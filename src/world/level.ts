import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { loadPbr, pbrMaterial } from '../core/assets';
import type { Audio } from '../core/audio';
import type { QualityPreset } from '../core/settings';
import { collidersChanged, raycastBoxes } from './physics';
import { installSunFog, makeSky, type SkySpec } from './sky';
import { buildProps, propBaseBox, releaseTextures, SHADOW_LAYER, type PropId } from './props';

/**
 * Level kit for the story maps. A map is built from axis-aligned boxes (slabs, walls with door
 * gaps, box-tread stairs, rails, containers), which is exactly what the player collision, the
 * bullet traces and the navmesh bake already understand. Static boxes are merged into one mesh
 * per material; doors and water stay separate because they change.
 *
 * Convention: y = 0 is the lowest walkable level of every map (the engine has an implicit ground
 * plane there). Basements are not below zero; everything else is stacked above them.
 */

export type Surface = 'dirt' | 'hard';
export type V3 = [number, number, number];
export type Rect = [x0: number, z0: number, x1: number, z1: number];

const TEX = {
  concrete: 'concrete_wall_008',
  floor: 'concrete_floor_02',
  painted: 'painted_concrete',
  plaster: 'plastered_wall_04',
  brick: 'brick_wall_001',
  steel: 'metal_plate',
  rust: 'rusty_metal_02',
  iron: 'corrugated_iron',
  blue: 'blue_metal_plate',
  green: 'green_metal_rust',
  tiles: 'floor_tiles_06',
  marble: 'marble_01',
  rock: 'rock_wall_08',
  stone: 'medieval_blocks_02',
  asphalt: 'asphalt_02',
  sand: 'coast_sand_rocks_02',
  sandstone: 'sandstone_brick_wall_01',
} as const;
export type TexName = keyof typeof TEX;
const METALS = new Set<TexName>(['steel', 'rust', 'iron', 'blue', 'green']);

export type { PropId };

/** Light, weather and how well bots perceive in it. */
export interface EnvSpec {
  /** Direction toward the sun or moon. */
  sunDir: V3;
  sunColor: number;
  sunIntensity: number;
  hemi: [sky: number, ground: number, intensity: number];
  fog: [color: number, density: number];
  /** Haze colour looking toward the sun. */
  fogSun: number;
  sky: Partial<SkySpec>;
  envIntensity: number;
  /** How brightly the weapon in the player's hands is lit (1 = the compound's afternoon). */
  viewLight: number;
  /** 0..1 rain density. */
  rain: number;
  lightning: boolean;
  /** Strength of the light shafts / haze around the sun. */
  shafts: number;
  /** Bots' sight and hearing multipliers (dark and rain hide the player). */
  sight: number;
  hearing: number;
  /** The player carries a light (underground). */
  flashlight: boolean;
  wind: number;
}

