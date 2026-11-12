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
const H_ROOF = 16.5; // pump hall roof

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

/** Quay containers: x, z, along x. Staggered pairs, so crossing is a string of short sprints. */
const CONTAINERS: [number, number, boolean][] = [
  [-34, 12, true], [-34, 24, false], [-22, 6, false], [-20, 20, true], [-10, 12, true], [-8, 26, false],
  [2, 4, false], [4, 18, true], [14, 10, false], [18, 24, true], [30, 8, true], [36, 20, false],
  [-38, -14, false], [-38, -24, true],
];
/** Second tier: x, z, along x, colour index. */
const STACKED: [number, number, boolean, number][] = [[-10, 12, true, 1], [4, 18, true, 0]];

export async function buildSpillway(scene: THREE.Scene, q: QualityPreset, gl: THREE.WebGLRenderer): Promise<WorldMap> {
  const b = await LevelBuilder.create(q, ['concrete', 'floor', 'steel', 'rust', 'iron', 'blue', 'green', 'painted']);
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
  CONTAINERS.forEach(([x, z, along], i) => b.container(x, z, Q, along, cont[i % 3]));
  for (const [x, z, along, k] of STACKED) b.container(x, z, Q + 2.6, along, cont[k]);
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
  const level = await b.finish(scene, gl, ENV.nightRain, bounds);
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
    ['small_lpg_tank', 2, { collide: true }], ['cement_bag', 2], ['plastic_crate_03', 2],
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
  d.shelves(26.3, -25.4, 26.3, -21, M, '+x'); // clear of the catwalk door (z -27.5..-25.8)
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

  quayDetail(d);
  dockDetail(d);
  hallDetail(d, H);
  galleryDetail(d);
  controlDetail(d);
  harbourBeyond(d);
}

// ---------------------------------------------------------------------------------------------
// Small local kit (boxes and merged geometry, so nearly free)

type Face = '+x' | '-x' | '+z' | '-z';
const YELLOW = 0xc79a2a;
const DARK = 0x2b2e31;
const PAPER = 0xd8d4c8;
const STEEL = 0x5a5f63;

/** Axis-aligned box on a wall face: `u` along the wall, `v` out of it, both as [from, to]. */
function onWall(d: Dresser, face: Face, at: number, u: [number, number], y: [number, number], v: [number, number], color: number, glow = 0): void {
  const out = face[0] === '+' ? 1 : -1;
  const v0 = at + out * v[0], v1 = at + out * v[1];
  const lo = Math.min(v0, v1), hi = Math.max(v0, v1);
  const m = glow ? d.b.glow(color, glow) : d.b.flat(color, 0.6, 0.4);
  if (face[1] === 'z') d.b.box([u[0], y[0], lo], [u[1], y[1], hi], m, { collide: false, shadow: false });
  else d.b.box([lo, y[0], u[0]], [hi, y[1], u[1]], m, { collide: false, shadow: false });
}

/** Steel rung ladder fixed to a wall, from y0 to y1. */
function ladder(d: Dresser, face: Face, at: number, along: number, y0: number, y1: number): void {
  for (const s of [-0.23, 0.2]) onWall(d, face, at, [along + s, along + s + 0.04], [y0, y1], [0, 0.16], STEEL);
  for (let y = y0 + 0.25; y < y1 - 0.1; y += 0.3) onWall(d, face, at, [along - 0.21, along + 0.22], [y, y + 0.035], [0.11, 0.15], STEEL);
}

/** Valve handwheel: rim and two spokes, its axle along `axis`. */
function wheel(d: Dresser, p: V3, axis: 'x' | 'z', r = 0.3, color = YELLOW): void {
  const m = d.b.flat(color, 0.6, 0.4);
  const parts = [new THREE.TorusGeometry(r, 0.03, 6, 18), new THREE.BoxGeometry(r * 2, 0.035, 0.035), new THREE.BoxGeometry(0.035, r * 2, 0.035),
    new THREE.CylinderGeometry(0.03, 0.03, 0.25, 6).rotateX(Math.PI / 2).translate(0, 0, -0.12)];
  for (const g of parts) {
    if (axis === 'x') g.rotateY(Math.PI / 2);
    g.translate(...p);
    d.b.geo(g, m);
  }
}

