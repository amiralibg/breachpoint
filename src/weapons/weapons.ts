import * as THREE from 'three';
import { loadGlb, loadModel } from '../core/assets';
import { buildM4, redDotOptic } from './m4';
import { add, Z, type Timeline, type V3 } from './timeline';

/**
 * Where a hand holds the weapon, in view (holder) space before the gun's animated offset.
 * `pos` is the wrist, `fwd` points from the wrist toward the knuckles, `back` is the back-of-hand
 * normal. With `part` set, the anchor rides on that movable part (magazine, charging handle...).
 */
export interface HandAnchor {
  part?: string;
  pos: V3;
  fwd: V3;
  back: V3;
  /** 0 = open hand, 1 = tight fist. */
  curl: number;
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
  };
}

// ---------------------------------------------------------------------------------------------
// Shared timelines

function drawAnim(weight: number): Timeline {
  const L = 0.5 + weight * 0.12;
  return {
    length: L,
    events: [[0, 'holster'], [L * 0.8, 'ready']],
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
    events: [[L, 'ready']],
    tracks: {
      pos: [[0, Z], [L, [0.03, -0.32, 0.08], 'in']],
      rot: [[0, Z], [L, [-1.1, 0.35, 0.55], 'in']],
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
    events: [[0.1, 'holster'], [3.0, 'ready']],
    tracks: {
      pos: [[0, Z], [0.5, A], [1.3, add(A, [0, 0.006, 0])], [1.85, B], [2.5, add(B, [0, -0.004, 0])], [3.1, Z]],
      rot: [[0, Z], [0.5, AR], [1.3, add(AR, [0.03, -0.05, 0.05])], [1.85, BR], [2.5, add(BR, [0.02, 0.04, 0])], [3.1, Z]],
    },
  };
}

// ---------------------------------------------------------------------------------------------
// M4 (poses are offsets from the hip pose: magazine work and the charging-handle pull)

const M4_MAG_P: V3 = [-0.06, 0.125, -0.04];
const M4_MAG_R: V3 = [0.12, 0.3, -0.75];
const M4_MAG_P2: V3 = [-0.06, 0.133, -0.04]; // seating bump
const M4_MAG_R2: V3 = [0.19, 0.32, -0.81];
const M4_CH_P: V3 = [-0.08, 0.06, 0.07];
const M4_CH_R: V3 = [0.1, -0.15, 0.4];

const M4: WeaponDef = {
  id: 'm4',
  name: 'M4A1 Carbine',
  slot: 0,
  // "Classic M4" by jeandiz (Sketchfab, CC BY 4.0). Falls back to the procedural model if missing.
  model: 'glb:models/m4/m4.glb',
  modelRotation: [0, Math.PI, 0],
  redDot: { height: 0.0735, front: -0.088, rear: 0.008, radius: 0.019 },
  hideNodes: ['Sling001'],
  parts: { mag: ['Magazine001'], handle: ['ChargingHandle001'], bolt: ['BoltCarrier001'] },
  fireParts: { bolt: [0, 0, 0.05] },
  lockOnEmpty: ['bolt'],
  hands: {
    grip: { pos: [0.014, -0.075, 0.118], fwd: [-0.45, -0.1, -0.89], back: [0.95, 0.3, 0], curl: 1.1 },
    guard: { pos: [0.0, -0.06, -0.2], fwd: [0.45, 0.2, -0.87], back: [-0.35, -0.94, 0], curl: 1.25 },
    mag: { part: 'mag', pos: [-0.018, -0.17, -0.035], fwd: [0.1, 1, 0], back: [-0.95, 0, 0.3], curl: 1.25 },
    magwell: { pos: [-0.04, -0.11, 0.0], fwd: [0.35, 0.7, -0.5], back: [-0.95, 0, -0.1], curl: 0.6 },
    handle: { part: 'handle', pos: [-0.03, 0.0, 0.16], fwd: [0.65, 0.3, -0.6], back: [-0.4, 0.9, 0.1], curl: 0.9 },
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
      length: 2.15,
      events: [[0.38, 'mag_out'], [1.42, 'mag_in'], [1.42, 'ammo'], [1.95, 'ready']],
      hands: [[0.22, 'mag'], [1.55, 'guard']],
      tracks: {
        pos: [[0, Z], [0.3, M4_MAG_P], [1.38, M4_MAG_P], [1.46, M4_MAG_P2, 'out'], [1.6, M4_MAG_P], [2.05, Z]],
        rot: [[0, Z], [0.3, M4_MAG_R], [0.42, add(M4_MAG_R, [0.04, 0, -0.04])], [0.6, M4_MAG_R],
          [1.38, M4_MAG_R], [1.46, M4_MAG_R2, 'out'], [1.62, M4_MAG_R], [2.05, Z]],
        mag: [[0, Z], [0.38, Z], [0.52, [0, -0.05, -0.008]], [0.85, [0.02, -0.4, 0.05], 'in'],
          [1.0, [0.02, -0.4, 0.05]], [1.27, [0, -0.05, -0.008], 'out'], [1.42, Z, 'in']],
        mag_rot: [[0.52, Z], [0.85, [0.4, 0, 0.3]], [1.0, [0.4, 0, 0.3]], [1.27, Z]],
      },
    },
    reloadEmpty: {
      length: 2.65,
      events: [[0.32, 'mag_out'], [0.5, 'drop:mag'], [0.85, 'mag_drop'], [1.4, 'mag_in'], [1.4, 'ammo'],
        [1.76, 'charge_back'], [1.97, 'charge_fwd'], [2.45, 'ready']],
      hands: [[0.2, 'mag'], [0.48, 'magwell'], [0.72, 'mag'], [1.5, 'handle'], [2.1, 'guard']],
      // The dropped mag becomes a physics prop; the fresh one appears in the hand off-screen.
      hide: { mag: [0.5, 0.7] },
      tracks: {
        pos: [[0, Z], [0.28, M4_MAG_P], [1.38, M4_MAG_P], [1.45, M4_MAG_P2, 'out'], [1.66, M4_CH_P],
          [1.85, add(M4_CH_P, [0, 0, 0.015])], [2.0, add(M4_CH_P, [0, -0.004, 0]), 'out'], [2.5, Z]],
        rot: [[0, Z], [0.28, M4_MAG_R], [1.38, M4_MAG_R], [1.45, M4_MAG_R2, 'out'], [1.66, M4_CH_R],
          [1.85, add(M4_CH_R, [0.02, 0, 0.02])], [2.0, add(M4_CH_R, [0.08, -0.02, 0.05]), 'out'], [2.5, Z]],
        // Old mag is pulled out and released; a fresh one comes up from the vest.
        mag: [[0, Z], [0.3, Z], [0.48, [0, -0.07, -0.012]], [0.72, [0.01, -0.6, 0.04]],
          [0.95, [0.03, -0.45, 0.06]], [1.25, [0, -0.05, -0.008], 'out'], [1.4, Z, 'in']],
        mag_rot: [[0.48, Z], [0.72, [0.9, 0, 0.5]], [0.95, [0.4, 0, 0.3]], [1.25, Z]],
        handle: [[1.72, Z], [1.86, [0, 0, 0.075], 'out'], [1.93, [0, 0, 0.075]], [1.97, Z, 'in']],
        // The bolt carrier sits locked back on the empty mag until the handle is released.
        bolt: [[0, [0, 0, 0.05]], [1.72, [0, 0, 0.05]], [1.86, [0, 0, 0.07], 'out'], [1.93, [0, 0, 0.07]], [1.97, Z, 'in']],
      },
    },
  },
};

