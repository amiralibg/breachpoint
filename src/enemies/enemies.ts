import * as THREE from 'three';
import { loadGlb } from '../core/assets';
import type { Audio } from '../core/audio';
import type { Player } from '../player/player';
import { WEAPONS, weaponModel } from '../weapons/weapons';
import type { CoverMap, CoverPoint } from '../world/cover';
import type { Effects } from '../world/effects';
import { flashTexture } from '../world/effects';
import type { NavGrid } from '../world/nav';
import { lineOfSight, rayCapsule, raySphere } from '../world/physics';
import { retargetClips } from './retarget';
import { SoldierRig, type CharacterProto } from './rig';

export interface EnemyStats {
  health: number;
  speed: number;
  /** 0..1 base chance to hit a still, standing player at 10 m with a settled aim. */
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
  headshot: boolean;
  point: THREE.Vector3;
}

type Role = 'rifleman' | 'flanker' | 'rusher';
type State = 'search' | 'advance' | 'peek' | 'hide' | 'hold' | 'rush' | 'reload' | 'retreat';

const RADIUS = 0.32;
const HEAD_R = 0.13;
const SIGHT_RANGE = 75;
const MAG = 30;
const RPM_INTERVAL = 0.1;

export interface EnemyCtx {
  player: Player;
  nav: NavGrid;
  cover: CoverMap;
  colliders: THREE.Box3[];
  audio: Audio;
  effects: Effects;
  onPlayerHit: (damage: number, from: THREE.Vector3) => void;
  enemies: Enemy[];
  intel: Intel;
}

/** What the squad collectively knows about the player. */
export class Intel {
  pos = new THREE.Vector3();
  age = Infinity;
  report(p: THREE.Vector3): void {
    this.pos.copy(p);
    this.age = 0;
  }
}

let nextId = 0;

export class Enemy {
  readonly rig: SoldierRig;
  readonly position: THREE.Vector3;
  private readonly id = nextId++;
  health: number;
  dead = false;
  deadTime = 0;
  role: Role;
  state: State = 'search';
  private facing = 0;
  private path: THREE.Vector3[] = [];
  private pathTarget = new THREE.Vector3();
  private repathT = 0;
  private decideT = 0;
  private stateT = 0;
  private perceiveT = Math.random() * 0.2;
  private sees = false;
  private seeT = 0;
  private lastSeen = new THREE.Vector3();
  private sinceSeen = Infinity;
  private settle = 0;
  private mag = MAG;
  private reloadT = 0;
  private burstLeft = 0;
  private shotT = 0;
  private burstPause = 0;
  private cover: CoverPoint | null = null;
  private peekPos: THREE.Vector3 | null = null;
  private stuckT = 0;
  private lastProgress = new THREE.Vector3();
  private stepT = 0;
  private suppressed = 0;
  private strafe = 0;
  private strafeT = 0;
  private flash: THREE.Sprite;
  private flashT = 0;
  bloodPooled = false;
  coverReleased = false;

