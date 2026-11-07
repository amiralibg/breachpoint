import * as THREE from 'three';
import { Audio, preloadSamples, type SampleName } from '../core/audio';
import { Input } from '../core/input';
import { Renderer } from '../core/renderer';
import { QUALITY_PRESETS, type QualityPreset, type Settings } from '../core/settings';
import { EnemyManager, type Enemy } from '../enemies/enemies';
import { TICK_DT, type HitZone, type Vec3 } from '../net/protocol';
import { Player } from '../player/player';
import { Hud } from '../ui/hud';
import { FpArms } from '../weapons/arms';
import { WeaponController, type ShotRequest, type WeaponState } from '../weapons/controller';
import { Viewmodel } from '../weapons/viewmodel';
import { WEAPONS } from '../weapons/weapons';
import { CoverMap } from '../world/cover';
import { Effects } from '../world/effects';
import { buildMap, surfaceAt, type WorldMap } from '../world/map';
import { initNavigation, NavSystem } from '../world/navmesh';
import { lineOfSight, raycastBoxes } from '../world/physics';
import { initPhysics, PhysicsWorld } from '../world/physics3d';
import { CommandBuilder } from './commands';
import { EventBus } from './events';
import { createMode, type GameMode, type ModeId } from './modes';

const CALLSIGNS = ['Hostile', 'Insurgent', 'Gunman', 'Rifleman', 'Raider', 'Mercenary', 'Sentry'];
const ZONE_MULT: Record<HitZone, (w: WeaponState) => number> = {
  head: (w) => w.def.headMultiplier,
  torso: () => 1,
  arm: (w) => w.def.limbMultiplier,
  leg: (w) => w.def.limbMultiplier,
};
const v3 = (v: THREE.Vector3): Vec3 => [v.x, v.y, v.z];
const vec = (a: Vec3): THREE.Vector3 => new THREE.Vector3(a[0], a[1], a[2]);

export type GameState = 'menu' | 'playing' | 'paused' | 'dead';

/**
 * Owns the world and runs the loop:
 *   frame: sample input -> N fixed simulation ticks (commands, physics, AI, weapons) -> render
 * Simulation emits GameEvents; presentation (audio, HUD, effects) only reacts to them.
 * That split is what lets the simulation move to a server later (docs/ONLINE.md).
 */
export class Game {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(80, 1, 0.05, 600);
  private viewScene = new THREE.Scene();
  private viewCamera = new THREE.PerspectiveCamera(58, 1, 0.01, 10);
  private viewSun = new THREE.DirectionalLight(0xfff1dc, 2.4);
  private worldFlash = new THREE.PointLight(0xffb060, 0, 12, 2);
  readonly renderer: Renderer;
  readonly input: Input;
  readonly hud = new Hud();
  readonly events = new EventBus();
  audio!: Audio;
  readonly player: Player;
  readonly enemies: EnemyManager;
  weapons!: WeaponController;
  readonly effects: Effects;
  phys!: PhysicsWorld;
  map!: WorldMap;
  private nav!: NavSystem;
  private cover!: CoverMap;
  private commands = new CommandBuilder();
  mode: GameMode | null = null;
  state: GameState = 'menu';
  private preset: QualityPreset;
  private loadedTexRes = '';
  private lastTime = performance.now();
  /** Overrides the frame delta (used by automated tests when the tab is hidden). */
  fixedDt: number | null = null;
  private acc = 0;
  tick = 0;
  private time = 0;
  private deadT = 0;
  private shake = 0;
  debug = false;
  private debugEl: HTMLDivElement | null = null;

  onStateChange: ((s: GameState) => void) | null = null;
  onGameOver: (() => void) | null = null;

  constructor(container: HTMLElement, public settings: Settings) {
    this.preset = QUALITY_PRESETS[settings.quality];
    this.renderer = new Renderer(container, this.scene, this.camera, this.viewScene, this.viewCamera);
    this.input = new Input(this.renderer.domElement);
    this.player = new Player(this.camera);
    this.enemies = new EnemyManager(this.scene);
    this.effects = new Effects(this.scene, this.preset.decals);
    this.scene.add(this.camera, this.worldFlash);
    this.viewScene.add(this.viewSun, new THREE.AmbientLight(0xffffff, 0.15));

    this.input.onUnlock = () => {
      if (this.state === 'playing') this.setState('paused');
    };
    this.wirePresentation();
  }

