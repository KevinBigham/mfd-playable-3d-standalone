#!/usr/bin/env tsx
/**
 * Where drives start, and where safeties come from. `npm run fieldpos`
 *
 * The batch report says 2.96 safeties a game against a real-world rate of about 0.05, and 3.3
 * first downs against a chain that is supposed to be a rhythm. Both of those are symptoms of the
 * same thing — a field-position economy nobody has ever looked at — and neither can be fixed by
 * staring at the aggregate. This prints the distribution underneath it: where every drive starts,
 * how it got there, and for each safety, the snap that caused it and the play before that.
 */
import { Match, defaultMatchConfig } from '../src/rules/match.ts';
import { getTeam, TEAM_IDS } from '../src/data/index.ts';
import type { TeamSide } from '../src/core/types.ts';

function arg(name: string, def: string): string { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : def; }
const GAMES = Number(arg('games', '60'));
const SEED = Number(arg('seed', '5150'));

/** Yards from a team's OWN goal line, which is the only frame safeties care about. */
function ownYardLine(z: number, side: TeamSide): number { return side === 0 ? z : 100 - z; }

interface Safety {
  spot: number; down: number; how: string; playKind: string;
  deadAt: number; originAt: number; conceder: string; threw: boolean;
}

const driveStarts: number[] = [];
const startsBySource = new Map<string, number[]>();
const safeties: Safety[] = [];
const firstDownsPerGame: number[] = [];
/** Kick returns: where the ball was fielded, where the return ended, and the net of the two. */
const returns: { caught: number; ended: number; kind: string }[] = [];
const scores: number[] = [];
const margins: number[] = [];
let plays = 0;
let snaps = 0;
let snapsInsideOwn10 = 0;
let snapsInsideOwn5 = 0;

for (let g = 0; g < GAMES; g++) {
  const cfg = defaultMatchConfig({
    seed: SEED + g * 7, quarterSeconds: 120, difficulty: 'PRO',
    home: TEAM_IDS[g % TEAM_IDS.length], away: TEAM_IDS[(g + 5) % TEAM_IDS.length],
    seats: [{ side: 0, active: false }, { side: 1, active: false },
      { side: 0, active: false }, { side: 1, active: false }],
  });
  const m = new Match({ config: cfg, home: getTeam(cfg.home!), away: getTeam(cfg.away!) });

  let lastSource = 'KICKOFF';
  let pendingSource: string | null = 'KICKOFF';
  let lastPossession: TeamSide | null = null;
  let firstDowns = 0;

  m.bus.on('turnover', (e: any) => { pendingSource = e.kind ?? 'TURNOVER'; });
  m.bus.on('kickoff', () => { pendingSource = 'KICKOFF'; });
  m.bus.on('firstDown', () => { firstDowns++; });
  m.bus.on('play.start', () => {
    const own = ownYardLine(m.state.losZ, m.state.possession);
    snaps++;
    if (own <= 10) snapsInsideOwn10++;
    if (own <= 5) snapsInsideOwn5++;
  });

  // A return is watched tick by tick: the moment a receiving player takes possession of a kick,
  // note where he caught it, then note where he finished. The gap between the two is the whole
  // question — a return that goes backwards is not a field-position problem, it is a broken play.
  let fieldedAt: number | null = null;
  let fieldedBy: TeamSide | null = null;
  let kickKind = '';

  let guard = 0;
  while (!m.state.finished && guard++ < 60 * 60 * 30) {
    const st = m.state;
    const w = m.world;
    if (w.special === 'KICKOFF' || w.special === 'PUNT' || w.special === 'ONSIDE') {
      const car = w.athletes.find((a) => a.hasBall);
      if (car && fieldedAt === null && car.side !== st.possession) {
        fieldedAt = ownYardLine(car.z, car.side); fieldedBy = car.side; kickKind = w.special;
      } else if (car && fieldedBy === car.side && fieldedAt !== null) {
        // keep the latest position; the last one before the play dies is where it ended
        (car as any).__lastOwn = ownYardLine(car.z, car.side);
      }
    } else if (fieldedAt !== null) {
      const ended = ownYardLine(st.losZ, fieldedBy as TeamSide);
      returns.push({ caught: fieldedAt, ended, kind: kickKind });
      fieldedAt = null; fieldedBy = null;
    }
    if (st.phase === 'PRE_SNAP' && st.possession !== lastPossession) {
      // A new drive: record where it starts and what put the ball there.
      lastPossession = st.possession;
      lastSource = pendingSource ?? 'OTHER';
      pendingSource = null;
      const own = ownYardLine(st.losZ, st.possession);
      driveStarts.push(own);
      if (!startsBySource.has(lastSource)) startsBySource.set(lastSource, []);
      startsBySource.get(lastSource)!.push(own);
    }
    m.tick();
  }

  // Safeties are captured through a second pass: the bus fires after the spot is already
  // resolved, so the snap that caused one has to be remembered as it happens.
  firstDownsPerGame.push(firstDowns / 2);
  scores.push(m.state.teams[0].score + m.state.teams[1].score);
  margins.push(Math.abs(m.state.teams[0].score - m.state.teams[1].score));
  plays += m.state.teams[0].stats.plays + m.state.teams[1].stats.plays;
}

