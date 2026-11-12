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
  const b = await LevelBuilder.create(q, ['concrete', 'floor', 'asphalt', 'steel', 'rust', 'blue', 'painted']);
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
  const level = await b.finish(scene, gl, ENV.dawnStorm, bounds);
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
  d.desk(47.5, T, -8.25, '+z'); // under the north window, clear of the head of the control-room stair
  d.desk(44, T, 6.5, '+x');
  d.shelves(40.3, -8.6, 40.3, -6.6, T, '+x');
  b.prop('Television_01', 47, T + 0.9, -0.6, Math.PI, { collide: false, scale: 0.6 });
  d.debris([40.3, -8.7, 54.7, 8.7], T, 50, { paper: 0.9 });
  d.debris([40.3, -8.7, 54.7, 8.7], H, 30, { paper: 0.6 });
  d.scatter([40.3, -8.7, 54.7, 8.7], H, 8, [['cardboard_box_01', 2], ['metal_jerrycan', 1], ['medical_box', 1], ['plastic_crate_03', 1]]);
  d.ceilingProp('mounted_fluorescent_lights', 47, T + 3.95, -4);
  d.ceilingProp('mounted_fluorescent_lights', 47, T + 3.95, 4);
  d.ceilingProp('mounted_fluorescent_lights', 47, H + 5.7, 2);
  d.windows('+x', 55.2, -9, 9, D, T + 4, { floor: 6, lit: 0.5, spacing: 3 });
  d.roof(40, -9, 55, 9, T + 4.3);
  // Cables from the tower down the deck to the piers
  d.cables([[[40, T + 3, -9], [PIERS[2] + 5, H + 3.4, -10]], [[PIERS[2] - 5, H + 3.4, -10], [PIERS[1] + 5, H + 3.4, -10]], [[PIERS[1] - 5, H + 3.4, -10], [PIERS[0] + 5, H + 3.4, -10]]], 2);

  deckDetail(d);
  PIERS.forEach((c, i) => pierDetail(d, c, i));
  catwalkDetail(d);
  galleryDetail(d);
  towerDetail(d);
  beyond(d);
}

// ---------------------------------------------------------------------------------------------
// Small local kit (boxes and merged geometry, so nearly free). Shared shapes copied from Spillway.

type Face = '+x' | '-x' | '+z' | '-z';
const YELLOW = 0xc79a2a;
const DARK = 0x2b2e31;
const PAPER = 0xd8d4c8;
const STEEL = 0x5a5f63;
const RED = 0xa82418;
const HYD = 0x4f6470; // machinery blue-grey
const CHROME = 0xc4c8cc;
const AMBER = 0xffa020;
const BEACON_RED = 0xff3a2a;
const LED_GREEN = 0x49ff8a;
const SCREEN = 0x5a8cb0;
const WINDOW = 0xffd9a0;
/** Gates 4 to 7 hang in these spans, west to east. */
const SPANS: [number, number][] = [[-45, PIERS[0] - 5], [PIERS[0] + 5, PIERS[1] - 5], [PIERS[1] + 5, PIERS[2] - 5], [PIERS[2] + 5, 40]];

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
    d.b.geo(g, d.b.flat(color, 0.6, 0.4));
  };
  disc(r, 0.06, 0.03, DARK);
  disc(r * 0.82, 0.01, 0.065, PAPER);
  onWall(d, face, at, [along - 0.01, along + 0.01], [y, y + r * 0.7], [0.07, 0.075], RED);
}

/** A board on a post standing on the floor, its face toward `face`. */
function signPost(d: Dresser, x: number, z: number, y: number, face: Face, lines: string[], w: number, opts: { bg?: string } = {}): void {
  const top = y + 1.9;
  d.b.box([x - 0.04, y, z - 0.04], [x + 0.04, top, z + 0.04], d.b.flat(STEEL, 0.6, 0.4), { collide: false });
  const out = face[0] === '+' ? 1 : -1;
  board(d, face, (face[1] === 'z' ? z : x) + out * 0.04, face[1] === 'z' ? x : z, top - 0.05, lines, w, 0.2, opts);
}

/** Bank of steel lockers against a wall, `a` to `c` along it. One solid box. */
function lockers(d: Dresser, face: Face, at: number, a: number, c: number, y: number, color = 0x4f6470): void {
  const deep = 0.5, h = 1.9;
  onWall(d, face, at, [a, c], [y, y + h], [0, deep], color);
  for (let u = a + 0.5; u < c - 0.05; u += 0.5) onWall(d, face, at, [u - 0.012, u + 0.012], [y + 0.05, y + h - 0.05], [deep, deep + 0.008], DARK);
  for (let u = a + 0.25; u < c; u += 0.5) {
    for (const k of [0, 1, 2]) onWall(d, face, at, [u - 0.12, u + 0.12], [y + 1.55 + k * 0.06, y + 1.58 + k * 0.06], [deep, deep + 0.008], DARK);
    onWall(d, face, at, [u + 0.14, u + 0.18], [y + 0.95, y + 1.1], [deep, deep + 0.03], PAPER);
  }
  const out = face[0] === '+' ? 1 : -1;
  const v0 = Math.min(at, at + out * deep), v1 = Math.max(at, at + out * deep);
  d.b.colliders.push(face[1] === 'z'
    ? new THREE.Box3(new THREE.Vector3(a, y, v0), new THREE.Vector3(c, y + h, v1))
    : new THREE.Box3(new THREE.Vector3(v0, y, a), new THREE.Vector3(v1, y + h, c)));
}