  constructor(proto: CharacterProto, gun: THREE.Object3D, muzzleZ: number, spawn: THREE.Vector3, readonly stats: EnemyStats, scene: THREE.Scene, role: Role) {
    this.rig = new SoldierRig(proto, gun, scene, muzzleZ);
    this.rig.root.position.copy(spawn);
    this.position = this.rig.root.position;
    this.health = stats.health;
    this.role = role;
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({
      map: flashTexture, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    }));
    this.flash.visible = false;
    this.flash.scale.setScalar(0.32);
    this.rig.muzzle.add(this.flash);
    this.lastProgress.copy(spawn);
  }

  get headCenter(): THREE.Vector3 {
    // The head bone sits at the base of the skull
    return this.rig.headWorld.add(new THREE.Vector3(0, 0.09, 0));
  }

  get chest(): THREE.Vector3 {
    return this.rig.chestWorld;
  }

  /** Ray test against head sphere and body capsule (both follow the animation). */
  raycast(o: THREE.Vector3, d: THREE.Vector3): { distance: number; headshot: boolean } | null {
    if (this.dead) return null;
    const head = raySphere(o, d, this.headCenter, HEAD_R);
    const chest = this.chest;
    const body = rayCapsule(o, d, chest.x, chest.z, this.position.y + 0.25, chest.y + 0.12, RADIUS);
    if (head >= 0 && (body < 0 || head <= body + 0.05)) return { distance: head, headshot: true };
    if (body >= 0) return { distance: body, headshot: false };
    return null;
  }

  /** Returns true if this killed the enemy. */
  damage(amount: number, dir: THREE.Vector3, from: THREE.Vector3, intel: Intel): boolean {
    if (this.dead) return false;
    this.health -= amount;
    // Getting shot reveals where the shooter is and makes the bot react immediately.
    this.lastSeen.copy(from).setY(0);
    this.sinceSeen = Math.min(this.sinceSeen, 0.5);
    intel.report(this.lastSeen);
    this.seeT = Math.max(this.seeT, this.stats.reaction);
    this.suppressed = 1.2;
    this.rig.hit(dir, amount / 40);
    if (this.health <= 0) {
      this.dead = true;
      this.flash.visible = false;
      this.rig.die(dir);
      return true;
    }
    // Under fire while exposed: break off and get behind something
    if (this.state === 'peek' || this.state === 'hold') this.decideT = 0;
    return false;
  }

  /** A bullet passed close by (suppression). */
  suppress(amount: number): void {
    this.suppressed = Math.max(this.suppressed, amount);
  }

  /** Heard a gunshot from `pos`. */
  hear(pos: THREE.Vector3): void {
    if (this.sinceSeen > 1) {
      this.lastSeen.copy(pos).setY(0);
      this.sinceSeen = Math.min(this.sinceSeen, 3);
    }
  }

  update(dt: number, ctx: EnemyCtx): void {
    if (this.dead) {
      this.deadTime += dt;
      this.rig.update(dt);
      if (this.deadTime > 14) this.position.y -= dt * 0.2;
      return;
    }
    const p = ctx.player;
    this.stateT += dt;
    this.suppressed = Math.max(0, this.suppressed - dt);

    this.perceive(dt, ctx);
    const threat = this.threat(ctx);

    this.decideT -= dt;
    if (this.decideT <= 0) {
      this.decideT = 0.3 + Math.random() * 0.25;
      this.decide(ctx, threat);
    }

    // ----- Reloading
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        this.mag = MAG;
        ctx.audio.click(this.position, 0.9);
      }
    }

    // ----- Movement
    let moveSpeed = 0;
    let moveDir = new THREE.Vector3();
    const s = this.state;
    const running = s === 'advance' || s === 'rush' || s === 'retreat' || s === 'search' || (s === 'reload' && this.path.length > 0);
    if (s === 'peek' && this.peekPos) {
      const d = new THREE.Vector3().subVectors(this.peekPos, this.position).setY(0);
      if (d.length() > 0.25) {
        moveDir = d.normalize();
        moveSpeed = 2.2;
      }
    } else if (running) {
      this.followPath(dt, ctx, s === 'rush' ? p.position : null);
      const close = s === 'rush' && this.sees && this.position.distanceTo(p.position) < 3.5;
      if (this.path.length && !close) {
        moveDir = new THREE.Vector3().subVectors(this.path[0], this.position).setY(0).normalize();
        moveSpeed = this.stats.speed * (s === 'search' && this.sinceSeen > 10 ? 0.6 : 1);
      } else if (close) {
        // Point blank: circle-strafe instead of walking into the player
        const toP = new THREE.Vector3().subVectors(p.position, this.position).setY(0).normalize();
        moveDir = new THREE.Vector3(-toP.z, 0, toP.x).multiplyScalar(this.id % 2 ? 1 : -1);
        moveSpeed = 2;
      }
    } else if (s === 'hold' && threat) {
      // Out in the open: keep moving sideways to be harder to hit
      this.strafeT -= dt;
      if (this.strafeT <= 0) {
        this.strafeT = 0.8 + Math.random() * 1.6;
        this.strafe = Math.random() < 0.25 ? 0 : Math.random() < 0.5 ? -1 : 1;
      }
      const toT = new THREE.Vector3().subVectors(threat, this.position).setY(0).normalize();
      moveDir = new THREE.Vector3(-toT.z, 0, toT.x).multiplyScalar(this.strafe);
      moveSpeed = 1.8;
    } else if (s === 'hide' && this.cover) {
      const d = new THREE.Vector3().subVectors(this.cover.pos, this.position).setY(0);
      if (d.length() > 0.3) {
        moveDir = d.normalize();
        moveSpeed = 2.4;
      }
    }

    // Separation from squad mates
    for (const o of ctx.enemies) {
      if (o === this || o.dead) continue;
      const d = new THREE.Vector3().subVectors(this.position, o.position).setY(0);
      const l = d.length();
      if (l < 1.0 && l > 0.001) moveDir.addScaledVector(d.divideScalar(l), (1.0 - l) * 1.5);
    }

    const crouched = this.rig.crouch > 0.5;
    const speed = moveSpeed * (crouched ? 0.55 : 1);
    this.position.addScaledVector(moveDir, speed * dt);
    this.pushOut(ctx.colliders);

    // ----- Posture
    const behindLowCover = !!this.cover?.low && this.position.distanceTo(this.cover.pos) < 0.8;
    const crouch = (s === 'hide' && behindLowCover) || (s === 'reload' && this.path.length === 0)
      || (this.suppressed > 0.6 && s !== 'rush' && s !== 'advance' && s !== 'retreat');
    this.rig.crouchTarget = crouch ? 1 : 0;
    const engaging = !!threat && (this.sees || this.sinceSeen < 1.5) && this.reloadT <= 0;
    this.rig.aimTarget = engaging && s !== 'retreat' ? 1 : threat && s !== 'search' ? 0.25 : 0;
    if (threat) this.rig.aimPoint.copy(this.sees ? p.eye.clone().setY(p.eye.y - 0.35) : threat.clone().setY(1.3));

    // Face the threat while engaged, otherwise the way we're going
    if ((engaging || s === 'hide' || s === 'peek' || s === 'hold') && threat) {
      this.faceTowards(new THREE.Vector3().subVectors(threat, this.position), dt, 9);
    } else if (moveDir.lengthSq() > 0.01) {
      this.faceTowards(moveDir, dt, 7);
    }
    this.rig.root.rotation.y = this.facing;

    // Animation: run / walk / idle, played at a rate matching ground speed
    if (speed > 3) this.rig.play('Run', speed / 5.2);
    else if (speed > 0.3) this.rig.play('Walk', Math.max(0.6, speed / 1.8));
    else this.rig.play('Idle');
    this.rig.update(dt);

    // Footsteps (positional - lets the player hear them coming)
    if (speed > 3) {
      this.stepT -= dt * speed;
      if (this.stepT <= 0) {
        this.stepT = 2.6;
        if (this.position.distanceTo(p.position) < 28) ctx.audio.footstep(this.position, 1.1);
      }
    }

    // ----- Shooting (bursts)
    this.shotT -= dt;
    this.burstPause -= dt;
    const stance = s === 'peek' || s === 'hold' || s === 'rush' || s === 'advance';
    const canShoot = !this.stats.passive && this.sees && this.reloadT <= 0 && this.mag > 0
      && this.seeT > this.stats.reaction && this.rig.aim > 0.6 && p.alive && stance;
    if (canShoot && this.shotT <= 0) {
      if (this.burstLeft <= 0 && this.burstPause <= 0) {
        const dist = this.position.distanceTo(p.position);
        this.burstLeft = dist < 12 ? 4 + Math.floor(Math.random() * 4) : 2 + Math.floor(Math.random() * 3);
      }
      if (this.burstLeft > 0) {
        this.burstLeft--;
        this.shotT = RPM_INTERVAL * (0.9 + Math.random() * 0.3);
        this.shoot(ctx, moveSpeed > 0.5);
        if (this.burstLeft === 0) this.burstPause = this.stats.fireInterval * (0.6 + Math.random() * 0.8);
      }
    }
    if (this.mag === 0 && this.reloadT <= 0 && this.state !== 'reload') this.decideT = 0;

    this.flashT -= dt;
    this.flash.visible = this.flashT > 0;
  }

  private perceive(dt: number, ctx: EnemyCtx): void {
    const p = ctx.player;
    this.sinceSeen += dt;
    this.perceiveT -= dt;
    if (this.perceiveT <= 0) {
      this.perceiveT = 0.12 + Math.random() * 0.08;
      let sees = false;
      const dist = this.position.distanceTo(p.position);
      if (p.alive && dist < SIGHT_RANGE) {
        const eye = this.headCenter;
        const fwd = new THREE.Vector3(Math.sin(this.facing), 0, Math.cos(this.facing));
        const to = new THREE.Vector3().subVectors(p.position, this.position).setY(0).normalize();
        const inView = fwd.dot(to) > -0.1 || this.sinceSeen < 4 || dist < 4;
        // Crouching players are harder to spot at range
        const spotChance = p.crouching && dist > 25 ? 0.6 : 1;
        if (inView && Math.random() < spotChance) {
          sees = lineOfSight(eye, p.eye, ctx.colliders)
            || lineOfSight(eye, p.position.clone().setY(p.position.y + p.height * 0.5), ctx.colliders);
        }
      }
      if (sees && !this.sees) this.settle = 0;
      this.sees = sees;
    }
    if (this.sees) {
      this.lastSeen.copy(p.position).setY(0);
      this.sinceSeen = 0;
      this.seeT += dt;
      ctx.intel.report(this.lastSeen);
      // Aim settles while tracking; fast target movement and own movement unsettle it
      const unsettle = p.moveFactor * 0.35 + (this.state === 'advance' || this.state === 'rush' ? 0.3 : 0);
      this.settle = THREE.MathUtils.clamp(this.settle + dt * (0.9 - unsettle), 0, 1);
    } else {
      this.seeT = Math.max(0, this.seeT - dt);
      this.settle = Math.max(0, this.settle - dt * 0.5);
    }
  }

  /** Best estimate of where the player is, or null if the bot has no idea. */
  private threat(ctx: EnemyCtx): THREE.Vector3 | null {
    if (this.sinceSeen < 20) return this.lastSeen;
    if (ctx.intel.age < 12) return ctx.intel.pos;
    return null;
  }

  private setState(s: State): void {
    if (this.state !== s) {
      this.state = s;
      this.stateT = 0;
    }
  }

  private takeCover(ctx: EnemyCtx, threat: THREE.Vector3, opts: { min: number; max: number; travel: number; flank?: boolean }): boolean {
    let flankDir: THREE.Vector3 | undefined;
    if (opts.flank) {
      const toMe = new THREE.Vector3().subVectors(this.position, threat).setY(0).normalize();
      const side = this.id % 2 ? 1 : -1;
      flankDir = new THREE.Vector3(-toMe.z, 0, toMe.x).multiplyScalar(side).addScaledVector(toMe, 0.3).normalize();
    }
    ctx.cover.release(this);
    const c = ctx.cover.find({
      owner: this, from: this.position, threat, minDist: opts.min, maxDist: opts.max,
      maxTravel: opts.travel, flankDir, needPeek: !opts.flank,
    });
    if (!c) {
      this.cover = null;
      return false;
    }
    c.claimedBy = this;
    this.cover = c;
    this.peekPos = null;
    this.setPath(ctx, c.pos);
    return true;
  }

  private decide(ctx: EnemyCtx, threat: THREE.Vector3 | null): void {
    const p = ctx.player;
    const hp = this.health / this.stats.health;
    const dist = threat ? this.position.distanceTo(threat) : Infinity;
    const atCover = !!this.cover && this.position.distanceTo(this.cover.pos) < 0.9;

    if (this.stats.passive) {
      // Practice targets: jog between random cover points
      if (this.path.length === 0) {
        const pts = ctx.cover.points;
        this.setPath(ctx, pts[Math.floor(Math.random() * pts.length)].pos);
      }
      this.setState('search');
      return;
    }

    // ----- Reload: get behind something first if we can
    if (this.mag === 0 && this.reloadT <= 0) {
      if (this.state !== 'reload') {
        this.setState('reload');
        if (!(threat && this.takeCover(ctx, threat, { min: 4, max: 45, travel: 8 }))) this.path = [];
      }
      if (this.path.length === 0 || atCover || this.stateT > 4) {
        this.reloadT = 2.4;
        this.path = [];
        ctx.audio.click(this.position, 0.7);
      }
      return;
    }
    if (this.state === 'reload') {
      if (this.reloadT > 0) return;
      this.setState(atCover ? 'hide' : 'hold');
    }

    if (!threat) {
      // No idea where the player is: sweep the map
      this.setState('search');
      if (this.path.length === 0) {
        const pts = ctx.cover.points;
        this.setPath(ctx, pts[Math.floor(Math.random() * pts.length)].pos);
      }
      return;
    }

    // ----- Badly hurt: fall back to cover further away
    if (hp < 0.35 && this.state !== 'retreat' && this.state !== 'hide' && this.role !== 'rusher') {
      if (this.takeCover(ctx, threat, { min: 16, max: 45, travel: 20 })) {
        this.setState('retreat');
        return;
      }
    }

    // ----- Rushers and close quarters: push the player directly
    if ((this.role === 'rusher' && dist < 30) || (dist < 7 && this.sees) || (p.health < 25 && dist < 18 && this.sees)) {
      if (this.state !== 'rush') this.setPath(ctx, p.position);
      this.setState('rush');
      return;
    }

    switch (this.state) {
      case 'advance':
      case 'retreat':
        if (atCover) {
          this.setState('hide');
          return;
        }
        if (this.cover && !ctx.cover.protects(this.cover, threat) && this.stateT > 1.5) {
          // The player moved and the planned cover no longer helps
          this.cover = null;
          this.setState('hold');
        }
        if (this.path.length === 0 && !this.cover) this.setState('hold');
        return;

      case 'hide': {
        if (!this.cover || !ctx.cover.protects(this.cover, threat)) {
          // Flanked: find new cover
          if (this.takeCover(ctx, threat, { min: 6, max: 30, travel: 14 })) this.setState('advance');
          else this.setState('hold');
          return;
        }
        const hideTime = this.suppressed > 0 ? 2.2 : 1.1 + Math.random();
        if (this.stateT > hideTime) {
          this.peekPos = ctx.cover.peekPosition(this.cover, threat);
          if (this.peekPos) this.setState('peek');
          else if (this.sinceSeen > 6 || dist > 30) this.advance(ctx, threat, dist);
        }
        return;
      }

      case 'peek': {
        const peekTime = this.sees ? 1.6 + Math.random() * 1.6 : 2.2;
        if (this.stateT > peekTime || this.suppressed > 0.8) {
          if (this.sinceSeen > 5 && this.role !== 'rifleman') this.advance(ctx, threat, dist);
          else {
            this.peekPos = null;
            this.setState('hide');
          }
        }
        return;
      }

      case 'hold':
        // Exposed: try to get to cover; otherwise keep fighting from here
        if (this.stateT > 0.8 && (this.suppressed > 0 || this.stateT > 3.5 || !this.sees)) this.advance(ctx, threat, dist);
        return;

      case 'rush':
        if (dist > 12 && this.role !== 'rusher') this.advance(ctx, threat, dist);
        else if (this.repathT <= 0) this.setPath(ctx, p.position);
        return;

      default:
        this.advance(ctx, threat, dist);
    }
  }

  /** Move up to the next cover toward the player (flankers swing wide). */
  private advance(ctx: EnemyCtx, threat: THREE.Vector3, dist: number): void {
    const flank = this.role === 'flanker' && dist > 12;
    const max = Math.max(10, Math.min(dist - 3, 30));
    if (this.takeCover(ctx, threat, { min: 6, max, travel: flank ? 34 : 22, flank })) {
      this.setState('advance');
      return;
    }
    if (this.sees) {
      this.setState('hold');
      return;
    }
    this.setPath(ctx, threat);
    this.setState('search');
  }

  private setPath(ctx: EnemyCtx, target: THREE.Vector3): void {
    this.pathTarget.copy(target);
    this.path = ctx.nav.findPath(this.position, target);
    this.repathT = 1.2 + Math.random() * 0.6;
    this.stuckT = 0;
    this.lastProgress.copy(this.position);
  }

  private followPath(dt: number, ctx: EnemyCtx, chase: THREE.Vector3 | null): void {
    this.repathT -= dt;
    if (chase && this.repathT <= 0) this.setPath(ctx, chase);
    while (this.path.length && this.path[0].distanceTo(this.position.clone().setY(0)) < 0.5) this.path.shift();
    // Unstick if we're not making progress
    this.stuckT += dt;
    if (this.stuckT > 1.5) {
      if (this.position.distanceTo(this.lastProgress) < 0.4 && this.path.length) this.setPath(ctx, this.pathTarget);
      this.stuckT = 0;
      this.lastProgress.copy(this.position);
    }
  }

  private faceTowards(dir: THREE.Vector3, dt: number, rate: number): void {
    if (dir.lengthSq() < 1e-6) return;
    const target = Math.atan2(dir.x, dir.z);
    let diff = target - this.facing;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.facing += diff * Math.min(1, dt * rate);
  }

  private pushOut(colliders: THREE.Box3[]): void {
    const p = this.position;
    for (const c of colliders) {
      if (c.max.y < 0.5 || c.min.y > 1.7) continue;
      const cx = THREE.MathUtils.clamp(p.x, c.min.x, c.max.x);
      const cz = THREE.MathUtils.clamp(p.z, c.min.z, c.max.z);
      const dx = p.x - cx, dz = p.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < RADIUS * RADIUS) {
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          p.x = cx + (dx / d) * RADIUS;
          p.z = cz + (dz / d) * RADIUS;
        } else {
          const opts = [
            [c.min.x - RADIUS - p.x, 0], [c.max.x + RADIUS - p.x, 0],
            [0, c.min.z - RADIUS - p.z], [0, c.max.z + RADIUS - p.z],
          ].sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]));
          p.x += opts[0][0];
          p.z += opts[0][1];
        }
      }
    }
  }

  private shoot(ctx: EnemyCtx, moving: boolean): void {
    const p = ctx.player;
    const from = this.rig.muzzle.getWorldPosition(new THREE.Vector3());
    this.mag--;
    this.flashT = 0.05;
    this.flash.material.rotation = Math.random() * 6.28;
    this.rig.kick();
    ctx.audio.gunshot(1.15, from);

    const dist = from.distanceTo(p.eye);
    let chance = this.stats.accuracy * THREE.MathUtils.clamp(10 / Math.max(dist, 1), 0.12, 1.25);
    chance *= 0.3 + 0.7 * this.settle;
    if (moving) chance *= 0.55;
    if (this.suppressed > 0) chance *= 0.6;
    chance *= 1 - Math.min(0.55, p.moveFactor * 0.35);
    if (p.crouching) chance *= 0.8;
    if (!p.onGround) chance *= 0.6;
    const hit = Math.random() < chance;

    const target = p.eye.clone().add(new THREE.Vector3(0, -0.35, 0));
    if (!hit) {
      const spread = 0.4 + (1 - this.settle) * 1.4;
      const miss = new THREE.Vector3((Math.random() - 0.5) * 2, (Math.random() - 0.4) * 1.2, (Math.random() - 0.5) * 2).multiplyScalar(spread);
      if (miss.length() < 0.45) miss.setLength(0.45);
      target.add(miss);
      if (miss.length() < 1.4) ctx.audio.bulletWhiz(target);
    }
    if (Math.random() < 0.35) ctx.effects.tracer(from, target);
    if (hit) ctx.onPlayerHit(this.stats.damage * (0.8 + Math.random() * 0.4), this.position.clone());
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.rig.root);
    this.rig.dispose();
  }
}

