import * as THREE from 'three';

const SAMPLE_NAMES = [
  // Weapon handling, one per motion (fired by the timelines in weapons/weapons.ts)
  'mag_release', 'mag_out', 'mag_insert', 'mag_in', 'mag_drop', 'bolt_release', 'charge_back', 'charge_fwd',
  'slide_back', 'slide', 'pistol_mag_out', 'pistol_mag_insert', 'pistol_mag_in',
  'bolt_up', 'bolt', 'bolt_fwd', 'sniper_charge_fwd', 'round_in', 'pouch', 'dry_fire', 'holster', 'raise', 'stow',
  'pickup_ammo', 'pickup_weapon', 'hitmarker', 'hitmarker_head', 'hit_kill', 'amb_wind',
] as const;
/** Sounds with numbered variants (`<name>_0.wav` ...); one is picked at random, never twice in a row. */
const VARIANTS = {
  m4_shot: 4, m4_tail: 2, m4_far: 2, pistol_shot: 4, pistol_tail: 2, pistol_far: 2,
  sniper_shot: 3, sniper_tail: 2, sniper_far: 2, explosion: 2, explosion_far: 1,
  footstep_dirt: 6, footstep_hard: 6, casing_hard: 3, casing_dirt: 3,
  impact_hard: 3, impact_dirt: 3, ricochet: 3, whiz: 4, flesh: 3, hurt: 2,
  cloth: 3, grip: 2, rattle: 3, ads: 2,
} as const;
export type SampleName = (typeof SAMPLE_NAMES)[number] | keyof typeof VARIANTS;
export type Surface = 'dirt' | 'hard';
const FILES: string[] = [
  ...SAMPLE_NAMES,
  ...Object.entries(VARIANTS).flatMap(([n, k]) => Array.from({ length: k }, (_, i) => `${n}_${i}`)),
];

/** The layers that go with a gun's close report: the wall slap-back and the across-the-map boom. */
const GUN_LAYERS: Partial<Record<SampleName, { tail: SampleName; far: SampleName }>> = {
  m4_shot: { tail: 'm4_tail', far: 'm4_far' },
  pistol_shot: { tail: 'pistol_tail', far: 'pistol_far' },
  sniper_shot: { tail: 'sniper_tail', far: 'sniper_far' },
};

/**
 * The mix. The files are all written near full scale; this is how loud each one is, multiplied
 * with whatever gain the caller passes. The reference is the player's own gunshot (~0.8): handling
 * clacks sit at about half of it, cloth and gear well under that, UI ticks quieter still.
 */
const MIX: Partial<Record<SampleName, number>> = {
  mag_release: 0.3, mag_out: 0.5, mag_insert: 0.4, mag_in: 0.65, bolt_release: 0.45,
  charge_back: 0.6, charge_fwd: 0.75, slide_back: 0.5, slide: 0.7,
  pistol_mag_out: 0.45, pistol_mag_insert: 0.35, pistol_mag_in: 0.6,
  bolt_up: 0.5, bolt: 0.6, bolt_fwd: 0.6, sniper_charge_fwd: 0.65, round_in: 0.5,
  pouch: 0.28, cloth: 0.22, grip: 0.35, rattle: 0.3, ads: 0.22, holster: 0.45, raise: 0.4, stow: 0.35,
  dry_fire: 0.7, pickup_ammo: 0.5, pickup_weapon: 0.5,
  hitmarker: 0.3, hitmarker_head: 0.3, hit_kill: 0.3, amb_wind: 0.12,
};

const SPEED_OF_SOUND = 343;
/** Cutoff of the master low-pass when nothing is muffling the world. */
const OPEN = 18000;

export interface PlayOptions {
  pos?: THREE.Vector3;
  gain?: number;
  rate?: number;
  delay?: number;
  /** Reverb send (defaults to more for positional sounds). */
  wet?: number;
  /** Distance at which a positional sound starts to fall off; loud sources carry further. */
  ref?: number;
  rolloff?: number;
  pan?: PanningModelType;
  /** Random pitch spread around `rate` (default 0.04). */
  jitter?: number;
  /** Interface feedback: straight to the output, untouched by reverb or muffling. */
  ui?: boolean;
}

