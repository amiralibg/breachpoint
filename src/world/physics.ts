import * as THREE from 'three';

export interface RayHit {
  distance: number;
  point: THREE.Vector3;
  normal: THREE.Vector3;
}

const _ray = new THREE.Ray();
const _p = new THREE.Vector3();

/** Nearest hit of a ray against axis-aligned world colliders. */
export function raycastBoxes(
  origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, boxes: THREE.Box3[],
): RayHit | null {
  _ray.set(origin, dir);
  let best: RayHit | null = null;
  for (const b of boxes) {
    if (!_ray.intersectBox(b, _p)) continue;
    const d = _p.distanceTo(origin);
    if (d > maxDist || (best && d >= best.distance)) continue;
    best = { distance: d, point: _p.clone(), normal: boxNormal(b, _p) };
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
