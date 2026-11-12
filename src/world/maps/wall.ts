import * as THREE from 'three';
import type { QualityPreset } from '../../core/settings';
import { ENV, LevelBuilder, stairRun, type Rect, type V3 } from '../level';
import { Dresser } from '../dress';
import { worldFromLevel, type WorldMap } from '../map';

/**
 * M6 The Wall: piers 4 to 6 of the Veyle Storm Barrier and the control tower, 110 x 60 m, at the
 * surge peak. Sea to the north, harbour to the south.
 *
 *   y = 0    service gallery inside the sill
 *   y = 8    road deck
 *   y = 14   machinery houses on the piers, the gate-frame catwalk, the tower's middle floor
 *   y = 20   control room
 *
 * Each pier's house is reached by its own stair from the deck or along the catwalk from the next
 * house. The tower has three ways in: the deck door, the catwalk door, and the gallery stair that
 * comes up inside it.
 */

const D = 8;
const H = 14;
const T = 20;
export const PIERS = [-25, 0, 25];

export const WALL = {
  spawn: [-52, D, 0] as V3,
  consoles: PIERS.map((c) => [c, H + 1.2, -9.1] as V3),
  control: [47, T, 0] as V3,
  lock: [53.5, T + 1.2, 0] as V3,
  lantern: [52, T, 4.5] as V3,
  arrest: [52, T + 1.2, 4.5] as V3,
  leave: [41.2, T + 1.2, 0] as V3,
};

