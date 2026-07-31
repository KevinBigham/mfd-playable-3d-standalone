/**
 * GRIDIRON OVERDRIVE — procedural crowd bed.
 *
 * Three parts:
 *   1. A continuous stereo pink-noise bed, filtered by energy, breathed on by two
 *      slow LFOs so it never sits still.
 *   2. A roar layer that only opens up as energy climbs (energy^2), which is what
 *      makes a swell feel like people standing up rather than a fader move.
 *   3. A sparse individual-voice layer — short filtered shouts scheduled at a rate
 *      proportional to energy, so a quiet stadium is genuinely quiet.
 *
 * Idle cost: when stopped, zero nodes and zero timers. When running quiet, one
 * 220 ms timer that early-outs without allocating anything.
 */

import { clamp, clamp01 } from '../core/math.ts';
import type { TeamSide } from '../core/types.ts';
import { AudioEngine, type VoiceSlot } from './engine.ts';
import { noiseBurst, tone, grit, rnd } from './synth.ts';

const TICK_MS = 220;
const MAX_CROWD_VOICES = 6;
/** Energy below which the individual-voice layer sleeps entirely. */
const QUIET_FLOOR = 0.06;

interface Bed {
  out: GainNode;
  srcA: AudioBufferSourceNode;
  srcB: AudioBufferSourceNode;
  lpA: BiquadFilterNode;
  lpB: BiquadFilterNode;
  bedGain: GainNode;
  roarFilter: BiquadFilterNode;
  roarGain: GainNode;
  lfo1: OscillatorNode;
  lfo1Gain: GainNode;
  lfo2: OscillatorNode;
  lfo2Gain: GainNode;
  panL: StereoPannerNode;
  panR: StereoPannerNode;
}

interface Chant {
  osc: OscillatorNode;
  depth: GainNode;
  gain: GainNode;
  filter: BiquadFilterNode;
  src: AudioBufferSourceNode;
}

export class CrowdBed {
  private engine: AudioEngine;
  private bed: Bed | null = null;
  private chantNodes: Chant | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  private running = false;
  private enabled = true;
  private disposed = false;

  /** Steady-state excitement, 0..1. */
  private energy = 0.22;
  /** Transient boost that decays back into `energy`. */
  private swellAmt = 0;
  private swellTau = 1.2;
  /** Short-lived suppression (a gasp, or the crowd that just lost the ball). */
  private dip = 0;
  /** Fraction of the stadium pulling for HOME. 0.5 = neutral site. */
  private homeBias = 0.78;

  private activeVoices = 0;
  private lastTick = 0;

  constructor(engine: AudioEngine) {
    this.engine = engine;
    this.engine.onReady(() => { if (this.running) this.build(); });
  }

  // ── lifecycle ───────────────────────────────────────────────────────────

