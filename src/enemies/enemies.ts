import * as THREE from 'three';
import type { CrowdAgent } from 'recast-navigation';
import { loadGlb } from '../core/assets';
import type { Audio, SampleName } from '../core/audio';
import type { EventBus } from '../game/events';
import type { HitZone, Vec3 } from '../net/protocol';
import type { Player } from '../player/player';
import { WEAPONS, weaponModel, type WeaponDef } from '../weapons/weapons';
import type { CoverMap, CoverPoint } from '../world/cover';
import type { Effects } from '../world/effects';
import { flashTexture } from '../world/effects';
import { surfaceAt } from '../world/map';
import type { NavSystem } from '../world/navmesh';
import { lineOfSight, raycastBoxes, raySegment, raySphere } from '../world/physics';
import { RAPIER, type PhysicsWorld } from '../world/physics3d';
import { retargetClips } from './retarget';
import { HOLDS, SoldierRig, type CharacterProto } from './rig';
import { Squad } from './squad';

export interface EnemyStats {
  health: number;
  speed: number;
  /** 0..1 skill: how tight the bot's aim gets once settled. */
  accuracy: number;
  damage: number;
  /** Pause between bursts (seconds). */
  fireInterval: number;
  /** Seconds between spotting the player and the first shot. */
  reaction: number;
  /** Practice dummies never shoot. */
  passive: boolean;
}

export interface EnemyHit {
  enemy: Enemy;
  distance: number;
  zone: HitZone;
  point: THREE.Vector3;
}

export type Role = 'rifleman' | 'flanker' | 'rusher' | 'marksman';
/** What the bot is doing (also shown by the F3 debug overlay). */
export type State =
  | 'patrol' | 'investigate' | 'search' | 'moveCover' | 'cover' | 'peek' | 'engage' | 'suppress'
  | 'flank' | 'push' | 'retreat' | 'reload' | 'throw' | 'evade';

const SIGHT_RANGE = 85;
const MAG = 30;
const RPM_INTERVAL = 0.092;
/** At most this many bots shoot at the player at the same time. */
const MAX_ATTACKERS = 3;

export interface EnemyCtx {
  time: number;
  player: Player;
  /** Player's view ray, and whether they are aiming down sights. */
  playerAim: { origin: THREE.Vector3; dir: THREE.Vector3; ads: boolean };
  nav: NavSystem;
  cover: CoverMap;
  colliders: THREE.Box3[];
  audio: Audio;
  effects: Effects;
  events: EventBus;
  onPlayerHit: (damage: number, from: THREE.Vector3, zone: HitZone) => void;
  /** Darkness and weather: multiplies how far and how quickly bots see (1 = clear daylight). */
  sightScale?: number;
  enemies: Enemy[];
  squad: Squad;
  grenades: GrenadeSystem;
}

const v3 = (v: THREE.Vector3): Vec3 => [v.x, v.y, v.z];
let nextId = 1;

export class Enemy {
  readonly id = nextId++;
  readonly rig: SoldierRig;
  readonly position: THREE.Vector3;
  private prevPos = new THREE.Vector3();
  private renderFacing = 0;
  agent: CrowdAgent | null = null;
  health: number;
  dead = false;
  deadTime = 0;
  role: Role;
  state: State = 'patrol';
  private facing = 0;
  private stateT = 0;
  private decideT = 0;
  private perceiveT = Math.random() * 0.1;

  // --- Perception & memory
  /** 0 = unaware, 1 = has spotted the player. */
  awareness = 0;
  /** Has been in a fight this life (stays more alert). */
  private combat = false;
  sees = false;
  private seeT = 0;
  private visibleFrac = 0;
  private known = new THREE.Vector3();
  private knownVel = new THREE.Vector3();
  /** Seconds since this bot itself knew where the player was. */
  sinceKnown = Infinity;
  private sinceSeen = Infinity;
  private settle = 0;
  private aimErr = new THREE.Vector3();

  // --- Combat
  private mag = MAG;
  private reloadT = 0;
  private burstLeft = 0;
  private shotT = 0;
  private burstPause = 0;
  suppressed = 0;
  private hurtT = Infinity;
  private target = new THREE.Vector3();
  private moveTarget: THREE.Vector3 | null = null;
  private moveSpeed = 0;
  private cover: CoverPoint | null = null;
  private peekPos: THREE.Vector3 | null = null;
  private peekSide = 0;
  private stuckT = 0;
  private lastProgress = new THREE.Vector3();
  private stepT = 0;
  private strafeT = 0;
  private strafe = new THREE.Vector3();
  private flash: THREE.Sprite;
  private flashT = 0;
  /** Scope glint (marksmen): grows while the shot is being lined up. */
  private glint: THREE.Sprite | null = null;
  private throwT = -1;
  private evadeFrom: THREE.Vector3 | null = null;
  private searchPts: THREE.Vector3[] = [];
  private flankCd = 4 + Math.random() * 6;
  bloodPooled = false;
  readonly weaponDef: WeaponDef;
  /** Posted bots stay within `leash` metres of `home` until they have something to fight. */
  home: THREE.Vector3 | null = null;
  leash = 7;
  /** Mission tag (spawn group name). */
  group = '';
  /** Friendly NPCs can't be hurt, never shoot, and follow the player when `follow` is set. */
  friendly = false;
  follow = false;
  /** Display name for the kill feed, if any. */
  label = '';

