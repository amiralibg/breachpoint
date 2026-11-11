import * as THREE from 'three';

/**
 * Surface finish for what the player holds: the things the eye rests on all game.
 *
 * Guns: an edge map is derived from each model's own normal map (where the surface turns outward
 * is a corner that gets handled and knocked; where it turns inward is a recess that collects
 * shadow), and the shader wears the finish through to bright metal on the corners, darkens the
 * recesses and breaks up the roughness so a highlight never slides across as one clean band.
 *
 * Arms: the arms model is painted near-black, which swallows its own stitching. The shader lifts
 * it into separate materials (gloves, sleeve, knit cuff), adds a woven surface from coordinates
 * measured along and around the arm, and gives the cloth a soft rim.
 *
 * Nothing here is authored per model: any gun with a normal map and any Mixamo-named arms work.
 */

// ---------------------------------------------------------------------------------------------
// Guns

export interface GunFinish {
  /** How far the corners are worn through to metal, 0..1. */
  wear: number;
  /** Colour of the exposed metal. */
  bare: THREE.ColorRepresentation;
  /** Darkening of recesses, 0..1. */
  cavity: number;
  /** Roughness break-up, 0..1. */
  grain: number;
  /** Multiplies the painted finish (lets a flat grey read as blued steel or dark polymer). */
  tint: THREE.ColorRepresentation;
}

export const DEFAULT_GUN_FINISH: GunFinish = { wear: 0.6, bare: 0x70757b, cavity: 0.55, grain: 0.5, tint: 0xffffff };

const edgeCache = new Map<string, THREE.Texture>();

/**
 * R = outward corners, G = recesses, from the divergence of a tangent-space normal map taken at
 * a few widths: narrow picks out machined edges, wide catches the roll of a larger bevel.
 */
function edgeMap(normalMap: THREE.Texture): THREE.Texture | null {
  const hit = edgeCache.get(normalMap.source.uuid);
  if (hit) return hit;
  const img = normalMap.image as CanvasImageSource & { width: number; height: number } | undefined;
  if (!img || !img.width || typeof document === 'undefined') return null;
  const size = Math.min(1024, img.width);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  let src: ImageData;
  try {
    ctx.drawImage(img, 0, 0, size, size);
    src = ctx.getImageData(0, 0, size, size);
  } catch {
    return null;
  }
  const px = src.data;
  const n = size * size;
  const nx = new Float32Array(n);
  const ny = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    nx[i] = px[i * 4] / 127.5 - 1;
    ny[i] = px[i * 4 + 1] / 127.5 - 1;
  }
  // Image rows run down while the map's green channel points up (glTF convention)
  const div = new Float32Array(n);
  const at = (x: number, y: number): number => ((y + size) % size) * size + ((x + size) % size);
  for (const [d, w] of [[1, 1], [2, 0.8], [4, 0.6]] as const) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        div[y * size + x] += w * ((nx[at(x + d, y)] - nx[at(x - d, y)]) - (ny[at(x, y - d)] - ny[at(x, y + d)])) / d;
      }
    }
  }
  // A small blur: JPEG blocks in the normal map would otherwise show up as speckle
  const tmp = new Float32Array(n);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) tmp[y * size + x] = (div[at(x - 1, y)] + 2 * div[at(x, y)] + div[at(x + 1, y)]) / 4;
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = (tmp[at(x, y - 1)] + 2 * tmp[at(x, y)] + tmp[at(x, y + 1)]) / 4;
      const i = (y * size + x) * 4;
      px[i] = Math.max(0, Math.min(255, v * EDGE_SIGN * 420));
      px[i + 1] = Math.max(0, Math.min(255, -v * EDGE_SIGN * 420));
      px[i + 2] = 0;
      px[i + 3] = 255;
    }
  }
  ctx.putImageData(src, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.flipY = normalMap.flipY;
  tex.wrapS = normalMap.wrapS;
  tex.wrapT = normalMap.wrapT;
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  edgeCache.set(normalMap.source.uuid, tex);
  return tex;
}

/** +1: a normal leaning away from the face centre is an outward corner. */
const EDGE_SIGN = 1;