export async function buildWall(scene: THREE.Scene, q: QualityPreset, gl: THREE.WebGLRenderer): Promise<WorldMap> {
  const b = await LevelBuilder.create(q, ['concrete', 'floor', 'asphalt', 'steel', 'rust', 'blue', 'painted'],
    ['concrete_road_barrier', 'concrete_road_barrier_02', 'covered_car', 'wooden_military_crate', 'Barrel_01', 'utility_box_01']);
  const conc = b.tint('concrete', 0x8a8e90);
  const concDark = b.tint('concrete', 0x62676a);
  const road = b.tint('asphalt', 0x9a9a98, 0.55);
  const steel = b.tint('steel', 0x70767d);
  const gate = b.tint('blue', 0x7f93a6);
  const yellow = b.tint('steel', 0xb8922c);
  const dark = b.flat(0x22262b, 0.5, 0.3);
  const sandbag = b.flat(0x8a7f64, 0.95);

  // --- Service gallery inside the sill: a tall tube under the deck
  b.ground([-50, -3, 50, 3], concDark);
  b.wall(-50, -3.25, 50, -3.25, 0, D - 1, concDark, { t: 0.5 });
  b.wall(-50, 3.25, 50, 3.25, 0, D - 1, concDark, { t: 0.5 });
  b.wall(-50.25, -3.5, -50.25, 3.5, 0, D - 1, concDark, { t: 0.5 });
  b.wall(54.75, -3.5, 54.75, 3.5, 0, D - 1, concDark, { t: 0.5 });
  const gRun = stairRun(0, D);
  const g1: Rect = [-48, 1, -48 + gRun, 3];
  const g2: Rect = [4, -3, 4 + gRun, -1];
  const g3: Rect = [38, 1, 38 + gRun, 3];
  b.stairs(-48, 2, '+x', 0, D, 2, steel);
  b.stairs(4, -2, '+x', 0, D, 2, steel);
  b.stairs(38, 2, '+x', 0, D, 2, steel);
  for (const x of [-30, -12, 24, 32]) b.box([x - 1.2, 0, -2.9], [x + 1.2, 2.0, -1.6], b.tint('rust', 0x8d8f90)); // hydraulic packs
  for (const x of [-20, -4, 30]) b.box([x - 1.0, 0, 1.4], [x + 1.0, 1.1, 2.8], dark);
  b.crates(-38, 0, -1.8, 2);
  b.crates(22, 0, 1.6, 2, 0.3);
  b.box([-50, 4.2, -2.95], [54, 4.6, -2.6], steel, { collide: false }); // cable trays
  b.box([-50, 4.2, 2.6], [54, 4.6, 2.95], steel, { collide: false });

  // --- Road deck with the three gallery stairs coming up through it
  b.floor([-55, -6, 55, 6], D, road, [g1, g2, g3], 1);
  const stairRails = (r: Rect, y: number): void => {
    b.rail(r[0], r[1], r[2], r[1], y, yellow, 1.0);
    b.rail(r[0], r[3], r[2], r[3], y, yellow, 1.0);
    b.rail(r[0], r[1], r[0], r[3], y, yellow, 1.0);
  };
  stairRails(g1, D);
  stairRails(g2, D);
  b.rail(-55, 6, 40, 6, D, conc, 1.1);
  b.rail(-55, -6, 40, -6, D, conc, 1.1);
  b.box([-55.3, D, -6], [-55, D + 1.1, 6], conc);

  // --- Piers: mass on the sea side carrying the machinery house, a buttress on the harbour side
  const hRun = stairRun(D, H);
  PIERS.forEach((c, i) => {
    b.box([c - 5, 0, -11.4], [c + 5, H - 0.4, -6.05], conc, { tile: 4 });
    b.box([c - 4, 0, 6.05], [c + 4, D + 4.5, 9.5], conc, { tile: 4 });
    for (const dx of [-4.4, 4.4]) b.column(c + dx, -10.75, H - 0.4, H + 12, 1.1, conc); // gate towers
    b.box([c - 5, H + 12, -11.4], [c + 5, H + 13.2, -10.1], conc, { collide: false });
    // House floor reaches over the deck's north lane, where its stair arrives
    b.slab(c - 5, -10, c + 5, -2, H, steel, 0.4);
    b.stairs(c - 5 - hRun, -5, '+x', D, H, 2, steel);
    b.room(c - 5, -10, c + 5, -2, H, H + 3.4, b.tint('painted', 0xa9b0b3), {
      t: 0.25, roof: steel,
      w: [[-6, -4, 0, 2.4], [-9.4, -7.4, 0, 2.4]],
      e: [[-9.4, -7.4, 0, 2.4]],
      s: [[c - 3.5, c + 3.5, 1.0, 2.4]],
    });
    b.box([c - 2.5, H, -9.7], [c + 2.5, H + 1.0, -9.0], dark); // manual hold console
    b.box([c - 2.2, H + 1.0, -9.65], [c + 2.2, H + 1.8, -9.6], b.glow(0xff8a3c, 0.6), { collide: false });
    b.box([c + 2.4, H, -5.2], [c + 4.2, H + 1.6, -3.2], b.tint('rust', 0x8d8f90)); // winch
    // Sandbag checkpoint on the deck by each pier
    b.box([c + 6, D, -0.6], [c + 6.8, D + 1.05, 3.4], sandbag);
    b.box([c + 6, D, 3.4], [c + 9, D + 1.05, 4.2], sandbag);
    b.lamp(c, H + 3.3, -6, { color: 0xffe0b0, size: 0.5 });
    b.lamp(c, D + 4.4, 6, { color: 0xdfe8ff, power: i === 1 ? 120 : 90, range: 26, size: 0.5 });
  });
  // Gate leaves between the piers, with the catwalk along their top
  const spans: [number, number][] = [[-45, PIERS[0] - 5], [PIERS[0] + 5, PIERS[1] - 5], [PIERS[1] + 5, PIERS[2] - 5], [PIERS[2] + 5, 40]];
  spans.forEach(([x0, x1], i) => {
    b.box([x0, 1, -8.6], [x1, H - 0.25, -7.8], gate, { tile: 2.5 });
    if (i > 0) {
      b.slab(x0, -9.4, x1, -7.4, H, steel, 0.25);
      b.rail(x0, -9.4, x1, -9.4, H, yellow, 1.0);
      b.rail(x0, -7.4, x1, -7.4, H, yellow, 1.0);
    }
  });
  b.box([-55, 0, -10], [-45, D, -6.05], conc, { tile: 4 }); // west abutment
  b.box([-55, 0, 6.05], [-45, D, 10], conc, { tile: 4 });

  // --- Deck cover: barriers and two abandoned trucks; the stretches between piers are left bare
  b.prop('covered_car', -38, D, -2.4, 1.5, { scale: 1.3 });
  b.prop('covered_car', 12, D, 3.2, 1.65, { scale: 1.3 });
  for (const [x, z, r] of [[-44, -2, 1.57], [-33, 0, 1.57], [-14, 2.5, 1.57], [-8, -2, 1.57], [8, 0.5, 1.57], [19, -2.5, 1.57], [34, 2, 1.57], [36, -3, 1.57]] as const) {
    b.prop(x % 2 ? 'concrete_road_barrier' : 'concrete_road_barrier_02', x, D, z, r);
  }
  b.crates(-46, D, 4, 2);
  b.crates(-18, D, 4.6, 2, 0.3);
  b.crates(30, D, 4.6, 3);
  b.prop('Barrel_01', -2, D, 5);
  b.prop('utility_box_01', 22, D, 5.4, Math.PI);

  // --- Control tower on the east abutment (x 40..55, z -9..9)
  b.box([40, 0, -10], [55, D - 1, -3.5], conc, { tile: 4 });
  b.box([40, 0, 3.5], [55, D - 1, 10], conc, { tile: 4 });
  b.slab(40, -9, 55, -6, D, conc, 1);
  b.slab(40, 6, 55, 9, D, conc, 1);
  const TOP = T + 4;
  b.room(40, -9, 55, 9, D, TOP, conc, {
    t: 0.4, roof: concDark,
    w: [[-1.5, 1.5, 0, 2.6], [-8.8, -7.4, H - D, H - D + 2.4], [-5.5, -1.8, T - D + 1.0, T - D + 2.6], [1.8, 5.5, T - D + 1.0, T - D + 2.6]],
    n: [[43, 52, T - D + 1.0, T - D + 2.6]],
    s: [[43, 52, T - D + 1.0, T - D + 2.6]],
  });
  b.glass([39.95, T + 1, -5.5], [40.05, T + 2.6, -1.8]);
  b.glass([39.95, T + 1, 1.8], [40.05, T + 2.6, 5.5]);
  const tRun = stairRun(D, H);
  const fa: Rect = [42.1, 5.4, 42.1 + tRun, 7.6];
  const fb: Rect = [52.9 - tRun, -6.6, 52.9, -4.4];
  b.stairs(42.1, 6.5, '+x', D, H, 2.2, steel);
  b.floor([40.2, -8.8, 54.8, 8.8], H, steel, [fa], 0.3);
  b.stairs(52.9, -5.5, '-x', H, T, 2.2, steel);
  b.floor([40.2, -8.8, 54.8, 8.8], T, b.tint('floor', 0x9a9d9e), [fb], 0.3);
  b.rail(fa[0], fa[1], fa[2], fa[1], H, yellow, 1.0);
  b.rail(fa[0], fa[1], fa[0], fa[3], H, yellow, 1.0);
  b.rail(fb[0], fb[3], fb[2], fb[3], T, yellow, 1.0);
  b.rail(fb[2], fb[1], fb[2], fb[3], T, yellow, 1.0);
  stairRails([g3[0], g3[1], Math.min(g3[2], 54.6), g3[3]], D);
  // Control room: the gate console on the east wall, desks for cover
  b.box([53.6, T, -3], [54.5, T + 1.0, 3], dark);
  b.box([53.9, T + 1.0, -2.6], [54.0, T + 2.2, 2.6], b.glow(0x6fd6ff, 0.5), { collide: false });
  b.box([45, T, -1.2], [49, T + 0.9, 0], dark);
  b.box([45, T, 3], [46, T + 0.9, 7], dark);
  b.box([50, T, 6.6], [53, T + 1.9, 7.4], dark);
  b.crates(47, H, -2, 2);
  b.box([44, H, 1], [48, H + 1.0, 2], dark);
  b.crates(46, D, -4.5, 2);
  b.box([49, D, -2.5], [50, D + 1.1, 0.5], sandbag);

  // --- Light: floods on every pier, red emergency lamps in the gallery, the tower lit from inside
  for (const x of [-40, -10, 20, 46]) b.lamp(x, D - 1.05, 0, { color: 0xff5a48, power: 30, range: 16, size: 0.35, flicker: x === 20 ? 0.06 : 0 });
  b.lamp(47, T + 3.9, 0, { color: 0xfff0d8, power: 70, range: 16, size: 0.6 });
  b.lamp(47, T - 0.4, 2, { color: 0xffd9a0, power: 35, range: 13, size: 0.4 });
  b.lamp(-50, D + 5, 5.4, { color: 0xdfe8ff, power: 90, range: 24, size: 0.5 });
  b.column(-50, 5.6, D, D + 5, 0.2, steel);

  // Water: sheet 0 is the gallery (it floods behind you); the sea is either side of the barrier
  b.water([-50, -3, 54.5, 3], 0, 0x0c1a1c);
  b.water([-300, -300, 300, -6.5], 6.4, 0x0b161b);
  b.water([-300, 6.5, 300, 300], 5.2, 0x0b161b);

  const bounds = new THREE.Box3(new THREE.Vector3(-55, 0, -30), new THREE.Vector3(55, 30, 30));
  dress(new Dresser(b, 606), bounds);
  const level = b.finish(scene, gl, ENV.dawnStorm, bounds);
  return worldFromLevel('wall', level, {
    bounds,
    spawn: WALL.spawn,
    spawnYaw: -Math.PI / 2,
    navGround: [[-50, -3, 54.5, 3]],
    menuCam: { center: [0, 12, 0], radius: 58, height: 30 },
  });
}

