import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import {
  findBone,
  handQuat,
  measureHand,
  measureSkin,
  rotateAxis,
  setWorldQuat,
  twoBoneIK,
  worldPos,
  type HandFrame,
} from '../core/ik';
import { applyArmFinish } from './finish';
import { relaxedPose, solveGrip, type DistanceFn, type GripPose, type GripSpec } from './grip';

/** Wrist to the tip of the middle finger, metres: a real hand, so it sits on a gun the way one does. */
const HAND_LENGTH = 0.195;
/** Shoulder to elbow and elbow to wrist, metres. */
const UPPER_ARM = 0.3;
const FOREARM = 0.27;

export interface HandTarget {
  pos: THREE.Vector3;
  fwd: THREE.Vector3;
  back: THREE.Vector3;
  /** Local rotation per finger joint (`HandFrame.joints` order). */
  fingers: THREE.Quaternion[];
}

interface Arm {
  arm: THREE.Bone;
  fore: THREE.Bone;
  hand: HandFrame;
  handRest: THREE.Quaternion;
  relaxed: THREE.Quaternion[];
  /** Forearm twist bones, elbow end first; they spread the wrist's roll along the sleeve. */
  twist: THREE.Bone[];
  /** Shoulder to wrist with the arm straight. */
  length: number;
}

/**
 * How bent the arm may get, as wrist distance over arm length. A hand close to the chest folds
 * the elbow up into view and collapses the sleeve; a hand out of reach leaves the gun. Nobody
 * sees the shoulders in first person, so they give way instead.
 */
const REACH_MIN = 0.6;
const SHOULDER_X = 0.27;
const SHOULDER_Y = -0.36;
const SHOULDER_Z = 0.06;
const REACH_MAX = 0.8;

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _axis = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _poleL = new THREE.Vector3();
const _poleR = new THREE.Vector3();
/** Pull of the elbow toward its usual down-and-out spot, against lining up with the hand. */
const ELBOW_HABIT = 1.1;

/**
 * First-person arms: the soldier character placed under the view camera with its head and legs
 * collapsed, and both arms solved with two-bone IK onto hand targets on the weapon.
 * Everything here is in view-camera space (camera at the origin looking down -Z).
 */
export class FpArms {
  readonly root = new THREE.Group();
  private model: THREE.Object3D;
  private bones: THREE.Bone[] = [];
  private rest: THREE.Quaternion[] = [];
  private restPos: THREE.Vector3[] = [];
  private l: Arm;
  private r: Arm;
  /** Without twist bones: the share of the wrist's roll the whole forearm takes up. */
  forearmTwist = 0.5;
  private shoulderL = new THREE.Vector3();
  private shoulderR = new THREE.Vector3();

