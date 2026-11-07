import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { aimBone, rotateAxis, twoBoneIK, worldPos } from '../core/ik';
import type { HitZone } from '../net/protocol';
import { raySegment, raySphere } from '../world/physics';
import type { PhysicsWorld } from '../world/physics3d';
import { Ragdoll } from './ragdoll';
import { facingAngle } from './retarget';

export interface CharacterProto {
  scene: THREE.Object3D;
  animations: THREE.AnimationClip[];
}

/*
 * Procedural animation layer on top of the soldier's Idle/Walk/Run clips:
 *  - lower body turns toward the movement direction while the upper body keeps facing the aim,
 *    so bots strafe and backpedal; walking backwards plays the walk clip in reverse
 *  - crouch (standing and walking) with planted feet via leg IK, lean for peeking
 *  - two-bone IK keeps both hands on the rifle (shouldered when aiming, low-ready when moving)
 *  - reload: left hand strips the magazine, drops it, seats a new one and slaps the handle
 *  - torso pitch toward the target, recoil kick, directional hit flinch and stagger
 *  - death: Rapier ragdoll that inherits the body's motion plus the bullet's push;
 *    the rifle drops as a separate physics prop
 */

interface Bones {
  hips: THREE.Bone; spine: THREE.Bone; spine1: THREE.Bone; spine2: THREE.Bone; neck: THREE.Bone; head: THREE.Bone;
  lArm: THREE.Bone; lFore: THREE.Bone; lHand: THREE.Bone; lFinger: THREE.Bone;
  rArm: THREE.Bone; rFore: THREE.Bone; rHand: THREE.Bone; rFinger: THREE.Bone;
  lUpLeg: THREE.Bone; lLeg: THREE.Bone; lFoot: THREE.Bone;
  rUpLeg: THREE.Bone; rLeg: THREE.Bone; rFoot: THREE.Bone;
}

/** Bone segments used as hitboxes: [from, to, radius, zone]. */
const HITBOXES: [keyof Bones, keyof Bones, number, HitZone][] = [
  ['hips', 'spine2', 0.17, 'torso'],
  ['spine2', 'neck', 0.17, 'torso'],
  ['lArm', 'lFore', 0.06, 'arm'], ['lFore', 'lHand', 0.05, 'arm'],
  ['rArm', 'rFore', 0.06, 'arm'], ['rFore', 'rHand', 0.05, 'arm'],
  ['lUpLeg', 'lLeg', 0.09, 'leg'], ['lLeg', 'lFoot', 0.07, 'leg'],
  ['rUpLeg', 'rLeg', 0.09, 'leg'], ['rLeg', 'rFoot', 0.07, 'leg'],
];

