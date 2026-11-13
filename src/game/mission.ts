import * as THREE from 'three';
import type { Enemy, EnemyStats, Role } from '../enemies/enemies';
import { Btn } from '../net/protocol';
import type { V3 } from '../world/level';
import type { WorldId } from '../world/map';
import type { Game } from './game';
import type { GameMode, ModeId } from './modes';

/**
 * Story missions. A mission is data plus small script hooks: an ordered list of stages, each with
 * one or more tasks (reach a place, use something, clear a group, hold for a time). The runtime
 * here ticks inside the fixed simulation step and only talks to the game through its public
 * surface, so it can move to a server with the rest of the simulation.
 */

export type Faction = 'lowwater' | 'cordon';

export interface SpawnDef {
  at: V3;
  role?: Role;
  /** Metres the bot wanders from its post while it has nothing to fight (0 = stands still). */
  leash?: number;
  /** Armoured: more than twice the health, slower. */
  heavy?: boolean;
  /** Facing on arrival (radians). */
  face?: number;
}

export interface GroupDef {
  faction: Faction;
  units: SpawnDef[];
}

export interface Task {
  id: string;
  text: string;
  /** Where it happens: gets a marker on the HUD. */
  at?: V3;
  /** Done when the player is within this many metres of `at`. */
  reach?: number;
  /** Done when the player uses the thing at `at` (hold E for `hold` seconds, or a tap). */
  interact?: { label: string; hold?: number };
  /** Done when every bot of this spawned group is dead. */
  clear?: string;
  /** Done after this many seconds; with `radius`, the clock only runs while the player stays near `at`. */
  hold?: { seconds: number; label: string; radius?: number };
  /** Custom condition, checked every tick. */
  check?(m: MissionMode, dt: number): boolean;
  /** Not needed to finish the stage. */
  optional?: boolean;
  noMarker?: boolean;
  onDone?(m: MissionMode): void;
}

export interface Stage {
  id: string;
  tasks: Task[];
  /** Any one task finishes the stage (a choice). */
  any?: boolean;
  /** Runs when the stage starts; `restored` is true when coming back from a checkpoint. */
  enter?(m: MissionMode, restored: boolean): void;
  /** Runs every tick while the stage is active. */
  tick?(m: MissionMode, dt: number): void;
}

export interface MissionDef {
  id: string;
  /** 1-based position in the campaign. */
  index: number;
  title: string;
  subtitle: string;
  /** Campaign clock line for the briefing ("T-36 h · 02:40 · heavy rain"). */
  clock: string;
  map: WorldId;
  briefing: string[];
  /** Objective summary on the briefing screen. */
  objectives: string[];
  /** Weapon ids the player starts with. */
  loadout: string[];
  groups: Record<string, GroupDef>;
  stages: Stage[];
  /** Shown on the mission-complete screen; may depend on choices made. */
  debrief(m: MissionMode): string[];
}

const STATS: Record<Faction, EnemyStats> = {
  lowwater: { health: 90, speed: 4.0, accuracy: 0.2, damage: 7.5, fireInterval: 1.15, reaction: 0.95, passive: false },
  cordon: { health: 145, speed: 4.4, accuracy: 0.33, damage: 10, fireInterval: 0.85, reaction: 0.65, passive: false },
};
/** Soldier models per faction (indices into the enemy manager's model list). */
const MODELS: Record<Faction, number[]> = { lowwater: [0, 2], cordon: [1] };
const NAMES: Record<Faction, string> = { lowwater: 'Low Water', cordon: 'Cordon' };

interface RadioLine {
  who: string;
  text: string;
  seconds: number;
  /** Mission time when it was queued. */
  born: number;
}

interface Checkpoint {
  stage: number;
  pos: THREE.Vector3;
  yaw: number;
  armor: number;
  weapons: { mag: number; reserve: number; unlocked: boolean }[];
  slot: number;
  flags: Record<string, number | string | boolean>;
  doors: Record<string, boolean>;
  power: boolean;
  waters: number[];
  waterTargets: { level: number; rate: number }[];
  clock: number | null;
}

