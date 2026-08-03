/**
 * Pass-outcome census.
 *
 * Counts what actually happens to every forward pass over a batch of CPU-vs-CPU games, so the
 * shape of the passing game can be argued about with numbers instead of impressions.
 *
 * "Interception" is deliberately reported as three different measures, because they are three
 * different facts: a defender-possession EVENT (the catch-resolution outcome), the credited
 * interception STAT (what the box score says), and a turnover DRIVE (whether the event actually
 * ended a possession). Collapsing them into one rate is how the old reports tuned the wrong layer.
 *
 *   npm run passprobe [-- --games 12]
 */
import { Match, defaultMatchConfig } from '../src/rules/match.ts';
import { getTeam, TEAM_IDS } from '../src/data/index.ts';
import type { GameEvent } from '../src/core/types.ts';
import { ThrowLedger, rate } from './lib/throwLedger.ts';
import { fingerprint, printFingerprint } from './lib/fingerprint.ts';

const argv = process.argv.slice(2);
const games = Number(argv[argv.indexOf('--games') + 1]) || 8;

const ledger = new ThrowLedger();
let contestedCatches = 0;
let contestedBobbles = 0;
let creditedInts = 0;
let creditedPassAtt = 0;
let intTurnoverDrives = 0;
let drives = 0;
let pickSixes = 0;

for (let g = 0; g < games; g++) {
  const cfg = defaultMatchConfig({
    seed: 9100 + g, quarterSeconds: 300, difficulty: 'PRO',
    home: TEAM_IDS[g % TEAM_IDS.length], away: TEAM_IDS[(g + 3) % TEAM_IDS.length],
    seats: [{ side: 0, active: false }, { side: 1, active: false }],
  });
  const m = new Match({ config: cfg, home: getTeam(cfg.home!), away: getTeam(cfg.away!), seatIntent: () => null });
  m.bus.on('*', (e: GameEvent) => ledger.handle(e));

  let tipLive = false;
  let pickLive = false;
  let inDrive = false;
  const bus = m.bus as unknown as { on: (t: string, f: (e: unknown) => void) => void };
  bus.on('play.start', () => { if (!inDrive) { inDrive = true; drives++; } });
  bus.on('catch', (e) => {
    if ((e as { contested: boolean }).contested) contestedCatches++;
    if (tipLive) tipLive = false;
  });
  bus.on('bobble', (e) => {
    tipLive = true;
    if ((e as { contested: boolean }).contested) contestedBobbles++;
  });
  bus.on('interception', () => { tipLive = false; pickLive = true; });
  bus.on('touchdown', () => { if (pickLive) pickSixes++; });
  bus.on('play.end', () => { tipLive = false; pickLive = false; });
  bus.on('turnover', (e) => {
    inDrive = false;
    if ((e as { kind: string }).kind === 'INT') intTurnoverDrives++;
  });
  for (const ev of ['touchdown', 'fieldGoal.result', 'safety', 'punt', 'quarter.end']) {
    bus.on(ev, () => { inDrive = false; });
  }
  for (let i = 0; i < 200000 && !m.state.finished; i++) m.tick();
  creditedInts += m.state.teams[0].stats.ints + m.state.teams[1].stats.ints;
  creditedPassAtt += m.state.teams[0].stats.passAtt + m.state.teams[1].stats.passAtt;
}

const t = ledger.tally();
const per = (n: number): string => (n / games).toFixed(2).padStart(7);

console.log(`\nPASS CENSUS — ${games} full CPU games\n${'─'.repeat(70)}`);
printFingerprint(fingerprint({
  tool: 'passprobe', seeds: `9100..${9100 + games - 1}`,
  teams: 'rotating home/away over TEAM_IDS', difficulty: 'PRO', quarterSeconds: 300,
}));
console.log('─'.repeat(70));
console.log(`  actual throws            ${per(t.throws)} /game`);
console.log(`  caught                   ${per(t.caught)} /game   ${rate(t.caught, t.throws, 'of throws')}`);
console.log(`    of which contested     ${per(contestedCatches)} /game   ${rate(contestedCatches, t.caught, 'of catches')}`);
console.log(`  dropped                  ${per(t.dropped)} /game   ${rate(t.dropped, t.throws, 'of throws')}`);
console.log(`  swatted                  ${per(t.swatted)} /game   ${rate(t.swatted, t.throws, 'of throws')}`);
console.log(`  fell incomplete          ${per(t.fellIncomplete)} /game   ${rate(t.fellIncomplete, t.throws, 'of throws')}`);
console.log(`  BOBBLED in flight        ${per(t.bobbled)} /game   ${rate(t.bobbled, t.throws, 'of throws (intermediate, not an outcome)')}`);
console.log(`    from a contested ball  ${per(contestedBobbles)} /game`);
console.log(`    → secured by offence   ${per(t.bobbledToOffense)} /game   ${rate(t.bobbledToOffense, t.bobbled, 'of bobbles')}`);
console.log(`    → taken by defence     ${per(t.bobbledToDefender)} /game   ${rate(t.bobbledToDefender, t.bobbled, 'of bobbles')}`);
console.log('─'.repeat(70));
console.log('  interception, by which question is being asked:');
console.log(`    defender-possession EVENT   ${rate(t.defenderPossession, t.throws, 'of actual throws')}`);
console.log(`    credited interception STAT  ${rate(creditedInts, creditedPassAtt, 'of official attempts')}`);
console.log(`    interception-ended DRIVES   ${rate(intTurnoverDrives, drives, 'of all drives')}`);
console.log(`    returned for touchdown      ${rate(pickSixes, t.defenderPossession, 'of defender possessions')}`);
console.log('─'.repeat(70));
console.log(`  reconciliation: throws ${t.throws} == caught ${t.caught} + dropped ${t.dropped}`
  + ` + swatted ${t.swatted} + defPoss ${t.defenderPossession} + fellInc ${t.fellIncomplete}`
  + ` → ${ThrowLedger.reconciles(t) ? 'OK' : 'MISMATCH — BUG'}`);
console.log('─'.repeat(70) + '\n');
if (!ThrowLedger.reconciles(t)) process.exit(1);
