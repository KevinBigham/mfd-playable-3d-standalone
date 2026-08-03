#!/usr/bin/env tsx
/**
 * Drive census — where the offence's yards actually come from, and where drives die.
 *
 * The batch sim reports totals. Totals hide the shape: "200 pass yards, 48 rush yards" is a fact
 * about the box score, not an answer to whether the run game works, whether the play caller ever
 * calls one, or whether second-and-long is a death sentence. This breaks the same games down by
 * play tag, by down, and by how drives end, which is the level the chain has to be tuned at.
 *
 *   npm run driveprobe [-- --games 20]
 */
import { Match, defaultMatchConfig } from '../src/rules/match.ts';
import { getTeam, TEAM_IDS } from '../src/data/index.ts';
import { OFFENSE_PLAYS } from '../src/plays/offense.ts';
import { FIRST_DOWN_YARDS } from '../src/core/constants.ts';
import type { DeadReason, GameEvent, PlayTag } from '../src/core/types.ts';
import { ThrowLedger, rate } from './lib/throwLedger.ts';
import { fingerprint, printFingerprint } from './lib/fingerprint.ts';

const argv = process.argv.slice(2);
const games = Number(argv[argv.indexOf('--games') + 1]) || 20;

/** One entry per actual forward throw, grouped by the play family live at the time. */
let currentBucket = 'other';
const ledger = new ThrowLedger(() => currentBucket);
/** Credited interception stat (rulesEngine `stats.ints`), summed over both teams at each final. */
let creditedInts = 0;
/** Official pass attempts from the stat layer, the denominator credited stats are quoted per. */
let creditedPassAtt = 0;
/** Drive-ending turnovers, split by kind, from the `turnover` event. */
const turnoverKinds = new Map<string, number>();

const tagOf = new Map<string, PlayTag[]>();
for (const p of OFFENSE_PLAYS) tagOf.set(p.id, p.tags);
/** One bucket per play: a run, or the kind of pass it is. */
function bucketOf(id: string): string {
  const tags = tagOf.get(id);
  if (!tags) return 'other';
  if (tags.includes('RUN')) return 'RUN';
  if (tags.includes('SCREEN')) return 'SCREEN';
  if (tags.includes('DEEP')) return 'DEEP';
  if (tags.includes('QUICK')) return 'QUICK';
  return 'PASS';
}

interface Bucket { plays: number; yards: number; loss: number; explosive: number;
  catches: number; yac: number; sep: number; sacks: number; incompletes: number }
const byBucket = new Map<string, Bucket>();
const byDown = [0, 1, 2, 3, 4].map(() => ({ plays: 0, yards: 0, converted: 0 }));
const endings = new Map<DeadReason | string, number>();
const driveEnds = new Map<string, number>();
let drives = 0, driveePlays = 0, firstDowns = 0, thirdAtt = 0, thirdConv = 0;
let yacPlays = 0, yacYards = 0, catchZ = 0, catching = false, catchSep = 0, sackPending = false;
/** Third downs split by whether the chain or the goal line is the thing being reached. */
const g2g = { att: 0, conv: 0 }, open3 = { att: 0, conv: 0 };
/** Distance-to-go buckets on the money down, because "3rd and 4" and "3rd and 24" are not one thing. */
const thirdByDist = [
  { label: '1-8 yd  ', lo: 0, hi: 8, att: 0, conv: 0 },
  { label: '9-16 yd ', lo: 8, hi: 16, att: 0, conv: 0 },
  { label: '17-24 yd', lo: 16, hi: 24, att: 0, conv: 0 },
  { label: '25+ yd  ', lo: 24, hi: 999, att: 0, conv: 0 },
];

function bump(map: Map<string, number>, k: string): void { map.set(k, (map.get(k) ?? 0) + 1); }

