import * as THREE from 'three';

export interface RayHit {
  distance: number;
  point: THREE.Vector3;
  normal: THREE.Vector3;
}

const _ray = new THREE.Ray();
const _p = new THREE.Vector3();

// -------------------------------------------------------------------------------------------------
// Broad phase: a uniform grid over the colliders in XZ. A multi-floor map has well over a thousand
// boxes (every stair tread is one) and the bots cast many rays per tick, so rays walk the grid
// cells they cross instead of testing every box.

const CELL = 4;
const GRID_MIN_BOXES = 40;

interface Grid {
  count: number;
  x0: number;
  z0: number;
  nx: number;
  nz: number;
  cells: number[][];
  stamp: Int32Array;
  mark: number;
}

const grids = new WeakMap<THREE.Box3[], Grid>();

function buildGrid(boxes: THREE.Box3[]): Grid {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.min.x);
    z0 = Math.min(z0, b.min.z);
    x1 = Math.max(x1, b.max.x);
    z1 = Math.max(z1, b.max.z);
  }
  x0 -= 0.5;
  z0 -= 0.5;
  const nx = Math.max(1, Math.ceil((x1 + 0.5 - x0) / CELL));
  const nz = Math.max(1, Math.ceil((z1 + 0.5 - z0) / CELL));
  const cells: number[][] = Array.from({ length: nx * nz }, () => []);
  boxes.forEach((b, i) => {
    const ax = Math.max(0, Math.floor((b.min.x - x0) / CELL)), bx = Math.min(nx - 1, Math.floor((b.max.x - x0) / CELL));
    const az = Math.max(0, Math.floor((b.min.z - z0) / CELL)), bz = Math.min(nz - 1, Math.floor((b.max.z - z0) / CELL));
    for (let z = az; z <= bz; z++) for (let x = ax; x <= bx; x++) cells[z * nx + x].push(i);
  });
  return { count: boxes.length, x0, z0, nx, nz, cells, stamp: new Int32Array(boxes.length), mark: 0 };
}

function gridFor(boxes: THREE.Box3[]): Grid | null {
  if (boxes.length < GRID_MIN_BOXES) return null;
  let g = grids.get(boxes);
  if (!g || g.count !== boxes.length) {
    g = buildGrid(boxes);
    grids.set(boxes, g);
  }
  return g;
}

/** Call after moving, adding or removing boxes in a collider list (doors, shutters). */
export function collidersChanged(boxes: THREE.Box3[]): void {
  grids.delete(boxes);
}

/** Boxes whose XZ footprint may overlap the given rectangle (all of them for small lists). */
export function boxesNear(boxes: THREE.Box3[], x0: number, z0: number, x1: number, z1: number, out: THREE.Box3[] = []): THREE.Box3[] {
  out.length = 0;
  const g = gridFor(boxes);
  if (!g) {
    for (const b of boxes) out.push(b);
    return out;
  }
  const mark = ++g.mark;
  const ax = Math.max(0, Math.floor((x0 - g.x0) / CELL)), bx = Math.min(g.nx - 1, Math.floor((x1 - g.x0) / CELL));
  const az = Math.max(0, Math.floor((z0 - g.z0) / CELL)), bz = Math.min(g.nz - 1, Math.floor((z1 - g.z0) / CELL));
  for (let z = az; z <= bz; z++) {
    for (let x = ax; x <= bx; x++) {
      for (const i of g.cells[z * g.nx + x]) {
        if (g.stamp[i] === mark) continue;
        g.stamp[i] = mark;
        out.push(boxes[i]);
      }
    }
  }
  return out;
}

/** Nearest hit of a ray against axis-aligned world colliders. */
export function raycastBoxes(
  origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, boxes: THREE.Box3[],
): RayHit | null {
  _ray.set(origin, dir);
  let best: RayHit | null = null;
  const test = (b: THREE.Box3): void => {
    if (!_ray.intersectBox(b, _p)) return;
    const d = _p.distanceTo(origin);
    if (d > maxDist || (best && d >= best.distance)) return;
    best = { distance: d, point: _p.clone(), normal: boxNormal(b, _p) };
  };
  const g = gridFor(boxes);
  if (!g) {
    for (const b of boxes) test(b);
    return best;
  }
  // Walk the cells the ray crosses (Amanatides & Woo), starting where it enters the grid
  const gx1 = g.x0 + g.nx * CELL, gz1 = g.z0 + g.nz * CELL;
  let t = 0;
  let tEnd = maxDist;
  for (const [o, d, lo, hi] of [[origin.x, dir.x, g.x0, gx1], [origin.z, dir.z, g.z0, gz1]]) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return null;
      continue;
    }
    const a = (lo - o) / d, b = (hi - o) / d;
    t = Math.max(t, Math.min(a, b));
    tEnd = Math.min(tEnd, Math.max(a, b));
  }
  if (t > tEnd) return null;
  const sx = origin.x + dir.x * t, sz = origin.z + dir.z * t;
  let cx = Math.min(g.nx - 1, Math.max(0, Math.floor((sx - g.x0) / CELL)));
  let cz = Math.min(g.nz - 1, Math.max(0, Math.floor((sz - g.z0) / CELL)));
  const stepX = dir.x > 0 ? 1 : -1, stepZ = dir.z > 0 ? 1 : -1;
  const invX = Math.abs(dir.x) > 1e-9 ? 1 / dir.x : Infinity, invZ = Math.abs(dir.z) > 1e-9 ? 1 / dir.z : Infinity;
  let tMaxX = invX === Infinity ? Infinity : (g.x0 + (cx + (stepX > 0 ? 1 : 0)) * CELL - origin.x) * invX;
  let tMaxZ = invZ === Infinity ? Infinity : (g.z0 + (cz + (stepZ > 0 ? 1 : 0)) * CELL - origin.z) * invZ;
  const mark = ++g.mark;
  for (;;) {
    for (const i of g.cells[cz * g.nx + cx]) {
      if (g.stamp[i] === mark) continue;
      g.stamp[i] = mark;
      test(boxes[i]);
    }
    const tExit = Math.min(tMaxX, tMaxZ);
    if ((best && (best as RayHit).distance <= tExit) || tExit > tEnd) break;
    if (tMaxX < tMaxZ) {
      cx += stepX;
      if (cx < 0 || cx >= g.nx) break;
      tMaxX += CELL * Math.abs(invX);
    } else {
      cz += stepZ;
      if (cz < 0 || cz >= g.nz) break;
      tMaxZ += CELL * Math.abs(invZ);
    }
  }
  return best;
}

