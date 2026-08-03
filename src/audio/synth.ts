/**
 * GRIDIRON OVERDRIVE — procedural voice library.
 *
 * Pure functions of the shape `fn(ctx, dest, opts) -> endTime`. They build a small
 * node graph, schedule it, and return the context time at which the voice is silent
 * so the caller can retire the slot. They never read global state, never allocate an
 * AudioBuffer (noise is cached per context), and never assume a particular bus.
 *
 * Every voice takes pitch / duration / level / pan variation so repeats never sound
 * identical — see `vary()`.
 */

import { clamp } from '../core/math.ts';

export type NoiseKind = 'white' | 'pink';

// ── cached noise ────────────────────────────────────────────────────────────

interface NoiseCache { white: AudioBuffer | null; pink: AudioBuffer | null }
const noiseCache = new WeakMap<BaseAudioContext, NoiseCache>();

const NOISE_SECONDS = 2;

/**
 * Two seconds of looping noise per context, generated once. Voices vary it with a
 * random loop offset + playback rate, which is why one buffer never sounds repetitive.
 */
export function getNoiseBuffer(ctx: BaseAudioContext, kind: NoiseKind): AudioBuffer | null {
  let entry = noiseCache.get(ctx);
  if (!entry) { entry = { white: null, pink: null }; noiseCache.set(ctx, entry); }
  const cached = kind === 'pink' ? entry.pink : entry.white;
  if (cached) return cached;
  let buf: AudioBuffer;
  try {
    buf = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * NOISE_SECONDS)), ctx.sampleRate);
  } catch {
    return null;
  }
  const d = buf.getChannelData(0);
  if (kind === 'pink') {
    // Paul Kellet's refined pink filter.
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520;
      b3 = 0.86650 * b3 + w * 0.3104856;
      b4 = 0.55000 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.0168980;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
  } else {
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (kind === 'pink') entry.pink = buf; else entry.white = buf;
  return buf;
}

// ── small helpers ───────────────────────────────────────────────────────────

const MIN_GAIN = 0.00012;

export function rnd(a: number, b: number): number { return a + Math.random() * (b - a); }
/** Multiplicative variation: `vary(1, 0.06)` -> 0.94 .. 1.06. */
export function vary(v: number, amount: number): number { return v * (1 + rnd(-amount, amount)); }
export function pick<T>(arr: readonly T[]): T { return arr[(Math.random() * arr.length) | 0]; }

/** Percussive envelope: linear attack, exponential decay, clean zero. */
export function env(p: AudioParam, t0: number, peak: number, attack: number, dur: number, tail = 0.006): number {
  const a = Math.max(0.0006, attack);
  const d = Math.max(a + 0.008, dur);
  const pk = Math.max(MIN_GAIN * 2, peak);
  try {
    p.cancelScheduledValues(t0);
    p.setValueAtTime(MIN_GAIN, t0);
    p.linearRampToValueAtTime(pk, t0 + a);
    p.exponentialRampToValueAtTime(MIN_GAIN, t0 + d);
    p.linearRampToValueAtTime(0, t0 + d + tail);
  } catch { /* ignore */ }
  return t0 + d + tail;
}

/** Arch envelope for swept/sustained voices (whooshes, risers). */
export function envArch(p: AudioParam, t0: number, peak: number, dur: number, peakAt = 0.4): number {
  const d = Math.max(0.03, dur);
  const pk = Math.max(MIN_GAIN * 2, peak);
  try {
    p.cancelScheduledValues(t0);
    p.setValueAtTime(MIN_GAIN, t0);
    p.linearRampToValueAtTime(pk, t0 + d * clamp(peakAt, 0.05, 0.9));
    p.exponentialRampToValueAtTime(MIN_GAIN, t0 + d);
    p.linearRampToValueAtTime(0, t0 + d + 0.008);
  } catch { /* ignore */ }
  return t0 + d + 0.008;
}

function safeRamp(p: AudioParam, from: number, to: number, t0: number, t1: number): void {
  try {
    p.setValueAtTime(Math.max(0.0001, from), t0);
    if (Math.abs(to - from) > 0.0001) p.exponentialRampToValueAtTime(Math.max(0.0001, to), Math.max(t1, t0 + 0.005));
  } catch { /* ignore */ }
}

