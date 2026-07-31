import './domstub.ts';
import type { N } from './domstub.ts';

async function main() {
  const { SeasonScreen } = await import('../src/ui/screens/season.ts');
  const { getSave, writeSave } = await import('../src/persistence/save.ts');
  const { createSeason, simulateWeek, playWeek, advanceSeason, currentFixtures, recordResult } = await import('../src/modes/season.ts');
  const { TEAM_IDS } = await import('../src/data/index.ts');
  const { Rng } = await import('../src/core/rng.ts');

  const fakeSim = (req: { seed: number }) => {
    const rng = new Rng(req.seed);
    const h = rng.int(0, 7) * 7, a = rng.int(0, 7) * 7 + 3;
    return { homeScore: h, awayScore: a };
  };

  const root = (document as unknown as { createElement(t: string): N }).createElement('div');
  const log: string[] = [];
  const ctx = {
    root: root as unknown as HTMLElement,
    input: { menuPressed: () => false } as never,
    go: (n: string) => { log.push(`go:${n}`); },
    replace: (n: string) => { log.push(`replace:${n}`); },
    reset: (n: string) => { log.push(`reset:${n}`); },
    back: () => { log.push('back'); },
    sound: () => {},
  };
  const game = {
    audio: { music: { start() {} } },
    settings: { quarterSeconds: 120, reducedMotion: false, difficulty: 'PRO' },
    match: null,
  } as never;

  const scr = new SeasonScreen(game);
  const views: string[] = [];
  const dump = (tag: string) => {
    const txt = (root as unknown as N).textContent;
    views.push(`${tag}: ${txt.slice(0, 90).replace(/\s+/g, ' ')}`);
  };

  // 1. no save -> setup
  writeSave({ season: null });
  scr.mount(ctx as never); dump('SETUP');
  const anyScr = scr as unknown as { render(): void; view: string; show(v: string): void; playNext(): void; recordHumanGame(f: unknown, r: unknown): void; season: unknown };
  anyScr.view = 'SETUP'; anyScr.render(); dump('SETUP-again');
  scr.unmount();

  // 2. mid-season hub + every sub view
  const season = createSeason(TEAM_IDS[4], 'ALLSTAR', 4242);
  for (let i = 0; i < 4; i++) { playWeek(season, simulateWeek(season, null, { simulate: fakeSim })); advanceSeason(season); }
  writeSave({ season });
  scr.mount(ctx as never); dump('HUB');
  for (const v of ['SCHEDULE', 'STANDINGS', 'STATS', 'ABANDON']) { anyScr.show(v); dump(v); }
  anyScr.show('SCHEDULE');
  (scr as unknown as { leagueView: boolean }).leagueView = true; anyScr.render(); dump('SCHEDULE-league');
  anyScr.playNext(); 
  scr.unmount();

  // 3. human game played, week incomplete -> auto simulate on mount
  const s2 = createSeason(TEAM_IDS[9], 'PRO', 77);
  const mine = currentFixtures(s2).find((f) => f.human)!;
  recordResult(s2, mine, { home: mine.home, away: mine.away, homeScore: 28, awayScore: 21 });
  writeSave({ season: s2 });
  scr.mount(ctx as never); dump('AUTOSIM');
  console.log('view after mount =', anyScr.view, '(expect SIMULATING)');
  let guard = 0;
  while (anyScr.view === 'SIMULATING' && guard++ < 200) (scr as unknown as { update(): void }).update();
  console.log('view after drain =', anyScr.view, 'week =', s2.week, 'played =', s2.schedule.filter((g) => g.played).length, 'frames', guard);
  dump('AFTER-SIM');
  scr.unmount();

  // 4. finished season -> trophy
  const s3 = createSeason(TEAM_IDS[2], 'PRO', 5);
  let g2 = 0;
  while (!s3.champion && g2++ < 30) { playWeek(s3, simulateWeek(s3, null, { simulate: fakeSim })); advanceSeason(s3); }
  writeSave({ season: s3 });
  scr.mount(ctx as never); dump('TROPHY');
  console.log('view =', anyScr.view, 'champion =', s3.champion);
  anyScr.show('STANDINGS'); dump('TROPHY-STANDINGS');
  scr.unmount();

  // 5. playoffs where the human is eliminated
  const s4 = createSeason(TEAM_IDS[7], 'PRO', 991);
  while (s4.week <= 14) { playWeek(s4, simulateWeek(s4, null, { simulate: fakeSim })); advanceSeason(s4); }
  writeSave({ season: s4 });
  scr.mount(ctx as never); dump('PLAYOFF-HUB');
  console.log('playoff view =', anyScr.view, 'week', s4.week, 'bracket', s4.playoffs.length);
  scr.unmount();

  console.log('\n--- rendered text ---');
  for (const v of views) console.log(v);
  console.log('\nnav log:', log.join(' | '));
  console.log('\nOK: no exceptions');
}
main().catch((e) => { console.error('FAILED', e); process.exit(1); });
