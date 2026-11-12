#!/usr/bin/env node
// Writes src/world/props.json: the bounding box of every prop model in public/assets/models, as
// modelled (before the game's scale fixes). Maps size and place props from it without loading
// any model they do not use. Run after `npm run assets`: `node scripts/prop-bounds.mjs`.
import fs from 'node:fs';
import path from 'node:path';
import { Box3, Matrix4, Quaternion, Vector3 } from 'three';

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const MODELS = path.join(ROOT, 'public/assets/models');
const out = {};

for (const id of fs.readdirSync(MODELS).sort()) {
  const file = path.join(MODELS, id, `${id}.gltf`);
  if (!fs.existsSync(file)) continue;
  const gltf = JSON.parse(fs.readFileSync(file, 'utf8'));
  const box = new Box3();
  const corner = new Vector3();
  const visit = (ni, parent) => {
    const n = gltf.nodes[ni];
    const local = new Matrix4();
    if (n.matrix) local.fromArray(n.matrix);
    else local.compose(new Vector3(...(n.translation ?? [0, 0, 0])), new Quaternion(...(n.rotation ?? [0, 0, 0, 1])), new Vector3(...(n.scale ?? [1, 1, 1])));
    const world = parent.clone().multiply(local);
    if (n.mesh !== undefined) {
      for (const p of gltf.meshes[n.mesh].primitives) {
        const a = gltf.accessors[p.attributes.POSITION];
        for (let i = 0; i < 8; i++) {
          corner.set(i & 1 ? a.max[0] : a.min[0], i & 2 ? a.max[1] : a.min[1], i & 4 ? a.max[2] : a.min[2]).applyMatrix4(world);
          box.expandByPoint(corner);
        }
      }
    }
    for (const c of n.children ?? []) visit(c, world);
  };
  for (const ni of gltf.scenes[gltf.scene ?? 0].nodes) visit(ni, new Matrix4());
  const r = (v) => Math.round(v * 10000) / 10000;
  out[id] = [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z].map(r);
}
fs.writeFileSync(path.join(ROOT, 'src/world/props.json'), `${JSON.stringify(out, null, 0).replace(/\],"/g, '],\n"')}\n`);
console.log(`wrote ${Object.keys(out).length} props`);