  private setState(s: GameState): void {
    this.state = s;
    this.hud.show(s === 'playing' || s === 'dead');
    this.onStateChange?.(s);
  }

  async load(): Promise<void> {
    void preloadSamples();
    await Promise.all([initPhysics(), initNavigation()]);
    this.phys = new PhysicsWorld();
    this.enemies.setPhysics(this.phys);
    this.enemies.onMagDrop = (mag, vel) => this.dropProp(mag, vel, 0.6);
    await Promise.all([this.loadMap(), this.enemies.load()]);
    const states: WeaponState[] = await Promise.all(WEAPONS.map(async (def) => ({
      def, mag: def.magSize, reserve: def.reserve, vm: await Viewmodel.create(def),
    })));
    const proto = this.enemies.characterScene;
    const arms = proto ? new FpArms(proto, true) : null;
    this.weapons = new WeaponController(states, this.viewScene, this.worldFlash, arms);
    this.weapons.cameraRef = this.camera;
    this.wireWeaponEvents();
    this.weapons.setVisible(false);
    this.renderer.apply(this.preset);
    this.renderer.gl.setAnimationLoop(() => this.frame());
    // Idle menu camera
    this.camera.position.set(-22, 9, 36);
    this.camera.lookAt(4, 1, -6);
  }

  private async loadMap(): Promise<void> {
    this.map?.dispose();
    this.map = await buildMap(this.scene, this.preset);
    this.viewScene.environment = this.map.envMap;
    this.viewScene.environmentIntensity = 0.6;
    this.nav?.dispose();
    this.nav = new NavSystem(this.map.bounds, this.map.colliders);
    this.enemies.nav = this.nav;
    this.cover = new CoverMap(this.map.colliders, this.nav);
    this.phys.setStatics(this.map.colliders);
    this.loadedTexRes = `${this.preset.textureRes}/${this.preset.hdriRes}`;
  }

  // ---------------------------------------------------------------------------------------------
  // Presentation: everything below reacts to simulation events

  private wirePresentation(): void {
    const ev = this.events;
    ev.on('fire', (e) => {
      const def = WEAPONS.find((w) => w.id === e.weapon)!;
      this.audio?.gunshot(def.soundPower, undefined, def.sound as SampleName);
      // Brass hits the ground a moment later (bolt guns eject when the bolt is worked)
      if (!def.anims.cycle) this.audio?.play('casing', { gain: 0.22, delay: 0.35 + Math.random() * 0.15, rate: def.id === 'pistol' ? 1.15 : 1 });
    });
    ev.on('dryFire', () => {
      if (!this.audio?.play('dry_fire', { gain: 0.9 })) this.audio?.click(undefined, 0.7);
    });
    ev.on('weaponSound', (e) => {
      if (e.sound === 'casing') {
        this.audio?.play('casing', { gain: 0.25, delay: 0.4 });
        return;
      }
      const name = e.sound as SampleName;
      if (!this.audio?.play(name, { gain: name === 'holster' ? 0.5 : 0.85, wet: 0.06 })) this.audio?.click(undefined, 0.9);
    });
    ev.on('impact', (e) => {
      const p = vec(e.point);
      const n = vec(e.normal);
      this.effects.bulletHole(p, n);
      this.effects.dust(p, n);
      this.audio?.impact(p);
    });
    ev.on('hit', (e) => {
      const p = vec(e.point);
      const d = vec(e.dir);
      const head = e.zone === 'head';
      this.effects.blood(p, d, head || e.killed);
      this.splatterBehind(p, d, head ? 0.7 : 0.45);
      this.audio?.flesh(p);
      this.audio?.hitMarker(head);
      this.hud.hit(head, e.killed);
      if (e.killed) this.hud.killFeed(CALLSIGNS[e.target % CALLSIGNS.length], head);
    });
    ev.on('playerHurt', (e) => {
      const from = vec(e.from);
      this.audio?.hurt();
      const to = new THREE.Vector3().subVectors(from, this.player.position);
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
      const angle = Math.atan2(to.x, -to.z) - Math.atan2(fwd.x, -fwd.z);
      this.hud.hurt(e.damage, angle);
    });
    ev.on('enemyFire', (e) => {
      if (e.nearMiss) this.hud.suppress(0.35);
    });
    ev.on('explosion', (e) => {
      const p = vec(e.point);
      this.effects.explosion(p);
      this.audio?.explosion(p);
      const d = p.distanceTo(this.player.position);
      this.shake = Math.max(this.shake, THREE.MathUtils.clamp(1.4 - d / 18, 0, 1));
    });
    ev.on('callout', (e) => this.debugCallout(e.shooter, e.kind));
  }