/** Round dial gauge on a wall: rim, white face, needle. */
function gauge(d: Dresser, face: Face, at: number, along: number, y: number, r = 0.14): void {
  const out = face[0] === '+' ? 1 : -1;
  const disc = (rad: number, depth: number, off: number, color: number): void => {
    const g = new THREE.CylinderGeometry(rad, rad, depth, 16);
    if (face[1] === 'z') g.rotateX(Math.PI / 2).translate(along, y, at + out * off);
    else g.rotateZ(Math.PI / 2).translate(at + out * off, y, along);
    d.b.geo(g, d.b.flat(color, 0.5, 0.4));
  };
  disc(r, 0.06, 0.03, DARK);
  disc(r * 0.82, 0.01, 0.065, PAPER);
  onWall(d, face, at, [along - 0.01, along + 0.01], [y, y + r * 0.7], [0.07, 0.075], 0x8a1a12);
}

/** A board on a post standing on the floor, its face toward `face`. */
function signPost(d: Dresser, x: number, z: number, y: number, face: Face, lines: string[], w: number, opts: { bg?: string } = {}): void {
  const top = y + 1.9;
  d.b.box([x - 0.04, y, z - 0.04], [x + 0.04, top, z + 0.04], d.b.flat(STEEL, 0.55, 0.45), { collide: false });
  const out = face[0] === '+' ? 1 : -1;
  board(d, face, (face[1] === 'z' ? z : x) + out * 0.04, face[1] === 'z' ? x : z, top - 0.05, lines, w, 0.2, opts);
}

/** Bank of steel lockers against a wall, `a` to `c` along it. One solid box. */
function lockers(d: Dresser, face: Face, at: number, a: number, c: number, y: number, color = 0x4f6470): void {
  const deep = 0.5, h = 1.9;
  onWall(d, face, at, [a, c], [y, y + h], [0, deep], color);
  for (let u = a + 0.5; u < c - 0.05; u += 0.5) onWall(d, face, at, [u - 0.012, u + 0.012], [y + 0.05, y + h - 0.05], [deep, deep + 0.008], 0x1e2022);
  for (let u = a + 0.25; u < c; u += 0.5) {
    for (const k of [0, 1, 2]) onWall(d, face, at, [u - 0.12, u + 0.12], [y + 1.55 + k * 0.06, y + 1.58 + k * 0.06], [deep, deep + 0.008], 0x1e2022);
    onWall(d, face, at, [u + 0.14, u + 0.18], [y + 0.95, y + 1.1], [deep, deep + 0.03], 0x9a9d9e);
  }
  const out = face[0] === '+' ? 1 : -1;
  const v0 = Math.min(at, at + out * deep), v1 = Math.max(at, at + out * deep);
  d.b.colliders.push(face[1] === 'z'
    ? new THREE.Box3(new THREE.Vector3(a, y, v0), new THREE.Vector3(c, y + h, v1))
    : new THREE.Box3(new THREE.Vector3(v0, y, a), new THREE.Vector3(v1, y + h, c)));
}

/** Fire hydrant: barrel, cap, two outlets. */
function hydrant(d: Dresser, x: number, y: number, z: number): void {
  const red = d.b.flat(0xa82418, 0.6, 0.3);
  d.cyl([x, y, z], 0.16, 0.08, red, 12);
  d.cyl([x, y, z], 0.11, 0.62, red, 12);
  d.cyl([x, y + 0.62, z], 0.13, 0.08, red, 12);
  d.cyl([x, y + 0.7, z], 0.05, 0.06, red, 8);
  d.b.box([x - 0.2, y + 0.4, z - 0.045], [x + 0.2, y + 0.49, z + 0.045], red, { collide: false });
}

/** A field radio set on a table: case, dial window, knobs, a whip aerial and the handset. */
function radio(d: Dresser, x: number, y: number, z: number): void {
  const b = d.b, dk = b.flat(0x3a3f36, 0.7, 0.2);
  b.box([x - 0.22, y, z - 0.13], [x + 0.22, y + 0.24, z + 0.13], dk, { collide: false });
  b.box([x - 0.18, y + 0.13, z + 0.13], [x - 0.02, y + 0.2, z + 0.135], b.glow(0xffb469, 1.2), { collide: false, shadow: false });
  for (const u of [0.06, 0.14]) d.cyl([x + u, y + 0.08, z + 0.13], 0.025, 0.02, b.flat(DARK, 0.6, 0.5), 8);
  d.cyl([x + 0.17, y + 0.24, z - 0.08], 0.006, 0.7, b.flat(DARK, 0.6, 0.5), 4);
  b.box([x + 0.26, y, z - 0.04], [x + 0.4, y + 0.05, z + 0.04], b.flat(DARK, 0.6, 0.5), { collide: false });
}

