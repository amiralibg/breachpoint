import * as THREE from 'three';

/**
 * Walkability grid built from world colliders, with A* path finding.
 * Cells are CELL meters wide; a cell is blocked when an obstacle taller
 * than a step overlaps it (inflated by the agent radius).
 */
export class NavGrid {
  static readonly CELL = 1;
  readonly cols: number;
  readonly rows: number;
  private blocked: Uint8Array;
  private originX: number;
  private originZ: number;

  constructor(bounds: THREE.Box3, colliders: THREE.Box3[], agentRadius = 0.45) {
    const C = NavGrid.CELL;
    this.originX = bounds.min.x;
    this.originZ = bounds.min.z;
    this.cols = Math.ceil((bounds.max.x - bounds.min.x) / C);
    this.rows = Math.ceil((bounds.max.z - bounds.min.z) / C);
    this.blocked = new Uint8Array(this.cols * this.rows);
    for (const b of colliders) {
      if (b.max.y < 0.5) continue;
      const x0 = Math.floor((b.min.x - agentRadius - this.originX) / C);
      const x1 = Math.floor((b.max.x + agentRadius - this.originX) / C);
      const z0 = Math.floor((b.min.z - agentRadius - this.originZ) / C);
      const z1 = Math.floor((b.max.z + agentRadius - this.originZ) / C);
      for (let z = Math.max(0, z0); z <= Math.min(this.rows - 1, z1); z++) {
        for (let x = Math.max(0, x0); x <= Math.min(this.cols - 1, x1); x++) {
          this.blocked[z * this.cols + x] = 1;
        }
      }
    }
  }

  cellOf(p: THREE.Vector3): [number, number] {
    return [
      THREE.MathUtils.clamp(Math.floor((p.x - this.originX) / NavGrid.CELL), 0, this.cols - 1),
      THREE.MathUtils.clamp(Math.floor((p.z - this.originZ) / NavGrid.CELL), 0, this.rows - 1),
    ];
  }

  center(cx: number, cz: number, out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(this.originX + (cx + 0.5) * NavGrid.CELL, 0, this.originZ + (cz + 0.5) * NavGrid.CELL);
  }

  isBlocked(cx: number, cz: number): boolean {
    if (cx < 0 || cz < 0 || cx >= this.cols || cz >= this.rows) return true;
    return this.blocked[cz * this.cols + cx] === 1;
  }

  private nearestOpen(cx: number, cz: number): [number, number] {
    if (!this.isBlocked(cx, cz)) return [cx, cz];
    for (let r = 1; r < 8; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          if (!this.isBlocked(cx + dx, cz + dz)) return [cx + dx, cz + dz];
        }
      }
    }
    return [cx, cz];
  }

  /** A* from a to b. Returns world-space waypoints (excluding the start). */
  findPath(a: THREE.Vector3, b: THREE.Vector3, maxNodes = 4000): THREE.Vector3[] {
    const [sx, sz] = this.nearestOpen(...this.cellOf(a));
    const [gx, gz] = this.nearestOpen(...this.cellOf(b));
    const N = this.cols * this.rows;
    const start = sz * this.cols + sx;
    const goal = gz * this.cols + gx;
    if (start === goal) return [b.clone()];

    const g = new Float32Array(N).fill(Infinity);
    const came = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    const open = new MinHeap();
    g[start] = 0;
    open.push(start, this.h(sx, sz, gx, gz));
    let expanded = 0;

    while (open.size > 0 && expanded++ < maxNodes) {
      const cur = open.pop();
      if (cur === goal) break;
      if (closed[cur]) continue;
      closed[cur] = 1;
      const cx = cur % this.cols;
      const cz = (cur / this.cols) | 0;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const nx = cx + dx, nz = cz + dz;
          if (this.isBlocked(nx, nz)) continue;
          // No corner cutting
          if (dx && dz && (this.isBlocked(cx + dx, cz) || this.isBlocked(cx, cz + dz))) continue;
          const ni = nz * this.cols + nx;
          if (closed[ni]) continue;
          const ng = g[cur] + (dx && dz ? 1.4142 : 1);
          if (ng < g[ni]) {
            g[ni] = ng;
            came[ni] = cur;
            open.push(ni, ng + this.h(nx, nz, gx, gz));
          }
        }
      }
    }
    if (came[goal] === -1) return [];

    const cells: number[] = [];
    for (let c = goal; c !== start && c !== -1; c = came[c]) cells.push(c);
    cells.reverse();
    const pts = cells.map((c) => this.center(c % this.cols, (c / this.cols) | 0));
    pts[pts.length - 1] = b.clone().setY(0);
    return this.smooth(a, pts);
  }

  private h(ax: number, az: number, bx: number, bz: number): number {
    const dx = Math.abs(ax - bx), dz = Math.abs(az - bz);
    return dx + dz - 0.5858 * Math.min(dx, dz);
  }

  /** Drop waypoints that have a clear straight walk from the previous kept point. */
  private smooth(from: THREE.Vector3, pts: THREE.Vector3[]): THREE.Vector3[] {
    const out: THREE.Vector3[] = [];
    let anchor = from.clone().setY(0);
    let i = 0;
    while (i < pts.length) {
      let j = pts.length - 1;
      while (j > i && !this.walkable(anchor, pts[j])) j--;
      out.push(pts[j]);
      anchor = pts[j];
      i = j + 1;
    }
    return out;
  }

  private walkable(a: THREE.Vector3, b: THREE.Vector3): boolean {
    const dist = a.distanceTo(b);
    const steps = Math.ceil(dist / (NavGrid.CELL * 0.5));
    const p = new THREE.Vector3();
    for (let s = 1; s <= steps; s++) {
      p.lerpVectors(a, b, s / steps);
      const [cx, cz] = this.cellOf(p);
      if (this.isBlocked(cx, cz)) return false;
    }
    return true;
  }
}

class MinHeap {
  private items: number[] = [];
  private prio: number[] = [];
  get size(): number {
    return this.items.length;
  }
  push(item: number, p: number): void {
    const a = this.items, q = this.prio;
    a.push(item);
    q.push(p);
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (q[parent] <= q[i]) break;
      [a[i], a[parent]] = [a[parent], a[i]];
      [q[i], q[parent]] = [q[parent], q[i]];
      i = parent;
    }
  }
  pop(): number {
    const a = this.items, q = this.prio;
    const top = a[0];
    const lastI = a.pop()!, lastP = q.pop()!;
    if (a.length > 0) {
      a[0] = lastI;
      q[0] = lastP;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && q[l] < q[m]) m = l;
        if (r < a.length && q[r] < q[m]) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        [q[i], q[m]] = [q[m], q[i]];
        i = m;
      }
    }
    return top;
  }
}
