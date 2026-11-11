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
  const maxLen = lab + lbc;
  const toT = new THREE.Vector3().subVectors(target, A);
  const rawDist = toT.length();
  // Soft IK: smooth asymptotic compression near max reach prevents sudden elbow pops
  const da = 0.04 * maxLen;
  const dSoft = maxLen - da;
  let d = rawDist;
  if (rawDist > dSoft) {
    d = maxLen - da * Math.exp(-(rawDist - dSoft) / da);
  }
  d = THREE.MathUtils.clamp(d, 0.05, maxLen * 0.999);
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

export function findBone(root: THREE.Object3D, name: string): THREE.Bone | null {
  return (
    (root.getObjectByName(`mixamorig${name}`) as THREE.Bone) ??
    (root.getObjectByName(`mixamorig:${name}`) as THREE.Bone) ??
    (root.getObjectByName(name) as THREE.Bone) ??
    null
  );
}

// ---------------------------------------------------------------------------------------------
// Hands
//
// Nothing here assumes the rig's local axes: flexion axes, finger thickness and the palm's
// contact points are all measured from the bind pose and the skin, so another hand model with
// Mixamo-style bone names works without retuning.

/** One finger joint: a bone that flexes about `axis`, with a skin capsule reaching to `tip`. */
export interface FingerJoint {
  bone: THREE.Bone;
  rest: THREE.Quaternion;
  /** Flexion axis in the bone's local frame; positive angles curl toward the palm. */
  axis: THREE.Vector3;
  /** End of this segment (the next joint, or the fingertip) in the bone's local frame. */
  tip: THREE.Vector3;
  /** Skin radius around the bone, world units. */
  radius: number;
}

export interface HandFrame {
  side: 'Left' | 'Right';
  hand: THREE.Bone;
  /** Wrist -> middle knuckle, and the back-of-hand normal, in the hand bone's local frame. */
  fwdLocal: THREE.Vector3;
  backLocal: THREE.Vector3;
  /** Index, middle, ring, pinky: three joints each. */
  fingers: FingerJoint[][];
  thumb: FingerJoint[];
  /** Axis (thumb base local) that swings the thumb in front of the palm. */
  thumbSwing: THREE.Vector3;
  /** Axis (thumb base local) that lays the thumb alongside the index finger. */
  thumbAdduct: THREE.Vector3;
  /** Spheres on the palm skin, in the hand bone's local frame (radius in world units). */
  palm: { p: THREE.Vector3; r: number }[];
  /** Every finger joint in a fixed order (fingers then thumb): the layout of a finger pose. */
  joints: FingerJoint[];
}

/** Flexion limits per joint (knuckle, middle, distal), radians. */
export const FINGER_LIMITS = [1.45, 1.75, 1.15];
export const THUMB_LIMITS = [0.55, 0.95, 1.2];
export const THUMB_SWING_MAX = 1.25;
export const THUMB_ADDUCT_MAX = 0.75;

const FINGER_NAMES = ['Index', 'Middle', 'Ring', 'Pinky'];
/** Finger and palm half-thickness as a share of the palm's length (wrist to middle knuckle). */
const FINGER_RADII = [0.095, 0.098, 0.092, 0.082];
const PALM_RADIUS = 0.145;

