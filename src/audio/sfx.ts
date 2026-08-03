/**
 * GRIDIRON OVERDRIVE — named one-shots.
 *
 * Design rules for this file:
 *  - A hit is always three layers: sub thump (weight) + mid crack (edge) + high
 *    transient (bite). Drop any one and it stops feeling heavy.
 *  - Anything that repeats has at least three variants plus continuous pitch/level
 *    jitter, so a drive full of tackles never machine-guns.
 *  - No speech, no announcer, no literal referee whistle. The dead-ball cue is an
 *    original dual-tone horn.
 *  - Every method is a no-op when the engine has no AudioContext.
 */

import { clamp } from '../core/math.ts';
import { AudioEngine, type BusName, type VoiceSlot } from './engine.ts';
import {
  noiseBurst, thump, crack, whoosh, tone, chime, stab, brass, metallic, grit, rnd, vary,
} from './synth.ts';

type Track = (n: AudioScheduledSourceNode) => void;

interface Slot { v: VoiceSlot; t0: number; ctx: AudioContext; dest: AudioNode; tr: Track }

export class Sfx {
  private engine: AudioEngine;
  private lastAt = new Map<string, number>();
  private lastVariant = new Map<string, number>();
  private stepFlip = false;

  constructor(engine: AudioEngine) { this.engine = engine; }

  // ── plumbing ────────────────────────────────────────────────────────────

  /** `protect` marks a voice the steal logic must leave alone (stingers only). */
  private slot(bus: BusName, dur: number, pan: number, gain: number, protect = false): Slot | null {
    const v = this.engine.voice(bus, { dur, pan: clamp(pan, -1, 1), gain, protect });
    if (!v) return null;
    return { v, t0: v.t0, ctx: v.ctx, dest: v.dest, tr: (n) => v.track(n) };
  }

  /** Rate limit for sounds that can fire many times per second. */
  private gate(key: string, minSeconds: number): boolean {
    const now = this.engine.now;
    const prev = this.lastAt.get(key);
    if (prev !== undefined && now - prev < minSeconds) return false;
    this.lastAt.set(key, now);
    return true;
  }

  /** Pick a variant index, never the same one twice in a row. */
  private variant(key: string, n: number): number {
    if (n <= 1) return 0;
    const prev = this.lastVariant.get(key) ?? -1;
    let i = (Math.random() * n) | 0;
    if (i === prev) i = (i + 1 + ((Math.random() * (n - 1)) | 0)) % n;
    this.lastVariant.set(key, i);
    return i;
  }

  /**
   * The core impact stack. `power` 0..1.5 scales weight, length and bite.
   * Shared by contact, tackles, blocks and kicks so the game has one hit "voice".
   */
  private impact(s: Slot, power: number, flavour: number): number {
    const p = clamp(power, 0.1, 1.5);
    const subF0 = [168, 142, 196][flavour % 3] * (0.85 + p * 0.25);
    const subDur = 0.14 + p * 0.2;
    let end = thump(s.ctx, s.dest, {
      t0: s.t0, dur: subDur, level: 0.55 + p * 0.42,
      f0: subF0, f1: 34 + p * 10, click: 0.35 + p * 0.4, track: s.tr,
    });
    const midF = [1500, 1950, 1180][flavour % 3];
    end = Math.max(end, crack(s.ctx, s.dest, {
      t0: s.t0 + 0.002, dur: 0.055 + p * 0.05, level: 0.4 + p * 0.4,
      freq: vary(midF, 0.12), bite: 0.45 + p * 0.45, q: 1.3 + flavour * 0.2, track: s.tr,
    }));
    // Pad / cloth body so the impact has a surface, not just a boom.
    end = Math.max(end, noiseBurst(s.ctx, s.dest, {
      t0: s.t0 + 0.004, dur: 0.09 + p * 0.12, level: 0.18 + p * 0.22,
      kind: 'pink', filter: 'bandpass', freq: vary(420, 0.18), freqEnd: vary(240, 0.18),
      q: 0.8, attack: 0.004, track: s.tr,
    }));
    if (p > 0.85) {
      // Extra sub tail for the biggest collisions.
      end = Math.max(end, thump(s.ctx, s.dest, {
        t0: s.t0 + 0.02, dur: 0.3 + p * 0.16, level: 0.3 * p, f0: 78, f1: 26, track: s.tr,
      }));
    }
    return end;
  }

  // ── snap / passing ──────────────────────────────────────────────────────

  snap(pan = 0): void {
    const s = this.slot('sfx', 0.2, pan, 0.55);
    if (!s) return;
    const k = this.variant('snap', 3);
    let end = thump(s.ctx, s.dest, { t0: s.t0, dur: 0.1, level: 0.5, f0: [110, 128, 96][k], f1: 46, click: 0.5, track: s.tr });
    end = Math.max(end, noiseBurst(s.ctx, s.dest, {
      t0: s.t0, dur: 0.05, level: 0.32, kind: 'white', filter: 'bandpass', freq: vary(2400, 0.15), q: 1.2, track: s.tr,
    }));
    end = Math.max(end, noiseBurst(s.ctx, s.dest, {
      t0: s.t0 + 0.006, dur: 0.07, level: 0.2, kind: 'pink', filter: 'bandpass', freq: 700, freqEnd: 430, q: 1, track: s.tr,
    }));
    s.v.end(end);
  }

