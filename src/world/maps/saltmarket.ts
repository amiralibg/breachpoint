import * as THREE from 'three';
import type { QualityPreset } from '../../core/settings';
import { ENV, LevelBuilder, stairRun, type PropId, type V3 } from '../level';
import { Dresser, type Face } from '../dress';
import { worldFromLevel, type WorldMap } from '../map';

/**
 * M2 Saltmarket: Lower Wards market district at dusk, 90 x 70 m, split by a canal.
 *
 *   y = 0     canal bed (water to 1.3 m)
 *   y = 2.5   streets, market hall floor
 *   y = 7     first floors, stair landings
 *   y = 11.5  roofs of the market hall and the two-storey blocks; safehouse top floor
 *   y = 16    safehouse roof
 *
 * West bank: the market hall. East bank: the safehouse tenement (T3). Three ways into its top
 * floor: the street door and the stairs, the plank from the roof opposite into the south window
 * (reached over the roof bridge from the market roof), or the fire escape to the roof hatch.
 */

const S = 2.5;
const L1 = 7;
const R = 11.5;
const T = 16;

export const SALTMARKET = {
  spawn: [-40, S, 28] as V3,
  market: [-23, S, 0] as V3,
  canalSide: [10, S, -3] as V3,
  safehouse: [27, R, -14] as V3,
  documents: [28, R + 1, -20.2] as V3,
  exfil: [0, S, 20] as V3,
};

