#!/usr/bin/env tsx
/** CPU-vs-CPU batch simulation. `npm run sim -- --games 200 --difficulty ALLSTAR` */
import { simulateBatch, simulateMatch } from '../src/testing/simRunner.ts';
import type { Difficulty } from '../src/core/types.ts';

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}
const games = Number(arg('games', '40'));
const difficulty = (arg('difficulty', 'PRO') as Difficulty);
const quarter = Number(arg('quarter', '120'));
const seed = Number(arg('seed', '1000'));
const invariants = process.argv.includes('--invariants');
const single = process.argv.includes('--single');

if (single) {
  const r = simulateMatch({ seed, difficulty, quarterSeconds: quarter, checkInvariants: true });
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.completed && r.violations.length === 0 ? 0 : 1);
}

const t0 = Date.now();
const s = simulateBatch(games, seed, { difficulty, quarterSeconds: quarter, checkInvariants: invariants });
const secs = ((Date.now() - t0) / 1000).toFixed(1);

const f = (n: number, d = 1) => n.toFixed(d);
console.log(`
GRIDIRON OVERDRIVE — CPU vs CPU batch
────────────────────────────────────────────────────────
games              ${s.games}   (completed ${s.completed})   difficulty ${difficulty}   quarters ${quarter / 60}:00
wall               ${secs}s total, ${f(s.avgWallMs)}ms per game
score              home ${f(s.avgHome)}  away ${f(s.avgAway)}  combined ${f(s.avgTotal)}  [${s.minTotal}..${s.maxTotal}]
ties / overtimes   ${s.ties} / ${s.overtimes}
shutouts/blowouts  ${s.shutouts} / ${s.blowouts}
plays per game     ${f(s.avgPlays)} both teams
first downs        ${f(s.avgFirstDownsPerTeam)} per team, ${f(s.avgFirstDownsBothTeams)} both teams
yards per team     pass ${f(s.avgPassYds)}  rush ${f(s.avgRushYds)}
turnovers          ints ${f(s.avgInts)}  forced fumbles ${f(s.avgFumbles)}   both teams
sacks              ${f(s.avgSacks)}        overdrives ${f(s.avgOverdrives)}   both teams
touchdowns         ${f(s.avgTouchdowns)}        field goals ${f(s.avgFieldGoals)}   punts ${f(s.avgPunts)}   safeties ${f(s.avgSafeties, 2)}   both teams
watchdogs          ${s.totalWatchdogs}
violations         ${s.violations.length}
────────────────────────────────────────────────────────`);

if (s.violations.length) {
  console.log('VIOLATIONS:');
  const seen = new Set<string>();
  for (const v of s.violations) {
    const k = `${v.code}`;
    if (seen.has(k)) continue;
    seen.add(k);
    console.log(`  ${v.code}: ${v.detail}`);
  }
}

const top = Object.entries(s.eventTotals).sort((a, b) => b[1] - a[1]).slice(0, 22);
console.log('EVENTS/GAME: ' + top.map(([k, v]) => `${k}=${(v / s.games).toFixed(1)}`).join('  '));

const failed = s.completed !== s.games || s.violations.length > 0;
process.exit(failed ? 1 : 0);
