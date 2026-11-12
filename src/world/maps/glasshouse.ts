import * as THREE from 'three';
import type { QualityPreset } from '../../core/settings';
import { ENV, LevelBuilder, stairRun, type PropId, type Rect, type V3 } from '../level';
import { Dresser, type Face } from '../dress';
import { worldFromLevel, type WorldMap } from '../map';

/**
 * M3 Glasshouse: the lower floors of the Aldane Trust tower, 80 x 60 m, by overcast daylight.
 *
 *   y = 0    parking and the data vault
 *   y = 5    lobby, cafe wing (west), security wing (east); the plaza outside
 *   y = 10   mezzanine gallery around the atrium
 *   y = 15   offices, boardroom, the glass bridge over the atrium
 *
 * Every level looks into a 16 m atrium, so a fight in the lobby is seen from three floors.
 * Raiders can come in through the lobby front, the cafe door, the staff door and the dock stairs
 * into the parking; three shutters (cafe, staff, dock) can close two of those.
 */

const L = 5;
const M = 10;
const O = 15;
const TOP = 20;

export const GLASSHOUSE = {
  spawn: [0, L, 15] as V3,
  panel: { dock: [17.2, L + 1.3, 21.5] as V3, staff: [19.2, L + 1.3, 21.5] as V3, cafe: [21.2, L + 1.3, 21.5] as V3 },
  vault: [-22, 1.2, -21.3] as V3,
  vaultHold: [-22, 0, -16] as V3,
  boardroom: [0, O, -16] as V3,
  lobby: [0, L, 8] as V3,
  entries: {
    lobby: [[-3, L, 26], [3, L, 26], [0, L, 28], [-6, L, 27], [6, L, 27]] as V3[],
    cafe: [[-27, L, 11], [-26, L, 14], [-27.5, L, 8], [-25, L, 11]] as V3[],
    staff: [[27, L, 11], [26, L, 14], [27.5, L, 8], [25, L, 11]] as V3[],
    dock: [[31.6, 0, -20.6], [27, 0, -20], [26, 0, -17], [24, 0, -20]] as V3[],
  },
};

export async function buildGlasshouse(scene: THREE.Scene, q: QualityPreset, gl: THREE.WebGLRenderer): Promise<WorldMap> {
  const b = await LevelBuilder.create(q, ['marble', 'plaster', 'painted', 'concrete', 'floor', 'steel']);
  const marble = b.tint('marble', 0xd8d4cc, 0.35);
  const tiles = b.tint('painted', 0xc9ccce);
  const wallMat = b.tint('plaster', 0xdcdad4);
  const dark = b.flat(0x23272c, 0.5, 0.3);
  const wood = b.flat(0x5e4630, 0.6);
  const steel = b.tint('steel', 0x8a9096);
  const glassRail = b.flat(0x9fb9c4, 0.2, 0.1);
  const paving = b.tint('floor', 0xb7b4ae);
  const parking = b.tint('concrete', 0x8c8f90);
  const green = b.flat(0x3f6b3a, 0.9);

  // --- Plaza around the tower (solid up to lobby level), with the dock stair trench in the east
  b.box([-40, 0, 22], [40, L, 30], paving, { tile: 4 });
  b.box([-40, 0, -30], [-30, L, 22], paving, { tile: 4 });
  b.box([-30, 0, -30], [30, L, -22], paving, { tile: 4 });
  b.box([33, 0, -30], [40, L, 22], paving, { tile: 4 });
  b.box([30, 0, -30], [33, L, -21.5], paving, { tile: 4 });
  const dockRun = stairRun(0, L);
  b.box([30, 0, -19.5 + dockRun], [33, L, 22], paving, { tile: 4 });
  b.stairs(31.6, -19.5, '+z', 0, L, 2.8, parking);
  b.rail(33, -21.5, 33, -19.5 + dockRun, L, steel, 1.0);
  b.rail(30.2, -21.5, 33, -21.5, L, steel, 1.0);
  b.ground([-30, -22, 33, 22], parking);

  // --- Shell: walls from parking floor to roof
  b.wall(-30, 22, 30, 22, 0, TOP, wallMat, {
    t: 0.4,
    gaps: [[-28, -14, L + 1.5, L + 4], [-12, -6.4, L + 1.5, TOP - 1], [-6, 6, L, L + 3.4], [6.4, 12, L + 1.5, TOP - 1], [14, 28, O + 1.5, O + 4]],
  });
  b.wall(-30, -22, 30, -22, 0, TOP, wallMat, { t: 0.4, gaps: [[-10, 10, O + 1.5, O + 3.8], [-26, -14, M + 1.5, M + 3.8], [14, 26, M + 1.5, M + 3.8]] });
  b.wall(-30, -22, -30, 22, 0, TOP, wallMat, { t: 0.4, gaps: [[10, 12, L, L + 2.6], [-18, -10, O + 1.5, O + 3.8]] });
  b.wall(30, -22, 30, 22, 0, TOP, wallMat, { t: 0.4, gaps: [[-21.3, -19.7, 0, 2.6], [10, 12, L, L + 2.6], [-18, -10, O + 1.5, O + 3.8]] });
  b.glass([-12, L + 1.5, 21.95], [-6.4, TOP - 1, 22.05]);
  b.glass([6.4, L + 1.5, 21.95], [12, TOP - 1, 22.05]);
  b.glass([-10, O + 1.5, -22.05], [10, O + 3.8, -21.95]);
  // The three shutters (open until the lockdown)
  b.door('cafe', [-30.15, L, 10], [-29.85, L + 2.6, 12], steel, true);
  b.door('staff', [29.85, L, 10], [30.15, L + 2.6, 12], steel, true);
  b.door('dock', [29.85, 0, -21.3], [30.15, 2.6, -19.7], steel, true);

  // --- Floors with the atrium void and the two stair cores
  const inner: Rect = [-29.8, -21.8, 29.8, 21.8];
  const atrium: Rect = [-8, -8, 8, 8];
  const run = stairRun(0, L);
  const half = run / 2;
  // Stair cores: lane 1 against the outer wall, lane 2 inside it
  const lane = (side: number, n: 1 | 2): [number, number] => {
    const a = n === 1 ? 29.4 : 27, c = n === 1 ? 27 : 24.6;
    return side < 0 ? [-a, -c] : [c, a];
  };
  const hole = (side: number, n: 1 | 2): Rect => [lane(side, n)[0], -half, lane(side, n)[1], half];
  b.floor(inner, L, marble, [hole(-1, 1), hole(1, 1)], 0.35);
  b.floor(inner, M, tiles, [atrium, hole(-1, 2), hole(1, 2)], 0.35);
  b.floor(inner, O, tiles, [atrium, hole(-1, 1), hole(1, 1)], 0.35);
  b.floor([-30.2, -22.2, 30.2, 22.2], TOP + 0.4, b.tint('concrete', 0x9a9c9e), [atrium], 0.4);
  b.glass([-8, TOP + 0.1, -8], [8, TOP + 0.2, 8], 0xbfd6e0, 0.18);
  for (const side of [-1, 1]) {
    const c1 = (lane(side, 1)[0] + lane(side, 1)[1]) / 2, c2 = (lane(side, 2)[0] + lane(side, 2)[1]) / 2;
    b.stairs(c1, -half, '+z', 0, L, 2.4, parking);
    b.stairs(c2, half, '-z', L, M, 2.4, steel);
    b.stairs(c1, -half, '+z', M, O, 2.4, steel);
    // Rails round the openings on the inner side
    const edge = side < 0 ? lane(side, 2)[1] : lane(side, 2)[0];
    const mid = side < 0 ? lane(side, 1)[1] : lane(side, 1)[0];
    b.rail(mid, -half, mid, half, L, glassRail, 1.0);
    b.rail(edge, -half, edge, half, M, glassRail, 1.0);
    b.rail(mid, -half, mid, half, O, glassRail, 1.0);
    // ...and across the end of each opening that is not where a flight arrives
    b.rail(lane(side, 1)[0], -half, lane(side, 1)[1], -half, L, glassRail, 1.0);
    b.rail(lane(side, 2)[0], half, lane(side, 2)[1], half, M, glassRail, 1.0);
    b.rail(lane(side, 1)[0], -half, lane(side, 1)[1], -half, O, glassRail, 1.0);
  }
  // Atrium rails on the mezzanine and the office floor; the glass bridge crosses at O
  for (const y of [M, O]) {
    b.rail(-8, -8, 8, -8, y, glassRail, 1.05);
    b.rail(-8, 8, 8, 8, y, glassRail, 1.05);
    if (y === M) {
      b.rail(-8, -8, -8, 8, y, glassRail, 1.05);
      b.rail(8, -8, 8, 8, y, glassRail, 1.05);
    } else {
      for (const x of [-8, 8]) {
        b.rail(x, -8, x, -1.3, y, glassRail, 1.05);
        b.rail(x, 1.3, x, 8, y, glassRail, 1.05);
      }
    }
  }
  b.slab(-8, -1.3, 8, 1.3, O, b.flat(0x9fc0cc, 0.15, 0.2), 0.2);
  b.rail(-8, -1.3, 8, -1.3, O, glassRail, 1.0);
  b.rail(-8, 1.3, 8, 1.3, O, glassRail, 1.0);

  // --- Parking and the vault (P)
  for (const x of [-18, -6, 6, 18]) for (const z of [-12, 0, 12]) {
    if (x === -18 && z === -12) continue;
    b.column(x, z, 0, L - 0.35, 0.8, parking);
  }
  b.room(-29.8, -21.8, -14, -10, 0, L - 0.35, b.tint('concrete', 0x6f7478), {
    roof: false, t: 0.5, skip: 'nw', e: [[-17, -15, 0, 2.4]], s: [[-24, -22, 0, 2.4]],
  });
  b.box([-24.5, 0, -21.6], [-19.5, 1.1, -20.9], dark); // transfer terminal
  b.box([-24.2, 1.1, -21.5], [-19.8, 2.3, -21.4], b.glow(0x6fd6ff, 0.6), { collide: false });
  b.box([-29, 0, -20], [-27.5, 2.2, -12], dark); // server racks
  b.box([-17.5, 0, -21], [-16, 2.2, -19], dark);
  const cars: [number, number, number][] = [[-12, 14, 0], [-2, 16, 0.05], [10, 15, -0.05], [20, 4, 1.57], [20, -8, 1.6], [0, -14, 0.03], [10, -16, 0], [-8, -4, 1.55], [-24, 4, 1.57]];
  cars.forEach(([x, z, r]) => b.prop('covered_car', x, 0, z, r));
  b.prop('concrete_road_barrier', -12, 0, -15, Math.PI / 2);
  b.prop('concrete_road_barrier', -12, 0, -17.5, Math.PI / 2);
  b.crates(-20, 0, -7, 2);
  b.crates(24, 0, -14, 2, 0.3);

  // --- Lobby (L)
  b.box([-4, L, -12.6], [4, L + 1.1, -11.4], wood); // reception desk
  b.box([-4, L, -12.6], [-3.2, L + 1.1, -10], wood);
  b.box([3.2, L, -12.6], [4, L + 1.1, -10], wood);
  for (const [x, z] of [[-9, 16], [9, 16], [-9, 4], [9, 4], [-4, 11], [4, 11]] as const) {
    b.box([x - 1.1, L, z - 0.5], [x + 1.1, L + 0.9, z + 0.5], dark);
    b.box([x - 1, L + 0.9, z - 0.4], [x + 1, L + 1.35, z + 0.4], green, { collide: false });
  }
  for (const [x, z] of [[-14, -6], [14, -6], [-14, -15], [14, -15]] as const) b.box([x - 1.4, L, z - 0.4], [x + 1.4, L + 0.5, z + 0.4], wood);
  for (const x of [-12, 12]) for (const z of [-12, 12]) b.column(x, z, L, M - 0.35, 0.7, marble);
  // Cafe wing: counter and tables
  b.wall(-12, 0, -12, 21.8, L, M - 0.35, wallMat, { t: 0.25, gaps: [[4, 8, 0, 2.6], [14, 18, 0, 2.6]] });
  b.box([-28, L, 2], [-20, L + 1.1, 3], wood);
  for (const [x, z] of [[-24, 8], [-18, 12], [-24, 17], [-17, 18]] as const) b.box([x - 0.7, L, z - 0.7], [x + 0.7, L + 0.8, z + 0.7], wood);
  // Security wing: the office with the lockdown panel
  b.wall(12, 0, 12, 21.8, L, M - 0.35, wallMat, { t: 0.25, gaps: [[4, 8, 0, 2.6]] });
  b.wall(14, 14, 29.8, 14, L, M - 0.35, wallMat, { t: 0.25, gaps: [[24, 26, 0, 2.4]] });
  b.wall(14, 14, 14, 21.8, L, M - 0.35, wallMat, { t: 0.25 });
  b.box([16, L, 21.2], [22.4, L + 1.0, 21.7], dark);
  (['dock', 'staff', 'cafe'] as const).forEach((k) => {
    const p = GLASSHOUSE.panel[k];
    b.box([p[0] - 0.5, L + 1.0, 21.45], [p[0] + 0.5, L + 1.7, 21.55], b.glow(0xff8a3c, 0.9), { collide: false });
  });
  b.box([15, L, 15], [16, L + 1.9, 19], dark);
  b.crates(26, L, 4, 2);

  // --- Mezzanine (M): open gallery, a few display cases for cover
  for (const [x, z] of [[-16, -14], [16, -14], [-16, 14], [16, 14], [0, -14], [0, 14]] as const) b.box([x - 1.2, M, z - 0.5], [x + 1.2, M + 1.2, z + 0.5], dark);
  for (const x of [-12, 12]) for (const z of [-12, 12]) b.column(x, z, M, O - 0.35, 0.7, marble);

  // --- Offices and boardroom (O)
  b.room(-12, -21.8, 12, -10, O, TOP, wallMat, { roof: false, t: 0.25, skip: 'n', s: [[-1.5, 1.5, 0, 2.5]] });
  b.box([-5, O, -17.5], [5, O + 0.8, -14.5], wood); // boardroom table
  b.box([-6, O + 1.2, -21.7], [6, O + 3.4, -21.6], b.glow(0x9fd0ff, 0.5), { collide: false }); // wall screen... behind glass
  for (const side of [-1, 1]) {
    for (const z of [12, 16, 20]) b.box([side * 14 - 2.2, O, z - 0.5], [side * 14 + 2.2, O + 0.8, z + 0.5], wood); // desk rows
    b.wall(side * 12, 10, side * 12, 21.8, O, O + 2.2, glassRail, { t: 0.1, gaps: [[13, 15, 0, 2.2]] });
  }
  for (const x of [-12, 12]) for (const z of [-12, 12]) b.column(x, z, O, TOP, 0.7, marble);

  // --- Plaza: planters and barriers outside the entrance
  b.prop('concrete_road_barrier', -9, L, 25.5, 0);
  b.prop('concrete_road_barrier', 9, L, 25.5, 0);
  b.box([-20, L, 25], [-14, L + 0.9, 27], dark);
  b.box([14, L, 25], [20, L + 0.9, 27], dark);
  b.box([-40, L, 29.6], [40, L + 3, 30], wallMat);
  b.box([-40, L, -30], [40, L + 3, -29.6], wallMat);
  b.box([-40, L, -30], [-39.6, L + 3, 30], wallMat);
  b.box([39.6, L, -30], [40, L + 3, 30], wallMat);

  // --- Light: cool daylight through the glass, fluorescent strips in the parking
  for (const [x, z] of [[-18, 6], [6, 6], [18, -6], [-6, -6], [-22, -16]] as const) b.lamp(x, L - 0.4, z, { color: 0xd6ffe6, power: 55, range: 18, size: 0.9, flicker: z === 6 ? 0.03 : 0 });
  b.lamp(-20, M - 0.4, 10, { color: 0xffe2bd, power: 45, range: 16, size: 0.6 });
  b.lamp(20, M - 0.4, 10, { color: 0xffe2bd, power: 45, range: 16, size: 0.6 });
  b.lamp(0, M - 0.4, -15, { color: 0xffffff, power: 45, range: 16, size: 0.6 });
  b.lamp(0, TOP - 0.1, -16, { color: 0xffffff, power: 40, range: 14, size: 0.6 });
  for (const [x, z] of [[-20, -14], [20, -14], [-20, 14], [20, 14]] as const) {
    b.lamp(x, O - 0.4, z, { color: 0xffffff, size: 0.8 });
    b.lamp(x, TOP - 0.05, z, { color: 0xffffff, size: 0.8 });
  }

  const bounds = new THREE.Box3(new THREE.Vector3(-40, 0, -30), new THREE.Vector3(40, 22, 30));
  dress(new Dresser(b, 303), bounds);
  const level = await b.finish(scene, gl, ENV.overcast, bounds);
  return worldFromLevel('glasshouse', level, {
    bounds,
    spawn: GLASSHOUSE.spawn,
    spawnYaw: 0,
    navGround: [[-30, -22, 33, 22]],
    menuCam: { center: [0, 8, 4], radius: 46, height: 26 },
  });
}

