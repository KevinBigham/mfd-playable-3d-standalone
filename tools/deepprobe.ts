#!/usr/bin/env tsx
/**
 * Deep-ball autopsy.
 *
 * The drive census says the deep shot completes 81% of the time for 23-25 yards a play, with half
 * of all attempts going twenty-plus, and that this one number is why 44% of drives score and why
 * drives last 3.2 plays. This asks the next question down: WHERE does a deep receiver's separation
 * come from? If he is already open when the ball leaves the hand, the problem is coverage. If he is
 * covered at the release and open at the catch, the problem is what happens during the flight.
 *
 *   npm run deepprobe [-- --games 10 --seed-start 4400 --deep 18 --json reports/deepprobe.json]
 */
import { Match, defaultMatchConfig } from '../src/rules/match.ts';
import { getTeam, TEAM_IDS } from '../src/data/index.ts';
import { dist } from '../src/core/math.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fingerprint, printFingerprint, type ProbeFingerprint } from './lib/fingerprint.ts';

export interface DeepProbeArgs {
  games: number;
  seedStart: number;
  deepAir: number;
  jsonPath: string | null;
}

function positiveNumber(argv: readonly string[], flag: string, fallback: number): number {
  const index = argv.indexOf(flag);
  if (index < 0) return fallback;
  const value = Number(argv[index + 1]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function positiveInteger(argv: readonly string[], flag: string, fallback: number): number {
  const value = positiveNumber(argv, flag, fallback);
  return Number.isInteger(value) ? value : fallback;
}

function integer(argv: readonly string[], flag: string, fallback: number): number {
  const index = argv.indexOf(flag);
  if (index < 0) return fallback;
  const value = Number(argv[index + 1]);
  return Number.isSafeInteger(value) ? value : fallback;
}

function optionalPath(argv: readonly string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  const value = index >= 0 ? argv[index + 1] : undefined;
  return value && !value.startsWith('--') ? value : null;
}

export function parseDeepProbeArgs(argv: readonly string[]): DeepProbeArgs {
  return {
    games: positiveInteger(argv, '--games', 10),
    seedStart: integer(argv, '--seed-start', 4400),
    deepAir: positiveNumber(argv, '--deep', 18),
    jsonPath: optionalPath(argv, '--json'),
  };
}

interface Shot {
  air: number;
  sepAtThrow: number;
  sepAtArrival: number;
  flight: number;
  caught: boolean;
  picked: boolean;
  /** Yards the receiver had to travel to correct for a bad throw. */
  correction: number;
  defenderTurbo: number;
}

export interface DeepProbeReport {
  fingerprint: ProbeFingerprint;
  config: { games: number; seedStart: number; seedEnd: number; deepAir: number };
  shots: number;
  completed: number;
  intercepted: number;
  failed: number;
  completionRate: number | null;
  means: {
    airYards: number;
    flightSeconds: number;
    separationAtThrow: number;
    separationAtArrival: number;
    separationChange: number;
    correction: number;
    defenderTurbo: number;
    completionSeparationAtThrow: number;
    completionSeparationAtArrival: number;
    failureSeparationAtThrow: number;
    failureSeparationAtArrival: number;
  };
}

export function runDeepProbe(options: DeepProbeArgs): DeepProbeReport {
const { games, seedStart, deepAir: DEEP_AIR, jsonPath } = options;
const shots: Shot[] = [];

for (let g = 0; g < games; g++) {
  const cfg = defaultMatchConfig({
    seed: seedStart + g, quarterSeconds: 120, difficulty: 'PRO',
    home: TEAM_IDS[g % TEAM_IDS.length], away: TEAM_IDS[(g + 5) % TEAM_IDS.length],
    seats: [{ side: 0, active: false }, { side: 1, active: false }],
  });
  const m = new Match({ config: cfg, home: getTeam(cfg.home!), away: getTeam(cfg.away!), seatIntent: () => null });
  const bus = m.bus as unknown as { on: (t: string, f: (e: never) => void) => void };

  let live: (Shot | null) = null as Shot | null;
  let target = -1;

  bus.on('throw', ((e: { to: number | null }) => {
    if (live) finish();
    const w = m.world;
    const st = w.ball.state;
    if (st.kind !== 'inAir' || e.to === null) return;
    const air = dist(st.sx, st.sz, st.tx, st.tz);
    if (air < DEEP_AIR) return;
    const r = w.athletes[e.to];
    target = e.to;
    let near = 99; let turbo = 0;
    for (const d of w.athletes) {
      if (d.side === r.side) continue;
      const dd = dist(d.x, d.z, r.x, r.z);
      if (dd < near) { near = dd; turbo = d.turbo; }
    }
    live = {
      air, sepAtThrow: near, sepAtArrival: -1, flight: st.flightTime,
      caught: false, picked: false,
      // How far off the receiver's own position the ball is aimed: the throw error he has to run
      // down. A miss he can jog to is not a miss.
      correction: dist(r.x, r.z, st.tx, st.tz),
      defenderTurbo: turbo,
    };
  }) as never);

  bus.on('catch', ((e: { by: number }) => {
    if (!live) return;
    live.caught = e.by === target;
    finish();
  }) as never);
  bus.on('interception', (() => { if (live) { live.picked = true; finish(); } }) as never);
  // A swat or bobble can keep a tipped pass airborne. Close only on an actual terminal event;
  // otherwise the probe would count a recoverable tip as an incompletion before its outcome.
  for (const ev of ['drop', 'play.end'] as const) {
    bus.on(ev, (() => { if (live) finish(); }) as never);
  }

  function finish(): void {
    if (!live) return;
    if (live.sepAtArrival < 0) live.sepAtArrival = sepNow();
    shots.push(live); live = null; target = -1;
  }
  function sepNow(): number {
    const w = m.world;
    const r = w.athletes[target];
    if (!r) return -1;
    let near = 99;
    for (const d of w.athletes) {
      if (d.side === r.side) continue;
      near = Math.min(near, dist(d.x, d.z, r.x, r.z));
    }
    return near;
  }

  for (let i = 0; i < 200000 && !m.state.finished; i++) {
    m.tick();
    // Sample separation on the tick the ball is about to arrive, before the contest resolves it.
    if (!live) continue;
    const st = m.world.ball.state;
    if (st.kind === 'inAir' && st.flightTime - st.t < 1 / 30 && live.sepAtArrival < 0) {
      live.sepAtArrival = sepNow();
    }
  }
}

const mean = (f: (s: Shot) => number, set = shots): number =>
  set.reduce((a, s) => a + f(s), 0) / Math.max(1, set.length);
const caught = shots.filter((s) => s.caught);
const failed = shots.filter((s) => !s.caught && !s.picked);
const pct = (a: number, b: number): string => (b === 0 ? '—' : `${((a / b) * 100).toFixed(0)}%`);
const fp = fingerprint({
  tool: 'deepprobe', seeds: `${seedStart}..${seedStart + games - 1}`,
  teams: 'rotating home/away over TEAM_IDS', difficulty: 'PRO', quarterSeconds: 120,
});
const report: DeepProbeReport = {
  fingerprint: fp,
  config: { games, seedStart, seedEnd: seedStart + games - 1, deepAir: DEEP_AIR },
  shots: shots.length,
  completed: caught.length,
  intercepted: shots.filter((s) => s.picked).length,
  failed: failed.length,
  completionRate: shots.length > 0 ? caught.length / shots.length : null,
  means: {
    airYards: mean((s) => s.air),
    flightSeconds: mean((s) => s.flight),
    separationAtThrow: mean((s) => s.sepAtThrow),
    separationAtArrival: mean((s) => Math.max(0, s.sepAtArrival)),
    separationChange: mean((s) => Math.max(0, s.sepAtArrival)) - mean((s) => s.sepAtThrow),
    correction: mean((s) => s.correction),
    defenderTurbo: mean((s) => s.defenderTurbo),
    completionSeparationAtThrow: mean((s) => s.sepAtThrow, caught),
    completionSeparationAtArrival: mean((s) => Math.max(0, s.sepAtArrival), caught),
    failureSeparationAtThrow: mean((s) => s.sepAtThrow, failed),
    failureSeparationAtArrival: mean((s) => Math.max(0, s.sepAtArrival), failed),
  },
};

console.log(`\nDEEP-BALL AUTOPSY — ${shots.length} throws of ${DEEP_AIR}+ air yards over ${games} games`);
printFingerprint(fp);
console.log('─'.repeat(70));
console.log(`  completed            ${caught.length}/${shots.length} = ${pct(caught.length, shots.length)}`);
console.log(`  intercepted          ${shots.filter((s) => s.picked).length}`);
console.log(`  air yards            mean ${mean((s) => s.air).toFixed(1)}   flight ${mean((s) => s.flight).toFixed(2)} s`);
console.log('─'.repeat(70));
console.log('  separation from the nearest defender, yards');
console.log(`    at the release     ${mean((s) => s.sepAtThrow).toFixed(2)}`);
console.log(`    at the arrival     ${mean((s) => Math.max(0, s.sepAtArrival)).toFixed(2)}`);
console.log(`    change in flight   ${(mean((s) => Math.max(0, s.sepAtArrival)) - mean((s) => s.sepAtThrow)).toFixed(2)}`);
console.log('─'.repeat(70));
console.log(`  throw miss           ${mean((s) => s.correction).toFixed(2)} yd off the receiver at release`);
console.log(`  covering defender    ${mean((s) => s.defenderTurbo).toFixed(0)} turbo left at the release`);
console.log('─'.repeat(70));
console.log(`  completions had      ${mean((s) => s.sepAtThrow, caught).toFixed(2)} yd at release, ${mean((s) => Math.max(0, s.sepAtArrival), caught).toFixed(2)} at arrival`);
console.log(`  failures had         ${mean((s) => s.sepAtThrow, failed).toFixed(2)} yd at release, ${mean((s) => Math.max(0, s.sepAtArrival), failed).toFixed(2)} at arrival`);
console.log('─'.repeat(70) + '\n');
if (jsonPath) {
  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}
return report;
}

const directEntry = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === directEntry) runDeepProbe(parseDeepProbeArgs(process.argv.slice(2)));
