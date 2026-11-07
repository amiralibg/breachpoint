import * as THREE from 'three';
import { worldPos } from '../core/ik';
import { GROUP_RAGDOLL, GROUP_WORLD, groups, RAPIER, type PhysicsWorld } from '../world/physics3d';

/*
 * Physics ragdoll for the Mixamo soldier.
 *
 * Eleven capsule bodies (pelvis, chest, head, upper/lower arms and legs). Every body starts with
 * the same orientation, so a hinge's zero angle is exactly the pose at death; knee and elbow
 * limits are then "straighten to 0" .. "fold to ~140 deg" relative to the bend they already had.
 * Bodies don't collide with each other (limbs often overlap the chest while holding a rifle,
 * which would make them explode apart), only with the world.
 * Each frame the bones are driven from their bodies; bones in between keep their local pose.
 */

interface Seg {
  name: string;
  from: string;
  to: string;
  radius: number;
  /** Bones this body drives (world transform follows the body). */
  drives: string[];
}

const SEGMENTS: Seg[] = [
  { name: 'pelvis', from: 'Hips', to: 'Spine1', radius: 0.14, drives: ['Hips'] },
  { name: 'chest', from: 'Spine1', to: 'Neck', radius: 0.16, drives: ['Spine2'] },
  { name: 'head', from: 'Neck', to: 'HeadTop_End', radius: 0.1, drives: ['Neck'] },
  { name: 'lUpArm', from: 'LeftArm', to: 'LeftForeArm', radius: 0.055, drives: ['LeftArm'] },
  { name: 'lForeArm', from: 'LeftForeArm', to: 'LeftHand', radius: 0.045, drives: ['LeftForeArm'] },
  { name: 'rUpArm', from: 'RightArm', to: 'RightForeArm', radius: 0.055, drives: ['RightArm'] },
  { name: 'rForeArm', from: 'RightForeArm', to: 'RightHand', radius: 0.045, drives: ['RightForeArm'] },
  { name: 'lThigh', from: 'LeftUpLeg', to: 'LeftLeg', radius: 0.08, drives: ['LeftUpLeg'] },
  { name: 'lShin', from: 'LeftLeg', to: 'LeftFoot', radius: 0.06, drives: ['LeftLeg'] },
  { name: 'rThigh', from: 'RightUpLeg', to: 'RightLeg', radius: 0.08, drives: ['RightUpLeg'] },
  { name: 'rShin', from: 'RightLeg', to: 'RightFoot', radius: 0.06, drives: ['RightLeg'] },
];

/** [parent body, child body, joint bone, hinge?] */
const JOINTS: [string, string, string, 'hinge' | 'ball'][] = [
  ['pelvis', 'chest', 'Spine1', 'ball'],
  ['chest', 'head', 'Neck', 'ball'],
  ['chest', 'lUpArm', 'LeftArm', 'ball'],
  ['lUpArm', 'lForeArm', 'LeftForeArm', 'hinge'],
  ['chest', 'rUpArm', 'RightArm', 'ball'],
  ['rUpArm', 'rForeArm', 'RightForeArm', 'hinge'],
  ['pelvis', 'lThigh', 'LeftUpLeg', 'ball'],
  ['lThigh', 'lShin', 'LeftLeg', 'hinge'],
  ['pelvis', 'rThigh', 'RightUpLeg', 'ball'],
  ['rThigh', 'rShin', 'RightLeg', 'hinge'],
];

const MASS_SHARE: Record<string, number> = {
  pelvis: 0.16, chest: 0.28, head: 0.08, lUpArm: 0.03, lForeArm: 0.025, rUpArm: 0.03, rForeArm: 0.025,
  lThigh: 0.1, lShin: 0.06, rThigh: 0.1, rShin: 0.06,
};

interface Driven {
  bone: THREE.Bone;
  body: RAPIER.RigidBody;
  /** bodyWorld^-1 * boneWorld at creation. */
  offset: THREE.Matrix4;
  depth: number;
}

