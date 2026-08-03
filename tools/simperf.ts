#!/usr/bin/env tsx
/** Simulation-only cost. Hardware-independent enough to be a useful budget check. */
import { Match, defaultMatchConfig } from '../src/rules/match.ts';
import { getTeam, TEAM_IDS } from '../src/data/index.ts';

const cfg = defaultMatchConfig({ seed: 4242, home: TEAM_IDS[0], away: TEAM_IDS[5], quarterSeconds: 360,
  seats: [{ side: 0, active: false }, { side: 1, active: false }, { side: 0, active: false }, { side: 1, active: false }] });
const m = new Match({ config: cfg, home: getTeam(cfg.home), away: getTeam(cfg.away) });
// Warm up.
for (let i = 0; i < 4000; i++) m.tick();
const samples: number[] = [];
let live = 0;
for (let block = 0; block < 400; block++) {
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 60; i++) { if (m.state.phase === 'LIVE') live++; m.tick(); }
  const t1 = process.hrtime.bigint();
  samples.push(Number(t1 - t0) / 1e6 / 60);
  if (m.state.finished) break;
}
samples.sort((a, b) => a - b);
const at = (p: number) => samples[Math.min(samples.length - 1, Math.floor(samples.length * p))];
console.log(`\nSIMULATION TICK COST (Node ${process.version}, ${samples.length * 60} ticks, ${live} of them live)`);
console.log(`  p50 ${at(0.5).toFixed(3)} ms   p95 ${at(0.95).toFixed(3)} ms   p99 ${at(0.99).toFixed(3)} ms   max ${samples[samples.length - 1].toFixed(3)} ms`);
console.log(`  budget: p50 <= 1.100 ms, hard fail > 3.000 ms  →  ${at(0.5) <= 1.1 ? 'PASS' : at(0.5) <= 3 ? 'OVER TARGET' : 'FAIL'}`);
console.log(`  real-time headroom: ${(16.6 / at(0.95)).toFixed(0)}x at 60 Hz\n`);
