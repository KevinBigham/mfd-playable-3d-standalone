import { simulateMatch } from '../src/testing/simRunner.ts';
import { TEAM_IDS } from '../src/data/index.ts';
for (const q of [60, 120]) {
  const t0 = Date.now();
  for (let i = 0; i < 6; i++) simulateMatch({ seed: 500 + i, home: TEAM_IDS[i % 16], away: TEAM_IDS[(i + 5) % 16], quarterSeconds: q, record: false });
  console.log('q', q, 'per game ms', (Date.now() - t0) / 6);
}