let rawSamples: Promise<Map<string, ArrayBuffer>> | null = null;

/** Fetch the sound files (no AudioContext needed yet, so this can run during loading). */
export function preloadSamples(): Promise<Map<string, ArrayBuffer>> {
  rawSamples ??= Promise.all(FILES.map(async (n): Promise<[string, ArrayBuffer] | null> => {
    try {
      const r = await fetch(`${import.meta.env.BASE_URL}assets/audio/${n}.wav`);
      return r.ok ? [n, await r.arrayBuffer()] : null;
    } catch {
      return null;
    }
  })).then((list) => new Map(list.filter((x): x is [string, ArrayBuffer] => x !== null)));
  return rawSamples;
}

/** Gain of an inverse-distance panner at `d` metres (what PannerNode applies for the dry path). */
function falloff(d: number, ref: number, rolloff: number): number {
  return ref / (ref + rolloff * (Math.max(d, ref) - ref));
}

/**
 * Sound: synthesized samples (scripts/make_sounds.py) plus a few procedural fallbacks.
 * Positional sounds are HRTF-panned, attenuated and muffled with distance, and sent to a
 * convolution reverb that models the walled compound (slap-back off the walls + tail).
 *
 * Routing: world sounds -> bus -> muffle (low-pass that closes when the player is badly hurt or
 * concussed) -> master (volume) -> limiter -> output. UI sounds join at the master.
 */
export class Audio {
  readonly ctx: AudioContext;
  private master: GainNode;
  private bus: GainNode;
  private muffle: BiquadFilterNode;
  private noise: AudioBuffer;
  private listenerPos = new THREE.Vector3();
  private samples = new Map<string, AudioBuffer>();
  private lastVariant = new Map<string, number>();
  private reverb: ConvolverNode;
  private wetBus: GainNode;
  /** Where the muffle rests (set by health), what it was last sent to, and when a concussion ends. */
  private restCut = OPEN;
  private appliedCut = OPEN;
  private concussedUntil = 0;

  constructor(volume: number) {
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = volume;
    // A limiter, not a leveller: it only catches the peaks of stacked gunfire, and lets go fast
    // enough (well inside the 80 ms between automatic shots) that the mix doesn't pump.
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -6;
    comp.knee.value = 4;
    comp.ratio.value = 12;
    comp.attack.value = 0.002;
    comp.release.value = 0.09;
    // The node adds its own make-up gain (~3 dB at these settings); take some of it back as headroom
    const post = this.ctx.createGain();
    post.gain.value = 0.85;
    this.master.connect(comp).connect(post).connect(this.ctx.destination);
    this.bus = this.ctx.createGain();
    this.muffle = this.ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.Q.value = 0.5;
    this.muffle.frequency.value = OPEN;
    this.bus.connect(this.muffle).connect(this.master);
    this.reverb = this.ctx.createConvolver();
    this.reverb.buffer = this.impulse(1.8);
    this.wetBus = this.ctx.createGain();
    this.wetBus.gain.value = 0.9;
    this.wetBus.connect(this.reverb).connect(this.bus);

    const len = this.ctx.sampleRate * 1.5;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    void preloadSamples().then((raw) => {
      for (const [n, buf] of raw) {
        this.ctx.decodeAudioData(buf.slice(0)).then((b) => {
          this.samples.set(n, b);
          if (n === 'amb_wind') this.startAmbience(b);
        }).catch(() => {});
      }
    });
  }

  has(name: SampleName): boolean {
    return this.samples.has(name) || this.samples.has(`${name}_0`);
  }

