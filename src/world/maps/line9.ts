import * as THREE from 'three';
import type { QualityPreset } from '../../core/settings';
import { ENV, LevelBuilder, stairRun, type Rect, type V3 } from '../level';
import { Dresser } from '../dress';
import { worldFromLevel, type WorldMap } from '../map';

/**
 * M4 Line 9: the closed Ferrier Street interchange, 100 x 50 m, underground and nearly black.
 *
 *   y = 0    drainage gallery and the pump room
 *   y = 5    track beds
 *   y = 6    island platform (the derailed tram's floor is level with it)
 *   y = 12   concourse over the east half, its balcony looking down on the platform
 *   y = 18   street entrance hall (east) and the vent shaft head (west)
 *
 * You come in at the street hall and go down. The way out with the doctor is west along the
 * platform, through the tram, and up the vent shaft; the water follows you up.
 */

const TR = 5;
const PL = 6;
const CO = 12;
const ST = 18;

export const LINE9 = {
  spawn: [20, ST, -7] as V3,
  pumpDoor: [28, 0, 0] as V3,
  hana: [38, 0, 2] as V3,
  pumpRoom: [36, 0, 0] as V3,
  shaftBase: [-38, PL, -2] as V3,
  shaftTop: [-34.5, ST, 0] as V3,
};