// ---------------------------------------------------------------------------------------------
// Pistol

const P_MAG_P: V3 = [-0.03, 0.03, 0.03];
const P_MAG_R: V3 = [0.3, 0.3, -0.5];

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
    grip: { pos: [0.004, -0.038, 0.075], fwd: [-0.35, 0.05, -0.93], back: [0.95, 0.3, 0], curl: 1.1 },
    support: { pos: [-0.02, -0.05, 0.065], fwd: [0.5, 0.2, -0.84], back: [-0.7, -0.7, 0], curl: 1.0 },
    mag: { part: 'mag', pos: [-0.02, -0.07, 0.11], fwd: [0.3, 0.8, -0.5], back: [-0.95, 0, -0.1], curl: 0.75 },
    slide: { part: 'slide', pos: [-0.035, 0.07, 0.07], fwd: [0.7, 0.2, -0.65], back: [-0.3, 0.95, 0], curl: 0.9 },
  },
  restLeft: 'support',
  restRight: 'grip',
  hipPos: [0.12, -0.13, -0.32],
  adsPos: [0, -0.074, -0.36],
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
      length: 1.65,
      events: [[0.25, 'mag_out'], [1.0, 'mag_in'], [1.0, 'ammo'], [1.45, 'ready']],
      show: { mag: [0.4, 1.0] },
      hands: [[0.3, 'mag'], [1.08, 'support']],
      tracks: {
        pos: [[0, Z], [0.25, P_MAG_P], [0.95, P_MAG_P], [1.03, add(P_MAG_P, [0, 0.01, 0]), 'out'], [1.15, P_MAG_P], [1.55, Z]],
        rot: [[0, Z], [0.25, P_MAG_R], [0.95, P_MAG_R], [1.03, add(P_MAG_R, [0.1, 0.02, -0.05]), 'out'], [1.15, P_MAG_R], [1.55, Z]],
        mag: [[0, [0, -0.35, -0.08]], [0.45, [0, -0.35, -0.08]], [0.85, [0, -0.11, -0.088], 'out'], [1.0, [0, -0.06, -0.09], 'in']],
      },
    },
    reloadEmpty: {
      length: 1.95,
      events: [[0.25, 'mag_out'], [1.0, 'mag_in'], [1.0, 'ammo'], [1.42, 'slide'], [1.75, 'ready']],
      show: { mag: [0.4, 1.0] },
      hands: [[0.3, 'mag'], [1.08, 'slide'], [1.5, 'support']],
      tracks: {
        pos: [[0, Z], [0.25, P_MAG_P], [0.95, P_MAG_P], [1.03, add(P_MAG_P, [0, 0.01, 0]), 'out'],
          [1.25, [-0.04, 0.02, 0.05]], [1.45, [-0.04, 0.02, 0.05]], [1.85, Z]],
        rot: [[0, Z], [0.25, P_MAG_R], [0.95, P_MAG_R], [1.03, add(P_MAG_R, [0.1, 0.02, -0.05]), 'out'],
          [1.25, [0.15, -0.25, 0.4]], [1.42, [0.15, -0.25, 0.4]], [1.5, [0.3, -0.25, 0.45], 'out'], [1.85, Z]],
        mag: [[0, [0, -0.35, -0.08]], [0.45, [0, -0.35, -0.08]], [0.85, [0, -0.11, -0.088], 'out'], [1.0, [0, -0.06, -0.09], 'in']],
        // Slide is locked back while empty; released by the support hand here.
        slide: [[0, [0, 0, 0.028]], [1.36, [0, 0, 0.028]], [1.4, [0, 0, 0.034], 'out'], [1.44, Z, 'in']],
      },
    },
  },
};