/** Cork notice board with pinned sheets. */
function noticeBoard(d: Dresser, face: Face, at: number, along: number, y: number, w = 1.4, h = 0.9): void {
  onWall(d, face, at, [along - w / 2, along + w / 2], [y, y + h], [0, 0.03], 0x6e5236);
  for (let i = 0; i < 7; i++) {
    const u = d.rand(along - w / 2 + 0.15, along + w / 2 - 0.15), yy = d.rand(y + 0.1, y + h - 0.35);
    const sw = d.rand(0.18, 0.26);
    onWall(d, face, at, [u - sw / 2, u + sw / 2], [yy, yy + sw * 1.35], [0.03, 0.035], d.pick([PAPER, 0xe8e0a0, 0xc8d8e0]));
  }
}

/** Counterbalance forklift facing +x or -x, standing on `y`; solid. Built from boxes. */
function forklift(d: Dresser, x: number, z: number, y: number, dir: 1 | -1): void {
  const b = d.b;
  const yel = b.flat(YELLOW, 0.55, 0.3), dk = b.flat(DARK, 0.6, 0.5), tyre = b.flat(0x161718, 0.9);
  const bx = (u0: number, u1: number, z0: number, z1: number, y0: number, y1: number, m: THREE.Material): void => {
    const a = x + dir * u0, c = x + dir * u1;
    b.box([Math.min(a, c), y + y0, z + z0], [Math.max(a, c), y + y1, z + z1], m, { collide: false });
  };
  bx(-1.0, 0.85, -0.55, 0.55, 0.28, 1.15, yel); // body
  bx(-1.25, -1.0, -0.55, 0.55, 0.28, 1.25, dk); // counterweight
  bx(-0.55, -0.1, -0.25, 0.25, 1.15, 1.6, dk); // seat
  for (const u of [-0.85, 0.7]) for (const zz of [-0.53, 0.47]) bx(u, u + 0.06, zz, zz + 0.06, 1.15, 2.15, dk); // guard posts
  bx(-0.9, 0.78, -0.55, 0.55, 2.15, 2.2, dk); // guard roof
  for (const zz of [-0.4, 0.33]) bx(0.88, 0.98, zz, zz + 0.07, 0.1, 2.5, dk); // mast
  bx(0.88, 0.98, -0.4, 0.4, 2.4, 2.48, dk);
  for (const zz of [-0.36, 0.24]) bx(0.98, 2.1, zz, zz + 0.12, 0.06, 0.11, dk); // forks
  bx(0.98, 1.04, -0.4, 0.4, 0.06, 0.9, dk); // fork carriage
  for (const u of [-0.7, 0.55]) for (const zz of [-0.58, 0.58]) {
    const g = new THREE.CylinderGeometry(0.28, 0.28, 0.22, 12).rotateX(Math.PI / 2);
    g.translate(x + dir * u, y + 0.28, z + zz);
    b.geo(g, tyre);
  }
  const a = x - dir * 1.25, c = x + dir * 2.1;
  b.colliders.push(new THREE.Box3(new THREE.Vector3(Math.min(a, c), y, z - 0.7), new THREE.Vector3(Math.max(a, c), y + 2.2, z + 0.7)));
}

/** Stencilled owner code on one long side of a quay container (the sign atlas is shared and small, so one side). */
function containerCode(d: Dresser, x: number, z: number, y: number, along: boolean, i: number): void {
  const owners = ['LWDU', 'VYLU', 'TRSU', 'SLTU'];
  const code = `${owners[i % 4]} ${String((204816 + i * 37117) % 1000000).padStart(6, '0')} ${(i * 7) % 10}`;
  if (along) d.stencil('+z', z + 1.235, x - 1.2, y + 1.85, code, { h: 0.26 });
  else d.stencil('+x', x + 1.235, z + 1.2, y + 1.85, code, { h: 0.26 });
}

/**
 * A multi-line board made of stacked one-line signs, `h` per line, all `w` wide. (A multi-line
 * `sign` takes a slot as tall as all its lines in the shared atlas row, which fills it fast.)
 */
