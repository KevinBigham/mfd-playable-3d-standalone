/**
 * Pass-outcome census.
 *
 * Counts what actually happens to every forward pass over a batch of CPU-vs-CPU games, so the
 * shape of the passing game can be argued about with numbers instead of impressions. Written to
 * settle one question — how often a ball is contested at all, which decides whether the bobble is
 * a real mechanic or a curiosity nobody will ever see — and kept because "how often does X happen"
 * is the question I keep needing to answer.
 *
 *   npm run passprobe [-- --games 12]
 */
import { Match, defaultMatchConfig } from '../src/rules/match.ts';
import { getTeam, TEAM_IDS } from '../src/data/index.ts';

const argv = process.argv.slice(2);
const games = Number(argv[argv.indexOf('--games') + 1]) || 8;

const tally: Record<string, number> = {
  pass: 0, catch: 0, catchContested: 0, drop: 0, bobble: 0, bobbleContested: 0,
  swat: 0, interception: 0, tipCaught: 0, tipPicked: 0,
};

for (let g = 0; g < games; g++) {
  const cfg = defaultMatchConfig({
    seed: 9100 + g, quarterSeconds: 300, difficulty: 'PRO',
    home: TEAM_IDS[g % TEAM_IDS.length], away: TEAM_IDS[(g + 3) % TEAM_IDS.length],
    seats: [{ side: 0, active: false }, { side: 1, active: false }],
  });
  const m = new Match({ config: cfg, home: getTeam(cfg.home!), away: getTeam(cfg.away!), seatIntent: () => null });
  let tipLive = false;
  const bus = m.bus as unknown as { on: (t: string, f: (e: unknown) => void) => void };
  bus.on('throw', () => { tally.pass++; });
  bus.on('catch', (e) => {
    tally.catch++;
    const ev = e as { contested: boolean };
    if (ev.contested) tally.catchContested++;
    if (tipLive) { tally.tipCaught++; tipLive = false; }
  });
  bus.on('drop', () => { tally.drop++; });
  bus.on('bobble', (e) => {
    tally.bobble++; tipLive = true;
    if ((e as { contested: boolean }).contested) tally.bobbleContested++;
  });
  bus.on('swat', () => { tally.swat++; });
  bus.on('interception', () => { tally.interception++; if (tipLive) { tally.tipPicked++; tipLive = false; } });
  bus.on('play.end', () => { tipLive = false; });
  for (let i = 0; i < 200000 && !m.state.finished; i++) m.tick();
}

const per = (n: number): string => (n / games).toFixed(2).padStart(7);
const pct = (n: number, d: number): string => (d === 0 ? '   —  ' : `${((n / d) * 100).toFixed(1)}%`.padStart(6));

console.log(`\nPASS CENSUS — ${games} full CPU games\n${'─'.repeat(62)}`);
console.log(`  passes thrown            ${per(tally.pass)} /game`);
console.log(`  completions              ${per(tally.catch)} /game   ${pct(tally.catch, tally.pass)} of throws`);
console.log(`    of which contested     ${per(tally.catchContested)} /game   ${pct(tally.catchContested, tally.catch)} of catches`);
console.log(`  drops (dead)             ${per(tally.drop)} /game   ${pct(tally.drop, tally.pass)} of throws`);
console.log(`  swats                    ${per(tally.swat)} /game   ${pct(tally.swat, tally.pass)} of throws`);
console.log(`  interceptions            ${per(tally.interception)} /game   ${pct(tally.interception, tally.pass)} of throws`);
console.log(`  BOBBLES                  ${per(tally.bobble)} /game   ${pct(tally.bobble, tally.pass)} of throws`);
console.log(`    from a contested ball  ${per(tally.bobbleContested)} /game`);
console.log(`    → secured by offence   ${per(tally.tipCaught)} /game   ${pct(tally.tipCaught, tally.bobble)} of bobbles`);
console.log(`    → picked off in air    ${per(tally.tipPicked)} /game   ${pct(tally.tipPicked, tally.bobble)} of bobbles`);
console.log(`${'─'.repeat(62)}\n`);
