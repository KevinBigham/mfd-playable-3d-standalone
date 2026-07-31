import {
  createSeason, simulateWeek, playWeek, advanceSeason, nextGameFor, seasonComplete,
  standingsFor, buildPlayoffs, type GameSimulator, REGULAR_WEEKS, playoffBracket, weekLabel,
} from '../src/modes/season.ts';
import { Rng } from '../src/core/rng.ts';
import { TEAM_IDS } from '../src/data/index.ts';

function fakeSim(): GameSimulator {
  return (req) => {
    const rng = new Rng(req.seed);
    const h = rng.int(0, 8) * 7 + rng.int(0, 1) * 3;
    const a = rng.int(0, 8) * 7 + rng.int(0, 1) * 3;
    return { homeScore: h, awayScore: a, stats: [mk(rng, h), mk(rng, a)], };
  };
}
function mk(rng: Rng, score: number) {
  return { passAtt: 20, passComp: 12, passYds: rng.int(80, 320), passTd: Math.floor(score / 14), ints: rng.int(0, 3),
    rushAtt: 8, rushYds: rng.int(-10, 90), rushTd: Math.floor(score / 21), sacks: rng.int(0, 6), tackles: 20, bigHits: 3,
    forcedFumbles: 1, firstDowns: 9, totalYds: 300, plays: 40, fgAtt: 1, fgMade: 1, punts: 2, possessionTicks: 100,
    longestPlay: 40, overdrives: 1 };
}

let champs = 0;
for (const seed of [1, 2, 3, 77, 20240, 999]) {
  const save = createSeason(TEAM_IDS[5], 'PRO', seed);
  let guard = 0;
  while (!seasonComplete(save) && guard++ < 40) {
    const res = simulateWeek(save, null, { simulate: fakeSim() });
    playWeek(save, res);
    advanceSeason(save);
  }
  const b = playoffBracket(save);
  console.log('seed', seed, 'champ', save.champion, 'week', save.week, 'label', weekLabel(save),
    'bracket', b.map(r => r.length).join('/'), 'playoffs', save.playoffs.length,
    'guard', guard, 'next', nextGameFor(save));
  if (save.champion) champs++;
  // champion must be one of the two conference finalists
  const title = save.playoffs.find(g => g.round === 2)!;
  if (![title.home, title.away].includes(save.champion!)) console.log('!!! BAD CHAMPION');
  // top seeds
  const s0 = standingsFor(save, 0);
  if (s0.length !== 8) console.log('!!! BAD STANDINGS');
}
console.log('champions produced', champs, '/6');