  throw(pan = 0, power = 1): void {
    const s = this.slot('sfx', 0.34, pan, 0.5);
    if (!s) return;
    const p = clamp(power, 0.4, 1.3);
    let end = whoosh(s.ctx, s.dest, {
      t0: s.t0, dur: 0.16 + 0.06 / p, level: 0.42 * p, f0: vary(560, 0.15), f1: vary(3100, 0.15), q: 0.85,
      panFrom: clamp(pan - 0.2, -1, 1), panTo: clamp(pan + 0.25, -1, 1), track: s.tr,
    });
    end = Math.max(end, noiseBurst(s.ctx, s.dest, {
      t0: s.t0, dur: 0.035, level: 0.3 * p, kind: 'white', filter: 'highpass', freq: 2600, attack: 0.001, track: s.tr,
    }));
    end = Math.max(end, tone(s.ctx, s.dest, {
      t0: s.t0, dur: 0.07, level: 0.12 * p, freq: vary(320, 0.1), freqEnd: vary(180, 0.1), wave: 'triangle', track: s.tr,
    }));
    s.v.end(end);
  }

  catchGood(pan = 0): void {
    const s = this.slot('sfx', 0.24, pan, 0.6);
    if (!s) return;
    const k = this.variant('catch', 3);
    let end = noiseBurst(s.ctx, s.dest, {
      t0: s.t0, dur: 0.07, level: 0.55, kind: 'white', filter: 'bandpass',
      freq: vary([1250, 1600, 1000][k], 0.12), freqEnd: vary(700, 0.12), q: 1.1, attack: 0.0012, track: s.tr,
    });
    end = Math.max(end, thump(s.ctx, s.dest, { t0: s.t0, dur: 0.09, level: 0.42, f0: 168, f1: 62, track: s.tr }));
    end = Math.max(end, noiseBurst(s.ctx, s.dest, {
      t0: s.t0 + 0.008, dur: 0.1, level: 0.16, kind: 'pink', filter: 'lowpass', freq: 900, q: 0.7, attack: 0.006, track: s.tr,
    }));
    s.v.end(end);
  }

  catchContested(pan = 0): void {
    const s = this.slot('sfx', 0.42, pan, 0.7);
    if (!s) return;
    let end = this.impact(s, 0.6, this.variant('catchC', 3));
    end = Math.max(end, noiseBurst(s.ctx, s.dest, {
      t0: s.t0 + 0.03, dur: 0.26, level: 0.24, kind: 'pink', filter: 'bandpass',
      freq: vary(1500, 0.2), freqEnd: vary(600, 0.2), q: 0.9, attack: 0.02, track: s.tr,
    }));
    s.v.end(end);
  }

  drop(pan = 0): void {
    const s = this.slot('sfx', 0.3, pan, 0.55);
    if (!s) return;
    let end = tone(s.ctx, s.dest, {
      t0: s.t0, dur: 0.16, level: 0.3, freq: vary(300, 0.06), freqEnd: vary(190, 0.06),
      wave: 'triangle', index: 2.4, ratio: 2.31, indexEnd: 0.2, attack: 0.002, track: s.tr,
    });
    end = Math.max(end, noiseBurst(s.ctx, s.dest, {
      t0: s.t0, dur: 0.09, level: 0.3, kind: 'white', filter: 'lowpass', freq: 1100, q: 0.9, track: s.tr,
    }));
    s.v.end(end);
  }

  swat(pan = 0): void {
    const s = this.slot('sfx', 0.2, pan, 0.65);
    if (!s) return;
    const k = this.variant('swat', 3);
    let end = crack(s.ctx, s.dest, {
      t0: s.t0, dur: 0.05, level: 0.7, freq: [2600, 3200, 2100][k], bite: 0.9, q: 1.1, track: s.tr,
    });
    end = Math.max(end, thump(s.ctx, s.dest, { t0: s.t0, dur: 0.06, level: 0.28, f0: 240, f1: 110, track: s.tr }));
    s.v.end(end);
  }

  intercept(pan = 0): void {
    const s = this.slot('sfx', 0.6, pan, 0.75, true);
    if (!s) return;
    let end = crack(s.ctx, s.dest, { t0: s.t0, dur: 0.06, level: 0.62, freq: 2300, bite: 0.9, track: s.tr });
    end = Math.max(end, thump(s.ctx, s.dest, { t0: s.t0, dur: 0.13, level: 0.5, f0: 200, f1: 58, click: 0.6, track: s.tr }));
    end = Math.max(end, tone(s.ctx, s.dest, {
      t0: s.t0 + 0.02, dur: 0.3, level: 0.24, freq: 330, freqEnd: 660, wave: 'square',
      index: 1.4, ratio: 1.5, indexEnd: 0.2, attack: 0.006, track: s.tr,
    }));
    s.v.end(end);
  }