const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();

export class Ragdoll {
  private bodies = new Map<string, RAPIER.RigidBody>();
  private joints: RAPIER.ImpulseJoint[] = [];
  private driven: Driven[] = [];
  private t = 0;
  frozen = false;

  constructor(
    private phys: PhysicsWorld,
    model: THREE.Object3D,
    /** Per-bone world velocity at the moment of death (from the last animated frames). */
    velocityOf: (bone: THREE.Bone) => THREE.Vector3,
  ) {
    const W = phys.world;
    const get = (n: string): THREE.Bone => model.getObjectByName(`mixamorig${n}`) as THREE.Bone;
    model.updateMatrixWorld(true);
    const rootQ = get('Hips').parent!.getWorldQuaternion(new THREE.Quaternion());
    const rq = { x: rootQ.x, y: rootQ.y, z: rootQ.z, w: rootQ.w };
    const invRoot = rootQ.clone().invert();
    const up = new THREE.Vector3(0, 1, 0);

    for (const s of SEGMENTS) {
      const a = worldPos(get(s.from));
      const b = worldPos(get(s.to));
      if (s.name === 'head') b.lerp(a, 0.15);
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const dir = b.clone().sub(a);
      const len = dir.length();
      dir.normalize();
      const v = velocityOf(get(s.from));
      const body = W.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(mid.x, mid.y, mid.z)
        .setRotation(rq)
        .setLinvel(v.x, v.y, v.z)
        .setLinearDamping(0.15)
        .setAngularDamping(1.6)
        .setCcdEnabled(s.name === 'head' || s.name === 'chest'));
      // Capsule axis is local Y: rotate it onto the segment inside the body frame.
      const local = new THREE.Quaternion().setFromUnitVectors(up, dir.clone().applyQuaternion(invRoot));
      const halfH = Math.max(0.01, len / 2 - s.radius * 0.6);
      const vol = Math.PI * s.radius * s.radius * (2 * halfH) + (4 / 3) * Math.PI * s.radius ** 3;
      W.createCollider(RAPIER.ColliderDesc.capsule(halfH, s.radius)
        .setRotation({ x: local.x, y: local.y, z: local.z, w: local.w })
        .setDensity((80 * MASS_SHARE[s.name]) / vol)
        .setFriction(0.9)
        .setRestitution(0.05)
        .setCollisionGroups(groups(GROUP_RAGDOLL, GROUP_WORLD)), body);
      this.bodies.set(s.name, body);
    }

    for (const [pa, ch, boneName, kind] of JOINTS) {
      const b1 = this.bodies.get(pa)!;
      const b2 = this.bodies.get(ch)!;
      const at = worldPos(get(boneName));
      const a1 = this.toLocal(b1, at);
      const a2 = this.toLocal(b2, at);
      let joint: RAPIER.ImpulseJoint;
      if (kind === 'hinge') {
        // Hinge axis from the current bend; positive rotation folds the limb further.
        const seg1 = SEGMENTS.find((s) => s.name === pa)!;
        const seg2 = SEGMENTS.find((s) => s.name === ch)!;
        const u = worldPos(get(seg1.to)).sub(worldPos(get(seg1.from))).normalize();
        const f = worldPos(get(seg2.to)).sub(worldPos(get(seg2.from))).normalize();
        let axis = new THREE.Vector3().crossVectors(u, f);
        const bend = Math.acos(THREE.MathUtils.clamp(u.dot(f), -1, 1));
        if (axis.lengthSq() < 1e-4) {
          // Nearly straight: knees fold backward, elbows forward
          const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(rootQ);
          axis = new THREE.Vector3().crossVectors(f, ch.includes('Shin') ? fwd.negate() : fwd);
        }
        axis.normalize().applyQuaternion(invRoot);
        const jd = RAPIER.JointData.revolute(a1, a2, { x: axis.x, y: axis.y, z: axis.z });
        joint = W.createImpulseJoint(jd, b1, b2, true);
        (joint as RAPIER.RevoluteImpulseJoint).setLimits(-bend, (ch.includes('Shin') ? 2.4 : 2.5) - bend);
      } else {
        joint = W.createImpulseJoint(RAPIER.JointData.spherical(a1, a2), b1, b2, true);
      }
      joint.setContactsEnabled(false);
      this.joints.push(joint);
    }