/** A checkpoint as stored between sessions, so a chapter can be resumed after quitting. */
export interface SavedCheckpoint {
  mission: string;
  stage: number;
  /** Stages in the chapter, for "objective 2 of 4" on the story screen. */
  stages: number;
  pos: V3;
  yaw: number;
  armor: number;
  weapons: Checkpoint['weapons'];
  slot: number;
  flags: Checkpoint['flags'];
  doors: Checkpoint['doors'];
  power: boolean;
  waters: number[];
  waterTargets: Checkpoint['waterTargets'];
  clock: number | null;
  elapsed: number;
  kills: number;
  /** What the player was doing, for the story screen. */
  task: string;
  savedAt: number;
}

interface TaskState {
  done: boolean;
  progress: number;
}

const _v = new THREE.Vector3();

export class MissionMode implements GameMode {
  id: ModeId = 'story';
  name: string;
  playerInvulnerable = false;
  infiniteAmmo = false;
  score = 0;
  kills = 0;
  wave = 0;
  sightScale = 1;
  game!: Game;
  /** Script state: choices made, counters. Saved with checkpoints. */
  flags: Record<string, number | string | boolean> = {};
  stageIndex = 0;
  elapsed = 0;
  complete = false;
  failed: string | null = null;
  private tasks = new Map<string, TaskState>();
  private radio: RadioLine[] = [];
  private radioT = 0;
  private radioGap = 0;
  private current: RadioLine | null = null;
  private timers: { t: number; fn: () => void }[] = [];
  private spawned = new Set<string>();
  private doors: Record<string, boolean> = {};
  private power = true;
  private waterTargets: { level: number; rate: number }[] = [];
  private clock: number | null = null;
  private clockLabel = '';
  private clockExpire: (() => void) | null = null;
  private checkpoint: Checkpoint | null = null;
  private prompt: { key: string; action: string; detail: string } | null = null;
  private endT = -1;
  private drownT = 0;
  private eWasDown = false;

  /** Called every time a checkpoint is taken (the stage advanced), to store it. */
  onCheckpoint: ((cp: SavedCheckpoint) => void) | null = null;

  /** `resume`: carry on from a checkpoint stored in an earlier session. */
  constructor(readonly def: MissionDef, private resume: SavedCheckpoint | null = null) {
    this.name = def.title;
  }

  get stage(): Stage {
    return this.def.stages[this.stageIndex];
  }

  // ---------------------------------------------------------------------------------------------
  // Script API

  /** Queue a radio line. Lines play one after another with subtitles. */
  say(who: string, text: string, seconds?: number): void {
    this.radio.push({ who, text, seconds: seconds ?? 1.5 + text.length * 0.046, born: this.elapsed });
  }

  /** Run something later (cancelled if the player goes back to a checkpoint). */
  after(seconds: number, fn: () => void): void {
    this.timers.push({ t: seconds, fn });
  }

  /** Spawn a named group. `alert`: they already know where the player is. */
  spawn(group: string, opts: { alert?: boolean } = {}): Enemy[] {
    const g = this.def.groups[group];
    if (!g) throw new Error(`mission ${this.def.id}: no spawn group "${group}"`);
    this.spawned.add(group);
    const out: Enemy[] = [];
    for (const u of g.units) {
      const base = STATS[g.faction];
      const stats: EnemyStats = u.heavy ? { ...base, health: base.health * 2.4, speed: base.speed * 0.78 } : { ...base };
      const at = new THREE.Vector3(...u.at);
      const e = this.game.enemies.spawn(at, stats, undefined, {
        role: u.role ?? 'rifleman', models: MODELS[g.faction], home: opts.alert ? undefined : at.clone(), leash: u.leash ?? 4,
        group, voice: g.faction, label: u.heavy ? `${NAMES[g.faction]} heavy` : NAMES[g.faction], scale: u.heavy ? 1.09 : 1, facing: u.face,
      });
      if (opts.alert) e.alert(this.game.player.position);
      out.push(e);
    }
    return out;
  }

