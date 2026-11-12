import * as THREE from 'three';
import type { QualityPreset } from '../../core/settings';
import { ENV, LevelBuilder, stairRun, type V3 } from '../level';
import { Dresser } from '../dress';
import { worldFromLevel, type WorldMap } from '../map';

/**
 * M5 Signal Hill: Fort Mardell and the coast relay, 90 x 80 m, in the storm.
 *
 *   y = 1.6   beach and jetty (sea at 0.6)
 *   y = 12    the hilltop: fort yard, keep ground floor
 *   y = 16.5  rampart walks, bastions, the relay room in the keep
 *   y = 21    keep roof and the mast
 *
 * Sea to the south. Three ways up from the jetty: the cliff stairs to the sally port (fast),
 * the sea tunnel and the long magazine stair into the yard (quiet), or round the hill to the
 * ruined south-east wall (loud). The cliff stairs are also the way back down.
 */

const B = 1.6;
const Y = 12;
const R = 16.5;
const K = 21;

export const SIGNALHILL = {
  spawn: [0, B, 33] as V3,
  boat: [0, B, 36] as V3,
  keepDoor: [0, Y, -2.5] as V3,
  console: [0, R + 1.1, -15.4] as V3,
  relay: [0, R, -11] as V3,
  gate: [0, Y, -27] as V3,
  dace: [1.5, Y, -25] as V3,
  overwatch: [0, R, -30.5] as V3,
};

