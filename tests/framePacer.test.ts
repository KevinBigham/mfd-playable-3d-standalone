import { describe, it, expect } from 'vitest';
import { FramePacer } from '../src/app/framePacer.ts';
import { FIXED_DT } from '../src/core/constants.ts';

/** Deterministic pseudo-noise; no Math.random in this repo. */
function noise(i: number, amp: number): number {
  const a = Math.sin(i * 12.9898) * 43758.5453;
  return (a - Math.floor(a) - 0.5) * 2 * amp;
}

describe('FramePacer', () => {
  it('passes an exact 60 Hz delta through untouched', () => {
    const p = new FramePacer();
    for (let i = 0; i < 200; i++) expect(p.next(FIXED_DT)).toBeCloseTo(FIXED_DT, 9);
  });

  it('removes timestamp noise from a steady display', () => {
    const p = new FramePacer();
    let worst = 0;
    for (let i = 0; i < 600; i++) {
      const out = p.next(FIXED_DT + noise(i, 0.0008));
      if (i > 10) worst = Math.max(worst, Math.abs(out - FIXED_DT));
    }
    // Input noise is up to 0.8 ms; the paced output stays inside 0.3 ms of the true step,
    // because the bleed is proportional to a banked error that noise never lets grow.
    expect(worst).toBeLessThan(0.0003);
  });

  it('stays true to the wall clock while smoothing', () => {
    const p = new FramePacer();
    const real = FIXED_DT * 1.004;          // a display running slightly slow
    let sum = 0;
    for (let i = 0; i < 3600; i++) sum += p.next(real + noise(i, 0.0006));
    // A minute of frames must not drift more than a couple of frames from real time.
    expect(Math.abs(sum - real * 3600)).toBeLessThan(0.035);
  });

  it('does not run slow on a refresh rate that sits inside the snap band', () => {
    // A steady 58 Hz is close enough to the fixed step to be snapped. If the bleed cannot
    // repay the difference, the whole match runs ~2 % slow for as long as the game is open.
    for (const hz of [57, 58, 62, 63]) {
      const p = new FramePacer();
      const real = 1 / hz;
      let sum = 0;
      const frames = hz * 120;              // two minutes
      for (let i = 0; i < frames; i++) sum += p.next(real + noise(i, 0.0003));
      const err = Math.abs(sum - real * frames) / (real * frames);
      expect(err).toBeLessThan(0.002);      // under 0.2 % over two minutes
    }
  });

  it('adopts a genuinely longer frame immediately instead of smearing it', () => {
    const p = new FramePacer();
    for (let i = 0; i < 40; i++) p.next(FIXED_DT);
    const dropped = p.next(FIXED_DT * 2);
    expect(dropped).toBeGreaterThan(FIXED_DT * 1.9);
    // ...and the frame after it is back to a normal step, not an average of the two.
    expect(p.next(FIXED_DT)).toBeLessThan(FIXED_DT * 1.1);
  });

  it('snaps common refresh rates onto the simulation step', () => {
    for (const hz of [240, 180, 144, 120, 100, 90, 75, 60]) {
      const p = new FramePacer();
      const real = 1 / hz;
      let out = 0;
      for (let i = 0; i < 60; i++) out = p.next(real + noise(i, 0.00025));
      expect(Math.abs(out - real)).toBeLessThan(0.0006);
    }
  });

  it('passes a real hitch straight through and resets', () => {
    const p = new FramePacer();
    for (let i = 0; i < 20; i++) p.next(FIXED_DT);
    expect(p.next(0.4)).toBeCloseTo(0.4, 9);
    expect(p.next(FIXED_DT)).toBeCloseTo(FIXED_DT, 6);
  });

  it('never returns a negative or non-finite delta', () => {
    const p = new FramePacer();
    for (const bad of [-1, NaN, Infinity]) expect(p.next(bad)).toBe(0);
    for (let i = 0; i < 200; i++) {
      const out = p.next(Math.abs(noise(i, 0.05)));
      expect(Number.isFinite(out)).toBe(true);
      expect(out).toBeGreaterThanOrEqual(0);
    }
  });
});
