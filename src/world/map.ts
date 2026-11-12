import * as THREE from 'three';
import { FOG_COLOR, installSunFog, makeSky } from './sky';
import { loadModel, loadPbr, pbrMaterial } from '../core/assets';
import type { Audio } from '../core/audio';
import type { QualityPreset } from '../core/settings';
import type { BuiltLevel, Rect, Surface, V3, Water } from './level';

export type WorldId = 'compound' | 'spillway' | 'saltmarket' | 'glasshouse' | 'line9' | 'signalhill' | 'wall';

export interface WorldMap {
  id: WorldId;
  root: THREE.Group;
  colliders: THREE.Box3[];
  bounds: THREE.Box3;
  playerSpawns: THREE.Vector3[];
  enemySpawns: THREE.Vector3[];
  /** Way the player faces on arrival (radians, 0 = toward -z). */
  spawnYaw: number;
  sun: THREE.DirectionalLight;
  /** Unit vector toward the sun. */
  sunDir: THREE.Vector3;
  sunColor: THREE.Color;
  envMap: THREE.Texture;
  /** Light and weather facts the game needs: weapon lighting, bot perception, flashlight. */
  env: { viewLight: number; shafts: number; sight: number; hearing: number; flashlight: boolean };
  /** Rectangles of walkable ground at y = 0 (default: everywhere inside the bounds). */
  navGround?: Rect[];
  /** Menu camera: orbits this point. */
  menuCam: { center: THREE.Vector3; radius: number; height: number };
  waters: Water[];
  /** Lightning brightness right now, 0..1. */
  readonly flash: number;
  surface(p: { x: number; y: number; z: number }): Surface;
  /** Open or close a named door/shutter. True if it changed (navigation must be rebuilt). */
  setDoor(id: string, open: boolean): boolean;
  setPower(on: boolean): void;
  setDaylight(f: number): void;
  /** Per-frame: sky, lamps, weather. */
  update(dt: number, viewer: THREE.Vector3, audio?: Audio): void;
  dispose(): void;
}

let activeSurface: WorldMap['surface'] | null = null;

/** The map whose ground `surfaceAt` describes. */
export function setActiveMap(map: WorldMap): void {
  activeSurface = map.surface;
}

/** Wrap a level built with the kit as a WorldMap. */
export function worldFromLevel(id: WorldId, level: BuiltLevel, extra: {
  bounds: THREE.Box3; spawn: V3; spawnYaw?: number; enemySpawns?: V3[]; navGround?: Rect[];
  menuCam?: { center: V3; radius: number; height: number }; surface?: WorldMap['surface'];
}): WorldMap {
  const c = extra.bounds.getCenter(new THREE.Vector3());
  return {
    id,
    root: level.root, colliders: level.colliders, bounds: extra.bounds,
    playerSpawns: [new THREE.Vector3(...extra.spawn)],
    enemySpawns: (extra.enemySpawns ?? []).map((p) => new THREE.Vector3(...p)),
    spawnYaw: extra.spawnYaw ?? 0,
    sun: level.sun, sunDir: level.sunDir, sunColor: level.sunColor, envMap: level.envMap,
    env: level.env,
    navGround: extra.navGround,
    menuCam: extra.menuCam
      ? { center: new THREE.Vector3(...extra.menuCam.center), radius: extra.menuCam.radius, height: extra.menuCam.height }
      : { center: c, radius: 30, height: c.y + 16 },
    waters: level.waters,
    get flash() {
      return level.flash;
    },
    surface: extra.surface ?? (() => 'hard'),
    setDoor: (id2, open) => level.setDoor(id2, open),
    setPower: (on) => level.setPower(on),
    setDaylight: (f) => level.setDaylight(f),
    update: (dt, viewer, audio) => level.update(dt, viewer, audio),
    dispose: () => level.dispose(),
  };
}

const HALF = 40; // the playable area is 80 x 80 m
const ROAD_HALF_W = 4.5;

/** Ground material under a point (for footsteps): the asphalt road and anything raised are hard. */
export function surfaceAt(p: { x: number; y: number; z: number }): Surface {
  return activeSurface ? activeSurface(p) : 'hard';
}

