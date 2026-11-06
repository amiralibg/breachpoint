import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { facingAngle } from './retarget';

export interface CharacterProto {
  scene: THREE.Object3D;
  animations: THREE.AnimationClip[];
}

/*
 * Procedural animation layer on top of the soldier's Idle/Walk/Run clips:
 *  - two-bone IK keeps both hands on the rifle (shouldered when aiming, low-ready when moving)
 *  - crouch with planted feet (leg IK)
 *  - torso pitch toward the target, recoil kick, hit flinch
 *  - death: knees buckle, limbs go limp and the body topples away from the shot,
 *    while the rifle drops and bounces on the ground
 * All bone edits are done in world space, so they don't depend on the rig's local axes.
 */

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();

function worldPos(o: THREE.Object3D, out = new THREE.Vector3()): THREE.Vector3 {
  return o.getWorldPosition(out);
}

/** Pre-multiply a world-space rotation onto a bone. */
function rotateWorld(bone: THREE.Object3D, q: THREE.Quaternion): void {
  const parentQ = bone.parent!.getWorldQuaternion(_q2);
  const world = parentQ.clone().multiply(bone.quaternion);
  world.premultiply(q);
  bone.quaternion.copy(parentQ.invert().multiply(world));
  bone.updateMatrixWorld(true);
}

function rotateAxis(bone: THREE.Object3D, axis: THREE.Vector3, angle: number): void {
  if (Math.abs(angle) < 1e-5) return;
  rotateWorld(bone, _q.setFromAxisAngle(axis, angle));
}

/** Rotate `bone` so the direction toward `child` points at `target` (world space). */
function aimBone(bone: THREE.Object3D, child: THREE.Object3D, target: THREE.Vector3, weight = 1): void {
  const a = worldPos(bone, _v1);
  const from = worldPos(child, _v2).sub(a).normalize();
  const to = _v3.copy(target).sub(a).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(from, to);
  if (weight < 1) q.slerp(new THREE.Quaternion(), 1 - weight);
  rotateWorld(bone, q);
}