/** A field radio set on a table: case, dial window, knobs, a whip aerial and the handset. */
function radio(d: Dresser, x: number, y: number, z: number): void {
  const b = d.b, dk = b.flat(DARK, 0.6, 0.4);
  b.box([x - 0.22, y, z - 0.13], [x + 0.22, y + 0.24, z + 0.13], dk, { collide: false });
  b.box([x - 0.18, y + 0.13, z + 0.13], [x - 0.02, y + 0.2, z + 0.135], b.glow(AMBER, 2.5), { collide: false, shadow: false });
  for (const u of [0.06, 0.14]) d.cyl([x + u, y + 0.08, z + 0.13], 0.025, 0.02, b.flat(DARK, 0.6, 0.4), 8);
  d.cyl([x + 0.17, y + 0.24, z - 0.08], 0.006, 0.7, b.flat(DARK, 0.6, 0.4), 4);
  b.box([x + 0.26, y, z - 0.04], [x + 0.4, y + 0.05, z + 0.04], b.flat(DARK, 0.6, 0.4), { collide: false });
}

/** Cork notice board with pinned sheets. */
function noticeBoard(d: Dresser, face: Face, at: number, along: number, y: number, w = 1.4, h = 0.9): void {
  onWall(d, face, at, [along - w / 2, along + w / 2], [y, y + h], [0, 0.03], 0x7a5a3a);
  for (let i = 0; i < 7; i++) {
    const u = d.rand(along - w / 2 + 0.15, along + w / 2 - 0.15), yy = d.rand(y + 0.1, y + h - 0.35);
    const sw = d.rand(0.18, 0.26);
    onWall(d, face, at, [u - sw / 2, u + sw / 2], [yy, yy + sw * 1.35], [0.03, 0.035], d.pick([PAPER, 0xe8e0a0, 0xc8d8e0]));
  }
}

/**
 * A multi-line board made of stacked one-line signs, `h` per line, all `w` wide. (A multi-line
 * `sign` takes a slot as tall as all its lines in the shared atlas row, which fills it fast.)
 */
function board(d: Dresser, face: Face, at: number, along: number, top: number, lines: string[], w: number, h: number,
  opts: { bg?: string; fg?: string } = {}): void {
  lines.forEach((l, i) => d.sign(face, at, along, top - (i + 1) * h, l, { ...opts, w, h, font: i === 0 ? undefined : '600 56px "Arial Narrow", Arial, sans-serif' }));
}

/** Warning beacon: a dark base, a glowing lens, a cap. Glow only, no light. */
function beacon(d: Dresser, x: number, y: number, z: number, color = AMBER, s = 0.12): void {
  const b = d.b, dk = b.flat(DARK, 0.6, 0.4), o = { collide: false, shadow: false };
  b.box([x - s * 1.4, y, z - s * 1.4], [x + s * 1.4, y + 0.06, z + s * 1.4], dk, o);
  b.box([x - s, y + 0.06, z - s], [x + s, y + 0.06 + s * 2.2, z + s], b.glow(color, 2.5), o);
  b.box([x - s * 1.15, y + 0.06 + s * 2.2, z - s * 1.15], [x + s * 1.15, y + 0.11 + s * 2.2, z + s * 1.15], dk, o);
}

/**
 * Vertical hydraulic gate ram standing at (x, z): foot, barrel, gland, chrome rod up to the
 * clevis at y1, the hose ports. Solid round the barrel.
 */
function ram(d: Dresser, x: number, z: number, y0: number, y1: number): void {
  const b = d.b, body = b.flat(HYD, 0.6, 0.4), rod = b.flat(CHROME, 0.25, 0.9), dk = b.flat(DARK, 0.6, 0.4);
  const L = (y1 - y0) * 0.5;
  b.box([x - 0.36, y0, z - 0.36], [x + 0.36, y0 + 0.22, z + 0.36], dk, { collide: false });
  d.cyl([x, y0 + 0.22, z], 0.3, L, body, 14);
  d.cyl([x, y0 + 0.22 + L, z], 0.34, 0.14, dk, 14);
  d.cyl([x, y0 + 0.36 + L, z], 0.1, y1 - y0 - 0.62 - L, rod, 10);
  b.box([x - 0.22, y1 - 0.26, z - 0.22], [x + 0.22, y1, z + 0.22], dk, { collide: false });
  for (const y of [y0 + 0.55, y0 + L - 0.1]) b.box([x - 0.08, y, z + 0.26], [x + 0.08, y + 0.14, z + 0.38], dk, { collide: false, shadow: false });
  b.colliders.push(new THREE.Box3(new THREE.Vector3(x - 0.36, y0, z - 0.36), new THREE.Vector3(x + 0.36, y0 + 0.36 + L, z + 0.36)));
}

/** Toothed rack on a wall face, from y0 to y1: the gate leaf's climbing rack. */
function rack(d: Dresser, face: Face, at: number, along: number, y0: number, y1: number): void {
  onWall(d, face, at, [along - 0.14, along + 0.14], [y0, y1], [0, 0.06], DARK);
  for (let y = y0 + 0.06; y < y1 - 0.08; y += 0.2) onWall(d, face, at, [along - 0.11, along + 0.11], [y, y + 0.09], [0.06, 0.13], STEEL);
}

