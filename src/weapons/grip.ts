import * as THREE from 'three';
import {
  chainSpheres,
  curlHand,
  FINGER_LIMITS,
  flexJoint,
  handQuat,
  poseThumbBase,
  setWorldQuat,
  THUMB_ADDUCT_MAX,
  THUMB_LIMITS,
  THUMB_SWING_MAX,
  type FingerJoint,
  type HandFrame,
} from '../core/ik';

/**
 * Grip solving: given roughly where a hand goes on a gun, settle the palm onto the surface and
 * close each finger until its skin meets the model. Run once per hand anchor and cached, so at
 * runtime a grip is just a stored wrist position and finger pose: stable, and free of the
 * frame-to-frame jitter a live contact solve has.
 */
export interface GripSpec {
  /** How far the fingers may close, 0..1 (1 = until they meet the gun, or a fist in open air). */
  curl?: number;
  /**
   * How much each joint (knuckle, middle, tip) takes part in the curl, 0..1. [1, 1, 1] is a fist
   * around a grip; [1, 0.5, 0.3] bends at the knuckles and keeps the fingers long, the open
   * cupping hold of a support hand under a handguard.
   */
  shape?: [number, number, number];
  /** Closure for the index finger alone (a trigger finger lies straighter than the rest). */
  index?: number;
  /** Where the thumb wants to be: [swing in front of the palm, flex, laid toward the fingers], each 0..1. */
  thumb?: [number, number, number?];
  /** How far (m) the palm may travel to seat itself on the gun. 0 keeps the authored spot. */
  seat?: number;
}

export interface Sphere {
  p: THREE.Vector3;
  r: number;
}

export interface GripPose {
  /** Wrist position after seating, in the frame the grip was solved in. */
  pos: THREE.Vector3;
  /** Local rotation of every finger joint, in `HandFrame.joints` order. */
  quats: THREE.Quaternion[];
  /** Skin of the posed hand, so the other hand can wrap around this one. */
  spheres: Sphere[];
  /** Fingers with no pose clear of the gun, left open (a badly placed anchor). */
  blocked: number;
  /** How much of the hand is on the gun: finger segments (weighted by curl), thumb segments and palm points touching. */
  contact: { fingers: number; thumb: number; palm: number };
}

/** Signed distance to whatever the hand may touch (negative inside), capped at `max`. */
export type DistanceFn = (p: THREE.Vector3, max: number) => number;

/** Skin may sink this little into the surface before it counts as contact: a grip presses, but must not look sunk in. */
const PRESS = 0.97;
const STEP = 0.045;
/** Skin within this of the surface counts as resting on it. */
const TOUCH = 0.0025;

const _spheres: Sphere[] = [];

function free(dist: DistanceFn, spheres: Sphere[]): boolean {
  for (const s of spheres) if (dist(s.p, s.r) < s.r * PRESS) return false;
  return true;
}

function chainFree(dist: DistanceFn, chain: FingerJoint[], from: number): boolean {
  chain[from].bone.updateMatrixWorld(true);
  _spheres.length = 0;
  return free(dist, chainSpheres(chain, from, _spheres));
}

function palmSpheres(h: HandFrame, out: Sphere[] = []): Sphere[] {
  for (const s of h.palm) out.push({ p: h.hand.localToWorld(s.p.clone()), r: s.r });
  return out;
}

function place(h: HandFrame, pos: THREE.Vector3, q: THREE.Quaternion): void {
  setWorldQuat(h.hand, q);
  h.hand.position.copy(h.hand.parent!.worldToLocal(pos.clone()));
  h.hand.updateMatrixWorld(true);
}

/**
 * Solve one grip. The hand's bones are posed in place (the caller restores them), with world
 * space standing in for the gun's frame. With `dist` null the hand closes on thin air.
 */