  constructor(proto: CharacterProto, gun: THREE.Object3D, muzzleZ: number, spawn: THREE.Vector3, readonly stats: EnemyStats,
    scene: THREE.Scene, role: Role, phys: PhysicsWorld | null, weaponDef: WeaponDef = WEAPONS[0]) {
    this.weaponDef = weaponDef;
    this.mag = weaponDef.magSize;
    this.rig = new SoldierRig(proto, gun, scene, muzzleZ, phys, HOLDS[weaponDef.id] ?? HOLDS.m4);
    this.rig.root.position.copy(spawn);
    this.position = spawn.clone();
    this.prevPos.copy(spawn);
    this.health = stats.health;
    this.role = role;
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({
      map: flashTexture, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    }));
    this.flash.visible = false;
    this.flash.scale.setScalar(0.32);
    this.rig.muzzle.add(this.flash);
    if (weaponDef.id === 'sniper') {
      this.glint = new THREE.Sprite(new THREE.SpriteMaterial({
        map: flashTexture, color: 0xd6ecff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
      }));
      this.glint.visible = false;
      this.glint.position.set(0, 0.09, -0.2); // the scope's front lens, in gun space
      this.rig.gunPivot.add(this.glint);
    }
    this.lastProgress.copy(spawn);
  }

  setFacing(yaw: number): void {
    this.facing = this.renderFacing = yaw;
  }

  /** Mission scripting: this bot now knows exactly where the player is. */
  alert(p: THREE.Vector3): void {
    this.known.copy(p);
    this.sinceKnown = 0;
    this.combat = true;
    this.awareness = Math.max(this.awareness, 0.85);
  }

  get eye(): THREE.Vector3 {
    return this.position.clone().setY(this.position.y + (this.rig.crouch > 0.5 ? 1.05 : 1.6));
  }

  get chest(): THREE.Vector3 {
    return this.rig.chestWorld;
  }

  raycast(o: THREE.Vector3, d: THREE.Vector3): { distance: number; zone: HitZone } | null {
    return this.rig.raycast(o, d);
  }

  /** Returns true if this killed the enemy. */
  damage(amount: number, dir: THREE.Vector3, from: THREE.Vector3, zone: HitZone, point: THREE.Vector3, ctx: Pick<EnemyCtx, 'squad' | 'events'>): boolean {
    if (this.dead || this.friendly) return false;
    this.health -= amount;
    // Getting shot reveals roughly where the shooter is and wakes the bot up immediately.
    this.known.copy(from);
    this.sinceKnown = 0;
    this.awareness = 1;
    this.combat = true;
    this.hurtT = 0;
    this.seeT = Math.max(this.seeT, this.stats.reaction * 0.6);
    this.suppressed = Math.max(this.suppressed, 1.4);
    ctx.squad.report(from, new THREE.Vector3(), false, 0.3);
    this.rig.hit(dir, Math.min(1.5, amount / 35), zone);
    if (this.health <= 0) {
      this.dead = true;
      this.flash.visible = false;
      if (this.glint) this.glint.visible = false;
      const force = zone === 'head' ? 11 : 12 + Math.min(amount, 120) * 0.07;
      this.rig.die(dir, zone, point, force);
      ctx.squad.forget(this);
      ctx.squad.lastDeath.copy(this.position);
      ctx.squad.lastDeathAge = 0;
      return true;
    }
    // Under fire while exposed: break off right away
    if (this.state === 'peek' || this.state === 'engage' || this.state === 'suppress') this.decideT = 0;
    return false;
  }

  suppress(amount: number): void {
    this.suppressed = Math.max(this.suppressed, amount);
    if (!this.combat) this.awareness = Math.max(this.awareness, 0.6);
  }

  /** Heard something at `pos` (gunshot, footsteps); `certainty` 0..1. */
  hear(pos: THREE.Vector3, certainty: number): void {
    if (this.sees) return;
    const err = (1 - certainty) * 6;
    const guess = pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * err, 0, (Math.random() - 0.5) * err));
    if (this.sinceKnown > 1.5 || certainty > 0.6) {
      this.known.copy(guess);
      this.knownVel.set(0, 0, 0);
      this.sinceKnown = Math.min(this.sinceKnown, 1.5);
    }
    this.awareness = Math.min(1, Math.max(this.awareness, 0.45 + certainty * 0.5));
    if (certainty > 0.5) this.combat = true;
  }

  /** Start the round knowing roughly where the player is (within ~12 m). */
  hunt(p: THREE.Vector3): void {
    this.known.copy(p).add(new THREE.Vector3((Math.random() - 0.5) * 24, 0, (Math.random() - 0.5) * 24));
    this.sinceKnown = 6;
    this.combat = true;
    this.awareness = 0.6;
  }

  /** A grenade landed nearby: get away from it. */
  warnGrenade(at: THREE.Vector3): void {
    if (this.dead || this.position.distanceTo(at) > 7.5) return;
    this.evadeFrom = at.clone();
    this.decideT = 0;
  }

  // =============================================================================================
  // Simulation tick

  tick(dt: number, ctx: EnemyCtx): void {
    if (this.dead) {
      this.deadTime += dt;
      return;
    }
    this.prevPos.copy(this.position);
    this.stateT += dt;
    this.hurtT += dt;
    this.flankCd -= dt;
    this.suppressed = Math.max(0, this.suppressed - dt);
    this.perceive(dt, ctx);

    this.decideT -= dt;
    if (this.decideT <= 0) {
      this.decideT = 0.25 + Math.random() * 0.2;
      this.decide(ctx);
    }
    this.act(dt, ctx);
  }

  /** Apply the crowd's movement result (after the crowd update). */
  syncFromAgent(ctx: EnemyCtx): void {
    if (this.dead || !this.agent) return;
    const p = this.agent.position();
    let y = Math.abs(p.y) < 0.3 ? 0 : p.y;
    if (y > 0) {
      // The navmesh smooths stairs into a slope: stand on the actual tread or floor
      const down = raycastBoxes(_feet.set(p.x, y + 0.9, p.z), _down, 1.8, ctx.colliders);
      if (down) y = down.point.y;
    }
    this.position.set(p.x, y, p.z);
    // Keep out of the player's body
    const pp = ctx.player.position;
    const dx = this.position.x - pp.x, dz = this.position.z - pp.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.75 && d > 1e-4) {
      this.position.x = pp.x + (dx / d) * 0.75;
      this.position.z = pp.z + (dz / d) * 0.75;
      this.agent.teleport(this.position);
    }
    const v = this.agent.velocity();
    this.rig.velocity.set(v.x, 0, v.z);
  }

  private perceive(dt: number, ctx: EnemyCtx): void {
    const p = ctx.player;
    this.sinceKnown += dt;
    this.sinceSeen += dt;
    this.perceiveT -= dt;
    if (this.perceiveT <= 0) {
      this.perceiveT = 0.1 + Math.random() * 0.05;
      let frac = 0;
      const dist = this.position.distanceTo(p.position);
      const sight = ctx.sightScale ?? 1;
      if (p.alive && dist < SIGHT_RANGE * sight) {
        const eye = this.eye;
        const fwd = new THREE.Vector3(Math.sin(this.facing), 0, Math.cos(this.facing));
        const to = new THREE.Vector3().subVectors(p.position, this.position).setY(0).normalize();
        const cos = fwd.dot(to);
        // Central vision 120 deg, peripheral to ~170 deg; very close you just notice them
        const inView = cos > -0.1 || dist < 3;
        if (inView) {
          const pts = [p.eye, p.position.clone().setY(p.position.y + p.height * 0.55), p.position.clone().setY(p.position.y + 0.3)];
          let vis = 0;
          for (const t of pts) if (lineOfSight(eye, t, ctx.colliders)) vis++;
          frac = vis / pts.length;
          if (frac > 0) {
            // Awareness gain: distance, angle, stance, movement and muzzle flashes all matter
            const central = cos > 0.5 ? 1 : cos > 0 ? 0.55 : 0.25;
            const range = THREE.MathUtils.clamp(1.4 - dist / (45 * sight), 0.12 * sight, 1.4);
            const stance = p.crouching ? 0.6 : 1;
            const motion = 0.6 + Math.min(1, p.moveFactor) * 0.6;
            const alert = this.combat ? 2.2 : 1;
            const gain = 2.4 * central * range * stance * motion * alert * (0.4 + frac * 0.6);
            this.awareness = Math.min(1, this.awareness + gain * 0.12);
          }
        }
      }
      const sees = frac > 0 && this.awareness >= 1;
      if (sees && !this.sees) {
        this.settle = 0;
        this.seeT = 0;
        if (this.sinceSeen > 4) ctx.events.emit({ type: 'callout', shooter: this.id, kind: 'contact', at: v3(p.position) });
      }
      this.sees = sees;
      this.visibleFrac = frac;
      if (frac === 0) this.awareness = Math.max(this.combat ? 0.5 : 0, this.awareness - 0.12 * 0.15);
      // Half-aware of something moving in view: remember roughly where
      if (frac > 0 && !sees && this.awareness > 0.35) {
        this.known.copy(p.position);
        this.sinceKnown = Math.min(this.sinceKnown, 2);
      }
    }
    if (this.sees) {
      this.combat = true;
      this.known.copy(p.position);
      this.knownVel.copy(p.velocity).setY(0);
      this.sinceKnown = 0;
      this.sinceSeen = 0;
      this.seeT += dt;
      ctx.squad.report(p.position, p.velocity, true);
      // Aim settles while tracking; target motion and own motion unsettle it
      const lateral = Math.min(1, p.moveFactor);
      const selfMove = this.rig.velocity.length() > 0.8 ? 0.45 : 0;
      this.settle = THREE.MathUtils.clamp(this.settle + dt * (0.85 - lateral * 0.3 - selfMove), 0, 1);
    } else {
      this.settle = Math.max(0, this.settle - dt * 0.6);
      // Squad intel fills in when the bot knows nothing fresher
      if (ctx.squad.age < this.sinceKnown && ctx.squad.age < 10) {
        this.known.copy(ctx.squad.pos);
        this.knownVel.copy(ctx.squad.vel);
        this.sinceKnown = ctx.squad.age;
        this.combat = true;
        this.awareness = Math.max(this.awareness, 0.7);
      }
    }
  }

  /** Best estimate of where the player is now (extrapolated for a moment), or null. */
  private threat(): THREE.Vector3 | null {
    if (this.sinceKnown > 25) return null;
    const ahead = Math.min(this.sinceKnown, 1.2);
    return this.known.clone().addScaledVector(this.knownVel, ahead);
  }

  private setState(s: State): void {
    if (this.state !== s) {
      this.state = s;
      this.stateT = 0;
    }
  }

  private go(p: THREE.Vector3, speed: number): void {
    this.moveTarget = p.clone();
    this.moveSpeed = speed;
    if (this.agent) {
      this.agent.maxSpeed = speed;
      this.agent.requestMoveTarget(p);
    }
    this.stuckT = 0;
    this.lastProgress.copy(this.position);
  }

  private stop(): void {
    this.moveTarget = null;
    this.moveSpeed = 0;
    this.agent?.resetMoveTarget();
  }

  private arrived(tol = 0.6): boolean {
    return !this.moveTarget || (Math.hypot(this.moveTarget.x - this.position.x, this.moveTarget.z - this.position.z) < tol
      && Math.abs(this.moveTarget.y - this.position.y) < 1.6);
  }

  private takeCover(ctx: EnemyCtx, threat: THREE.Vector3, opts: { min: number; max: number; travel: number; flank?: boolean; speed?: number }): boolean {
    let flankDir: THREE.Vector3 | undefined;
    if (opts.flank) {
      const toMe = new THREE.Vector3().subVectors(this.position, threat).setY(0).normalize();
      const side = ctx.squad.flankSide(this);
      flankDir = new THREE.Vector3(-toMe.z, 0, toMe.x).multiplyScalar(side).addScaledVector(toMe, -0.2).normalize();
    }
    ctx.cover.release(this);
    const avoid = ctx.enemies.filter((e) => e !== this && !e.dead).map((e) => e.position);
    if (ctx.squad.lastDeathAge < 8) avoid.push(ctx.squad.lastDeath);
    const cands = ctx.cover.rank({
      owner: this, from: this.position, threat, minDist: opts.min, maxDist: opts.max,
      maxTravel: opts.travel, flankDir, needPeek: !opts.flank, avoid,
    }, opts.flank ? 4 : 2);
    // Prefer the route that stays out of the player's sight the most
    let best: CoverPoint | null = null;
    let bestCost = Infinity;
    const eye = threat.clone().setY(threat.y + 1.5);
    for (const [i, c] of cands.entries()) {
      const path = ctx.nav.findPath(this.position, c.pos);
      if (!path.length) continue;
      let exposed = 0;
      let len = 0;
      let prev = this.position.clone();
      for (const wp of path) {
        const seg = prev.distanceTo(wp);
        len += seg;
        const steps = Math.max(1, Math.floor(seg / 2.5));
        for (let s = 1; s <= steps; s++) {
          const q = prev.clone().lerp(wp, s / steps);
          q.y += 1.4;
          if (lineOfSight(q, eye, ctx.colliders)) exposed += seg / steps;
        }
        prev = wp;
      }
      const cost = i * 2 + len * 0.3 + exposed * (opts.flank ? 2.5 : 1.2);
      if (cost < bestCost) {
        bestCost = cost;
        best = c;
      }
    }
    if (!best) {
      this.cover = null;
      return false;
    }
    best.claimedBy = this;
    this.cover = best;
    this.peekPos = null;
    this.go(best.pos, opts.speed ?? this.stats.speed);
    return true;
  }

  private atCover(): boolean {
    return !!this.cover && Math.hypot(this.cover.pos.x - this.position.x, this.cover.pos.z - this.position.z) < 0.9
      && Math.abs(this.cover.pos.y - this.position.y) < 1.6;
  }

  // ---------------------------------------------------------------------------------------------
  // Decisions

  private decide(ctx: EnemyCtx): void {
    const p = ctx.player;
    const sq = ctx.squad;
    const hp = this.health / this.stats.health;
    const threat = this.threat();
    const dist = threat ? this.position.distanceTo(threat) : Infinity;
    const atCover = this.atCover();
    const protectedNow = !!threat && atCover && !!this.cover && ctx.cover.protects(this.cover, threat);

    if (this.friendly) {
      // Escort: keep close behind the player, wait when they stop
      this.setState('patrol');
      if (this.follow) {
        const d = this.position.distanceTo(p.position);
        if (d > 3.2) {
          const dest = ctx.nav.closest(p.position) ?? p.position;
          this.go(dest, d > 9 ? 6.4 : 4.2);
        } else this.stop();
      } else this.stop();
      return;
    }
    if (this.stats.passive) {
      // Practice targets: jog between random cover points
      if (this.arrived() || this.stateT > 12) {
        const pts = ctx.cover.points;
        if (pts.length) this.go(pts[Math.floor(Math.random() * pts.length)].pos, this.stats.speed);
        this.setState('patrol');
      }
      return;
    }

    // ----- Grenade nearby: get clear before anything else
    if (this.evadeFrom) {
      const away = new THREE.Vector3().subVectors(this.position, this.evadeFrom).setY(0);
      if (away.length() > 7.5 || this.stateT > 3 && this.state === 'evade') {
        this.evadeFrom = null;
      } else {
        if (this.state !== 'evade') {
          const dir = away.lengthSq() > 0.01 ? away.normalize() : new THREE.Vector3(1, 0, 0);
          const dest = ctx.nav.closest(this.position.clone().addScaledVector(dir, 8)) ?? ctx.nav.randomPointAround(this.position, 8);
          if (dest) this.go(dest, this.stats.speed * 1.15);
          this.setState('evade');
        }
        return;
      }
    }

    // ----- Throwing: finish the throw
    if (this.state === 'throw' && this.throwT >= 0) return;

    // ----- Reload: get behind something first if we can
    const lowMag = this.mag < this.weaponDef.magSize * 0.3 && !this.sees && this.sinceSeen > 1.5;
    if ((this.mag === 0 || lowMag) && this.reloadT <= 0) {
      if (this.state !== 'reload') {
        this.setState('reload');
        ctx.events.emit({ type: 'callout', shooter: this.id, kind: 'reloading', at: v3(this.position) });
        sq.releaseToken(this);
        if (!(threat && !protectedNow && this.takeCover(ctx, threat, { min: 5, max: 45, travel: 9 }))) this.stop();
      }
      if (this.arrived() || this.stateT > 3.5) {
        this.reloadT = 2.6;
        this.stop();
        ctx.audio.play('mag_out', { pos: this.position, gain: 0.6 }) || ctx.audio.click(this.position, 0.7);
      }
      return;
    }
    if (this.state === 'reload') {
      if (this.reloadT > 0) return;
      this.setState(atCover ? 'cover' : 'engage');
    }

    if (!threat) {
      sq.releaseToken(this);
      this.patrolOrSearch(ctx);
      return;
    }

    // Not yet sure what that was: turn and look, edge toward it carefully
    if (!this.combat) {
      this.setState('investigate');
      if (this.arrived(1.5) || this.stateT > 6) this.go(threat, this.stats.speed * 0.45);
      return;
    }

    // ----- Badly hurt: fall back to cover further away
    if (hp < 0.35 && this.role !== 'rusher' && this.state !== 'retreat' && !(protectedNow && this.state === 'cover')) {
      sq.releaseToken(this);
      if (this.takeCover(ctx, threat, { min: 16, max: 50, travel: 22 })) {
        this.setState('retreat');
        return;
      }
    }
    if (this.state === 'retreat') {
      if (atCover || this.arrived()) this.setState('cover');
      return;
    }

    // ----- Grenade: the player has been holding one spot behind cover
    const playerHidden = !this.sees && this.sinceKnown < 5;
    if (playerHidden && sq.grenadeCooldown <= 0 && (sq.campTime > 4 || this.sinceSeen > 3) && dist > 9 && dist < 32 && hp > 0.3) {
      const target = ctx.squad.age < 3 ? sq.pos : threat;
      const friendlyNear = ctx.enemies.some((e) => !e.dead && e !== this && e.position.distanceTo(target) < 7);
      if (!friendlyNear && ctx.grenades.canThrow(this.eye, target, ctx.colliders)) {
        this.stop();
        this.throwT = 0;
        this.target.copy(target);
        sq.grenadeCooldown = 9 + Math.random() * 5;
        this.setState('throw');
        ctx.events.emit({ type: 'callout', shooter: this.id, kind: 'grenade', at: v3(target) });
        return;
      }
    }

    // ----- Push: rushers, point blank, a hurt or reloading player
    const playerWeak = p.health < 30 && dist < 22;
    const pushWindow = sq.playerReloadingT > 0 && dist < 18;
    const holdsBack = this.role === 'marksman';
    // A rusher closes from anywhere he can see the fight; he used to trade shots from across the map
    if ((this.role === 'rusher' && dist < 75) || (dist < 6 && this.sees) || ((playerWeak || pushWindow) && hp > 0.5 && !holdsBack)) {
      if (this.state !== 'push' || this.arrived(2) || this.stateT > 1.5) {
        this.setState('push');
        this.go(threat, this.stats.speed);
      }
      sq.requestToken(this, MAX_ATTACKERS + 1);
      return;
    }

    // ----- Flank: someone keeps the player busy while flankers go around
    const camping = sq.campTime > 5 || (this.sinceSeen > 4 && this.sinceKnown < 6);
    const wantsFlank = this.role === 'flanker' || (camping && this.role === 'rifleman' && !sq.hasToken(this) && Math.random() < 0.2);
    if (wantsFlank && this.flankCd <= 0 && dist > 10 && this.state !== 'flank') {
      if (!sq.hasToken(this) || camping) {
        this.flankCd = 9 + Math.random() * 7;
        sq.releaseToken(this);
        if (this.takeCover(ctx, threat, { min: 7, max: Math.max(12, Math.min(dist, 32)), travel: 40, flank: true })) {
          this.setState('flank');
          ctx.events.emit({ type: 'callout', shooter: this.id, kind: 'flanking', at: v3(this.cover!.pos) });
          return;
        }
      }
    }

    switch (this.state) {
      case 'flank':
      case 'moveCover':
        if (atCover || this.arrived()) {
          this.setState('cover');
          return;
        }
        if (this.cover && !ctx.cover.protects(this.cover, threat) && this.stateT > 1.5) {
          // The player moved and the planned cover no longer helps
          if (!this.takeCover(ctx, threat, { min: 6, max: 30, travel: 14 })) this.setState('engage');
        }
        // Spotted on the way and we have a shot: take it
        if (this.sees && this.state === 'moveCover' && this.hurtT > 2 && sq.requestToken(this, MAX_ATTACKERS) && dist < 25) {
          this.stop();
          this.setState('engage');
        }
        return;

      case 'cover': {
        if (!this.cover || !ctx.cover.protects(this.cover, threat)) {
          // Flanked: find new cover
          if (this.takeCover(ctx, threat, { min: 6, max: 30, travel: 14 })) this.setState('moveCover');
          else this.setState('engage');
          return;
        }
        const hide = this.suppressed > 0 ? 2.4 : 0.9 + Math.random() * 1.2;
        if (this.stateT < hide) return;
        // A pistol is no use from across the yard: close the distance instead of trading shots
        if (this.weaponDef.id === 'pistol' && dist > 20) {
          this.advance(ctx, threat, dist);
          return;
        }
        // Only token holders pop up to fight; the rest suppress from cover or reposition
        if (sq.requestToken(this, MAX_ATTACKERS)) {
          this.peekPos = ctx.cover.peekPosition(this.cover, threat);
          if (this.peekPos) {
            this.peekSide = this.cover.low ? 0 : Math.sign(
              new THREE.Vector3().subVectors(this.peekPos, this.cover.pos).dot(new THREE.Vector3(Math.cos(this.facing), 0, -Math.sin(this.facing))));
            this.go(this.peekPos, 2.4);
            this.setState('peek');
            return;
          }
          this.advance(ctx, threat, dist);
          return;
        }
        // Covering fire: keep the player's head down while a squad mate is crossing open ground
        const mateMoving = sq.age < 6 && ctx.enemies.some((e) => e !== this && !e.dead
          && (e.state === 'moveCover' || e.state === 'flank' || e.state === 'push') && e.position.distanceTo(this.position) < 30);
        if ((this.sinceKnown < 4 || mateMoving) && this.canSuppress(ctx, threat)) {
          this.setState('suppress');
          return;
        }
        // A marksman keeps his position; everyone else works forward
        if (this.stateT > (this.role === 'marksman' ? 14 : 6)) this.advance(ctx, threat, dist);
        return;
      }

      case 'peek': {
        const peekTime = this.sees ? 1.4 + Math.random() * 1.6 : 1.6;
        if (this.stateT > peekTime || this.suppressed > 0.9 || this.hurtT < 0.4) {
          this.peekPos = null;
          sq.releaseToken(this);
          if (this.sinceSeen > 5 && this.role !== 'rifleman') this.advance(ctx, threat, dist);
          else {
            if (this.cover) this.go(this.cover.pos, 2.6);
            this.setState('cover');
          }
        }
        return;
      }

      case 'suppress':
        if (this.stateT > 2.5 + Math.random() || this.sees || this.suppressed > 1) {
          if (this.cover) this.go(this.cover.pos, 2.6);
          this.setState('cover');
        }
        return;

      case 'engage': {
        // Exposed: get to cover if pressed, otherwise keep fighting (strafing) from here
        const aimedAt = this.playerAimingAtMe(ctx);
        const pressed = this.suppressed > 0.4 || this.hurtT < 1 || aimedAt;
        if (this.weaponDef.id === 'pistol' && dist > 22 && this.stateT > 0.6) {
          sq.releaseToken(this);
          this.advance(ctx, threat, dist);
          return;
        }
        if (!sq.hasToken(this) && !sq.requestToken(this, MAX_ATTACKERS)) {
          this.advance(ctx, threat, dist);
          return;
        }
        if ((this.stateT > 0.8 && pressed) || this.stateT > 4 || (!this.sees && this.stateT > 1.2)) {
          sq.releaseToken(this);
          this.advance(ctx, threat, dist);
        }
        return;
      }

      case 'push':
        if (dist > 14 && this.role !== 'rusher' && !this.sees) this.advance(ctx, threat, dist);
        else if (this.arrived(2) || this.stateT > 1.2) this.go(threat, this.stats.speed);
        return;

      case 'investigate':
      case 'search':
      case 'patrol':
        if (this.sees) {
          if (!this.takeCover(ctx, threat, { min: 6, max: Math.max(10, dist), travel: 10 })) this.setState('engage');
          else this.setState('moveCover');
        } else this.advance(ctx, threat, dist);
        return;

      default:
        this.advance(ctx, threat, dist);
    }
  }

  /** Move up to the next cover toward the player. */
  private advance(ctx: EnemyCtx, threat: THREE.Vector3, dist: number): void {
    // Fight at the range the weapon is good at: a marksman hangs back, a pistol has to get close
    const w = this.weaponDef.id;
    const keep = w === 'sniper' ? 26 : w === 'pistol' ? 5 : this.role === 'rifleman' ? 12 : 8;
    const reach = w === 'sniper' ? 60 : w === 'pistol' ? 15 : 30;
    const max = Math.max(keep + 4, Math.min(w === 'sniper' ? dist + 12 : dist - 2, reach));
    if (this.takeCover(ctx, threat, { min: Math.min(keep, max - 2), max, travel: 22 })) {
      this.setState('moveCover');
      return;
    }
    if (this.sees) {
      this.stop();
      this.setState('engage');
      return;
    }
    this.go(threat, this.stats.speed * 0.8);
    this.setState('search');
  }

  private patrolOrSearch(ctx: EnemyCtx): void {
    if (this.combat) {
      // Lost contact: sweep around the last known area
      if (this.state !== 'search') {
        this.setState('search');
        const around = this.known;
        this.searchPts = [];
        for (let i = 0; i < 4; i++) {
          const q = ctx.nav.randomPointAround(around, 10);
          if (q) this.searchPts.push(q);
        }
        ctx.events.emit({ type: 'callout', shooter: this.id, kind: 'lostHim', at: v3(around) });
      }
      if (this.arrived(1) || this.stateT > 10) {
        const next = this.searchPts.shift();
        if (next) this.go(next, this.stats.speed * 0.55);
        else this.combat = this.sinceKnown < 40;
        this.stateT = 0;
      }
      return;
    }
    this.setState('patrol');
    if (this.home) {
      // On post: stand a while, then wander a few steps around it
      if (this.arrived() && this.moveTarget) this.stop();
      if (this.stateT > this.patrolWait) {
        const q = this.leash > 0.5 ? ctx.nav.randomPointAround(this.home, this.leash) : null;
        if (q && Math.abs(q.y - this.home.y) < 1.2) this.go(q, this.stats.speed * 0.3);
        this.patrolWait = 4 + Math.random() * 7;
        this.stateT = 0;
      }
      return;
    }
    if (this.arrived() || this.stateT > 15) {
      const pts = ctx.cover.points;
      if (pts.length) this.go(pts[Math.floor(Math.random() * pts.length)].pos, this.stats.speed * 0.4);
      this.stateT = 0;
    }
  }
  private patrolWait = Math.random() * 5;

  private canSuppress(ctx: EnemyCtx, threat: THREE.Vector3): boolean {
    // Standing up / stepping out gives a line to the area the player is hiding in
    const from = (this.cover && ctx.cover.peekPosition(this.cover, threat)) ?? this.position;
    return lineOfSight(from.clone().setY(from.y + 1.6), threat.clone().setY(threat.y + 1.6), ctx.colliders)
      || lineOfSight(from.clone().setY(from.y + 1.6), threat.clone().setY(threat.y + 2.2), ctx.colliders);
  }

  /** Is the player looking down their sights at this bot? */
  private playerAimingAtMe(ctx: EnemyCtx): boolean {
    const a = ctx.playerAim;
    if (!a.ads) return false;
    const to = this.chest.sub(a.origin);
    const along = to.dot(a.dir);
    if (along <= 0) return false;
    const miss = to.addScaledVector(a.dir, -along).length();
    return miss < 1 && this.visibleFrac > 0;
  }

  // ---------------------------------------------------------------------------------------------
  // Acting on the decision every tick

  private act(dt: number, ctx: EnemyCtx): void {
    const p = ctx.player;
    const s = this.state;
    const threat = this.threat();

    // ----- Reloading timer
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      this.rig.reload = 1 - this.reloadT / 2.6;
      if (this.reloadT <= 0) {
        this.mag = this.weaponDef.magSize;
        this.rig.reload = -1;
        ctx.audio.play('mag_in', { pos: this.position, gain: 0.6 }) || ctx.audio.click(this.position, 0.9);
      }
    }

    // ----- Grenade throw
    if (this.throwT >= 0) {
      this.throwT += dt;
      this.rig.throwT = this.throwT / 0.9;
      if (this.throwT > 0.55 && this.throwT - dt <= 0.55) ctx.grenades.throw(this, this.eye.add(new THREE.Vector3(0, 0.3, 0)), this.target, ctx);
      if (this.throwT > 0.9) {
        this.throwT = -1;
        this.rig.throwT = -1;
        this.setState('cover');
        this.decideT = 0;
      }
    }

    // ----- Evasive strafing when exposed and engaged
    if (this.agent && (s === 'engage' || s === 'push' && this.sees && this.position.distanceTo(p.position) < 5)) {
      this.strafeT -= dt;
      if (this.strafeT <= 0 && threat) {
        this.strafeT = 0.6 + Math.random() * 1.2;
        const toT = new THREE.Vector3().subVectors(threat, this.position).setY(0).normalize();
        const side = Math.random() < 0.2 ? 0 : Math.random() < 0.5 ? -1 : 1;
        const fwdBias = s === 'push' ? 0.3 : -0.15;
        this.strafe.set(-toT.z, 0, toT.x).multiplyScalar(side).addScaledVector(toT, fwdBias);
        const dest = ctx.nav.closest(this.position.clone().addScaledVector(this.strafe, 2.5));
        if (dest) this.go(dest, s === 'push' ? 3 : 1.9);
      }
    } else if (s === 'cover' || s === 'suppress') {
      if (this.cover && !this.atCover() && this.arrived(0.3) === false && !this.moveTarget) this.go(this.cover.pos, 2.4);
    }

    // ----- Stuck detection
    if (this.moveTarget) {
      this.stuckT += dt;
      if (this.stuckT > 2) {
        if (this.position.distanceTo(this.lastProgress) < 0.4) {
          const alt = ctx.nav.randomPointAround(this.position, 3);
          if (alt) this.go(alt, this.moveSpeed || 2);
          this.decideT = 0;
        }
        this.stuckT = 0;
        this.lastProgress.copy(this.position);
      }
    }

    // ----- Posture
    const speed = this.rig.velocity.length();
    const behindLowCover = !!this.cover?.low && this.atCover();
    let crouch = (s === 'cover' && behindLowCover) || (s === 'reload' && !this.moveTarget && behindLowCover)
      || (this.suppressed > 0.6 && s !== 'push' && s !== 'retreat' && s !== 'evade' && s !== 'flank');
    if (s === 'flank' && this.cover?.low && speed < 3.5) crouch = true; // sneak along low walls
    if (s === 'investigate' && this.awareness < 0.8) crouch = speed < 1.5;
    if (s === 'suppress' && this.cover?.low) crouch = false;
    if (this.reloadT > 0 && behindLowCover) crouch = true;
    // A marksman in the open drops to a knee for a steady shot
    if (this.role === 'marksman' && (s === 'engage' || s === 'peek' && this.cover?.low) && speed < 0.4) crouch = true;
    this.rig.crouchTarget = crouch ? 1 : 0;
    this.rig.leanTarget = s === 'peek' || s === 'suppress' ? this.peekSide * 0.8 : 0;
    const engaging = !!threat && (this.sees || this.sinceSeen < 1.5 || s === 'suppress') && this.reloadT <= 0;
    this.rig.aimTarget = engaging && s !== 'retreat' && s !== 'evade' ? 1 : threat && this.combat && s !== 'patrol' ? 0.3 : 0;
    if (threat) {
      this.rig.aimPoint.copy(this.sees ? p.eye.setY(p.eye.y - 0.35) : threat.clone().setY(threat.y + 1.3));
      this.rig.lookWeight = 1;
    } else this.rig.lookWeight = 0;

    // Face the threat while engaged or covering, otherwise the way we're going
    const faceThreat = threat && (engaging || s === 'cover' || s === 'peek' || s === 'suppress' || s === 'investigate'
      || (s === 'moveCover' && speed < 3.2) || s === 'push' || s === 'reload' && !this.moveTarget || s === 'throw');
    if (faceThreat && threat) this.faceTowards(new THREE.Vector3().subVectors(s === 'throw' ? this.target : threat, this.position), dt, 8);
    else if (speed > 0.3) this.faceTowards(this.rig.velocity, dt, 7);

    // Footsteps (positional - lets the player hear them coming)
    if (speed > 2.2) {
      this.stepT -= dt * speed;
      if (this.stepT <= 0) {
        this.stepT = 2.6;
        if (this.position.distanceTo(p.position) < 30) {
          ctx.audio.step(surfaceAt(this.position), this.position, speed > 3.5 ? 1.1 : 0.6);
        }
      }
    }

    // ----- Shooting (bursts) at the player or, when suppressing, at where they hide
    this.shotT -= dt;
    this.burstPause -= dt;
    const stance = s === 'peek' || s === 'engage' || s === 'push' || s === 'moveCover' && this.sees || s === 'suppress';
    const suppressing = s === 'suppress' && !this.sees && !!threat;
    const canShoot = !this.stats.passive && this.reloadT <= 0 && this.mag > 0 && this.throwT < 0 && p.alive && stance
      && this.rig.aim > 0.6 && ((this.sees && this.seeT > this.stats.reaction) || suppressing)
      // A scoped shot is lined up, not snapped: the glint is the player's warning to move
      && (this.weaponDef.id !== 'sniper' || this.settle > 0.7 || suppressing);
    const isSniper = this.weaponDef.id === 'sniper';
    const interval = isSniper ? 1.2 : this.weaponDef.id === 'pistol' ? 0.22 : RPM_INTERVAL;
    if (canShoot && this.shotT <= 0) {
      if (this.burstLeft <= 0 && this.burstPause <= 0) {
        const dist = this.position.distanceTo(p.position);
        this.burstLeft = isSniper
          ? 1
          : suppressing
          ? 3 + Math.floor(Math.random() * 3)
          : dist < 12
          ? 4 + Math.floor(Math.random() * 4)
          : 2 + Math.floor(Math.random() * 3);
      }
      if (this.burstLeft > 0) {
        this.burstLeft--;
        this.shotT = interval * (0.9 + Math.random() * 0.3);
        this.shoot(ctx, speed > 0.8, suppressing ? threat! : null);
        if (this.burstLeft === 0) {
          this.burstPause = isSniper
            ? 1.4 + Math.random() * 0.8
            : this.stats.fireInterval * (suppressing ? 1.3 : 0.6 + Math.random() * 0.8);
        }
      }
    }
    if (this.mag === 0 && this.reloadT <= 0 && this.state !== 'reload') this.decideT = 0;

    this.flashT -= dt;
    this.flash.visible = this.flashT > 0;
    if (this.glint) {
      const lining = isSniper && this.sees && this.rig.aim > 0.8 && this.reloadT <= 0 && !this.stats.passive;
      this.glint.visible = lining;
      if (lining) this.glint.scale.setScalar(0.1 + this.settle * 0.3 + Math.sin(ctx.time * 30) * 0.02);
    }
  }

  private faceTowards(dir: THREE.Vector3, dt: number, rate: number): void {
    if (dir.lengthSq() < 1e-6) return;
    const target = Math.atan2(dir.x, dir.z);
    let diff = target - this.facing;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.facing += diff * Math.min(1, dt * rate);
  }

  /**
   * Fire one round. The aim point drifts toward the player with an error that shrinks as the
   * aim settles; the bullet is then traced for real against the world, squad mates and the
   * player's capsule, so cover actually stops it.
   */
  private shoot(ctx: EnemyCtx, moving: boolean, suppressAt: THREE.Vector3 | null): void {
    const p = ctx.player;
    const from = this.rig.muzzle.getWorldPosition(new THREE.Vector3());
    const aimAt = suppressAt
      ? suppressAt.clone().setY(suppressAt.y + 1.2 + Math.random() * 0.8)
      : p.position.clone().setY(p.position.y + p.height * 0.62).addScaledVector(p.velocity, 0.12 * this.stats.accuracy);
    const dist = from.distanceTo(aimAt);
    // Don't shoot through a friend
    const dir0 = aimAt.clone().sub(from).normalize();
    for (const e of ctx.enemies) {
      if (e === this || e.dead) continue;
      if (raySphere(from, dir0, e.chest, 0.45) >= 0 && e.position.distanceTo(this.position) < dist) {
        this.burstLeft = 0;
        this.strafeT = 0;
        return;
      }
    }

    this.mag--;
    this.flashT = 0.05;
    this.flash.material.rotation = Math.random() * 6.28;
    this.rig.kick();
    ctx.audio.gunshot(this.weaponDef.soundPower, from, this.weaponDef.sound as SampleName);

    // Angular error (radians, 1 sigma)
    let sigma = THREE.MathUtils.lerp(0.075, 0.013, THREE.MathUtils.clamp(this.stats.accuracy * 2, 0, 1));
    sigma *= 1.9 - 1.3 * this.settle;
    if (moving) sigma *= 1.7;
    if (this.suppressed > 0) sigma *= 1.5;
    if (this.hurtT < 0.5) sigma *= 1.8;
    sigma *= 1 + Math.min(1, p.moveFactor) * 0.6;
    if (!p.onGround) sigma *= 1.4;
    // Scoped and settled: a still target gets hit, a moving one mostly doesn't
    if (this.weaponDef.id === 'sniper' && !suppressAt) sigma *= 0.5 + Math.min(1, p.moveFactor) * 1.4;
    if (suppressAt) sigma = Math.max(sigma, 0.04);
    // The error wanders smoothly within a burst (a real spray), instead of pure noise
    this.aimErr.multiplyScalar(0.6).add(new THREE.Vector3(gauss(), gauss() * 0.8, gauss()).multiplyScalar(sigma * 0.8));
    const dir = dir0.clone().add(this.aimErr).normalize();

    // Trace: world, then the player
    const world = raycastBoxes(from, dir, 200, ctx.colliders);
    let maxD = world?.distance ?? 200;
    if (dir.y < 0) maxD = Math.min(maxD, -from.y / dir.y);
    const top = p.position.clone().setY(p.position.y + p.height - 0.12);
    const bottom = p.position.clone().setY(p.position.y + 0.3);
    const tp = p.alive ? raySegment(from, dir, bottom, top, 0.32) : -1;
    const hitPlayer = tp >= 0 && tp < maxD;
    const end = hitPlayer ? from.clone().addScaledVector(dir, tp) : from.clone().addScaledVector(dir, Math.min(maxD, 200));

    // Near miss: whiz past the player's head and rattle them
    let nearMiss = false;
    if (!hitPlayer) {
      const toP = p.eye.sub(from);
      const along = toP.dot(dir);
      if (along > 0 && along < maxD) {
        const miss = toP.addScaledVector(dir, -along).length();
        if (miss < 1.6) {
          nearMiss = true;
          ctx.audio.bulletWhiz(from.clone().addScaledVector(dir, along));
        }
      }
      if (world && world.distance <= maxD + 0.01) {
        ctx.effects.bulletHole(world.point, world.normal);
        if (Math.random() < 0.5) ctx.effects.dust(world.point, world.normal);
      }
    }
    const tracer = Math.random() < 0.35;
    if (tracer) ctx.effects.tracer(from, end);
    ctx.events.emit({ type: 'enemyFire', shooter: this.id, from: v3(from), to: v3(end), tracer, nearMiss });
    if (hitPlayer) {
      const zone: HitZone = end.y > top.y - 0.25 ? 'head' : end.y < p.position.y + 0.85 ? 'leg' : 'torso';
      const mult = zone === 'head' ? 1.6 : zone === 'leg' ? 0.75 : 1;
      const baseDmg = this.stats.damage * (this.weaponDef.damage / 30);
      ctx.onPlayerHit(baseDmg * mult * (0.85 + Math.random() * 0.3), this.position.clone(), zone);
    }
  }

  // =============================================================================================
  // Rendering

  render(dt: number, alpha: number): void {
    if (!this.dead) {
      this.rig.root.position.lerpVectors(this.prevPos, this.position, alpha);
      let diff = this.facing - this.renderFacing;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.renderFacing += diff * Math.min(1, dt * 20);
      this.rig.root.rotation.y = this.renderFacing;
    }
    this.rig.update(dt);
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.rig.root);
    this.rig.dispose();
  }
}