  start(): void {
    if (this.disposed || this.running) return;
    this.running = true;
    this.build();
    this.startTimer();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.stopTimer();
    this.teardown();
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) { this.swellAmt = 0; this.applyLevels(0.2); }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.running = false;
    this.stopTimer();
    this.teardown();
  }

  private startTimer(): void {
    if (this.timer !== null) return;
    this.lastTick = this.engine.now;
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  private stopTimer(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  private build(): void {
    if (this.bed || this.disposed) return;
    const ctx = this.engine.context;
    const bus = this.engine.busInput('crowd');
    if (!ctx || !bus) return;
    const white = this.engine.noise('pink');
    if (!white) return;
    const t = ctx.currentTime;

    const out = ctx.createGain();
    out.gain.value = 1;
    out.connect(bus);

    const mk = (rate: number, pan: number): { src: AudioBufferSourceNode; lp: BiquadFilterNode; p: StereoPannerNode } => {
      const src = ctx.createBufferSource();
      src.buffer = white;
      src.loop = true;
      src.playbackRate.value = rate;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 900;
      lp.Q.value = 0.4;
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      src.connect(lp); lp.connect(p);
      return { src, lp, p };
    };

    const a = mk(1, -0.55);
    const b = mk(0.83, 0.55);

    const bedGain = ctx.createGain();
    bedGain.gain.value = 0.06;
    a.p.connect(bedGain);
    b.p.connect(bedGain);
    bedGain.connect(out);

    // Roar: a narrower, brighter band that only shows up when the place is loud.
    const roarFilter = ctx.createBiquadFilter();
    roarFilter.type = 'bandpass';
    roarFilter.frequency.value = 1000;
    roarFilter.Q.value = 0.75;
    const roarGain = ctx.createGain();
    roarGain.gain.value = 0.0;
    a.lp.connect(roarFilter);
    roarFilter.connect(roarGain);
    roarGain.connect(out);

    // Breathing.
    const lfo1 = ctx.createOscillator();
    lfo1.frequency.value = 0.085;
    const lfo1Gain = ctx.createGain();
    lfo1Gain.gain.value = 0.014;
    lfo1.connect(lfo1Gain);
    lfo1Gain.connect(bedGain.gain);

    const lfo2 = ctx.createOscillator();
    lfo2.frequency.value = 0.037;
    lfo2.type = 'triangle';
    const lfo2Gain = ctx.createGain();
    lfo2Gain.gain.value = 0.02;
    lfo2.connect(lfo2Gain);
    lfo2Gain.connect(roarGain.gain);

    try { lfo1.start(t); lfo2.start(t); a.src.start(t, Math.random() * 1.8); b.src.start(t, Math.random() * 1.8); } catch { /* ignore */ }

    this.bed = {
      out, srcA: a.src, srcB: b.src, lpA: a.lp, lpB: b.lp, bedGain,
      roarFilter, roarGain, lfo1, lfo1Gain, lfo2, lfo2Gain, panL: a.p, panR: b.p,
    };
    this.applyLevels(0.35);
  }

  private teardown(): void {
    this.stopChant();
    const bed = this.bed;
    this.bed = null;
    if (!bed) return;
    const stop = (n: AudioScheduledSourceNode): void => { try { n.stop(); } catch { /* ignore */ } };
    stop(bed.srcA); stop(bed.srcB); stop(bed.lfo1); stop(bed.lfo2);
    const nodes: AudioNode[] = [
      bed.srcA, bed.srcB, bed.lpA, bed.lpB, bed.panL, bed.panR,
      bed.bedGain, bed.roarFilter, bed.roarGain, bed.lfo1, bed.lfo1Gain, bed.lfo2, bed.lfo2Gain, bed.out,
    ];
    for (const n of nodes) { try { n.disconnect(); } catch { /* ignore */ } }
  }

  // ── control ─────────────────────────────────────────────────────────────

  /** Steady excitement. Ramped, never stepped. */
  setEnergy(v: number, ms = 700): void {
    this.energy = clamp01(v);
    this.applyLevels(Math.max(0.05, ms / 1000 / 3));
  }

  getEnergy(): number { return clamp01(this.energy + this.swellAmt - this.dip); }

  /** Punch the crowd up and let it settle. `power` 0..1.5, `ms` sets the decay. */
  swell(power: number, ms = 1400): void {
    if (!this.enabled) return;
    const p = clamp(power, 0, 1.5);
    this.swellAmt = clamp(Math.max(this.swellAmt, p * 0.85), 0, 1.1);
    this.swellTau = clamp(ms / 1000 / 2.2, 0.25, 6);
    this.dip = 0;
    this.applyLevels(0.09);
    const bursts = 2 + Math.round(p * 4);
    for (let i = 0; i < bursts; i++) this.individual(rnd(0, 0.28), 0.7 + p * 0.5);
  }

  /** Reaction weighted by who the building supports. Losing crowds boo instead. */
  swellFor(side: TeamSide | -1, power: number, ms = 1500): void {
    if (side === -1) { this.swell(power * 0.7, ms); return; }
    const support = side === 0 ? this.homeBias : 1 - this.homeBias;
    if (support >= 0.5) this.swell(power * (0.55 + support * 0.75), ms);
    else {
      this.boo(power * (0.55 + (1 - support) * 0.6));
      this.swell(power * support * 0.5, ms * 0.6);
    }
  }

  /** Low disapproval roar. */
  boo(power = 1): void {
    if (!this.enabled) return;
    const p = clamp(power, 0.15, 1.4);
    const v = this.voice(1.9, 0.0, 0.5 + p * 0.4);
    if (v) {
      const t0 = v.t0;
      let end = noiseBurst(v.ctx, v.dest, {
        t0, dur: 1.5 + p * 0.5, level: 0.5 * p, kind: 'pink', filter: 'bandpass',
        freq: rnd(230, 300), freqEnd: rnd(150, 190), q: 1.5, arch: true, track: (n) => v.track(n),
      });
      const g = grit(v.ctx, v.dest, {
        t0: t0 + 0.05, dur: 1.2 + p * 0.4, level: 0.09 * p, freq: rnd(78, 96), freqEnd: rnd(58, 70),
        drive: 6, cutoff: 420, cutoffEnd: 260, q: 1.4, arch: true, track: (n) => v.track(n),
      });
      end = Math.max(end, g);
      v.end(end);
    }
    this.dip = Math.max(this.dip, 0.12 * p);
    this.swellAmt = Math.max(this.swellAmt, 0.18 * p);
    this.swellTau = 1.6;
    this.applyLevels(0.25);
  }

  /** Sharp collective inhale, then a hole where the noise was. */
  gasp(power = 1): void {
    if (!this.enabled) return;
    const p = clamp(power, 0.2, 1.4);
    const v = this.voice(0.7, 0, 0.45 * p);
    if (v) {
      const end = noiseBurst(v.ctx, v.dest, {
        t0: v.t0, dur: 0.55, level: 0.7, kind: 'white', filter: 'bandpass',
        freq: rnd(900, 1250), freqEnd: rnd(2100, 2700), q: 0.9, attack: 0.05, track: (n) => v.track(n),
      });
      v.end(end);
    }
    this.swellAmt = Math.max(this.swellAmt, 0.1 * p);
    this.dip = clamp(0.2 * p, 0, 0.45);
    this.applyLevels(0.12);
  }

  /**
   * Rhythmic chant bed at `bpm`. Passing 0 (or a non-positive bpm) stops it and
   * frees the nodes so an idle stadium stays idle.
   */
  chant(bpm: number): void {
    if (!this.enabled || bpm <= 0) { this.stopChant(); return; }
    const ctx = this.engine.context;
    const bus = this.engine.busInput('crowd');
    const buf = this.engine.noise('pink');
    if (!ctx || !bus || !buf) return;
    const hz = clamp(bpm / 60, 0.3, 6);
    if (this.chantNodes) {
      try { this.chantNodes.osc.frequency.setTargetAtTime(hz, ctx.currentTime, 0.3); } catch { /* ignore */ }
      return;
    }
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.playbackRate.value = 1.17;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 520;
    filter.Q.value = 1.6;
    const gain = ctx.createGain();
    gain.gain.value = 0.001;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = hz;
    const depth = ctx.createGain();
    depth.gain.value = 0;
    src.connect(filter); filter.connect(gain); gain.connect(bus);
    osc.connect(depth); depth.connect(gain.gain);
    try {
      osc.start(t); src.start(t, Math.random());
      depth.gain.linearRampToValueAtTime(0.05, t + 1.2);
    } catch { /* ignore */ }
    this.chantNodes = { osc, depth, gain, filter, src };
  }

  private stopChant(): void {
    const c = this.chantNodes;
    this.chantNodes = null;
    if (!c) return;
    const ctx = this.engine.context;
    if (ctx) {
      try {
        c.depth.gain.setTargetAtTime(0, ctx.currentTime, 0.25);
        c.osc.stop(ctx.currentTime + 1.2);
        c.src.stop(ctx.currentTime + 1.2);
      } catch { /* ignore */ }
    }
    const done = (): void => {
      for (const n of [c.src, c.filter, c.gain, c.osc, c.depth]) { try { n.disconnect(); } catch { /* ignore */ } }
    };
    setTimeout(done, 1400);
  }

  /** 0..1 fraction of the building supporting HOME. 0.5 for neutral sites. */
  setHomeBias(b: number): void { this.homeBias = clamp01(b); }
  getHomeBias(): number { return this.homeBias; }

  // ── internals ───────────────────────────────────────────────────────────

  private tick(): void {
    if (this.disposed || !this.running) return;
    const now = this.engine.now;
    let dt = now - this.lastTick;
    if (!Number.isFinite(dt) || dt <= 0 || dt > 2) dt = TICK_MS / 1000;
    this.lastTick = now;

    if (this.swellAmt > 0.0005) this.swellAmt *= Math.exp(-dt / this.swellTau);
    else this.swellAmt = 0;
    if (this.dip > 0.0005) this.dip *= Math.exp(-dt / 0.7);
    else this.dip = 0;

    this.applyLevels(0.18);

    if (!this.enabled) return;
    const e = this.getEnergy();
    if (e < QUIET_FLOOR) return;

    // Sparse shouts. Rate rises steeply so a loud stadium feels populated.
    const rate = 0.5 + e * e * 9;
    let expected = rate * (TICK_MS / 1000);
    while (expected > 0) {
      if (Math.random() < Math.min(1, expected)) this.individual(rnd(0, TICK_MS / 1000), 0.35 + e * 0.7);
      expected -= 1;
    }
  }

  private applyLevels(timeConstant: number): void {
    const bed = this.bed;
    const ctx = this.engine.context;
    if (!bed || !ctx) return;
    const e = this.enabled ? this.getEnergy() : 0;
    const t = ctx.currentTime;
    const tc = clamp(timeConstant, 0.02, 3);
    const bedLevel = 0.035 + e * 0.11;
    const roarLevel = 0.008 + e * e * 0.16;
    const cutoff = 620 + e * 2600;
    try {
      bed.bedGain.gain.setTargetAtTime(bedLevel, t, tc);
      bed.roarGain.gain.setTargetAtTime(roarLevel, t, tc);
      bed.lpA.frequency.setTargetAtTime(cutoff, t, tc);
      bed.lpB.frequency.setTargetAtTime(cutoff * 0.86, t, tc);
      bed.roarFilter.frequency.setTargetAtTime(820 + e * 700, t, tc);
      bed.lfo1Gain.gain.setTargetAtTime(0.008 + e * 0.02, t, tc);
    } catch { /* ignore */ }
  }

  private voice(dur: number, pan: number, gain: number): VoiceSlot | null {
    if (this.activeVoices >= MAX_CROWD_VOICES) return null;
    const v = this.engine.voice('crowd', { dur, pan, gain, budget: false });
    if (!v) return null;
    this.activeVoices++;
    setTimeout(() => { this.activeVoices = Math.max(0, this.activeVoices - 1); }, Math.min(4000, dur * 1000 + 120));
    return v;
  }

  /** One anonymous shout: short filtered noise plus a wobbly tonal core. */
  private individual(delay: number, level: number): void {
    const engine = this.engine;
    if (!engine.available) return;
    const dur = rnd(0.12, 0.34);
    const v = this.voice(dur + delay + 0.1, rnd(-0.85, 0.85), clamp(level * rnd(0.35, 0.7), 0, 1));
    if (!v) return;
    const t0 = v.t0 + delay;
    const f = rnd(430, 1150);
    let end = noiseBurst(v.ctx, v.dest, {
      t0, dur, level: 0.55, kind: 'white', filter: 'bandpass',
      freq: f * rnd(1.6, 2.4), freqEnd: f * rnd(1.1, 1.7), q: rnd(3, 7),
      attack: rnd(0.01, 0.04), track: (n) => v.track(n),
    });
    const te = tone(v.ctx, v.dest, {
      t0, dur: dur * 0.85, level: 0.10, freq: f, freqEnd: f * rnd(0.72, 1.25),
      wave: 'sawtooth', index: 0.6, ratio: 2.02, indexEnd: 0.1, attack: 0.02, track: (n) => v.track(n),
    });
    end = Math.max(end, te);
    v.end(end);
  }
}