/** Analytic two-bone IK: a (shoulder/hip) -> b (elbow/knee) -> c (wrist/ankle). */
function twoBoneIK(
  a: THREE.Object3D, b: THREE.Object3D, c: THREE.Object3D,
  target: THREE.Vector3, pole: THREE.Vector3, weight = 1,
): void {
  const A = worldPos(a);
  const B = worldPos(b);
  const C = worldPos(c);
  const lab = A.distanceTo(B);
  const lbc = B.distanceTo(C);
  const toT = new THREE.Vector3().subVectors(target, A);
  const d = THREE.MathUtils.clamp(toT.length(), 0.05, (lab + lbc) * 0.999);
  const dir = toT.normalize();
  const poleDir = new THREE.Vector3().subVectors(pole, A);
  poleDir.addScaledVector(dir, -poleDir.dot(dir)).normalize();
  const cosA = THREE.MathUtils.clamp((lab * lab + d * d - lbc * lbc) / (2 * lab * d), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  const elbow = A.clone().addScaledVector(dir, cosA * lab).addScaledVector(poleDir, sinA * lab);
  if (weight < 1) elbow.lerp(B, 1 - weight);
  aimBone(a, b, elbow);
  const end = weight < 1 ? worldPos(c).lerp(target, weight) : target;
  aimBone(b, c, end);
}

interface Bones {
  hips: THREE.Bone; spine: THREE.Bone; spine1: THREE.Bone; spine2: THREE.Bone; neck: THREE.Bone; head: THREE.Bone;
  lArm: THREE.Bone; lFore: THREE.Bone; lHand: THREE.Bone; lFinger: THREE.Bone;
  rArm: THREE.Bone; rFore: THREE.Bone; rHand: THREE.Bone; rFinger: THREE.Bone;
  lUpLeg: THREE.Bone; lLeg: THREE.Bone; lFoot: THREE.Bone;
  rUpLeg: THREE.Bone; rLeg: THREE.Bone; rFoot: THREE.Bone;
}

export class SoldierRig {
  /** Positioned at the feet, rotation.y = facing (forward is +Z). */
  readonly root = new THREE.Group();
  private tilt = new THREE.Group();
  private model: THREE.Object3D;
  private mixer: THREE.AnimationMixer;
  private actions: Record<string, THREE.AnimationAction> = {};
  private anim = '';
  private b: Bones;
  readonly gunPivot = new THREE.Group();
  readonly muzzle = new THREE.Object3D();

  /** 0 = standing, 1 = fully crouched. */
  crouch = 0;
  crouchTarget = 0;
  /** 0 = low ready, 1 = shouldered and aimed. */
  aim = 0;
  aimTarget = 0;
  aimPoint = new THREE.Vector3();
  private recoil = 0;
  private flinch = new THREE.Vector3();
  private flinchVel = new THREE.Vector3();

  dead = false;
  private deathT = 0;
  private fallAxis = new THREE.Vector3(1, 0, 0);
  private fallSign = 1;
  private snapshot: THREE.Quaternion[] = [];
  private allBones: THREE.Bone[] = [];
  private hipsDeathPos = new THREE.Vector3();
  private gunVel = new THREE.Vector3();
  private gunSpin = new THREE.Vector3();
  private gunResting = false;
  private headRoll = (Math.random() - 0.5) * 0.8;

  constructor(proto: CharacterProto, gun: THREE.Object3D, private scene: THREE.Scene, muzzleZ = 0.58) {
    this.model = SkeletonUtils.clone(proto.scene);
    this.model.rotation.y = facingAngle(this.model); // face +Z inside the rig
    this.tilt.add(this.model);
    this.root.add(this.tilt);
    this.model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
        m.frustumCulled = false;
      }
      if ((o as THREE.Bone).isBone) this.allBones.push(o as THREE.Bone);
    });
    const get = (n: string): THREE.Bone => {
      const o = this.model.getObjectByName(`mixamorig${n}`);
      if (!o) throw new Error(`soldier rig: missing bone ${n}`);
      return o as THREE.Bone;
    };
    this.b = {
      hips: get('Hips'), spine: get('Spine'), spine1: get('Spine1'), spine2: get('Spine2'), neck: get('Neck'), head: get('Head'),
      lArm: get('LeftArm'), lFore: get('LeftForeArm'), lHand: get('LeftHand'), lFinger: get('LeftHandMiddle1'),
      rArm: get('RightArm'), rFore: get('RightForeArm'), rHand: get('RightHand'), rFinger: get('RightHandMiddle1'),
      lUpLeg: get('LeftUpLeg'), lLeg: get('LeftLeg'), lFoot: get('LeftFoot'),
      rUpLeg: get('RightUpLeg'), rLeg: get('RightLeg'), rFoot: get('RightFoot'),
    };

    this.mixer = new THREE.AnimationMixer(this.model);
    for (const clip of proto.animations) this.actions[clip.name] = this.mixer.clipAction(clip);
    this.play('Idle');

    // Rifle: pivot +Z is the barrel direction; the model's muzzle is -Z so flip it.
    const g = new THREE.Group();
    g.add(gun.clone(true));
    g.rotation.y = Math.PI;
    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
      if (o.name === 'reddot') o.visible = false;
    });
    this.gunPivot.add(g);
    this.muzzle.position.set(0, 0.012, muzzleZ);
    this.gunPivot.add(this.muzzle);
    this.root.add(this.gunPivot);
  }

  play(name: 'Idle' | 'Walk' | 'Run', speed = 1): void {
    const next = this.actions[name];
    if (!next) return;
    next.timeScale = speed;
    if (this.anim === name) return;
    const prev = this.actions[this.anim];
    next.reset().setEffectiveWeight(1).fadeIn(0.25).play();
    if (prev) prev.fadeOut(0.25);
    this.anim = name;
  }

  kick(): void {
    this.recoil = 1;
  }

  /** Direction the hit came from (world, bullet travel direction). */
  hit(dir: THREE.Vector3, strength = 1): void {
    this.flinchVel.addScaledVector(dir, 6 * strength);
  }

  get headWorld(): THREE.Vector3 {
    return worldPos(this.b.head);
  }

  get chestWorld(): THREE.Vector3 {
    return worldPos(this.b.spine2);
  }

  die(bulletDir: THREE.Vector3): void {
    if (this.dead) return;
    this.dead = true;
    this.deathT = 0;
    // Snapshot first: stopping the mixer restores the bind (T) pose.
    this.snapshot = this.allBones.map((b) => b.quaternion.clone());
    this.hipsDeathPos.copy(this.b.hips.position);
    this.mixer.stopAllAction();
    // Fall in the bullet's direction, expressed in root-local space
    const local = bulletDir.clone().setY(0).normalize();
    local.applyQuaternion(this.root.quaternion.clone().invert());
    this.fallAxis.set(local.z, 0, -local.x).normalize(); // rotation axis = up x dir
    this.fallSign = 1;
    // Drop the rifle into the world
    this.scene.attach(this.gunPivot);
    this.gunVel.copy(bulletDir).setY(0).normalize().multiplyScalar(1.2).add(new THREE.Vector3(0, 1.4, 0));
    this.gunSpin.set((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 8);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.scene.remove(this.gunPivot);
  }

  update(dt: number): void {
    if (this.dead) {
      this.updateDeath(dt);
      return;
    }
    this.mixer.update(dt);
    this.root.updateMatrixWorld(true);

    const b = this.b;
    const up = new THREE.Vector3(0, 1, 0);
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(this.root.quaternion);
    const right = new THREE.Vector3().crossVectors(fwd, up).normalize(); // character's right

    // --- Crouch with planted feet
    this.crouch = THREE.MathUtils.damp(this.crouch, this.crouchTarget, 8, dt);
    if (this.crouch > 0.01) {
      const lf = worldPos(b.lFoot);
      const rf = worldPos(b.rFoot);
      const hips = worldPos(b.hips);
      hips.y -= this.crouch * 0.42;
      hips.addScaledVector(fwd, -this.crouch * 0.12);
      b.hips.position.copy(b.hips.parent!.worldToLocal(hips));
      b.hips.updateMatrixWorld(true);
      for (const [up_, leg, foot, target] of [[b.lUpLeg, b.lLeg, b.lFoot, lf], [b.rUpLeg, b.rLeg, b.rFoot, rf]] as const) {
        const knee = worldPos(up_).addScaledVector(fwd, 1.0);
        twoBoneIK(up_, leg, foot, target, knee);
      }
      rotateAxis(b.spine, right, this.crouch * 0.35);
    }

    // --- Torso: pitch toward the aim point, flinch spring
    this.aim = THREE.MathUtils.damp(this.aim, this.aimTarget, 7, dt);
    const chest = worldPos(b.spine2);
    const toAim = new THREE.Vector3().subVectors(this.aimPoint, chest);
    const pitch = Math.atan2(toAim.y, Math.hypot(toAim.x, toAim.z)) * this.aim;
    rotateAxis(b.spine1, right, -pitch * 0.35);
    rotateAxis(b.spine2, right, -pitch * 0.35);

    this.flinchVel.addScaledVector(this.flinch, -120 * dt);
    this.flinchVel.multiplyScalar(Math.max(0, 1 - 14 * dt));
    this.flinch.addScaledVector(this.flinchVel, dt);
    if (this.flinch.lengthSq() > 1e-6) {
      const axis = new THREE.Vector3().crossVectors(up, this.flinch).normalize();
      const amt = Math.min(0.6, this.flinch.length());
      rotateAxis(b.spine1, axis, amt * 0.6);
      rotateAxis(b.spine2, axis, amt * 0.5);
      rotateAxis(b.neck, axis, amt * 0.4);
    }

    // --- Rifle placement relative to the neck
    this.recoil = Math.max(0, this.recoil - dt * 10);
    const neck = worldPos(b.neck);
    const aimedPos = neck.clone().addScaledVector(right, 0.1).addScaledVector(up, -0.075).addScaledVector(fwd, 0.3);
    const lowPos = neck.clone().addScaledVector(right, 0.06).addScaledVector(up, -0.32).addScaledVector(fwd, 0.34);
    const gunPos = lowPos.lerp(aimedPos, this.aim);
    const aimDir = toAim.normalize();
    const lowDir = fwd.clone().addScaledVector(up, -0.75).addScaledVector(right, -0.45).normalize();
    const dir = lowDir.lerp(aimDir, this.aim).normalize();
    gunPos.addScaledVector(dir, -this.recoil * 0.04);
    dir.addScaledVector(up, this.recoil * 0.08).normalize();
    this.gunPivot.position.copy(this.root.worldToLocal(gunPos.clone()));
    this.gunPivot.updateMatrixWorld(true);
    this.gunPivot.lookAt(gunPos.clone().add(dir));
    this.gunPivot.updateMatrixWorld(true);

    // --- Arms onto the rifle (wrist targets slightly off the grip surfaces)
    const rGrip = this.gunPivot.localToWorld(new THREE.Vector3(-0.022, -0.05, -0.065));
    const lGrip = this.gunPivot.localToWorld(new THREE.Vector3(0.045, -0.04, 0.2));
    const rShoulder = worldPos(b.rArm);
    const lShoulder = worldPos(b.lArm);
    twoBoneIK(b.rArm, b.rFore, b.rHand, rGrip,
      rShoulder.clone().addScaledVector(up, -1).addScaledVector(right, 0.8).addScaledVector(fwd, -0.2));
    twoBoneIK(b.lArm, b.lFore, b.lHand, lGrip,
      lShoulder.clone().addScaledVector(up, -1).addScaledVector(right, -0.6).addScaledVector(fwd, 0.1));

    // Hands: fingers wrap the grip (right) and support the handguard from below (left)
    const gunFwd = new THREE.Vector3(0, 0, 1).applyQuaternion(this.gunPivot.quaternion);
    const gunUp = new THREE.Vector3(0, 1, 0).applyQuaternion(this.gunPivot.quaternion);
    const gunLeft = new THREE.Vector3().crossVectors(gunUp, gunFwd);
    aimBone(b.rHand, b.rFinger, worldPos(b.rHand).addScaledVector(gunFwd, 0.4).addScaledVector(gunUp, -0.6).addScaledVector(gunLeft, 0.5));
    aimBone(b.lHand, b.lFinger, worldPos(b.lHand).addScaledVector(gunFwd, 0.7).addScaledVector(gunLeft, -0.4).addScaledVector(gunUp, 0.2));
  }

  private updateDeath(dt: number): void {
    this.deathT += dt;
    const t = this.deathT;
    const b = this.b;

    // Restore the pose at death, then layer the collapse on top.
    this.allBones.forEach((bone, i) => bone.quaternion.copy(this.snapshot[i]));
    b.hips.position.copy(this.hipsDeathPos);

    const buckle = THREE.MathUtils.smoothstep(t, 0, 0.35);
    const fall = THREE.MathUtils.clamp((t - 0.15) / 0.7, 0, 1);
    let angle = fall * fall * (Math.PI / 2) * 0.96;
    if (t > 0.85) angle += Math.sin((t - 0.85) * 18) * Math.exp(-(t - 0.85) * 8) * 0.06; // ground bounce

    this.tilt.quaternion.setFromAxisAngle(this.fallAxis, angle * this.fallSign);
    this.tilt.position.y = Math.sin(angle) * 0.13;
    this.root.updateMatrixWorld(true);

    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.tilt.getWorldQuaternion(new THREE.Quaternion()));
    const fallAxisWorld = this.fallAxis.clone().applyQuaternion(this.root.quaternion);

    // Knees buckle while toppling, then the legs straighten out on the ground
    const kneeBend = buckle * (1 - fall * 0.7);
    const hipsWorld = worldPos(b.hips).addScaledVector(up, -kneeBend * 0.3);
    b.hips.position.copy(b.hips.parent!.worldToLocal(hipsWorld));
    b.hips.updateMatrixWorld(true);
    const bodyFwd = new THREE.Vector3().crossVectors(up, fallAxisWorld).normalize().negate();
    for (const [upLeg, leg, foot] of [[b.lUpLeg, b.lLeg, b.lFoot], [b.rUpLeg, b.rLeg, b.rFoot]] as const) {
      const hip = worldPos(upLeg);
      const len = hip.distanceTo(worldPos(leg)) + worldPos(leg).distanceTo(worldPos(foot));
      const target = hip.clone().addScaledVector(up, -len * (1 - kneeBend * 0.35));
      twoBoneIK(upLeg, leg, foot, target, hip.clone().addScaledVector(bodyFwd, -1));
    }

    // Spine and head slump, arms go limp toward the ground
    // Upper body folds toward the fall direction so it ends up flat on the ground
    rotateAxis(b.spine, fallAxisWorld, buckle * 0.12 + fall * 0.12);
    rotateAxis(b.spine2, fallAxisWorld, buckle * 0.08 + fall * 0.1);
    rotateAxis(b.neck, fallAxisWorld, buckle * 0.25 + fall * 0.2);
    rotateAxis(b.head, up, this.headRoll * buckle);
    const down = new THREE.Vector3(0, -1, 0);
    const limp = THREE.MathUtils.smoothstep(t, 0.05, 0.6);
    for (const [arm, fore, hand] of [[b.lArm, b.lFore, b.lHand], [b.rArm, b.rFore, b.rHand]] as const) {
      const sh = worldPos(arm);
      aimBone(arm, fore, sh.clone().add(down).addScaledVector(fallAxisWorld, 0.3), limp * 0.8);
      aimBone(fore, hand, worldPos(fore).add(down), limp * 0.6);
    }

    // Dropped rifle: simple rigid body with ground bounce
    if (!this.gunResting) {
      this.gunVel.y -= 9.8 * dt;
      this.gunPivot.position.addScaledVector(this.gunVel, dt);
      this.gunPivot.rotation.x += this.gunSpin.x * dt;
      this.gunPivot.rotation.y += this.gunSpin.y * dt;
      this.gunPivot.rotation.z += this.gunSpin.z * dt;
      if (this.gunPivot.position.y < 0.035) {
        this.gunPivot.position.y = 0.035;
        if (this.gunVel.y < -1.2) {
          this.gunVel.y *= -0.3;
          this.gunVel.x *= 0.5;
          this.gunVel.z *= 0.5;
          this.gunSpin.multiplyScalar(0.4);
        } else {
          this.gunResting = true;
          // Lay it flat on its side
          const yaw = this.gunPivot.rotation.y;
          this.gunPivot.rotation.set(0, yaw, Math.PI / 2);
          this.gunPivot.position.y = 0.025;
        }
      }
    }
  }

  /** Approximate world position of the torso once the body is down (for blood pools). */
  get torsoWorld(): THREE.Vector3 {
    return worldPos(this.b.spine1);
  }
}