const _feet = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);

function gauss(): number {
  // Box-Muller, clamped so outliers don't fly off at 90 degrees
  const u = 1 - Math.random();
  const v = Math.random();
  return THREE.MathUtils.clamp(Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v), -2.5, 2.5);
}

// =================================================================================================
// Grenades

interface Grenade {
  mesh: THREE.Mesh;
  body: RAPIER.RigidBody;
  fuse: number;
  warned: boolean;
  bounced: number;
}

export class GrenadeSystem {
  private live: Grenade[] = [];
  private geo = new THREE.SphereGeometry(0.045, 12, 8).scale(1, 1.25, 1);
  private mat = new THREE.MeshStandardMaterial({ color: 0x2f3a26, roughness: 0.6, metalness: 0.3 });

  constructor(private scene: THREE.Scene, private phys: PhysicsWorld | null) {}

  /** Launch velocity that lands at `to` with an arc, or null if the arc hits something. */
  private solve(from: THREE.Vector3, to: THREE.Vector3, colliders: THREE.Box3[]): THREE.Vector3 | null {
    const d = to.clone().sub(from);
    const flat = Math.hypot(d.x, d.z);
    for (const T of [0.9 + flat * 0.04, 1.3 + flat * 0.05, 1.8 + flat * 0.05]) {
      const v = new THREE.Vector3(d.x / T, (d.y + 0.5 * 9.81 * T * T) / T, d.z / T);
      let ok = true;
      let prev = from.clone();
      for (let i = 1; i <= 12 && ok; i++) {
        const t = (T * i) / 12 * 0.92;
        const q = from.clone().addScaledVector(v, t).add(new THREE.Vector3(0, -0.5 * 9.81 * t * t, 0));
        if (!lineOfSight(prev, q, colliders)) ok = false;
        prev = q;
      }
      if (ok) return v;
    }
    return null;
  }

