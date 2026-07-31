import { simulateMatch } from '../src/testing/simRunner.ts';
import { TEAM_IDS } from '../src/data/index.ts';
for (const q of [60, 120, 360]) {
  const r = simulateMatch({ seed: 7, home: TEAM_IDS[2], away: TEAM_IDS[9], quarterSeconds: q, record: false });
  console.log('q', q, 'ticks', r.ticks, 'ms', r.wallMs, 'score', r.homeScore, r.awayScore, 'ot', r.overtime);
}