export async function buildLine9(scene: THREE.Scene, q: QualityPreset, gl: THREE.WebGLRenderer): Promise<WorldMap> {
  const b = await LevelBuilder.create(q, ['concrete', 'tiles', 'floor', 'steel', 'rust', 'painted', 'green']);
  const rock = b.tint('concrete', 0x5d6266);
  const wall = b.tint('tiles', 0xaab3b0, 0.5);
  const platform = b.tint('floor', 0x9a9d9c, 0.55);
  const bed = b.tint('concrete', 0x4a4d4f);
  const steel = b.tint('steel', 0x70767c);
  const yellow = b.tint('steel', 0xb58f2a);
  const tram = b.tint('painted', 0x9a4a3a, 0.5);
  const dark = b.flat(0x1e2226, 0.6, 0.3);

  // --- Below the tracks: solid except the drainage gallery (x -30..30, z -3..3) and the pump room (x 30..44, z -7..7)
  b.box([-50, 0, -25], [50, TR, -7], rock, { tile: 4 });
  b.box([-50, 0, 7], [50, TR, 25], rock, { tile: 4 });
  b.box([-50, 0, -7], [-30, TR, 7], rock, { tile: 4 });
  b.box([44, 0, -7], [50, TR, 7], rock, { tile: 4 });
  b.box([-30, 0, -7], [30, TR, -3], rock, { tile: 4 });
  b.box([-30, 0, 3], [30, TR, 7], rock, { tile: 4 });
  b.ground([-30, -7, 44, 7], bed);
  const run = stairRun(0, PL);
  const stairW: Rect = [-28, 1, -28 + run, 3];
  const stairE: Rect = [26 - run, -3, 26, -1];
  b.floor([-30, -3, 30, 3], TR, rock, [stairW, stairE], 1.8);
  b.slab(30, -7, 44, 7, TR, rock, 0.5);
  b.stairs(-28, 2, '+x', 0, PL, 2, steel);
  b.stairs(26, -2, '-x', 0, PL, 2, steel);
  // Pump room: three pumps, the doctor's bench
  for (const z of [-4.5, 0, 4.5]) {
    b.box([40, 0, z - 1.2], [43, 2.2, z + 1.2], b.tint('green', 0x9db3a0));
    b.box([39.9, 1.5, z - 0.2], [39.95, 1.7, z + 0.2], b.glow(0x49ff8a, 2), { collide: false });
  }
  b.box([32, 0, 5.6], [36, 0.9, 6.6], dark);
  b.box([32.2, 0.9, 6.3], [35.8, 1.6, 6.4], b.glow(0x6fd6ff, 0.5), { collide: false });
  b.crates(33, 0, -5.5, 2);
  b.prop('Barrel_01', 37, 0, -6);
  b.wall(30, -7, 30, 7, 0, 4.5, rock, { t: 0.5, gaps: [[-1.5, 1.5, 0, 2.6]] });
  b.crates(-6, 0, -2, 1);
  b.crates(12, 0, 2, 2, 0.4);
  b.box([-30, 0, -2.9], [29.6, 0.5, -2.5], steel, { collide: false }); // drain pipe

  // --- Platform hall: island platform between two track beds, caps with steps at the east end
  b.floor([-36.5, -4, 36, 4], PL, platform, [stairW, stairE], 1);
  b.box([34, TR, -10], [36, PL, -4], platform);
  b.box([34, TR, 4], [36, PL, 10], platform);
  for (const z of [-7, 7]) {
    b.stairs(36 + stairRun(TR, PL), z, '-x', TR, PL, 4, platform);
    b.stairs(34 - stairRun(TR, PL), z, '+x', TR, PL, 4, platform);
  }
  b.rail(-28, 1, -28 + run, 1, PL, yellow, 1.0);
  b.rail(-28, 3, -28 + run, 3, PL, yellow, 1.0);
  b.rail(-28, 1, -28, 3, PL, yellow, 1.0);
  b.rail(26 - run, -3, 26, -3, PL, yellow, 1.0);
  b.rail(26 - run, -1, 26, -1, PL, yellow, 1.0);
  b.rail(26, -3, 26, -1, PL, yellow, 1.0);
  for (const x of [-30, -12, 0, 18, 30]) b.column(x, 0, PL, CO - 0.4, 0.8, wall);
  for (const x of [-22, -6]) {
    b.box([x - 1.2, PL, -0.4], [x + 1.2, PL + 0.5, 0.4], dark); // benches
  }
  b.crates(-33, PL, 2.5, 2);
  b.crates(8, PL, -2.8, 2, 0.3);
  b.crates(31, PL, 2.6, 3);
  b.prop('utility_box_01', -9, PL, 3.4, Math.PI);
  // Rails on the beds (visual), sleepers
  for (const z of [-7.8, -6.2, 6.2, 7.8]) b.box([-50, TR, z - 0.06], [34, TR + 0.14, z + 0.06], steel, { collide: false });
  // The derailed tram on the north track: floor level with the platform, doors toward it
  const tx0 = -30, tx1 = -10, tz0 = -6.9, tz1 = -4.0;
  b.box([tx0, TR, tz0], [tx1, PL, tz1], dark);
  b.wall(tx0, tz1, tx1, tz1, PL, PL + 2.6, tram, { t: 0.12, gaps: [[-27.5, -25.5, 0, 2.2], [-14.5, -12.5, 0, 2.2], [-23.5, -16.5, 0.9, 2.0]] });
  b.wall(tx0, tz0, tx1, tz0, PL, PL + 2.6, tram, { t: 0.12, gaps: [[-28, -24, 0.9, 2.0], [-22, -18, 0.9, 2.0], [-16, -12, 0.9, 2.0]] });
  b.wall(tx0, tz0, tx0, tz1, PL, PL + 2.6, tram, { t: 0.12, gaps: [[-6.2, -4.9, 0, 2.2]] });
  b.wall(tx1, tz0, tx1, tz1, PL, PL + 2.6, tram, { t: 0.12, gaps: [[-6.2, -4.9, 0, 2.2]] });
  b.slab(tx0 - 0.1, tz0 - 0.1, tx1 + 0.1, tz1 + 0.1, PL + 2.9, tram, 0.3);
  for (const x of [-21, -19]) b.box([x - 0.25, PL, -6.8], [x + 0.25, PL + 0.9, -6.2], dark, { collide: false });

  // --- Shell: hall walls, tunnel mouths, roof
  const ROOF = 17.5;
  b.box([-50, TR, -25], [50, ST + 4, -10], rock, { tile: 4 });
  b.box([-50, TR, 10], [50, ST + 4, 25], rock, { tile: 4 });
  b.box([40, TR + 4.2, -10], [50, ST + 4, 10], rock, { tile: 4 }); // above the east tunnels
  b.box([40, TR, -4], [50, TR + 4.2, 4], rock, { tile: 4 }); // between them
  // West: the same, but the vent shaft stands between the tunnels
  for (const [z0, z1] of [[-10, -3.35], [3.35, 10]] as const) {
    b.box([-50, TR + 4.2, z0], [-40, ST + 4, z1], rock, { tile: 4 });
    b.box([-50, TR, Math.max(z0, -4)], [-40, TR + 4.2, Math.min(z1, 4)], rock, { tile: 4 });
  }
  for (const x of [-50, 49.5]) b.box([x, TR, -10], [x + 0.5, TR + 4.2, 10], dark); // dark ends
  // Wall tiling inside the hall (thin, over the rock)
  b.box([-40, PL, -10], [40, ROOF, -9.85], wall, { collide: false });
  b.box([-40, PL, 9.85], [40, ROOF, 10], wall, { collide: false });

  // --- Concourse over the east half, with the balcony at x = 0
  const up1: Rect = [4, -1.2, 4 + run, 1.2];
  const up2: Rect = [34 - run, 3.6, 34, 6];
  b.floor([0, -10, 40, 10], CO, platform, [up1, up2], 0.4);
  b.stairs(4, 0, '+x', PL, CO, 2.4, platform);
  // The second stair comes up the south side, over the track
  b.stairs(34, 4.8, '-x', PL, CO, 2.4, platform);
  b.rail(0, -10, 0, 10, CO, yellow, 1.05);
  b.rail(4, -1.2, 4 + run, -1.2, CO, yellow, 1.0);
  b.rail(4, 1.2, 4 + run, 1.2, CO, yellow, 1.0);
  b.rail(4, -1.2, 4, 1.2, CO, yellow, 1.0);
  b.rail(34 - run, 3.6, 34, 3.6, CO, yellow, 1.0);
  b.rail(34 - run, 6, 34, 6, CO, yellow, 1.0);
  b.rail(34, 3.6, 34, 6, CO, yellow, 1.0);
  // Ticket barriers: low cover with three gaps
  for (const z of [-8.5, -4.5, 6.8]) b.box([20, CO, z - 1.2], [21, CO + 1.1, z + 1.2], steel);
  b.box([20, CO, -2], [21, CO + 1.1, 2.2], steel);
  b.box([8, CO, -9.6], [14, CO + 2.4, -8], dark); // kiosk
  b.crates(30, CO, -3, 2);
  b.crates(12, CO, 7.5, 2, 0.2);
  b.prop('concrete_road_barrier', 3, CO, -6, Math.PI / 2);
  b.prop('concrete_road_barrier', 3, CO, 6, Math.PI / 2);

  // --- Roof of the hall; the street stairs come down through it on the north side
  const stUp: Rect = [38 - run, -9.6, 38, -7.2];
  b.floor([-40, -10, 40, 10], ST, rock, [stUp, [-40, -3.05, -36.5, 3.05]], ST - ROOF);
  b.stairs(38, -8.4, '-x', CO, ST, 2.4, platform);
  // Street entrance hall (you start here; the shutter behind you is down)
  b.room(14, -9.8, 38.4, -3.6, ST, ST + 3.2, wall, { t: 0.3, roof: rock });
  b.rail(38 - run, -7.2, 38, -7.2, ST, yellow, 1.0);
  b.rail(38, -9.6, 38, -7.2, ST, yellow, 1.0);
  b.box([14.2, ST, -8.5], [14.5, ST + 2.6, -5], steel, { collide: false }); // the shutter

  // --- Vent shaft at the west end: two flights from the platform to the street
  b.slab(-49.5, -3.2, -36.5, 3.2, PL, steel, 1);
  b.stairs(-36.5, -2, '-x', PL, CO, 2, steel);
  b.slab(-49.5, -3.2, -36.5 - run, 3.2, CO, steel, 0.25);
  b.stairs(-36.5 - run, 2, '+x', CO, ST, 2, steel);
  b.slab(-36.5, -3.2, -32, 3.2, ST, steel, 0.25);
  for (const z of [-3.2, 3.2]) {
    b.wall(-49.5, z, -36.5, z, PL, ST + 3, rock, { t: 0.3 });
    b.wall(-36.5, z, -32, z, ST, ST + 3, rock, { t: 0.3 });
  }
  b.wall(-49.5, -3.2, -49.5, 3.2, PL, ST + 3, rock, { t: 0.3 });
  b.wall(-32, -3.2, -32, 3.2, ST, ST + 3, rock, { t: 0.3 });
  b.wall(-36.5, -3.2, -36.5, 3.2, PL, ST - 0.25, rock, { t: 0.3, gaps: [[-3, -1, 0, 2.6], [1, 3, 0, 2.6]] });
  b.slab(-49.6, -3.4, -31.9, 3.4, ST + 3.3, rock, 0.3);

  // --- Light: battery emergency lamps, mostly red; the flashlight does the rest
  b.lamp(20, ST + 3.1, -6.5, { color: 0xfff0d8, power: 40, range: 12, size: 0.5 });
  b.lamp(10, ROOF - 0.05, 0, { color: 0xff5a48, power: 45, range: 20, size: 0.4 });
  b.lamp(30, ROOF - 0.05, -4, { color: 0xff5a48, power: 45, range: 20, size: 0.4, flicker: 0.05 });
  b.lamp(18, CO - 0.45, 0, { color: 0xffd9a0, power: 40, range: 18, size: 0.4, flicker: 0.08 });
  b.lamp(-12, ROOF - 0.05, 0, { color: 0xff5a48, power: 55, range: 24, size: 0.4 });
  b.lamp(-30, ROOF - 0.05, 0, { color: 0xff5a48, power: 55, range: 24, size: 0.4 });
  b.lamp(0, 3.15, 0, { color: 0xff5a48, power: 22, range: 14, size: 0.3 });
  b.lamp(-20, 3.15, -1, { color: 0xff5a48, power: 22, range: 14, size: 0.3, flicker: 0.06 });
  b.lamp(37, 4.45, 0, { color: 0xd8ffe8, power: 60, range: 18, size: 0.6 });
  b.lamp(-43, ST + 2.9, 0, { color: 0xfff0d8, power: 40, range: 16, size: 0.4 });
  b.lamp(-20, PL + 2.55, -5.5, { color: 0xffe2b0, power: 14, range: 8, size: 0.3, flicker: 0.12 });

  // Water sheet 0: the whole station floor plan; it starts dry and comes up from the gallery
  b.water([-50, -10, 50, 10], 0, 0x0c1a1c);

  const bounds = new THREE.Box3(new THREE.Vector3(-50, 0, -25), new THREE.Vector3(50, 23, 25));
  dress(new Dresser(b, 404));
  const level = await b.finish(scene, gl, ENV.underground, bounds);
  return worldFromLevel('line9', level, {
    bounds,
    spawn: LINE9.spawn,
    spawnYaw: -Math.PI / 2,
    navGround: [[-30, -7, 44, 7]],
    menuCam: { center: [0, 9, 0], radius: 26, height: 13 },
  });
}


