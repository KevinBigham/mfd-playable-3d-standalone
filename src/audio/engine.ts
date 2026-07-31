/**
 * GRIDIRON OVERDRIVE — audio engine.
 *
 * 100 % procedural Web Audio. No sample files, no fetches, no decodeAudioData.
 *
 * Graph:
 *
 *   voices ─▶ [sfx]  ─┐
 *   voices ─▶ [crowd] ─┤ per-bus volume ─▶ per-bus duck ─┐
 *   voices ─▶ [music] ─┤                                  ├─▶ master ─▶ duck ─▶ compressor ─▶ out
 *   voices ─▶ [ui]    ─┘                                  ┘
 *
 * HEADLESS SAFETY: `tools/smoke.ts` imports this module in Node, where there is no
 * `AudioContext`. Nothing is touched at module scope, the context is created lazily
 * inside `unlock()`, and every public method is a guarded no-op when it is missing.
 */

import { clamp, clamp01 } from '../core/math.ts';
import { getNoiseBuffer, type NoiseKind } from './synth.ts';

export type BusName = 'master' | 'sfx' | 'crowd' | 'music' | 'ui';

export const BUS_NAMES: readonly BusName[] = ['master', 'sfx', 'crowd', 'music', 'ui'];
/** Buses that feed the master strip. */
const SUB_BUSES: readonly BusName[] = ['sfx', 'crowd', 'music', 'ui'];

/** Concurrent budgeted one-shots. Oldest is stolen when the budget is full. */
export const MAX_VOICES = 24;
/** Absolute ceiling including unbudgeted (bed / music) voices — pure safety valve. */
const HARD_VOICE_CAP = 96;

const DEFAULT_VOLUMES: Record<BusName, number> = {
  master: 0.85, sfx: 0.9, crowd: 0.7, music: 0.6, ui: 0.8,
};

/** Handle handed to synth voices. `dest` is where sources connect. */
export interface VoiceSlot {
  readonly ctx: AudioContext;
  /** Connect sound sources here. Level and pan are already applied downstream. */
  readonly dest: AudioNode;
  /** Scheduled start time in context seconds. */
  readonly t0: number;
  /** Register a source so the engine can hard-stop it if the voice is stolen. */
  track(node: AudioScheduledSourceNode): void;
  /** Tell the engine when this voice is finished (context seconds). */
  end(when: number): void;
  setPan(p: number): void;
  /** Voice level param, for envelopes owned by the caller. */
  readonly level: AudioParam;
}

export interface VoiceOptions {
  /** -1 hard left .. 1 hard right. */
  pan?: number;
  /** Linear voice gain, 0..1.5. */
  gain?: number;
  /** Expected length in seconds — refined later via `end()`. */
  dur?: number;
  /** Start time in context seconds. Defaults to "now". */
  when?: number;
  /**
   * Budgeted voices participate in the 24-voice steal pool (gameplay one-shots).
   * Continuous layers (crowd bed, music notes) pass `false`.
   */
  budget?: boolean;
  /**
   * Never steal this voice. Reserved for stingers — a touchdown payoff getting
   * cut off by a footstep is the one failure mode nobody forgives.
   */
  protect?: boolean;
}

class Voice implements VoiceSlot {
  readonly gain: GainNode;
  readonly panner: StereoPannerNode;
  readonly nodes: AudioScheduledSourceNode[] = [];
  ctx!: AudioContext;
  t0 = 0;
  endTime = 0;
  budgeted = true;
  shielded = false;
  startedAt = 0;
  connectedTo: AudioNode | null = null;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.gain = ctx.createGain();
    this.panner = ctx.createStereoPanner();
    this.gain.connect(this.panner);
  }

  get dest(): AudioNode { return this.gain; }
  get level(): AudioParam { return this.gain.gain; }

  track(node: AudioScheduledSourceNode): void { this.nodes.push(node); }

  end(when: number): void { if (when > this.endTime) this.endTime = when; }

  setPan(p: number): void {
    try { this.panner.pan.setValueAtTime(clamp(p, -1, 1), this.ctx.currentTime); } catch { /* ignore */ }
  }
}

/**
 * Owns the AudioContext, the bus graph, the voice budget and the cached noise.
 * Safe to construct, call and dispose in Node.
 */
