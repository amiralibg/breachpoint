import * as THREE from 'three';

const SAMPLE_NAMES = [
  'm4_shot', 'pistol_shot', 'sniper_shot', 'mag_out', 'mag_in', 'mag_drop', 'charge_back', 'charge_fwd',
  'bolt', 'slide', 'round_in', 'dry_fire', 'holster', 'whiz', 'impact', 'flesh', 'hitmarker',
] as const;
/** Sounds with numbered variants (`<name>_0.wav` ...); one is picked at random, never twice in a row. */
const VARIANTS = { footstep_dirt: 6, footstep_hard: 6, casing: 3 } as const;
export type SampleName = (typeof SAMPLE_NAMES)[number] | keyof typeof VARIANTS;
const FILES: string[] = [
  ...SAMPLE_NAMES,
  ...Object.entries(VARIANTS).flatMap(([n, k]) => Array.from({ length: k }, (_, i) => `${n}_${i}`)),
];

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

/**
 * Sound: recorded/synthesized samples (scripts/make_sounds.py) plus a few procedural effects.
 * Positional sounds are HRTF-panned, attenuated and muffled with distance, and sent to a
 * convolution reverb that models the walled compound (early slap-back off the walls + tail).
 */
export class Audio {
  readonly ctx: AudioContext;
  private master: GainNode;
  private noise: AudioBuffer;
  private listenerPos = new THREE.Vector3();
  private samples = new Map<string, AudioBuffer>();
  private lastVariant = new Map<string, number>();
  private reverb: ConvolverNode;
  private wetBus: GainNode;

  constructor(volume: number) {
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = volume;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(this.ctx.destination);
    this.reverb = this.ctx.createConvolver();
    this.reverb.buffer = this.impulse(1.8);
    this.wetBus = this.ctx.createGain();
    this.wetBus.gain.value = 0.9;
    this.wetBus.connect(this.reverb).connect(this.master);

    const len = this.ctx.sampleRate * 1.5;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    void preloadSamples().then((raw) => {
      for (const [n, buf] of raw) {
        this.ctx.decodeAudioData(buf.slice(0)).then((b) => this.samples.set(n, b)).catch(() => {});
      }
    });
  }

  has(name: SampleName): boolean {
    return this.samples.has(name);
  }

  /**
   * Play a recorded sound. Positional sounds are panned, and far ones lose their highs
   * (distant gunfire is a dull thump, not a crack).
   */
  play(name: SampleName, opts: { pos?: THREE.Vector3; gain?: number; rate?: number; delay?: number; wet?: number } = {}): boolean {
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
    src.playbackRate.value = (opts.rate ?? 1) * (0.96 + Math.random() * 0.08);
    const g = this.ctx.createGain();
    g.gain.value = opts.gain ?? 1;
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
    node.connect(this.out(opts.pos, opts.wet));
    src.start(t);
    return true;
  }

  resume(): void {
    if (this.ctx.state !== 'running') void this.ctx.resume();
  }

  setVolume(v: number): void {
    this.master.gain.value = v;
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

  /** Stereo impulse response: sparse early reflections (compound walls) and a diffuse tail. */
  private impulse(seconds: number): AudioBuffer {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(2, len, this.ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / this.ctx.sampleRate;
        // Diffuse tail, darker as it decays
        d[i] = (Math.random() * 2 - 1) * Math.exp(-t * 3.2) * 0.35 * (t < 0.02 ? t / 0.02 : 1);
      }
      for (const [at, g] of [[0.045, 0.6], [0.09, 0.45], [0.14, 0.3], [0.21, 0.22], [0.3, 0.12]]) {
        const j = Math.floor((at + (c ? 0.007 : 0)) * this.ctx.sampleRate);
        for (let k = 0; k < 90; k++) d[j + k] += (Math.random() * 2 - 1) * g * Math.exp(-k / 25);
      }
      // One-pole low-pass so the tail isn't hissy
      let y = 0;
      for (let i = 0; i < len; i++) {
        const a = 0.35 - 0.25 * Math.min(1, i / len * 2);
        y += a * (d[i] - y);
        d[i] = y;
      }
    }
    return buf;
  }

