import * as THREE from 'three';
import type { Input } from '../core/input';
import { Btn, type PlayerCommand } from '../net/protocol';
import type { Player } from '../player/player';
import type { FpArms, HandTarget } from './arms';
import { TimelinePlayer, type Timeline, type V3 } from './timeline';
import type { Viewmodel } from './viewmodel';
import type { WeaponDef } from './weapons';

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
}

type Action = 'draw' | 'idle' | 'reload' | 'holster' | 'cycle' | 'inspect';

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
  private swayRot = new Spring3(120, 14);
  private sprintBlend = 0;
  private crouchBlend = 0;
  private bobT = 0;
  private strafeTilt = 0;
  private dryT = 0;

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
    this.select(0);
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

  setVisible(on: boolean): void {
    this.holder.visible = on;
    if (this.arms) this.arms.visible = on;
  }

  reset(): void {
    for (const w of this.weapons) {
      w.mag = w.def.magSize;
      w.reserve = w.def.reserve;
    }
    this.aimBlend = 0;
    this.select(0);
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
    this.outOfAmmo = false;
    this.play('draw', this.weapon.def.anims.draw);
  }

  private play(a: Action, tl: Timeline, speed = 1): void {
    this.action = a;
    this.anim.play(a, tl, speed);
  }

  private hasAmmo(w: WeaponState): boolean {
    return this.infiniteAmmo || w.mag > 0 || w.reserve > 0;
  }

  private requestSwitch(i: number): void {
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

    // --- Weapon switching
    if (player.alive) {
      const n = this.weapons.length;
      let want = cmd.weapon >= 0 && cmd.weapon < n ? cmd.weapon : -1;
      if (pressed(Btn.NextWeapon)) want = (this.current + 1) % n;
      if (pressed(Btn.PrevWeapon)) want = (this.current + n - 1) % n;
      if (want >= 0 && want !== (this.action === 'holster' ? this.nextWeapon : this.current)) this.requestSwitch(want);
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
          this.action = 'idle';
          // Keep the timeline's tail playing for presentation; logic is free again.
        }
      } else if (ev.startsWith('drop:')) {
        this.dropPart(ev.slice(5));
      } else if (ev === 'eject') {
        w.vm.eject();
        this.onSound?.('casing');
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
    const ads = 1 - this.aimBlend * 0.55;
    this.kickPos.v.y += d.kickPos[0] * 60 * ads;
    this.kickPos.v.z += d.kickPos[1] * 60 * ads;
    this.kickRot.v.x += d.kickRot[0] * 60 * ads;
    this.kickRot.v.y += (Math.random() - 0.5) * 2 * d.kickRot[1] * 60 * ads;
    this.kickRot.v.z += (Math.random() - 0.5) * 2 * d.kickRot[2] * 60 * ads;
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

  render(dt: number, alpha: number, input: Input, player: Player, camera: THREE.PerspectiveCamera, baseFov: number): void {
    const w = this.weapon;
    const d = w.def;
    const vm = w.vm;
    const t = THREE.MathUtils.smoothstep(this.aimBlend, 0, 1);
    const ads = t;

    // --- FOV (ADS zoom)
    const fov = THREE.MathUtils.lerp(baseFov, d.adsFov, ads);
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }

    const pos = new THREE.Vector3(...d.hipPos).lerp(new THREE.Vector3(...d.adsPos), ads);
    const rot = new THREE.Euler(0, 0, 0, 'YXZ');

    // Sway: the gun lags behind mouse movement, less so when aiming
    const swayAmt = (1 - ads * 0.85) * d.weight;
    const swayTarget = new THREE.Vector3(
      THREE.MathUtils.clamp(input.mouseDY * 0.0011, -0.08, 0.08) * swayAmt,
      THREE.MathUtils.clamp(input.mouseDX * 0.0011, -0.08, 0.08) * swayAmt,
      THREE.MathUtils.clamp(input.mouseDX * 0.0016, -0.1, 0.1) * swayAmt,
    );
    this.swayRot.update(dt, swayTarget);
    rot.x += this.swayRot.x.x;
    rot.y += this.swayRot.x.y;
    rot.z += this.swayRot.x.z;
    pos.x += this.swayRot.x.y * 0.06;
    pos.y -= this.swayRot.x.x * 0.06;

    // Strafe tilt + walk bob (figure-eight), damped when aiming
    const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(THREE.Object3D.DEFAULT_UP, player.yaw);
    const side = player.velocity.dot(right) / 5.2;
    this.strafeTilt = THREE.MathUtils.damp(this.strafeTilt, THREE.MathUtils.clamp(side, -1, 1), 8, dt);
    rot.z -= this.strafeTilt * 0.06 * (1 - ads * 0.8);
    const hs = player.onGround ? Math.min(1.5, player.moveFactor) : 0;
    this.bobT += dt * (6.5 + hs * 4) * (hs > 0.1 ? 1 : 0.25);
    const bobAmt = (0.0025 + hs * 0.011) * (1 - ads * 0.92) * (0.7 + d.weight * 0.3);
    pos.x += Math.sin(this.bobT) * bobAmt;
    pos.y += Math.abs(Math.cos(this.bobT)) * bobAmt * 0.9 - bobAmt * 0.5;
    rot.z += Math.sin(this.bobT) * bobAmt * 1.5;
    if (!player.onGround) pos.y += THREE.MathUtils.clamp(player.velocity.y * -0.004, -0.02, 0.03);

    // Sprint: gun swings down and across
    this.sprintBlend = THREE.MathUtils.damp(this.sprintBlend, player.sprinting && this.action !== 'reload' ? 1 : 0, 9, dt);
    const sb = this.sprintBlend;
    if (sb > 0.001) {
      const pistol = d.id === 'pistol';
      pos.x += sb * (pistol ? -0.02 : -0.05);
      pos.y += sb * (pistol ? -0.06 : -0.035) + Math.abs(Math.sin(this.bobT)) * 0.012 * sb;
      pos.z += sb * 0.02;
      rot.x += sb * (pistol ? -0.55 : -0.25);
      rot.y += sb * (pistol ? 0.2 : 0.7);
      rot.z += sb * (pistol ? 0.1 : 0.3);
    }
    // Crouch: tuck the gun in a little
    this.crouchBlend = THREE.MathUtils.damp(this.crouchBlend, player.crouching ? 1 : 0, 8, dt);
    rot.z += this.crouchBlend * 0.05 * (1 - ads);
    pos.y -= this.crouchBlend * 0.006 * (1 - ads);

    // Recoil springs
    this.kickPos.update(dt);
    this.kickRot.update(dt);
    pos.y += this.kickPos.x.y;
    pos.z += this.kickPos.x.z;
    rot.x += this.kickRot.x.x;
    rot.y += this.kickRot.x.y;
    rot.z += this.kickRot.x.z;

    // Dry fire: a little trigger slap
    if (this.dryT > 0) rot.x += Math.sin((0.2 - this.dryT) / 0.2 * Math.PI) * 0.015;

    // Timeline (reload, draw, holster, cycle, inspect), sampled between ticks
    const animT = this.anim.t;
    if (this.anim.playing) this.anim.t = animT + alpha * (1 / 60) * this.anim.speed;
    const tlScale = this.action === 'reload' || this.action === 'inspect' ? 1 - ads : 1;
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
    this.anim.t = animT;

    vm.group.position.copy(pos);
    vm.group.rotation.copy(rot);
    vm.group.updateMatrix();
    // Through a scope you only see the optic overlay
    const showGun = !this.scoped;
    vm.group.visible = showGun;
    const dot = vm.group.getObjectByName('reddot');
    if (dot) dot.visible = ads > 0.75;
    vm.updateCasings(dt);

    // Arms on the gun
    if (this.arms) {
      this.arms.visible = showGun && this.holder.visible;
      if (showGun) {
        const L = this.handTarget('l', d.restLeft);
        const R = this.handTarget('r', d.restRight);
        const m = vm.group.matrix;
        const caps = d.colliders
          .filter((c) => !c.part || vm.partVisible(c.part))
          .map((c) => ({ a: vm.partPoint(c.part, c.a).applyMatrix4(m), b: vm.partPoint(c.part, c.b).applyMatrix4(m), r: c.r, hand: c.hand }));
        this.arms.update(L, R, new THREE.Vector3(pos.x - d.hipPos[0], 0, 0).multiplyScalar(0.3), caps);
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

  private handTarget(side: 'l' | 'r', rest: string): HandTarget {
    const w = this.weapon;
    const [a, b, u] = this.anim.hand(side, rest);
    const A = w.def.hands[a] ?? w.def.hands[rest];
    const B = w.def.hands[b] ?? w.def.hands[rest];
    const p1 = new THREE.Vector3(), f1 = new THREE.Vector3(), k1 = new THREE.Vector3();
    const p2 = new THREE.Vector3(), f2 = new THREE.Vector3(), k2 = new THREE.Vector3();
    w.vm.anchor(A, p1, f1, k1);
    w.vm.anchor(B, p2, f2, k2);
    const e = THREE.MathUtils.smoothstep(u, 0, 1);
    p1.lerp(p2, e);
    f1.lerp(f2, e).normalize();
    k1.lerp(k2, e).normalize();
    const m = w.vm.group.matrix;
    const q = w.vm.group.quaternion;
    return {
      pos: p1.applyMatrix4(m),
      fwd: f1.applyQuaternion(q),
      back: k1.applyQuaternion(q),
      curl: THREE.MathUtils.lerp(A.curl, B.curl, e),
    };
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
