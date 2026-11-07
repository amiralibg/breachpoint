import * as THREE from 'three';
import { Crowd, init as initRecast, NavMeshQuery, type CrowdAgent, type NavMesh } from 'recast-navigation';
import { generateSoloNavMesh } from 'recast-navigation/generators';

let ready: Promise<void> | null = null;

export function initNavigation(): Promise<void> {
  ready ??= initRecast();
  return ready;
}

const CS = 0.2; // voxel size (m)
const CH = 0.1; // voxel height (m)
export const AGENT_RADIUS = 0.4;

// DT_CROWD_ANTICIPATE_TURNS | OBSTACLE_AVOIDANCE | SEPARATION | OPTIMIZE_VIS | OPTIMIZE_TOPO
const CROWD_FLAGS = 1 | 2 | 4 | 8 | 16;

/**
 * Recast/Detour navigation: a real navmesh baked from the map colliders, path queries, and a
 * Detour crowd that moves the bots with local avoidance (they steer around each other instead of
 * bumping). Runs on WASM; the same module works in Node for a dedicated server.
 */
export class NavSystem {
  readonly navMesh: NavMesh;
  readonly query: NavMeshQuery;
  readonly crowd: Crowd;
  private ext = { x: 2, y: 4, z: 2 };

  constructor(bounds: THREE.Box3, colliders: THREE.Box3[]) {
    const positions: number[] = [];
    const indices: number[] = [];
    const quad = (a: number[], b: number[], c: number[], d: number[]): void => {
      const i = positions.length / 3;
      positions.push(...a, ...b, ...c, ...d);
      indices.push(i, i + 1, i + 2, i, i + 2, i + 3);
    };
    // Ground (counter-clockwise seen from above = facing up)
    const m = 2;
    const [x0, z0, x1, z1] = [bounds.min.x - m, bounds.min.z - m, bounds.max.x + m, bounds.max.z + m];
    quad([x0, 0, z0], [x0, 0, z1], [x1, 0, z1], [x1, 0, z0]);
    // Each collider as a closed box
    for (const b of colliders) {
      const { min: n, max: x } = b;
      quad([n.x, x.y, n.z], [n.x, x.y, x.z], [x.x, x.y, x.z], [x.x, x.y, n.z]); // top
      quad([n.x, n.y, n.z], [x.x, n.y, n.z], [x.x, x.y, n.z], [n.x, x.y, n.z]); // -z
      quad([x.x, n.y, x.z], [n.x, n.y, x.z], [n.x, x.y, x.z], [x.x, x.y, x.z]); // +z
      quad([n.x, n.y, x.z], [n.x, n.y, n.z], [n.x, x.y, n.z], [n.x, x.y, x.z]); // -x
      quad([x.x, n.y, n.z], [x.x, n.y, x.z], [x.x, x.y, x.z], [x.x, x.y, n.z]); // +x
    }
    const res = generateSoloNavMesh(positions, indices, {
      cs: CS,
      ch: CH,
      walkableSlopeAngle: 40,
      walkableHeight: Math.ceil(1.7 / CH),
      walkableClimb: Math.floor(0.35 / CH),
      walkableRadius: Math.ceil(AGENT_RADIUS / CS),
      maxEdgeLen: 12 / CS,
      maxSimplificationError: 1.3,
      minRegionArea: 8,
      mergeRegionArea: 20,
      maxVertsPerPoly: 6,
      detailSampleDist: 6,
      detailSampleMaxError: 1,
    });
    if (!res.success) throw new Error(`navmesh generation failed: ${res.error}`);
    this.navMesh = res.navMesh;
    this.query = new NavMeshQuery(this.navMesh);
    this.crowd = new Crowd(this.navMesh, { maxAgents: 48, maxAgentRadius: 0.6 });
  }

  /** Straight path from a to b, ground level (excludes the start point). */
  findPath(a: THREE.Vector3, b: THREE.Vector3): THREE.Vector3[] {
    const r = this.query.computePath(a, b, { halfExtents: this.ext });
    if (!r.success) return [];
    return r.path.slice(1).map((p) => new THREE.Vector3(p.x, 0, p.z));
  }

  /** Path length (m), or Infinity when unreachable. */
  pathLength(a: THREE.Vector3, b: THREE.Vector3): number {
    const pts = this.findPath(a, b);
    if (!pts.length) return Infinity;
    let len = 0;
    let prev = a.clone().setY(0);
    for (const p of pts) {
      len += prev.distanceTo(p);
      prev = p;
    }
    return len;
  }

  /** Nearest point on the navmesh, or null when nothing is within ~2 m. */
  closest(p: THREE.Vector3): THREE.Vector3 | null {
    const r = this.query.findClosestPoint(p, { halfExtents: this.ext });
    if (!r.success || !r.polyRef) return null;
    return new THREE.Vector3(r.point.x, r.point.y, r.point.z);
  }

  /** True if a bot can stand at p (within tolerance, horizontally). */
  walkable(p: THREE.Vector3, tol = 0.25): boolean {
    const c = this.closest(p);
    return !!c && Math.hypot(c.x - p.x, c.z - p.z) < tol && Math.abs(c.y - p.y) < 0.6;
  }

  /** Can a bot walk straight from a to b without leaving the mesh? */
  straightWalk(a: THREE.Vector3, b: THREE.Vector3): boolean {
    const s = this.query.findClosestPoint(a, { halfExtents: this.ext });
    if (!s.success) return false;
    const r = this.query.raycast(s.polyRef, s.point, b);
    return r.success && r.t >= 1;
  }

  randomPointAround(p: THREE.Vector3, radius: number): THREE.Vector3 | null {
    const r = this.query.findRandomPointAroundCircle(p, radius, { halfExtents: this.ext });
    if (!r.success) return null;
    return new THREE.Vector3(r.randomPoint.x, r.randomPoint.y, r.randomPoint.z);
  }

  addAgent(p: THREE.Vector3, maxSpeed: number): CrowdAgent {
    const at = this.closest(p) ?? p;
    return this.crowd.addAgent(at, {
      radius: AGENT_RADIUS,
      height: 1.8,
      maxAcceleration: 24,
      maxSpeed,
      collisionQueryRange: 3,
      pathOptimizationRange: 12,
      separationWeight: 2.2,
      updateFlags: CROWD_FLAGS,
      obstacleAvoidanceType: 3,
    });
  }

  removeAgent(a: CrowdAgent): void {
    this.crowd.removeAgent(a);
  }

  update(dt: number): void {
    this.crowd.update(dt);
  }

  dispose(): void {
    this.crowd.destroy();
    this.query.destroy();
    this.navMesh.destroy();
  }
}