  canThrow(from: THREE.Vector3, to: THREE.Vector3, colliders: THREE.Box3[]): boolean {
    return !!this.phys && !!this.solve(from.clone().setY(from.y + 0.3), to, colliders);
  }

  throw(owner: Enemy, from: THREE.Vector3, to: THREE.Vector3, ctx: EnemyCtx): void {
    if (!this.phys) return;
    // A little scatter: nobody throws perfectly
    const target = to.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2.5, 0, (Math.random() - 0.5) * 2.5));
    const vel = this.solve(from, target, ctx.colliders);
    if (!vel) return;
    const mesh = new THREE.Mesh(this.geo, this.mat);
    mesh.castShadow = true;
    mesh.position.copy(from);
    this.scene.add(mesh);
    const W = this.phys.world;
    const body = W.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(from.x, from.y, from.z)
      .setLinvel(vel.x, vel.y, vel.z).setAngvel({ x: 6, y: 2, z: 4 }).setLinearDamping(0.05).setAngularDamping(1.2).setCcdEnabled(true));
    W.createCollider(RAPIER.ColliderDesc.ball(0.05).setDensity(3500).setRestitution(0.35).setFriction(0.8), body);
    this.live.push({ mesh, body, fuse: 3.2 + Math.random() * 0.4, warned: false, bounced: 0 });
    ctx.events.emit({ type: 'grenadeThrown', shooter: owner.id, id: this.live.length });
  }

  /** Positions of live grenades (for the HUD warning). */
  get positions(): THREE.Vector3[] {
    return this.live.map((g) => g.mesh.position);
  }

  tick(dt: number, ctx: EnemyCtx, onExplode: (p: THREE.Vector3) => void): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const g = this.live[i];
      g.fuse -= dt;
      const v = g.body.linvel();
      const t = g.body.translation();
      g.mesh.position.set(t.x, t.y, t.z);
      if (t.y < 0.1 && Math.abs(v.y) > 1 && g.bounced < 3) {
        g.bounced++;
        ctx.audio.clink(g.mesh.position, 0.8);
      }
      // Once it's slowing down, everybody nearby knows where it'll go off
      if (!g.warned && (Math.hypot(v.x, v.y, v.z) < 3 || g.fuse < 1.5)) {
        g.warned = true;
        for (const e of ctx.enemies) e.warnGrenade(g.mesh.position);
      }
      if (g.fuse <= 0) {
        const p = g.mesh.position.clone();
        this.phys?.world.removeRigidBody(g.body);
        this.scene.remove(g.mesh);
        this.live.splice(i, 1);
        onExplode(p);
      }
    }
  }

  render(): void {
    for (const g of this.live) {
      const r = g.body.rotation();
      const t = g.body.translation();
      g.mesh.position.set(t.x, t.y, t.z);
      g.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }

  clear(): void {
    for (const g of this.live) {
      this.phys?.world.removeRigidBody(g.body);
      this.scene.remove(g.mesh);
    }
    this.live = [];
  }
}