const NOISE_GLSL = /* glsl */ `
  float fHash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float fNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(fHash(i), fHash(i + vec2(1.0, 0.0)), f.x), mix(fHash(i + vec2(0.0, 1.0)), fHash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fFbm(vec2 p) {
    return fNoise(p) * 0.5 + fNoise(p * 2.13 + 7.1) * 0.3 + fNoise(p * 4.71 + 3.3) * 0.2;
  }
`;

/** Wear, recess shading and roughness break-up on one gun material (in place). */
export function applyGunFinish(mat: THREE.Material, finish: Partial<GunFinish> = {}): void {
  const m = mat as THREE.MeshStandardMaterial;
  if (!m.isMeshStandardMaterial || !m.normalMap || !m.map || m.userData.finish) return;
  const edges = edgeMap(m.normalMap);
  if (!edges) return;
  const f = { ...DEFAULT_GUN_FINISH, ...finish };
  const uniforms = {
    uEdges: { value: edges },
    uWear: { value: f.wear },
    uBare: { value: new THREE.Color(f.bare) },
    uCavity: { value: f.cavity },
    uGrain: { value: f.grain },
    uTint: { value: new THREE.Color(f.tint) },
  };
  m.userData.finish = uniforms;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', /* glsl */ `#include <common>
        uniform sampler2D uEdges;
        uniform float uWear, uCavity, uGrain;
        uniform vec3 uBare, uTint;
        float gWear, gCavity, gGrain;
        ${NOISE_GLSL}`)
      .replace('#include <map_fragment>', /* glsl */ `#include <map_fragment>
        {
          vec2 e = texture2D(uEdges, vMapUv).rg;
          // Wear is patchy: a broad pattern says which stretches of an edge got knocked, a fine one
          // gives the chipped outline. Scratches run off the corner onto the flat.
          float broad = fFbm(vMapUv * 34.0);
          float fine = fFbm(vMapUv * 210.0);
          float scratch = fNoise(vec2(vMapUv.x * 900.0 + vMapUv.y * 260.0, vMapUv.y * 22.0));
          float worn = smoothstep(0.44, 0.68, broad + (uWear - 0.5) * 0.4);
          float edge = smoothstep(0.3, 0.85, e.r);
          gWear = smoothstep(0.5, 0.78, edge * worn + (fine - 0.5) * 0.5 * edge + scratch * 0.1 * worn) * step(0.001, uWear);
          // Every corner is rubbed a little thin, worn through or not: it keeps the bevels readable
          float rub = edge * (0.12 + 0.3 * worn) * uWear;
          gCavity = e.g;
          gGrain = fine;
          vec3 base = diffuseColor.rgb * uTint;
          base *= 1.0 + rub * 0.9;
          base *= 1.0 - uCavity * smoothstep(0.08, 0.6, gCavity);
          // Large-scale unevenness: handling polishes some panels and leaves others matte
          base *= 0.9 + 0.2 * broad;
          diffuseColor.rgb = mix(base, uBare, gWear);
        }`)
      .replace('#include <roughnessmap_fragment>', /* glsl */ `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + (gGrain - 0.5) * 0.3 * uGrain, 0.08, 1.0);
        roughnessFactor = mix(roughnessFactor, 0.32 + 0.2 * gGrain, gWear);
        roughnessFactor = mix(roughnessFactor, 0.95, uCavity * smoothstep(0.1, 0.7, gCavity) * 0.6);`)
      .replace('#include <metalnessmap_fragment>', /* glsl */ `#include <metalnessmap_fragment>
        metalnessFactor = mix(metalnessFactor, 1.0, gWear);`);
  };
  m.customProgramCacheKey = () => 'gun-finish-1';
  m.needsUpdate = true;
}

// ---------------------------------------------------------------------------------------------
// Arms

export interface ArmFinish {
  glove: THREE.ColorRepresentation;
  sleeve: THREE.ColorRepresentation;
  cuff: THREE.ColorRepresentation;
  /** Length of the knit cuff at the end of the sleeve, metres. */
  cuffLength: number;
}

export const DEFAULT_ARM_FINISH: ArmFinish = { glove: 0x9a8156, sleeve: 0x38443c, cuff: 0x1d211e, cuffLength: 0.05 };

const _p = new THREE.Vector3();
const _m = new THREE.Matrix4();

/**
 * Per-vertex cloth coordinates for a skinned arms mesh, measured in the bind pose:
 *   x  metres along the arm from the end of the sleeve (negative up the sleeve)
 *   y  1 on the hand's own pieces of the model (gloves), 0 on the sleeve
 *   zw cos/sin of the angle around the arm, so a pattern can run around it without a seam
 */
function clothCoords(mesh: THREE.SkinnedMesh, forearmMetres: number): THREE.BufferAttribute | null {
  const geo = mesh.geometry;
  const pos = geo.getAttribute('position');
  const si = geo.getAttribute('skinIndex');
  const sw = geo.getAttribute('skinWeight');
  if (!pos || !si || !sw) return null;
  const bones = mesh.skeleton.bones;
  const bind = mesh.skeleton.boneInverses.map((inv) => new THREE.Vector3().setFromMatrixPosition(_m.copy(inv).invert()));
  const idx = (suffix: string): number => bones.findIndex((b) => b.name.replace(/^mixamorig:?/, '') === suffix);
  type Side = { arm: number; fore: number; hand: number; uDir: THREE.Vector3; fDir: THREE.Vector3; uLen: number; uRef: THREE.Vector3; fRef: THREE.Vector3 };
  const sides: Side[] = [];
  for (const s of ['Left', 'Right']) {
    const arm = idx(`${s}Arm`), fore = idx(`${s}ForeArm`), hand = idx(`${s}Hand`);
    if (arm < 0 || fore < 0 || hand < 0) return null;
    const uDir = bind[fore].clone().sub(bind[arm]);
    const uLen = uDir.length();
    uDir.normalize();
    const fDir = bind[hand].clone().sub(bind[fore]).normalize();
    const ref = (d: THREE.Vector3): THREE.Vector3 => {
      const up = Math.abs(d.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      return up.addScaledVector(d, -up.dot(d)).normalize();
    };
    sides.push({ arm, fore, hand, uDir, fDir, uLen, uRef: ref(uDir), fRef: ref(fDir) });
  }
  // 0 upper arm, 1 forearm, 2 hand; side from the name
  const kind = bones.map((b) => {
    const n = b.name.replace(/^mixamorig:?/, '');
    const side = n.startsWith('Left') ? 0 : n.startsWith('Right') ? 1 : -1;
    const part = /Hand/.test(n) ? 2 : /ForeArm/.test(n) ? 1 : 0;
    return { side, part };
  });

  const count = pos.count;
  const along = new Float32Array(count);
  const handW = new Float32Array(count);
  const sideOf = new Uint8Array(count);
  const out = new Float32Array(count * 4);
  const bindM = mesh.bindMatrix;
  // Bind-space units to metres, from the one length the caller knows for sure
  const scale = forearmMetres / (bind[sides[0].hand].distanceTo(bind[sides[0].fore]) || 1);
  const _c = new THREE.Vector3();
  for (let v = 0; v < count; v++) {
    const w = [0, 0, 0];
    const sw2 = [0, 0];
    for (let k = 0; k < 4; k++) {
      const b = kind[si.getComponent(v, k)];
      const wt = sw.getComponent(v, k);
      if (!b || wt <= 0) continue;
      w[b.part] += wt;
      if (b.side >= 0) sw2[b.side] += wt;
    }
    const sd = sw2[1] > sw2[0] ? 1 : 0;
    const S = sides[sd];
    _p.fromBufferAttribute(pos, v).applyMatrix4(bindM);
    const upper = w[0] > w[1] + w[2];
    const dir = upper ? S.uDir : S.fDir;
    const origin = upper ? bind[S.arm] : bind[S.fore];
    const rel = _p.sub(origin);
    const t = rel.dot(dir);
    along[v] = (upper ? t : S.uLen + t) * scale;
    handW[v] = w[2];
    sideOf[v] = sd;
    const radial = rel.addScaledVector(dir, -t);
    const refA = upper ? S.uRef : S.fRef;
    const x = radial.dot(refA);
    const y = radial.dot(_c.crossVectors(dir, refA));
    const r = Math.hypot(x, y) || 1;
    out[v * 4 + 2] = x / r;
    out[v * 4 + 3] = y / r;
  }

  // Which parts are glove: the model's UV islands (a glove is unwrapped apart from the sleeve even
  // when the mesh is one skin) whose vertices mostly follow the hand
  const parent = new Int32Array(count).map((_, i) => i);
  const find = (a: number): number => {
    while (parent[a] !== a) a = parent[a] = parent[parent[a]];
    return a;
  };
  const index = geo.getIndex();
  const tri = index ? index.count : count;
  for (let i = 0; i < tri; i += 3) {
    const a = index ? index.getX(i) : i, b = index ? index.getX(i + 1) : i + 1, c = index ? index.getX(i + 2) : i + 2;
    parent[find(a)] = find(b);
    parent[find(b)] = find(c);
  }
  const sum = new Map<number, [number, number]>();
  for (let v = 0; v < count; v++) {
    const r = find(v);
    const s = sum.get(r) ?? [0, 0];
    s[0] += handW[v];
    s[1]++;
    sum.set(r, s);
  }
  const pieces = sum.size;
  const sleeveEnd = [-Infinity, -Infinity];
  const glove = new Uint8Array(count);
  for (let v = 0; v < count; v++) {
    const s = sum.get(find(v))!;
    // One fused mesh has no separate glove piece: fall back to where the hand's bones take over
    glove[v] = pieces > 1 ? (s[0] / s[1] > 0.5 ? 1 : 0) : handW[v] > 0.5 ? 1 : 0;
    if (!glove[v]) sleeveEnd[sideOf[v]] = Math.max(sleeveEnd[sideOf[v]], along[v]);
  }
  for (let v = 0; v < count; v++) {
    const end = Number.isFinite(sleeveEnd[sideOf[v]]) ? sleeveEnd[sideOf[v]] : 0;
    out[v * 4] = along[v] - end;
    out[v * 4 + 1] = glove[v];
  }
  return new THREE.BufferAttribute(out, 4);
}

/** Gloves, sleeve and cuff on a first-person arms mesh (material is replaced in place). */
export function applyArmFinish(mesh: THREE.SkinnedMesh, forearmMetres: number, finish: Partial<ArmFinish> = {}): void {
  const m = mesh.material as THREE.MeshStandardMaterial;
  if (!mesh.isSkinnedMesh || !m.isMeshStandardMaterial || m.userData.finish) return;
  const coords = clothCoords(mesh, forearmMetres);
  if (!coords) return;
  // The geometry is shared with every clone of the model; the attribute is the same for all
  if (!mesh.geometry.getAttribute('aCloth')) mesh.geometry.setAttribute('aCloth', coords);
  const f = { ...DEFAULT_ARM_FINISH, ...finish };
  const uniforms = {
    uGlove: { value: new THREE.Color(f.glove) },
    uSleeve: { value: new THREE.Color(f.sleeve) },
    uCuff: { value: new THREE.Color(f.cuff) },
    uCuffLen: { value: f.cuffLength },
  };
  m.userData.finish = uniforms;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aCloth;\nvarying vec4 vCloth;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCloth = aCloth;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', /* glsl */ `#include <common>
        uniform vec3 uGlove, uSleeve, uCuff;
        uniform float uCuffLen;
        varying vec4 vCloth;
        float aHeight, aRough, aFuzz;
        ${NOISE_GLSL}
        // Bump from a height in metres (same construction as three's bump mapping)
        vec3 armBump(vec3 N, vec3 p, float h) {
          vec3 dpdx = dFdx(p), dpdy = dFdy(p);
          float hx = dFdx(h), hy = dFdy(h);
          vec3 r1 = cross(dpdy, N), r2 = cross(N, dpdx);
          float det = dot(dpdx, r1);
          vec3 g = sign(det) * (hx * r1 + hy * r2);
          return normalize(abs(det) * N - g);
        }
        // 1 where a pattern of this period is big enough on screen to draw, 0 where it would alias
        float aFade(vec2 q) {
          return 1.0 - smoothstep(0.35, 0.9, max(fwidth(q.x), fwidth(q.y)));
        }`)
      .replace('#include <map_fragment>', /* glsl */ `#include <map_fragment>
        {
          vec3 src = diffuseColor.rgb;
          float lum = dot(src, vec3(0.2126, 0.7152, 0.0722));
          float sat = max(src.r, max(src.g, src.b)) - min(src.r, min(src.g, src.b));
          float skin = smoothstep(0.06, 0.16, sat) * smoothstep(0.08, 0.2, lum);
          // The paint job is nearly black: read it as shading (seams, folds) over a cloth colour
          float shade = clamp(0.5 + lum * 7.0, 0.35, 1.6);
          float ang = atan(vCloth.w, vCloth.z);
          // Cloth coordinates in metres: along the arm, and around it
          vec2 uvm = vec2(vCloth.x, ang * 0.045);
          float glove = step(0.5, vCloth.y);
          float cuff = (1.0 - glove) * smoothstep(-uCuffLen - 0.002, -uCuffLen + 0.002, vCloth.x);
          aHeight = 0.0;

          // Sleeve: ripstop, a fine plain weave with a heavier thread every few millimetres
          vec2 wq = uvm / 0.0011;
          float wf = aFade(wq);
          float weave = (sin(wq.x * 6.2832) * sin(wq.y * 6.2832)) * wf;
          vec2 rq = uvm / 0.0062;
          vec2 rg = abs(fract(rq) - 0.5);
          float rip = smoothstep(0.42, 0.48, max(rg.x, rg.y)) * aFade(rq);
          float mottle = fFbm(uvm * 55.0);
          vec3 sleeve = uSleeve * shade * (0.86 + 0.28 * mottle) * (1.0 + 0.1 * weave + 0.16 * rip);
          float sleeveH = weave * 0.00006 + rip * 0.00016;

          // Cuff: knit ribs running along the arm, elastic gathering them slightly
          float ribs = 44.0;
          float rv = ang * ribs;
          float rfade = 1.0 - smoothstep(0.5, 1.4, fwidth(rv));
          float rib = (0.5 + 0.5 * cos(rv)) * rfade;
          float knit = sin(vCloth.x / 0.0016 * 6.2832 + cos(rv) * 1.5) * aFade(vec2(vCloth.x / 0.0016));
          vec3 cuffC = uCuff * shade * (0.55 + 0.75 * rib) * (1.0 + 0.12 * knit);
          float cuffH = rib * 0.0009 + knit * 0.00008;

          // Glove: the paint supplies panels and stitching; add grain and a paler worn palm
          float grain = fFbm(vMapUv * 420.0);
          float stitch = smoothstep(0.11, 0.2, lum);
          vec3 gloveC = uGlove * clamp(0.42 + lum * 6.5, 0.3, 1.5) * (0.9 + 0.2 * grain);
          gloveC = mix(gloveC, uGlove * 1.7, stitch * 0.45);
          float gloveH = grain * 0.00012;

          vec3 cloth = mix(mix(sleeve, cuffC, cuff), gloveC, glove);
          aHeight = mix(mix(sleeveH, cuffH, cuff), gloveH, glove) * (1.0 - skin);
          aRough = mix(mix(0.92, 0.97, cuff), 0.62 + 0.25 * grain, glove);
          aFuzz = mix(mix(0.55, 0.8, cuff), 0.12, glove) * (1.0 - skin);
          diffuseColor.rgb = mix(cloth, src, skin);
          aRough = mix(aRough, -1.0, skin);
        }`)
      .replace('#include <roughnessmap_fragment>', /* glsl */ `#include <roughnessmap_fragment>
        if (aRough >= 0.0) roughnessFactor = aRough;`)
      .replace('#include <metalnessmap_fragment>', /* glsl */ `#include <metalnessmap_fragment>
        metalnessFactor = 0.0;`)
      .replace('#include <normal_fragment_maps>', /* glsl */ `#include <normal_fragment_maps>
        normal = armBump(normal, -vViewPosition, aHeight);
        // Cloth catches light on its nap at glancing angles
        diffuseColor.rgb *= 1.0 + aFuzz * pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 2.5) * 1.6;`);
  };
  m.customProgramCacheKey = () => 'arm-finish-1';
  m.needsUpdate = true;
}
