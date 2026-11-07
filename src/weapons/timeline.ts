/**
 * Keyframed viewmodel animation.
 *
 * A timeline has tracks of [time, value, ease?] keys. Channels:
 *   pos / rot           whole-gun offset from the current base pose (view space, radians YXZ)
 *   <part> / <part>_rot offset of a movable part (magazine, bolt, slide...) in view space
 * Events fire once as playback crosses their time: "ammo" grants rounds, "ready" ends the action,
 * "drop:<part>" spawns a physical copy of that part, anything else is a sound name.
 * `hands` switches the left hand between anchors ("grip", "mag", "handle"...), blended over ~0.12 s.
 */

export type V3 = [number, number, number];
export type Ease = 'linear' | 'in' | 'out' | 'inout' | 'back';
export type Key = [t: number, v: V3, ease?: Ease];

export interface Timeline {
  length: number;
  events?: [number, string][];
  tracks: Record<string, Key[]>;
  /** Parts that are only visible within [from, to). */
  show?: Record<string, [number, number]>;
  /** Parts that are hidden within [from, to). */
  hide?: Record<string, [number, number]>;
  /** Left-hand anchor changes: [time, anchor]. */
  hands?: [number, string][];
  /** Right-hand anchor changes (bolt work, round loading). */
  rhands?: [number, string][];
}

export const Z: V3 = [0, 0, 0];

export function add(a: V3, b: V3): V3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function ease(t: number, e: Ease): number {
  switch (e) {
    case 'linear': return t;
    case 'in': return t * t * t;
    case 'out': return 1 - (1 - t) ** 3;
    case 'back': {
      const c = 1.6;
      return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
    }
    default: return t * t * (3 - 2 * t);
  }
}

/** Value of a track at time t (holds the first/last key outside the keyed range). */
export function sample(keys: Key[] | undefined, t: number, out: V3 = [0, 0, 0]): V3 {
  if (!keys || keys.length === 0) {
    out[0] = out[1] = out[2] = 0;
    return out;
  }
  if (t <= keys[0][0]) return copy(keys[0][1], out);
  for (let i = 1; i < keys.length; i++) {
    const k1 = keys[i];
    if (t < k1[0]) {
      const k0 = keys[i - 1];
      const u = ease((t - k0[0]) / Math.max(1e-6, k1[0] - k0[0]), k1[2] ?? 'inout');
      out[0] = k0[1][0] + (k1[1][0] - k0[1][0]) * u;
      out[1] = k0[1][1] + (k1[1][1] - k0[1][1]) * u;
      out[2] = k0[1][2] + (k1[1][2] - k0[1][2]) * u;
      return out;
    }
  }
  return copy(keys[keys.length - 1][1], out);
}

function copy(v: V3, out: V3): V3 {
  out[0] = v[0];
  out[1] = v[1];
  out[2] = v[2];
  return out;
}

/** Plays one timeline and reports the events crossed since the last update. */
export class TimelinePlayer {
  tl: Timeline | null = null;
  name = '';
  t = 0;
  speed = 1;

  play(name: string, tl: Timeline, speed = 1): void {
    this.name = name;
    this.tl = tl;
    this.t = 0;
    this.speed = speed;
  }

  stop(): void {
    this.tl = null;
    this.name = '';
  }

  get playing(): boolean {
    return this.tl !== null;
  }

  /** Advances time; returns the events crossed, in order. Stops after the last key. */
  update(dt: number): string[] {
    const tl = this.tl;
    if (!tl) return [];
    const t0 = this.t;
    const t1 = t0 + dt * this.speed;
    this.t = t1;
    const fired: string[] = [];
    for (const [et, name] of tl.events ?? []) if (et > t0 - 1e-9 && et <= t1) fired.push(name);
    if (t1 >= tl.length) {
      this.tl = null;
      fired.push('end');
    }
    return fired;
  }

  value(channel: string, out?: V3): V3 {
    return sample(this.tl?.tracks[channel], this.t, out);
  }

  /** Visibility override for a part, or null when the timeline doesn't control it. */
  shown(part: string): boolean | null {
    const h = this.tl?.hide?.[part];
    if (h && this.t >= h[0] && this.t < h[1]) return false;
    const w = this.tl?.show?.[part];
    if (!w) return null;
    return this.t >= w[0] && this.t < w[1];
  }

  /** Hand anchor blend: [previous, current, 0..1 toward current]. */
  hand(side: 'l' | 'r', rest: string): [string, string, number] {
    const hands = side === 'l' ? this.tl?.hands : this.tl?.rhands;
    if (!hands || hands.length === 0) return [rest, rest, 1];
    let prev = rest;
    let cur = rest;
    let since = Infinity;
    for (const [ht, a] of hands) {
      if (this.t >= ht) {
        prev = cur;
        cur = a;
        since = this.t - ht;
      }
    }
    return [prev, cur, Math.min(1, since / 0.12)];
  }
}
