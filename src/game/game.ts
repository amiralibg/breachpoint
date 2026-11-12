import * as THREE from 'three';
import { Audio, preloadSamples, type SampleName } from '../core/audio';
import { loadGlb } from '../core/assets';
import { Input } from '../core/input';
import { Renderer } from '../core/renderer';
import { QUALITY_PRESETS, type QualityPreset, type Settings } from '../core/settings';
import { EnemyManager, type Enemy } from '../enemies/enemies';
import { TICK_DT, Btn, type HitZone, type PlayerCommand, type Vec3 } from '../net/protocol';
import { Player } from '../player/player';
import { Hud } from '../ui/hud';
import { FpArms } from '../weapons/arms';
import { WeaponController, type ShotRequest, type WeaponState } from '../weapons/controller';
import { Viewmodel } from '../weapons/viewmodel';
import { WEAPONS } from '../weapons/weapons';
import { CoverMap } from '../world/cover';
import { Effects } from '../world/effects';
import { setActiveMap, surfaceAt, type WorldId, type WorldMap } from '../world/map';
import { buildWorld } from '../world/worlds';
import { initNavigation, NavSystem } from '../world/navmesh';
import { lineOfSight, raycastBoxes } from '../world/physics';
import { initPhysics, PhysicsWorld } from '../world/physics3d';
import { LootManager, type InteractCandidate } from '../world/loot';
import { CommandBuilder } from './commands';
import { EventBus } from './events';
import { MissionMode, type MissionDef, type SavedCheckpoint } from './mission';
import { createMode, type GameMode, type ModeId } from './modes';

const CALLSIGNS = ['Hostile', 'Insurgent', 'Gunman', 'Rifleman', 'Raider', 'Mercenary', 'Sentry'];
const ZONE_MULT: Record<HitZone, (w: WeaponState) => number> = {
  head: (w) => w.def.headMultiplier,
  torso: () => 1,
  arm: (w) => w.def.limbMultiplier,
  leg: (w) => w.def.limbMultiplier,
};
/** Handling sounds worth a stand-in click while the samples are still loading. */
const FALLBACK_CLICKS = new Set(['mag_out', 'mag_in', 'charge_fwd', 'slide', 'bolt']);
const v3 = (v: THREE.Vector3): Vec3 => [v.x, v.y, v.z];
const vec = (a: Vec3): THREE.Vector3 => new THREE.Vector3(a[0], a[1], a[2]);

