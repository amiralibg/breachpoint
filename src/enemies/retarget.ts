import * as THREE from 'three';

/*
 * Bakes animation clips from one Mixamo-style rig onto another whose bones have the same names
 * but different rest orientations (e.g. after an FBX -> glTF -> Blender -> glTF round trip).
 *
 * Both rigs are brought into a reference T-pose and turned to face +Z. For every sampled frame:
 *   worldDelta = srcWorld(t) * srcRefWorld^-1     (how far the source bone turned from T-pose)
 *   dstWorld(t) = worldDelta * dstRefWorld
 *   dstLocal(t) = dstParentWorld(t)^-1 * dstWorld(t)
 * The hips translation is transferred as an offset from the reference pose, scaled by leg length.
 */

/** Rotation about Y that makes the character face +Z (derived from the hip joints). */
export function facingAngle(model: THREE.Object3D): number {
  model.updateMatrixWorld(true);
  const l = model.getObjectByName('mixamorigLeftUpLeg') ?? model.getObjectByName('mixamorig:LeftUpLeg');
  const r = model.getObjectByName('mixamorigRightUpLeg') ?? model.getObjectByName('mixamorig:RightUpLeg');
  if (!l || !r) return 0;
  const right = r.getWorldPosition(new THREE.Vector3()).sub(l.getWorldPosition(new THREE.Vector3())).setY(0);
  const fwd = new THREE.Vector3(0, 1, 0).cross(right).normalize();
  return -Math.atan2(fwd.x, fwd.z);
}

function bonesByName(root: THREE.Object3D): Map<string, THREE.Bone> {
  const m = new Map<string, THREE.Bone>();
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone) m.set(o.name, o as THREE.Bone);
  });
  return m;
}

export function retargetClips(
  srcScene: THREE.Object3D,
  srcClips: THREE.AnimationClip[],
  dstScene: THREE.Object3D,
  opts: { tPoseClip?: string; fps?: number; hips?: string } = {},
): THREE.AnimationClip[] {
  const fps = opts.fps ?? 30;
  const hipsName = opts.hips ?? 'mixamorigHips';

  // Work on wrappers so we don't disturb the originals' transforms permanently.
  const src = srcScene;
  const dst = dstScene;
  const srcWrap = new THREE.Group();
  const dstWrap = new THREE.Group();
  const srcParent = src.parent;
  const dstParent = dst.parent;
  srcWrap.add(src);
  dstWrap.add(dst);

  const srcBones = bonesByName(src);
  const dstBones = bonesByName(dst);
  const dstDefaults = new Map<THREE.Bone, { q: THREE.Quaternion; p: THREE.Vector3 }>();
  for (const b of dstBones.values()) dstDefaults.set(b, { q: b.quaternion.clone(), p: b.position.clone() });

  const mixer = new THREE.AnimationMixer(src);
  const tpose = srcClips.find((c) => c.name === opts.tPoseClip);
  if (tpose) {
    mixer.clipAction(tpose).play();
    mixer.update(0);
  }
  srcWrap.rotation.y = facingAngle(src);
  dstWrap.rotation.y = facingAngle(dst);
  srcWrap.updateMatrixWorld(true);
  dstWrap.updateMatrixWorld(true);

  // Reference (T-pose) world rotations
  const srcRef = new Map<string, THREE.Quaternion>();
  const dstRef = new Map<string, THREE.Quaternion>();
  for (const [n, b] of srcBones) srcRef.set(n, b.getWorldQuaternion(new THREE.Quaternion()));
  for (const [n, b] of dstBones) dstRef.set(n, b.getWorldQuaternion(new THREE.Quaternion()));

  const sHips = srcBones.get(hipsName);
  const dHips = dstBones.get(hipsName);
  const sHipsRef = sHips ? sHips.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3();
  const dHipsRef = dHips ? dHips.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3();
  const hipScale = sHipsRef.y > 0 ? dHipsRef.y / sHipsRef.y : 1;
  const dHipsParentInv = dHips?.parent ? dHips.parent.matrixWorld.clone().invert() : new THREE.Matrix4();

  // Destination bones in parent-first order
  const order: THREE.Bone[] = [];
  dst.traverse((o) => {
    if ((o as THREE.Bone).isBone) order.push(o as THREE.Bone);
  });

  const out: THREE.AnimationClip[] = [];
  const inv = new THREE.Quaternion();
  for (const clip of srcClips) {
    if (clip === tpose) continue;
    mixer.stopAllAction();
    const action = mixer.clipAction(clip);
    action.reset().play();
    const frames = Math.max(2, Math.round(clip.duration * fps) + 1);
    const times = new Float32Array(frames);
    const quatVals = new Map<THREE.Bone, Float32Array>();
    for (const b of order) if (srcBones.has(b.name)) quatVals.set(b, new Float32Array(frames * 4));
    const hipsVals = new Float32Array(frames * 3);

    for (let f = 0; f < frames; f++) {
      const t = Math.min(clip.duration, f / fps);
      times[f] = t;
      mixer.setTime(t);
      srcWrap.updateMatrixWorld(true);

      const dstWorld = new Map<THREE.Object3D, THREE.Quaternion>();
      const parentWorld = (o: THREE.Object3D): THREE.Quaternion => {
        const p = o.parent!;
        return dstWorld.get(p)?.clone() ?? p.getWorldQuaternion(new THREE.Quaternion());
      };
      for (const b of order) {
        const s = srcBones.get(b.name);
        let world: THREE.Quaternion;
        if (s) {
          const delta = s.getWorldQuaternion(new THREE.Quaternion()).multiply(inv.copy(srcRef.get(b.name)!).invert());
          world = delta.multiply(dstRef.get(b.name)!);
          const local = parentWorld(b).invert().multiply(world);
          quatVals.get(b)!.set([local.x, local.y, local.z, local.w], f * 4);
        } else {
          world = parentWorld(b).multiply(dstDefaults.get(b)!.q);
        }
        dstWorld.set(b, world);
      }
      if (sHips && dHips) {
        const off = sHips.getWorldPosition(new THREE.Vector3()).sub(sHipsRef).multiplyScalar(hipScale);
        const p = dHipsRef.clone().add(off).applyMatrix4(dHipsParentInv);
        hipsVals.set([p.x, p.y, p.z], f * 3);
      }
    }

    const tracks: THREE.KeyframeTrack[] = [];
    for (const [b, v] of quatVals) tracks.push(new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`, times, v));
    if (dHips) tracks.push(new THREE.VectorKeyframeTrack(`${dHips.name}.position`, times, hipsVals));
    out.push(new THREE.AnimationClip(clip.name, clip.duration, tracks));
  }

  // Restore everything
  mixer.stopAllAction();
  for (const [b, d] of dstDefaults) {
    b.quaternion.copy(d.q);
    b.position.copy(d.p);
  }
  srcWrap.remove(src);
  dstWrap.remove(dst);
  if (srcParent) srcParent.add(src);
  if (dstParent) dstParent.add(dst);
  src.updateMatrixWorld(true);
  dst.updateMatrixWorld(true);
  return out;
}