/** Pipe flange round a pipe along x. */
function flangeX(d: Dresser, x: number, y: number, z: number, r: number, color: number): void {
  d.b.geo(new THREE.CylinderGeometry(r * 1.45, r * 1.45, 0.07, 14).rotateZ(Math.PI / 2).translate(x, y, z), d.b.flat(color, 0.55, 0.45));
}

/** Steel floor hatch: chequer plate in a frame, hinges, a recessed handle. Flat, not solid. */
function hatch(d: Dresser, x: number, y: number, z: number, w = 1.1, l = 1.1): void {
  const b = d.b, o = { collide: false, shadow: false };
  b.box([x - w / 2 - 0.06, y, z - l / 2 - 0.06], [x + w / 2 + 0.06, y + 0.015, z + l / 2 + 0.06], b.flat(DARK, 0.6, 0.4), o);
  b.box([x - w / 2, y + 0.015, z - l / 2], [x + w / 2, y + 0.025, z + l / 2], b.flat(STEEL, 0.6, 0.4), o);
  for (const s of [-1, 1]) b.box([x + s * w * 0.3 - 0.08, y + 0.025, z - l / 2 - 0.04], [x + s * w * 0.3 + 0.08, y + 0.045, z - l / 2 + 0.04], b.flat(DARK, 0.6, 0.4), o);
  b.box([x - 0.12, y + 0.025, z + l / 2 - 0.16], [x + 0.12, y + 0.03, z + l / 2 - 0.1], b.flat(YELLOW, 0.6, 0.4), o);
}

/** Flat-panel monitor on a desk, its screen toward `face`; `at` is the plane of its back. */
function monitor(d: Dresser, face: Face, at: number, along: number, y: number, color = SCREEN): void {
  onWall(d, face, at, [along - 0.05, along + 0.05], [y, y + 0.14], [0.04, 0.1], DARK);
  onWall(d, face, at, [along - 0.15, along + 0.15], [y, y + 0.012], [0, 0.16], DARK);
  onWall(d, face, at, [along - 0.3, along + 0.3], [y + 0.14, y + 0.5], [0, 0.04], DARK);
  onWall(d, face, at, [along - 0.27, along + 0.27], [y + 0.165, y + 0.475], [0.04, 0.045], color, 0.9);
}

/** Fire alarm call point: red box, white window. */
function alarm(d: Dresser, face: Face, at: number, along: number, y: number): void {
  onWall(d, face, at, [along - 0.07, along + 0.07], [y, y + 0.14], [0, 0.05], RED);
  onWall(d, face, at, [along - 0.04, along + 0.04], [y + 0.04, y + 0.1], [0.05, 0.055], PAPER);
}

function mug(d: Dresser, x: number, y: number, z: number): void {
  d.cyl([x, y, z], 0.04, 0.1, d.b.flat(PAPER, 0.6, 0.4), 8);
}

// ---------------------------------------------------------------------------------------------
// Areas