export const ENV: Record<'nightRain' | 'dusk' | 'overcast' | 'underground' | 'storm' | 'dawnStorm', EnvSpec> = {
  nightRain: {
    sunDir: [0.35, 0.72, 0.45], sunColor: 0x8ea6d6, sunIntensity: 1.25,
    hemi: [0x46587c, 0x1c1f26, 1.0], fog: [0x0b1017, 0.011], fogSun: 0x1b2433,
    sky: {
      zenith: [0.006, 0.009, 0.018], horizon: [0.022, 0.028, 0.04], horizonSun: [0.09, 0.06, 0.035], glow: [0.05, 0.06, 0.09],
      cloudLit: [0.03, 0.035, 0.05], cloudSun: [0.06, 0.07, 0.1], cloudDark: [0.008, 0.01, 0.015], cover: [0.25, 0.55], cloudAmount: 0.96, disc: 0,
    },
    envIntensity: 0.9, viewLight: 0.42, rain: 0.9, lightning: true, shafts: 0, sight: 0.6, hearing: 0.7, flashlight: false, wind: 0.5,
  },
  dusk: {
    sunDir: [-0.82, 0.14, -0.3], sunColor: 0xff9a52, sunIntensity: 3.6,
    hemi: [0x6f7fa8, 0x4a3a30, 0.5], fog: [0x4a4a55, 0.009], fogSun: 0xff8a45,
    sky: {
      zenith: [0.05, 0.075, 0.16], horizon: [0.22, 0.22, 0.3], horizonSun: [1.2, 0.5, 0.18], glow: [1.3, 0.6, 0.25],
      cloudLit: [0.3, 0.26, 0.32], cloudSun: [1.5, 0.6, 0.3], cloudDark: [0.07, 0.07, 0.11], cover: [0.45, 0.72], cloudAmount: 0.9, disc: 1,
    },
    envIntensity: 0.8, viewLight: 0.7, rain: 0, lightning: false, shafts: 0.5, sight: 0.85, hearing: 1, flashlight: false, wind: 0.2,
  },
  overcast: {
    sunDir: [0.3, 0.8, 0.5], sunColor: 0xe6ecf5, sunIntensity: 2.4,
    hemi: [0xb9c6d8, 0x5a5650, 1.0], fog: [0x8b949e, 0.0045], fogSun: 0xb0b8c2,
    sky: {
      zenith: [0.32, 0.36, 0.42], horizon: [0.55, 0.58, 0.62], horizonSun: [0.7, 0.7, 0.72], glow: [0.5, 0.5, 0.5],
      cloudLit: [0.62, 0.64, 0.68], cloudSun: [0.85, 0.85, 0.86], cloudDark: [0.3, 0.32, 0.36], cover: [0.15, 0.5], cloudAmount: 0.98, disc: 0,
    },
    envIntensity: 1, viewLight: 0.85, rain: 0, lightning: false, shafts: 0.15, sight: 1, hearing: 1, flashlight: false, wind: 0.3,
  },
  underground: {
    sunDir: [0.2, 0.9, 0.3], sunColor: 0x6f86b0, sunIntensity: 0,
    hemi: [0x2b3a44, 0x101214, 0.34], fog: [0x05080a, 0.02], fogSun: 0x05080a,
    sky: {
      zenith: [0.004, 0.006, 0.01], horizon: [0.01, 0.014, 0.02], horizonSun: [0.02, 0.02, 0.02], glow: [0.01, 0.01, 0.01],
      cloudLit: [0.01, 0.012, 0.016], cloudSun: [0.02, 0.02, 0.025], cloudDark: [0.004, 0.005, 0.008], cover: [0.2, 0.5], cloudAmount: 0.96, disc: 0,
    },
    envIntensity: 0.25, viewLight: 0.3, rain: 0, lightning: false, shafts: 0, sight: 0.45, hearing: 1.15, flashlight: true, wind: 0,
  },
  storm: {
    sunDir: [-0.4, 0.6, 0.6], sunColor: 0x7f9bd0, sunIntensity: 1.3,
    hemi: [0x4c5f84, 0x1b1f27, 1.05], fog: [0x0d131c, 0.012], fogSun: 0x1c2738,
    sky: {
      zenith: [0.008, 0.012, 0.024], horizon: [0.03, 0.04, 0.06], horizonSun: [0.05, 0.06, 0.09], glow: [0.06, 0.08, 0.12],
      cloudLit: [0.045, 0.055, 0.08], cloudSun: [0.08, 0.1, 0.14], cloudDark: [0.01, 0.012, 0.02], cover: [0.18, 0.5], cloudAmount: 0.98, disc: 0,
    },
    envIntensity: 0.9, viewLight: 0.45, rain: 1, lightning: true, shafts: 0, sight: 0.55, hearing: 0.5, flashlight: false, wind: 1,
  },
  dawnStorm: {
    sunDir: [0.75, 0.2, -0.5], sunColor: 0xb8c6e0, sunIntensity: 1.5,
    hemi: [0x7e8fb0, 0x2a2c33, 0.8], fog: [0x39434f, 0.008], fogSun: 0x8a8f9c,
    sky: {
      zenith: [0.07, 0.09, 0.13], horizon: [0.2, 0.23, 0.28], horizonSun: [0.55, 0.45, 0.4], glow: [0.5, 0.42, 0.38],
      cloudLit: [0.22, 0.24, 0.29], cloudSun: [0.6, 0.5, 0.46], cloudDark: [0.05, 0.06, 0.08], cover: [0.2, 0.52], cloudAmount: 0.97, disc: 0,
    },
    envIntensity: 0.8, viewLight: 0.6, rain: 0.8, lightning: true, shafts: 0.1, sight: 0.8, hearing: 0.6, flashlight: false, wind: 1,
  },
};

export interface Door {
  id: string;
  mesh: THREE.Mesh;
  box: THREE.Box3;
  open: boolean;
}

export interface Water {
  mesh: THREE.Mesh;
  rect: Rect;
  level: number;
}

/** A door or window in a wall: [from, to] along the wall in world coordinates, optional [sill, top] heights above the wall's base. */
export type Gap = [from: number, to: number, sill?: number, top?: number];

export interface BuiltLevel {
  root: THREE.Group;
  colliders: THREE.Box3[];
  sun: THREE.DirectionalLight;
  sunDir: THREE.Vector3;
  sunColor: THREE.Color;
  envMap: THREE.Texture;
  env: EnvSpec;
  doors: Map<string, Door>;
  waters: Water[];
  /** Current lightning brightness, 0..1. */
  flash: number;
  /** False cuts the lamps (a blackout). */
  setPower(on: boolean): void;
  /** Scale the sun, sky light and reflections (1 = as built): nightfall, a blackout. */
  setDaylight(f: number): void;
  setDoor(id: string, open: boolean): boolean;
  update(dt: number, viewer: THREE.Vector3, audio?: Audio): void;
  dispose(): void;
}

const UP = new THREE.Vector3(0, 1, 0);

export const STAIR_TREAD = 0.45;
/** Horizontal length of a flight between two heights. */
export function stairRun(y0: number, y1: number): number {
  return Math.max(1, Math.round((y1 - y0) / 0.25)) * STAIR_TREAD;
}

/** Box with UVs scaled to world size, so textures keep a constant texel density. */
function worldBox(w: number, h: number, d: number, tile: number): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const faceDims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    const [su, sv] = faceDims[f];
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, (uv.getX(i) * su) / tile, (uv.getY(i) * sv) / tile);
    }
  }
  return g;
}