export class AudioEngine {
  private ac: AudioContext | null = null;
  private strips = new Map<BusName, { gain: GainNode; duck: GainNode }>();
  private comp: DynamicsCompressorNode | null = null;
  private vol: Record<BusName, number> = { ...DEFAULT_VOLUMES };
  private muted: Record<BusName, boolean> = { master: false, sfx: false, crowd: false, music: false, ui: false };
  private live: Voice[] = [];
  private dying: Voice[] = [];
  private pool: Voice[] = [];
  private budgetCount = 0;
  private reapTimer: ReturnType<typeof setTimeout> | null = null;
  private readyFns: Array<() => void> = [];
  private disposed = false;
  /** True once an AudioContext has been successfully created. */
  private started = false;

  // ── lifecycle ───────────────────────────────────────────────────────────

  /** True when real audio hardware is available (false in Node/headless). */
  get available(): boolean { return this.ac !== null; }
  get context(): AudioContext | null { return this.ac; }
  get state(): string { return this.ac ? this.ac.state : 'unavailable'; }
  /** Context clock, or 0 when headless. Never throws. */
  get now(): number { return this.ac ? this.ac.currentTime : 0; }
  /** Budgeted voices currently sounding — diagnostics / tests. */
  get voiceCount(): number { return this.budgetCount; }

  /**
   * Create (once) and resume the AudioContext. Must be called from a user gesture
   * in browsers. Idempotent, and a no-op when Web Audio is unavailable.
   */
  unlock(): void {
    if (this.disposed) return;
    if (!this.ac) {
      const Ctor = audioContextCtor();
      if (!Ctor) return;
      try {
        this.ac = new Ctor({ latencyHint: 'interactive' });
      } catch {
        this.ac = null;
        return;
      }
      try {
        this.buildGraph(this.ac);
      } catch {
        this.ac = null;
        this.strips.clear();
        return;
      }
      this.started = true;
      const fns = this.readyFns.slice();
      this.readyFns.length = 0;
      for (const fn of fns) { try { fn(); } catch { /* listener must not break audio */ } }
    }
    const ac = this.ac;
    // iOS reports a non-standard 'interrupted' state, hence the widened compare.
    const st: string = ac.state;
    if (st === 'suspended' || st === 'interrupted') {
      void Promise.resolve(ac.resume()).catch(() => { /* ignore */ });
    }
    // Some mobile browsers only truly unlock after a source has been played.
    try {
      const b = ac.createBuffer(1, 1, ac.sampleRate);
      const src = ac.createBufferSource();
      src.buffer = b;
      src.connect(ac.destination);
      src.start(0);
    } catch { /* ignore */ }
  }

  /** Run `fn` once the context exists (immediately if it already does). */
  onReady(fn: () => void): void {
    if (this.disposed) return;
    if (this.started) { try { fn(); } catch { /* ignore */ } return; }
    this.readyFns.push(fn);
  }

  private buildGraph(ac: AudioContext): void {
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.knee.value = 8;
    comp.ratio.value = 8;
    comp.attack.value = 0.004;
    comp.release.value = 0.22;
    comp.connect(ac.destination);
    this.comp = comp;

    const masterGain = ac.createGain();
    const masterDuck = ac.createGain();
    masterGain.connect(masterDuck);
    masterDuck.connect(comp);
    this.strips.set('master', { gain: masterGain, duck: masterDuck });

    for (const name of SUB_BUSES) {
      const g = ac.createGain();
      const d = ac.createGain();
      g.connect(d);
      d.connect(masterGain);
      this.strips.set(name, { gain: g, duck: d });
    }
    for (const name of BUS_NAMES) this.applyVolume(name);
  }

  suspend(): void {
    const ac = this.ac;
    if (!ac || this.disposed) return;
    if (ac.state === 'running') void Promise.resolve(ac.suspend()).catch(() => { /* ignore */ });
  }

  resume(): void {
    const ac = this.ac;
    if (!ac || this.disposed) return;
    if (ac.state !== 'running') void Promise.resolve(ac.resume()).catch(() => { /* ignore */ });
  }

