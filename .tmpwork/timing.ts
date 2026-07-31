import { simulateMatch } from '../src/testing/simRunner.ts';
import { TEAM_IDS } from '../src/data/index.ts';
const t0 = Date.now();
let n = 0;
for (let i = 0; i < 8; i++) {
  const r = simulateMatch({ seed: 1000 + i, home: TEAM_IDS[i % 16], away: TEAM_IDS[(i + 3) % 16], quarterSeconds: 120, record: false });
  n++;
  if (i < 3) console.log(r.homeScore, r.awayScore, 'ints', r.stats[0].ints, r.stats[1].ints, 'sacks', r.stats[0].sacks, r.stats[1].sacks, 'passTd', r.stats[0].passTd, 'rushTd', r.stats[0].rushTd, 'passYds', r.stats[0].passYds, 'rushYds', r.stats[0].rushYds);
}
console.log('per game ms', (Date.now() - t0) / n);
