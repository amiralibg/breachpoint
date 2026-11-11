import type { GunFinish } from './finish';
import * as THREE from 'three';
import { loadGlb, loadModel } from '../core/assets';
import { buildM4, redDotOptic } from './m4';
import type { GripSpec } from './grip';
import { add, Z, type Key, type Timeline, type V3 } from './timeline';

/**
 * Where a hand holds the weapon, in view (holder) space before the gun's animated offset.
 * `pos` is the wrist, `fwd` points from the wrist toward the knuckles, `back` is the back-of-hand
 * normal. With `part` set, the anchor rides on that movable part (magazine, charging handle...).
 */
export interface HandAnchor extends GripSpec {
  part?: string;
  pos: V3;
  fwd: V3;
  back: V3;
  /** The hand holds the part by itself (a magazine out of the gun): only that part is solid. */
  solo?: boolean;
  /** This (left-hand) grip wraps over the right hand at the named anchor. */
  over?: string;
  /** Nothing to touch here (a hand reaching into the world). */
  air?: boolean;
}

export interface WeaponDef {
  id: string;
  name: string;
  slot: number;
  /** Poly Haven model id, "glb:<path under assets/>", or "procedural:m4". */
  model: string;
  /** Glass + projected dot added to the model for a tube red-dot sight. */
  redDot?: { height: number; front: number; rear: number; radius: number };
  /** Rotation applied to the raw model so the muzzle points down -Z. */
  modelRotation: [number, number, number];
  /** Node names inside the model to hide (spare magazines, loose rounds...). */
  hideNodes: string[];
  /** Movable parts: role -> node name(s). */
  parts: Record<string, string[]>;
  /** Parts hidden unless a timeline shows them. */
  hiddenParts?: string[];
  /** Per-shot part travel (bolt carrier / slide), view space. */
  fireParts?: Record<string, V3>;
  /** Parts that stay at their fire offset when the magazine runs dry (slide/bolt lock). */
  lockOnEmpty?: string[];
  /** Top cartridge shown in the magazine: [length, radius] in metres, and a nudge from the top centre. */
  magRound?: { size: [number, number]; offset?: V3 };
  /** Surface finish overrides (wear, bare metal colour, tint). */
  finish?: Partial<GunFinish>;
  hands: Record<string, HandAnchor>;
  /** Rest anchors for each hand. */
  restLeft: string;
  restRight: string;
  /** Hip-fire position of the model in view space. */
  hipPos: [number, number, number];
  /** Aim-down-sights position (sight line on the screen center). */
  adsPos: [number, number, number];
  /** Muzzle position in the rotated model's local space. */
  muzzle: [number, number, number];
  /** Where spent casings leave the gun (view space). */
  ejectPort: V3;
  /** 'sights' = look through the weapon's sights; 'scope' = full-screen magnified optic. */
  optic: 'sights' | 'scope';
  damage: number;
  headMultiplier: number;
  limbMultiplier: number;
  range: number;
  rpm: number;
  automatic: boolean;
  magSize: number;
  reserve: number;
  /** Extra time after each shot before the next (bolt cycling). */
  cycleTime: number;
  spreadHip: number;
  spreadAds: number;
  spreadMove: number;
  recoilPitch: number;
  recoilYaw: number;
  /** Sustained-fire climb: extra pitch per consecutive shot, and sideways drift. */
  sprayClimb: number;
  sprayDrift: number;
  adsFov: number;
  /** Seconds to raise the sights. */
  adsTime: number;
  /** Heavier guns sway and bob more and draw slower. */
  weight: number;
  sound: string;
  soundPower: number;
  /** Viewmodel kick per shot: position (up, back) and rotation (pitch, yaw jitter, roll jitter). */
  kickPos: [number, number];
  kickRot: [number, number, number];
  anims: {
    draw: Timeline;
    holster: Timeline;
    reloadTactical: Timeline;
    reloadEmpty: Timeline;
    inspect: Timeline;
    cycle?: Timeline;
    loot?: Timeline;
  };
}

// ---------------------------------------------------------------------------------------------
// Shared timelines

function drawAnim(weight: number): Timeline {
  const L = 0.5 + weight * 0.12;
  return {
    length: L,
    events: [[0, 'holster'], [L * 0.5, 'raise'], [L * 0.8, 'ready']],
    tracks: {
      pos: [[0, [0.03, -0.3, 0.08]], [L * 0.62, [0, 0.008, -0.004], 'out'], [L, Z]],
      rot: [[0, [-1.1, 0.35, 0.55]], [L * 0.62, [0.05, -0.02, -0.03], 'out'], [L, Z]],
    },
  };
}