  /**
   * Play a sample. Positional sounds are panned, and far ones lose their highs
   * (distant gunfire is a dull thump, not a crack).
   */
  play(name: SampleName, opts: PlayOptions = {}): boolean {
    let file: string = name;
    const k = (VARIANTS as Record<string, number>)[name];
    if (k) {
      let i = Math.floor(Math.random() * k);
      if (i === this.lastVariant.get(name)) i = (i + 1) % k;
      this.lastVariant.set(name, i);
      file = `${name}_${i}`;
    }
    const buf = this.samples.get(file);
    if (!buf) return false;
    const t = this.ctx.currentTime + (opts.delay ?? 0);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const jitter = opts.jitter ?? 0.04;
    src.playbackRate.value = (opts.rate ?? 1) * (1 + (Math.random() * 2 - 1) * jitter);
    const g = this.ctx.createGain();
    g.gain.value = (opts.gain ?? 1) * (MIX[name] ?? 1);
    let node: AudioNode = src.connect(g);
    if (opts.pos) {
      const d = opts.pos.distanceTo(this.listenerPos);
      if (d > 12) {
        const lp = this.ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = THREE.MathUtils.clamp(14000 / (d / 12) ** 1.4, 500, 14000);
        node = node.connect(lp);
      }
    }
    node.connect(opts.ui ? this.master : this.out(opts));
    src.start(t);
    return true;
  }

  /**
   * A weapon-handling sound named by a timeline event. A gun's own version of it
   * (`pistol_mag_in`, `sniper_charge_fwd`) wins over the shared one.
   */
  foley(event: string, weapon?: string): boolean {
    const own = `${weapon}_${event}`;
    return this.play((this.samples.has(own) ? own : event) as SampleName, { wet: 0.05 });
  }

  /** Sleeve and stock as the sights come up or drop (the same rustle, slower on the way down). */
  ads(up: boolean): void {
    this.play('ads', { rate: up ? 1.08 : 0.9, wet: 0 });
  }

  resume(): void {
    if (this.ctx.state !== 'running') void this.ctx.resume();
  }

  setVolume(v: number): void {
    this.master.gain.value = v;
  }

  /** Below about a third health the world closes in: the highs roll off, down to ~1.8 kHz near death. */
  setHealth(frac: number): void {
    this.restCut = OPEN * (1800 / OPEN) ** THREE.MathUtils.clamp(1 - frac / 0.35, 0, 1);
    const t = this.ctx.currentTime;
    if (t < this.concussedUntil || Math.abs(this.restCut - this.appliedCut) < 1) return;
    this.appliedCut = this.restCut;
    this.muffle.frequency.setTargetAtTime(this.restCut, t, 0.25);
  }

  /** A blast close by (strength 0..1): hearing shuts down to a dull rumble, then opens back up. */
  concuss(strength: number): void {
    const s = THREE.MathUtils.clamp(strength, 0, 1);
    if (s < 0.05) return;
    const t = this.ctx.currentTime;
    const hold = 0.3 + s;
    const recover = 0.4 + s;
    const f = this.muffle.frequency;
    f.cancelScheduledValues(t);
    // Targets, not jumps: stepping a filter's cutoff clicks
    f.setTargetAtTime(THREE.MathUtils.lerp(4000, 450, s), t, 0.015);
    f.setTargetAtTime(this.restCut, t + hold, recover);
    this.appliedCut = this.restCut;
    this.concussedUntil = t + hold + recover * 3;
  }

