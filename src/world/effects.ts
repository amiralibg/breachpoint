import * as THREE from 'three';

function canvasTexture(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export const flashTexture = canvasTexture(128, (g, s) => {
  const c = s / 2;
  const grad = g.createRadialGradient(c, c, 0, c, c, c);
  grad.addColorStop(0, 'rgba(255,250,230,1)');
  grad.addColorStop(0.2, 'rgba(255,200,110,0.9)');
  grad.addColorStop(0.5, 'rgba(255,120,30,0.35)');
  grad.addColorStop(1, 'rgba(255,80,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  // Star-shaped prongs
  g.globalCompositeOperation = 'lighter';
  g.translate(c, c);
  for (let i = 0; i < 6; i++) {
    g.rotate((Math.PI * 2) / 6 + Math.random() * 0.3);
    const lg = g.createLinearGradient(0, 0, c, 0);
    lg.addColorStop(0, 'rgba(255,230,170,0.9)');
    lg.addColorStop(1, 'rgba(255,140,40,0)');
    g.fillStyle = lg;
    g.beginPath();
    g.moveTo(0, -4);
    g.lineTo(c * (0.7 + Math.random() * 0.3), 0);
    g.lineTo(0, 4);
    g.fill();
  }
});

const holeTexture = canvasTexture(64, (g, s) => {
  const c = s / 2;
  const grad = g.createRadialGradient(c, c, 0, c, c, c);
  grad.addColorStop(0, 'rgba(10,8,6,1)');
  grad.addColorStop(0.18, 'rgba(25,20,16,0.95)');
  grad.addColorStop(0.35, 'rgba(60,50,40,0.6)');
  grad.addColorStop(1, 'rgba(90,80,70,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
});

const puffTexture = canvasTexture(64, (g, s) => {
  const c = s / 2;
  const grad = g.createRadialGradient(c, c, 0, c, c, c);
  grad.addColorStop(0, 'rgba(255,255,255,0.8)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
});

function splatterTexture(seed: number): THREE.CanvasTexture {
  return canvasTexture(128, (g, s) => {
    let r = seed * 9301 + 49297;
    const rnd = (): number => ((r = (r * 9301 + 49297) % 233280) / 233280);
    const c = s / 2;
    g.fillStyle = 'rgba(70,4,4,0.95)';
    g.beginPath();
    g.arc(c, c, s * 0.16, 0, Math.PI * 2);
    g.fill();
    for (let i = 0; i < 26; i++) {
      const a = rnd() * Math.PI * 2;
      const d = s * (0.1 + rnd() * 0.36);
      const rad = s * (0.012 + rnd() * 0.05) * (1 - d / s);
      g.fillStyle = `rgba(${55 + rnd() * 30},${2 + rnd() * 6},${2 + rnd() * 6},${0.75 + rnd() * 0.25})`;
      g.beginPath();
      g.arc(c + Math.cos(a) * d, c + Math.sin(a) * d, rad, 0, Math.PI * 2);
      g.fill();
      // streak toward the center
      g.strokeStyle = g.fillStyle;
      g.lineWidth = rad * 0.9;
      g.beginPath();
      g.moveTo(c + Math.cos(a) * d * 0.4, c + Math.sin(a) * d * 0.4);
      g.lineTo(c + Math.cos(a) * d, c + Math.sin(a) * d);
      g.stroke();
    }
  });
}

const poolTexture = canvasTexture(128, (g, s) => {
  const c = s / 2;
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const grad = g.createRadialGradient(c + Math.cos(a) * 14, c + Math.sin(a) * 14, 0, c + Math.cos(a) * 14, c + Math.sin(a) * 14, s * 0.34);
    grad.addColorStop(0, 'rgba(60,3,3,0.95)');
    grad.addColorStop(0.75, 'rgba(50,2,2,0.85)');
    grad.addColorStop(1, 'rgba(40,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
  }
});

interface Pool {
  mesh: THREE.Mesh;
  age: number;
  size: number;
}

interface Particle {
  sprite: THREE.Sprite;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  grow: number;
  gravity: number;
}

interface Tracer {
  line: THREE.Line;
  life: number;
}

/** Bullet holes, dust/spark/blood puffs and tracers, all pooled. */
export class Effects {
  private decals: THREE.Mesh[] = [];
  private decalIdx = 0;
  private particles: Particle[] = [];
  private tracers: Tracer[] = [];
  private decalGeo = new THREE.PlaneGeometry(0.09, 0.09);
  private decalMat = new THREE.MeshStandardMaterial({
    map: holeTexture, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -4, roughness: 1, metalness: 0,
  });
  private tracerMat = new THREE.LineBasicMaterial({ color: 0xffd28a, transparent: true, opacity: 0.6 });
  private splatMats = [1, 2, 3, 4].map((seed) => new THREE.MeshStandardMaterial({
    map: splatterTexture(seed), transparent: true, depthWrite: false, roughness: 0.25, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: -4,
  }));
  private poolMat = new THREE.MeshStandardMaterial({
    map: poolTexture, transparent: true, depthWrite: false, roughness: 0.08, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: -3,
  });
  private splats: THREE.Mesh[] = [];
  private pools: Pool[] = [];
  private unitPlane = new THREE.PlaneGeometry(1, 1);

  constructor(private scene: THREE.Scene, private maxDecals: number) {}

  setMaxDecals(n: number): void {
    this.maxDecals = n;
    while (this.decals.length > n) {
      const d = this.decals.shift()!;
      this.scene.remove(d);
    }
    this.decalIdx = 0;
  }

  bulletHole(point: THREE.Vector3, normal: THREE.Vector3): void {
    let d: THREE.Mesh;
    if (this.decals.length < this.maxDecals) {
      d = new THREE.Mesh(this.decalGeo, this.decalMat);
      d.receiveShadow = true;
      d.userData.noAO = true;
      this.decals.push(d);
      this.scene.add(d);
    } else {
      d = this.decals[this.decalIdx];
      this.decalIdx = (this.decalIdx + 1) % this.decals.length;
    }
    d.position.copy(point).addScaledVector(normal, 0.005);
    d.lookAt(point.clone().add(normal));
    d.rotateZ(Math.random() * Math.PI * 2);
    d.scale.setScalar(0.7 + Math.random() * 0.6);
  }

  private spawn(pos: THREE.Vector3, vel: THREE.Vector3, color: THREE.ColorRepresentation, size: number, life: number, grow: number, gravity: number, additive = false): void {
    const mat = new THREE.SpriteMaterial({
      map: puffTexture, color, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const s = new THREE.Sprite(mat);
    s.position.copy(pos);
    s.scale.setScalar(size);
    this.scene.add(s);
    this.particles.push({ sprite: s, vel, life, maxLife: life, grow, gravity });
  }

  dust(point: THREE.Vector3, normal: THREE.Vector3, color = 0xb8a68a): void {
    for (let i = 0; i < 5; i++) {
      const v = normal.clone().multiplyScalar(1 + Math.random() * 1.5)
        .add(new THREE.Vector3((Math.random() - 0.5) * 1.2, Math.random() * 0.8, (Math.random() - 0.5) * 1.2));
      this.spawn(point, v, color, 0.12, 0.6 + Math.random() * 0.5, 0.9, 1.5);
    }
    for (let i = 0; i < 4; i++) {
      const v = normal.clone().multiplyScalar(3 + Math.random() * 3)
        .add(new THREE.Vector3((Math.random() - 0.5) * 4, Math.random() * 3, (Math.random() - 0.5) * 4));
      this.spawn(point, v, 0xffc070, 0.03, 0.18, 0, 9, true);
    }
  }

  /** Blood spray at a bullet hit: exit spray along the bullet, a little back-spatter, and mist. */
  blood(point: THREE.Vector3, dir: THREE.Vector3, heavy = false): void {
    const n = heavy ? 16 : 9;
    for (let i = 0; i < n; i++) {
      const back = i < 3 ? -0.6 : 1;
      const v = dir.clone().multiplyScalar((1.5 + Math.random() * 3) * back)
        .add(new THREE.Vector3((Math.random() - 0.5) * 1.6, Math.random() * 1.4, (Math.random() - 0.5) * 1.6));
      this.spawn(point, v, 0x4a0303, 0.025 + Math.random() * 0.04, 0.35 + Math.random() * 0.4, 0.2, 9.8);
    }
    for (let i = 0; i < (heavy ? 4 : 2); i++) {
      const v = dir.clone().multiplyScalar(0.6).add(new THREE.Vector3((Math.random() - 0.5) * 0.5, 0.2, (Math.random() - 0.5) * 0.5));
      this.spawn(point, v, 0x6a0808, 0.12 + Math.random() * 0.1, 0.5 + Math.random() * 0.3, 1.6, 0.3);
    }
  }

  /** Blood splatter decal on a wall or the ground. */
  bloodSplat(point: THREE.Vector3, normal: THREE.Vector3, size = 0.5): void {
    const m = new THREE.Mesh(this.unitPlane, this.splatMats[Math.floor(Math.random() * this.splatMats.length)]);
    m.userData.noAO = true;
    m.receiveShadow = true;
    m.position.copy(point).addScaledVector(normal, 0.006);
    m.lookAt(point.clone().add(normal));
    m.rotateZ(Math.random() * Math.PI * 2);
    m.scale.setScalar(size * (0.7 + Math.random() * 0.6));
    this.scene.add(m);
    this.splats.push(m);
    if (this.splats.length > Math.max(12, this.maxDecals / 3)) this.scene.remove(this.splats.shift()!);
  }

  /** A pool of blood that slowly spreads under a body. */
  bloodPool(pos: THREE.Vector3, size = 1.3): void {
    const m = new THREE.Mesh(this.unitPlane, this.poolMat);
    m.userData.noAO = true;
    m.receiveShadow = true;
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = Math.random() * Math.PI * 2;
    m.position.set(pos.x, 0.012 + this.pools.length * 0.0004, pos.z);
    m.scale.setScalar(0.05);
    this.scene.add(m);
    this.pools.push({ mesh: m, age: 0, size });
    if (this.pools.length > 16) this.scene.remove(this.pools.shift()!.mesh);
  }

  /** Grenade blast: fireball, smoke column, debris sparks, a scorch mark and a light flash. */
  explosion(point: THREE.Vector3): void {
    for (let i = 0; i < 10; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 6, 1 + Math.random() * 4, (Math.random() - 0.5) * 6);
      this.spawn(point.clone().add(new THREE.Vector3(0, 0.3, 0)), v, 0xffa040, 0.6 + Math.random() * 0.6, 0.25 + Math.random() * 0.15, 3, 0, true);
    }
    for (let i = 0; i < 14; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 5, 1.5 + Math.random() * 3.5, (Math.random() - 0.5) * 5);
      this.spawn(point.clone().add(new THREE.Vector3(0, 0.4, 0)), v, i < 6 ? 0x3a352e : 0x7d7366, 0.8 + Math.random() * 0.8, 2.2 + Math.random() * 1.8, 0.9, -0.4);
    }
    for (let i = 0; i < 24; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 18, 3 + Math.random() * 9, (Math.random() - 0.5) * 18);
      this.spawn(point.clone().add(new THREE.Vector3(0, 0.2, 0)), v, 0xffc070, 0.05, 0.5 + Math.random() * 0.4, 0, 12, true);
    }
    const scorch = new THREE.Mesh(this.unitPlane, this.poolMat.clone());
    (scorch.material as THREE.MeshStandardMaterial).color.set(0x111111);
    (scorch.material as THREE.MeshStandardMaterial).roughness = 1;
    scorch.userData.noAO = true;
    scorch.rotation.x = -Math.PI / 2;
    scorch.rotation.z = Math.random() * Math.PI * 2;
    scorch.position.set(point.x, 0.011, point.z);
    scorch.scale.setScalar(2.4);
    this.scene.add(scorch);
    this.splats.push(scorch);
    const light = new THREE.PointLight(0xffa050, 120, 18, 2);
    light.position.copy(point).setY(point.y + 0.8);
    this.scene.add(light);
    this.lights.push({ light, life: 0.35, max: 0.35, peak: 120 });
  }

  private lights: { light: THREE.PointLight; life: number; max: number; peak: number }[] = [];

  tracer(from: THREE.Vector3, to: THREE.Vector3): void {
    const g = new THREE.BufferGeometry().setFromPoints([from, to]);
    const line = new THREE.Line(g, this.tracerMat.clone());
    this.scene.add(line);
    this.tracers.push({ line, life: 0.06 });
  }

  update(dt: number): void {
    for (let i = this.lights.length - 1; i >= 0; i--) {
      const l = this.lights[i];
      l.life -= dt;
      l.light.intensity = Math.max(0, l.life / l.max) ** 2 * l.peak;
      if (l.life <= 0) {
        this.scene.remove(l.light);
        this.lights.splice(i, 1);
      }
    }
    for (const p of this.pools) {
      p.age += dt;
      const k = 1 - Math.exp(-p.age * 0.45);
      p.mesh.scale.setScalar(Math.max(0.05, p.size * k));
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.scene.remove(p.sprite);
        p.sprite.material.dispose();
        this.particles.splice(i, 1);
        continue;
      }
      p.vel.y -= p.gravity * dt;
      p.vel.multiplyScalar(1 - Math.min(1, dt * 2.5));
      p.sprite.position.addScaledVector(p.vel, dt);
      p.sprite.scale.multiplyScalar(1 + p.grow * dt);
      p.sprite.material.opacity = p.life / p.maxLife;
    }
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      if (t.life <= 0) {
        this.scene.remove(t.line);
        t.line.geometry.dispose();
        (t.line.material as THREE.Material).dispose();
        this.tracers.splice(i, 1);
      }
    }
  }

  clear(): void {
    for (const s of this.splats) this.scene.remove(s);
    this.splats = [];
    for (const p of this.pools) this.scene.remove(p.mesh);
    this.pools = [];
    for (const d of this.decals) this.scene.remove(d);
    this.decals = [];
    for (const p of this.particles) this.scene.remove(p.sprite);
    this.particles = [];
    for (const t of this.tracers) this.scene.remove(t.line);
    this.tracers = [];
    for (const l of this.lights) this.scene.remove(l.light);
    this.lights = [];
  }
}
