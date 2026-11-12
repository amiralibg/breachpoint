import * as THREE from 'three';
import { MeshoptSimplifier } from 'meshoptimizer';
import { loadModel } from '../core/assets';
import BOUNDS from './props.json';

/**
 * Props (Poly Haven, CC0) for the level kit: sizes, loading, and how they are drawn.
 *
 * A map places props by id while it is built; their sizes come from `props.json` (written by
 * `scripts/prop-bounds.mjs`), so a map can scatter and stack them before any model is loaded.
 * When the map is finished only the props it actually used are fetched.
 *
 * Drawing, for speed:
 *  - every part gets three levels of detail made with meshoptimizer (the index buffer changes,
 *    the vertices are shared), picked per cell by distance;
 *  - instances are bucketed into cells of the map, one instanced mesh per part per cell, so a
 *    cell behind the camera is culled and a far one draws its coarse level;
 *  - small things vanish past a distance where they would be a pixel or two;
 *  - shadows come from one merged mesh of every prop at its coarsest level, which only the
 *    sun's shadow camera sees (layer 1). Alpha-tested foliage keeps its own shadow caster.
 */

export type PropId = keyof typeof BOUNDS;
export const PROP_IDS = Object.keys(BOUNDS) as PropId[];

/** Layer only the sun's shadow camera renders: shadow casters nobody sees directly. */
export const SHADOW_LAYER = 1;

/** Props whose files are not at real-world scale (or read wrong at it), corrected once at load. */
const PROP_SCALE: Partial<Record<PropId, number>> = {
  steel_frame_shelves_01: 1.9 / 21.41, // modelled in the wrong unit: 21 m tall
  office_notepads: 0.35,
  classic_laptop: 0.7,
  portable_searchlight: 2.6, // a hand lamp, scaled up to a site floodlight
};

/** World box of a prop standing on its base at the origin, at its corrected scale. */
export function propBaseBox(id: PropId): THREE.Box3 {
  const b = BOUNDS[id] as number[];
  if (!b) throw new Error(`unknown prop ${id}`);
  const k = PROP_SCALE[id] ?? 1;
  return new THREE.Box3(new THREE.Vector3(b[0] * k, 0, b[2] * k), new THREE.Vector3(b[3] * k, (b[4] - b[1]) * k, b[5] * k));
}

/** Matrix that stands the model on its base at its corrected scale. */
function baseFix(id: PropId): THREE.Matrix4 {
  const b = BOUNDS[id] as number[];
  const k = PROP_SCALE[id] ?? 1;
  return new THREE.Matrix4().makeScale(k, k, k).multiply(new THREE.Matrix4().makeTranslation(0, -b[1], 0));
}

interface Part {
  /** Full, medium and coarse versions; they share vertex buffers. */
  lods: THREE.BufferGeometry[];
  material: THREE.Material;
  local: THREE.Matrix4;
  alphaTest: boolean;
}

const partCache = new Map<PropId, Promise<Part[]>>();
const fixedMaterials = new WeakMap<THREE.Material, THREE.Material>();
const shrunk = new WeakSet<THREE.Texture>();

/** Glass that refracts makes three render the whole scene a second time each frame: use plain see-through glass. */
function cheapMaterial(m: THREE.Material): THREE.Material {
  const phys = m as THREE.MeshPhysicalMaterial;
  if (!phys.isMeshPhysicalMaterial || !(phys.transmission > 0)) return m;
  let f = fixedMaterials.get(m);
  if (!f) {
    const s = new THREE.MeshStandardMaterial({
      color: phys.color, roughness: Math.min(phys.roughness, 0.15), metalness: 0, transparent: true, opacity: 0.25,
      depthWrite: false, envMapIntensity: 1.5, name: phys.name,
    });
    fixedMaterials.set(m, (f = s));
  }
  return f;
}

/** Small props do not need 1k textures: shrink them before they reach the GPU. */
async function shrinkTextures(material: THREE.Material, size: number): Promise<void> {
  const m = material as THREE.MeshStandardMaterial;
  const maps = [m.map, m.normalMap, m.roughnessMap, m.metalnessMap, m.aoMap, m.emissiveMap, m.alphaMap];
  await Promise.all(maps.map(async (t) => {
    if (!t || shrunk.has(t)) return;
    shrunk.add(t);
    const img = t.image as ImageBitmap | HTMLImageElement | undefined;
    if (!img || !('width' in img) || img.width <= size) return;
    try {
      const bmp = await createImageBitmap(img, { resizeWidth: size, resizeHeight: Math.round((img.height / img.width) * size), resizeQuality: 'high' });
      t.image = bmp;
      t.needsUpdate = true;
    } catch {
      // keep the full image
    }
  }));
}

function triCount(g: THREE.BufferGeometry): number {
  return (g.index ? g.index.count : g.attributes.position.count) / 3;
}

