import * as THREE from 'three';
import type { NavGrid } from './nav';
import { lineOfSight } from './physics';

export interface CoverPoint {
  pos: THREE.Vector3;
  /** Points away from the obstacle (the side the bot stands on). */
  normal: THREE.Vector3;
  /** Low cover: crouch to hide, stand to shoot over it. Tall: step sideways to peek. */
  low: boolean;
  /** Bot currently using this point, if any. */
  claimedBy: object | null;
}

const LOW_EYE = 0.95;
const STAND_EYE = 1.6;

/** Cover positions sampled around every obstacle tall enough to hide behind. */
export class CoverMap {
  readonly points: CoverPoint[] = [];

  constructor(colliders: THREE.Box3[], nav: NavGrid, private colliderList = colliders) {
    for (const b of colliders) {
      const h = b.max.y - Math.max(0, b.min.y);
      if (b.min.y > 0.3 || h < 1.0) continue;
      const low = b.max.y < 1.5;
      const sides: [THREE.Vector3, THREE.Vector3, number, THREE.Vector3][] = [
        // origin, direction along side, length, outward normal
        [new THREE.Vector3(b.min.x, 0, b.min.z), new THREE.Vector3(1, 0, 0), b.max.x - b.min.x, new THREE.Vector3(0, 0, -1)],
        [new THREE.Vector3(b.min.x, 0, b.max.z), new THREE.Vector3(1, 0, 0), b.max.x - b.min.x, new THREE.Vector3(0, 0, 1)],
        [new THREE.Vector3(b.min.x, 0, b.min.z), new THREE.Vector3(0, 0, 1), b.max.z - b.min.z, new THREE.Vector3(-1, 0, 0)],
        [new THREE.Vector3(b.max.x, 0, b.min.z), new THREE.Vector3(0, 0, 1), b.max.z - b.min.z, new THREE.Vector3(1, 0, 0)],
      ];
      for (const [o, dir, len, n] of sides) {
        const count = Math.max(1, Math.floor(len / 1.6));
        for (let i = 0; i < count; i++) {
          const t = (i + 0.5) / count;
          const p = o.clone().addScaledVector(dir, len * t).addScaledVector(n, 0.75);
          const [cx, cz] = nav.cellOf(p);
          if (nav.isBlocked(cx, cz)) continue;
          if (Math.abs(p.x) > 39 || Math.abs(p.z) > 39) continue;
          this.points.push({ pos: p, normal: n.clone(), low, claimedBy: null });
        }
      }
    }
  }

  /** True when the point hides a crouching (low) or standing (tall) bot from `threat`. */
  protects(c: CoverPoint, threat: THREE.Vector3): boolean {
    const toThreat = new THREE.Vector3().subVectors(threat, c.pos).setY(0).normalize();
    if (toThreat.dot(c.normal) > -0.3) return false; // obstacle must be between us
    const eye = c.pos.clone().setY(c.low ? LOW_EYE : STAND_EYE);
    return !lineOfSight(eye, threat.clone().setY(1.5), this.colliderList);
  }

  /** Can a bot at this point shoot the threat (standing up / stepping out)? */
  peekPosition(c: CoverPoint, threat: THREE.Vector3): THREE.Vector3 | null {
    const t = threat.clone().setY(1.5);
    if (c.low) {
      return lineOfSight(c.pos.clone().setY(STAND_EYE), t, this.colliderList) ? c.pos : null;
    }
    const side = new THREE.Vector3(-c.normal.z, 0, c.normal.x);
    for (const s of [1.1, -1.1, 1.8, -1.8]) {
      const p = c.pos.clone().addScaledVector(side, s);
      if (lineOfSight(p.clone().setY(STAND_EYE), t, this.colliderList)) return p;
    }
    return null;
  }

  release(owner: object): void {
    for (const c of this.points) if (c.claimedBy === owner) c.claimedBy = null;
  }

  /**
   * Best free cover for a bot: protects from the threat, ideally lets it peek, at a preferred
   * distance from the threat, close to the bot, and optionally off to one side (flanking).
   */
  find(opts: {
    owner: object; from: THREE.Vector3; threat: THREE.Vector3;
    minDist: number; maxDist: number; maxTravel: number;
    flankDir?: THREE.Vector3; needPeek?: boolean;
  }): CoverPoint | null {
    let best: CoverPoint | null = null;
    let bestScore = Infinity;
    for (const c of this.points) {
      if (c.claimedBy && c.claimedBy !== opts.owner) continue;
      const dThreat = c.pos.distanceTo(opts.threat);
      if (dThreat < opts.minDist || dThreat > opts.maxDist) continue;
      const travel = c.pos.distanceTo(opts.from);
      if (travel > opts.maxTravel) continue;
      if (!this.protects(c, opts.threat)) continue;
      const peek = this.peekPosition(c, opts.threat);
      if (opts.needPeek && !peek) continue;
      let score = travel + (peek ? 0 : 6) + Math.abs(dThreat - (opts.minDist + opts.maxDist) / 2) * 0.3;
      if (opts.flankDir) {
        const dir = new THREE.Vector3().subVectors(c.pos, opts.threat).setY(0).normalize();
        score -= dir.dot(opts.flankDir) * 10;
      }
      // Avoid bunching up with other claimed points
      for (const o of this.points) {
        if (o !== c && o.claimedBy && o.claimedBy !== opts.owner && o.pos.distanceToSquared(c.pos) < 9) score += 4;
      }
      score += Math.random() * 1.5;
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
    return best;
  }
}
