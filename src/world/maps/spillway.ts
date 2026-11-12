import * as THREE from 'three';
import type { QualityPreset } from '../../core/settings';
import { ENV, LevelBuilder, stairRun, type V3 } from '../level';
import { Dresser } from '../dress';
import { worldFromLevel, type WorldMap } from '../map';

/**
 * M1 Spillway: Pump Station 3 and No. 2 dry dock, 96 x 64 m, at night in the rain.
 *
 *   y = 0    dry dock floor, culvert, pump gallery under the hall
 *   y = 7    quay and pump hall floor
 *   y = 12   control room mezzanine, north catwalk, service bridge
 *   y = 20   crane cab
 *
 * West is the harbour (the boat drops you on the quay's west edge), the dock is cut into the
 * quay in the north, the hall stands in the east. Three ways to the hall: across the quay to the
 * south door, down the dock stairs and through the culvert into the gallery, or up the gantry
 * stairs and along the service bridge to the catwalk.
 */

const Q = 7; // quay level
const M = 12; // mezzanine level

export const SPILLWAY = {
  spawn: [-44, Q, 18] as V3,
  hallDoor: [22, Q, 2] as V3,
  valve: [39.8, 1.4, -14] as V3,
  console: [40, M + 1.1, -26.9] as V3,
  pell: [37, M, -25] as V3,
  culvert: [8, 0, -16] as V3,
  bridge: [-18, M, -27] as V3,
  cab: [-12, 20, -16] as V3,
};