/** The three levels of a part: full, about a quarter, about a twentieth (never under ~60 triangles). */
/** Triangle caps per level, per part. */
const LOD0_MAX = 12000;
const LOD1_MAX = 2500;
const LOD2_MAX = 500;

function makeLods(src: THREE.BufferGeometry): THREE.BufferGeometry[] {
  // One indexed geometry with only what the instanced draw needs
  let g = src.clone();
  g.morphAttributes = {};
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'uv1', 'color'].includes(k)) g.deleteAttribute(k);
  if (!g.index) {
    const n = g.attributes.position.count;
    const idx = new Uint32Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    g.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  const tris = triCount(g);
  g.userData.shared = true;
  if (tris < 600 || !MeshoptSimplifier.supported) return [g, g, g];
  const pa = g.attributes.position;
  const pos = new Float32Array(pa.count * 3);
  for (let i = 0; i < pa.count; i++) {
    pos[i * 3] = pa.getX(i);
    pos[i * 3 + 1] = pa.getY(i);
    pos[i * 3 + 2] = pa.getZ(i);
  }
  const idx = new Uint32Array(g.index!.array as ArrayLike<number>);
  // Each level has a share of the source and a hard cap: some scans are 50k triangles for a weed
  const level = (ratio: number, cap: number, error: number): THREE.BufferGeometry => {
    const target = Math.max(180, Math.floor(Math.min(tris * ratio, cap)) * 3);
    let [out] = MeshoptSimplifier.simplify(idx, pos, 3, target, error, ['LockBorder']);
    // Seams and many separate shells stop the careful simplifier early; finish the job sloppily
    if (out.length > target * 1.6) [out] = MeshoptSimplifier.simplifySloppy(idx, pos, 3, null, target, error * 2);
    if (out.length < 9 || out.length >= idx.length) return g;
    const l = new THREE.BufferGeometry();
    for (const k of Object.keys(g.attributes)) l.setAttribute(k, g.attributes[k]);
    l.setIndex(new THREE.BufferAttribute(out, 1));
    l.boundingBox = g.boundingBox;
    l.boundingSphere = g.boundingSphere;
    return l;
  };
  g.computeBoundingBox();
  g.computeBoundingSphere();
  const full = tris > LOD0_MAX ? level(1, LOD0_MAX, 0.004) : g;
  const lods = [full, level(0.25, LOD1_MAX, 0.01), level(0.05, LOD2_MAX, 0.05)];
  for (const l of lods) l.userData.shared = true; // cached across maps
  return lods;
}

async function loadParts(id: PropId): Promise<Part[]> {
  let p = partCache.get(id);
  if (p) return p;
  p = (async () => {
    const [gltf] = await Promise.all([loadModel(id), MeshoptSimplifier.ready]);
    const root = gltf.scene;
    root.updateMatrixWorld(true);
    const fix = baseFix(id);
    const size = propBaseBox(id).getSize(new THREE.Vector3());
    const big = Math.max(size.x, size.y, size.z);
    const texSize = big < 0.6 ? 256 : big < 1.5 ? 512 : 0;
    const parts: Part[] = [];
    const jobs: Promise<void>[] = [];
    root.traverse((c) => {
      const m = c as THREE.Mesh;
      if (!m.isMesh) return;
      const material = cheapMaterial(Array.isArray(m.material) ? m.material[0] : m.material);
      if (texSize) jobs.push(shrinkTextures(material, texSize));
      const mat = material as THREE.MeshStandardMaterial;
      parts.push({
        lods: makeLods(m.geometry),
        material,
        local: m.matrixWorld.clone().premultiply(fix),
        alphaTest: mat.alphaTest > 0 || (!!mat.alphaMap && !mat.transparent),
      });
    });
    await Promise.all(jobs);
    return parts;
  })();
  partCache.set(id, p);
  return p;
}

/** Sizes of the cells instances are bucketed into, and the distances the levels switch at. */
const CELL = 20;
const LOD1_AT = 14;
const LOD2_AT = 38;

interface Cell {
  meshes: THREE.InstancedMesh[];
  lods: THREE.BufferGeometry[][];
  center: THREE.Vector3;
  radius: number;
  /** Past this distance the cell is not drawn at all (small props). */
  cull: number;
  level: number;
}

/** Free the GPU copies of a material's textures (three uploads them again if they are used later). */
export function releaseTextures(m: THREE.Material): void {
  const s = m as THREE.MeshStandardMaterial;
  for (const t of [s.map, s.normalMap, s.roughnessMap, s.metalnessMap, s.aoMap, s.emissiveMap, s.alphaMap]) t?.dispose();
}

export interface PropSet {
  root: THREE.Group;
  /** Choose levels of detail for where the camera is. */
  update(viewer: THREE.Vector3): void;
  dispose(): void;
}

