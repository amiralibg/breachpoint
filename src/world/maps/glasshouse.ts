import * as THREE from 'three';
import type { QualityPreset } from '../../core/settings';
import { ENV, LevelBuilder, stairRun, type Rect, type V3 } from '../level';
import { Dresser } from '../dress';
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
  const b = await LevelBuilder.create(q, ['marble', 'plaster', 'painted', 'concrete', 'floor', 'steel'],
    ['covered_car', 'wooden_military_crate', 'concrete_road_barrier', 'utility_box_01', 'plastic_crate_01']);
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
  const level = b.finish(scene, gl, ENV.overcast, bounds);
  return worldFromLevel('glasshouse', level, {
    bounds,
    spawn: GLASSHOUSE.spawn,
    spawnYaw: 0,
    navGround: [[-30, -22, 33, 22]],
    menuCam: { center: [0, 8, 4], radius: 46, height: 26 },
  });
}

/** The Trust's tower on a working day that stopped: the business district, the plaza, desks left mid-task. */
function dress(d: Dresser, bounds: THREE.Box3): void {
  const b = d.b;
  // Glass towers of the business district all round
  d.skyline(bounds, { near: 12, far: 180, h: [30, 120], lit: 0.25, day: true, count: 80 });

  // --- The tower's own curtain wall, outside, around the real openings
  const cw = { floor: 5, sill: 1.2, h: 3, w: 2.6, spacing: 3.1, lit: 0.12, frame: 0x8c949a, margin: 0.6, litColor: 0xf2f6ff };
  for (const [face, at] of [['-x', -30.2], ['+x', 30.2]] as const) {
    d.windows(face, at, -22, -18.4, L, TOP, cw);
    d.windows(face, at, -9.6, 9.6, L, TOP, cw);
    d.windows(face, at, 12.4, 22, L, TOP, cw);
  }
  d.windows('-z', -22.2, -30, -26.4, L, TOP, cw);
  d.windows('-z', -22.2, -13.6, -10.4, L, TOP, cw);
  d.windows('-z', -22.2, 10.4, 13.6, L, TOP, cw);
  d.windows('-z', -22.2, 26.4, 30, L, TOP, cw);
  d.roof(-30, -22, 30, 22, TOP + 0.4);

  // --- Plaza: lamps, bins, bollards, the planted strip
  const plaza: [number, number, number, number][] = [[-39.5, 22.5, 39.5, 29.5], [-39.5, -29.5, -30.5, 21.5], [-29.5, -29.5, 29.5, -22.5], [33.5, -29.5, 39.5, 21.5]];
  for (const [x, dir] of [[-24, '+z'], [-14, '+z'], [14, '+z'], [24, '+z']] as const) d.lampPost(x, 28.8, L, dir === '+z' ? '-z' : '+z', { h: 5 });
  for (const z of [-20, -6, 8]) {
    d.lampPost(-38.8, z, L, '+x', { h: 5 });
    d.lampPost(38.8, z, L, '-x', { h: 5 });
  }
  for (let x = -5; x <= 5; x += 2.5) d.cyl([x, L, 28], 0.12, 0.9, b.flat(0x3a3e42, 0.5, 0.6));
  for (const r of plaza) {
    d.stains(r, L, 8, 0x1a1a1a, 0.25);
    d.debris(r, L, 25, { paper: 0.7 });
    d.scatter(r, L, 6, [['metal_trash_can', 2, { collide: true }], ['cardboard_box_01', 1], ['trashbag', 1]]);
  }
  d.line(-39.5, 22.6, 39.5, 22.6, L, { color: 0x6b6d70, w: 0.3 });

  // --- Parking: bays, oil, pipes and lights under the slab, extinguishers on the columns
  const park: [number, number, number, number] = [-29.5, -21.5, 29.5, 21.5];
  for (let x = -28; x <= 28; x += 2.6) {
    d.line(x, 10, x, 15, 0, { color: 0xd8d2bf, w: 0.1 });
    d.line(x, -15, x, -10, 0, { color: 0xd8d2bf, w: 0.1 });
  }
  d.line(-28, 6.5, 28, 6.5, 0, { color: 0xc79a2a, w: 0.12, dash: 2, gap: 1.5 });
  d.line(-28, -6.5, 28, -6.5, 0, { color: 0xc79a2a, w: 0.12, dash: 2, gap: 1.5 });
  d.stains(park, 0, 50, 0x090909, 0.55);
  d.debris(park, 0, 50, { paper: 0.4 });
  d.scatter(park, 0, 14, [['cardboard_box_01', 2], ['metal_jerrycan', 1], ['WetFloorSign_01', 1], ['trashbag', 1], ['old_tyre', 1]]);
  for (const x of [-18, -6, 6, 18]) for (const z of [0, 12]) d.wallProp('korean_fire_extinguisher_01', '+z', z + 0.4, x, 0.5, { collide: false });
  d.pipe([-29.5, L - 0.8, -3], [29.5, L - 0.8, -3], 0.18, 0x8a3a2a);
  d.pipe([-29.5, L - 0.7, 3], [29.5, L - 0.7, 3], 0.12, 0x5a5f63);
  d.pipe([-29.5, L - 0.9, 18], [29.5, L - 0.9, 18], 0.25, 0x6a7074);
  for (const x of [-24, -12, 0, 12, 24]) for (const z of [-15, 9]) d.ceilingProp('mounted_fluorescent_lights', x, L - 0.35, z);
  // The vault: cable runs into the racks
  d.pipe([-29.3, 3.8, -21.3], [-14.5, 3.8, -21.3], 0.08, 0x2a2d30);
  d.pipe([-29.3, 4.0, -21.2], [-14.5, 4.0, -21.2], 0.08, 0x2a2d30);

  // --- Lobby and wings
  d.scatter([-11.5, -21.5, 11.5, 21.5], L, 5, [['WetFloorSign_01', 1], ['cardboard_box_01', 1]], { clear: [[-8, -8, 8, 8]] });
  d.debris([-11.5, -21.5, 11.5, 21.5], L, 30, { paper: 0.95 });
  for (const [x, z] of [[-24, 8], [-18, 12], [-24, 17], [-17, 18]] as const) {
    for (const k of [0, 1, 2]) {
      const a = k * 2.1 + d.rand(-0.3, 0.3);
      b.prop('plastic_monobloc_chair_01', x + Math.cos(a) * 1.15, L, z + Math.sin(a) * 1.15, -a + Math.PI / 2, { collide: false });
    }
  }
  b.prop('Television_01', -24, L + 1.1, 2.4, 0, { collide: false, scale: 0.7 });
  d.desk(22, L, 17.5, '+z');
  d.desk(27, L, 17.5, '+z');
  d.shelves(29.6, 15, 29.6, 20, L, '-x');
  d.debris([14.5, 14.5, 29.5, 21.5], L, 20, { paper: 0.9 });

  // --- Offices: the desk rows got their screens and chairs, the open floor got more desks
  for (const side of [-1, 1]) {
    for (const z of [12, 16, 20]) {
      for (const dx of [-1.2, 1.2]) {
        b.prop(d.r() < 0.6 ? 'classic_laptop' : 'Television_01', side * 14 + dx, O + 0.8, z + d.rand(-0.1, 0.1), Math.PI + d.rand(-0.3, 0.3), { collide: false, scale: d.r() < 0.6 ? 1 : 0.55 });
        b.prop('metal_stool_01', side * 14 + dx + d.rand(-0.2, 0.2), O, z - 0.9, d.rand(0, 6), { collide: false });
      }
    }
    for (const x of [16, 21, 26]) for (const z of [-6, 0, 6]) d.desk(side * x, O, z, side > 0 ? '-x' : '+x');
    d.shelves(side * 29.6, -9, side * 29.6, -2, O, side > 0 ? '-x' : '+x');
  }
  for (let i = 0; i < 10; i++) {
    const x = -4.2 + (i % 5) * 2.1, z = i < 5 ? -18.2 : -13.8;
    b.prop('metal_stool_01', x, O, z, d.rand(0, 6), { collide: false });
  }
  d.debris([-29.5, -21.5, 29.5, 21.5], O, 70, { paper: 0.95 });
  d.debris([-29.5, -21.5, 29.5, 21.5], M, 30, { paper: 0.95 });
}