function compoundSurface(p: { x: number; y: number; z: number }): Surface {
  if (p.y > 0.2) return 'hard';
  return Math.abs(p.x) < ROAD_HALF_W && Math.abs(p.z) < HALF ? 'hard' : 'dirt';
}
const TILE = 3; // meters per texture repeat on walls/ground

/** Box with UVs scaled to world size, so textures keep a constant texel density. */
function worldBox(w: number, h: number, d: number, tile = TILE): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z (4 verts each)
  const faceDims: [number, number][] = [
    [d, h], [d, h], [w, d], [w, d], [w, h], [w, h],
  ];
  for (let f = 0; f < 6; f++) {
    const [su, sv] = faceDims[f];
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, (uv.getX(i) * su) / tile, (uv.getY(i) * sv) / tile);
    }
  }
  uv.needsUpdate = true;
  return g;
}

function shadowed<T extends THREE.Object3D>(o: T): T {
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) {
      c.castShadow = true;
      c.receiveShadow = true;
    }
  });
  return o;
}

/**
 * Standing water on a ground material. Puddles sit where a slow noise over the world says the
 * ground dips: inside one the surface goes flat, dark and mirror-smooth and picks up the sky; a
 * damp margin around it is darker and a little glossier than the dry ground.
 */
function addPuddles(mat: THREE.MeshStandardMaterial, opts: { cover: number; scale: number }): void {
  const uniforms = { uPudCover: { value: opts.cover }, uPudScale: { value: opts.scale } };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vPudPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPudPos = (modelMatrix * vec4(transformed, 1.0)).xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', /* glsl */ `#include <common>
        uniform float uPudCover, uPudScale;
        varying vec2 vPudPos;
        float pudWater, pudDamp;
        float pudHash(vec2 p) {
          vec3 p3 = fract(vec3(p.xyx) * 0.1031);
          p3 += dot(p3, p3.yzx + 33.33);
          return fract((p3.x + p3.y) * p3.z);
        }
        float pudNoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(pudHash(i), pudHash(i + vec2(1.0, 0.0)), f.x), mix(pudHash(i + vec2(0.0, 1.0)), pudHash(i + vec2(1.0, 1.0)), f.x), f.y);
        }`)
      .replace('#include <map_fragment>', /* glsl */ `#include <map_fragment>
        {
          vec2 q = vPudPos * uPudScale;
          float n = pudNoise(q) * 0.55 + pudNoise(q * 2.3 + 11.0) * 0.3 + pudNoise(q * 6.1 + 3.0) * 0.15;
          // The rough bits of the surface stand proud of the water: its own texture breaks the shoreline
          float lum = dot(diffuseColor.rgb, vec3(0.333));
          float level = n - (lum - 0.25) * 0.25;
          float edge = 1.0 - uPudCover;
          pudWater = smoothstep(edge, edge + 0.035, level);
          pudDamp = smoothstep(edge - 0.16, edge, level);
          diffuseColor.rgb *= mix(1.0, 0.62, pudDamp) * mix(1.0, 0.7, pudWater);
        }`)
      .replace('#include <roughnessmap_fragment>', /* glsl */ `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.6, pudDamp);
        roughnessFactor = mix(roughnessFactor, 0.045, pudWater);`)
      .replace('#include <normal_fragment_maps>', /* glsl */ `#include <normal_fragment_maps>
        normal = normalize(mix(normal, nonPerturbedNormal, pudWater * 0.97));`);
  };
  mat.customProgramCacheKey = () => 'puddles-1';
}

/** Late-afternoon haze: thin up close, closes the far end of the compound. */
export function makeFog(): THREE.FogExp2 {
  return new THREE.FogExp2(FOG_COLOR, 0.0085);
}

/** Low sun, about 15 degrees up, ahead and to the left of the player's spawn. */
const SUN_DIR = new THREE.Vector3(-0.56, 0.27, -0.8).normalize();
const SUN_COLOR = new THREE.Color(1.0, 0.68, 0.4);

export async function buildMap(scene: THREE.Scene, q: QualityPreset, gl: THREE.WebGLRenderer): Promise<WorldMap> {
  const root = new THREE.Group();
  root.name = 'map';
  const colliders: THREE.Box3[] = [];

  const [sand, asphalt, sandstone, concrete, iron] = await Promise.all([
    loadPbr('coast_sand_rocks_02', q.textureRes, q.anisotropy),
    loadPbr('asphalt_02', q.textureRes, q.anisotropy),
    loadPbr('sandstone_brick_wall_01', q.textureRes, q.anisotropy),
    loadPbr('concrete_wall_008', q.textureRes, q.anisotropy),
    loadPbr('corrugated_iron', q.textureRes, q.anisotropy),
  ]);

  const mats = {
    sand: pbrMaterial(sand, { metalness: 0 }),
    asphalt: pbrMaterial(asphalt, { metalness: 0 }),
    sandstone: pbrMaterial(sandstone, { metalness: 0 }),
    concrete: pbrMaterial(concrete, { metalness: 0 }),
    iron: pbrMaterial(iron),
  };
  mats.asphalt.polygonOffset = true;
  mats.asphalt.polygonOffsetFactor = -2;
  // Hosed-down road: the low sun streaks along it
  mats.asphalt.roughness = 0.62;
  // Water lies in the road's dips and, more sparsely, in the hard-packed yard
  addPuddles(mats.asphalt, { cover: 0.42, scale: 0.42 });
  addPuddles(mats.sand, { cover: 0.3, scale: 0.16 });

  // --- Sky & lighting -------------------------------------------------------
  installSunFog(SUN_DIR, new THREE.Color(1.0, 0.6, 0.32));
  const sky = makeSky(SUN_DIR);
  root.add(sky);
  // Reflections come from the same sky, without the sun disc (the sun light supplies that highlight)
  const envSky = makeSky(SUN_DIR, false);
  const envScene = new THREE.Scene();
  envScene.add(envSky);
  const pmrem = new THREE.PMREMGenerator(gl);
  const envTarget = pmrem.fromScene(envScene, 0, 0.1, 1000);
  pmrem.dispose();
  envSky.material.dispose();
  envSky.geometry.dispose();
  const envMap = envTarget.texture;

  scene.background = null;
  scene.environment = envMap;
  scene.environmentIntensity = 1;
  scene.fog = makeFog();

  const sun = new THREE.DirectionalLight(SUN_COLOR, 6.5);
  sun.position.copy(SUN_DIR).multiplyScalar(110);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = q.shadows;
  sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
  const sc = sun.shadow.camera;
  // Seen from a low sun the compound is wide and shallow
  sc.left = -HALF * 1.5;
  sc.right = HALF * 1.5;
  sc.top = 26;
  sc.bottom = -16;
  sc.near = 1;
  sc.far = 230;
  sc.updateProjectionMatrix();
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.05;
  sun.shadow.radius = q.softShadows ? 2.5 : 1;
  root.add(sun, sun.target);
  // Skylight from the cool side of the sky, warm bounce off the yard
  root.add(new THREE.HemisphereLight(0x8fa6cf, 0x5a4636, 0.55));

  // --- Ground ---------------------------------------------------------------
  const groundSize = 220;
  const groundGeo = new THREE.PlaneGeometry(groundSize, groundSize);
  groundGeo.attributes.uv.array.forEach((_, i, arr) => ((arr as Float32Array)[i] *= groundSize / 4));
  const ground = new THREE.Mesh(groundGeo, mats.sand);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  root.add(ground);

  const roadGeo = new THREE.PlaneGeometry(ROAD_HALF_W * 2, HALF * 2);
  roadGeo.attributes.uv.array.forEach((_, i, arr) => {
    (arr as Float32Array)[i] *= i % 2 === 0 ? 9 / 4 : (HALF * 2) / 4;
  });
  const road = new THREE.Mesh(roadGeo, mats.asphalt);
  road.rotation.x = -Math.PI / 2;
  road.position.y = 0.01;
  road.receiveShadow = true;
  root.add(road);

  // --- Solid geometry -------------------------------------------------------
  const block = (
    x: number, z: number, w: number, h: number, d: number,
    mat: THREE.Material, y = 0, collide = true,
  ): THREE.Mesh => {
    const m = new THREE.Mesh(worldBox(w, h, d), mat);
    m.position.set(x, y + h / 2, z);
    shadowed(m);
    root.add(m);
    if (collide) colliders.push(new THREE.Box3().setFromObject(m));
    return m;
  };

  const building = (x: number, z: number, w: number, h: number, d: number): void => {
    block(x, z, w, h, d, mats.sandstone);
    // Corrugated roof overhang plus a parapet lip.
    block(x, z, w + 0.8, 0.12, d + 0.8, mats.iron, h, false);
    block(x, z, w + 0.2, 0.5, 0.25, mats.sandstone, h, false);
  };

  // Perimeter wall
  const WALL_H = 5;
  block(0, -HALF, HALF * 2 + 1, WALL_H, 1, mats.sandstone);
  block(0, HALF, HALF * 2 + 1, WALL_H, 1, mats.sandstone);
  block(-HALF, 0, 1, WALL_H, HALF * 2 + 1, mats.sandstone);
  block(HALF, 0, 1, WALL_H, HALF * 2 + 1, mats.sandstone);

  // Buildings (corners of the compound)
  building(-24, -24, 14, 7, 12);
  building(24, -22, 12, 8, 16);
  building(-25, 22, 12, 6, 10);
  building(25, 24, 10, 6, 12);
  building(-30, 0, 8, 5, 8);
  building(30, 2, 8, 9, 6);

  // Mid-field concrete divider walls
  block(-11, -2, 1, 3.2, 12, mats.concrete);
  block(11, 3, 1, 3.2, 12, mats.concrete);
  block(-3, -16, 10, 3.2, 1, mats.concrete);
  block(6, 15, 9, 3.2, 1, mats.concrete);
  block(-18, 10, 8, 3.2, 1, mats.concrete);
  block(18, -9, 8, 3.2, 1, mats.concrete);

  // Low cover walls (crouch height)
  block(-6, 6, 4, 1.1, 0.6, mats.concrete);
  block(16, 9, 0.6, 1.1, 4, mats.concrete);
  block(-16, -10, 0.6, 1.1, 4, mats.concrete);
  block(0, 26, 5, 1.1, 0.6, mats.concrete);
  block(-2, -28, 5, 1.1, 0.6, mats.concrete);

  // --- Props (Poly Haven, CC0) ---------------------------------------------
  const propIds = [
    'wooden_crate_01', 'wooden_crate_02', 'old_military_crate', 'wooden_military_crate',
    'Barrel_01', 'barrel_03', 'concrete_road_barrier', 'concrete_road_barrier_02',
    'utility_box_01', 'plastic_crate_01', 'ammo_box', 'covered_car',
  ] as const;
  type PropId = (typeof propIds)[number];
  const gltfs = await Promise.all(propIds.map((id) => loadModel(id)));
  const protos = new Map<PropId, THREE.Object3D>();
  propIds.forEach((id, i) => protos.set(id, gltfs[i].scene));

  const prop = (
    id: PropId, x: number, z: number, rotY = 0,
    opts: { scale?: number; y?: number; collide?: boolean } = {},
  ): THREE.Object3D => {
    const o = shadowed(protos.get(id)!.clone(true));
    const s = opts.scale ?? 1;
    o.scale.setScalar(s);
    o.position.set(x, opts.y ?? 0, z);
    o.rotation.y = rotY;
    root.add(o);
    o.updateMatrixWorld(true);
    if (opts.collide !== false) colliders.push(new THREE.Box3().setFromObject(o));
    return o;
  };

  // Crate stacks used as cover (scaled up a little to make useful cover)
  const crateStack = (x: number, z: number, rot: number, layers: number): void => {
    for (let i = 0; i < layers; i++) {
      prop('wooden_military_crate', x, z, rot + (i % 2) * 0.08, { scale: 1.35, y: i * 0.465 * 1.35 });
    }
  };
  crateStack(-4, -6, 0, 3);
  crateStack(6, -10, Math.PI / 2, 2);
  crateStack(-20, 4, 0.2, 2);
  crateStack(20, -2, -0.15, 3);
  crateStack(-8, 20, Math.PI / 2, 2);
  crateStack(14, 28, 0, 2);
  crateStack(-14, -30, 0.1, 3);
  crateStack(30, -10, 0, 2);

  prop('old_military_crate', 8, -1, 0.4, { scale: 1.2 });
  prop('old_military_crate', -26, 12, -0.3, { scale: 1.2 });
  prop('wooden_crate_02', -6, 30, 0.6, { scale: 1.6 });
  prop('wooden_crate_02', 18, 20, -0.2, { scale: 1.6 });
  prop('wooden_crate_01', 18.3, 20.2, 0.4, { scale: 1.6, y: 0.454 * 1.6 });
  prop('wooden_crate_01', -9, -22, 1.2, { scale: 1.6 });

  // Barrels in clusters
  const barrels: [number, number][] = [
    [-15, -5], [-14.3, -5.5], [-14.8, -4.3], [9, 20], [9.6, 20.6],
    [27, -6], [27.7, -6.2], [-33, -12], [-32.4, -12.5], [35, 30], [-35, 34],
  ];
  barrels.forEach(([x, z], i) => prop(i % 2 ? 'Barrel_01' : 'barrel_03', x, z, i * 1.3));

  // Road barriers along the road and at the gate
  for (let i = -3; i <= 3; i++) {
    if (i === 0) continue;
    prop(i % 2 ? 'concrete_road_barrier' : 'concrete_road_barrier_02', i < 0 ? -5.2 : 5.2, i * 9, Math.PI / 2);
  }
  prop('concrete_road_barrier', -1.5, -34, 0);
  prop('concrete_road_barrier_02', 1.6, -34, 0);
  prop('concrete_road_barrier', 0, 34, 0);

  prop('covered_car', 1.8, -6, 0.12);
  prop('covered_car', -1.5, 16, Math.PI + 0.2);

  prop('utility_box_01', -39.2, 8, Math.PI / 2);
  prop('utility_box_01', 39.2, -14, -Math.PI / 2);
  prop('utility_box_01', 17, -30.1, 0);

  // Small clutter (no collision)
  prop('ammo_box', -4.4, -5.4, 0.5, { y: 3 * 0.465 * 1.35, collide: false });
  prop('plastic_crate_01', 8.6, -0.2, 0.2, { scale: 1.3, collide: false, y: 0.301 * 1.2 });
  prop('plastic_crate_01', -25.6, 12.3, 1.0, { scale: 1.3 });
  prop('ammo_box', 20.4, -2.8, 2.1, { y: 3 * 0.465 * 1.35, collide: false });

  scene.add(root);

  const bounds = new THREE.Box3(new THREE.Vector3(-HALF, 0, -HALF), new THREE.Vector3(HALF, 20, HALF));

  return {
    id: 'compound',
    spawnYaw: 0,
    env: { viewLight: 1, shafts: 0.4, sight: 1, hearing: 1, flashlight: false },
    menuCam: { center: new THREE.Vector3(0, 1.5, 0), radius: 24, height: 13 },
    waters: [],
    flash: 0,
    surface: compoundSurface,
    setDoor: () => false,
    setPower: () => {},
    setDaylight: () => {},
    root,
    colliders,
    bounds,
    sun,
    sunDir: SUN_DIR.clone(),
    sunColor: SUN_COLOR.clone(),
    envMap,
    update(dt, viewer) {
      sky.material.uniforms.uTime.value += dt;
      sky.position.copy(viewer);
    },
    playerSpawns: [new THREE.Vector3(0, 0, 33), new THREE.Vector3(-8, 0, 32), new THREE.Vector3(8, 0, 33)],
    enemySpawns: [
      new THREE.Vector3(0, 0, -36), new THREE.Vector3(-14, 0, -36), new THREE.Vector3(12, 0, -36),
      new THREE.Vector3(-36, 0, -14), new THREE.Vector3(36, 0, -4), new THREE.Vector3(-36, 0, 10),
      new THREE.Vector3(36, 0, 12), new THREE.Vector3(-34, 0, -34), new THREE.Vector3(34, 0, -34),
      new THREE.Vector3(-14, 0, 36), new THREE.Vector3(18, 0, 36),
    ],
    dispose() {
      scene.remove(root);
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && m.geometry && !(m.geometry as THREE.BufferGeometry).userData.shared) m.geometry.dispose();
      });
      Object.values(mats).forEach((m) => m.dispose());
      sky.material.dispose();
      envTarget.dispose();
    },
  };
}
