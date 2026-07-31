import { simulateMatch } from '../src/testing/simRunner.ts';
import { TEAM_IDS } from '../src/data/index.ts';
const t0 = Date.now();
for (let i = 0; i < 3; i++) {
  const r = simulateMatch({ seed: 1000 + i, home: TEAM_IDS[0], away: TEAM_IDS[3], quarterSeconds: 120, record: false });
  console.log(r.homeScore, r.awayScore, r.winner, r.completed, r.wallMs);
}
console.log('total', Date.now() - t0);