/** A small palette, so the merged boxes share a handful of materials. */
const BASE = {
  ceiling: 0xdedcd6, steel: 0x9aa1a7, darkSteel: 0x3a3f44, black: 0x1b1e21, stone: 0xe6e2da, wood: 0x5e4630,
  woodLight: 0x9a7650, darkWood: 0x3a2a1e, fabric: 0x6c7782, carpet: 0x434b54, carpetRed: 0x4e2f2c, red: 0xa8302a,
  yellow: 0xd2a82a, navy: 0x1f2c44, green: 0x2f6a3a, blue: 0x3d5866, pale: 0xbfd6e0,
};
/** The base paints plus names for the things that share one. */
const C = {
  ...BASE, panelRim: BASE.steel, skirting: BASE.darkSteel, white: BASE.stone, paper: BASE.ceiling, soil: BASE.darkWood,
  plan: BASE.pale, water: BASE.blue, rope: BASE.woodLight, grey: BASE.fabric, light: BASE.ceiling,
};
const PALETTE = Object.values(BASE);
const METAL = new Set([C.steel, C.darkSteel]);
const GLOSS = new Set([C.stone, C.pale, C.black]);

/**
 * Paint for the dressing: snapped to the nearest palette colour and to two finishes, so hundreds of
 * little boxes merge into a few dozen meshes instead of one per odd colour.
 */
function tone(b: LevelBuilder, color: number, rough = 0.8, metal = 0): THREE.Material {
  const rgb = (c: number): [number, number, number] => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
  const [r, g, bl] = rgb(color);
  let best = PALETTE[0], bestD = Infinity;
  for (const p of PALETTE) {
    const [pr, pg, pb] = rgb(p);
    const dd = (pr - r) ** 2 + (pg - g) ** 2 + (pb - bl) ** 2;
    if (dd < bestD) [best, bestD] = [p, dd];
  }
  void rough;
  void metal;
  return METAL.has(best) ? b.flat(best, 0.4, 0.6) : b.flat(best, GLOSS.has(best) ? 0.4 : 0.85);
}
const GLOW = { panel: 0xeef3ff, screen: 0x7fb6e8, green: 0x5cff8a, amber: 0xffb040, red: 0xff3a2a };
/** One strength per glow colour, so each is a single material (the wall boxes' LEDs use 3). */
const GLOW_K: Record<number, number> = { [GLOW.panel]: 1.2, [GLOW.screen]: 0.9, [GLOW.green]: 3, [GLOW.amber]: 3, [GLOW.red]: 3 };

/** Floor slabs and their openings, for the suspended ceilings under them. */
const INNER: Rect = [-29.8, -21.8, 29.8, 21.8];
const ATRIUM: Rect = [-8, -8, 8, 8];
const CORE1: Rect[] = [[-29.4, -4.5, -27, 4.5], [27, -4.5, 29.4, 4.5]];
const CORE2: Rect[] = [[-27, -4.5, -24.6, 4.5], [24.6, -4.5, 27, 4.5]];
const BOARDROOM: Rect = [-12, -21.8, 12, -10];

/** Sign styles: wayfinding plates, lit exit signs, brass plaques. */
const way = { h: 0.26, bg: '#2a3036', fg: '#eef0f0', font: '600 56px "Arial Narrow", Arial, sans-serif' };
const exit = { h: 0.2, bg: '#1d7a3a', fg: '#f2fff4', glow: 1.2, font: '700 60px Arial, sans-serif' };
const brass = { h: 0.16, bg: '#b89a5a', fg: '#2a2418', font: '600 52px Georgia, serif' };

/** A few loose sheets of paper on a surface (boxes: far cheaper than a prop in every cell). */
function sheets(deco: (min: V3, max: V3, color: number, rough?: number) => void, d: Dresser, x: number, y: number, z: number): void {
  for (let i = 0; i < 2; i++) {
    const ox = d.rand(-0.08, 0.08), oz = d.rand(-0.08, 0.08), wide = d.r() < 0.5;
    deco([x + ox - (wide ? 0.15 : 0.105), y + i * 0.003, z + oz - (wide ? 0.105 : 0.15)], [x + ox + (wide ? 0.15 : 0.105), y + 0.003 + i * 0.003, z + oz + (wide ? 0.105 : 0.15)], C.paper, 0.9);
  }
}

const overlaps = (a: Rect, c: Rect, pad = 0): boolean => a[0] < c[2] + pad && a[2] > c[0] - pad && a[1] < c[3] + pad && a[3] > c[1] - pad;