export async function buildSpillway(scene: THREE.Scene, q: QualityPreset, gl: THREE.WebGLRenderer): Promise<WorldMap> {
  const b = await LevelBuilder.create(q, ['concrete', 'floor', 'steel', 'rust', 'iron', 'blue', 'green', 'painted'],
    ['wooden_military_crate', 'Barrel_01', 'barrel_03', 'concrete_road_barrier', 'concrete_road_barrier_02', 'covered_car', 'utility_box_01']);
  const quay = b.tint('floor', 0x8e9296, 0.5); // rain-wet concrete
  const dock = b.tint('concrete', 0x7b8085);
  const steel = b.tint('steel', 0x6c7178);
  const yellow = b.tint('steel', 0xc79a2a);
  const hallWall = b.tint('iron', 0x7f8a8c);
  const pumpGreen = b.tint('green', 0x9fb5a0);

  // --- The quay: solid from the dock floor up, except the dock, the culvert and the gallery
  const solid = (x0: number, z0: number, x1: number, z1: number, y0 = 0, y1 = Q): void => {
    b.box([x0, y0, z0], [x1, y1, z1], quay, { tile: 4 });
  };
  solid(-48, -32, -30, 32); // west strip
  solid(-30, -32, 6, -26); // north strip
  solid(-30, -6, 14, 32); // south quay
  solid(6, -26, 14, -18); // between dock and gallery
  solid(6, -14, 14, -6);
  solid(6, -18, 14, -14, 3, Q); // over the culvert
  solid(6, -32, 48, -24); // north of the gallery
  solid(42, -24, 48, -4); // east of the gallery
  solid(14, -4, 48, 32); // south-east quay
  b.ground([-30, -26, 14, -6], dock);
  b.ground([14, -24, 42, -4], dock);

  // --- Dry dock: stairs down the south side, keel blocks down the middle, altar steps in the north
  const dockTop = -10 - stairRun(0, Q); // x where the dock stairs reach the quay
  b.stairs(-10, -7.5, '-x', 0, Q, 3, dock);
  for (let x = -26; x <= 2; x += 7) {
    b.box([x - 0.6, 0, -17.2], [x + 0.6, 1.7, -14.8], dock);
    b.box([x - 0.5, 0, -12], [x + 0.5, 1.1, -10.5], b.mat('rust'));
  }
  b.box([-30, 0, -26], [-2, 1.0, -24.6], dock);
  b.box([-30, 0, -24.6], [-14, 0.5, -23.4], dock, { collide: false });
  b.crates(-22, 0, -20, 2);
  b.crates(-6, 0, -21, 3, 0.4);
  b.prop('Barrel_01', 3, 0, -9);
  b.prop('barrel_03', 3.8, 0, -9.6);
  b.water([-30, -26, 6, -6], 0); // water sheet 0: the dock floods when the main valve opens

  // --- Pump gallery under the hall
  for (const x of [20, 28, 36]) {
    b.box([x - 2, 0, -18], [x + 2, 3.2, -12], pumpGreen); // pump base
    b.box([x - 0.5, 3.2, -15.5], [x + 0.5, 6, -14.5], steel); // riser pipe into the hall
    b.box([x - 0.25, 3.3, -12.02], [x + 0.25, 3.5, -11.98], b.glow(0x49ff8a, 2.2), { collide: false });
  }
  b.box([40, 0, -15.5], [41.4, 2.4, -12.5], b.mat('rust')); // main valve housing
  b.box([39.55, 1.0, -14.45], [39.95, 1.9, -13.55], yellow, { collide: false }); // valve wheel
  b.box([15, 0, -23.4], [41, 0.6, -22.4], steel, { collide: false }); // drain pipe along the wall
  b.crates(24, 0, -8, 2);
  b.crates(33, 0, -21, 2, 0.3);
  b.prop('Barrel_01', 16, 0, -22);
  // Stairs up into the hall, along the gallery's south wall
  b.stairs(18, -5.4, '+x', 0, Q, 2.4, steel);
  const galTop = 18 + stairRun(0, Q);
  // Gallery ceiling = hall floor, open over the stairs
  b.slab(14, -24, 42, -6.6, Q, quay, 1);
  b.slab(14, -6.6, 18, -4, Q, quay, 1);
  b.slab(galTop, -6.6, 42, -4, Q, quay, 1);
  b.slab(18, -4.2, galTop, -4, Q, quay, 1);
  b.rail(18, -4.2, galTop, -4.2, Q, yellow);
  b.rail(18, -6.6, galTop, -6.6, Q, yellow);
  b.rail(18, -6.6, 18, -4.2, Q, yellow);

  // --- Pump hall (x 12..46, z -28..0), roof at 16.5
  const H = 16.5;
  b.room(12, -28, 46, 0, Q, H, hallWall, {
    t: 0.4, roof: b.tint('iron', 0x596164),
    s: [[20, 24, 0, 3.4]], // main door, facing the quay
    w: [[-16, -12, 0, 3.2], [-27.8, -26.2, M - Q, M - Q + 2.4]], // apron door, service bridge door
    e: [[-6, -3, 0, 2.6]], // loading door
  });
  for (const x of [20, 28, 36]) {
    b.box([x - 2.2, Q, -18.2], [x + 2.2, Q + 2.6, -11.8], pumpGreen); // pump housing
    b.box([x - 0.9, Q + 2.6, -16], [x + 0.9, Q + 3.6, -14], steel, { collide: false });
    b.box([x - 0.3, Q + 1.4, -11.78], [x + 0.3, Q + 1.6, -11.74], b.glow(0x49ff8a, 2.4), { collide: false });
  }
  b.crates(15, Q, -22, 3);
  b.crates(32, Q, -3, 2, 0.2);
  b.crates(40, Q, -4, 2);
  b.prop('utility_box_01', 44.6, Q, -14, -Math.PI / 2);
  // Mezzanine: control room in the north-east corner, catwalk along the north wall
  b.slab(26, -28, 46, -20, M, steel);
  b.slab(43, -20, 46, -18.8, M, steel); // landing at the top of the stairs
  b.slab(12.2, -28, 26, -25.5, M, steel); // catwalk from the service bridge
  b.rail(12.2, -25.5, 26, -25.5, M, yellow);
  b.stairs(44.5, -18.8 + stairRun(Q, M), '-z', Q, M, 2.4, steel);
  b.rail(43, -20, 43, -18.8, M, yellow, 1.0);
  b.wall(26, -28, 26, -20, M, M + 3.4, b.mat('painted'), { t: 0.2, gaps: [[-27.5, -25.8, 0, 2.3]] });
  b.wall(26, -20, 46, -20, M, M + 3.4, b.mat('painted'), { t: 0.2, gaps: [[27, 42.5, 1.0, 2.6], [43.6, 45.6, 0, 2.3]] });
  b.glass([27, M + 1.0, -20.05], [42.5, M + 2.6, -19.95]);
  b.box([38, M, -27.6], [42, M + 0.95, -26.9], b.flat(0x23272c, 0.5, 0.4)); // control desk
  b.box([38.3, M + 0.95, -27.5], [41.7, M + 1.7, -27.4], b.glow(0x58c8ff, 0.55), { collide: false }); // screens
  b.box([28, M, -27.6], [31, M + 0.95, -26.9], b.flat(0x23272c, 0.5, 0.4));
  b.box([32.5, M, -22.4], [34.5, M + 0.8, -21.2], b.flat(0x2c3138, 0.6)); // table: low cover by the window

  // --- Gantry: stairs and the service bridge to the hall, crane across the dock
  b.stairs(-28, -27, '+x', Q, M, 2, steel);
  const brW = -28 + stairRun(Q, M);
  b.slab(brW, -28, 12, -26, M, steel, 0.25);
  b.rail(brW, -28, 12, -28, M, yellow, 1.0);
  b.rail(brW, -26, 11.6, -26, M, yellow, 1.0);
  for (const x of [-12, 0]) b.column(x, -27, Q, M - 0.25, 0.35, steel);
  for (const z of [-29.5, -2.5]) b.column(-12, z, Q, 23, 1.3, yellow);
  b.box([-13, 23, -30.5], [-11, 24.4, -1.5], yellow, { collide: false });
  b.slab(-14.6, -18.2, -9.4, -13.8, 20, steel, 0.25); // crane cab floor
  b.rail(-14.6, -18.2, -9.4, -18.2, 20, yellow, 1.1);
  b.rail(-14.6, -13.8, -9.4, -13.8, 20, yellow, 1.1);
  b.rail(-14.6, -18.2, -14.6, -13.8, 20, yellow, 1.1);
  b.rail(-9.4, -18.2, -9.4, -13.8, 20, yellow, 1.1);
  b.box([-12.2, 21.4, -16.2], [-11.8, 23, -15.8], steel, { collide: false });

  // --- Quay cover: containers in staggered pairs, so crossing is a string of short sprints
  const cont = [b.mat('blue'), b.mat('rust'), b.mat('green')];
  const boxes: [number, number, boolean][] = [
    [-34, 12, true], [-34, 24, false], [-22, 6, false], [-20, 20, true], [-10, 12, true], [-8, 26, false],
    [2, 4, false], [4, 18, true], [14, 10, false], [18, 24, true], [30, 8, true], [36, 20, false],
    [-38, -14, false], [-38, -24, true],
  ];
  boxes.forEach(([x, z, along], i) => b.container(x, z, Q, along, cont[i % 3]));
  b.container(-10, 12, Q + 2.6, true, cont[1]);
  b.container(4, 18, Q + 2.6, true, cont[0]);
  b.crates(-28, Q, 16, 2);
  b.crates(-2, Q, 12, 3, 0.3);
  b.crates(10, Q, 2, 2);
  b.crates(26, Q, 14, 2, 0.5);
  b.crates(9, Q, -10, 2);
  b.prop('concrete_road_barrier', -16, Q, 2, 0);
  b.prop('concrete_road_barrier_02', 8, Q, 28, 0.2);
  b.prop('concrete_road_barrier', 22, Q, 6, 0);
  b.prop('concrete_road_barrier_02', 27, Q, 4, 0.1);
  b.prop('covered_car', 40, Q, 10, 0.3);
  b.prop('Barrel_01', -26, Q, 0);
  b.prop('barrel_03', -25.2, Q, 0.5);
  b.prop('Barrel_01', 16.5, Q, 2);

  // Dock edge rails (with gaps at the stairs), quay edge kerb, landside fence
  b.rail(-30, -6, dockTop - 0.1, -6, Q, yellow, 1.0);
  b.rail(-10, -6, 6, -6, Q, yellow, 1.0);
  b.rail(-30, -26, -28.2, -26, Q, yellow, 1.0);
  b.rail(brW, -26, 6, -26, Q, yellow, 1.0);
  b.rail(-30, -26, -30, -6, Q, yellow, 1.0);
  b.rail(6, -26, 6, -18.4, Q, yellow, 1.0);
  b.rail(6, -13.6, 6, -6, Q, yellow, 1.0);
  b.box([-48, Q, -32], [-47.6, Q + 1.5, 32], dock);
  b.box([-48, Q, 31.6], [48, Q + 1.5, 32], dock);
  b.box([-48, Q, -32], [48, Q + 3, -31.7], hallWall);
  b.box([47.7, Q, -32], [48, Q + 3, 32], hallWall);

  // --- Light: sodium floods on the quay, the hall glows from inside, the dock floor is dark
  const pole = (x: number, z: number): void => {
    b.column(x, z, Q, Q + 6.5, 0.22, steel);
    b.lamp(x, Q + 6.5, z, { color: 0xffb469, power: 150, range: 30, size: 0.5 });
  };
  pole(-30, 9);
  pole(-5, 16);
  pole(12, 27);
  b.lamp(22, Q + 4.6, 0.6, { color: 0xffb469, power: 90, range: 22, size: 0.6 });
  b.lamp(22, H - 0.4, -9, { color: 0xcfe3d4, power: 110, range: 26, size: 0.8 });
  b.lamp(36, H - 0.4, -9, { color: 0xcfe3d4, power: 110, range: 26, size: 0.8 });
  b.lamp(36, M + 3.3, -24, { color: 0xffd6a0, power: 45, range: 14, size: 0.5 });
  b.lamp(24, 5.9, -9, { color: 0x9dffc4, power: 70, range: 20, size: 0.4, flicker: 0.04 });
  b.lamp(36, 5.9, -20, { color: 0x9dffc4, power: 70, range: 20, size: 0.4 });
  b.lamp(-12, 6.6, -6.4, { color: 0xffb469, power: 60, range: 24, size: 0.4 });
  b.lamp(-12, 20.9, -16, { color: 0xffb469, size: 0.3 });
  b.lamp(10, 2.9, -16, { color: 0xff9a4a, power: 14, range: 10, size: 0.3, flicker: 0.1 });

  // Harbour water around the quay
  for (const r of [[-200, -200, -48, 200], [-48, 32, 200, 200], [48, -200, 200, 32], [-48, -200, 48, -32]] as const) {
    b.water([...r], Q - 1.5);
  }

  const bounds = new THREE.Box3(new THREE.Vector3(-48, 0, -32), new THREE.Vector3(48, 25, 32));
  dress(new Dresser(b, 101), bounds);
  const level = b.finish(scene, gl, ENV.nightRain, bounds);
  return worldFromLevel('spillway', level, {
    bounds,
    spawn: SPILLWAY.spawn,
    spawnYaw: -Math.PI / 2,
    navGround: [[-30, -26, 6, -6], [6, -18, 14, -14], [14, -24, 42, -4]],
    menuCam: { center: [4, 9, -8], radius: 46, height: 30 },
  });
}

