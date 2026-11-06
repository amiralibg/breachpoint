import * as THREE from 'three';

/**
 * Procedural sound effects using the Web Audio API (no audio files needed).
 * Positional sounds are panned and attenuated relative to the listener.
 */
export class Audio {
  readonly ctx: AudioContext;
  private master: GainNode;
  private noise: AudioBuffer;
  private listenerPos = new THREE.Vector3();

  constructor(volume: number) {
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = volume;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(this.ctx.destination);

    const len = this.ctx.sampleRate * 1.5;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
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

  private out(pos?: THREE.Vector3): AudioNode {
    if (!pos) return this.master;
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
  gunshot(power: number, pos?: THREE.Vector3): void {
    const t = this.ctx.currentTime;
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
