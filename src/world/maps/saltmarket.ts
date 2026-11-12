import * as THREE from 'three';
import type { QualityPreset } from '../../core/settings';
import { ENV, LevelBuilder, stairRun, type V3 } from '../level';
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
  const b = await LevelBuilder.create(q, ['brick', 'plaster', 'floor', 'asphalt', 'concrete', 'steel', 'rust', 'iron', 'blue'],
    ['wooden_crate_01', 'wooden_crate_02', 'wooden_military_crate', 'Barrel_01', 'barrel_03', 'plastic_crate_01', 'covered_car', 'concrete_road_barrier', 'utility_box_01']);
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
  const level = b.finish(scene, gl, ENV.dusk, bounds);
  return worldFromLevel('saltmarket', level, {
    bounds,
    spawn: SALTMARKET.spawn,
    spawnYaw: -Math.PI / 4,
    navGround: [],
    menuCam: { center: [0, 8, -4], radius: 44, height: 30 },
  });
}

/** A lived-in market district at the end of the day: shops shutting, washing lines, rubbish, the city around it. */
function dress(d: Dresser, bounds: THREE.Box3): void {
  const b = d.b;
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
  for (const [x0, z0, x1, z1, top, skip, shops] of blocks) {
    d.block(x0, z0, x1, z1, S, top, { skip, lit: 0.4, skipGround: shops.length > 0, ac: 3 });
    for (const f of shops) {
      const at = f === '-x' ? x0 : f === '+x' ? x1 : f === '-z' ? z0 : z1;
      const [a, c] = f[1] === 'x' ? [z0, z1] : [x0, x1];
      d.shopfronts(f, at, a, c, S, { open: 0.35 });
    }
  }
  // T4: its roof is the way across, so no roof clutter; shops on the canal street
  d.block(18, 2, 34, 16, S, R, { roof: false, lit: 0.35, skipGround: true, skip: [] });
  d.shopfronts('-x', 18, 2, 16, S, { open: 0.5 });
  d.shopfronts('+z', 16, 18, 34, S, { open: 0.3 });
  // The safehouse: grime on the brick, a gutter pipe
  d.pipe([17.7, S, -6.3], [17.7, T + 0.2, -6.3], 0.07, 0x4c5054);
  d.pipe([34.3, S, -21.7], [34.3, T + 0.2, -21.7], 0.07, 0x4c5054);
  d.wallProp('exterior_aircon_unit', '+x', 34.15, -18, L1 + 0.3, { collide: false });
  d.wallProp('exterior_aircon_unit', '-z', -22.15, 30, R - 1, { collide: false });

  // --- Streets: rubbish, puddles, manholes, bins against the walls
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
  for (const [x, z] of [[-24, 18], [-6, -14], [10, 0], [26, 19], [14, -24], [-38, -6]] as const) b.prop('water_manhole_cover', x, S, z, d.rand(0, 6), { collide: false });
  // Canal: grime at the waterline
  d.stains([-3.8, -34.5, 3.8, 34.5], 0, 20, 0x0d1a12, 0.5, [1, 3]);

  // --- Market hall: produce crates on the stalls, sacks and bins round them
  for (const x of [-29, -23, -17]) {
    for (const z of [-5, 5]) {
      for (let i = 0; i < 3; i++) b.prop(d.pick(['plastic_crate_03', 'cardboard_box_01'] as const), x - 1 + i, S + 1.1, z + d.rand(-0.3, 0.3), d.rand(-0.3, 0.3), { collide: false, scale: 0.8 });
      b.prop('plastic_monobloc_chair_01', x + d.rand(-1, 1), S, z + (z > 0 ? 1.6 : -1.6), d.rand(0, 6), { collide: false });
    }
  }
  d.scatter([-33.5, -11.5, -12.5, 11.5], S, 16, [['trashbag', 3], ['cardboard_box_01', 3], ['plastic_crate_03', 2], ['cement_bag', 1]]);
  d.debris([-33.5, -11.5, -12.5, 11.5], S, 80, { paper: 0.6 });
  d.stains([-33.5, -11.5, -12.5, 11.5], S, 16, 0x15110c, 0.4);
  // Strings of bulbs between the columns
  for (const z of [-8, 0, 8]) d.cables([[[-34, R - 0.8, z], [-12, R - 0.8, z]]], 1);

  // --- Safehouse inside: a relief office that has been lived in
  d.desk(22, R, -19.5, '+z');
  d.desk(30.5, R, -14, '-x');
  d.shelves(18.2, -21.7, 18.2, -17.5, L1, '+x');
  d.debris([18.3, -21.7, 33.7, -6.3], R, 40, { paper: 0.9 });
  d.debris([18.3, -21.7, 33.7, -6.3], L1, 30, { paper: 0.7 });
  d.scatter([18.3, -21.7, 33.7, -6.3], L1, 8, [['cardboard_box_01', 3], ['trashbag', 1], ['plastic_monobloc_chair_01', 2]]);
  d.scatter([18.3, -21.7, 33.7, -6.3], S, 8, [['cardboard_box_01', 3], ['trashbag', 2], ['Barrel_02', 1, { collide: true }]]);
  d.ceilingProp('mounted_fluorescent_lights', 26, T - 0.3, -14);
  d.ceilingProp('mounted_fluorescent_lights', 28, R - 0.3, -12);

  // --- Overhead: power and phone lines across the streets and the canal, washing lines
  d.cables([
    [[-10, 9.5, -24], [6, 8.5, -31]], [[-10, 8.5, 28], [6, 8.5, 28]], [[-10, 10, -21], [18, 10.5, -10]],
    [[-38, 10, -20], [-38, 10, -10]], [[-40, 9.5, 8], [-32, 8.5, 22]], [[12, 8.5, -29.2], [18, 10, -21.8]],
    [[14, 8.5, 24], [20, 8.5, 22]], [[38, 10, -2], [38, 10, 2]], [[34, 10, 16], [38, 10, 18]],
  ], 3);
  for (const [x0, x1, z, y] of [[-44, -38, -16.5, 7.6], [20, 34, 16.3, 8], [38, 45, 18.3, 7.4]] as const) {
    d.cable([x0, y, z], [x1, y, z], 0.3, 0.006);
    for (let x = x0 + 0.8; x < x1 - 0.5; x += d.rand(0.5, 1.1)) {
      b.box([x - 0.25, y - 0.75 - d.rand(0, 0.2), z - 0.01], [x + 0.25, y - 0.1, z + 0.01], b.flat(d.pick([0xd8d3c4, 0x8a3a2a, 0x2f6f8f, 0xc79a2a, 0x4a4f55]), 0.95), { collide: false });
    }
  }
}
