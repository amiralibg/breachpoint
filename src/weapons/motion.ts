import * as THREE from 'three';

/**
 * Viewmodel motion: everything that moves the gun in the hands that isn't an authored animation.
 *
 * Each layer is its own spring with its own frequency and damping, so the layers settle at
 * different speeds and never read as one rigid offset. Tuning lives in MotionProfile: amplitudes
 * are given as the peak the gun reaches (metres / radians), not as raw impulses, so the numbers
 * can be read and tuned directly.
 *
 * Axes (view space): pos x right, y up, z back; rot x pitch (up +), y yaw (left +), z roll.
 */

/** [angular frequency rad/s, damping ratio]. */
export type SpringSpec = [w: number, zeta: number];

export interface MotionProfile {
  recoil: {
    /** Peak displacement per shot. */
    back: number; up: number; side: number;
    pitch: number; yaw: number; roll: number;
    /** First shot of a burst hits harder. */
    first: number;
    /** Multipliers when fully aimed: rotation must stay small or the sight leaves the target. */
    adsRot: number; adsPos: number;
    /** Slow upward creep over sustained fire (radians at full heat). */
    climb: number;
    springs: { back: SpringSpec; pitch: SpringSpec; yaw: SpringSpec; roll: SpringSpec; side: SpringSpec; up: SpringSpec };
  };
  sway: {
    /** Seconds of look rate the gun trails behind by. */
    lag: number;
    /** Clamp (radians). */
    max: number;
    /** Roll per radian of yaw sway. */
    roll: number;
    /** Metres of sideways shift per radian. */
    shift: number;
    spring: SpringSpec;
    ads: number;
  };
  inertia: {
    /** Per m/s of velocity change: gun pushes back / sideways, pitches and rolls. */
    z: number; x: number; pitch: number; roll: number;
    /** Steady roll while strafing, per m/s. */
    lean: number;
    /** Seconds the body takes to "catch up" with a velocity change. */
    tau: number;
    spring: SpringSpec;
  };
  idle: { hz: number; breathY: number; breathP: number; drift: number; driftR: number };
  walk: GaitSpec;
  run: GaitSpec;
  /** Gait multiplier while crouched. */
  crouch: number;
  air: {
    jumpY: number; jumpP: number;
    /** Offset per m/s of vertical speed while airborne. */
    fallY: number; fallP: number;
    landY: number; landP: number; landR: number;
    spring: SpringSpec;
  };
  crouchDip: { y: number; pitch: number; roll: number; spring: SpringSpec };
  sprint: { pos: [number, number, number]; rot: [number, number, number]; spring: SpringSpec };
  /** ADS travel curve: the sight comes up in an arc, not along a straight line. */
  adsArc: { pos: [number, number, number]; rot: [number, number, number] };
}

interface GaitSpec {
  /** Vertical dip per step (m), side sway per stride (m), push per step (m). */
  y: number; x: number; z: number;
  pitch: number; yaw: number; roll: number;
  /** Fraction of a step the gun trails the body by. */
  lag: number;
}

// ---------------------------------------------------------------------------------------------
// Tuning

const RIFLE: MotionProfile = {
  recoil: {
    back: 0.017, up: 0.0025, side: 0.0018,
    pitch: 0.042, yaw: 0.016, roll: 0.028,
    first: 1.4, adsRot: 0.22, adsPos: 0.75, climb: 0.02,
    springs: { back: [44, 0.55], pitch: [36, 0.5], yaw: [30, 0.45], roll: [31, 0.42], side: [40, 0.5], up: [40, 0.5] },
  },
  sway: { lag: 0.058, max: 0.07, roll: 0.55, shift: 0.02, spring: [13.5, 0.64], ads: 0.15 },
  inertia: { z: 0.0042, x: 0.0034, pitch: 0.0085, roll: 0.01, lean: 0.006, tau: 0.13, spring: [15, 0.48] },
  idle: { hz: 0.25, breathY: 0.0005, breathP: 0.0009, drift: 0.0006, driftR: 0.001 },
  walk: { y: 0.0034, x: 0.0034, z: 0.0016, pitch: 0.007, yaw: 0.01, roll: 0.015, lag: 0.04 },
  run: { y: 0.015, x: 0.011, z: 0.006, pitch: 0.028, yaw: 0.028, roll: 0.046, lag: 0.05 },
  crouch: 0.72,
  air: { jumpY: 0.012, jumpP: 0.035, fallY: 0.0019, fallP: 0.004, landY: 0.022, landP: 0.05, landR: 0.03, spring: [20.5, 0.56] },
  crouchDip: { y: 0.0075, pitch: 0.02, roll: 0.028, spring: [16, 0.5] },
  sprint: { pos: [-0.05, -0.035, 0.02], rot: [-0.25, 0.7, 0.3], spring: [17, 1] },
  adsArc: { pos: [0.004, 0.011, -0.01], rot: [0.02, -0.03, -0.03] },
};