export type GameState = 'menu' | 'playing' | 'paused' | 'dead' | 'complete';

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
  private viewSun = new THREE.DirectionalLight(0xffc089, 2.6);
  private viewHemi = new THREE.HemisphereLight(0x8fa6cf, 0x5a4636, 0.5);
  private viewFill = new THREE.DirectionalLight(0xa9c1ee, 0.85);
  private flashlight = new THREE.SpotLight(0xfff1dc, 0, 46, 0.5, 0.55, 1.5);
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
  loot!: LootManager;
  private activeInteract: InteractCandidate | null = null;
  map!: WorldMap;
  private nav!: NavSystem;
  private cover!: CoverMap;
  private commands = new CommandBuilder();
  /** The command the current tick ran on (missions read the interact button from it). */
  lastCmd: PlayerCommand | null = null;
  /** Where the player is looking, this tick. */
  readonly aimDir = new THREE.Vector3(0, 0, -1);
  /** How deep the player stands in water (m). */
  waterDepth = 0;
  private worldLoad: Promise<void> | null = null;
  /** Why the mission ended, when it ended in failure rather than death. */
  failReason: string | null = null;
  private wasAiming = false;
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
  onMissionComplete: ((m: MissionMode) => void) | null = null;
  /** A story checkpoint was taken (store it so the chapter can be resumed). */
  onCheckpoint: ((cp: SavedCheckpoint) => void) | null = null;

  constructor(container: HTMLElement, public settings: Settings) {
    this.preset = QUALITY_PRESETS[settings.quality];
    this.renderer = new Renderer(container, this.scene, this.camera, this.viewScene, this.viewCamera);
    this.input = new Input(this.renderer.domElement);
    this.player = new Player(this.camera);
    this.enemies = new EnemyManager(this.scene);
    this.effects = new Effects(this.scene, this.preset.decals);
    this.scene.add(this.camera, this.worldFlash);
    this.viewScene.add(this.viewSun, this.viewHemi);
    // Sky fill fixed to the view, from above and behind the left shoulder: whichever way the
    // player faces, the gun's top edges catch a cool highlight and its shadow side keeps its shape.
    this.viewFill.position.set(-1.6, 2.4, 1.2);
    this.viewScene.add(this.viewFill);
    // Carried light for the dark maps: rides on the camera, a little off the eye line
    this.flashlight.position.set(0.18, -0.12, 0);
    this.flashlight.target.position.set(0.1, -0.1, -6);
    this.flashlight.shadow.mapSize.set(1024, 1024);
    this.flashlight.shadow.camera.near = 0.3;
    this.flashlight.shadow.camera.far = 46;
    this.flashlight.shadow.bias = -0.002;
    this.flashlight.visible = false;
    this.camera.add(this.flashlight, this.flashlight.target);

    this.input.onUnlock = () => {
      if (this.state === 'playing') this.setState('paused');
    };
    this.wirePresentation();
  }

  private setState(s: GameState): void {
    this.state = s;
    this.hud.show(s === 'playing' || s === 'dead' || s === 'complete');
    this.onStateChange?.(s);
  }

  async load(): Promise<void> {
    void preloadSamples();
    await Promise.all([initPhysics(), initNavigation()]);
    this.phys = new PhysicsWorld();
    this.loot = new LootManager(this.scene, this.phys);
    this.enemies.setPhysics(this.phys);
    this.enemies.onMagDrop = (mag, vel) => this.dropProp(mag, vel, 0.6);
    this.enemies.onDropGun = (_enemy, pivot, vel, def, ammo, size, center) => {
      this.loot.spawnWeaponDrop(def, pivot, pivot.position, vel, ammo, { size, center });
    };
    this.enemies.onEnemyDeath = (enemy, def, ammo) => {
      this.loot.registerCasualty(enemy, def, Math.max(10, Math.floor(ammo * (0.6 + Math.random() * 0.4))));
    };
    await Promise.all([this.loadWorld('compound'), this.enemies.load()]);
    const states: WeaponState[] = await Promise.all(WEAPONS.map(async (def, _idx) => ({
      def, mag: def.magSize, reserve: def.reserve, vm: await Viewmodel.create(def),
      unlocked: true, // all weapons available in wave survival; unlockable in story missions
    })));
    // Purpose-built first-person arms; the soldier's own arms stand in if the file is missing.
    const armsModel = await loadGlb('characters/fp_arms.glb').then((g) => g.scene, () => this.enemies.characterScene);
    const arms = armsModel ? new FpArms(armsModel, true) : null;
    this.weapons = new WeaponController(states, this.viewScene, this.worldFlash, arms);
    this.weapons.cameraRef = this.camera;
    this.weapons.setObstacleColliders(this.map.colliders);
    this.wireWeaponEvents();
    this.weapons.setVisible(false);
    this.renderer.apply(this.preset);
    this.renderer.gl.setAnimationLoop(() => this.frame());
  }

  /** Make `id` the loaded map (no-op if it already is). Safe to call while another load runs. */
  loadWorld(id: WorldId, force = false): Promise<void> {
    const prev = this.worldLoad ?? Promise.resolve();
    this.worldLoad = prev.catch(() => {}).then(async () => {
      if (!force && this.map?.id === id) return;
      this.enemies.clear();
      this.effects.clear();
      this.phys.clear();
      this.loot.clear();
      this.map?.dispose();
      this.map = await buildWorld(id, this.scene, this.preset, this.renderer.gl);
      setActiveMap(this.map);
      const env = this.map.env;
      // The lit haze is as bright as the light that makes it: almost nothing under a moon
      const hazeColor = this.map.sunColor.clone().multiplyScalar(this.map.sun.intensity / 6.5);
      this.renderer.setSun(this.map.sunDir, hazeColor, env.shafts, this.map.sun.castShadow ? this.map.sun : null);
      this.viewScene.environment = this.map.envMap;
      this.viewScene.environmentIntensity = 0.9 * Math.max(0.3, env.viewLight);
      this.viewSun.color.copy(this.map.sunColor);
      this.flashlight.visible = env.flashlight;
      this.flashlight.intensity = env.flashlight ? 260 : 0;
      this.flashlight.castShadow = env.flashlight && this.preset.shadows;
      this.enemies.hearingScale = env.hearing;
      this.rebuildNav();
      this.weapons?.setObstacleColliders(this.map.colliders);
      this.loadedTexRes = `${this.preset.textureRes}/${this.preset.hdriRes}`;
      // New lights and fog: every material's program depends on them
      if (this.weapons) this.renderer.apply(this.preset);
    });
    return this.worldLoad;
  }

  /** Bake navigation, cover and physics statics from the map's colliders as they are now. */
  private rebuildNav(): void {
    this.nav?.dispose();
    this.nav = new NavSystem(this.map.bounds, this.map.colliders, this.map.navGround);
    this.enemies.nav = this.nav;
    this.cover = new CoverMap(this.map.colliders, this.nav, this.map.bounds);
    this.phys.setStatics(this.map.colliders);
    for (const e of this.enemies.enemies) {
      if (!e.dead) e.agent = this.nav.addAgent(e.position, e.stats.speed);
    }
  }

  /** Open or close a door or shutter on the map; paths and cover are rebuilt around it. */
  setDoor(id: string, open: boolean): void {
    if (this.map.setDoor(id, open)) this.rebuildNav();
  }

  // ---------------------------------------------------------------------------------------------
  // Presentation: everything below reacts to simulation events

  private wirePresentation(): void {
    const ev = this.events;
    ev.on('fire', (e) => {
      const def = WEAPONS.find((w) => w.id === e.weapon)!;
      this.audio?.gunshot(def.soundPower, undefined, def.sound as SampleName);
      // Brass hits the ground a moment later (bolt guns eject when the bolt is worked)
      if (!def.anims.cycle) this.audio?.play(this.casingSound(), { gain: 0.22, delay: 0.35 + Math.random() * 0.15, rate: def.id === 'pistol' ? 1.15 : 1 });
    });
    ev.on('dryFire', () => {
      if (!this.audio?.play('dry_fire')) this.audio?.click(undefined, 0.7);
    });
    ev.on('weaponSound', (e) => {
      if (e.sound === 'casing') {
        this.audio?.play(this.casingSound(), { gain: 0.25, delay: 0.4 });
        return;
      }
      // Timeline events name a motion; the gun in hand may have its own recording of it
      if (!this.audio?.foley(e.sound, this.weapons.weapon.def.id) && FALLBACK_CLICKS.has(e.sound)) this.audio?.click(undefined, 0.9);
    });
    ev.on('impact', (e) => {
      const p = vec(e.point);
      const n = vec(e.normal);
      this.effects.bulletHole(p, n);
      this.effects.dust(p, n);
      // Walls and props are hard; the ground is whatever it is at that spot (dirt yard, asphalt road)
      this.audio?.impact(p, e.surface === 'ground' ? surfaceAt(p) : 'hard');
    });
    ev.on('hit', (e) => {
      const p = vec(e.point);
      const d = vec(e.dir);
      const head = e.zone === 'head';
      this.effects.blood(p, d, head || e.killed);
      this.splatterBehind(p, d, head ? 0.7 : 0.45);
      this.audio?.flesh(p);
      this.audio?.hitMarker(head, e.killed);
      this.hud.hit(head, e.killed);
      if (e.killed) this.hud.killFeed(this.enemies.enemies.find((x) => x.id === e.target)?.label || CALLSIGNS[e.target % CALLSIGNS.length], head);
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
      // Close enough to hurt: ears shut for a moment
      this.audio?.concuss(1 - d / 14);
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

  /** Brass lands at the player's feet: it rings on the road, barely ticks in the dirt. */
  private casingSound(): SampleName {
    return surfaceAt(this.player.position) === 'dirt' ? 'casing_dirt' : 'casing_hard';
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
      await this.loadWorld(this.map.id, true);
    }
    const sun = this.map.sun;
    sun.castShadow = this.preset.shadows && sun.intensity > 0;
    this.flashlight.castShadow = this.map.env.flashlight && this.preset.shadows;
    if (sun.shadow.mapSize.x !== this.preset.shadowMapSize) {
      sun.shadow.mapSize.set(this.preset.shadowMapSize, this.preset.shadowMapSize);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
    this.renderer.apply(this.preset);
  }

  /** Start a mode on the map that is loaded. Story missions pass their definition. */
  start(modeId: ModeId, mission?: MissionDef, resume?: SavedCheckpoint | null): void {
    this.ensureAudio();
    this.failReason = null;
    this.enemies.clear();
    this.effects.clear();
    this.phys.clear();
    this.loot.clear();
    this.hud.clearFeed();
    const sp = this.map.playerSpawns[Math.floor(Math.random() * this.map.playerSpawns.length)];
    this.player.spawn(sp, this.map.spawnYaw);
    this.weapons.reset(mission?.loadout);
    this.weapons.setVisible(true);
    this.hud.setStory(false);
    if (mission) {
      const m = new MissionMode(mission, resume ?? null);
      m.onCheckpoint = (cp) => this.onCheckpoint?.(cp);
      this.mode = m;
    } else this.mode = createMode(modeId);
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
    // The browser can refuse the pointer lock (no recent click, e.g. after a long load): fall
    // back to the pause screen, whose Resume button is a fresh click
    setTimeout(() => {
      if (this.state === 'playing' && !this.input.locked && !this.fixedDt) this.setState('paused');
    }, 600);
  }

  /** Story: back to the last checkpoint after dying or failing. */
  restartCheckpoint(): void {
    if (!(this.mode instanceof MissionMode)) return;
    this.failReason = null;
    this.enemies.clear();
    this.effects.clear();
    this.phys.clear();
    this.loot.clear();
    this.hud.clearFeed();
    this.mode.restore();
    this.acc = 0;
    this.resume();
  }

  /** Mission scripting: the mission is lost for a reason other than the player dying. */
  failMission(reason: string): void {
    if (this.state !== 'playing') return;
    this.failReason = reason;
    this.deadT = 1.2;
    this.setState('dead');
  }

  completeMission(): void {
    if (!(this.mode instanceof MissionMode)) return;
    this.input.unlock();
    this.setState('complete');
    this.onMissionComplete?.(this.mode);
  }

  /** Mission scripting: a bot (friendly or not) is shot dead from `from`. */
  dropBot(e: Enemy, from: THREE.Vector3): void {
    if (e.dead) return;
    e.friendly = false;
    const dir = e.position.clone().sub(from).setY(0).normalize();
    e.damage(99999, dir, from, 'head', e.eye, { squad: this.enemies.squad, events: this.events });
    this.enemies.onDeath(e, { cover: this.cover });
  }

  /** Damage from the world (water, scripted hazards). */
  hurtPlayer(dmg: number, from: THREE.Vector3): void {
    this.onPlayerHit(dmg, from);
  }

  quitToMenu(): void {
    this.input.unlock();
    this.hud.setStory(false);
    this.audio?.setRain(0);
    this.enemies.clear();
    this.effects.clear();
    this.phys.clear();
    this.loot.clear();
    this.activeInteract = null;
    this.hud.setInteractPrompt(null);
    this.mode = null;
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
      .filter((c) => allowVisible || !lineOfSight(c.p.clone().setY(c.p.y + 1.6), eye, this.map.colliders));
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
    const floor = raycastBoxes(drop, new THREE.Vector3(0, -1, 0), 3, this.map.colliders);
    drop.y = (floor ? floor.point.y : 0) + 0.005;
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
    this.lastCmd = cmd;
    this.time += dt;
    if (!this.mode) return;
    const aiming = this.weapons.aiming;
    // Standing water: wading is slow
    this.waterDepth = 0;
    const pp = this.player.position;
    for (const w of this.map.waters) {
      if (pp.x > w.rect[0] && pp.x < w.rect[2] && pp.z > w.rect[1] && pp.z < w.rect[3]) this.waterDepth = Math.max(this.waterDepth, w.level - pp.y);
    }
    const wade = this.waterDepth > 0.35 ? THREE.MathUtils.lerp(0.85, 0.45, Math.min(1, (this.waterDepth - 0.35) / 0.9)) : 1;
    this.player.simulate(cmd, dt, this.map.colliders, aiming, wade);
    const shots = this.weapons.tick(cmd, dt, this.player);
    for (const s of shots) this.handleShot(s);
    const aimDir = this.aimDir.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    if (this.state === 'playing') this.mode.update(this, dt);
    if (this.state !== 'playing' && this.state !== 'dead') return;

    // Loot query & interaction
    if (this.player.alive) {
      const cand = this.loot.queryInteract(this.player.eye, aimDir, this.weapons);
      this.activeInteract = cand;
      if (cand && (cmd.pressed & Btn.Interact) !== 0) {
        this.loot.loot(cand, this.weapons, this.audio, this.events, this.hud);
      }
    } else {
      this.activeInteract = null;
    }
    this.loot.tick(dt, this.player.position);

    const ctx = {
      time: this.time, player: this.player, playerAim: { origin: this.player.eye, dir: aimDir, ads: aiming },
      nav: this.nav, cover: this.cover, colliders: this.map.colliders, audio: this.audio, effects: this.effects,
      events: this.events, onPlayerHit: (d: number, f: THREE.Vector3) => this.onPlayerHit(d, f),
      sightScale: this.map.env.sight * (this.mode.sightScale ?? 1) * (1 + this.map.flash * 2),
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
    const playing = (this.state === 'playing' || this.state === 'dead' || this.state === 'complete') && !!this.mode;

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
      this.mode!.render?.(this);
      this.hud.setInteractPrompt(!this.player.alive ? null : this.mode!.interactPrompt?.() ?? (this.activeInteract ? {
        key: this.activeInteract.promptKey,
        action: this.activeInteract.promptAction,
        detail: this.activeInteract.promptDetail,
      } : null));
      this.audio.updateListener(this.camera);
      this.audio.setHealth(this.player.health / 100);
      if (this.weapons.aiming !== this.wasAiming) {
        this.wasAiming = this.weapons.aiming;
        this.audio.ads(this.wasAiming);
      }
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
      const mc = this.map.menuCam;
      this.camera.position.set(mc.center.x + Math.sin(t) * mc.radius, mc.height, mc.center.z + Math.cos(t) * mc.radius);
      this.camera.lookAt(mc.center);
    }

    this.effects.update(dt);
    this.map.update(dt, this.camera.position, this.mode ? this.audio : undefined);
    this.syncViewLighting();
    this.renderer.render(dt);
    this.input.endFrame();
  }

  /** Keep the weapon lit consistently with the world as the camera turns. */
  private syncViewLighting(): void {
    const inv = this.camera.quaternion.clone().invert();
    const sunDir = this.map.sun.position.clone().sub(this.map.sun.target.position).normalize();
    this.viewSun.position.copy(sunDir.applyQuaternion(inv)).multiplyScalar(5);
    // The gun is lit like the place it is in: dim at night, flaring with lightning
    const k = this.map.env.viewLight * (1 + this.map.flash * 5) + (this.map.env.flashlight ? 0.25 : 0);
    this.viewSun.intensity = 2.6 * k * (this.map.sun.intensity > 0 ? 1 : 0.15);
    this.viewHemi.intensity = 0.5 * k;
    this.viewFill.intensity = 0.85 * k;
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