export async function buildSaltmarket(scene: THREE.Scene, q: QualityPreset, gl: THREE.WebGLRenderer): Promise<WorldMap> {
  const b = await LevelBuilder.create(q, ['brick', 'plaster', 'floor', 'asphalt', 'concrete', 'steel', 'rust', 'iron', 'blue']);
  const street = b.tint('asphalt', 0xa8a39c, 0.7);
  const brick = b.mat('brick');
  const brickDark = b.tint('brick', 0xa89a90);
  const plaster = b.tint('plaster', 0xd9cdb8);
  const plasterBlue = b.tint('plaster', 0x9fb2b8);
  const steel = b.tint('steel', 0x777d84);
  const wood = b.flat(0x6b4a2f, 0.85);
  const canalWall = b.tint('concrete', 0x8a8f8c);

  // --- Banks: solid up to street level either side of the canal
  b.box([-45, 0, -35], [-4, S, 35], street, { tile: 4 });
  b.box([4, 0, -35], [45, S, 35], street, { tile: 4 });
  b.ground([-4, -35, 4, 35], canalWall);
  b.water([-4, -35, 4, 35], 1.3, 0x0d1a1c);
  // Three footbridges, bare of cover, and steps out of the water on each bank
  for (const z of [-20, 0, 20]) b.slab(-4.2, z - 1.1, 4.2, z + 1.1, S, b.mat('floor'), 0.3);
  b.stairs(-3.3, 30, '-z', 0, S, 1.4, canalWall);
  b.stairs(3.3, -30, '+z', 0, S, 1.4, canalWall);
  const wTop = 30 - stairRun(0, S), eTop = -30 + stairRun(0, S);
  const railRuns = (x: number, cuts: [number, number][]): void => {
    let at = -35;
    for (const [a, c] of [...cuts].sort((p, r) => p[0] - r[0])) {
      b.rail(x, at, x, a, S, steel, 1.0);
      at = c;
    }
    b.rail(x, at, x, 35, S, steel, 1.0);
  };
  railRuns(-4, [[-21.1, -18.9], [-1.1, 1.1], [18.9, 21.1], [wTop - 0.2, wTop + 1.4]]);
  railRuns(4, [[-21.1, -18.9], [-1.1, 1.1], [18.9, 21.1], [eTop - 1.4, eTop + 0.2]]);

  // --- Market hall (west bank): open sides, six stalls in two rows, roof you can walk on
  b.slab(-34, -12, -12, 12, R, b.tint('iron', 0x8b8f8a), 0.4);
  for (const x of [-34, -28.5, -23, -17.5, -12]) {
    for (const z of [-12, 12]) b.column(x, z, S, R - 0.4, 0.6, brickDark);
  }
  for (const z of [-4, 4]) for (const x of [-34, -12]) b.column(x, z, S, R - 0.4, 0.6, brickDark);
  const awn = [0xb5452c, 0x2f6f8f, 0xc79a2a];
  [-29, -23, -17].forEach((x, i) => {
    for (const z of [-5, 5]) {
      b.box([x - 1.6, S, z - 0.8], [x + 1.6, S + 1.1, z + 0.8], wood);
      b.box([x - 1.9, S + 2.5, z - 1.2], [x + 1.9, S + 2.62, z + 1.2], b.flat(awn[(i + (z > 0 ? 1 : 0)) % 3], 0.9), { collide: false });
      for (const dx of [-1.8, 1.8]) b.box([x + dx - 0.04, S, z - 0.04], [x + dx + 0.04, S + 2.5, z + 0.04], steel, { collide: false });
    }
  });
  b.rail(-34, -12, -12, -12, R, brickDark, 0.9);
  b.rail(-34, -12, -34, 10, R, brickDark, 0.9);
  b.rail(-34, 12, -12, 12, R, brickDark, 0.9);
  b.rail(-12, -12, -12, 5, R, brickDark, 0.9);
  b.rail(-12, 7, -12, 12, R, brickDark, 0.9);
  // Stairs up the hall's south side, two flights
  const f = stairRun(S, L1);
  b.stairs(-34, 13.4, '+x', S, L1, 2, steel);
  b.slab(-34 + f, 12.4, -34 + f + 2.4, 16.8, L1, steel, 0.25);
  b.stairs(-34 + f, 15.8, '-x', L1, R, 2, steel);
  b.slab(-36.4, 10, -34, 16.8, R, steel, 0.25);
  b.rail(-36.4, 10, -36.4, 16.8, R, steel, 1.0);
  // Roof bridge over the canal to the block opposite the safehouse
  b.slab(-12, 5, 18, 7, R, steel, 0.25);
  b.rail(-12, 5, 18, 5, R, steel, 1.0);
  b.rail(-12, 7, 18, 7, R, steel, 1.0);
  for (const x of [-6, 6, 12]) b.column(x, 6, S, R - 0.25, 0.3, steel);

  // --- West bank blocks
  const block = (x0: number, z0: number, x1: number, z1: number, top: number, mat: THREE.Material): void => {
    b.box([x0, S, z0], [x1, top, z1], mat);
    b.box([x0 - 0.15, top, z0 - 0.15], [x1 + 0.15, top + 0.25, z1 + 0.15], b.tint('concrete', 0x9a9690), { collide: false });
  };
  block(-44, -34, -38, -16, R, brick);
  block(-32, -34, -10, -20, R, plaster);
  block(-44, -10, -40, 8, R, plasterBlue);
  block(-32, 22, -10, 34, 9, brick);

  // --- East bank blocks; T4 (18..34, 2..16) has the roof you cross
  block(38, -34, 45, -2, R, plaster);
  block(6, -34, 12, -29, 9, brick);
  block(6, 24, 14, 34, 9, plasterBlue);
  block(20, 22, 45, 34, 9, brick);
  block(38, 2, 45, 18, R, brick);
  b.box([18, S, 2], [34, R, 16], plasterBlue);
  b.rail(18, 2, 24.2, 2, R, brickDark, 0.9);
  b.rail(25.8, 2, 34, 2, R, brickDark, 0.9);
  b.rail(18, 16, 34, 16, R, brickDark, 0.9);
  b.rail(34, 2, 34, 16, R, brickDark, 0.9);
  b.rail(18, 2, 18, 5, R, brickDark, 0.9);
  b.rail(18, 7, 18, 16, R, brickDark, 0.9);
  b.box([28, R, 9], [30.5, R + 1.6, 11.5], b.tint('rust', 0x8b8f92)); // water tank
  b.crates(21, R, 13, 2);
  // The plank into the safehouse's south window
  b.slab(24.2, -6.2, 25.8, 2, R, wood, 0.12);

  // --- T3, the safehouse (18..34, -22..-6): three floors and a roof
  b.room(18, -22, 34, -6, S, T, brick, {
    roof: false,
    s: [[24.2, 25.8, R - S, R - S + 2.2], [28, 30, 0, 2.4], [20, 22, L1 - S + 1, L1 - S + 2.2]],
    e: [[-16, -14, L1 - S + 1, L1 - S + 2.2], [-12, -10, R - S + 1, R - S + 2.2]],
    w: [[-13, -11, R - S + 1, R - S + 2.2]],
  });
  const run = stairRun(S, L1);
  // Ground -> first floor, along the west wall
  b.stairs(20, -7, '-z', S, L1, 2, b.mat('floor'));
  b.slab(21.2, -21.85, 33.85, -6.15, L1, b.mat('floor'));
  b.slab(18.15, -21.85, 21.2, -7 - run, L1, b.mat('floor'));
  b.rail(21.2, -7 - run, 21.2, -6.15, L1, steel, 1.0);
  // First -> top floor
  b.stairs(23, -16, '+z', L1, R, 2, b.mat('floor'));
  b.slab(18.15, -21.85, 21.8, -6.15, R, b.mat('floor'));
  b.slab(24.2, -21.85, 33.85, -6.15, R, b.mat('floor'));
  b.slab(21.8, -21.85, 24.2, -16, R, b.mat('floor'));
  b.slab(21.8, -16 + run, 24.2, -6.15, R, b.mat('floor'));
  b.rail(21.8, -16, 21.8, -16 + run, R, steel, 1.0);
  b.rail(24.2, -16, 24.2, -16 + run, R, steel, 1.0);
  // Top floor -> roof hatch
  b.stairs(32, -8, '-z', R, T, 2, b.mat('floor'));
  b.slab(17.85, -22.15, 30.8, -5.85, T, b.tint('concrete', 0x8d8a84));
  b.slab(33.2, -22.15, 34.15, -5.85, T, b.tint('concrete', 0x8d8a84));
  b.slab(30.8, -22.15, 33.2, -8 - run, T, b.tint('concrete', 0x8d8a84));
  b.slab(30.8, -8, 33.2, -5.85, T, b.tint('concrete', 0x8d8a84));
  b.rail(30.8, -8 - run, 30.8, -8, T, steel, 1.0);
  b.rail(33.2, -8 - run, 33.2, -8, T, steel, 1.0);
  b.rail(30.8, -8, 33.2, -8, T, steel, 1.0);
  // Furniture: the top floor is a relief office, not an armoury
  b.box([26.5, R, -21.2], [29.5, R + 0.85, -20.4], wood); // the desk with the papers
  b.box([27.2, R + 0.85, -21.1], [28.8, R + 0.9, -20.5], b.flat(0xe8e2d0, 0.9), { collide: false });
  b.box([19, R, -21.4], [20.2, R + 1.9, -18.5], b.flat(0x4a4f55, 0.6, 0.3)); // filing cabinets
  b.box([25, R, -13], [27.5, R + 0.8, -11.6], wood);
  b.box([25.2, R, -8.6], [27.6, R + 1.2, -7.8], wood);
  b.box([26, L1, -18], [29, L1 + 1.0, -17], wood);
  b.box([30, L1, -10.5], [31.2, L1 + 1.9, -8], b.flat(0x4a4f55, 0.6, 0.3));
  b.crates(31, S, -19, 2);
  b.box([23, S, -12.5], [26, S + 1.0, -11.5], wood);
  // Fire escape up the north wall to the roof
  b.stairs(18, -24, '+x', S, L1, 2, steel);
  b.slab(18 + run, -27.4, 18 + run + 2.4, -23, L1, steel, 0.25);
  b.stairs(18 + run, -26.4, '-x', L1, R, 2, steel);
  b.slab(15.6, -27.4, 18, -23, R, steel, 0.25);
  b.stairs(18, -24, '+x', R, T, 2, steel);
  b.slab(18 + run, -27.4, 18 + run + 2.4, -22, T, steel, 0.25);
  b.rail(15.6, -27.4, 15.6, -23, R, steel, 1.0);
  b.rail(18 + run + 2.4, -27.4, 18 + run + 2.4, -23, L1, steel, 1.0);
  b.rail(18 + run + 2.4, -27.4, 18 + run + 2.4, -22, T, steel, 1.0);

  // --- Street cover and clutter
  b.prop('covered_car', -6.5, S, -27, 0.1);
  b.prop('covered_car', 14.5, S, 12, Math.PI / 2 + 0.1);
  b.prop('covered_car', 36, S, -12, 0.05);
  b.prop('concrete_road_barrier', 9, S, -8, Math.PI / 2);
  b.prop('concrete_road_barrier', 9, S, 6, Math.PI / 2);
  b.prop('concrete_road_barrier', 28, S, -1.5, 0);
  b.prop('utility_box_01', 17.4, S, -10, Math.PI / 2);
  b.crates(-8, S, 12, 2);
  b.crates(-37, S, 16, 2, 0.3);
  b.crates(-8, S, -8, 3);
  b.crates(12, S, -18, 2, 0.2);
  b.crates(15, S, 20, 2);
  b.crates(35.5, S, 8, 2);
  b.prop('wooden_crate_02', -36, S, -4, 0.4, { scale: 1.6 });
  b.prop('wooden_crate_02', -20, S, 18.5, 0.1, { scale: 1.6 });
  b.prop('wooden_crate_01', -14, S, -15, 0.7, { scale: 1.6 });
  b.prop('Barrel_01', -31, S, -9);
  b.prop('barrel_03', -30.2, S, -9.4);
  b.prop('Barrel_01', 16, S, -3);
  b.prop('plastic_crate_01', -28.5, S + 1.1, -5, 0.3, { scale: 1.3, collide: false });
  b.prop('plastic_crate_01', -17.4, S + 1.1, 5.1, 1.1, { scale: 1.3, collide: false });

  // District walls
  b.box([-45, S, -35], [45, S + 5, -34.6], brickDark);
  b.box([-45, S, 34.6], [45, S + 5, 35], brickDark);
  b.box([-45, S, -35], [-44.6, S + 5, 35], brickDark);
  b.box([44.6, S, -35], [45, S + 5, 35], brickDark);

  // --- Light: market lamps on strings, a few street lamps, warm windows. All of it dies in the blackout.
  for (const x of [-31, -26, -20, -15]) for (const z of [-8, 0, 8]) b.lamp(x, R - 0.9, z, { color: 0xffc27a, size: 0.22 });
  b.lamp(-26, R - 0.5, -2, { color: 0xffc27a, power: 70, range: 20, size: 0.3 });
  b.lamp(-18, R - 0.5, 3, { color: 0xffc27a, power: 70, range: 20, size: 0.3 });
  const streetLamp = (x: number, z: number): void => {
    b.column(x, z, S, S + 5, 0.18, steel);
    // A cast foot and a lantern housing round the bulb (visual only)
    const iron = b.flat(0x2e3236, 0.5, 0.6);
    b.box([x - 0.17, S, z - 0.17], [x + 0.17, S + 0.7, z + 0.17], iron, { collide: false });
    b.box([x - 0.26, S + 5, z - 0.26], [x + 0.26, S + 5.08, z + 0.26], iron, { collide: false });
    b.box([x - 0.06, S + 5.08, z - 0.06], [x + 0.06, S + 5.3, z + 0.06], iron, { collide: false });
    b.lamp(x, S + 5, z, { color: 0xffb469, power: 80, range: 22, size: 0.4 });
  };
  streetLamp(-6, 16);
  streetLamp(6.5, -12);
  streetLamp(16, 0);
  streetLamp(36, -4);
  b.lamp(26, T - 0.4, -14, { color: 0xffd9a8, power: 40, range: 14, size: 0.4 });
  b.lamp(26, R - 0.4, -14, { color: 0xffd9a8, power: 35, range: 14, size: 0.4 });
  b.lamp(27, L1 - 0.4, -12, { color: 0xffd9a8, power: 35, range: 14, size: 0.4 });

  const bounds = new THREE.Box3(new THREE.Vector3(-45, 0, -35), new THREE.Vector3(45, 21, 35));
  dress(new Dresser(b, 202), bounds);
  const level = await b.finish(scene, gl, ENV.dusk, bounds);
  return worldFromLevel('saltmarket', level, {
    bounds,
    spawn: SALTMARKET.spawn,
    spawnYaw: -Math.PI / 4,
    navGround: [],
    menuCam: { center: [0, 8, -4], radius: 44, height: 30 },
  });
}