/** Road deck: the entry gantry, evacuation signs, life rings, pier fronts with their rams, the abutment huts. */
function deckDetail(d: Dresser): void {
  const b = d.b;
  const steel = b.flat(STEEL, 0.6, 0.4);
  // Gantry over the road at the west abutment: the barrier's name and the closure, read from the landing
  const gx = -43; // east of the landing crates, so the south lane stays wide
  for (const z of [-5.68, 5.68]) b.box([gx - 0.12, D, z - 0.12], [gx + 0.12, D + 5.6, z + 0.12], steel);
  b.box([gx - 0.2, D + 5.0, -5.8], [gx + 0.2, D + 5.6, 5.8], steel, { collide: false });
  d.sign('-x', gx - 0.2, 0, D + 4.15, 'VEYLE STORM BARRIER', { h: 0.75, bg: '#1f3a5a', fg: '#f2efe4' });
  d.sign('-x', gx - 0.2, 0, D + 3.5, 'ROAD CLOSED  ·  SURGE IN PROGRESS', { h: 0.42, bg: '#f0d040' });
  for (const z of [-5.4, 5.4]) beacon(d, gx, D + 5.6, z);
  d.floorText(-51.5, D, -3, 'SLOW', '-x', { h: 1.4 });

  // Rails: evacuation route on the harbour side, wave warnings on the sea side
  for (const x of [-30, 12]) d.stencil('-z', 5.94, x, D + 0.4, '<< EVACUATION ROUTE', { h: 0.3, color: '#e8e2d0' });
  for (const [x0, x1] of SPANS.slice(1)) {
    const xm = (x0 + x1) / 2;
    d.stencil('+z', -5.94, xm, D + 0.4, 'DO NOT STOP', { h: 0.32, color: '#e0b030' });
    d.floorText(xm, D, -3.2, 'WASH ZONE', '-x', { h: 1.1, color: '#e0b030' });
    d.stains([x0 + 0.5, -5.8, x1 - 0.5, 1], D, 10, 0x262c1c, 0.45, [0.8, 2.4]); // wrack left by the waves
  }
  d.puddles([-54.8, -5.8, 39.8, 5.8], D, 34, [1, 3.8]);

  // Life rings in red boxes on the harbour rail
  for (const x of [-41, -9.5, 15.5, 37.5]) {
    onWall(d, '-z', 5.95, [x - 0.5, x + 0.5], [D + 0.12, D + 1.08], [0, 0.03], RED);
    d.wallProp('lifebuoy', '-z', 5.92, x, D + 0.18, { collide: false });
  }

  // Each pier on the deck: name posts, the surge warning, the pier front under its house
  PIERS.forEach((c, i) => {
    const n = 4 + i;
    signPost(d, c - 6.5, 5.45, D, '-x', [`PIER ${n}`, `GATES ${n} · ${n + 1}`], 0.9, { bg: '#e8e4d6' });
    signPost(d, c + 10.2, 5.45, D, '-x', ['NO ENTRY DURING SURGE'], 1.3, { bg: '#f0d040' });
    // Pier front (z -6.05): name, twin gate rams, damp
    d.stencil('+z', -6.05, c - 2.4, D + 2.5, `PIER ${n}`, { h: 1.1 });
    for (const dx of [0.8, 3.6]) {
      ram(d, c + dx, -5.6, D, H - 0.4);
      d.pipe([c + dx, D + 0.62, -5.24], [c + dx, D + 0.62, -6.0], 0.04, 0x3e4a44, { brackets: false });
    }
    d.streaks('+z', -6.05, c - 5, c + 5, D, H - 0.4, 14);
    hatch(d, c - 1.5, D, 3.2);
    // Buttress on the harbour side: the pier number, big, and salt streaks
    d.stencil('-z', 6.05, c, D + 1.6, `${n}`, { h: 2.2 });
    d.streaks('-z', 6.05, c - 4, c + 4, D, D + 4.5, 10);
    // Beacons on the house roof, red obstruction lights on the gate towers
    for (const s of [-1, 1]) {
      beacon(d, c + s * 4.6, H + 3.7, -2.3);
      beacon(d, c + s * 4.4, H + 13.2, -10.75, BEACON_RED, 0.15);
    }
  });

  // Gate leaves seen across the gap: the gate numbers, and a tide board on gate 5 with the design level
  SPANS.forEach(([x0, x1], i) => d.stencil('+z', -7.8, (x0 + x1) / 2, H - 3.4, `GATE ${4 + i}`, { h: 1.6 }));
  const tx = -19.1, datum = 0.8; // gauge zero at y 0.8: the sea sheet at 6.4 reads +5.6
  onWall(d, '+z', -7.8, [tx - 0.14, tx + 0.14], [datum + 4, datum + 12], [0, 0.02], PAPER);
  for (let m = 4; m <= 12; m += 0.2) {
    const major = Math.abs(m - Math.round(m)) < 0.01;
    onWall(d, '+z', -7.8, [tx - 0.14, tx + (major ? 0.14 : 0)], [datum + m - 0.02, datum + m + 0.02], [0.02, 0.025], DARK);
  }
  for (const m of [4, 6, 8, 10, 12]) d.stencil('+z', -7.8, tx + 0.5, datum + m - 0.14, `+${m}`, { h: 0.28, color: '#20201c' });
  onWall(d, '+z', -7.8, [tx - 0.4, tx + 0.4], [datum + 6.17, datum + 6.23], [0.02, 0.03], 0xb82a1a);
  d.stencil('+z', -7.8, tx + 1.35, datum + 6.05, 'DESIGN +6.2', { h: 0.26, color: '#c03020' });

  // West abutment beyond the rails: the crew shelter on the harbour side, the tool store on the sea side
  const hut = b.flat(PAPER, 0.6, 0.4), roofM = b.flat(DARK, 0.6, 0.4);
  b.box([-54.6, D, 6.7], [-50.4, D + 2.6, 9.6], hut);
  b.box([-54.8, D + 2.6, 6.5], [-50.2, D + 2.75, 9.8], roofM, { collide: false });
  b.box([-53.9, D + 1.1, 6.68], [-52.3, D + 2.0, 6.7], b.glow(WINDOW, 0.7), { collide: false });
  b.box([-51.6, D, 6.67], [-50.8, D + 2.05, 6.7], b.flat(DARK, 0.6, 0.4), { collide: false });
  d.sign('-z', 6.7, -52.5, D + 2.15, 'BARRIER CREW  ·  WEST', { h: 0.26, bg: '#1f3a5a', fg: '#e8e8e0' });
  d.wallProp('lifebuoy', '-x', -54.6, 8.2, D + 0.9, { collide: false });
  for (const x of [-48.5, -46]) d.bollard(x, D, 9.2, 'mooring');
  b.box([-54.2, D, -9.6], [-50.6, D + 2.4, -7.2], b.flat(HYD, 0.6, 0.4));
  b.box([-54.4, D + 2.4, -9.8], [-50.4, D + 2.52, -7.0], roofM, { collide: false });
  for (const x of [-53.5, -52.4]) b.box([x, D, -7.2], [x + 1.0, D + 2.1, -7.18], b.flat(DARK, 0.6, 0.4), { collide: false });
  d.sign('+z', -7.18, -52.4, D + 2.15, 'TOOL STORE 2', { h: 0.22, bg: '#e8e4d6' });
  d.pallet(-48.6, D, -8.4, 0.2, 'sacks');
  d.pallet(-47.0, D, -8.6, -0.1, 'wrapped');
  for (const x of [-49.8, -45.8]) d.cone(x, D, -6.7);
}