/** Build the instanced meshes for every placed prop. `placed` maps prop id to world matrices. */
export async function buildProps(placed: Map<PropId, THREE.Matrix4[]>, shadows: boolean): Promise<PropSet> {
  const ids = [...placed.keys()];
  const loaded = await Promise.all(ids.map(loadParts));
  const root = new THREE.Group();
  root.name = 'props';
  const cells: Cell[] = [];
  const owned: THREE.BufferGeometry[] = [];
  const shadowGeos: THREE.BufferGeometry[] = [];
  const m = new THREE.Matrix4();
  const v = new THREE.Vector3();

  ids.forEach((id, k) => {
    const parts = loaded[k];
    const mats = placed.get(id)!;
    const box = propBaseBox(id);
    const size = box.getSize(new THREE.Vector3());
    const big = Math.max(size.x, size.y, size.z);
    // A 0.3 m can is gone at 45 m; a car is never culled
    const cull = big < 0.25 ? 30 : big < 0.6 ? 55 : big < 1.2 ? 110 : Infinity;
    const buckets = new Map<string, THREE.Matrix4[]>();
    for (const w of mats) {
      v.setFromMatrixPosition(w);
      const key = `${Math.floor(v.x / CELL)},${Math.floor(v.y / 8)},${Math.floor(v.z / CELL)}`;
      let list = buckets.get(key);
      if (!list) buckets.set(key, (list = []));
      list.push(w);
    }
    for (const list of buckets.values()) {
      const cell: Cell = { meshes: [], lods: [], center: new THREE.Vector3(), radius: 0, cull, level: -1 };
      for (const part of parts) {
        const inst = new THREE.InstancedMesh(part.lods[0], part.material, list.length);
        list.forEach((w, i) => inst.setMatrixAt(i, m.multiplyMatrices(w, part.local)));
        inst.instanceMatrix.needsUpdate = true;
        inst.computeBoundingSphere();
        inst.castShadow = false;
        inst.receiveShadow = true;
        inst.userData.sharedMaterial = true;
        inst.matrixAutoUpdate = false;
        root.add(inst);
        cell.meshes.push(inst);
        cell.lods.push(part.lods);
      }
      // Cell bounds: union of the parts' spheres
      const s = new THREE.Box3();
      for (const inst of cell.meshes) if (inst.boundingSphere) s.union(new THREE.Box3().setFromCenterAndSize(inst.boundingSphere.center, new THREE.Vector3().setScalar(inst.boundingSphere.radius * 2)));
      s.getCenter(cell.center);
      cell.radius = s.getSize(v).length() / 2;
      cells.push(cell);
    }
    if (!shadows || big < 0.2) return;
    // Leaves and mesh: their shadow needs the alpha, so they keep their own caster (one for the whole map)
    for (const part of parts) {
      if (!part.alphaTest) continue;
      const sh = new THREE.InstancedMesh(part.lods[2], part.material, mats.length);
      mats.forEach((w, i) => sh.setMatrixAt(i, m.multiplyMatrices(w, part.local)));
      sh.castShadow = true;
      sh.layers.set(SHADOW_LAYER);
      sh.userData.sharedMaterial = true;
      sh.matrixAutoUpdate = false;
      sh.computeBoundingSphere();
      root.add(sh);
    }
    // Shadow proxy: coarse level, baked into world space
    for (const part of parts) {
      if (part.alphaTest || part.material.transparent) continue;
      const lod = part.lods[2];
      for (const w of mats) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', lod.attributes.position);
        g.setIndex(lod.index);
        const t = g.toNonIndexed();
        t.applyMatrix4(m.multiplyMatrices(w, part.local));
        shadowGeos.push(t);
      }
    }
  });

  if (shadowGeos.length) {
    const n = shadowGeos.reduce((s, g) => s + g.attributes.position.count, 0);
    const pos = new Float32Array(n * 3);
    let o = 0;
    for (const g of shadowGeos) {
      pos.set(g.attributes.position.array as Float32Array, o);
      o += g.attributes.position.count * 3;
      g.dispose();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.computeBoundingSphere();
    owned.push(g);
    const mat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide });
    const proxy = new THREE.Mesh(g, mat);
    proxy.name = 'prop-shadows';
    proxy.castShadow = true;
    proxy.layers.set(SHADOW_LAYER);
    proxy.matrixAutoUpdate = false;
    root.add(proxy);
  }

  return {
    root,
    update(viewer) {
      for (const c of cells) {
        const d = Math.max(0, viewer.distanceTo(c.center) - c.radius);
        const level = d > c.cull ? 3 : d > LOD2_AT ? 2 : d > LOD1_AT ? 1 : 0;
        if (level === c.level) continue;
        c.level = level;
        c.meshes.forEach((inst, i) => {
          inst.visible = level < 3;
          if (level < 3) inst.geometry = c.lods[i][level];
        });
      }
    },
    dispose() {
      for (const g of owned) g.dispose();
      // Models stay cached (CPU side) for the next map; their textures leave the GPU
      for (const parts of loaded) for (const p of parts) releaseTextures(p.material);
    },
  };
}
