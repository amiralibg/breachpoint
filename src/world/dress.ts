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
    if (!m) this.mats.set(key, (m = make()));
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
      if (alongX) b.box([u0, yy0, lo], [u1, yy1, hi], mat, { collide: false });
      else b.box([lo, yy0, u0], [hi, yy1, u1], mat, { collide: false });
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
      if (alongX) b.box([u0, y0, lo], [u1, y1, hi], mat, { collide: false });
      else b.box([lo, y0, u0], [hi, y1, u1], mat, { collide: false });
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
      if (alongX) this.b.box([u, y, z0 - w], [e, y + 0.012, z0 + w], mat, { collide: false });
      else this.b.box([x0 - w, y, u], [x0 + w, y + 0.012, e], mat, { collide: false });
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
      if (alongX) this.b.box([u, y, z0 - w / 2], [e, y + 0.01, z0 + w / 2], m, { collide: false });
      else this.b.box([x0 - w / 2, y, u], [x0 + w / 2, y + 0.01, e], m, { collide: false });
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
      this.b.box([cx - w / 2, base, cz - dep / 2], [cx + w / 2, base + h, cz + dep / 2], this.pick(mats), { collide: false, tile: 12 });
      // Red aircraft warning light on the tall ones
      if (h > hMax * 0.7) this.b.box([cx - 0.3, base + h, cz - 0.3], [cx + 0.3, base + h + 0.4, cz + 0.3], this.b.glow(0xff3a2a, 3), { collide: false });
    }
  }
}