/** Optional per-voice panner. Returns the node sources should connect into. */
function outputFor(ctx: BaseAudioContext, dest: AudioNode, pan?: number): AudioNode {
  if (pan === undefined || pan === 0) return dest;
  try {
    const p = ctx.createStereoPanner();
    p.pan.value = clamp(pan, -1, 1);
    p.connect(dest);
    return p;
  } catch {
    return dest;
  }
}

/** Register a source with the caller's voice slot so it can be force-stopped. */
export type TrackFn = (n: AudioScheduledSourceNode) => void;

export interface BaseOpts {
  /** Context time to start at. Defaults to `ctx.currentTime`. */
  t0?: number;
  /** Linear level within the voice. */
  level?: number;
  /** Extra panning on top of the voice panner. */
  pan?: number;
  /** Seconds. */
  dur?: number;
  track?: TrackFn;
}

function startAt(ctx: BaseAudioContext, o: BaseOpts): number {
  return o.t0 ?? ctx.currentTime;
}

function noiseSource(ctx: BaseAudioContext, kind: NoiseKind, rate: number): AudioBufferSourceNode | null {
  const buf = getNoiseBuffer(ctx, kind);
  if (!buf) return null;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  src.playbackRate.value = clamp(rate, 0.25, 4);
  return src;
}

function begin(src: AudioScheduledSourceNode, t0: number, o: BaseOpts, offset?: number): void {
  try {
    if (offset !== undefined && 'buffer' in src) (src as AudioBufferSourceNode).start(t0, offset);
    else src.start(t0);
  } catch { /* ignore */ }
  o.track?.(src);
}

function finish(src: AudioScheduledSourceNode, end: number): void {
  try { src.stop(end + 0.02); } catch { /* ignore */ }
}

// ── voices ──────────────────────────────────────────────────────────────────

export interface NoiseBurstOpts extends BaseOpts {
  kind?: NoiseKind;
  filter?: BiquadFilterType;
  /** Filter cutoff / centre at the start. */
  freq?: number;
  /** Optional sweep target. */
  freqEnd?: number;
  q?: number;
  attack?: number;
  /** Playback rate of the noise buffer — subtle timbre variation. */
  rate?: number;
  /** Use an arch envelope instead of a percussive one. */
  arch?: boolean;
}

/** Filtered noise transient — the backbone of impacts, footsteps and air. */
export function noiseBurst(ctx: BaseAudioContext, dest: AudioNode, o: NoiseBurstOpts = {}): number {
  const t0 = startAt(ctx, o);
  const dur = o.dur ?? 0.09;
  const src = noiseSource(ctx, o.kind ?? 'white', o.rate ?? vary(1, 0.12));
  if (!src) return t0 + dur;
  const out = outputFor(ctx, dest, o.pan);
  const f = ctx.createBiquadFilter();
  f.type = o.filter ?? 'bandpass';
  const f0 = clamp(o.freq ?? 1400, 24, 19000);
  f.frequency.setValueAtTime(f0, t0);
  if (o.freqEnd !== undefined) safeRamp(f.frequency, f0, clamp(o.freqEnd, 24, 19000), t0, t0 + dur);
  f.Q.value = o.q ?? 1;
  const g = ctx.createGain();
  const end = o.arch
    ? envArch(g.gain, t0, o.level ?? 0.6, dur)
    : env(g.gain, t0, o.level ?? 0.6, o.attack ?? 0.0025, dur);
  src.connect(f); f.connect(g); g.connect(out);
  begin(src, t0, o, Math.random() * (NOISE_SECONDS - 0.05));
  finish(src, end);
  return end;
}

export interface ThumpOpts extends BaseOpts {
  /** Start pitch. */
  f0?: number;
  /** End pitch (the drop is what makes it read as weight). */
  f1?: number;
  wave?: OscillatorType;
  /** Adds a hard click transient on top (0..1). */
  click?: number;
}

