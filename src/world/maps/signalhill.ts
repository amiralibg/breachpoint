import * as THREE from 'three';
import type { QualityPreset } from '../../core/settings';
import { ENV, LevelBuilder, stairRun, type PropId, type Rect, type V3 } from '../level';
import { Dresser, type Face } from '../dress';
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

/** Sandbag walls in the yard (centre x, z, width, depth): solid cover, 1.05 m high. */
const SANDBAGS: readonly [number, number, number, number][] = [
  [-2, -22, 3, 0.8], [3.5, -23.5, 0.8, 3], [-4.5, -23.5, 0.8, 3], [0, 1, 4, 0.8], [-12, -4, 0.8, 3.5], [16.5, -2, 3.5, 0.8], [8, 5, 0.8, 3], [-20, -8, 3, 0.8], [22, 4, 3, 0.8],
];
/** Rock outcrops on the hilltop outside the walls (x, z, half size). */
const HILL_ROCKS: readonly [number, number, number][] = [[36, 14, 2], [40, 2, 1.6], [38, -12, 2.2], [-37, 12, 2], [-39, -8, 1.8], [-36, -26, 2.2], [20, 16, 1.5], [-6, 16, 1.4]];
/** Rocks on the beach (x, z, half size). */
const BEACH_ROCKS: readonly [number, number, number][] = [[-30, 27, 1.4], [-24, 29, 0.9], [22, 28, 1.6], [30, 26, 1.1], [38, 29, 1.3], [-40, 25, 1.2]];