/** The few flat colours the dressing paints with (each colour is one cached material). */
const C = {
  iron: 0x2e3236, steelGrey: 0x7d8488, wood: 0x6b4a2f, woodLight: 0x9a7a50, cream: 0xe8e2d0, paper: 0xd8d3c4,
  red: 0xb5452c, blue: 0x2f6f8f, ochre: 0xc79a2a, green: 0x3f6b3a, darkGreen: 0x23332a, rubber: 0x161616,
  glass: 0x1b2328, cork: 0x8a6440, canvas: 0x56614a, algae: 0x1f2b1a,
};

/** Shop names painted on the fascia boards, in the order the shop fronts come. */
const SHOP_NAMES = [
  'MARR GROCERS', 'HALLOWAY FISH', 'WARD 4 CHEMIST', 'TIDEWATER BAKERY', 'KEMP HARDWARE', 'NEWS & TOBACCO',
  'NET LOFT', 'DUNMORE TAILOR', 'PAWN & LOAN', 'LAUNDERETTE', 'NOODLE HOUSE', 'BARBER', 'LOCKSMITH',
  'RADIO REPAIRS', 'PIE & MASH', 'SALT ROW WINES', 'BOOKMAKER', 'CANAL CAFE',
];

/** Centres of the shops `Dresser.shopfronts` lays along a facade from a to c (same arithmetic). */
function shopSlots(a: number, c: number, w = 3.2): number[] {
  const n = Math.floor((c - a - 1) / (w + 1));
  const pad = (c - a - n * w) / (n + 1);
  return Array.from({ length: Math.max(0, n) }, (_, i) => a + pad + i * (w + pad) + w / 2);
}