export function measureHand(root: THREE.Object3D, side: 'Left' | 'Right'): HandFrame {
  const get = (n: string): THREE.Bone => {
    const b = findBone(root, `${side}${n}`);
    if (!b) throw new Error(`Bone mixamorig${side}${n} not found`);
    return b;
  };
  root.updateMatrixWorld(true);
  const hand = get('Hand');
  // Thickness scales with the hand itself, not with whatever scale the rig was exported at
  const worldScale = worldPos(get('HandMiddle1')).distanceTo(worldPos(hand));
  const h = worldPos(hand);
  const mid = worldPos(get('HandMiddle1')).sub(h).normalize();
  const across = worldPos(get('HandPinky1')).sub(worldPos(get('HandIndex1'))); // toward the little finger
  const back = new THREE.Vector3().crossVectors(across, mid).multiplyScalar(side === 'Right' ? 1 : -1).normalize();
  const palmDir = back.clone().negate();
  const ulnar = across.clone().normalize();
  const invHand = hand.getWorldQuaternion(new THREE.Quaternion()).invert();

  const chain = (name: string, radius: number, closeDir: (at: THREE.Vector3) => THREE.Vector3, useHinge = true): FingerJoint[] => {
    const bones = [1, 2, 3]
      .map((i) => findBone(root, `${side}Hand${name}${i}`))
      .filter((b): b is THREE.Bone => b !== null);
    const pts = bones.map((b) => worldPos(b));
    // The rig's end bones are unreliable (some exports park them at the origin); extend the last segment.
    if (pts.length >= 2) {
      const n = pts.length;
      pts.push(pts[n - 1].clone().add(pts[n - 1].clone().sub(pts[n - 2]).multiplyScalar(0.85)));
    }
    // A finger modelled slightly curled shows its own hinge: the axis its first two bones already
    // bend about. Used when it agrees with the palm (a digit resting bent backward does not).
    const hinge = new THREE.Vector3();
    if (bones.length >= 3) {
      hinge.crossVectors(pts[1].clone().sub(pts[0]).normalize(), pts[2].clone().sub(pts[1]).normalize());
    }
    const bent = useHinge && hinge.length() > 0.07; // more than ~4 degrees of bend at rest
    hinge.normalize();
    return bones.map((bone, j) => {
      const dir = pts[j + 1].clone().sub(pts[j]).normalize();
      const close = closeDir(pts[j]);
      close.addScaledVector(dir, -close.dot(dir)).normalize();
      const inv = bone.getWorldQuaternion(new THREE.Quaternion()).invert();
      const guess = new THREE.Vector3().crossVectors(dir, close).normalize();
      // Keep the hinge square to this bone, so flexing never twists it
      const own = hinge.clone().addScaledVector(dir, -hinge.dot(dir)).normalize();
      return {
        bone,
        rest: bone.quaternion.clone(),
        axis: (bent && own.dot(guess) > 0.5 ? own : guess).applyQuaternion(inv),
        tip: bone.worldToLocal(pts[j + 1].clone()),
        radius: radius * worldScale * (1 - j * 0.09),
      };
    });
  };

  const fingers = FINGER_NAMES.map((n, i) => chain(n, FINGER_RADII[i], () => palmDir.clone()));
  // The thumb closes across the palm: each joint bends toward the base of the little finger, and
  // a little into the palm. Its hinge can't be read from the rest pose (thumbs are often modelled
  // bent slightly backward), so it is built from where a thumb goes when it closes.
  const pinkyBase = fingers[3].length ? worldPos(fingers[3][0].bone) : h.clone().add(ulnar);
  const thumb = chain(
    'Thumb', 0.112,
    (at) => pinkyBase.clone().sub(at).normalize().addScaledVector(palmDir, 0.45), false);
  const thumbSwing = new THREE.Vector3();
  const thumbAdduct = new THREE.Vector3(1, 0, 0);
  if (thumb.length) {
    const t0 = worldPos(thumb[0].bone);
    const tDir = thumb[0].bone.localToWorld(thumb[0].tip.clone()).sub(t0).normalize();
    // Swing about the hand's long axis, signed so a positive angle carries the thumb palm-ward.
    const axis = mid.clone();
    if (new THREE.Vector3().crossVectors(axis, tDir).dot(palmDir) < 0) axis.negate();
    const inv = thumb[0].bone.getWorldQuaternion(new THREE.Quaternion()).invert();
    thumbSwing.copy(axis).applyQuaternion(inv);
    // Adduction turns in the plane of the palm, signed to bring the thumb toward the fingers.
    const flat = palmDir.clone();
    if (new THREE.Vector3().crossVectors(flat, tDir).dot(mid) < 0) flat.negate();
    thumbAdduct.copy(flat).applyQuaternion(inv);
  }

  // Palm: spheres from the heel of the hand to each knuckle, sunk so their skin side is the palm.
  const palmR = PALM_RADIUS * worldScale;
  const palm: { p: THREE.Vector3; r: number }[] = [];
  for (const f of fingers) {
    if (!f.length) continue;
    const k = worldPos(f[0].bone);
    for (const t of [0.4, 0.7, 1]) palm.push({ p: hand.worldToLocal(h.clone().lerp(k, t)), r: palmR });
  }

  return {
    side,
    hand,
    fwdLocal: mid.clone().applyQuaternion(invHand),
    backLocal: back.clone().applyQuaternion(invHand),
    fingers,
    thumb,
    thumbSwing,
    thumbAdduct,
    palm,
    joints: [...fingers.flat(), ...thumb],
  };
}

/**
 * Replace the default finger and palm thickness with what the skin actually measures: for every
 * vertex mostly driven by a finger bone, its distance from that bone's segment.
 */