  /** Living bots of a group (0 before it has been spawned). */
  alive(group: string): number {
    let n = 0;
    for (const e of this.game.enemies.enemies) if (!e.dead && e.group === group) n++;
    return n;
  }

  wasSpawned(group: string): boolean {
    return this.spawned.has(group);
  }

  /** Every living hostile learns where the player is. */
  alertAll(group?: string): void {
    for (const e of this.game.enemies.enemies) {
      if (!e.dead && !e.friendly && (!group || e.group === group)) e.alert(this.game.player.position);
    }
  }

  /** A friendly who follows the player (an escort). Reuses the one already in the world. */
  escort(name: string, at: V3): Enemy {
    const have = this.game.enemies.enemies.find((e) => e.friendly && e.label === name && !e.dead);
    if (have) return have;
    const e = this.game.enemies.spawn(new THREE.Vector3(...at), { ...STATS.lowwater, passive: true }, undefined, {
      role: 'rifleman', models: [2], friendly: true, label: name, group: 'friendly',
    });
    e.follow = true;
    return e;
  }

  friendly(name: string): Enemy | undefined {
    return this.game.enemies.enemies.find((e) => e.friendly && e.label === name && !e.dead);
  }

  /** A named friendly is killed by a shot from `from` (scripted). */
  fall(name: string, from: V3): void {
    const e = this.friendly(name);
    if (e && !e.dead) this.game.dropBot(e, new THREE.Vector3(...from));
  }

  door(id: string, open: boolean): void {
    this.doors[id] = open;
    this.game.setDoor(id, open);
  }

  setPower(on: boolean): void {
    this.power = on;
    this.game.map.setPower(on);
  }

  /** Dim or restore the daylight; bots see less in the dark. Call it from `enter` so checkpoints restore it. */
  daylight(f: number): void {
    this.game.map.setDaylight(f);
    this.sightScale = 0.45 + 0.55 * f;
  }

  /** Raise or lower a water sheet toward `level` at `rate` metres per second. */
  water(index: number, level: number, rate: number): void {
    this.waterTargets[index] = { level, rate };
  }

  /** A countdown on the HUD; `onExpire` runs when it reaches zero. */
  startClock(seconds: number, label: string, onExpire: () => void): void {
    this.clock = seconds;
    this.clockLabel = label;
    this.clockExpire = onExpire;
  }

  stopClock(): void {
    this.clock = null;
    this.clockExpire = null;
  }

  banner(title: string, sub: string, seconds = 4): void {
    this.game.hud.banner(title, sub, seconds);
  }

  fail(reason: string): void {
    if (this.failed || this.complete) return;
    this.failed = reason;
    this.game.failMission(reason);
  }

  /** Finish a task from script. */
  finish(taskId: string): void {
    const t = this.stage.tasks.find((x) => x.id === taskId);
    const st = this.tasks.get(taskId);
    if (!t || !st || st.done) return;
    st.done = true;
    this.game.audio?.chime(true);
    t.onDone?.(this);
  }

  isDone(taskId: string): boolean {
    return !!this.tasks.get(taskId)?.done;
  }

  dist(at: V3): number {
    return this.game.player.position.distanceTo(_v.set(at[0], at[1], at[2]));
  }

  // ---------------------------------------------------------------------------------------------
  // GameMode