  private wireWeaponEvents(): void {
    const w = this.weapons;
    w.onFire = (ws) => this.events.emit({
      type: 'fire', shooter: this.player.id, weapon: ws.def.id, origin: v3(this.player.eye), dir: [0, 0, -1],
    });
    w.onDryFire = () => this.events.emit({ type: 'dryFire', shooter: this.player.id });
    w.onSound = (name) => {
      this.events.emit({ type: 'weaponSound', shooter: this.player.id, sound: name });
      // Reloading is loud up close: nearby bots take the chance to push
      if (name === 'mag_out' || name === 'bolt') this.enemies.playerNoise(this.player.position, 14, 'reload');
    };
    w.onDropPart = (obj, vel) => this.dropProp(obj, vel.add(this.player.velocity), 0.5);
    this.player.onFootstep = () => {
      if (!this.audio) return;
      const loud = this.player.sprinting ? 0.85 : this.player.crouching ? 0.3 : 0.55;
      this.audio.step(surfaceAt(this.player.position), undefined, loud);
      this.enemies.playerNoise(this.player.position, this.player.sprinting ? 20 : 11, 'step');
    };
  }

  /** A loose magazine (or similar) tumbling onto the ground. */
  private dropProp(obj: THREE.Object3D, vel: THREE.Vector3, gain: number): void {
    this.scene.add(obj);
    obj.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    // Measure in the object's own frame
    const q = obj.quaternion.clone();
    const p = obj.position.clone();
    obj.quaternion.identity();
    obj.position.set(0, 0, 0);
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    obj.quaternion.copy(q);
    obj.position.copy(p);
    const size = box.getSize(new THREE.Vector3()).divide(obj.scale);
    const center = box.getCenter(new THREE.Vector3()).divide(obj.scale);
    let clinks = 0;
    this.phys.spawnProp(obj, {
      size, center, vel, spin: new THREE.Vector3(Math.random() * 6 - 3, Math.random() * 4 - 2, Math.random() * 6 - 3),
      density: 1200, life: 8, restitution: 0.3,
      onImpact: (s) => {
        if (clinks++ < 3 && this.audio) {
          if (!this.audio.play('mag_drop', { pos: obj.position, gain: gain * Math.min(1, s / 4) })) this.audio.clink(obj.position, 0.6);
        }
      },
    });
  }

  ensureAudio(): void {
    if (!this.audio) this.audio = new Audio(this.settings.volume);
    this.audio.resume();
  }

