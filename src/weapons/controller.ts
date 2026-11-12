import * as THREE from 'three';
import type { Input } from '../core/input';
import { Btn, type PlayerCommand } from '../net/protocol';
import type { Player } from '../player/player';
import type { FpArms, HandTarget } from './arms';
import { fitGrip, sphereDistance, type DistanceFn, type GripPose } from './grip';
import { TimelinePlayer, type Timeline, type V3 } from './timeline';
import type { Viewmodel } from './viewmodel';
import { motionProfile, ViewmodelMotion } from './motion';
import type { HandAnchor, WeaponDef } from './weapons';

export interface ShotRequest {
  origin: THREE.Vector3;
  dir: THREE.Vector3;
  weapon: WeaponState;
}

export interface WeaponState {
  def: WeaponDef;
  mag: number;
  reserve: number;
  vm: Viewmodel;
  unlocked: boolean;
}

type Action = 'draw' | 'idle' | 'reload' | 'holster' | 'cycle' | 'inspect' | 'loot';

/** Critically damped-ish spring on three axes. */
class Spring3 {
  readonly x = new THREE.Vector3();
  readonly v = new THREE.Vector3();
  constructor(private k: number, private c: number) {}
  update(dt: number, target = _zero): void {
    // Semi-implicit Euler, sub-stepped so stiff springs stay stable at low frame rates
    const n = Math.ceil(dt / 0.008);
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.v.x += ((target.x - this.x.x) * this.k - this.v.x * this.c) * h;
      this.v.y += ((target.y - this.x.y) * this.k - this.v.y * this.c) * h;
      this.v.z += ((target.z - this.x.z) * this.k - this.v.z * this.c) * h;
      this.x.addScaledVector(this.v, h);
    }
  }
  reset(): void {
    this.x.set(0, 0, 0);
    this.v.set(0, 0, 0);
  }
}
const _zero = new THREE.Vector3();
const _v3: V3 = [0, 0, 0];
const _r3: V3 = [0, 0, 0];
const _hitPoint = new THREE.Vector3();
const _near = new THREE.Vector3();
/** How far a hand travelling between grips keeps its wrist from the gun's surface. */
const HAND_CLEARANCE = 0.045;

/**
 * First-person weapon handling. `tick` is simulation (ammo, fire timing, what action is running)
 * and runs at the fixed tick rate from PlayerCommands; `render` is presentation (viewmodel pose,
 * arms, FOV, muzzle flash) and runs every frame.
 */
export class WeaponController {
  current = 0;
  private action: Action = 'draw';
  private anim = new TimelinePlayer();
  private nextWeapon = 0;
  private cooldown = 0;
  private bloom = 0;
  aimBlend = 0;
  scoped = false;
  /** Seconds of held breath available while scoped. */
  breath = 4;
  private breathT = 0;
  private sprayShots = 0;
  private sprayT = 0;
  infiniteAmmo = false;
  /** Seconds until an automatic follow-up (reload after dry fire, switch when out of ammo). */
  private autoT = -1;
  private autoAction: 'reload' | 'switch' | null = null;
  /** Set when the last trigger pull clicked on an empty gun with nothing to reload. */
  outOfAmmo = false;

  private holder = new THREE.Group();
  private flashLight: THREE.PointLight;
  private flashT = 0;
  private firePartT = 1;
  private kickPos = new Spring3(260, 22);
  private kickRot = new Spring3(240, 20);
  private obstructionSpring = new Spring3(150, 18);
  private currentObstruction = 0;
  private triggerPull = 0;
  /** Development aid: hold a hand at a named anchor regardless of the animation. */
  debugHands: { l?: string; r?: string } = {};
  /** Solved grips, one per weapon, anchor and hand. */
  private grips = new Map<string, GripPose>();
  private lootTargetWorld: THREE.Vector3 | null = null;
  /** Weapon to bring up once the reach for it has finished. */
  private afterLoot = -1;
  private mapColliders: THREE.Box3[] = [];
  private dryT = 0;
  readonly motion = new ViewmodelMotion();

  onFire: ((w: WeaponState) => void) | null = null;
  onDryFire: (() => void) | null = null;
  /** A timeline sound cue (mag_out, charge_back...). */
  onSound: ((name: string) => void) | null = null;
  /** A part leaves the gun (dropped magazine); `obj` is a world-space copy, `vel` its velocity. */
  onDropPart: ((obj: THREE.Object3D, vel: THREE.Vector3) => void) | null = null;