// ── second pass: capture the real geometry at the instant a safety fires ─────
//
// The first attempt at this read the last `snap` event, which is wrong twice over: kickoffs and
// returns never emit one, so a safety on a return inherited whatever number was left over from
// the previous scrimmage down. That produced "safeties snapped from midfield", which is
// geometrically impossible and was a measurement bug, not a rules bug. Read the world instead.
for (let g = 0; g < GAMES; g++) {
  const cfg = defaultMatchConfig({
    seed: SEED + g * 7, quarterSeconds: 120, difficulty: 'PRO',
    home: TEAM_IDS[g % TEAM_IDS.length], away: TEAM_IDS[(g + 5) % TEAM_IDS.length],
    seats: [{ side: 0, active: false }, { side: 1, active: false },
      { side: 0, active: false }, { side: 1, active: false }],
  });
  const m = new Match({ config: cfg, home: getTeam(cfg.home!), away: getTeam(cfg.away!) });
  let source = 'KICKOFF'; let pending: string | null = 'KICKOFF';
  let lastPoss: TeamSide | null = null;
  m.bus.on('turnover', (e: any) => { pending = e.kind ?? 'TURNOVER'; });
  m.bus.on('kickoff', () => { pending = 'KICKOFF'; });
  m.bus.on('safety', (e: any) => {
    const w = m.world;
    const against = e.against as TeamSide;
    const car = w.athletes.find((a) => a.hasBall) ?? null;
    safeties.push({
      spot: ownYardLine(m.state.losZ, m.state.possession),
      down: m.state.down,
      how: source,
      playKind: w.special ?? 'SCRIMMAGE',
      // Where the ball actually died, and where whoever was holding it first got it.
      deadAt: ownYardLine(car ? car.z : w.ball.z, against),
      originAt: ownYardLine(w.gainOriginZ, against),
      conceder: against === m.state.possession ? 'OFFENCE' : 'DEFENCE-turned-carrier',
      threw: w.passThrown,
    });
  });
  let guard = 0;
  while (!m.state.finished && guard++ < 60 * 60 * 30) {
    if (m.state.phase === 'PRE_SNAP' && m.state.possession !== lastPoss) {
      lastPoss = m.state.possession; source = pending ?? 'OTHER'; pending = null;
    }
    m.tick();
  }
}

// ── report ───────────────────────────────────────────────────────────────────
function stats(v: number[]): string {
  if (!v.length) return 'none';
  const s = [...v].sort((a, b) => a - b);
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  return `n=${s.length}  mean ${mean.toFixed(1)}  p10 ${s[(s.length * 0.1) | 0]}  median ${s[(s.length * 0.5) | 0]}  p90 ${s[(s.length * 0.9) | 0]}`;
}
function histogram(v: number[], buckets: number[]): string {
  const counts = buckets.map(() => 0);
  for (const x of v) {
    for (let i = buckets.length - 1; i >= 0; i--) if (x >= buckets[i]) { counts[i]++; break; }
  }
  return buckets.map((b, i) => {
    const hi = i + 1 < buckets.length ? buckets[i + 1] - 1 : 100;
    const pct = (100 * counts[i]) / Math.max(1, v.length);
    return `  own ${String(b).padStart(3)}-${String(hi).padStart(3)}  ${String(counts[i]).padStart(5)}  ${pct.toFixed(1).padStart(5)}%  ${'#'.repeat(Math.round(pct / 2))}`;
  }).join('\n');
}

