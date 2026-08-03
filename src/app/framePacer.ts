import { FIXED_DT } from '../core/constants.ts';
import { clamp } from '../core/math.ts';

/** How much wider the band is for the multiple already in use. Must keep the widest band
 *  (0.9 ms) inside `BLEED_MAX`, or the wall-clock guarantee above is void. */
const SNAP_STICK = 1.6;

/**
 * Frame pacing for a fixed-timestep loop.
 *
 * A display almost never runs at exactly 60.000 Hz, and a browser's frame timestamps carry a
 * little noise on top of that. Feeding the raw delta into a fixed-step accumulator means that
 * every couple of seconds one frame runs two simulation steps and the next runs none — every
 * frame arrives on time and the game still visibly stutters, because the amount of simulated
 * time each frame displays is jumping around even though the frames are not.
 *
 * Two corrections, in order:
 *   1. Average the delta over a few frames to take out timestamp noise.
 *   2. Snap it to a whole number of simulation steps when it is close to one, so a 60.05 Hz
 *      display stops beating against a 60 Hz simulation.
 *
 * Snapping alone would let the match clock drift away from the wall clock, so the difference
 * between the real and the snapped delta is banked and bled back a fraction of a millisecond
 * at a time.
 *
 * No DOM, no timers, no state outside this object: it is a pure function of the delta sequence,
 * which is what makes it measurable (`npm run pacing`).
 */
export class FramePacer {
  /**
   * Ratios of the fixed step worth snapping to. A display running at R Hz produces a delta of
   * `FIXED_DT * 60 / R`, so these are the common desktop refresh rates — 240, 180, 144, 120,
   * 100, 90, 75, 60 — followed by whole multiples for frames that take more than one step.
   * They are far enough apart that the tolerance below cannot claim the wrong one.
   */
  static readonly SNAP_MULTIPLES = [0.25, 1 / 3, 5 / 12, 0.5, 0.6, 2 / 3, 0.8, 1, 2, 3, 4, 5];
  /** A delta this far from the running average is a change of cadence, not noise. */
  static readonly JUMP = 0.25;
  /** A delta longer than this is a real hitch, not jitter — pass it straight through. */
  static readonly HITCH = 0.1;
  /**
   * Wall-clock correction: a proportion of the banked error per frame, with a ceiling.
   *
   * Proportional on purpose. A flat bleed large enough to repay a sustained bias would also
   * re-inject the frame-to-frame noise that averaging just removed, making the pacer a no-op —
   * which is exactly what the first version of this did. Proportional means noise (which nets
   * to nothing) is barely corrected, while a steady bias accumulates until the correction
   * matches it, and settles there as a DC offset rather than as jitter.
   *
   * The ceiling must be at least as large as the widest snap below, or a display sitting inside
   * the snap band but outside the repayable band runs permanently slow. See the snap tolerance.
   */
  static readonly BLEED_P = 0.05;      // fraction of the banked error returned per frame
  static readonly BLEED_MAX = 0.0015;  // ...and never more than 1.5 ms in one frame

  private hist = [FIXED_DT, FIXED_DT, FIXED_DT, FIXED_DT];
  private idx = 0;
  private drift = 0;
  /** Index of the multiple currently snapped to, or -1. Snapping is sticky; see below. */
  private lastSnap = -1;

  reset(): void {
    this.hist.fill(FIXED_DT);
    this.idx = 0;
    this.drift = 0;
    this.lastSnap = -1;
  }

  next(raw: number): number {
    if (!Number.isFinite(raw) || raw < 0) return 0;
    if (raw > FramePacer.HITCH) {
      this.hist.fill(FIXED_DT);
      this.drift = 0;
      return raw;
    }
    let avg = 0;
    for (const v of this.hist) avg += v;
    avg /= this.hist.length;

    if (Math.abs(raw - avg) > Math.max(0.0015, avg * FramePacer.JUMP)) {
      // A dropped frame or a refresh-rate change. Averaging it would smear one genuinely long
      // frame across the next four, which is a worse artefact than the one being fixed — the
      // world would crawl through the long frame and then race through the short ones.
      this.hist.fill(raw);
      avg = raw;
    } else {
      this.idx = (this.idx + 1) % this.hist.length;
      this.hist[this.idx] = raw;
      avg = 0;
      for (const v of this.hist) avg += v;
      avg /= this.hist.length;
    }

    let dt = avg;
    let snapped = -1;
    for (let k = 0; k < FramePacer.SNAP_MULTIPLES.length; k++) {
      const target = FIXED_DT * FramePacer.SNAP_MULTIPLES[k];
      // Two constraints on the band.
      //
      // It must never exceed what the bleed can give back, or a display holding a steady 58 Hz
      // — inside a 6 % band around the fixed step — is fed 16.67 ms forever with a residual the
      // bleed can never repay, and the match clock runs about 2 % slow for as long as the game
      // is open.
      //
      // And it is sticky: a display sitting near the edge of the band otherwise snaps on some
      // frames and not others, which swings the delta by the width of the band and is worse
      // than never snapping at all.
      const base = Math.min(clamp(target * 0.06, 0.0003, 0.0009), FramePacer.BLEED_MAX);
      const tol = k === this.lastSnap ? base * SNAP_STICK : base;
      if (Math.abs(avg - target) < tol) { dt = target; snapped = k; break; }
    }
    this.lastSnap = snapped;

    this.drift += raw - dt;
    const bleed = clamp(this.drift * FramePacer.BLEED_P, -FramePacer.BLEED_MAX, FramePacer.BLEED_MAX);
    this.drift -= bleed;
    return Math.max(0, dt + bleed);
  }
}
