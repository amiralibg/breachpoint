import type { EnemyStats } from '../enemies/enemies';
import type { Game } from './game';

export type ModeId = 'waves' | 'practice';

export interface GameMode {
  id: ModeId;
  name: string;
  start(game: Game): void;
  update(game: Game, dt: number): void;
  onKill(game: Game, headshot: boolean): void;
  /** Status line shown on the HUD (wave number, timers...). */
  status(): { title: string; detail: string };
  readonly playerInvulnerable: boolean;
  readonly infiniteAmmo: boolean;
  score: number;
  kills: number;
  wave: number;
}

/** Wave Survival: endless, escalating waves of armed enemies. */
export class WaveMode implements GameMode {
  id: ModeId = 'waves';
  name = 'Wave Survival';
  playerInvulnerable = false;
  infiniteAmmo = false;
  wave = 0;
  score = 0;
  kills = 0;
  private toSpawn = 0;
  private spawnT = 0;
  private intermission = 0;

  start(game: Game): void {
    this.wave = 0;
    this.score = 0;
    this.kills = 0;
    this.intermission = 5;
    game.hud.banner('GET READY', 'First wave incoming');
  }

  private stats(): EnemyStats {
    const n = this.wave;
    return {
      health: 100 + 8 * (n - 1),
      speed: Math.min(5.2, 3.8 + 0.12 * n),
      // Per-bullet values; bots fire short bursts from an M4
      accuracy: Math.min(0.5, 0.2 + 0.025 * n),
      damage: Math.min(16, 7 + 0.7 * n),
      fireInterval: Math.max(0.45, 1.2 - 0.05 * n),
      reaction: Math.max(0.3, 0.95 - 0.05 * n),
      passive: false,
    };
  }

  private maxConcurrent(): number {
    return Math.min(14, 3 + this.wave);
  }

  update(game: Game, dt: number): void {
    if (this.intermission > 0) {
      this.intermission -= dt;
      if (this.intermission <= 0) {
        this.wave++;
        this.toSpawn = Math.min(48, 4 + this.wave * 3);
        this.spawnT = 0;
        game.audio.waveHorn();
        game.hud.banner(`WAVE ${this.wave}`, `${this.toSpawn} hostiles`);
      }
      return;
    }

    this.spawnT -= dt;
    if (this.toSpawn > 0 && this.spawnT <= 0 && game.enemies.alive < this.maxConcurrent()) {
      const at = game.pickEnemySpawn();
      if (at) {
        game.enemies.spawn(at, this.stats(), game.player.position);
        this.toSpawn--;
        this.spawnT = Math.max(0.5, 2 - this.wave * 0.1);
      }
    }

    if (this.toSpawn === 0 && game.enemies.alive === 0) {
      const bonus = 500 * this.wave;
      this.score += bonus;
      this.intermission = 10;
      game.player.health = Math.min(100, game.player.health + 35);
      game.player.armor = Math.min(100, game.player.armor + 50);
      game.weapons.refillReserve();
      game.hud.banner(`WAVE ${this.wave} CLEARED`, `+${bonus} pts · ammo resupplied · next wave in 10s`);
    }
  }

  onKill(_game: Game, headshot: boolean): void {
    this.kills++;
    this.score += 100 + (headshot ? 50 : 0) + this.wave * 10;
  }

  status(): { title: string; detail: string } {
    if (this.intermission > 0 && this.wave > 0) {
      return { title: `WAVE ${this.wave} CLEARED`, detail: `Next wave in ${Math.ceil(this.intermission)}s` };
    }
    if (this.wave === 0) return { title: 'GET READY', detail: `${Math.ceil(this.intermission)}s` };
    return { title: `WAVE ${this.wave}`, detail: `${this.toSpawn} incoming` };
  }
}

/** Practice: passive targets that run around; infinite ammo, no damage taken. */
export class PracticeMode implements GameMode {
  id: ModeId = 'practice';
  name = 'Practice Range';
  playerInvulnerable = true;
  infiniteAmmo = true;
  kills = 0;
  score = 0;
  wave = 0;
  private spawnT = 0;

  start(game: Game): void {
    this.kills = 0;
    this.score = 0;
    game.hud.banner('PRACTICE', 'Targets do not shoot back · infinite ammo');
  }

  update(game: Game, dt: number): void {
    this.spawnT -= dt;
    if (this.spawnT <= 0 && game.enemies.alive < 6) {
      const at = game.pickEnemySpawn(true);
      if (at) game.enemies.spawn(at, {
        health: 100, speed: 3.2, accuracy: 0, damage: 0, fireInterval: 99, reaction: 99, passive: true,
      });
      this.spawnT = 1.2;
    }
  }

  onKill(_game: Game, headshot: boolean): void {
    this.kills++;
    this.score += headshot ? 150 : 100;
  }

  status(): { title: string; detail: string } {
    return { title: 'PRACTICE', detail: 'Press Esc for menu' };
  }
}

export function createMode(id: ModeId): GameMode {
  return id === 'waves' ? new WaveMode() : new PracticeMode();
}

