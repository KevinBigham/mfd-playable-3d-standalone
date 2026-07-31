import { createSeason, simulateWeek, playWeek, advanceSeason } from '../src/modes/season.ts';
import { TEAM_IDS } from '../src/data/index.ts';
const save = createSeason(TEAM_IDS[0], 'PRO', 4242);
const t0 = Date.now();
for (let w = 0; w < 3; w++) {
  const res = simulateWeek(save, null, { quarterSeconds: 60 });
  playWeek(save, res); advanceSeason(save);
}
console.log('3 weeks (24 games) ms', Date.now() - t0, '=> full season est ms', Math.round((Date.now()-t0)/24*119));
console.log('week', save.week, 'sample', save.schedule.slice(0,3).map(g => `${g.home} ${g.homeScore}-${g.awayScore} ${g.away}`));
console.log('leaders sample', save.leaders[TEAM_IDS[0]]);