/** Working-harbour clutter: the quay, the dock floor, the hall and its gallery, the city across the water. */
function dress(d: Dresser, bounds: THREE.Box3): void {
  const b = d.b;
  const H = 16.5; // hall roof
  // The Lower Wards across the harbour, and the far bank behind the station
  d.skyline(bounds, { sides: ['-x', '+z'], near: 60, far: 220, h: [10, 46], lit: 0.22, count: 70 });
  d.skyline(bounds, { sides: ['-z', '+x'], near: 40, far: 160, h: [8, 28], lit: 0.12, count: 40 });

  // --- Quay: oil and rainwater, painted lanes, bollards on the waterfront, working gear
  const quays: [number, number, number, number][] = [[-47.5, -31.5, -30, 31.5], [-30, -5.5, 14, 31.5], [14, -3.5, 47.5, 31.5]];
  for (const r of quays) {
    d.stains(r, Q, 26, 0x0a0a0a, 0.5);
    d.stains(r, Q, 14, 0x1a2a33, 0.35, [1.5, 4]);
    d.debris(r, Q, 70, { paper: 0.25 });
  }
  d.line(-46, 30.5, 46, 30.5, Q, { color: 0xc79a2a, w: 0.15 });
  d.line(-46, -4.6, -12, -4.6, Q, { color: 0xc79a2a, w: 0.15, dash: 2, gap: 1.2 });
  d.line(-46, 0, 46, 0, Q, { w: 0.12, dash: 3, gap: 2 });
  for (let x = -26; x <= 4; x += 3) d.hazard(x, -6.3, x + 1.6, -6.3, Q);
  for (let z = -28; z <= 30; z += 7) {
    d.cyl([-47.2, Q, z], 0.22, 0.75, b.flat(0x2b2e31, 0.6, 0.5));
    d.cyl([-47.2, Q + 0.75, z], 0.3, 0.08, b.flat(0x2b2e31, 0.6, 0.5));
  }
  for (const z of [-20, 4, 22]) d.wallProp('lifebuoy', '+x', -47.6, z, Q + 0.5, { collide: false });
  d.scatter(quays[1], Q, 26, [
    ['Barrel_02', 3, { collide: true }], ['old_tyre', 3], ['metal_jerrycan', 3], ['cardboard_box_01', 2], ['trashbag', 3],
    ['small_lpg_tank', 1, { collide: true }], ['propane_tank', 1, { collide: true }], ['cement_bag', 2], ['plastic_crate_03', 2],
  ]);
  d.scatter(quays[2], Q, 16, [
    ['Barrel_02', 2, { collide: true }], ['old_tyre', 2], ['metal_jerrycan', 2], ['trashbag', 2], ['portable_generator', 1, { collide: true }],
    ['hand_truck', 1], ['cement_bag', 2],
  ]);
  d.scatter(quays[0], Q, 10, [['old_tyre', 2], ['Barrel_02', 2, { collide: true }], ['metal_jerrycan', 2], ['cardboard_box_01', 1]]);
  b.prop('portable_generator', -24, Q, 23, 0.6);
  b.prop('portable_searchlight', -23, Q, 24.5, 2.4, { collide: false });
  b.prop('tool_cart', 31, Q, 26, 1.1);
  b.prop('utility_box_02', 47.3, Q, 12, -Math.PI / 2);

  // --- Dock floor: standing water, rust, rubbish washed in
  const dockFloor: [number, number, number, number] = [-29.5, -25.5, 5.5, -6.5];
  d.stains(dockFloor, 0, 20, 0x0e1c22, 0.55, [1.5, 5]);
  d.stains(dockFloor, 0, 16, 0x2a1608, 0.4);
  d.debris(dockFloor, 0, 90, { paper: 0.15 });
  d.scatter(dockFloor, 0, 18, [['old_tyre', 3], ['trashbag', 2], ['rusted_wheel_rim_01', 2], ['Barrel_02', 1, { collide: true }], ['metal_jerrycan', 1]]);
  d.pipe([-29.6, 2.4, -25.6], [5.6, 2.4, -25.6], 0.25, 0x3e4a44);
  d.pipe([-29.6, 3.1, -25.5], [5.6, 3.1, -25.5], 0.12, 0x5a5f63);

  // --- Pump hall: clerestory glow, pipes, fittings on the walls
  d.windows('+z', 0.25, 12, 46, Q + 5, H - 0.5, { floor: 20, sill: 0.4, h: 2.6, w: 2.4, spacing: 5, lit: 0.9, litColor: 0xcfe3d4 });
  d.windows('-x', 11.75, -28, 0, Q + 5, H - 0.5, { floor: 20, sill: 0.4, h: 2.6, w: 2.4, spacing: 5, lit: 0.9, litColor: 0xcfe3d4 });
  d.windows('+x', 46.25, -28, 0, Q + 5, H - 0.5, { floor: 20, sill: 0.4, h: 2.6, w: 2.4, spacing: 5, lit: 0.8, litColor: 0xcfe3d4 });
  for (const x of [17.5, 26.5, 38]) d.wallProp('security_light', '+z', 0.2, x, Q + 4.2, { collide: false });
  d.wallProp('security_light', '-x', 11.8, -10.5, Q + 4.2, { collide: false });
  for (const x of [20, 28, 36]) {
    d.pipe([x, Q + 3.6, -15], [x, H - 0.6, -15], 0.35, 0x4d6a58, { brackets: false });
    d.pipe([x, H - 1.2, -15], [x, H - 1.2, -27.6], 0.3, 0x4d6a58);
  }
  d.pipe([12.3, Q + 5, -27.6], [45.7, Q + 5, -27.6], 0.2, 0x5a5f63);
  d.pipe([12.3, Q + 5.5, -27.6], [45.7, Q + 5.5, -27.6], 0.1, 0x8a3a2a);
  d.pipe([45.7, Q + 0.4, -27.5], [45.7, Q + 0.4, -1], 0.15, 0x5a5f63);
  for (const x of [18, 26, 34, 42]) d.ceilingProp('hanging_industrial_lamp', x, H, -5);
  d.shelves(13, -27.7, 23, -27.7, Q, '+z');
  d.wallProp('korean_fire_extinguisher_01', '-z', -0.2, 30, Q + 0.4, { collide: false });
  b.prop('tool_cart', 31, Q, -8.5, 0.3);
  b.prop('metal_toolbox', 24.6, Q + 2.6, -17, 0.4, { collide: false });
  d.scatter([12.5, -27, 45.5, -0.5], Q, 14, [['cardboard_box_01', 2], ['metal_jerrycan', 2], ['Barrel_02', 1, { collide: true }], ['trashbag', 1], ['WetFloorSign_01', 1]]);
  d.stains([12.5, -27, 45.5, -0.5], Q, 18, 0x0b0b0b, 0.5);
  d.debris([12.5, -27, 45.5, -0.5], Q, 40, { paper: 0.4 });

  // --- Control room: desks, paperwork, the radio log
  d.desk(29.5, M, -24.5, '+z', { collide: true });
  d.desk(44.5, M, -24, '-x', { collide: true });
  d.shelves(26.3, -27.7, 26.3, -21, M, '+x');
  b.prop('Television_01', 39, M + 0.95, -27.25, 0, { collide: false, scale: 0.7 });
  d.debris([26.5, -27.5, 45.5, -20.5], M, 30, { paper: 0.9 });
  d.ceilingProp('mounted_fluorescent_lights', 33, M + 3.4, -23);

  // --- Gallery under the hall: wet, dripping, pipes everywhere
  const gal: [number, number, number, number] = [14.5, -23.5, 41.5, -6.8];
  d.stains(gal, 0, 18, 0x0c1a1f, 0.55, [1.2, 4]);
  d.debris(gal, 0, 40, { paper: 0.1 });
  d.pipe([14.2, 5.6, -23.4], [41.8, 5.6, -23.4], 0.3, 0x3e4a44);
  d.pipe([14.2, 6.2, -22.9], [41.8, 6.2, -22.9], 0.12, 0x8a3a2a);
  d.pipe([14.2, 6.3, -7.2], [41.8, 6.3, -7.2], 0.15, 0x5a5f63);
  d.scatter(gal, 0, 10, [['WetFloorSign_01', 1], ['metal_jerrycan', 2], ['trashbag', 1], ['cardboard_box_01', 1], ['metal_toolbox', 1]]);
  for (const [x, z] of [[22, -9], [30, -9], [28, -20], [38, -9]] as const) d.ceilingProp('mounted_fluorescent_lights', x, Q - 1, z);

  // --- Cables from the floodlight poles to the hall
  d.cables([[[-30, Q + 6.2, 9], [-5, Q + 6.2, 16]], [[-5, Q + 6.2, 16], [12, Q + 6.2, 27]], [[12, Q + 6.2, 27], [14, Q + 8, 0.25]]], 2);
}