  constructor(
    readonly weapons: WeaponState[],
    viewScene: THREE.Scene,
    private worldFlash: THREE.PointLight,
    private arms: FpArms | null,
  ) {
    viewScene.add(this.holder);
    for (const w of weapons) this.holder.add(w.vm.group);
    if (arms) viewScene.add(arms.root);
    this.flashLight = new THREE.PointLight(0xffb060, 0, 3, 2);
    viewScene.add(this.flashLight);
    this.bakeGrips();
    this.select(0);
  }

  /** Solve every grip the weapons use up front, so no reload hitches on its first play. */
  private bakeGrips(): void {
    if (!this.arms) return;
    const t0 = performance.now();
    let blocked = 0;
    for (const w of this.weapons) {
      const d = w.def;
      const use = (side: 'l' | 'r', name: string): void => {
        blocked += this.grip(w, name, side)?.blocked ?? 0;
      };
      use('r', d.restRight);
      use('l', d.restLeft);
      for (const tl of Object.values(d.anims)) {
        for (const [, name] of tl?.hands ?? []) use('l', name);
        for (const [, name] of tl?.rhands ?? []) use('r', name);
      }
    }
    if (import.meta.env.DEV) {
      console.info(`grips: ${this.grips.size} solved in ${(performance.now() - t0).toFixed(0)} ms, ${blocked} blocked fingers`);
    }
  }

  /** Drop the solved grips (after editing hand anchors) so they are solved again on next use. */
  invalidateGrips(): void {
    this.grips.clear();
  }

  /** What a hand at this anchor can touch: the gun (or one loose part), plus the hand it wraps. */
  private gripDistance(w: WeaponState, a: HandAnchor, side: 'l' | 'r'): DistanceFn | null {
    if (a.air) return null;
    const surface = w.vm.surface(a.solo && a.part ? a.part : 'all');
    const other = a.over ? this.grip(w, a.over, side === 'l' ? 'r' : 'l') : null;
    return other
      ? (p, max) => Math.min(surface.distance(p, max), sphereDistance(other.spheres, p, max))
      : (p, max) => surface.distance(p, max);
  }

  /** The solved grip for a hand anchor, in holder space with the gun's parts at rest. */
  private grip(w: WeaponState, name: string, side: 'l' | 'r'): GripPose | null {
    if (!this.arms) return null;
    const key = `${w.def.id}:${name}:${side}`;
    const cached = this.grips.get(key);
    if (cached) return cached;
    const a = w.def.hands[name];
    if (!a) return null;
    const pose = this.arms.solveGrip(
      side, new THREE.Vector3(...a.pos), new THREE.Vector3(...a.fwd).normalize(), new THREE.Vector3(...a.back).normalize(),
      a, this.gripDistance(w, a, side));
    this.grips.set(key, pose);
    return pose;
  }

  /**
   * Development tool (run from the console): nudge a hand anchor of the current weapon to where
   * the hand sits best on the model, apply it, and return the values to paste into weapons.ts.
   */
  fitGrip(name: string, side: 'l' | 'r', opts: Parameters<typeof fitGrip>[4] = {}): Record<string, unknown> | null {
    const w = this.weapon;
    const a = w.def.hands[name];
    if (!this.arms || !a) return null;
    const dist = this.gripDistance(w, a, side);
    const fit = fitGrip(
      (p, f, b) => this.arms!.solveGrip(side, p, f, b, a, dist),
      new THREE.Vector3(...a.pos), new THREE.Vector3(...a.fwd).normalize(), new THREE.Vector3(...a.back).normalize(), opts);
    const r = (v: THREE.Vector3, n: number): V3 => v.toArray().map((x) => +x.toFixed(n)) as V3;
    a.pos = r(fit.pos, 4);
    a.fwd = r(fit.fwd, 3);
    a.back = r(fit.back, 3);
    this.invalidateGrips();
    return { pos: a.pos, fwd: a.fwd, back: a.back, score: +fit.score.toFixed(2), ...fit.pose.contact, blocked: fit.pose.blocked };
  }

  get weapon(): WeaponState {
    return this.weapons[this.current];
  }

  get reloading(): boolean {
    return this.action === 'reload';
  }

  get aiming(): boolean {
    return this.aimBlend > 0.6;
  }

  get busy(): boolean {
    return this.action !== 'idle';
  }

  get obstruction(): number {
    return this.currentObstruction;
  }

  setVisible(on: boolean): void {
    this.holder.visible = on;
    if (this.arms) this.arms.visible = on;
  }

  /** Full ammo. `loadout` lists the weapon ids the player carries (default: all of them). */
  reset(loadout?: string[]): void {
    for (const w of this.weapons) {
      w.mag = w.def.magSize;
      w.reserve = w.def.reserve;
      w.unlocked = !loadout || loadout.includes(w.def.id);
    }
    this.aimBlend = 0;
    this.action = 'idle';
    this.select(Math.max(0, this.weapons.findIndex((w) => w.unlocked)));
  }