/** The Trust's tower on a working day that stopped: the business district, the plaza, desks left mid-task. */
function dress(d: Dresser, bounds: THREE.Box3): void {
  const b = d.b;
  const paint = (color: number, rough = 0.8, metal = 0): THREE.Material => tone(b, color, rough, metal);
  const sort = (min: V3, max: V3): [V3, V3] => [
    [Math.min(min[0], max[0]), Math.min(min[1], max[1]), Math.min(min[2], max[2])],
    [Math.max(min[0], max[0]), Math.max(min[1], max[1]), Math.max(min[2], max[2])],
  ];
  /** A visual-only box (corners in either order). */
  const deco = (min: V3, max: V3, color: number, rough = 0.8, metal = 0): void => {
    const [lo, hi] = sort(min, max);
    b.box(lo, hi, paint(color, rough, metal), { collide: false, shadow: false });
  };
  /** A square post standing on `base`: cups, poles, bottles, pots (merged boxes, unlike cylinders). */
  const post = (base: V3, r: number, h: number, color: number): void => {
    deco([base[0] - r * 0.89, base[1], base[2] - r * 0.89], [base[0] + r * 0.89, base[1] + h, base[2] + r * 0.89], color);
  };
  const glowBox = (min: V3, max: V3, color: number, _k = 1.5): void => {
    const [lo, hi] = sort(min, max);
    b.box(lo, hi, b.glow(color, GLOW_K[color] ?? 1.2), { collide: false, shadow: false });
  };
  const free = (min: V3, max: V3): boolean => {
    const [lo, hi] = sort(min, max);
    return !b.blocked(new THREE.Box3(new THREE.Vector3(...lo), new THREE.Vector3(...hi)));
  };
  /** A solid piece of furniture, only where nothing solid is already. */
  const solidBox = (min: V3, max: V3, color: number, rough = 0.8, metal = 0): boolean => {
    if (!free(min, max)) return false;
    const [lo, hi] = sort(min, max);
    b.box(lo, hi, paint(color, rough, metal), { shadow: false });
    return true;
  };
  const prop = (id: PropId, x: number, y: number, z: number, rot = 0, scale = 1): void => {
    b.prop(id, x, y, z, rot, { collide: false, scale });
  };
  const solid = (id: PropId, x: number, y: number, z: number, rot = 0, scale = 1): boolean => {
    if (b.blocked(b.propBox(id, x, y, z, rot, scale))) return false;
    b.prop(id, x, y, z, rot, { scale });
    return true;
  };
  const glass = b.own(new THREE.MeshStandardMaterial({ color: 0xbfd6e0, roughness: 0.05, transparent: true, opacity: 0.2, depthWrite: false }));
  const glassBox = (min: V3, max: V3): void => {
    const [lo, hi] = sort(min, max);
    b.box(lo, hi, glass, { collide: false, shadow: false });
  };
  /** Something flat on a wall: `face` is the way the wall faces, `at` its surface. */
  const onWall = (face: Face, at: number, along: number, y0: number, y1: number, w: number, d0: number, d1: number, color: number, glow = 0): void => {
    const out = face[0] === '+' ? 1 : -1;
    const min: V3 = face[1] === 'z' ? [along - w / 2, y0, at + out * d0] : [at + out * d0, y0, along - w / 2];
    const max: V3 = face[1] === 'z' ? [along + w / 2, y1, at + out * d1] : [at + out * d1, y1, along + w / 2];
    if (glow) glowBox(min, max, color, glow);
    else deco(min, max, color, 0.6, 0.2);
  };

  // Labels go in 2048 px atlases packed in rows: queue them and draw the tall ones first. One atlas
  // is not enough for a whole tower, so the stair cores, lifts and upper floors use a second one (`ds`).
  // A label that no longer fits is skipped with a warning instead of failing the whole map.
  const ds = new Dresser(b, 404);
  const labels: [number, () => void][] = [];
  const q = (rows: number, draw: () => void): void => {
    labels.push([rows, draw]);
  };

  // Glass towers of the business district all round
  d.skyline(bounds, { near: 12, far: 180, h: [30, 120], lit: 0.25, day: true, count: 80 });

  // --- The tower's own curtain wall, outside, around the real openings
  const cw = { floor: 5, sill: 1.2, h: 3, w: 2.6, spacing: 3.1, lit: 0.12, frame: 0x8c949a, margin: 0.6, litColor: 0xf2f6ff };
  for (const [face, at] of [['-x', -30.2], ['+x', 30.2]] as const) {
    d.windows(face, at, -22, -18.4, L, TOP, cw);
    d.windows(face, at, -9.6, 9.6, L, TOP, cw);
    d.windows(face, at, 12.4, 22, L, TOP, cw);
    d.streaks(face, at, -22, 22, L, TOP, 8, { opacity: 0.22 });
  }
  d.windows('-z', -22.2, -30, -26.4, L, TOP, cw);
  d.windows('-z', -22.2, -13.6, -10.4, L, TOP, cw);
  d.windows('-z', -22.2, 10.4, 13.6, L, TOP, cw);
  d.windows('-z', -22.2, 26.4, 30, L, TOP, cw);
  d.streaks('-z', -22.2, -30, 30, L, TOP, 10, { opacity: 0.22 });
  d.streaks('+z', 22.2, -30, 30, L, TOP, 10, { opacity: 0.22 });
  d.roof(-30, -22, 30, 22, TOP + 0.4);
  // Mullions and floor bands on the two tall glass bays of the front
  for (const [x0, x1] of [[-12, -6.4], [6.4, 12]] as const) {
    for (let i = 0; i <= 4; i++) {
      const x = x0 + ((x1 - x0) * i) / 4;
      deco([x - 0.05, L + 1.5, 21.88], [x + 0.05, TOP - 1, 22.12], C.darkSteel, 0.4, 0.6);
    }
    for (const y of [L + 1.5, M - 0.2, O - 0.2, TOP - 1.1]) deco([x0, y, 21.88], [x1, y + 0.12, 22.12], C.darkSteel, 0.4, 0.6);
  }
  for (let i = 0; i <= 8; i++) deco([-10 + i * 2.5 - 0.05, O + 1.5, -22.12], [-10 + i * 2.5 + 0.05, O + 3.8, -21.88], C.darkSteel, 0.4, 0.6);

  dressPlaza(d, { deco, post, glowBox, solidBox, prop, q, signs: ds });
  dressParking(d, { deco, post, glowBox, solidBox, prop, q, onWall, signs: ds });

  // --- Suspended ceilings with a grid of light panels under every slab (no real lights: glow only)
  const ceiling = (y: number, holes: Rect[], walls: Rect[], skip: Rect[] = []): void => {
    const xs = [...new Set([INNER[0], INNER[2], ...holes.flatMap((h) => [h[0], h[2]])])].sort((p, r) => p - r);
    const zs = [...new Set([INNER[1], INNER[3], ...holes.flatMap((h) => [h[1], h[3]])])].sort((p, r) => p - r);
    for (let i = 0; i + 1 < xs.length; i++) for (let j = 0; j + 1 < zs.length; j++) {
      const cx = (xs[i] + xs[i + 1]) / 2, cz = (zs[j] + zs[j + 1]) / 2;
      if (holes.some((h) => cx > h[0] && cx < h[2] && cz > h[1] && cz < h[3])) continue;
      deco([xs[i], y - 0.03, zs[j]], [xs[i + 1], y, zs[j + 1]], C.ceiling, 0.95);
    }
    for (let x = -26; x <= 26; x += 4) for (let z = -19; z <= 21; z += 4) {
      const r: Rect = [x - 0.6, z - 0.3, x + 0.6, z + 0.3];
      if (holes.some((h) => overlaps(r, h, 0.25)) || walls.some((w) => overlaps(r, w, 0.2)) || skip.some((s) => overlaps(r, s))) continue;
      deco([x - 0.66, y - 0.045, z - 0.36], [x + 0.66, y - 0.03, z + 0.36], C.panelRim, 0.5, 0.3);
      glowBox([x - 0.6, y - 0.055, z - 0.3], [x + 0.6, y - 0.045, z + 0.3], GLOW.panel, 1.2);
    }
  };
  const lobbyWalls: Rect[] = [[-12.2, 0, -11.8, 21.8], [11.8, 0, 12.2, 21.8], [14, 13.8, 29.8, 14.2], [13.8, 14, 14.2, 21.8]];
  ceiling(M - 0.35, [ATRIUM, ...CORE2], lobbyWalls);
  ceiling(O - 0.35, [ATRIUM, ...CORE1], []);
  ceiling(TOP, [ATRIUM], [[-12.2, -21.8, -11.8, -10], [11.8, -21.8, 12.2, -10], [-12.2, -10.2, 12.2, -9.8]], [BOARDROOM]);

  // --- Skirting along the outer walls of the three upper floors (not across doors or the stair cores)
  const skirt = (face: Face, at: number, a: number, c: number, y: number, gaps: [number, number][]): void => {
    let u = a;
    for (const [g0, g1] of [...gaps, [c, c] as [number, number]].sort((p, r) => p[0] - r[0])) {
      if (g0 - u > 0.1) onWall(face, at, (u + g0) / 2, y, y + 0.1, g0 - u, 0, 0.015, C.skirting);
      u = Math.max(u, g1);
    }
  };
  for (const y of [L, M, O]) {
    const door: [number, number][] = y === L ? [[10, 12]] : [];
    skirt('+z', -21.8, -29.8, 29.8, y, []);
    skirt('-z', 21.8, -29.8, 29.8, y, y === L ? [[-6, 6]] : []);
    skirt('+x', -29.8, -21.8, 21.8, y, [[-4.6, 4.6], ...door]);
    skirt('-x', 29.8, -21.8, 21.8, y, [[-4.6, 4.6], ...door]);
  }

  // --- Stair cores: the level on every landing, extinguishers and call points, exits
  const levels: [number, string, string, number][] = [[0, 'P1', 'PARKING', -1], [L, '0', 'LOBBY', 1], [M, '1', 'GALLERY', -1], [O, '2', 'OFFICES', 1]];
  for (const [y, n, name, side] of levels) {
    for (const [face, at, core] of [['+x', -29.8, 'A'], ['-x', 29.8, 'B']] as const) {
      q(1, () => ds.sign(face, at, side * 6.9, y + 1.75, `STAIR ${core} · ${name}`, way));
      q(1, () => ds.stencil(face, at, side * 9.2, y + 0.8, n, { h: 1.2, color: '#2a3440', opacity: 0.75 }));
      if (y === L) d.wallProp('korean_fire_extinguisher_01', face, at, side * 5.3, y + 0.45, { collide: false });
      else if (y > 0) onWall(face, at, side * 5.3, y + 1.0, y + 1.6, 0.6, 0, 0.04, C.red);
      if (y > 0) onWall(face, at, side * 7.9, y + 1.35, y + 1.5, 0.12, 0, 0.05, C.red);
    }
  }
  q(1, () => ds.sign('-z', 21.8, 0, L + 3.55, 'EXIT', exit));
  q(1, () => ds.sign('+x', -29.8, 11, L + 2.75, 'EXIT', exit));
  q(1, () => ds.sign('-x', 29.8, 11, L + 2.75, 'EXIT', exit));

  // --- Lifts on the north wall of the parking, the lobby and the gallery
  const lifts = (y: number, label: string): void => {
    for (const x of [-3.2, 0, 3.2]) {
      onWall('+z', -21.8, x, y, y + 2.65, 1.7, 0, 0.06, C.steel);
      onWall('+z', -21.8, x - 0.36, y, y + 2.4, 0.7, 0.06, 0.09, 0xb4bac0);
      onWall('+z', -21.8, x + 0.36, y, y + 2.4, 0.7, 0.06, 0.09, 0xb4bac0);
      onWall('+z', -21.8, x, y + 2.47, y + 2.58, 0.26, 0.06, 0.075, GLOW.amber, 1.6);
      onWall('+z', -21.8, x + 1.05, y + 1.0, y + 1.25, 0.1, 0, 0.03, C.darkSteel);
      onWall('+z', -21.8, x + 1.05, y + 1.07, y + 1.12, 0.04, 0.03, 0.04, GLOW.amber, 2);
    }
    q(1, () => ds.sign('+z', -21.8, 0, y + 2.85, `LIFTS · ${label}`, way));
  };
  lifts(0, 'P1');
  lifts(L, 'LOBBY');
  lifts(M, 'LEVEL 1');

  // --- Cameras under the ceilings
  const cams: [Face, number, number, number][] = [
    ['+z', -21.8, 9, M - 0.75], ['+z', 12.35, -12, M - 0.75], ['-z', -10.125, 9, TOP - 0.7],
  ];
  for (const [face, at, along, y] of cams) d.wallProp('security_camera_01', face, at, along, y, { collide: false });

  dressLobby(d, { deco, post, glowBox, solidBox, prop, solid, glassBox, onWall, q, signs: ds });
  dressUpper(d, { deco, post, glowBox, solidBox, prop, solid, glassBox, onWall, q, signs: ds });

  labels.sort((p, r) => r[0] - p[0]).forEach(([, draw]) => {
    try {
      draw();
    } catch (e) {
      console.warn('glasshouse: label skipped', e);
    }
  });
}