  private out(pos?: THREE.Vector3, wet?: number): AudioNode {
    const send = wet ?? (pos ? 0.35 : 0.1);
    if (send > 0) {
      // Split to the dry path and the reverb send
      const split = this.ctx.createGain();
      const s = this.ctx.createGain();
      s.gain.value = send;
      split.connect(s).connect(this.wetBus);
      split.connect(pos ? this.panner(pos) : this.master);
      return split;
    }
    if (!pos) return this.master;
    return this.panner(pos);
  }

  private panner(pos: THREE.Vector3): AudioNode {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 3;
    p.rolloffFactor = 1.1;
    p.positionX.value = pos.x;
    p.positionY.value = pos.y;
    p.positionZ.value = pos.z;
    p.connect(this.master);
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

  /** Gunshot. `power` ~1 for pistol, ~1.6 for rifle. */
  gunshot(power: number, pos?: THREE.Vector3, sample?: SampleName): void {
    const t = this.ctx.currentTime;
    if (sample && this.play(sample, { pos, gain: pos ? 1.1 : 0.85, wet: pos ? 0.55 : 0.4 })) return;
    const dest = this.out(pos);
    this.noiseBurst(dest, t, 0.09 * power, 1.2, 9000, 1200, 1.2); // crack
    this.noiseBurst(dest, t, 0.45 * power, 0.7, 2500, 120); // body / room tail
    this.thump(dest, t, 110 + 30 / power, 0.18 * power, 0.9);
    // Distant echo off the compound walls
    this.noiseBurst(dest, t + 0.11, 0.6 * power, 0.12, 900, 80);
  }

  click(pos?: THREE.Vector3, pitch = 1): void {
    const t = this.ctx.currentTime;
    const dest = this.out(pos);
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

  hitMarker(headshot: boolean): void {
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

  impact(pos: THREE.Vector3): void {
    const t = this.ctx.currentTime;
    this.noiseBurst(this.out(pos), t, 0.07, 0.35, 5000, 600, 2);
  }

  flesh(pos: THREE.Vector3): void {
    const t = this.ctx.currentTime;
    const dest = this.out(pos);
    this.noiseBurst(dest, t, 0.08, 0.5, 1400, 200);
    this.thump(dest, t, 90, 0.08, 0.4);
  }

  /** Footstep on a surface (falls back to a noise burst before samples load). */
  step(surface: 'dirt' | 'hard', pos?: THREE.Vector3, loud = 1): void {
    const ok = this.play(surface === 'dirt' ? 'footstep_dirt' : 'footstep_hard', {
      pos, gain: loud, rate: 0.92 + Math.random() * 0.16, wet: pos ? 0.2 : 0.05,
    });
    if (!ok) this.footstep(pos, loud);
  }

  footstep(pos?: THREE.Vector3, loud = 1): void {
    const t = this.ctx.currentTime;
    this.noiseBurst(this.out(pos), t, 0.09, 0.22 * loud, 1600, 150, 1.5);
  }

  hurt(): void {
    const t = this.ctx.currentTime;
    this.thump(this.master, t, 70, 0.25, 0.8);
    this.noiseBurst(this.master, t, 0.15, 0.3, 800, 100);
  }

  bulletWhiz(pos: THREE.Vector3): void {
    if (this.play('whiz', { pos, gain: 0.8, rate: 0.9 + Math.random() * 0.3 })) return;
    const t = this.ctx.currentTime;
    const dest = this.out(pos);
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

  /** Grenade blast: low boom, crack and a long rumble. */
  explosion(pos: THREE.Vector3): void {
    const t = this.ctx.currentTime;
    const dest = this.out(pos);
    this.noiseBurst(dest, t, 0.12, 1.6, 7000, 900, 1);
    this.noiseBurst(dest, t, 1.6, 1.4, 1800, 40);
    this.thump(dest, t, 70, 0.9, 1.6);
    this.noiseBurst(dest, t + 0.2, 1.8, 0.25, 500, 40);
  }

  /** Metallic tink of a grenade or magazine hitting the ground. */
  clink(pos: THREE.Vector3, pitch = 1): void {
    const t = this.ctx.currentTime;
    const dest = this.out(pos);
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