console.log(`\nGRIDIRON OVERDRIVE — field-position economy (${GAMES} games, PRO)`);
console.log('──────────────────────────────────────────────────────────────');
console.log(`drives              ${driveStarts.length}   (${(driveStarts.length / GAMES).toFixed(1)} per game)`);
console.log(`drive start         ${stats(driveStarts)}`);
console.log(histogram(driveStarts, [0, 5, 10, 20, 30, 40, 50, 60, 70, 80]));
console.log('\nby how the ball arrived:');
for (const [k, v] of [...startsBySource.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${k.padEnd(10)} ${stats(v)}`);
}
console.log(`\nplays               ${snaps}  (${(snaps / GAMES).toFixed(1)} per game)`);
console.log(`  starting inside own 10   ${snapsInsideOwn10}  (${(100 * snapsInsideOwn10 / Math.max(1, snaps)).toFixed(1)}%)`);
console.log(`  starting inside own  5   ${snapsInsideOwn5}  (${(100 * snapsInsideOwn5 / Math.max(1, snaps)).toFixed(1)}%)`);

const koRet = returns.filter((r) => r.kind === 'KICKOFF');
const puRet = returns.filter((r) => r.kind === 'PUNT');
console.log('\nkick returns (yards from the returning team\'s own goal):');
for (const [label, set] of [['kickoff', koRet], ['punt', puRet]] as [string, typeof returns][]) {
  if (!set.length) continue;
  const nets = set.map((r) => r.ended - r.caught);
  const lost = set.filter((r) => r.ended < r.caught).length;
  console.log(`  ${label.padEnd(8)} n=${set.length}`);
  console.log(`    fielded at    ${stats(set.map((r) => r.caught))}`);
  console.log(`    ended at      ${stats(set.map((r) => r.ended))}`);
  console.log(`    net gained    ${stats(nets)}`);
  console.log(`    went BACKWARDS on ${((100 * lost) / set.length).toFixed(0)}% of returns`);
}

console.log(`\nsafeties            ${safeties.length}  (${(safeties.length / GAMES).toFixed(2)} per game)`);
if (safeties.length) {
  const byHow = new Map<string, number>();
  const byKind = new Map<string, number>();
  const byDown = new Map<number, number>();
  for (const s of safeties) {
    byHow.set(s.how, (byHow.get(s.how) ?? 0) + 1);
    byKind.set(s.playKind, (byKind.get(s.playKind) ?? 0) + 1);
    byDown.set(s.down, (byDown.get(s.down) ?? 0) + 1);
  }
  const pc = (n: number): string => `${((100 * n) / safeties.length).toFixed(0)}%`;
  console.log('  ball arrived via ' + [...byHow.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${pc(n)}`).join('  '));
  console.log('  play was         ' + [...byKind.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${pc(n)}`).join('  '));
  console.log('  on down          ' + [...byDown.entries()].sort((a, b) => a[0] - b[0]).map(([k, n]) => `${k}: ${pc(n)}`).join('  '));
  console.log(`  line of scrimmage ${stats(safeties.map((s) => s.spot))}`);
  console.log(`  ball died at      ${stats(safeties.map((s) => s.deadAt))}`);
  console.log(`  carrier got it at ${stats(safeties.map((s) => s.originAt))}`);
  const byWho = new Map<string, number>();
  for (const s of safeties) byWho.set(s.conceder, (byWho.get(s.conceder) ?? 0) + 1);
  console.log('  conceded by      ' + [...byWho.entries()].map(([k, n]) => `${k} ${pc(n)}`).join('  '));
  console.log(`  after a pass     ${pc(safeties.filter((s) => s.threw).length)}`);
}

const mean = (v: number[]): number => v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);
console.log(`\nfirst downs / team  ${mean(firstDownsPerGame).toFixed(2)} per game`);
console.log(`combined score      ${mean(scores).toFixed(1)}   margin ${mean(margins).toFixed(1)}`);
console.log('──────────────────────────────────────────────────────────────');