function holsterAnim(weight: number): Timeline {
  const L = 0.24 + weight * 0.06;
  return {
    length: L,
    events: [[0, 'stow'], [L, 'ready']],
    tracks: {
      pos: [[0, Z], [L, [0.03, -0.32, 0.08], 'in']],
      rot: [[0, Z], [L, [-1.1, 0.35, 0.55], 'in']],
    },
  };
}

/** Tactical off-hand snatch/reach gesture when looting ammo or weapons. */
function lootAnim(weight: number, restHand = 'guard'): Timeline {
  const L = 0.48 + weight * 0.08;
  return {
    length: L,
    events: [[0.04, 'cloth'], [L * 0.38, 'grip'], [L * 0.88, 'ready']],
    hands: [[0.04, 'reach'], [L * 0.34, 'take'], [L * 0.52, restHand]],
    tracks: {
      pos: [[0, Z], [L * 0.32, [-0.025, -0.035, 0.025], 'out'], [L * 0.65, [-0.01, -0.012, 0.01]], [L, Z]],
      rot: [[0, Z], [L * 0.32, [-0.06, 0.12, -0.16], 'out'], [L * 0.65, [-0.02, 0.04, -0.05]], [L, Z]],
    },
  };
}

/** Tilt the gun over to look at it, roll back, then show the other side. */
function inspectAnim(): Timeline {
  const A: V3 = [-0.06, 0.05, 0.03];
  const AR: V3 = [0.15, 0.55, -0.95];
  const B: V3 = [0.02, 0.03, 0.01];
  const BR: V3 = [-0.05, -0.35, 0.45];
  return {
    length: 3.1,
    events: [[0.1, 'holster'], [0.5, 'rattle'], [1.85, 'rattle'], [2.85, 'grip'], [3.0, 'ready']],
    tracks: {
      pos: [[0, Z], [0.5, A], [1.3, add(A, [0, 0.006, 0])], [1.85, B], [2.5, add(B, [0, -0.004, 0])], [3.1, Z]],
      rot: [[0, Z], [0.5, AR], [1.3, add(AR, [0.03, -0.05, 0.05])], [1.85, BR], [2.5, add(BR, [0.02, 0.04, 0])], [3.1, Z]],
    },
  };
}

// ---------------------------------------------------------------------------------------------
// M4 (poses are offsets from the hip pose: magazine work and the charging-handle pull)

// The gun comes up and across and rolls its magazine well toward the support hand, close enough
// to the eye that the well and the fresh magazine's top round are in plain view. The hand strips
// the magazine down and out of frame, comes back with a fresh one, stops it at the mouth of the
// well, drives it home, tugs it to check the catch, and only then lets go.
const M4_MAG_P: V3 = [-0.075, 0.135, 0.02];
const M4_MAG_R: V3 = [0.4, 0.22, -0.82];
const M4_SEAT_P: V3 = add(M4_MAG_P, [0.003, 0.011, 0]); // the push that seats the magazine
const M4_SEAT_R: V3 = add(M4_MAG_R, [0.05, 0.01, -0.06]);
// Empty: the gun rolls most of the way back upright for the support hand to slap the bolt release
const M4_REL_P: V3 = [-0.025, 0.05, 0.005];
const M4_REL_R: V3 = [0.16, 0.12, -0.26];
const M4_MAG_OUT: V3 = [0.015, -0.42, 0.06];
const M4_MAG_ROT: V3 = [0.45, 0, 0.3];
/** Seconds: magazine seated, tug done, support hand lets go. */
const M4_SEAT = 1.42;
const M4_TUG = 1.6;
const M4_LEAVE = 1.7;

/** The magazine change both M4 reloads share. */
const M4_MAG_TRACKS: Record<string, Key[]> = {
  mag: [[0, Z], [0.34, Z], [0.4, [0, -0.012, 0], 'out'], [0.47, [0, -0.06, -0.01]], [0.66, M4_MAG_OUT, 'in'],
    [0.98, M4_MAG_OUT], [1.24, [0, -0.062, -0.011], 'out'],
    // Stops at the mouth of the well, draws back a touch, then goes home in one push
    [1.3, [0, -0.05, -0.008]], [1.36, [0, -0.056, -0.009]], [M4_SEAT, Z, 'in'],
    [M4_TUG - 0.08, Z], [M4_TUG, [0, -0.0035, 0], 'out'], [M4_TUG + 0.06, Z]],
  mag_rot: [[0.47, Z], [0.66, M4_MAG_ROT], [0.98, M4_MAG_ROT], [1.22, [0.03, 0, 0.02], 'out'], [1.3, Z]],
};