function board(d: Dresser, face: Face, at: number, along: number, top: number, lines: string[], w: number, h: number,
  opts: { bg?: string; fg?: string } = {}): void {
  lines.forEach((l, i) => d.sign(face, at, along, top - (i + 1) * h, l, { ...opts, w, h, font: i === 0 ? undefined : '600 56px "Arial Narrow", Arial, sans-serif' }));
}

// ---------------------------------------------------------------------------------------------
// Areas

/** The working quay: berth furniture on the harbour edge, bays and codes in the container yard, cargo, the gatehouse. */
function quayDetail(d: Dresser): void {
  const b = d.b;
  // Harbour edge (west): tyre fenders and ladders down the quay wall, berth numbers on the kerb
  // Fenders are merged tori, not tyre props: a prop strung along the whole edge costs calls in every cell
  for (let z = -24.5; z <= 30; z += 7) {
    b.geo(new THREE.TorusGeometry(0.3, 0.11, 6, 14).rotateY(Math.PI / 2).translate(-48.12, Q - 1.0, z), b.flat(0x161718, 0.9));
    b.geo(new THREE.CylinderGeometry(0.015, 0.015, 1.1, 4).translate(-48.05, Q - 0.2, z), b.flat(DARK, 0.6, 0.5));
  }
  for (const z of [-10, 12.5, 26.5]) ladder(d, '-x', -48, z, Q - 1.8, Q + 1.6);
  [['BERTH 3A', -18], ['BERTH 3B', 8], ['BERTH 3C', 27]].forEach(([t, z]) => {
    d.stencil('+x', -47.6, z as number, Q + 0.55, t as string, { h: 0.45 });
  });
  d.stencil('+x', -47.6, -2, Q + 0.6, 'NO MOORING', { h: 0.3, color: '#e0b030' });
  for (let z = -27; z <= 30; z += 7) d.hazard(-47.5, z - 0.8, -47.5, z + 0.8, Q, 0.18);
  d.streaks('-x', -48, -32, 32, Q - 1.6, Q + 1.5, 24, { base: false });

  // Container yard: painted bays and bay numbers under the ground tier, codes on every box
  CONTAINERS.forEach(([x, z, along], i) => {
    const [hx, hz] = along ? [3.55, 1.7] : [1.7, 3.55];
    const lc = { color: 0xd8d2bf, w: 0.1 };
    d.line(x - hx, z - hz, x + hx, z - hz, Q, lc);
    d.line(x - hx, z + hz, x + hx, z + hz, Q, lc);
    d.line(x - hx, z - hz, x - hx, z + hz, Q, lc);
    d.line(x + hx, z - hz, x + hx, z + hz, Q, lc);
    const bay = `${String.fromCharCode(65 + Math.floor(i / 5))}${String(i % 5 + 1).padStart(2, '0')}`;
    if (along) d.floorText(x - 3.25, Q, z, bay, '-x', { h: 0.55 });
    else d.floorText(x, Q, z - 3.25, bay, '-z', { h: 0.55 });
    containerCode(d, x, z, Q, along, i);
  });
  STACKED.forEach(([x, z, along], i) => containerCode(d, x, z, Q + 2.6, along, 20 + i));

  // Rain: standing water on the quay
  for (const r of [[-47.3, -31.5, -30.2, 31.3], [-30, -5.4, 14, 31.3], [14, -3.4, 47.5, 31.3]] as const) d.puddles([...r], Q, 22, [1, 3.6]);
  // Weeds only in one corner: plant props cost draw calls in every cell they touch
  d.scatter([-43.5, 30.7, -31, 31.55], Q, 8, [['shrub_04', 1, { scale: 1.1 }]]);

  // Cargo store under the service bridge, against the north fence
  const loads = ['wrapped', 'sacks', 'boxes', 'wrapped', 'none', 'boxes', 'sacks'] as const;
  [-25.5, -22.8, -19.2, -8.2, -5.5, 3.2, 4.6].forEach((x, i) => d.pallet(x, Q, -31.05, 0, loads[i]));
  d.pallet(-5.5, Q + 0.14, -31.05, 0.1, 'none');
  d.pallet(-5.5, Q + 0.28, -31.05, -0.05, 'none');
  for (const x of [-16.5, 0.6]) {
    d.cone(x, Q, -29.4);
    d.cone(x + 1.1, Q, -29.5);
  }
  d.stencil('+z', -31.7, -14, Q + 1.4, 'NO STACKING UNDER BRIDGE', { h: 0.3, color: '#e0b030' });

  // Forklift parked by the west containers, a wrapped load on its forks
  forklift(d, -42.5, -4, Q, 1);
  d.pallet(-40.9, Q + 0.11, -4, Math.PI / 2, 'wrapped');
  d.pallet(-44.8, Q, 2.8, 0.2, 'sacks');
  d.pallet(-44.6, Q, 4.3, -0.1, 'boxes');

  // Gatehouse at the landside corner: a security hut with a lit window
  const hut = b.flat(0xb8bcb6, 0.8);
  b.box([-46.9, Q, 28.4], [-43.9, Q + 2.6, 31.5], hut);
  b.box([-47.1, Q + 2.6, 28.2], [-43.7, Q + 2.75, 31.55], b.flat(DARK, 0.6, 0.5), { collide: false });
  b.box([-45.9, Q + 1.1, 28.37], [-44.3, Q + 2.1, 28.4], b.glow(0xffd9a0, 0.7), { collide: false });
  b.box([-43.87, Q + 1.1, 29.0], [-43.85, Q + 2.1, 30.0], b.glow(0xffd9a0, 0.7), { collide: false });
  b.box([-43.88, Q, 30.3], [-43.84, Q + 2.05, 31.2], b.flat(0x3a3d40, 0.6, 0.4), { collide: false });
  d.sign('-z', 28.4, -45.4, Q + 2.15, 'GATE 1  SECURITY', { h: 0.28, bg: '#1f3a5a', fg: '#e8e8e0' });
  d.wallProp('security_camera_01', '+x', -43.9, 29.2, Q + 2.3, { collide: false });

  // Hall front: the station's name, the notice board, bollards at the door, a hydrant
  d.sign('-x', 11.8, -6, Q + 8.3, 'PUMP STATION 3', { h: 1.0, bg: '#1f3a5a', fg: '#f2efe4', glow: 1.1 });
  d.sign('+z', 0.2, 22, Q + 3.75, 'PUMP STATION 3', { h: 0.55, bg: '#1f3a5a', fg: '#f2efe4' });
  board(d, '+z', 0.2, 30, Q + 1.9, ['LOWER WARDS DRAINAGE TRUST', 'AUTHORISED PERSONNEL ONLY', 'HARD HATS AND HI-VIS'], 1.7, 0.22, { bg: '#e8e4d6' });
  board(d, '+z', 0.2, 25.6, Q + 2.0, ['DANGER', 'PUMPS START', 'WITHOUT WARNING'], 0.9, 0.2, { bg: '#f0d040' });
  for (const x of [19.2, 24.8]) d.bollard(x, Q, 0.75);
  hydrant(d, 12.9, Q, 1.0);
  d.wallProp('security_camera_01', '+z', 0.2, 12.9, Q + 4.6, { collide: false });
  d.wallProp('security_camera_01', '-x', 11.8, -26.5, Q + 4.6, { collide: false });
  d.streaks('+z', 0.2, 12, 46, Q, H_ROOF, 30);
  d.streaks('-x', 11.8, -28, 0, Q, H_ROOF, 26);
  d.streaks('+x', 46.2, -28, 0, Q, H_ROOF, 14);
  d.cableTray([12.4, Q + 3.95, 0.4], [45.6, Q + 3.95, 0.4], 0.25);
  // Signs on the dock rail and at the gantry stair
  signPost(d, -24, -5.75, Q, '+z', ['NO. 2 DRY DOCK', 'DANGER: DEEP DROP', 'KEEP OUT WHEN FLOODING'], 1.2, { bg: '#f0d040' });
  signPost(d, -29.4, -25.7, Q, '+x', ['CRANE 2 GANTRY', 'AUTHORISED ONLY'], 1.0, { bg: '#e8e4d6' });
}