/** A machinery house: the gate-drive panel over the hold console, gauges, crew kit, services, signs outside. */
function pierDetail(d: Dresser, c: number, i: number): void {
  const b = d.b;
  const n = 4 + i;
  const W = c - 4.875, N = -9.875, S = -2.125; // inner wall faces (west, north, south)
  // Gate-drive mimic over the console: one bar per gate, lifting (amber), a lamp under each
  onWall(d, '+z', N, [c - 2.3, c + 2.3], [H + 1.95, H + 3.0], [0, 0.04], DARK);
  for (const [u0, u1] of [[c - 2.0, c - 0.3], [c + 0.3, c + 2.0]] as const) {
    onWall(d, '+z', N, [u0, u1], [H + 2.3, H + 2.48], [0.04, 0.05], AMBER, 2.5);
    onWall(d, '+z', N, [u0 + 0.05, u0 + 0.2], [H + 2.08, H + 2.2], [0.04, 0.055], BEACON_RED, 2.5);
  }
  for (const s of [-1, 1]) {
    gauge(d, '+z', N, c + s * 3.0, H + 2.35);
    gauge(d, '+z', N, c + s * 3.45, H + 2.35, 0.1);
  }
  // The hold console itself: its label, the emergency stop, the shift's clipboard and mug
  d.sign('+z', -9.0, c, H + 0.52, 'MANUAL HOLD', { h: 0.18, bg: '#f0d040' });
  d.cyl([c + 1.9, H + 1.0, -9.3], 0.08, 0.03, b.flat(YELLOW, 0.6, 0.4), 12);
  d.cyl([c + 1.9, H + 1.03, -9.3], 0.05, 0.05, b.flat(RED, 0.6, 0.4), 12);
  b.prop('clipboard', c - 1.6, H + 1.0, -9.3, 0.3, { collide: false });
  mug(d, c - 2.15, H + 1.0, -9.2);
  d.hazard(c - 2.5, -8.75, c + 2.5, -8.75, H, 0.1);
  // North wall either side: the notice board, breakers, the hydraulic lines down to the floor
  noticeBoard(d, '+z', N, c - 3.75, H + 0.95, 1.1, 0.75);
  d.wallBox('+z', N, c + 3.4, H + 0.9, 0.6, 0.9, 0.2, 0x7d8488, { grille: true });
  d.wallBox('+z', N, c + 4.2, H + 0.9, 0.6, 0.9, 0.2, 0x7d8488, { glow: LED_GREEN });
  for (const [y, col] of [[H + 0.25, 0x8a3a2a], [H + 0.42, 0x3e4a44]] as const) d.pipe([c + 2.55, y, -9.78], [c + 4.85, y, -9.78], 0.045, col, { brackets: false });
  d.sign('+z', N, c + 3.8, H + 2.85, 'DANGER', { h: 0.2, w: 0.8, bg: '#f0d040' });
  // Crew kit: lockers by the stair door, a tool chest in the corner, the fire point
  lockers(d, '+x', W, -3.85, -2.25, H);
  b.prop('metal_tool_chest', c + 4.3, H, -2.5, Math.PI);
  alarm(d, '-z', S, c - 3.85, H + 1.45);
  d.cableTray([c - 4.8, H + 3.15, -3.0], [c + 4.8, H + 3.15, -3.0], 0.3);
  d.streaks('+z', N, c - 4.8, c + 4.8, H, H + 3.4, 6);
  // Outside: the house's name over the deck window, a camera, names by the catwalk doors
  d.sign('+z', -1.875, c, H + 2.5, `PIER ${n}  MACHINERY HOUSE`, { h: 0.42, bg: '#1f3a5a', fg: '#f2efe4' });
  d.wallProp('security_camera_01', '+z', -1.875, c + 4.6, H + 3.0, { collide: false });
  if (i === 0) d.stencil('+x', c + 5.13, -4.4, H + 1.0, 'NO ENTRY DURING SURGE', { h: 0.28, color: '#e0b030' });
  d.streaks('+z', -1.875, c - 5, c + 5, H, H + 3.4, 8);
  // Gate towers: the leaf's climbing racks; ladders down the pier sides to the water
  for (const s of [-1, 1]) {
    rack(d, '+z', -10.2, c + s * 4.4, H + 3.8, H + 11.8);
    ladder(d, s < 0 ? '-x' : '+x', c + s * 5, -10.7, 5.6, H - 0.4);
  }
}

/** Gate-frame catwalks: gate numbers on the walkway, life rings on the sea rail. */
function catwalkDetail(d: Dresser): void {
  SPANS.forEach(([x0, x1], i) => {
    if (i === 0) return; // no catwalk on gate 4's frame
    const xm = (x0 + x1) / 2;
    d.floorText(xm, H, -8.4, `GATE ${4 + i}`, '-x', { h: 0.6, color: '#e0b030' });
    d.wallProp('lifebuoy', '+z', -9.35, xm + 2.5, H + 0.12, { collide: false });
    d.hazard(x0 + 0.2, -8.4, x0 + 0.2, -8.4, H, 0.2);
  });
}

