import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/**
 * Procedurally modelled M4 carbine with a red-dot sight (no free realistic M4 asset with a
 * direct download was available). Real-world proportions, in meters.
 *
 * Local frame: muzzle points down -Z, +Y up, origin at the top of the pistol grip.
 * A real model can replace it: see WEAPONS in weapons.ts (`model` field).
 */

export const M4_SIGHT_HEIGHT = 0.083; // red-dot center above the origin
export const M4_MUZZLE: [number, number, number] = [0, 0.012, -0.58];

let cache: { group: THREE.Group } | null = null;

function noiseTexture(size: number, base: number, amp: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const img = g.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = THREE.MathUtils.clamp(base + (Math.random() - 0.5) * amp, 0, 255);
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4, 4);
  return t;
}

function box(w: number, h: number, d: number, x: number, y: number, z: number, r = 0.002): THREE.BufferGeometry {
  const g = r > 0 ? new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2)) : new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

function cylZ(r: number, len: number, x: number, y: number, z: number, seg = 16, open = false): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1, open);
  g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  return g;
}

/** Shape drawn in the (z, y) plane, extruded along X and centered on x = 0. */
function profile(points: [number, number][], width: number, bevel = 0.002): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) s.lineTo(points[i][0], points[i][1]);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, {
    depth: width - bevel * 2, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, curveSegments: 6,
  });
  // Shape x -> world z, shape y -> world y, extrude z -> world x
  g.rotateY(-Math.PI / 2);
  g.translate((width - bevel * 2) / 2, 0, 0);
  g.computeVertexNormals();
  return g;
}

/** Picatinny rail: base strip plus cross slots. */
function rail(z0: number, z1: number, y: number, width = 0.021): THREE.BufferGeometry[] {
  const parts = [box(width, 0.006, Math.abs(z1 - z0), 0, y, (z0 + z1) / 2, 0.001)];
  for (let z = Math.min(z0, z1) + 0.004; z < Math.max(z0, z1) - 0.003; z += 0.01) {
    parts.push(box(width + 0.002, 0.004, 0.0055, 0, y + 0.004, z, 0.0008));
  }
  return parts;
}