export function measureSkin(root: THREE.Object3D, hands: HandFrame[]): void {
  const byBone = new Map<THREE.Bone, { joint: FingerJoint; a: THREE.Vector3; b: THREE.Vector3; d: number[] }>();
  const palms = new Map<THREE.Bone, { hand: HandFrame; o: THREE.Vector3; n: THREE.Vector3; d: number[] }>();
  root.updateMatrixWorld(true);
  for (const hf of hands) {
    for (const j of hf.joints) {
      byBone.set(j.bone, { joint: j, a: worldPos(j.bone), b: j.bone.localToWorld(j.tip.clone()), d: [] });
    }
    const q = hf.hand.getWorldQuaternion(new THREE.Quaternion());
    palms.set(hf.hand, { hand: hf, o: worldPos(hf.hand), n: hf.backLocal.clone().applyQuaternion(q), d: [] });
  }
  const v = new THREE.Vector3();
  const seg = new THREE.Line3();
  const cp = new THREE.Vector3();
  root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    const idx = m.geometry.getAttribute('skinIndex');
    const wgt = m.geometry.getAttribute('skinWeight');
    const pos = m.geometry.getAttribute('position');
    if (!idx || !wgt) return;
    for (let i = 0; i < pos.count; i++) {
      let best = 0;
      let bw = -1;
      for (let k = 0; k < 4; k++) {
        const w = wgt.getComponent(i, k);
        if (w > bw) {
          bw = w;
          best = idx.getComponent(i, k);
        }
      }
      if (bw < 0.55) continue;
      const bone = m.skeleton.bones[best];
      const f = byBone.get(bone);
      const p = palms.get(bone);
      if (!f && !p) continue;
      m.getVertexPosition(i, v).applyMatrix4(m.matrixWorld);
      if (f) f.d.push(seg.set(f.a, f.b).closestPointToPoint(v, true, cp).distanceTo(v));
      else if (p) {
        // Palm side only: the back of the hand never touches the gun
        const side = -v.sub(p.o).dot(p.n);
        if (side > 0) p.d.push(side);
      }
    }
  });
  const pct = (d: number[], q: number): number => d.sort((x, y) => x - y)[Math.floor((d.length - 1) * q)];
  for (const f of byBone.values()) {
    // Low-poly fingers are boxy: the corners overstate the thickness, so lean toward the faces
    if (f.d.length >= 6) f.joint.radius = THREE.MathUtils.clamp(pct(f.d, 0.5), f.joint.radius * 0.85, f.joint.radius * 1.35);
  }
  for (const p of palms.values()) {
    if (p.d.length < 12) continue;
    const r = THREE.MathUtils.clamp(pct(p.d, 0.6), p.hand.palm[0].r * 0.85, p.hand.palm[0].r * 1.4);
    for (const s of p.hand.palm) s.r = r;
  }
}

function basis(f: THREE.Vector3, b: THREE.Vector3, out: THREE.Matrix4): THREE.Matrix4 {
  const x = f.clone().normalize();
  const y = b.clone().addScaledVector(x, -b.dot(x)).normalize();
  const z = new THREE.Vector3().crossVectors(x, y);
  return out.makeBasis(x, y, z);
}

/** World rotation that points the hand's fingers along `fwd` with its back facing `back`. */
export function handQuat(h: HandFrame, fwd: THREE.Vector3, back: THREE.Vector3, out = new THREE.Quaternion()): THREE.Quaternion {
  basis(fwd, back, _m1);
  basis(h.fwdLocal, h.backLocal, _m2);
  return out.setFromRotationMatrix(_m1.multiply(_m2.transpose()));
}

/** Flex one joint from its rest pose. */
export function flexJoint(j: FingerJoint, angle: number): void {
  j.bone.quaternion.copy(j.rest).multiply(_q.setFromAxisAngle(j.axis, angle));
}

/** Thumb base: swing in front of the palm, lay it toward the fingers, then flex. */
export function poseThumbBase(h: HandFrame, swing: number, flex: number, adduct = 0): void {
  const j = h.thumb[0];
  if (!j) return;
  j.bone.quaternion.copy(j.rest)
    .multiply(_q.setFromAxisAngle(h.thumbSwing, swing))
    .multiply(_q2.setFromAxisAngle(h.thumbAdduct, adduct))
    .multiply(_q.setFromAxisAngle(j.axis, flex));
}

/** A relaxed or clenched hand with no contact: `curl` 0 = flat, 1 = fist. */
export function curlHand(h: HandFrame, curl: number): void {
  for (const f of h.fingers) f.forEach((j, k) => flexJoint(j, curl * FINGER_LIMITS[k]));
  poseThumbBase(h, curl * THUMB_SWING_MAX * 0.6, curl * THUMB_LIMITS[0]);
  for (let k = 1; k < h.thumb.length; k++) flexJoint(h.thumb[k], curl * THUMB_LIMITS[k]);
}

/** Skin spheres along a chain from joint `from` outward, in world space. */
export function chainSpheres(
  chain: FingerJoint[], from: number, out: { p: THREE.Vector3; r: number }[] = [],
): { p: THREE.Vector3; r: number }[] {
  for (let k = from; k < chain.length; k++) {
    const j = chain[k];
    const a = worldPos(j.bone);
    const b = j.bone.localToWorld(j.tip.clone());
    const next = chain[k + 1]?.radius ?? j.radius * 0.88;
    // The joint itself belongs to the previous segment, except at the knuckle.
    for (const t of k === from ? [0.3, 0.55, 0.8, 1] : [0.25, 0.5, 0.75, 1]) {
      out.push({ p: a.clone().lerp(b, t), r: THREE.MathUtils.lerp(j.radius, next, t) });
    }
  }
  return out;
}