export async function buildSignalHill(scene: THREE.Scene, q: QualityPreset, gl: THREE.WebGLRenderer): Promise<WorldMap> {
  const b = await LevelBuilder.create(q, ['rock', 'stone', 'sand', 'concrete', 'steel', 'rust', 'floor'],
    ['wooden_military_crate', 'Barrel_01', 'barrel_03', 'covered_car', 'concrete_road_barrier', 'ammo_box']);
  const rock = b.tint('rock', 0x7d807c);
  const stone = b.tint('stone', 0xa09c92);
  const stoneDark = b.tint('stone', 0x7a776f);
  const turf = b.tint('sand', 0x5f6650, 0.95);
  const steel = b.tint('steel', 0x6d737a);
  const wood = b.flat(0x54402c, 0.9);
  const sandbag = b.flat(0x8a7f64, 0.95);

  // --- The hill: solid to the yard level, cut by the sea tunnel and the magazine stair (x 10..13)
  const run = stairRun(B, Y); // the magazine stair: one long flight
  const zTop = 4 - run;
  b.box([-45, 0, -40], [10, Y, 20], turf, { tile: 5 });
  b.box([13, 0, -40], [45, Y, 20], turf, { tile: 5 });
  b.box([10, 0, -40], [13, Y, zTop], turf, { tile: 5 });
  b.box([10, 4.6, 4], [13, Y, 20], rock);
  b.box([10, 0, zTop], [13, B, 20], rock);
  b.stairs(11.5, 4, '-z', B, Y, 3, stoneDark);
  b.rail(10, zTop, 10, 4, Y, stoneDark, 1.0);
  b.rail(13, zTop, 13, 4, Y, stoneDark, 1.0);
  b.rail(10, 4, 13, 4, Y, stoneDark, 1.0);
  // Cliff face cladding and the beach
  b.box([-45, 0, 19.7], [10, Y, 20.05], rock, { collide: false });
  b.box([13, 0, 19.7], [45, Y, 20.05], rock, { collide: false });
  b.box([-45, 0, 20], [45, B, 30], b.tint('sand', 0x6f6a5c), { tile: 5 });
  // Jetty and the boat
  b.slab(-2, 30, 2, 39, B, wood, 0.3);
  for (const z of [32, 35.5, 38.8]) for (const x of [-1.8, 1.8]) b.column(x, z, 0, B - 0.3, 0.3, wood);
  b.box([2.2, 0.5, 33], [4.6, 1.5, 39.5], b.flat(0x2b3138, 0.6)); // the boat's hull
  b.box([2.6, 1.5, 36.5], [4.2, 2.5, 38.6], b.flat(0x3a424b, 0.6));
  b.crates(-8, B, 24, 2);
  b.prop('Barrel_01', 6, B, 23);
  b.prop('barrel_03', -16, B, 28);

  // --- Cliff stairs: three flights from the beach to the sally port
  const f1 = stairRun(B, 5), f2 = stairRun(5, 8.5), f3 = stairRun(8.5, Y);
  b.stairs(-14, 27, '-x', B, 5, 2, steel);
  b.slab(-14 - f1 - 2.7, 23.9, -14 - f1, 28, 5, steel, 0.25);
  b.stairs(-14 - f1, 24.9, '+x', 5, 8.5, 2, steel);
  b.slab(-14 - f1 + f2, 21.8, -14 - f1 + f2 + 2.7, 25.9, 8.5, steel, 0.25);
  b.stairs(-14 - f1 + f2, 22.8, '-x', 8.5, Y, 2, steel);
  const cTop = -14 - f1 + f2 - f3;
  b.slab(cTop - 2.7, 20, cTop, 23.8, Y, steel, 0.25);
  b.rail(cTop - 2.7, 20, cTop - 2.7, 23.8, Y, steel, 1.0);
  b.rail(cTop - 2.7, 23.8, cTop, 23.8, Y, steel, 1.0);
  b.rail(-14 - f1 - 2.7, 23.9, -14 - f1 - 2.7, 28, 5, steel, 1.0);
  b.rail(-14 - f1 + f2 + 2.7, 21.8, -14 - f1 + f2 + 2.7, 25.9, 8.5, steel, 1.0);
  // Low wall along the cliff top, open at the stair head
  b.rail(-45, 19.6, cTop - 2.7, 19.6, Y, stoneDark, 1.0);
  b.rail(cTop, 19.6, 45, 19.6, Y, stoneDark, 1.0);

  // --- Fort walls: 3 m thick with a walk on top (x -30..30, z -32..12)
  const wallBox = (x0: number, z0: number, x1: number, z1: number): void => {
    b.box([x0, Y, z0], [x1, R, z1], stone);
  };
  wallBox(-30, -32, -3, -29); // north wall, west of the gate
  wallBox(3, -32, 30, -29);
  b.slab(-3, -32, 3, -29, R, stone, 1.2); // over the gate arch
  wallBox(-30, 9, -21, 12); // south wall, with the sally port
  wallBox(-19, 9, 30, 12);
  b.slab(-21, 9, -19, 12, R, stone, 1.6);
  wallBox(-30, -29, -27, 2); // west wall, with the postern
  wallBox(-30, 4, -27, 9);
  b.slab(-30, 2, -27, 4, R, stone, 1.8);
  wallBox(27, -29, 30, 0); // east wall, broken down in the south
  b.box([27, Y, 6.5], [30, R, 9], stone);
  for (const [x, z, h] of [[27.7, 0.9, 1.3], [29.4, 5.7, 1.1], [32.5, 1.5, 0.7], [24.5, 5.5, 0.6]] as const) {
    b.box([x - 0.8, Y, z - 0.7], [x + 0.8, Y + h, z + 0.7], stoneDark);
  }
  // Parapets on the outer edge
  b.rail(-30, -32, 24, -32, R, stoneDark, 1.1);
  b.rail(-30, 12, 30, 12, R, stoneDark, 1.1);
  b.rail(-30, -32, -30, 12, R, stoneDark, 1.1);
  b.rail(30, -26, 30, 0, R, stoneDark, 1.1);
  b.rail(30, 6.5, 30, 12, R, stoneDark, 1.1);
  // Stairs from the yard to the walks: one on the south wall, one on the north
  const rr = stairRun(Y, R);
  b.stairs(-10, 8, '+x', Y, R, 2, stoneDark);
  b.stairs(10, -28, '+x', Y, R, 2, stoneDark);
  // North-east bastion: an open gun platform (the Cordon sniper's perch)
  b.box([30, Y, -36], [36, R, -26], stone);
  b.box([24, Y, -36], [30, R, -32], stone);
  b.rail(24, -36, 36, -36, R, stoneDark, 1.1);
  b.rail(36, -36, 36, -26, R, stoneDark, 1.1);
  b.rail(30, -26, 36, -26, R, stoneDark, 1.1);

  // --- The keep (x -7..7, z -16..-4): store below, relay room above, mast on the roof
  b.room(-7, -16, 7, -4, Y, K, stone, {
    t: 0.6, roof: false,
    s: [[-1.1, 1.1, 0, 2.5], [-4.5, -3.5, R - Y + 1, R - Y + 2.2], [3.2, 4.2, R - Y + 1, R - Y + 2.2]],
    n: [[-3, 3, R - Y + 1, R - Y + 2.1]],
    w: [[-11, -9, R - Y + 1, R - Y + 2.1]],
    e: [[-11, -9, R - Y + 1, R - Y + 2.1]],
  });
  b.floor([-6.7, -15.7, 6.7, -4.3], R, b.tint('floor', 0x8c8a84), [[4.2, -5.6 - rr, 6.4, -5.6]]);
  b.stairs(5.3, -5.6, '-z', Y, R, 2.2, stoneDark);
  b.rail(4.2, -5.6 - rr, 4.2, -5.6, R, steel, 1.0);
  b.rail(4.2, -5.6, 6.4, -5.6, R, steel, 1.0);
  const kr = stairRun(R, K);
  b.floor([-7.3, -16.3, 7.3, -3.7], K, stone, [[-6.4, -14, -4.2, -14 + kr]], 0.35);
  b.stairs(-5.3, -14, '+z', R, K, 2.2, stoneDark);
  b.rail(-4.2, -14, -4.2, -14 + kr, K, steel, 1.0);
  b.rail(-6.4, -14, -4.2, -14, K, steel, 1.0);
  for (const [x0, z0, x1, z1] of [[-7.3, -16.3, 7.3, -16.3], [-7.3, -3.7, 7.3, -3.7], [-7.3, -16.3, -7.3, -3.7], [7.3, -16.3, 7.3, -3.7]] as const) {
    b.rail(x0, z0, x1, z1, K, stoneDark, 1.1);
  }
  b.column(2, -10, K, K + 9, 0.5, steel); // the relay mast
  b.box([0.6, K + 6, -11.4], [3.4, K + 6.2, -8.6], steel, { collide: false });
  b.box([-2.5, R, -15.6], [2.5, R + 0.95, -14.9], b.flat(0x23272c, 0.5, 0.3)); // relay desk
  b.box([-2.2, R + 0.95, -15.55], [2.2, R + 1.7, -15.5], b.glow(0xffb469, 0.5), { collide: false });
  b.crates(-4, Y, -13, 2);
  b.crates(3, Y, -14, 3, 0.3);
  b.box([-2.5, R, -6.2], [-0.5, R + 0.9, -5.2], wood);

  // --- Yard: ruined barracks, storehouse, vehicles, sandbags in a ring round the keep
  b.wall(-22, -24, -12, -24, Y, Y + 2.6, stoneDark, { t: 0.5, gaps: [[-18, -16, 0, 2.6]] });
  b.wall(-22, -24, -22, -16, Y, Y + 1.4, stoneDark, { t: 0.5 });
  b.wall(-12, -24, -12, -18, Y, Y + 2.0, stoneDark, { t: 0.5 });
  b.box([16, Y, -22], [23, Y + 3.4, -14], stoneDark); // storehouse
  b.prop('covered_car', -17, Y, 2, 0.4, { scale: 1.25 });
  b.prop('covered_car', 19, Y, -6, 1.3, { scale: 1.25 });
  for (const [x, z, w, d] of [[-2, -22, 3, 0.8], [3.5, -23.5, 0.8, 3], [-4.5, -23.5, 0.8, 3], [0, 1, 4, 0.8], [-12, -4, 0.8, 3.5], [16.5, -2, 3.5, 0.8], [8, 5, 0.8, 3], [-20, -8, 3, 0.8], [22, 4, 3, 0.8]] as const) {
    b.box([x - w / 2, Y, z - d / 2], [x + w / 2, Y + 1.05, z + d / 2], sandbag);
  }
  b.crates(-24, Y, -2, 2);
  b.crates(9, Y, -20, 2, 0.4);
  b.crates(-9, Y, 5, 3);
  b.crates(24, Y, -25, 2);
  b.prop('Barrel_01', -25, Y, 7);
  b.prop('barrel_03', 15, Y, 7.5);
  b.prop('concrete_road_barrier', -6, Y, -35, 0);
  b.prop('concrete_road_barrier', 6, Y, -36, 0.1);
  b.prop('covered_car', -10, Y, -37, 1.5, { scale: 1.3 });
  b.prop('covered_car', 12, Y, -37, 1.65, { scale: 1.3 });
  // Outside the walls: a few rocks for the long way round
  for (const [x, z, s] of [[36, 14, 2], [40, 2, 1.6], [38, -12, 2.2], [-37, 12, 2], [-39, -8, 1.8], [-36, -26, 2.2], [20, 16, 1.5], [-6, 16, 1.4]] as const) {
    b.box([x - s, Y, z - s * 0.8], [x + s, Y + s * 0.9, z + s * 0.8], rock);
  }
  // Edges of the hill
  b.box([-45, Y, -40], [45, Y + 3, -39.5], rock);
  b.box([-45, Y, -40], [-44.5, Y + 3, 20], rock);
  b.box([44.5, Y, -40], [45, Y + 3, 20], rock);
  b.box([-45, B, 20], [-44.5, B + 3, 30], rock);
  b.box([44.5, B, 20], [45, B + 3, 30], rock);

  // --- Light: the relay room glows through its slits; headlights at the gate; a lamp on the jetty
  b.lamp(0, K - 0.4, -10, { color: 0xffc98a, power: 60, range: 14, size: 0.4 });
  b.lamp(0, R - 0.4, -10, { color: 0xffb469, power: 30, range: 12, size: 0.3, flicker: 0.05 });
  b.lamp(-9, Y + 1.2, -35.5, { color: 0xdfe8ff, power: 110, range: 30, size: 0.35 });
  b.lamp(11, Y + 1.2, -35.5, { color: 0xdfe8ff, power: 110, range: 30, size: 0.35 });
  b.lamp(0, B + 2.4, 31, { color: 0xffb469, power: 40, range: 16, size: 0.3 });
  b.column(0.9, 30.4, B, B + 2.4, 0.12, steel);
  b.lamp(-20, R - 1.3, 8.6, { color: 0xffb469, power: 45, range: 16, size: 0.3 });
  b.lamp(11.5, 4.5, 12, { color: 0xff7a48, power: 20, range: 12, size: 0.25, flicker: 0.1 });
  b.lamp(19.5, Y + 3.6, -13.6, { color: 0xffb469, power: 45, range: 18, size: 0.3 });
  b.lamp(33, R + 0.1, -31, { color: 0xff5a48, size: 0.2 });

  // The sea
  b.water([-200, 20, 200, 200], 0.6, 0x0a1418);
  b.water([-200, -200, -45, 20], 0.6, 0x0a1418);
  b.water([45, -200, 200, 20], 0.6, 0x0a1418);

  const bounds = new THREE.Box3(new THREE.Vector3(-45, 0, -40), new THREE.Vector3(45, 31, 40));
  dress(new Dresser(b, 505), bounds);
  const level = b.finish(scene, gl, ENV.storm, bounds);
  return worldFromLevel('signalhill', level, {
    bounds,
    spawn: SIGNALHILL.spawn,
    spawnYaw: 0,
    navGround: [],
    menuCam: { center: [0, 14, -6], radius: 50, height: 34 },
  });
}