export async function buildSignalHill(scene: THREE.Scene, q: QualityPreset, gl: THREE.WebGLRenderer): Promise<WorldMap> {
  const b = await LevelBuilder.create(q, ['rock', 'stone', 'sand', 'concrete', 'steel', 'rust', 'floor']);
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
  for (const [x, z, w, d] of SANDBAGS) {
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
  for (const [x, z, s] of HILL_ROCKS) {
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
  const level = await b.finish(scene, gl, ENV.storm, bounds);
  return worldFromLevel('signalhill', level, {
    bounds,
    spawn: SIGNALHILL.spawn,
    spawnYaw: 0,
    navGround: [],
    menuCam: { center: [0, 14, -6], radius: 50, height: 34 },
  });
}


/** Small palette for the dressing (b.flat caches by colour, so every piece shares these). */
const C = {
  iron: 0x2b2e31, ironRust: 0x5a3a26, rope: 0x8a7a58, wood: 0x54402c, woodDark: 0x2e2418, olive: 0x4f5640,
  red: 0xa8281e, white: 0xd8d4c8, hull: 0x3f5a6a, rack: 0x23272c, steel: 0x6d737a,
};

/** An old fort turned into a relay post: the garrison's kit in the yard, the mast's cables, the coast in the storm. */
function dress(d: Dresser, bounds: THREE.Box3): void {
  const b = d.b;
  // The build's own textured materials, shared so they stay one draw call each
  const rockMat = b.tint('rock', 0x7d807c);
  const stoneMat = b.tint('stone', 0xa09c92);
  const stoneDarkMat = b.tint('stone', 0x7a776f);
  // One material per colour (each is a draw call): metal colours are always painted steel, the rest matt
  const METAL = new Set<number>([C.iron, C.ironRust, C.rack, C.steel, 0x7d8488]);
  const paint = (color: number, _rough?: number, _metal?: number): THREE.Material => (METAL.has(color) ? b.flat(color, 0.6, 0.5) : b.flat(color, 0.85));
  /**
   * A visual-only box, corners in either order. Flat colours go in as loose geometry (merged with
   * the rest of the dressing in that colour); the map's textured stone and rock go in as boxes, so
   * they merge with the walls built of them.
   */
  const deco = (p: V3, q: V3, color: number | THREE.Material, _rough?: number, _metal?: number): void => {
    const lo: V3 = [Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.min(p[2], q[2])];
    const hi: V3 = [Math.max(p[0], q[0]), Math.max(p[1], q[1]), Math.max(p[2], q[2])];
    if (hi[0] - lo[0] < 1e-4 || hi[1] - lo[1] < 1e-4 || hi[2] - lo[2] < 1e-4) return;
    if (typeof color !== 'number') {
      b.box(lo, hi, color, { collide: false });
      return;
    }
    const g = new THREE.BoxGeometry(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
    g.translate((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2);
    b.geo(g, paint(color));
  };
  const free = (p: V3, q: V3): boolean => !b.blocked(new THREE.Box3(new THREE.Vector3(...p), new THREE.Vector3(...q)));
  /** A solid box, only where nothing solid is already. */
  const solidBox = (p: V3, q: V3, color: number, rough = 0.85, metal = 0): void => {
    if (free(p, q)) b.box(p, q, paint(color, rough, metal), { tile: 1 });
  };
  const prop = (id: PropId, x: number, y: number, z: number, rot = 0, scale = 1, tilt?: [number, number]): void => {
    b.prop(id, x, y, z, rot, { collide: false, scale, tilt });
  };
  /** A solid prop, only if it touches nothing solid already there. */
  const solid = (id: PropId, x: number, y: number, z: number, rot = 0, scale = 1): boolean => {
    if (b.blocked(b.propBox(id, x, y, z, rot, scale))) return false;
    b.prop(id, x, y, z, rot, { scale });
    return true;
  };
  /** A box turned about y (and optionally leaned about its own z), standing on y. Visual only. */
  const rbox = (x: number, y: number, z: number, w: number, h: number, dd: number, rot: number, color: number, lean = 0, rough = 0.85): void => {
    const g = new THREE.BoxGeometry(w, h, dd);
    g.translate(0, h / 2, 0);
    if (lean) g.rotateZ(lean);
    g.rotateY(rot);
    g.translate(x, y, z);
    b.geo(g, paint(color, rough));
  };
  /** Rope (a thick sagging line), for moorings and lashings. */
  const rope = (a: V3, c: V3, sag = 0.15, r = 0.02): void => {
    const va = new THREE.Vector3(...a), vc = new THREE.Vector3(...c);
    const mid = va.clone().lerp(vc, 0.5);
    mid.y -= sag * 2;
    b.geo(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(va, mid, vc), 10, r, 5, false), paint(C.rope, 0.95));
  };
  /** A coil of rope lying on a deck. */
  const coil = (x: number, y: number, z: number, r = 0.28): void => {
    for (let k = 0; k < 3; k++) {
      const g = new THREE.TorusGeometry(r - k * 0.03, 0.028, 4, 14);
      g.rotateX(Math.PI / 2);
      g.translate(x + d.rand(-0.02, 0.02), y + 0.03 + k * 0.05, z + d.rand(-0.02, 0.02));
      b.geo(g, paint(C.rope, 0.95));
    }
  };
  /** A drift log or a beam: a cylinder lying on y, turned `rot` about y. */
  const log = (x: number, y: number, z: number, len: number, r: number, rot: number, color: number = C.wood): void => {
    const g = new THREE.CylinderGeometry(r * 0.85, r, len, 7);
    g.rotateZ(Math.PI / 2);
    g.rotateY(rot);
    g.translate(x, y + r * 0.9, z);
    b.geo(g, paint(color, 0.95));
  };
  /** Offsets of a wall-mounted piece: `face` is the way the wall faces, `out` metres off it. */
  const onWall = (face: Face, at: number, along: number, out: number): [number, number] => {
    const o = at + (face[0] === '+' ? out : -out);
    return face[1] === 'z' ? [along, o] : [o, along];
  };
  /** A box on a wall: `w` along it, `h` up, from `out0` to `out1` off its face. */
  const wallDeco = (face: Face, at: number, along: number, y: number, w: number, h: number, out0: number, out1: number, color: number | THREE.Material, rough = 0.8, metal = 0): void => {
    const [ax, az] = onWall(face, at, along, out0), [cx, cz] = onWall(face, at, along, out1);
    if (face[1] === 'z') deco([ax - w / 2, y, az], [cx + w / 2, y + h, cz], color, rough, metal);
    else deco([ax, y, az - w / 2], [cx, y + h, cz + w / 2], color, rough, metal);
  };
  const lens = b.glow(0xffc98a, 1.8);
  /** Caged bulkhead lamp on a wall: lit-looking, no real light. */
  const bulkhead = (face: Face, at: number, along: number, y: number): void => {
    wallDeco(face, at, along, y, 0.24, 0.3, 0, 0.05, C.iron, 0.6, 0.5);
    const [ax, az] = onWall(face, at, along, 0.05), [cx, cz] = onWall(face, at, along, 0.15);
    if (face[1] === 'z') b.box([ax - 0.08, y + 0.06, Math.min(az, cz)], [ax + 0.08, y + 0.24, Math.max(az, cz)], lens, { collide: false });
    else b.box([Math.min(ax, cx), y + 0.06, az - 0.08], [Math.max(ax, cx), y + 0.24, az + 0.08], lens, { collide: false });
    wallDeco(face, at, along, y + 0.14, 0.2, 0.02, 0.05, 0.17, C.iron, 0.6, 0.5); // cage bar
  };
  /** An iron tethering ring set in the stone, with rust bled down the wall under it. */
  const ring = (face: Face, at: number, along: number, y: number): void => {
    wallDeco(face, at, along, y, 0.12, 0.12, 0, 0.03, C.ironRust, 0.7, 0.4);
    const g = new THREE.TorusGeometry(0.09, 0.014, 4, 12);
    if (face[1] === 'x') g.rotateY(Math.PI / 2);
    const [x, z] = onWall(face, at, along, 0.04);
    g.translate(x, y - 0.06, z);
    b.geo(g, paint(C.ironRust, 0.7, 0.4));
    d.streaks(face, at, along - 0.25, along + 0.25, y - 1.6, y, 1, { base: false });
  };
  /** A stone spout draining a rampart walk, with the grime it leaves. */
  const drain = (face: Face, at: number, along: number, y: number): void => {
    wallDeco(face, at, along, y, 0.26, 0.16, 0, 0.38, stoneDarkMat);
    wallDeco(face, at, along, y + 0.1, 0.12, 0.06, 0.02, 0.4, C.rack);
    d.streaks(face, at, along - 0.35, along + 0.35, Y, y, 2, { base: false });
  };
  /** A coping stone along the top of a parapet. */
  const coping = (x0: number, z0: number, x1: number, z1: number, y: number): void => {
    const alongX = Math.abs(z1 - z0) < 1e-6;
    if (alongX) deco([Math.min(x0, x1) - 0.1, y, z0 - 0.16], [Math.max(x0, x1) + 0.1, y + 0.09, z0 + 0.16], stoneDarkMat);
    else deco([x0 - 0.16, y, Math.min(z0, z1) - 0.1], [x0 + 0.16, y + 0.09, Math.max(z0, z1) + 0.1], stoneDarkMat);
  };
  // One bag, reused: about 0.53 x 0.135 x 0.285 m
  const bag = new THREE.CapsuleGeometry(0.075, 0.38, 2, 6);
  bag.rotateZ(Math.PI / 2);
  bag.scale(1, 0.9, 1.9);
  const bagMats = [0x6f6650, 0x625a48].map((c) => b.flat(c, 0.95));
  const putBag = (x: number, y: number, z: number, rot: number): void => {
    const g = bag.clone();
    g.scale(d.rand(0.92, 1.08), d.rand(0.9, 1.1), 1);
    g.rotateY(rot + d.rand(-0.09, 0.09));
    g.translate(x + d.rand(-0.03, 0.03), y, z);
    b.geo(g, d.pick(bagMats));
  };
  /** Bags laid over a plain sandbag block (centre x, z, w x dd, h high): looks only, the block stays the cover. */
  const bagSkin = (x: number, z: number, w: number, dd: number, h: number): void => {
    const alongX = w >= dd;
    const len = alongX ? w : dd, dep = alongX ? dd : w;
    const at = (u: number, v: number): [number, number] => (alongX ? [x + u, z + v] : [x + v, z + u]);
    const rows = Math.round(h / 0.13), per = Math.max(1, Math.round(len / 0.5));
    const rot = alongX ? 0 : Math.PI / 2;
    for (let r = 0; r < rows; r++) {
      const y = Y + 0.06 + r * (h / rows);
      for (let i = 0; i < per; i++) {
        const u = -len / 2 + ((i + 0.5 + (r % 2) * 0.5) * len) / per;
        if (u > len / 2 - 0.15) continue;
        for (const v of r === rows - 1 ? [-1, 0, 1] : [-1, 1]) {
          const [px, pz] = at(u, v * (dep / 2 - 0.12));
          putBag(px, y, pz, rot);
        }
      }
      // The ends, bags laid across
      for (const e of [-1, 1]) for (const v of [-0.18, 0.18]) {
        const [px, pz] = at(e * (len / 2 - 0.1), v);
        putBag(px, y, pz, rot + Math.PI / 2);
      }
    }
  };
  /** A rough stone: a jittered icosahedron in the rock texture, half sunk in the ground. Merged, so nearly free. Visual only. */
  const stone = (x: number, y: number, z: number, s: number, flat = 0.6): void => {
    const g = new THREE.IcosahedronGeometry(1, 0);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const jit = new Map<string, number>(); // shared corners move together, so the faces stay closed
    for (let i = 0; i < pos.count; i++) {
      const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
      let k = jit.get(key);
      if (k === undefined) jit.set(key, (k = d.rand(0.75, 1.2)));
      pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k, pos.getZ(i) * k);
    }
    g.computeVertexNormals();
    g.scale(s * d.rand(0.9, 1.3), s * flat, s);
    g.rotateY(d.rand(0, Math.PI * 2));
    g.translate(x, y + s * flat * 0.35, z);
    b.geo(g, rockMat);
  };
  /** Loose stone round the foot of a blocky outcrop, to break its outline. */
  const rockFoot = (x: number, z: number, y: number, s: number): void => {
    for (let k = 0; k < 4; k++) {
      const a = k * 1.6 + d.rand(-0.4, 0.4);
      stone(x + Math.cos(a) * s * 1.05, y, z + Math.sin(a) * s * 0.8, s * d.rand(0.3, 0.5));
    }
  };
  // Grass blades: thin triangles merged into the map (one material for the whole map), not props
  const blade = b.own(new THREE.MeshStandardMaterial({ color: 0x646a42, roughness: 0.95, side: THREE.DoubleSide }));
  /** A tuft of storm-flattened grass at (x, y, z), leaning away from the sea. */
  const tuft = (x: number, y: number, z: number, h: number): void => {
    const n = 5 + Math.floor(d.r() * 4);
    const v: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = d.rand(0, Math.PI * 2), r = d.rand(0, 0.12);
      const bx = x + Math.cos(a) * r, bz = z + Math.sin(a) * r;
      const w = d.rand(0.015, 0.03), hh = h * d.rand(0.5, 1.1);
      const side = d.rand(0, Math.PI);
      const lx = Math.cos(side) * w, lz = Math.sin(side) * w;
      v.push(bx - lx, y, bz - lz, bx + lx, y, bz + lz, bx + d.rand(-0.15, 0.15), y + hh, bz - hh * d.rand(0.2, 0.6));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.computeVertexNormals();
    b.geo(g, blade);
  };
  /** Grass in the cracks of a rectangle at y, only on open ground. */
  const weeds = (r: Rect, y: number, n: number, clear?: Rect[]): void => {
    for (let i = 0; i < n; i++) {
      const x = d.rand(r[0], r[2]), z = d.rand(r[1], r[3]);
      if (clear?.some((c) => x > c[0] && x < c[2] && z > c[1] && z < c[3])) continue;
      if (Math.abs(b.floorAt(x, z, y) - y) > 0.06 || !free([x - 0.1, y + 0.03, z - 0.1], [x + 0.1, y + 0.4, z + 0.1])) continue;
      const k = 1 + Math.floor(d.r() * 3);
      for (let j = 0; j < k; j++) tuft(x + d.rand(-0.3, 0.3), y, z + d.rand(-0.3, 0.3), d.rand(0.25, 0.55));
    }
  };
  /** A steel jerrycan built from boxes (the model is heavy for something this small). */
  const jerry = (x: number, y: number, z: number, rot: number): void => {
    rbox(x, y, z, 0.17, 0.46, 0.35, rot, C.olive);
    rbox(x, y + 0.46, z, 0.04, 0.04, 0.2, rot, C.olive);
    const c = Math.cos(rot), sn = Math.sin(rot);
    rbox(x + sn * 0.12, y + 0.42, z + c * 0.12, 0.05, 0.07, 0.05, rot, C.iron);
  };
  /** A sign on its own two posts, facing `face` (+z or -z). */
  const postSign = (x: number, y: number, z: number, face: '+z' | '-z', text: string, opts: NonNullable<Parameters<Dresser['sign']>[5]>): void => {
    for (const dx of [-0.55, 0.55]) deco([x + dx - 0.04, y, z - 0.04], [x + dx + 0.04, y + (opts.h ?? 0.5) + 1.3, z + 0.04], C.iron, 0.6, 0.5);
    d.sign(face, z + (face === '+z' ? 0.04 : -0.04), x, y + 1.25, text, opts);
  };
  /** A folding camp cot along x or z: frame, canvas, a rolled blanket. Solid when there is room. */
  const cot = (x: number, y: number, z: number, alongX: boolean): void => {
    const [hx, hz] = alongX ? [0.95, 0.36] : [0.36, 0.95];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) deco([x + sx * hx - 0.03, y, z + sz * hz - 0.03], [x + sx * hx + 0.03, y + 0.38, z + sz * hz + 0.03], C.olive, 0.6, 0.4);
    deco([x - hx, y + 0.34, z - hz], [x + hx, y + 0.4, z + hz], C.olive, 0.95);
    const [bx, bz] = alongX ? [x + 0.55, z] : [x, z + 0.55];
    deco([bx - (alongX ? 0.3 : 0.32), y + 0.4, bz - (alongX ? 0.32 : 0.3)], [bx + (alongX ? 0.3 : 0.32), y + 0.52, bz + (alongX ? 0.32 : 0.3)], C.olive, 0.95);
    const [px, pz] = alongX ? [x - 0.72, z] : [x, z - 0.72];
    deco([px - 0.16, y + 0.4, pz - 0.2], [px + 0.16, y + 0.48, pz + 0.2], C.white, 0.95);
    if (free([x - hx, y + 0.05, z - hz], [x + hx, y + 0.4, z + hz])) {
      b.colliders.push(new THREE.Box3(new THREE.Vector3(x - hx, y, z - hz), new THREE.Vector3(x + hx, y + 0.4, z + hz)));
    }
  };

  // Port Veyle across the bay, and the headland's farms inland
  d.skyline(bounds, { sides: ['+z'], near: 160, far: 320, h: [8, 40], lit: 0.3, count: 60 });
  d.skyline(bounds, { sides: ['-z', '-x', '+x'], near: 50, far: 200, base: Y - 6, h: [4, 9], lit: 0.05, count: 25 });

  // ===== The beach and the landing stage =====
  const beach: Rect = [-44.5, 20.5, 44.5, 29.5];
  const stairFoot: Rect = [-23.5, 19.5, -10.8, 28.6]; // the cliff stairs, kept clear
  d.stains(beach, B, 20, 0x2a2a22, 0.4, [1.5, 4]);
  d.stains([-44, 28.4, 44, 29.9], B, 26, 0x2a2a22, 0.4, [0.8, 2.2]); // the wrack line
  d.puddles(beach, B, 14, [1, 3.2]);
  d.debris(beach, B, 60, { paper: 0.05 });
  d.scatter(beach, B, 12, [['old_tyre', 2], ['Barrel_02', 2, { collide: true }], ['metal_jerrycan', 1], ['trashbag', 1], ['rusted_wheel_rim_01', 1]],
    { clear: [[-16, 20, 2, 30]] });
  // Marram tufts at the cliff foot
  weeds([-44, 20.2, 44, 22.2], B, 40, [stairFoot, [9, 19, 14, 23]]);
  for (const [x, z, s] of BEACH_ROCKS) {
    b.box([x - s, 0, z - s * 0.7], [x + s, B + s * 0.6, z + s * 0.7], rockMat);
    rockFoot(x, z, B, s);
  }
  // Fallen rock along the cliff foot (against the cliff, so solid)
  for (const [x, s] of [[-34, 0.9], [-27, 1.2], [-8, 1.0], [6, 1.1], [19, 0.8], [33, 1.0]] as const) {
    stone(x, B - 0.1, 20.4 + s * 0.5, s, 0.8);
    if (free([x - s * 0.7, B, 20.05], [x + s * 0.7, B + s * 0.6, 20.4 + s])) b.colliders.push(new THREE.Box3(new THREE.Vector3(x - s * 0.7, B, 20.05), new THREE.Vector3(x + s * 0.7, B + s * 0.6, 20.4 + s)));
  }
  for (let x = -44; x < 44; x += d.rand(1.5, 4)) {
    if (x > -24 && x < -10.5) continue;
    if (x > 9 && x < 14) continue;
    stone(x, B, 20.3 + d.rand(0, 0.9), d.rand(0.25, 0.7));
  }
  // Ledges on the cliff, above head height, with grass that got a hold
  const cliff = 20.05;
  for (const [x, y, w, h, out] of [[-38, 6, 3, 0.5, 0.5], [-30, 9, 2.2, 0.4, 0.4], [-6, 7.5, 2.8, 0.5, 0.6], [2, 4.8, 1.8, 0.4, 0.4], [20, 6.2, 3.4, 0.6, 0.5], [32, 9.5, 2.4, 0.5, 0.4], [40, 4.5, 2, 0.4, 0.5], [-42, 10.4, 2, 0.4, 0.4], [26, 3.6, 1.6, 0.4, 0.35]] as const) {
    deco([x - w / 2, y, cliff - 0.1], [x + w / 2, y + h, cliff + out], rockMat);
    stone(x + w / 2 - 0.2, y - 0.1, cliff + out * 0.4, h * 1.1);
    for (let k = 0; k < 3; k++) tuft(x + d.rand(-w / 2.5, w / 2.5), y + h, cliff + out * d.rand(0.2, 0.8), d.rand(0.3, 0.5));
  }
  d.streaks('+z', cliff, -45, 10, B, Y, 22);
  d.streaks('+z', cliff, 13, 45, B, Y, 14);
  // An upturned dinghy and the drift the storm threw up
  solidBox([-37.6, B, 23], [-34.4, B + 0.45, 24.2], C.hull, 0.5);
  deco([-37.9, B, 23.25], [-37.6, B + 0.38, 23.95], C.hull, 0.5);
  deco([-37.9, B + 0.45, 23.56], [-34.3, B + 0.52, 23.64], C.woodDark);
  deco([-37.6, B + 0.3, 22.96], [-34.4, B + 0.36, 24.24], C.white, 0.6);
  log(-36, B, 25.2, 2.2, 0.04, 0.2, C.wood); // an oar
  for (const [x, z, len, r, rot] of [[-28, 25.5, 2.6, 0.13, 0.4], [16, 27, 3.2, 0.16, -0.3], [30, 23.4, 1.8, 0.1, 1.1], [-42, 27, 2.2, 0.12, 0.2], [4, 28.6, 1.4, 0.09, 2.3]] as const) log(x, B, z, len, r, rot);
  // The sea gate: a stone portal round the tunnel mouth, its iron gate swung back
  for (const [x0, x1] of [[9.55, 10], [13, 13.45]] as const) {
    if (free([x0, B, 19.9], [x1, 4.9, 20.45])) b.box([x0, B, 19.9], [x1, 4.9, 20.45], stoneMat, { tile: 3 });
  }
  deco([9.4, 4.6, 19.95], [13.6, 5.15, 20.5], stoneMat);
  for (let x = 13.6; x <= 16.2; x += 0.26) deco([x - 0.02, B, 20.08], [x + 0.02, 4.3, 20.12], C.ironRust, 0.6, 0.4);
  for (const y of [B + 0.15, 3.0, 4.25]) deco([13.5, y, 20.07], [16.3, y + 0.06, 20.13], C.ironRust, 0.6, 0.4);
  d.sign('+z', cliff, 7.8, B + 1.4, 'SEA GATE', { lines: ['SEA GATE', 'TUNNEL FLOODS', 'AT HIGH WATER'], h: 0.66, bg: '#d8b02a', fg: '#1c1c1c', border: '#1c1c1c' });
  d.stencil('+z', cliff, -10.2, B + 1.6, 'STAIRS TO FORT', { h: 0.4, opacity: 0.7 });
  bulkhead('+z', cliff, 8.6, 3.4);
  // The landing stage: planks, bollards, lines to the boat, fenders, fuel for the run back
  for (let z = 30.3; z < 39; z += 0.62) deco([-2, B + 0.001, z], [2, B + 0.008, z + 0.03], C.woodDark);
  for (const x of [-1.98, 1.9]) deco([x, B - 0.32, 30], [x + 0.08, B + 0.06, 39], C.woodDark);
  d.wallProp('lifebuoy', '+x', 1.95, 32, B + 0.2, { collide: false });
  for (const z of [31, 34, 37]) d.cyl([2.05, B, z], 0.1, 0.6, b.flat(0x2b2e31, 0.6, 0.5));
  for (const [x, z] of [[1.65, 33.4], [1.65, 38.5], [-1.65, 36.2]] as const) d.bollard(x, B, z, 'mooring', C.iron);
  rope([1.65, B + 0.55, 33.4], [2.6, 1.5, 34.3], 0.08);
  rope([1.65, B + 0.55, 38.5], [2.6, 1.5, 39.1], 0.08);
  coil(1.2, B, 37.8);
  coil(-1.3, B, 31.4, 0.24);
  for (const z of [32.6, 35.6, 37.7]) {
    prop('old_tyre', 2.09, B - 0.95, z, Math.PI / 2);
    rope([2.0, B + 0.02, z], [2.09, B - 0.38, z], 0.01, 0.012);
  }
  jerry(-1.55, B, 32.2, 0.2);
  jerry(-1.5, B, 32.6, -0.1);
  prop('life_jacket', 0.9, B + 0.65, 30.56, 0);
  postSign(-3.6, B, 29.4, '+z', 'FORT MARDELL', { lines: ['FORT MARDELL', 'LANDING STAGE', 'NO UNAUTHORISED MOORING'], h: 0.66, bg: '#1f3a5a', fg: '#f0ece0', border: '#f0ece0' });
  // The boat: gunwale, cabin windows, nav lights, the outboard
  deco([2.15, 1.5, 32.95], [4.65, 1.6, 39.55], C.white, 0.5);
  for (const z of [36.95, 37.7]) deco([2.55, 1.9, z], [4.25, 2.25, z + 0.5], C.rack, 0.15, 0.3);
  deco([2.9, 1.9, 38.62], [3.9, 2.25, 38.66], C.rack, 0.15, 0.3);
  d.cyl([3.4, 2.5, 37.5], 0.03, 1.4, paint(C.iron, 0.6, 0.5), 6);
  b.box([3.35, 3.9, 37.45], [3.45, 4.0, 37.55], lens, { collide: false });
  b.box([2.15, 1.62, 33.4], [2.25, 1.7, 33.5], b.glow(0xff3a2a, 3), { collide: false });
  b.box([4.55, 1.62, 33.4], [4.65, 1.7, 33.5], b.glow(0x3aff6a, 3), { collide: false });
  deco([3.1, 1.2, 39.5], [3.7, 2.0, 39.95], C.rack, 0.5, 0.3);
  prop('ocean_buoy', -7, -0.4, 37, 0, 1, [0.08, 0.05]);
  prop('ocean_buoy', 10, -0.45, 42, 0, 1, [-0.06, 0.1]);

  // ===== The sea tunnel and the magazine stair =====
  const tunnel: Rect = [10.1, 4.1, 12.9, 19.9];
  d.puddles(tunnel, B, 8, [0.6, 1.8]);
  d.debris(tunnel, B, 20, { paper: 0 });
  d.streaks('+x', 10, 4, 20, B, 4.6, 8);
  d.streaks('-x', 13, 4, 20, B, 4.6, 8);
  d.cableTray([10.2, 4.1, 4.2], [10.2, 4.1, 19.6], 0.25);
  for (const z of [7, 16]) bulkhead('-x', 13, z, 3.3);
  ring('+x', 10, 10, 2.4);
  ring('-x', 13, 14, 2.4);
  d.sign('-x', 13, 5.6, 2.5, 'MAGAZINE STAIR', { lines: ['MAGAZINE STAIR', 'NO NAKED LIGHTS'], h: 0.5, bg: '#e8e4d8', fg: '#a8281e', border: '#a8281e' });
  // The trench walls of the stair: grime, a conduit climbing with it, lamps on the way up
  const zTop = 4 - stairRun(B, Y);
  const stepY = (z: number): number => B + ((4 - z) / (4 - zTop)) * (Y - B);
  d.streaks('+x', 10, zTop, 4, B, Y, 10);
  d.streaks('-x', 13, zTop, 4, B, Y, 10);
  d.pipe([10.08, stepY(4) + 2.2, 4], [10.08, Y - 0.3, zTop + 2.6], 0.04, C.iron);
  for (const z of [0, -6, -11.5]) bulkhead('-x', 13, z, stepY(z) + 2.1);
  for (const [x0, z0, x1, z1] of [[10, zTop, 10, 4], [13, zTop, 13, 4], [10, 4, 13, 4]] as const) coping(x0, z0, x1, z1, Y + 1.0);

  // ===== The yard =====
  const yard: Rect = [-26.5, -28.5, 26.5, 8.5];
  const yardPaths: Rect[] = [[-2, -29, 2, -3.5], [-10.5, 6, -5, 10], [9.5, -29, 16, -26.5], [-1.5, -4, 1.5, -2], [9.5, -15.5, 13.5, 4.5]];
  d.stains(yard, Y, 30, 0x1a1a14, 0.45, [1.2, 3.5]);
  d.puddles(yard, Y, 24, [0.8, 3]);
  d.debris(yard, Y, 120, { paper: 0.15 });
  d.scatter(yard, Y, 26, [
    ['metal_jerrycan', 3], ['Barrel_02', 2, { collide: true }], ['ammo_box', 3], ['cardboard_box_01', 1], ['old_tyre', 2],
    ['propane_tank', 1, { collide: true }], ['cement_bag', 2], ['trashbag', 1], ['plastic_crate_03', 1],
  ], { clear: yardPaths });
  // Weeds along the wall bases, where nobody walks
  for (const r of [[-26.9, -28.9, 26.9, -27.6], [-26.9, 7.6, 26.9, 8.9], [-26.9, -28.9, -25.6, 8.9], [25.6, -28.9, 26.9, 8.9]] as Rect[]) weeds(r, Y, 30, yardPaths);
  for (const [x, z, w, dd] of SANDBAGS) bagSkin(x, z, w, dd, 1.05);
  b.prop('portable_generator', 6, Y, -8, 0.4);
  b.prop('portable_generator', -14, Y, -26, 2.1);
  b.prop('portable_searchlight', -9, Y, -34.4, Math.PI, { collide: false });
  b.prop('portable_searchlight', 11, Y, -34.4, Math.PI, { collide: false });
  b.prop('tool_cart', 14.5, Y, -18, 1.57);
  b.prop('worn_metal_rack', 17, Y, -12.8, 0);
  // Generator cables to the keep
  d.cables([[[6, Y + 0.6, -8], [5, R + 1, -4]], [[-14, Y + 0.6, -26], [-6.7, R + 2, -10]]], 1);

  // The fort walls: grime, drains off the walks, tethering rings, damp at the foot
  for (const [f, at, a, c] of [
    ['+z', -29, -27, -3], ['+z', -29, 3, 27], ['-z', 9, -27, -21], ['-z', 9, -19, 27], ['+x', -27, -29, 2], ['+x', -27, 4, 9], ['-x', 27, -29, 0], ['-x', 27, 6.5, 9],
    ['-z', -32, -30, -3], ['-z', -32, 3, 24], ['+z', 12, -30, -21], ['+z', 12, -19, 30], ['-x', -30, -32, 12], ['+x', 30, -26, 0], ['+x', 30, 6.5, 12],
    ['-z', -36, 24, 36], ['+x', 36, -36, -26],
  ] as const) d.streaks(f, at, a, c, Y, R, Math.round((c - a) / 2.5));
  for (const [f, at, alongs] of [['+z', -29, [-24, -16, -8, 8, 16, 24]], ['-z', 9, [-24, -14, -4, 6, 16, 24]], ['+x', -27, [-24, -14, -4, 6]], ['-x', 27, [-24, -14, -4]]] as const) {
    for (const u of alongs) drain(f, at, u, R - 0.28);
  }
  for (const [f, at, alongs] of [['+z', -29, [-20, -12, 12, 20]], ['-z', 9, [-12, 2, 12]], ['+x', -27, [-20, -8]], ['-x', 27, [-20, -8]]] as const) {
    for (const u of alongs) ring(f, at, u, Y + 1.3);
  }
  for (const [f, at, u] of [['+z', -29, -6], ['+z', -29, 6], ['-z', 9, -17.5], ['-z', 9, -22.5], ['+x', -27, 5.2], ['-x', 27, -10]] as const) bulkhead(f, at, u, Y + 2.6);
  // Signs: the gate, the sally port, the walks
  d.sign('+z', -29, -5.2, Y + 1.5, 'MAIN GATE', { lines: ['MAIN GATE', 'VEHICLES STOP', 'SHOW YOUR PASS'], h: 0.66, bg: '#e8e4d8', fg: '#1c1c1c', border: '#1c1c1c' });
  d.sign('-z', 9, -22.8, Y + 1.5, 'SALLY PORT', { lines: ['SALLY PORT', 'CLIFF STAIRS', 'TO LANDING'], h: 0.66, bg: '#e8e4d8', fg: '#1c1c1c', border: '#1c1c1c' });
  d.stencil('-z', 9, -2.5, Y + 1.0, 'WALK 2', { h: 0.45, opacity: 0.7 });
  d.stencil('+z', -29, 9, Y + 1.0, 'WALK 1', { h: 0.45, opacity: 0.7 });
  d.stencil('+x', -27, -2, Y + 0.9, 'NO PARKING', { h: 0.4, opacity: 0.7 });

  // The duty post against the west wall: an awning, the yard radio, a cot for the night watch
  rbox(-25.2, Y + 2.38, -13, 3.7, 0.03, 4.8, 0, C.olive, -0.13, 0.95);
  for (const z of [-15.3, -10.7]) {
    deco([-23.42, Y, z - 0.04], [-23.34, Y + 2.36, z + 0.04], C.wood);
    rope([-23.38, Y + 2.3, z], [-22.6, Y, z + (z < -13 ? -0.8 : 0.8)], 0.02, 0.01);
  }
  b.box([-24.7, Y + 2.0, -13.06], [-24.58, Y + 2.14, -12.94], lens, { collide: false });
  solid('wooden_table_02', -25.9, Y, -13.2, Math.PI / 2);
  // A field radio set: olive case, dials, a handset, its whip aerial
  deco([-26.2, Y + 0.8, -13.8], [-25.8, Y + 1.1, -13.2], C.olive, 0.7);
  deco([-25.8, Y + 0.86, -13.7], [-25.79, Y + 1.04, -13.3], C.rack, 0.4);
  b.box([-25.79, Y + 1.0, -13.62], [-25.78, Y + 1.03, -13.58], lens, { collide: false });
  deco([-25.75, Y + 0.8, -13.0], [-25.6, Y + 0.85, -12.8], C.rack, 0.5);
  d.cyl([-26.1, Y + 1.1, -13.75], 0.008, 1.4, paint(C.iron, 0.6, 0.5), 4);
  prop('clipboard', -25.7, Y + 0.8, -12.4, 1.2);
  prop('wooden_military_crate', -24.95, Y, -13.3, 0.4, 0.9); // a crate for a seat
  cot(-26.4, Y, -10.2, false);
  jerry(-26.6, Y, -15.3, 1.4);
  jerry(-26.6, Y, -15.75, 1.6);
  d.cable([-26.0, Y + 1.05, -13.5], [-26.9, Y + 2.6, -13.5], 0.2, 0.012);
  d.cable([-26.9, R - 0.5, -13.5], [-7.3, R + 0.9, -10.2], 2.2, 0.012); // field line to the relay room
  d.pipe([-26.92, Y + 2.6, -13.5], [-26.92, R - 0.5, -13.5], 0.02, C.iron, { brackets: false });

  // The storehouse: a door, its sign, grime, a whip aerial on the roof with guy wires
  const sh = Y + 3.4;
  deco([18.7, Y, -14.06], [20.3, Y + 2.2, -13.96], C.wood);
  for (const y of [Y + 0.4, Y + 1.7]) deco([18.75, y, -14.08], [20.25, y + 0.08, -13.94], C.iron, 0.6, 0.5);
  deco([18.55, Y + 2.2, -14.1], [20.45, Y + 2.32, -13.92], stoneMat);
  d.sign('+z', -14, 19.5, Y + 2.5, 'STORE 2', { h: 0.36, bg: '#e8e4d8', fg: '#1c1c1c' });
  d.sign('+z', -14, 21.5, Y + 1.4, 'NO SMOKING', { lines: ['NO SMOKING', 'FUEL STORE'], h: 0.44, bg: '#e8e4d8', fg: '#a8281e', border: '#a8281e' });
  for (const [f, at, a, c] of [['+z', -14, 16, 23], ['-z', -22, 16, 23], ['-x', 16, -22, -14], ['+x', 23, -22, -14]] as const) d.streaks(f, at, a, c, Y, sh, 3);
  for (const [x0, z0, x1, z1] of [[16, -22, 23, -22], [16, -14, 23, -14], [16, -22, 16, -14], [23, -22, 23, -14]] as const) coping(x0, z0, x1, z1, sh);
  d.cyl([21.8, sh, -20.5], 0.04, 7, paint(C.iron, 0.6, 0.5), 6);
  for (const p of [[16.4, sh + 0.05, -21.6], [22.6, sh + 0.05, -21.6], [19.5, sh + 0.05, -14.4]] as V3[]) d.cable([21.8, sh + 5, -20.5], p, 0.05, 0.008);
  wallDeco('-x', 16, -17, Y + 1.1, 0.5, 0.6, 0, 0.18, C.steel);
  d.pallet(16.9, Y, -23.3, 0.1, 'sacks');

  // The ruined barracks: rubble, fallen roof timbers, a rusted bed frame, grass through the floor
  d.debris([-21.7, -23.7, -12.3, -16.3], Y, 80, { paper: 0 });
  for (let i = 0; i < 6; i++) {
    const x = d.rand(-21, -13), z = d.rand(-23, -17), s = d.rand(0.3, 0.8);
    b.box([x - s, Y, z - s], [x + s, Y + s * 0.6, z + s], b.mat('stone'), { collide: false });
  }
  for (let i = 0; i < 10; i++) stone(d.rand(-21.5, -12.5), Y, d.rand(-23.5, -16.5), d.rand(0.15, 0.35));
  rbox(-17.5, Y, -20.5, 5.2, 0.22, 0.22, 0.5, C.woodDark, 0.12);
  rbox(-14.5, Y, -22, 3.6, 0.18, 0.2, -0.9, C.woodDark, -0.08);
  for (const sx of [-1, 1]) deco([-20.4 + sx * 0.4, Y, -19.4], [-20.36 + sx * 0.4, Y + 0.5, -17.5], C.ironRust, 0.7, 0.4);
  deco([-20.8, Y + 0.42, -19.4], [-19.96, Y + 0.46, -17.5], C.ironRust, 0.7, 0.4);
  weeds([-21.7, -23.7, -12.3, -16.3], Y, 25);
  d.sign('+z', -23.75, -20, Y + 1.7, 'BARRACK B', { h: 0.3, bg: '#8a867c', fg: '#2a2824', font: '700 60px Georgia, serif', plate: false });

  // ===== The keep =====
  for (const [f, at, a, c] of [['+z', -3.7, -7.3, 7.3], ['-z', -16.3, -7.3, 7.3], ['-x', -7.3, -16.3, -3.7], ['+x', 7.3, -16.3, -3.7]] as const) d.streaks(f, at, a, c, Y, K, 6);
  d.sign('+z', -3.7, 0, Y + 2.75, 'RELAY STATION', { lines: ['FORT MARDELL', 'COAST RELAY STATION 5'], h: 0.6, bg: '#1f3a5a', fg: '#f0ece0', border: '#f0ece0' });
  d.sign('+z', -3.7, 2.4, Y + 1.2, 'DANGER', { lines: ['DANGER', 'HIGH VOLTAGE', 'AUTHORISED ONLY'], h: 0.66, bg: '#d8b02a', fg: '#1c1c1c', border: '#1c1c1c' });
  for (const x of [-1.75, 1.75]) bulkhead('+z', -3.7, x, Y + 2.2);
  // Power into the keep's east side, up to the relay room
  d.wallProp('power_box_01', '+x', 7.3, -8.2, Y + 1.0, { collide: false });
  d.pipe([7.38, Y + 1.5, -8.6], [7.38, R + 1.25, -8.6], 0.035, C.iron);
  d.pipe([7.38, R + 1.25, -8.6], [7.38, R + 1.25, -9.3], 0.035, C.iron, { brackets: false });
  d.cable([6, Y + 0.55, -7.7], [7.4, Y + 1.0, -8.2], 0.25);
  // The store below: fuel, rations, gas masks by the door
  d.shelves(-6.4, -15.4, -6.4, -9, Y, '+x');
  d.debris([-6.6, -15.6, 6.6, -4.4], Y, 30, { paper: 0.4 });
  d.pallet(0.2, Y, -15.0, 0, 'sacks');
  for (const x of [-2.6, -2.2, -1.8]) jerry(x, Y, -15.45, d.rand(-0.1, 0.1));
  prop('long_life_food', -4, Y + 1.26, -13, 0.3);
  prop('long_life_food', -3.9, Y + 1.5, -13.05, -0.2);
  for (const x of [-3.2, -2.7, -2.2]) d.wallProp('old_gas_mask', '-z', -4.3, x, Y + 0.55, { collide: false });
  d.stencil('-z', -4.3, 3.2, Y + 1.6, 'AMMUNITION', { h: 0.35, color: '#c8a23a', opacity: 0.7 });
  // The relay room: radio racks, test gear, the channel plan, a cot for the operator
  d.shelves(-6.4, -15.4, -6.4, -11, R, '+x');
  b.prop('Television_01', 1, R + 0.95, -15.3, 0, { collide: false, scale: 0.7 });
  b.prop('classic_laptop', -1.2, R + 0.95, -15.2, 0.2, { collide: false });
  b.prop('clipboard', -1.8, R + 0.9, -5.7, 0.4, { collide: false });
  prop('vintage_radio_transceiver', -2.05, R + 0.95, -15.25, 0);
  // A test meter by the set: yellow case, dark face, two leads
  rbox(2.05, R + 0.95, -15.15, 0.16, 0.26, 0.07, -0.3, C.red);
  rbox(2.06, R + 1.06, -15.11, 0.12, 0.1, 0.01, -0.3, C.rack);
  d.cable([2.0, R + 0.98, -15.1], [1.75, R + 0.955, -14.98], 0.01, 0.005);
  d.debris([-6.6, -15.6, 6.6, -4.4], R, 40, { paper: 0.85 });
  const led = [b.glow(0x3aff6a, 3), lens, b.glow(0xff3a2a, 3)];
  for (const x of [2.85, 3.55]) {
    solidBox([x, R, -15.7], [x + 0.62, R + 1.9, -15.12], C.rack, 0.5, 0.3);
    for (let y = R + 0.3; y < R + 1.8; y += 0.22) {
      deco([x + 0.04, y, -15.12], [x + 0.58, y + 0.16, -15.1], C.iron);
      b.box([x + 0.46, y + 0.05, -15.1], [x + 0.5, y + 0.09, -15.09], d.pick(led), { collide: false });
    }
  }
  d.cableTray([-6.2, K - 0.6, -15.3], [6.2, K - 0.6, -15.3], 0.3);
  for (const x of [-2, 0.5, 3.2]) d.cable([x, K - 0.6, -15.3], [x * 0.8, R + 1.0, -15.45], 0.1);
  d.wallProp('power_box_01', '+z', -15.7, -3.6, R + 1.0, { collide: false });
  d.sign('-z', -4.3, 0.9, R + 1.15, 'CHANNEL PLAN', {
    lines: ['COAST RELAY  CHANNEL PLAN', 'B2  COASTGUARD  156.8', 'B4  CITY MESH  WARDS 1-9', 'CALL SIGN  MARDELL'], h: 0.9, bg: '#ece8dc', fg: '#1c1c1c', font: '600 56px "Courier New", monospace',
  });
  cot(1.6, R, -4.85, true);
  prop('metal_stool_02', -1.5, R, -6.75, 0.6);
  d.cyl([-0.85, R + 0.9, -5.5], 0.04, 0.1, paint(C.white, 0.5), 8); // a mug left on the table
  d.ceilingProp('caged_hanging_light', 0, K - 0.35, -10.3);
  // The roof and the mast: dipoles, a dish facing the bay, the cabinet at its foot
  for (const [x0, z0, x1, z1] of [[-7.3, -16.3, 7.3, -16.3], [-7.3, -3.7, 7.3, -3.7], [-7.3, -16.3, -7.3, -3.7], [7.3, -16.3, 7.3, -3.7]] as const) coping(x0, z0, x1, z1, K + 1.1);
  for (const [x, z] of [[-6.8, -15.8], [6.8, -15.8], [-6.8, -4.2], [6.8, -4.2]] as const) {
    d.cable([2, K + 8.5, -10], [x, K + 1.1, z], 0.1, 0.01);
    deco([x - 0.12, K + 1.1, z - 0.12], [x + 0.12, K + 1.16, z + 0.12], C.iron, 0.6, 0.5);
  }
  d.pipe([2.3, K, -10.3], [2.3, R + 0.4, -15.5], 0.05, 0x1c1e20, { brackets: false });
  for (let y = K + 1.5; y < K + 9; y += 1.5) b.box([1.6, y, -10.4], [2.4, y + 0.05, -9.6], b.flat(0x6d737a, 0.5, 0.6), { collide: false });
  b.box([1.85, K + 9, -10.15], [2.15, K + 9.3, -9.85], b.glow(0xff3a2a, 3), { collide: false });
  deco([0.2, K + 7.6, -10.03], [3.8, K + 7.66, -9.97], C.steel);
  deco([1.97, K + 8.4, -11.8], [2.03, K + 8.46, -8.2], C.steel);
  for (const x of [0.25, 3.75]) d.cyl([x, K + 7.66, -10], 0.02, 1.2, paint(C.steel), 5);
  const dish = new THREE.CylinderGeometry(0.62, 0.5, 0.12, 16);
  dish.rotateX(Math.PI / 2 - 0.15);
  dish.translate(2, K + 4.6, -9.45);
  b.geo(dish, paint(C.white));
  deco([1.97, K + 4.57, -9.75], [2.03, K + 4.63, -9.4], C.steel);
  solidBox([2.6, K, -11.4], [3.6, K + 1.3, -10.8], C.steel);
  b.box([3.4, K + 1.15, -10.79], [3.46, K + 1.21, -10.78], led[0], { collide: false });
  d.sign('+z', -10.8, 3.1, K + 0.35, 'DANGER RF', { lines: ['DANGER  RF', 'DO NOT CLIMB', 'WHEN LIVE'], h: 0.5, bg: '#d8b02a', fg: '#1c1c1c' });
  d.roof(-7, -16, 7, -4, K);
  d.puddles([-6.9, -15.9, 6.9, -4.1], K, 6, [0.8, 2]);

  // ===== The ramparts =====
  for (const [x0, z0, x1, z1] of [[-30, -32, 24, -32], [-30, 12, 30, 12], [-30, -32, -30, 12], [30, -26, 30, 0], [30, 6.5, 30, 12], [24, -36, 36, -36], [36, -36, 36, -26], [30, -26, 36, -26]] as const) coping(x0, z0, x1, z1, R + 1.1);
  for (const [x, z, r] of [[-28.5, -20, 1.57], [-28.5, 0, 1.57], [28.5, -15, -1.57], [33, -33, 2.4], [-12, -30.5, Math.PI], [18, 10.5, 0]] as const) {
    b.prop('portable_searchlight', x, R, z, r, { collide: false });
  }
  d.scatter([-29.8, -31.8, 29.8, 11.8], R, 14, [['ammo_box', 3], ['metal_jerrycan', 1], ['cardboard_box_01', 1], ['trashbag', 1]], { clear: [[-7.5, -16.5, 7.5, -3.5]] });
  d.debris([-29.8, -31.8, 29.8, 11.8], R, 60, { paper: 0.1 });
  d.puddles([-29.8, -35.8, 35.8, 11.8], R, 22, [0.6, 2]);
  // The bastion's flagpole, the flag torn by the wind
  d.cyl([35.4, R, -35.4], 0.05, 7.5, paint(C.steel), 6);
  rbox(34.7, R + 6.4, -35.4, 1.3, 0.8, 0.02, 0.15, C.hull, 0, 0.95);
  rope([35.45, R + 1.0, -35.4], [35.45, R + 7.4, -35.4], 0, 0.008);

  // ===== Outside the walls =====
  // The main gate: the fort's name over the arch, a raised boom, ruts in the road
  d.sign('-z', -32, 0, R - 1.05, 'FORT MARDELL', { lines: ['FORT MARDELL', 'MDCCCLXXI'], h: 0.8, bg: '#8a867c', fg: '#2a2824', font: '700 64px Georgia, serif', plate: false });
  d.sign('-z', -32, -5.6, Y + 1.6, 'MILITARY AREA', { lines: ['MILITARY AREA', 'NO ENTRY', 'COAST RELAY STATION 5'], h: 0.66, bg: '#8a2a1c', fg: '#f0ece0', border: '#f0ece0' });
  for (const x of [-4.2, 4.2]) bulkhead('-z', -32, x, Y + 2.8);
  for (const [f, x] of [['+x', -3], ['-x', 3]] as const) bulkhead(f, x, -30.5, Y + 2.6);
  solidBox([3.35, Y, -32.85], [3.85, Y + 1.0, -32.35], C.white, 0.6);
  for (let i = 0; i < 6; i++) {
    const g = new THREE.BoxGeometry(0.7, 0.09, 0.09);
    g.translate(-0.35 - i * 0.7, 0, 0);
    g.rotateZ(-1.32);
    g.translate(3.6, Y + 0.95, -32.6);
    b.geo(g, paint(i % 2 ? C.white : C.red, 0.6));
  }
  for (const x of [-1.15, 1.15]) deco([x - 0.22, Y, -39.4], [x + 0.22, Y + 0.012, -29.2], C.woodDark);
  d.puddles([-12, -39.4, 14, -32.2], Y, 14, [0.8, 2.6]);
  weeds([-44, -39.4, -10, -32.4], Y, 40);
  weeds([14, -39.4, 44, -36.4], Y, 30);
  // The cliff top along the south wall
  weeds([-44, 12.3, 44, 19.3], Y, 90, [[-25, 12, -14, 19.7]]);
  for (const [x, s] of [[-38, 0.8], [-31, 0.6], [5, 0.7], [24, 0.9], [37, 0.6], [-12, 0.5], [14, 0.5]] as const) {
    stone(x, Y, 19.0, s);
    stone(x + s * 1.2, Y, 18.6, s * 0.5);
  }
  d.sign('+z', 12, -23, Y + 1.5, 'SALLY PORT', { lines: ['FORT MARDELL', 'SALLY PORT'], h: 0.5, bg: '#e8e4d8', fg: '#1c1c1c', border: '#1c1c1c' });
  // The long way round: rocks, scrub and the rubbish where the hill drops away
  for (const [x, z, s] of HILL_ROCKS) rockFoot(x, z, Y, s);
  weeds([30.5, -25, 44, 18], Y, 70, [[31, -1, 41, 8]]);
  weeds([-44, -38, -30.5, 18], Y, 70, [[-40, -2, -30, 7]]);
  d.debris([30.5, -25, 44, 18], Y, 50, { paper: 0 });
  d.debris([-44, -38, -30.5, 18], Y, 30, { paper: 0 });
  d.scatter([30.5, -25, 44, 18], Y, 6, [['old_tyre', 1], ['Barrel_02', 1, { collide: true }], ['metal_jerrycan', 1]]);
  d.puddles([30.5, -25, 44, 18], Y, 8, [1, 2.5]);
  d.puddles([-44, -38, -30.5, 18], Y, 8, [1, 2.5]);
}
