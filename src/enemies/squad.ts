import * as THREE from 'three';

/**
 * Squad-level coordination shared by every bot:
 *  - shared intel: the freshest report of where the player is, delayed a little (it travels
 *    by "radio"), plus how long the player has been sitting in one place (camping)
 *  - attack tokens: only a few bots may actively shoot at once; the rest reposition, flank or
 *    suppress. That keeps fights readable and makes the squad look coordinated instead of
 *    every bot standing in the open shooting
 *  - flank sides, so two flankers go around opposite sides
 *  - a shared grenade cooldown
 */
export class Squad {
  /** Best known player position (ground level) and its age in seconds. */
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  age = Infinity;
  /** Was the last report a direct sighting (vs. heard / inferred)? */
  confirmed = false;
  private pending: { pos: THREE.Vector3; vel: THREE.Vector3; delay: number; confirmed: boolean }[] = [];
  /** Seconds the player has stayed within a few meters of `campAnchor`. */
  campTime = 0;
  private campAnchor = new THREE.Vector3(Infinity, 0, Infinity);
  private tokens = new Set<object>();
  private flankers = new Map<object, number>();
  grenadeCooldown = 6;
  /** Set when a squad mate died recently near this point (others get cautious). */
  lastDeath = new THREE.Vector3();
  lastDeathAge = Infinity;
  /** The player is reloading (heard nearby): a window to push. */
  playerReloadingT = 0;

  /** A bot reports what it knows; it reaches the others after `delay` seconds. */
  report(pos: THREE.Vector3, vel: THREE.Vector3, confirmed: boolean, delay = 0.6): void {
    this.pending.push({ pos: pos.clone().setY(0), vel: vel.clone(), delay, confirmed });
  }

  update(dt: number): void {
    this.age += dt;
    this.lastDeathAge += dt;
    this.grenadeCooldown -= dt;
    this.playerReloadingT -= dt;
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      p.delay -= dt;
      if (p.delay <= 0) {
        // Prefer confirmed sightings over hearsay of similar age
        if (p.confirmed || !this.confirmed || this.age > 1.5) {
          this.pos.copy(p.pos);
          this.vel.copy(p.vel);
          this.age = 0;
          this.confirmed = p.confirmed;
        }
        this.pending.splice(i, 1);
      }
    }
    if (this.age < 2) {
      if (this.pos.distanceTo(this.campAnchor) < 3.5) this.campTime += dt;
      else {
        this.campAnchor.copy(this.pos);
        this.campTime = 0;
      }
    }
  }

  /** Try to take (or keep) one of the attack tokens. */
  requestToken(who: object, max: number): boolean {
    if (this.tokens.has(who)) return true;
    if (this.tokens.size >= max) return false;
    this.tokens.add(who);
    return true;
  }

  hasToken(who: object): boolean {
    return this.tokens.has(who);
  }

  releaseToken(who: object): void {
    this.tokens.delete(who);
  }

  /** -1 or 1: which side of the player this bot should go around. */
  flankSide(who: object): number {
    let s = this.flankers.get(who);
    if (s === undefined) {
      let left = 0;
      for (const v of this.flankers.values()) left += v < 0 ? 1 : -1;
      s = left > 0 ? 1 : -1;
      this.flankers.set(who, s);
    }
    return s;
  }

  forget(who: object): void {
    this.tokens.delete(who);
    this.flankers.delete(who);
  }

  reset(): void {
    this.age = Infinity;
    this.pending = [];
    this.campTime = 0;
    this.tokens.clear();
    this.flankers.clear();
    this.grenadeCooldown = 6;
    this.lastDeathAge = Infinity;
    this.playerReloadingT = 0;
  }
}