/** Gun movement through the magazine change, up to the moment the support hand lets go. */
const M4_SWAP_POS: Key[] = [[0, Z], [0.1, [0.004, -0.008, 0.004], 'out'], [0.32, M4_MAG_P, 'out'],
  [0.38, add(M4_MAG_P, [0, -0.007, 0])], [0.52, M4_MAG_P],
  // Left alone in one hand, the gun sags a little and is brought back up to meet the magazine
  [0.9, add(M4_MAG_P, [0.004, -0.012, 0.004])], [1.22, add(M4_MAG_P, [0, 0.003, 0])],
  [1.28, add(M4_MAG_P, [0.002, 0.007, 0]), 'out'], [1.36, add(M4_MAG_P, [0, -0.002, 0])],
  [M4_SEAT, M4_SEAT_P, 'in'], [M4_SEAT + 0.12, M4_MAG_P, 'out'],
  [M4_TUG, add(M4_MAG_P, [0, -0.006, 0]), 'out'], [M4_LEAVE, M4_MAG_P]];
const M4_SWAP_ROT: Key[] = [[0, Z], [0.1, [-0.03, -0.02, 0.05], 'out'], [0.32, M4_MAG_R, 'out'],
  [0.39, add(M4_MAG_R, [0.03, 0, -0.04])], [0.56, M4_MAG_R],
  [0.9, add(M4_MAG_R, [-0.035, 0.02, 0.07])], [1.22, add(M4_MAG_R, [0.01, 0, -0.02])],
  [1.28, add(M4_MAG_R, [0.025, 0, -0.03]), 'out'], [1.36, M4_MAG_R],
  [M4_SEAT, M4_SEAT_R, 'in'], [M4_SEAT + 0.14, M4_MAG_R, 'out'],
  [M4_TUG, add(M4_MAG_R, [-0.02, 0, 0.03]), 'out'], [M4_LEAVE, M4_MAG_R]];
const M4_SWAP_EVENTS: [number, string][] = [[0.06, 'cloth'], [0.3, 'mag_release'], [0.34, 'mag_out'], [0.7, 'pouch'],
  [1.25, 'mag_insert'], [M4_SEAT, 'mag_in'], [M4_SEAT, 'ammo'], [M4_TUG, 'tug']];

