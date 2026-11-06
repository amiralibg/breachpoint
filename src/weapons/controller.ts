import * as THREE from 'three';
import type { Input } from '../core/input';
import type { Player } from '../player/player';
import { flashTexture } from '../world/effects';
import type { WeaponState } from './weapons';

export interface ShotRequest {
  origin: THREE.Vector3;
  dir: THREE.Vector3;
  weapon: WeaponState;
}

type Phase = 'idle' | 'reload' | 'switchOut' | 'switchIn';

/** First-person weapon handling: firing, reloading, switching, ADS and the viewmodel motion. */
export class WeaponController {
  current = 0;
  private phase: Phase = 'switchIn';
  private phaseT = 0;
  private cooldown = 0;
  private nextWeapon = 0;
  private bloom = 0;
  aimBlend = 0;
  scoped = false;
  /** Seconds of held breath available while scoped. */
  breath = 4;
  private breathT = 0;
  private sprayShots = 0;
  private sprayT = 0;
  infiniteAmmo = false;

  private holder = new THREE.Group();
  private flash: THREE.Sprite;
  private flashLight: THREE.PointLight;
  private flashT = 0;
  private swayX = 0;
  private swayY = 0;
  private kick = 0;
  private bobT = 0;

  onFire: ((w: WeaponState) => void) | null = null;
  onDryFire: (() => void) | null = null;
  onReloadStart: ((w: WeaponState) => void) | null = null;
  onReloadEnd: ((w: WeaponState) => void) | null = null;