  /** Ammo and carried weapons, for mission checkpoints. */
  snapshot(): { mag: number; reserve: number; unlocked: boolean }[] {
    return this.weapons.map((w) => ({ mag: w.mag, reserve: w.reserve, unlocked: w.unlocked }));
  }

  restore(snap: { mag: number; reserve: number; unlocked: boolean }[], slot: number): void {
    this.weapons.forEach((w, i) => {
      const s = snap[i];
      if (!s) return;
      // Coming back from a checkpoint with an empty gun is no fun: at least two magazines
      w.mag = Math.max(s.mag, Math.min(w.def.magSize, s.mag + s.reserve));
      w.reserve = Math.max(s.reserve, w.def.magSize * 2);
      w.unlocked = s.unlocked;
    });
    this.aimBlend = 0;
    this.action = 'idle';
    this.outOfAmmo = false;
    this.select(this.weapons[slot]?.unlocked ? slot : Math.max(0, this.weapons.findIndex((w) => w.unlocked)));
  }

  refillReserve(): void {
    for (const w of this.weapons) w.reserve = Math.max(w.reserve, w.def.reserve);
    this.outOfAmmo = false;
  }

  private select(i: number): void {
    this.weapons.forEach((w, k) => (w.vm.group.visible = k === i));
    this.current = i;
    this.cooldown = 0;
    this.kickPos.reset();
    this.kickRot.reset();
    this.motion.setProfile(motionProfile(this.weapon.def.id));
    this.motion.reset();
    this.outOfAmmo = false;
    this.afterLoot = -1;
    this.lootTargetWorld = null;
    this.play('draw', this.weapon.def.anims.draw);
  }

  hasWeapon(id: string): boolean {
    return this.weapons.some((w) => w.def.id === id && w.unlocked);
  }

  isCurrentWeapon(id: string): boolean {
    return this.weapon.def.id === id;
  }

  unlockWeapon(slotOrId: number | string, ammo?: number): boolean {
    const w = typeof slotOrId === 'number'
      ? this.weapons[slotOrId]
      : this.weapons.find((x) => x.def.id === slotOrId);
    if (!w) return false;
    w.unlocked = true;
    if (ammo !== undefined && ammo > 0) {
      w.reserve = Math.min(w.def.reserve * 2, w.reserve + ammo);
    }
    const idx = this.weapons.indexOf(w);
    if (idx >= 0 && idx !== this.current) {
      this.requestSwitch(idx);
    }
    return true;
  }

  addAmmo(slotOrId: number | string, amount: number): { added: number; full: boolean } {
    const w = typeof slotOrId === 'number'
      ? this.weapons[slotOrId]
      : this.weapons.find((x) => x.def.id === slotOrId);
    if (!w) return { added: 0, full: true };
    const maxReserve = w.def.reserve * 2;
    if (w.reserve >= maxReserve) return { added: 0, full: true };
    const toAdd = Math.min(amount, maxReserve - w.reserve);
    w.reserve += toAdd;
    this.outOfAmmo = false;
    return { added: toAdd, full: false };
  }

  canAddAmmo(slotOrId: number | string): boolean {
    const w = typeof slotOrId === 'number'
      ? this.weapons[slotOrId]
      : this.weapons.find((x) => x.def.id === slotOrId);
    if (!w) return false;
    return w.reserve < w.def.reserve * 2;
  }

  setObstacleColliders(colliders: THREE.Box3[]): void {
    this.mapColliders = colliders;
  }

  /** Reach out with the support hand for something being picked up. False if the hands are busy. */
  playLoot(targetWorldPos?: THREE.Vector3): boolean {
    const tl = this.weapon.def.anims.loot;
    if (!tl || (this.action !== 'idle' && this.action !== 'inspect')) return false;
    this.lootTargetWorld = targetWorldPos ? targetWorldPos.clone() : null;
    this.play('loot', tl);
    return true;
  }

  /** Pick a weapon up off the ground: reach for it, then bring it up in place of the current one. */
  takeWeapon(id: string, ammo: number, at?: THREE.Vector3): boolean {
    const i = this.weapons.findIndex((w) => w.def.id === id);
    if (i < 0) return false;
    const w = this.weapons[i];
    w.unlocked = true;
    w.reserve = Math.min(w.def.reserve * 2, w.reserve + ammo);
    this.outOfAmmo = false;
    if (i === this.current) return true;
    if (this.playLoot(at)) this.afterLoot = i;
    else this.requestSwitch(i);
    return true;
  }

  private play(a: Action, tl: Timeline, speed = 1): void {
    this.action = a;
    this.anim.play(a, tl, speed);
  }

  private hasAmmo(w: WeaponState): boolean {
    return this.infiniteAmmo || w.mag > 0 || w.reserve > 0;
  }