  async applySettings(s: Settings): Promise<void> {
    this.settings = s;
    this.preset = QUALITY_PRESETS[s.quality];
    this.audio?.setVolume(s.volume);
    this.hud.setFpsVisible(s.showFps);
    this.effects.setMaxDecals(this.preset.decals);
    if (this.map && `${this.preset.textureRes}/${this.preset.hdriRes}` !== this.loadedTexRes) {
      this.enemies.clear();
      await this.loadMap();
    }
    const sun = this.map.sun;
    sun.castShadow = this.preset.shadows;
    if (sun.shadow.mapSize.x !== this.preset.shadowMapSize) {
      sun.shadow.mapSize.set(this.preset.shadowMapSize, this.preset.shadowMapSize);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
    this.scene.fog = new THREE.Fog(0xc9d3dc, 70, this.preset.fogFar);
    this.renderer.apply(this.preset);
  }

  start(modeId: ModeId): void {
    this.ensureAudio();
    this.enemies.clear();
    this.effects.clear();
    this.phys.clear();
    this.hud.clearFeed();
    const sp = this.map.playerSpawns[Math.floor(Math.random() * this.map.playerSpawns.length)];
    this.player.spawn(sp, 0);
    this.weapons.reset();
    this.weapons.setVisible(true);
    this.mode = createMode(modeId);
    this.weapons.infiniteAmmo = this.mode.infiniteAmmo;
    this.mode.start(this);
    this.camera.fov = this.settings.fov;
    this.camera.updateProjectionMatrix();
    this.acc = 0;
    this.resume();
  }

  resume(): void {
    this.ensureAudio();
    this.input.lock();
    this.lastTime = performance.now();
    this.setState('playing');
  }

  quitToMenu(): void {
    this.input.unlock();
    this.enemies.clear();
    this.effects.clear();
    this.phys.clear();
    this.mode = null;
    this.camera.position.set(-22, 9, 36);
    this.camera.lookAt(4, 1, -6);
    this.camera.fov = 70;
    this.camera.updateProjectionMatrix();
    this.weapons.setVisible(false);
    this.setState('menu');
  }

  /** A spawn point far from the player and preferably out of sight. */
  pickEnemySpawn(allowVisible = false): THREE.Vector3 | null {
    const eye = this.player.eye;
    const candidates = this.map.enemySpawns
      .map((p) => ({ p, d: p.distanceTo(this.player.position) }))
      .filter((c) => c.d > 16)
      .filter((c) => allowVisible || !lineOfSight(c.p.clone().setY(1.6), eye, this.map.colliders));
    const pool = candidates.length ? candidates : this.map.enemySpawns.map((p) => ({ p, d: 0 }));
    if (!pool.length) return null;
    const pick = pool[Math.floor(Math.random() * pool.length)].p.clone();
    pick.x += (Math.random() - 0.5) * 2;
    pick.z += (Math.random() - 0.5) * 2;
    return pick;
  }

  // ---------------------------------------------------------------------------------------------
  // Simulation

  private handleShot(s: ShotRequest): void {
    const d = s.weapon.def;
    const world = raycastBoxes(s.origin, s.dir, d.range, this.map.colliders);
    // Ground plane at y = 0
    let worldDist = world?.distance ?? Infinity;
    let worldPoint = world?.point;
    let worldNormal = world?.normal;
    let surface: 'world' | 'ground' = 'world';
    if (s.dir.y < 0) {
      const t = -s.origin.y / s.dir.y;
      if (t < worldDist && t <= d.range) {
        worldDist = t;
        worldPoint = s.origin.clone().addScaledVector(s.dir, t);
        worldNormal = new THREE.Vector3(0, 1, 0);
        surface = 'ground';
      }
    }
    const hit = this.enemies.raycast(s.origin, s.dir, Math.min(worldDist, d.range));

    // Tracer from the muzzle
    const muzzle = s.weapon.vm.muzzle.getWorldPosition(new THREE.Vector3()).applyMatrix4(this.camera.matrixWorld);
    const end = hit ? hit.point : worldPoint ?? s.origin.clone().addScaledVector(s.dir, d.range);
    if (Math.random() < 0.5) this.effects.tracer(muzzle, end);

    this.enemies.playerFired(s.origin, s.dir, d.soundPower);
    if (hit) {
      // Damage falls off a little at long range
      const falloff = THREE.MathUtils.clamp(1 - (hit.distance - 40) / 400, 0.75, 1);
      const dmg = d.damage * ZONE_MULT[hit.zone](s.weapon) * falloff;
      const e = hit.enemy;
      const killed = e.damage(dmg, s.dir, this.player.position, hit.zone, hit.point, { squad: this.enemies.squad, events: this.events });
      if (killed) {
        this.enemies.onDeath(e, { cover: this.cover });
        this.mode?.onKill(this, hit.zone === 'head');
      }
      this.events.emit({
        type: 'hit', shooter: this.player.id, target: e.id, point: v3(hit.point), dir: v3(s.dir),
        zone: hit.zone, damage: dmg, killed,
      });
    } else if (worldPoint && worldNormal) {
      this.events.emit({ type: 'impact', point: v3(worldPoint), normal: v3(worldNormal), surface });
    }
  }

  /** Exit blood: paint the wall or floor behind the target if it's close enough. */
  private splatterBehind(point: THREE.Vector3, dir: THREE.Vector3, size: number): void {
    const o = point.clone().addScaledVector(dir, 0.3);
    const hit = raycastBoxes(o, dir, 3.5, this.map.colliders);
    if (hit) {
      this.effects.bloodSplat(hit.point, hit.normal, size * (1 - hit.distance / 5));
      return;
    }
    const drop = point.clone().addScaledVector(dir.clone().setY(0).normalize(), 0.6 + Math.random() * 1.2);
    drop.y = 0.005;
    this.effects.bloodSplat(drop, new THREE.Vector3(0, 1, 0), size * 0.8);
  }

  private onPlayerHit(dmg: number, from: THREE.Vector3): void {
    if (this.mode?.playerInvulnerable || !this.player.alive) return;
    const killed = this.player.damage(dmg);
    this.events.emit({ type: 'playerHurt', target: this.player.id, from: v3(from), damage: dmg, killed });
    this.player.punchPitch += 0.02;
    this.player.punchYaw += (Math.random() - 0.5) * 0.03;
    if (killed) {
      this.deadT = 0;
      this.events.emit({ type: 'death', id: this.player.id, kind: 'player' });
      this.setState('dead');
    }
  }

  private explode(p: THREE.Vector3): void {
    const R = 7.5;
    this.events.emit({ type: 'explosion', point: v3(p), radius: R });
    const center = p.clone().setY(Math.max(0.3, p.y + 0.2));
    // Player
    const pd = this.player.position.distanceTo(p);
    if (pd < R && lineOfSight(center, this.player.eye, this.map.colliders)) {
      this.onPlayerHit(Math.round(140 * (1 - pd / R) ** 1.4), p);
    }
    // Bots (no friendly-fire exemption: it's a grenade)
    for (const e of this.enemies.enemies) {
      if (e.dead) continue;
      const d = e.position.distanceTo(p);
      if (d > R || !lineOfSight(center, e.chest, this.map.colliders)) continue;
      const dir = e.chest.sub(p).normalize().add(new THREE.Vector3(0, 0.6, 0)).normalize();
      const killed = e.damage(160 * (1 - d / R) ** 1.3, dir, p, 'torso', e.chest, { squad: this.enemies.squad, events: this.events });
      if (killed) {
        this.enemies.onDeath(e, { cover: this.cover });
        this.mode?.onKill(this, false);
      }
    }
  }

  private simulate(dt: number): void {
    const cmd = this.commands.build(this.input, this.tick++, this.player.yaw, this.player.pitch);
    this.time += dt;
    if (!this.mode) return;
    const aiming = this.weapons.aiming;
    this.player.simulate(cmd, dt, this.map.colliders, aiming);
    const shots = this.weapons.tick(cmd, dt, this.player);
    for (const s of shots) this.handleShot(s);
    if (this.state === 'playing') this.mode.update(this, dt);
    const aimDir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const ctx = {
      time: this.time, player: this.player, playerAim: { origin: this.player.eye, dir: aimDir, ads: aiming },
      nav: this.nav, cover: this.cover, colliders: this.map.colliders, audio: this.audio, effects: this.effects,
      events: this.events, onPlayerHit: (d: number, f: THREE.Vector3) => this.onPlayerHit(d, f),
    };
    this.enemies.tick(dt, ctx);
    this.enemies.grenades.tick(dt, { ...ctx, enemies: this.enemies.enemies, squad: this.enemies.squad, grenades: this.enemies.grenades },
      (p) => this.explode(p));
    this.phys.step(dt);
    for (const e of this.enemies.enemies) {
      if (e.dead && !e.bloodPooled && e.deadTime > 1.2) {
        e.bloodPooled = true;
        this.effects.bloodPool(e.rig.torsoWorld, 1.1 + Math.random() * 0.6);
      }
    }
  }

  private frame(): void {
    const now = performance.now();
    const dt = this.fixedDt ?? Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;
    const playing = (this.state === 'playing' || this.state === 'dead') && !!this.mode;

    if (playing) {
      // Mouse look is applied every frame for responsiveness; the sim reads the angles per tick.
      const w0 = this.weapons.weapon.def;
      const zoom = this.weapons.aimBlend > 0.5 ? (w0.optic === 'scope' ? (w0.adsFov / this.settings.fov) * 1.2 : 0.7) : 1;
      if (this.player.alive) this.player.look(this.input.mouseDX, this.input.mouseDY, 0.0022 * this.settings.sensitivity * zoom);
      this.commands.sample(this.input);
      if (this.input.hit('F3')) this.toggleDebug();
      this.acc += dt;
      let n = 0;
      while (this.acc >= TICK_DT && n < 6) {
        this.simulate(TICK_DT);
        this.acc -= TICK_DT;
        n++;
      }
      if (n === 6) this.acc = 0; // way behind (tab was hidden): drop time rather than spiral
      const alpha = this.acc / TICK_DT;

      // Camera shake from explosions
      this.shake = Math.max(0, this.shake - dt * 1.6);
      const sk = this.shake * this.shake * 0.03;
      this.player.viewOffset.z = (Math.random() - 0.5) * sk;
      this.player.render(alpha, dt);
      if (sk > 0) {
        this.camera.rotation.x += (Math.random() - 0.5) * sk;
        this.camera.rotation.y += (Math.random() - 0.5) * sk;
      }
      this.camera.updateMatrixWorld();
      this.weapons.render(dt, alpha, this.input, this.player, this.camera, this.settings.fov);
      this.enemies.render(dt, alpha);
      this.phys.render();
      this.worldFlash.position.copy(this.camera.position);

      const w = this.weapons.weapon;
      const st = this.mode!.status();
      this.hud.update(dt, {
        health: this.player.health, armor: this.player.armor,
        mag: w.mag, magSize: w.def.magSize, reserve: this.mode!.infiniteAmmo ? '∞' : w.reserve, weapon: w.def.name,
        slot: w.def.slot, title: st.title, detail: st.detail,
        score: this.mode!.score, alive: this.enemies.alive,
        spread: this.weapons.spread(this.player), aiming: this.weapons.aiming,
        reloading: this.weapons.reloading, outOfAmmo: this.weapons.outOfAmmo,
      });
      this.hud.setScope(this.weapons.scoped, this.weapons.breath / 4);
      this.hud.grenades(this.enemies.grenades.positions, this.camera, this.player.position);
      this.audio.updateListener(this.camera);
      this.updateDebug();

      if (this.state === 'dead') {
        this.deadT += dt;
        if (this.deadT > 2.4) {
          this.input.unlock();
          this.onGameOver?.();
          this.deadT = -Infinity;
        }
      }
    } else if (this.state === 'menu') {
      // Slow orbit on the menu
      const t = performance.now() * 0.00004;
      this.camera.position.set(Math.sin(t) * 24, 13, Math.cos(t) * 24);
      this.camera.lookAt(0, 1.5, 0);
    }

    this.effects.update(dt);
    this.syncViewLighting();
    this.renderer.render(dt);
    this.input.endFrame();
  }

  /** Keep the weapon lit consistently with the world as the camera turns. */
  private syncViewLighting(): void {
    const inv = this.camera.quaternion.clone().invert();
    const sunDir = this.map.sun.position.clone().sub(this.map.sun.target.position).normalize();
    this.viewSun.position.copy(sunDir.applyQuaternion(inv)).multiplyScalar(5);
    this.viewScene.environmentRotation.setFromQuaternion(inv);
  }

  // ---------------------------------------------------------------------------------------------
  // F3 debug overlay: what each bot is doing

  private callouts = new Map<number, { kind: string; t: number }>();

  private debugCallout(id: number, kind: string): void {
    this.callouts.set(id, { kind, t: performance.now() });
  }

  toggleDebug(): void {
    this.debug = !this.debug;
    if (!this.debugEl) {
      this.debugEl = document.createElement('div');
      this.debugEl.id = 'ai-debug';
      document.body.appendChild(this.debugEl);
    }
    this.debugEl.style.display = this.debug ? 'block' : 'none';
  }

  private updateDebug(): void {
    if (!this.debug || !this.debugEl) return;
    const w = window.innerWidth, h = window.innerHeight;
    let html = '';
    for (const e of this.enemies.enemies as Enemy[]) {
      if (e.dead) continue;
      const p = e.position.clone().setY(2.1).project(this.camera);
      if (p.z > 1) continue;
      const c = this.callouts.get(e.id);
      const say = c && performance.now() - c.t < 2000 ? ` "${c.kind}"` : '';
      const tok = this.enemies.squad.hasToken(e) ? ' ★' : '';
      html += `<div style="left:${((p.x + 1) / 2) * w}px;top:${((1 - p.y) / 2) * h}px">`
        + `${e.role} · ${e.state}${tok}<br>aware ${(e.awareness * 100) | 0}% ${e.sees ? '👁' : ''}${say}</div>`;
    }
    html += `<div class="sq">squad intel age ${this.enemies.squad.age.toFixed(1)}s · camp ${this.enemies.squad.campTime.toFixed(1)}s · tick ${this.tick}</div>`;
    this.debugEl.innerHTML = html;
  }
}
