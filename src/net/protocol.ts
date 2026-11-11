/**
 * Wire types for multiplayer. Nothing here touches three.js or the DOM, so the same file can be
 * imported by a Node server. Today the game runs these through a local loop (see game.ts):
 * input -> PlayerCommand -> simulation tick -> GameEvents -> presentation (audio, HUD, effects).
 * An online client would send its commands to the server and render the server's snapshots and
 * events instead; see docs/ONLINE.md.
 */

/** Simulation rate. Commands, physics, AI and weapon logic all advance in these fixed steps. */
export const TICK_RATE = 60;
export const TICK_DT = 1 / TICK_RATE;

/** Button bits for PlayerCommand.buttons / .pressed. */
export const Btn = {
  Fire: 1 << 0,
  Aim: 1 << 1,
  Reload: 1 << 2,
  Jump: 1 << 3,
  Crouch: 1 << 4,
  Sprint: 1 << 5,
  Inspect: 1 << 6,
  NextWeapon: 1 << 7,
  PrevWeapon: 1 << 8,
  Interact: 1 << 9,
} as const;

/** Everything a player did during one tick. Small and serializable: this is what a client sends. */
export interface PlayerCommand {
  tick: number;
  /** Buttons held this tick. */
  buttons: number;
  /** Buttons that went down since the previous command (edge triggers). */
  pressed: number;
  /** Move intent in [-1, 1]: x = strafe right, z = forward. */
  moveX: number;
  moveZ: number;
  /** View angles (radians) after mouse look; the server trusts these within limits. */
  yaw: number;
  pitch: number;
  /** Requested weapon slot, or -1 for no change. */
  weapon: number;
}

export function emptyCommand(tick = 0): PlayerCommand {
  return { tick, buttons: 0, pressed: 0, moveX: 0, moveZ: 0, yaw: 0, pitch: 0, weapon: -1 };
}

export type Vec3 = [number, number, number];

/** Network-relevant facts the simulation produces. Presentation reacts to these, never the reverse. */
export type GameEvent =
  | { type: 'fire'; shooter: number; weapon: string; origin: Vec3; dir: Vec3 }
  | { type: 'dryFire'; shooter: number }
  | { type: 'weaponSound'; shooter: number; sound: string }
  | { type: 'impact'; point: Vec3; normal: Vec3; surface: 'world' | 'ground' }
  | { type: 'hit'; shooter: number; target: number; point: Vec3; dir: Vec3; zone: HitZone; damage: number; killed: boolean }
  | { type: 'playerHurt'; target: number; from: Vec3; damage: number; killed: boolean }
  | { type: 'enemyFire'; shooter: number; from: Vec3; to: Vec3; tracer: boolean; nearMiss: boolean }
  | { type: 'grenadeThrown'; shooter: number; id: number }
  | { type: 'explosion'; point: Vec3; radius: number }
  | { type: 'callout'; shooter: number; kind: Callout; at: Vec3 }
  | { type: 'spawn'; id: number; kind: 'enemy' | 'player'; at: Vec3 }
  | { type: 'death'; id: number; kind: 'enemy' | 'player' }
  | { type: 'lootPickup'; kind: 'weapon' | 'ammo'; weapon: string; amount: number; at: Vec3 };

export type HitZone = 'head' | 'torso' | 'arm' | 'leg';
export type Callout = 'contact' | 'reloading' | 'flanking' | 'grenade' | 'manDown' | 'lostHim' | 'suppressing';

/** Per-entity state an online client needs to render remote enemies/players. */
export interface EntitySnapshot {
  id: number;
  kind: 'enemy' | 'player';
  pos: Vec3;
  yaw: number;
  /** Animation inputs: crouch 0..1, aim 0..1, move speed m/s, lean -1..1. */
  crouch: number;
  aim: number;
  speed: number;
  health: number;
  dead: boolean;
}

export interface WorldSnapshot {
  tick: number;
  entities: EntitySnapshot[];
  /** Last command tick the server applied for the receiving client (for reconciliation). */
  ackTick: number;
}
