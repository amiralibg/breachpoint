import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { curlFingers, measureHand, orientHand, twoBoneIK, worldPos, type HandFrame } from '../core/ik';
import { facingAngle } from '../enemies/retarget';

const ARM_SCALE = 1.12;

export interface HandTarget {
  pos: THREE.Vector3;
  fwd: THREE.Vector3;
  back: THREE.Vector3;
  curl: number;
}

/**
 * First-person arms: the soldier character placed under the view camera with its head and legs
 * collapsed, and both arms solved with two-bone IK onto hand anchors on the weapon.
 * Everything here is in view-camera space (camera at the origin looking down -Z).
 */
export class FpArms {
  readonly root = new THREE.Group();
  private model: THREE.Object3D;
  private bones: THREE.Bone[] = [];
  private rest: THREE.Quaternion[] = [];
  private restPos: THREE.Vector3[] = [];
  private l: { arm: THREE.Bone; fore: THREE.Bone; hand: HandFrame };
  private r: { arm: THREE.Bone; fore: THREE.Bone; hand: HandFrame };
  private shoulderL = new THREE.Vector3();
  private shoulderR = new THREE.Vector3();

  constructor(proto: THREE.Object3D, ready: boolean) {
    this.model = SkeletonUtils.clone(proto);
    this.model.rotation.y = facingAngle(this.model) + Math.PI; // face -Z
    this.root.add(this.model);
    this.root.visible = ready;
    this.model.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (m.isMesh) {
        m.frustumCulled = false;
        m.castShadow = false;
        const mat = (m.material as THREE.MeshStandardMaterial).clone();
        mat.envMapIntensity = 0.8;
        m.material = mat;
      }
      if ((o as THREE.Bone).isBone) this.bones.push(o as THREE.Bone);
    });
    const get = (n: string): THREE.Bone => this.model.getObjectByName(`mixamorig${n}`) as THREE.Bone;

    // First-person arms are slightly oversized (as in most shooters) so the support hand reaches
    // the handguard at hip without the shoulders coming into view.
    this.model.scale.setScalar(ARM_SCALE);
    this.model.updateMatrixWorld(true);
    // Place the body so the neck sits just below the eye; it never enters the view frustum.
    const neck = worldPos(get('Neck'));
    this.model.position.set(-neck.x, -0.15 - neck.y, -0.04 - neck.z);
    this.model.updateMatrixWorld(true);
    // Head and legs are never seen; collapse them so they can't clip into view.
    for (const n of ['Head', 'LeftUpLeg', 'RightUpLeg']) get(n).scale.setScalar(0.001);

    this.l = { arm: get('LeftArm'), fore: get('LeftForeArm'), hand: measureHand(this.model, 'Left') };
    this.r = { arm: get('RightArm'), fore: get('RightForeArm'), hand: measureHand(this.model, 'Right') };
    for (const b of this.bones) {
      this.rest.push(b.quaternion.clone());
      this.restPos.push(b.position.clone());
    }
  }

  /** Solve both arms. `sway` shifts the shoulders a little so the body follows the gun. */
  update(left: HandTarget, right: HandTarget, sway: THREE.Vector3): void {
    this.bones.forEach((b, i) => {
      b.quaternion.copy(this.rest[i]);
      b.position.copy(this.restPos[i]);
    });
    this.root.position.copy(sway);
    this.root.updateMatrixWorld(true);
    worldPos(this.l.arm, this.shoulderL);
    worldPos(this.r.arm, this.shoulderR);
    // Elbows point down and out, like a real carry
    const poleR = this.shoulderR.clone().add(new THREE.Vector3(0.5, -1, 0.3));
    const poleL = this.shoulderL.clone().add(new THREE.Vector3(-0.6, -1, 0.1));
    for (const [side, t, pole] of [[this.r, right, poleR], [this.l, left, poleL]] as const) {
      twoBoneIK(side.arm, side.fore, side.hand.hand, t.pos, pole);
      orientHand(side.hand, t.fwd, t.back);
      curlFingers(side.hand, t.curl);
    }
  }

  set visible(on: boolean) {
    this.root.visible = on;
  }
}