/** A lived-in market district at the end of the day: shops shutting, washing lines, rubbish, the city around it. */
function dress(d: Dresser, bounds: THREE.Box3): void {
  const b = d.b;
  const paint = (color: number, rough = 0.85, metal = 0): THREE.Material => b.flat(color, rough, metal);
  /** A visual-only box. */
  const deco = (min: V3, max: V3, color: number, rough = 0.85, metal = 0): void => {
    // Corners in either order (pieces facing the other way flip their offsets)
    const lo: V3 = [Math.min(min[0], max[0]), Math.min(min[1], max[1]), Math.min(min[2], max[2])];
    const hi: V3 = [Math.max(min[0], max[0]), Math.max(min[1], max[1]), Math.max(min[2], max[2])];
    b.box(lo, hi, paint(color, rough, metal), { collide: false, shadow: false });
  };
  /** A solid prop, only if it touches nothing solid already there. */
  const solid = (id: PropId, x: number, y: number, z: number, rot = 0, scale = 1): void => {
    if (!b.blocked(b.propBox(id, x, y, z, rot, scale))) b.prop(id, x, y, z, rot, { scale });
  };
  const free = (min: V3, max: V3): boolean => !b.blocked(new THREE.Box3(new THREE.Vector3(...min), new THREE.Vector3(...max)));
  const prop = (id: PropId, x: number, y: number, z: number, rot = 0, scale = 1): void => {
    b.prop(id, x, y, z, rot, { collide: false, scale });
  };

  // Every label shares one 2048 px atlas, packed in rows in the order drawn: queue them all and draw
  // the tall ones first, so the rows pack tight
  const labels: [number, () => void][] = [];
  const q = (rows: number, draw: () => void): void => {
    labels.push([rows, draw]);
  };

  d.skyline(bounds, { near: 8, far: 140, h: [10, 44], lit: 0.35, count: 90 });

  // --- Building fronts. [x0, z0, x1, z1, top, faces against the district wall, shop fronts]
  const blocks: [number, number, number, number, number, Face[], Face[]][] = [
    [-44, -34, -38, -16, R, ['-x', '-z'], ['+x', '+z']],
    [-32, -34, -10, -20, R, ['-z'], ['+z', '+x']],
    [-44, -10, -40, 8, R, ['-x'], ['+x']],
    [-32, 22, -10, 34, 9, ['+z'], ['-z']],
    [38, -34, 45, -2, R, ['+x', '-z'], ['-x', '+z']],
    [6, -34, 12, -29, 9, ['-z'], []],
    [6, 24, 14, 34, 9, ['+z'], ['-x']],
    [20, 22, 45, 34, 9, ['+z', '+x'], ['-z']],
    [38, 2, 45, 18, R, ['+x'], ['-x']],
  ];
  const faceAt = (f: Face, x0: number, z0: number, x1: number, z1: number): [number, number, number] => {
    const at = f === '-x' ? x0 : f === '+x' ? x1 : f === '-z' ? z0 : z1;
    const [a, c] = f[1] === 'x' ? [z0, z1] : [x0, x1];
    return [at, a, c];
  };
  let shop = 0;
  /** Shop fronts with a name painted on every other fascia board. */
  const shops = (f: Face, at: number, a: number, c: number, open: number): void => {
    d.shopfronts(f, at, a, c, S, { open });
    const out = f[0] === '+' ? 1 : -1;
    for (const u of shopSlots(a, c)) {
      if (shop++ % 4 !== 1) continue;
      const name = SHOP_NAMES[(shop >> 2) % SHOP_NAMES.length];
      q(1, () => d.stencil(f, at + out * 0.14, u, S + 3.0, name, { h: 0.4, color: '#efe6cf', opacity: 0.9 }));
    }
  };
  for (const [x0, z0, x1, z1, top, skip, fronts] of blocks) {
    d.block(x0, z0, x1, z1, S, top, { skip, lit: 0.4, skipGround: fronts.length > 0, ac: 3 });
    for (const f of (['-x', '+x', '-z', '+z'] as Face[]).filter((g) => !skip.includes(g))) {
      const [at, a, c] = faceAt(f, x0, z0, x1, z1);
      d.streaks(f, at, a, c, S, top, Math.round((c - a) / 3));
    }
    for (const f of fronts) {
      const [at, a, c] = faceAt(f, x0, z0, x1, z1);
      shops(f, at, a, c, 0.35);
    }
  }
  // T4: its roof is the way across, so no roof clutter; shops on the canal street
  d.block(18, 2, 34, 16, S, R, { roof: false, lit: 0.35, skipGround: true, skip: [] });
  shops('-x', 18, 2, 16, 0.5);
  shops('+z', 16, 18, 34, 0.3);
  d.streaks('-x', 18, 2, 16, S, R, 5);
  d.streaks('+z', 16, 18, 34, S, R, 5);
  // The safehouse: grime on the brick, gutter pipes, blind windows on the fire-escape side
  d.pipe([17.7, S, -6.3], [17.7, T + 0.2, -6.3], 0.07, 0x4c5054);
  d.pipe([34.3, S, -21.7], [34.3, T + 0.2, -21.7], 0.07, 0x4c5054);
  d.wallProp('exterior_aircon_unit', '+x', 34.15, -18, L1 + 0.3, { collide: false });
  d.wallProp('exterior_aircon_unit', '-z', -22.15, 30, R - 1, { collide: false });
  d.windows('-z', -22.15, 18, 34, S, T, { lit: 0.25, floor: 4.5, sill: 1.1 });
  for (const [f, at, a, c] of [['-z', -22.15, 18, 34], ['+x', 34.15, -22, -6], ['+z', -5.85, 18, 34], ['-x', 17.85, -22, -6]] as const) {
    d.streaks(f, at, a, c, S, T, 7);
  }

  // --- Street names, house numbers, posters and the faction's paint
  const plate = { h: 0.3, bg: '#1f3a5a', fg: '#f0ece0', border: '#f0ece0', font: '700 56px "Arial Narrow", Arial, sans-serif' };
  q(1, () => d.sign('-x', 17.85, -8, S + 3.4, 'CANAL STREET', plate));
  q(1, () => d.sign('+z', -5.85, 21, S + 3.4, 'TIDEWATER ROW', plate));
  q(1, () => d.sign('+x', -10, -21.2, S + 3.8, 'MARKET LANE', plate));
  q(1, () => d.sign('+x', -40, 6.5, S + 3.8, 'SALT ROW', plate));
  q(1, () => d.sign('-x', -32, 23.5, S + 3.4, 'HALL SQUARE', plate));
  const poster = (f: Face, at: number, along: number, y: number, lines: string[], bg: string, fg = '#1c1c1c'): void => {
    d.sign(f, at, along, y, lines[0], { lines, h: 0.32 * lines.length, bg, fg, plate: false });
  };
  // On the district wall by the square where the player comes in
  q(3, () => poster('+x', -44.6, 12, S + 1.4, ['STORM WARNING', 'TIDE 4.2 M', 'KEEP OFF THE QUAYS'], '#e8dcc0'));
  q(3, () => poster('+x', -44.6, 14.4, S + 1.2, ['LOW WATER', 'THE WARDS LOOK', 'AFTER THEIR OWN'], '#1d2a24', '#e4c76a'));
  q(2, () => poster('+x', -44.6, 31, S + 1.3, ['EVACUATION ROUTE', 'WARD 4 > HIGH STREET'], '#f2f0e8', '#8a2a1c'));
  q(2, () => poster('+x', -44.6, 33, S + 1.6, ['LOST DOG', 'ASK AT No 14'], '#f0eadc'));
  q(1, () => d.stencil('+x', -44.6, 22, S + 0.6, 'LOW WATER', { h: 0.9, color: '#c8a23a', opacity: 0.75 }));
  // Behind the safehouse, along the north wall, and the south wall's open stretches
  q(1, () => d.stencil('+z', -34.6, 36, S + 0.9, 'WARD 4 STAYS', { h: 0.6, color: '#d8d2bf', opacity: 0.7 }));
  q(1, () => d.stencil('-z', 34.6, -38, S + 0.7, 'WARD 4', { h: 0.8, color: '#d8d2bf', opacity: 0.6 }));
  q(1, () => d.stencil('-z', 34.6, 17, S + 0.8, 'LOW WATER', { h: 0.8, color: '#c8a23a', opacity: 0.7 }));

  // --- Market hall: stalls by trade, with produce, scales and prices; signs on the fascia
  const hallSign = { h: 0.75, bg: '#23332a', fg: '#e8dcb0', border: '#c8a23a', font: '700 64px Georgia, serif' };
  q(1, () => d.sign('+x', -11.98, -2.5, R - 1.2, 'SALTMARKET HALL', hallSign));
  q(1, () => d.sign('-z', -12.02, -23, R - 1.2, 'SALTMARKET HALL', hallSign));
  type Trade = { name: string; price: string; colors: number[]; tray: number; item: [number, number, number] };
  const trades: Trade[] = [
    { name: 'MARR & SONS', price: 'ORANGES 1.20', colors: [0xe07a1f, 0xd9681a, 0xeb8f2a], tray: C.wood, item: [0.09, 0.09, 0.09] },
    { name: 'HALLOWAY FISH', price: 'COD 4.80 / KG', colors: [0x9aa3a8, 0x7d878c, 0xb5bcc0], tray: 0xdfe8ec, item: [0.32, 0.05, 0.09] },
    { name: 'GREENS', price: 'CABBAGE 0.90', colors: [0x4f7a32, 0x6b8f3a, 0x3d6628], tray: C.wood, item: [0.14, 0.12, 0.14] },
    { name: 'TIDEWATER BREAD', price: 'LOAF 1.60', colors: [0xb07a3c, 0x9a6530, 0xc48c48], tray: C.woodLight, item: [0.26, 0.1, 0.13] },
    { name: 'SPICE & SALT', price: 'SALT 0.50 / BAG', colors: [0xb5452c, 0xc79a2a, 0x8a5a2a], tray: C.woodLight, item: [0.12, 0.1, 0.12] },
    { name: 'APPLES', price: 'APPLES 1.40', colors: [0xa8281e, 0x8f2a1c, 0x7a9a32], tray: C.wood, item: [0.09, 0.09, 0.09] },
  ];
  const chalk = { h: 0.26, bg: '#1f2522', fg: '#ece6d6', font: 'italic 600 56px Georgia, serif' };
  let ti = 0;
  for (const x of [-29, -23, -17]) {
    for (const z of [-5, 5]) {
      const t = trades[ti++];
      const toAisle = z < 0 ? 1 : -1;
      const front: Face = z < 0 ? '+z' : '-z';
      const top = S + 1.1;
      // Produce in trays along the front of the counter
      for (const u of [-1.2, -0.4, 0.4, 1.2]) {
        const tz = z + toAisle * 0.4;
        deco([x + u - 0.32, top, tz - 0.24], [x + u + 0.32, top + 0.07, tz + 0.24], t.tray);
        const [w, h, dd] = t.item;
        for (let k = 0; k < 9; k++) {
          const px = x + u + d.rand(-0.24, 0.24) , pz = tz + d.rand(-0.16, 0.16);
          const py = top + 0.07 + (k > 5 ? h : 0);
          deco([px - w / 2, py, pz - dd / 2], [px + w / 2, py + h, pz + dd / 2], d.pick(t.colors), 0.7);
        }
      }
      // Scales on the vendor's side, a price board on the counter front, the stall's name under the awning
      const sx = x + 1.25, sz = z - toAisle * 0.5;
      deco([sx - 0.13, top, sz - 0.1], [sx + 0.13, top + 0.06, sz + 0.1], 0xd8d8d0, 0.4, 0.3);
      deco([sx - 0.015, top + 0.06, sz - 0.015], [sx + 0.015, top + 0.3, sz + 0.015], 0x9a9d9e, 0.4, 0.6);
      d.cyl([sx, top + 0.3, sz], 0.14, 0.02, paint(0xb8bcbe, 0.3, 0.7), 14);
      deco([sx - 0.07, top + 0.08, sz + toAisle * 0.1], [sx + 0.07, top + 0.2, sz + toAisle * 0.105], C.cream, 0.5);
      q(1, () => d.sign(front, z + toAisle * 0.8, x - 0.6, S + 0.55, t.price, chalk));
      q(1, () => d.sign(front, z + toAisle * 1.2, x, S + 2.12, t.name, { h: 0.34, bg: '#e8dcc0', fg: '#2a2620', font: '700 60px Georgia, serif' }));
      if (ti % 3 === 1) prop('CashRegister_01', x - 1.3, top, z - toAisle * 0.45, z < 0 ? 0 : Math.PI, 0.6);
      prop('wicker_basket_01', x + d.rand(-1.2, 1.2), S, z + toAisle * 1.05, d.rand(0, 6));
    }
  }
  // Pallets of sacks in the corners, chalkboards out in the aisle, a market break corner
  for (const [x, z, r] of [[-32.6, -10.2, 0], [-13.4, 10.2, 0.2], [-13.4, -10.3, 1.57]] as const) {
    if (free([x - 0.7, S + 0.05, z - 0.7], [x + 0.7, S + 1, z + 0.7])) d.pallet(x, S, z, r, 'sacks');
  }
  for (const [x, z, r] of [[-26, -2.4, 0.3], [-20, 2.4, Math.PI + 0.2], [-31.6, 0.8, -1.4]] as const) prop('standing_chalkboard_01', x, S, z, r);
  prop('wooden_crate_02', -32.2, S, 9.2, 0.05, 1.3);
  prop('plastic_monobloc_chair_01', -33.1, S, 8.4, 1.2);
  prop('plastic_monobloc_chair_01', -31.2, S, 9.9, -2.2);
  prop('vintage_radio_transceiver', -32.3, S + 0.6, 9.0, 0.3, 0.45);
  for (const [x, z] of [[-32.0, 9.6], [-31.85, 9.35]] as const) d.cyl([x, S + 0.6, z], 0.04, 0.1, paint(C.cream, 0.5), 8);
  d.puddles([-33, -11, -13, 11], S, 4, [0.6, 1.4]);
  d.stains([-33, -11, -13, 11], S, 10, 0x2a3a1a, 0.35, [0.2, 0.6]); // trodden leaves

  // --- West bank: the canal cafe under its awning, a bike rack, a phone box on the square
  const cafeZ = -20;
  for (let x = -30; x < -20.5; x += 0.5) deco([x, S + 2.8, cafeZ], [x + 0.5, S + 2.88, cafeZ + 2.4], (x * 2) % 2 === 0 ? C.red : C.cream, 0.9);
  deco([-30, S + 2.55, cafeZ + 2.38], [-20.5, S + 2.8, cafeZ + 2.42], C.red, 0.9);
  for (const x of [-28.6, -25.4, -22.4]) {
    const z = cafeZ + 2.7 + d.rand(-0.2, 0.2);
    prop('wooden_table_02', x, S, z, d.rand(-0.1, 0.1));
    prop('dining_chair_02', x - 0.8, S, z + d.rand(-0.1, 0.1), Math.PI / 2 + d.rand(-0.3, 0.3));
    prop('dining_chair_02', x + 0.8, S, z + d.rand(-0.1, 0.1), -Math.PI / 2 + d.rand(-0.3, 0.3));
    d.cyl([x + d.rand(-0.3, 0.3), S + 0.8, z + d.rand(-0.15, 0.15)], 0.04, 0.09, paint(C.cream, 0.5), 8);
  }
  prop('standing_chalkboard_01', -20.2, S, cafeZ + 2.2, -0.4);
  d.wallProp('wall_clock', '+z', cafeZ, -27.3, S + 2.2);
  // Bike rack against the hall square block, three bikes in it
  const bike = (x: number, z: number, color: number): void => {
    const tyre = paint(C.rubber, 0.9);
    for (const k of [-0.5, 0.5]) {
      const g = new THREE.TorusGeometry(0.31, 0.025, 6, 16);
      g.rotateY(Math.PI / 2);
      g.translate(x, S + 0.335, z + k);
      b.geo(g, tyre);
    }
    const tube = (k0: number, y0: number, k1: number, y1: number): void => d.pipe([x, S + y0, z + k0], [x, S + y1, z + k1], 0.016, color, { brackets: false });
    tube(-0.5, 0.335, -0.05, 0.36);
    tube(-0.5, 0.335, -0.2, 0.8);
    tube(-0.05, 0.36, -0.2, 0.82);
    tube(-0.2, 0.8, 0.38, 0.8);
    tube(-0.05, 0.36, 0.38, 0.8);
    tube(0.38, 0.8, 0.5, 0.335);
    deco([x - 0.06, S + 0.84, z - 0.3], [x + 0.06, S + 0.88, z - 0.1], C.rubber);
    deco([x - 0.25, S + 0.9, z + 0.37], [x + 0.25, S + 0.93, z + 0.41], C.iron, 0.5, 0.6);
  };
  for (const x of [-16, -14.5, -13]) d.pipe([x, S, 21.6], [x, S + 0.7, 21.6], 0.025, 0x8a8f94, { brackets: false });
  d.pipe([-16, S + 0.7, 21.6], [-13, S + 0.7, 21.6], 0.025, 0x8a8f94, { brackets: false });
  bike(-15.6, 21.1, C.blue);
  bike(-14.2, 21.15, C.red);
  bike(-12.9, 21.0, C.darkGreen);
  // Phone box on the square, against the block's flank
  const phone = (x0: number, z0: number): void => {
    const x1 = x0 + 1.1, z1 = z0 + 1.1, top = S + 2.4;
    if (!free([x0, S + 0.05, z0], [x1, top, z1])) return;
    for (const [px, pz] of [[x0, z0], [x1 - 0.08, z0], [x0, z1 - 0.08], [x1 - 0.08, z1 - 0.08]] as const) deco([px, S, pz], [px + 0.08, top, pz + 0.08], 0x8a2a1c, 0.6);
    deco([x0 + 0.08, S + 0.9, z0 + 0.04], [x1 - 0.08, top - 0.3, z0 + 0.06], C.glass, 0.1);
    deco([x0 + 0.08, S + 0.9, z1 - 0.06], [x1 - 0.08, top - 0.3, z1 - 0.04], C.glass, 0.1);
    deco([x0 + 0.04, S + 0.9, z0 + 0.08], [x0 + 0.06, top - 0.3, z1 - 0.08], C.glass, 0.1);
    deco([x0, S, z0], [x1, S + 0.9, z0 + 0.04], 0x8a2a1c, 0.6);
    deco([x0, S, z1 - 0.04], [x1, S + 0.9, z1], 0x8a2a1c, 0.6);
    deco([x0 - 0.04, top, z0 - 0.04], [x1 + 0.04, top + 0.18, z1 + 0.04], 0x8a2a1c, 0.6);
    deco([x1 - 0.2, S + 1.3, z0 + 0.35], [x1 - 0.02, S + 1.75, z0 + 0.75], C.iron, 0.5, 0.4); // the phone
    b.box([x0 + 0.3, top - 0.08, z0 + 0.3], [x1 - 0.3, top - 0.02, z1 - 0.3], b.glow(0xfff0d0, 1.4), { collide: false, shadow: false });
    q(1, () => d.sign('-x', x0 - 0.02, (z0 + z1) / 2, top - 0.25, 'TELEPHONE', { h: 0.2, w: 0.95, bg: '#f2efe6', fg: '#1c1c1c', plate: false }));
    b.colliders.push(new THREE.Box3(new THREE.Vector3(x0, S, z0), new THREE.Vector3(x1, top + 0.18, z1)));
  };
  phone(-33.15, 29.4);

  // --- East bank: the news kiosk on the corner, a power cabinet, a bench by the safehouse
  const kiosk = (x0: number, z0: number): void => {
    const x1 = x0 + 2.4, z1 = z0 + 1.2, top = S + 2.3;
    if (!free([x0, S + 0.05, z0], [x1, top, z1])) return;
    b.box([x0, S, z0], [x1, top, z1], paint(C.darkGreen, 0.7));
    deco([x0 - 0.1, top, z0 - 0.1], [x1 + 0.1, top + 0.12, z1 + 0.6], C.darkGreen, 0.7);
    deco([x0 + 0.1, S + 0.9, z1], [x1 - 0.1, S + 1.0, z1 + 0.35], C.woodLight); // counter
    deco([x0 + 0.15, S + 1.0, z1 - 0.01], [x1 - 0.15, S + 2.0, z1 + 0.01], 0x3a2e22);
    // Papers and magazines on the counter and a rack on the front
    for (let i = 0; i < 9; i++) {
      const u = x0 + 0.25 + i * 0.24;
      deco([u, S + 1.0, z1 + 0.05], [u + 0.2, S + 1.02, z1 + 0.3], d.pick([C.paper, C.cream, C.red, C.blue, C.ochre]), 0.9);
      deco([u, S + 0.3 + (i % 2) * 0.3, z1 + 0.01], [u + 0.2, S + 0.56 + (i % 2) * 0.3, z1 + 0.03], d.pick([C.paper, C.red, C.blue, C.ochre]), 0.9);
    }
    q(1, () => d.sign('+z', z1 + 0.6, (x0 + x1) / 2, top - 0.02, 'NEWS', { h: 0.3, bg: '#e8dcb0', fg: '#23332a', plate: false }));
    q(1, () => d.sign('+z', z1 + 0.02, x0 + 0.9, S + 1.5, 'SURGE TONIGHT', { h: 0.2, bg: '#f2f0e8', fg: '#8a2a1c', plate: false }));
  };
  kiosk(7.2, -28.9);
  solid('power_box_01', 33.4, S, -5.62, 0);
  prop('painted_wooden_bench', 36.5, S, -1.3, Math.PI);

  // --- Canal: rings, ladders and lifebuoys on the quays, a moored boat, weed at the waterline
  const canalWall = (side: -1 | 1): number => side * 4;
  const ringMat = paint(C.iron, 0.5, 0.6);
  for (const side of [-1, 1] as const) {
    const x = canalWall(side);
    const face: Face = side < 0 ? '+x' : '-x';
    d.streaks(face, x, -35, 35, 0, S, 22, { color: 0x15180f, opacity: 0.55 });
    deco([x - side * 0.02 - 0.01, 1.15, -35], [x - side * 0.02 + 0.01, 1.45, 35], C.algae, 0.95);
    for (let z = -32; z <= 32; z += 6.5) {
      if ([-20, 0, 20].some((zb) => Math.abs(z - zb) < 2) || (side < 0 ? z > 24.5 && z < 31 : z > -31 && z < -24.5)) continue; // bridges, steps
      const g = new THREE.TorusGeometry(0.09, 0.016, 6, 12);
      g.rotateY(Math.PI / 2);
      g.translate(x - side * 0.05, 1.85, z);
      b.geo(g, ringMat);
      deco([x - side * 0.03 - 0.02, 1.9, z - 0.05], [x - side * 0.03 + 0.02, 2.0, z + 0.05], C.iron, 0.5, 0.6);
    }
    // An iron ladder down to the water
    const lz = side < 0 ? -25 : 11;
    for (const dz of [-0.22, 0.22]) deco([x - side * 0.12 - 0.02, 0, lz + dz - 0.02], [x - side * 0.12 + 0.02, S + 0.9, lz + dz + 0.02], C.iron, 0.5, 0.6);
    for (let y = 0.3; y < S; y += 0.3) deco([x - side * 0.12 - 0.015, y, lz - 0.22], [x - side * 0.12 + 0.015, y + 0.03, lz + 0.22], C.iron, 0.5, 0.6);
    // Lifebuoys on posts by the rail
    for (const z of side < 0 ? [-27.5, 14.5] : [-6, 27.5]) {
      const px = x + side * 0.4;
      deco([px - 0.04, S, z - 0.04], [px + 0.04, S + 1.6, z + 0.04], 0xb5452c, 0.6);
      prop('lifebuoy', px + side * 0.06, S + 0.55, z, side < 0 ? -Math.PI / 2 : Math.PI / 2);
    }
    // Quay bollards (solid, tight to the rail) and benches looking over the water
    for (const z of side < 0 ? [-15, 5.5, 23] : [-9.5, 16.5]) {
      const bx = x + side * 0.45;
      if (free([bx - 0.25, S + 0.05, z - 0.25], [bx + 0.25, S + 0.7, z + 0.25])) d.bollard(bx, S, z, 'mooring');
    }
    for (const z of side < 0 ? [-11.5, 8.5, 29.5] : [-13.5, 13.5, 26]) prop('painted_wooden_bench', x + side * 0.95, S, z, side < 0 ? Math.PI / 2 : -Math.PI / 2);
  }
  // A small boat tied up under the west quay, a tarp over its load
  const boat = (x0: number, z0: number, len: number): void => {
    const x1 = x0 + 1.7, z1 = z0 + len, y = 0.95;
    deco([x0, y, z0 + 0.5], [x1, y + 0.55, z1], 0x2f4a52, 0.6);
    deco([x0 + 0.25, y + 0.05, z0], [x1 - 0.25, y + 0.55, z0 + 0.5], 0x2f4a52, 0.6);
    deco([x0 - 0.03, y + 0.5, z0 + 0.5], [x1 + 0.03, y + 0.62, z1], C.woodLight);
    deco([x0 + 0.1, y + 0.4, z1 - 1.2], [x1 - 0.1, y + 0.46, z1 - 0.95], C.wood); // thwart
    deco([x0 + 0.2, y + 0.4, z0 + 0.7], [x1 - 0.2, y + 0.95, z0 + 2.2], C.canvas, 0.95); // tarp
    deco([(x0 + x1) / 2 - 0.15, y + 0.3, z1], [(x0 + x1) / 2 + 0.15, y + 1.0, z1 + 0.3], 0x2a2c2e, 0.5, 0.4); // outboard
    d.cable([(x0 + x1) / 2, y + 0.6, z0], [-4.45, S + 0.6, -15], 0.4, 0.015);
  };
  boat(-3.3, -13.6, 4.6);
  // Bits floating in the water
  for (let i = 0; i < 14; i++) {
    const x = d.rand(-3.4, 3.4), z = d.rand(-34, 34);
    if ([-20, 0, 20].some((zb) => Math.abs(z - zb) < 1.5) || (x < -1.4 && z > -14 && z < -8.5)) continue;
    const s = d.rand(0.08, 0.35);
    deco([x - s, 1.28, z - s * 0.4], [x + s, 1.33, z + s * 0.4], d.pick([C.paper, C.woodLight, 0x3a5a3a, C.cream]), 0.9);
  }

  // --- Street furniture: hydrants, more lamp standards (no light of their own), crossings
  for (const [x, z, r] of [[-37.4, -15.4, 0.4], [-9.4, -19.4, 0], [17.3, -5.3, 1.2], [37.4, 1.4, 0.2], [14.6, 23.4, 2.0], [-31.4, 21.4, 0]] as const) prop('fire_hydrant', x, S, z, r);
  for (const [x, z, dir] of [[-5.2, -7, '+x'], [5.2, 8.5, '-x'], [-5.2, 32.6, '+x'], [17.4, -30.5, '-x'], [-34.8, -14.5, '+z']] as const) {
    if (free([x - 0.12, S + 0.05, z - 0.12], [x + 0.12, S + 5, z + 0.12])) d.lampPost(x, z, S, dir, { h: 5 });
  }
  // Zebra crossings: stripes run with the traffic
  for (let x = 5.4; x < 17.2; x += 0.9) d.line(x, -3.6, x, -1.3, S, { w: 0.45, color: 0xd8d2bf });
  for (let z = -19.3; z < -12.6; z += 0.9) d.line(-18.2, z, -15.8, z, S, { w: 0.45, color: 0xd8d2bf });
  d.line(11, -27, 11, 22, S, { dash: 2, gap: 2, color: 0xd8d2bf });
  q(1, () => d.floorText(-9.4, S, -4, 'LOADING', '+x', { h: 0.9 }));
  d.hazard(-11.2, -7, -11.2, -1, S, 0.25);
  // Junction boxes, meters and conduit on the street walls
  for (const [f, at, along] of [['-x', 18, 11.15], ['-x', 38, -7], ['+x', -10, -24.85], ['-z', 22, 25.45], ['+x', -40, -5.24], ['+z', -20, -14.7]] as const) {
    d.wallBox(f, at, along, S + 1.0, 0.45, 0.6, 0.18, C.steelGrey, { glow: 0x7fff6a });
    const out = f[0] === '+' ? 0.08 : -0.08;
    if (f[1] === 'x') d.pipe([at + out, S + 1.6, along], [at + out, S + 4.5, along], 0.025, 0x55595d, { brackets: false });
    else d.pipe([along, S + 1.6, at + out], [along, S + 4.5, at + out], 0.025, 0x55595d, { brackets: false });
  }

  // --- Streets: rubbish, stains, weeds in the cracks, bins against the walls
  const west: [number, number, number, number] = [-44.5, -34.5, -4.5, 34.5];
  const east: [number, number, number, number] = [4.5, -34.5, 44.5, 34.5];
  for (const r of [west, east]) {
    d.stains(r, S, 40, 0x0c0b0a, 0.45);
    d.stains(r, S, 14, 0x1d262b, 0.3, [1.5, 3.5]);
    d.debris(r, S, 150, { paper: 0.5 });
    d.scatter(r, S, 30, [
      ['trashbag', 5], ['metal_trash_can', 3, { collide: true }], ['cardboard_box_01', 3], ['plastic_crate_03', 2],
      ['old_tyre', 1], ['plastic_monobloc_chair_01', 1], ['Barrel_02', 1, { collide: true }], ['hand_truck', 1],
    ]);
  }
  for (const r of [[-5, -34.5, -4.1, 34.5], [4.1, -34.5, 5, 34.5], [-44.5, 8.5, -43.6, 34.5], [14, -34.5, 37.5, -33.8]] as const) {
    d.scatter([...r], S, 14, [['shrub_04', 1, { scale: 1.1 }]]);
  }
  for (const [x, z] of [[-24, 18], [-6, -14], [10, 0], [26, 19], [14, -24], [-38, -6]] as const) b.prop('water_manhole_cover', x, S, z, d.rand(0, 6), { collide: false });
  // Canal: grime at the waterline
  d.stains([-3.8, -34.5, 3.8, 34.5], 0, 20, 0x0d1a12, 0.5, [1, 3]);

  // --- Market hall: stock crates behind the stalls, sacks and bins round them
  for (const x of [-29, -23, -17]) {
    for (const z of [-5, 5]) {
      for (let i = 0; i < 3; i++) b.prop(d.pick(['plastic_crate_03', 'cardboard_box_01'] as const), x - 1 + i, S, z + (z < 0 ? -1.05 : 1.05), d.rand(-0.3, 0.3), { collide: false, scale: 0.9 });
      b.prop('plastic_monobloc_chair_01', x + d.rand(-1, 1), S, z + (z > 0 ? 1.6 : -1.6), d.rand(0, 6), { collide: false });
    }
  }
  d.scatter([-33.5, -11.5, -12.5, 11.5], S, 16, [['trashbag', 3], ['cardboard_box_01', 3], ['plastic_crate_03', 2], ['cement_bag', 1]]);
  d.debris([-33.5, -11.5, -12.5, 11.5], S, 80, { paper: 0.6 });
  d.stains([-33.5, -11.5, -12.5, 11.5], S, 16, 0x15110c, 0.4);
  // Strings of bulbs between the columns
  for (const z of [-8, 0, 8]) d.cables([[[-34, R - 0.8, z], [-12, R - 0.8, z]]], 1);

  dressSafehouse(d, { deco, prop, solid, free, q });

  // --- Overhead: power and phone lines across the streets and the canal, washing lines
  d.cables([
    [[-10, 9.5, -24], [6, 8.5, -31]], [[-10, 8.5, 28], [6, 8.5, 28]], [[-10, 10, -21], [18, 10.5, -10]],
    [[-38, 10, -20], [-38, 10, -10]], [[-40, 9.5, 8], [-32, 8.5, 22]], [[12, 8.5, -29.2], [18, 10, -21.8]],
    [[14, 8.5, 24], [20, 8.5, 22]], [[38, 10, -2], [38, 10, 2]], [[34, 10, 16], [38, 10, 18]],
  ], 3);
  const washing = [C.paper, 0x8a3a2a, C.blue, C.ochre, 0x4a4f55, C.cream];
  const laundry = (a: V3, c: V3): void => {
    d.cable(a, c, 0.3, 0.006);
    const alongX = Math.abs(c[0] - a[0]) > Math.abs(c[2] - a[2]);
    const [u0, u1] = alongX ? [a[0], c[0]] : [a[2], c[2]];
    for (let u = u0 + 0.8; u < u1 - 0.5; u += d.rand(0.5, 1.1)) {
      const y0 = a[1] - 0.75 - d.rand(0, 0.2), y1 = a[1] - 0.1, w = d.rand(0.18, 0.3);
      const v = alongX ? a[2] : a[0];
      if (alongX) b.box([u - w, y0, v - 0.01], [u + w, y1, v + 0.01], paint(d.pick(washing), 0.95), { collide: false });
      else b.box([v - 0.01, y0, u - w], [v + 0.01, y1, u + w], paint(d.pick(washing), 0.95), { collide: false });
    }
  };
  laundry([-44, 7.6, -16.5], [-38, 7.6, -16.5]);
  laundry([20, 8, 16.3], [34, 8, 16.3]);
  laundry([38, 7.4, 18.3], [45, 7.4, 18.3]);
  laundry([-42, 8.2, -16], [-42, 8.2, -10]);
  laundry([-39, 7.2, -16], [-39, 7.2, -10]);
  laundry([41, 8.6, -2], [41, 8.6, 2]);

  labels.sort((a, c) => c[0] - a[0]).forEach(([, draw]) => draw());
}