const PISTOL: MotionProfile = {
  ...RIFLE,
  recoil: {
    back: 0.012, up: 0.006, side: 0.002,
    pitch: 0.11, yaw: 0.022, roll: 0.04,
    first: 1, adsRot: 0.42, adsPos: 0.8, climb: 0,
    springs: { back: [56, 0.55], pitch: [50, 0.5], yaw: [38, 0.48], roll: [38, 0.45], side: [46, 0.5], up: [46, 0.5] },
  },
  sway: { lag: 0.04, max: 0.085, roll: 0.45, shift: 0.012, spring: [19, 0.6], ads: 0.12 },
  inertia: { z: 0.0034, x: 0.0028, pitch: 0.011, roll: 0.012, lean: 0.0085, tau: 0.1, spring: [20, 0.5] },
  idle: { hz: 0.25, breathY: 0.0006, breathP: 0.0011, drift: 0.0007, driftR: 0.0014 },
  walk: { y: 0.003, x: 0.0036, z: 0.0014, pitch: 0.009, yaw: 0.014, roll: 0.015, lag: 0.028 },
  run: { y: 0.012, x: 0.009, z: 0.005, pitch: 0.034, yaw: 0.03, roll: 0.04, lag: 0.034 },
  air: { jumpY: 0.01, jumpP: 0.045, fallY: 0.0017, fallP: 0.005, landY: 0.019, landP: 0.065, landR: 0.035, spring: [23, 0.54] },
  crouchDip: { y: 0.0065, pitch: 0.03, roll: 0.026, spring: [18, 0.5] },
  sprint: { pos: [-0.02, -0.06, 0.02], rot: [-0.55, 0.2, 0.1], spring: [20, 1] },
  adsArc: { pos: [0.003, 0.008, -0.012], rot: [0.03, -0.02, -0.03] },
};

const SNIPER: MotionProfile = {
  ...RIFLE,
  recoil: {
    back: 0.05, up: 0.008, side: 0.003,
    pitch: 0.16, yaw: 0.03, roll: 0.07,
    first: 1, adsRot: 0.3, adsPos: 0.6, climb: 0,
    springs: { back: [26, 0.5], pitch: [22, 0.48], yaw: [20, 0.45], roll: [20, 0.42], side: [26, 0.5], up: [26, 0.5] },
  },
  sway: { lag: 0.075, max: 0.06, roll: 0.6, shift: 0.024, spring: [11, 0.66], ads: 0.1 },
  inertia: { ...RIFLE.inertia, z: 0.005, x: 0.004, pitch: 0.01, tau: 0.16, spring: [12, 0.5] },
  walk: { ...RIFLE.walk, y: 0.004, roll: 0.018, lag: 0.05 },
  run: { ...RIFLE.run, y: 0.017, roll: 0.05, lag: 0.06 },
};

const PROFILES: Record<string, MotionProfile> = { m4: RIFLE, pistol: PISTOL, sniper: SNIPER };

export function motionProfile(weaponId: string): MotionProfile {
  return PROFILES[weaponId] ?? RIFLE;
}

// ---------------------------------------------------------------------------------------------
// Springs

class Spring {
  x = 0;
  v = 0;
  w = 20;
  z = 0.5;
  set([w, z]: SpringSpec): this {
    this.w = w;
    this.z = z;
    return this;
  }
  update(dt: number, target = 0): void {
    // Semi-implicit Euler, sub-stepped: stiff recoil springs stay stable at 30 fps
    const n = Math.max(1, Math.ceil(dt * 240));
    const h = dt / n;
    const k = this.w * this.w;
    const c = 2 * this.z * this.w;
    for (let i = 0; i < n; i++) {
      this.v += (-(this.x - target) * k - this.v * c) * h;
      this.x += this.v * h;
    }
  }
  /** Kick so that the free response peaks at `peak`. */
  kick(peak: number): void {
    this.v += peak * this.w / peakFactor(this.z);
  }
  reset(): void {
    this.x = this.v = 0;
  }
}