  start(game: Game): void {
    this.game = game;
    this.stageIndex = 0;
    this.flags = {};
    this.elapsed = 0;
    this.kills = 0;
    this.complete = false;
    this.failed = null;
    this.endT = -1;
    this.radio = [];
    this.current = null;
    this.timers = [];
    this.spawned.clear();
    this.doors = {};
    this.power = true;
    this.waterTargets = [];
    this.clock = null;
    this.sightScale = 1;
    game.map.setDaylight(1);
    game.map.setPower(true);
    game.hud.setStory(true);
    game.hud.subtitle(null);
    const r = this.resume;
    if (r && r.mission === this.def.id && r.stage < this.def.stages.length) {
      this.resume = null;
      this.elapsed = r.elapsed;
      this.kills = r.kills;
      this.checkpoint = {
        stage: r.stage, pos: new THREE.Vector3(...r.pos), yaw: r.yaw, armor: r.armor, weapons: r.weapons, slot: r.slot,
        flags: { ...r.flags }, doors: { ...r.doors }, power: r.power, waters: [...r.waters],
        waterTargets: r.waterTargets.map((w) => ({ ...w })), clock: r.clock,
      };
      this.restore();
      this.banner(`${this.def.index}. ${this.def.title.toUpperCase()}`, 'Resuming from the last checkpoint', 5);
      return;
    }
    this.banner(`${this.def.index}. ${this.def.title.toUpperCase()}`, this.def.subtitle, 5);
    this.enterStage(false);
    this.saveCheckpoint();
  }

  /** The current checkpoint as plain data. */
  saved(): SavedCheckpoint | null {
    const cp = this.checkpoint;
    if (!cp) return null;
    const stage = this.def.stages[cp.stage];
    return {
      mission: this.def.id, stage: cp.stage, stages: this.def.stages.length,
      pos: cp.pos.toArray() as V3, yaw: cp.yaw, armor: cp.armor, weapons: cp.weapons.map((w) => ({ ...w })), slot: cp.slot,
      flags: { ...cp.flags }, doors: { ...cp.doors }, power: cp.power, waters: [...cp.waters],
      waterTargets: cp.waterTargets.map((w) => ({ ...w })), clock: cp.clock,
      elapsed: this.elapsed, kills: this.kills, task: stage.tasks.find((t) => !t.optional)?.text ?? '', savedAt: Date.now(),
    };
  }

  private enterStage(restored: boolean): void {
    this.tasks.clear();
    for (const t of this.stage.tasks) this.tasks.set(t.id, { done: false, progress: 0 });
    // The player moved on: chatter still waiting from before is stale
    this.radio = this.radio.filter((l) => this.elapsed - l.born < 5);
    this.timers = [];
    this.stage.enter?.(this, restored);
    if (!restored && this.stageIndex > 0) this.game.audio?.chime(false);
  }

  private saveCheckpoint(): void {
    const g = this.game;
    this.checkpoint = {
      stage: this.stageIndex,
      pos: g.player.position.clone(),
      yaw: g.player.yaw,
      armor: g.player.armor,
      weapons: g.weapons.snapshot(),
      slot: g.weapons.weapon.def.slot,
      flags: { ...this.flags },
      doors: { ...this.doors },
      power: this.power,
      waters: g.map.waters.map((w) => w.level),
      waterTargets: this.waterTargets.map((w) => ({ ...w })),
      clock: this.clock,
    };
    if (this.onCheckpoint) {
      const sv = this.saved();
      if (sv) this.onCheckpoint(sv);
    }
  }

  /** Back to the last checkpoint (after dying). */
  restore(): void {
    const cp = this.checkpoint;
    const g = this.game;
    if (!cp) return;
    this.failed = null;
    this.timers = [];
    this.radio = [];
    this.current = null;
    g.hud.subtitle(null);
    this.stageIndex = cp.stage;
    this.flags = { ...cp.flags };
    for (const [id, open] of Object.entries(cp.doors)) g.setDoor(id, open);
    for (const id of Object.keys(this.doors)) if (!(id in cp.doors)) g.setDoor(id, !this.doors[id]);
    this.doors = { ...cp.doors };
    this.setPower(cp.power);
    g.map.waters.forEach((w, i) => this.applyWater(i, cp.waters[i] ?? w.level));
    this.waterTargets = cp.waterTargets.map((w) => ({ ...w }));
    this.clock = cp.clock;
    g.player.spawn(cp.pos, cp.yaw);
    g.player.armor = Math.max(60, cp.armor);
    g.weapons.restore(cp.weapons, cp.slot);
    this.enterStage(true);
    this.banner('CHECKPOINT', 'Restarting from the last objective', 3);
  }