// =================================================================================================

/** Soldier models and a brightness gain for each (some are textured much darker than the world is lit). */
const SOLDIER_MODELS: [name: string, gain: number][] = [['us_soldier', 1], ['soldier_ksk', 4], ['soldier_bw', 4]];

export interface SpawnOpts {
  role?: Role;
  /** Indices into the soldier models (see SOLDIER_MODELS). */
  models?: number[];
  home?: THREE.Vector3;
  leash?: number;
  group?: string;
  friendly?: boolean;
  label?: string;
  scale?: number;
  facing?: number;
}

export class EnemyManager {
  readonly enemies: Enemy[] = [];
  readonly squad = new Squad();
  grenades: GrenadeSystem;
  /** Every soldier model available; each spawn picks one, so a squad is not five copies of one man. */
  private protos: CharacterProto[] = [];
  private spawnCount = 0;
  private gunM4!: THREE.Object3D;
  private gunPistol!: THREE.Object3D;
  private gunSniper!: THREE.Object3D;
  /** Character used for the first-person arms too. */
  get characterScene(): THREE.Object3D | null {
    return this.protos[0]?.scene ?? null;
  }
  phys: PhysicsWorld | null = null;
  nav: NavSystem | null = null;
  onMagDrop: ((mag: THREE.Object3D, vel: THREE.Vector3) => void) | null = null;
  onDropGun: ((enemy: Enemy, pivot: THREE.Object3D, vel: THREE.Vector3, def: WeaponDef, ammo: number, size?: THREE.Vector3, center?: THREE.Vector3) => void) | null = null;
  onEnemyDeath: ((enemy: Enemy, def: WeaponDef, ammo: number) => void) | null = null;