const M4: WeaponDef = {
  id: 'm4',
  name: 'M4A1 Carbine',
  slot: 0,
  // "Classic M4" by jeandiz (Sketchfab, CC BY 4.0). Falls back to the procedural model if missing.
  model: 'glb:models/m4/m4.glb',
  modelRotation: [0, Math.PI, 0],
  redDot: { height: 0.0735, front: -0.088, rear: 0.008, radius: 0.019 },
  hideNodes: ['Sling001'],
  parts: { mag: ['Magazine_m4_0001', 'Magazine001'], bolt: ['BoltCarrier_m4_0001', 'BoltCarrier001'] },
  fireParts: { bolt: [0, 0, 0.05] },
  lockOnEmpty: ['bolt'],
  magRound: { size: [0.057, 0.0047] },
  hands: {
    // Firing hand around the pistol grip, index finger laid along the receiver
    grip: { pos: [-0.0081, -0.1451, 0.1769], fwd: [0.432, 0.265, -0.862], back: [0.799, -0.168, 0.578], index: 0.55, thumb: [0.6, 0.35, 0.6] },
    // Support hand: palm flat under the handguard, fingers long up the far side, thumb laid forward along the near side
    guard: { pos: [-0.0697, -0.0444, -0.1595], fwd: [0.894, -0.036, -0.447], back: [-0.048, -0.999, 0.005], shape: [0.9, 0.4, 0.25], thumb: [-0.4, 0.1, 0] },
    // Around the magazine body, to pull it and to seat the fresh one
    mag: { part: 'mag', solo: true, pos: [-0.0082, -0.1288, 0.0077], fwd: [0.114, 0.287, -0.951], back: [-0.988, -0.066, -0.138], thumb: [0.6, 0.4] },
    // Flat on the left of the receiver, thumb on the bolt release
    release: { pos: [-0.0187, -0.0994, 0.0264], fwd: [-0.074, 0.258, -0.963], back: [-0.991, -0.09, 0.098], curl: 0.6, thumb: [0.3, 0.3] },
    // Reaching out, palm down, for something in the world; then closed around it
    reach: { air: true, pos: [-0.08, -0.26, -0.08], fwd: [0.2, -0.45, -0.87], back: [-0.25, 0.87, -0.42], curl: 0.22, thumb: [0.3, 0.15] },
    take: { air: true, pos: [-0.08, -0.26, -0.08], fwd: [0.2, -0.45, -0.87], back: [-0.25, 0.87, -0.42], curl: 0.8, thumb: [0.7, 0.6] },
  },
  restLeft: 'guard',
  restRight: 'grip',
  hipPos: [0.13, -0.16, -0.32],
  adsPos: [0, -0.0735, -0.13],
  muzzle: [0, 0.0, -0.39],
  ejectPort: [0.02, 0.0, -0.03],
  optic: 'sights',
  damage: 30,
  headMultiplier: 4,
  limbMultiplier: 0.75,
  range: 300,
  rpm: 750,
  automatic: true,
  magSize: 30,
  reserve: 150,
  cycleTime: 0,
  spreadHip: 0.03,
  spreadAds: 0.0025,
  spreadMove: 0.05,
  recoilPitch: 0.012,
  recoilYaw: 0.006,
  sprayClimb: 0.0016,
  sprayDrift: 0.0045,
  adsFov: 55,
  adsTime: 0.2,
  weight: 1,
  sound: 'm4_shot',
  soundPower: 1.25,
  kickPos: [0.004, 0.028],
  kickRot: [0.035, 0.012, 0.02],
  anims: {
    draw: drawAnim(1),
    holster: holsterAnim(1),
    inspect: inspectAnim(),
    reloadTactical: {
      length: 2.3,
      events: [...M4_SWAP_EVENTS, [1.98, 'grip'], [2.06, 'ready']],
      hands: [[0.1, 'mag', 0.22], [M4_LEAVE, 'guard', 0.28]],
      tracks: {
        // Back to the shoulder past level, then settling: the weight carries a little too far
        pos: [...M4_SWAP_POS, [2.08, [0.003, -0.006, 0.004], 'inout'], [2.3, Z]],
        rot: [...M4_SWAP_ROT, [2.08, [-0.025, -0.015, 0.045], 'inout'], [2.3, Z]],
        ...M4_MAG_TRACKS,
      },
    },
    reloadEmpty: {
      length: 2.75,
      events: [...M4_SWAP_EVENTS, [1.74, 'cloth'], [2.03, 'bolt_release'], [2.06, 'charge_fwd'], [2.46, 'grip'], [2.5, 'ready']],
      hands: [[0.1, 'mag', 0.22], [M4_LEAVE, 'release', 0.3], [2.18, 'guard', 0.28]],
      tracks: {
        pos: [...M4_SWAP_POS, [2.0, M4_REL_P], [2.06, add(M4_REL_P, [0.007, 0, 0]), 'out'], [2.2, M4_REL_P],
          [2.56, [0.003, -0.006, 0.004], 'inout'], [2.75, Z]],
        rot: [...M4_SWAP_ROT, [2.0, M4_REL_R], [2.06, add(M4_REL_R, [0, -0.03, 0.05]), 'out'], [2.22, M4_REL_R],
          [2.56, [-0.025, -0.015, 0.045], 'inout'], [2.75, Z]],
        ...M4_MAG_TRACKS,
        // The bolt is held back on the empty magazine until the release is hit
        bolt: [[0, [0, 0, 0.05]], [2.04, [0, 0, 0.05]], [2.09, Z, 'in']],
      },
    },
    loot: lootAnim(1.0, 'guard'),
  },
};

// ---------------------------------------------------------------------------------------------
// Pistol

// Muzzle up and the butt rolled toward the support hand, high enough that the magazine well and the
// fresh magazine going into it are in view
const P_MAG_P: V3 = [-0.035, 0.085, 0.02];
const P_MAG_R: V3 = [0.68, 0.24, -0.58];
// The model keeps its loaded magazine beside the gun; this puts it home in the grip. From there
// it travels along the grip's rake: `pMag(d)` is d metres out of the magazine well.
const P_MAG_HOME: V3 = [0, -0.012, -0.09];
const pMag = (d: number): V3 => add(P_MAG_HOME, [0, -0.955 * d, 0.297 * d]);
/** Seconds: magazine seated; support hand lets go of it. */
const P_SEAT = 1.02;
const P_LEAVE = 1.12;
/**
 * Old magazine drops free; the hand brings a fresh one up from below the frame, stops it at the
 * mouth of the well, draws back a touch and drives it home with the heel of the palm.
 */