  lateral(pan = 0): void {
    const s = this.slot('sfx', 0.2, pan, 0.45);
    if (!s) return;
    let end = noiseBurst(s.ctx, s.dest, {
      t0: s.t0, dur: 0.05, level: 0.34, kind: 'white', filter: 'bandpass', freq: vary(1500, 0.15), q: 1.4, track: s.tr,
    });
    end = Math.max(end, tone(s.ctx, s.dest, {
      t0: s.t0, dur: 0.11, level: 0.2, freq: vary(420, 0.08), freqEnd: vary(620, 0.08), wave: 'triangle', track: s.tr,
    }));
    s.v.end(end);
  }

  // ── locomotion ──────────────────────────────────────────────────────────

  private footstep(pan: number, right: boolean): void {
    if (!this.gate(right ? 'stepR' : 'stepL', 0.055)) return;
    const s = this.slot('sfx', 0.12, clamp(pan + (right ? 0.06 : -0.06), -1, 1), 0.3);
    if (!s) return;
    const k = this.variant('step', 4);
    const f = [560, 700, 460, 820][k];
    let end = noiseBurst(s.ctx, s.dest, {
      t0: s.t0, dur: 0.045 + Math.random() * 0.02, level: 0.4, kind: 'pink', filter: 'bandpass',
      freq: vary(f, 0.16), freqEnd: vary(f * 0.6, 0.16), q: 1.1, attack: 0.0015, track: s.tr,
    });
    end = Math.max(end, thump(s.ctx, s.dest, {
      t0: s.t0, dur: 0.05, level: 0.2, f0: vary(110, 0.14), f1: 52, track: s.tr,
    }));
    s.v.end(end);
  }

  footstepL(pan = 0): void { this.stepFlip = false; this.footstep(pan, false); }
  footstepR(pan = 0): void { this.stepFlip = true; this.footstep(pan, true); }
  /** Alternating convenience for callers that do not track feet. */
  footstep2(pan = 0): void { this.stepFlip = !this.stepFlip; this.footstep(pan, this.stepFlip); }

  sprint(pan = 0): void {
    if (!this.gate('sprint', 0.28)) return;
    const s = this.slot('sfx', 0.4, pan, 0.28);
    if (!s) return;
    const end = whoosh(s.ctx, s.dest, {
      t0: s.t0, dur: 0.34, level: 0.32, f0: vary(300, 0.2), f1: vary(1500, 0.2), q: 0.7,
      panFrom: clamp(pan - 0.3, -1, 1), panTo: clamp(pan + 0.3, -1, 1), track: s.tr,
    });
    s.v.end(end);
  }

  slide(pan = 0): void {
    const s = this.slot('sfx', 0.75, pan, 0.5);
    if (!s) return;
    let end = noiseBurst(s.ctx, s.dest, {
      t0: s.t0, dur: 0.55, level: 0.45, kind: 'pink', filter: 'bandpass',
      freq: vary(900, 0.15), freqEnd: vary(320, 0.15), q: 0.8, attack: 0.03, track: s.tr,
    });
    end = Math.max(end, noiseBurst(s.ctx, s.dest, {
      t0: s.t0, dur: 0.4, level: 0.2, kind: 'white', filter: 'lowpass', freq: 420, attack: 0.02, track: s.tr,
    }));
    end = Math.max(end, thump(s.ctx, s.dest, { t0: s.t0, dur: 0.13, level: 0.3, f0: 130, f1: 40, track: s.tr }));
    s.v.end(end);
  }

  // ── contact ─────────────────────────────────────────────────────────────

  /** Generic collision. `power` 0..1.5. Used for blocks and incidental contact. */
  bodyContact(power = 0.5, pan = 0): void {
    const p = clamp(power, 0.1, 1.5);
    if (p < 0.35 && !this.gate('contactLight', 0.06)) return;
    const s = this.slot('sfx', 0.4 + p * 0.3, pan, 0.4 + p * 0.35);
    if (!s) return;
    s.v.end(this.impact(s, p, this.variant('contact', 3)));
  }

  tackleStd(pan = 0): void {
    const s = this.slot('sfx', 0.5, pan, 0.62);
    if (!s) return;
    const k = this.variant('tackle', 3);
    let end = this.impact(s, 0.62, k);
    end = Math.max(end, noiseBurst(s.ctx, s.dest, {
      t0: s.t0 + 0.05, dur: 0.22, level: 0.16, kind: 'pink', filter: 'bandpass',
      freq: vary(700, 0.2), freqEnd: vary(360, 0.2), q: 0.7, attack: 0.02, track: s.tr,
    }));
    s.v.end(end);
  }

  tackleBig(pan = 0): void {
    const s = this.slot('sfx', 0.85, pan, 0.85);
    if (!s) return;
    const k = this.variant('tackleBig', 3);
    let end = this.impact(s, 1.15, k);
    end = Math.max(end, metallic(s.ctx, s.dest, {
      t0: s.t0 + 0.004, dur: 0.24, level: 0.16, freq: [520, 640, 430][k], ring: 0.4,
      partials: [1, 1.71, 2.44], track: s.tr,
    }));
    // Turf and air displaced.
    end = Math.max(end, noiseBurst(s.ctx, s.dest, {
      t0: s.t0 + 0.03, dur: 0.36, level: 0.2, kind: 'pink', filter: 'lowpass',
      freq: 900, freqEnd: 260, attack: 0.015, track: s.tr,
    }));
    s.v.end(end);
  }

