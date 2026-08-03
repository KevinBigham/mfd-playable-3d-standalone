#!/usr/bin/env tsx
/**
 * Motion-quality metrics. `npm run smoothness -- --games 12`
 *
 * "Smoother" is easy to assert and hard to prove, so this measures it. Everything here is
 * sampled from the simulation only (no GPU needed) and is therefore comparable run to run:
 *
 *   anim churn      animation-state changes per athlete per second while the ball is live.
 *                   Every change restarts a procedural pose, so churn is literally the rate
 *                   at which limbs teleport.
 *   run/sprint flip changes between the two locomotion states specifically — the band that
 *                   used to flap when an athlete sat on the threshold.
 *   facing jerk     RMS third derivative of heading. High = the body snaps rather than turns.
 *   position jerk   RMS third derivative of position. Catches motion that velocity does not
 *                   explain, e.g. bodies being teleported apart inside a pile.
 *   body overlap    how deeply live bodies interpenetrate. Softening the pile separation buys
 *                   smoothness and can be paid for in visible clipping, so it is measured.
 *   pops            ticks where the position moved further than the athlete's own velocity
 *                   could have carried it: a blocking shove or a pile separation. These are
 *                   intentional, but the SIZE of the largest one matters — a big single-tick
 *                   correction is a body visibly jumping sideways.
 */
import { Match, defaultMatchConfig } from '../src/rules/match.ts';
import { getTeam, TEAM_IDS } from '../src/data/index.ts';
import { FIXED_DT, BODY_RADIUS } from '../src/core/constants.ts';
import type { Difficulty } from '../src/core/types.ts';

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}
const games = Number(arg('games', '12'));
const difficulty = arg('difficulty', 'PRO') as Difficulty;
const seed0 = Number(arg('seed', '90210'));
const json = process.argv.includes('--json');

const N = 14;
const DT = FIXED_DT;

interface Acc {
  liveTicks: number;
  stateChanges: number;
  runSprintFlips: number;
  facingJerkSum: number;   // squared
  facingJerkN: number;
  posJerkSum: number;      // squared
  posJerkN: number;
  pops: number;
  popMag: number;
  worstPop: number;
  /** Ground speed a velocity-driven stride would fail to account for. */
  slipSum: number;
  slipN: number;
  slipOver1: number;
  slipHist: Int32Array;
  /** Bodies occupying the same space. Separation is a smoothness change with a cost. */
  pairChecks: number;
  overlapPairs: number;
  penetrationSum: number;
  worstPenetration: number;
}

const acc: Acc = {
  liveTicks: 0, stateChanges: 0, runSprintFlips: 0,
  facingJerkSum: 0, facingJerkN: 0, posJerkSum: 0, posJerkN: 0,
  pops: 0, popMag: 0, worstPop: 0,
  slipSum: 0, slipN: 0, slipOver1: 0, slipHist: new Int32Array(1200),
  pairChecks: 0, overlapPairs: 0, penetrationSum: 0, worstPenetration: 0,
};

// Ring of the last four samples per athlete, for third differences.
const px = [0, 1, 2, 3].map(() => new Float64Array(N));
const pz = [0, 1, 2, 3].map(() => new Float64Array(N));
const pf = [0, 1, 2, 3].map(() => new Float64Array(N));
const lastState = new Array<string>(N).fill('');
const hist = new Int32Array(N);        // how many consecutive samples we have