  constructor(
    readonly weapons: WeaponState[],
    viewScene: THREE.Scene,
    private worldFlash: THREE.PointLight,
  ) {
    viewScene.add(this.holder);
    for (const w of weapons) this.holder.add(w.view);
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({
      map: flashTexture, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    }));
    this.flash.visible = false;
    this.flashLight = new THREE.PointLight(0xffb060, 0, 3, 2);
    viewScene.add(this.flashLight);
    this.select(0, true);
  }

  get weapon(): WeaponState {
    return this.weapons[this.current];
  }

  get reloading(): boolean {
    return this.phase === 'reload';
  }

  get aiming(): boolean {
    return this.aimBlend > 0.6;
  }

  reset(): void {
    for (const w of this.weapons) {
      w.mag = w.def.magSize;
      w.reserve = w.def.reserve;
    }
    this.select(0, true);
  }

  refillReserve(): void {
    for (const w of this.weapons) w.reserve = Math.max(w.reserve, w.def.reserve);
  }

  private select(i: number, instant = false): void {
    this.weapons.forEach((w, k) => (w.view.visible = k === i));
    this.current = i;
    this.weapon.muzzle.add(this.flash);
    this.phase = 'switchIn';
    this.phaseT = instant ? 0.01 : 0.45;
    this.cooldown = 0;
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

  update(dt: number, input: Input, player: Player, camera: THREE.PerspectiveCamera, baseFov: number): ShotRequest[] {
    const shots: ShotRequest[] = [];
    const w = this.weapon;
    const d = w.def;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.bloom = Math.max(0, this.bloom - dt * 0.25);

    // --- Weapon switching
    let want = this.current;
    if (input.hit('Digit1')) want = 0;
    if (input.hit('Digit2')) want = 1;
    if (input.hit('Digit3')) want = 2;
    if (input.hit('KeyQ')) want = (this.current + 1) % this.weapons.length;
    if (input.wheel !== 0) want = (this.current + (input.wheel > 0 ? 1 : this.weapons.length - 1)) % this.weapons.length;
    if (want !== this.current && this.phase !== 'switchOut' && player.alive) {
      this.nextWeapon = want;
      this.phase = 'switchOut';
      this.phaseT = 0.25;
    }

    // --- Phase timers
    if (this.phase !== 'idle') {
      this.phaseT -= dt;
      if (this.phaseT <= 0) {
        if (this.phase === 'switchOut') this.select(this.nextWeapon);
        else if (this.phase === 'reload') {
          const need = d.magSize - w.mag;
          const take = this.infiniteAmmo ? need : Math.min(need, w.reserve);
          w.mag += take;
          if (!this.infiniteAmmo) w.reserve -= take;
          this.phase = 'idle';
          this.onReloadEnd?.(w);
        } else this.phase = 'idle';
      }
    }

    const canAct = player.alive && this.phase === 'idle';
    // Bolt-action: the scope comes off the eye while the bolt cycles.
    const cycling = d.cycleTime > 0 && this.cooldown > 0.12;
    const wantsAim = input.aim && player.alive && this.phase === 'idle' && !player.sprinting && !cycling;
    this.aimBlend = THREE.MathUtils.damp(this.aimBlend, wantsAim ? 1 : 0, d.optic === 'scope' ? 11 : 14, dt);
    this.scoped = d.optic === 'scope' && this.aimBlend > 0.9;

    // Scope sway (breathing). Hold Shift while scoped to steady for a few seconds.
    this.breathT += dt;
    const holding = this.scoped && input.down('ShiftLeft') && this.breath > 0;
    this.breath = holding ? Math.max(0, this.breath - dt) : Math.min(4, this.breath + dt * 0.8);
    if (this.scoped) {
      const amp = holding ? 0.0004 : 0.0035 * (1 + player.moveFactor * 2);
      camera.rotation.x += Math.sin(this.breathT * 1.3) * amp + Math.sin(this.breathT * 3.1) * amp * 0.3;
      camera.rotation.y += Math.cos(this.breathT * 0.9) * amp * 1.2;
    }

    // Spray pattern resets when the trigger is released for a moment
    this.sprayT -= dt;
    if (this.sprayT <= 0) this.sprayShots = 0;

    // --- Reload
    if (canAct && (input.hit('KeyR') || (w.mag === 0 && input.firePressed)) && w.mag < d.magSize && (w.reserve > 0 || this.infiniteAmmo)) {
      this.phase = 'reload';
      this.phaseT = d.reloadTime;
      this.onReloadStart?.(w);
    } else if (canAct && this.cooldown === 0 && !player.sprinting) {
      const trigger = d.automatic ? input.fire : input.firePressed;
      if (trigger) {
        if (w.mag > 0) {
          w.mag--;
          this.cooldown = 60 / d.rpm + d.cycleTime;
          const origin = camera.getWorldPosition(new THREE.Vector3());
          const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
          shots.push({ origin, dir: jitter(fwd, this.spread(player)), weapon: w });
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
          this.kick = 1;
          this.flashT = 0.05;
          this.flash.material.rotation = Math.random() * Math.PI * 2;
          this.onFire?.(w);
        } else if (input.firePressed) {
          this.onDryFire?.();
          this.cooldown = 0.25;
        }
      }
    }

    // --- FOV (ADS zoom)
    const fov = THREE.MathUtils.lerp(baseFov, d.adsFov, this.aimBlend);
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }

    this.animate(dt, input, player);
    return shots;
  }

  private animate(dt: number, input: Input, player: Player): void {
    const w = this.weapon;
    const d = w.def;
    const hip = new THREE.Vector3(...d.hipPos);
    const ads = new THREE.Vector3(...d.adsPos);
    const pos = hip.lerp(ads, this.aimBlend);
    const rot = new THREE.Euler();

    // Sway follows mouse movement
    const swayAmt = 1 - this.aimBlend * 0.85;
    this.swayX = THREE.MathUtils.damp(this.swayX, -input.mouseDX * 0.0006 * swayAmt, 8, dt);
    this.swayY = THREE.MathUtils.damp(this.swayY, input.mouseDY * 0.0006 * swayAmt, 8, dt);
    pos.x += this.swayX;
    pos.y += this.swayY;
    rot.y += this.swayX * 2;
    rot.x += this.swayY * 2;

    // Walk bob
    const hs = player.onGround ? Math.min(1.5, player.moveFactor) : 0;
    this.bobT += dt * (6 + hs * 4) * (hs > 0.1 ? 1 : 0.25);
    const bobAmt = (0.004 + hs * 0.012) * (1 - this.aimBlend * 0.9);
    pos.x += Math.sin(this.bobT) * bobAmt;
    pos.y += Math.abs(Math.cos(this.bobT)) * bobAmt;
    if (player.sprinting) {
      pos.x -= 0.06;
      pos.y -= 0.04;
      rot.y += 0.6;
      rot.x -= 0.15;
    }

    // Recoil kick
    this.kick = Math.max(0, this.kick - dt * 9);
    const k = this.kick * this.kick;
    pos.z += k * d.kickBack;
    rot.x += k * d.kickBack * 1.6;

    // Reload / switch dip
    let dip = 0;
    if (this.phase === 'reload') {
      const t = 1 - this.phaseT / d.reloadTime;
      dip = Math.sin(Math.min(1, t) * Math.PI);
      rot.z += dip * 0.7;
      rot.x -= dip * 0.35;
    } else if (this.phase === 'switchOut') dip = 1 - this.phaseT / 0.25;
    else if (this.phase === 'switchIn') dip = this.phaseT / 0.45;
    if (!player.alive) dip = 1;
    pos.y -= dip * 0.22;

    w.view.position.copy(pos);
    w.view.rotation.copy(rot);
    // Through a scope you only see the optic overlay
    w.view.visible = !this.scoped;
    const dot = w.view.getObjectByName('reddot');
    if (dot) dot.visible = this.aimBlend > 0.75;

    // Muzzle flash
    this.flashT -= dt;
    const on = this.flashT > 0;
    this.flash.visible = on;
    this.flash.scale.setScalar(on ? 0.12 + Math.random() * 0.08 : 0.1);
    this.flashLight.intensity = on ? 6 : 0;
    this.worldFlash.intensity = on ? 40 : 0;
    if (on) w.muzzle.getWorldPosition(this.flashLight.position);
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