  private requestSwitch(i: number): void {
    if (i < 0 || i >= this.weapons.length) return;
    if (!this.weapons[i].unlocked) return;
    if (i === this.current && this.action !== 'holster') return;
    this.nextWeapon = i;
    if (this.action === 'holster') return;
    if (this.action === 'draw' && this.anim.t < 0.15) {
      // Barely out: go straight to the next gun
      this.select(i);
      return;
    }
    this.play('holster', this.weapon.def.anims.holster);
  }

  private startReload(): void {
    const w = this.weapon;
    if (w.mag >= w.def.magSize || !(w.reserve > 0 || this.infiniteAmmo)) return;
    const empty = w.mag === 0;
    this.play('reload', empty ? w.def.anims.reloadEmpty : w.def.anims.reloadTactical);
  }

  /** Current cone half-angle in radians. */
  spread(player: Player): number {
    const d = this.weapon.def;
    const base = THREE.MathUtils.lerp(d.spreadHip, d.spreadAds, this.aimBlend);
    const move = Math.min(1, player.moveFactor) * d.spreadMove * (1 - this.aimBlend * 0.6);
    const air = player.onGround ? 0 : 0.08;
    const crouch = player.crouching ? 0.7 : 1;
    return (base + move + air + this.bloom) * crouch;
  }