  tacklePower(pan = 0): void {
    const s = this.slot('sfx', 1.0, pan, 0.9);
    if (!s) return;
    const k = this.variant('tacklePow', 3);
    let end = this.impact(s, 1.4, k);
    end = Math.max(end, grit(s.ctx, s.dest, {
      t0: s.t0, dur: 0.26, level: 0.24, freq: vary(120, 0.1), freqEnd: vary(48, 0.1),
      drive: 18, cutoff: 900, cutoffEnd: 260, q: 1.2, track: s.tr,
    }));
    end = Math.max(end, thump(s.ctx, s.dest, { t0: s.t0 + 0.05, dur: 0.5, level: 0.3, f0: 64, f1: 22, track: s.tr }));
    s.v.end(end);
  }

  brokenTackle(pan = 0): void {
    const s = this.slot('sfx', 0.5, pan, 0.6);
    if (!s) return;
    let end = noiseBurst(s.ctx, s.dest, {
      t0: s.t0, dur: 0.3, level: 0.42, kind: 'white', filter: 'bandpass',
      freq: vary(1100, 0.2), freqEnd: vary(2600, 0.2), q: 1.6, attack: 0.01, track: s.tr,
    });
    end = Math.max(end, thump(s.ctx, s.dest, { t0: s.t0, dur: 0.12, level: 0.4, f0: 150, f1: 60, click: 0.3, track: s.tr }));
    end = Math.max(end, tone(s.ctx, s.dest, {
      t0: s.t0 + 0.02, dur: 0.26, level: 0.2, freq: 260, freqEnd: 520, wave: 'sawtooth',
      index: 0.9, ratio: 2, indexEnd: 0.1, attack: 0.01, track: s.tr,
    }));
    s.v.end(end);
  }

  hurdle(pan = 0): void {
    const s = this.slot('sfx', 0.5, pan, 0.5);
    if (!s) return;
    let end = whoosh(s.ctx, s.dest, {
      t0: s.t0, dur: 0.36, level: 0.4, f0: vary(340, 0.15), f1: vary(2200, 0.15), q: 0.8, track: s.tr,
    });
    end = Math.max(end, noiseBurst(s.ctx, s.dest, {
      t0: s.t0, dur: 0.07, level: 0.25, kind: 'pink', filter: 'bandpass', freq: 620, freqEnd: 300, q: 1, track: s.tr,
    }));
    s.v.end(end);
  }

  spin(pan = 0): void {
    const s = this.slot('sfx', 0.5, pan, 0.5);
    if (!s) return;
    let end = whoosh(s.ctx, s.dest, {
      t0: s.t0, dur: 0.3, level: 0.42, f0: vary(700, 0.15), f1: vary(1800, 0.15), q: 1.5,
      panFrom: clamp(pan - 0.6, -1, 1), panTo: clamp(pan + 0.6, -1, 1), track: s.tr,
    });
    end = Math.max(end, tone(s.ctx, s.dest, {
      t0: s.t0, dur: 0.28, level: 0.14, freq: vary(380, 0.1), freqEnd: vary(240, 0.1),
      wave: 'triangle', index: 1.2, ratio: 1.41, indexEnd: 0.2, attack: 0.02, track: s.tr,
    }));
    s.v.end(end);
  }

  /**
   * A juke is heard from the ground up: cleats biting turf, then the body going the other way.
   * Shorter and quieter than the spin on purpose — it is the cheap move, and if it were as loud
   * as the spin the mix would read them as the same event.
   */
  juke(pan = 0): void {
    const s = this.slot('sfx', 0.35, pan, 0.45);
    if (!s) return;
    let end = noiseBurst(s.ctx, s.dest, {
      t0: s.t0, dur: 0.11, level: 0.34, kind: 'white', filter: 'bandpass',
      freq: vary(1500, 0.15), freqEnd: vary(520, 0.15), q: 1.4, attack: 0.004, track: s.tr,
    });
    end = Math.max(end, whoosh(s.ctx, s.dest, {
      t0: s.t0 + 0.03, dur: 0.18, level: 0.26, f0: vary(520, 0.15), f1: vary(1400, 0.15), q: 1.1,
      panFrom: pan, panTo: clamp(pan + 0.45, -1, 1), track: s.tr,
    }));
    s.v.end(end);
  }

  stiffArm(pan = 0): void {
    const s = this.slot('sfx', 0.35, pan, 0.6);
    if (!s) return;
    let end = crack(s.ctx, s.dest, { t0: s.t0, dur: 0.06, level: 0.55, freq: vary(1900, 0.12), bite: 0.7, track: s.tr });
    end = Math.max(end, thump(s.ctx, s.dest, { t0: s.t0, dur: 0.14, level: 0.45, f0: 180, f1: 50, click: 0.3, track: s.tr }));
    s.v.end(end);
  }

