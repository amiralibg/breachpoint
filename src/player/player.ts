import * as THREE from 'three';
import { Btn, type PlayerCommand } from '../net/protocol';
import { boxesNear } from '../world/physics';

const STAND_H = 1.8;
const CROUCH_H = 1.25;
const EYE_OFFSET = 0.12; // eye below top of head
const RADIUS = 0.3;
const STEP = 0.45;
const GRAVITY = 20;
const JUMP_V = 6.2;
const WALK = 5.2;
const SPRINT = 7.4;
const CROUCH_SPEED = 2.6;
const ACCEL_GROUND = 60;
const ACCEL_AIR = 12;
const FRICTION = 10;

/**
 * Player movement. `simulate` is deterministic given the command and the colliders, so a server
 * can run the exact same code and a client can replay unacknowledged commands (prediction).
 * `render` only places the camera (interpolated between ticks) and never feeds back into the sim.
 */
export class Player {
  readonly id = 0;
  readonly position = new THREE.Vector3();
  private prevPosition = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  /** View punch from recoil (radians), decays back to zero. */
  punchPitch = 0;
  punchYaw = 0;
  height = STAND_H;
  private prevHeight = STAND_H;
  onGround = false;
  crouching = false;
  sprinting = false;
  health = 100;
  armor = 100;
  alive = true;
  /** 0..1 how fast the player is moving relative to walk speed. */
  moveFactor = 0;
  /** Set for one tick when landing; 0..1 strength. */
  landed = 0;
  private fallSpeed = 0;
  private stepTimer = 0;
  onFootstep: (() => void) | null = null;
  private box = new THREE.Box3();
  private bobT = 0;
  private landDip = 0;
  private landVel = 0;
  private deathRoll = 0;
  /** Camera height still to catch up after a stair step (keeps the view smooth on stairs). */
  private stepOffset = 0;
  private near: THREE.Box3[] = [];
  /** Extra view rotation that isn't part of the aim (scope sway, camera shake). */
  readonly viewOffset = new THREE.Euler();

  constructor(private camera: THREE.PerspectiveCamera) {}

  spawn(p: THREE.Vector3, yaw: number): void {
    this.position.copy(p);
    this.prevPosition.copy(p);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.punchPitch = this.punchYaw = 0;
    this.health = 100;
    this.armor = 100;
    this.alive = true;
    this.height = this.prevHeight = STAND_H;
    this.crouching = false;
    this.deathRoll = 0;
    this.stepOffset = 0;
    this.onGround = false;
  }

  /** Eye position at the latest tick (what the simulation uses). */
  get eye(): THREE.Vector3 {
    return new THREE.Vector3(this.position.x, this.position.y + this.height - EYE_OFFSET, this.position.z);
  }

  get eyeHeight(): number {
    return this.height - EYE_OFFSET;
  }