  constructor(private scene: THREE.Scene) {
    this.grenades = new GrenadeSystem(scene, null);
  }

  setPhysics(phys: PhysicsWorld): void {
    this.phys = phys;
    this.grenades = new GrenadeSystem(this.scene, phys);
  }

  async load(): Promise<void> {
    // Animations come from the three.js Soldier (Idle/Walk/Run); the character mesh is the
    // realistic "American Soldier Rigged" (Sketchfab, CC BY 4.0) when present.
    const [anim, gunM4, gunPistol, gunSniper] = await Promise.all([
      loadGlb('characters/soldier.glb'),
      weaponModel(WEAPONS[0]),
      weaponModel(WEAPONS[1]),
      weaponModel(WEAPONS[2]),
    ]);
    this.gunM4 = gunM4;
    this.gunPistol = gunPistol;
    this.gunSniper = gunSniper;
    // Any Mixamo-rigged soldier works: its clips are retargeted from the one animated character.
    for (const [name, gain] of SOLDIER_MODELS) {
      try {
        const m = await loadGlb(`characters/${name}.glb`);
        m.scene.traverse((o) => {
          const mat = (o as THREE.Mesh).material as THREE.MeshPhysicalMaterial | undefined;
          if (!mat || !mat.isMaterial) return;
          mat.color.multiplyScalar(gain);
          // Exported with specular switched off, which reads as a black cut-out next to lit geometry
          if (mat.isMeshPhysicalMaterial) mat.specularIntensity = 1;
        });
        this.protos.push({ scene: m.scene, animations: retargetClips(anim.scene, anim.animations, m.scene, { tPoseClip: 'TPose' }) });
      } catch (err) {
        console.warn(`Soldier model ${name} unavailable`, err);
      }
    }
    if (!this.protos.length) {
      this.protos.push({ scene: anim.scene, animations: anim.animations.filter((c) => c.name !== 'TPose') });
    }
  }