  dive(pan = 0): void {
    const s = this.slot('sfx', 0.7, pan, 0.6);
    if (!s) return;
    let end = whoosh(s.ctx, s.dest, { t0: s.t0, dur: 0.22, level: 0.3, f0: 400, f1: 1500, track: s.tr });
    end = Math.max(end, thump(s.ctx, s.dest, { t0: s.t0 + 0.16, dur: 0.16, level: 0.5, f0: 140, f1: 38, click: 0.4, track: s.tr }));
    end = Math.max(end, noiseBurst(s.ctx, s.dest, {
      t0: s.t0 + 0.16, dur: 0.36, level: 0.34, kind: 'pink', filter: 'bandpass',
      freq: vary(800, 0.2), freqEnd: vary(280, 0.2), q: 0.8, attack: 0.006, track: s.tr,
    }));
    s.v.end(end);
  }

  // ── ball security ───────────────────────────────────────────────────────

  fumble(pan = 0): void {
    const s = this.slot('sfx', 0.8, pan, 0.8, true);
    if (!s) return;
    let end = this.impact(s, 0.9, this.variant('fumble', 3));
    end = Math.max(end, metallic(s.ctx, s.dest, {
      t0: s.t0 + 0.01, dur: 0.5, level: 0.2, freq: 760, ring: 0.5, partials: [1, 1.83, 2.77, 4.1], track: s.tr,
    }));
    end = Math.max(end, tone(s.ctx, s.dest, {
      t0: s.t0 + 0.04, dur: 0.45, level: 0.22, freq: 620, freqEnd: 240, wave: 'square',
      index: 1.8, ratio: 1.33, indexEnd: 0.4, attack: 0.004, track: s.tr,
    }));
    s.v.end(end);
  }

  recover(pan = 0): void {
    const s = this.slot('sfx', 0.7, pan, 0.7);
    if (!s) return;
    let end = thump(s.ctx, s.dest, { t0: s.t0, dur: 0.16, level: 0.5, f0: 160, f1: 44, click: 0.5, track: s.tr });
    end = Math.max(end, stab(s.ctx, s.dest, {
      t0: s.t0 + 0.02, dur: 0.34, level: 0.4, freq: 262, chord: [0, 7, 12], cutoff: 3200, cutoffEnd: 900, track: s.tr,
    }));
    end = Math.max(end, stab(s.ctx, s.dest, {
      t0: s.t0 + 0.14, dur: 0.34, level: 0.36, freq: 349, chord: [0, 7, 12], cutoff: 3600, cutoffEnd: 1100, track: s.tr,
    }));
    s.v.end(end);
  }

  // ── kicking ─────────────────────────────────────────────────────────────

  kick(pan = 0): void {
    const s = this.slot('sfx', 0.5, pan, 0.85);
    if (!s) return;
    const k = this.variant('kick', 3);
    let end = thump(s.ctx, s.dest, {
      t0: s.t0, dur: 0.16, level: 0.9, f0: [190, 220, 165][k], f1: 44, click: 0.9, track: s.tr,
    });
    end = Math.max(end, crack(s.ctx, s.dest, { t0: s.t0, dur: 0.05, level: 0.62, freq: vary(2600, 0.12), bite: 1, track: s.tr }));
    end = Math.max(end, noiseBurst(s.ctx, s.dest, {
      t0: s.t0 + 0.01, dur: 0.24, level: 0.16, kind: 'pink', filter: 'bandpass',
      freq: 900, freqEnd: 2800, q: 0.6, attack: 0.03, track: s.tr,
    }));
    s.v.end(end);
  }

  punt(pan = 0): void {
    const s = this.slot('sfx', 0.55, pan, 0.8);
    if (!s) return;
    let end = thump(s.ctx, s.dest, { t0: s.t0, dur: 0.2, level: 0.85, f0: 150, f1: 38, click: 0.65, track: s.tr });
    end = Math.max(end, crack(s.ctx, s.dest, { t0: s.t0, dur: 0.06, level: 0.45, freq: vary(1700, 0.12), bite: 0.7, track: s.tr }));
    end = Math.max(end, whoosh(s.ctx, s.dest, { t0: s.t0 + 0.02, dur: 0.4, level: 0.22, f0: 500, f1: 1800, q: 0.7, track: s.tr }));
    s.v.end(end);
  }

  goalpostHit(pan = 0): void {
    const s = this.slot('sfx', 1.9, pan, 0.85, true);
    if (!s) return;
    const k = this.variant('post', 3);
    let end = metallic(s.ctx, s.dest, {
      t0: s.t0, dur: 1.6, level: 0.6, freq: [412, 468, 358][k], ring: 1.1,
      partials: [1, 1.732, 2.412, 3.19, 4.37, 5.83, 7.11], track: s.tr,
    });
    end = Math.max(end, thump(s.ctx, s.dest, { t0: s.t0, dur: 0.12, level: 0.4, f0: 210, f1: 70, click: 0.8, track: s.tr }));
    s.v.end(end);
  }

  // ── officiating cues (original, non-verbal) ─────────────────────────────