export class LevelBuilder {
  readonly root = new THREE.Group();
  readonly colliders: THREE.Box3[] = [];
  readonly doors = new Map<string, Door>();
  readonly waters: Water[] = [];
  private batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
  /** Boxes that cast no shadow (trim, signs, the skyline): merged separately. */
  private unshadowed = new Map<THREE.Material, THREE.BufferGeometry[]>();
  private mats = new Map<string, THREE.Material>();
  private boxes = new Map<PropId, THREE.Box3>();
  /** Placed props, drawn as one instanced mesh per prop part. */
  private placed = new Map<PropId, THREE.Matrix4[]>();
  /** Free-form static geometry (pipes, cables, frames), merged per material like the boxes. */
  private extra = new Map<THREE.Material, THREE.BufferGeometry[]>();
  private lights: { light: THREE.PointLight; base: number; flicker: number }[] = [];
  private bulbs: THREE.MeshBasicMaterial[] = [];
  private owned: THREE.Material[] = [];

  private constructor(private q: QualityPreset) {}

  static async create(q: QualityPreset, textures: TexName[]): Promise<LevelBuilder> {
    const b = new LevelBuilder(q);
    const sets = await Promise.all(textures.map((t) => loadPbr(TEX[t], q.textureRes, q.anisotropy)));
    textures.forEach((t, i) => {
      // Painted and rusted steel, not bare metal: full metalness goes black wherever the sky is dark
      const m = pbrMaterial(sets[i], { metalness: METALS.has(t) ? 0.45 : 0 });
      if (METALS.has(t)) m.userData.metal = true;
      b.mats.set(t, m);
      b.owned.push(m);
    });
    return b;
  }

  /** A prop's box standing at the origin (models are loaded only when the map is finished). */
  private protoBox(id: PropId): THREE.Box3 {
    let box = this.boxes.get(id);
    if (!box) this.boxes.set(id, (box = propBaseBox(id)));
    return box;
  }

  /** A textured material loaded for this map. */
  mat(name: TexName): THREE.Material {
    const m = this.mats.get(name);
    if (!m) throw new Error(`texture ${name} was not requested for this map`);
    return m;
  }

  /** A textured material multiplied by a colour (painted steel, stained concrete...). */
  tint(name: TexName, color: number, roughness?: number): THREE.Material {
    const key = `${name}:${color}:${roughness ?? ''}`;
    let m = this.mats.get(key);
    if (!m) {
      const c = (this.mat(name) as THREE.MeshStandardMaterial).clone();
      c.userData = { ...c.userData };
      c.color.set(color);
      if (roughness !== undefined) c.roughness = roughness;
      m = c;
      this.mats.set(key, m);
      this.owned.push(m);
    }
    return m;
  }