function angWrap(d: number): number {
  while (d > Math.PI) d -= Math.PI * 2;
  while (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

function isLoco(s: string): boolean { return s === 'RUN' || s === 'SPRINT'; }

function sample(m: Match): void {
  const w = m.world;
  if (w.playPhase !== 'LIVE') {
    hist.fill(0);
    return;
  }
  acc.liveTicks++;

  // Interpenetration among live bodies. Softening the pile separation is a smoothness win that
  // can be paid for in visible clipping, so the cost is measured rather than assumed.
  const minSep = BODY_RADIUS * 2;
  for (let i = 0; i < N; i++) {
    const a = w.athletes[i];
    if (a.move === 'DOWN') continue;
    for (let j = i + 1; j < N; j++) {
      const b = w.athletes[j];
      if (b.move === 'DOWN') continue;
      if (Math.abs(a.y - b.y) > 1.1) continue;
      acc.pairChecks++;
      const d = Math.hypot(b.x - a.x, b.z - a.z);
      if (d >= minSep) continue;
      acc.overlapPairs++;
      const pen = minSep - d;
      acc.penetrationSum += pen;
      if (pen > acc.worstPenetration) acc.worstPenetration = pen;
    }
  }

  for (let i = 0; i < N; i++) {
    const a = w.athletes[i];

    const st = a.anim.state as string;
    if (lastState[i] && lastState[i] !== st) {
      acc.stateChanges++;
      if (isLoco(lastState[i]) && isLoco(st)) acc.runSprintFlips++;
    }
    lastState[i] = st;

    // Shift the ring.
    for (let k = 3; k > 0; k--) {
      px[k][i] = px[k - 1][i]; pz[k][i] = pz[k - 1][i]; pf[k][i] = pf[k - 1][i];
    }
    px[0][i] = a.x; pz[0][i] = a.z; pf[0][i] = a.facing;
    hist[i] = Math.min(4, hist[i] + 1);

    if (hist[i] >= 2) {
      // A step the athlete's own velocity cannot account for is a positional correction.
      const stepX = px[0][i] - px[1][i], stepZ = pz[0][i] - pz[1][i];
      const step = Math.hypot(stepX, stepZ);
      const byVel = Math.hypot(a.vx, a.vz) * DT;
      const excess = step - byVel - 1e-4;
      if (excess > 0.004) {          // 4 mm of unexplained travel in one tick
        acc.pops++;
        acc.popMag += excess;
        if (excess > acc.worstPop) acc.worstPop = excess;
      }
    }

    if (hist[i] >= 2) {
      // Foot-slide the OLD velocity-driven stride would have shown: the gap between the ground
      // an athlete really covers and the speed his velocity claims. The shipped stride is
      // derived from ground travel, so this particular error is zero for it — this measures
      // how much slide that structural change removes.
      const trueGround = Math.hypot(px[0][i] - px[1][i], pz[0][i] - pz[1][i]) / DT;
      const slip = Math.abs(trueGround - Math.hypot(a.vx, a.vz));
      acc.slipSum += slip; acc.slipN++;
      if (slip > 1) acc.slipOver1++;
      acc.slipHist[Math.min(1199, Math.round(slip * 40))]++;
    }

    if (hist[i] >= 4) {
      const jx = (px[0][i] - 3 * px[1][i] + 3 * px[2][i] - px[3][i]) / (DT * DT * DT);
      const jz = (pz[0][i] - 3 * pz[1][i] + 3 * pz[2][i] - pz[3][i]) / (DT * DT * DT);
      const j2 = jx * jx + jz * jz;
      acc.posJerkSum += j2; acc.posJerkN++;

      // Heading is wrapped, so difference the wrapped deltas rather than the angles.
      const d1 = angWrap(pf[0][i] - pf[1][i]);
      const d2 = angWrap(pf[1][i] - pf[2][i]);
      const d3 = angWrap(pf[2][i] - pf[3][i]);
      const fj = (d1 - 2 * d2 + d3) / (DT * DT * DT);
      acc.facingJerkSum += fj * fj; acc.facingJerkN++;
    }
  }
}

for (let g = 0; g < games; g++) {
  const cfg = defaultMatchConfig({
    seed: seed0 + g * 7919, difficulty, quarterSeconds: 120,
    home: TEAM_IDS[g % TEAM_IDS.length], away: TEAM_IDS[(g + 5) % TEAM_IDS.length],
    seats: [{ side: 0, active: false }, { side: 1, active: false },
      { side: 0, active: false }, { side: 1, active: false }],
  });
  const m = new Match({ config: cfg, home: getTeam(cfg.home!), away: getTeam(cfg.away!) });
  let t = 0;
  while (!m.state.finished && t < 60 * 60 * 24) { m.tick(); sample(m); t++; }
  lastState.fill(''); hist.fill(0);
}

function percentile(p: number): number {
  const want = acc.slipN * p;
  let seen = 0;
  for (let i = 0; i < acc.slipHist.length; i++) {
    seen += acc.slipHist[i];
    if (seen >= want) return i / 40;
  }
  return acc.slipHist.length / 40;
}

const liveSeconds = acc.liveTicks * DT;
const athleteSeconds = liveSeconds * N;
const out = {
  games,
  liveSeconds: +liveSeconds.toFixed(1),
  animChurnPerAthleteSec: +(acc.stateChanges / athleteSeconds).toFixed(3),
  runSprintFlipsPerAthleteSec: +(acc.runSprintFlips / athleteSeconds).toFixed(3),
  facingJerkRms: +Math.sqrt(acc.facingJerkSum / Math.max(1, acc.facingJerkN)).toFixed(0),
  posJerkRms: +Math.sqrt(acc.posJerkSum / Math.max(1, acc.posJerkN)).toFixed(0),
  popsPerAthleteSec: +(acc.pops / athleteSeconds).toFixed(3),
  meanPopYd: +(acc.popMag / Math.max(1, acc.pops)).toFixed(4),
  worstPopYd: +acc.worstPop.toFixed(3),
  strideSlipMean: +(acc.slipSum / Math.max(1, acc.slipN)).toFixed(3),
  strideSlipP95: +percentile(0.95).toFixed(2),
  strideSlipOver1Pct: +(100 * acc.slipOver1 / Math.max(1, acc.slipN)).toFixed(1),
  overlapPairPct: +(100 * acc.overlapPairs / Math.max(1, acc.pairChecks)).toFixed(3),
  meanPenetrationYd: +(acc.penetrationSum / Math.max(1, acc.overlapPairs)).toFixed(4),
  worstPenetrationYd: +acc.worstPenetration.toFixed(3),
};

if (json) {
  console.log(JSON.stringify(out));
} else {
  console.log(`
GRIDIRON OVERDRIVE — motion quality (${games} games, ${difficulty}, ${out.liveSeconds}s of live ball)
──────────────────────────────────────────────────────────────
anim churn            ${out.animChurnPerAthleteSec.toFixed(3)} state changes / athlete / s
  run<->sprint flips  ${out.runSprintFlipsPerAthleteSec.toFixed(3)} / athlete / s
facing jerk (RMS)     ${out.facingJerkRms} rad/s³
position jerk (RMS)   ${out.posJerkRms} yd/s³
positional pops       ${out.popsPerAthleteSec.toFixed(3)} / athlete / s   mean ${out.meanPopYd} yd   worst ${out.worstPopYd} yd
body overlap          ${out.overlapPairPct}% of live pairs, mean ${out.meanPenetrationYd} yd, worst ${out.worstPenetrationYd} yd
                      (a body is ${(BODY_RADIUS * 2).toFixed(2)} yd across)
stride cadence error  a velocity-driven stride would misjudge the ground covered by
                      ${out.strideSlipMean} yd/s mean, ${out.strideSlipP95} p95, over 1 yd/s on ${out.strideSlipOver1Pct}% of
                      athlete-ticks. The shipped cadence reads ground travel, so this
                      term is zero for it. That is CADENCE only, not what the shoe does
                      on the turf — for that, run: npm run footslip
──────────────────────────────────────────────────────────────
lower is smoother in every row.`);
}