/** Sub-weight layer: pitch-dropping sine. Every heavy hit starts here. */
export function thump(ctx: BaseAudioContext, dest: AudioNode, o: ThumpOpts = {}): number {
  const t0 = startAt(ctx, o);
  const dur = o.dur ?? 0.2;
  const out = outputFor(ctx, dest, o.pan);
  const osc = ctx.createOscillator();
  osc.type = o.wave ?? 'sine';
  const f0 = clamp(vary(o.f0 ?? 150, 0.07), 20, 2000);
  const f1 = clamp(vary(o.f1 ?? 44, 0.07), 16, 2000);
  osc.frequency.setValueAtTime(f0, t0);
  try { osc.frequency.exponentialRampToValueAtTime(f1, t0 + dur * 0.75); } catch { /* ignore */ }
  const g = ctx.createGain();
  const end = env(g.gain, t0, o.level ?? 0.9, 0.0016, dur);
  osc.connect(g); g.connect(out);
  begin(osc, t0, o);
  finish(osc, end);

  if (o.click && o.click > 0) {
    const c = ctx.createOscillator();
    c.type = 'square';
    c.frequency.setValueAtTime(clamp(f0 * 6, 60, 4000), t0);
    try { c.frequency.exponentialRampToValueAtTime(clamp(f0 * 1.4, 40, 4000), t0 + 0.03); } catch { /* ignore */ }
    const cg = ctx.createGain();
    env(cg.gain, t0, (o.level ?? 0.9) * 0.35 * o.click, 0.0008, 0.032);
    c.connect(cg); cg.connect(out);
    begin(c, t0, o);
    finish(c, t0 + 0.06);
  }
  return end;
}

export interface CrackOpts extends BaseOpts {
  /** Centre of the mid crack. */
  freq?: number;
  /** Brightness of the high transient, 0..1. */
  bite?: number;
  q?: number;
}

/** Mid "pads and bone" crack plus a high transient — the audible edge of a hit. */
export function crack(ctx: BaseAudioContext, dest: AudioNode, o: CrackOpts = {}): number {
  const t0 = startAt(ctx, o);
  const dur = o.dur ?? 0.075;
  const level = o.level ?? 0.7;
  const f = clamp(vary(o.freq ?? 1700, 0.14), 200, 9000);
  const end = noiseBurst(ctx, dest, {
    t0, dur, level, pan: o.pan, track: o.track,
    kind: 'white', filter: 'bandpass', freq: f, freqEnd: f * 0.55, q: o.q ?? 1.5, attack: 0.0012,
  });
  const bite = o.bite ?? 0.65;
  if (bite > 0) {
    noiseBurst(ctx, dest, {
      t0, dur: dur * 0.42, level: level * bite * 0.55, pan: o.pan, track: o.track,
      kind: 'white', filter: 'highpass', freq: 5200, q: 0.7, attack: 0.0006,
    });
  }
  return end;
}

export interface WhooshOpts extends BaseOpts {
  f0?: number;
  f1?: number;
  q?: number;
  panFrom?: number;
  panTo?: number;
  kind?: NoiseKind;
}

/** Swept air — throws, spins, hurdles, dives. */
export function whoosh(ctx: BaseAudioContext, dest: AudioNode, o: WhooshOpts = {}): number {
  const t0 = startAt(ctx, o);
  const dur = o.dur ?? 0.28;
  const src = noiseSource(ctx, o.kind ?? 'pink', vary(1, 0.1));
  if (!src) return t0 + dur;

  let out: AudioNode = outputFor(ctx, dest, o.pan);
  if (o.panFrom !== undefined || o.panTo !== undefined) {
    try {
      const p = ctx.createStereoPanner();
      const a = clamp(o.panFrom ?? 0, -1, 1);
      const b = clamp(o.panTo ?? 0, -1, 1);
      p.pan.setValueAtTime(a, t0);
      p.pan.linearRampToValueAtTime(b, t0 + dur);
      p.connect(out);
      out = p;
    } catch { /* ignore */ }
  }

  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  const a0 = clamp(vary(o.f0 ?? 480, 0.12), 60, 16000);
  const a1 = clamp(vary(o.f1 ?? 2600, 0.12), 60, 16000);
  f.frequency.setValueAtTime(a0, t0);
  safeRamp(f.frequency, a0, a1, t0, t0 + dur * 0.9);
  f.Q.value = o.q ?? 0.9;
  const g = ctx.createGain();
  const end = envArch(g.gain, t0, o.level ?? 0.5, dur, 0.45);
  src.connect(f); f.connect(g); g.connect(out);
  begin(src, t0, o, Math.random() * (NOISE_SECONDS - 0.05));
  finish(src, end);
  return end;
}