/** An old fort turned into a relay post: the garrison's kit in the yard, the mast's cables, the coast in the storm. */
function dress(d: Dresser, bounds: THREE.Box3): void {
  const b = d.b;
  // Port Veyle across the bay, and the headland's farms inland
  d.skyline(bounds, { sides: ['+z'], near: 160, far: 320, h: [8, 40], lit: 0.3, count: 60 });
  d.skyline(bounds, { sides: ['-z', '-x', '+x'], near: 50, far: 200, base: Y - 6, h: [4, 9], lit: 0.05, count: 25 });

  // --- Beach and jetty
  const beach: [number, number, number, number] = [-44.5, 20.5, 44.5, 29.5];
  d.stains(beach, B, 20, 0x2a2a22, 0.4, [1.5, 4]);
  d.debris(beach, B, 60, { paper: 0.05 });
  d.scatter(beach, B, 12, [['old_tyre', 2], ['Barrel_02', 2, { collide: true }], ['metal_jerrycan', 1], ['trashbag', 1], ['rusted_wheel_rim_01', 1]],
    { clear: [[-16, 20, 2, 30]] });
  for (const [x, z, s] of [[-30, 27, 1.4], [-24, 29, 0.9], [22, 28, 1.6], [30, 26, 1.1], [38, 29, 1.3], [-40, 25, 1.2]] as const) {
    b.box([x - s, 0, z - s * 0.7], [x + s, B + s * 0.6, z + s * 0.7], b.mat('rock'));
  }
  d.wallProp('lifebuoy', '+x', 1.95, 32, B + 0.2, { collide: false });
  for (const z of [31, 34, 37]) d.cyl([2.05, B, z], 0.1, 0.6, b.flat(0x2b2e31, 0.6, 0.5));

  // --- Yard: the garrison's kit
  const yard: [number, number, number, number] = [-26.5, -28.5, 26.5, 8.5];
  d.stains(yard, Y, 30, 0x1a1a14, 0.45, [1.2, 3.5]);
  d.debris(yard, Y, 120, { paper: 0.15 });
  d.scatter(yard, Y, 26, [
    ['metal_jerrycan', 3], ['Barrel_02', 2, { collide: true }], ['ammo_box', 3], ['cardboard_box_01', 1], ['old_tyre', 2],
    ['propane_tank', 1, { collide: true }], ['cement_bag', 2], ['trashbag', 1], ['plastic_crate_03', 1],
  ], { clear: [[-2, -29, 2, -3.5], [-10.5, 6, -5, 10], [9.5, -29, 16, -26.5], [-1.5, -4, 1.5, -2]] });
  b.prop('portable_generator', 6, Y, -8, 0.4);
  b.prop('portable_generator', -14, Y, -26, 2.1);
  b.prop('portable_searchlight', -9, Y, -34.4, Math.PI, { collide: false });
  b.prop('portable_searchlight', 11, Y, -34.4, Math.PI, { collide: false });
  b.prop('tool_cart', 14.5, Y, -18, 1.57);
  b.prop('worn_metal_rack', 17, Y, -12.8, 0);
  // Ruined barracks: rubble inside the broken walls
  d.debris([-21.7, -23.7, -12.3, -16.3], Y, 80, { paper: 0 });
  for (let i = 0; i < 6; i++) {
    const x = d.rand(-21, -13), z = d.rand(-23, -17), s = d.rand(0.3, 0.8);
    b.box([x - s, Y, z - s], [x + s, Y + s * 0.6, z + s], b.mat('stone'), { collide: false });
  }
  // Generator cables to the keep
  d.cables([[[6, Y + 0.6, -8], [5, R + 1, -4]], [[-14, Y + 0.6, -26], [-6.7, R + 2, -10]]], 1);

  // --- Ramparts: searchlights, ammo, sandbag rests
  for (const [x, z, r] of [[-28.5, -20, 1.57], [-28.5, 0, 1.57], [28.5, -15, -1.57], [33, -33, 2.4], [-12, -30.5, Math.PI], [18, 10.5, 0]] as const) {
    b.prop('portable_searchlight', x, R, z, r, { collide: false });
  }
  d.scatter([-29.8, -31.8, 29.8, 11.8], R, 14, [['ammo_box', 3], ['metal_jerrycan', 1], ['cardboard_box_01', 1], ['trashbag', 1]]);
  d.debris([-29.8, -31.8, 29.8, 11.8], R, 60, { paper: 0.1 });

  // --- The keep: the relay room's racks and cabling, the mast's guy wires
  d.shelves(-6.4, -15.4, -6.4, -11, R, '+x');
  b.prop('Television_01', 1, R + 0.95, -15.3, 0, { collide: false, scale: 0.7 });
  b.prop('classic_laptop', -1.2, R + 0.95, -15.2, 0.2, { collide: false });
  b.prop('clipboard', -1.8, R + 0.9, -5.7, 0.4, { collide: false });
  d.debris([-6.6, -15.6, 6.6, -4.4], R, 40, { paper: 0.85 });
  d.shelves(-6.4, -15.4, -6.4, -9, Y, '+x');
  d.debris([-6.6, -15.6, 6.6, -4.4], Y, 30, { paper: 0.4 });
  for (const [x, z] of [[-6.8, -15.8], [6.8, -15.8], [-6.8, -4.2], [6.8, -4.2]] as const) d.cable([2, K + 8.5, -10], [x, K + 1.1, z], 0.1, 0.01);
  d.pipe([2.3, K, -10.3], [2.3, R + 0.4, -15.5], 0.05, 0x1c1e20, { brackets: false });
  for (let y = K + 1.5; y < K + 9; y += 1.5) b.box([1.6, y, -10.4], [2.4, y + 0.05, -9.6], b.flat(0x6d737a, 0.5, 0.6), { collide: false });
  b.box([1.85, K + 9, -10.15], [2.15, K + 9.3, -9.85], b.glow(0xff3a2a, 3), { collide: false });
  d.roof(-7, -16, 7, -4, K);

  // --- Outside the walls: rubbish where the hill drops away
  d.debris([30.5, -25, 44, 18], Y, 50, { paper: 0 });
  d.scatter([30.5, -25, 44, 18], Y, 6, [['old_tyre', 1], ['Barrel_02', 1, { collide: true }], ['metal_jerrycan', 1]]);
}