/** Line 9's sign style: transit navy with white letters. */
const NAVY = { bg: '#1d3f6e', fg: '#f4f4f0' };
/** The dot-matrix departure boards, still on their batteries. */
const DOTS = { bg: '#080808', fg: '#ffae3a', glow: 1.3, plate: false };
/** Column positions along the platform. */
const COLS = [-30, -12, 0, 18, 30];

/** A station closed in a hurry: sleepers and ballast, services on every wall, signs still lit, rubbish left behind. */
function dress(d: Dresser): void {
  const b = d.b;
  const ROOF = 17.5;
  const dark = b.flat(0x1e2226, 0.6, 0.3);
  const frame = b.flat(0x3a3d40, 0.55, 0.35);
  const navy = b.flat(0x1d3f6e, 0.6);
  const orange = b.flat(0xd9792a, 0.6);
  const yellow = b.flat(0xc9a227, 0.7);
  const cream = b.flat(0xe8e4d8, 0.85);
  const steelRod = b.flat(0x2a2d30, 0.5, 0.5);
  const off = b.flat(0x2a2e30, 0.4, 0.2); // a dead lamp or lens

  // A thin panel on a wall facing +z or -z: depth d0..d1 out from the wall line at z
  const panel = (x0: number, x1: number, y0: number, y1: number, z: number, out: number, d0: number, d1: number, m: THREE.Material): void => {
    const a = z + out * d0, c = z + out * d1;
    b.box([x0, y0, Math.min(a, c)], [x1, y1, Math.max(a, c)], m, { collide: false, shadow: false });
  };
  // Thin vertical rod (hangers, poles)
  const rod = (x: number, z: number, y0: number, y1: number, r = 0.012): void => {
    b.box([x - r, y0, z - r], [x + r, y1, z + r], steelRod, { collide: false, shadow: false });
  };
  // A two-sided sign hung across the hall (faces +x and -x) on rods up to `top`
  const hangSign = (x: number, z: number, y: number, w: number, h: number, top: number, east: string, west: string,
    style: { bg?: string; fg?: string; glow?: number } = NAVY): void => {
    b.box([x - 0.03, y - 0.03, z - w / 2 - 0.03], [x + 0.03, y + h + 0.03, z + w / 2 + 0.03], frame, { collide: false, shadow: false });
    d.sign('+x', x + 0.03, z, y, east, { ...style, w, h, plate: false });
    d.sign('-x', x - 0.03, z, y, west, { ...style, w, h, plate: false });
    for (const dz of [-w / 2 + 0.2, w / 2 - 0.2]) rod(x, z + dz, y + h, top);
  };
  // Fluorescent batten under a ceiling at y, on hanger wires up to `ceil` (long axis along z). Built from
  // boxes: the fitting prop is many parts, and these merge into the map for nothing.
  const tubeGlow = b.glow(0xeef4ff, 1.4);
  const tube = (x: number, y: number, z: number, ceil: number, lit = true): void => {
    b.box([x - 0.14, y - 0.08, z - 0.62], [x + 0.14, y, z + 0.62], frame, { collide: false, shadow: false });
    b.box([x - 0.1, y - 0.1, z - 0.58], [x + 0.1, y - 0.08, z + 0.58], lit ? tubeGlow : off, { collide: false, shadow: false });
    if (ceil > y + 0.05) for (const dz of [-0.45, 0.45]) rod(x, z + dz, y, ceil, 0.006);
  };
  // Prop placed only if it fits (hand-placed solids must not overlap anything)
  const place = (id: Parameters<typeof b.prop>[0], x: number, y: number, z: number, rot = 0, opts: { collide?: boolean; scale?: number } = {}): void => {
    if (opts.collide !== false && b.blocked(b.propBox(id, x, y, z, rot, opts.scale ?? 1))) return;
    b.prop(id, x, y, z, rot, opts);
  };

  // --- Track beds: ballast, sleepers under the rails, the track running on into the east tunnels
  const ballast = b.flat(0x575450, 0.95);
  const sleeper = b.flat(0x3b3631, 0.95);
  const railM = b.tint('steel', 0x70767c);
  for (const z of [-7, 7]) {
    b.box([-50, TR, z - 1.45], [32.2, TR + 0.008, z + 1.45], ballast, { collide: false, shadow: false });
    b.box([37.8, TR, z - 1.45], [49.5, TR + 0.008, z + 1.45], ballast, { collide: false, shadow: false });
    for (const rz of [z - 0.8, z + 0.8]) b.box([37.8, TR, rz - 0.06], [49.5, TR + 0.14, rz + 0.06], railM, { collide: false });
  }
  for (let x = -49; x < 49.5; x += 0.9) {
    if (x > 32 && x < 38) continue; // the platform caps and their steps
    for (const z of [-7, 7]) {
      if (z < 0 && x > -30.2 && x < -9.8) continue; // under the tram
      b.box([x - 0.12, TR, z - 1.2], [x + 0.12, TR + 0.08, z + 1.2], sleeper, { collide: false });
    }
  }
  for (const r of [[-49.5, -9.8, 33.8, -4.2], [-49.5, 4.2, 33.8, 9.8]] as const) {
    d.debris([...r], TR, 160, { paper: 0.3 });
    d.stains([...r], TR, 24, 0x0a0806, 0.55);
    d.puddles([...r], TR, 8, [0.8, 2.4]); // the first of the water, seeping in from the tunnels
    d.scatter([...r], TR, 8, [['trashbag', 2], ['old_tyre', 1], ['cardboard_box_01', 1], ['metal_jerrycan', 1]]);
  }
  // Third-rail cover boards, cable runs and trays along the tunnel walls
  for (const z of [-9.4, 9.4]) {
    b.box([-50, TR + 0.25, z - 0.15], [40, TR + 0.4, z + 0.15], b.flat(0xb58f2a, 0.7), { collide: false });
    d.pipe([-40, PL + 3.5, z * 1.04], [40, PL + 3.5, z * 1.04], 0.08, 0x1c1e20, { brackets: true });
    d.pipe([-40, PL + 3.8, z * 1.04], [40, PL + 3.8, z * 1.04], 0.06, 0x2a2d30, { brackets: false });
    d.pipe([-40, ROOF - 1.2, z * 1.03], [40, ROOF - 1.2, z * 1.03], 0.25, 0x56605c);
    d.cableTray([-49.5, TR + 1.6, Math.sign(z) * 9.75], [49.5, TR + 1.6, Math.sign(z) * 9.75]);
  }
  // Tunnel mouths: signal heads on the piers, tunnel numbers, a few dim lamps going into the dark
  const signal = (x: number, z: number, out: number): void => {
    const p = (d0: number, d1: number): [number, number] => [Math.min(x + out * d0, x + out * d1), Math.max(x + out * d0, x + out * d1)];
    const [a0, a1] = p(0, 0.25), [l0, l1] = p(0.25, 0.27), [h0, h1] = p(0.25, 0.4);
    b.box([a0, TR + 2.0, z - 0.2], [a1, TR + 3.0, z + 0.2], dark, { collide: false });
    b.box([l0, TR + 2.62, z - 0.09], [l1, TR + 2.8, z + 0.09], b.glow(0xff3a2a, 2.4), { collide: false, shadow: false });
    b.box([l0, TR + 2.2, z - 0.09], [l1, TR + 2.38, z + 0.09], off, { collide: false, shadow: false });
    for (const y of [TR + 2.82, TR + 2.4]) b.box([h0, y, z - 0.12], [h1, y + 0.03, z + 0.12], dark, { collide: false, shadow: false });
  };
  signal(40, -3.7, -1);
  signal(40, 3.7, -1);
  signal(-40, -3.7, 1);
  signal(-40, 3.7, 1);
  d.stencil('-x', 40, 0, TR + 1.1, 'DANGER  LIVE RAIL', { h: 0.3, color: '#e0b030' });
  d.stencil('-x', 40, -7, TR + 4.5, '9E-1', { h: 0.5 });
  d.stencil('-x', 40, 7, TR + 4.5, '9E-2', { h: 0.5 });
  d.stencil('+x', -40, -6.7, TR + 4.5, '9W-1', { h: 0.5 });
  d.stencil('+x', -40, 6.7, TR + 4.5, '9W-2', { h: 0.5 });
  const tunnelLamp = b.glow(0xffe2b0, 0.7);
  for (const x of [42.5, 46.5, -42.5, -46.5]) {
    for (const z of [-10, 10]) {
      const s = Math.sign(z);
      b.box([x - 0.15, TR + 2.9, Math.min(z, z - s * 0.1)], [x + 0.15, TR + 3.05, Math.max(z, z - s * 0.1)], tunnelLamp, { collide: false, shadow: false });
    }
  }
  // Maintenance corner at the east end of the beds, where the cap steps come down
  // A red tool locker and a ladder hung on wall pegs
  const locker = b.flat(0x8a2a22, 0.5, 0.4);
  b.box([38.9, TR, 9.4], [39.7, TR + 1.2, 9.85], locker);
  for (const y of [TR + 0.4, TR + 0.8]) b.box([38.92, y - 0.01, 9.38], [39.68, y + 0.01, 9.4], dark, { collide: false, shadow: false });
  for (const x of [38.0, 38.42]) b.box([x - 0.025, TR + 0.6, 9.76], [x + 0.025, TR + 2.8, 9.84], yellow, { collide: false, shadow: false });
  for (let y = TR + 0.75; y < TR + 2.8; y += 0.3) b.box([38.0, y, 9.78], [38.42, y + 0.03, 9.82], yellow, { collide: false, shadow: false });
  b.prop('plastic_broom', 39.7, TR, 8.9, Math.PI, { collide: false, tilt: [-0.15, 0] });
  d.cone(39.4, TR, 4.6);
  d.cone(39.6, TR, 5.3);
  d.wallProp('power_box_01', '+z', -10, 38.9, TR + 1.0, { collide: false });
  d.sign('+z', -10, 38.9, TR + 2.2, 'TRACK ACCESS', { h: 0.22, w: 1.1, bg: '#f2f0e8', fg: '#a01818', lines: ['TRACK ACCESS', 'AUTHORISED STAFF ONLY'] });
  // A cable drum on its side, chocked against the wall
  const drum = new THREE.CylinderGeometry(0.45, 0.45, 0.5, 14);
  drum.rotateZ(Math.PI / 2);
  drum.translate(39.2, TR + 0.45, -9.4);
  b.geo(drum, b.flat(0x6a4a30, 0.9));
  b.colliders.push(new THREE.Box3(new THREE.Vector3(38.95, TR, -9.85), new THREE.Vector3(39.45, TR + 0.9, -8.95)));

  // --- The tram: livery, a dead destination blind, seats, poles, half its lights out
  const tz0 = -6.9, tz1 = -4.0;
  for (const [x0, x1] of [[-30, -27.6], [-25.4, -14.6], [-12.4, -10]] as const) panel(x0, x1, PL + 0.45, PL + 0.6, tz1, 1, 0.06, 0.075, yellow);
  b.box([-30, PL + 0.45, tz0 - 0.075], [-10, PL + 0.6, tz0 - 0.06], yellow, { collide: false, shadow: false });
  d.sign('+x', -9.94, -5.55, PL + 2.31, 'NOT IN SERVICE', { ...DOTS, h: 0.24, w: 1.2 });
  d.sign('-x', -30.06, -5.55, PL + 2.31, 'NOT IN SERVICE', { ...DOTS, h: 0.24, w: 1.2 });
  d.stencil('+z', tz1 + 0.06, -11.2, PL + 1.0, '9', { h: 0.6, color: '#f0e8d0' });
  d.stencil('+z', tz1 + 0.06, -29, PL + 0.9, '9-114', { h: 0.22, color: '#f0e8d0' });
  const seat = b.flat(0x3a4a5a, 0.8);
  for (const x of [-27.5, -24.5, -15.5, -12.5]) {
    b.box([x - 0.9, PL, -6.8], [x + 0.9, PL + 0.45, -6.3], seat, { collide: false });
    b.box([x - 0.9, PL + 0.45, -6.84], [x + 0.9, PL + 0.95, -6.74], seat, { collide: false });
  }
  for (const x of [-23, -17]) rod(x, -5.0, PL, PL + 2.6, 0.02);
  b.box([-29, PL + 2.52, -5.6], [-22, PL + 2.56, -5.3], off, { collide: false, shadow: false });
  b.box([-22, PL + 2.52, -5.6], [-11, PL + 2.56, -5.3], b.glow(0xd8e8ff, 0.5), { collide: false, shadow: false });
  d.debris([-29.8, -6.7, -10.2, -4.2], PL, 30, { paper: 0.7 });

  // --- Platform: edges, furniture, wayfinding
  const plat: [number, number, number, number] = [-36, -3.9, 33.5, 3.9];
  d.hazard(-36.4, -3.75, 34, -3.75, PL, 0.35);
  d.hazard(-36.4, 3.75, 34, 3.75, PL, 0.35);
  b.box([-36.4, PL, 3.15], [34, PL + 0.008, 3.5], yellow, { collide: false, shadow: false }); // tactile strips
  b.box([-36.4, PL, -3.5], [34, PL + 0.008, -3.15], yellow, { collide: false, shadow: false });
  for (const x of [-33, -8, 10, 30]) d.floorText(x, PL, 2.95, 'MIND THE GAP', '+z', { h: 0.3, color: '#e8e2d0' });
  for (const x of [-33, -4, 8, 30]) d.floorText(x, PL, -2.95, 'MIND THE GAP', '-z', { h: 0.3, color: '#e8e2d0' });
  // Benches: slatted seats and a backrest on the old frames; litter bins by the columns
  for (const x of [-22, -6]) {
    b.box([x - 1.2, PL + 0.5, -0.4], [x + 1.2, PL + 0.53, 0.4], b.flat(0x6a4a30, 0.85), { collide: false, shadow: false });
    b.box([x - 1.15, PL + 0.53, -0.05], [x + 1.15, PL + 1.0, 0.05], dark, { collide: false });
  }
  const binM = b.flat(0x2f4a38, 0.6, 0.3);
  for (const x of COLS) {
    d.cyl([x + 0.75, PL, -0.7], 0.22, 0.78, binM);
    d.cyl([x + 0.75, PL + 0.78, -0.7], 0.24, 0.05, dark);
  }
  // Help points and fire points on the column faces, cameras up top
  for (const x of [-30, -12, 18]) {
    d.wallBox('-z', -0.4, x, PL + 1.1, 0.32, 0.5, 0.1, 0xc9a227, { glow: 0x49ff8a });
    d.sign('-z', -0.4, x, PL + 1.68, 'HELP POINT', { ...NAVY, h: 0.16, w: 0.62 });
  }
  for (const x of [0, 30]) {
    d.wallProp('fire_alarm', '-z', -0.4, x - 0.15, PL + 1.4, { collide: false });
    d.sign('-z', -0.4, x, PL + 1.7, 'FIRE POINT', { h: 0.16, w: 0.62, bg: '#b3261e', fg: '#ffffff' });
  }
  d.wallProp('security_camera_02', '+x', -11.6, 0, PL + 4.3, { collide: false });
  // Hanging direction signs and the departure boards (rods up to the roof, or the concourse slab)
  const WEST = '← PLATFORM 2          PLATFORM 1 →';
  const EAST = '← PLATFORM 1     ↑ WAY OUT     PLATFORM 2 →';
  hangSign(-21, 0, PL + 3.0, 3.6, 0.4, ROOF, WEST, EAST);
  hangSign(-3, 0, PL + 3.0, 3.6, 0.4, ROOF, WEST, EAST);
  hangSign(24, 0, PL + 3.0, 3.6, 0.4, CO - 0.4, WEST, EAST);
  hangSign(-8, 0, PL + 2.6, 2.6, 0.26, ROOF, 'LINE 9 · NO SERVICE', 'LINE 9 · NO SERVICE', DOTS);
  hangSign(28, 0, PL + 2.6, 2.6, 0.26, CO - 0.4, 'NO SERVICE · STATION CLOSED', 'NO SERVICE · STATION CLOSED', DOTS);
  // A family's things, left by the bench
  b.prop('long_life_food', -22.5, PL, -0.75, 0.3, { collide: false });
  b.prop('plastic_crate_02', -21.2, PL, -0.8, -0.2, { collide: false });
  b.prop('long_life_food', -21.2, PL + 0.25, -0.8, 1.2, { collide: false });
  d.stains(plat, PL, 30, 0x0b0b0b, 0.5);
  d.puddles(plat, PL, 6, [0.5, 1.5]); // under the roof leaks
  d.debris(plat, PL, 160, { paper: 0.55 });
  d.scatter(plat, PL, 26, [
    ['trashbag', 4], ['cardboard_box_01', 3], ['metal_trash_can', 2, { collide: true }], ['WetFloorSign_01', 1],
    ['plastic_crate_03', 2], ['hand_truck', 1], ['medical_box', 1], ['metal_jerrycan', 1], ['plastic_container', 1],
  ], { clear: [[-28.5, 0.5, -28 + 6, 3.5], [21.5, -3.5, 26.5, -0.5], [-37, -3.5, -33.5, 3.5]] });
  // Line signs on the columns, lit by their own backlight
  for (const x of COLS) {
    for (const out of [-1, 1]) {
      panel(x - 0.9, x + 0.9, PL + 3.1, PL + 3.7, 0, out, 0.4, 0.46, b.glow(0x1d4f8f, 1.1));
      panel(x - 0.75, x - 0.2, PL + 3.32, PL + 3.48, 0, out, 0.46, 0.47, b.glow(0xffffff, 1.3));
      panel(x - 0.1, x + 0.7, PL + 3.36, PL + 3.44, 0, out, 0.46, 0.47, b.glow(0xffffff, 1.0));
    }
    d.wallProp('korean_fire_extinguisher_01', '+z', 0.4, x + 0.6, PL + 0.4, { collide: false });
  }
  // The track walls: a navy and orange frieze, the station name every 16 m, faded posters, grime and leaks
  for (const [z, out, face] of [[-9.85, 1, '+z'], [9.85, -1, '-z']] as const) {
    panel(-40, 40, PL + 3.98, PL + 4.04, z, out, 0.004, 0.012, navy);
    panel(-40, 40, PL + 4.9, PL + 4.94, z, out, 0.004, 0.012, orange);
    for (const x of [-32, -16, 0, 16, 32]) d.sign(face, z, x, PL + 4.18, 'FERRIER STREET', { ...NAVY, h: 0.55, w: 3.4, border: '#d8dde4' });
    for (let x = -36; x < 38; x += 6) {
      if (d.r() < 0.25) continue;
      const c = d.pick([0x7a3a2a, 0x2a4a6a, 0xc8b89a, 0x3a5a3a, 0x8a7a4a]);
      panel(x, x + 1.6, PL + 1.2, PL + 3.4, z, out, 0.005, 0.02, b.flat(c, 0.9));
      panel(x - 0.04, x + 1.64, PL + 1.16, PL + 1.2, z, out, 0.005, 0.03, frame);
      panel(x - 0.04, x + 1.64, PL + 3.4, PL + 3.44, z, out, 0.005, 0.03, frame);
    }
    d.streaks(face, z, -40, 40, PL, ROOF, 34);
    d.streaks(face, z, -40, 40, PL + 3, ROOF, 10, { color: 0x0b1a1e, opacity: 0.4, base: false });
  }
  for (const [x, z] of [[-24, -2], [-4, 2]] as const) tube(x, CO - 0.4, z, ROOF);
  for (const [x, z] of [[14, -2], [24, 2]] as const) tube(x, CO - 0.4, z, CO - 0.4);

  // --- Drainage gallery and pump room
  // The sign atlas holds about one hall's worth of lettering, so the lower and upper levels get their own
  const sd = new Dresser(b, 4040);
  const gal: [number, number, number, number] = [-29.5, -2.9, 29.5, 2.9];
  d.stains(gal, 0, 26, 0x0c1a1f, 0.6, [1, 3.5]);
  d.puddles(gal, 0, 12, [0.6, 2]);
  d.debris(gal, 0, 60, { paper: 0.1 });
  d.pipe([-30, 3.3, 2.6], [30, 3.3, 2.6], 0.2, 0x3e4a44);
  d.pipe([-30, 3.8, -2.6], [30, 3.8, -2.6], 0.1, 0x8a3a2a);
  d.cableTray([-17, 2.7, 2.8], [29.6, 2.7, 2.8], 0.25);
  // Grime, and the brown line the 2031 flood left at 1.4 m
  const tide = b.flat(0x3a3020, 0.95);
  for (const [z, out, face] of [[-3, 1, '+z'], [3, -1, '-z']] as const) {
    d.streaks(face, z, -30, 29.7, 0, 3.2, 18, { color: 0x0e1612 });
    panel(-30, 29.7, 1.38, 1.42, z, out, 0.003, 0.008, tide);
  }
  sd.stencil('-z', 3, -6, 1.5, 'FLOOD 2031', { h: 0.18, color: '#cfc6a8' });
  // Bulkhead lamps (some dead) and direction stencils
  for (const [x, z, lit] of [[-25, -3, true], [-10, -3, false], [5, -3, true], [-5, 3, true], [10, 3, false], [27, 3, true]] as const) {
    const face = z < 0 ? '+z' : '-z';
    d.wallBox(face, z, x, 2.45, 0.36, 0.2, 0.12, 0x3a3d40);
    panel(x - 0.14, x + 0.14, 2.49, 2.61, z, -Math.sign(z), 0.12, 0.13, lit ? b.glow(0xffe2b0, 1.6) : off);
  }
  sd.stencil('+z', -3, -10, 1.75, 'PUMP ROOM P2 → 40 M', { h: 0.3, color: '#d8c890' });
  sd.stencil('+z', -3, 5, 1.75, 'P2 → 25 M', { h: 0.3, color: '#d8c890' });
  sd.stencil('-z', 3, 2, 1.75, 'PLATFORMS · STAIR W →', { h: 0.3, color: '#d8c890' });
  d.scatter(gal, 0, 6, [['metal_jerrycan', 1], ['trashbag', 1], ['old_tyre', 1], ['WetFloorSign_01', 1]], { clear: [[-28.5, 0.5, -20, 3.5], [20, -3.5, 26.5, -0.5]] });
  sd.sign('-x', 29.75, 0, 2.72, 'P2 PUMP ROOM', { h: 0.3, w: 3.2, bg: '#f2f0e8', fg: '#1c1c1c', lines: ['P2 PUMP ROOM', 'AUTHORISED STAFF ONLY'] });

  // Pump room: control panels on the west wall, the pumps' numbers, Hana's bench
  sd.sign('+x', 30.25, 0, 2.95, 'PUMP ROOM P2', { ...NAVY, h: 0.32, w: 2.2 });
  for (const [z, w] of [[-4.2, 2.8], [3.4, 2.6]] as const) {
    d.wallBox('+x', 30.25, z, 0.8, w, 1.5, 0.35, 0x6b7a72, { glow: 0x49ff8a });
    for (let i = 0; i < 6; i++) {
      const zz = z - w / 2 + 0.35 + i * ((w - 0.7) / 5);
      const lamp = i % 3 === 2 ? b.glow(0xff3a2a, 1.8) : i % 2 ? off : b.glow(0x49ff8a, 1.8);
      b.box([30.6, 2.0, zz - 0.04], [30.62, 2.08, zz + 0.04], lamp, { collide: false, shadow: false });
      b.box([30.6, 1.55, zz - 0.08], [30.62, 1.71, zz + 0.08], cream, { collide: false, shadow: false }); // gauges
    }
    sd.stencil('+x', 30.61, z, 2.15, 'PUMP CONTROL', { h: 0.14, color: '#e8e2d0' });
    d.cableTray([30.6, 4.25, z], [40, 4.25, z], 0.3);
  }
  for (const [z, n] of [[-4.5, 1], [0, 2], [4.5, 3]] as const) {
    sd.stencil('-x', 40, z, 0.55, `P2-${n}`, { h: 0.35 });
    sd.stencil('-x', 40, z, 1.85, 'DANGER 6.6 KV', { h: 0.12, color: '#e0b030' });
  }
  d.pipe([41.5, 4.1, -6.5], [41.5, 4.1, 6.5], 0.28, 0x4d6a58);
  d.wallProp('wall_clock', '-x', 44, -2.25, 3.0, { collide: false });
  for (const z of [-3, 3]) d.ceilingProp('caged_hanging_light', 34, 4.5, z);
  // Her radio: a grey set with a lit dial
  b.box([34.9, 0.9, 5.75], [35.6, 1.25, 6.15], b.flat(0x4a5048, 0.6, 0.3), { collide: false });
  b.box([35.0, 1.05, 5.74], [35.3, 1.17, 5.75], b.glow(0xffb469, 1), { collide: false, shadow: false });
  d.cable([35.5, 1.25, 6.1], [36.6, 4.4, 6.5], 0.2);
  b.prop('office_notepads', 34.7, 0.9, 6.05, 0.2, { collide: false });
  b.prop('clipboard', 33.6, 0.9, 5.85, 2.6, { collide: false });
  b.prop('desk_lamp_arm_01', 32.4, 0.9, 6.1, Math.PI - 0.4, { collide: false });
  b.prop('can_rusted', 32.9, 0.9, 5.8, 0, { collide: false });
  b.prop('can_rusted', 35.9, 0.9, 5.85, 1, { collide: false });
  b.prop('metal_stool_02', 34.3, 0, 5.0, 0.3, { collide: false });
  b.prop('plastic_jerrycan', 34.4, 0, -5.4, 0.6, { collide: false });
  d.wallProp('korean_fire_extinguisher_01', '+x', 30.25, -2.0, 0.35, { collide: false });
  for (const [z, face] of [[-7, '+z'], [7, '-z']] as const) d.streaks(face, z, 30.3, 44, 0, 4.5, 8);
  d.puddles([38.5, -6.5, 43.5, 6.5], 0, 5, [0.5, 1.4]);
  d.shelves(30.4, -6.8, 36, -6.8, 0, '+z');
  b.prop('tool_cart', 38, 0, 5.5, 0.4);
  b.prop('medical_box', 33, 0.9, 6.1, 0.2, { collide: false });
  for (const z of [-4.5, 0, 4.5]) d.pipe([41.5, 2.2, z], [41.5, 4.6, z], 0.25, 0x4d6a58, { brackets: false });
  d.debris([30.5, -6.8, 43.5, 6.8], 0, 30, { paper: 0.6 });

  // --- Concourse: ticket hall gone quiet
  const con: [number, number, number, number] = [0.5, -9.7, 39.5, 9.7];
  // Ticket machines on the south wall, one still lit
  const machine = b.flat(0x5a6670, 0.5, 0.4);
  for (const [x, lit] of [[23, true], [24.1, false], [25.2, false]] as const) {
    if (b.blocked(new THREE.Box3(new THREE.Vector3(x - 0.4, CO, 9.25), new THREE.Vector3(x + 0.4, CO + 1.75, 9.84)))) continue;
    b.box([x - 0.4, CO, 9.25], [x + 0.4, CO + 1.75, 9.84], machine);
    b.box([x - 0.28, CO + 1.05, 9.23], [x + 0.28, CO + 1.45, 9.25], lit ? b.glow(0x6fb4ff, 0.6) : off, { collide: false, shadow: false });
    b.box([x - 0.3, CO + 0.75, 9.1], [x + 0.3, CO + 0.82, 9.25], dark, { collide: false });
    b.box([x - 0.1, CO + 0.9, 9.22], [x + 0.1, CO + 0.96, 9.25], b.glow(0xffb469, 1), { collide: false, shadow: false });
  }
  sd.sign('-z', 9.85, 24.1, CO + 2.0, 'TICKETS', { ...NAVY, h: 0.32, w: 1.6 });
  // The line map: title, stations, and the strip with its stops
  sd.sign('+z', -9.85, 24, CO + 1.6, '', {
    h: 0.9, w: 4.6, bg: '#f2f0e8', fg: '#1d3f6e', border: '#1d3f6e',
    lines: ['LINE 9   HARBOUR QUAY – BARRIER ROAD', 'Harbour Quay · Saltmarket · FERRIER STREET · Glasshouse · Pump Station 3 · Barrier Road', 'SERVICE SUSPENDED UNTIL FURTHER NOTICE'],
  });
  panel(22, 26, CO + 1.25, CO + 1.31, -9.85, 1, 0.005, 0.02, orange);
  for (let i = 0; i < 6; i++) {
    const x = 22 + i * 0.8;
    panel(x - 0.06, x + 0.06, CO + 1.22, CO + 1.34, -9.85, 1, 0.02, 0.03, i === 2 ? navy : cream);
  }
  d.wallProp('wall_clock', '+z', -9.85, 20.5, CO + 3.2, { collide: false });
  hangSign(20.5, 0, CO + 3.2, 3.4, 0.4, ROOF, '↑ PLATFORMS 1 & 2', '↑ WAY OUT · FERRIER STREET');
  sd.sign('+z', -9.85, 35.5, CO + 3.4, 'WAY OUT ↑ FERRIER STREET', { ...NAVY, h: 0.36, w: 3.2 });
  // Kiosk: shut window and counter
  b.box([8.6, CO + 1.0, -8.0], [13.4, CO + 2.1, -7.98], b.flat(0x10161c, 0.08, 0.3), { collide: false, shadow: false });
  b.box([8.4, CO + 0.95, -8.0], [13.6, CO + 1.0, -7.7], frame, { collide: false });
  sd.sign('+z', -8.1, 11, CO + 2.45, 'TICKETS · INFORMATION', { h: 0.3, w: 5.2, plate: false, bg: '#ffc27a', fg: '#2a1a08', glow: 0.9 });
  sd.sign('+z', -7.98, 12.4, CO + 1.3, 'CLOSED', { h: 0.2, w: 0.6, plate: false, bg: '#f0ece0', fg: '#a01818' });
  // Flood relief point: a trestle table of water and food, a chair, a loaded pallet
  place('wooden_table_02', 16.6, CO, 9.3, 0);
  b.prop('long_life_food', 16.2, CO + 0.8, 9.3, 0.1, { collide: false });
  b.prop('long_life_food', 16.9, CO + 0.8, 9.35, -0.2, { collide: false });
  b.prop('medical_box', 16.6, CO + 0.8, 9.05, 0.3, { collide: false });
  b.prop('SchoolChair_01', 16.4, CO, 8.45, 0.25, { collide: false });
  place('plastic_container', 18.4, CO, 9.35, 0.05);
  b.prop('plastic_container', 18.4, CO + 0.43, 9.35, -0.1, { collide: false });
  if (!b.blocked(new THREE.Box3(new THREE.Vector3(14.1, CO, 8.6), new THREE.Vector3(15.5, CO + 0.8, 9.7)))) d.pallet(14.8, CO, 9.15, 0, 'boxes');
  sd.sign('-z', 9.85, 16.8, CO + 1.9, 'FLOOD RELIEF POINT B', { h: 0.4, w: 3.2, bg: '#e8e4d8', fg: '#1d3f6e', border: '#1d3f6e' });
  sd.sign('-z', 9.85, 16.8, CO + 1.45, 'WATER · BLANKETS · FIRST AID', { h: 0.22, w: 2.2, bg: '#f2f0e8', fg: '#1c1c1c' });
  // Staff door and the fire point by the balcony
  b.box([2.4, CO, -9.85], [3.6, CO + 2.15, -9.8], b.flat(0x55606a, 0.6, 0.3), { collide: false });
  for (const [x0, x1, y0, y1] of [[2.32, 2.4, 0, 2.23], [3.6, 3.68, 0, 2.23], [2.32, 3.68, 2.15, 2.23]] as const) {
    b.box([x0, CO + y0, -9.85], [x1, CO + y1, -9.78], frame, { collide: false, shadow: false });
  }
  b.box([3.35, CO + 1.0, -9.8], [3.5, CO + 1.04, -9.74], steelRod, { collide: false, shadow: false });
  sd.sign('+z', -9.8, 3.0, CO + 1.6, 'STAFF ONLY', { h: 0.18, w: 0.8, bg: '#f2f0e8', fg: '#1c1c1c' });
  d.wallProp('korean_fire_extinguisher_01', '+z', -9.85, 5.6, CO + 0.35, { collide: false });
  d.wallProp('fire_alarm', '+z', -9.85, 6.3, CO + 1.4, { collide: false });
  sd.sign('+z', -9.85, 5.95, CO + 1.75, 'FIRE POINT', { h: 0.2, w: 0.8, bg: '#b3261e', fg: '#ffffff' });
  d.wallProp('security_camera_02', '+z', -9.85, 18.6, CO + 3.6, { collide: false });
  d.duct([1, ROOF - 0.45, -6.8], [26, ROOF - 0.45, -6.8], 0.9, 0.5);
  d.stains(con, CO, 20, 0x0b0b0b, 0.45);
  d.debris(con, CO, 120, { paper: 0.75 });
  d.scatter(con, CO, 16, [['trashbag', 2], ['cardboard_box_01', 3], ['metal_trash_can', 1, { collide: true }], ['plastic_crate_03', 1], ['WetFloorSign_01', 1]], {
    clear: [[3.5, -1.5, 12, 1.5], [26, 3.3, 34.5, 6.3], [19.5, -10, 21.5, 10], [13.8, 8, 19.2, 10]],
  });
  for (const z of [-8.5, -4.5, 0, 6.8]) b.box([20.2, CO + 1.1, z - 0.15], [20.8, CO + 1.4, z + 0.15], b.glow(z === 0 ? 0x49ff8a : 0xff3a2a, 1.4), { collide: false });
  b.box([8.2, CO + 2.4, -9.5], [13.8, CO + 2.8, -8.1], b.glow(0xffc27a, 0.6), { collide: false }); // kiosk sign
  b.prop('Television_01', 11, CO + 1.2, -8.4, 0, { collide: false, scale: 0.6 });
  for (const [x, z] of [[10, 0], [26, -5], [30, 6]] as const) tube(x, ST - 1, z, ROOF);

  // --- Street hall: the shutter is down; notices, the way down, the last of the rain under the door
  const hall: [number, number, number, number] = [14.5, -9.5, 38, -3.9];
  sd.sign('+x', 14.15, -6.75, ST + 2.66, 'FERRIER STREET', { ...NAVY, h: 0.4, w: 2.6 });
  sd.sign('+x', 14.5, -6.2, ST + 1.2, '', { h: 0.5, w: 0.5, bg: '#f2f0e8', fg: '#1c1c1c', lines: ['STATION', 'CLOSED', 'FLOODING'] });
  sd.sign('-z', -3.75, 24, ST + 1.0, '', {
    h: 0.9, w: 1.7, bg: '#f2f0e8', fg: '#1c1c1c', border: '#1d3f6e',
    lines: ['LINE 9 CLOSED', 'Ferrier Street closed after', 'the 2031 floods. Buses from', 'Harbour Quay. PORT VEYLE TRANSIT'],
  });
  sd.sign('+z', -9.65, 25.8, ST + 2.2, 'PLATFORMS ↓ LINE 9', { ...NAVY, h: 0.32, w: 2.4 });
  d.wallBox('-z', -3.75, 30, ST + 1.1, 0.32, 0.5, 0.1, 0xc9a227, { glow: 0x49ff8a });
  sd.sign('-z', -3.75, 30, ST + 1.68, 'HELP POINT', { ...NAVY, h: 0.16, w: 0.62 });
  for (const x of [24, 32]) tube(x, ST + 3.2, -6.7, ST + 3.2);
  b.prop('plastic_broom', 15.2, ST, -4.2, 0.2, { collide: false, tilt: [0.15, 0] });
  b.prop('multi_cleaner_5_litre', 15.8, ST, -4.05, 0.5, { collide: false });
  d.cyl([36.8, ST, -4.25], 0.22, 0.78, binM);
  d.streaks('-z', -3.75, 14.2, 38.2, ST, ST + 3.2, 8);
  d.streaks('+z', -9.65, 14.2, 27, ST, ST + 3.2, 6);
  d.puddles([14.6, -8.5, 17, -5], ST, 3, [0.6, 1.4]);
  d.debris(hall, ST, 40, { paper: 0.8 });
  d.scatter(hall, ST, 5, [['cardboard_box_01', 1], ['trashbag', 1], ['WetFloorSign_01', 1]], { clear: [[38 - 11, -9.6, 38, -7.2], [18, -8.5, 22, -5.5]] });

  // --- Vent shaft: the exit sign over its doors, level marks, ducts and cable up the walls
  sd.sign('+x', -36.35, 0, PL + 2.85, 'EMERGENCY EXIT · VENT SHAFT V9', { h: 0.34, w: 3.6, bg: '#0f6a3a', fg: '#ffffff', glow: 1.2, plate: false });
  sd.stencil('+x', -49.35, 0, PL + 1.4, 'V9 · LEVEL 1 · PLATFORM', { h: 0.3 });
  sd.stencil('+x', -49.35, 0, CO + 1.4, 'V9 · LEVEL 2', { h: 0.3 });
  sd.stencil('-x', -32.15, 0, ST + 1.4, 'V9 · STREET ↑', { h: 0.3 });
  for (const [x, y, z] of [[-49.35, PL + 2.6, 1.5], [-49.35, CO + 2.4, -1.5], [-32.15, ST + 2.4, 1.6]] as const) {
    const out = x < -40 ? 1 : -1;
    b.box([Math.min(x, x + out * 0.1), y, z - 0.15], [Math.max(x, x + out * 0.1), y + 0.15, z + 0.15], b.glow(0xfff0d8, 1.4), { collide: false, shadow: false });
  }
  d.streaks('+x', -49.35, -3, 3, PL, ST + 3, 10);
  d.streaks('+z', -3.05, -49.4, -36.6, PL, ST + 3, 10);
  d.streaks('-z', 3.05, -49.4, -36.6, PL, ST + 3, 10);
  d.pipe([-49.2, PL, -2.8], [-49.2, ST + 2.6, -2.8], 0.18, 0x56605c);
  d.pipe([-49.2, PL, 2.8], [-49.2, ST + 2.6, 2.8], 0.1, 0x1c1e20);
  d.puddles([-49.3, -3, -36.7, 3], PL, 2, [0.6, 1.2]);
  d.debris([-49.4, -3.1, -36.6, 3.1], PL, 30, { paper: 0.3 });
}
