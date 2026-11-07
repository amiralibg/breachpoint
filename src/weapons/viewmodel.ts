import * as THREE from 'three';
import { flashTexture } from '../world/effects';
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
  private casings: Casing[] = [];
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

    this.casingGeo = new THREE.CylinderGeometry(0.0028, 0.0028, def.id === 'pistol' ? 0.018 : 0.04, 8).rotateZ(Math.PI / 2);
    this.casingMat = new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 1, roughness: 0.3, envMapIntensity: 1.5 });
  }

  static async create(def: WeaponDef): Promise<Viewmodel> {
    return new Viewmodel(def, await weaponModel(def));
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

  /** Hand anchor in holder space, following the part it's attached to. */
  anchor(a: HandAnchor, outPos: THREE.Vector3, outFwd: THREE.Vector3, outBack: THREE.Vector3): void {
    outPos.set(...a.pos);
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