type Kit = {
  deco: (min: V3, max: V3, color: number, rough?: number, metal?: number) => void;
  post: (base: V3, r: number, h: number, color: number) => void;
  glowBox: (min: V3, max: V3, color: number, k?: number) => void;
  solidBox: (min: V3, max: V3, color: number, rough?: number, metal?: number) => boolean;
  prop: (id: PropId, x: number, y: number, z: number, rot?: number, scale?: number) => void;
  solid?: (id: PropId, x: number, y: number, z: number, rot?: number, scale?: number) => boolean;
  glassBox?: (min: V3, max: V3) => void;
  onWall?: (face: Face, at: number, along: number, y0: number, y1: number, w: number, d0: number, d1: number, color: number, glow?: number) => void;
  /** Queue a label `rows` lines tall (see `labels` in dress). */
  q: (rows: number, draw: () => void) => void;
  /** The second label atlas. */
  signs?: Dresser;
};

/** The plaza: the Trust's name over the door, planters, benches, flags and the assembly point. */
function dressPlaza(d: Dresser, k: Kit): void {
  const { deco, post, solidBox, prop, q } = k;
  const plaza: Rect[] = [[-39.5, 22.5, 39.5, 29.5], [-39.5, -29.5, -30.5, 21.5], [-29.5, -29.5, 29.5, -22.5], [33.5, -29.5, 39.5, 21.5]];
  for (const [x, dir] of [[-24, '+z'], [-14, '+z'], [14, '+z'], [24, '+z']] as const) d.lampPost(x, 28.8, L, dir === '+z' ? '-z' : '+z', { h: 5 });
  for (const z of [-20, -6, 8]) {
    d.lampPost(-38.8, z, L, '+x', { h: 5 });
    d.lampPost(38.8, z, L, '-x', { h: 5 });
  }
  for (let x = -5; x <= 5; x += 2.5) post([x, L, 28], 0.12, 0.9, 0x3a3e42);
  for (const r of plaza) {
    d.stains(r, L, 8, 0x1a1a1a, 0.25);
    d.debris(r, L, 25, { paper: 0.7 });
    d.scatter(r, L, 6, [['metal_trash_can', 2, { collide: true }], ['cardboard_box_01', 1], ['trashbag', 1]], { clear: [[-7, 23.5, 7, 29.5]] });
  }
  d.line(-39.5, 22.6, 39.5, 22.6, L, { color: 0x6b6d70, w: 0.3 });

  // The entrance: a canopy with the Trust's name, the name again high on the facade, the street number
  deco([-7, L + 3.45, 22.2], [7, L + 3.7, 25.2], C.darkSteel, 0.4, 0.6);
  deco([-7, L + 3.4, 25.1], [7, L + 3.45, 25.2], C.steel, 0.4, 0.6);
  q(1, () => k.signs!.sign('+z', 25.2, 0, L + 3.46, 'ALDANE CIVIC TRUST', { h: 0.22, bg: '#2a323a', fg: '#e8e4d8', font: '600 60px Georgia, serif', plate: false }));
  q(1, () => d.sign('+z', 22.2, 0, L + 6.4, 'ALDANE CIVIC TRUST', { h: 0.9, bg: '#d2cec6', fg: '#26303a', font: '600 64px Georgia, serif', plate: false }));
  q(1, () => d.sign('+z', 22.2, -7.6, L + 2.2, '1 BARRIER ROW', { h: 0.18, bg: '#b89a5a', fg: '#2a2418', font: '600 52px Georgia, serif' }));
  deco([-5, L, 22.2], [5, L + 0.012, 23.6], 0x2e3134, 0.95);

  // Planters (the dark boxes) get soil and shrubs; granite benches beside them
  for (const x0 of [-20, 14]) {
    deco([x0 + 0.1, L + 0.9, 25.1], [x0 + 5.9, L + 0.92, 26.9], C.soil, 1);
    for (let i = 0; i < 3; i++) prop('shrub_04', x0 + 1.0 + i * 2.0 + d.rand(-0.2, 0.2), L + 0.92, 26 + d.rand(-0.4, 0.4), d.rand(0, 6), d.rand(2.2, 2.8));
  }
  for (const x of [-30, -19, 19, 30]) solidBox([x - 1, L, 27.6], [x + 1, L + 0.45, 28.2], 0x8e8c88, 0.7);

  // Flags of the Trust and the city by the east corner
  for (const [i, x] of [26.5, 28, 29.5].entries()) {
    post([x, L, 24], 0.06, 9, C.steel);
    deco([x + 0.06, L + 7.6, 23.98], [x + 1.5, L + 8.5, 24.02], i === 1 ? C.white : C.navy, 0.9);
  }
  // Where the staff gather when the building empties
  deco([-34.05, L, 27.4], [-33.95, L + 2.2, 27.5], C.steel, 0.4, 0.6);
  q(1, () => d.sign('+z', 27.5, -34, L + 1.7, 'ASSEMBLY POINT B', { h: 0.3, bg: '#1f7a3a', fg: '#f2fff4', font: '700 60px Arial, sans-serif' }));
  for (let i = 0; i < 5; i++) sheets(deco, d, -34 + d.rand(-3, 3), L, 25.5 + d.rand(-1.5, 1.5));
}

