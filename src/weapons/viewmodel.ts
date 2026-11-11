import * as THREE from 'three';
import { flashTexture } from '../world/effects';
import { applyGunFinish } from './finish';
import { GunSurface } from './surface';
import type { V3 } from './timeline';
import { weaponModel, type HandAnchor, type WeaponDef } from './weapons';

/**
 * First-person model of one weapon. Presentation only: the controller decides the pose.
 *
 * Part offsets are given in holder space (the gun's own view-space frame) and converted into each
 * part's parent space, because imported models carry odd parent transforms (the M4's Receiver has
 * scale 100 under a 0.01 fbx node, plus rotations).
 */

interface PartNode {
  node: THREE.Object3D;
  restPos: THREE.Vector3;
  restQuat: THREE.Quaternion;
  /** Holder delta -> parent-local delta. */
  toParent: THREE.Matrix3;
  /** Parent rotation relative to the holder. */
  parentQ: THREE.Quaternion;
  /** Part origin in holder space at rest. */
  origin: THREE.Vector3;
}

interface Part {
  nodes: PartNode[];
  offset: THREE.Vector3;
  rot: THREE.Quaternion;
}

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();

interface Casing {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  t: number;
  born: number;
}

export class Viewmodel {
  readonly group = new THREE.Group();
  readonly muzzle = new THREE.Object3D();
  readonly flash: THREE.Sprite;
  private parts = new Map<string, Part>();
  private surfaces = new Map<string, GunSurface>();
  private casings: Casing[] = [];
  private round: THREE.Object3D | null = null;
  private casingGeo: THREE.BufferGeometry;
  private casingMat: THREE.MeshStandardMaterial;