type Kit = {
  deco: (min: V3, max: V3, color: number, rough?: number, metal?: number) => void;
  prop: (id: PropId, x: number, y: number, z: number, rot?: number, scale?: number) => void;
  solid: (id: PropId, x: number, y: number, z: number, rot?: number, scale?: number) => void;
  free: (min: V3, max: V3) => boolean;
  /** Queue a label `rows` lines tall (see `labels` in dress). */
  q: (rows: number, draw: () => void) => void;
};

/**
 * T3 inside: a Ward 4 relief office run by volunteers who sleep on site. Ground floor: the
 * tenement hall with its letterboxes and meters, relief stock on pallets. First floor: camp beds
 * and a kitchen table. Top floor: the office itself, with the documents on the desk.
 */
function dressSafehouse(d: Dresser, k: Kit): void {
  const b = d.b;
  const { deco, prop, solid, free, q } = k;
  const N = -21.85, Sth = -6.15, W = 18.15, E = 33.85; // inner wall faces

  // Outside: the office's sign over the street door, its number, the intercom
  q(1, () => d.sign('+z', -5.85, 29, S + 2.62, 'WARD 4 RELIEF OFFICE', { h: 0.32, bg: '#f2efe6', fg: '#1f3a5a', border: '#1f3a5a' }));
  q(1, () => d.sign('+z', -5.85, 31.1, S + 1.7, '14', { h: 0.26, bg: '#1f3a5a', fg: '#f0ece0' }));
  d.wallBox('+z', -5.85, 30.55, S + 1.1, 0.16, 0.3, 0.05, 0x9a9d9e);
  d.cyl([31.6, S, -5.5], 0.22, 0.4, b.flat(C.iron, 0.6, 0.3), 12); // a planter by the door
  prop('shrub_04', 31.6, S + 0.4, -5.5, 0.4, 1.2);

  // --- Ground floor: tenement hall
  for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) {
    const x = 31.3 + i * 0.52, y = S + 1.05 + j * 0.34;
    d.wallBox('-z', Sth, x, y, 0.48, 0.3, 0.22, C.steelGrey);
    deco([x - 0.15, y + 0.2, Sth - 0.235], [x + 0.15, y + 0.23, Sth - 0.225], C.rubber);
  }
  q(1, () => d.sign('-z', Sth - 0.01, 32.08, S + 1.86, 'LETTERS', { h: 0.14, bg: '#d8d4c8', fg: '#1c1c1c', plate: false }));
  for (const z of [-8.2, -9.0, -9.8]) d.wallBox('-x', E, z, S + 1.5, 0.32, 0.45, 0.16, 0xb8b8b0, { glow: 0xff5a3a });
  d.wallBox('-x', E, -11, S + 1.3, 0.6, 0.85, 0.12, C.steelGrey);
  d.pipe([E - 0.06, S + 2.0, -8.2], [E - 0.06, L1 - 0.3, -8.2], 0.02, 0x55595d, { brackets: false });
  d.pipe([E - 0.06, S + 2.0, -11], [E - 0.06, L1 - 0.3, -11], 0.02, 0x55595d, { brackets: false });
  // Notice board by the door
  d.wallBox('-z', Sth, 26, S + 1.1, 1.5, 0.95, 0.03, C.cork);
  for (const [u, v, w, h, c] of [[-0.5, 0.15, 0.3, 0.4, C.paper], [-0.1, 0.4, 0.3, 0.35, 0xf2e08a], [0.3, 0.1, 0.35, 0.5, C.cream], [0.05, 0.05, 0.2, 0.25, 0xa8d0e6]] as const) {
    deco([26 + u - w / 2, S + 1.1 + v, Sth - 0.05], [26 + u + w / 2, S + 1.1 + v + h, Sth - 0.04], c, 0.95);
  }
  q(1, () => d.sign('-z', Sth - 0.01, 26, S + 2.12, 'RESIDENTS', { h: 0.16, bg: '#d8d4c8', fg: '#1c1c1c', plate: false }));
  q(2, () => d.sign('+x', W, -17.2, S + 1.5, 'RELIEF OFFICE', { lines: ['RELIEF OFFICE', 'TOP FLOOR  ^'], h: 0.5, bg: '#f2efe6', fg: '#1f3a5a', border: '#1f3a5a' }));
  // Relief stock on pallets
  for (const [x, load] of [[25.3, 'wrapped'], [27.0, 'boxes']] as const) {
    if (free([x - 0.62, S + 0.05, N + 0.25], [x + 0.62, S + 1.5, N + 1.3])) d.pallet(x, S, N + 0.8, 0, load);
  }
  q(1, () => d.sign('+z', N, 26.2, S + 1.9, 'WATER  BLANKETS  TINNED', { h: 0.2, bg: '#f2efe6', fg: '#1c1c1c', plate: false }));
  d.ceilingProp('mounted_fluorescent_lights', 26, L1 - 0.3, -17.5);
  d.ceilingProp('mounted_fluorescent_lights', 30.5, L1 - 0.3, -10.5);

  // --- First floor: where the volunteers sleep and eat
  const campBed = (x: number, y: number, z: number, alongX: boolean, bag: number): void => {
    const [hx, hz] = alongX ? [1.0, 0.38] : [0.38, 1.0];
    deco([x - hx, y + 0.32, z - hz], [x + hx, y + 0.38, z + hz], C.canvas, 0.95);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      deco([x + sx * (hx - 0.04) - 0.02, y, z + sz * (hz - 0.04) - 0.02], [x + sx * (hx - 0.04) + 0.02, y + 0.32, z + sz * (hz - 0.04) + 0.02], C.iron, 0.5, 0.5);
    }
    // Sleeping bag thrown back, a pillow at the head
    if (alongX) {
      deco([x - 0.55, y + 0.38, z - hz + 0.05], [x + hx - 0.05, y + 0.5, z + hz - 0.05], bag, 0.9);
      deco([x - hx + 0.08, y + 0.38, z - 0.25], [x - hx + 0.45, y + 0.5, z + 0.25], C.cream, 0.95);
    } else {
      deco([x - hx + 0.05, y + 0.38, z - 0.55], [x + hx - 0.05, y + 0.5, z + hz - 0.05], bag, 0.9);
      deco([x - 0.25, y + 0.38, z - hz + 0.08], [x + 0.25, y + 0.5, z - hz + 0.45], C.cream, 0.95);
    }
  };
  campBed(25.6, L1, N + 0.5, true, C.blue);
  campBed(28.4, L1, N + 0.5, true, 0x8a3a2a);
  campBed(E - 0.5, L1, -12.4, false, C.darkGreen);
  campBed(E - 0.5, L1, -18.6, false, C.ochre);
  // The long table is the kitchen: a camping stove, a kettle, mugs, bread, jerrycans of water
  const top = L1 + 1.0;
  deco([26.3, top, -17.8], [26.75, top + 0.12, -17.35], C.steelGrey, 0.5, 0.4);
  d.cyl([26.52, top + 0.12, -17.58], 0.09, 0.16, b.flat(0x9a9d9e, 0.35, 0.7), 12);
  for (const x of [27.2, 27.45, 27.75, 28.4]) d.cyl([x, top, -17.3 - (x % 0.5) * 0.4], 0.04, 0.09, b.flat(C.cream, 0.5), 8);
  deco([28.0, top, -17.85], [28.35, top + 0.1, -17.6], 0xb07a3c, 0.9);
  prop('vintage_radio_transceiver', 28.7, top, -17.6, Math.PI + 0.2, 0.42);
  for (const [x, z] of [[29.6, -21.4], [30.0, -21.45], [30.4, -21.35], [29.8, -20.95]] as const) prop('plastic_jerrycan', x, L1, z, d.rand(-0.3, 0.3));
  prop('cardboard_box_01', 31.0, L1, -21.4, 0.1);
  prop('cardboard_box_01', 31.05, L1 + 0.34, -21.4, -0.15);
  // A small table to eat at, and two chairs
  if (free([30.0, L1 + 0.05, -20.2], [31.2, L1 + 0.8, -19.4])) b.prop('wooden_table_02', 30.6, L1, -19.8, 0);
  prop('dining_chair_02', 30.6, L1, -20.65, 0);
  prop('dining_chair_02', 30.5, L1, -18.95, Math.PI + 0.3);
  q(2, () => d.sign('+z', N, 27, L1 + 1.6, 'WARD 4 VOLUNTEERS', { lines: ['WARD 4 VOLUNTEERS', 'SIGN IN  SIGN OUT'], h: 0.42, bg: '#f2efe6', fg: '#1f3a5a', plate: false }));
  d.wallProp('wall_clock', '-x', E, -20.6, L1 + 2.4);
  d.ceilingProp('mounted_fluorescent_lights', 29.5, R - 0.3, -19.5);
  d.debris([18.3, -21.7, 33.7, -6.3], L1, 30, { paper: 0.7 });
  d.scatter([18.3, -21.7, 33.7, -6.3], L1, 6, [['cardboard_box_01', 3], ['trashbag', 1], ['plastic_monobloc_chair_01', 2]]);

  // --- Top floor: the relief office
  d.desk(22, R, -19.5, '+z');
  d.desk(30.5, R, -14, '-x');
  // Cork board over the documents desk, a wall map of the Lower Wards beside it
  d.wallBox('+z', N, 28, R + 1.2, 2.6, 1.1, 0.03, C.cork);
  for (let i = 0; i < 11; i++) {
    const u = 26.9 + (i % 6) * 0.42 + d.rand(-0.05, 0.05), v = R + 1.3 + Math.floor(i / 6) * 0.48 + d.rand(-0.04, 0.04);
    deco([u - 0.14, v, N + 0.035], [u + 0.14, v + 0.38, N + 0.045], d.pick([C.paper, C.cream, 0xf2e08a, 0xa8d0e6]), 0.95);
  }
  q(2, () => d.sign('+z', N + 0.05, 28, R + 2.35, 'BUS ROTA', { lines: ['BUS ROTA', 'WARDS 3 4 5'], h: 0.3, bg: '#f2efe6', fg: '#1c1c1c', plate: false }));
  d.wallBox('+z', N, 24.8, R + 1.1, 2.0, 1.3, 0.02, 0xcfd6c8);
  deco([24.55, R + 1.15, N + 0.025], [24.75, R + 2.35, N + 0.03], 0x5a86a0, 0.8); // the canal
  for (const [u, v] of [[-0.6, 0.3], [0.5, 0.7], [-0.2, 0.9], [0.7, 0.2], [-0.8, 1.0]] as const) {
    deco([24.8 + u - 0.03, R + 1.1 + v - 0.03, N + 0.025], [24.8 + u + 0.03, R + 1.1 + v + 0.03, N + 0.04], 0xc0281e, 0.6);
  }
  for (const v of [0.35, 0.8]) deco([23.85, R + 1.1 + v, N + 0.022], [25.75, R + 1.12 + v, N + 0.027], 0x8a8f94, 0.8);
  q(1, () => d.sign('+z', N + 0.02, 24.8, R + 2.45, 'LOWER WARDS', { h: 0.18, bg: '#f2efe6', fg: '#1c1c1c', plate: false }));
  q(3, () => d.sign('-z', Sth, 31.2, R + 1.4, 'EVACUATION', { lines: ['WARD 4 EVACUATION', 'REGISTER HERE', 'BRING ID AND MEDICINES'], h: 0.6, bg: '#f2efe6', fg: '#8a2a1c', plate: false }));
  q(3, () => d.sign('+x', W, -18.0, R + 2.1, 'TIDE TABLE', { lines: ['TIDE TABLE  NOV', 'HW 04:12  4.2 M', 'HW 16:40  4.4 M'], h: 0.5, bg: '#e8eef2', fg: '#1f3a5a', plate: false }));
  // Furniture: a drawer cabinet and a bookshelf, a radio and a kettle, file boxes on the floor
  solid('drawer_cabinet', 32.4, R, N + 0.27, 0);
  solid('wooden_bookshelf_worn', E - 0.31, R, -19.2, -Math.PI / 2);
  prop('vintage_radio_transceiver', 29.05, R + 0.85, -20.85, -0.2, 0.42);
  d.cyl([26.9, R + 0.85, -20.75], 0.04, 0.1, b.flat(C.cream, 0.5), 8);
  d.cyl([26.0, R + 1.2, -8.2], 0.09, 0.18, b.flat(0x9a9d9e, 0.35, 0.7), 12);
  for (const x of [26.4, 26.65, 27.1]) d.cyl([x, R + 1.2, -8.15], 0.04, 0.09, b.flat(C.cream, 0.5), 8);
  for (const [x, z, h] of [[24.7, -21.45, 0], [24.75, -21.45, 0.34], [25.3, -21.5, 0], [19.2, -17.6, 0], [19.25, -17.6, 0.34]] as const) prop('cardboard_box_01', x, R + h, z, d.rand(-0.2, 0.2));
  d.wallProp('wall_clock', '+x', W, -15.8, R + 2.5);
  deco([24.6, R, -13.6], [27.9, R + 0.01, -11], 0x6a2a22, 0.95); // rug under the table
  for (const x of [25.6, 26.6]) prop('dining_chair_02', x, R, -13.9, d.rand(-0.3, 0.3));
  prop('dining_chair_02', 26.2, R, -10.7, Math.PI + d.rand(-0.3, 0.3));
  campBed(W + 0.55, R, -9.6, false, 0x4a4f55);
  d.ceilingProp('mounted_fluorescent_lights', 26, T - 0.3, -14);
  d.ceilingProp('mounted_fluorescent_lights', 28.5, T - 0.3, -19.8);
  d.ceilingProp('mounted_fluorescent_lights', 20, T - 0.3, -11);
  d.ceilingProp('mounted_fluorescent_lights', 28, R - 0.3, -12);
  d.shelves(W + 0.05, -21.7, W + 0.05, -17.5, L1, '+x');
  d.debris([18.3, -21.7, 33.7, -6.3], R, 40, { paper: 0.9 });
  d.scatter([18.3, -21.7, 33.7, -6.3], S, 8, [['cardboard_box_01', 3], ['trashbag', 2], ['Barrel_02', 1, { collide: true }]]);
}