export interface ToneOpts extends BaseOpts {
  freq?: number;
  freqEnd?: number;
  wave?: OscillatorType;
  /** Modulator:carrier frequency ratio. */
  ratio?: number;
  /** FM index (in carrier-frequency multiples). 0 disables the modulator entirely. */
  index?: number;
  indexEnd?: number;
  modWave?: OscillatorType;
  attack?: number;
  detune?: number;
  arch?: boolean;
}

/** Two-operator FM voice. The workhorse behind blips, stings and metallic colour. */
export function tone(ctx: BaseAudioContext, dest: AudioNode, o: ToneOpts = {}): number {
  const t0 = startAt(ctx, o);
  const dur = o.dur ?? 0.18;
  const out = outputFor(ctx, dest, o.pan);
  const carrier = ctx.createOscillator();
  carrier.type = o.wave ?? 'sine';
  const f0 = clamp(o.freq ?? 440, 20, 12000);
  carrier.frequency.setValueAtTime(f0, t0);
  if (o.detune) carrier.detune.setValueAtTime(o.detune, t0);
  if (o.freqEnd !== undefined) safeRamp(carrier.frequency, f0, clamp(o.freqEnd, 20, 12000), t0, t0 + dur * 0.9);

  const index = o.index ?? 0;
  if (index > 0) {
    const mod = ctx.createOscillator();
    mod.type = o.modWave ?? 'sine';
    mod.frequency.setValueAtTime(clamp(f0 * (o.ratio ?? 2), 0.1, 18000), t0);
    const mg = ctx.createGain();
    const i0 = f0 * index;
    const i1 = f0 * (o.indexEnd ?? index * 0.25);
    mg.gain.setValueAtTime(i0, t0);
    try { mg.gain.linearRampToValueAtTime(Math.max(0, i1), t0 + dur); } catch { /* ignore */ }
    mod.connect(mg); mg.connect(carrier.frequency);
    begin(mod, t0, o);
    finish(mod, t0 + dur + 0.05);
  }

  const g = ctx.createGain();
  const end = o.arch
    ? envArch(g.gain, t0, o.level ?? 0.5, dur)
    : env(g.gain, t0, o.level ?? 0.5, o.attack ?? 0.004, dur);
  carrier.connect(g); g.connect(out);
  begin(carrier, t0, o);
  finish(carrier, end);
  return end;
}

export interface ChimeOpts extends BaseOpts {
  freq?: number;
  /** Harmonic multipliers. */
  partials?: readonly number[];
  spread?: number;
}

/** Bell-ish harmonic stack with staggered decays. Confirmations, first downs. */
export function chime(ctx: BaseAudioContext, dest: AudioNode, o: ChimeOpts = {}): number {
  const t0 = startAt(ctx, o);
  const dur = o.dur ?? 0.5;
  const base = clamp(o.freq ?? 880, 40, 8000);
  const partials = o.partials ?? [1, 2, 3.01, 4.98];
  const level = o.level ?? 0.34;
  let end = t0 + dur;
  for (let i = 0; i < partials.length; i++) {
    const d = dur * (1 - i * 0.16);
    const e = tone(ctx, dest, {
      t0, dur: Math.max(0.06, d), level: level / (1 + i * 1.35),
      freq: base * partials[i] * (1 + rnd(-0.002, 0.002)),
      wave: 'sine', attack: 0.003, index: i === 0 ? 0.4 : 0, ratio: 3.5, indexEnd: 0,
      pan: o.pan !== undefined ? o.pan + (o.spread ?? 0) * (i % 2 ? 1 : -1) : undefined,
      track: o.track,
    });
    if (e > end) end = e;
  }
  return end;
}

export interface StabOpts extends BaseOpts {
  /** Root frequency. */
  freq?: number;
  /** Semitone offsets forming the chord. */
  chord?: readonly number[];
  wave?: OscillatorType;
  /** Lowpass sweep start / end. */
  cutoff?: number;
  cutoffEnd?: number;
  q?: number;
  /** Detune spread in cents. */
  spread?: number;
}