  /** `hunt`: the bot arrives knowing roughly where the player is (wave attackers). */
  spawn(at: THREE.Vector3, stats: EnemyStats, hunt?: THREE.Vector3, opts: SpawnOpts = {}): Enemy {
    const n = this.spawnCount++;
    const role: Role = opts.role ?? (stats.passive ? 'rifleman' : n % 7 === 4 ? 'marksman' : n % 4 === 1 ? 'flanker' : n % 6 === 3 ? 'rusher' : 'rifleman');
    const isSniper = role === 'marksman';
    const isPistol = role === 'flanker';
    const def = isSniper ? WEAPONS[2] : isPistol ? WEAPONS[1] : WEAPONS[0];
    const gunProto = isSniper ? this.gunSniper : isPistol ? this.gunPistol : this.gunM4;
    const gunClone = gunProto.clone(true);
    const muzzleZ = -def.muzzle[2];
    // Spread the models over the spawn order (not by role: the same man shouldn't always be the sniper)
    const models = opts.models?.filter((i) => i < this.protos.length);
    const proto = models?.length ? this.protos[models[n % models.length]] : this.protos[(n * 5 + (n >> 2)) % this.protos.length];
    const e = new Enemy(proto, gunClone, muzzleZ, at, stats, this.scene, role, this.phys, def);
    // People differ in height
    e.rig.root.scale.setScalar((0.96 + ((n * 37) % 9) * 0.01) * (opts.scale ?? 1));
    e.home = opts.home ?? null;
    if (opts.leash !== undefined) e.leash = opts.leash;
    e.group = opts.group ?? '';
    e.friendly = !!opts.friendly;
    e.label = opts.label ?? '';
    if (opts.facing !== undefined) e.setFacing(opts.facing);
    e.rig.onMagDrop = (mag, vel) => this.onMagDrop?.(mag, vel);
    e.rig.onDropGun = (pivot, vel, size, center) => this.onDropGun?.(e, pivot, vel, def, def.magSize, size, center);
    if (this.nav) {
      e.agent = this.nav.addAgent(at, stats.speed);
      const p = e.agent.position();
      e.position.set(p.x, Math.abs(p.y) < 0.3 ? 0 : p.y, p.z);
    }
    if (hunt && !stats.passive) e.hunt(hunt);
    this.scene.add(e.rig.root);
    this.enemies.push(e);
    return e;
  }