  /** The outdoor bed: a quiet wind loop under everything. */
  private startAmbience(buf: AudioBuffer): void {
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, this.ctx.currentTime);
    g.gain.linearRampToValueAtTime(MIX.amb_wind ?? 0.1, this.ctx.currentTime + 3);
    src.connect(g).connect(this.bus);
    src.start();
  }

  updateListener(cam: THREE.Camera): void {
    cam.getWorldPosition(this.listenerPos);
    const l = this.ctx.listener;
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const u = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    const t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setValueAtTime(this.listenerPos.x, t);
      l.positionY.setValueAtTime(this.listenerPos.y, t);
      l.positionZ.setValueAtTime(this.listenerPos.z, t);
      l.forwardX.setValueAtTime(f.x, t);
      l.forwardY.setValueAtTime(f.y, t);
      l.forwardZ.setValueAtTime(f.z, t);
      l.upX.setValueAtTime(u.x, t);
      l.upY.setValueAtTime(u.y, t);
      l.upZ.setValueAtTime(u.z, t);
    }
  }

  /**
   * Stereo impulse response of the compound: discrete echoes off the walls (the yard is 80 m
   * across, so round trips of 20-250 m), each one later, quieter, duller and more smeared, over
   * a faint diffuse tail. Left and right get their own echo times so the slap-back has width.
   */
  private impulse(seconds: number): AudioBuffer {
    const sr = this.ctx.sampleRate;
    const len = Math.floor(sr * seconds);
    const buf = this.ctx.createBuffer(2, len, sr);
    const walls = [[0.065, 1], [0.105, 0.8], [0.16, 0.62], [0.23, 0.5], [0.31, 0.38], [0.42, 0.27], [0.56, 0.17], [0.72, 0.1]];
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        d[i] = (Math.random() * 2 - 1) * Math.exp(-t * 3.2) * 0.1 * Math.min(1, t / 0.05);
      }
      for (const [at, g] of walls) {
        const j = Math.floor(at * (0.9 + Math.random() * 0.2) * sr);
        // A far wall is a rough, wide reflector: its echo is a burst, not a click
        const n = Math.floor((0.004 + at * 0.05) * sr);
        const gain = g * (0.75 + Math.random() * 0.45) / Math.sqrt(n / 200);
        for (let k = 0; k < n && j + k < len; k++) d[j + k] += (Math.random() * 2 - 1) * gain * Math.exp(-3 * k / n);
      }
      // One-pole low-pass that closes with time: air and rough walls eat the highs of late echoes
      let y = 0;
      for (let i = 0; i < len; i++) {
        const a = 0.4 - 0.32 * Math.min(1, i / (sr * 0.7));
        y += a * (d[i] - y);
        d[i] = y;
      }
    }
    return buf;
  }

  private out(o: PlayOptions = {}): AudioNode {
    const { pos } = o;
    const ref = o.ref ?? 3;
    const rolloff = o.rolloff ?? 1.1;
    let send = o.wet ?? (pos ? 0.35 : 0.1);
    // The send is taken before the panner, so fade it with distance too, only more slowly:
    // far sounds get wetter, not louder than near ones
    if (pos) send *= falloff(pos.distanceTo(this.listenerPos), ref, rolloff) ** 0.6;
    const dry = pos ? this.panner(pos, ref, rolloff, o.pan ?? 'HRTF') : this.bus;
    if (send <= 0) return dry;
    // Split to the dry path and the reverb send
    const split = this.ctx.createGain();
    const s = this.ctx.createGain();
    s.gain.value = send;
    split.connect(s).connect(this.wetBus);
    split.connect(dry);
    return split;
  }

  private panner(pos: THREE.Vector3, ref: number, rolloff: number, model: PanningModelType): AudioNode {
    const p = this.ctx.createPanner();
    p.panningModel = model;
    p.distanceModel = 'inverse';
    p.refDistance = ref;
    p.rolloffFactor = rolloff;
    p.positionX.value = pos.x;
    p.positionY.value = pos.y;
    p.positionZ.value = pos.z;
    p.connect(this.bus);
    return p;
  }

  private noiseBurst(dest: AudioNode, t: number, dur: number, gain: number, f0: number, f1: number, q = 0.7): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.Q.value = q;
    filt.frequency.setValueAtTime(f0, t);
    filt.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filt).connect(g).connect(dest);
    src.start(t, Math.random() * 0.5, dur + 0.05);
  }

  private thump(dest: AudioNode, t: number, freq: number, dur: number, gain: number): void {
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.35, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /**
   * Gunshot. `power` ~1 for pistol, ~1.7 for the sniper rifle. The player's own shot (no `pos`)
   * is the dry report plus the stereo slap-back off the walls. Anyone else's is positional: it
   * arrives late by distance / speed of sound, and with distance the close report gives way to
   * the far layer (boom and echoes, no crack) instead of just getting quieter.
   */
  gunshot(power: number, pos?: THREE.Vector3, sample?: SampleName): void {
    const level = Math.min(1, 0.5 + 0.25 * power);
    const layers = sample && GUN_LAYERS[sample];
    if (sample && !pos && this.play(sample, { gain: level, wet: 0.1, jitter: 0.025 })) {
      if (layers) this.play(layers.tail, { gain: level * 0.38, wet: 0, jitter: 0.06 });
      return;
    }
    if (sample && pos && this.has(sample)) {
      const d = pos.distanceTo(this.listenerPos);
      const delay = Math.min(0.6, d / SPEED_OF_SOUND);
      const x = layers ? THREE.MathUtils.smoothstep(d, 12, 55) : 0;
      const near = Math.cos(x * Math.PI / 2);
      const far = Math.sin(x * Math.PI / 2);
      if (near > 0.05) this.play(sample, { pos, gain: level * 1.2 * near, wet: 0.5, delay, ref: 6, jitter: 0.03 });
      // Low and diffuse: cheap equal-power panning is enough, and it carries much further
      if (layers && far > 0.05) {
        this.play(layers.far, { pos, gain: level * 1.3 * far, wet: 0.3, delay, ref: 12, rolloff: 0.8, pan: 'equalpower', jitter: 0.06 });
      }
      return;
    }
    const t = this.ctx.currentTime;
    const dest = this.out({ pos });
    this.noiseBurst(dest, t, 0.09 * power, 1.2, 9000, 1200, 1.2); // crack
    this.noiseBurst(dest, t, 0.45 * power, 0.7, 2500, 120); // body / room tail
    this.thump(dest, t, 110 + 30 / power, 0.18 * power, 0.9);
    // Distant echo off the compound walls
    this.noiseBurst(dest, t + 0.11, 0.6 * power, 0.12, 900, 80);
  }

  click(pos?: THREE.Vector3, pitch = 1): void {
    const t = this.ctx.currentTime;
    const dest = this.out({ pos });
    const o = this.ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(1800 * pitch, t);
    o.frequency.exponentialRampToValueAtTime(400 * pitch, t + 0.03);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + 0.06);
    this.noiseBurst(dest, t, 0.04, 0.25, 6000, 2000);
  }

  /** Hit confirm: a dry tick, higher for a headshot, with a low knock under it on a kill. */
  hitMarker(headshot: boolean, killed = false): void {
    if (killed) this.play('hit_kill', { ui: true, jitter: 0.02 });
    if (this.play(headshot ? 'hitmarker_head' : 'hitmarker', { ui: true, jitter: 0.02 })) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = headshot ? 1650 : 1100;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.08);
  }

  /** Bullet into the world: a thud and soil on dirt, a crack and chips on anything hard (which sometimes sends it whining off). */
  impact(pos: THREE.Vector3, surface: Surface = 'hard'): void {
    if (this.play(surface === 'dirt' ? 'impact_dirt' : 'impact_hard', { pos, gain: 0.8, ref: 4, jitter: 0.08 })) {
      if (surface === 'hard' && Math.random() < 0.2) this.play('ricochet', { pos, gain: 0.6, ref: 4, rate: 0.85 + Math.random() * 0.3 });
      return;
    }
    this.noiseBurst(this.out({ pos }), this.ctx.currentTime, 0.07, 0.35, 5000, 600, 2);
  }

  flesh(pos: THREE.Vector3): void {
    if (this.play('flesh', { pos, gain: 0.9, jitter: 0.08 })) return;
    const t = this.ctx.currentTime;
    const dest = this.out({ pos });
    this.noiseBurst(dest, t, 0.08, 0.5, 1400, 200);
    this.thump(dest, t, 90, 0.08, 0.4);
  }

  /** Footstep on a surface (falls back to a noise burst before samples load). */
  step(surface: Surface, pos?: THREE.Vector3, loud = 1): void {
    const ok = this.play(surface === 'dirt' ? 'footstep_dirt' : 'footstep_hard', {
      pos, gain: loud, rate: 0.92 + Math.random() * 0.16, wet: pos ? 0.2 : 0.05,
    });
    if (!ok) this.footstep(pos, loud);
  }

  footstep(pos?: THREE.Vector3, loud = 1): void {
    const t = this.ctx.currentTime;
    this.noiseBurst(this.out({ pos }), t, 0.09, 0.22 * loud, 1600, 150, 1.5);
  }

  /** The player taking a hit. Joins at the master so it stays clear when everything else is muffled. */
  hurt(): void {
    if (this.play('hurt', { gain: 0.75, ui: true })) return;
    const t = this.ctx.currentTime;
    this.thump(this.master, t, 70, 0.25, 0.8);
    this.noiseBurst(this.master, t, 0.15, 0.3, 800, 100);
  }

  bulletWhiz(pos: THREE.Vector3): void {
    if (this.play('whiz', { pos, gain: 0.8, rate: 0.9 + Math.random() * 0.3 })) return;
    const t = this.ctx.currentTime;
    const dest = this.out({ pos });
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 6;
    bp.frequency.setValueAtTime(3500, t);
    bp.frequency.exponentialRampToValueAtTime(900, t + 0.18);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.4, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    src.connect(bp).connect(g).connect(dest);
    src.start(t, Math.random(), 0.25);
  }

  /**
   * Grenade blast. Like gunfire it arrives late and changes with distance: up close a crack,
   * blast and falling debris, from far off mostly the boom rolling round the walls. The far
   * layer always plays underneath, as the low end of the close one.
   */
  explosion(pos: THREE.Vector3): void {
    if (this.has('explosion')) {
      const d = pos.distanceTo(this.listenerPos);
      const delay = Math.min(0.6, d / SPEED_OF_SOUND);
      const x = THREE.MathUtils.smoothstep(d, 20, 70);
      const near = Math.cos(x * Math.PI / 2);
      if (near > 0.05) this.play('explosion', { pos, gain: 1.3 * near, wet: 0.5, delay, ref: 10, jitter: 0.06 });
      this.play('explosion_far', { pos, gain: 1.3 * Math.max(0.4, Math.sin(x * Math.PI / 2)), wet: 0.3, delay, ref: 16, rolloff: 0.7, pan: 'equalpower', jitter: 0.08 });
      return;
    }
    const t = this.ctx.currentTime;
    const dest = this.out({ pos });
    this.noiseBurst(dest, t, 0.12, 1.6, 7000, 900, 1);
    this.noiseBurst(dest, t, 1.6, 1.4, 1800, 40);
    this.thump(dest, t, 70, 0.9, 1.6);
    this.noiseBurst(dest, t + 0.2, 1.8, 0.25, 500, 40);
  }

  /** Metallic tink of a grenade or magazine hitting the ground. */
  clink(pos: THREE.Vector3, pitch = 1): void {
    const t = this.ctx.currentTime;
    const dest = this.out({ pos });
    for (const f of [2300, 3450]) {
      const o = this.ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f * pitch * (0.95 + Math.random() * 0.1);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.12, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      o.connect(g).connect(dest);
      o.start(t);
      o.stop(t + 0.13);
    }
    this.noiseBurst(dest, t, 0.04, 0.2, 5000, 1500);
  }

  waveHorn(): void {
    const t = this.ctx.currentTime;
    for (const f of [110, 165]) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 600;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.2);
      g.gain.setValueAtTime(0.12, t + 1.0);
      g.gain.exponentialRampToValueAtTime(0.001, t + 1.6);
      o.connect(lp).connect(g).connect(this.master);
      o.start(t);
      o.stop(t + 1.7);
    }
  }
}
