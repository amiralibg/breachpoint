import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

export { RAPIER };

let ready: Promise<void> | null = null;

/** Loads the Rapier WASM module (embedded in the package, no extra request). */
export function initPhysics(): Promise<void> {
  ready ??= RAPIER.init();
  return ready;
}

/** Collision groups: 16 bits membership << 16 | 16 bits filter. */
export const GROUP_WORLD = 0x0001;
export const GROUP_RAGDOLL = 0x0002;
export const GROUP_PROP = 0x0004;
export function groups(member: number, filter: number): number {
  return (member << 16) | filter;
}

interface Prop {
  body: RAPIER.RigidBody;
  obj: THREE.Object3D;
  /** Offset from the body origin to the object's origin (body-local). */
  offset: THREE.Vector3;
  life: number;
  frozen: boolean;
  onImpact?: (speed: number) => void;
  lastVel: number;
}

/**
 * Physics for things that tumble: ragdolls, dropped rifles, magazines and grenades.
 * Player and bot movement stay on the cheaper kinematic box collision in physics.ts.
 * Steps at the simulation tick rate, so it slots into a server-side tick the same way.
 */
export class PhysicsWorld {
  readonly world: RAPIER.World;
  private statics: RAPIER.Collider[] = [];
  private props: Prop[] = [];

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = 1 / 60;
    const ground = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0));
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(200, 0.5, 200).setFriction(0.9).setCollisionGroups(groups(GROUP_WORLD, 0xffff)),
      ground,
    );
  }

  setStatics(boxes: THREE.Box3[]): void {
    for (const c of this.statics) this.world.removeCollider(c, false);
    this.statics = [];
    const c = new THREE.Vector3();
    const h = new THREE.Vector3();
    for (const b of boxes) {
      b.getCenter(c);
      b.getSize(h).multiplyScalar(0.5);
      const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(c.x, c.y, c.z));
      this.statics.push(this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(h.x, h.y, h.z).setFriction(0.8).setCollisionGroups(groups(GROUP_WORLD, 0xffff)),
        body,
      ));
    }
  }

  /**
   * Turn an object (already in world space, parented to the scene) into a tumbling box.
   * `size` is the full box size in the object's local frame; `center` its local center.
   */
  spawnProp(obj: THREE.Object3D, opts: {
    size: THREE.Vector3; center?: THREE.Vector3; vel?: THREE.Vector3; spin?: THREE.Vector3;
    density?: number; life?: number; restitution?: number; onImpact?: (speed: number) => void;
  }): RAPIER.RigidBody {
    const center = (opts.center ?? new THREE.Vector3()).clone().multiply(obj.scale).applyQuaternion(obj.quaternion);
    const p = obj.position.clone().add(center);
    const q = obj.quaternion;
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(p.x, p.y, p.z)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setLinearDamping(0.1)
      .setAngularDamping(0.6)
      .setCcdEnabled(true));
    const s = opts.size.clone().multiply(obj.scale).multiplyScalar(0.5);
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(Math.max(0.005, s.x), Math.max(0.005, s.y), Math.max(0.005, s.z))
      .setDensity(opts.density ?? 800)
      .setFriction(0.7)
      .setRestitution(opts.restitution ?? 0.25)
      .setCollisionGroups(groups(GROUP_PROP, GROUP_WORLD | GROUP_PROP)), body);
    if (opts.vel) body.setLinvel(opts.vel, true);
    if (opts.spin) body.setAngvel(opts.spin, true);
    const offset = (opts.center ?? new THREE.Vector3()).clone().multiply(obj.scale).negate();
    this.props.push({ body, obj, offset, life: opts.life ?? 20, frozen: false, onImpact: opts.onImpact, lastVel: 0 });
    return body;
  }

  removeProp(obj: THREE.Object3D): void {
    const i = this.props.findIndex((p) => p.obj === obj);
    if (i < 0) return;
    const p = this.props[i];
    if (!p.frozen) this.world.removeRigidBody(p.body);
    this.props.splice(i, 1);
  }

  step(dt: number): void {
    this.world.timestep = dt;
    this.world.step();
    for (let i = this.props.length - 1; i >= 0; i--) {
      const p = this.props[i];
      p.life -= dt;
      if (!p.frozen) {
        const v = p.body.linvel();
        const speed = Math.hypot(v.x, v.y, v.z);
        // A sudden drop in speed is an impact (for clatter sounds)
        if (p.onImpact && p.lastVel - speed > 1.2) p.onImpact(p.lastVel);
        p.lastVel = speed;
        // Settled props stop costing anything: bake the pose and drop the body
        if (p.body.isSleeping() || p.life < 0) {
          this.syncProp(p);
          this.world.removeRigidBody(p.body);
          p.frozen = true;
        }
      }
      if (p.life < -30) {
        p.obj.removeFromParent();
        this.props.splice(i, 1);
      }
    }
  }

  /** Copy body transforms onto their objects (every rendered frame). */
  render(): void {
    for (const p of this.props) if (!p.frozen) this.syncProp(p);
  }

  private syncProp(p: Prop): void {
    const t = p.body.translation();
    const r = p.body.rotation();
    p.obj.quaternion.set(r.x, r.y, r.z, r.w);
    p.obj.position.set(t.x, t.y, t.z).add(p.offset.clone().applyQuaternion(p.obj.quaternion));
  }

  clear(): void {
    for (const p of this.props) {
      if (!p.frozen) this.world.removeRigidBody(p.body);
      p.obj.removeFromParent();
    }
    this.props = [];
  }
}