  private applyWater(i: number, level: number): void {
    const w = this.game.map.waters[i];
    if (!w) return;
    w.level = level;
    w.mesh.position.y = level;
    w.mesh.visible = level > 0.02;
  }

  update(game: Game, dt: number): void {
    if (this.failed) return;
    this.elapsed += dt;
    const p = game.player;

    // Radio
    if (this.current) {
      this.radioT -= dt;
      if (this.radioT <= 0) {
        this.current = null;
        this.radioGap = 0.45;
        game.hud.subtitle(null);
        game.audio?.radio(false);
      }
    } else if (this.radio.length) {
      this.radioGap -= dt;
      if (this.radioGap <= 0) {
        this.current = this.radio.shift()!;
        this.radioT = this.current.seconds;
        game.hud.subtitle(this.current.who, this.current.text);
        game.audio?.radio(true);
      }
    }

    // Timers
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const t = this.timers[i];
      t.t -= dt;
      if (t.t <= 0) {
        this.timers.splice(i, 1);
        t.fn();
      }
    }
    if (this.clock !== null && !this.complete) {
      this.clock -= dt;
      if (this.clock <= 0) {
        const fn = this.clockExpire;
        this.stopClock();
        fn?.();
      }
    }

    // Water: rises and falls toward its target; deep water slows, then drowns
    this.waterTargets.forEach((w, i) => {
      const cur = game.map.waters[i]?.level;
      if (cur === undefined || cur === w.level) return;
      const step = w.rate * dt;
      this.applyWater(i, Math.abs(w.level - cur) <= step ? w.level : cur + Math.sign(w.level - cur) * step);
    });
    if (game.waterDepth > 1.7 && p.alive) {
      this.drownT += dt;
      if (this.drownT > 0.5) {
        this.drownT = 0;
        game.hurtPlayer(14, p.position.clone().setY(p.position.y - 1));
      }
    } else this.drownT = 0;

    if (this.complete) {
      this.endT -= dt;
      if (this.endT <= 0 && !this.radio.length && !this.current) {
        this.endT = Infinity;
        game.completeMission();
      }
      return;
    }
    if (!p.alive) return;

    // Tasks
    this.stage.tick?.(this, dt);
    this.prompt = null;
    const cmd = game.lastCmd;
    const eDown = !!cmd && (cmd.buttons & Btn.Interact) !== 0;
    const eTap = (!!cmd && (cmd.pressed & Btn.Interact) !== 0) || (eDown && !this.eWasDown);
    this.eWasDown = eDown;
    const eye = p.eye;
    const look = game.aimDir;
    for (const t of this.stage.tasks) {
      const st = this.tasks.get(t.id)!;
      if (st.done) continue;
      let done = false;
      const d = t.at ? this.dist(t.at) : Infinity;
      if (t.reach !== undefined && d < t.reach) done = true;
      if (t.clear && this.spawned.has(t.clear) && this.alive(t.clear) === 0) done = true;
      if (t.check?.(this, dt)) done = true;
      if (t.hold) {
        if (!t.hold.radius || d < t.hold.radius) st.progress += dt;
        if (st.progress >= t.hold.seconds) done = true;
      }
      if (t.interact && t.at) {
        const to = _v.set(t.at[0], t.at[1], t.at[2]).sub(eye);
        const near = to.length() < 2.6 && to.normalize().dot(look) > 0.55;
        if (near && !this.prompt) {
          const hold = t.interact.hold ?? 0;
          this.prompt = { key: 'E', action: t.interact.label.toUpperCase(), detail: hold ? 'HOLD' : '' };
          if (hold) {
            if (eDown) st.progress += dt;
            else st.progress = Math.max(0, st.progress - dt * 2);
            if (st.progress >= hold) done = true;
          } else if (eTap) done = true;
        } else if (!near && t.interact.hold) st.progress = Math.max(0, st.progress - dt * 2);
      }
      if (done) {
        st.done = true;
        game.audio?.chime(true);
        t.onDone?.(this);
        if (this.failed || this.complete) return;
      }
    }