  get alive(): number {
    return this.enemies.reduce((n, e) => n + (e.dead || e.friendly ? 0 : 1), 0);
  }

  /** Weather: scales how far the player's noise carries. */
  hearingScale = 1;

  /** The player fired: bots within earshot learn roughly where; near misses suppress. */
  playerFired(from: THREE.Vector3, dir: THREE.Vector3, loudness: number): void {
    for (const e of this.enemies) {
      if (e.dead || e.friendly) continue;
      const d = e.position.distanceTo(from);
      const range = 60 * loudness * this.hearingScale;
      if (d < range) e.hear(from, THREE.MathUtils.clamp(1 - d / range, 0.2, 0.95));
      const toE = e.chest.sub(from);
      const along = toE.dot(dir);
      if (along > 0) {
        const miss = toE.addScaledVector(dir, -along).length();
        if (miss < 2) e.suppress(1.6 - miss * 0.5);
      }
    }
    this.squad.report(from, new THREE.Vector3(), false, 0.8);
  }

  /** Footsteps / reload noise from the player. */
  playerNoise(at: THREE.Vector3, radius: number, kind: 'step' | 'reload'): void {
    radius *= this.hearingScale;
    for (const e of this.enemies) {
      if (e.dead || e.friendly) continue;
      const d = e.position.distanceTo(at);
      if (d < radius) {
        e.hear(at, 0.55 * (1 - d / radius) + 0.2);
        if (kind === 'reload' && e.sinceKnown < 10) this.squad.playerReloadingT = 2.5;
      }
    }
  }

  tick(dt: number, ctx: Omit<EnemyCtx, 'enemies' | 'squad' | 'grenades'>): void {
    this.squad.update(dt);
    const full: EnemyCtx = { ...ctx, enemies: this.enemies, squad: this.squad, grenades: this.grenades };
    for (const e of this.enemies) {
      const wasDead = e.dead;
      e.tick(dt, full);
      if (e.dead && !wasDead) this.onDeath(e, ctx);
    }
    this.nav?.update(dt);
    for (const e of this.enemies) e.syncFromAgent(full);
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.dead && e.deadTime > 30) {
        ctx.cover.release(e);
        e.dispose(this.scene);
        this.enemies.splice(i, 1);
      }
    }
  }

  /** Called for deaths from any source (bullets, grenades). */
  onDeath(e: Enemy, ctx: { cover: CoverMap }): void {
    ctx.cover.release(e);
    this.squad.forget(e);
    if (e.agent && this.nav) {
      this.nav.removeAgent(e.agent);
      e.agent = null;
    }
    this.onEnemyDeath?.(e, e.weaponDef, e.weaponDef.magSize);
  }

  render(dt: number, alpha: number): void {
    for (const e of this.enemies) e.render(dt, alpha);
    this.grenades.render();
  }

  raycast(o: THREE.Vector3, d: THREE.Vector3, maxDist: number): EnemyHit | null {
    let best: EnemyHit | null = null;
    for (const e of this.enemies) {
      if (e.friendly) continue;
      const r = e.raycast(o, d);
      if (!r || r.distance > maxDist) continue;
      if (!best || r.distance < best.distance) {
        best = { enemy: e, distance: r.distance, zone: r.zone, point: o.clone().addScaledVector(d, r.distance) };
      }
    }
    return best;
  }

  clear(): void {
    for (const e of this.enemies) {
      if (e.agent && this.nav) this.nav.removeAgent(e.agent);
      e.dispose(this.scene);
    }
    this.enemies.length = 0;
    this.squad.reset();
    this.grenades.clear();
  }
}