export function solveGrip(
  h: HandFrame, pos: THREE.Vector3, fwd: THREE.Vector3, back: THREE.Vector3, spec: GripSpec, dist: DistanceFn | null,
): GripPose {
  const q = handQuat(h, fwd, back);
  const out = pos.clone();
  for (const j of h.joints) j.bone.quaternion.copy(j.rest);
  place(h, out, q);

  // --- Seat the palm: back off, then slide in along the palm normal until the skin touches
  const seat = spec.seat ?? 0.03;
  if (dist && seat > 0) {
    const palmDir = back.clone().normalize().negate();
    const start = pos.clone().addScaledVector(palmDir, -seat);
    let settled: THREE.Vector3 | null = null;
    let touched = false;
    for (let s = 0; s <= seat * 2; s += 0.001) {
      const p = start.clone().addScaledVector(palmDir, s);
      place(h, p, q);
      if (!free(dist, palmSpheres(h))) {
        touched = true;
        break;
      }
      settled = p;
    }
    if (touched && settled) out.copy(settled);
    place(h, out, q);
  }

  // --- Fingers: curl as one, then let each joint carry on by itself until it touches, so the
  // finger wraps around what it found.
  const curl = spec.curl ?? 1;
  let blocked = 0;
  h.fingers.forEach((chain, f) => {
    if (!chain.length) return;
    const max = f === 0 && spec.index !== undefined ? spec.index : curl;
    const limits = chain.map((_, k) => FINGER_LIMITS[k] * max * (spec.shape?.[k] ?? 1));
    const angles = chain.map(() => 0);
    const apply = (): void => chain.forEach((j, k) => flexJoint(j, angles[k]));
    if (!dist) {
      limits.forEach((l, k) => (angles[k] = l));
      apply();
      return;
    }
    // The tightest curl that is clear of the gun. Searched from the fist down rather than from
    // the open hand up: a straight finger often lies along the receiver, where the first degree
    // of curl already touches, yet the wrapped pose behind it is perfectly free.
    const N = 28;
    let t = -1;
    for (let k = N; k >= 0; k--) {
      limits.forEach((l, i) => (angles[i] = (l * k) / N));
      apply();
      if (chainFree(dist, chain, 0)) {
        t = k / N;
        break;
      }
    }
    if (t < 0) {
      blocked++;
      angles.fill(0);
      apply();
      return;
    }
    for (let j = 0; j < chain.length; j++) {
      const base = angles[j];
      for (let a = base + STEP; a <= limits[j]; a += STEP) {
        flexJoint(chain[j], a);
        if (!chainFree(dist, chain, j)) break;
        angles[j] = a;
      }
      flexJoint(chain[j], angles[j]);
    }
    chain[0].bone.updateMatrixWorld(true);
  });

  // --- Thumb: the free pose nearest to where it wants to be, then closed onto the surface
  if (h.thumb.length) {
    const [ts, tf, ta = 0] = spec.thumb ?? [0.6, 0.45, 0];
    const pose = (sw: number, f: number, ad: number): void => {
      poseThumbBase(h, sw * THUMB_SWING_MAX, f * THUMB_LIMITS[0], ad * THUMB_ADDUCT_MAX);
      for (let k = 1; k < h.thumb.length; k++) flexJoint(h.thumb[k], f * THUMB_LIMITS[k]);
    };
    let bs = ts;
    let bf = tf;
    let ba = ta;
    if (dist) {
      let best = Infinity;
      const N = 8;
      // Negative swing and adduction splay the thumb out flat beside the palm: where it goes when
      // the palm lies against something wide and the thumb can't close across it.
      for (let si = -4; si <= N; si++) {
        for (let fi = 0; fi <= N; fi++) {
          for (let ai = -N; ai <= N; ai += 2) {
            const cost = (si / N - ts) ** 2 + (fi / N - tf) ** 2 + (ai / N - ta) ** 2;
            if (cost >= best) continue;
            pose(si / N, fi / N, ai / N);
            if (chainFree(dist, h.thumb, 0)) {
              best = cost;
              bs = si / N;
              bf = fi / N;
              ba = ai / N;
            }
          }
        }
      }
      if (best === Infinity) {
        bs = bf = ba = 0;
        blocked++;
      } else {
        // Lay it down: swing toward the palm until the thumb rests on something, then curl its
        // joints onto it. Without this a thumb hovers stiffly beside the gun.
        const swingCap = Math.min(1, Math.max(ts, bs) + 0.45);
        for (let sw = bs + 0.04; sw <= swingCap; sw += 0.04) {
          pose(sw, bf, ba);
          if (!chainFree(dist, h.thumb, 0)) break;
          bs = sw;
        }
        // ...and bring it in from the side, toward the fingers, until it lies against the gun
        const adductCap = Math.min(1, Math.max(ta, ba) + 0.75);
        for (let ad = ba + 0.05; ad <= adductCap; ad += 0.05) {
          pose(bs, bf, ad);
          if (!chainFree(dist, h.thumb, 0)) break;
          ba = ad;
        }
        const cap = Math.min(1, Math.max(tf, bf) + 0.6);
        for (let f = bf + 0.04; f <= cap; f += 0.04) {
          pose(bs, f, ba);
          if (!chainFree(dist, h.thumb, 0)) break;
          bf = f;
        }
      }
    }
    pose(bs, bf, ba);
  }

  h.hand.updateMatrixWorld(true);
  const spheres = palmSpheres(h);
  for (const chain of [...h.fingers, h.thumb]) if (chain.length) chainSpheres(chain, 0, spheres);
  const contact = { fingers: 0, thumb: 0, palm: 0 };
  if (dist) {
    const near = (s: Sphere): boolean => dist(s.p, s.r + TOUCH) < s.r * PRESS + TOUCH;
    const segments = (chain: FingerJoint[]): number =>
      chain.filter((_, k) => chainSpheres(chain.slice(k, k + 1), 0).some(near)).length;
    // A finger lying flat along the receiver touches it too, so contact counts for more the
    // further the finger has curled: what is wanted is a hand wrapped around something.
    for (const chain of h.fingers) {
      const closed = chain.reduce((sum, j, k) => sum + j.rest.angleTo(j.bone.quaternion) / FINGER_LIMITS[k], 0) / Math.max(1, chain.length);
      contact.fingers += segments(chain) * (0.2 + 1.6 * closed);
    }
    contact.thumb = segments(h.thumb);
    contact.palm = palmSpheres(h).filter(near).length;
  }
  return { pos: out, quats: h.joints.map((j) => j.bone.quaternion.clone()), spheres, blocked, contact };
}