/** The dry dock walls: depth marks, ladders, wet streaks, the dock's name. */
function dockDetail(d: Dresser): void {
  d.stencil('+z', -26, -16, 3.0, 'No. 2 DRY DOCK', { h: 1.2 });
  d.stencil('+z', -26, -16, 2.3, 'LOWER WARDS DRAINAGE TRUST', { h: 0.35, opacity: 0.6 });
  // Depth gauge on the east wall, read from the dock stairs
  onWall(d, '-x', 6, [-8.65, -8.35], [0, Q], [0, 0.01], 0x1e2022);
  for (let y = 1; y < Q; y++) {
    onWall(d, '-x', 6, [-8.9, -8.1], [y - 0.03, y + 0.03], [0, 0.012], PAPER);
    d.stencil('-x', 6, -7.7, y - 0.17, `${Q - y} M`, { h: 0.32 });
  }
  ladder(d, '+x', -30, -11, 0, Q + 1);
  ladder(d, '+z', -26, -20, 1.0, Q + 1);
  ladder(d, '-x', 6, -22.5, 0, Q + 1);
  d.streaks('+z', -26, -30, 6, 1.0, Q, 30, { opacity: 0.6 });
  d.streaks('-z', -6, -10, 6, 0, Q, 14, { opacity: 0.6 });
  d.streaks('+x', -30, -26, -6, 0, Q, 14, { opacity: 0.6 });
  d.streaks('-x', 6, -26, -6, 0, Q, 12, { opacity: 0.6 });
  d.puddles([-29.5, -23.2, 5.5, -6.5], 0, 26, [1.2, 4.5]);
  d.stencil('+x', 6, -16, 3.25, 'CULVERT C3', { h: 0.4 });
  // Crane 2: load rating on the beam, warning lamps on the ends
  for (const s of [-1, 1] as const) d.stencil(s > 0 ? '+x' : '-x', -12 + s, -16, 23.25, 'CRANE 2   SWL 40 t', { h: 0.9, color: '#20201c' });
  for (const z of [-30.3, -1.7]) d.b.box([-12.2, 24.4, z - 0.2], [-11.8, 24.65, z + 0.2], d.b.glow(0xff3a2a, 3), { collide: false });
}