  tick(cmd: PlayerCommand, dt: number, player: Player): ShotRequest[] {
    const shots: ShotRequest[] = [];
    let w = this.weapon;
    let d = w.def;
    const pressed = (b: number): boolean => (cmd.pressed & b) !== 0;
    const held = (b: number): boolean => (cmd.buttons & b) !== 0;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.bloom = Math.max(0, this.bloom - dt * 0.25);
    this.dryT = Math.max(0, this.dryT - dt);

    // Trigger finger tracking: squeeze trigger on hold/fire, recover on release
    if (held(Btn.Fire) || this.cooldown > 0) {
      this.triggerPull = THREE.MathUtils.damp(this.triggerPull, 1, 35, dt);
    } else {
      this.triggerPull = THREE.MathUtils.damp(this.triggerPull, 0, 22, dt);
    }

    // --- Weapon switching (only cycles through unlocked weapons)
    if (player.alive) {
      const n = this.weapons.length;
      let want = -1;
      if (cmd.weapon >= 0 && cmd.weapon < n && this.weapons[cmd.weapon].unlocked) {
        want = cmd.weapon;
      }
      if (pressed(Btn.NextWeapon)) {
        for (let s = 1; s < n; s++) {
          const idx = (this.current + s) % n;
          if (this.weapons[idx].unlocked) { want = idx; break; }
        }
      }
      if (pressed(Btn.PrevWeapon)) {
        for (let s = 1; s < n; s++) {
          const idx = (this.current + n - s) % n;
          if (this.weapons[idx].unlocked) { want = idx; break; }
        }
      }
      if (want >= 0 && want !== (this.action === 'holster' ? this.nextWeapon : this.current)) {
        this.requestSwitch(want);
      }
    }

    // --- Timeline events
    for (const ev of this.anim.update(dt)) {
      if (ev === 'ammo') {
        const need = d.magSize - w.mag;
        const take = this.infiniteAmmo ? need : Math.min(need, w.reserve);
        w.mag += take;
        if (!this.infiniteAmmo) w.reserve -= take;
      } else if (ev === 'ready' || ev === 'end') {
        if (this.action === 'holster') {
          this.select(this.nextWeapon);
          w = this.weapon;
          d = w.def;
          break; // the rest of this list belonged to the holster timeline
        } else if (this.action !== 'idle') {
          const next = this.action === 'loot' ? this.afterLoot : -1;
          this.action = 'idle';
          // Keep the timeline's tail playing for presentation; logic is free again.
          this.afterLoot = -1;
          if (next >= 0) this.requestSwitch(next);
        }
      } else if (ev.startsWith('drop:')) {
        this.dropPart(ev.slice(5));
      } else if (ev === 'eject') {
        w.vm.eject();
        this.onSound?.('casing');
      } else if (ev === 'mag_in') {
        // The magazine seats: a sharp push up into the well that the hands then absorb
        this.motion.bump(-0.004, 0.006, 0.03, -0.016);
        this.onSound?.(ev);
      } else if (ev === 'mag_out') {
        this.motion.bump(0.002, -0.004, -0.014, 0.006);
        this.onSound?.(ev);
      } else if (ev === 'mag_insert') {
        // The magazine meets the mouth of the well: a knock sideways before the push
        this.motion.bump(0.001, 0.002, 0.008, -0.02);
        this.onSound?.(ev);
      } else if (ev === 'round_in') {
        // A round thumbed down into the action
        this.motion.bump(0, -0.003, -0.012, 0.01);
        this.onSound?.(ev);
      } else if (ev === 'tug') {
        // A pull on the seated magazine to check the catch has it (silent)
        this.motion.bump(0.001, -0.003, -0.01, 0.008);
      } else if (ev === 'grip') {
        // The support hand lands back on the gun
        this.motion.bump(-0.002, -0.002, 0.008, -0.012);
        this.onSound?.(ev);
      } else if (ev === 'charge_fwd' || ev === 'slide' || ev === 'bolt_release') {
        // Bolt or slide slams home
        this.motion.bump(-0.009, 0.002, -0.035, 0.012);
        this.onSound?.(ev);
      } else if (ev === 'charge_back' || ev === 'bolt' || ev === 'slide_back') {
        this.motion.bump(0.008, 0.001, 0.022, -0.008);
        this.onSound?.(ev);
      } else if (ev === 'bolt_up' || ev === 'bolt_fwd') {
        this.motion.bump(ev === 'bolt_fwd' ? -0.004 : 0.002, 0.001, 0.008, ev === 'bolt_up' ? 0.02 : -0.012);
        this.onSound?.(ev);
      } else {
        this.onSound?.(ev);
      }
    }

    // --- Automatic follow-ups after a dry fire
    if (this.autoT >= 0) {
      this.autoT -= dt;
      if (this.autoT < 0) {
        if (this.autoAction === 'reload' && this.action === 'idle') this.startReload();
        else if (this.autoAction === 'switch' && this.action === 'idle') {
          const next = this.weapons.findIndex((o, i) => i !== this.current && this.hasAmmo(o));
          if (next >= 0) this.requestSwitch(next);
        }
        this.autoAction = null;
      }
    }

    const idle = player.alive && this.action === 'idle';
    // Bolt-action: the scope comes off the eye while the bolt cycles.
    const wantsAim = held(Btn.Aim) && player.alive && (idle || this.action === 'cycle' && this.anim.t > 0.75)
      && !player.sprinting;
    const rate = 1 / d.adsTime;
    this.aimBlend = THREE.MathUtils.clamp(this.aimBlend + (wantsAim ? rate : -rate * 1.3) * dt, 0, 1);
    this.scoped = d.optic === 'scope' && this.aimBlend > 0.9;

    // Scope sway (breathing). Hold Shift while scoped to steady for a few seconds.
    this.breathT += dt;
    const holding = this.scoped && held(Btn.Sprint) && this.breath > 0;
    this.breath = holding ? Math.max(0, this.breath - dt) : Math.min(4, this.breath + dt * 0.8);
    const amp = this.scoped ? (holding ? 0.0004 : 0.0035 * (1 + player.moveFactor * 2)) : 0;
    player.viewOffset.x = Math.sin(this.breathT * 1.3) * amp + Math.sin(this.breathT * 3.1) * amp * 0.3;
    player.viewOffset.y = Math.cos(this.breathT * 0.9) * amp * 1.2;

    // Spray pattern resets when the trigger is released for a moment
    this.sprayT -= dt;
    if (this.sprayT <= 0) this.sprayShots = 0;

    // --- Inspect
    if (idle && pressed(Btn.Inspect)) this.play('inspect', d.anims.inspect);
    if (this.action === 'inspect' && (held(Btn.Fire) || held(Btn.Aim) || pressed(Btn.Reload))) {
      this.action = 'idle';
      this.anim.stop();
    }

    // --- Reload / fire
    const canAct = player.alive && this.action === 'idle';
    if (canAct && pressed(Btn.Reload)) this.startReload();
    else if (canAct && this.cooldown === 0 && !player.sprinting) {
      const trigger = d.automatic ? held(Btn.Fire) : pressed(Btn.Fire);
      if (trigger && w.mag > 0) {
        this.fire(w, cmd, player, shots);
      } else if (pressed(Btn.Fire) && w.mag === 0) {
        this.onDryFire?.();
        this.dryT = 0.2;
        this.cooldown = 0.2;
        if (w.reserve > 0 || this.infiniteAmmo) {
          this.autoAction = 'reload';
          this.autoT = 0.12;
        } else {
          this.outOfAmmo = true;
          this.autoAction = 'switch';
          this.autoT = 0.45;
        }
      }
    }
    return shots;
  }