  /** Stop everything, disconnect, close. Safe to call more than once. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.readyFns.length = 0;
    if (this.reapTimer !== null) { clearTimeout(this.reapTimer); this.reapTimer = null; }

    for (const v of this.live) this.hardStop(v);
    for (const v of this.dying) this.hardStop(v);
    this.live.length = 0;
    this.dying.length = 0;
    this.budgetCount = 0;

    for (const v of this.pool) {
      try { v.gain.disconnect(); } catch { /* ignore */ }
      try { v.panner.disconnect(); } catch { /* ignore */ }
    }
    this.pool.length = 0;

    for (const strip of this.strips.values()) {
      try { strip.gain.disconnect(); } catch { /* ignore */ }
      try { strip.duck.disconnect(); } catch { /* ignore */ }
    }
    this.strips.clear();
    if (this.comp) { try { this.comp.disconnect(); } catch { /* ignore */ } this.comp = null; }

    const ac = this.ac;
    this.ac = null;
    this.started = false;
    if (ac) {
      try { void Promise.resolve(ac.close()).catch(() => { /* ignore */ }); } catch { /* ignore */ }
    }
  }

  // ── mixer ───────────────────────────────────────────────────────────────

  /** Store raw 0..1 so `getVolume` round-trips exactly; the curve is applied to the node. */
  setVolume(bus: BusName, v: number): void {
    if (!isBus(bus)) return;
    this.vol[bus] = clamp01(Number.isFinite(v) ? v : 0);
    this.applyVolume(bus);
  }

  getVolume(bus: BusName): number { return isBus(bus) ? this.vol[bus] : 0; }

  mute(bus: BusName, on = true): void {
    if (!isBus(bus)) return;
    this.muted[bus] = on;
    this.applyVolume(bus);
  }

  setMute(bus: BusName, on: boolean): void { this.mute(bus, on); }
  isMuted(bus: BusName): boolean { return isBus(bus) ? this.muted[bus] : false; }
  toggleMute(bus: BusName): boolean {
    if (!isBus(bus)) return false;
    this.mute(bus, !this.muted[bus]);
    return this.muted[bus];
  }

  private applyVolume(bus: BusName): void {
    const strip = this.strips.get(bus);
    if (!strip || !this.ac) return;
    const raw = this.muted[bus] ? 0 : this.vol[bus];
    // Perceptual-ish taper, with master headroom so the compressor is a safety net
    // rather than the main gain stage.
    const g = raw * raw * (bus === 'master' ? 0.9 : 1);
    try {
      strip.gain.gain.setTargetAtTime(g, this.ac.currentTime, 0.012);
    } catch {
      strip.gain.gain.value = g;
    }
  }

  /** Input node of a bus — for long-lived layers (crowd bed, music). */
  busInput(bus: BusName): GainNode | null {
    const strip = this.strips.get(bus);
    return strip ? strip.gain : null;
  }

  /**
   * Duck a bus: dip to `1 - amount` over `attackMs`, hold, then release.
   * Independent of user volume, so stingers can breathe without fighting settings.
   */
  duck(bus: BusName, amount: number, attackMs = 40, holdMs = 260, releaseMs = 520): void {
    const strip = this.strips.get(bus);
    const ac = this.ac;
    if (!strip || !ac) return;
    const target = clamp01(1 - clamp01(amount));
    const p = strip.duck.gain;
    const t = ac.currentTime;
    try {
      const holdable = p as AudioParam & { cancelAndHoldAtTime?: (t: number) => AudioParam };
      if (typeof holdable.cancelAndHoldAtTime === 'function') holdable.cancelAndHoldAtTime(t);
      else { p.cancelScheduledValues(t); p.setValueAtTime(p.value, t); }
      const a = t + Math.max(0.005, attackMs / 1000);
      const h = a + Math.max(0, holdMs / 1000);
      p.linearRampToValueAtTime(target, a);
      p.setValueAtTime(target, h);
      p.linearRampToValueAtTime(1, h + Math.max(0.02, releaseMs / 1000));
    } catch { /* ignore */ }
  }

  // ── voices ──────────────────────────────────────────────────────────────

  /**
   * Acquire a voice on a bus. Returns null when headless — every caller treats
   * that as "no sound this time" and returns early.
   */
  voice(bus: BusName, opts?: VoiceOptions): VoiceSlot | null {
    const ac = this.ac;
    if (!ac || this.disposed) return null;
    const strip = this.strips.get(bus) ?? this.strips.get('master');
    if (!strip) return null;

    const budgeted = opts?.budget !== false;
    if (budgeted && this.budgetCount >= MAX_VOICES) this.stealOldest(true);
    if (this.live.length >= HARD_VOICE_CAP) this.stealOldest(false);

    const v = this.pool.pop() ?? new Voice(ac);
    const now = ac.currentTime;
    const t0 = Math.max(now, opts?.when ?? now);
    const gain = clamp(opts?.gain ?? 1, 0, 4);

    try {
      v.gain.gain.cancelScheduledValues(0);
      v.gain.gain.setValueAtTime(gain, now);
      v.panner.pan.cancelScheduledValues(0);
      v.panner.pan.setValueAtTime(clamp(opts?.pan ?? 0, -1, 1), now);
    } catch { /* ignore */ }

    if (v.connectedTo !== strip.gain) {
      try { v.panner.disconnect(); } catch { /* ignore */ }
      try { v.panner.connect(strip.gain); } catch { return null; }
      v.connectedTo = strip.gain;
    }

    v.ctx = ac;
    v.t0 = t0;
    v.startedAt = now;
    v.endTime = t0 + Math.max(0.02, opts?.dur ?? 0.6);
    v.budgeted = budgeted;
    v.shielded = opts?.protect === true;
    v.nodes.length = 0;
    this.live.push(v);
    if (budgeted) this.budgetCount++;
    this.scheduleReap();
    return v;
  }

  private stealOldest(budgetedOnly: boolean): void {
    let idx = -1;
    let oldest = Infinity;
    for (let i = 0; i < this.live.length; i++) {
      const v = this.live[i];
      if (v.shielded) continue;
      if (budgetedOnly && !v.budgeted) continue;
      if (v.startedAt < oldest) { oldest = v.startedAt; idx = i; }
    }
    if (idx < 0) return;
    const v = this.live[idx];
    this.live.splice(idx, 1);
    if (v.budgeted) this.budgetCount = Math.max(0, this.budgetCount - 1);
    const ac = this.ac;
    if (ac) {
      const t = ac.currentTime;
      try {
        v.gain.gain.cancelScheduledValues(t);
        v.gain.gain.setValueAtTime(v.gain.gain.value, t);
        v.gain.gain.linearRampToValueAtTime(0, t + 0.012);
      } catch { /* ignore */ }
      for (const n of v.nodes) { try { n.stop(t + 0.014); } catch { /* ignore */ } }
      v.endTime = t + 0.02;
    }
    this.dying.push(v);
  }

  private hardStop(v: Voice): void {
    for (const n of v.nodes) {
      try { n.stop(); } catch { /* ignore */ }
      try { n.disconnect(); } catch { /* ignore */ }
    }
    v.nodes.length = 0;
    try { v.panner.disconnect(); } catch { /* ignore */ }
    v.connectedTo = null;
  }

  private recycle(v: Voice): void {
    for (const n of v.nodes) { try { n.disconnect(); } catch { /* ignore */ } }
    v.nodes.length = 0;
    try { v.panner.disconnect(); } catch { /* ignore */ }
    v.connectedTo = null;
    try { v.gain.gain.cancelScheduledValues(0); } catch { /* ignore */ }
    if (this.pool.length < 40) this.pool.push(v);
    else { try { v.gain.disconnect(); } catch { /* ignore */ } }
  }

  private scheduleReap(): void {
    if (this.reapTimer !== null || this.disposed || !this.ac) return;
    let soonest = Infinity;
    for (const v of this.live) if (v.endTime < soonest) soonest = v.endTime;
    for (const v of this.dying) if (v.endTime < soonest) soonest = v.endTime;
    if (soonest === Infinity) return;
    const ms = clamp((soonest - this.ac.currentTime) * 1000 + 45, 50, 4000);
    this.reapTimer = setTimeout(() => { this.reapTimer = null; this.reap(); }, ms);
  }

  private reap(): void {
    if (this.disposed || !this.ac) return;
    const t = this.ac.currentTime + 0.005;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const v = this.live[i];
      if (v.endTime <= t) {
        this.live.splice(i, 1);
        if (v.budgeted) this.budgetCount = Math.max(0, this.budgetCount - 1);
        this.recycle(v);
      }
    }
    for (let i = this.dying.length - 1; i >= 0; i--) {
      const v = this.dying[i];
      if (v.endTime <= t) { this.dying.splice(i, 1); this.recycle(v); }
    }
    this.scheduleReap();
  }

  /** Immediately silence every one-shot (scene change, pause, dispose). */
  stopAllVoices(): void {
    for (const v of this.live) { this.hardStop(v); this.recycle(v); }
    this.live.length = 0;
    this.budgetCount = 0;
    for (const v of this.dying) { this.hardStop(v); this.recycle(v); }
    this.dying.length = 0;
  }

  /** Cached noise buffer for this context — never allocated per shot. */
  noise(kind: NoiseKind = 'white'): AudioBuffer | null {
    if (!this.ac) return null;
    return getNoiseBuffer(this.ac, kind);
  }
}

function isBus(b: string): b is BusName {
  return b === 'master' || b === 'sfx' || b === 'crowd' || b === 'music' || b === 'ui';
}

type AudioContextCtor = new (options?: AudioContextOptions) => AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  const g = globalThis as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return g.AudioContext ?? g.webkitAudioContext ?? null;
}