const P_MAG_TRACK: Key[] = [[0, P_MAG_HOME], [0.27, P_MAG_HOME], [0.3, pMag(0.36)], [0.52, pMag(0.36)],
  [0.84, pMag(0.085), 'out'], [0.9, pMag(0.07)], [0.95, pMag(0.078)], [P_SEAT, P_MAG_HOME, 'in']];
/** Gun movement through the magazine change, up to the moment the support hand lets go. */
const P_SWAP_POS: Key[] = [[0, Z], [0.08, [0.003, -0.006, 0.003], 'out'], [0.26, P_MAG_P, 'out'],
  [0.31, add(P_MAG_P, [0, 0.006, 0])], [0.42, P_MAG_P],
  [0.7, add(P_MAG_P, [0.003, -0.008, 0.003])], [0.84, add(P_MAG_P, [0, 0.002, 0])],
  [0.9, add(P_MAG_P, [0, 0.005, 0]), 'out'], [0.96, add(P_MAG_P, [0, -0.002, 0])],
  [P_SEAT, add(P_MAG_P, [0, 0.013, 0]), 'in'], [P_SEAT + 0.12, P_MAG_P, 'out']];
const P_SWAP_ROT: Key[] = [[0, Z], [0.08, [-0.04, -0.02, 0.04], 'out'], [0.26, P_MAG_R, 'out'],
  [0.31, add(P_MAG_R, [-0.05, 0, 0.04])], [0.44, P_MAG_R],
  [0.7, add(P_MAG_R, [-0.04, 0.02, 0.06])], [0.84, P_MAG_R],
  [0.9, add(P_MAG_R, [0.03, 0, -0.03]), 'out'], [0.96, P_MAG_R],
  [P_SEAT, add(P_MAG_R, [0.11, 0.02, -0.06]), 'in'], [P_SEAT + 0.14, P_MAG_R, 'out']];
const P_SWAP_EVENTS: [number, string][] = [[0.1, 'cloth'], [0.22, 'mag_release'], [0.25, 'mag_out'], [0.26, 'drop:mag'],
  [0.44, 'pouch'], [0.86, 'mag_insert'], [P_SEAT, 'mag_in'], [P_SEAT, 'ammo']];
// Empty: with the support hand back on the gun, the firing thumb drops the slide stop. An overhand
// rack puts the support hand between the eye and a gun this small and hides it completely; this
// keeps the pistol, and the slide running home, in plain view.
const P_REL_P: V3 = [-0.02, 0.03, 0.02];
const P_REL_R: V3 = [0.22, 0.12, -0.2];
/** Seconds: the slide is released. */
const P_REL = 1.46;