/** Peak of the unit-velocity impulse response of a damped spring, times w. */
function peakFactor(z: number): number {
  if (z >= 1) return Math.exp(-1);
  const s = Math.sqrt(1 - z * z);
  return Math.exp(-(z / s) * Math.atan2(s, z));
}

/** Smooth, non-repeating noise in about -1..1 from a few incommensurate sines. */
function drift(t: number, seed: number): number {
  return (Math.sin(t * 0.71 + seed) * 0.5 + Math.sin(t * 1.37 + seed * 2.1) * 0.3 + Math.sin(t * 2.93 + seed * 3.7) * 0.2);
}

const WALK_SPEED = 5.2;
const RUN_SPEED = 7.4;
/** Metres per footstep (matches the player's footstep timer). */
const STRIDE = 2.4;

export interface MotionInput {
  dt: number;
  yaw: number;
  pitch: number;
  velocity: THREE.Vector3;
  onGround: boolean;
  crouching: boolean;
  sprinting: boolean;
  /** 0..1 smoothed aim. */
  ads: number;
  /** 0..1, how much sprint pose is allowed (reloads keep the gun up). */
  sprintAllowed: number;
}

/** Per-frame output: offsets added to the gun's base pose. */
export class ViewmodelMotion {
  readonly pos = new THREE.Vector3();
  readonly rot = new THREE.Vector3();
  private p: MotionProfile = RIFLE;

  // Recoil
  private kZ = new Spring(); private kP = new Spring(); private kY = new Spring();
  private kR = new Spring(); private kX = new Spring(); private kU = new Spring();
  private heat = 0;
  // Sway
  private swY = new Spring(); private swP = new Spring();
  private lastYaw = NaN; private lastPitch = 0;
  // Inertia
  private inZ = new Spring(); private inX = new Spring(); private inP = new Spring(); private inR = new Spring();
  private lagVel = new THREE.Vector3();
  private lean = 0;
  // Air
  private jY = new Spring(); private jP = new Spring(); private jR = new Spring();
  private wasGround = true;
  private fallSpeed = 0;
  // Crouch
  private cY = new Spring(); private cP = new Spring(); private cR = new Spring();
  private wasCrouch = false;
  // Sprint / gait
  private sprint = new Spring();
  private gaitAmt = 0;
  private steps = 0;
  private t = 0;

  setProfile(p: MotionProfile): void {
    this.p = p;
    const r = p.recoil.springs;
    this.kZ.set(r.back); this.kP.set(r.pitch); this.kY.set(r.yaw);
    this.kR.set(r.roll); this.kX.set(r.side); this.kU.set(r.up);
    this.swY.set(p.sway.spring); this.swP.set(p.sway.spring);
    for (const s of [this.inZ, this.inX, this.inP, this.inR]) s.set(p.inertia.spring);
    for (const s of [this.jY, this.jP, this.jR]) s.set(p.air.spring);
    for (const s of [this.cY, this.cP, this.cR]) s.set(p.crouchDip.spring);
    this.sprint.set(p.sprint.spring);
  }

  get profile(): MotionProfile {
    return this.p;
  }

  reset(): void {
    for (const s of [this.kZ, this.kP, this.kY, this.kR, this.kX, this.kU, this.swY, this.swP,
      this.inZ, this.inX, this.inP, this.inR, this.jY, this.jP, this.jR, this.cY, this.cP, this.cR, this.sprint]) s.reset();
    this.heat = 0;
    this.lastYaw = NaN;
  }

  /** One shot. `burst` counts shots since the trigger was last released (1 = first). */
  fire(burst: number, ads: number, crouching: boolean): void {
    const r = this.p.recoil;
    const first = burst <= 1 ? r.first : burst === 2 ? 0.5 + 0.5 * r.first : 1;
    const m = first * (0.88 + Math.random() * 0.24) * (crouching ? 0.88 : 1);
    const rm = m * THREE.MathUtils.lerp(1, r.adsRot, ads);
    const pm = m * THREE.MathUtils.lerp(1, r.adsPos, ads);
    const sgn = (): number => (Math.random() < 0.5 ? -1 : 1);
    this.kZ.kick(r.back * pm);
    this.kU.kick(r.up * pm);
    this.kX.kick(r.side * pm * sgn() * (0.4 + Math.random() * 0.6));
    this.kP.kick(r.pitch * rm);
    this.kY.kick(r.yaw * rm * sgn() * (0.4 + Math.random() * 0.6));
    this.kR.kick(r.roll * rm * sgn() * (0.5 + Math.random() * 0.5));
    this.heat = Math.min(1, this.heat + 0.07);
  }