  private fire(w: WeaponState, cmd: PlayerCommand, player: Player, shots: ShotRequest[]): void {
    const d = w.def;
    w.mag--;
    this.cooldown = 60 / d.rpm + d.cycleTime;
    this.triggerPull = 1;
    const q = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(cmd.pitch + player.punchPitch + player.viewOffset.x, cmd.yaw + player.punchYaw + player.viewOffset.y, 0, 'YXZ'));
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    shots.push({ origin: player.eye, dir: jitter(fwd, this.spread(player)), weapon: w });
    // Recoil: view punch + a learnable climb/drift for sustained fire
    const adsDamp = 1 - this.aimBlend * 0.35;
    const n = this.sprayShots++;
    this.sprayT = (60 / d.rpm) * 2.5;
    const drift = n > 4 ? Math.sin(n * 0.45) * d.sprayDrift : 0;
    player.punchPitch += d.recoilPitch * adsDamp;
    player.punchYaw += (Math.random() - 0.5) * 2 * d.recoilYaw + drift;
    player.pitch += (d.recoilPitch * 0.25 + Math.min(n, 12) * d.sprayClimb) * adsDamp;
    player.yaw += drift * 0.5;
    this.bloom = Math.min(0.08, this.bloom + d.recoilPitch * 0.3);