  private constructor(readonly def: WeaponDef, readonly model: THREE.Object3D) {
    this.group.name = def.id;
    this.group.add(model);
    this.muzzle.position.set(...def.muzzle);
    this.group.add(this.muzzle);
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({
      map: flashTexture, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    }));
    this.flash.visible = false;
    this.muzzle.add(this.flash);

    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.frustumCulled = false;
        const mat = m.material as THREE.MeshStandardMaterial;
        mat.envMapIntensity = 1.2;
        if (!m.userData.noTouch && !mat.transparent) applyGunFinish(mat, def.finish);
      }
    });

    this.group.updateMatrixWorld(true);
    const inv = this.group.matrixWorld.clone().invert();
    for (const [role, names] of Object.entries(def.parts)) {
      const nodes: PartNode[] = [];
      for (const n of names) {
        const node = model.getObjectByName(n);
        if (!node || !node.parent) {
          console.warn(`${def.id}: part ${role} (${n}) not found`);
          continue;
        }
        const rel = inv.clone().multiply(node.parent.matrixWorld);
        const pos = new THREE.Vector3();
        const parentQ = new THREE.Quaternion();
        rel.decompose(pos, parentQ, new THREE.Vector3());
        nodes.push({
          node,
          restPos: node.position.clone(),
          restQuat: node.quaternion.clone(),
          toParent: new THREE.Matrix3().setFromMatrix4(rel).invert(),
          parentQ,
          origin: node.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv),
        });
      }
      if (nodes.length) this.parts.set(role, { nodes, offset: new THREE.Vector3(), rot: new THREE.Quaternion() });
    }
    for (const p of def.hiddenParts ?? []) this.setPartVisible(p, false);
    this.buildSurfaces(inv);
    if (def.magRound) this.addMagRound(def.magRound);

    this.casingGeo = new THREE.CylinderGeometry(0.0028, 0.0028, def.id === 'pistol' ? 0.018 : 0.04, 8).rotateZ(Math.PI / 2);
    this.casingMat = new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 1, roughness: 0.3, envMapIntensity: 1.5 });
  }

  /**
   * The top cartridge of the magazine, sitting in the feed lips: what tells a loaded magazine from
   * an empty one when it is turned toward the eye. Placed from the magazine's own bounds.
   */
  private addMagRound(spec: NonNullable<WeaponDef['magRound']>): void {
    const node = this.parts.get('mag')?.nodes[0].node;
    if (!node) return;
    const box = new THREE.Box3().setFromObject(node);
    if (box.isEmpty()) return;
    const [len, r] = spec.size;
    const caseLen = len * 0.7;
    const brass = new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 1, roughness: 0.28, envMapIntensity: 1.4 });
    const copper = new THREE.MeshStandardMaterial({ color: 0xb4683c, metalness: 1, roughness: 0.34, envMapIntensity: 1.4 });
    const round = new THREE.Group();
    round.name = 'mag-round';
    const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r, caseLen, 14).rotateX(Math.PI / 2), brass);
    body.position.z = (len - caseLen) / 2;
    // Bullet: an ogive from the case mouth to the tip
    const pts: THREE.Vector2[] = [];
    const tipLen = len - caseLen;
    for (let i = 0; i <= 8; i++) {
      const u = i / 8;
      pts.push(new THREE.Vector2(r * 0.8 * Math.cos(u * Math.PI * 0.5) ** 0.7, u * tipLen));
    }
    const tip = new THREE.Mesh(new THREE.LatheGeometry(pts, 14).rotateX(-Math.PI / 2), copper);
    tip.position.z = (len - caseLen) / 2 - caseLen / 2;
    for (const m of [body, tip]) {
      m.frustumCulled = false;
      m.userData.noTouch = true;
      round.add(m);
    }
    const o = spec.offset ?? [0, 0, 0];
    round.position.set((box.min.x + box.max.x) / 2 + o[0], box.max.y - r * 0.55 + o[1], (box.min.z + box.max.z) / 2 + o[2]);
    this.group.add(round);
    round.updateMatrixWorld(true);
    node.attach(round);
    this.round = round;
  }

  /** Show or hide the magazine's top round (an empty magazine has none). */
  setRoundVisible(on: boolean): void {
    if (this.round) this.round.visible = on;
  }

  static async create(def: WeaponDef): Promise<Viewmodel> {
    return new Viewmodel(def, await weaponModel(def));
  }

  /**
   * Touchable shapes, in holder space with every part at rest: 'all' is the gun as it looks at
   * rest (hidden spares and parts left out), and each part role is that part by itself, for a
   * hand holding a magazine that is out of the gun.
   */
  private buildSurfaces(toHolder: THREE.Matrix4): void {
    const shown = (o: THREE.Object3D): boolean => {
      for (let n: THREE.Object3D | null = o; n && n !== this.group; n = n.parent) if (!n.visible) return false;
      return true;
    };
    const all: THREE.Mesh[] = [];
    this.model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && shown(m) && !m.userData.noTouch) all.push(m);
    });
    this.surfaces.set('all', new GunSurface(all, toHolder));
    for (const [role, part] of this.parts) {
      const meshes: THREE.Mesh[] = [];
      for (const n of part.nodes) {
        n.node.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
        });
      }
      this.surfaces.set(role, new GunSurface(meshes, toHolder));
    }
  }

  /** The gun's touchable shape ('all') or one part's, in holder space at rest. */
  surface(key = 'all'): GunSurface {
    return this.surfaces.get(key) ?? this.surfaces.get('all')!;
  }

  hasPart(role: string): boolean {
    return this.parts.has(role);
  }

  /** Offset a part from its rest pose (holder space translation + YXZ euler rotation about its origin). */
  posePart(role: string, offset: V3, rot?: V3): void {
    const p = this.parts.get(role);
    if (!p) return;
    p.offset.set(offset[0], offset[1], offset[2]);
    if (rot) p.rot.setFromEuler(_e.set(rot[0], rot[1], rot[2], 'YXZ'));
    else p.rot.identity();
    for (const n of p.nodes) {
      _v.copy(p.offset).applyMatrix3(n.toParent);
      n.node.position.copy(n.restPos).add(_v);
      // local = parentQ^-1 * R * parentQ * rest
      _q.copy(n.parentQ).invert().multiply(p.rot).multiply(n.parentQ);
      n.node.quaternion.copy(_q).multiply(n.restQuat);
    }
  }

  setPartVisible(role: string, on: boolean): void {
    for (const n of this.parts.get(role)?.nodes ?? []) n.node.visible = on;
  }

  /**
   * Hand anchor in holder space, following the part it's attached to. `seated` replaces the
   * authored wrist position with the one the grip solver settled on.
   */
  anchor(a: HandAnchor, outPos: THREE.Vector3, outFwd: THREE.Vector3, outBack: THREE.Vector3, seated?: THREE.Vector3): void {
    if (seated) outPos.copy(seated);
    else outPos.set(...a.pos);
    outFwd.set(...a.fwd).normalize();
    outBack.set(...a.back).normalize();
    const p = a.part ? this.parts.get(a.part) : undefined;
    if (p) {
      const o = p.nodes[0].origin;
      outPos.sub(o).applyQuaternion(p.rot).add(o).add(p.offset);
      outFwd.applyQuaternion(p.rot);
      outBack.applyQuaternion(p.rot);
    }
  }

  /** A holder-space point riding on a part's current offset/rotation (or fixed when no part). */
  partPoint(role: string | undefined, p: V3, out = new THREE.Vector3()): THREE.Vector3 {
    out.set(p[0], p[1], p[2]);
    const part = role ? this.parts.get(role) : undefined;
    if (part) {
      const o = part.nodes[0].origin;
      out.sub(o).applyQuaternion(part.rot).add(o).add(part.offset);
    }
    return out;
  }

  /** Whether a part is currently shown (hidden mags shouldn't stop fingers). */
  partVisible(role: string): boolean {
    return this.parts.get(role)?.nodes[0].node.visible ?? true;
  }

  /** A loose copy of a part in world space (for dropping a magazine). */
  detachCopy(role: string): THREE.Object3D | null {
    const p = this.parts.get(role);
    if (!p) return null;
    const node = p.nodes[0].node;
    const copy = node.clone(true);
    node.updateWorldMatrix(true, false);
    node.matrixWorld.decompose(copy.position, copy.quaternion, copy.scale);
    copy.visible = true;
    return copy;
  }

  /** Spit a spent casing out of the ejection port (view space, simple ballistics). */
  eject(): void {
    const m = new THREE.Mesh(this.casingGeo, this.casingMat);
    m.position.set(...this.def.ejectPort).applyMatrix4(this.group.matrix);
    m.quaternion.copy(this.group.quaternion);
    m.frustumCulled = false;
    this.group.parent?.add(m);
    const r = Math.random();
    this.casings.push({
      mesh: m,
      vel: new THREE.Vector3(1.4 + r * 0.8, 1.0 + Math.random() * 0.7, 0.2 + Math.random() * 0.3),
      spin: new THREE.Vector3(Math.random() * 20, 15 + Math.random() * 20, Math.random() * 10),
      t: 0,
      born: performance.now(),
    });
  }

  updateCasings(dt: number): void {
    for (let i = this.casings.length - 1; i >= 0; i--) {
      const c = this.casings[i];
      c.t += dt;
      c.vel.y -= 9 * dt;
      c.mesh.position.addScaledVector(c.vel, dt);
      c.mesh.rotation.x += c.spin.x * dt;
      c.mesh.rotation.y += c.spin.y * dt;
      c.mesh.rotation.z += c.spin.z * dt;
      // Wall-clock expiry too, so a paused or throttled frame loop never leaves one hanging in view
      if (c.t > 0.7 || performance.now() - c.born > 1500) {
        c.mesh.removeFromParent();
        this.casings.splice(i, 1);
      }
    }
  }
}
