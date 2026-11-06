import * as THREE from 'three';
import type { Input } from '../core/input';

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

export class Player {
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  /** View punch from recoil (radians), decays back to zero. */
  punchPitch = 0;
  punchYaw = 0;
  height = STAND_H;
  onGround = false;
  crouching = false;
  sprinting = false;
  health = 100;
  armor = 100;
  alive = true;
  /** 0..1 how fast the player is moving relative to walk speed. */
  moveFactor = 0;
  private stepTimer = 0;
  onFootstep: (() => void) | null = null;
  private box = new THREE.Box3();

  constructor(private camera: THREE.PerspectiveCamera) {}

  spawn(p: THREE.Vector3, yaw: number): void {
    this.position.copy(p);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.punchPitch = this.punchYaw = 0;
    this.health = 100;
    this.armor = 100;
    this.alive = true;
    this.height = STAND_H;
  }

  get eye(): THREE.Vector3 {
    return this.camera.position;
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

  update(dt: number, input: Input, colliders: THREE.Box3[], sensitivity: number, aiming: boolean, sensScale = 1): void {
    // --- Look
    const sens = 0.0022 * sensitivity * sensScale;
    this.yaw -= input.mouseDX * sens;
    this.pitch -= input.mouseDY * sens;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -1.5, 1.5);

    // Recoil recovery
    const rec = Math.min(1, dt * 7);
    this.punchPitch -= this.punchPitch * rec;
    this.punchYaw -= this.punchYaw * rec;

    if (!this.alive) {
      this.updateCamera(dt);
      return;
    }

    // --- Crouch (smoothly change height, refuse to stand under a ceiling)
    const wantCrouch = input.down('ControlLeft') || input.down('KeyC');
    if (wantCrouch) this.crouching = true;
    else if (this.crouching && this.canStand(colliders)) this.crouching = false;
    const targetH = this.crouching ? CROUCH_H : STAND_H;
    this.height += (targetH - this.height) * Math.min(1, dt * 12);

    // --- Wish direction
    const f = (input.down('KeyW') ? 1 : 0) - (input.down('KeyS') ? 1 : 0);
    const s = (input.down('KeyD') ? 1 : 0) - (input.down('KeyA') ? 1 : 0);
    const wish = new THREE.Vector3(s, 0, -f);
    if (wish.lengthSq() > 0) wish.normalize().applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.yaw);
    this.sprinting = input.down('ShiftLeft') && f > 0 && !this.crouching && !aiming;
    let maxSpeed = this.crouching ? CROUCH_SPEED : this.sprinting ? SPRINT : WALK;
    if (aiming) maxSpeed *= 0.6;

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
    const add = maxSpeed - cur;
    if (add > 0 && wish.lengthSq() > 0) {
      const accel = (this.onGround ? ACCEL_GROUND : ACCEL_AIR) * dt * maxSpeed;
      hv.addScaledVector(wish, Math.min(add, accel));
    }
    this.velocity.x = hv.x;
    this.velocity.z = hv.z;

    // --- Jump & gravity
    if (this.onGround && input.hit('Space')) {
      this.velocity.y = JUMP_V;
      this.onGround = false;
    }
    this.velocity.y -= GRAVITY * dt;

    // --- Move with collision, one axis at a time
    this.moveAxis('x', this.velocity.x * dt, colliders);
    this.moveAxis('z', this.velocity.z * dt, colliders);
    this.onGround = false;
    this.moveAxis('y', this.velocity.y * dt, colliders);
    if (this.position.y <= 0) {
      this.position.y = 0;
      this.velocity.y = 0;
      this.onGround = true;
    }

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

    this.updateCamera(dt);
  }

  private bobT = 0;
  private updateCamera(dt: number): void {
    const hs = Math.hypot(this.velocity.x, this.velocity.z);
    if (this.onGround && hs > 0.5) this.bobT += dt * hs * 1.6;
    const bob = this.onGround ? Math.sin(this.bobT * 2) * 0.025 * Math.min(1, hs / WALK) : 0;
    const eyeY = this.alive ? this.height - EYE_OFFSET : 0.35;
    this.camera.position.set(this.position.x, this.position.y + eyeY + bob, this.position.z);
    this.camera.rotation.set(this.pitch + this.punchPitch, this.yaw + this.punchYaw, this.alive ? 0 : 0.6, 'YXZ');
  }

  private makeBox(pos: THREE.Vector3, h: number): THREE.Box3 {
    this.box.min.set(pos.x - RADIUS, pos.y, pos.z - RADIUS);
    this.box.max.set(pos.x + RADIUS, pos.y + h, pos.z + RADIUS);
    return this.box;
  }

  private canStand(colliders: THREE.Box3[]): boolean {
    const b = this.makeBox(this.position, STAND_H);
    return !colliders.some((c) => c.intersectsBox(b));
  }

  private moveAxis(axis: 'x' | 'y' | 'z', delta: number, colliders: THREE.Box3[]): void {
    if (delta === 0) return;
    const p = this.position;
    p[axis] += delta;
    const b = this.makeBox(p, this.height);
    for (const c of colliders) {
      if (!c.intersectsBox(b)) continue;
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
          if (!colliders.some((o) => o !== c && o.intersectsBox(test))) {
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
