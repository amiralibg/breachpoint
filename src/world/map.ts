import * as THREE from 'three';
import { loadHdri, loadModel, loadPbr, pbrMaterial } from '../core/assets';
import type { QualityPreset } from '../core/settings';

export interface WorldMap {
  root: THREE.Group;
  colliders: THREE.Box3[];
  bounds: THREE.Box3;
  playerSpawns: THREE.Vector3[];
  enemySpawns: THREE.Vector3[];
  sun: THREE.DirectionalLight;
  envMap: THREE.Texture;
  dispose(): void;
}

const HALF = 40; // the playable area is 80 x 80 m
const ROAD_HALF_W = 4.5;

/** Ground material under a point (for footsteps): the asphalt road and anything raised are hard. */
export function surfaceAt(p: { x: number; y: number; z: number }): 'dirt' | 'hard' {
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

export async function buildMap(scene: THREE.Scene, q: QualityPreset): Promise<WorldMap> {
  const root = new THREE.Group();
  root.name = 'map';
  const colliders: THREE.Box3[] = [];

  const [sand, asphalt, sandstone, concrete, iron, hdri] = await Promise.all([
    loadPbr('coast_sand_rocks_02', q.textureRes, q.anisotropy),
    loadPbr('asphalt_02', q.textureRes, q.anisotropy),
    loadPbr('sandstone_brick_wall_01', q.textureRes, q.anisotropy),
    loadPbr('concrete_wall_008', q.textureRes, q.anisotropy),
    loadPbr('corrugated_iron', q.textureRes, q.anisotropy),
    loadHdri('kloofendal_48d_partly_cloudy_puresky', q.hdriRes),
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

  // --- Sky & lighting -------------------------------------------------------
  scene.background = hdri;
  scene.environment = hdri;
  scene.environmentIntensity = 0.45;
  scene.backgroundIntensity = 1;
  scene.fog = new THREE.Fog(0xc9d3dc, 70, q.fogFar);

  const sun = new THREE.DirectionalLight(0xfff1dc, 4.5);
  sun.position.set(-38, 60, 26);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = q.shadows;
  sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
  const sc = sun.shadow.camera;
  sc.left = -HALF - 6;
  sc.right = HALF + 6;
  sc.top = HALF + 6;
  sc.bottom = -HALF - 6;
  sc.near = 1;
  sc.far = 160;
  sc.updateProjectionMatrix();
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = q.softShadows ? 2.5 : 1;
  root.add(sun, sun.target);
  root.add(new THREE.HemisphereLight(0xbfd4ff, 0x8a7458, 0.15));

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
    root,
    colliders,
    bounds,
    sun,
    envMap: hdri,
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
    },
  };
}