export class EnemyManager {
  readonly enemies: Enemy[] = [];
  readonly intel = new Intel();
  private proto!: CharacterProto;
  private muzzleZ = 0.58;
  private gun!: THREE.Object3D;
  private spawnCount = 0;

  constructor(private scene: THREE.Scene) {}

  async load(): Promise<void> {
    // Animations come from the three.js Soldier (Idle/Walk/Run); the character mesh is the
    // realistic "American Soldier Rigged" (Sketchfab, CC BY 4.0) when present.
    const [anim, gun] = await Promise.all([loadGlb('characters/soldier.glb'), weaponModel(WEAPONS[0])]);
    this.gun = gun;
    this.muzzleZ = -WEAPONS[0].muzzle[2];
    try {
      const us = await loadGlb('characters/us_soldier.glb');
      const clips = retargetClips(anim.scene, anim.animations, us.scene, { tPoseClip: 'TPose' });
      this.proto = { scene: us.scene, animations: clips };
    } catch (err) {
      console.warn('Realistic soldier unavailable, using the default character', err);
      this.proto = { scene: anim.scene, animations: anim.animations.filter((c) => c.name !== 'TPose') };
    }
  }

  spawn(at: THREE.Vector3, stats: EnemyStats): Enemy {
    const n = this.spawnCount++;
    const role: Role = stats.passive ? 'rifleman' : n % 4 === 1 ? 'flanker' : n % 7 === 3 ? 'rusher' : 'rifleman';
    const e = new Enemy(this.proto, this.gun, this.muzzleZ, at, stats, this.scene, role);
    this.scene.add(e.rig.root);
    this.enemies.push(e);
    return e;
  }