const PISTOL: WeaponDef = {
  id: 'pistol',
  name: 'P-9 Service Pistol',
  slot: 1,
  model: 'service_pistol',
  modelRotation: [0, Math.PI / 2, 0],
  // The file also contains a slide-locked "_b" copy of the pistol and loose magazines.
  hideNodes: [
    'service_pistol_magazine_empty', 'service_pistol_bullet',
    'service_pistol_pistol_b', 'service_pistol_slide_b', 'service_pistol_hammer_b', 'service_pistol_trigger_b',
  ],
  parts: { slide: ['service_pistol_slide_a'], mag: ['service_pistol_magazine_loaded'], hammer: ['service_pistol_hammer_a'] },
  hiddenParts: ['mag'],
  fireParts: { slide: [0, 0, 0.028] },
  lockOnEmpty: ['slide'],
  hands: {
    // Firing hand high on the grip
    grip: { pos: [-0.0101, -0.0351, 0.0593], fwd: [0.397, 0.227, -0.889], back: [0.829, -0.175, 0.531], index: 0.5, thumb: [0.5, 0.45, 0.4] },
    // Support hand wrapped over the firing hand's fingers
    support: { over: 'grip', pos: [0.0058, -0.0346, 0.0348], fwd: [-0.382, 0.06, -0.922], back: [-0.838, -0.038, 0.544], thumb: [0.5, 0.3, 0.5] },
    // Around the magazine, fed up into the grip
    mag: { part: 'mag', solo: true, pos: [-0.0312, -0.0789, 0.1639], fwd: [-0.085, 0.482, -0.872], back: [-0.975, -0.203, 0.087], thumb: [0.6, 0.4] },
    // Overhand on the rear of the slide, to rack it
    slide: { part: 'slide', pos: [-0.1009, 0.067, 0.0127], fwd: [0.919, 0.386, -0.08], back: [-0.393, 0.913, -0.109], thumb: [0.5, 0.4] },
    // Reaching out, palm down, for something in the world; then closed around it
    reach: { air: true, pos: [-0.07, -0.24, -0.04], fwd: [0.2, -0.45, -0.87], back: [-0.25, 0.87, -0.42], curl: 0.22, thumb: [0.3, 0.15] },
    take: { air: true, pos: [-0.07, -0.24, -0.04], fwd: [0.2, -0.45, -0.87], back: [-0.25, 0.87, -0.42], curl: 0.8, thumb: [0.7, 0.6] },
  },
  restLeft: 'support',
  restRight: 'grip',
  hipPos: [0.105, -0.15, -0.34],
  adsPos: [0, -0.074, -0.42],
  muzzle: [0, 0.062, -0.18],
  ejectPort: [0.012, 0.065, -0.02],
  optic: 'sights',
  damage: 34,
  headMultiplier: 3,
  limbMultiplier: 0.8,
  range: 120,
  rpm: 420,
  automatic: false,
  magSize: 15,
  reserve: 90,
  cycleTime: 0,
  spreadHip: 0.014,
  spreadAds: 0.004,
  spreadMove: 0.03,
  recoilPitch: 0.03,
  recoilYaw: 0.01,
  sprayClimb: 0,
  sprayDrift: 0,
  adsFov: 62,
  adsTime: 0.15,
  weight: 0.6,
  sound: 'pistol_shot',
  soundPower: 1,
  kickPos: [0.012, 0.035],
  kickRot: [0.16, 0.025, 0.03],
  anims: {
    draw: drawAnim(0.6),
    holster: holsterAnim(0.6),
    inspect: inspectAnim(),
    reloadTactical: {
      length: 1.7,
      events: [...P_SWAP_EVENTS, [1.34, 'grip'], [1.5, 'ready']],
      show: { mag: [0.4, P_SEAT] },
      hands: [[0.14, 'mag', 0.24], [P_LEAVE, 'support', 0.24]],
      tracks: {
        pos: [...P_SWAP_POS, [1.5, [0.002, -0.005, 0.003], 'inout'], [1.7, Z]],
        rot: [...P_SWAP_ROT, [1.5, [-0.03, -0.01, 0.03], 'inout'], [1.7, Z]],
        mag: P_MAG_TRACK,
      },
    },
    reloadEmpty: {
      length: 1.95,
      events: [...P_SWAP_EVENTS, [1.34, 'grip'], [P_REL, 'slide'], [1.74, 'ready']],
      show: { mag: [0.4, P_SEAT] },
      hands: [[0.14, 'mag', 0.24], [P_LEAVE, 'support', 0.24]],
      tracks: {
        // Both hands back on the gun, a beat, then it jumps as the slide runs home
        pos: [...P_SWAP_POS, [1.34, P_REL_P], [P_REL, add(P_REL_P, [0, 0.002, 0])],
          [P_REL + 0.05, add(P_REL_P, [0, -0.004, 0.007]), 'out'], [P_REL + 0.18, P_REL_P], [1.78, [0.002, -0.005, 0.003], 'inout'], [1.95, Z]],
        rot: [...P_SWAP_ROT, [1.34, P_REL_R], [P_REL, add(P_REL_R, [-0.015, 0, 0])],
          [P_REL + 0.05, add(P_REL_R, [0.13, 0.01, -0.03]), 'out'], [P_REL + 0.2, P_REL_R], [1.78, [-0.03, -0.01, 0.03], 'inout'], [1.95, Z]],
        mag: P_MAG_TRACK,
        // The slide is locked back while empty until the stop is dropped
        slide: [[0, [0, 0, 0.028]], [P_REL, [0, 0, 0.028]], [P_REL + 0.035, Z, 'in']],
      },
    },
    loot: lootAnim(0.6, 'support'),
  },
};

// ---------------------------------------------------------------------------------------------
// Sniper

// Loading: the rifle comes up and rolls its open action toward the eye
const S_LOAD_P: V3 = [-0.05, 0.05, 0.05];
const S_LOAD_R: V3 = [0.16, 0.28, -0.6];
// Closing the bolt: most of the way back upright
const S_CLOSE_P: V3 = [-0.03, 0.02, 0.03];
const S_CLOSE_R: V3 = [0.05, 0.1, -0.25];
/** When each round is thumbed into the action. */
const S_ROUNDS = [1.0, 1.35, 1.7];
/** A little lift before each round, then the rifle gives under the thumb and comes back. */
const sPress = (base: V3, give: V3, lift: V3): Key[] => S_ROUNDS.flatMap((t): Key[] => [
  [t - 0.12, add(base, lift)], [t, add(base, give), 'in'], [t + 0.14, base, 'out'],
]);

