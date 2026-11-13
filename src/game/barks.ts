import * as THREE from 'three';
import type { Audio } from '../core/audio';
import type { Enemy } from '../enemies/enemies';
import type { Callout } from '../net/protocol';

/**
 * Who says what, out loud. The AI already announces what it is doing (`callout` events); this turns
 * those into voice lines at the speaker, without the squad turning into a choir:
 *  - one voice at a time, with a short breath between lines
 *  - each kind of line and each speaker has its own cooldown, so "Reloading!" is news, not noise
 *  - some lines matter more than others: a grenade warning cuts the queue, "lost him" waits its turn
 *  - only bots within earshot talk; the far side of the map stays quiet
 * Callouts are gameplay information as much as flavour: "Reloading!" is the moment to push,
 * "Going round the side!" is a flank you can now meet.
 */

const PRIORITY: Record<Callout, number> = {
  grenade: 5, manDown: 4, contact: 3, flanking: 3, reloading: 2, suppressing: 1, lostHim: 1,
};
/** Seconds before the same kind of line can be heard again (from anyone). */
const KIND_COOLDOWN: Record<Callout, number> = {
  grenade: 2.5, manDown: 6, contact: 7, flanking: 8, reloading: 6, suppressing: 10, lostHim: 9,
};
/** Some events happen all the time; say them only some of the time. */
const CHANCE: Record<Callout, number> = {
  grenade: 1, manDown: 0.85, contact: 0.9, flanking: 0.8, reloading: 0.6, suppressing: 0.6, lostHim: 0.9,
};
const SPEAKER_COOLDOWN = 4;
const GAP = 0.35;
const EARSHOT = 55;

export class Barks {
  private busyUntil = 0;
  private kindAt = new Map<Callout, number>();
  private speakerAt = new Map<number, number>();
  private queued: { e: Enemy; kind: Callout; at: number }[] = [];
  private t = 0;

  constructor(private audio: Audio) {
    audio.loadVoices();
  }

  reset(): void {
    this.queued.length = 0;
    this.kindAt.clear();
    this.speakerAt.clear();
    this.busyUntil = 0;
  }

  /** A bot announced something. `delay` lets a reaction land a beat after its cause. */
  callout(e: Enemy | undefined, kind: Callout, listener: THREE.Vector3, delay = 0): void {
    if (!e || e.dead || !e.voice || !this.audio.speakers(e.voice)) return;
    if (e.position.distanceTo(listener) > EARSHOT) return;
    if (Math.random() > CHANCE[kind]) return;
    if (this.t < (this.kindAt.get(kind) ?? -Infinity) + KIND_COOLDOWN[kind]) return;
    if (this.t < (this.speakerAt.get(e.id) ?? -Infinity) + SPEAKER_COOLDOWN && kind !== 'grenade') return;
    // Grenade warnings jump the queue; otherwise one waiting line per kind
    if (kind === 'grenade') this.queued = this.queued.filter((q) => PRIORITY[q.kind] >= PRIORITY.grenade);
    else if (this.queued.some((q) => q.kind === kind)) return;
    this.queued.push({ e, kind, at: this.t + delay });
    this.queued.sort((a, b) => PRIORITY[b.kind] - PRIORITY[a.kind] || a.at - b.at);
  }

  /** A bot went down: the nearest squad mate who saw it (same group, close by) reacts. */
  died(dead: Enemy, all: readonly Enemy[], listener: THREE.Vector3): void {
    let best: Enemy | undefined;
    let bestD = 22;
    for (const e of all) {
      if (e === dead || e.dead || !e.voice || e.voice !== dead.voice) continue;
      if (dead.group && e.group !== dead.group) continue;
      const d = e.position.distanceTo(dead.position);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    this.callout(best, 'manDown', listener, 0.5 + Math.random() * 0.6);
  }

  update(dt: number): void {
    this.t += dt;
    if (!this.queued.length || this.t < this.busyUntil) return;
    // Lines that waited too long are stale ("Reloading!" ten seconds later is a lie)
    this.queued = this.queued.filter((q) => !q.e.dead && this.t - q.at < 2.5);
    const i = this.queued.findIndex((q) => q.at <= this.t);
    if (i < 0) return;
    const { e, kind } = this.queued.splice(i, 1)[0];
    const speakers = this.audio.speakers(e.voice);
    const speaker = e.id % speakers;
    const pos = e.rig.headWorld;
    // Shouted lines carry; a pitch nudge per bot keeps two bots on one voice apart
    const rate = 0.96 + ((e.id * 37) % 9) * 0.01;
    const len = this.audio.voice(e.voice, speaker, kind, { pos, gain: 1.15, ref: 5, rolloff: 0.9, wet: 0.3, rate });
    if (len <= 0) return;
    this.busyUntil = this.t + len + GAP;
    this.kindAt.set(kind, this.t);
    this.speakerAt.set(e.id, this.t);
  }
}