  constructor(proto: THREE.Object3D, ready: boolean) {
    this.model = SkeletonUtils.clone(proto);
    this.root.add(this.model);
    this.root.visible = ready;
    this.model.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (m.isMesh) {
        m.frustumCulled = false;
        m.castShadow = false;
        const mat = (m.material as THREE.MeshStandardMaterial).clone();
        mat.envMapIntensity = 0.8;
        m.material = mat;
      }
      if ((o as THREE.Bone).isBone) this.bones.push(o as THREE.Bone);
    });
    const get = (n: string): THREE.Bone => {
      const b = findBone(this.model, n);
      if (!b) throw new Error(`Bone mixamorig${n} not found in arms`);
      return b;
    };

    // Face -Z, whichever way the model was authored: forward is up x (right shoulder - left).
    this.model.updateMatrixWorld(true);
    const across = worldPos(get('RightArm')).sub(worldPos(get('LeftArm'))).setY(0);
    const fwd = new THREE.Vector3(0, 1, 0).cross(across);
    this.model.rotation.y = -Math.atan2(fwd.x, fwd.z) + Math.PI;
    // Size the model by its hand (wrist to the tip of the middle finger), so any rig holds the
    // guns at the same scale. Arm length is free: the shoulders float to wherever the arm needs.
    this.model.updateMatrixWorld(true);
    const pts = ['Hand', 'HandMiddle1', 'HandMiddle2', 'HandMiddle3'].map((n) => worldPos(get(`Left${n}`)));
    const span = pts[0].distanceTo(pts[1]) + pts[1].distanceTo(pts[2]) + pts[2].distanceTo(pts[3]) * 1.85;
    this.model.scale.multiplyScalar(HAND_LENGTH / span);
    this.model.updateMatrixWorld(true);
    // Shoulders sit well below the eye, so the forearms rise into frame from the bottom edge
    // instead of lying across it; the body, if there is one, stays out of frame.
    const mid = worldPos(get('LeftArm')).add(worldPos(get('RightArm'))).multiplyScalar(0.5);
    this.model.position.set(-mid.x, SHOULDER_Y - mid.y, SHOULDER_Z - mid.z);
    this.model.updateMatrixWorld(true);

    // Arms models are often short for their hands. A short arm cannot reach the gun from a shoulder
    // behind the camera, so the shoulder gets dragged forward and the forearm ends up lying across
    // the frame. Stretch both segments to real proportions: the elbow then stays back and low.
    for (const side of ['Left', 'Right'] as const) {
      const upper = get(`${side}Arm`);
      const fore = get(`${side}ForeArm`);
      const hand = get(`${side}Hand`);
      const uLen = worldPos(upper).distanceTo(worldPos(fore));
      const fLen = worldPos(fore).distanceTo(worldPos(hand));
      const ku = Math.max(1, UPPER_ARM / uLen);
      const kf = Math.max(1, FOREARM / fLen);
      for (const c of upper.children) c.position.multiplyScalar(ku);
      for (const c of fore.children) c.position.multiplyScalar(kf);
    }
    this.model.updateMatrixWorld(true);
    const forearm = worldPos(get('LeftForeArm')).distanceTo(worldPos(get('LeftHand')));
    this.model.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) applyArmFinish(o as THREE.SkinnedMesh, forearm);
    });

    const arm = (side: 'Left' | 'Right'): Arm => {
      const hand = measureHand(this.model, side);
      const upper = get(`${side}Arm`);
      const fore = get(`${side}ForeArm`);
      const elbow = worldPos(fore);
      return {
        arm: upper, fore, hand, handRest: hand.hand.quaternion.clone(), relaxed: [],
        twist: [1, 2].map((i) => findBone(this.model, `${side}ForeArmTwist${i}`)).filter((b): b is THREE.Bone => !!b),
        length: worldPos(upper).distanceTo(elbow) + elbow.distanceTo(worldPos(hand.hand)),
      };
    };
    this.l = arm('Left');
    this.r = arm('Right');
    measureSkin(this.model, [this.l.hand, this.r.hand]);
    this.l.relaxed = relaxedPose(this.l.hand);
    this.r.relaxed = relaxedPose(this.r.hand);

    // A whole character works as arms too: its head and legs are collapsed, and the neck sunk into
    // the chest first (a collapsed head is a spike from the collar up to the eye).
    const neckBone = findBone(this.model, 'Neck');
    if (neckBone) {
      neckBone.position.copy(neckBone.parent!.worldToLocal(worldPos(neckBone).add(new THREE.Vector3(0, -0.3, 0.2))));
    }
    for (const n of ['Neck', 'LeftUpLeg', 'RightUpLeg']) {
      const b = findBone(this.model, n);
      if (b) b.scale.setScalar(0.001);
    }
    for (const b of this.bones) {
      this.rest.push(b.quaternion.clone());
      this.restPos.push(b.position.clone());
    }
  }

  private reset(): void {
    this.bones.forEach((b, i) => {
      b.quaternion.copy(this.rest[i]);
      b.position.copy(this.restPos[i]);
    });
  }

  /** Finger pose of a loose hand, for blending between grips. */
  relaxed(side: 'l' | 'r'): THREE.Quaternion[] {
    return (side === 'l' ? this.l : this.r).relaxed;
  }

  /**
   * Work out a grip: where the palm settles and how the fingers wrap, for a hand placed at `pos`
   * with its fingers along `fwd` and its back toward `back`. All in the frame `dist` is in.
   */
  solveGrip(
    side: 'l' | 'r', pos: THREE.Vector3, fwd: THREE.Vector3, back: THREE.Vector3, spec: GripSpec, dist: DistanceFn | null,
  ): GripPose {
    this.reset();
    this.root.position.set(0, 0, 0);
    this.root.updateMatrixWorld(true);
    const pose = solveGrip((side === 'l' ? this.l : this.r).hand, pos, fwd, back, spec, dist);
    this.reset();
    return pose;
  }

  /**
   * Solve both arms. `sway` shifts the shoulders a little so the body follows the gun.
   * `triggerPull`: 0 = finger resting on the trigger, 1 = squeezed.
   */
  update(left: HandTarget, right: HandTarget, sway: THREE.Vector3, triggerPull = 0): void {
    this.reset();
    this.root.position.copy(sway);
    this.root.updateMatrixWorld(true);
    this.setShoulder(this.l, left.pos, this.shoulderL);
    this.setShoulder(this.r, right.pos, this.shoulderR);

    const poleR = this.pole(this.shoulderR, right, _poleR.set(0.35, -1, 0.1));
    const poleL = this.pole(this.shoulderL, left, _poleL.set(-0.4, -1, 0.1));

    this.solve(this.r, right, poleR);
    this.solve(this.l, left, poleL);

    // Trigger finger: a short squeeze on top of the baked grip
    if (triggerPull > 0.001) {
      const index = this.r.hand.fingers[0];
      for (let k = 1; k < index.length; k++) {
        index[k].bone.quaternion.multiply(_q.setFromAxisAngle(index[k].axis, triggerPull * (k === 1 ? 0.2 : 0.14)));
      }
    }
  }

  /**
   * Where the elbow points. By default down and out; but a wrist is most relaxed with the forearm
   * running straight into the hand, so the elbow also swings to line the two up. That keeps the
   * wrist from folding over (which is what tears a sleeve cuff open) as the gun tilts and rolls.
   */
  private pole(shoulder: THREE.Vector3, t: HandTarget, natural: THREE.Vector3): THREE.Vector3 {
    _axis.subVectors(t.pos, shoulder).normalize();
    const across = _fwd.copy(t.fwd).addScaledVector(_axis, -t.fwd.dot(_axis));
    return natural.normalize().multiplyScalar(ELBOW_HABIT).addScaledVector(across, -1).add(shoulder);
  }

  /** Slide the shoulder along the line to the wrist until the arm is comfortably bent. */
  private setShoulder(a: Arm, wrist: THREE.Vector3, out: THREE.Vector3): void {
    // Start from a fixed spot rather than the rig's own shoulder: rigs differ in width, and the
    // forearms should come up from the bottom corners of the frame whatever the model.
    out.set(a.hand.side === 'Left' ? -SHOULDER_X : SHOULDER_X, SHOULDER_Y, SHOULDER_Z).add(this.root.position);
    const d = out.distanceTo(wrist);
    const want = THREE.MathUtils.clamp(d, a.length * REACH_MIN, a.length * REACH_MAX);
    if (d < 1e-4 || Math.abs(want - d) < 1e-5) return;
    out.sub(wrist).multiplyScalar(want / d).add(wrist);
    a.arm.position.copy(a.arm.parent!.worldToLocal(_axis.copy(out)));
    a.arm.updateMatrixWorld(true);
  }

  private solve(a: Arm, t: HandTarget, pole: THREE.Vector3): void {
    twoBoneIK(a.arm, a.fore, a.hand.hand, t.pos, pole);
    const target = handQuat(a.hand, t.fwd, t.back);
    // Split the roll between forearm and wrist: how far the target is twisted, about the forearm's
    // axis, from where the hand would sit with a neutral wrist.
    const neutral = a.fore.getWorldQuaternion(_q2).multiply(a.handRest);
    const delta = _q.copy(target).multiply(neutral.invert());
    _axis.subVectors(worldPos(a.hand.hand), worldPos(a.fore)).normalize();
    let twist = 2 * Math.atan2(delta.x * _axis.x + delta.y * _axis.y + delta.z * _axis.z, delta.w);
    if (twist > Math.PI) twist -= Math.PI * 2;
    if (twist < -Math.PI) twist += Math.PI * 2;
    twist = THREE.MathUtils.clamp(twist, -2.6, 2.6);
    if (a.twist.length) {
      // A rig with twist bones: the roll builds up along the forearm and arrives whole at the wrist
      a.twist.forEach((b, i) => rotateAxis(b, _axis, (twist * (i + 1)) / a.twist.length));
    } else {
      rotateAxis(a.fore, _axis, twist * this.forearmTwist);
    }
    setWorldQuat(a.hand.hand, target);
    a.hand.joints.forEach((j, i) => {
      if (t.fingers[i]) j.bone.quaternion.copy(t.fingers[i]);
    });
  }

  set visible(on: boolean) {
    this.root.visible = on;
  }
}

