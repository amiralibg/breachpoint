import * as THREE from 'three';
import type { LevelBuilder, PropId, Rect, V3 } from './level';

/**
 * Set dressing on top of the level kit: the detail that makes a blockout read as a place.
 * Nothing here changes how a map plays unless it says so (`collide`): facades, pipes, cables,
 * lamp posts, rubbish, stains and the city on the horizon are all visual only, and scattered
 * props are only placed where they do not overlap anything solid.
 *
 * Every map gets its own seeded random stream, so a map looks the same every time it loads.
 */

/** Outward side of a facade: the axis it faces along and which way. */
export type Face = '+x' | '-x' | '+z' | '-z';

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const canvasCache = new Map<string, THREE.CanvasTexture>();

/** A soft round blot (alpha), for stains and puddles. */
function blotTexture(): THREE.CanvasTexture {
  let t = canvasCache.get('blot');
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const r = rng(7);
  for (let i = 0; i < 14; i++) {
    const x = 40 + r() * 48, y = 40 + r() * 48, rad = 14 + r() * 30;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, 'rgba(255,255,255,0.55)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
  }
  t = new THREE.CanvasTexture(c);
  canvasCache.set('blot', t);
  return t;
}

/** Window grid for distant buildings: lit and dark panes, as an emissive map. */
function towerTexture(lit: number, seed: number): THREE.CanvasTexture {
  const key = `tower:${lit}:${seed}`;
  let t = canvasCache.get(key);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, 256, 256);
  const r = rng(seed);
  const cols = 8, rows = 8;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      if (r() > lit) continue;
      const warm = r();
      g.fillStyle = warm < 0.7 ? `rgb(255,${190 + r() * 40 | 0},${110 + r() * 50 | 0})` : `rgb(${170 + r() * 50 | 0},${200 + r() * 40 | 0},255)`;
      g.globalAlpha = 0.35 + r() * 0.65;
      g.fillRect(i * 32 + 7, j * 32 + 8, 18, 16);
    }
  }
  g.globalAlpha = 1;
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  canvasCache.set(key, t);
  return t;
}

/** Chain-link mesh, alpha-tested. */
function chainTexture(): THREE.CanvasTexture {
  let t = canvasCache.get('chain');
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.strokeStyle = '#fff';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(0, 0); g.lineTo(64, 64);
  g.moveTo(64, 0); g.lineTo(0, 64);
  g.stroke();
  t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  canvasCache.set('chain', t);
  return t;
}

/** Vertical grime: dark at the top, running down in uneven drips (alpha). */
function streakTexture(): THREE.CanvasTexture {
  let t = canvasCache.get('streak');
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const g = c.getContext('2d')!;
  const r = rng(31);
  for (let i = 0; i < 26; i++) {
    const x = 10 + r() * 108, w = 2 + r() * 10, len = 60 + r() * 196;
    const grd = g.createLinearGradient(0, 0, 0, len);
    grd.addColorStop(0, `rgba(255,255,255,${0.25 + r() * 0.35})`);
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(x, 0, w, len);
  }
  // Fade the sides
  const side = g.createLinearGradient(0, 0, 128, 0);
  side.addColorStop(0, 'rgba(0,0,0,1)');
  side.addColorStop(0.2, 'rgba(0,0,0,0)');
  side.addColorStop(0.8, 'rgba(0,0,0,0)');
  side.addColorStop(1, 'rgba(0,0,0,1)');
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = side;
  g.fillRect(0, 0, 128, 256);
  t = new THREE.CanvasTexture(c);
  canvasCache.set('streak', t);
  return t;
}