  /**
   * Dead-ball cue. Deliberately NOT a referee whistle — a short dual-tone horn,
   * two stacked FM voices a fifth apart with a slight downward tail.
   */
  whistle(pan = 0): void {
    const s = this.slot('sfx', 0.4, pan, 0.55, true);
    if (!s) return;
    const base = vary(596, 0.015);
    let end = tone(s.ctx, s.dest, {
      t0: s.t0, dur: 0.2, level: 0.4, freq: base, freqEnd: base * 0.965, wave: 'square',
      index: 0.55, ratio: 3.01, indexEnd: 0.25, attack: 0.006, track: s.tr,
    });
    end = Math.max(end, tone(s.ctx, s.dest, {
      t0: s.t0, dur: 0.2, level: 0.28, freq: base * 1.5, freqEnd: base * 1.45, wave: 'sawtooth',
      index: 0.35, ratio: 2.0, indexEnd: 0.1, attack: 0.008, track: s.tr,
    }));
    end = Math.max(end, noiseBurst(s.ctx, s.dest, {
      t0: s.t0, dur: 0.03, level: 0.16, kind: 'white', filter: 'highpass', freq: 3400, track: s.tr,
    }));
    s.v.end(end);
  }

  firstDown(pan = 0): void {
    const s = this.slot('sfx', 0.8, pan, 0.6, true);
    if (!s) return;
    let end = chime(s.ctx, s.dest, { t0: s.t0, dur: 0.34, level: 0.34, freq: 784, partials: [1, 2, 3.01], track: s.tr });
    end = Math.max(end, chime(s.ctx, s.dest, {
      t0: s.t0 + 0.1, dur: 0.5, level: 0.34, freq: 1046, partials: [1, 2, 2.99, 4.98], track: s.tr,
    }));
    end = Math.max(end, noiseBurst(s.ctx, s.dest, {
      t0: s.t0, dur: 0.12, level: 0.12, kind: 'white', filter: 'highpass', freq: 6200, attack: 0.004, track: s.tr,
    }));
    s.v.end(end);
  }

  downMarker(pan = 0): void {
    const s = this.slot('ui', 0.3, pan, 0.4);
    if (!s) return;
    const end = metallic(s.ctx, s.dest, {
      t0: s.t0, dur: 0.2, level: 0.34, freq: vary(1180, 0.04), ring: 0.35, partials: [1, 2.14, 3.41], track: s.tr,
    });
    s.v.end(end);
  }

  countdownTick(pan = 0): void {
    const s = this.slot('ui', 0.16, pan, 0.42);
    if (!s) return;
    let end = tone(s.ctx, s.dest, {
      t0: s.t0, dur: 0.075, level: 0.32, freq: 1320, wave: 'square', index: 0.4, ratio: 2, indexEnd: 0, attack: 0.001, track: s.tr,
    });
    end = Math.max(end, noiseBurst(s.ctx, s.dest, {
      t0: s.t0, dur: 0.02, level: 0.14, kind: 'white', filter: 'highpass', freq: 4200, track: s.tr,
    }));
    s.v.end(end);
  }

  // ── stingers ────────────────────────────────────────────────────────────

  turnoverSting(): void {
    const s = this.slot('sfx', 1.3, 0, 0.8, true);
    if (!s) return;
    let end = stab(s.ctx, s.dest, {
      t0: s.t0, dur: 0.5, level: 0.45, freq: 220, chord: [0, 3, 6, 10], wave: 'sawtooth',
      cutoff: 3400, cutoffEnd: 500, q: 4, spread: 14, track: s.tr,
    });
    end = Math.max(end, stab(s.ctx, s.dest, {
      t0: s.t0 + 0.16, dur: 0.7, level: 0.4, freq: 174.6, chord: [0, 3, 6, 10], wave: 'sawtooth',
      cutoff: 2400, cutoffEnd: 380, q: 4, spread: 16, track: s.tr,
    }));
    end = Math.max(end, thump(s.ctx, s.dest, { t0: s.t0, dur: 0.55, level: 0.6, f0: 120, f1: 26, click: 0.5, track: s.tr }));
    end = Math.max(end, grit(s.ctx, s.dest, {
      t0: s.t0 + 0.1, dur: 0.6, level: 0.16, freq: 180, freqEnd: 60, drive: 20, cutoff: 1400, cutoffEnd: 300, track: s.tr,
    }));
    s.v.end(end);
  }

  touchdownSting(): void {
    const s = this.slot('sfx', 2.0, 0, 0.95, true);
    if (!s) return;
    // Weight first: the room drops out from under the hit.
    let end = thump(s.ctx, s.dest, { t0: s.t0, dur: 0.7, level: 0.7, f0: 150, f1: 32, click: 0.8, track: s.tr });
    end = Math.max(end, noiseBurst(s.ctx, s.dest, {
      t0: s.t0, dur: 0.1, level: 0.3, kind: 'white', filter: 'highpass', freq: 3000, attack: 0.001, track: s.tr,
    }));
    // Two brass hits: root, then a lift up a fourth.
    end = Math.max(end, brass(s.ctx, s.dest, {
      t0: s.t0, dur: 0.42, level: 0.52, freq: 174.6, chord: [0, 7, 12, 16], bite: 1.15, track: s.tr,
    }));
    end = Math.max(end, brass(s.ctx, s.dest, {
      t0: s.t0 + 0.4, dur: 0.95, level: 0.58, freq: 233.1, chord: [0, 7, 12, 19], bite: 1.35, vibrato: 0.7, track: s.tr,
    }));
    end = Math.max(end, metallic(s.ctx, s.dest, {
      t0: s.t0 + 0.4, dur: 1.1, level: 0.2, freq: 1866, ring: 1, partials: [1, 1.51, 2.31, 3.44], track: s.tr,
    }));
    end = Math.max(end, thump(s.ctx, s.dest, { t0: s.t0 + 0.4, dur: 0.9, level: 0.45, f0: 116, f1: 29, track: s.tr }));
    s.v.end(end);
  }