// ---------------------------------------------------------------------------------------------
// Sniper

const S_LOAD_P: V3 = [-0.04, 0.02, 0.04];
const S_LOAD_R: V3 = [0.12, 0.25, -0.45];

const SNIPER: WeaponDef = {
  id: 'sniper',
  name: 'M-91 Sniper Rifle',
  slot: 2,
  model: 'bolt_action_rifle_7_62',
  modelRotation: [0, Math.PI / 2, 0],
  hideNodes: ['bolt_action_rifle_7_62_bullet_54mm'],
  parts: { bolt: ['bolt_action_rifle_7_62_bolt_a', 'bolt_action_rifle_7_62_bolt_b'] },
  hands: {
    grip: { pos: [0.01, -0.085, 0.37], fwd: [-0.35, 0.15, -0.92], back: [0.95, 0.3, 0], curl: 0.85 },
    guard: { pos: [-0.006, -0.075, 0.02], fwd: [0.45, 0.2, -0.87], back: [-0.35, -0.94, 0], curl: 1.2 },
    bolt: { part: 'bolt', pos: [0.06, 0.0, 0.3], fwd: [-0.2, 0.55, -0.8], back: [0.9, 0.2, 0.3], curl: 0.95 },
    port: { pos: [0.03, 0.02, 0.27], fwd: [-0.55, 0.1, -0.83], back: [0.3, 0.95, 0], curl: 0.7 },
  },
  restLeft: 'guard',
  restRight: 'grip',
  hipPos: [0.17, -0.19, -0.47],
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
      events: [[0.3, 'bolt'], [0.42, 'eject'], [0.62, 'charge_fwd'], [0.9, 'ready']],
      rhands: [[0.12, 'bolt'], [0.78, 'grip']],
      tracks: {
        pos: [[0, Z], [0.25, [-0.02, -0.02, 0.03]], [0.7, [-0.02, -0.02, 0.03]], [0.95, Z]],
        rot: [[0, Z], [0.25, [0.0, 0.1, -0.25]], [0.7, [0.0, 0.1, -0.25]], [0.95, Z]],
        bolt_rot: [[0.22, Z], [0.32, [0, 0, 1.0], 'out'], [0.62, [0, 0, 1.0]], [0.72, Z, 'in']],
        bolt: [[0.32, Z], [0.45, [0, 0, 0.09], 'out'], [0.52, [0, 0, 0.09]], [0.62, Z, 'in']],
      },
    },
    reloadTactical: {
      length: 3.0,
      events: [[0.3, 'bolt'], [1.0, 'round_in'], [1.35, 'round_in'], [1.7, 'round_in'], [1.7, 'ammo'],
        [2.3, 'charge_fwd'], [2.8, 'ready']],
      rhands: [[0.1, 'bolt'], [0.55, 'port'], [2.0, 'bolt'], [2.5, 'grip']],
      tracks: {
        pos: [[0, Z], [0.3, S_LOAD_P], [0.95, S_LOAD_P], [1.0, add(S_LOAD_P, [0, -0.01, 0]), 'out'], [1.15, S_LOAD_P],
          [1.35, add(S_LOAD_P, [0, -0.01, 0]), 'out'], [1.5, S_LOAD_P],
          [1.7, add(S_LOAD_P, [0, -0.01, 0]), 'out'], [1.85, S_LOAD_P], [2.9, Z]],
        rot: [[0, Z], [0.3, S_LOAD_R], [1.9, S_LOAD_R], [2.1, [0.05, 0.1, -0.25]], [2.9, Z]],
        bolt_rot: [[0.15, Z], [0.3, [0, 0, 1.0], 'out'], [2.3, [0, 0, 1.0]], [2.42, Z, 'in']],
        bolt: [[0.3, Z], [0.48, [0, 0, 0.09], 'out'], [2.1, [0, 0, 0.09]], [2.28, Z, 'in']],
      },
    },
    reloadEmpty: null as unknown as Timeline, // same as tactical (set below)
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
    optic.rotation.set(-def.modelRotation[0], -def.modelRotation[1], -def.modelRotation[2]);
    model.add(optic);
  }
  model.rotation.set(...def.modelRotation);
  model.traverse((o) => {
    if (def.hideNodes.includes(o.name)) o.visible = false;
  });
  return model;
}
