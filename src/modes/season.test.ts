/**
 * SEASON MODE — schedule integrity, standings order, playoff resolution, persistence.
 *
 * Most tests drive the season through an injected fake simulator so they stay fast and
 * deterministic; one test runs an entire 119-game season through the real rules engine
 * to prove the wiring end to end.
 */

import { describe, it, expect } from 'vitest';
import { Rng } from '../core/rng.ts';
import { TEAM_IDS, CONFERENCES, conferenceOf } from '../data/index.ts';
import type { TeamStats } from '../core/types.ts';
import type { SeasonSave } from '../persistence/save.ts';
import { getSave, writeSave } from '../persistence/save.ts';
import {
  createSeason, buildSchedule, playWeek, simulateWeek, simulateFixture, standingsFor, defaultSimulator,
  leagueStandings, buildPlayoffs, playoffBracket, playoffWinner, nextGameFor, advanceSeason,
  currentFixtures, teamSchedule, seasonComplete, weekComplete, weekLabel, recordOf,
  formatRecord, conferenceRank, leadersFor, fixtureSeed, fixtureConditions, recordResult,
  REGULAR_WEEKS, PLAYOFF_ROUNDS, ROUND_CHAMPIONSHIP, ROUND_CONFERENCE_FINAL, ROUND_SEMIFINAL,
  type GameSimulator, type GameResult,
} from './season.ts';

const SEEDS = [1, 2, 3, 77, 4242, 20240, 999983, 0x7fffffff];

// ── fake simulator ─────────────────────────────────────────────────────────
function statLine(rng: Rng, score: number): TeamStats {
  return {
    passAtt: 22, passComp: 13, passYds: rng.int(60, 340), passTd: Math.floor(score / 14), ints: rng.int(0, 3),
    rushAtt: 9, rushYds: rng.int(-14, 96), rushTd: Math.floor(score / 21),
    sacks: rng.int(0, 6), tackles: 24, bigHits: 3, forcedFumbles: 1,
    firstDowns: 9, totalYds: 320, plays: 44, fgAtt: 1, fgMade: 1, punts: 2,
    possessionTicks: 900, longestPlay: 44, overdrives: 1,
  };
}

/** Deterministic scores that never draw, so brackets resolve without tie handling. */
const fakeSim: GameSimulator = (req) => {
  const rng = new Rng(req.seed);
  const home = rng.int(0, 7) * 7 + rng.int(0, 1) * 3;
  let away = rng.int(0, 7) * 7 + rng.int(0, 1) * 3;
  if (away === home) away += 3;
  return { homeScore: home, awayScore: away, stats: [statLine(rng, home), statLine(rng, away)] };
};

function runSeason(seed: number, teamId = TEAM_IDS[5], sim: GameSimulator = fakeSim, quarterSeconds = 60): SeasonSave {
  const save = createSeason(teamId, 'PRO', seed);
  let guard = 0;
  while (!seasonComplete(save) && guard++ < REGULAR_WEEKS + PLAYOFF_ROUNDS + 4) {
    playWeek(save, simulateWeek(save, null, { simulate: sim, quarterSeconds }));
    advanceSeason(save);
  }
  return save;
}