  /** A handling bump from an animation event (magazine seating, bolt slamming home). */
  bump(back: number, up: number, pitch: number, roll = 0): void {
    this.kZ.kick(back);
    this.kU.kick(up);
    this.kP.kick(pitch);
    if (roll) this.kR.kick(roll);
  }

  /** Barrel heat 0..1 (drives smoke). */
  get barrelHeat(): number {
    return this.heat;
  }

  update(i: MotionInput): void {
    const p = this.p;
    const dt = Math.max(1e-4, i.dt);
    this.t += dt;
    const ads = i.ads;
    this.heat = Math.max(0, this.heat - dt * 0.35);
    const pos = this.pos.set(0, 0, 0);
    const rot = this.rot.set(0, 0, 0);

    // --- Recoil
    for (const s of [this.kZ, this.kP, this.kY, this.kR, this.kX, this.kU]) s.update(dt);
    pos.z += this.kZ.x;
    pos.y += this.kU.x;
    pos.x += this.kX.x;
    rot.x += this.kP.x + this.heat * this.heat * p.recoil.climb * (1 - ads * 0.7);
    rot.y += this.kY.x;
    rot.z += this.kR.x;

    // --- Sway: the gun trails the look direction
    if (Number.isNaN(this.lastYaw)) {
      this.lastYaw = i.yaw;
      this.lastPitch = i.pitch;
    }
    let dYaw = i.yaw - this.lastYaw;
    if (dYaw > Math.PI) dYaw -= Math.PI * 2;
    if (dYaw < -Math.PI) dYaw += Math.PI * 2;
    const dPitch = i.pitch - this.lastPitch;
    this.lastYaw = i.yaw;
    this.lastPitch = i.pitch;
    const sw = p.sway;
    const swAmt = THREE.MathUtils.lerp(1, sw.ads, ads);
    const yawRate = dYaw / dt;
    const pitchRate = dPitch / dt;
    this.swY.update(dt, THREE.MathUtils.clamp(-yawRate * sw.lag, -sw.max, sw.max) * swAmt);
    this.swP.update(dt, THREE.MathUtils.clamp(-pitchRate * sw.lag, -sw.max, sw.max) * swAmt);
    rot.y += this.swY.x;
    rot.x += this.swP.x;
    rot.z += this.swY.x * sw.roll;
    pos.x += this.swY.x * sw.shift;
    pos.y += this.swP.x * sw.shift * 0.6;

    // --- Inertia: velocity changes in the view's frame
    const cy = Math.cos(i.yaw), sy = Math.sin(i.yaw);
    const vx = i.velocity.x, vz = i.velocity.z;
    // right = (cos yaw, 0, -sin yaw), forward = (-sin yaw, 0, -cos yaw)
    const vRight = vx * cy - vz * sy;
    const vFwd = -vx * sy - vz * cy;
    const lk = 1 - Math.exp(-dt / p.inertia.tau);
    this.lagVel.x += (vRight - this.lagVel.x) * lk;
    this.lagVel.z += (vFwd - this.lagVel.z) * lk;
    const aR = vRight - this.lagVel.x;
    const aF = vFwd - this.lagVel.z;
    const inAmt = 1 - ads * 0.75;
    const ine = p.inertia;
    this.inZ.update(dt, aF * ine.z * inAmt);
    this.inX.update(dt, -aR * ine.x * inAmt);
    this.inP.update(dt, -aF * ine.pitch * inAmt);
    this.inR.update(dt, aR * ine.roll * inAmt);
    this.lean = THREE.MathUtils.damp(this.lean, i.onGround ? -vRight * ine.lean : 0, 8, dt);
    pos.z += this.inZ.x;
    pos.x += this.inX.x;
    rot.x += this.inP.x;
    rot.z += this.inR.x + this.lean * (1 - ads * 0.8);

    // --- Idle: breathing and a slow drift, never perfectly still
    const id = p.idle;
    const idAmt = THREE.MathUtils.lerp(1, 0.3, ads);
    const br = Math.sin(this.t * Math.PI * 2 * id.hz);
    pos.y += br * id.breathY * idAmt;
    rot.x += br * id.breathP * idAmt;
    pos.x += drift(this.t * 0.6, 1.3) * id.drift * idAmt;
    pos.y += drift(this.t * 0.5, 4.1) * id.drift * 0.6 * idAmt;
    rot.y += drift(this.t * 0.45, 7.7) * id.driftR * idAmt;
    rot.z += drift(this.t * 0.4, 2.9) * id.driftR * idAmt;

    // --- Gait: steps driven by distance walked, so the gun lands with the footsteps
    const hs = Math.hypot(vx, vz);
    const grounded = i.onGround ? 1 : 0;
    const want = grounded * Math.min(1, hs / WALK_SPEED) * (i.crouching ? p.crouch : 1);
    this.gaitAmt = THREE.MathUtils.damp(this.gaitAmt, want, 6, dt);
    if (i.onGround) this.steps += (hs * dt) / STRIDE;
    const runK = THREE.MathUtils.smoothstep(hs, WALK_SPEED, RUN_SPEED);
    const g = (k: keyof GaitSpec): number => THREE.MathUtils.lerp(p.walk[k], p.run[k], runK);
    const gAmt = this.gaitAmt * THREE.MathUtils.lerp(1, 0.14, ads);
    if (gAmt > 1e-4) {
      const s = this.steps - g('lag');
      const stride = Math.sin(Math.PI * s); // one cycle per two steps: left/right
      const step = 0.5 - 0.5 * Math.cos(Math.PI * 2 * s); // one dip per footfall
      pos.y -= step * g('y') * gAmt;
      pos.x += stride * g('x') * gAmt;
      pos.z += step * g('z') * gAmt;
      rot.x -= (step - 0.5) * g('pitch') * gAmt;
      rot.y += stride * g('yaw') * gAmt;
      rot.z += stride * g('roll') * gAmt;
    }

    // --- Air: takeoff, falling, landing
    const air = p.air;
    if (this.wasGround && !i.onGround && i.velocity.y > 1) {
      this.jY.kick(-air.jumpY);
      this.jP.kick(-air.jumpP);
    }
    if (!i.onGround) this.fallSpeed = Math.max(this.fallSpeed, -i.velocity.y);
    if (!this.wasGround && i.onGround) {
      const k = THREE.MathUtils.clamp((this.fallSpeed - 1.5) / 8, 0.15, 1);
      this.jY.kick(-air.landY * k);
      this.jP.kick(air.landP * k);
      this.jR.kick(air.landR * k * (Math.random() < 0.5 ? -1 : 1));
      this.fallSpeed = 0;
    }
    this.wasGround = i.onGround;
    const vy = i.onGround ? 0 : i.velocity.y;
    this.jY.update(dt, THREE.MathUtils.clamp(-vy * air.fallY, -0.025, 0.02));
    this.jP.update(dt, THREE.MathUtils.clamp(-vy * air.fallP, -0.04, 0.03));
    this.jR.update(dt);
    const airAmt = 1 - ads * 0.6;
    pos.y += this.jY.x * airAmt;
    rot.x += this.jP.x * airAmt;
    rot.z += this.jR.x * airAmt;

    // --- Crouch: a little dip and roll as the body drops
    const cd = p.crouchDip;
    if (i.crouching !== this.wasCrouch) {
      const d = i.crouching ? 1 : -0.6;
      this.cY.kick(-cd.y * d);
      this.cP.kick(cd.pitch * d);
      this.cR.kick(cd.roll * d);
      this.wasCrouch = i.crouching;
    }
    this.cY.update(dt); this.cP.update(dt); this.cR.update(dt);
    pos.y += this.cY.x;
    rot.x += this.cP.x;
    rot.z += this.cR.x;

    // --- Sprint: the gun swings down and across, with a heavier run bounce
    this.sprint.update(dt, i.sprinting ? i.sprintAllowed : 0);
    const sb = THREE.MathUtils.clamp(this.sprint.x, 0, 1.05);
    if (sb > 1e-3) {
      const sp = p.sprint;
      pos.x += sp.pos[0] * sb;
      pos.y += sp.pos[1] * sb;
      pos.z += sp.pos[2] * sb;
      rot.x += sp.rot[0] * sb;
      rot.y += sp.rot[1] * sb;
      rot.z += sp.rot[2] * sb;
      const s = this.steps;
      rot.y += Math.sin(Math.PI * s) * 0.05 * sb * this.gaitAmt;
      pos.y -= (0.5 - 0.5 * Math.cos(Math.PI * 2 * s)) * 0.008 * sb * this.gaitAmt;
    }
  }

  /** 0..1 how far into the sprint pose the gun is. */
  get sprintBlend(): number {
    return THREE.MathUtils.clamp(this.sprint.x, 0, 1);
  }
}
