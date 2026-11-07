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

/** Capsule in world space (a hand collider proxy). */
export interface Capsule {
  a: THREE.Vector3;
  b: THREE.Vector3;
  r: number;
  hand?: 'l' | 'r';
}

const _cp = new THREE.Vector3();
const _ab = new THREE.Vector3();

/** Penetration depth of point p (with radius pad) into the capsule, and the outward normal. */
export function capsulePenetration(c: Capsule, p: THREE.Vector3, pad: number, outNormal?: THREE.Vector3): number {
  _ab.subVectors(c.b, c.a);
  const t = THREE.MathUtils.clamp(_cp.subVectors(p, c.a).dot(_ab) / Math.max(1e-9, _ab.lengthSq()), 0, 1);
  _cp.copy(c.a).addScaledVector(_ab, t);
  const d = p.distanceTo(_cp);
  if (outNormal) outNormal.subVectors(p, _cp).divideScalar(Math.max(1e-6, d));
  return c.r + pad - d;
}

function anyInside(points: THREE.Vector3[], caps: Capsule[], pad: number): boolean {
  for (const p of points) for (const c of caps) if (capsulePenetration(c, p, pad) > 0) return true;
  return false;
}

function chainPoints(chain: THREE.Bone[], from: number): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  for (let k = from + 1; k < chain.length; k++) pts.push(worldPos(chain[k]));
  const n = chain.length;
  if (n >= 2) {
    const last = worldPos(chain[n - 1]);
    const prev = worldPos(chain[n - 2]);
    pts.push(last.clone().add(last.clone().sub(prev).multiplyScalar(0.8))); // fingertip
  }
  return pts;
}

/**
 * Curl each finger joint by joint toward the palm until it touches one of the capsules
 * (up to `curl`), so fingers wrap around grips and handguards instead of sinking into them.
 * A finger that starts inside keeps curling until it comes out and touches again.
 */
export function curlFingersContact(h: HandFrame, curl: number, caps: Capsule[]): void {
  const hq = h.hand.getWorldQuaternion(new THREE.Quaternion());
  const fwd = h.fwdLocal.clone().applyQuaternion(hq);
  const back = h.backLocal.clone().applyQuaternion(hq);
  const axis = new THREE.Vector3().crossVectors(back, fwd).normalize();
  const thumbAxis = fwd.clone().addScaledVector(axis, 0.3).normalize().multiplyScalar(h.hand.name.includes('Right') ? 1 : -1);
  const pad = 0.008;
  // Thumb: lay it forward along the grip, angled toward the palm, instead of sticking up
  if (h.thumb.length >= 2) {
    const t0 = worldPos(h.thumb[0]);
    const dir = fwd.clone().multiplyScalar(0.8).addScaledVector(back, -0.55).normalize();
    aimBone(h.thumb[0], h.thumb[1], t0.addScaledVector(dir, 0.05), Math.min(1, curl));
  }
  const chains: [THREE.Bone[], THREE.Vector3, number[]][] = [
    ...h.fingers.map((f) => [f, axis, [0.85, 1.25, 0.9]] as [THREE.Bone[], THREE.Vector3, number[]]),
    [h.thumb.slice(1), thumbAxis, [0.35, 0.35]],
  ];
  for (const [chain, ax, per] of chains) {
    for (let j = 0; j < chain.length; j++) {
      const steps = 8;
      const step = (curl * per[j]) / steps;
      let wasInside = anyInside(chainPoints(chain, j), caps, pad);
      for (let s = 0; s < steps; s++) {
        rotateAxis(chain[j], ax, step);
        const inside = anyInside(chainPoints(chain, j), caps, pad);
        if (inside && !wasInside) {
          rotateAxis(chain[j], ax, -step); // touched: back off one step and stop this joint
          break;
        }
        wasInside = inside;
      }
    }
  }
}

/** How far the palm sinks into the capsules (max over a few palm points) and which way is out. */
export function palmPenetration(h: HandFrame, caps: Capsule[], outNormal: THREE.Vector3): number {
  const wrist = worldPos(h.hand);
  const knuckles = worldPos(h.fingers[1][0]);
  const idx = worldPos(h.fingers[0][0]);
  const pinky = worldPos(h.fingers[3][0]);
  const pts = [wrist.clone().lerp(knuckles, 0.25), wrist.clone().lerp(knuckles, 0.6), knuckles, idx, pinky];
  let best = 0;
  const n = new THREE.Vector3();
  for (const p of pts) {
    for (const c of caps) {
      const d = capsulePenetration(c, p, 0.013, n);
      if (d > best) {
        best = d;
        outNormal.copy(n);
      }
    }
  }
  return best;
}