const SNIPER: WeaponDef = {
  id: 'sniper',
  name: 'M-91 Sniper Rifle',
  slot: 2,
  model: 'bolt_action_rifle_7_62',
  modelRotation: [0, Math.PI / 2, 0],
  hideNodes: ['bolt_action_rifle_7_62_bullet_54mm'],
  parts: { bolt: ['bolt_action_rifle_7_62_bolt_a', 'bolt_action_rifle_7_62_bolt_b'] },
  hands: {
    // Firing hand on the wrist of the stock
    grip: { pos: [-0.0113, 0.0087, 0.4809], fwd: [0.45, -0.462, -0.764], back: [0.68, 0.203, 0.705], index: 0.5, thumb: [0.5, 0.4, 0.6] },
    // Support hand under the fore-end
    guard: { pos: [-0.0709, -0.0066, 0.0884], fwd: [0.917, -0.088, -0.389], back: [-0.13, -0.99, -0.06], shape: [0.9, 0.45, 0.3], thumb: [-0.4, 0.1, 0] },
    // Palm on the bolt knob
    bolt: { part: 'bolt', pos: [0.0814, 0.0732, 0.2918], fwd: [-0.605, 0.411, -0.682], back: [0.709, 0.705, 0], thumb: [0.6, 0.4] },
    // Fingers pressing rounds down into the open action
    port: { pos: [0.0479, 0.1245, 0.3104], fwd: [-0.761, 0.174, -0.625], back: [0.497, 0.85, 0.175], curl: 0.5 },
    // Reaching out, palm down, for something in the world; then closed around it
    reach: { air: true, pos: [-0.09, -0.28, -0.08], fwd: [0.2, -0.45, -0.87], back: [-0.25, 0.87, -0.42], curl: 0.22, thumb: [0.3, 0.15] },
    take: { air: true, pos: [-0.09, -0.28, -0.08], fwd: [0.2, -0.45, -0.87], back: [-0.25, 0.87, -0.42], curl: 0.8, thumb: [0.7, 0.6] },
  },
  restLeft: 'guard',
  restRight: 'grip',
  hipPos: [0.135, -0.165, -0.6],
  adsPos: [0, -0.08, -0.42],
  muzzle: [0, 0.02, -0.64],
  ejectPort: [0.02, 0.05, 0.22],
  optic: 'scope',
  damage: 115,
  headMultiplier: 2.5,
  limbMultiplier: 0.85,
  range: 500,
  rpm: 60,
  automatic: false,
  magSize: 5,
  reserve: 30,
  cycleTime: 0.9,
  spreadHip: 0.06,
  spreadAds: 0.0,
  spreadMove: 0.08,
  recoilPitch: 0.075,
  recoilYaw: 0.015,
  sprayClimb: 0,
  sprayDrift: 0,
  adsFov: 11,
  adsTime: 0.3,
  weight: 1.6,
  sound: 'sniper_shot',
  soundPower: 1.7,
  kickPos: [0.02, 0.09],
  kickRot: [0.22, 0.03, 0.05],
  anims: {
    draw: drawAnim(1.6),
    holster: holsterAnim(1.6),
    inspect: inspectAnim(),
    cycle: {
      length: 0.95,
      events: [[0.23, 'bolt_up'], [0.3, 'bolt'], [0.42, 'eject'], [0.52, 'bolt_fwd'], [0.62, 'charge_fwd'], [0.9, 'ready']],
      rhands: [[0.12, 'bolt'], [0.78, 'grip']],
      tracks: {
        // The rifle is dragged back with the bolt and shoved forward as it closes
        pos: [[0, Z], [0.2, [-0.02, -0.02, 0.03]], [0.3, [-0.022, -0.016, 0.034]], [0.45, [-0.02, -0.022, 0.046], 'out'],
          [0.52, [-0.02, -0.02, 0.04]], [0.62, [-0.02, -0.02, 0.018], 'in'], [0.72, [-0.02, -0.022, 0.03], 'out'], [0.95, Z]],
        rot: [[0, Z], [0.2, [0.0, 0.1, -0.25]], [0.3, [0.01, 0.1, -0.31], 'out'], [0.45, [0.035, 0.11, -0.27], 'out'],
          [0.62, [-0.02, 0.09, -0.25], 'in'], [0.72, [0.0, 0.1, -0.2], 'out'], [0.95, Z]],
        bolt_rot: [[0.22, Z], [0.32, [0, 0, 1.0], 'out'], [0.62, [0, 0, 1.0]], [0.72, Z, 'in']],
        bolt: [[0.32, Z], [0.45, [0, 0, 0.09], 'out'], [0.52, [0, 0, 0.09]], [0.62, Z, 'in']],
      },
    },
    reloadTactical: {
      length: 3.0,
      events: [[0.08, 'cloth'], [0.17, 'bolt_up'], [0.3, 'bolt'], [0.58, 'pouch'], [1.0, 'round_in'], [1.35, 'round_in'], [1.7, 'round_in'], [1.7, 'ammo'],
        [2.18, 'bolt_fwd'], [2.3, 'charge_fwd'], [2.62, 'grip'], [2.8, 'ready']],
      rhands: [[0.1, 'bolt'], [0.55, 'port'], [2.0, 'bolt'], [2.5, 'grip']],
      tracks: {
        pos: [[0, Z], [0.1, [0.003, -0.006, 0.004], 'out'], [0.3, S_LOAD_P], [0.48, add(S_LOAD_P, [0, 0, 0.012]), 'out'], [0.62, S_LOAD_P],
          ...sPress(S_LOAD_P, [0, -0.012, 0], [0, 0.003, 0]),
          [2.1, S_CLOSE_P], [2.28, add(S_CLOSE_P, [0, 0, -0.012]), 'in'], [2.42, S_CLOSE_P, 'out'],
          [2.8, [0.003, -0.006, 0.004], 'inout'], [3.0, Z]],
        rot: [[0, Z], [0.1, [-0.02, -0.02, 0.05], 'out'], [0.3, S_LOAD_R], [0.48, add(S_LOAD_R, [0.03, 0, -0.03]), 'out'], [0.62, S_LOAD_R],
          ...sPress(S_LOAD_R, [0.025, 0, -0.035], Z),
          [2.1, S_CLOSE_R], [2.28, add(S_CLOSE_R, [-0.07, -0.01, 0]), 'in'], [2.42, add(S_CLOSE_R, [-0.03, 0, 0.03]), 'out'],
          [2.8, [-0.02, -0.015, 0.04], 'inout'], [3.0, Z]],
        bolt_rot: [[0.15, Z], [0.3, [0, 0, 1.0], 'out'], [2.3, [0, 0, 1.0]], [2.42, Z, 'in']],
        bolt: [[0.3, Z], [0.48, [0, 0, 0.09], 'out'], [2.1, [0, 0, 0.09]], [2.28, Z, 'in']],
      },
    },
    reloadEmpty: null as unknown as Timeline, // same as tactical (set below)
    loot: lootAnim(1.6, 'guard'),
  },
};
SNIPER.anims.reloadEmpty = SNIPER.anims.reloadTactical;

