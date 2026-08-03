/**
 * GRIDIRON OVERDRIVE — event→sound mapping and dynamic mixing.
 *
 * `AudioDirector` is the only place that knows what a GameEvent *means* for the mix:
 * which one-shot fires, how hard the crowd reacts, what gets ducked. Sfx and CrowdBed
 * stay dumb instruments; this is the mixer engineer.
 *
 * `MusicDirector` owns the tempo-locked menu loop and the musical stingers that sit
 * on top of the sfx ones.
 */

import { clamp, clamp01 } from '../core/math.ts';
import { FIELD_HALF_WIDTH, FIELD_LENGTH } from '../core/constants.ts';
import type { AthleteId, GameEvent, TeamSide, Vec3 } from '../core/types.ts';
import type { EventBus } from '../core/events.ts';
import { AudioEngine } from './engine.ts';
import { Sfx } from './sfx.ts';
import { CrowdBed } from './crowd.ts';
import { noiseBurst, thump, tone, stab, brass, chime, grit, metallic, rnd } from './synth.ts';

/** Crowd energy the stadium settles back to between snaps. */
const BASE_ENERGY = 0.26;
/** Inside this many yards of a goal line the building wakes up. */
const GOAL_LINE_YARDS = 14;

export class AudioDirector {
  private engine: AudioEngine;
  private sfx: Sfx;
  private crowd: CrowdBed;
  private music: MusicDirector;

  private bus: EventBus | null = null;
  private unsub: (() => void) | null = null;
  /** Guards against double delivery when the shell also forwards events. */
  private lastEvent: GameEvent | null = null;

  private panResolver: ((id: AthleteId) => number) | null = null;
  private spotZ = 50;
  private chantPending = false;
  private disposed = false;

  constructor(engine: AudioEngine, sfx: Sfx, crowd: CrowdBed, music: MusicDirector) {
    this.engine = engine;
    this.sfx = sfx;
    this.crowd = crowd;
    this.music = music;
  }

  // ── wiring ──────────────────────────────────────────────────────────────

  /** Subscribe to a match bus. Safe to call when the shell also forwards events. */
  attach(bus: EventBus): void {
    if (this.disposed) return;
    this.detach();
    this.bus = bus;
    this.unsub = bus.on('*', (e) => this.handle(e));
    this.crowd.start();
    this.crowd.setEnergy(BASE_ENERGY, 1200);
    this.spotZ = FIELD_LENGTH / 2;
  }

  get attached(): boolean { return this.bus !== null; }

  detach(): void {
    if (this.unsub) { this.unsub(); this.unsub = null; }
    this.bus = null;
    this.crowd.chant(0);
    this.crowd.stop();
  }

  /** Lets the shell map an athlete to a stereo position. Optional. */
  setPanResolver(fn: ((id: AthleteId) => number) | null): void { this.panResolver = fn; }

  /** 0..1 share of the crowd pulling for HOME. 0.5 for neutral sites. */
  setHomeBias(b: number): void { this.crowd.setHomeBias(b); }