/** The barrier at the surge peak: a road deck abandoned in the evacuation, the machinery, the city it protects. */
function dress(d: Dresser, bounds: THREE.Box3): void {
  const b = d.b;
  // The city behind the barrier (harbour side), dark but for emergency power; the open sea in front
  d.skyline(bounds, { sides: ['+z'], near: 50, far: 260, h: [12, 70], lit: 0.12, count: 90 });
  d.skyline(bounds, { sides: ['-x', '+x'], near: 40, far: 140, h: [6, 20], lit: 0.06, count: 20 });

  // --- Road deck: lanes, the debris of an evacuation, lamp posts down the harbour side
  const deck: [number, number, number, number] = [-54.8, -5.8, 39.8, 5.8];
  d.line(-55, 0, 40, 0, D, { color: 0xd8d2bf, w: 0.14, dash: 3, gap: 3 });
  d.line(-55, -5.3, 40, -5.3, D, { color: 0xd8d2bf, w: 0.14 });
  d.line(-55, 5.3, 40, 5.3, D, { color: 0xd8d2bf, w: 0.14 });
  d.stains(deck, D, 50, 0x090909, 0.5);
  d.stains(deck, D, 16, 0x16232a, 0.35, [1.5, 4]);
  d.debris(deck, D, 180, { paper: 0.35 });
  d.scatter(deck, D, 28, [
    ['metal_jerrycan', 3], ['trashbag', 2], ['old_tyre', 2], ['cardboard_box_01', 2], ['Barrel_02', 2, { collide: true }],
    ['plastic_crate_03', 1], ['hand_truck', 1], ['cement_bag', 1], ['rusted_wheel_rim_01', 1],
  ], { clear: [[-49, 0.5, -38, 3.5], [3, -3.5, 15, -0.5], [37, 0.5, 40, 3.5]] });
  for (let x = -50; x <= 36; x += 14) {
    if (Math.abs(x - -50) < 1) continue; // the existing post at the west end
    d.lampPost(x, 5.6, D, '-z', { h: 5.5 });
  }
  for (const r of [[-55, -6, 40, -6], [-55, 6, 40, 6]] as const) {
    for (let x = r[0] + 4; x < r[2]; x += 8) {
      if (PIERS.some((c) => Math.abs(x - c) < 6)) continue;
      d.hazard(x, r[1] + Math.sign(r[1]) * -0.3, x + 1.6, r[1] + Math.sign(r[1]) * -0.3, D, 0.25);
    }
  }
  b.prop('portable_generator', -26.5, D, 4.6, 0.3);
  b.prop('portable_searchlight', -24.5, D, 4.5, 2.6, { collide: false });
  b.prop('portable_searchlight', 26.5, D, 4.5, 3.4, { collide: false });

  // --- Piers: houses dressed inside, ladders and lights on the gate towers
  PIERS.forEach((c) => {
    d.shelves(c - 4.8, -9.8, c - 4.8, -6.5, H, '+x');
    b.prop('tool_cart', c + 3.6, H, -7.2, 1.1);
    b.prop('metal_toolbox', c + 3.2, H + 1.6, -4.2, 0.4, { collide: false });
    d.debris([c - 4.8, -9.8, c + 4.8, -2.2], H, 26, { paper: 0.5 });
    d.ceilingProp('mounted_fluorescent_lights', c, H + 3.4, -6);
    d.wallProp('korean_fire_extinguisher_01', '-x', c + 4.87, -3, H + 0.4, { collide: false });
    for (const dx of [-4.4, 4.4]) d.wallProp('security_light', '+z', -10.2, c + dx, H + 10, { collide: false });
    d.pipe([c - 3, H - 0.4, -6.2], [c - 3, D, -6.2], 0.25, 0x56605c, { brackets: false });
  });

  // --- Service gallery: wet floor, ducts, stores
  const gal: [number, number, number, number] = [-49.8, -2.9, 54.4, 2.9];
  d.stains(gal, 0, 40, 0x0c1a1f, 0.55, [1, 3.5]);
  d.debris(gal, 0, 90, { paper: 0.2 });
  d.pipe([-50, 5.6, -2.7], [54.5, 5.6, -2.7], 0.22, 0x3e4a44);
  d.pipe([-50, 6.1, 2.7], [54.5, 6.1, 2.7], 0.12, 0x8a3a2a);
  d.scatter(gal, 0, 12, [['metal_jerrycan', 2], ['WetFloorSign_01', 1], ['cardboard_box_01', 1], ['trashbag', 1], ['metal_toolbox', 1]],
    { clear: [[-48.5, 0.5, -48 + 10, 3.5], [3.5, -3.5, 4 + 10, -0.5], [37.5, 0.5, 48.5, 3.5]] });
  for (let x = -44; x < 54; x += 12) d.ceilingProp('mounted_fluorescent_lights', x, D - 1, 0, Math.PI / 2);

  // --- Control tower: desks, racks, paper
  d.desk(44, T, -6, '+x');
  d.desk(44, T, 6.5, '+x');
  d.shelves(40.3, -8.6, 40.3, -6.6, T, '+x');
  b.prop('Television_01', 47, T + 0.9, -0.6, Math.PI, { collide: false, scale: 0.6 });
  d.debris([40.3, -8.7, 54.7, 8.7], T, 50, { paper: 0.9 });
  d.debris([40.3, -8.7, 54.7, 8.7], H, 30, { paper: 0.6 });
  d.scatter([40.3, -8.7, 54.7, 8.7], H, 8, [['cardboard_box_01', 2], ['metal_jerrycan', 1], ['medical_box', 1], ['plastic_crate_03', 1]]);
  d.ceilingProp('mounted_fluorescent_lights', 47, T + 3.95, -4);
  d.ceilingProp('mounted_fluorescent_lights', 47, H + 5.7, 2);
  d.windows('+x', 55.2, -9, 9, D, T + 4, { floor: 6, lit: 0.5, spacing: 3 });
  d.roof(40, -9, 55, 9, T + 4.3);
  // Cables from the tower down the deck to the piers
  d.cables([[[40, T + 3, -9], [PIERS[2] + 5, H + 3.4, -10]], [[PIERS[2] - 5, H + 3.4, -10], [PIERS[1] + 5, H + 3.4, -10]], [[PIERS[1] - 5, H + 3.4, -10], [PIERS[0] + 5, H + 3.4, -10]]], 2);
}