// ── schedule ───────────────────────────────────────────────────────────────
describe('season schedule', () => {
  it('is 14 weeks of 8 games with nobody playing twice in a week', () => {
    for (const seed of SEEDS) {
      const games = buildSchedule(seed);
      expect(games.length).toBe(112);
      const weeks = new Set(games.map((g) => g.week));
      expect(weeks.size).toBe(REGULAR_WEEKS);
      expect(Math.min(...weeks)).toBe(1);
      expect(Math.max(...weeks)).toBe(REGULAR_WEEKS);

      for (let w = 1; w <= REGULAR_WEEKS; w++) {
        const inWeek = games.filter((g) => g.week === w);
        expect(inWeek.length).toBe(8);
        const seen = new Set<string>();
        for (const g of inWeek) {
          expect(g.home).not.toBe(g.away);
          expect(seen.has(g.home)).toBe(false);
          expect(seen.has(g.away)).toBe(false);
          seen.add(g.home); seen.add(g.away);
        }
        expect(seen.size).toBe(16);
      }
    }
  });

  it('gives every club 14 games, 7 at home and 7 away', () => {
    for (const seed of SEEDS) {
      const games = buildSchedule(seed);
      const played = new Map<string, number>();
      const hosted = new Map<string, number>();
      for (const id of TEAM_IDS) { played.set(id, 0); hosted.set(id, 0); }
      for (const g of games) {
        played.set(g.home, (played.get(g.home) as number) + 1);
        played.set(g.away, (played.get(g.away) as number) + 1);
        hosted.set(g.home, (hosted.get(g.home) as number) + 1);
      }
      for (const id of TEAM_IDS) {
        expect(played.get(id)).toBe(REGULAR_WEEKS);
        expect(hosted.get(id)).toBe(7);
      }
    }
  });

  it('pairs every conference rival exactly twice, once each way, and never crosses conferences', () => {
    for (const seed of SEEDS) {
      const games = buildSchedule(seed);
      const directed = new Map<string, number>();
      for (const g of games) {
        expect(conferenceOf(g.home)?.name).toBe(conferenceOf(g.away)?.name);
        const k = `${g.home}>${g.away}`;
        directed.set(k, (directed.get(k) ?? 0) + 1);
      }
      for (const conf of CONFERENCES) {
        for (const a of conf.teamIds) {
          for (const b of conf.teamIds) {
            if (a === b) continue;
            expect(directed.get(`${a}>${b}`)).toBe(1);
          }
        }
      }
    }
  });

  it('starts a new season at week 1 with a blank table for all 16 clubs', () => {
    const save = createSeason(TEAM_IDS[9], 'ALLSTAR', 1234);
    expect(save.week).toBe(1);
    expect(save.teamId).toBe(TEAM_IDS[9]);
    expect(save.difficulty).toBe('ALLSTAR');
    expect(save.champion).toBeNull();
    expect(save.playoffs).toEqual([]);
    expect(Object.keys(save.standings).length).toBe(16);
    expect(Object.keys(save.leaders).length).toBe(16);
    expect(teamSchedule(save, save.teamId).length).toBe(REGULAR_WEEKS);
    for (const id of TEAM_IDS) expect(save.standings[id]).toEqual({ w: 0, l: 0, t: 0, pf: 0, pa: 0 });
  });

  it('falls back to a real club when handed an unknown id', () => {
    const save = createSeason('not-a-real-club', 'PRO', 3);
    expect(TEAM_IDS).toContain(save.teamId);
  });
});