/** Filtered chord stab — turnovers, menu confirms, music hits. */
export function stab(ctx: BaseAudioContext, dest: AudioNode, o: StabOpts = {}): number {
  const t0 = startAt(ctx, o);
  const dur = o.dur ?? 0.4;
  const out = outputFor(ctx, dest, o.pan);
  const root = clamp(o.freq ?? 220, 20, 4000);
  const chord = o.chord ?? [0, 7, 12];
  const spread = o.spread ?? 9;

  const filt = ctx.createBiquadFilter();
  filt.type = 'lowpass';
  const c0 = clamp(o.cutoff ?? 2600, 60, 18000);
  filt.frequency.setValueAtTime(c0, t0);
  safeRamp(filt.frequency, c0, clamp(o.cutoffEnd ?? c0 * 0.32, 60, 18000), t0, t0 + dur);
  filt.Q.value = o.q ?? 3;
  const g = ctx.createGain();
  const end = env(g.gain, t0, (o.level ?? 0.4) / Math.sqrt(chord.length), 0.006, dur);
  filt.connect(g); g.connect(out);

  for (let i = 0; i < chord.length; i++) {
    const osc = ctx.createOscillator();
    osc.type = o.wave ?? 'sawtooth';
    osc.frequency.setValueAtTime(root * Math.pow(2, chord[i] / 12), t0);
    osc.detune.setValueAtTime(rnd(-spread, spread), t0);
    osc.connect(filt);
    begin(osc, t0, o);
    finish(osc, end);
  }
  return end;
}

export interface BrassOpts extends BaseOpts {
  freq?: number;
  chord?: readonly number[];
  /** Filter opening amount — the "blat". */
  bite?: number;
  vibrato?: number;
}

/** Detuned saw brass with a filter blat. The touchdown payoff lives here. */
export function brass(ctx: BaseAudioContext, dest: AudioNode, o: BrassOpts = {}): number {
  const t0 = startAt(ctx, o);
  const dur = o.dur ?? 0.7;
  const out = outputFor(ctx, dest, o.pan);
  const root = clamp(o.freq ?? 174.6, 30, 3000);
  const chord = o.chord ?? [0, 7, 12, 19];
  const level = (o.level ?? 0.5) / Math.sqrt(chord.length);

  const filt = ctx.createBiquadFilter();
  filt.type = 'lowpass';
  const bite = clamp(o.bite ?? 1, 0.2, 3);
  filt.frequency.setValueAtTime(clamp(root * 2, 80, 18000), t0);
  try {
    filt.frequency.linearRampToValueAtTime(clamp(root * 14 * bite, 200, 17000), t0 + Math.min(0.085, dur * 0.25));
    filt.frequency.exponentialRampToValueAtTime(clamp(root * 4, 120, 17000), t0 + dur);
  } catch { /* ignore */ }
  filt.Q.value = 1.6;
  const g = ctx.createGain();
  try {
    g.gain.setValueAtTime(MIN_GAIN, t0);
    g.gain.linearRampToValueAtTime(level, t0 + 0.02);
    g.gain.setValueAtTime(level, t0 + dur * 0.62);
    g.gain.exponentialRampToValueAtTime(MIN_GAIN, t0 + dur);
    g.gain.linearRampToValueAtTime(0, t0 + dur + 0.01);
  } catch { /* ignore */ }
  const end = t0 + dur + 0.01;
  filt.connect(g); g.connect(out);

  let vib: OscillatorNode | null = null;
  let vibGain: GainNode | null = null;
  if (o.vibrato && o.vibrato > 0) {
    vib = ctx.createOscillator();
    vib.frequency.setValueAtTime(5.4, t0);
    vibGain = ctx.createGain();
    vibGain.gain.setValueAtTime(0, t0);
    try { vibGain.gain.linearRampToValueAtTime(o.vibrato * 9, t0 + dur * 0.5); } catch { /* ignore */ }
    vib.connect(vibGain);
    begin(vib, t0, o);
    finish(vib, end);
  }

  for (let i = 0; i < chord.length; i++) {
    for (let d = 0; d < 2; d++) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(root * Math.pow(2, chord[i] / 12), t0);
      osc.detune.setValueAtTime((d === 0 ? -1 : 1) * rnd(4, 11), t0);
      if (vibGain) vibGain.connect(osc.detune);
      osc.connect(filt);
      begin(osc, t0, o);
      finish(osc, end);
    }
  }
  return end;
}

