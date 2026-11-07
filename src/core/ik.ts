import * as THREE from 'three';

/*
 * World-space bone helpers shared by the enemy rig and the first-person arms.
 * All edits are done in world space, so they don't depend on the rig's local axes.
 */

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _m1 = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();

export function worldPos(o: THREE.Object3D, out = new THREE.Vector3()): THREE.Vector3 {
  return o.getWorldPosition(out);
}

/** Pre-multiply a world-space rotation onto a bone. */
export function rotateWorld(bone: THREE.Object3D, q: THREE.Quaternion): void {
  const parentQ = bone.parent!.getWorldQuaternion(_q2);
  const world = parentQ.clone().multiply(bone.quaternion);
  world.premultiply(q);
  bone.quaternion.copy(parentQ.invert().multiply(world));
  bone.updateMatrixWorld(true);
}

export function rotateAxis(bone: THREE.Object3D, axis: THREE.Vector3, angle: number): void {
  if (Math.abs(angle) < 1e-5) return;
  rotateWorld(bone, _q.setFromAxisAngle(axis, angle));
}

/** Set a bone's world rotation. */
export function setWorldQuat(bone: THREE.Object3D, q: THREE.Quaternion): void {
  const parentQ = bone.parent!.getWorldQuaternion(_q2).invert();
  bone.quaternion.copy(parentQ.multiply(q));
  bone.updateMatrixWorld(true);
}

/** Rotate `bone` so the direction toward `child` points at `target` (world space). */
export function aimBone(bone: THREE.Object3D, child: THREE.Object3D, target: THREE.Vector3, weight = 1): void {
  const a = worldPos(bone, _v1);
  const from = worldPos(child, _v2).sub(a).normalize();
  const to = _v3.copy(target).sub(a).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(from, to);
  if (weight < 1) q.slerp(new THREE.Quaternion(), 1 - weight);
  rotateWorld(bone, q);
}

/** Analytic two-bone IK: a (shoulder/hip) -> b (elbow/knee) -> c (wrist/ankle). */
export function twoBoneIK(
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

/**
 * A hand's local finger and back-of-hand directions, measured once from the rig.
 * Mixamo hands: back = -(index - pinky) x (hand -> middle) for the right hand, + for the left.
 */
export interface HandFrame {
  hand: THREE.Bone;
  fwdLocal: THREE.Vector3;
  backLocal: THREE.Vector3;
  fingers: THREE.Bone[][];
  thumb: THREE.Bone[];
}

export function measureHand(root: THREE.Object3D, side: 'Left' | 'Right'): HandFrame {
  const get = (n: string): THREE.Bone => root.getObjectByName(`mixamorig${side}${n}`) as THREE.Bone;
  const hand = get('Hand');
  root.updateMatrixWorld(true);
  const h = worldPos(hand);
  const mid = worldPos(get('HandMiddle1')).sub(h).normalize();
  const across = worldPos(get('HandIndex1')).sub(worldPos(get('HandPinky1')));
  const back = new THREE.Vector3().crossVectors(across, mid).multiplyScalar(side === 'Right' ? -1 : 1).normalize();
  const inv = hand.getWorldQuaternion(new THREE.Quaternion()).invert();
  const chain = (f: string): THREE.Bone[] => [1, 2, 3].map((i) => get(`Hand${f}${i}`)).filter(Boolean);
  return {
    hand,
    fwdLocal: mid.applyQuaternion(inv),
    backLocal: back.applyQuaternion(inv),
    fingers: ['Index', 'Middle', 'Ring', 'Pinky'].map(chain),
    thumb: chain('Thumb'),
  };
}

function basis(f: THREE.Vector3, b: THREE.Vector3, out: THREE.Matrix4): THREE.Matrix4 {
  const x = f.clone().normalize();
  const y = b.clone().addScaledVector(x, -b.dot(x)).normalize();
  const z = new THREE.Vector3().crossVectors(x, y);
  return out.makeBasis(x, y, z);
}

/** Turn the hand so its fingers point along `fwd` and the back of the hand faces `back` (world). */
export function orientHand(h: HandFrame, fwd: THREE.Vector3, back: THREE.Vector3, weight = 1): void {
  basis(fwd, back, _m1);
  basis(h.fwdLocal, h.backLocal, _m2);
  const q = new THREE.Quaternion().setFromRotationMatrix(_m1.multiply(_m2.transpose()));
  if (weight < 1) q.slerp(h.hand.getWorldQuaternion(new THREE.Quaternion()), 1 - weight);
  setWorldQuat(h.hand, q);
}

/** Curl the fingers toward the palm (0 = flat, 1 = fist). */
export function curlFingers(h: HandFrame, curl: number): void {
  const hq = h.hand.getWorldQuaternion(new THREE.Quaternion());
  const fwd = h.fwdLocal.clone().applyQuaternion(hq);
  const back = h.backLocal.clone().applyQuaternion(hq);
  const axis = new THREE.Vector3().crossVectors(back, fwd).normalize();
  const per = [0.85, 1.25, 0.9];
  for (const chain of h.fingers) {
    chain.forEach((b, i) => rotateAxis(b, axis, curl * per[i]));
  }
  // The thumb wraps across the palm
  const thumbAxis = fwd.clone().addScaledVector(axis, 0.3).normalize();
  h.thumb.forEach((b, i) => rotateAxis(b, thumbAxis, curl * (i === 0 ? 0.25 : 0.45) * (h.hand.name.includes('Right') ? 1 : -1)));
}