  get alive(): number {
    return this.enemies.reduce((n, e) => n + (e.dead ? 0 : 1), 0);
  }

  /** The player fired: bots within earshot learn roughly where; near misses suppress. */
  playerFired(from: THREE.Vector3, dir: THREE.Vector3): void {
    for (const e of this.enemies) {
      if (e.dead) continue;
      const d = e.position.distanceTo(from);
      if (d < 55) {
        const err = d * 0.15;
        e.hear(from.clone().add(new THREE.Vector3((Math.random() - 0.5) * err, 0, (Math.random() - 0.5) * err)));
      }
      const toE = e.chest.sub(from);
      const along = toE.dot(dir);
      if (along > 0) {
        const miss = toE.addScaledVector(dir, -along).length();
        if (miss < 1.8) e.suppress(1.5 - miss * 0.5);
      }
    }
    this.intel.report(from.clone().setY(0));
  }

  update(dt: number, ctx: Omit<EnemyCtx, 'enemies' | 'intel'>): void {
    this.intel.age += dt;
    const full: EnemyCtx = { ...ctx, enemies: this.enemies, intel: this.intel };
    for (const e of this.enemies) {
      e.update(dt, full);
      if (e.dead && !e.coverReleased) {
        e.coverReleased = true;
        ctx.cover.release(e);
      }
    }
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.dead && e.deadTime > 18) {
        ctx.cover.release(e);
        e.dispose(this.scene);
        this.enemies.splice(i, 1);
      }
    }
  }

  raycast(o: THREE.Vector3, d: THREE.Vector3, maxDist: number): EnemyHit | null {
    let best: EnemyHit | null = null;
    for (const e of this.enemies) {
      const r = e.raycast(o, d);
      if (!r || r.distance > maxDist) continue;
      if (!best || r.distance < best.distance) {
        best = { enemy: e, distance: r.distance, headshot: r.headshot, point: o.clone().addScaledVector(d, r.distance) };
      }
    }
    return best;
  }

  clear(): void {
    for (const e of this.enemies) e.dispose(this.scene);
    this.enemies.length = 0;
    this.intel.age = Infinity;
  }
}