export function lineOfSight(a: THREE.Vector3, b: THREE.Vector3, boxes: THREE.Box3[]): boolean {
  const dir = _dir.subVectors(b, a);
  const len = dir.length();
  dir.divideScalar(len);
  return raycastBoxes(a, dir, len - 0.05, boxes) === null;
}
const _dir = new THREE.Vector3();

function boxNormal(b: THREE.Box3, p: THREE.Vector3): THREE.Vector3 {
  const eps = [
    [Math.abs(p.x - b.min.x), -1, 0, 0], [Math.abs(p.x - b.max.x), 1, 0, 0],
    [Math.abs(p.y - b.min.y), 0, -1, 0], [Math.abs(p.y - b.max.y), 0, 1, 0],
    [Math.abs(p.z - b.min.z), 0, 0, -1], [Math.abs(p.z - b.max.z), 0, 0, 1],
  ];
  eps.sort((x, y) => x[0] - y[0]);
  return new THREE.Vector3(eps[0][1], eps[0][2], eps[0][3]);
}

/** Ray vs sphere; returns distance or -1. */
export function raySphere(o: THREE.Vector3, d: THREE.Vector3, c: THREE.Vector3, r: number): number {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const h = b * b - cc;
  if (h < 0) return -1;
  const t = -b - Math.sqrt(h);
  return t >= 0 ? t : -1;
}

/** Ray vs vertical capsule (segment from y0 to y1 at x,z). Returns distance or -1. */
export function rayCapsule(
  o: THREE.Vector3, d: THREE.Vector3, x: number, z: number, y0: number, y1: number, r: number,
): number {
  // Infinite cylinder in XZ
  const ox = o.x - x, oz = o.z - z;
  const a = d.x * d.x + d.z * d.z;
  let best = -1;
  if (a > 1e-8) {
    const b = ox * d.x + oz * d.z;
    const c = ox * ox + oz * oz - r * r;
    const h = b * b - a * c;
    if (h >= 0) {
      const t = (-b - Math.sqrt(h)) / a;
      const y = o.y + d.y * t;
      if (t >= 0 && y >= y0 && y <= y1) best = t;
    }
  }
  // End caps
  for (const cy of [y0, y1]) {
    const t = raySphere(o, d, _c.set(x, cy, z), r);
    if (t >= 0 && (best < 0 || t < best)) best = t;
  }
  return best;
}
const _c = new THREE.Vector3();

/** Ray vs capsule around segment a-b with radius r (Inigo Quilez's formulation). Distance or -1. */
export function raySegment(o: THREE.Vector3, d: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, r: number): number {
  const ba = _ba.subVectors(b, a);
  const oa = _oa.subVectors(o, a);
  const baba = ba.dot(ba);
  const bard = ba.dot(d);
  const baoa = ba.dot(oa);
  const rdoa = d.dot(oa);
  const oaoa = oa.dot(oa);
  const A = baba - bard * bard;
  let B = baba * rdoa - baoa * bard;
  let C = baba * oaoa - baoa * baoa - r * r * baba;
  let h = B * B - A * C;
  if (h < 0) return -1;
  const t = A > 1e-9 ? (-B - Math.sqrt(h)) / A : 0;
  const y = baoa + t * bard;
  if (A > 1e-9 && y > 0 && y < baba) return t >= 0 ? t : -1;
  const oc = y <= 0 ? oa : _oc.subVectors(o, b);
  B = d.dot(oc);
  C = oc.dot(oc) - r * r;
  h = B * B - C;
  if (h <= 0) return -1;
  const tc = -B - Math.sqrt(h);
  return tc >= 0 ? tc : -1;
}
const _ba = new THREE.Vector3();
const _oa = new THREE.Vector3();
const _oc = new THREE.Vector3();
