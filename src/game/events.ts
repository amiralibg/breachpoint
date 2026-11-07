import type { GameEvent } from '../net/protocol';

type Handler<T extends GameEvent['type']> = (e: Extract<GameEvent, { type: T }>) => void;

/**
 * Simulation -> presentation channel. The simulation emits events; audio, HUD and effects listen.
 * In an online game the same events arrive from the server, so presentation code doesn't change.
 */
export class EventBus {
  private handlers = new Map<string, ((e: GameEvent) => void)[]>();
  /** Everything emitted since the last drain (what a server would broadcast this tick). */
  readonly outbox: GameEvent[] = [];
  recording = false;

  on<T extends GameEvent['type']>(type: T, fn: Handler<T>): void {
    const list = this.handlers.get(type) ?? [];
    list.push(fn as (e: GameEvent) => void);
    this.handlers.set(type, list);
  }

  emit(e: GameEvent): void {
    if (this.recording) this.outbox.push(e);
    for (const fn of this.handlers.get(e.type) ?? []) fn(e);
  }

  drain(): GameEvent[] {
    return this.outbox.splice(0);
  }
}