/** Rising damp: strong at the bottom edge, ragged top (alpha, tiles along u). */
function dampTexture(): THREE.CanvasTexture {
  let t = canvasCache.get('damp');
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d')!;
  const r = rng(53);
  for (let x = 0; x < 256; x += 4) {
    const h = 20 + r() * 40;
    const grd = g.createLinearGradient(0, 64, 0, 64 - h);
    grd.addColorStop(0, 'rgba(255,255,255,0.8)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(x, 64 - h, 5, h);
  }
  t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  canvasCache.set('damp', t);
  return t;
}

type Weighted = [PropId, number, { scale?: number; collide?: boolean }?];

export class Dresser {
  readonly r: () => number;
  private mats = new Map<string, THREE.Material>();

  constructor(readonly b: LevelBuilder, seed: number) {
    this.r = rng(seed);
  }

  /** Random in [a, c). */
  rand(a: number, c: number): number {
    return a + (c - a) * this.r();
  }

  pick<T>(list: readonly T[]): T {
    return list[Math.floor(this.r() * list.length)];
  }

  private material(key: string, make: () => THREE.Material): THREE.Material {
    let m = this.mats.get(key);
    if (!m) this.mats.set(key, (m = this.b.own(make())));
    return m;
  }

  // ---------------------------------------------------------------------------------------------
  // Building fronts

  /**
   * A row of windows on a solid facade: frame, sill and a pane that is dark glass or a lit room.
   * The facade runs from `a` to `c` along the wall line at `at`, from `y0` up to `y1`.
   */
  windows(face: Face, at: number, a: number, c: number, y0: number, y1: number, opts: {
    floor?: number; spacing?: number; w?: number; h?: number; sill?: number; lit?: number; frame?: number; skipGround?: boolean;
    litColor?: number; margin?: number;
  } = {}): void {
    const b = this.b;
    const floorH = opts.floor ?? 3.2;
    const spacing = opts.spacing ?? 3;
    const w = opts.w ?? 1.25, h = opts.h ?? 1.55;
    const sill = opts.sill ?? 0.95;
    const out = face[0] === '+' ? 1 : -1;
    const alongX = face[1] === 'z';
    const frame = b.flat(opts.frame ?? 0x2a2c2e, 0.6, 0.2);
    const dark = b.flat(0x10161c, 0.08, 0.3);
    const ledge = b.flat(0x8f8c86, 0.85);
    const margin = opts.margin ?? 1.2;
    const span = c - a - margin * 2;
    if (span < w) return;
    const n = Math.max(1, Math.floor(span / spacing) + 1);
    const step = n > 1 ? span / (n - 1) : 0;
    const box = (u0: number, u1: number, yy0: number, yy1: number, d0: number, d1: number, mat: THREE.Material): void => {
      const p0 = at + out * d0, p1 = at + out * d1;
      const lo = Math.min(p0, p1), hi = Math.max(p0, p1);
      if (alongX) b.box([u0, yy0, lo], [u1, yy1, hi], mat, { collide: false, shadow: false });
      else b.box([lo, yy0, u0], [hi, yy1, u1], mat, { collide: false, shadow: false });
    };
    for (let y = y0 + (opts.skipGround ? floorH : 0); y + sill + h <= y1 - 0.2; y += floorH) {
      for (let i = 0; i < n; i++) {
        const u = a + margin + i * step + (n === 1 ? span / 2 : 0);
        const lit = this.r() < (opts.lit ?? 0.3);
        const pane = lit ? b.glow(opts.litColor ?? this.pick([0xffc98a, 0xffb36b, 0xffe2b8, 0xcfe0ff]), this.rand(0.28, 0.6)) : dark;
        const ys = y + sill;
        box(u - w / 2, u + w / 2, ys, ys + h, 0.005, 0.03, pane);
        // frame: four bars and a mullion
        box(u - w / 2 - 0.07, u - w / 2, ys, ys + h, 0, 0.08, frame);
        box(u + w / 2, u + w / 2 + 0.07, ys, ys + h, 0, 0.08, frame);
        box(u - w / 2 - 0.07, u + w / 2 + 0.07, ys + h, ys + h + 0.08, 0, 0.08, frame);
        box(u - 0.025, u + 0.025, ys, ys + h, 0, 0.06, frame);
        box(u - w / 2 - 0.15, u + w / 2 + 0.15, ys - 0.08, ys, 0, 0.16, ledge);
        // Some have a shutter half down, some an AC unit under them
        if (!lit && this.r() < 0.2) box(u - w / 2, u + w / 2, ys + h * this.rand(0.3, 0.7), ys + h, 0.03, 0.06, b.flat(0x6d6a63, 0.9));
      }
    }
  }

  /** Windows, drainpipes and roof clutter all round a solid building block. `skip` lists faces against something. */
  block(x0: number, z0: number, x1: number, z1: number, y0: number, top: number, opts: {
    skip?: Face[]; lit?: number; frame?: number; roof?: boolean; pipes?: boolean; ac?: number; skipGround?: boolean;
  } = {}): void {
    const skip = new Set(opts.skip ?? []);
    const o = { lit: opts.lit, frame: opts.frame, skipGround: opts.skipGround };
    if (!skip.has('-z')) this.windows('-z', z0, x0, x1, y0, top, o);
    if (!skip.has('+z')) this.windows('+z', z1, x0, x1, y0, top, o);
    if (!skip.has('-x')) this.windows('-x', x0, z0, z1, y0, top, o);
    if (!skip.has('+x')) this.windows('+x', x1, z0, z1, y0, top, o);
    if (opts.pipes !== false) {
      const corners: [number, number, Face][] = [[x0, z0, '-z'], [x1, z1, '+z'], [x1, z0, '+x'], [x0, z1, '-x']];
      for (const [x, z, f] of corners) {
        if (skip.has(f) || this.r() < 0.4) continue;
        const dx = f === '+x' ? 0.12 : f === '-x' ? -0.12 : x === x0 ? 0.35 : -0.35;
        const dz = f === '+z' ? 0.12 : f === '-z' ? -0.12 : z === z0 ? 0.35 : -0.35;
        this.pipe([x + dx, y0, z + dz], [x + dx, top + 0.2, z + dz], 0.06, 0x4c5054);
      }
    }
    if (opts.roof !== false) this.roof(x0, z0, x1, z1, top + 0.25);
    const ac = opts.ac ?? 2;
    for (let i = 0; i < ac; i++) {
      const faces = (['-z', '+z', '-x', '+x'] as Face[]).filter((f) => !skip.has(f));
      if (!faces.length) break;
      const f = this.pick(faces);
      const y = y0 + 3.2 * (1 + Math.floor(this.r() * Math.max(1, (top - y0) / 3.2 - 1))) - 0.6;
      if (y + 0.8 > top) continue;
      const along = f[1] === 'z' ? this.rand(x0 + 1.5, x1 - 1.5) : this.rand(z0 + 1.5, z1 - 1.5);
      const at = f === '-z' ? z0 : f === '+z' ? z1 : f === '-x' ? x0 : x1;
      this.wallProp('exterior_aircon_unit', f, at, along, y, { collide: false });
    }
  }

  /**
   * Ground-floor shops along a facade: roller shutters (most closed at this hour), a few lit
   * fronts, a sign board over each. Visual only.
   */
  shopfronts(face: Face, at: number, a: number, c: number, y: number, opts: { open?: number; w?: number } = {}): void {
    const b = this.b;
    const out = face[0] === '+' ? 1 : -1;
    const alongX = face[1] === 'z';
    const w = opts.w ?? 3.2;
    const n = Math.floor((c - a - 1) / (w + 1));
    if (n < 1) return;
    const pad = (c - a - n * w) / (n + 1);
    const signs = [0xb5452c, 0x2f6f8f, 0xc79a2a, 0x3f6b3a, 0x6b3f6b, 0x8a8f94];
    const box = (u0: number, u1: number, y0: number, y1: number, d0: number, d1: number, mat: THREE.Material): void => {
      const p0 = at + out * d0, p1 = at + out * d1;
      const lo = Math.min(p0, p1), hi = Math.max(p0, p1);
      if (alongX) b.box([u0, y0, lo], [u1, y1, hi], mat, { collide: false, shadow: false });
      else b.box([lo, y0, u0], [hi, y1, u1], mat, { collide: false, shadow: false });
    };
    for (let i = 0; i < n; i++) {
      const u0 = a + pad + i * (w + pad), u1 = u0 + w;
      const lit = this.r() < (opts.open ?? 0.3);
      // Opening surround and the shop behind: a lit room or a closed shutter
      box(u0 - 0.15, u0, y, y + 3, 0, 0.12, b.flat(0x3a3836, 0.8));
      box(u1, u1 + 0.15, y, y + 3, 0, 0.12, b.flat(0x3a3836, 0.8));
      if (lit) {
        box(u0, u1, y + 0.4, y + 2.6, 0.004, 0.02, b.glow(this.pick([0xffd9a8, 0xfff0d8, 0xcfe0ff]), this.rand(0.25, 0.5)));
        box(u0, u1, y, y + 0.4, 0, 0.1, b.flat(0x2a2826, 0.8));
        box(u0, u1, y + 2.6, y + 2.75, 0, 0.1, b.flat(0x2a2826, 0.8));
      } else {
        box(u0, u1, y, y + 2.75, 0.01, 0.06, b.flat(this.pick([0x7d8186, 0x6c7176, 0x8a8a82, 0x5f6a70]), 0.55, 0.5));
        for (let k = 1; k < 10; k++) box(u0, u1, y + k * 0.27, y + k * 0.27 + 0.03, 0.06, 0.075, b.flat(0x55595d, 0.6, 0.5));
      }
      const sign = signs[Math.floor(this.r() * signs.length)];
      box(u0 - 0.1, u1 + 0.1, y + 2.9, y + 3.5, 0, 0.14, lit ? b.glow(sign, 0.9) : b.flat(sign, 0.85));
      // An awning over some
      if (this.r() < 0.35) box(u0 - 0.2, u1 + 0.2, y + 2.78, y + 2.86, 0, 1.1, b.flat(this.pick([0xb5452c, 0x2f6f8f, 0xc79a2a, 0x3d4a3d]), 0.9));
    }
  }

  /** Clutter on a flat roof: vents, a tank, an antenna, a dish. */
  roof(x0: number, z0: number, x1: number, z1: number, y: number): void {
    const b = this.b;
    const vent = b.flat(0x6b7074, 0.5, 0.5);
    const n = Math.max(1, Math.round(((x1 - x0) * (z1 - z0)) / 60));
    for (let i = 0; i < n; i++) {
      const x = this.rand(x0 + 1.2, x1 - 1.2), z = this.rand(z0 + 1.2, z1 - 1.2);
      const k = this.r();
      if (k < 0.45) b.box([x - 0.35, y, z - 0.35], [x + 0.35, y + 0.6, z + 0.35], vent, { collide: false });
      else if (k < 0.7) this.cyl([x, y, z], 0.18, 0.9, vent);
      else if (k < 0.85) {
        this.cyl([x, y, z], 0.03, this.rand(2, 4.5), b.flat(0x2a2d30, 0.5, 0.6));
      } else b.box([x - 0.8, y, z - 0.5], [x + 0.8, y + 0.9, z + 0.5], b.flat(0x8a8d8e, 0.6, 0.4), { collide: false });
    }
  }

  /** A prop hung on a wall: `face` is the way the wall faces, `along` the position along it. */
  wallProp(id: PropId, face: Face, at: number, along: number, y: number, opts: { collide?: boolean; scale?: number; gap?: number } = {}): void {
    // Models face +z, so their depth off the wall is their z extent whichever way the wall faces
    const off = (this.b.propSize(id).z * (opts.scale ?? 1)) / 2 + (opts.gap ?? 0.02);
    const rot = face === '+z' ? 0 : face === '-z' ? Math.PI : face === '+x' ? Math.PI / 2 : -Math.PI / 2;
    const out = face[0] === '+' ? 1 : -1;
    if (face[1] === 'z') this.b.prop(id, along, y, at + out * off, rot, opts);
    else this.b.prop(id, at + out * off, y, along, rot, opts);
  }

  /** A prop hung under a ceiling at height `ceil`. */
  ceilingProp(id: PropId, x: number, ceil: number, z: number, rot = 0, scale = 1): void {
    this.b.prop(id, x, ceil - this.b.propSize(id).y * scale, z, rot, { collide: false, scale });
  }

  // ---------------------------------------------------------------------------------------------
  // Services

  /** Cylinder from its base. */
  cyl(base: V3, r: number, h: number, mat: THREE.Material, seg = 10): void {
    const g = new THREE.CylinderGeometry(r, r, h, seg);
    g.translate(base[0], base[1] + h / 2, base[2]);
    this.b.geo(g, mat);
  }

  /** Straight pipe between two points, with brackets every few metres. */
  pipe(a: V3, c: V3, r: number, color = 0x5a5f63, opts: { brackets?: boolean } = {}): void {
    const mat = this.b.flat(color, 0.55, 0.45);
    const va = new THREE.Vector3(...a), vc = new THREE.Vector3(...c);
    const len = va.distanceTo(vc);
    if (len < 0.01) return;
    const g = new THREE.CylinderGeometry(r, r, len, 10, 1, true);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vc.clone().sub(va).normalize()));
    g.translate((a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2);
    this.b.geo(g, mat);
    if (opts.brackets !== false) {
      const n = Math.floor(len / 2.5);
      for (let i = 1; i <= n; i++) {
        const p = va.clone().lerp(vc, i / (n + 1));
        const s = r * 1.5;
        this.b.box([p.x - s, p.y - s, p.z - s], [p.x + s, p.y + s, p.z + s], mat, { collide: false });
      }
    }
  }

  /** A sagging cable between two points. */
  cable(a: V3, c: V3, sag = 0.6, r = 0.012): void {
    const va = new THREE.Vector3(...a), vc = new THREE.Vector3(...c);
    const mid = va.clone().lerp(vc, 0.5);
    mid.y -= sag;
    const curve = new THREE.QuadraticBezierCurve3(va, mid.clone().multiplyScalar(2).sub(va.clone().lerp(vc, 0.5)), vc);
    const g = new THREE.TubeGeometry(curve, 16, r, 4, false);
    this.b.geo(g, this.b.flat(0x141516, 0.7));
  }

  /** Strings of cables between pairs of points, a few per pair. */
  cables(pairs: [V3, V3][], per = 2): void {
    for (const [a, c] of pairs) {
      for (let i = 0; i < per; i++) {
        const d = i * 0.18;
        this.cable([a[0], a[1] - d, a[2]], [c[0], c[1] - d, c[2]], this.rand(0.4, 1.1));
      }
    }
  }

  /** Street lamp: pole, arm and head; `dir` is where the arm reaches. Real light only with `power`. */
  lampPost(x: number, z: number, y: number, dir: Face, opts: { h?: number; power?: number; color?: number; range?: number } = {}): void {
    const h = opts.h ?? 6;
    const mat = this.b.flat(0x3a3e42, 0.5, 0.6);
    this.cyl([x, y, z], 0.08, h, mat);
    this.cyl([x, y, z], 0.14, 0.6, mat);
    const ax = dir === '+x' ? 1 : dir === '-x' ? -1 : 0;
    const az = dir === '+z' ? 1 : dir === '-z' ? -1 : 0;
    const L = 1.4;
    const ex = x + ax * L, ez = z + az * L;
    this.pipe([x, y + h, z], [ex, y + h + 0.15, ez], 0.04, 0x3a3e42, { brackets: false });
    this.b.box([ex - 0.25, y + h - 0.05, ez - 0.25], [ex + 0.25, y + h + 0.2, ez + 0.25], mat, { collide: false });
    this.b.lamp(ex, y + h - 0.05, ez, { color: opts.color ?? 0xffb469, power: opts.power, range: opts.range ?? 22, size: 0.36 });
    // Hit box for the pole only
    this.b.box([x - 0.08, y, z - 0.08], [x + 0.08, y + h, z + 0.08], mat);
  }

  /** Chain-link fence with posts; solid to movement, transparent to sight and bullets. */
  fence(x0: number, z0: number, x1: number, z1: number, y: number, h = 2.4): void {
    const b = this.b;
    const alongX = Math.abs(z1 - z0) < 1e-6;
    const len = alongX ? Math.abs(x1 - x0) : Math.abs(z1 - z0);
    const mesh = this.material('chain', () => {
      const t = chainTexture().clone();
      t.needsUpdate = true;
      return new THREE.MeshStandardMaterial({ color: 0x8c9196, metalness: 0.6, roughness: 0.4, alphaMap: t, alphaTest: 0.5, side: THREE.DoubleSide });
    }) as THREE.MeshStandardMaterial;
    (mesh.alphaMap as THREE.Texture).repeat.set(1, 1);
    const g = new THREE.PlaneGeometry(len, h);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len * 8, uv.getY(i) * h * 8);
    if (!alongX) g.rotateY(Math.PI / 2);
    g.translate((x0 + x1) / 2, y + h / 2, (z0 + z1) / 2);
    b.geo(g, mesh);
    const post = b.flat(0x6a6f74, 0.5, 0.6);
    const n = Math.max(1, Math.round(len / 3));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      this.cyl([x0 + (x1 - x0) * t, y, z0 + (z1 - z0) * t], 0.04, h + 0.1, post, 6);
    }
    this.pipe([x0, y + h, z0], [x1, y + h, z1], 0.025, 0x6a6f74, { brackets: false });
    // Movement only: the fence is a thin box the player and bots cannot pass
    if (alongX) b.box([Math.min(x0, x1), y, z0 - 0.04], [Math.max(x0, x1), y + h, z0 + 0.04], post);
    else b.box([x0 - 0.04, y, Math.min(z0, z1)], [x0 + 0.04, y + h, Math.max(z0, z1)], post);
  }

  // ---------------------------------------------------------------------------------------------
  // Floors

  /**
   * Scatter props over a rectangle at height `y`, only where each one stands on something at that
   * height and touches nothing else. Returns how many were placed.
   */
  scatter(rect: Rect, y: number, n: number, items: Weighted[], opts: { tries?: number; clear?: Rect[] } = {}): number {
    const total = items.reduce((s, i) => s + i[1], 0);
    let placed = 0;
    for (let t = 0; t < (opts.tries ?? n * 8) && placed < n; t++) {
      let k = this.r() * total;
      const item = items.find((i) => (k -= i[1]) < 0) ?? items[0];
      const [id, , o = {}] = item;
      const x = this.rand(rect[0], rect[2]), z = this.rand(rect[1], rect[3]);
      if (opts.clear?.some((c) => x > c[0] && x < c[2] && z > c[1] && z < c[3])) continue;
      if (Math.abs(this.b.floorAt(x, z, y) - y) > 0.06) continue;
      const rot = this.r() * Math.PI * 2;
      const box = this.b.propBox(id, x, y, z, rot, o.scale ?? 1);
      if (this.b.blocked(box)) continue;
      // Every corner must be on the floor too, not hanging over an edge
      if ([[box.min.x, box.min.z], [box.max.x, box.max.z], [box.min.x, box.max.z], [box.max.x, box.min.z]]
        .some(([cx, cz]) => Math.abs(this.b.floorAt(cx, cz, y) - y) > 0.06)) continue;
      this.b.prop(id, x, y, z, rot, { scale: o.scale, collide: o.collide ?? false });
      placed++;
    }
    return placed;
  }

  /** Is the point just above (x, y, z) inside something solid? */
  private inside(x: number, y: number, z: number): boolean {
    return this.b.blocked(new THREE.Box3(new THREE.Vector3(x - 0.05, y + 0.03, z - 0.05), new THREE.Vector3(x + 0.05, y + 0.4, z + 0.05)), 0);
  }

  /** Bits on the floor: broken concrete, paper, cans. Visual only. */
  debris(rect: Rect, y: number, n: number, opts: { paper?: number; clear?: Rect[] } = {}): void {
    const b = this.b;
    const rubble = b.flat(0x77746e, 0.95);
    const rubbleDark = b.flat(0x55534f, 0.95);
    const paper = b.flat(0xd8d3c4, 0.95);
    const can = b.flat(0x8a2f25, 0.4, 0.6);
    for (let i = 0; i < n; i++) {
      const x = this.rand(rect[0], rect[2]), z = this.rand(rect[1], rect[3]);
      if (opts.clear?.some((c) => x > c[0] && x < c[2] && z > c[1] && z < c[3])) continue;
      if (Math.abs(b.floorAt(x, z, y) - y) > 0.06 || this.inside(x, y, z)) continue;
      const k = this.r();
      let g: THREE.BufferGeometry;
      let mat: THREE.Material;
      if (k < (opts.paper ?? 0.35)) {
        g = new THREE.PlaneGeometry(this.rand(0.18, 0.32), this.rand(0.22, 0.36));
        g.rotateX(-Math.PI / 2 + this.rand(-0.1, 0.1));
        g.translate(0, 0.006, 0);
        mat = paper;
      } else if (k < 0.45) {
        g = new THREE.CylinderGeometry(0.033, 0.033, 0.12, 8);
        g.rotateZ(Math.PI / 2);
        g.translate(0, 0.033, 0);
        mat = can;
      } else {
        const s = this.rand(0.06, 0.22);
        g = new THREE.BoxGeometry(s * this.rand(0.8, 1.6), s * this.rand(0.5, 0.9), s);
        g.rotateX(this.rand(-0.4, 0.4));
        g.rotateZ(this.rand(-0.4, 0.4));
        g.translate(0, s * 0.3, 0);
        mat = this.r() < 0.5 ? rubble : rubbleDark;
      }
      g.rotateY(this.r() * Math.PI * 2);
      g.translate(x, y, z);
      b.geo(g, mat);
    }
  }

  /** Dark blots on a floor: oil, damp, soot. */
  stains(rect: Rect, y: number, n: number, color = 0x111111, opacity = 0.45, size: [number, number] = [0.8, 2.6]): void {
    const mat = this.material(`stain:${color}:${opacity}`, () => new THREE.MeshBasicMaterial({
      color, alphaMap: blotTexture(), transparent: true, opacity, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }));
    for (let i = 0; i < n; i++) {
      const x = this.rand(rect[0], rect[2]), z = this.rand(rect[1], rect[3]);
      if (Math.abs(this.b.floorAt(x, z, y) - y) > 0.06 || this.inside(x, y, z)) continue;
      const s = this.rand(size[0], size[1]);
      const g = new THREE.PlaneGeometry(s, s * this.rand(0.6, 1));
      g.rotateX(-Math.PI / 2);
      g.rotateY(this.r() * Math.PI);
      g.translate(x, y + 0.012, z);
      this.b.geo(g, mat);
    }
  }

  /** Painted lines on a road or a floor: a dashed or solid strip. */
  line(x0: number, z0: number, x1: number, z1: number, y: number, opts: { w?: number; dash?: number; gap?: number; color?: number } = {}): void {
    const mat = this.b.flat(opts.color ?? 0xd8d2bf, 0.8);
    const w = (opts.w ?? 0.12) / 2;
    const alongX = Math.abs(z1 - z0) < 1e-6;
    const a = alongX ? Math.min(x0, x1) : Math.min(z0, z1), c = alongX ? Math.max(x0, x1) : Math.max(z0, z1);
    const dash = opts.dash ?? c - a, gap = opts.gap ?? 0;
    for (let u = a; u < c; u += dash + gap) {
      const e = Math.min(c, u + dash);
      if (alongX) this.b.box([u, y, z0 - w], [e, y + 0.012, z0 + w], mat, { collide: false, shadow: false });
      else this.b.box([x0 - w, y, u], [x0 + w, y + 0.012, e], mat, { collide: false, shadow: false });
    }
  }

  /** Hazard stripes along an edge. */
  hazard(x0: number, z0: number, x1: number, z1: number, y: number, w = 0.3): void {
    const yel = this.b.flat(0xc79a2a, 0.7), blk = this.b.flat(0x1c1c1c, 0.7);
    const alongX = Math.abs(z1 - z0) < 1e-6;
    const a = alongX ? Math.min(x0, x1) : Math.min(z0, z1), c = alongX ? Math.max(x0, x1) : Math.max(z0, z1);
    let k = 0;
    for (let u = a; u < c; u += 0.4, k++) {
      const e = Math.min(c, u + 0.4);
      const m = k % 2 ? yel : blk;
      if (alongX) this.b.box([u, y, z0 - w / 2], [e, y + 0.01, z0 + w / 2], m, { collide: false, shadow: false });
      else this.b.box([x0 - w / 2, y, u], [x0 + w / 2, y + 0.01, e], m, { collide: false, shadow: false });
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Rooms

  /** A worked-in office desk: desk, chair, a screen or a laptop, papers. Desk faces `face`. */
  desk(x: number, y: number, z: number, face: Face, opts: { collide?: boolean } = {}): void {
    const rot = face === '+z' ? 0 : face === '-z' ? Math.PI : face === '+x' ? Math.PI / 2 : -Math.PI / 2;
    const desk = this.b.prop('metal_office_desk', x, y, z, rot, { collide: opts.collide ?? true });
    const top = desk.max.y;
    const fx = Math.sin(rot), fz = Math.cos(rot);
    const k = this.r();
    if (k < 0.5) this.b.prop('classic_laptop', x + this.rand(-0.3, 0.3), top, z + this.rand(-0.1, 0.1), rot + Math.PI + this.rand(-0.3, 0.3), { collide: false });
    else if (k < 0.75) this.b.prop('Television_01', x, top, z - fz * 0.1, rot + Math.PI, { collide: false, scale: 0.8 });
    if (this.r() < 0.7) this.b.prop(this.pick(['clipboard', 'office_notepads', 'binder_notebook'] as const), x + this.rand(-0.5, 0.5), top, z + this.rand(-0.15, 0.15), this.r() * 6, { collide: false });
    if (this.r() < 0.8) this.b.prop('metal_stool_01', x + fx * 0.75 + this.rand(-0.2, 0.2), y, z + fz * 0.75, this.r() * 6, { collide: false });
  }

  /** A run of shelving against a wall, loaded with boxes and cans. */
  shelves(x0: number, z0: number, x1: number, z1: number, y: number, face: Face): void {
    const alongX = Math.abs(z1 - z0) < 1e-6;
    const id: PropId = 'steel_frame_shelves_01';
    const s = this.b.propSize(id);
    const w = Math.max(s.x, s.z);
    const len = alongX ? Math.abs(x1 - x0) : Math.abs(z1 - z0);
    const n = Math.max(1, Math.floor(len / (w + 0.05)));
    const rot = face === '+z' ? 0 : face === '-z' ? Math.PI : face === '+x' ? Math.PI / 2 : -Math.PI / 2;
    const deep = Math.min(s.x, s.z);
    const out = face[0] === '+' ? 1 : -1;
    for (let i = 0; i < n; i++) {
      const u = (alongX ? Math.min(x0, x1) : Math.min(z0, z1)) + (i + 0.5) * (len / n);
      const x = alongX ? u : x0 + out * (deep / 2 + 0.05);
      const z = alongX ? z0 + out * (deep / 2 + 0.05) : u;
      this.b.prop(id, x, y, z, rot);
      for (const sy of [0.05, 0.55, 1.05]) {
        if (this.r() < 0.4) continue;
        this.b.prop(this.pick(['cardboard_box_01', 'plastic_crate_03', 'metal_toolbox', 'medical_box'] as const), x + this.rand(-0.2, 0.2) * (alongX ? 1 : 0), y + sy, z + this.rand(-0.2, 0.2) * (alongX ? 0 : 1), rot + this.rand(-0.2, 0.2), { collide: false, scale: 0.7 });
      }
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Signs and paint

  private atlas: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; x: number; y: number; row: number; tex: THREE.CanvasTexture } | null = null;

  /** Room in the shared sign atlas for a w x h pixel label; returns its UV rectangle. */
  private atlasSlot(w: number, h: number): { ctx: CanvasRenderingContext2D; px: number; py: number; uv: [number, number, number, number] } {
    if (!this.atlas) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 2048;
      const ctx = canvas.getContext('2d')!;
      ctx.clearRect(0, 0, 2048, 2048);
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      this.atlas = { canvas, ctx, x: 0, y: 0, row: 0, tex };
    }
    const A = this.atlas;
    w = Math.min(2048, Math.ceil(w));
    if (A.x + w > 2048) {
      A.x = 0;
      A.y += A.row + 2;
      A.row = 0;
    }
    if (A.y + h > 2048) {
      // Out of room: draw over a corner rather than fail the whole map
      console.warn('sign atlas full');
      return { ctx: A.ctx, px: 0, py: 0, uv: [0, 1 - h / 2048, w / 2048, 1] };
    }
    const px = A.x, py = A.y;
    A.x += w + 2;
    A.row = Math.max(A.row, h);
    A.tex.needsUpdate = true;
    return { ctx: A.ctx, px, py, uv: [px / 2048, 1 - (py + h) / 2048, (px + w) / 2048, 1 - py / 2048] };
  }

  private labels = new Map<string, [number, number, number, number]>();

  /**
   * A label in the atlas, drawn once per distinct key: the same sign text in the same style reuses
   * its slot. `burn` is how many random numbers drawing it takes, so a reused label leaves the
   * map's random stream (and everything placed after it) exactly as if it had been drawn again.
   */
  private label(key: string, w: number, h: number, burn: number, draw: (ctx: CanvasRenderingContext2D, px: number, py: number) => void): [number, number, number, number] {
    const hit = this.labels.get(key);
    if (hit) {
      for (let i = 0; i < burn; i++) this.r();
      return hit;
    }
    const { ctx, px, py, uv } = this.atlasSlot(w, h);
    draw(ctx, px, py);
    this.labels.set(key, uv);
    return uv;
  }

  /** A flat quad on a wall facing `face`, centred at `along`, from y to y + h, UV-mapped to `uv`. */
  private wallQuad(face: Face, at: number, along: number, y: number, w: number, h: number, off: number, uv: [number, number, number, number], mat: THREE.Material): void {
    const g = new THREE.PlaneGeometry(w, h);
    const a = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < a.count; i++) a.setXY(i, uv[0] + a.getX(i) * (uv[2] - uv[0]), uv[1] + a.getY(i) * (uv[3] - uv[1]));
    const rot = face === '+z' ? 0 : face === '-z' ? Math.PI : face === '+x' ? Math.PI / 2 : -Math.PI / 2;
    g.rotateY(rot);
    const out = face[0] === '+' ? 1 : -1;
    if (face[1] === 'z') g.translate(along, y + h / 2, at + out * off);
    else g.translate(at + out * off, y + h / 2, along);
    this.b.geo(g, mat);
  }

  /**
   * A sign board on a wall: text on a painted plate (a shop name, "PUMP STATION 3", a warning).
   * `glow` makes it a lit sign. Height `h` in metres; the width follows the text unless given.
   */
  sign(face: Face, at: number, along: number, y: number, text: string, opts: {
    h?: number; w?: number; bg?: string; fg?: string; font?: string; glow?: number; border?: string; plate?: boolean; lines?: string[];
  } = {}): void {
    const h = opts.h ?? 0.5;
    const lines = opts.lines ?? [text];
    const PX = 96 * lines.length;
    const font = opts.font ?? '700 64px "Arial Narrow", Arial, sans-serif';
    const probe = this.textWidth(lines, font);
    const aspect = opts.w ? opts.w / h : Math.max(1, (probe + 48) / PX);
    const wpx = Math.round(PX * aspect);
    const key = `sign|${lines.join('\n')}|${font}|${opts.bg}|${opts.fg}|${opts.border}|${wpx}`;
    const uv = this.label(key, wpx, PX, 200, (ctx, px, py) => {
      ctx.save();
      ctx.fillStyle = opts.bg ?? '#d8d4c8';
      ctx.fillRect(px, py, wpx, PX);
      if (opts.border) {
        ctx.strokeStyle = opts.border;
        ctx.lineWidth = 8;
        ctx.strokeRect(px + 8, py + 8, wpx - 16, PX - 16);
      }
      ctx.fillStyle = opts.fg ?? '#1c1c1c';
      ctx.font = font;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      lines.forEach((l, i) => ctx.fillText(l, px + wpx / 2, py + 96 * i + 50, wpx - 24));
      // A little weathering (5 random numbers per smudge: keep `burn` in step)
      for (let i = 0; i < 40; i++) {
        ctx.fillStyle = `rgba(40,30,20,${this.rand(0.02, 0.08)})`;
        ctx.fillRect(px + this.r() * wpx, py + this.r() * PX, this.rand(4, 30), this.rand(2, 12));
      }
      ctx.restore();
    });
    const w = h * aspect;
    const mat = opts.glow
      ? this.material(`signGlow:${opts.glow}`, () => new THREE.MeshBasicMaterial({ map: this.atlas!.tex, color: new THREE.Color(1, 1, 1).multiplyScalar(opts.glow!) }))
      : this.material('sign', () => new THREE.MeshStandardMaterial({ map: this.atlas!.tex, roughness: 0.7, metalness: 0.1 }));
    if (opts.plate !== false) {
      const out = face[0] === '+' ? 1 : -1;
      const p0 = at, p1 = at + out * 0.03;
      const lo = Math.min(p0, p1), hi = Math.max(p0, p1);
      const pm = this.b.flat(0x3a3d40, 0.6, 0.4);
      if (face[1] === 'z') this.b.box([along - w / 2 - 0.02, y - 0.02, lo], [along + w / 2 + 0.02, y + h + 0.02, hi], pm, { collide: false, shadow: false });
      else this.b.box([lo, y - 0.02, along - w / 2 - 0.02], [hi, y + h + 0.02, along + w / 2 + 0.02], pm, { collide: false, shadow: false });
    }
    this.wallQuad(face, at, along, y, w, h, opts.plate !== false ? 0.033 : 0.006, uv, mat);
  }

  private measureCtx: CanvasRenderingContext2D | null = null;
  private textWidth(lines: string[], font: string): number {
    if (!this.measureCtx) this.measureCtx = document.createElement('canvas').getContext('2d')!;
    this.measureCtx.font = font;
    return Math.max(...lines.map((l) => this.measureCtx!.measureText(l).width));
  }

  /** Stencilled paint straight on a surface (bay numbers, "NO ENTRY", arrows): transparent background. */
  stencil(face: Face, at: number, along: number, y: number, text: string, opts: { h?: number; color?: string; font?: string; opacity?: number } = {}): void {
    const h = opts.h ?? 0.6;
    const font = opts.font ?? '900 80px Impact, "Arial Black", sans-serif';
    const PX = 96;
    const wpx = Math.round(this.textWidth([text], font) + 24);
    const uv = this.label(`stencil|${text}|${font}|${opts.color}`, wpx, PX, 240, (ctx, px, py) => {
      ctx.save();
      ctx.clearRect(px, py, wpx, PX);
      ctx.fillStyle = opts.color ?? '#e8e2d0';
      ctx.font = font;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, px + wpx / 2, py + PX / 2 + 4);
      // Worn paint: knock holes in it (4 random numbers per hole: keep `burn` in step)
      ctx.globalCompositeOperation = 'destination-out';
      for (let i = 0; i < 60; i++) {
        ctx.fillStyle = `rgba(0,0,0,${this.rand(0.2, 0.7)})`;
        ctx.beginPath();
        ctx.arc(px + this.r() * wpx, py + this.r() * PX, this.rand(1, 6), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    });
    const mat = this.material(`stencil:${opts.opacity ?? 0.85}`, () => new THREE.MeshStandardMaterial({
      map: this.atlas!.tex, transparent: true, opacity: opts.opacity ?? 0.85, roughness: 0.8, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }));
    this.wallQuad(face, at, along, y, (h * wpx) / PX, h, 0.004, uv, mat);
  }

  /** Painted text flat on a floor or road (bay numbers, "SLOW"), reading toward `face`. */
  floorText(x: number, y: number, z: number, text: string, face: Face, opts: { h?: number; color?: string } = {}): void {
    const h = opts.h ?? 1;
    const font = '900 80px Impact, "Arial Black", sans-serif';
    const PX = 96;
    const wpx = Math.round(this.textWidth([text], font) + 24);
    const uv = this.label(`floor|${text}|${opts.color}`, wpx, PX, 0, (ctx, px, py) => {
      ctx.save();
      ctx.clearRect(px, py, wpx, PX);
      ctx.fillStyle = opts.color ?? '#d8d2bf';
      ctx.font = font;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, px + wpx / 2, py + PX / 2 + 4);
      ctx.restore();
    });
    const g = new THREE.PlaneGeometry((h * wpx) / PX, h);
    const a = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < a.count; i++) a.setXY(i, uv[0] + a.getX(i) * (uv[2] - uv[0]), uv[1] + a.getY(i) * (uv[3] - uv[1]));
    g.rotateX(-Math.PI / 2);
    g.rotateY(face === '+z' ? Math.PI : face === '-z' ? 0 : face === '+x' ? -Math.PI / 2 : Math.PI / 2);
    g.translate(x, y + 0.014, z);
    this.b.geo(g, this.material('floorText', () => new THREE.MeshStandardMaterial({
      map: this.atlas!.tex, transparent: true, opacity: 0.8, roughness: 0.85, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    })));
  }

  /**
   * Grime running down a wall: dark streaks under window sills and roof edges, damp at the base.
   * The wall line is at `at` facing `face`, from `a` to `c`, between y0 and y1.
   */
  streaks(face: Face, at: number, a: number, c: number, y0: number, y1: number, n: number, opts: { color?: number; opacity?: number; base?: boolean } = {}): void {
    const mat = this.material(`streak:${opts.color ?? 0x14110d}:${opts.opacity ?? 0.5}`, () => new THREE.MeshBasicMaterial({
      color: opts.color ?? 0x14110d, alphaMap: streakTexture(), transparent: true, opacity: opts.opacity ?? 0.5, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    }));
    const full: [number, number, number, number] = [0, 0, 1, 1];
    for (let i = 0; i < n; i++) {
      const w = this.rand(0.4, 1.6);
      const along = this.rand(a + w / 2, c - w / 2);
      const top = this.rand(y0 + (y1 - y0) * 0.3, y1);
      const h = Math.min(top - y0, this.rand(1, 4));
      if (h < 0.3) continue;
      this.wallQuad(face, at, along, top - h, w, h, 0.008 + this.r() * 0.004, full, mat);
    }
    if (opts.base !== false) {
      // Rising damp along the bottom
      const m2 = this.material('damp', () => new THREE.MeshBasicMaterial({
        color: 0x16140f, alphaMap: dampTexture(), transparent: true, opacity: 0.55, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
      }));
      this.wallQuad(face, at, (a + c) / 2, y0, c - a, this.rand(0.5, 1.1), 0.007, [0, 0, (c - a) / 3, 1], m2);
    }
  }

  /** Rain puddles: mirror-smooth dark water in the low spots of a floor. Visual only. */
  puddles(rect: Rect, y: number, n: number, size: [number, number] = [0.8, 3]): void {
    const mat = this.material('puddle', () => new THREE.MeshStandardMaterial({
      color: 0x1a2026, roughness: 0.02, metalness: 0.3, alphaMap: blotTexture(), transparent: true, opacity: 0.6,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, envMapIntensity: 1.6,
    }));
    for (let i = 0; i < n; i++) {
      const x = this.rand(rect[0], rect[2]), z = this.rand(rect[1], rect[3]);
      if (Math.abs(this.b.floorAt(x, z, y) - y) > 0.06 || this.inside(x, y, z)) continue;
      const s = this.rand(size[0], size[1]);
      const g = new THREE.PlaneGeometry(s, s * this.rand(0.5, 0.9));
      g.rotateX(-Math.PI / 2);
      g.rotateY(this.r() * Math.PI);
      g.translate(x, y + 0.01, z);
      this.b.geo(g, mat);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Small kit pieces, built from boxes (cheap: they merge with the map)

  /** Wooden pallet on `y`, optionally loaded with sacks or boxes. Solid only if loaded. */
  pallet(x: number, y: number, z: number, rot = 0, load: 'none' | 'sacks' | 'boxes' | 'wrapped' = 'none'): void {
    const b = this.b;
    const wood = b.flat(this.pick([0x8a6a45, 0x7a5c3a, 0x9a7a50]), 0.9);
    const c = Math.cos(rot), s = Math.sin(rot);
    const at = (u: number, v: number): [number, number] => [x + u * c + v * s, z - u * s + v * c];
    const piece = (u: number, v: number, w: number, d: number, y0: number, y1: number, m: THREE.Material): void => {
      // Rotated boxes are drawn as rotated geometry (no collider)
      const g = new THREE.BoxGeometry(w, y1 - y0, d);
      g.rotateY(rot);
      const [px, pz] = at(u, v);
      g.translate(px, y + (y0 + y1) / 2, pz);
      b.geo(g, m);
    };
    for (const v of [-0.5, 0, 0.5]) piece(0, v, 1.2, 0.1, 0, 0.1, wood);
    for (let u = -0.55; u <= 0.56; u += 0.183) piece(u, 0, 0.1, 1.0, 0.1, 0.14, wood);
    let top = 0.14;
    if (load === 'sacks') {
      const sack = b.flat(this.pick([0xc8bc9c, 0xb8ae92, 0x9c9a88]), 0.95);
      for (let k = 0; k < 3; k++) for (const u of [-0.3, 0.3]) for (const v of [-0.25, 0.25]) piece(u + this.rand(-0.03, 0.03), v, 0.55, 0.45, top + k * 0.16, top + k * 0.16 + 0.15, sack);
      top += 0.48;
    } else if (load === 'boxes') {
      const card = b.flat(this.pick([0xa88a62, 0x9a7c56]), 0.9);
      const layers = 2 + Math.floor(this.r() * 3);
      for (let k = 0; k < layers; k++) for (const u of [-0.3, 0.3]) for (const v of [-0.25, 0.25]) piece(u, v, 0.56, 0.48, top + k * 0.4, top + k * 0.4 + 0.39, card);
      top += layers * 0.4;
    } else if (load === 'wrapped') {
      const h = this.rand(0.8, 1.4);
      piece(0, 0, 1.18, 0.98, top, top + h, b.flat(this.pick([0x8f969c, 0x6d7a84, 0x3f5a6a]), 0.25, 0.1));
      top += h;
    }
    if (load !== 'none') {
      const r = Math.abs(c) * 0.6 + Math.abs(s) * 0.5, q = Math.abs(s) * 0.6 + Math.abs(c) * 0.5;
      b.colliders.push(new THREE.Box3(new THREE.Vector3(x - r, y, z - q), new THREE.Vector3(x + r, y + top, z + q)));
    }
  }

  /** Traffic cone. */
  cone(x: number, y: number, z: number): void {
    const or = this.b.flat(0xd5541c, 0.6);
    const g = new THREE.CylinderGeometry(0.03, 0.15, 0.62, 12);
    g.translate(x, y + 0.34, z);
    this.b.geo(g, or);
    const band = new THREE.CylinderGeometry(0.075, 0.1, 0.1, 12, 1, true);
    band.translate(x, y + 0.36, z);
    this.b.geo(band, this.b.flat(0xe8e8e0, 0.4));
    this.b.box([x - 0.19, y, z - 0.19], [x + 0.19, y + 0.03, z + 0.19], this.b.flat(0x1c1c1c, 0.8), { collide: false });
  }

  /** Steel bollard (solid). `kind` mooring = squat quay bollard. */
  bollard(x: number, y: number, z: number, kind: 'post' | 'mooring' = 'post', color = 0x2b2e31): void {
    const m = this.b.flat(color, 0.55, 0.5);
    if (kind === 'mooring') {
      this.cyl([x, y, z], 0.24, 0.6, m, 12);
      this.cyl([x, y + 0.6, z], 0.32, 0.1, m, 12);
      this.b.box([x - 0.22, y, z - 0.22], [x + 0.22, y + 0.7, z + 0.22], m, { collide: true, shadow: false, tile: 1 });
      return;
    }
    this.cyl([x, y, z], 0.09, 0.95, m, 10);
    this.cyl([x, y + 0.75, z], 0.095, 0.08, this.b.flat(0xc79a2a, 0.6), 10);
    this.b.colliders.push(new THREE.Box3(new THREE.Vector3(x - 0.09, y, z - 0.09), new THREE.Vector3(x + 0.09, y + 0.95, z + 0.09)));
  }

  /** A row of sandbags from (x0, z0) to (x1, z1), `rows` high (about 0.14 m each). Solid: it is cover. */
  sandbags(x0: number, z0: number, x1: number, z1: number, y: number, rows = 4): void {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const ang = Math.atan2(z1 - z0, x1 - x0);
    const mats = [this.b.flat(0x8c8068, 0.95), this.b.flat(0x7d725c, 0.95), this.b.flat(0x9a8e74, 0.95)];
    const per = Math.max(1, Math.round(len / 0.55));
    for (let r = 0; r < rows; r++) {
      for (let i = 0; i < per; i++) {
        const t = (i + 0.5 + (r % 2) * 0.5) / per;
        if (t > 1) continue;
        const g = new THREE.CapsuleGeometry(0.075, 0.38, 3, 8);
        g.rotateZ(Math.PI / 2);
        g.scale(1, 0.9, 1.9);
        g.rotateY(-ang + this.rand(-0.08, 0.08));
        g.translate(x0 + (x1 - x0) * t, y + 0.07 + r * 0.135, z0 + (z1 - z0) * t);
        this.b.geo(g, this.pick(mats));
      }
    }
    const h = rows * 0.135 + 0.02;
    const pad = 0.16;
    this.b.colliders.push(new THREE.Box3(
      new THREE.Vector3(Math.min(x0, x1) - pad, y, Math.min(z0, z1) - pad), new THREE.Vector3(Math.max(x0, x1) + pad, y + h, Math.max(z0, z1) + pad)));
  }

  /** Rectangular duct (air handling) from a to c along one axis, w x h section, with flanges. Visual only. */
  duct(a: V3, c: V3, w = 0.6, h = 0.4, color = 0x8f969b): void {
    const m = this.b.flat(color, 0.4, 0.6);
    const fl = this.b.flat(color - 0x101010, 0.45, 0.6);
    const ax = Math.abs(c[0] - a[0]) > 1e-3 ? 0 : Math.abs(c[2] - a[2]) > 1e-3 ? 2 : 1;
    const lo: V3 = [Math.min(a[0], c[0]), Math.min(a[1], c[1]), Math.min(a[2], c[2])];
    const hi: V3 = [Math.max(a[0], c[0]), Math.max(a[1], c[1]), Math.max(a[2], c[2])];
    const half: V3 = ax === 0 ? [0, h / 2, w / 2] : ax === 2 ? [w / 2, h / 2, 0] : [w / 2, 0, h / 2];
    this.b.box([lo[0] - half[0], lo[1] - half[1], lo[2] - half[2]], [hi[0] + half[0], hi[1] + half[1], hi[2] + half[2]], m, { collide: false, tile: 1.2 });
    for (let u = lo[ax] + 1.2; u < hi[ax] - 0.1; u += 1.2) {
      const p0: V3 = [lo[0] - half[0] - 0.03, lo[1] - half[1] - 0.03, lo[2] - half[2] - 0.03];
      const p1: V3 = [hi[0] + half[0] + 0.03, hi[1] + half[1] + 0.03, hi[2] + half[2] + 0.03];
      p0[ax] = u - 0.025;
      p1[ax] = u + 0.025;
      this.b.box(p0, p1, fl, { collide: false, shadow: false });
    }
  }

  /** Cable tray: a shallow open channel with cables in it, along an axis. Visual only. */
  cableTray(a: V3, c: V3, w = 0.3): void {
    const m = this.b.flat(0x9a9d9e, 0.5, 0.6);
    const cab = this.b.flat(0x1a1b1c, 0.7);
    const alongX = Math.abs(c[0] - a[0]) > Math.abs(c[2] - a[2]);
    const [u0, u1] = alongX ? [Math.min(a[0], c[0]), Math.max(a[0], c[0])] : [Math.min(a[2], c[2]), Math.max(a[2], c[2])];
    const v = alongX ? a[2] : a[0], y = a[1];
    const put = (p0: number, p1: number, q0: number, q1: number, y0: number, y1: number, mm: THREE.Material): void => {
      if (alongX) this.b.box([p0, y0, q0], [p1, y1, q1], mm, { collide: false, shadow: false });
      else this.b.box([q0, y0, p0], [q1, y1, p1], mm, { collide: false, shadow: false });
    };
    put(u0, u1, v - w / 2, v + w / 2, y, y + 0.012, m);
    put(u0, u1, v - w / 2, v - w / 2 + 0.012, y, y + 0.08, m);
    put(u0, u1, v + w / 2 - 0.012, v + w / 2, y, y + 0.08, m);
    put(u0, u1, v - w / 2 + 0.03, v + w / 2 - 0.03, y + 0.012, y + 0.05, cab);
  }

  /** A box mounted on a wall: junction boxes, breaker panels, signs' backs, vents. */
  wallBox(face: Face, at: number, along: number, y: number, w: number, h: number, d: number, color = 0x7d8488, opts: { glow?: number; grille?: boolean } = {}): void {
    const m = this.b.flat(color, 0.55, 0.4);
    const out = face[0] === '+' ? 1 : -1;
    const p0 = at, p1 = at + out * d;
    const lo = Math.min(p0, p1), hi = Math.max(p0, p1);
    if (face[1] === 'z') this.b.box([along - w / 2, y, lo], [along + w / 2, y + h, hi], m, { collide: false });
    else this.b.box([lo, y, along - w / 2], [hi, y + h, along + w / 2], m, { collide: false });
    if (opts.grille) {
      const dark = this.b.flat(0x1e2022, 0.7);
      for (let k = 1; k < 6; k++) {
        const yy = y + (h * k) / 6;
        const q0 = at + out * d, q1 = at + out * (d + 0.01);
        const l2 = Math.min(q0, q1), h2 = Math.max(q0, q1);
        if (face[1] === 'z') this.b.box([along - w / 2 + 0.04, yy - 0.015, l2], [along + w / 2 - 0.04, yy + 0.015, h2], dark, { collide: false, shadow: false });
        else this.b.box([l2, yy - 0.015, along - w / 2 + 0.04], [h2, yy + 0.015, along + w / 2 - 0.04], dark, { collide: false, shadow: false });
      }
    }
    if (opts.glow) {
      const q0 = at + out * d, q1 = at + out * (d + 0.01);
      const l2 = Math.min(q0, q1), h2 = Math.max(q0, q1);
      const led = this.b.glow(opts.glow, 3);
      if (face[1] === 'z') this.b.box([along + w / 2 - 0.08, y + h - 0.08, l2], [along + w / 2 - 0.04, y + h - 0.04, h2], led, { collide: false, shadow: false });
      else this.b.box([l2, y + h - 0.08, along + w / 2 - 0.08], [h2, y + h - 0.04, along + w / 2 - 0.04], led, { collide: false, shadow: false });
    }
  }

  /** Weeds and ferns in the cracks: along wall bases and kerbs, only on open ground at `y`. */
  weeds(rect: Rect, y: number, n: number, opts: { clear?: Rect[] } = {}): number {
    return this.scatter(rect, y, n, [['fern_02', 1, { scale: 0.35 }], ['shrub_04', 2, { scale: 1.1 }], ['shrub_02', 0.6, { scale: 0.25 }]], { clear: opts.clear });
  }

  // ---------------------------------------------------------------------------------------------
  // Beyond the map

  /**
   * City blocks on the horizon outside `bounds`: dark masses with lit windows, in a ring from
   * `near` to `far` metres out. `sides` limits which sides of the map get them.
   */
  skyline(bounds: THREE.Box3, opts: { near?: number; far?: number; base?: number; h?: [number, number]; lit?: number; color?: number;
    sides?: Face[]; count?: number; day?: boolean } = {}): void {
    const near = opts.near ?? 25, far = opts.far ?? 120;
    const base = opts.base ?? 0;
    const [hMin, hMax] = opts.h ?? [12, 60];
    const sides = opts.sides ?? ['+x', '-x', '+z', '-z'];
    const mats: THREE.Material[] = [];
    for (let i = 0; i < 3; i++) {
      mats.push(this.material(`sky:${i}:${opts.day ? 1 : 0}:${opts.lit ?? 0.3}`, () => {
        const t = towerTexture(opts.lit ?? 0.3, 11 + i);
        return new THREE.MeshStandardMaterial({
          color: opts.color ?? (opts.day ? 0x7a8088 : 0x15181c), roughness: opts.day ? 0.35 : 0.9, metalness: opts.day ? 0.3 : 0,
          emissive: 0xffffff, emissiveMap: t, emissiveIntensity: opts.day ? 0.15 : 1.4, map: opts.day ? t : null,
        });
      }));
    }
    const n = opts.count ?? 60;
    for (let i = 0; i < n; i++) {
      const side = this.pick(sides);
      const d = near + (far - near) * Math.pow(this.r(), 0.8);
      const w = this.rand(10, 26), dep = this.rand(10, 26);
      let cx: number, cz: number;
      if (side[1] === 'x') {
        cx = side[0] === '+' ? bounds.max.x + d : bounds.min.x - d;
        cz = this.rand(bounds.min.z - far * 0.7, bounds.max.z + far * 0.7);
      } else {
        cz = side[0] === '+' ? bounds.max.z + d : bounds.min.z - d;
        cx = this.rand(bounds.min.x - far * 0.7, bounds.max.x + far * 0.7);
      }
      const h = this.rand(hMin, hMax) * (0.6 + 0.4 * (d / far));
      this.b.box([cx - w / 2, base, cz - dep / 2], [cx + w / 2, base + h, cz + dep / 2], this.pick(mats), { collide: false, tile: 12, shadow: false });
      // Red aircraft warning light on the tall ones
      if (h > hMax * 0.7) this.b.box([cx - 0.3, base + h, cz - 0.3], [cx + 0.3, base + h + 0.4, cz + 0.3], this.b.glow(0xff3a2a, 3), { collide: false, shadow: false });
    }
  }
}