for (let g = 0; g < games; g++) {
  const cfg = defaultMatchConfig({
    seed: 4400 + g, quarterSeconds: 120, difficulty: 'PRO',
    home: TEAM_IDS[g % TEAM_IDS.length], away: TEAM_IDS[(g + 5) % TEAM_IDS.length],
    seats: [{ side: 0, active: false }, { side: 1, active: false }],
  });
  const m = new Match({ config: cfg, home: getTeam(cfg.home!), away: getTeam(cfg.away!), seatIntent: () => null });
  const bus = m.bus as unknown as { on: (t: string, f: (e: never) => void) => void };
  m.bus.on('*', (e: GameEvent) => ledger.handle(e));
  m.bus.on('turnover', (e) => {
    const ev = e as GameEvent & { type: 'turnover' };
    turnoverKinds.set(ev.kind, (turnoverKinds.get(ev.kind) ?? 0) + 1);
  });

  let bucket = 'other';
  let down = 1, distance = FIRST_DOWN_YARDS, goalToGo = false;
  let inDrive = false, thisDrivePlays = 0;

  bus.on('play.start', ((e: { play: string }) => {
    bucket = bucketOf(e.play);
    currentBucket = bucket;
    if (!inDrive) { inDrive = true; drives++; thisDrivePlays = 0; }
    thisDrivePlays++;
  }) as never);

  // Down and distance are read from match state at the SNAP, not from the event stream. A play
  // that scores never emits a down change — the match jumps straight to the score phase — so an
  // event-driven reader carries the last drive's distance into the next one and mislabels every
  // play until something non-scoring happens. That is how an earlier version of this file
  // reported third-and-goal as 0 for 52 when the real number is 6 for 41.
  bus.on('snap', (() => {
    const st = m.state;
    down = st.down;
    const toGoal = st.possession === 0 ? 100 - st.losZ : st.losZ;
    distance = Math.min(Math.abs(st.firstDownZ - st.losZ), toGoal);
    goalToGo = Math.abs(st.firstDownZ - st.losZ) >= toGoal - 0.01;
  }) as never);

  bus.on('play.end', ((e: { reason: DeadReason; yards: number }) => {
    bump(endings, e.reason);
    const b = byBucket.get(bucket)
      ?? { plays: 0, yards: 0, loss: 0, explosive: 0, catches: 0, yac: 0, sep: 0, sacks: 0, incompletes: 0 };
    b.plays++; b.yards += e.yards;
    if (e.yards < 0) b.loss++;
    if (e.yards >= 20) b.explosive++;
    byBucket.set(bucket, b);

    const d = byDown[Math.min(4, Math.max(0, down))];
    d.plays++; d.yards += e.yards;
    if (e.yards >= distance) d.converted++;

    if (catching) {
      const gained = Math.abs(m.world.ball.z - catchZ);
      yacPlays++; yacYards += gained;
      b.catches++; b.yac += gained; b.sep += catchSep;
      catching = false;
    }
    if (e.reason === 'INCOMPLETE') b.incompletes++;
    if (sackPending) { b.sacks++; sackPending = false; }
    if (down === 3) {
      thirdAtt++;
      if (e.yards >= distance) thirdConv++;
      // Goal-to-go is a different question from third-and-six at midfield: the end zone is a hard
      // wall behind the defence, so the same distance is much harder. Reported separately or the
      // short-yardage numbers read as a bug that is really a mix of two populations.
      const t2 = goalToGo ? g2g : open3;
      t2.att++; if (e.yards >= distance) t2.conv++;
      for (const t of thirdByDist) {
        if (distance > t.lo && distance <= t.hi) { t.att++; if (e.yards >= distance) t.conv++; break; }
      }
    }
  }) as never);

  bus.on('firstDown', (() => { firstDowns++; }) as never);

  // Yards after catch. The short passing game lives or dies on this number and nothing was
  // measuring it: a slant that gains three yards is not a slant, it is a way to stop the clock.
  bus.on('catch', (() => {
    const w = m.world;
    const c = w.athletes.find((a) => a.hasBall);
    if (!c) return;
    catchZ = c.z; catching = true;
    // Separation at the catch point. This is the number that decides whether a short concept is
    // a first down or a way to burn a down: a receiver caught with a defender on his hip gains
    // nothing after the catch no matter how good the throw was.
    let near = 99;
    for (const d of w.athletes) {
      if (d.side === c.side) continue;
      near = Math.min(near, Math.hypot(d.x - c.x, d.z - c.z));
    }
    catchSep = near;
  }) as never);
  bus.on('sack', (() => { sackPending = true; }) as never);

  for (const ev of ['touchdown', 'turnover', 'fieldGoal', 'safety'] as const) {
    bus.on(ev, (() => {
      if (!inDrive) return;
      bump(driveEnds, ev); inDrive = false; driveePlays += thisDrivePlays;
    }) as never);
  }
  bus.on('quarter.end', (() => { inDrive = false; }) as never);

  for (let i = 0; i < 200000 && !m.state.finished; i++) m.tick();
  creditedInts += m.state.teams[0].stats.ints + m.state.teams[1].stats.ints;
  creditedPassAtt += m.state.teams[0].stats.passAtt + m.state.teams[1].stats.passAtt;
}

const n = (v: number, w = 6, dp = 1): string => v.toFixed(dp).padStart(w);
const pc = (a: number, b: number): string => (b === 0 ? '   —  ' : `${((a / b) * 100).toFixed(0)}%`.padStart(5));