export interface MetallicOpts extends BaseOpts {
  freq?: number;
  /** Inharmonic ratios. Defaults read as struck metal. */
  partials?: readonly number[];
  /** Ring length multiplier. */
  ring?: number;
}

/** Inharmonic partial stack — goalpost clang, marker clack, sparkle. */
export function metallic(ctx: BaseAudioContext, dest: AudioNode, o: MetallicOpts = {}): number {
  const t0 = startAt(ctx, o);
  const dur = o.dur ?? 1.1;
  const out = outputFor(ctx, dest, o.pan);
  const base = clamp(vary(o.freq ?? 430, 0.05), 40, 6000);
  const partials = o.partials ?? [1, 1.732, 2.412, 3.19, 4.37, 5.83];
  const ring = o.ring ?? 1;
  const level = (o.level ?? 0.4) / Math.sqrt(partials.length);
  let end = t0;

  // Strike transient.
  noiseBurst(ctx, dest, {
    t0, dur: 0.03, level: (o.level ?? 0.4) * 0.5, pan: o.pan, track: o.track,
    kind: 'white', filter: 'highpass', freq: 3800, attack: 0.0005,
  });

  for (let i = 0; i < partials.length; i++) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const f = base * partials[i] * (1 + rnd(-0.004, 0.004));
    osc.frequency.setValueAtTime(clamp(f, 20, 16000), t0);
    const g = ctx.createGain();
    const d = Math.max(0.05, dur * ring * (1 - i * 0.13));
    const e = env(g.gain, t0 + i * 0.0016, level / (1 + i * 0.55), 0.0015, d);
    osc.connect(g); g.connect(out);
    begin(osc, t0, o);
    finish(osc, e);
    if (e > end) end = e;
  }
  return end;
}

export interface GritOpts extends BaseOpts {
  freq?: number;
  freqEnd?: number;
  /** Waveshaper drive, 1..40. */
  drive?: number;
  cutoff?: number;
  cutoffEnd?: number;
  q?: number;
  wave?: OscillatorType;
  arch?: boolean;
}

/** WaveShaper curves are pure functions of the drive amount — build each one once. */
const shaperCurves = new Map<number, Float32Array<ArrayBuffer>>();

function driveCurve(amount: number): Float32Array<ArrayBuffer> {
  const key = Math.round(clamp(amount, 1, 60));
  const cached = shaperCurves.get(key);
  if (cached) return cached;
  const n = 1024;
  const curve = new Float32Array(n);
  const k = key * 2;
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / (n - 1) - 1;
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  shaperCurves.set(key, curve);
  return curve;
}

/** Distorted saw — Overdrive risers, power hits, anything that should feel mean. */
export function grit(ctx: BaseAudioContext, dest: AudioNode, o: GritOpts = {}): number {
  const t0 = startAt(ctx, o);
  const dur = o.dur ?? 0.5;
  const out = outputFor(ctx, dest, o.pan);
  const osc = ctx.createOscillator();
  osc.type = o.wave ?? 'sawtooth';
  const f0 = clamp(vary(o.freq ?? 90, 0.04), 20, 6000);
  osc.frequency.setValueAtTime(f0, t0);
  if (o.freqEnd !== undefined) safeRamp(osc.frequency, f0, clamp(o.freqEnd, 20, 6000), t0, t0 + dur * 0.92);

  const shaper = ctx.createWaveShaper();
  shaper.curve = driveCurve(o.drive ?? 12);
  shaper.oversample = '2x';

  const filt = ctx.createBiquadFilter();
  filt.type = 'bandpass';
  const c0 = clamp(o.cutoff ?? 620, 60, 16000);
  filt.frequency.setValueAtTime(c0, t0);
  safeRamp(filt.frequency, c0, clamp(o.cutoffEnd ?? c0, 60, 16000), t0, t0 + dur * 0.92);
  filt.Q.value = o.q ?? 1.1;

  const g = ctx.createGain();
  const end = o.arch
    ? envArch(g.gain, t0, o.level ?? 0.4, dur, 0.6)
    : env(g.gain, t0, o.level ?? 0.4, 0.006, dur);

  osc.connect(shaper); shaper.connect(filt); filt.connect(g); g.connect(out);
  begin(osc, t0, o);
  finish(osc, end);
  return end;
}
