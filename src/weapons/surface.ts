import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';

/**
 * The real shape of a gun (or one of its parts) as something hands can touch.
 *
 * Distances come from a BVH over the model's own triangles, so fingers stop on the actual
 * handguard ribs and trigger guard rather than on hand-placed proxy shapes. Gun models are open
 * shells, which have no reliable inside; a coarse voxel flood fill from outside the model marks
 * what is enclosed, so a point deep in the receiver still counts as inside.
 */
const CELL = 0.004;
const SHELL = 1;
const NEAR = 2;
const OUT = 4;

const _hit = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };

export class GunSurface {
  private bvh: MeshBVH;
  private grid: Uint8Array;
  private min = new THREE.Vector3();
  private nx = 0;
  private ny = 0;
  private nz = 0;
  readonly triangles: number;

  /** `toLocal` takes world space into the frame the surface is queried in. */
  constructor(meshes: THREE.Mesh[], toLocal: THREE.Matrix4) {
    const chunks: Float32Array[] = [];
    const v = new THREE.Vector3();
    const m = new THREE.Matrix4();
    let total = 0;
    for (const mesh of meshes) {
      const pos = mesh.geometry.getAttribute('position');
      const index = mesh.geometry.getIndex();
      const n = index ? index.count : pos.count;
      const out = new Float32Array(n * 3);
      m.multiplyMatrices(toLocal, mesh.matrixWorld);
      for (let i = 0; i < n; i++) {
        v.fromBufferAttribute(pos, index ? index.getX(i) : i).applyMatrix4(m);
        out[i * 3] = v.x;
        out[i * 3 + 1] = v.y;
        out[i * 3 + 2] = v.z;
      }
      chunks.push(out);
      total += out.length;
    }
    const positions = new Float32Array(Math.max(9, total));
    let o = 0;
    for (const c of chunks) {
      positions.set(c, o);
      o += c.length;
    }
    this.triangles = total / 9;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.bvh = new MeshBVH(geo);
    this.grid = this.voxelize(positions, total);
  }

  private voxelize(pos: Float32Array, count: number): Uint8Array {
    const box = new THREE.Box3();
    const p = new THREE.Vector3();
    for (let i = 0; i < count; i += 3) box.expandByPoint(p.set(pos[i], pos[i + 1], pos[i + 2]));
    if (box.isEmpty()) box.set(new THREE.Vector3(), new THREE.Vector3());
    box.expandByScalar(CELL * 3);
    this.min.copy(box.min);
    const size = box.getSize(new THREE.Vector3());
    const nx = (this.nx = Math.ceil(size.x / CELL));
    const ny = (this.ny = Math.ceil(size.y / CELL));
    const nz = (this.nz = Math.ceil(size.z / CELL));
    const grid = new Uint8Array(nx * ny * nz);
    const at = (x: number, y: number, z: number): number => x + nx * (y + ny * z);

    // Triangles -> shell voxels, sampled finer than a cell so nothing is skipped
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i < count; i += 9) {
      a.set(pos[i], pos[i + 1], pos[i + 2]);
      b.set(pos[i + 3], pos[i + 4], pos[i + 5]);
      c.set(pos[i + 6], pos[i + 7], pos[i + 8]);
      const edge = Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a));
      const n = Math.min(64, Math.max(1, Math.ceil(edge / (CELL * 0.6))));
      for (let u = 0; u <= n; u++) {
        for (let w = 0; w <= n - u; w++) {
          const s = u / n, t = w / n;
          const x = Math.floor((a.x + (b.x - a.x) * s + (c.x - a.x) * t - this.min.x) / CELL);
          const y = Math.floor((a.y + (b.y - a.y) * s + (c.y - a.y) * t - this.min.y) / CELL);
          const z = Math.floor((a.z + (b.z - a.z) * s + (c.z - a.z) * t - this.min.z) / CELL);
          grid[at(x, y, z)] |= SHELL;
        }
      }
    }
    // Thicken the shell by one cell so small gaps (vent holes, open seams) don't leak
    for (let z = 1; z < nz - 1; z++) for (let y = 1; y < ny - 1; y++) for (let x = 1; x < nx - 1; x++) {
      if (!(grid[at(x, y, z)] & SHELL)) continue;
      for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        grid[at(x + dx, y + dy, z + dz)] |= NEAR;
      }
    }
    // Flood the outside in from a corner (the padding guarantees it is empty)
    const stack = [0];
    grid[0] |= OUT;
    const push = (i: number): void => {
      if (grid[i] === 0) {
        grid[i] = OUT;
        stack.push(i);
      }
    };
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % nx;
      const y = Math.floor(i / nx) % ny;
      const z = Math.floor(i / (nx * ny));
      if (x > 0) push(i - 1);
      if (x < nx - 1) push(i + 1);
      if (y > 0) push(i - nx);
      if (y < ny - 1) push(i + nx);
      if (z > 0) push(i - nx * ny);
      if (z < nz - 1) push(i + nx * ny);
    }
    return grid;
  }

  /** Enclosed by the model and more than a cell from its surface. */
  private deepInside(p: THREE.Vector3): boolean {
    const x = Math.floor((p.x - this.min.x) / CELL);
    const y = Math.floor((p.y - this.min.y) / CELL);
    const z = Math.floor((p.z - this.min.z) / CELL);
    if (x < 0 || y < 0 || z < 0 || x >= this.nx || y >= this.ny || z >= this.nz) return false;
    return this.grid[x + this.nx * (y + this.ny * z)] === 0;
  }

  /**
   * Distance from p to the surface, negative when enclosed. Beyond `max` the exact value doesn't
   * matter to callers and `max` is returned (which keeps the query cheap).
   */
  distance(p: THREE.Vector3, max = 0.05): number {
    if (this.triangles === 0) return max;
    if (this.deepInside(p)) return -CELL;
    const hit = this.bvh.closestPointToPoint(p, _hit, 0, max);
    return hit ? hit.distance : max;
  }

  /** Closest surface point within `max`, or null. */
  closest(p: THREE.Vector3, out: THREE.Vector3, max = 0.05): number | null {
    if (this.triangles === 0) return null;
    const hit = this.bvh.closestPointToPoint(p, _hit, 0, max);
    if (!hit) return null;
    out.copy(hit.point);
    return this.deepInside(p) ? -hit.distance : hit.distance;
  }
}