/** Parking and the data vault: bays, columns, ducts and trays, the vault's anteroom and its machines, the dock. */
function dressParking(d: Dresser, k: Kit): void {
  const { deco, post, glowBox, solidBox, q } = k;
  const onWall = k.onWall!;
  const park: Rect = [-29.5, -21.5, 29.5, 21.5];
  for (let x = -28; x <= 28; x += 2.6) {
    d.line(x, 10, x, 15, 0, { color: 0xd8d2bf, w: 0.1 });
    d.line(x, -15, x, -10, 0, { color: 0xd8d2bf, w: 0.1 });
  }
  // Bay numbers and wheel stops along the south row
  for (let i = 0, x = -26.7; x < 28; x += 2.6, i++) {
    q(1, () => d.floorText(x, 0, 10.7, String(i + 1).padStart(2, '0'), '-z', { h: 0.42 }));
    deco([x - 0.6, 0, 14.4], [x + 0.6, 0.12, 14.6], 0x9a9c9a, 0.95);
  }
  d.line(-28, 6.5, 28, 6.5, 0, { color: 0xc79a2a, w: 0.12, dash: 2, gap: 1.5 });
  d.line(-28, -6.5, 28, -6.5, 0, { color: 0xc79a2a, w: 0.12, dash: 2, gap: 1.5 });
  q(1, () => d.floorText(12, 0, 0, 'SLOW', '-x', { h: 0.9 }));
  q(1, () => d.floorText(23, 0, -11, 'DOCK', '-x', { h: 0.9 }));
  d.stains(park, 0, 50, 0x090909, 0.55);
  d.debris(park, 0, 50, { paper: 0.4 });
  d.scatter(park, 0, 14, [['cardboard_box_01', 2], ['metal_jerrycan', 1], ['WetFloorSign_01', 1], ['trashbag', 1], ['old_tyre', 1]], { clear: [[22, -21.8, 30, -15]] });

  // Columns: grid letters, a painted foot, extinguishers
  for (const [i, x] of [-18, -6, 6, 18].entries()) for (const [j, z] of [-12, 0, 12].entries()) {
    if (x === -18 && z === -12) continue;
    deco([x - 0.415, 0, z - 0.415], [x + 0.415, 0.5, z + 0.415], C.yellow, 0.7);
    q(1, () => d.stencil('+z', z + 0.4, x, 1.6, `${'ABCD'[i]}${j + 1}`, { h: 0.34, color: '#26303a', opacity: 0.85 }));
  }
  for (const x of [-18, -6, 6, 18]) for (const z of [0, 12]) d.wallProp('korean_fire_extinguisher_01', '+z', z + 0.4, x, 0.5, { collide: false });

  // Services under the slab: the old pipes, two ducts, a cable tray, the sprinkler main
  d.pipe([-29.5, L - 0.8, -3], [29.5, L - 0.8, -3], 0.18, 0x8a3a2a);
  d.pipe([-29.5, L - 0.7, 3], [29.5, L - 0.7, 3], 0.12, 0x5a5f63);
  d.pipe([-29.5, L - 0.9, 18], [29.5, L - 0.9, 18], 0.25, 0x6a7074);
  for (const x of [-24, -12, 0, 12, 24]) for (const z of [-15, 9]) d.ceilingProp('mounted_fluorescent_lights', x, L - 0.35, z);
  d.duct([-29.4, L - 0.8, -8.5], [29.4, L - 0.8, -8.5], 0.9, 0.45);
  d.duct([-29.4, L - 0.8, 7.5], [29.4, L - 0.8, 7.5], 0.7, 0.4);
  d.cableTray([-26.6, L - 0.6, 0.9], [26.6, L - 0.6, 0.9], 0.4);
  deco([-29.4, L - 0.53, -5.13], [29.4, L - 0.47, -5.07], C.red);
  for (let x = -27; x <= 27; x += 3) deco([x - 0.03, L - 0.62, -5.13], [x + 0.03, L - 0.5, -5.07], C.red, 0.5, 0.3);
  // Directions on the columns nearest the vault and the dock
  q(1, () => d.sign('+x', -5.6, -12, 2.3, 'DATA VAULT ↑', way));
  q(1, () => d.sign('-x', 17.6, -12, 2.3, 'LOADING DOCK ↑', way));

  // The vault anteroom: steel surrounds, card readers, warnings, a camera on each door
  const R = 0x2f3337;
  for (const [z0, z1] of [[-17.35, -17], [-15, -14.65]] as const) deco([-13.75, 0, z0], [-13.55, 2.75, z1], R, 0.4, 0.7);
  deco([-13.75, 2.4, -17.35], [-13.55, 2.75, -14.65], R, 0.4, 0.7);
  for (const [x0, x1] of [[-24.35, -24], [-22, -21.65]] as const) deco([x0, 0, -9.75], [x1, 2.75, -9.55], R, 0.4, 0.7);
  deco([-24.35, 2.4, -9.75], [-21.65, 2.75, -9.55], R, 0.4, 0.7);
  d.wallBox('+x', -13.75, -14.35, 1.15, 0.12, 0.2, 0.05, 0x7d8488, { glow: GLOW.green });
  d.wallBox('+z', -9.75, -21.35, 1.15, 0.12, 0.2, 0.05, 0x7d8488, { glow: GLOW.green });
  d.hazard(-13.4, -17, -13.4, -15, 0);
  d.hazard(-24, -9.4, -22, -9.4, 0);
  q(1, () => d.sign('+x', -13.75, -16, 2.95, 'DATA VAULT · ARCHIVE', { h: 0.3, bg: '#1d2730', fg: '#e8e4d8' }));
  q(1, () => d.sign('+x', -13.75, -18.6, 1.4, 'AUTHORISED STAFF ONLY', { h: 0.2, bg: '#f0ece0', fg: '#8a2a1c' }));
  q(1, () => d.sign('+z', -9.75, -23, 2.95, 'DATA VAULT', { h: 0.3, bg: '#1d2730', fg: '#e8e4d8' }));
  q(1, () => k.signs!.sign('+z', -9.75, -19.8, 1.4, 'TWO-PERSON RULE', { h: 0.2, bg: '#f0ece0', fg: '#8a2a1c' }));
  q(1, () => k.signs!.floorText(-10.4, 0, -16, 'KEEP CLEAR', '-x', { h: 0.6, color: '#d2a82a' }));
  d.wallProp('security_camera_01', '+x', -13.75, -13.4, L - 0.8, { collide: false });

  // Inside the vault: raised floor, rack lights and seams, trays over the racks, the cooling unit, gas bottles
  deco([-29.55, 0, -21.55], [-14.25, 0.015, -10.25], 0xb4b8ba, 0.6);
  for (let x = -29; x < -14.4; x += 0.6) deco([x - 0.008, 0.015, -21.55], [x + 0.008, 0.017, -10.25], 0x7d8284, 0.6);
  for (let z = -21; z < -10.4; z += 0.6) deco([-29.55, 0.015, z - 0.008], [-14.25, 0.017, z + 0.008], 0x7d8284, 0.6);
  for (let z = -19.7; z < -12; z += 0.6) {
    deco([-27.5, 0.05, z - 0.01], [-27.48, 2.15, z + 0.01], 0x0e1012, 0.6);
    for (let y = 0.3; y < 2.1; y += 0.22) {
      if (d.r() < 0.45) continue;
      glowBox([-27.5, y, z + 0.08], [-27.47, y + 0.025, z + 0.12], d.r() < 0.8 ? GLOW.green : GLOW.amber, 2.5);
    }
  }
  for (let z = -20.8; z < -19; z += 0.3) for (let y = 0.4; y < 2.1; y += 0.3) if (d.r() < 0.6) glowBox([-17.53, y, z], [-17.5, y + 0.025, z + 0.04], GLOW.green, 2.5);
  d.cableTray([-28.25, 2.6, -20.5], [-28.25, 2.6, -11.5], 0.45);
  d.cableTray([-29, 3.2, -10.8], [-14.6, 3.2, -10.8], 0.3);
  if (solidBox([-27.4, 0, -11.0], [-25.4, 1.95, -10.3], 0xd8dadc, 0.5, 0.2)) {
    for (let y = 1.2; y < 1.85; y += 0.1) deco([-27.3, y, -11.03], [-25.5, y + 0.03, -11.0], 0x50565a, 0.6);
    glowBox([-26.9, 0.9, -11.03], [-26.5, 1.05, -11.01], GLOW.screen, 1.2);
  }
  for (const x of [-14.9, -15.25, -15.6]) {
    post([x, 0, -21.35], 0.13, 1.45, C.red);
    post([x, 1.45, -21.35], 0.05, 0.12, C.steel);
  }
  q(1, () => d.sign('+z', -21.8, -16.2, 1.95, 'GAS SUPPRESSION', { h: 0.18, bg: '#a8302a', fg: '#ffffff' }));
  q(1, () => d.sign('+z', -21.8, -22, 3.0, 'ARCHIVE · DATA VAULT 1', { h: 0.3, bg: '#1d2730', fg: '#e8e4d8' }));
  q(1, () => d.sign('+z', -21.39, -22, 1.55, 'ARCHIVE TRANSFER', { h: 0.24, bg: '#0e1e33', fg: '#cfefff', glow: 1.2, plate: false }));
  d.wallProp('security_camera_01', '+z', -21.8, -27, L - 0.8, { collide: false });
  d.wallBox('+x', -29.8, -11.2, 1.0, 0.46, 0.5, 0.2, 0x7d8488, { grille: true });

  // The loading dock: stripes at the door, its name, pallets waiting
  d.hazard(29.5, -21.3, 29.5, -19.7, 0, 0.4);
  q(1, () => d.sign('-x', 29.8, -20.5, 2.75, 'EXIT', exit));
  q(1, () => d.sign('-x', 29.8, -17.6, 2.3, 'LOADING DOCK', { h: 0.3, bg: '#d2a82a', fg: '#1c1c1c' }));
  d.pallet(28.6, 0, -13.2, 0.05, 'none');
  d.pallet(28.6, 0, -14.5, -0.04, 'wrapped');
  d.wallBox('-x', 29.8, -9, 1.0, 0.46, 0.5, 0.2, 0x7d8488, { grille: true });
  onWall('-x', 29.8, -10.2, 0.6, 2.2, 0.9, 0, 0.12, 0x7d8488);
}

