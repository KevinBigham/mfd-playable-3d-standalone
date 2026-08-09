#!/usr/bin/env tsx
/** Deterministic concept census used by the movement-intelligence acceptance gates. */
import { Match, defaultMatchConfig } from '../src/rules/match.ts';
import { getTeam, TEAM_IDS } from '../src/data/index.ts';
import { OFFENSE_PLAYS } from '../src/plays/offense.ts';
import { distanceToGo, isAndGoal } from '../src/rules/rulesEngine.ts';

type Concept = 'SCREEN' | 'SHORT' | 'REDZONE' | 'PURSUIT';
const argv = process.argv.slice(2);
const concept = (argv[argv.indexOf('--concept') + 1] ?? 'SCREEN') as Concept;
const games = Number(argv[argv.indexOf('--games') + 1]) || 20;
const seedStart = Number(argv[argv.indexOf('--seed-start') + 1]) || 9100;
const playsById = new Map(OFFENSE_PLAYS.map((play) => [play.id, play]));

let plays = 0, yards = 0, conversions = 0, negative = 0, sacks = 0, turnovers = 0;
for (let g = 0; g < games; g++) {
  const cfg = defaultMatchConfig({ seed: seedStart + g, quarterSeconds: 120, difficulty: 'PRO',
    home: TEAM_IDS[g % TEAM_IDS.length], away: TEAM_IDS[(g + 3) % TEAM_IDS.length],
    seats: [{ side: 0, active: false }, { side: 1, active: false }] });
  const m = new Match({ config: cfg, home: getTeam(cfg.home!), away: getTeam(cfg.away!), seatIntent: () => null });
  const bus = m.bus as unknown as { on: (type: string, fn: (event: any) => void) => void };
  let active = false, needed = 5, scored = false;
  bus.on('play.start', (e) => {
    const play = playsById.get(e.play);
    needed = distanceToGo(m.state);
    scored = false;
    if (!play) { active = false; return; }
    if (concept === 'SCREEN') active = play.tags.includes('SCREEN');
    else if (concept === 'SHORT') active = play.tags.includes('RUN') && needed >= 0.5 && needed <= 3 && m.state.down >= 3;
    else if (concept === 'REDZONE') active = play.tags.includes('QUICK') && isAndGoal(m.state)
      && Math.abs((m.state.possession === 0 ? 100 : 0) - m.state.losZ) <= 12;
    else active = play.tags.includes('RUN') || play.tags.includes('SCREEN') || play.tags.includes('QUICK');
  });
  bus.on('touchdown', () => { if (active) scored = true; });
  bus.on('sack', () => { if (active) sacks++; });
  bus.on('play.end', (e) => {
    if (!active) return;
    plays++; yards += e.yards ?? 0;
    if ((e.yards ?? 0) < 0) negative++;
    const threshold = concept === 'SCREEN' || concept === 'PURSUIT' ? 5 : needed;
    if (scored || (e.yards ?? 0) >= threshold) conversions++;
    if (e.reason === 'INTERCEPTION' || e.reason === 'FUMBLE') turnovers++;
    active = false;
  });
  for (let i = 0; i < 200000 && !m.state.finished; i++) m.tick();
}
const mean = plays ? yards / plays : 0;
console.log(JSON.stringify({ concept, seedStart, games, selectedPlays: plays, yardsPerPlay: Number(mean.toFixed(4)),
  conversionRate: Number((conversions / Math.max(1, plays)).toFixed(4)), negativeRate: Number((negative / Math.max(1, plays)).toFixed(4)),
  sackRate: Number((sacks / Math.max(1, plays)).toFixed(4)), turnoverRate: Number((turnovers / Math.max(1, plays)).toFixed(4)) }));