/** Service gallery: the hydraulic power units, ribs and bays, leaks, route signs, emergency lamps. */
function galleryDetail(d: Dresser): void {
  const b = d.b;
  const NW = -3.0, SW = 3.0; // inner wall faces (sea side, harbour side)
  // Hydraulic power units: names, gauges, handwheels, risers to the main
  ([[-30, 'HPU 4'], [-12, 'HPU 5'], [24, 'HPU 6-A'], [32, 'HPU 6-B']] as const).forEach(([x, name]) => {
    d.sign('+z', -1.6, x - 0.4, 1.35, name, { h: 0.22, bg: '#f0d040' });
    gauge(d, '+z', -1.6, x + 0.7, 1.55);
    wheel(d, [x + 1.3, 1.0, -2.25], 'x', 0.25);
    d.pipe([x - 0.8, 2.0, -2.6], [x - 0.8, 5.4, -2.6], 0.1, 0x3e4a44, { brackets: false });
    d.hazard(x - 1.4, -1.35, x + 1.4, -1.35, 0, 0.15);
  });
  for (let x = -47; x < 54; x += 6) {
    flangeX(d, x, 5.6, -2.7, 0.22, 0x3e4a44);
    flangeX(d, x + 3, 6.1, 2.7, 0.12, 0x8a3a2a);
  }
  // Structural ribs every bay, with bay marks on the harbour wall
  const ribs = [-36, -26, -14, -2, 20, 26, 35];
  const rib = b.flat(STEEL, 0.6, 0.4);
  ribs.forEach((x, k) => {
    b.box([x - 0.15, 0, NW], [x + 0.15, D - 1, NW + 0.16], rib, { collide: false });
    b.box([x - 0.15, 0, SW - 0.16], [x + 0.15, D - 1, SW], rib, { collide: false });
    b.box([x - 0.15, D - 1.16, NW], [x + 0.15, D - 1, SW], rib, { collide: false, shadow: false });
    if (k % 2 === 0) d.stencil('-z', SW - 0.16, x + 0.9, 2.5, `BAY ${12 + k}`, { h: 0.28 });
  });
  // Sea side seeps; red bulkhead lamps above the cable tray
  d.streaks('+z', NW, -50, 54.5, 0, D - 1, 44, { color: 0x0d1a18, opacity: 0.55 });
  d.streaks('-z', SW, -50, 54.5, 0, D - 1, 16);
  d.puddles([-49.8, -2.9, 54.4, 2.9], 0, 30, [0.8, 3]);
  for (let x = -44; x < 54; x += 12) {
    onWall(d, '+z', NW, [x - 0.14, x + 0.14], [4.72, 4.98], [0, 0.06], DARK);
    onWall(d, '+z', NW, [x - 0.1, x + 0.1], [4.76, 4.94], [0.06, 0.09], BEACON_RED, 2.5);
  }
  // Sump grates
  for (const x of [-26, 8.5, 34]) {
    b.box([x - 0.7, 0, -0.7], [x + 0.7, 0.02, 0.7], b.flat(DARK, 0.6, 0.4), { collide: false, shadow: false });
    for (let u = x - 0.6; u < x + 0.7; u += 0.18) b.box([u, 0.02, -0.65], [u + 0.06, 0.04, 0.65], b.flat(STEEL, 0.6, 0.4), { collide: false, shadow: false });
  }
  // Route signs at the three stairs, and the warning at the west end
  const exit = { h: 0.26, bg: '#1d8a3a', fg: '#f0fff0', glow: 1.3 };
  d.sign('+z', NW, -43, 2.6, 'UP: DECK  ·  WEST ABUTMENT', exit);
  d.sign('-z', SW, 7.5, 2.6, 'UP: DECK  ·  PIER 5', exit);
  d.sign('+z', NW, 42, 2.6, 'UP: CONTROL TOWER', exit);
  board(d, '+x', -50.0, 0, 3.2, ['NO ENTRY DURING SURGE', 'GALLERY FLOODS ABOVE +5.0'], 1.6, 0.24, { bg: '#f0d040' });
}

