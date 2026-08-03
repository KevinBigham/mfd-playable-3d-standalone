#!/usr/bin/env tsx
/**
 * Frame pacing measurement. `npm run pacing`
 *
 * This runs the SHIPPED `FramePacer` and the SHIPPED accumulator arithmetic over synthetic
 * frame-delta sequences. It is not a browser benchmark and does not need one — pacing is a
 * pure function of the delta sequence, so it can be measured exactly and repeatably here,
 * which an in-browser measurement in this container could not be (there is no GPU, so frames
 * arrive seconds apart and every timing figure would be an artefact of the rasteriser).
 *
 * The model has TWO clocks, because that is the situation that actually bites:
 *
 *   - the TRUE interval between displayed frames, which is what the eye sees. On a healthy
 *     vsync this is close to constant, with the occasional dropped frame.
 *   - the REPORTED delta the loop reads, which is the true interval plus measurement noise.
 *     Browser frame timestamps are not exact, and on variable-refresh and power-managed
 *     displays they are noticeably not exact.
 *
 * The world advances by the reported delta. So the speed the player perceives on frame i is
 * `advance[i] / trueInterval[i]` — one if motion is even, and wobbling either side of one if
 * the world is advancing by an amount that has nothing to do with how long the frame was
 * actually on screen. The metric is the standard deviation of that ratio: 0 % is perfectly
 * even motion, 10 % means apparent speed wobbles by a tenth frame to frame.
 *
 * This is the failure pacing exists to fix, and it is the ONLY one: render interpolation
 * already removes the classic fixed-timestep beat, where one frame runs two simulation steps
 * and the next runs none. The step-count column is printed to show exactly that — it moves a
 * lot and it does not matter, because `alpha` covers it.
 */
import { FramePacer } from '../src/app/framePacer.ts';
import { FIXED_DT, MAX_SUBSTEPS } from '../src/core/constants.ts';

interface Row {
  label: string;
  rawJitter: number; pacedJitter: number;
  pacedOffModal: number;
  driftMs: number;
}

/** Deterministic jitter so runs are comparable; no Math.random anywhere in this repo's tools. */
function jitter(i: number, amp: number): number {
  const a = Math.sin(i * 12.9898) * 43758.5453;
  return (a - Math.floor(a) - 0.5) * 2 * amp;
}

function run(hz: number, noiseMs: number, dropRate: number, seconds: number, paced: boolean): {
  jitter: number; offModal: number; drift: number;
} {
  const pacer = new FramePacer();
  const frames = Math.round(hz * seconds);
  const nominal = 1 / hz;
  let acc = 0;
  let ticks = 0;
  let prevShown = 0;
  let trueElapsed = 0;
  const ratios: number[] = [];
  const stepCounts = new Map<number, number>();

  for (let i = 0; i < frames; i++) {
    // What the eye sees: a regular cadence with the occasional dropped frame.
    const dropped = dropRate > 0 && i % Math.round(1 / dropRate) === 0;
    const trueInterval = nominal * (dropped ? 2 : 1);
    // What the loop reads: the same interval, mismeasured.
    const reported = Math.max(0.0005, trueInterval + jitter(i, noiseMs / 1000));
    trueElapsed += trueInterval;

    const dt = paced ? pacer.next(reported) : Math.min(reported, 0.25);
    acc += dt;
    let steps = 0;
    while (acc >= FIXED_DT && steps < MAX_SUBSTEPS) { acc -= FIXED_DT; ticks++; steps++; }
    if (steps === MAX_SUBSTEPS) acc = 0;
    stepCounts.set(steps, (stepCounts.get(steps) ?? 0) + 1);

    const shown = (ticks + acc / FIXED_DT) * FIXED_DT;
    if (i > 8) ratios.push((shown - prevShown) / trueInterval);   // skip warm-up
    prevShown = shown;
  }

  const mean = ratios.reduce((a, b) => a + b, 0) / Math.max(1, ratios.length);
  const sd = Math.sqrt(ratios.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, ratios.length));
  let modal = 0;
  for (const v of stepCounts.values()) modal = Math.max(modal, v);
  return {
    jitter: 100 * sd / Math.max(1e-9, mean),
    offModal: 100 * (frames - modal) / frames,
    drift: (prevShown - trueElapsed) * 1000,
  };
}

const SECONDS = 30;
/** label, refresh, timestamp noise (ms), dropped-frame rate */
const CASES: Array<[string, number, number, number]> = [
  ['60 Hz, exact timestamps', 60, 0, 0],
  ['60 Hz, 0.4 ms noise', 60, 0.4, 0],
  ['60 Hz, 1.5 ms noise', 60, 1.5, 0],
  ['59.94 Hz, 0.8 ms noise', 59.94, 0.8, 0],
  ['60.05 Hz, 0.8 ms noise', 60.05, 0.8, 0],
  ['120 Hz, 0.5 ms noise', 120, 0.5, 0],
  ['144 Hz, 0.5 ms noise', 144, 0.5, 0],
  ['58 Hz steady (inside snap band)', 58, 0.3, 0],
  ['63 Hz steady (inside snap band)', 63, 0.3, 0],
  ['60 Hz, 1 frame in 40 dropped', 60, 0.4, 0.025],
];

const rows: Row[] = CASES.map(([label, hz, n, drop]) => {
  const raw = run(hz, n, drop, SECONDS, false);
  const pac = run(hz, n, drop, SECONDS, true);
  return {
    label,
    rawJitter: raw.jitter, pacedJitter: pac.jitter,
    pacedOffModal: pac.offModal,
    driftMs: pac.drift,
  };
});

const f = (n: number, d = 1) => n.toFixed(d);
console.log(`
GRIDIRON OVERDRIVE — frame pacing (${SECONDS}s per case, shipped FramePacer + accumulator)
──────────────────────────────────────────────────────────────────────────────────
                               apparent-speed jitter      steps/frame   clock
display                          unpaced      paced         varying     drift
──────────────────────────────────────────────────────────────────────────────────`);
for (const r of rows) {
  console.log(`${r.label.padEnd(30)} ${f(r.rawJitter).padStart(6)}%  ${f(r.pacedJitter).padStart(8)}%   `
    + `${f(r.pacedOffModal).padStart(8)}%  ${f(r.driftMs, 1).padStart(8)} ms`);
}
console.log('──────────────────────────────────────────────────────────────────────────────────');
console.log('jitter: standard deviation of (simulated time advanced / time the frame was really');
console.log('on screen). 0 % is perfectly even motion. steps/frame varying: share of frames not');
console.log('running the modal number of simulation steps — large and harmless, because render');
console.log(`interpolation covers it. drift: paced clock vs true elapsed after ${SECONDS} s.`);

const worst = Math.max(...rows.map((r) => r.pacedJitter));
const worstDrift = Math.max(...rows.map((r) => Math.abs(r.driftMs)));
if (worst > 60) { console.error(`\nFAIL: paced jitter reached ${f(worst)}%`); process.exit(1); }
if (worstDrift > 60) { console.error(`\nFAIL: clock drift reached ${f(worstDrift)} ms`); process.exit(1); }
process.exit(0);