/** Pump hall: the overhead crane, pump labels, gauges and wheels, lockers, a break corner, the services. */
function hallDetail(d: Dresser, H: number): void {
  const b = d.b;
  // Overhead travelling crane spanning the pump bay, its runway beams on the end walls
  const cy = H - 0.9 - b.propSize('overhead_crane').y;
  b.prop('overhead_crane', 31, cy, -7.4, Math.PI / 2, { collide: false });
  for (const z of [-13.9, -0.9]) b.box([12.2, H - 0.95, z - 0.18], [45.8, H - 0.6, z + 0.18], b.flat(YELLOW, 0.55, 0.3), { collide: false });
  d.stencil('+z', -0.9 + 0.18, 31, H - 0.93, 'SWL 10 t', { h: 0.3, color: '#20201c' });
  // Pumps: names, a gauge and a handwheel each, painted keep-out lines, flanged risers
  [20, 28, 36].forEach((x, i) => {
    d.sign('+z', -11.8, x - 1.4, Q + 1.85, `P-${i + 1}`, { h: 0.4, bg: '#e8e4d6' });
    gauge(d, '+z', -11.8, x + 1.3, Q + 2.05);
    gauge(d, '+z', -11.8, x + 1.75, Q + 2.05, 0.1);
    wheel(d, [x + 2.36, Q + 1.3, -15], 'x', 0.32);
    d.hazard(x - 2.6, -11.3, x + 2.6, -11.3, Q, 0.2);
    d.hazard(x - 2.6, -18.7, x + 2.6, -18.7, Q, 0.2);
    d.floorText(x, Q, -10.2, `PUMP ${i + 1}`, '+z', { h: 0.7, color: '#d8c890' });
    for (const y of [Q + 5, Q + 7.5]) d.cyl([x, y, -15], 0.46, 0.1, b.flat(0x4d6a58, 0.55, 0.45), 14);
  });
  d.line(13, -9.4, 45, -9.4, Q, { color: YELLOW, w: 0.12 });
  d.line(13, -19.6, 45, -19.6, Q, { color: YELLOW, w: 0.12 });
  // Break corner by the main door: table, chairs, the radio, mugs, the rota
  b.prop('wooden_table_02', 14.2, Q, -1.4, 0, { collide: true });
  b.prop('plastic_monobloc_chair_01', 13.4, Q, -2.4, 0.4, { collide: false });
  b.prop('plastic_monobloc_chair_01', 15.3, Q, -2.3, -0.5, { collide: false });
  radio(d, 14.5, Q + 0.8, -1.25);
  for (const [x, z] of [[13.85, -1.6], [14.05, -1.35]] as const) d.cyl([x, Q + 0.8, z], 0.04, 0.1, b.flat(0xe8e4dc, 0.4), 8);
  b.prop('plastic_crate_03', 12.7, Q, -0.6, 0.3, { collide: false });
  d.cyl([12.7, Q + 0.27, -0.6], 0.09, 0.2, b.flat(0x9a9d9e, 0.4, 0.6), 10); // kettle
  d.wallProp('wall_clock', '+x', 12.2, -1.5, Q + 2.3, { collide: false });
  noticeBoard(d, '+x', 12.2, -4.2, Q + 1.2);
  d.sign('+x', 12.2, -4.2, Q + 2.15, 'SHIFT ROTA', { h: 0.22 });
  // Lockers along the west wall, past the apron door
  lockers(d, '+x', 12.2, -10.8, -6.3, Q);
  b.prop('plastic_broom', 12.6, Q, -11.2, 1.2, { collide: false });
  // Services: breaker panels on the east wall, trays, the fire point, exits
  for (const z of [-12.2, -11.2, -10.2]) d.wallBox('-x', 45.8, z, Q + 1.2, 0.8, 1.1, 0.25, 0x7d8488, { grille: z === -11.2, glow: z === -10.2 ? 0x49ff8a : undefined });
  d.wallBox('-x', 45.8, -8.6, Q + 1.0, 1.4, 1.7, 0.35, 0x6a7a70, { glow: 0xff8a3c });
  d.sign('-x', 45.8, -8.6, Q + 2.8, 'MCC-3  400 V', { h: 0.22, bg: '#f0d040' });
  d.cableTray([45.6, Q + 3.2, -27.6], [45.6, Q + 3.2, -1], 0.35);
  d.cableTray([12.4, Q + 3.2, -27.6], [12.4, Q + 3.2, -17], 0.3);
  d.wallBox('-z', -0.2, 26.2, Q + 1.4, 0.12, 0.14, 0.04, 0xb8221a);
  d.sign('-z', -0.2, 22, Q + 3.5, 'EXIT', { h: 0.25, bg: '#1d8a3a', fg: '#f0fff0', glow: 1.3 });
  d.sign('+x', 12.2, -14, Q + 3.3, 'EXIT', { h: 0.25, bg: '#1d8a3a', fg: '#f0fff0', glow: 1.3 });
  board(d, '+z', -27.8, 24.5, Q + 2.9, ['HEARING PROTECTION', 'MUST BE WORN'], 1.3, 0.24, { bg: '#2a5aa0', fg: '#f2f2f2' });
  board(d, '+z', -27.8, 32, Q + 2.6, ['DANGER', 'ROTATING MACHINERY', 'ISOLATE BEFORE WORK'], 1.2, 0.22, { bg: '#f0d040' });
  d.wallProp('security_camera_01', '-z', -0.2, 45, Q + 5, { collide: false });
  // Under the mezzanine: lights on its soffit
  for (const x of [30, 38]) d.ceilingProp('mounted_fluorescent_lights', x, M - 0.3, -24);
  d.puddles([18, -3.2, 26, -0.4], Q, 6, [0.8, 2]);
  d.puddles([42, -7, 45.6, -2], Q, 4, [0.8, 2]);
}