/** Lobby floor: entrance, reception and turnstiles, the seating, the café, the security wing, washrooms. */
function dressLobby(d: Dresser, k: Kit): void {
  const b = d.b;
  const { deco, post, glowBox, solidBox, prop, q } = k;
  /** A floor plant: a ceramic pot (merged geometry) with a shrub in it. */
  const plant = (x: number, y: number, z: number, rot = 0, s = 1): void => {
    post([x, y, z], 0.24 * s, 0.5 * s, C.darkSteel);
    prop('shrub_04', x, y + 0.48 * s, z, rot, 2.3 * s);
  };
  /** A flat screen on its foot, facing `dir` along z. */
  const monitor = (x: number, y: number, z: number, dir = 1): void => {
    deco([x - 0.06, y, z - 0.08], [x + 0.06, y + 0.12, z + 0.08], C.black);
    deco([x - 0.28, y + 0.12, z - 0.02], [x + 0.28, y + 0.45, z + 0.02], C.black);
    glowBox([x - 0.26, y + 0.14, z - dir * 0.021], [x + 0.26, y + 0.43, z - dir * 0.025], GLOW.screen);
  };
  const solid = k.solid!, glassBox = k.glassBox!, onWall = k.onWall!;

  // --- Entrance: mats, a directory totem
  deco([-5, L, 19.6], [5, L + 0.012, 21.8], 0x2e3134, 0.95);
  if (solidBox([-10.4, L, 19.4], [-8.6, L + 2.1, 19.6], C.darkSteel, 0.4, 0.5)) {
    q(4, () => d.sign('+z', 19.6, -9.5, L + 0.8, 'DIRECTORY', {
      h: 0.8, bg: '#1d2730', fg: '#e8e4d8', plate: false, font: '600 54px "Arial Narrow", Arial, sans-serif',
      lines: ['2  OFFICES · BOARDROOM', '1  GALLERY', '0  LOBBY · CAFÉ', 'P1  PARKING · VAULT'],
    }));
  }
  // Atrium banners from the roof, over the void
  for (const [x, lines] of [[-4.5, ['ALDANE', 'CIVIC', 'TRUST']], [4.5, ['KEEPING', 'PORT VEYLE', 'DRY']]] as const) {
    deco([x - 0.8, 18.95, -7.82], [x + 0.8, 19.0, -7.76], C.darkSteel, 0.4, 0.6);
    for (const dx of [-0.7, 0.7]) deco([x + dx - 0.01, 19.0, -7.8], [x + dx + 0.01, TOP, -7.78], C.darkSteel, 0.4, 0.6);
    q(3, () => d.sign('+z', -7.8, x, 16.6, lines[0], { lines: [...lines], h: 2.35, w: 1.5, bg: '#1d2a3a', fg: '#e8e4d8', font: '600 50px Georgia, serif', plate: false }));
  }

  // --- Reception: stone top, screens and the visitors' book, staff stools, the Trust's name above the lifts
  deco([-4.1, L + 1.1, -12.7], [4.1, L + 1.15, -11.3], C.stone, 0.3);
  for (const x of [-3.6, 3.6]) deco([x - 0.5, L + 1.1, -12.7], [x + 0.5, L + 1.15, -9.9], C.stone, 0.3);
  q(1, () => d.sign('+z', -11.4, 0, L + 0.45, 'RECEPTION', { h: 0.2, bg: '#5e4630', fg: '#e8dcc0', font: '600 56px Georgia, serif', plate: false }));
  for (const x of [-1.6, 1.6]) {
    monitor(x, L + 1.15, -12.25);
  }
  sheets(deco, d, 0, L + 1.15, -11.9);
  sheets(deco, d, -2.8, L + 1.15, -12.1);
  deco([0.5, L + 1.15, -12.6], [0.75, L + 1.22, -12.4], C.black, 0.5);
  plant(-4.9, L, -12.0, 0.3);
  plant(4.9, L, -12.0, 2.1);
  q(1, () => d.sign('+z', -21.8, 0, L + 3.4, 'ALDANE CIVIC TRUST', { h: 0.55, bg: '#1d2730', fg: '#d9dde0', font: '600 64px Georgia, serif' }));

  // Turnstiles between reception and the lifts: steel posts with open glass paddles, card readers lit
  for (let i = 0; i <= 6; i++) {
    const x = -3.75 + i * 1.25;
    if (!solidBox([x - 0.13, L, -17.1], [x + 0.13, L + 1.0, -15.9], C.steel, 0.35, 0.7)) continue;
    deco([x - 0.14, L + 1.0, -17.12], [x + 0.14, L + 1.03, -15.88], C.black, 0.4);
    glowBox([x - 0.06, L + 1.031, -16.2], [x + 0.06, L + 1.035, -16.05], i % 3 === 0 ? GLOW.red : GLOW.green, 2);
    if (i > 0) glassBox([x - 0.33, L + 0.45, -16.55], [x - 0.13, L + 0.95, -16.45]);
    if (i < 6) glassBox([x + 0.13, L + 0.45, -16.55], [x + 0.33, L + 0.95, -16.45]);
  }

  // --- Lobby screens on the two wing walls, where the Trust talks to its visitors
  for (const [face, at] of [['+x', -11.875], ['-x', 11.875]] as const) {
    onWall(face, at, 11, L + 1.45, L + 2.85, 2.4, 0, 0.06, C.black);
    onWall(face, at, 11, L + 1.52, L + 2.78, 2.26, 0.06, 0.065, GLOW.screen, 0.9);
    q(2, () => d.sign(face, at + (face === '+x' ? 0.066 : -0.066), 11, L + 1.75, 'STORM WATCH', {
      lines: ['STORM WATCH +5.8 M', 'THE WALL IS READY'], h: 0.8, bg: '#0f2238', fg: '#dfeaf4', glow: 1.2, plate: false,
    }));
  }

  // --- Seating groups in the two north wings: sofa, armchairs, a table with magazines, on a rug
  const lounge = (cx: number, cz: number): void => {
    deco([cx - 1.95, L, cz - 1.55], [cx + 1.95, L + 0.012, cz + 1.25], C.carpet, 1);
    if (solid('CoffeeTable_01', cx, L, cz)) {
      for (let i = 0; i < 3; i++) deco([cx - 0.5 + i * 0.35, L + 0.52, cz - 0.15], [cx - 0.25 + i * 0.35, L + 0.53, cz + 0.2], d.pick([C.paper, 0x8a9aa8, 0xb85a3a]), 0.9);
      post([cx + 0.5, L + 0.52, cz + 0.1], 0.04, 0.1, C.white);
    }
    solid('Sofa_01', cx, L, cz - 1.15);
    solid('ArmChair_01', cx - 1.45, L, cz + 0.1, Math.PI / 2 - 0.2);
    solid('ArmChair_01', cx + 1.45, L, cz + 0.1, -Math.PI / 2 + 0.2);
    plant(cx + 1.6, L, cz - 1.25, d.rand(0, 6), 0.8);
  };
  for (const s of [-1, 1]) {
    lounge(s * 21, -17);
    lounge(s * 21.5, -10.5);
  }
  // Someone's coat on a bench, a bag under it: the staff left in a hurry
  deco([-15.2, L + 0.5, -6.3], [-14.4, L + 0.56, -5.7], 0x2e3a48, 0.95);
  deco([13.6, L, -14.4], [14.1, L + 0.3, -14.2], 0x4a3628, 0.9);
  // Hanging signs at the mouths of the two wings
  for (const [x, text] of [[-12.6, 'STAIR A · CAFÉ · WC'], [12.6, 'STAIR B · SECURITY']] as const) {
    deco([x - 0.04, L + 2.9, -5.2], [x + 0.04, L + 3.25, -2.8], C.darkSteel, 0.4, 0.6);
    for (const dz of [-1, 1]) deco([x - 0.01, L + 3.25, -4 + dz - 0.01], [x + 0.01, M - 0.38, -4 + dz + 0.01], C.darkSteel, 0.4, 0.6);
    q(1, () => d.sign('+x', x + 0.04, -4, L + 2.95, text, { ...way, plate: false }));
  }

  // Washrooms in the west wing, the riser and the cleaner's corner in the east
  const washrooms = (y: number): void => {
    for (const [z, text] of [[-17, 'WC'], [-14.6, 'WC · ACCESSIBLE']] as const) {
      onWall('+x', -29.8, z, y, y + 2.2, 1.15, 0, 0.05, C.steel);
      onWall('+x', -29.8, z, y, y + 2.12, 1.0, 0.05, 0.07, C.woodLight);
      onWall('+x', -29.8, z + 0.38, y + 1.0, y + 1.05, 0.14, 0.07, 0.1, C.steel);
      q(1, () => d.sign('+x', -29.8, z, y + 2.35, text, { ...way, h: 0.2 }));
    }
    onWall('+x', -29.8, -12.9, y + 0.75, y + 0.95, 0.45, 0, 0.35, C.white);
  };
  washrooms(L);
  washrooms(M);
  onWall('+z', -21.8, 26, L, L + 2.15, 1.0, 0, 0.05, 0x6f767c);
  q(1, () => d.sign('+z', -21.8, 26, L + 2.3, 'RISER · ELECTRICAL', { ...way, h: 0.18 }));
  d.wallBox('+z', -21.8, 24.6, L + 1.0, 0.46, 0.5, 0.2, 0x7d8488, { grille: true });
  if (solidBox([27.6, L + 0.2, -21.6], [28.6, L + 0.85, -21.05], 0x2f5a8a, 0.6)) {
    for (const [x, z] of [[27.7, -21.7], [28.5, -21.7], [27.7, -20.95], [28.5, -20.95]] as const) post([x, L, z], 0.05, 0.2, C.black);
    post([28.3, L + 0.85, -21.3], 0.16, 0.3, 0xd2a82a);
    post([27.85, L + 0.85, -21.35], 0.09, 0.28, C.blue);
  }
  deco([29.5, L, -20.9], [29.55, L + 1.25, -20.85], C.woodLight); // a mop against the wall
  deco([29.35, L, -21.05], [29.7, L + 0.08, -20.7], C.fabric);
  prop('WetFloorSign_01', 26.9, L, -19.9, 0.6);

  // --- Café: counter top, the machine, the till and the cakes, a menu over the counter
  deco([-28.05, L + 1.1, 1.95], [-19.95, L + 1.14, 3.05], C.stone, 0.3);
  deco([-21.7, L + 1.14, 2.1], [-20.7, L + 1.6, 2.6], C.steel, 0.3, 0.8);
  deco([-21.6, L + 1.6, 2.15], [-20.8, L + 1.66, 2.55], C.black, 0.5);
  for (const x of [-21.45, -20.95]) post([x, L + 1.14, 2.75], 0.04, 0.08, C.white);
  deco([-23.25, L + 1.14, 2.3], [-22.75, L + 1.24, 2.75], C.black); // the till
  deco([-23.2, L + 1.24, 2.35], [-22.8, L + 1.46, 2.42], C.black);
  glowBox([-23.17, L + 1.27, 2.42], [-22.83, L + 1.43, 2.425], GLOW.screen);
  glassBox([-25.8, L + 1.14, 2.15], [-24.4, L + 1.55, 2.95]);
  for (let i = 0; i < 8; i++) deco([-25.7 + (i % 4) * 0.33, L + 1.15 + (i < 4 ? 0 : 0.2), 2.3], [-25.48 + (i % 4) * 0.33, L + 1.22 + (i < 4 ? 0 : 0.2), 2.75], d.pick([0xb07a3c, 0xd8c090, 0x6a3a22]), 0.8);
  deco([-28, M - 1.15, 2.3], [-20, M - 0.35, 2.6], C.wood, 0.7);
  q(2, () => d.sign('+z', 2.6, -24, M - 1.05, 'COFFEE 2.40', {
    lines: ['COFFEE 2.40 · TEA 1.80', 'SOUP 3.90 · SANDWICH 4.50'], h: 0.5, bg: '#1f2522', fg: '#ece6d6', font: 'italic 600 56px Georgia, serif', plate: false,
  }));
  for (const x of [-23.2, -21.6]) prop('bar_chair_round_01', x + d.rand(-0.15, 0.15), L, 3.6 + d.rand(0, 0.3), d.rand(0, 6));
  // Back bar and the drinks fridge behind the counter
  if (solidBox([-24.2, L, 0.3], [-21.4, L + 0.95, 0.85], C.wood, 0.7)) {
    deco([-24.25, L + 0.95, 0.25], [-21.35, L + 0.99, 0.9], C.stone, 0.3);
    for (let i = 0; i < 5; i++) post([-23.9 + i * 0.5, L + 0.99, 0.55], 0.07, d.rand(0.15, 0.3), d.pick([0x3a2a1e, 0x6a5a48, C.white]));
  }
  if (solidBox([-21.2, L, 0.3], [-20.4, L + 1.9, 0.85], C.white, 0.4, 0.2)) glowBox([-21.12, L + 0.1, 0.86], [-20.48, L + 1.8, 0.87], GLOW.panel, 0.9);
  // Table tops with what was left on them, plants, the recycling bins
  for (const [x, z] of [[-24, 8], [-18, 12], [-24, 17], [-17, 18]] as const) {
    deco([x - 0.72, L + 0.8, z - 0.72], [x + 0.72, L + 0.83, z + 0.72], C.stone, 0.4);
    for (let i = 0; i < 2; i++) post([x + d.rand(-0.45, 0.45), L + 0.83, z + d.rand(-0.45, 0.45)], 0.045, 0.1, C.white);
    if (d.r() < 0.6) sheets(deco, d, x + d.rand(-0.3, 0.3), L + 0.83, z + d.rand(-0.3, 0.3));
  }
  for (const [i, c] of [0x2f6a3a, 0x2f4a7a, 0x5a5f63].entries()) solidBox([-13.6 + i * 0.45, L, 0.15], [-13.2 + i * 0.45, L + 0.9, 0.6], c, 0.6);
  q(1, () => d.sign('+x', -11.875, 6, L + 2.75, 'ATRIUM CAFÉ', { ...way, bg: '#5e4630', fg: '#efe6cf', font: '600 56px Georgia, serif' }));
  q(1, () => k.signs!.sign('+x', -11.875, 16, L + 2.75, 'ATRIUM CAFÉ', { ...way, bg: '#5e4630', fg: '#efe6cf', font: '600 56px Georgia, serif' }));
  // A chalk A-board outside the café
  deco([-11.2, L, 9.2], [-11.15, L + 1.05, 10.0], C.wood);
  deco([-11.15, L + 0.15, 9.27], [-11.14, L + 1.0, 9.93], C.black);
  // The old loose seating stays where the staff pushed it back
  for (const [x, z] of [[-24, 8], [-18, 12], [-24, 17], [-17, 18]] as const) {
    for (const j of [0, 1, 2]) {
      const a = j * 2.1 + d.rand(-0.3, 0.3);
      b.prop('plastic_monobloc_chair_01', x + Math.cos(a) * 1.15, L, z + Math.sin(a) * 1.15, -a + Math.PI / 2, { collide: false });
    }
  }
  b.prop('Television_01', -24, L + 1.1, 2.4, 0, { collide: false, scale: 0.7 });

  // --- Lobby floor: paper and boxes from the evacuation
  d.scatter([-11.5, -21.5, 11.5, 21.5], L, 5, [['WetFloorSign_01', 1], ['cardboard_box_01', 1]], { clear: [[-8, -8, 8, 8]] });
  d.debris([-11.5, -21.5, 11.5, 21.5], L, 30, { paper: 0.95 });
  for (let i = 0; i < 6; i++) sheets(deco, d, d.rand(-7, 7), L, d.rand(9, 20));

  // --- Security wing: the corridor to the staff door, then the office with the shutter panels
  q(1, () => d.sign('-x', 11.875, 6, L + 2.75, 'SECURITY', way));
  q(1, () => d.sign('-z', 13.875, 22.4, L + 2.1, 'SECURITY OFFICE', way));
  q(1, () => d.sign('-z', 13.875, 27.6, L + 1.6, 'STAFF ONLY', { h: 0.18, bg: '#f0ece0', fg: '#8a2a1c' }));
  q(1, () => d.sign('-x', 29.8, 13, L + 1.9, 'STAFF ENTRANCE', way));
  d.wallBox('-x', 29.8, 9.5, L + 1.15, 0.12, 0.2, 0.05, 0x7d8488, { glow: GLOW.green });
  // A vending machine and a notice board in the corridor
  if (solidBox([12.15, L, 0.4], [12.95, L + 1.85, 1.35], 0x8a2a24, 0.5, 0.2)) {
    glowBox([12.96, L + 0.7, 0.5], [12.97, L + 1.75, 1.0], GLOW.panel, 0.9);
    deco([12.95, L + 0.2, 0.5], [12.98, L + 0.45, 1.25], C.black, 0.5);
  }
  onWall('+x', 12.125, 10.5, L + 1.2, L + 2.0, 1.4, 0, 0.03, 0xb08a5a);
  for (let i = 0; i < 5; i++) onWall('+x', 12.125, 10.0 + i * 0.25 + d.rand(-0.05, 0.05), L + 1.3 + d.rand(0, 0.35), L + 1.6 + d.rand(0, 0.3), 0.2, 0.03, 0.035, C.paper);
  // The office: the monitor wall over the console, labels under the panels, lockers, a chair, the procedure
  for (const [i, x] of [16.9, 19.2, 21.5].entries()) for (const y of [L + 1.95, L + 2.65]) {
    onWall('-z', 21.8, x, y - 0.04, y + 0.64, 1.12, 0, 0.06, C.black);
    onWall('-z', 21.8, x, y, y + 0.6, 1.04, 0.06, 0.065, GLOW.screen, (i + (y > L + 2 ? 1 : 0)) % 2 ? 0.9 : 0.6);
  }
  q(1, () => d.sign('-z', 21.8, 19.2, L + 3.45, 'SHUTTER CONTROL', { ...way, h: 0.22 }));
  (['dock', 'staff', 'cafe'] as const).forEach((key) => {
    const p = GLASSHOUSE.panel[key];
    q(1, () => d.sign('-z', 21.2, p[0], L + 0.6, key === 'cafe' ? 'CAFÉ' : key.toUpperCase(), { h: 0.14, bg: '#e8e4d8', fg: '#1c1c1c', plate: false }));
  });
  monitor(22.15, L + 1.0, 21.4);
  for (let i = 0; i < 4; i++) {
    const z = 19.45 + i * 0.55;
    if (solidBox([14.15, L, z], [14.65, L + 1.9, z + 0.53], 0x6a747c, 0.5, 0.4)) deco([14.65, L + 1.5, z + 0.1], [14.66, L + 1.7, z + 0.43], C.black, 0.5);
  }
  q(2, () => d.sign('+z', 14.125, 18, L + 1.3, 'LOCKDOWN', {
    lines: ['LOCKDOWN: SEAL TWO ENTRIES', 'STAFF TO ASSEMBLY POINT B'],
    h: 0.34, bg: '#f0ece0', fg: '#1c1c1c', border: '#8a2a1c', font: '600 52px "Arial Narrow", Arial, sans-serif',
  }));
  d.wallBox('+z', 14.125, 15.2, L + 1.2, 0.5, 0.6, 0.08, 0x7d8488);
  d.desk(22, L, 17.5, '+z');
  d.desk(27, L, 17.5, '+z');
  d.shelves(29.6, 15, 29.6, 20, L, '-x');
  d.debris([14.5, 14.5, 29.5, 21.5], L, 20, { paper: 0.9 });
}