function gunUpNow(pivot: THREE.Object3D): THREE.Vector3 {
  return new THREE.Vector3(0, 1, 0).applyQuaternion(pivot.getWorldQuaternion(new THREE.Quaternion()));
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
  private gunMag: THREE.Object3D | null = null;
  private gunMagRest = new THREE.Vector3();
  private gunSize = new THREE.Vector3(0.08, 0.25, 0.8);
  private gunCenter = new THREE.Vector3();

  /** 0 = standing, 1 = fully crouched. */
  crouch = 0;
  crouchTarget = 0;
  /** 0 = low ready, 1 = shouldered and aimed. */
  aim = 0;
  aimTarget = 0;
  aimPoint = new THREE.Vector3();
  /** -1 = lean left .. 1 = lean right (peeking around cover). */
  lean = 0;
  leanTarget = 0;
  /** World-space ground velocity (drives the locomotion layer). */
  readonly velocity = new THREE.Vector3();
  /** Reload progress 0..1, or -1 when not reloading. */
  reload = -1;
  /** Grenade throw progress 0..1, or -1. */
  throwT = -1;
  private magDropped = false;
  onMagDrop: ((mag: THREE.Object3D, vel: THREE.Vector3) => void) | null = null;
  private recoil = 0;
  private flinch = new THREE.Vector3();
  private flinchVel = new THREE.Vector3();
  private stagger = new THREE.Vector3();
  private staggerVel = new THREE.Vector3();
  private legYaw = 0;

  dead = false;
  private ragdoll: Ragdoll | null = null;
  private allBones: THREE.Bone[] = [];
  private prevBonePos = new Map<THREE.Bone, THREE.Vector3>();
  private boneVel = new Map<THREE.Bone, THREE.Vector3>();
  private lastDt = 1 / 60;

  constructor(proto: CharacterProto, gun: THREE.Object3D, private scene: THREE.Scene, muzzleZ = 0.58, private phys: PhysicsWorld | null = null) {
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
    const gunModel = gun.clone(true);
    g.add(gunModel);
    g.rotation.y = Math.PI;
    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
      if (o.name === 'reddot') o.visible = false;
    });
    this.gunPivot.add(g);
    this.gunMag = gunModel.getObjectByName('Magazine001') ?? null;
    if (this.gunMag) this.gunMagRest.copy(this.gunMag.position);
    this.gunPivot.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(g);
    box.applyMatrix4(this.gunPivot.matrixWorld.clone().invert());
    box.getSize(this.gunSize);
    box.getCenter(this.gunCenter);
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
  hit(dir: THREE.Vector3, strength = 1, zone: HitZone = 'torso'): void {
    const s = zone === 'head' ? 1.4 : zone === 'leg' ? 0.5 : zone === 'arm' ? 0.6 : 1;
    this.flinchVel.addScaledVector(dir, 6 * strength * s);
    this.staggerVel.addScaledVector(dir.clone().setY(0), 1.6 * strength * s);
  }

  get headWorld(): THREE.Vector3 {
    return worldPos(this.b.head);
  }

  get chestWorld(): THREE.Vector3 {
    return worldPos(this.b.spine2);
  }

  /** Bullet vs. bone capsules and head sphere. */
  raycast(o: THREE.Vector3, d: THREE.Vector3): { distance: number; zone: HitZone } | null {
    if (this.dead) return null;
    // Cheap reject: bounding sphere around the body
    const c = worldPos(this.b.spine);
    if (raySphere(o, d, c, 1.3) < 0 && c.distanceTo(o) > 1.3) return null;
    let best: { distance: number; zone: HitZone } | null = null;
    const head = this.headWorld.add(new THREE.Vector3(0, 0.09, 0));
    const th = raySphere(o, d, head, 0.125);
    if (th >= 0) best = { distance: th, zone: 'head' };
    for (const [a, b, r, zone] of HITBOXES) {
      const t = raySegment(o, d, worldPos(this.b[a]), worldPos(this.b[b]), r);
      if (t >= 0 && (!best || t < best.distance - (best.zone === 'head' ? 0.04 : 0))) best = { distance: t, zone };
    }
    return best;
  }

  die(bulletDir: THREE.Vector3, zone: HitZone, point: THREE.Vector3 | null, force: number): void {
    if (this.dead) return;
    this.dead = true;
    this.mixer.stopAllAction();
    // Bring the gun into the world: it falls on its own
    this.scene.attach(this.gunPivot);
    if (this.phys) {
      this.ragdoll = new Ragdoll(this.phys, this.model, (bone) => {
        const bv = this.boneVel.get(bone);
        return bv ? bv.clone().clampLength(0, 6) : this.velocity.clone();
      });
      const imp = bulletDir.clone().normalize().multiplyScalar(force);
      const part = zone === 'head' ? 'head' : zone === 'torso' ? 'chest' : zone;
      this.ragdoll.impulse(part, imp, point ?? undefined);
      // Legs give out: a small pull at the pelvis so bodies don't fall like planks
      this.ragdoll.impulse('pelvis', bulletDir.clone().setY(0).normalize().multiplyScalar(-force * 0.15).add(new THREE.Vector3(0, -2, 0)));
      const gunVel = bulletDir.clone().setY(0).normalize().multiplyScalar(1.2).add(new THREE.Vector3(0, 1.0, 0)).add(this.velocity);
      this.phys.spawnProp(this.gunPivot, {
        size: this.gunSize, center: this.gunCenter, vel: gunVel,
        spin: new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 6),
        density: 400, life: 12,
      });
    }
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.ragdoll?.dispose();
    this.phys?.removeProp(this.gunPivot);
    this.scene.remove(this.gunPivot);
  }

  update(dt: number): void {
    this.lastDt = Math.max(1e-3, dt);
    if (this.dead) {
      this.ragdoll?.update(dt);
      return;
    }
    // --- Locomotion: which clip, which way the legs go
    const fwd0 = new THREE.Vector3(0, 0, 1).applyQuaternion(this.root.quaternion);
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    let targetLegYaw = 0;
    if (speed > 0.3) {
      const facing = Math.atan2(fwd0.x, fwd0.z);
      let phi = Math.atan2(this.velocity.x, this.velocity.z) - facing;
      phi = Math.atan2(Math.sin(phi), Math.cos(phi));
      const backward = Math.abs(phi) > 1.95;
      if (backward) phi = Math.atan2(Math.sin(phi + Math.PI), Math.cos(phi + Math.PI));
      targetLegYaw = THREE.MathUtils.clamp(phi, -1.25, 1.25);
      const crouchRate = 1 - this.crouch * 0.35;
      if (speed > 3.2 && !backward) this.play('Run', (speed / 5.2) * crouchRate);
      else this.play('Walk', (backward ? -1 : 1) * Math.max(0.6, speed / 1.8) * crouchRate);
    } else this.play('Idle');
    this.legYaw = THREE.MathUtils.damp(this.legYaw, targetLegYaw, 8, dt);

    this.mixer.update(dt);
    this.root.updateMatrixWorld(true);

    const b = this.b;
    const up = new THREE.Vector3(0, 1, 0);
    const fwd = fwd0.clone();
    const right = new THREE.Vector3().crossVectors(fwd, up).normalize(); // character's right

    // Stagger spring: the whole body is pushed and recovers
    this.staggerVel.addScaledVector(this.stagger, -90 * dt);
    this.staggerVel.multiplyScalar(Math.max(0, 1 - 10 * dt));
    this.stagger.addScaledVector(this.staggerVel, dt);
    this.tilt.position.copy(this.stagger).applyQuaternion(this.root.quaternion.clone().invert());
    this.tilt.updateMatrixWorld(true);

    // Lower body toward the movement direction, upper body counter-rotates back to the aim
    if (Math.abs(this.legYaw) > 1e-3) {
      rotateAxis(b.hips, up, this.legYaw);
      rotateAxis(b.spine, up, -this.legYaw * 0.4);
      rotateAxis(b.spine1, up, -this.legYaw * 0.3);
      rotateAxis(b.spine2, up, -this.legYaw * 0.3);
    }

    // --- Crouch with planted feet (works while walking: feet follow the clip, knees bend)
    this.crouch = THREE.MathUtils.damp(this.crouch, this.crouchTarget, 8, dt);
    if (this.crouch > 0.01) {
      const lf = worldPos(b.lFoot);
      const rf = worldPos(b.rFoot);
      const hips = worldPos(b.hips);
      hips.y -= this.crouch * 0.42;
      hips.addScaledVector(fwd, -this.crouch * 0.12);
      b.hips.position.copy(b.hips.parent!.worldToLocal(hips));
      b.hips.updateMatrixWorld(true);
      const legFwd = fwd.clone().applyAxisAngle(up, this.legYaw);
      for (const [up_, leg, foot, target] of [[b.lUpLeg, b.lLeg, b.lFoot, lf], [b.rUpLeg, b.rLeg, b.rFoot, rf]] as const) {
        target.y = Math.max(target.y, 0.08);
        const knee = worldPos(up_).addScaledVector(legFwd, 1.0);
        twoBoneIK(up_, leg, foot, target, knee);
      }
      rotateAxis(b.spine, right, this.crouch * 0.35);
    }

    // --- Lean (peek): bend the spine sideways around the facing axis
    this.lean = THREE.MathUtils.damp(this.lean, this.leanTarget, 6, dt);
    if (Math.abs(this.lean) > 0.01) {
      rotateAxis(b.spine, fwd, this.lean * 0.12);
      rotateAxis(b.spine1, fwd, this.lean * 0.14);
      rotateAxis(b.spine2, fwd, this.lean * 0.12);
      rotateAxis(b.neck, fwd, -this.lean * 0.15);
    }

    // --- Torso: pitch toward the aim point, flinch spring
    this.aim = THREE.MathUtils.damp(this.aim, this.reload >= 0 ? 0 : this.aimTarget, 7, dt);
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
    // Reload: bring the rifle in and roll it so the mag well faces the left hand
    const r = this.reload;
    const rl = r >= 0 ? Math.sin(Math.min(1, r * 1.15) * Math.PI) : 0;
    gunPos.addScaledVector(fwd, -rl * 0.08).addScaledVector(up, rl * 0.06).addScaledVector(right, -rl * 0.04);
    dir.addScaledVector(up, rl * 0.35).normalize();
    this.gunPivot.position.copy(this.root.worldToLocal(gunPos.clone()));
    this.gunPivot.updateMatrixWorld(true);
    this.gunPivot.lookAt(gunPos.clone().add(dir));
    if (rl > 0) this.gunPivot.rotateZ(rl * 0.7);
    this.gunPivot.updateMatrixWorld(true);

    // --- Reload choreography for the left hand and the magazine
    const guardGrip = this.gunPivot.localToWorld(new THREE.Vector3(0.045, -0.04, 0.2));
    let lGrip = guardGrip;
    let magOff = 0;
    if (r >= 0) {
      const magWell = this.gunPivot.localToWorld(new THREE.Vector3(0.03, -0.11, 0.02));
      const pouch = worldPos(b.spine).addScaledVector(fwd, 0.18).addScaledVector(right, -0.12).addScaledVector(up, 0.05);
      const k = (a: number, z: number): number => THREE.MathUtils.smoothstep(r, a, z);
      if (r < 0.32) {
        lGrip = guardGrip.clone().lerp(magWell, k(0.05, 0.18));
        magOff = k(0.2, 0.32) * 0.12;
      } else if (r < 0.5) {
        if (!this.magDropped) this.dropMag();
        lGrip = magWell.clone().lerp(pouch, k(0.32, 0.45));
        magOff = 1;
      } else if (r < 0.8) {
        lGrip = pouch.clone().lerp(magWell.clone().addScaledVector(up, -0.12), k(0.5, 0.68));
        lGrip.lerp(magWell, k(0.68, 0.8));
        magOff = (1 - k(0.68, 0.8)) * 0.12;
      } else {
        lGrip = magWell.clone().lerp(guardGrip, k(0.85, 1));
      }
      if (this.gunMag) {
        // The mag is in the hand between the pouch and the well
        const inHand = r >= 0.5 && r < 0.8;
        this.gunMag.visible = r < 0.32 || r >= 0.5;
        this.gunMag.position.copy(this.gunMagRest);
        if ((r < 0.32 || inHand) && magOff > 0) {
          // Slide the mag out along the gun's down axis (its parent carries odd fbx scales)
          const parent = this.gunMag.parent!;
          parent.updateWorldMatrix(true, false);
          const w = parent.localToWorld(this.gunMagRest.clone()).addScaledVector(gunUpNow(this.gunPivot), -magOff);
          this.gunMag.position.copy(parent.worldToLocal(w));
        }
      }
    } else {
      this.magDropped = false;
      if (this.gunMag) {
        this.gunMag.visible = true;
        this.gunMag.position.copy(this.gunMagRest);
      }
    }

    // --- Arms onto the rifle (wrist targets slightly off the grip surfaces)
    let rGrip = this.gunPivot.localToWorld(new THREE.Vector3(-0.022, -0.05, -0.065));
    if (this.throwT >= 0) {
      // Overhand throw: wind up behind the head, release forward and high, back to the grip
      const tt = this.throwT;
      const wind = neck.clone().addScaledVector(up, 0.22).addScaledVector(fwd, -0.22).addScaledVector(right, 0.22);
      const release = neck.clone().addScaledVector(up, 0.15).addScaledVector(fwd, 0.5).addScaledVector(right, 0.1);
      const k1 = THREE.MathUtils.smoothstep(tt, 0, 0.35);
      const k2 = THREE.MathUtils.smoothstep(tt, 0.45, 0.62);
      const k3 = THREE.MathUtils.smoothstep(tt, 0.7, 1);
      const arc = rGrip.clone().lerp(wind, k1).lerp(release, k2).lerp(rGrip, k3);
      rGrip = arc;
      rotateAxis(b.spine1, up, (k1 - k2) * 0.5);
    }
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
    if (r < 0) aimBone(b.lHand, b.lFinger, worldPos(b.lHand).addScaledVector(gunFwd, 0.7).addScaledVector(gunLeft, -0.4).addScaledVector(gunUp, 0.2));
    else aimBone(b.lHand, b.lFinger, worldPos(b.lHand).addScaledVector(up, 0.6).addScaledVector(gunFwd, 0.3));

    this.trackBones();
  }

  private dropMag(): void {
    this.magDropped = true;
    if (!this.gunMag || !this.onMagDrop) return;
    const copy = this.gunMag.clone(true);
    this.gunMag.updateWorldMatrix(true, false);
    this.gunMag.matrixWorld.decompose(copy.position, copy.quaternion, copy.scale);
    this.onMagDrop(copy, this.velocity.clone().add(new THREE.Vector3(0, -0.5, 0)));
  }

  /** Bone velocities for the ragdoll to inherit. */
  private trackBones(): void {
    for (const bone of [this.b.hips, this.b.spine1, this.b.neck, this.b.lArm, this.b.lFore, this.b.rArm, this.b.rFore,
      this.b.lUpLeg, this.b.lLeg, this.b.rUpLeg, this.b.rLeg]) {
      const p = worldPos(bone);
      const prev = this.prevBonePos.get(bone);
      if (prev) {
        const v = this.boneVel.get(bone) ?? new THREE.Vector3();
        v.subVectors(p, prev).divideScalar(this.lastDt);
        this.boneVel.set(bone, v);
        prev.copy(p);
      } else this.prevBonePos.set(bone, p);
    }
  }

  /** Approximate world position of the torso once the body is down (for blood pools). */
  get torsoWorld(): THREE.Vector3 {
    return worldPos(this.b.spine1);
  }
}
