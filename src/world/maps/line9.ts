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
  const b = await LevelBuilder.create(q, ['concrete', 'tiles', 'floor', 'steel', 'rust', 'painted', 'green'],
    ['wooden_military_crate', 'Barrel_01', 'barrel_03', 'utility_box_01', 'plastic_crate_01', 'concrete_road_barrier']);
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
  const level = b.finish(scene, gl, ENV.underground, bounds);
  return worldFromLevel('line9', level, {
    bounds,
    spawn: LINE9.spawn,
    spawnYaw: -Math.PI / 2,
    navGround: [[-30, -7, 44, 7]],
    menuCam: { center: [0, 9, 0], radius: 26, height: 13 },
  });
}

/** A station closed in a hurry: sleepers and ballast, services on every wall, signs still lit, rubbish left behind. */
function dress(d: Dresser): void {
  const b = d.b;
  const ROOF = 17.5;
  // --- Track beds: sleepers under the rails, ballast, litter
  const sleeper = b.flat(0x3b3631, 0.95);
  for (let x = -49; x < 34; x += 0.9) {
    for (const z of [-7, 7]) {
      if (z < 0 && x > -30.2 && x < -9.8) continue; // under the tram
      b.box([x - 0.12, TR, z - 1.2], [x + 0.12, TR + 0.08, z + 1.2], sleeper, { collide: false });
    }
  }
  for (const r of [[-49.5, -9.8, 33.8, -4.2], [-49.5, 4.2, 33.8, 9.8]] as const) {
    d.debris([...r], TR, 160, { paper: 0.3 });
    d.stains([...r], TR, 24, 0x0a0806, 0.55);
    d.scatter([...r], TR, 8, [['trashbag', 2], ['old_tyre', 1], ['cardboard_box_01', 1], ['metal_jerrycan', 1]]);
  }
  // Third-rail cover boards and cable runs along the tunnel walls
  for (const z of [-9.4, 9.4]) {
    b.box([-50, TR + 0.25, z - 0.15], [40, TR + 0.4, z + 0.15], b.flat(0xb58f2a, 0.7), { collide: false });
    d.pipe([-40, PL + 3.5, z * 1.04], [40, PL + 3.5, z * 1.04], 0.08, 0x1c1e20, { brackets: true });
    d.pipe([-40, PL + 3.8, z * 1.04], [40, PL + 3.8, z * 1.04], 0.06, 0x2a2d30, { brackets: false });
    d.pipe([-40, ROOF - 1.2, z * 1.03], [40, ROOF - 1.2, z * 1.03], 0.25, 0x56605c);
  }

  // --- Platform: station furniture, signage, the mess of an evacuation
  const plat: [number, number, number, number] = [-36, -3.9, 33.5, 3.9];
  d.hazard(-36.4, -3.75, 34, -3.75, PL, 0.35);
  d.hazard(-36.4, 3.75, 34, 3.75, PL, 0.35);
  d.stains(plat, PL, 30, 0x0b0b0b, 0.5);
  d.debris(plat, PL, 160, { paper: 0.55 });
  d.scatter(plat, PL, 26, [
    ['trashbag', 4], ['cardboard_box_01', 3], ['metal_trash_can', 2, { collide: true }], ['WetFloorSign_01', 1],
    ['plastic_crate_03', 2], ['hand_truck', 1], ['medical_box', 1], ['metal_jerrycan', 1],
  ], { clear: [[-28.5, 0.5, -28 + 6, 3.5], [21.5, -3.5, 26.5, -0.5]] });
  // A thin panel on a wall facing +z or -z: depth d0..d1 out from the wall line at z
  const panel = (x0: number, x1: number, y0: number, y1: number, z: number, out: number, d0: number, d1: number, m: THREE.Material): void => {
    const a = z + out * d0, c = z + out * d1;
    b.box([x0, y0, Math.min(a, c)], [x1, y1, Math.max(a, c)], m, { collide: false });
  };
  // Line signs on the columns, lit by their own backlight
  for (const x of [-30, -12, 0, 18, 30]) {
    for (const out of [-1, 1]) {
      panel(x - 0.9, x + 0.9, PL + 3.1, PL + 3.7, 0, out, 0.4, 0.46, b.glow(0x1d4f8f, 1.1));
      panel(x - 0.75, x - 0.2, PL + 3.32, PL + 3.48, 0, out, 0.46, 0.47, b.glow(0xffffff, 1.3));
      panel(x - 0.1, x + 0.7, PL + 3.36, PL + 3.44, 0, out, 0.46, 0.47, b.glow(0xffffff, 1.0));
    }
    d.wallProp('korean_fire_extinguisher_01', '+z', 0.4, x + 0.6, PL + 0.4, { collide: false });
  }
  // Wall posters along the tiled walls (faded, some torn)
  for (let x = -36; x < 38; x += 6) {
    for (const [z, out] of [[-9.85, 1], [9.85, -1]] as const) {
      if (d.r() < 0.25) continue;
      const c = d.pick([0x7a3a2a, 0x2a4a6a, 0xc8b89a, 0x3a5a3a, 0x8a7a4a]);
      panel(x, x + 1.6, PL + 1.2, PL + 3.4, z, out, 0.005, 0.02, b.flat(c, 0.9));
    }
  }
  for (const [x, z] of [[-24, -2], [-4, 2], [14, -2], [24, 2]] as const) d.ceilingProp('mounted_fluorescent_lights', x, CO - 0.4, z, Math.PI / 2);

  // --- Drainage gallery and pump room
  const gal: [number, number, number, number] = [-29.5, -2.9, 29.5, 2.9];
  d.stains(gal, 0, 26, 0x0c1a1f, 0.6, [1, 3.5]);
  d.debris(gal, 0, 60, { paper: 0.1 });
  d.pipe([-30, 3.3, 2.6], [30, 3.3, 2.6], 0.2, 0x3e4a44);
  d.pipe([-30, 3.8, -2.6], [30, 3.8, -2.6], 0.1, 0x8a3a2a);
  d.scatter(gal, 0, 6, [['metal_jerrycan', 1], ['trashbag', 1], ['old_tyre', 1], ['WetFloorSign_01', 1]], { clear: [[-28.5, 0.5, -20, 3.5], [20, -3.5, 26.5, -0.5]] });
  d.shelves(30.4, -6.8, 36, -6.8, 0, '+z');
  b.prop('tool_cart', 38, 0, 5.5, 0.4);
  b.prop('medical_box', 33, 0.9, 6.1, 0.2, { collide: false });
  for (const z of [-4.5, 0, 4.5]) d.pipe([41.5, 2.2, z], [41.5, 4.6, z], 0.25, 0x4d6a58, { brackets: false });
  d.debris([30.5, -6.8, 43.5, 6.8], 0, 30, { paper: 0.6 });

  // --- Concourse: ticket hall gone quiet
  const con: [number, number, number, number] = [0.5, -9.7, 39.5, 9.7];
  d.stains(con, CO, 20, 0x0b0b0b, 0.45);
  d.debris(con, CO, 120, { paper: 0.75 });
  d.scatter(con, CO, 16, [['trashbag', 2], ['cardboard_box_01', 3], ['metal_trash_can', 1, { collide: true }], ['plastic_crate_03', 1], ['WetFloorSign_01', 1]], {
    clear: [[3.5, -1.5, 12, 1.5], [26, 3.3, 34.5, 6.3], [19.5, -10, 21.5, 10]],
  });
  for (const z of [-8.5, -4.5, 0, 6.8]) b.box([20.2, CO + 1.1, z - 0.15], [20.8, CO + 1.4, z + 0.15], b.glow(z === 0 ? 0x49ff8a : 0xff3a2a, 1.4), { collide: false });
  b.box([8.2, CO + 2.4, -9.5], [13.8, CO + 2.8, -8.1], b.glow(0xffc27a, 0.6), { collide: false }); // kiosk sign
  b.prop('Television_01', 11, CO + 1.2, -8.4, 0, { collide: false, scale: 0.6 });
  for (const [x, z] of [[10, 0], [26, -5], [30, 6]] as const) d.ceilingProp('mounted_fluorescent_lights', x, ST - 1, z, Math.PI / 2);
  // Street hall
  d.debris([14.5, -9.5, 38, -3.9], ST, 40, { paper: 0.8 });
  d.scatter([14.5, -9.5, 38, -3.9], ST, 5, [['cardboard_box_01', 1], ['trashbag', 1], ['WetFloorSign_01', 1]], { clear: [[38 - 9, -9.6, 38, -7.2]] });
  // Vent shaft: ducts and cable up the walls
  d.pipe([-49.2, PL, -2.8], [-49.2, ST + 2.6, -2.8], 0.18, 0x56605c);
  d.pipe([-49.2, PL, 2.8], [-49.2, ST + 2.6, 2.8], 0.1, 0x1c1e20);
  d.debris([-49.4, -3.1, -36.6, 3.1], PL, 30, { paper: 0.3 });
}