/** Gallery and office floors: display cases, kitchenette, meeting tables, desk pods, the boardroom. */
function dressUpper(d: Dresser, k: Kit): void {
  const b = d.b;
  const { deco, post, glowBox, solidBox, prop, q } = k;
  const ds = k.signs!;
  const solid = k.solid!, glassBox = k.glassBox!, onWall = k.onWall!;
  /** A floor plant: a ceramic pot (merged geometry) with a shrub in it. */
  const plant = (x: number, y: number, z: number, rot = 0, s = 1): void => {
    post([x, y, z], 0.24 * s, 0.5 * s, C.darkSteel);
    prop('shrub_04', x, y + 0.48 * s, z, rot, 2.3 * s);
  };
  /** A flat screen on its foot, facing `dir` along z. */
  const monitor = (x: number, y: number, z: number, dir = 1): void => {
    deco([x - 0.06, y, z - 0.08], [x + 0.06, y + 0.12, z + 0.08], C.black);
    deco([x - 0.28, y + 0.12, z - 0.02], [x + 0.28, y + 0.45, z + 0.02], C.black);
    glowBox([x - 0.26, y + 0.14, z - dir * 0.021], [x + 0.26, y + 0.43, z - dir * 0.025], GLOW.screen);
  };

  // --- Gallery (M): the display cases get glass hoods, models and plaques
  const model = (kind: 'barrier' | 'pump' | 'city', x: number, z: number): void => {
    const y = M + 1.2;
    if (kind === 'barrier') {
      deco([x - 1.1, y, z - 0.4], [x + 1.1, y + 0.02, z + 0.4], 0x3d5866, 0.3);
      for (let i = 0; i < 7; i++) {
        const px = x - 0.95 + i * 0.32;
        deco([px - 0.04, y, z - 0.18], [px + 0.04, y + 0.26, z + 0.18], 0xc8c6c0, 0.8);
        if (i < 6) deco([px + 0.04, y + 0.02, z - 0.03], [px + 0.28, y + 0.18, z + 0.03], 0x5a5f63, 0.5, 0.6);
      }
    } else if (kind === 'pump') {
      deco([x - 1.1, y, z - 0.4], [x + 1.1, y + 0.02, z + 0.4], 0x7a8a6a, 0.9);
      deco([x - 0.5, y, z - 0.2], [x + 0.3, y + 0.28, z + 0.2], 0xb8a890, 0.8);
      deco([x + 0.3, y, z - 0.12], [x + 0.6, y + 0.16, z + 0.12], 0xb8a890, 0.8);
      for (let i = 0; i < 3; i++) post([x - 0.35 + i * 0.25, y + 0.28, z], 0.04, 0.16, 0x8a3a2a);
      deco([x - 1.05, y + 0.02, z + 0.25], [x + 1.05, y + 0.03, z + 0.32], 0x3d5866, 0.3);
    } else {
      deco([x - 1.1, y, z - 0.4], [x + 1.1, y + 0.02, z + 0.4], 0x8f9496, 0.8);
      for (let i = 0; i < 14; i++) {
        const bx = x - 0.95 + (i % 7) * 0.28, bz = z - 0.2 + Math.floor(i / 7) * 0.32;
        deco([bx - 0.1, y, bz - 0.1], [bx + 0.1, y + 0.05 + d.r() * (i === 3 ? 0.5 : 0.22), bz + 0.1], d.pick([0xd2cec6, 0x9aa8b4, 0xc0b8a8]), 0.6);
      }
    }
  };
  const cases: [number, number, 'barrier' | 'pump' | 'city', string][] = [
    [-16, -14, 'barrier', 'THE STORM BARRIER'], [16, -14, 'pump', 'PUMP STATION 3'], [0, -14, 'city', 'ALDANE TOWER'],
    [-16, 14, 'barrier', 'GATES 4–7'], [16, 14, 'city', 'FIFTY YEARS ON'], [0, 14, 'pump', 'LOWER WARDS'],
  ];
  for (const [x, z, kind, text] of cases) {
    model(kind, x, z);
    glassBox([x - 1.15, M + 1.2, z - 0.45], [x + 1.15, M + 1.75, z + 0.45]);
    deco([x - 1.17, M + 1.75, z - 0.47], [x + 1.17, M + 1.78, z + 0.47], C.darkSteel, 0.4, 0.6);
    const face: Face = z < 0 ? '+z' : '-z';
    q(1, () => ds.sign(face, z + (z < 0 ? 0.5 : -0.5), x, M + 0.8, text, brass));
  }
  q(1, () => ds.sign('+z', -21.8, -9, M + 1.8, 'TWELVE YEARS DRY', { h: 0.4, bg: '#1d2a3a', fg: '#e8e4d8', font: '600 56px Georgia, serif' }));
  q(1, () => ds.sign('+z', -21.8, 9, M + 1.8, 'BUILT TO HOLD', { h: 0.4, bg: '#e8e4d8', fg: '#1d2a3a', font: '600 56px Georgia, serif' }));

  // Kitchenette in the north-east corner: counter under the window, sink, kettle, microwave, fridge, water
  if (solidBox([16, M, -21.78], [22, M + 0.9, -21.15], C.woodLight, 0.7)) {
    deco([15.95, M + 0.9, -21.8], [22.05, M + 0.94, -21.1], C.stone, 0.3);
    deco([17.2, M + 0.92, -21.65], [17.8, M + 0.945, -21.3], 0x50565a, 0.3, 0.7);
    deco([17.47, M + 0.94, -21.75], [17.53, M + 1.2, -21.69], C.steel, 0.3, 0.8);
    deco([20.6, M + 0.94, -21.7], [21.3, M + 1.3, -21.3], C.white, 0.4);
    glowBox([21.1, M + 1.18, -21.29], [21.25, M + 1.24, -21.28], GLOW.green, 2);
    post([18.6, M + 0.94, -21.45], 0.08, 0.2, C.steel);
    for (let i = 0; i < 4; i++) post([19.2 + i * 0.22, M + 0.94, -21.3], 0.04, 0.1, d.pick([C.white, C.red, 0x2f4a7a]));
  }
  if (solidBox([26.2, M, -21.78], [27.0, M + 1.85, -21.1], C.white, 0.4, 0.2)) deco([26.9, M + 0.8, -21.1], [26.94, M + 1.5, -21.06], C.steel, 0.3, 0.8);
  if (solidBox([27.35, M, -21.72], [27.8, M + 1.05, -21.3], C.white, 0.5)) post([27.575, M + 1.05, -21.51], 0.15, 0.4, 0x6fa8d8);
  q(1, () => ds.sign('+z', -21.8, 26.6, M + 2.1, 'KITCHEN', { ...way, h: 0.2 }));
  if (solidBox([19.6, M, -18.9], [20.4, M + 1.05, -18.1], C.wood, 0.6)) {
    deco([19.4, M + 1.05, -19.1], [20.6, M + 1.08, -17.9], C.stone, 0.3);
    post([20.1, M + 1.08, -18.5], 0.045, 0.1, C.white);
  }

  // Meeting table in the north-west corner with a screen and a flip chart
  deco([-24, M, -20.2], [-15.8, M + 0.012, -15.6], C.carpet, 1);
  if (solidBox([-22, M, -18.6], [-18, M + 0.72, -17.2], C.wood, 0.6)) deco([-22.05, M + 0.72, -18.65], [-17.95, M + 0.76, -17.15], C.woodLight, 0.4);
  for (const x of [-21, -19]) {
    prop('dining_chair_02', x + d.rand(-0.15, 0.15), M, -19.2, d.rand(-0.3, 0.3));
    prop('dining_chair_02', x + d.rand(-0.15, 0.15), M, -16.6, Math.PI + d.rand(-0.3, 0.3));
  }
  prop('projector_screen', -23.4, M, -17.9, Math.PI / 2);
  sheets(deco, d, -20.4, M + 0.76, -17.9);

  // Desk pods in the south wings: back-to-back desks with a fabric screen between, a printer at the end
  for (const s of [-1, 1]) {
    deco([s * 13.4, M, 15.4], [s * 23.6, M + 0.012, 21.6], C.carpet, 1);
    for (const z0 of [17.8]) {
      for (const x of [15.3, 17.4, 19.5]) {
        d.desk(s * x, M, z0 - 0.5, '-z');
        d.desk(s * x, M, z0 + 0.5, '+z');
        sheets(deco, d, s * x + d.rand(-0.6, 0.6), M + 0.79, z0 + (d.r() < 0.5 ? -0.4 : 0.4));
      }
      deco([s * 14.3, M + 0.79, z0 - 0.025], [s * 20.5, M + 1.3, z0 + 0.025], C.fabric, 1);
      deco([s * 14.3, M + 1.3, z0 - 0.035], [s * 20.5, M + 1.33, z0 + 0.035], C.steel, 0.4, 0.6);
      solidBox([s * 20.6, M, z0 - 0.9], [s * 21.2, M + 0.7, z0 + 0.9], 0x8a9096, 0.5, 0.4);
    }
    if (solidBox([s * 22.4, M, 17.4], [s * 23.2, M + 1.0, 18.2], 0xd8dadc, 0.5)) {
      glowBox([s * 22.5, M + 1.0, 17.5], [s * 22.7, M + 1.005, 17.6], GLOW.green, 2);
      deco([s * 22.5, M + 1.0, 17.7], [s * 23.1, M + 1.05, 18.1], C.paper, 0.9);
    }
  }
  d.debris([-29.5, -21.5, 29.5, 21.5], M, 30, { paper: 0.95 });

  // --- Offices (O): the desk rows get screens between them, the open floor its filing and corner offices
  for (const side of [-1, 1]) {
    for (const z of [12, 16, 20]) {
      for (const dx of [-1.2, 1.2]) {
        b.prop(d.r() < 0.6 ? 'classic_laptop' : 'Television_01', side * 14 + dx, O + 0.8, z + d.rand(-0.1, 0.1), Math.PI + d.rand(-0.3, 0.3), { collide: false, scale: d.r() < 0.6 ? 1 : 0.55 });
        b.prop('metal_stool_01', side * 14 + dx + d.rand(-0.2, 0.2), O, z - 0.9, d.rand(0, 6), { collide: false });
      }
      deco([side * 14 - 2.1, O + 0.8, z + 0.42], [side * 14 + 2.1, O + 1.25, z + 0.46], C.fabric, 1);
    }
    for (const x of [16, 21, 26]) for (const z of [-6, 0, 6]) d.desk(side * x, O, z, side > 0 ? '-x' : '+x');
    d.shelves(side * 29.6, -9, side * 29.6, -2, O, side > 0 ? '-x' : '+x');
    // Filing along the north wall, archive boxes on the floor beside it
    for (const x of [15, 16, 17, 18]) {
      if (!solidBox([side * (x - 0.47), O, -21.78], [side * (x + 0.47), O + 1.32, -21.1], C.fabric)) continue;
      for (const y of [0.3, 0.62, 0.94, 1.26]) deco([side * (x - 0.42), O + y - 0.01, -21.1], [side * (x + 0.42), O + y, -21.08], C.darkSteel);
      for (const y of [0.18, 0.5, 0.82, 1.14]) deco([side * (x - 0.08), O + y, -21.1], [side * (x + 0.08), O + y + 0.03, -21.07], C.steel);
    }
    for (let i = 0; i < 3; i++) prop('cardboard_box_01', side * (19.6 + d.rand(0, 1.2)), O + (i === 2 ? 0.34 : 0), -21.2 + d.rand(-0.2, 0.2), d.rand(-0.3, 0.3));
    // A copier in the corner
    if (solidBox([side * 28.6, O, -21.4], [side * 29.6, O + 1.05, -20.4], 0xd8dadc, 0.5)) {
      deco([side * 28.7, O + 1.05, -21.3], [side * 29.5, O + 1.12, -20.5], 0x6a7074, 0.5);
      glowBox([side * 28.62, O + 0.9, -20.95], [side * 28.61, O + 0.98, -20.75], GLOW.green, 2);
    }
    // A small meeting corner by the south windows: round table, chairs, whiteboard
    post([side * 24, O, 16], 0.06, 0.72, C.darkSteel);
    post([side * 24, O + 0.72, 16], 0.6, 0.04, C.stone);
    for (let i = 0; i < 2; i++) {
      const a = i * Math.PI + d.rand(-0.3, 0.3);
      prop('metal_stool_01', side * 24 + Math.cos(a) * 0.95, O, 16 + Math.sin(a) * 0.95, -a - Math.PI / 2);
    }
  }
  // North-east: the director's corner office, open to the floor
  deco([20.6, O, -19.6], [26.2, O + 0.012, -13.4], C.carpet, 1);
  if (solidBox([22, O, -17.6], [24.4, O + 0.74, -16.5], C.wood, 0.5)) {
    deco([21.95, O + 0.74, -17.65], [24.45, O + 0.78, -16.45], 0x3a2a1e, 0.4);
    prop('desk_lamp_arm_01', 22.3, O + 0.78, -17.3, 0.8, 0.8);
    monitor(23.4, O + 0.78, -17.3, -1);
    sheets(deco, d, 23.6, O + 0.78, -16.8);
  }
  solid('ArmChair_01', 23.2, O, -18.5);
  solid('ArmChair_01', 22.5, O, -15.3, Math.PI + 0.2);
  solid('ArmChair_01', 24, O, -15.3, Math.PI - 0.2);
  solid('Sofa_01', 29.2, O, -14.2, -Math.PI / 2);
  solid('CoffeeTable_01', 27.9, O, -14.2, Math.PI / 2);
  // North-west: the planning table, drawings of the Wall's gates left out
  if (solidBox([-23.5, O, -17.6], [-20.5, O + 0.9, -16.2], C.steel, 0.5, 0.4)) {
    for (let i = 0; i < 4; i++) deco([-23.3 + i * 0.7, O + 0.9, -17.45 + d.rand(0, 0.15)], [-22.55 + i * 0.7, O + 0.905, -16.4 - d.rand(0, 0.15)], C.plan, 0.9);
    q(1, () => ds.floorText(-22, O + 0.9, -16.9, 'GATES 4–7', '+z', { h: 0.12, color: '#22345a' }));
  }
  for (const [x, z] of [[-24.1, -16.9], [-19.9, -16.9], [-22, -18.2]] as const) prop('metal_stool_01', x, O, z, d.rand(0, 6));
  for (let i = 0; i < 6; i++) sheets(deco, d, -22 + d.rand(-3, 3), O, -15 + d.rand(-1.5, 1.5));
  d.debris([-29.5, -21.5, 29.5, 21.5], O, 70, { paper: 0.95 });

  // --- Boardroom: carpet, chairs round the table, credenzas, portraits, the screen with what Mirela was copying
  deco([-10, O, -20.6], [10, O + 0.012, -11], C.carpetRed, 1);
  deco([-5.05, O + 0.8, -17.55], [5.05, O + 0.84, -14.45], 0x3a2a1e, 0.35);
  for (let i = 0; i < 5; i++) {
    const x = -4 + i * 2;
    prop('dining_chair_02', x + d.rand(-0.2, 0.2), O, -18.2 - d.rand(0, 0.4), d.rand(-0.4, 0.4));
    prop('dining_chair_02', x + d.rand(-0.2, 0.2), O, -13.8 + d.rand(0, 0.4), Math.PI + d.rand(-0.4, 0.4));
  }
  prop('dining_chair_02', -5.7, O, -16, Math.PI / 2);
  prop('dining_chair_02', 5.7, O, -16, -Math.PI / 2);
  for (let i = 0; i < 6; i++) {
    const x = -4 + i * 1.6 + d.rand(-0.2, 0.2), z = d.r() < 0.5 ? -17.1 : -14.9;
    sheets(deco, d, x, O + 0.84, z);
    post([x + 0.3, O + 0.84, z], 0.035, 0.11, 0xcfe0e8);
  }
  prop('classic_laptop', 2.2, O + 0.84, -16.6, Math.PI + 0.3);
  d.cable([2.5, O + 0.86, -17.2], [2.8, O + 0.1, -21.5], 0.25, 0.01);
  for (const s of [-1, 1]) {
    if (solidBox([s * 11.25, O, -20], [s * 11.85, O + 0.8, -12], C.wood, 0.5)) {
      deco([s * 11.2, O + 0.8, -20.05], [s * 11.87, O + 0.84, -11.95], 0x3a2a1e, 0.35);
      post([s * 11.55, O + 0.84, -17.5], 0.09, 0.28, 0x9fc4c8);
      post([s * 11.55, O + 0.84, -14.5], 0.22, 0.08, C.darkSteel);
    }
    const face: Face = s > 0 ? '-x' : '+x';
    for (const z of [-18.5, -16, -13.5]) {
      onWall(face, s * 11.875, z, O + 1.35, O + 2.45, 0.9, 0, 0.04, 0x8a7448);
      onWall(face, s * 11.875, z, O + 1.42, O + 2.38, 0.76, 0.04, 0.045, d.pick([0x4a4e48, 0x5a4a3a, 0x3e4a52]));
    }
    plant(s * 11.2, O, -21.1, d.rand(0, 6));
    plant(s * 11.2, O, -10.7, d.rand(0, 6));
  }
  d.wallProp('wall_clock', '-z', -10.125, -5, O + 2.6, { collide: false });
  q(1, () => ds.sign('+z', -9.875, 2.7, O + 1.6, 'BOARDROOM', { ...brass, h: 0.2 }));
  // The screen: a bezel round it, and the document on it
  deco([-6.1, O + 1.1, -21.72], [6.1, O + 1.2, -21.6], C.black, 0.4);
  deco([-6.1, O + 3.4, -21.72], [6.1, O + 3.5, -21.6], C.black, 0.4);
  q(4, () => ds.sign('+z', -21.59, 0, O + 1.55, 'SUND', {
    lines: ['SUND', 'MANAGED RELIEF', 'SECTOR 4–7 PRE-OPENING', 'LOWER WARDS'], h: 1.5, bg: '#0e1e33', fg: '#e6eef8', glow: 1.2, plate: false,
  }));
  // A long pendant over the table
  deco([-4.1, TOP - 0.86, -16.15], [4.1, TOP - 0.8, -15.85], C.darkSteel, 0.4, 0.6);
  glowBox([-4, TOP - 0.87, -16.1], [4, TOP - 0.86, -15.9], GLOW.panel, 1.2);
  for (const x of [-3.5, 3.5]) deco([x - 0.008, TOP - 0.8, -16.008], [x + 0.008, TOP, -15.992], C.darkSteel, 0.4, 0.6);
  // The rope team: lines down the outside of the glass, one in over the sill, glass on the carpet
  for (const x of [-6.2, 5.8]) {
    deco([x - 0.015, O + 0.5, -22.42], [x + 0.015, TOP + 0.6, -22.39], 0xd8c89a, 0.9);
    deco([x - 0.015, O, -21.7], [x + 0.015, O + 0.03, -19.5], 0xd8c89a, 0.9);
  }
  for (let i = 0; i < 24; i++) {
    const x = d.pick([-6.2, 5.8]) + d.rand(-1.2, 1.2), z = d.rand(-21.6, -19.6), s = d.rand(0.03, 0.09);
    deco([x - s, O + 0.012, z - s * 0.7], [x + s, O + 0.02, z + s * 0.7], 0xbfd6e0, 0.1, 0.1);
  }
}