    // Viewmodel kick (presentation, but cheap to start here)
    this.motion.fire(this.sprayShots, this.aimBlend, player.crouching);
    this.flashT = 0.05;
    this.firePartT = 0;
    w.vm.flash.material.rotation = Math.random() * Math.PI * 2;
    if (!d.anims.cycle) w.vm.eject();
    this.onFire?.(w);
    if (d.anims.cycle && w.mag > 0) this.play('cycle', d.anims.cycle);
  }

  private dropPart(role: string): void {
    const vm = this.weapon.vm;
    const cam = this.cameraRef;
    if (!cam) return;
    vm.group.updateMatrixWorld(true);
    const copy = vm.detachCopy(role);
    if (!copy) return;
    // View space == camera local space: lift the copy into the world through the camera.
    const m = new THREE.Matrix4().compose(copy.position, copy.quaternion, copy.scale).premultiply(cam.matrixWorld);
    m.decompose(copy.position, copy.quaternion, copy.scale);
    const vel = new THREE.Vector3(-0.3, -1.2, 0).applyQuaternion(cam.quaternion);
    this.onDropPart?.(copy, vel);
  }

  /** Set by the game so dropped parts can be placed in the world. */
  cameraRef: THREE.Camera | null = null;

  render(dt: number, alpha: number, _input: Input, player: Player, camera: THREE.PerspectiveCamera, baseFov: number): void {
    const w = this.weapon;
    const d = w.def;
    const vm = w.vm;
    const t = THREE.MathUtils.smoothstep(this.aimBlend, 0, 1);
    const ads = t;

    // --- Environmental Edge Detection & Obstacle Clearance System ---
    // Prevent weapon barrel, hands, and viewmodel from clipping through walls, cover, and level geometry.
    // How far the muzzle sits in front of the eye at the hip, plus a little air
    const reach = -(d.hipPos[2] + d.muzzle[2]) + 0.06;
    let minHitDist = reach;
    if (this.mapColliders.length > 0) {
      const camPos = new THREE.Vector3();
      camera.getWorldPosition(camPos);
      const camDir = new THREE.Vector3();
      camera.getWorldDirection(camDir);
      const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);

      const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
      // Along the line of sight, and along the line the gun itself lies on at the hip
      const gunLine = camPos.clone().addScaledVector(camRight, d.hipPos[0]).addScaledVector(camUp, d.hipPos[1] * 0.6);
      const rays = [new THREE.Ray(camPos, camDir), new THREE.Ray(gunLine, camDir)];

      for (const box of this.mapColliders) {
        for (const r of rays) {
          if (r.intersectBox(box, _hitPoint)) {
            const dist = r.origin.distanceTo(_hitPoint);
            if (dist < minHitDist) minHitDist = dist;
          }
        }
      }
    }

    const targetObs = Math.max(0, reach - minHitDist);
    this.obstructionSpring.update(dt, new THREE.Vector3(targetObs, 0, 0));
    const obs = Math.max(0, this.obstructionSpring.x.x);
    this.currentObstruction = obs;

    // Something right in front of the muzzle: the sights can't come up
    const block = THREE.MathUtils.smoothstep(obs, 0, 0.35);
    const effectiveAds = ads * (1 - block);

    // --- FOV (ADS zoom)
    const fov = THREE.MathUtils.lerp(baseFov, d.adsFov, effectiveAds);
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }

    const pos = new THREE.Vector3(...d.hipPos).lerp(new THREE.Vector3(...d.adsPos), effectiveAds);
    const rot = new THREE.Euler(0, 0, 0, 'YXZ');

    // Against a wall the gun comes back and up into a high ready instead of poking through it
    if (block > 0.001) {
      pos.z += block * 0.09;
      pos.y += block * 0.015;
      pos.x -= block * 0.035;
      rot.x += block * 0.62;
      rot.y += block * 0.16;
      rot.z += block * 0.22;
    }

    // Purposeful shoulder arc when raising or lowering into ADS
    const adsArc = Math.sin(Math.PI * effectiveAds);
    const arc = this.motion.profile.adsArc;
    pos.x += adsArc * arc.pos[0];
    pos.y += adsArc * arc.pos[1];
    pos.z += adsArc * arc.pos[2];
    rot.x += adsArc * arc.rot[0];
    rot.y += adsArc * arc.rot[1];
    rot.z += adsArc * arc.rot[2];

    // Everything that moves the gun in the hands: recoil, sway, inertia, idle, gait, air, crouch, sprint
    this.motion.update({
      dt, yaw: player.yaw, pitch: player.pitch, velocity: player.velocity, onGround: player.onGround,
      crouching: player.crouching, sprinting: player.sprinting && player.alive, ads: effectiveAds,
      sprintAllowed: this.action === 'reload' || this.action === 'inspect' ? 0.35 : 1,
    });
    pos.add(this.motion.pos);
    rot.x += this.motion.rot.x;
    rot.y += this.motion.rot.y;
    rot.z += this.motion.rot.z;

    // Handling bumps from animation events
    this.kickPos.update(dt);
    this.kickRot.update(dt);
    pos.y += this.kickPos.x.y;
    pos.z += this.kickPos.x.z;
    rot.x += this.kickRot.x.x;
    rot.y += this.kickRot.x.y;
    rot.z += this.kickRot.x.z;

    // Dry fire: a little trigger slap
    if (this.dryT > 0) rot.x += Math.sin((0.2 - this.dryT) / 0.2 * Math.PI) * 0.015;

    // Timeline (reload, draw, holster, cycle, inspect, loot), sampled between ticks
    const animT = this.anim.t;
    if (this.anim.playing) this.anim.t = animT + alpha * (1 / 60) * this.anim.speed;
    const tlScale = this.action === 'reload' || this.action === 'inspect' ? 1 - effectiveAds : 1;
    const ap = this.anim.value('pos', _v3);
    pos.x += ap[0] * tlScale;
    pos.y += ap[1] * tlScale;
    pos.z += ap[2] * tlScale;
    const ar = this.anim.value('rot', _r3);
    rot.x += ar[0] * tlScale;
    rot.y += ar[1] * tlScale;
    rot.z += ar[2] * tlScale;
    if (!player.alive) {
      pos.y -= 0.3;
      rot.x -= 0.8;
    }

    // Parts: timeline offsets, per-shot travel, locked back on empty
    this.firePartT += dt;
    const fireEnv = this.firePartT < 0.012 ? this.firePartT / 0.012 : Math.max(0, 1 - (this.firePartT - 0.012) / 0.045);
    for (const role of Object.keys(d.parts)) {
      const tlPos = this.anim.tl?.tracks[role] ? this.anim.value(role, [0, 0, 0]) : null;
      const tlRot = this.anim.tl?.tracks[`${role}_rot`] ? this.anim.value(`${role}_rot`, [0, 0, 0]) : undefined;
      let off: V3 = tlPos ?? [0, 0, 0];
      const fp = d.fireParts?.[role];
      if (!tlPos && fp) {
        const locked = d.lockOnEmpty?.includes(role) && w.mag === 0 && this.action !== 'draw';
        const k = locked ? 1 : fireEnv;
        off = [fp[0] * k, fp[1] * k, fp[2] * k];
      }
      vm.posePart(role, off, tlRot);
      const shown = this.anim.shown(role);
      vm.setPartVisible(role, shown ?? !(d.hiddenParts ?? []).includes(role));
    }
    // The magazine in hand is loaded unless it is the empty one on its way out
    // (a fresh one comes into view once the timeline stops hiding the magazine, else after 0.8 s)
    vm.setRoundVisible(w.mag > 0 || (this.action === 'reload' && animT > (this.anim.tl?.hide?.mag?.[1] ?? 0.8)));
    this.anim.t = animT;

    vm.group.position.copy(pos);
    vm.group.rotation.copy(rot);
    vm.group.updateMatrix();
    // Through a scope you only see the optic overlay
    const showGun = !this.scoped;
    vm.group.visible = showGun;
    const dot = vm.group.getObjectByName('reddot');
    if (dot) dot.visible = effectiveAds > 0.75;
    vm.updateCasings(dt);

    // Arms on the gun
    if (this.arms) {
      this.arms.visible = showGun && this.holder.visible;
      if (showGun) {
        const L = this.handTarget('l', d.restLeft, camera);
        const R = this.handTarget('r', d.restRight, camera);
        const shoulderFollow = new THREE.Vector3(
          (pos.x - d.hipPos[0]) * 0.3,
          (pos.y - d.hipPos[1]) * 0.22,
          (pos.z - d.hipPos[2]) * 0.18,
        );
        this.arms.update(L, R, shoulderFollow, this.triggerPull);
      }
    }

    // Muzzle flash
    this.flashT -= dt;
    const on = this.flashT > 0;
    vm.flash.visible = on && showGun;
    vm.flash.scale.setScalar(on ? 0.12 + Math.random() * 0.08 : 0.1);
    this.flashLight.intensity = on ? 6 : 0;
    this.worldFlash.intensity = on ? 40 : 0;
    if (on) vm.muzzle.getWorldPosition(this.flashLight.position);
  }

  private handTarget(side: 'l' | 'r', rest: string, camera?: THREE.Camera): HandTarget {
    const w = this.weapon;
    const held = this.debugHands[side];
    const [a, b, u] = held ? [held, held, 1] : this.anim.hand(side, rest);
    const nameA = w.def.hands[a] ? a : rest;
    const nameB = w.def.hands[b] ? b : rest;
    const A = w.def.hands[nameA];
    const B = w.def.hands[nameB];
    const gA = this.grip(w, nameA, side);
    const gB = this.grip(w, nameB, side);
    const p1 = new THREE.Vector3(), f1 = new THREE.Vector3(), k1 = new THREE.Vector3();
    const p2 = new THREE.Vector3(), f2 = new THREE.Vector3(), k2 = new THREE.Vector3();
    w.vm.anchor(A, p1, f1, k1, gA?.pos);
    w.vm.anchor(B, p2, f2, k2, gB?.pos);

    // Reaching for loot: the hand goes toward the thing itself, within what an arm can do
    if (this.lootTargetWorld && camera) {
      const inView = this.lootTargetWorld.clone().applyMatrix4(camera.matrixWorldInverse);
      inView.x = THREE.MathUtils.clamp(inView.x, -0.26, 0.1);
      inView.y = THREE.MathUtils.clamp(inView.y, -0.42, -0.2);
      inView.z = THREE.MathUtils.clamp(inView.z, -0.62, -0.34);
      const local = inView.applyMatrix4(w.vm.group.matrix.clone().invert());
      if (A.air) p1.copy(local);
      if (B.air) p2.copy(local);
    }

    const e = THREE.MathUtils.smoothstep(u, 0, 1);
    const moving = nameA !== nameB && e > 0.001 && e < 0.999;
    p1.lerp(p2, e);
    f1.lerp(f2, e).normalize();
    k1.lerp(k2, e).normalize();

    // A hand changing grips lifts off the gun and comes back down, rather than sliding through it:
    // an arc away from the palm side, and whatever of the gun is still in the way pushes the
    // wrist out to arm's-thickness clearance.
    if (moving) {
      const arc = Math.sin(Math.PI * e);
      const lift = 0.02 + Math.min(0.03, p1.distanceTo(p2) * 0.12);
      p1.addScaledVector(k1, arc * lift);
      p1.y -= arc * 0.012;
      const d = w.vm.surface().closest(p1, _near, HAND_CLEARANCE);
      if (d !== null && d > 1e-4) p1.addScaledVector(_near.subVectors(p1, _near).divideScalar(d), (HAND_CLEARANCE - d) * arc);
    }

    // Fingers open on the way and close again as the hand arrives
    const rel = this.arms!.relaxed(side);
    const open = moving ? Math.sin(Math.PI * e) * 0.75 : 0;
    const fingers = rel.map((r, i) => {
      const q = (gA?.quats[i] ?? r).clone().slerp(gB?.quats[i] ?? r, e);
      return open > 0 ? q.slerp(r, open) : q;
    });

    const m = w.vm.group.matrix;
    const q = w.vm.group.quaternion;
    return { pos: p1.applyMatrix4(m), fwd: f1.applyQuaternion(q), back: k1.applyQuaternion(q), fingers };
  }
}

function jitter(dir: THREE.Vector3, cone: number): THREE.Vector3 {
  if (cone <= 0) return dir.clone();
  // Uniform-ish disc sampling, biased toward the center like real dispersion
  const r = cone * Math.sqrt(Math.random()) * (0.5 + Math.random() * 0.5);
  const a = Math.random() * Math.PI * 2;
  const up = Math.abs(dir.y) < 0.99 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const right = new THREE.Vector3().crossVectors(dir, up).normalize();
  const realUp = new THREE.Vector3().crossVectors(right, dir).normalize();
  return dir.clone()
    .addScaledVector(right, Math.cos(a) * r)
    .addScaledVector(realUp, Math.sin(a) * r)
    .normalize();
}