export const WEAPONS: WeaponDef[] = [M4, PISTOL, SNIPER];

export interface WeaponState {
  def: WeaponDef;
  mag: number;
  reserve: number;
  view: THREE.Group;
  muzzle: THREE.Object3D;
}

export async function weaponModel(def: WeaponDef): Promise<THREE.Object3D> {
  if (def.model === 'procedural:m4') return buildM4();
  let gltf;
  try {
    gltf = def.model.startsWith('glb:') ? await loadGlb(def.model.slice(4)) : await loadModel(def.model);
  } catch (err) {
    if (def.id === 'm4') {
      console.warn('M4 model missing, using the procedural one', err);
      return buildM4();
    }
    throw err;
  }
  const model = gltf.scene.clone(true);
  // Materials are shared between clones; give each model its own so tweaks don't leak.
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) m.material = (m.material as THREE.Material).clone();
  });
  if (def.redDot) {
    const r = def.redDot;
    // Lens positions are given in the rotated frame; undo the rotation for the child.
    const optic = redDotOptic(r.height, r.front, r.rear, r.radius);
    // The model's sight tube is a one-sided shell: from behind the sight you saw the world
    // through its wall. A matte black sleeve rendered from the inside gives it a real bore.
    const len = Math.abs(r.front - r.rear) + 0.012;
    const sleeve = new THREE.Mesh(
      new THREE.CylinderGeometry(r.radius * 1.12, r.radius * 1.12, len, 40, 1, true).rotateX(Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.92, metalness: 0.1, side: THREE.BackSide }),
    );
    sleeve.name = 'sight-bore';
    sleeve.position.set(0, r.height, (r.front + r.rear) / 2);
    optic.add(sleeve);
    optic.rotation.set(-def.modelRotation[0], -def.modelRotation[1], -def.modelRotation[2]);
    model.add(optic);
  }
  model.rotation.set(...def.modelRotation);
  model.traverse((o) => {
    if (def.hideNodes.includes(o.name)) o.visible = false;
  });
  return model;
}