/** Control tower: the deck lobby, the crew floor, and the control room with its wall screen and gate mimic. */
function towerDetail(d: Dresser): void {
  const b = d.b;
  const TOP = T + 4;
  // Outside: the tower's name over the deck door, the access notice, a camera, weather on the walls, the mast
  d.sign('-x', 39.8, 0, D + 3.0, 'VSB CONTROL TOWER', { h: 0.55, bg: '#1f3a5a', fg: '#f2efe4', glow: 1.3 });
  board(d, '-x', 39.8, -2.5, D + 2.0, ['AUTHORISED', 'PERSONNEL ONLY'], 0.9, 0.2, { bg: '#e8e4d6' });
  d.wallProp('security_camera_01', '-x', 39.8, 2.3, D + 2.9, { collide: false });
  d.streaks('-x', 39.8, -9, 9, D, TOP, 26);
  d.streaks('-z', -9.2, 40, 55, D, TOP, 12);
  d.cyl([52, TOP + 0.3, -6], 0.06, 6, b.flat(STEEL, 0.6, 0.4));
  beacon(d, 52, TOP + 6.3, -6, BEACON_RED, 0.15);
  beacon(d, 40.6, TOP + 0.3, -8.4, BEACON_RED, 0.12);

  // Level 0, the deck lobby: lockers, the fire point, notices, stair signs
  lockers(d, '-x', 54.8, -8.4, -5.9, D);
  d.wallProp('korean_fire_extinguisher_01', '+x', 40.2, -3.0, D + 0.4, { collide: false });
  alarm(d, '+x', 40.2, -2.4, D + 1.45);
  noticeBoard(d, '+x', 40.2, -5.6, D + 1.0);
  d.sign('-z', 8.8, 44, D + 2.4, 'UP: LEVEL 1  ·  CATWALK', { h: 0.24, bg: '#1d8a3a', fg: '#f0fff0', glow: 1.3 });
  for (const z of [-4, 2.5]) d.ceilingProp('mounted_fluorescent_lights', 48, H - 0.3, z);

  // Level 1, crew floor: a break corner by the west wall, life jackets on pegs, the way up
  const wood = b.flat(0x7a5a3a, 0.6, 0.4);
  b.box([40.7, H + 0.7, 2.2], [41.9, H + 0.76, 3.4], wood);
  for (const [x, z] of [[40.78, 2.28], [41.82, 2.28], [40.78, 3.32], [41.82, 3.32]] as const) b.box([x - 0.03, H, z - 0.03], [x + 0.03, H + 0.7, z + 0.03], wood, { collide: false });
  b.prop('plastic_monobloc_chair_01', 41.3, H, 1.75, 0.2, { collide: false });
  b.prop('plastic_monobloc_chair_01', 42.4, H, 2.9, -Math.PI / 2 - 0.3, { collide: false });
  radio(d, 41.15, H + 0.76, 3.05);
  mug(d, 41.6, H + 0.76, 2.5);
  mug(d, 41.75, H + 0.76, 2.75);
  b.prop('plastic_crate_03', 40.7, H, 4.3, 0.3, { collide: false });
  d.cyl([40.7, H + 0.27, 4.3], 0.09, 0.2, b.flat(CHROME, 0.25, 0.9), 10); // kettle
  d.wallProp('wall_clock', '+x', 40.2, 1.3, H + 2.3, { collide: false });
  noticeBoard(d, '+x', 40.2, 3.4, H + 1.1, 1.2, 0.8);
  d.sign('+x', 40.2, 3.4, H + 2.0, 'SHIFT ROTA', { h: 0.2 });
  for (const x of [45.4, 46.2, 47.0]) d.wallProp('life_jacket', '-z', 8.8, x, H + 0.95, { collide: false });
  d.sign('+x', 40.2, -6.4, H + 2.1, 'CATWALK  ·  PIERS 6 TO 4', { h: 0.22, bg: '#e8e4d6' });
  d.sign('-x', 54.8, -5.5, H + 2.4, 'UP: CONTROL ROOM', { h: 0.24, bg: '#1d8a3a', fg: '#f0fff0', glow: 1.3 });

  // Level 2, control room. The wall screen over the gate console: water at the Wall, climbing
  onWall(d, '-x', 54.8, [-3.2, 3.2], [T + 2.35, T + 3.75], [0, 0.06], DARK);
  onWall(d, '-x', 54.8, [-3.05, 3.05], [T + 2.45, T + 3.65], [0.06, 0.065], SCREEN, 0.9);
  d.sign('-x', 54.735, 0.6, T + 3.3, 'WATER AT THE WALL  +5.6 M', { h: 0.24, bg: '#0e2233', fg: '#bfe6ff', glow: 1.3 });
  for (let k = 0; k < 9; k++) {
    const z = -2.8 + k * 0.32, y = T + 2.6 + k * k * 0.008;
    onWall(d, '-x', 54.735, [z, z + 0.3], [y, y + 0.035], [0, 0.005], 0x58c8ff, 1.2);
  }
  onWall(d, '-x', 54.735, [-2.9, 3.0], [T + 3.08, T + 3.1], [0, 0.005], BEACON_RED, 2.5); // design level
  // Gate mimic south of the screen: the barrier line, gates 4 to 7 lifting, pier lamps
  onWall(d, '-x', 54.8, [3.7, 8.3], [T + 1.3, T + 2.5], [0, 0.04], DARK);
  d.sign('-x', 54.76, 6.0, T + 2.22, 'GATES 4 TO 7', { h: 0.18, bg: '#23272c', fg: '#cfe3d4' });
  onWall(d, '-x', 54.8, [3.9, 8.1], [T + 1.78, T + 1.82], [0.04, 0.05], 0x58c8ff, 1.2);
  [4.3, 5.5, 6.7, 7.9].forEach((z) => {
    onWall(d, '-x', 54.8, [z - 0.35, z + 0.35], [T + 1.85, T + 1.98], [0.04, 0.055], AMBER, 2.5);
  });
  for (const z of [4.9, 6.1, 7.3]) onWall(d, '-x', 54.8, [z - 0.06, z + 0.06], [T + 1.72, T + 1.88], [0.04, 0.06], LED_GREEN, 2.5);
  // The console: override key switch, its label, the chairs
  d.sign('-x', 53.6, 0, T + 0.55, 'GATE OVERRIDE  ·  TWO-KEY', { h: 0.18, bg: '#f0d040' });
  b.box([53.62, T + 1.0, 0.25], [53.82, T + 1.04, 0.55], b.flat(YELLOW, 0.6, 0.4), { collide: false });
  d.cyl([53.72, T + 1.04, 0.4], 0.035, 0.05, b.flat(CHROME, 0.25, 0.9), 10);
  for (const z of [-1.6, 1.8]) b.prop('modern_arm_chair_01', 52.7, T, z, Math.PI / 2 + d.rand(-0.3, 0.3), { collide: false });
  // Duty desk (the dark block in the middle): a screen, the radio, the log, mugs, a chair
  monitor(d, '-z', -0.25, 45.9, T + 0.9);
  radio(d, 48.4, T + 0.9, -0.55);
  b.prop('office_notepads', 46.4, T + 0.9, -0.75, 0.2, { collide: false });
  mug(d, 48.0, T + 0.9, -0.95);
  b.prop('modern_arm_chair_01', 47.3, T, -2.0, 0.2, { collide: false });
  // Counter on the west side: two screens, the binders
  monitor(d, '-x', 45.95, 4.2, T + 0.9);
  monitor(d, '-x', 45.95, 5.8, T + 0.9, SCREEN);
  b.prop('binder_notebook', 45.5, T + 0.9, 6.6, 1.3, { collide: false });
  mug(d, 45.4, T + 0.9, 3.4);
  // Equipment rack: status lamps and vents on its face
  for (let k = 0; k < 5; k++) {
    const x = 50.3 + k * 0.55;
    onWall(d, '-z', 6.6, [x, x + 0.4], [T + 0.3, T + 0.34], [0, 0.01], DARK);
    onWall(d, '-z', 6.6, [x, x + 0.4], [T + 0.45, T + 0.49], [0, 0.01], DARK);
    for (const [y, c] of [[T + 1.2, LED_GREEN], [T + 1.35, k === 3 ? AMBER : LED_GREEN], [T + 1.5, LED_GREEN]] as const) {
      onWall(d, '-z', 6.6, [x + 0.05, x + 0.1], [y, y + 0.04], [0, 0.012], c, 2.5);
    }
  }
  // Walls: clock between the west windows, the barrier's name, the fire point, filing, a camera
  d.wallProp('wall_clock', '+x', 40.2, 0, T + 2.3, { collide: false });
  d.sign('+z', -8.8, 47.5, T + 2.85, 'VEYLE STORM BARRIER  ·  CONTROL', { h: 0.3, bg: '#1f3a5a', fg: '#f2efe4' });
  d.wallProp('korean_fire_extinguisher_01', '+z', -8.8, 42.4, T + 0.4, { collide: false });
  alarm(d, '+z', -8.8, 41.7, T + 1.45);
  b.box([53.0, T, -8.78], [54.1, T + 1.35, -8.25], b.flat(HYD, 0.6, 0.4)); // filing cabinet
  for (const y of [T + 0.4, T + 0.85, T + 1.3]) onWall(d, '+z', -8.25, [53.1, 54.0], [y - 0.02, y], [0, 0.01], DARK);
  d.wallProp('security_camera_01', '-z', 8.8, 54.2, T + 3.4, { collide: false });
}