/** How good a grip is: more of the hand on the gun is better, a finger with nowhere to go is bad. */
export function gripScore(p: GripPose): number {
  return p.contact.fingers + p.contact.thumb * 0.7 + p.contact.palm * 0.35 - p.blocked * 3;
}

export interface FitResult {
  pos: THREE.Vector3;
  fwd: THREE.Vector3;
  back: THREE.Vector3;
  score: number;
  pose: GripPose;
}

/**
 * Development tool: improve a roughly placed hand anchor. Tries nearby placements (a few
 * centimetres, a few degrees) and keeps the one that puts most of the hand on the gun, with a
 * pull back toward the authored spot so the grip stays where it was meant to be.
 */
export function fitGrip(
  solve: (pos: THREE.Vector3, fwd: THREE.Vector3, back: THREE.Vector3) => GripPose,
  pos: THREE.Vector3, fwd: THREE.Vector3, back: THREE.Vector3,
  opts: { iterations?: number; spread?: number; angle?: number; seed?: number } = {},
): FitResult {
  let seed = opts.seed ?? 1;
  const rnd = (): number => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const gauss = (): number => (rnd() + rnd() + rnd() + rnd() - 2) * 1.73;
  const spread = opts.spread ?? 0.012;
  const angle = opts.angle ?? 0.2;
  const evaluate = (p: THREE.Vector3, f: THREE.Vector3, b: THREE.Vector3): FitResult => {
    const pose = solve(p, f, b);
    const drift = (p.distanceTo(pos) / (spread * 2.5)) ** 2 + (f.angleTo(fwd) / (angle * 2.5)) ** 2 + (b.angleTo(back) / (angle * 2.5)) ** 2;
    return { pos: p, fwd: f, back: b, pose, score: gripScore(pose) - drift };
  };
  let best = evaluate(pos.clone(), fwd.clone().normalize(), back.clone().normalize());
  const n = opts.iterations ?? 500;
  const q = new THREE.Quaternion();
  const axis = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    // Wide at first, then closing in on the best so far
    const k = i < n * 0.5 ? 1 : 0.35;
    const from = i < n * 0.5 && i % 3 === 0 ? { pos, fwd, back } : best;
    q.setFromAxisAngle(axis.set(gauss(), gauss(), gauss()).normalize(), gauss() * angle * k);
    const c = evaluate(
      from.pos.clone().add(new THREE.Vector3(gauss(), gauss(), gauss()).multiplyScalar(spread * k)),
      from.fwd.clone().normalize().applyQuaternion(q),
      from.back.clone().normalize().applyQuaternion(q),
    );
    if (c.score > best.score) best = c;
  }
  return best;
}

/** Finger pose of a hand hanging loose (used between grips). */
export function relaxedPose(h: HandFrame, curl = 0.3): THREE.Quaternion[] {
  curlHand(h, curl);
  const quats = h.joints.map((j) => j.bone.quaternion.clone());
  for (const j of h.joints) j.bone.quaternion.copy(j.rest);
  return quats;
}

/** Distance to a set of skin spheres (another hand), for wrapping one hand over the other. */
export function sphereDistance(spheres: Sphere[], p: THREE.Vector3, max: number): number {
  let d = max;
  for (const s of spheres) {
    const k = s.p.distanceTo(p) - s.r;
    if (k < d) d = k;
  }
  return d;
}
