import { createSeason, buildSchedule, REGULAR_WEEKS } from '../src/modes/season.ts';
import { TEAM_IDS, CONFERENCES } from '../src/data/index.ts';

for (const seed of [1, 7, 12345, 999983]) {
  const s = buildSchedule(seed);
  const weeks = new Set(s.map(g => g.week));
  const perTeam: Record<string, number> = {};
  const homeCount: Record<string, number> = {};
  const perWeek: Record<string, Set<number>> = {};
  const pairs: Record<string, number> = {};
  let bad = 0;
  for (const t of TEAM_IDS) { perTeam[t] = 0; homeCount[t] = 0; perWeek[t] = new Set(); }
  for (const g of s) {
    perTeam[g.home]++; perTeam[g.away]++; homeCount[g.home]++;
    if (perWeek[g.home].has(g.week)) bad++;
    if (perWeek[g.away].has(g.week)) bad++;
    perWeek[g.home].add(g.week); perWeek[g.away].add(g.week);
    const k = [g.home, g.away].sort().join('|');
    pairs[k] = (pairs[k] ?? 0) + 1;
    const ck = `${g.home}>${g.away}`;
    pairs[ck] = (pairs[ck] ?? 0) + 1;
  }
  const gamesPer = new Set(Object.values(perTeam));
  const homePer = new Set(Object.values(homeCount));
  // every intra-conference pair exactly twice
  let pairErrs = 0, dirErrs = 0;
  for (const c of CONFERENCES) for (let i = 0; i < c.teamIds.length; i++) for (let j = i+1; j < c.teamIds.length; j++) {
    const k = [c.teamIds[i], c.teamIds[j]].sort().join('|');
    if (pairs[k] !== 2) pairErrs++;
    if (pairs[`${c.teamIds[i]}>${c.teamIds[j]}`] !== 1) dirErrs++;
    if (pairs[`${c.teamIds[j]}>${c.teamIds[i]}`] !== 1) dirErrs++;
  }
  // no cross-conference games
  let cross = 0;
  for (const g of s) {
    const ca = CONFERENCES.findIndex(c => c.teamIds.includes(g.home));
    const cb = CONFERENCES.findIndex(c => c.teamIds.includes(g.away));
    if (ca !== cb) cross++;
  }
  console.log('seed', seed, 'games', s.length, 'weeks', weeks.size, 'maxWeek', Math.max(...weeks),
    'gamesPerTeam', [...gamesPer], 'homePerTeam', [...homePer], 'doubleBook', bad,
    'pairErrs', pairErrs, 'dirErrs', dirErrs, 'cross', cross);
}
const save = createSeason(TEAM_IDS[3], 'PRO', 42);
console.log('week', save.week, 'standings keys', Object.keys(save.standings).length, 'leaders', Object.keys(save.leaders).length, 'REGULAR_WEEKS', REGULAR_WEEKS);