    const need = this.stage.tasks.filter((t) => !t.optional);
    const finished = this.stage.any
      ? need.some((t) => this.tasks.get(t.id)!.done)
      : need.every((t) => this.tasks.get(t.id)!.done);
    if (finished) {
      if (this.stageIndex >= this.def.stages.length - 1) {
        this.complete = true;
        this.stopClock();
        this.endT = 2.5;
        return;
      }
      this.stageIndex++;
      this.enterStage(false);
      this.saveCheckpoint();
    }
  }

  /**
   * Developer: finish the current objective as if the player had done it (each task's onDone
   * runs, so flags, doors and water move the way the story expects), then go to the next one.
   */
  devSkipStage(): void {
    if (this.complete || this.failed) return;
    for (const t of this.stage.tasks) {
      const st = this.tasks.get(t.id);
      if (!st || st.done || t.optional) continue;
      st.done = true;
      st.progress = 1;
      t.onDone?.(this);
    }
    if (this.stageIndex >= this.def.stages.length - 1) {
      this.complete = true;
      this.stopClock();
      this.endT = 2.5;
      return;
    }
    this.stageIndex++;
    this.enterStage(false);
    this.saveCheckpoint();
  }

  /** Developer: where the current objective is (the first unfinished task with a place). */
  devObjective(): THREE.Vector3 | null {
    for (const t of this.stage.tasks) {
      const st = this.tasks.get(t.id);
      const at = (t as { at?: V3 }).at;
      if (st && !st.done && at) return new THREE.Vector3(...at);
    }
    return null;
  }

  /** Developer: chapter progress for the panel. */
  devStatus(): { stage: number; stages: number; id: string } {
    return { stage: this.stageIndex, stages: this.def.stages.length, id: this.stage.id };
  }

  onKill(_game: Game, _headshot: boolean): void {
    this.kills++;
  }

  status(): { title: string; detail: string } {
    return { title: `${this.def.index} · ${this.def.title.toUpperCase()}`, detail: this.def.subtitle };
  }

  /** What E would do right now, for the HUD prompt. */
  interactPrompt(): { key: string; action: string; detail: string } | null {
    return this.prompt;
  }

  /** HUD: objective list, markers, progress bar and countdown (every rendered frame). */
  render(game: Game): void {
    const hud = game.hud;
    const list: { text: string; done: boolean; optional: boolean }[] = [];
    const marks: { pos: THREE.Vector3; label: string }[] = [];
    let bar: { label: string; frac: number } | null = null;
    if (!this.complete) {
      for (const t of this.stage.tasks) {
        const st = this.tasks.get(t.id);
        if (!st) continue;
        let text = t.text;
        if (t.clear && this.spawned.has(t.clear) && !st.done) text += ` (${this.alive(t.clear)} left)`;
        list.push({ text, done: st.done, optional: !!t.optional });
        if (st.done) continue;
        if (t.at && !t.noMarker) marks.push({ pos: new THREE.Vector3(t.at[0], t.at[1] + 0.4, t.at[2]), label: '' });
        if (t.hold && st.progress > 0) bar = { label: t.hold.label, frac: st.progress / t.hold.seconds };
        if (t.interact?.hold && st.progress > 0) bar = { label: t.interact.label, frac: st.progress / t.interact.hold };
      }
    }
    hud.objectives(list);
    hud.markers(marks, game.camera, game.player.position);
    hud.progress(bar);
    if (this.clock !== null) {
      const s = Math.max(0, Math.ceil(this.clock));
      hud.clock(`${this.clockLabel} ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`, this.clock < 60);
    } else hud.clock(null, false);
  }
}
