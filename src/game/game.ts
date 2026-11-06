import * as THREE from 'three';
import { Audio } from '../core/audio';
import { Input } from '../core/input';
import { Renderer } from '../core/renderer';
import { QUALITY_PRESETS, type QualityPreset, type Settings } from '../core/settings';
import { EnemyManager } from '../enemies/enemies';
import { Player } from '../player/player';
import { Hud } from '../ui/hud';
import { WeaponController, type ShotRequest } from '../weapons/controller';
import { createWeapons } from '../weapons/weapons';
import { Effects } from '../world/effects';
import { buildMap, type WorldMap } from '../world/map';
import { CoverMap } from '../world/cover';
import { NavGrid } from '../world/nav';
import { lineOfSight, raycastBoxes } from '../world/physics';
import { createMode, type GameMode, type ModeId } from './modes';

const CALLSIGNS = ['Hostile', 'Insurgent', 'Gunman', 'Rifleman', 'Raider', 'Mercenary', 'Sentry'];

export type GameState = 'menu' | 'playing' | 'paused' | 'dead';

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
  audio!: Audio;
  readonly player: Player;
  readonly enemies: EnemyManager;
  weapons!: WeaponController;
  readonly effects: Effects;
  map!: WorldMap;
  private nav!: NavGrid;
  private cover!: CoverMap;
  mode: GameMode | null = null;
  state: GameState = 'menu';
  private preset: QualityPreset;
  private loadedTexRes = '';
  private lastTime = performance.now();
  /** Overrides the frame delta (used by automated tests when the tab is hidden). */
  fixedDt: number | null = null;
  private deadT = 0;

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
  }

  private setState(s: GameState): void {
    this.state = s;
    this.hud.show(s === 'playing' || s === 'dead');
    this.onStateChange?.(s);
  }

  async load(): Promise<void> {
    await Promise.all([this.loadMap(), this.enemies.load()]);
    const weapons = await createWeapons();
    this.weapons = new WeaponController(weapons, this.viewScene, this.worldFlash);
    this.wireWeaponEvents();
    for (const w of this.weapons.weapons) w.view.visible = false;
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
    this.nav = new NavGrid(this.map.bounds, this.map.colliders);
    this.cover = new CoverMap(this.map.colliders, this.nav);
    this.loadedTexRes = `${this.preset.textureRes}/${this.preset.hdriRes}`;
  }

  private wireWeaponEvents(): void {
    const w = this.weapons;
    w.onFire = (ws) => this.audio?.gunshot(ws.def.soundPower);
    w.onDryFire = () => this.audio?.click(undefined, 0.7);
    w.onReloadStart = () => {
      this.audio?.click(undefined, 0.8);
      setTimeout(() => this.audio?.click(undefined, 0.6), 350);
    };
    w.onReloadEnd = () => this.audio?.click(undefined, 1.2);
    this.player.onFootstep = () => this.audio?.footstep(undefined, this.player.sprinting ? 1.3 : 0.8);
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
    this.hud.clearFeed();
    const sp = this.map.playerSpawns[Math.floor(Math.random() * this.map.playerSpawns.length)];
    this.player.spawn(sp, 0);
    this.weapons.reset();
    this.mode = createMode(modeId);
    this.weapons.infiniteAmmo = this.mode.infiniteAmmo;
    this.mode.start(this);
    this.camera.fov = this.settings.fov;
    this.camera.updateProjectionMatrix();
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
    this.mode = null;
    this.camera.position.set(-22, 9, 36);
    this.camera.lookAt(4, 1, -6);
    this.camera.fov = 70;
    this.camera.updateProjectionMatrix();
    for (const w of this.weapons.weapons) w.view.visible = false;
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

  private handleShot(s: ShotRequest): void {
    const d = s.weapon.def;
    const world = raycastBoxes(s.origin, s.dir, d.range, this.map.colliders);
    // Ground plane at y = 0
    let worldDist = world?.distance ?? Infinity;
    let worldPoint = world?.point;
    let worldNormal = world?.normal;
    if (s.dir.y < 0) {
      const t = -s.origin.y / s.dir.y;
      if (t < worldDist && t <= d.range) {
        worldDist = t;
        worldPoint = s.origin.clone().addScaledVector(s.dir, t);
        worldNormal = new THREE.Vector3(0, 1, 0);
      }
    }
    const enemy = this.enemies.raycast(s.origin, s.dir, Math.min(worldDist, d.range));

    // Tracer from the muzzle (in world space, approximated from the eye)
    const muzzleWorld = s.origin.clone()
      .add(new THREE.Vector3(0.12, -0.12, -0.4).applyQuaternion(this.camera.quaternion));
    const end = enemy ? enemy.point : worldPoint ?? s.origin.clone().addScaledVector(s.dir, d.range);
    if (Math.random() < 0.5) this.effects.tracer(muzzleWorld, end);

    this.enemies.playerFired(s.origin, s.dir);
    if (enemy) {
      // Damage falls off a little at long range
      const falloff = THREE.MathUtils.clamp(1 - (enemy.distance - 40) / 400, 0.75, 1);
      const dmg = d.damage * (enemy.headshot ? d.headMultiplier : 1) * falloff;
      const killed = enemy.enemy.damage(dmg, s.dir, this.player.position, this.enemies.intel);
      this.effects.blood(enemy.point, s.dir, enemy.headshot || killed);
      this.splatterBehind(enemy.point, s.dir, enemy.headshot ? 0.7 : 0.45);
      this.audio.flesh(enemy.point);
      this.audio.hitMarker(enemy.headshot);
      this.hud.hit(enemy.headshot, killed);
      if (killed) {
        this.mode?.onKill(this, enemy.headshot);
        this.hud.killFeed(CALLSIGNS[Math.floor(Math.random() * CALLSIGNS.length)], enemy.headshot);
      }
    } else if (worldPoint && worldNormal) {
      this.effects.bulletHole(worldPoint, worldNormal);
      this.effects.dust(worldPoint, worldNormal);
      this.audio.impact(worldPoint);
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
    // Otherwise blood lands on the ground a short way behind
    const drop = point.clone().addScaledVector(dir.clone().setY(0).normalize(), 0.6 + Math.random() * 1.2);
    drop.y = 0.005;
    this.effects.bloodSplat(drop, new THREE.Vector3(0, 1, 0), size * 0.8);
  }

  private onPlayerHit(dmg: number, from: THREE.Vector3): void {
    if (this.mode?.playerInvulnerable || !this.player.alive) return;
    const killed = this.player.damage(dmg);
    this.audio.hurt();
    const to = new THREE.Vector3().subVectors(from, this.player.position);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const angle = Math.atan2(to.x, -to.z) - Math.atan2(fwd.x, -fwd.z);
    this.hud.hurt(dmg, angle);
    this.player.punchPitch += 0.02;
    this.player.punchYaw += (Math.random() - 0.5) * 0.03;
    if (killed) {
      this.deadT = 0;
      this.setState('dead');
    }
  }

  private frame(): void {
    const now = performance.now();
    const dt = this.fixedDt ?? Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;
    const playing = this.state === 'playing' || this.state === 'dead';

    if (playing && this.mode) {
      const w0 = this.weapons.weapon.def;
      const zoom = this.weapons.aimBlend > 0.5 ? (w0.optic === 'scope' ? (w0.adsFov / this.settings.fov) * 1.2 : 0.7) : 1;
      this.player.update(dt, this.input, this.map.colliders, this.settings.sensitivity, this.weapons.aiming, zoom);
      const shots = this.weapons.update(dt, this.input, this.player, this.camera, this.settings.fov);
      for (const s of shots) this.handleShot(s);
      if (this.state === 'playing') this.mode.update(this, dt);
      this.enemies.update(dt, {
        player: this.player, nav: this.nav, cover: this.cover, colliders: this.map.colliders,
        audio: this.audio, effects: this.effects,
        onPlayerHit: (d, f) => this.onPlayerHit(d, f),
      });
      this.worldFlash.position.copy(this.camera.position);

      const w = this.weapons.weapon;
      const st = this.mode.status();
      this.hud.update(dt, {
        health: this.player.health, armor: this.player.armor,
        mag: w.mag, reserve: this.mode.infiniteAmmo ? '∞' : w.reserve, weapon: w.def.name,
        title: st.title, detail: st.detail,
        score: this.mode.score, alive: this.enemies.alive,
        spread: this.weapons.spread(this.player), aiming: this.weapons.aiming,
        reloading: this.weapons.reloading,
      });
      this.hud.setScope(this.weapons.scoped, this.weapons.breath / 4);
      for (const e of this.enemies.enemies) {
        if (e.dead && !e.bloodPooled && e.deadTime > 0.9) {
          e.bloodPooled = true;
          this.effects.bloodPool(e.rig.torsoWorld, 1.1 + Math.random() * 0.6);
        }
      }
      this.audio.updateListener(this.camera);

      if (this.state === 'dead') {
        this.deadT += dt;
        if (this.deadT > 2.2) {
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
      this.enemies.update(dt, {
        player: this.player, nav: this.nav, cover: this.cover, colliders: this.map.colliders,
        audio: this.audio, effects: this.effects, onPlayerHit: () => {},
      });
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
}