/**
 * Beyond the playable edge: the barrier running on west through piers 3 to 1, buoys and a
 * freighter at sea, a patrol boat in the harbour.
 */
function beyond(d: Dresser): void {
  const b = d.b;
  const o = { collide: false, shadow: false };
  const conc = b.tint('concrete', 0x8a8e90);
  const house = b.tint('painted', 0xa9b0b3);
  const gateM = b.tint('blue', 0x7f93a6);
  const far = [-80, -105, -130, -155];
  b.box([-170, D - 1, -6], [-55.3, D, 6], conc, o); // the road deck carries on
  far.forEach((c, k) => {
    b.box([c - 5, 0, -11.4], [c + 5, H - 0.4, -6], conc, o);
    b.box([c - 4, 0, 6], [c + 4, D + 4.5, 9.5], conc, o);
    b.box([c - 5, H - 0.4, -10], [c + 5, H + 3.4, -2], house, o);
    b.box([c - 3.5, H + 1.0, -1.98], [c + 3.5, H + 2.4, -1.96], b.glow(WINDOW, 0.7), o);
    for (const dx of [-4.4, 4.4]) b.box([c + dx - 0.55, H - 0.4, -11.3], [c + dx + 0.55, H + 12, -10.2], conc, o);
    b.box([c - 5, H + 12, -11.4], [c + 5, H + 13.2, -10.1], conc, o);
    for (const dx of [-4.4, 4.4]) beacon(d, c + dx, H + 13.2, -10.75, BEACON_RED, 0.18);
    b.box([c - 0.25, D + 4.4, 5.75], [c + 0.25, D + 4.5, 6.25], b.glow(0xdfe8ff, 2.6), o);
    const x1 = k === 0 ? -55 : far[k - 1] - 5;
    b.box([c + 5, 1, -8.6], [x1, H - 0.25, -7.8], gateM, o);
  });
  // Channel buoys at sea, lit
  for (const [x, z, c] of [[-30, -48, BEACON_RED], [24, -62, LED_GREEN], [70, -40, BEACON_RED]] as const) {
    d.cyl([x, 5.6, z], 0.6, 1.3, b.flat(c === BEACON_RED ? RED : 0x2f7a4a, 0.6, 0.4), 12);
    d.cyl([x, 6.9, z], 0.12, 1.2, b.flat(DARK, 0.6, 0.4), 6);
    b.box([x - 0.12, 8.1, z - 0.12], [x + 0.12, 8.3, z + 0.12], b.glow(c, 2.5), o);
  }
  // A freighter riding out the storm, far out
  const hull = b.flat(DARK, 0.6, 0.4);
  b.box([20, 0, -190], [85, 15, -176], hull, o);
  b.box([70, 15, -188], [80, 26, -178], hull, o);
  for (let x = 71; x < 80; x += 1.6) b.box([x, 23, -176.05], [x + 0.9, 23.6, -176], b.glow(WINDOW, 0.7), o);
  for (const x of [24, 50, 82]) b.box([x - 0.25, 16, -183.2], [x + 0.25, 16.5, -182.8], b.glow(0xdfe8ff, 2.6), o);
  // Patrol boat in the harbour, its searchlight on
  b.box([-14, 4, 38], [0, 6.6, 42.5], hull, o);
  b.box([-9, 6.6, 38.8], [-4, 8.6, 41.7], hull, o);
  b.box([-8.6, 7.6, 38.75], [-4.4, 8.2, 38.8], b.glow(WINDOW, 0.7), o);
  b.box([-1.0, 6.6, 39.9], [-0.4, 7.1, 40.6], b.glow(0xdfe8ff, 2.6), o);
  beacon(d, -6.5, 8.6, 40.2, 0x58c8ff, 0.12);
}