  fieldGoalGood(): void {
    const s = this.slot('sfx', 1.5, 0, 0.8, true);
    if (!s) return;
    let end = 0;
    const notes = [523.3, 659.3, 784];
    for (let i = 0; i < notes.length; i++) {
      end = Math.max(end, chime(s.ctx, s.dest, {
        t0: s.t0 + i * 0.09, dur: 0.4 + i * 0.2, level: 0.3, freq: notes[i], partials: [1, 2, 3.01, 4.99], track: s.tr,
      }));
    }
    end = Math.max(end, brass(s.ctx, s.dest, {
      t0: s.t0 + 0.18, dur: 0.7, level: 0.36, freq: 261.6, chord: [0, 7, 12], bite: 1, track: s.tr,
    }));
    s.v.end(end);
  }

  fieldGoalMiss(): void {
    const s = this.slot('sfx', 1.2, 0, 0.7, true);
    if (!s) return;
    let end = tone(s.ctx, s.dest, {
      t0: s.t0, dur: 0.4, level: 0.3, freq: 415, freqEnd: 392, wave: 'sawtooth',
      index: 0.8, ratio: 1.414, indexEnd: 0.3, attack: 0.01, track: s.tr,
    });
    end = Math.max(end, tone(s.ctx, s.dest, {
      t0: s.t0 + 0.12, dur: 0.6, level: 0.3, freq: 293.7, freqEnd: 261, wave: 'sawtooth',
      index: 1.1, ratio: 1.414, indexEnd: 0.2, attack: 0.012, track: s.tr,
    }));
    end = Math.max(end, thump(s.ctx, s.dest, { t0: s.t0 + 0.1, dur: 0.4, level: 0.4, f0: 96, f1: 30, track: s.tr }));
    s.v.end(end);
  }

  safety(): void {
    const s = this.slot('sfx', 1.6, 0, 0.85, true);
    if (!s) return;
    let end = thump(s.ctx, s.dest, { t0: s.t0, dur: 0.6, level: 0.7, f0: 130, f1: 26, click: 0.7, track: s.tr });
    for (let i = 0; i < 2; i++) {
      end = Math.max(end, tone(s.ctx, s.dest, {
        t0: s.t0 + i * 0.28, dur: 0.26, level: 0.34, freq: 392 - i * 62, freqEnd: 349 - i * 62,
        wave: 'square', index: 0.6, ratio: 2.5, indexEnd: 0.2, attack: 0.006, track: s.tr,
      }));
    }
    end = Math.max(end, grit(s.ctx, s.dest, {
      t0: s.t0, dur: 0.8, level: 0.2, freq: 160, freqEnd: 70, drive: 16, cutoff: 1200, cutoffEnd: 260, track: s.tr,
    }));
    s.v.end(end);
  }

  // ── overdrive ───────────────────────────────────────────────────────────

  overdriveStart(): void {
    const s = this.slot('sfx', 1.5, 0, 0.85, true);
    if (!s) return;
    let end = grit(s.ctx, s.dest, {
      t0: s.t0, dur: 0.75, level: 0.42, freq: 70, freqEnd: 310, drive: 26,
      cutoff: 320, cutoffEnd: 3400, q: 1.4, arch: true, track: s.tr,
    });
    end = Math.max(end, noiseBurst(s.ctx, s.dest, {
      t0: s.t0, dur: 0.72, level: 0.24, kind: 'white', filter: 'bandpass',
      freq: 700, freqEnd: 7000, q: 1.2, arch: true, track: s.tr,
    }));
    end = Math.max(end, thump(s.ctx, s.dest, { t0: s.t0 + 0.68, dur: 0.5, level: 0.75, f0: 190, f1: 30, click: 0.8, track: s.tr }));
    end = Math.max(end, stab(s.ctx, s.dest, {
      t0: s.t0 + 0.68, dur: 0.6, level: 0.42, freq: 196, chord: [0, 7, 12, 15], wave: 'sawtooth',
      cutoff: 5200, cutoffEnd: 700, q: 3, spread: 18, track: s.tr,
    }));
    end = Math.max(end, metallic(s.ctx, s.dest, {
      t0: s.t0 + 0.7, dur: 0.9, level: 0.18, freq: 1570, ring: 0.9, partials: [1, 1.62, 2.51, 3.9], track: s.tr,
    }));
    s.v.end(end);
  }