export function buildM4(): THREE.Group {
  if (cache) return cache.group.clone(true);

  const rough = noiseTexture(128, 150, 70);
  const anodized = new THREE.MeshStandardMaterial({
    color: 0x1b1b1c, metalness: 0.35, roughness: 0.62, roughnessMap: rough,
  });
  const polymer = new THREE.MeshStandardMaterial({ color: 0x151515, metalness: 0.02, roughness: 0.85, roughnessMap: rough });
  const steel = new THREE.MeshStandardMaterial({ color: 0x232323, metalness: 0.85, roughness: 0.4, roughnessMap: rough });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x121212, metalness: 0, roughness: 0.95 });

  const metalParts: THREE.BufferGeometry[] = [];
  const polyParts: THREE.BufferGeometry[] = [];
  const steelParts: THREE.BufferGeometry[] = [];
  const rubberParts: THREE.BufferGeometry[] = [];

  // --- Upper receiver + flat-top rail
  metalParts.push(box(0.028, 0.04, 0.2, 0, 0.0, -0.01, 0.003));
  metalParts.push(...rail(0.085, -0.105, 0.023));
  metalParts.push(box(0.016, 0.012, 0.03, 0, 0.022, 0.1, 0.002)); // charging handle
  metalParts.push(box(0.008, 0.02, 0.06, -0.016, 0.0, -0.005, 0.001)); // ejection port cover
  metalParts.push(cylZ(0.007, 0.02, 0.018, 0.007, 0.045, 12)); // forward assist
  // --- Lower receiver with magazine well
  metalParts.push(profile([[0.08, -0.018], [-0.085, -0.018], [-0.085, -0.055], [-0.04, -0.06], [0.03, -0.058], [0.08, -0.045]], 0.026));
  metalParts.push(box(0.03, 0.035, 0.048, 0, -0.06, -0.06, 0.003)); // mag well
  steelParts.push(box(0.004, 0.012, 0.004, 0, -0.064, 0.005, 0.0008)); // trigger
  metalParts.push(box(0.012, 0.004, 0.05, 0, -0.078, 0.01, 0.001)); // trigger guard bottom
  // --- Pistol grip
  polyParts.push(profile([[0.03, -0.045], [0.058, -0.045], [0.09, -0.15], [0.078, -0.158], [0.052, -0.155], [0.025, -0.06]], 0.028, 0.004));
  // --- Magazine (curved STANAG)
  const mag: [number, number][] = [];
  const steps = 10;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    mag.push([-0.037 - t * 0.04 - t * t * 0.03, -0.065 - t * 0.17]);
  }
  for (let i = steps; i >= 0; i--) {
    const t = i / steps;
    mag.push([-0.037 - t * 0.04 - t * t * 0.03 - 0.058 - t * 0.006, -0.065 - t * 0.17 + 0.006 * t]);
  }
  metalParts.push(profile(mag, 0.024, 0.0025));
  // --- Handguard (quad rail)
  metalParts.push(box(0.044, 0.044, 0.2, 0, -0.002, -0.215, 0.006));
  metalParts.push(...rail(-0.115, -0.315, 0.024));
  for (const side of [-1, 1]) {
    const r = rail(-0.12, -0.31, 0, 0.018);
    for (const g of r) {
      g.rotateZ((side * Math.PI) / 2);
      g.translate(side * 0.024, -0.002, 0);
      metalParts.push(g);
    }
  }
  // --- Barrel, gas block, flash hider
  steelParts.push(cylZ(0.0085, 0.16, 0, 0.002, -0.4, 16));
  steelParts.push(box(0.022, 0.03, 0.022, 0, 0.004, -0.34, 0.002)); // gas block / front sight base
  steelParts.push(profile([[-0.335, 0.019], [-0.35, 0.019], [-0.355, 0.06], [-0.348, 0.064], [-0.34, 0.06]], 0.01, 0.001)); // front sight post
  steelParts.push(cylZ(0.011, 0.055, 0, 0.002, -0.505, 12)); // flash hider
  for (let i = 0; i < 4; i++) {
    const slot = box(0.003, 0.024, 0.032, 0, 0.002, -0.51, 0);
    slot.rotateZ((i * Math.PI) / 4);
    rubberParts.push(slot);
  }
  // --- Buffer tube + collapsible stock
  metalParts.push(cylZ(0.0155, 0.19, 0, -0.006, 0.18, 18));
  polyParts.push(profile([[0.17, 0.02], [0.3, 0.022], [0.305, -0.085], [0.285, -0.09], [0.255, -0.04], [0.17, -0.025]], 0.036, 0.004));
  rubberParts.push(box(0.04, 0.112, 0.012, 0, -0.032, 0.306, 0.004));
  polyParts.push(box(0.014, 0.018, 0.012, 0, -0.035, 0.21, 0.002)); // stock lever
  // --- Red dot sight on a riser mount
  metalParts.push(box(0.024, 0.034, 0.03, 0, 0.042, -0.02, 0.003)); // mount
  // Hollow sight tube (open ends, rendered double-sided) with thin lens rings
  const tubeParts = [
    cylZ(0.019, 0.07, 0, M4_SIGHT_HEIGHT, -0.02, 32, true),
    new THREE.TorusGeometry(0.0185, 0.0018, 6, 32).translate(0, M4_SIGHT_HEIGHT, 0.015),
    new THREE.TorusGeometry(0.0185, 0.0018, 6, 32).translate(0, M4_SIGHT_HEIGHT, -0.055),
  ];
  const turret = new THREE.CylinderGeometry(0.006, 0.006, 0.014, 10).rotateZ(Math.PI / 2);
  metalParts.push(turret.translate(0.022, M4_SIGHT_HEIGHT, -0.02)); // turret (side)
  metalParts.push(box(0.012, 0.012, 0.016, 0, M4_SIGHT_HEIGHT + 0.022, -0.02, 0.002)); // turret (top)
  // --- Rear flip-up sight
  metalParts.push(box(0.016, 0.022, 0.012, 0, 0.034, 0.07, 0.002));

  const group = new THREE.Group();
  group.name = 'm4';
  const add = (parts: THREE.BufferGeometry[], mat: THREE.Material): void => {
    const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)), false);
    const m = new THREE.Mesh(g, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  };
  add(metalParts, anodized);
  add(polyParts, polymer);
  add(steelParts, steel);
  add(rubberParts, rubber);
  const tubeMat = anodized.clone();
  tubeMat.side = THREE.DoubleSide;
  add(tubeParts, tubeMat);

  group.add(redDotOptic(M4_SIGHT_HEIGHT, -0.054, 0.014, 0.0165));

  cache = { group };
  return group.clone(true);
}

/**
 * Glass lenses plus a projected red dot for a tube sight centered at (0, height, z).
 * Used by the procedural M4 and the downloaded M4 model (whose lens faces were removed).
 */
export function redDotOptic(height: number, zFront: number, zRear: number, radius: number): THREE.Group {
  const optic = new THREE.Group();
  optic.name = 'optic';
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x9fd0ff, metalness: 0, roughness: 0.05, transparent: true, opacity: 0.14,
    clearcoat: 1, side: THREE.DoubleSide, depthWrite: false,
  });
  const lensGeo = new THREE.CircleGeometry(radius, 32);
  for (const z of [zFront, zRear]) {
    const lens = new THREE.Mesh(lensGeo, glass);
    lens.position.set(0, height, z);
    lens.userData.noAO = true;
    lens.renderOrder = 2;
    optic.add(lens);
  }
  const dotC = document.createElement('canvas');
  dotC.width = dotC.height = 32;
  const dg = dotC.getContext('2d')!;
  const grad = dg.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,90,70,1)');
  grad.addColorStop(0.25, 'rgba(255,30,20,0.9)');
  grad.addColorStop(1, 'rgba(255,0,0,0)');
  dg.fillStyle = grad;
  dg.fillRect(0, 0, 32, 32);
  const dotTex = new THREE.CanvasTexture(dotC);
  dotTex.colorSpace = THREE.SRGBColorSpace;
  const dot = new THREE.Sprite(new THREE.SpriteMaterial({
    map: dotTex, blending: THREE.AdditiveBlending, depthTest: false, transparent: true,
  }));
  dot.name = 'reddot';
  dot.scale.setScalar(0.0035);
  dot.position.set(0, height, zFront);
  dot.renderOrder = 3;
  optic.add(dot);
  return optic;
}