// ── results & standings ────────────────────────────────────────────────────
describe('results and standings', () => {
  it('applies scores, records and leaders exactly once per fixture', () => {
    const save = createSeason(TEAM_IDS[0], 'PRO', 55);
    const f = currentFixtures(save)[0];
    const stats: [TeamStats, TeamStats] = [statLine(new Rng(1), 21), statLine(new Rng(2), 14)];
    const result: GameResult = { home: f.home, away: f.away, homeScore: 21, awayScore: 14, stats };

    playWeek(save, [result]);
    expect(save.schedule[f.index].played).toBe(true);
    expect(save.schedule[f.index].homeScore).toBe(21);
    expect(save.standings[f.home]).toMatchObject({ w: 1, l: 0, t: 0, pf: 21, pa: 14 });
    expect(save.standings[f.away]).toMatchObject({ w: 0, l: 1, t: 0, pf: 14, pa: 21 });
    expect(save.leaders[f.home].passYds).toBe(Math.round(stats[0].passYds));
    expect(save.leaders[f.home].tds).toBe(stats[0].passTd + stats[0].rushTd);

    // Replaying the same result must not double count.
    playWeek(save, [result]);
    expect(save.standings[f.home].w).toBe(1);
    expect(save.leaders[f.home].passYds).toBe(Math.round(stats[0].passYds));
  });

  it('scores a draw as a tie for both clubs', () => {
    const save = createSeason(TEAM_IDS[0], 'PRO', 56);
    const f = currentFixtures(save)[0];
    playWeek(save, [{ home: f.home, away: f.away, homeScore: 17, awayScore: 17 }]);
    expect(save.standings[f.home]).toMatchObject({ w: 0, l: 0, t: 1 });
    expect(save.standings[f.away]).toMatchObject({ w: 0, l: 0, t: 1 });
    expect(recordOf(save, f.home).pct).toBeCloseTo(0.5);
    expect(formatRecord(recordOf(save, f.home))).toBe('0-0-1');
  });

  it('sorts a conference by win pct, then differential, then points for, then id', () => {
    const save = createSeason(TEAM_IDS[0], 'PRO', 7);
    const ids = CONFERENCES[0].teamIds;
    const set = (id: string, w: number, l: number, t: number, pf: number, pa: number) => {
      save.standings[id] = { w, l, t, pf, pa };
    };
    // Same 10-4 record; differential separates them.
    set(ids[0], 10, 4, 0, 300, 280);   // diff +20
    set(ids[1], 10, 4, 0, 420, 380);   // diff +40  → ahead of ids[0]
    // Same record AND differential as ids[0]; more points for wins the tie.
    set(ids[2], 10, 4, 0, 350, 330);   // diff +20, pf 350 → ahead of ids[0]
    // A tie counts as half a win: 9-4-1 outranks 9-5-0.
    set(ids[3], 9, 4, 1, 300, 300);
    set(ids[4], 9, 5, 0, 300, 300);
    // Wholly identical lines fall back to club id order.
    set(ids[5], 2, 12, 0, 100, 400);
    set(ids[6], 2, 12, 0, 100, 400);
    set(ids[7], 0, 14, 0, 90, 500);

    const table = standingsFor(save, 0);
    expect(table.map((r) => r.teamId).slice(0, 5)).toEqual([ids[1], ids[2], ids[0], ids[3], ids[4]]);
    expect(table[0].pct).toBeCloseTo(10 / 14);
    expect(table[0].diff).toBe(40);
    expect(table[3].pct).toBeCloseTo(9.5 / 14);
    expect(table[4].pct).toBeCloseTo(9 / 14);
    const lowIds = [ids[5], ids[6]].slice().sort();
    expect(table.map((r) => r.teamId).slice(5, 7)).toEqual(lowIds);
    expect(table[7].teamId).toBe(ids[7]);
    expect(table.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(conferenceRank(save, ids[1])).toBe(1);
    expect(standingsFor(save, 99)).toEqual([]);
  });

  it('ranks the whole league and the leader tables consistently', () => {
    const save = runSeason(4242);
    const league = leagueStandings(save);
    expect(league.length).toBe(16);
    expect(league.map((r) => r.rank)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
    for (let i = 1; i < league.length; i++) expect(league[i - 1].pct).toBeGreaterThanOrEqual(league[i].pct);

    const pass = leadersFor(save, 'passYds');
    expect(pass.length).toBe(8);
    expect(pass[0].value).toBeGreaterThan(0);
    for (let i = 1; i < pass.length; i++) expect(pass[i - 1].value).toBeGreaterThanOrEqual(pass[i].value);
    expect(leadersFor(save, 'tds', 16).length).toBe(16);
  });
});

// ── simulation ─────────────────────────────────────────────────────────────
describe('week simulation', () => {
  it('skips the excluded club and is repeatable for the same seed', () => {
    const save = createSeason(TEAM_IDS[2], 'PRO', 808);
    const mine = nextGameFor(save);
    expect(mine).not.toBeNull();
    expect(mine?.human).toBe(true);

    const a = simulateWeek(save, save.teamId, { simulate: fakeSim });
    const b = simulateWeek(save, save.teamId, { simulate: fakeSim });
    expect(a.length).toBe(7);
    expect(a).toEqual(b);
    for (const r of a) {
      expect(r.home).not.toBe(save.teamId);
      expect(r.away).not.toBe(save.teamId);
    }
    expect(simulateWeek(save, null, { simulate: fakeSim }).length).toBe(8);
  });

  it('derives a stable seed and venue per fixture, with a neutral site for the title game', () => {
    const save = createSeason(TEAM_IDS[0], 'PRO', 31337);
    const f = currentFixtures(save)[0];
    const s1 = fixtureSeed(save, f.week, f.home, f.away);
    expect(s1).toBe(fixtureSeed(save, f.week, f.home, f.away));
    expect(s1).not.toBe(fixtureSeed(save, f.week + 1, f.home, f.away));
    expect(s1).toBeGreaterThanOrEqual(0);
    const regular = fixtureConditions(f, s1);
    expect(regular.stadium).toBeTruthy();
    const title = fixtureConditions({ ...f, kind: 'PLAYOFF', round: ROUND_CHAMPIONSHIP }, s1);
    expect(title.stadium).not.toBe(regular.stadium);
  });

  it('advances the calendar only when the week is complete', () => {
    const save = createSeason(TEAM_IDS[4], 'PRO', 12);
    expect(weekComplete(save)).toBe(false);
    playWeek(save, simulateWeek(save, save.teamId, { simulate: fakeSim }));
    advanceSeason(save);
    expect(save.week).toBe(1);
    expect(weekComplete(save)).toBe(false);
    playWeek(save, simulateWeek(save, null, { simulate: fakeSim }));
    advanceSeason(save);
    expect(save.week).toBe(2);
    expect(weekLabel(save)).toBe('WEEK 2');
  });
});

// ── playoffs ───────────────────────────────────────────────────────────────
describe('playoffs', () => {
  function throughRegularSeason(seed: number, teamId = TEAM_IDS[5]): SeasonSave {
    const save = createSeason(teamId, 'PRO', seed);
    while (save.week <= REGULAR_WEEKS) {
      playWeek(save, simulateWeek(save, null, { simulate: fakeSim }));
      advanceSeason(save);
    }
    return save;
  }

  it('does not build a bracket before the regular season is done', () => {
    const save = createSeason(TEAM_IDS[0], 'PRO', 9);
    expect(buildPlayoffs(save)).toEqual([]);
    expect(save.champion).toBeNull();
  });

  it('seeds 1v4 and 2v3 from each conference with the better seed hosting', () => {
    const save = throughRegularSeason(2024);
    expect(save.playoffs.filter((g) => g.round === ROUND_SEMIFINAL).length).toBe(4);
    for (let c = 0; c < CONFERENCES.length; c++) {
      const seeds = standingsFor(save, c).slice(0, 4).map((r) => r.teamId);
      const semis = save.playoffs.filter((g) => g.round === ROUND_SEMIFINAL && seeds.includes(g.home));
      expect(semis.length).toBe(2);
      expect([semis[0].home, semis[0].away]).toEqual([seeds[0], seeds[3]]);
      expect([semis[1].home, semis[1].away]).toEqual([seeds[1], seeds[2]]);
    }
    // Everyone in the bracket finished in their conference's top four.
    for (const g of save.playoffs) {
      expect(conferenceRank(save, g.home)).toBeLessThanOrEqual(4);
      expect(conferenceRank(save, g.away)).toBeLessThanOrEqual(4);
    }
  });

  it('advances the host when a playoff game is drawn', () => {
    const save = throughRegularSeason(31);
    const semis = playoffBracket(save)[ROUND_SEMIFINAL];
    for (const f of semis) recordResult(save, f, { home: f.home, away: f.away, homeScore: 24, awayScore: 24 });
    advanceSeason(save);
    const finals = playoffBracket(save)[ROUND_CONFERENCE_FINAL];
    expect(finals.length).toBe(2);
    const hosts = semis.map((f) => f.home);
    for (const f of finals) {
      expect(hosts).toContain(f.home);
      expect(hosts).toContain(f.away);
    }
    // The better conference seed hosts the conference final.
    for (const f of finals) expect(conferenceRank(save, f.home)).toBeLessThan(conferenceRank(save, f.away));
  });

  it('keeps standings frozen once the playoffs start', () => {
    const save = throughRegularSeason(64);
    const before = JSON.parse(JSON.stringify(save.standings)) as SeasonSave['standings'];
    const f = playoffBracket(save)[ROUND_SEMIFINAL][0];
    recordResult(save, f, { home: f.home, away: f.away, homeScore: 45, awayScore: 3 });
    expect(save.standings).toEqual(before);
  });

  it('reports the human fixture first and the next open playoff game once eliminated', () => {
    const save = throughRegularSeason(2024);
    const bracket = playoffBracket(save)[ROUND_SEMIFINAL];
    const mine = bracket.find((f) => f.human);
    const next = nextGameFor(save);
    expect(next).not.toBeNull();
    if (mine) {
      expect(next?.human).toBe(true);
      expect(next?.index).toBe(mine.index);
    } else {
      expect(next?.human).toBe(false);
      expect(next?.round).toBe(ROUND_SEMIFINAL);
    }
    expect(next?.kind).toBe('PLAYOFF');
    expect(next?.label).toBe('CONFERENCE SEMIFINAL');
  });

  it('produces a 4/2/1 bracket and exactly one champion for every seed', () => {
    for (const seed of SEEDS) {
      const save = runSeason(seed);
      expect(seasonComplete(save)).toBe(true);
      expect(save.schedule.every((g) => g.played)).toBe(true);
      expect(save.playoffs.length).toBe(7);
      expect(playoffBracket(save).map((r) => r.length)).toEqual([4, 2, 1]);
      expect(save.playoffs.every((g) => g.played)).toBe(true);

      const title = save.playoffs.find((g) => g.round === ROUND_CHAMPIONSHIP) as SeasonSave['playoffs'][number];
      expect(save.champion).toBe(playoffWinner(title));
      expect([title.home, title.away]).toContain(save.champion);
      expect(TEAM_IDS).toContain(save.champion as string);
      expect(save.week).toBe(REGULAR_WEEKS + PLAYOFF_ROUNDS);
      expect(nextGameFor(save)).toBeNull();
      expect(weekLabel(save)).toBe('SEASON COMPLETE');

      // Every club played its 14 games; the two finalists came from different conferences.
      for (const id of TEAM_IDS) expect(recordOf(save, id).games).toBe(REGULAR_WEEKS);
      expect(conferenceOf(title.home)?.name).not.toBe(conferenceOf(title.away)?.name);

      // Running the season machinery again changes nothing.
      const frozen = JSON.stringify(save);
      advanceSeason(save);
      buildPlayoffs(save);
      expect(JSON.stringify(save)).toBe(frozen);
    }
  });

  it('crowns exactly one champion through the real match simulator', { timeout: 180_000 }, () => {
    const save = runSeason(90210, TEAM_IDS[1], defaultSimulator, 60);
    expect(seasonComplete(save)).toBe(true);
    expect(save.playoffs.length).toBe(7);
    expect(TEAM_IDS).toContain(save.champion as string);
    expect(save.schedule.every((g) => g.played)).toBe(true);
    // The real engine produces real box scores, so the leader tables must be populated.
    const totalPass = TEAM_IDS.reduce((n, id) => n + save.leaders[id].passYds, 0);
    expect(totalPass).toBeGreaterThan(0);
    expect(leadersFor(save, 'sacks')[0].value).toBeGreaterThan(0);
    expect(leadersFor(save, 'tds')[0].value).toBeGreaterThan(0);
  });

  it('runs a single fixture through the real simulator', { timeout: 60_000 }, () => {
    const save = createSeason(TEAM_IDS[0], 'PRO', 5150);
    const f = currentFixtures(save)[0];
    const r = simulateFixture(save, f, { quarterSeconds: 60 });
    expect(r.home).toBe(f.home);
    expect(r.away).toBe(f.away);
    expect(r.homeScore).toBeGreaterThanOrEqual(0);
    expect(r.awayScore).toBeGreaterThanOrEqual(0);
    expect(r.stats).toBeDefined();
    expect(simulateFixture(save, f, { quarterSeconds: 60 })).toEqual(r);
  });
});

// ── persistence ────────────────────────────────────────────────────────────
describe('season persistence', () => {
  it('round-trips a season through JSON without losing state', () => {
    const save = runSeason(777, TEAM_IDS[3]);
    const clone = JSON.parse(JSON.stringify(save)) as SeasonSave;
    expect(clone).toEqual(save);
    expect(clone.champion).toBe(save.champion);
    expect(standingsFor(clone, 0)).toEqual(standingsFor(save, 0));
    expect(standingsFor(clone, 1)).toEqual(standingsFor(save, 1));
    expect(leadersFor(clone, 'passYds')).toEqual(leadersFor(save, 'passYds'));
    expect(playoffBracket(clone)).toEqual(playoffBracket(save));
    expect(nextGameFor(clone)).toEqual(nextGameFor(save));
  });

  it('round-trips a part-played season through the save file', () => {
    const save = createSeason(TEAM_IDS[6], 'LEGEND', 606);
    for (let i = 0; i < 3; i++) {
      playWeek(save, simulateWeek(save, null, { simulate: fakeSim }));
      advanceSeason(save);
    }
    writeSave({ season: save });
    const loaded = getSave().season as SeasonSave;
    expect(loaded).toEqual(save);
    expect(loaded.week).toBe(4);
    expect(loaded.schedule.filter((g) => g.played).length).toBe(24);
    expect(recordOf(loaded, loaded.teamId).games).toBe(3);
    expect(nextGameFor(loaded)?.week).toBe(4);
    writeSave({ season: null });
    expect(getSave().season).toBeNull();
  });
});