console.log(`\nDRIVE CENSUS — ${games} CPU games, 2:00 quarters, ${FIRST_DOWN_YARDS}-yard chain`);
console.log('─'.repeat(74));
printFingerprint(fingerprint({
  tool: 'driveprobe', seeds: `4400..${4400 + games - 1}`,
  teams: 'rotating home/away over TEAM_IDS', difficulty: 'PRO', quarterSeconds: 120,
}));
console.log('─'.repeat(74));
// comp% below is caught / ACTUAL THROWS — every throw outcome is in the denominator, including
// drops, swats, defender-possession events, and untouched incompletions. The old figure divided
// by catches+incompletes and overstated every family; do not compare against pre-repair receipts.
console.log('  play type    plays/gm  yd/play  lost  20+  throws  comp%   YAC   separation  sack%');
for (const [k, b] of [...byBucket].sort((p, q) => q[1].plays - p[1].plays)) {
  const t = ledger.tally(k);
  console.log(`  ${k.padEnd(10)} ${n(b.plays / games)}   ${n(b.yards / Math.max(1, b.plays), 6, 2)}  ${pc(b.loss, b.plays)} ${pc(b.explosive, b.plays)}  ${String(t.throws).padStart(5)} ${pc(t.caught, t.throws)}  ${n(b.yac / Math.max(1, b.catches), 5, 2)}     ${n(b.sep / Math.max(1, b.catches), 5, 2)}     ${pc(b.sacks, b.plays)}`);
}
console.log('─'.repeat(74));
console.log('  throw outcomes (mutually exclusive; each row reconciles to actual throws)');
console.log('  play type   throws  caught  dropped  swatted  defPoss  fellInc  bobbled  reconciled');
for (const k of ledger.buckets().sort()) {
  const t = ledger.tally(k);
  console.log(`  ${k.padEnd(10)} ${String(t.throws).padStart(6)} ${String(t.caught).padStart(7)}`
    + ` ${String(t.dropped).padStart(8)} ${String(t.swatted).padStart(8)} ${String(t.defenderPossession).padStart(8)}`
    + ` ${String(t.fellIncomplete).padStart(8)} ${String(t.bobbled).padStart(8)}`
    + `   ${ThrowLedger.reconciles(t) ? 'yes' : 'NO — BUG'}`);
}
const all = ledger.tally();
console.log(`  ${'ALL'.padEnd(10)} ${String(all.throws).padStart(6)} ${String(all.caught).padStart(7)}`
  + ` ${String(all.dropped).padStart(8)} ${String(all.swatted).padStart(8)} ${String(all.defenderPossession).padStart(8)}`
  + ` ${String(all.fellIncomplete).padStart(8)} ${String(all.bobbled).padStart(8)}`
  + `   ${ThrowLedger.reconciles(all) ? 'yes' : 'NO — BUG'}`);
console.log('─'.repeat(74));
console.log('  interception is three different measures; never quote one as another:');
console.log(`    defender-possession events   ${rate(all.defenderPossession, all.throws, 'of actual throws')}`);
console.log(`    credited interceptions       ${rate(creditedInts, creditedPassAtt, 'of official pass attempts')}`);
const intDrives = turnoverKinds.get('INT') ?? 0;
console.log(`    drives ended by interception ${rate(intDrives, drives, 'of all drives')}`);
console.log(`    bobbles ending with defense  ${rate(all.bobbledToDefender, all.bobbled, 'of bobbled throws')}`);
console.log('─'.repeat(74));
console.log('  down          plays/gm   yd/play   moved the chain');
for (let d = 1; d <= 4; d++) {
  const x = byDown[d];
  console.log(`  ${String(d).padEnd(12)} ${n(x.plays / games)}    ${n(x.yards / Math.max(1, x.plays), 6, 2)}    ${pc(x.converted, x.plays)}`);
}
console.log('─'.repeat(74));
console.log(`  third down overall  ${thirdConv}/${thirdAtt} = ${pc(thirdConv, thirdAtt)}`);
console.log(`    open field        ${String(open3.conv).padStart(3)}/${String(open3.att).padStart(3)} = ${pc(open3.conv, open3.att)}`);
console.log(`    goal to go        ${String(g2g.conv).padStart(3)}/${String(g2g.att).padStart(3)} = ${pc(g2g.conv, g2g.att)}`);
for (const t of thirdByDist) console.log(`    3rd and ${t.label}  ${String(t.conv).padStart(3)}/${String(t.att).padStart(3)} = ${pc(t.conv, t.att)}`);
console.log('─'.repeat(74));
console.log(`  yards after catch   ${n(yacYards / Math.max(1, yacPlays), 6, 2)} per completion`);
console.log(`  first downs         ${n(firstDowns / games)} /game (both teams)`);
console.log(`  drives              ${n(drives / games)} /game, ${n(driveePlays / Math.max(1, drives), 6, 2)} plays each`);
const de = [...driveEnds].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(v / games).toFixed(1)}`).join('  ');
console.log(`  drives end in       ${de}`);
const en = [...endings].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} ${(v / games).toFixed(1)}`).join('  ');
console.log(`  plays end in        ${en}`);
console.log('─'.repeat(74) + '\n');