    for (const s of SEGMENTS) {
      const body = this.bodies.get(s.name)!;
      for (const bn of s.drives) {
        const bone = get(bn);
        let depth = 0;
        for (let p: THREE.Object3D | null = bone; p; p = p.parent) depth++;
        this.driven.push({ bone, body, offset: this.bodyMatrix(body, new THREE.Matrix4()).invert().multiply(bone.matrixWorld), depth });
      }
    }
    this.driven.sort((x, y) => x.depth - y.depth);
  }

  private toLocal(body: RAPIER.RigidBody, p: THREE.Vector3): { x: number; y: number; z: number } {
    const v = p.clone().applyMatrix4(this.bodyMatrix(body, _m2).invert());
    return { x: v.x, y: v.y, z: v.z };
  }

  private bodyMatrix(body: RAPIER.RigidBody, out: THREE.Matrix4): THREE.Matrix4 {
    const t = body.translation();
    const r = body.rotation();
    return out.compose(_p.set(t.x, t.y, t.z), _q.set(r.x, r.y, r.z, r.w), _s.set(1, 1, 1));
  }

  /** Push a body part, e.g. where a bullet hit. */
  impulse(part: 'head' | 'chest' | 'pelvis' | 'arm' | 'leg', impulse: THREE.Vector3, at?: THREE.Vector3): void {
    const name = part === 'arm' ? (Math.random() < 0.5 ? 'lUpArm' : 'rUpArm')
      : part === 'leg' ? (Math.random() < 0.5 ? 'lThigh' : 'rThigh') : part;
    const b = this.bodies.get(name);
    if (!b) return;
    if (at) b.applyImpulseAtPoint(impulse, at, true);
    else b.applyImpulse(impulse, true);
  }

  /** Nearest body part to a world point (for routing bullet impulses). */
  partNear(p: THREE.Vector3): 'head' | 'chest' | 'pelvis' | 'arm' | 'leg' {
    let best = 'chest';
    let bd = Infinity;
    for (const [n, b] of this.bodies) {
      const t = b.translation();
      const d = (t.x - p.x) ** 2 + (t.y - p.y) ** 2 + (t.z - p.z) ** 2;
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    return best.includes('Arm') ? 'arm' : best.includes('Thigh') || best.includes('Shin') ? 'leg' : best as 'head' | 'chest' | 'pelvis';
  }

  /** Is everything at rest? */
  get settled(): boolean {
    for (const b of this.bodies.values()) if (!b.isSleeping()) return false;
    return true;
  }

  update(dt: number): void {
    if (this.frozen) return;
    this.t += dt;
    for (const d of this.driven) {
      const world = this.bodyMatrix(d.body, _m).multiply(d.offset);
      const parent = d.bone.parent!;
      parent.updateWorldMatrix(true, false);
      _m2.copy(parent.matrixWorld).invert().multiply(world);
      _m2.decompose(d.bone.position, d.bone.quaternion, _s);
      d.bone.updateMatrixWorld(true);
    }
    // Settled (or long enough): bake the pose and free the physics bodies
    if (this.t > 1.5 && (this.settled || this.t > 9)) this.dispose();
  }

  get pelvisWorld(): THREE.Vector3 {
    const t = this.bodies.get('chest')?.translation();
    return t ? new THREE.Vector3(t.x, t.y, t.z) : new THREE.Vector3();
  }

  dispose(): void {
    if (this.frozen) return;
    this.frozen = true;
    for (const b of this.bodies.values()) this.phys.world.removeRigidBody(b);
    this.bodies.clear();
    this.joints = [];
  }
}