  /** Mouse look (client side, every frame). */
  look(dx: number, dy: number, sens: number): void {
    this.yaw -= dx * sens;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * sens, -1.5, 1.5);
  }

  /** Apply damage, armor absorbs part of it. Returns true if this killed the player. */
  damage(amount: number): boolean {
    if (!this.alive) return false;
    const absorbed = Math.min(this.armor, amount * 0.5);
    this.armor -= absorbed;
    this.health -= amount - absorbed;
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      return true;
    }
    return false;
  }

  /** `speedScale` slows the player down (wading through water). */
  simulate(cmd: PlayerCommand, dt: number, allColliders: THREE.Box3[], aiming: boolean, speedScale = 1): void {
    const colliders = boxesNear(allColliders, this.position.x - 2.5, this.position.z - 2.5, this.position.x + 2.5, this.position.z + 2.5, this.near);
    this.prevPosition.copy(this.position);
    this.prevHeight = this.height;
    this.yaw = cmd.yaw;
    this.pitch = cmd.pitch;
    this.landed = 0;

    // Recoil recovery
    const rec = Math.min(1, dt * 7);
    this.punchPitch -= this.punchPitch * rec;
    this.punchYaw -= this.punchYaw * rec;
    if (!this.alive) {
      this.height = THREE.MathUtils.damp(this.height, 0.45, 4, dt);
      this.deathRoll = THREE.MathUtils.damp(this.deathRoll, 0.6, 3, dt);
      return;
    }
    const held = (b: number): boolean => (cmd.buttons & b) !== 0;

    // --- Crouch (smoothly change height, refuse to stand under a ceiling)
    if (held(Btn.Crouch)) this.crouching = true;
    else if (this.crouching && this.canStand(colliders)) this.crouching = false;
    const targetH = this.crouching ? CROUCH_H : STAND_H;
    this.height += (targetH - this.height) * Math.min(1, dt * 12);

    // --- Wish direction
    const wish = new THREE.Vector3(cmd.moveX, 0, -cmd.moveZ);
    if (wish.lengthSq() > 1) wish.normalize();
    if (wish.lengthSq() > 0) wish.applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.yaw);
    this.sprinting = held(Btn.Sprint) && cmd.moveZ > 0 && !this.crouching && !aiming;
    let maxSpeed = this.crouching ? CROUCH_SPEED : this.sprinting ? SPRINT : WALK;
    if (aiming) maxSpeed *= 0.6;
    maxSpeed *= speedScale;

    // --- Friction & acceleration (Quake/Source style)
    const hv = new THREE.Vector3(this.velocity.x, 0, this.velocity.z);
    if (this.onGround) {
      const speed = hv.length();
      if (speed > 0) {
        const drop = Math.max(speed, 1.5) * FRICTION * dt;
        hv.multiplyScalar(Math.max(0, speed - drop) / speed);
      }
    }
    const cur = hv.dot(wish);
    const add = maxSpeed * Math.min(1, wish.length()) - cur;
    if (add > 0 && wish.lengthSq() > 0) {
      const accel = (this.onGround ? ACCEL_GROUND : ACCEL_AIR) * dt * maxSpeed;
      hv.addScaledVector(wish.clone().normalize(), Math.min(add, accel));
    }
    this.velocity.x = hv.x;
    this.velocity.z = hv.z;

    // --- Jump & gravity
    let jumped = false;
    if (this.onGround && (cmd.pressed & Btn.Jump)) {
      this.velocity.y = JUMP_V * (speedScale < 1 ? 0.75 : 1);
      this.onGround = false;
      jumped = true;
    }
    this.velocity.y -= GRAVITY * dt;
    const wasGround = this.onGround;
    this.fallSpeed = Math.max(this.fallSpeed, -this.velocity.y);

    // --- Move with collision, one axis at a time
    this.moveAxis('x', this.velocity.x * dt, colliders);
    this.moveAxis('z', this.velocity.z * dt, colliders);
    this.onGround = false;
    this.moveAxis('y', this.velocity.y * dt, colliders);
    // Walking off a stair tread: follow the stairs down instead of hopping from step to step
    if (wasGround && !this.onGround && !jumped && this.position.y > 0) {
      const y = this.position.y;
      const vy = this.velocity.y;
      this.moveAxis('y', -(STEP - 0.05), colliders);
      if (this.onGround || this.position.y <= 0) this.stepOffset += y - Math.max(0, this.position.y);
      else {
        this.position.y = y;
        this.velocity.y = vy;
      }
    }
    if (this.position.y <= 0) {
      this.position.y = 0;
      this.velocity.y = 0;
      this.onGround = true;
    }
    if (this.onGround && !wasGround) {
      this.landed = THREE.MathUtils.clamp((this.fallSpeed - 3.2) / 8, 0, 1);
      if (this.landed > 0) {
        this.landVel -= this.landed * 1.6;
        this.onFootstep?.();
      }
    }
    if (this.onGround) this.fallSpeed = 0;

    // --- Footsteps
    const hs = Math.hypot(this.velocity.x, this.velocity.z);
    this.moveFactor = hs / WALK;
    if (this.onGround && hs > 1.5 && !this.crouching) {
      this.stepTimer -= dt * hs;
      if (this.stepTimer <= 0) {
        this.stepTimer = 2.4;
        this.onFootstep?.();
      }
    }
  }

  /** Place the camera between the last two ticks. */
  render(alpha: number, dt: number): void {
    const hs = Math.hypot(this.velocity.x, this.velocity.z);
    if (this.onGround && hs > 0.5) this.bobT += dt * hs * 1.6;
    const bob = this.onGround && this.alive ? Math.sin(this.bobT * 2) * 0.025 * Math.min(1, hs / WALK) : 0;
    // Landing: a damped spring dips the view
    this.landVel += (-this.landDip * 220 - this.landVel * 18) * dt;
    this.landDip += this.landVel * dt;
    this.stepOffset = THREE.MathUtils.clamp(THREE.MathUtils.damp(this.stepOffset, 0, 16, dt), -0.7, 0.7);
    const h = THREE.MathUtils.lerp(this.prevHeight, this.height, alpha) + this.stepOffset;
    const p = this.prevPosition.clone().lerp(this.position, alpha);
    this.camera.position.set(p.x, p.y + h - EYE_OFFSET + bob + this.landDip * 0.08, p.z);
    this.camera.rotation.set(
      this.pitch + this.punchPitch + this.viewOffset.x + this.landDip * 0.05,
      this.yaw + this.punchYaw + this.viewOffset.y,
      this.deathRoll + this.viewOffset.z,
      'YXZ',
    );
  }

  private makeBox(pos: THREE.Vector3, h: number): THREE.Box3 {
    this.box.min.set(pos.x - RADIUS, pos.y, pos.z - RADIUS);
    this.box.max.set(pos.x + RADIUS, pos.y + h, pos.z + RADIUS);
    return this.box;
  }

  private canStand(colliders: THREE.Box3[]): boolean {
    const b = this.makeBox(this.position, STAND_H);
    return !colliders.some((c) => c.max.y > this.position.y + 1e-4 && c.intersectsBox(b));
  }

  private moveAxis(axis: 'x' | 'y' | 'z', delta: number, colliders: THREE.Box3[]): void {
    if (delta === 0) return;
    const p = this.position;
    p[axis] += delta;
    const b = this.makeBox(p, this.height);
    for (const c of colliders) {
      if (!c.intersectsBox(b)) continue;
      // Box3 counts touching as intersecting: the floor under the feet is not a wall
      if (axis !== 'y' && (c.max.y <= p.y + 1e-4 || c.min.y >= p.y + this.height - 1e-4)) continue;
      if (axis === 'y') {
        if (delta < 0) {
          p.y = c.max.y;
          this.onGround = true;
        } else {
          p.y = c.min.y - this.height - 0.001;
        }
        this.velocity.y = 0;
      } else {
        // Try stepping up onto low obstacles
        const rise = c.max.y - p.y;
        if (rise > 0 && rise <= STEP && this.onGroundish()) {
          const test = this.makeBox(new THREE.Vector3(p.x, c.max.y + 0.001, p.z), this.height);
          const ty = c.max.y + 0.001;
          if (!colliders.some((o) => o !== c && o.max.y > ty + 1e-4 && o.intersectsBox(test))) {
            this.stepOffset -= c.max.y + 0.001 - p.y;
            p.y = c.max.y + 0.001;
            continue;
          }
        }
        if (axis === 'x') p.x = delta > 0 ? c.min.x - RADIUS - 0.001 : c.max.x + RADIUS + 0.001;
        else p.z = delta > 0 ? c.min.z - RADIUS - 0.001 : c.max.z + RADIUS + 0.001;
        if (axis === 'x') this.velocity.x = 0;
        else this.velocity.z = 0;
      }
      this.makeBox(p, this.height);
    }
  }

  private onGroundish(): boolean {
    return this.onGround || Math.abs(this.velocity.y) < 1.5;
  }
}