/** Gallery under the hall: wheels and gauges on the pump bases, valve signage, trays, emergency lamps, damp. */
function galleryDetail(d: Dresser): void {
  const b = d.b;
  [20, 28, 36].forEach((x, i) => {
    wheel(d, [x + 1.2, 1.5, -11.8], 'z', 0.3);
    gauge(d, '+z', -12, x - 1.1, 2.2);
    d.stencil('+z', -12, x - 1.1, 1.2, `P-${i + 1} SUCTION`, { h: 0.2 });
    d.hazard(x - 2, -11.6, x + 2, -11.6, 0, 0.2);
  });
  wheel(d, [39.5, 1.45, -14], 'x', 0.55, 0xb82a1a); // painted rim behind the main valve handle
  board(d, '-x', 42, -14, 3.4, ['MAIN VALVE V-1', 'DOCK 2 DRAIN'], 1.1, 0.22, { bg: '#f0d040' });
  board(d, '+x', 14, -16, 3.8, ['CULVERT C3', 'TO No. 2 DRY DOCK'], 1.1, 0.2, { bg: '#e8e4d6' });
  d.sign('+x', 14, -6.2, 2.4, 'UP: PUMP HALL', { h: 0.3, bg: '#1d8a3a', fg: '#f0fff0', glow: 1.3 });
  // Sump grate by the valve
  b.box([37.4, 0, -10.6], [38.8, 0.02, -9.2], b.flat(0x1e2022, 0.7), { collide: false, shadow: false });
  for (let x = 37.5; x < 38.8; x += 0.18) b.box([x, 0.02, -10.55], [x + 0.06, 0.04, -9.25], b.flat(STEEL, 0.55, 0.45), { collide: false, shadow: false });
  d.cableTray([14.3, 5.5, -10.6], [41.7, 5.5, -10.6], 0.35);
  for (const x of [16, 26, 34, 41]) b.box([x - 0.15, 4.3, -23.98], [x + 0.15, 4.45, -23.9], b.glow(0xff5a48, 1.6), { collide: false });
  d.streaks('+z', -24, 14, 42, 0, Q - 1, 26, { opacity: 0.6 });
  d.streaks('-x', 42, -24, -4, 0, Q - 1, 14, { opacity: 0.6 });
  d.puddles([14.5, -23.5, 41.5, -6.8], 0, 18, [0.8, 2.6]);
}