  /** Optional per-frame hook. The mix is schedule-driven, so this is not required. */
  update(_dt: number): void { /* reserved: the crowd bed runs on its own clock */ }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.detach();
  }

  // ── helpers ─────────────────────────────────────────────────────────────

  private panAt(v: Vec3): number { return clamp(v.x / FIELD_HALF_WIDTH, -1, 1) * 0.72; }

  private panFor(id: AthleteId): number {
    if (this.panResolver) {
      const p = this.panResolver(id);
      return Number.isFinite(p) ? clamp(p, -1, 1) : 0;
    }
    // Stable pseudo-spread so two athletes are not stacked in the centre.
    return ((((id * 37) % 11) - 5) / 5) * 0.22;
  }

  private goalLineHeat(): number {
    const d = Math.min(this.spotZ, FIELD_LENGTH - this.spotZ);
    if (d >= GOAL_LINE_YARDS) return 0;
    return (1 - d / GOAL_LINE_YARDS) * 0.24;
  }

  /** Push a stinger through by getting the crowd and the music out of its way. */
  private duckUnderSting(amount: number, holdMs: number): void {
    this.engine.duck('crowd', amount, 45, holdMs, 750);
    this.engine.duck('music', amount * 0.8, 35, holdMs, 600);
  }

  // ── event mapping ───────────────────────────────────────────────────────

  handle(e: GameEvent): void {
    if (this.disposed || !e) return;
    if (e === this.lastEvent) return;   // shell forwarded what we already heard
    this.lastEvent = e;

    switch (e.type) {
      case 'play.start':
        this.crowd.setEnergy(BASE_ENERGY + this.goalLineHeat(), 900);
        return;

      case 'snap':
        if (this.chantPending) { this.crowd.chant(0); this.chantPending = false; }
        this.sfx.snap(0);
        return;

      case 'handoff':
        this.sfx.lateral(this.panFor(e.to));
        return;

      case 'throw':
        this.sfx.throw(this.panFor(e.from), e.passKind === 'BULLET' ? 1.25 : e.passKind === 'TOUCH' ? 0.75 : 1);
        return;

      case 'pass.arrive':
        // Anticipation only — the catch/drop/swat that follows carries the hit.
        this.crowd.setEnergy(BASE_ENERGY + this.goalLineHeat() + 0.08, 260);
        return;

      case 'catch': {
        const pan = this.panFor(e.by);
        if (e.contested) this.sfx.catchContested(pan); else this.sfx.catchGood(pan);
        if (e.diving) this.sfx.dive(pan);
        const big = clamp01((e.yards - 8) / 26);
        if (big > 0.05 || e.contested) this.crowd.swell(0.3 + big * 0.7 + (e.contested ? 0.15 : 0), 1500);
        return;
      }

      case 'drop':
        this.sfx.drop(this.panFor(e.by));
        this.crowd.gasp(0.8);
        return;

      // A bobble is a gasp that has not resolved yet. The crowd noise deliberately RISES and is
      // left hanging — whatever happens next (catch, pick, incomplete) supplies its own resolution.
      case 'bobble':
        this.sfx.drop(this.panFor(e.by));
        this.crowd.gasp(0.55);
        this.crowd.swell(0.5, 1100);
        return;

      case 'swat':
        this.sfx.swat(this.panFor(e.by));
        this.crowd.swell(0.35, 900);
        return;

      case 'interception':
        this.sfx.intercept(this.panFor(e.by));
        this.duckUnderSting(0.45, 420);
        this.sfx.turnoverSting();
        this.music.sting('turnover');
        return;

      case 'lateral':
        this.sfx.lateral(this.panFor(e.to));
        return;

      case 'fumble':
        this.sfx.fumble(this.panFor(e.by));
        this.crowd.gasp(1);
        this.crowd.swell(0.55, 1800);
        return;

      case 'recover':
        this.sfx.recover(this.panFor(e.by));
        this.crowd.swellFor(e.side, 0.7);
        return;

      case 'tackle':
        if (e.power >= 0.85) this.sfx.tackleBig(this.panFor(e.on));
        else this.sfx.tackleStd(this.panFor(e.on));
        if (e.power >= 0.85) this.crowd.swell(0.3 + e.power * 0.2, 1100);
        return;

      case 'bigHit':
        this.sfx.tackleBig(this.panFor(e.on));
        this.crowd.swell(0.55 + clamp01(e.power - 1) * 0.4, 1700);
        return;

      case 'brokenTackle':
        this.sfx.brokenTackle(this.panFor(e.by));
        this.crowd.swell(0.45, 1300);
        return;

      case 'sack':
        this.sfx.tacklePower(this.panFor(e.on));
        this.crowd.swell(0.8, 2000);
        return;

      case 'move': {
        const pan = this.panFor(e.by);
        if (e.move === 'SPIN') this.sfx.spin(pan);
        else if (e.move === 'JUKE') this.sfx.juke(pan);
        else if (e.move === 'DIVE') this.sfx.dive(pan);
        else if (e.move === 'STIFFARM') this.sfx.stiffArm(pan);
        else this.sfx.hurdle(pan);
        return;
      }

      case 'block.win':
        this.sfx.bodyContact(e.pancake ? 1.0 : 0.4, this.panFor(e.on));
        if (e.pancake) this.crowd.swell(0.3, 900);
        return;

      case 'firstDown':
        this.sfx.firstDown(0);
        this.sfx.downMarker(0.3);
        this.crowd.swellFor(e.side, 0.5);
        return;

      case 'down.change':
        this.sfx.downMarker(0.3);
        return;

      case 'turnover':
        this.duckUnderSting(0.5, 500);
        if (e.kind === 'INT' || e.kind === 'FUMBLE') {
          this.sfx.turnoverSting();
          this.music.sting('turnover');
        }
        // The building reacts for whoever just gained the ball; the crowd that lost
        // it gets pulled down by swellFor's bias handling.
        this.crowd.swellFor(e.to, e.kind === 'PUNT' ? 0.25 : 0.95, 2400);
        return;

      case 'touchdown':
        this.duckUnderSting(0.55, 700);
        this.sfx.touchdownSting();
        this.music.sting('touchdown');
        this.crowd.swellFor(e.side, 1.5, 4200);
        this.spotZ = e.side === 0 ? FIELD_LENGTH : 0;
        return;

      case 'fieldGoal.attempt':
        this.crowd.setEnergy(0.5 + clamp01((e.distance - 20) / 40) * 0.2, 700);
        return;

      case 'fieldGoal.result':
        this.duckUnderSting(0.4, 420);
        if (e.good) { this.sfx.fieldGoalGood(); this.music.sting('fieldGoal'); this.crowd.swellFor(e.side, 1.0, 2600); }
        else { this.sfx.fieldGoalMiss(); this.music.sting('miss'); this.crowd.gasp(1.1); this.crowd.swellFor(e.side === 0 ? 1 : 0, 0.6, 1800); }
        return;

      case 'punt':
        this.sfx.punt(0);
        this.crowd.setEnergy(BASE_ENERGY * 0.8, 1500);
        return;

      case 'kickoff':
        this.sfx.kick(0);
        this.crowd.swell(e.onside ? 0.9 : 0.45, 1800);
        return;

      case 'safety':
        this.duckUnderSting(0.5, 600);
        this.sfx.safety();
        this.crowd.swellFor(e.against === 0 ? 1 : 0, 1.1, 2600);
        return;

      case 'touchback':
        this.sfx.whistle(0);
        this.crowd.setEnergy(BASE_ENERGY * 0.85, 1400);
        return;

      case 'extraPoint':
      case 'twoPoint':
        if (e.good) { this.sfx.fieldGoalGood(); this.crowd.swellFor(e.side, 0.6, 1600); }
        else { this.sfx.fieldGoalMiss(); this.crowd.gasp(0.9); }
        return;

      case 'outOfBounds':
        this.sfx.whistle(this.panAt(e.at));
        return;

      case 'overdrive.charge':
        if (e.progress > 0.32) this.sfx.countdownTick(0);
        return;

      case 'overdrive.start':
        this.duckUnderSting(0.5, 900);
        this.sfx.overdriveStart();
        this.music.sting('overdrive');
        this.music.setIntensity(1);
        this.crowd.swellFor(e.side, 1.3, 4000);
        return;

      case 'overdrive.end':
        this.sfx.overdriveEnd();
        this.music.setIntensity(0.45);
        return;

      case 'play.end': {
        this.spotZ = clamp(e.spotZ, -10, FIELD_LENGTH + 10);
        const scored = e.reason === 'TOUCHDOWN' || e.reason === 'SAFETY'
          || e.reason === 'FIELD_GOAL_GOOD' || e.reason === 'FIELD_GOAL_MISS';
        if (!scored && e.reason !== 'TIME_EXPIRED') this.sfx.whistle(0);
        if (!scored) {
          const gain = clamp01(Math.abs(e.yards) / 30) * 0.35;
          this.crowd.setEnergy(BASE_ENERGY + this.goalLineHeat() + gain, 1600);
        }
        return;
      }

      case 'quarter.end':
        this.sfx.quarterEnd();
        this.crowd.setEnergy(0.42, 2000);
        if (e.quarter >= 3) { this.crowd.chant(96); this.chantPending = true; }
        return;

      case 'half':
        this.sfx.quarterEnd();
        this.crowd.setEnergy(0.35, 2500);
        return;

      case 'overtime':
        this.sfx.quarterEnd();
        this.crowd.setEnergy(0.65, 1800);
        this.crowd.chant(104);
        this.chantPending = true;
        return;

      case 'match.end':
        this.duckUnderSting(0.5, 900);
        this.sfx.gameEnd();
        this.music.sting(e.winner === 'TIE' ? 'quarter' : 'win');
        if (e.winner !== 'TIE') this.crowd.swellFor(e.winner, 1.4, 5000);
        else this.crowd.swell(0.7, 3000);
        this.crowd.chant(0);
        this.chantPending = false;
        return;

      case 'crowd.swell':
        this.crowd.swellFor(e.side, clamp(e.power, 0, 1.5));
        return;

      case 'ui.tick': this.sfx.menuMove(); return;
      case 'ui.confirm': this.sfx.menuSelect(); return;
      case 'ui.back': this.sfx.menuBack(); return;

      case 'camera.impulse':
      case 'rules.watchdog':
        return;

      default:
        // Presentation must tolerate unknown event types (ARCHITECTURE §7).
        return;
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────

export type StingKind =
  | 'touchdown' | 'turnover' | 'fieldGoal' | 'miss' | 'overdrive' | 'quarter' | 'win' | 'lose';

const BPM = 104;
const STEPS_PER_BAR = 16;
const BARS = 4;
/** Semitone offsets of each bar's root above the tonic. */
const PROGRESSION = [0, 8, 3, 10];
const IS_MINOR = [true, false, false, false];
const TONIC_HZ = 110; // A2 — nothing to do with any real-world theme.

const KICK_STEPS = [0, 6, 10];
const KICK_STEPS_HOT = [0, 3, 6, 8, 10, 14];
const SNARE_STEPS = [4, 12];
const BASS_STEPS = [0, 3, 6, 8, 11, 14];

/**
 * Low-intensity, loopable menu music plus tempo-locked stingers.
 * A lookahead scheduler writes ~350 ms of notes at a time, so the loop stays
 * sample-accurate regardless of frame hitching.
 */
export class MusicDirector {
  private engine: AudioEngine;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private wanted = false;
  private disposed = false;
  private intensity = 0.35;
  private step = 0;
  private nextTime = 0;

  constructor(engine: AudioEngine) {
    this.engine = engine;
    this.engine.onReady(() => { if (this.wanted) this.begin(); });
  }

  get isPlaying(): boolean { return this.running; }

  start(): void {
    if (this.disposed || this.wanted) return;
    this.wanted = true;
    this.begin();
  }

  stop(): void {
    this.wanted = false;
    this.running = false;
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null; }
  }

  setIntensity(v: number): void { this.intensity = clamp01(v); }
  getIntensity(): number { return this.intensity; }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
  }

  private begin(): void {
    if (this.running || this.disposed) return;
    const ctx = this.engine.context;
    if (!ctx) return;   // wait for unlock; onReady will call back
    this.running = true;
    this.step = 0;
    this.nextTime = ctx.currentTime + 0.08;
    this.timer = setInterval(() => this.schedule(), 45);
    this.schedule();
  }

  private get stepDur(): number { return 60 / BPM / 4; }

  private schedule(): void {
    const ctx = this.engine.context;
    if (!ctx || !this.running || this.disposed) return;
    const horizon = ctx.currentTime + 0.35;
    let guard = 0;
    while (this.nextTime < horizon && guard++ < 64) {
      this.emitStep(this.step, this.nextTime);
      this.nextTime += this.stepDur;
      this.step = (this.step + 1) % (STEPS_PER_BAR * BARS);
    }
    // Recover from tab-throttling rather than machine-gunning a backlog.
    if (this.nextTime < ctx.currentTime) this.nextTime = ctx.currentTime + 0.02;
  }

  /**
   * Time of the next 8th-note boundary on the loop's own grid, so a sting locks to
   * the music instead of landing wherever the event happened to fire. Returns 0 when
   * the wait would be long enough to feel like lag — then the caller plays it now.
   */
  private nextBeat(): number {
    const ctx = this.engine.context;
    if (!ctx || !this.running) return 0;
    const d = this.stepDur;
    let t = this.nextTime;
    let s = this.step;
    let guard = 0;
    while ((t < ctx.currentTime + 0.02 || s % 2 !== 0) && guard++ < 64) {
      t += d;
      s = (s + 1) % (STEPS_PER_BAR * BARS);
    }
    return t - ctx.currentTime > 0.26 ? 0 : t;
  }

  private emitStep(step: number, t: number): void {
    const bar = (step / STEPS_PER_BAR) | 0;
    const i = step % STEPS_PER_BAR;
    const inten = this.intensity;
    const root = TONIC_HZ * Math.pow(2, PROGRESSION[bar] / 12);
    const third = IS_MINOR[bar] ? 3 : 4;
    const chord = [0, third, 7, 12];

    if (KICK_STEPS.includes(i) || (inten > 0.55 && KICK_STEPS_HOT.includes(i))) {
      const v = this.engine.voice('music', { dur: 0.3, when: t, gain: 0.55 + inten * 0.25, budget: false });
      if (v) v.end(thump(v.ctx, v.dest, { t0: t, dur: 0.19, level: 0.85, f0: 128, f1: 42, click: 0.25, track: (n) => v.track(n) }));
    }

    if (SNARE_STEPS.includes(i)) {
      const v = this.engine.voice('music', { dur: 0.3, when: t, gain: 0.4 + inten * 0.25, budget: false });
      if (v) {
        const tr = (n: AudioScheduledSourceNode): void => v.track(n);
        let end = noiseBurst(v.ctx, v.dest, {
          t0: t, dur: 0.13, level: 0.5, kind: 'white', filter: 'highpass', freq: 1500, q: 0.7, attack: 0.001, track: tr,
        });
        end = Math.max(end, tone(v.ctx, v.dest, { t0: t, dur: 0.09, level: 0.3, freq: 196, freqEnd: 150, wave: 'sine', track: tr }));
        v.end(end);
      }
    }

    if (inten > 0.25 && i % 2 === 1) {
      const v = this.engine.voice('music', { dur: 0.1, when: t, gain: 0.12 + inten * 0.14, budget: false, pan: rnd(-0.2, 0.2) });
      if (v) v.end(noiseBurst(v.ctx, v.dest, {
        t0: t, dur: 0.035, level: 0.3, kind: 'white', filter: 'highpass', freq: 7800, attack: 0.0008, track: (n) => v.track(n),
      }));
    }

    if (BASS_STEPS.includes(i)) {
      const v = this.engine.voice('music', { dur: 0.25, when: t, gain: 0.4 + inten * 0.2, budget: false });
      if (v) v.end(tone(v.ctx, v.dest, {
        t0: t, dur: 0.14, level: 0.42, freq: root / 2, wave: 'square',
        index: 0.5, ratio: 2, indexEnd: 0.05, attack: 0.004, track: (n) => v.track(n),
      }));
    }

    // Arpeggio: 16ths through the chord, octave-hopping every other bar.
    if (inten > 0.12) {
      const octave = (step >> 3) % 2 === 1 ? 2 : 1;
      const note = chord[(step + bar) % chord.length];
      const f = root * Math.pow(2, note / 12) * 2 * octave;
      const v = this.engine.voice('music', {
        dur: 0.22, when: t, gain: 0.1 + inten * 0.22, budget: false, pan: (i % 4 < 2 ? -1 : 1) * 0.22,
      });
      if (v) v.end(stab(v.ctx, v.dest, {
        t0: t, dur: 0.14, level: 0.3, freq: f, chord: [0], wave: i % 4 === 0 ? 'square' : 'sawtooth',
        cutoff: 1400 + inten * 3600, cutoffEnd: 700, q: 6, spread: 5, track: (n) => v.track(n),
      }));
    }
  }

  /** Short musical hit layered over the sfx stinger. Quantised when music is running. */
  sting(kind: StingKind): void {
    const ctx = this.engine.context;
    if (!ctx || this.disposed) return;
    const quant = this.nextBeat();
    const when = quant > 0 ? quant : ctx.currentTime + 0.005;
    const v = this.engine.voice('music', { dur: 2.6, when, gain: 0.75, budget: false, protect: true });
    if (!v) return;
    const tr = (n: AudioScheduledSourceNode): void => v.track(n);
    const t0 = v.t0;
    let end = t0;

    switch (kind) {
      case 'touchdown':
        end = brass(ctx, v.dest, { t0, dur: 0.9, level: 0.42, freq: 233.1, chord: [0, 7, 12, 16, 19], bite: 1.3, vibrato: 0.6, track: tr });
        end = Math.max(end, thump(ctx, v.dest, { t0, dur: 0.6, level: 0.5, f0: 140, f1: 32, click: 0.4, track: tr }));
        for (let i = 0; i < 4; i++) {
          end = Math.max(end, stab(ctx, v.dest, {
            t0: t0 + 0.5 + i * 0.075, dur: 0.2, level: 0.24, freq: 466.2 * Math.pow(2, [0, 4, 7, 12][i] / 12),
            chord: [0], wave: 'square', cutoff: 5200, cutoffEnd: 1400, q: 5, track: tr,
          }));
        }
        break;
      case 'turnover':
        end = stab(ctx, v.dest, { t0, dur: 0.8, level: 0.4, freq: 155.6, chord: [0, 3, 6, 9], cutoff: 2600, cutoffEnd: 320, q: 5, spread: 20, track: tr });
        end = Math.max(end, grit(ctx, v.dest, { t0, dur: 0.7, level: 0.2, freq: 155, freqEnd: 62, drive: 18, cutoff: 1600, cutoffEnd: 260, track: tr }));
        break;
      case 'fieldGoal':
        end = chime(ctx, v.dest, { t0, dur: 0.7, level: 0.32, freq: 1046, partials: [1, 2, 3.01, 4.99], track: tr });
        end = Math.max(end, brass(ctx, v.dest, { t0, dur: 0.6, level: 0.3, freq: 261.6, chord: [0, 7, 12], bite: 0.9, track: tr }));
        break;
      case 'miss':
        end = stab(ctx, v.dest, { t0, dur: 0.7, level: 0.32, freq: 146.8, chord: [0, 1, 6], cutoff: 1800, cutoffEnd: 260, q: 4, track: tr });
        break;
      case 'overdrive':
        end = grit(ctx, v.dest, { t0, dur: 0.9, level: 0.3, freq: 82, freqEnd: 330, drive: 28, cutoff: 400, cutoffEnd: 4200, q: 1.5, arch: true, track: tr });
        end = Math.max(end, metallic(ctx, v.dest, { t0: t0 + 0.55, dur: 1.0, level: 0.18, freq: 1245, ring: 0.9, partials: [1, 1.61, 2.49, 3.87], track: tr }));
        break;
      case 'quarter':
        end = stab(ctx, v.dest, { t0, dur: 0.6, level: 0.3, freq: 196, chord: [0, 5, 12], cutoff: 2200, cutoffEnd: 500, q: 3, track: tr });
        break;
      case 'win':
        end = brass(ctx, v.dest, { t0, dur: 1.5, level: 0.44, freq: 174.6, chord: [0, 7, 12, 16, 19], bite: 1.15, vibrato: 0.5, track: tr });
        end = Math.max(end, chime(ctx, v.dest, { t0: t0 + 0.35, dur: 1.2, level: 0.24, freq: 1396, partials: [1, 2, 3.01], track: tr }));
        break;
      case 'lose':
        end = brass(ctx, v.dest, { t0, dur: 1.3, level: 0.34, freq: 130.8, chord: [0, 3, 7, 10], bite: 0.7, track: tr });
        break;
      default:
        break;
    }
    v.end(end);
  }
}
