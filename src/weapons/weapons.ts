import * as THREE from 'three';
import { loadGlb, loadModel } from '../core/assets';
import { buildM4, redDotOptic } from './m4';

export interface WeaponDef {
  id: string;
  name: string;
  /** Poly Haven model id, "glb:<path under assets/>", or "procedural:m4". */
  model: string;
  /** Glass + projected dot added to the model for a tube red-dot sight. */
  redDot?: { height: number; front: number; rear: number; radius: number };
  /** Rotation applied to the raw model so the muzzle points down -Z. */
  modelRotation: [number, number, number];
  /** Node names inside the model to hide (spare magazines, loose rounds...). */
  hideNodes: string[];
  /** Hip-fire position of the model in view space. */
  hipPos: [number, number, number];
  /** Aim-down-sights position (sight line on the screen center). */
  adsPos: [number, number, number];
  /** Muzzle position in the rotated model's local space. */
  muzzle: [number, number, number];
  /** 'sights' = look through the weapon's sights; 'scope' = full-screen magnified optic. */
  optic: 'sights' | 'scope';
  damage: number;
  headMultiplier: number;
  range: number;
  rpm: number;
  automatic: boolean;
  magSize: number;
  reserve: number;
  reloadTime: number;
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
  soundPower: number;
  kickBack: number;
}

export const WEAPONS: WeaponDef[] = [
  {
    id: 'm4',
    name: 'M4A1 Carbine (5.56)',
    // "Classic M4" by jeandiz (Sketchfab, CC BY 4.0). Falls back to the procedural model if missing.
    model: 'glb:models/m4/m4.glb',
    modelRotation: [0, Math.PI, 0],
    redDot: { height: 0.0735, front: -0.088, rear: 0.008, radius: 0.019 },
    hideNodes: [],
    hipPos: [0.13, -0.16, -0.32],
    adsPos: [0, -0.0735, -0.13],
    muzzle: [0, 0.0, -0.39],
    optic: 'sights',
    damage: 30,
    headMultiplier: 4,
    range: 300,
    rpm: 750,
    automatic: true,
    magSize: 30,
    reserve: 150,
    reloadTime: 2.3,
    cycleTime: 0,
    spreadHip: 0.03,
    spreadAds: 0.0025,
    spreadMove: 0.05,
    recoilPitch: 0.012,
    recoilYaw: 0.006,
    sprayClimb: 0.0016,
    sprayDrift: 0.0045,
    adsFov: 55,
    soundPower: 1.25,
    kickBack: 0.035,
  },
  {
    id: 'pistol',
    name: 'P-9 Service Pistol (9mm)',
    model: 'service_pistol',
    modelRotation: [0, Math.PI / 2, 0],
    // The file contains a second pistol (slide-locked "_b" variant) and loose magazines; hide them.
    hideNodes: [
      'service_pistol_magazine_empty', 'service_pistol_magazine_loaded', 'service_pistol_bullet',
      'service_pistol_pistol_b', 'service_pistol_slide_b', 'service_pistol_hammer_b', 'service_pistol_trigger_b',
    ],
    hipPos: [0.12, -0.13, -0.32],
    adsPos: [0, -0.074, -0.36],
    muzzle: [0, 0.062, -0.18],
    optic: 'sights',
    damage: 34,
    headMultiplier: 3,
    range: 120,
    rpm: 420,
    automatic: false,
    magSize: 15,
    reserve: 90,
    reloadTime: 1.7,
    cycleTime: 0,
    spreadHip: 0.014,
    spreadAds: 0.004,
    spreadMove: 0.03,
    recoilPitch: 0.03,
    recoilYaw: 0.01,
    sprayClimb: 0,
    sprayDrift: 0,
    adsFov: 62,
    soundPower: 1,
    kickBack: 0.05,
  },
  {
    id: 'sniper',
    name: 'M-91 Sniper Rifle (7.62)',
    model: 'bolt_action_rifle_7_62',
    modelRotation: [0, Math.PI / 2, 0],
    hideNodes: ['bolt_action_rifle_7_62_bullet_54mm'],
    hipPos: [0.2, -0.2, -0.55],
    adsPos: [0, -0.08, -0.42],
    muzzle: [0, 0.02, -0.64],
    optic: 'scope',
    damage: 115,
    headMultiplier: 2.5,
    range: 500,
    rpm: 60,
    automatic: false,
    magSize: 5,
    reserve: 30,
    reloadTime: 3.0,
    cycleTime: 0.9,
    spreadHip: 0.06,
    spreadAds: 0.0,
    spreadMove: 0.08,
    recoilPitch: 0.075,
    recoilYaw: 0.015,
    sprayClimb: 0,
    sprayDrift: 0,
    adsFov: 11,
    soundPower: 1.7,
    kickBack: 0.12,
  },
];

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

export async function createWeapons(): Promise<WeaponState[]> {
  return Promise.all(
    WEAPONS.map(async (def) => {
      const model = await weaponModel(def);
      model.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.frustumCulled = false;
          const mat = m.material as THREE.MeshStandardMaterial;
          mat.envMapIntensity = 1.2;
        }
      });
      const view = new THREE.Group();
      view.add(model);
      const muzzle = new THREE.Object3D();
      muzzle.position.set(...def.muzzle);
      view.add(muzzle);
      view.visible = false;
      return { def, mag: def.magSize, reserve: def.reserve, view, muzzle };
    }),
  );
}