/** Control room: the mimic board, filing, the radio log, the clock. */
function controlDetail(d: Dresser): void {
  const b = d.b;
  // Drainage mimic board on the north wall: the three pumps and the dock on a dark panel
  onWall(d, '+z', -27.8, [32.2, 37.4], [M + 1.25, M + 2.75], [0, 0.04], 0x23272c);
  d.sign('+z', -27.76, 34.8, M + 2.45, 'PS3 DRAINAGE', { h: 0.2, bg: '#23272c', fg: '#cfe3d4' });
  onWall(d, '+z', -27.8, [32.6, 37.0], [M + 1.85, M + 1.9], [0.04, 0.05], 0x58c8ff, 1.2);
  for (const [u, c] of [[33.4, 0x49ff8a], [34.6, 0x49ff8a], [35.8, 0x49ff8a], [36.6, 0xff5a48]] as const) {
    onWall(d, '+z', -27.8, [u - 0.12, u + 0.12], [M + 1.5, M + 1.74], [0.04, 0.055], c, 1.6);
  }
  onWall(d, '+z', -27.8, [33.4 - 0.02, 33.4 + 0.02], [M + 1.74, M + 1.85], [0.04, 0.05], 0x58c8ff, 1.2);
  b.prop('drawer_cabinet', 44.2, M, -27.5, 0, { collide: true });
  radio(d, 29.4, M + 0.79, -24.75);
  b.prop('wall_clock', 37.5, M + 2.6, -27.77, 0, { collide: false });
  noticeBoard(d, '-x', 45.8, -22.2, M + 1.0, 1.2, 0.8);
  d.wallBox('-x', 45.8, -25.9, M + 1.2, 0.5, 0.7, 0.18, 0x7d8488, { glow: 0x49ff8a });
  for (const [x, z] of [[38.6, -27.2], [40.9, -27.3], [29.3, -27.2]] as const) d.cyl([x, M + 0.95, z], 0.04, 0.1, b.flat(0xe8e4dc, 0.4), 8);
  d.wallProp('security_camera_01', '-x', 45.8, -20.5, M + 2.9, { collide: false });
}

/** The harbour beyond the quay: channel buoys and a freighter riding out the storm. */
function harbourBeyond(d: Dresser): void {
  const b = d.b;
  for (const [x, z, c] of [[-64, -12, 0xff3a2a], [-70, 16, 0x49ff8a], [-61, 40, 0xff3a2a], [-90, -40, 0x49ff8a]] as const) {
    b.prop('ocean_buoy', x, Q - 1.9, z, d.rand(0, 6), { collide: false });
    b.box([x - 0.12, Q + 0.8, z - 0.12], [x + 0.12, Q + 1.0, z + 0.12], b.glow(c, 3), { collide: false, shadow: false });
  }
  // Freighter at anchor: hull, bridge house, deck lights
  const hull = b.flat(0x1a1d20, 0.8);
  b.box([-175, 0, -40], [-120, Q + 4, -28], hull, { collide: false, shadow: false });
  b.box([-170, Q + 4, -38], [-160, Q + 14, -30], hull, { collide: false, shadow: false });
  for (let x = -169; x < -160; x += 1.6) b.box([x, Q + 11, -28.05], [x + 0.9, Q + 11.6, -28], b.glow(0xffd9a0, 1.2), { collide: false, shadow: false });
  for (const x of [-172, -140, -122]) b.box([x - 0.2, Q + 5, -34.2], [x + 0.2, Q + 5.4, -33.8], b.glow(0xffe8c0, 3), { collide: false, shadow: false });
}