  overdriveEnd(): void {
    const s = this.slot('sfx', 1.0, 0, 0.6, true);
    if (!s) return;
    let end = grit(s.ctx, s.dest, {
      t0: s.t0, dur: 0.6, level: 0.3, freq: 280, freqEnd: 62, drive: 14,
      cutoff: 2600, cutoffEnd: 260, q: 1.2, track: s.tr,
    });
    end = Math.max(end, tone(s.ctx, s.dest, {
      t0: s.t0, dur: 0.5, level: 0.22, freq: 392, freqEnd: 174, wave: 'triangle',
      index: 1.2, ratio: 1.5, indexEnd: 0.1, attack: 0.008, track: s.tr,
    }));
    s.v.end(end);
  }

  // ── period cues ─────────────────────────────────────────────────────────

  quarterEnd(): void {
    const s = this.slot('sfx', 1.4, 0, 0.7, true);
    if (!s) return;
    let end = 0;
    for (let i = 0; i < 2; i++) {
      const t = s.t0 + i * 0.34;
      end = Math.max(end, tone(s.ctx, s.dest, {
        t0: t, dur: 0.26, level: 0.4, freq: 233, freqEnd: 228, wave: 'square',
        index: 0.5, ratio: 3.0, indexEnd: 0.3, attack: 0.008, track: s.tr,
      }));
      end = Math.max(end, tone(s.ctx, s.dest, {
        t0: t, dur: 0.26, level: 0.26, freq: 349, freqEnd: 344, wave: 'sawtooth',
        index: 0.3, ratio: 2.0, indexEnd: 0.1, attack: 0.01, track: s.tr,
      }));
    }
    s.v.end(end);
  }

  gameEnd(): void {
    const s = this.slot('sfx', 2.6, 0, 0.85, true);
    if (!s) return;
    let end = 0;
    for (let i = 0; i < 3; i++) {
      end = Math.max(end, tone(s.ctx, s.dest, {
        t0: s.t0 + i * 0.3, dur: i === 2 ? 0.8 : 0.26, level: 0.38, freq: 220, freqEnd: 216,
        wave: 'square', index: 0.5, ratio: 3.0, indexEnd: 0.25, attack: 0.008, track: s.tr,
      }));
    }
    end = Math.max(end, brass(s.ctx, s.dest, {
      t0: s.t0 + 0.6, dur: 1.4, level: 0.5, freq: 146.8, chord: [0, 7, 12, 16, 19], bite: 1.1, vibrato: 0.5, track: s.tr,
    }));
    end = Math.max(end, thump(s.ctx, s.dest, { t0: s.t0 + 0.6, dur: 0.9, level: 0.5, f0: 130, f1: 28, click: 0.4, track: s.tr }));
    s.v.end(end);
  }

  // ── UI ──────────────────────────────────────────────────────────────────

  menuMove(): void {
    const s = this.slot('ui', 0.14, rnd(-0.08, 0.08), 0.4);
    if (!s) return;
    const end = tone(s.ctx, s.dest, {
      t0: s.t0, dur: 0.06, level: 0.34, freq: vary(880, 0.01), freqEnd: vary(1100, 0.01),
      wave: 'triangle', index: 1.1, ratio: 3.0, indexEnd: 0.1, attack: 0.0015, track: s.tr,
    });
    s.v.end(end);
  }

  menuSelect(): void {
    const s = this.slot('ui', 0.4, 0, 0.5);
    if (!s) return;
    let end = tone(s.ctx, s.dest, {
      t0: s.t0, dur: 0.08, level: 0.34, freq: 784, wave: 'triangle', index: 0.9, ratio: 2, indexEnd: 0.1, attack: 0.0015, track: s.tr,
    });
    end = Math.max(end, chime(s.ctx, s.dest, {
      t0: s.t0 + 0.055, dur: 0.28, level: 0.3, freq: 1174, partials: [1, 2, 3.01], track: s.tr,
    }));
    s.v.end(end);
  }

  menuBack(): void {
    const s = this.slot('ui', 0.3, 0, 0.45);
    if (!s) return;
    let end = tone(s.ctx, s.dest, {
      t0: s.t0, dur: 0.07, level: 0.3, freq: 587, wave: 'triangle', index: 0.8, ratio: 2, indexEnd: 0.1, attack: 0.0015, track: s.tr,
    });
    end = Math.max(end, tone(s.ctx, s.dest, {
      t0: s.t0 + 0.05, dur: 0.14, level: 0.26, freq: 392, freqEnd: 370, wave: 'triangle',
      index: 0.6, ratio: 2, indexEnd: 0.05, attack: 0.002, track: s.tr,
    }));
    s.v.end(end);
  }

  menuError(): void {
    const s = this.slot('ui', 0.3, 0, 0.5);
    if (!s) return;
    let end = tone(s.ctx, s.dest, {
      t0: s.t0, dur: 0.16, level: 0.3, freq: 164.8, wave: 'square', index: 1.6, ratio: 1.06, indexEnd: 1.2, attack: 0.002, track: s.tr,
    });
    end = Math.max(end, tone(s.ctx, s.dest, {
      t0: s.t0, dur: 0.16, level: 0.22, freq: 174.2, wave: 'square', index: 1.4, ratio: 1.06, indexEnd: 1.0, attack: 0.002, track: s.tr,
    }));
    s.v.end(end);
  }
}
