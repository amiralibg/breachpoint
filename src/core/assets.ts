import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';

const BASE = `${import.meta.env.BASE_URL}assets/`;

const manager = new THREE.LoadingManager();
const gltfLoader = new GLTFLoader(manager);
const texLoader = new THREE.TextureLoader(manager);
const hdrLoader = new HDRLoader(manager);

const gltfCache = new Map<string, Promise<GLTF>>();
const texCache = new Map<string, Promise<THREE.Texture>>();

export type ProgressFn = (loaded: number, total: number) => void;

export function onProgress(fn: ProgressFn): void {
  manager.onProgress = (_url, loaded, total) => fn(loaded, total);
}

export function loadModel(id: string): Promise<GLTF> {
  const url = `${BASE}models/${id}/${id}.gltf`;
  let p = gltfCache.get(url);
  if (!p) {
    p = gltfLoader.loadAsync(url);
    gltfCache.set(url, p);
  }
  return p;
}

export function loadGlb(path: string): Promise<GLTF> {
  const url = `${BASE}${path}`;
  let p = gltfCache.get(url);
  if (!p) {
    p = gltfLoader.loadAsync(url);
    gltfCache.set(url, p);
  }
  return p;
}

function loadTexture(url: string, srgb: boolean, anisotropy: number): Promise<THREE.Texture> {
  const key = `${url}|${anisotropy}`;
  let p = texCache.get(key);
  if (!p) {
    p = texLoader.loadAsync(url).then((t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = anisotropy;
      return t;
    });
    texCache.set(key, p);
  }
  return p;
}

export interface PbrSet {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  arm: THREE.Texture; // R = AO, G = roughness, B = metalness
}

export async function loadPbr(id: string, res: '1k' | '2k', anisotropy: number): Promise<PbrSet> {
  const dir = `${BASE}textures/${id}/`;
  const [map, normalMap, arm] = await Promise.all([
    loadTexture(`${dir}diff_${res}.jpg`, true, anisotropy),
    loadTexture(`${dir}nor_${res}.jpg`, false, anisotropy),
    loadTexture(`${dir}arm_${res}.jpg`, false, anisotropy),
  ]);
  return { map, normalMap, arm };
}

export function pbrMaterial(set: PbrSet, opts: { metalness?: number; normalScale?: number } = {}): THREE.MeshStandardMaterial {
  const ns = opts.normalScale ?? 1;
  return new THREE.MeshStandardMaterial({
    map: set.map,
    normalMap: set.normalMap,
    normalScale: new THREE.Vector2(ns, ns),
    aoMap: set.arm,
    roughnessMap: set.arm,
    metalnessMap: set.arm,
    roughness: 1,
    metalness: opts.metalness ?? 1,
  });
}

export function loadHdri(id: string, res: '1k' | '2k'): Promise<THREE.DataTexture> {
  return hdrLoader.loadAsync(`${BASE}hdri/${id}_${res}.hdr`).then((t) => {
    t.mapping = THREE.EquirectangularReflectionMapping;
    return t;
  });
}