  /** Plain painted surface. */
  flat(color: number, roughness = 0.8, metalness = 0): THREE.Material {
    const key = `flat:${color}:${roughness}:${metalness}`;
    let m = this.mats.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color, roughness, metalness });
      if (metalness >= 0.3) m.userData.metal = true;
      this.mats.set(key, m);
      this.owned.push(m);
    }
    return m;
  }

  /** Hand a material made elsewhere (the dresser's decals and signs) to the map, to be freed with it. */
  own<M extends THREE.Material>(m: M): M {
    this.owned.push(m);
    return m;
  }

  /** Door and window frames. */
  frameMat(): THREE.Material {
    return this.flat(0x3a3d40, 0.55, 0.35);
  }

  /** Unlit glowing surface (lamps, screens, status lights). Values above 1 bloom. */
  glow(color: number, strength = 2): THREE.Material {
    strength = Math.round(strength * 10) / 10; // a material (and a draw call) per step, not per lamp
    const key = `glow:${color}:${strength}`;
    let m = this.mats.get(key);
    if (!m) {
      const g = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(strength) });
      g.userData.baseColor = g.color.clone();
      this.bulbs.push(g);
      m = g;
      this.mats.set(key, m);
      this.owned.push(m);
    }
    return m;
  }

  // ---------------------------------------------------------------------------------------------
  // Solids

  /** Axis-aligned box from corner to corner. */
  box(min: V3, max: V3, mat: THREE.Material, opts: { collide?: boolean; tile?: number; shadow?: boolean } = {}): THREE.Box3 {
    const w = max[0] - min[0], h = max[1] - min[1], d = max[2] - min[2];
    if (w <= 0 || h <= 0 || d <= 0) throw new Error(`empty box ${min} ${max}`);
    const g = worldBox(w, h, d, opts.tile ?? 3);
    g.translate(min[0] + w / 2, min[1] + h / 2, min[2] + d / 2);
    const batches = opts.shadow === false ? this.unshadowed : this.batches;
    let list = batches.get(mat);
    if (!list) batches.set(mat, (list = []));
    list.push(g);
    const b = new THREE.Box3(new THREE.Vector3(...min), new THREE.Vector3(...max));
    if (opts.collide !== false) this.colliders.push(b);
    return b;
  }

  /** Floor or roof whose top surface is at `top`. */
  slab(x0: number, z0: number, x1: number, z1: number, top: number, mat: THREE.Material, thick = 0.3): void {
    this.box([x0, top - thick, z0], [x1, top, z1], mat);
  }

  /** A floor with rectangular openings (stairwells, an atrium). */
  floor(rect: Rect, top: number, mat: THREE.Material, holes: Rect[], thick = 0.3): void {
    const [x0, z0, x1, z1] = rect;
    const xs = [...new Set([x0, x1, ...holes.flatMap((h) => [h[0], h[2]])])].filter((x) => x >= x0 && x <= x1).sort((a, c) => a - c);
    const zs = [...new Set([z0, z1, ...holes.flatMap((h) => [h[1], h[3]])])].filter((z) => z >= z0 && z <= z1).sort((a, c) => a - c);
    const open = (x: number, z: number): boolean => holes.some((h) => x > h[0] && x < h[2] && z > h[1] && z < h[3]);
    for (let j = 0; j < zs.length - 1; j++) {
      let start = -1;
      for (let i = 0; i <= xs.length - 1; i++) {
        const solid = i < xs.length - 1 && !open((xs[i] + xs[i + 1]) / 2, (zs[j] + zs[j + 1]) / 2);
        if (solid && start < 0) start = i;
        if (!solid && start >= 0) {
          this.slab(xs[start], zs[j], xs[i], zs[j + 1], top, mat, thick);
          start = -1;
        }
      }
    }
  }

  /**
   * Straight wall between two points on the same x or z, from y0 to y1, with door and window
   * gaps given in world coordinates along the wall.
   */
  wall(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, mat: THREE.Material,
    opts: { t?: number; gaps?: Gap[]; frames?: boolean } = {}): void {
    const t = (opts.t ?? 0.3) / 2;
    const alongX = Math.abs(z1 - z0) < 1e-6;
    if (!alongX && Math.abs(x1 - x0) > 1e-6) throw new Error('walls must be axis-aligned');
    const a = alongX ? Math.min(x0, x1) : Math.min(z0, z1);
    const b = alongX ? Math.max(x0, x1) : Math.max(z0, z1);
    const piece = (from: number, to: number, lo: number, hi: number): void => {
      if (to - from < 0.01 || hi - lo < 0.01) return;
      if (alongX) this.box([from, lo, z0 - t], [to, hi, z0 + t], mat);
      else this.box([x0 - t, lo, from], [x0 + t, hi, to], mat);
    };
    let at = a;
    const trim = (u0: number, u1: number, lo: number, hi: number): void => {
      if (u1 - u0 < 0.01 || hi - lo < 0.01) return;
      const d = t + 0.035;
      if (alongX) this.box([u0, lo, z0 - d], [u1, hi, z0 + d], this.frameMat(), { collide: false, shadow: false });
      else this.box([x0 - d, lo, u0], [x0 + d, hi, u1], this.frameMat(), { collide: false, shadow: false });
    };
    for (const [from, to, sill = 0, top = 2.5] of [...(opts.gaps ?? [])].sort((p, q) => p[0] - q[0])) {
      piece(at, from, y0, y1);
      if (sill > 0) piece(from, to, y0, y0 + sill);
      piece(from, to, Math.min(y1, y0 + top), y1);
      // A frame round the opening, on both faces of the wall (visual only, outside the gap)
      const head = Math.min(y1, y0 + top);
      if (opts.frames !== false && head < y1 - 0.05 && to - from < 6) {
        const yb = y0 + sill;
        trim(from - 0.09, from, yb, head + 0.09);
        trim(to, to + 0.09, yb, head + 0.09);
        trim(from - 0.09, to + 0.09, head, head + 0.09);
        if (sill > 0) trim(from - 0.12, to + 0.12, yb - 0.07, yb);
      }
      at = to;
    }
    piece(at, b, y0, y1);
  }

  /** Four walls and a ceiling. `gaps` are per side: n = -z, s = +z, w = -x, e = +x. */
  room(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, mat: THREE.Material,
    opts: { n?: Gap[]; s?: Gap[]; w?: Gap[]; e?: Gap[]; roof?: THREE.Material | false; t?: number; skip?: string } = {}): void {
    const t = opts.t ?? 0.3;
    const skip = opts.skip ?? '';
    if (!skip.includes('n')) this.wall(x0, z0, x1, z0, y0, y1, mat, { t, gaps: opts.n });
    if (!skip.includes('s')) this.wall(x0, z1, x1, z1, y0, y1, mat, { t, gaps: opts.s });
    if (!skip.includes('w')) this.wall(x0, z0, x0, z1, y0, y1, mat, { t, gaps: opts.w });
    if (!skip.includes('e')) this.wall(x1, z0, x1, z1, y0, y1, mat, { t, gaps: opts.e });
    if (opts.roof !== false) this.slab(x0 - t / 2, z0 - t / 2, x1 + t / 2, z1 + t / 2, y1 + 0.3, opts.roof ?? mat);
  }

  /**
   * Stairs as solid box treads (risers of about 0.25 m, treads of 0.45 m, which both the player
   * and the navmesh climb; steeper stairs drop out of the navmesh). (x, z) is the centre of the bottom edge; they rise in `dir` from y0 to y1 and their
   * top tread is flush with y1. Returns the run length.
   */
  stairs(x: number, z: number, dir: '+x' | '-x' | '+z' | '-z', y0: number, y1: number, width: number, mat: THREE.Material,
    opts: { tread?: number } = {}): number {
    const n = Math.max(1, Math.round((y1 - y0) / 0.25));
    const rise = (y1 - y0) / n;
    const D = opts.tread ?? STAIR_TREAD;
    const sgn = dir[0] === '+' ? 1 : -1;
    const hw = width / 2;
    for (let i = 0; i < n; i++) {
      const a = sgn * i * D, c = sgn * (i + 1) * D;
      const lo = Math.min(a, c), hi = Math.max(a, c);
      const top = y0 + (i + 1) * rise;
      if (dir[1] === 'x') this.box([x + lo, y0, z - hw], [x + hi, top, z + hw], mat);
      else this.box([x - hw, y0, z + lo], [x + hw, top, z + hi], mat);
    }
    return n * D;
  }

  /**
   * Waist-high barrier along an edge: stops a fall. Metal ones are drawn as open railings (posts,
   * a top and a middle rail, a toe board) over the same solid box; others are a low wall.
   */
  rail(x0: number, z0: number, x1: number, z1: number, y: number, mat: THREE.Material, h = 1.05, opts: { open?: boolean } = {}): void {
    const alongX = Math.abs(z1 - z0) < 1e-6;
    const a = alongX ? Math.min(x0, x1) : Math.min(z0, z1);
    const b = alongX ? Math.max(x0, x1) : Math.max(z0, z1);
    if (b - a < 0.05) return;
    const open = opts.open ?? !!mat.userData.metal;
    const lo: V3 = alongX ? [a, y, z0 - 0.05] : [x0 - 0.05, y, a];
    const hi: V3 = alongX ? [b, y + h, z0 + 0.05] : [x0 + 0.05, y + h, b];
    if (!open) {
      this.box(lo, hi, mat);
      return;
    }
    // The collider: the same box as a solid rail, never drawn
    this.colliders.push(new THREE.Box3(new THREE.Vector3(...lo), new THREE.Vector3(...hi)));
    const seg = (u0: number, u1: number, y0: number, y1: number, half: number): void => {
      if (alongX) this.box([u0, y0, z0 - half], [u1, y1, z0 + half], mat, { collide: false });
      else this.box([x0 - half, y0, u0], [x0 + half, y1, u1], mat, { collide: false });
    };
    seg(a, b, y + h - 0.05, y + h, 0.03); // top rail
    seg(a, b, y + h * 0.5 - 0.02, y + h * 0.5 + 0.02, 0.02); // middle rail
    seg(a, b, y, y + 0.1, 0.008); // toe board
    const n = Math.max(1, Math.round((b - a) / 1.3));
    for (let i = 0; i <= n; i++) {
      const u = Math.min(b - 0.025, Math.max(a + 0.025, a + ((b - a) * i) / n));
      seg(u - 0.025, u + 0.025, y, y + h - 0.05, 0.025);
    }
  }

  /** 20 ft shipping container standing on `y`. */
  container(x: number, z: number, y: number, alongX: boolean, mat: THREE.Material): void {
    const hl = 3.05, hw = 1.22, H = 2.6;
    // Local (u along the length, v across) to world
    const put = (u0: number, u1: number, v0: number, v1: number, y0: number, y1: number, m: THREE.Material, big = false): void => {
      if (alongX) this.box([x + u0, y + y0, z + v0], [x + u1, y + y1, z + v1], m, { tile: 2, collide: false, shadow: big });
      else this.box([x + v0, y + y0, z + u0], [x + v1, y + y1, z + u1], m, { tile: 2, collide: false, shadow: big });
    };
    // Body, a little inside the frame, then the frame: corner posts, top and bottom rails
    put(-hl + 0.04, hl - 0.04, -hw + 0.03, hw - 0.03, 0.12, H - 0.08, mat, true);
    // The collider is the whole box, as before, so stacks and anything standing on top still work
    this.colliders.push(alongX
      ? new THREE.Box3(new THREE.Vector3(x - hl, y, z - hw), new THREE.Vector3(x + hl, y + H, z + hw))
      : new THREE.Box3(new THREE.Vector3(x - hw, y, z - hl), new THREE.Vector3(x + hw, y + H, z + hl)));
    const frame = mat;
    for (const su of [-1, 1]) {
      for (const sv of [-1, 1]) put(su > 0 ? hl - 0.16 : -hl, su > 0 ? hl : -hl + 0.16, sv > 0 ? hw - 0.16 : -hw, sv > 0 ? hw : -hw + 0.16, 0, H, frame, true);
    }
    for (const sv of [-1, 1]) {
      put(-hl, hl, sv > 0 ? hw - 0.12 : -hw, sv > 0 ? hw : -hw + 0.12, 0, 0.16, frame);
      put(-hl, hl, sv > 0 ? hw - 0.1 : -hw, sv > 0 ? hw : -hw + 0.1, H - 0.1, H, frame);
    }
    // Corrugation on the long sides and the roof
    for (let u = -hl + 0.35; u < hl - 0.3; u += 0.28) {
      for (const sv of [-1, 1]) put(u - 0.07, u + 0.07, sv > 0 ? hw - 0.03 : -hw, sv > 0 ? hw : -hw + 0.03, 0.16, H - 0.1, mat);
    }
    // Doors on the +u end: the seam, four locking bars with their handles
    const dark = this.flat(0x2a2c2e, 0.5, 0.5);
    put(hl - 0.04, hl - 0.005, -0.012, 0.012, 0.16, H - 0.1, dark);
    for (const v of [-0.85, -0.3, 0.3, 0.85]) {
      put(hl - 0.005, hl + 0.03, v - 0.025, v + 0.025, 0.14, H - 0.08, dark);
      put(hl - 0.005, hl + 0.05, v - 0.02, v + 0.09, 1.05, 1.12, dark);
    }
  }

  /** Round-ish column. */
  column(x: number, z: number, y0: number, y1: number, size: number, mat: THREE.Material): void {
    this.box([x - size / 2, y0, z - size / 2], [x + size / 2, y1, z + size / 2], mat);
  }

  /** Light fitting. `power` > 0 also adds a real point light (keep those under about ten per map). */
  lamp(x: number, y: number, z: number, opts: { color?: number; power?: number; range?: number; size?: number; flicker?: number } = {}): void {
    const color = opts.color ?? 0xffc98a;
    const s = (opts.size ?? 0.3) / 2;
    this.box([x - s, y - 0.06, z - s], [x + s, y, z + s], this.glow(color, 2.6), { collide: false });
    if (opts.power) {
      // `power` is roughly the lux a surface gets 7 m under the lamp, times 50
      const l = new THREE.PointLight(color, opts.power * 2.4, (opts.range ?? 22) * 1.4, 2);
      l.position.set(x, y - 0.25, z);
      this.root.add(l);
      this.lights.push({ light: l, base: opts.power * 2.4, flicker: opts.flicker ?? 0 });
    }
  }

  /**
   * A Poly Haven prop standing at (x, y, z). `tilt` leans it (x, z radians) and `lift` raises it
   * off its base, for things mounted on walls or knocked over. Returns its world box.
   */
  prop(id: PropId, x: number, y: number, z: number, rotY = 0,
    opts: { scale?: number; collide?: boolean; tilt?: [number, number] } = {}): THREE.Box3 {
    const m = this.propMatrix(x, y, z, rotY, opts.scale ?? 1, opts.tilt);
    let list = this.placed.get(id);
    if (!list) this.placed.set(id, (list = []));
    list.push(m);
    const box = this.protoBox(id).clone().applyMatrix4(m);
    if (opts.collide !== false) this.colliders.push(box);
    return box;
  }

  /** Where a prop would be, without placing it. */
  propBox(id: PropId, x: number, y: number, z: number, rotY = 0, scale = 1): THREE.Box3 {
    return this.protoBox(id).clone().applyMatrix4(this.propMatrix(x, y, z, rotY, scale));
  }

  /** Size of a prop as modelled (metres). */
  propSize(id: PropId): THREE.Vector3 {
    return this.protoBox(id).getSize(new THREE.Vector3());
  }

  private propMatrix(x: number, y: number, z: number, rotY: number, scale: number, tilt?: [number, number]): THREE.Matrix4 {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt?.[0] ?? 0, rotY, tilt?.[1] ?? 0, 'YXZ'));
    return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(scale, scale, scale));
  }

  /** Any static, non-solid geometry in world space (merged with the rest of its material). */
  geo(g: THREE.BufferGeometry, mat: THREE.Material): void {
    let list = this.extra.get(mat);
    if (!list) this.extra.set(mat, (list = []));
    // Everything here is merged non-indexed with position, normal and uv
    if (g.index) g = g.toNonIndexed();
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    list.push(g);
  }

  /** True if a solid already occupies any of `box` (ignoring anything it merely stands on). */
  blocked(box: THREE.Box3, skin = 0.02): boolean {
    const t = box.clone().expandByScalar(-skin);
    return this.colliders.some((c) => c.intersectsBox(t));
  }

  /** Height of the highest solid surface under (x, z) at or below `y` (0 is the ground). */
  floorAt(x: number, z: number, y: number): number {
    let top = 0;
    for (const c of this.colliders) {
      if (x > c.min.x && x < c.max.x && z > c.min.z && z < c.max.z && c.max.y <= y + 0.05 && c.max.y > top) top = c.max.y;
    }
    return top;
  }

  /** Stack of military crates (about 0.63 m per layer). */
  crates(x: number, y: number, z: number, layers: number, rot = 0): void {
    for (let i = 0; i < layers; i++) this.prop('wooden_military_crate', x, y + i * 0.465 * 1.35, z, rot + (i % 2) * 0.08, { scale: 1.35 });
  }

  /** A door or shutter that can be opened and closed at runtime. */
  door(id: string, min: V3, max: V3, mat: THREE.Material, open = false): void {
    const w = max[0] - min[0], h = max[1] - min[1], d = max[2] - min[2];
    const mesh = new THREE.Mesh(worldBox(w, h, d, 2), mat);
    mesh.position.set(min[0] + w / 2, min[1] + h / 2, min[2] + d / 2);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.visible = !open;
    this.root.add(mesh);
    const box = new THREE.Box3(new THREE.Vector3(...min), new THREE.Vector3(...max));
    if (!open) this.colliders.push(box);
    this.doors.set(id, { id, mesh, box, open });
  }

  /** Pane of glass: seen, not solid (bullets and sight pass through it). */
  glass(min: V3, max: V3, color = 0x9fc4d8, opacity = 0.22): void {
    const key = `glass:${color}:${opacity}`;
    let m = this.mats.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color, roughness: 0.05, metalness: 0, transparent: true, opacity, depthWrite: false });
      this.mats.set(key, m);
      this.owned.push(m);
    }
    const w = max[0] - min[0], h = max[1] - min[1], d = max[2] - min[2];
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(min[0] + w / 2, min[1] + h / 2, min[2] + d / 2);
    mesh.userData.noAO = true;
    this.root.add(mesh);
  }

  /** A sheet of water over a rectangle (sea, flooded basin). */
  water(rect: Rect, level: number, color = 0x0a1519): Water {
    const [x0, z0, x1, z1] = rect;
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.07, metalness: 0, transparent: true, opacity: 0.88 });
    this.owned.push(mat);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set((x0 + x1) / 2, level, (z0 + z1) / 2);
    mesh.receiveShadow = true;
    mesh.userData.noAO = true;
    mesh.visible = level > 0.02;
    this.root.add(mesh);
    const w: Water = { mesh, rect, level };
    this.waters.push(w);
    return w;
  }

  /** Flat ground at y = 0 (visual only: the engine's ground plane is the collider). */
  ground(rect: Rect, mat: THREE.Material, tile = 4): void {
    const [x0, z0, x1, z1] = rect;
    const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * (x1 - x0)) / tile, (uv.getY(i) * (z1 - z0)) / tile);
    g.rotateX(-Math.PI / 2);
    g.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
    const mesh = new THREE.Mesh(g, mat);
    mesh.receiveShadow = true;
    this.root.add(mesh);
  }

  // ---------------------------------------------------------------------------------------------

  /** Merge the boxes, set up sky, sun, fog, lamps and weather, and add everything to the scene. */
  async finish(scene: THREE.Scene, gl: THREE.WebGLRenderer, env: EnvSpec, bounds: THREE.Box3): Promise<BuiltLevel> {
    const q = this.q;
    const root = this.root;
    root.name = 'map';
    for (const [batches, shadow] of [[this.batches, true], [this.unshadowed, false]] as const) {
      for (const [mat, geos] of batches) {
        const merged = mergeGeometries(geos, false);
        for (const g of geos) g.dispose();
        const mesh = new THREE.Mesh(merged, mat);
        const lit = !(mat as THREE.MeshBasicMaterial).isMeshBasicMaterial;
        mesh.castShadow = lit && shadow;
        mesh.receiveShadow = lit;
        if (!lit) mesh.userData.noAO = true;
        mesh.matrixAutoUpdate = false;
        root.add(mesh);
      }
      batches.clear();
    }
    for (const [mat, geos] of this.extra) {
      const merged = mergeGeometries(geos.map((g) => {
        const n = g.clone();
        for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(k)) n.deleteAttribute(k);
        return n;
      }), false);
      for (const g of geos) g.dispose();
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      const lit = !(mat as THREE.MeshBasicMaterial).isMeshBasicMaterial && !mat.transparent;
      mesh.castShadow = lit;
      mesh.receiveShadow = !(mat as THREE.MeshBasicMaterial).isMeshBasicMaterial;
      if (!lit) mesh.userData.noAO = true;
      if (mat.transparent) mesh.renderOrder = 2;
      root.add(mesh);
    }
    this.extra.clear();
    // Props: loaded now, only the ones this map placed (see props.ts)
    const props = await buildProps(this.placed, q.shadows && env.sunIntensity > 0);
    root.add(props.root);
    this.placed.clear();

    const sunDir = new THREE.Vector3(...env.sunDir).normalize();
    const sunColor = new THREE.Color(env.sunColor);
    installSunFog(sunDir, new THREE.Color(env.fogSun));
    const sky = makeSky(sunDir, true, env.sky);
    root.add(sky);
    const envSky = makeSky(sunDir, false, env.sky);
    const envScene = new THREE.Scene();
    envScene.add(envSky);
    const pmrem = new THREE.PMREMGenerator(gl);
    const envTarget = pmrem.fromScene(envScene, 0, 0.1, 1000);
    pmrem.dispose();
    envSky.material.dispose();
    envSky.geometry.dispose();

    scene.background = null;
    scene.environment = envTarget.texture;
    scene.environmentIntensity = env.envIntensity;
    scene.fog = new THREE.FogExp2(env.fog[0], env.fog[1]);

    // Sun (or moon): one shadow box fitted around the whole map as seen from the light
    const sun = new THREE.DirectionalLight(sunColor, env.sunIntensity);
    const center = bounds.getCenter(new THREE.Vector3());
    const radius = bounds.getSize(new THREE.Vector3()).length() / 2;
    sun.position.copy(center).addScaledVector(sunDir, radius * 1.6);
    sun.target.position.copy(center);
    sun.castShadow = q.shadows && env.sunIntensity > 0;
    sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
    sun.shadow.camera.layers.enable(SHADOW_LAYER); // the props' coarse shadow casters
    const view = new THREE.Matrix4().lookAt(sun.position, center, UP).invert();
    const lo = new THREE.Vector3(Infinity, Infinity, Infinity), hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    const c = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      c.set(i & 1 ? bounds.max.x : bounds.min.x, i & 2 ? bounds.max.y : bounds.min.y, i & 4 ? bounds.max.z : bounds.min.z)
        .sub(sun.position).applyMatrix4(view);
      lo.min(c);
      hi.max(c);
    }
    const sc = sun.shadow.camera;
    sc.left = lo.x - 1;
    sc.right = hi.x + 1;
    sc.bottom = lo.y - 1;
    sc.top = hi.y + 1;
    sc.near = Math.max(0.5, -hi.z - 2);
    sc.far = -lo.z + 2;
    sc.updateProjectionMatrix();
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.06;
    sun.shadow.radius = q.softShadows ? 2.5 : 1;
    const hemi = new THREE.HemisphereLight(env.hemi[0], env.hemi[1], env.hemi[2]);
    root.add(sun, sun.target, hemi);

    // Rain: streaks in a box that follows the camera, wrapped so it never runs out
    let rain: THREE.LineSegments<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null;
    if (env.rain > 0) {
      const n = Math.round(2600 * env.rain);
      const seed = new Float32Array(n * 2 * 3);
      const end = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) {
        const r = [Math.random(), Math.random(), Math.random()];
        seed.set(r, i * 6);
        seed.set(r, i * 6 + 3);
        end[i * 2 + 1] = 1;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(seed, 3));
      g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
      rain = new THREE.LineSegments(g, new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 }, uAmount: { value: 1 }, uFlash: { value: 0 },
          uWind: { value: new THREE.Vector2(2.5 + env.wind * 7, 1 + env.wind * 3) },
        },
        vertexShader: /* glsl */ `
          attribute float aEnd;
          uniform float uTime;
          uniform vec2 uWind;
          varying float vFade;
          void main() {
            const vec3 B = vec3(26.0, 18.0, 26.0);
            vec3 fall = vec3(uWind.x, -19.0, uWind.y);
            vec3 p = position * B + fall * uTime * (0.8 + 0.4 * position.x);
            p = mod(p - cameraPosition, B) - B * 0.5 + cameraPosition;
            p += normalize(fall) * aEnd * 0.38;
            vec4 mv = viewMatrix * vec4(p, 1.0);
            vFade = smoothstep(13.0, 7.0, length(mv.xyz)) * smoothstep(0.4, 1.6, length(mv.xyz));
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          uniform float uAmount, uFlash;
          varying float vFade;
          void main() {
            gl_FragColor = vec4(vec3(0.42, 0.48, 0.58) * (1.0 + uFlash * 3.0), vFade * uAmount * 0.2);
          }`,
        transparent: true, depthWrite: false, fog: false,
      }));
      rain.frustumCulled = false;
      rain.userData.noAO = true;
      rain.renderOrder = 5;
      root.add(rain);
    }

    scene.add(root);

    const colliders = this.colliders;
    const doors = this.doors;
    const lights = this.lights;
    const bulbs = this.bulbs;
    const owned = this.owned;
    let power = true;
    let daylight = 1;
    let time = 0;
    let coverT = 0;
    let rainCover = 1;
    let nextStrike = 8 + Math.random() * 14;
    let strikeT = Infinity;
    let thunderIn = Infinity;

    const level: BuiltLevel = {
      root, colliders, sun, sunDir, sunColor, envMap: envTarget.texture, env, doors, waters: this.waters, flash: 0,
      setPower(on) {
        power = on;
        for (const b of bulbs) b.color.copy(b.userData.baseColor as THREE.Color).multiplyScalar(on ? 1 : 0.02);
      },
      setDaylight(f) {
        daylight = f;
        scene.environmentIntensity = env.envIntensity * f;
      },
      setDoor(id, open) {
        const d = doors.get(id);
        if (!d || d.open === open) return false;
        d.open = open;
        d.mesh.visible = !open;
        const i = colliders.indexOf(d.box);
        if (open && i >= 0) colliders.splice(i, 1);
        if (!open && i < 0) colliders.push(d.box);
        collidersChanged(colliders);
        return true;
      },
      update(dt, viewer, audio) {
        time += dt;
        sky.material.uniforms.uTime.value += dt;
        sky.position.copy(viewer);
        props.update(viewer);
        for (const l of lights) {
          const f = l.flicker > 0 && Math.sin(time * 31 + l.light.position.x) * Math.sin(time * 7.3 + l.light.position.z) > 1 - l.flicker ? 0.25 : 1;
          l.light.intensity = power ? l.base * f : 0;
        }
        // Lightning: two quick strokes, thunder after the light
        if (env.lightning) {
          nextStrike -= dt;
          if (nextStrike <= 0) {
            nextStrike = 14 + Math.random() * 26;
            strikeT = 0;
            thunderIn = 0.4 + Math.random() * 2.2;
          }
          strikeT += dt;
          const s = strikeT;
          level.flash = s < 0.08 ? 1 : s < 0.16 ? 0.15 : s < 0.26 ? 0.8 : Math.max(0, 0.5 - (s - 0.26) * 1.6);
          thunderIn -= dt;
          if (thunderIn <= 0) {
            thunderIn = Infinity;
            audio?.thunder();
          }
        }
        hemi.intensity = env.hemi[2] * daylight * (1 + level.flash * 9);
        sun.intensity = env.sunIntensity * daylight * (1 + level.flash * 4);
        sky.material.uniforms.uFlash.value = level.flash;
        if (rain) {
          // No rain indoors: fade it out under a roof
          coverT -= dt;
          if (coverT <= 0) {
            coverT = 0.2;
            rainCover = raycastBoxes(viewer, UP, 40, colliders) ? 0 : 1;
          }
          const u = rain.material.uniforms;
          u.uAmount.value = THREE.MathUtils.damp(u.uAmount.value, rainCover, 5, dt);
          u.uTime.value = time;
          u.uFlash.value = level.flash;
          audio?.setRain(env.rain * (0.35 + 0.65 * u.uAmount.value));
        }
      },
      dispose() {
        scene.remove(root);
        root.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh && m.geometry && !(m.geometry as THREE.BufferGeometry).userData.shared) m.geometry.dispose();
        });
        for (const m of owned) {
          releaseTextures(m);
          m.dispose();
        }
        props.dispose();
        sky.material.dispose();
        rain?.material.dispose();
        envTarget.dispose();
      },
    };
    return level;
  }
}
