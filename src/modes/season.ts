/**
 * GRIDIRON OVERDRIVE — SEASON MODE (pure logic, no DOM).
 *
 * A season is 16 clubs in two 8-team conferences playing a 14-week double round-robin
 * inside their own conference (7 rivals x 2 = 14 games, exactly one game per club per
 * week), followed by a four-team-per-conference playoff:
 *
 *   round 0  CONFERENCE SEMIFINAL   1v4 and 2v3 in each conference   (4 games)
 *   round 1  CONFERENCE FINAL       semifinal winners                 (2 games)
 *   round 2  CIRCUIT CHAMPIONSHIP   conference champions, neutral site (1 game)
 *
 * Everything here is deterministic: the schedule is derived from the season seed, and
 * every simulated game gets a stable per-fixture seed, so re-simulating a week can never
 * produce a different league.
 *
 * The higher seed always hosts a playoff game, which also makes tie-breaking trivial:
 * a drawn playoff game advances the host.
 */

import type { Difficulty, TeamStats, WeatherKind } from '../core/types.ts';
import type { SeasonSave } from '../persistence/save.ts';
import { CONFERENCES, TEAM_IDS, findTeam, NEUTRAL_SITE_IDS, getTeam } from '../data/index.ts';
import { Rng, hashSeed } from '../core/rng.ts';
import { simulateMatch } from '../testing/simRunner.ts';

// ─────────────────────────────────────────────────────────── shape

export const REGULAR_WEEKS = 14;
export const CONFERENCE_SIZE = 8;
export const PLAYOFF_SEEDS = 4;
export const PLAYOFF_ROUNDS = 3;

export const ROUND_SEMIFINAL = 0;
export const ROUND_CONFERENCE_FINAL = 1;
export const ROUND_CHAMPIONSHIP = 2;

export const ROUND_LABELS = ['CONFERENCE SEMIFINAL', 'CONFERENCE FINAL', 'CIRCUIT CHAMPIONSHIP'] as const;

export type ScheduleGame = SeasonSave['schedule'][number];
export type PlayoffGame = SeasonSave['playoffs'][number];
export type StandingLine = SeasonSave['standings'][string];
export type LeaderLine = SeasonSave['leaders'][string];

/** One fixture, regular season or playoff, in a form the UI can render directly. */
export interface Fixture {
  kind: 'REGULAR' | 'PLAYOFF';
  /** Index into `save.schedule` or `save.playoffs`. */
  index: number;
  /** Regular-season week number; playoff rounds continue the count (15, 16, 17). */
  week: number;
  /** Playoff round, or -1 during the regular season. */
  round: number;
  home: string;
  away: string;
  played: boolean;
  /** True when the season's human club is playing in it. */
  human: boolean;
  label: string;
}

export interface GameResult {
  home: string;
  away: string;
  homeScore: number;
  awayScore: number;
  /** [home, away] box score. Optional — when absent, only scores feed the tables. */
  stats?: [TeamStats, TeamStats];
}

export interface StandingRow {
  teamId: string;
  w: number; l: number; t: number;
  pf: number; pa: number;
  games: number;
  pct: number;
  diff: number;
  /** 1-based position inside the conference. */
  rank: number;
}

// ─────────────────────────────────────────────────────────── simulation hook

export interface SimRequest {
  seed: number;
  home: string;
  away: string;
  stadium: string;
  weather: WeatherKind;
  difficulty: Difficulty;
  quarterSeconds: number;
}

export interface SimOutcome {
  homeScore: number;
  awayScore: number;
  stats?: [TeamStats, TeamStats];
}

export type GameSimulator = (req: SimRequest) => SimOutcome;

export interface SimOptions {
  quarterSeconds?: number;
  /** Swappable for tests; defaults to the headless match simulator. */
  simulate?: GameSimulator;
}

/** Headless CPU-vs-CPU match through the real rules engine. */
export const defaultSimulator: GameSimulator = (req) => {
  const r = simulateMatch({
    seed: req.seed,
    home: req.home,
    away: req.away,
    stadium: req.stadium,
    weather: req.weather,
    difficulty: req.difficulty,
    quarterSeconds: req.quarterSeconds,
    record: false,
  });
  return { homeScore: r.homeScore, awayScore: r.awayScore, stats: r.stats };
};

export const DEFAULT_SIM_QUARTER_SECONDS = 120;

// ─────────────────────────────────────────────────────────── creation

function blankStanding(): StandingLine { return { w: 0, l: 0, t: 0, pf: 0, pa: 0 }; }
function blankLeader(): LeaderLine { return { passYds: 0, rushYds: 0, sacks: 0, ints: 0, tds: 0 }; }

/**
 * Circle-method rotation: element 0 is pinned, the rest rotate one step clockwise.
 * Over `n - 1` rounds every club meets every other club exactly once.
 */
function rotate(list: string[]): void {
  if (list.length < 3) return;
  const last = list.pop() as string;
  list.splice(1, 0, last);
}

/**
 * 14 weeks, 8 games a week, 112 games total.
 * Each club plays its 7 conference rivals home and away — 7 home + 7 away, exactly.
 */
export function buildSchedule(seed: number): ScheduleGame[] {
  const rng = new Rng((seed >>> 0) || 0x9e3779b9);
  const games: ScheduleGame[] = [];

  for (const conf of CONFERENCES) {
    const order = rng.shuffle(conf.teamIds.slice());
    const n = order.length;
    const rounds = n - 1;
    for (let r = 0; r < rounds; r++) {
      for (let i = 0; i < n / 2; i++) {
        const a = order[i];
        const b = order[n - 1 - i];
        // Alternate which side hosts so no club stacks its home dates in one stretch.
        const flip = (r + i) % 2 === 1;
        const first = flip ? b : a;
        const second = flip ? a : b;
        games.push({ week: r + 1, home: first, away: second, homeScore: 0, awayScore: 0, played: false });
        // Second half mirrors the first, which is what makes home/away land exactly even.
        games.push({ week: r + 1 + rounds, home: second, away: first, homeScore: 0, awayScore: 0, played: false });
      }
      rotate(order);
    }
  }

  games.sort((x, y) => x.week - y.week);
  return games;
}

export function createSeason(teamId: string, difficulty: Difficulty, seed: number): SeasonSave {
  const id = findTeam(teamId) ? teamId : TEAM_IDS[0];
  const save: SeasonSave = {
    teamId: id,
    week: 1,
    schedule: buildSchedule(seed),
    standings: {},
    playoffs: [],
    champion: null,
    difficulty,
    seed: (seed >>> 0) || 1,
    leaders: {},
  };
  for (const t of TEAM_IDS) {
    save.standings[t] = blankStanding();
    save.leaders[t] = blankLeader();
  }
  return save;
}

// ─────────────────────────────────────────────────────────── seeds & conditions

/** Stable per-fixture seed so a given week always simulates the same way. */
export function fixtureSeed(save: SeasonSave, week: number, home: string, away: string): number {
  return (hashSeed(`${save.seed >>> 0}|w${week}|${home}@${away}`) & 0x7fffffff) >>> 0;
}

const WEATHER_TABLE: WeatherKind[] = [
  'CLEAR', 'CLEAR', 'CLEAR', 'CLEAR', 'CLEAR', 'CLEAR',
  'RAIN', 'RAIN', 'WIND', 'WIND', 'FOG', 'SNOW', 'HEAT',
];

/** Venue and weather for a fixture — deterministic, so sims and played games agree. */
export function fixtureConditions(f: Fixture, seed: number): { stadium: string; weather: WeatherKind } {
  const stadium = f.round === ROUND_CHAMPIONSHIP
    ? (NEUTRAL_SITE_IDS[0] ?? getTeam(f.home).stadium)
    : getTeam(f.home).stadium;
  const rng = new Rng(seed || 1);
  return { stadium, weather: WEATHER_TABLE[rng.int(0, WEATHER_TABLE.length - 1)] };
}

// ─────────────────────────────────────────────────────────── fixtures

export function playoffRoundOf(save: SeasonSave): number {
  return Math.max(0, Math.min(PLAYOFF_ROUNDS - 1, save.week - REGULAR_WEEKS - 1));
}

export function inPlayoffs(save: SeasonSave): boolean { return save.week > REGULAR_WEEKS; }

export function seasonComplete(save: SeasonSave): boolean { return save.champion !== null; }

export function weekLabel(save: SeasonSave): string {
  if (save.champion) return 'SEASON COMPLETE';
  if (!inPlayoffs(save)) return `WEEK ${save.week}`;
  return ROUND_LABELS[playoffRoundOf(save)];
}

function toFixture(save: SeasonSave, g: ScheduleGame, index: number): Fixture {
  return {
    kind: 'REGULAR', index, week: g.week, round: -1,
    home: g.home, away: g.away, played: g.played,
    human: g.home === save.teamId || g.away === save.teamId,
    label: `WEEK ${g.week}`,
  };
}

function toPlayoffFixture(save: SeasonSave, g: PlayoffGame, index: number): Fixture {
  const round = Math.max(0, Math.min(PLAYOFF_ROUNDS - 1, g.round));
  return {
    kind: 'PLAYOFF', index, week: REGULAR_WEEKS + 1 + round, round,
    home: g.home, away: g.away, played: g.played,
    human: g.home === save.teamId || g.away === save.teamId,
    label: ROUND_LABELS[round],
  };
}

/** Every fixture in the current week (regular season) or playoff round, played or not. */
export function currentFixtures(save: SeasonSave): Fixture[] {
  if (!inPlayoffs(save)) {
    const out: Fixture[] = [];
    save.schedule.forEach((g, i) => { if (g.week === save.week) out.push(toFixture(save, g, i)); });
    return out;
  }
  const round = playoffRoundOf(save);
  const out: Fixture[] = [];
  save.playoffs.forEach((g, i) => { if (g.round === round) out.push(toPlayoffFixture(save, g, i)); });
  return out;
}

/** Every fixture of a given regular-season week. */
export function weekFixtures(save: SeasonSave, week: number): Fixture[] {
  const out: Fixture[] = [];
  save.schedule.forEach((g, i) => { if (g.week === week) out.push(toFixture(save, g, i)); });
  return out;
}

/** The human club's whole regular-season slate, week 1 first. */
export function teamSchedule(save: SeasonSave, teamId: string): Fixture[] {
  const out: Fixture[] = [];
  save.schedule.forEach((g, i) => {
    if (g.home === teamId || g.away === teamId) out.push(toFixture(save, g, i));
  });
  out.sort((a, b) => a.week - b.week);
  return out;
}

/** The human club's next fixture; failing that, the next playoff game to resolve. */
export function nextGameFor(save: SeasonSave): Fixture | null {
  if (save.champion) return null;
  const pending = currentFixtures(save).filter((f) => !f.played);
  const mine = pending.find((f) => f.human);
  if (mine) return mine;
  return pending[0] ?? null;
}

// ─────────────────────────────────────────────────────────── results

function standingOf(save: SeasonSave, id: string): StandingLine {
  let s = save.standings[id];
  if (!s) { s = blankStanding(); save.standings[id] = s; }
  return s;
}

function leaderOf(save: SeasonSave, id: string): LeaderLine {
  let s = save.leaders[id];
  if (!s) { s = blankLeader(); save.leaders[id] = s; }
  return s;
}

function addLeaders(save: SeasonSave, id: string, st: TeamStats | undefined, score: number): void {
  const line = leaderOf(save, id);
  if (st) {
    line.passYds += Math.round(st.passYds);
    line.rushYds += Math.round(st.rushYds);
    line.sacks += st.sacks;
    line.ints += st.ints;
    line.tds += st.passTd + st.rushTd;
  } else {
    // No box score available (legacy result) — approximate the only stat a score implies.
    line.tds += Math.floor(score / 7);
  }
}

function applyStandings(save: SeasonSave, r: GameResult): void {
  const h = standingOf(save, r.home);
  const a = standingOf(save, r.away);
  h.pf += r.homeScore; h.pa += r.awayScore;
  a.pf += r.awayScore; a.pa += r.homeScore;
  if (r.homeScore > r.awayScore) { h.w++; a.l++; }
  else if (r.awayScore > r.homeScore) { a.w++; h.l++; }
  else { h.t++; a.t++; }
}

/**
 * Record one result against a known fixture. Regular-season games move the standings;
 * playoff games do not (seeding must stay frozen), but both feed the leader table.
 */
export function recordResult(save: SeasonSave, f: Fixture, r: GameResult): void {
  const game: ScheduleGame | PlayoffGame | undefined =
    f.kind === 'REGULAR' ? save.schedule[f.index] : save.playoffs[f.index];
  if (!game || game.played) return;
  game.homeScore = r.homeScore;
  game.awayScore = r.awayScore;
  game.played = true;
  if (f.kind === 'REGULAR') applyStandings(save, r);
  addLeaders(save, r.home, r.stats?.[0], r.homeScore);
  addLeaders(save, r.away, r.stats?.[1], r.awayScore);
}

function findFixture(save: SeasonSave, r: GameResult): Fixture | null {
  const here = currentFixtures(save).find(
    (f) => !f.played && f.home === r.home && f.away === r.away,
  );
  if (here) return here;
  const idx = save.schedule.findIndex((g) => !g.played && g.home === r.home && g.away === r.away);
  if (idx >= 0) return toFixture(save, save.schedule[idx], idx);
  const pidx = save.playoffs.findIndex((g) => !g.played && g.home === r.home && g.away === r.away);
  if (pidx >= 0) return toPlayoffFixture(save, save.playoffs[pidx], pidx);
  return null;
}

/**
 * Apply a batch of results: scores onto the fixtures, records onto the standings,
 * box scores onto the leader table. Unknown or already-played fixtures are ignored,
 * so replaying a week can never double-count.
 */
export function playWeek(save: SeasonSave, results: GameResult[]): void {
  for (const r of results) {
    const f = findFixture(save, r);
    if (f) recordResult(save, f, r);
  }
}

/** True once every fixture of the current week / playoff round is in the books. */
export function weekComplete(save: SeasonSave): boolean {
  const f = currentFixtures(save);
  return f.length > 0 && f.every((x) => x.played);
}

/** Roll the calendar forward when the current week is finished, building playoffs as needed. */
export function advanceSeason(save: SeasonSave): void {
  if (save.champion) return;
  if (!inPlayoffs(save)) {
    if (weekComplete(save)) save.week++;
    if (inPlayoffs(save)) buildPlayoffs(save);
    return;
  }
  buildPlayoffs(save);
  if (weekComplete(save) && save.week < REGULAR_WEEKS + PLAYOFF_ROUNDS) {
    save.week++;
    buildPlayoffs(save);
  }
}

// ─────────────────────────────────────────────────────────── simulation

/** Simulate one fixture headlessly. Same seed in, same score out, always. */
export function simulateFixture(save: SeasonSave, f: Fixture, opts: SimOptions = {}): GameResult {
  const sim = opts.simulate ?? defaultSimulator;
  const seed = fixtureSeed(save, f.week, f.home, f.away);
  const { stadium, weather } = fixtureConditions(f, seed);
  const out = sim({
    seed, home: f.home, away: f.away, stadium, weather,
    difficulty: save.difficulty,
    quarterSeconds: opts.quarterSeconds ?? DEFAULT_SIM_QUARTER_SECONDS,
  });
  return { home: f.home, away: f.away, homeScore: out.homeScore, awayScore: out.awayScore, stats: out.stats };
}

/**
 * Simulate every outstanding game of the current week / playoff round, optionally
 * skipping one club's fixture so a human can play it.
 */
export function simulateWeek(
  save: SeasonSave, exceptTeamId: string | null = null, opts: SimOptions = {},
): GameResult[] {
  const out: GameResult[] = [];
  for (const f of currentFixtures(save)) {
    if (f.played) continue;
    if (exceptTeamId && (f.home === exceptTeamId || f.away === exceptTeamId)) continue;
    out.push(simulateFixture(save, f, opts));
  }
  return out;
}

// ─────────────────────────────────────────────────────────── standings

export function comparePct(a: StandingRow, b: StandingRow): number {
  if (b.pct !== a.pct) return b.pct - a.pct;
  if (b.diff !== a.diff) return b.diff - a.diff;
  if (b.pf !== a.pf) return b.pf - a.pf;
  return a.teamId < b.teamId ? -1 : a.teamId > b.teamId ? 1 : 0;
}

function rowFor(save: SeasonSave, teamId: string): StandingRow {
  const s = save.standings[teamId] ?? blankStanding();
  const games = s.w + s.l + s.t;
  return {
    teamId, w: s.w, l: s.l, t: s.t, pf: s.pf, pa: s.pa, games,
    pct: games > 0 ? (s.w + s.t * 0.5) / games : 0,
    diff: s.pf - s.pa,
    rank: 0,
  };
}

/**
 * Conference table, best first. Tiebreakers in order: win percentage, point
 * differential, points for, then club id so the order is always stable.
 */
export function standingsFor(save: SeasonSave, conference: number): StandingRow[] {
  const conf = CONFERENCES[conference];
  if (!conf) return [];
  const rows = conf.teamIds.map((id) => rowFor(save, id));
  rows.sort(comparePct);
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}

/** Whole-league table, best first — used to seat the championship game. */
export function leagueStandings(save: SeasonSave): StandingRow[] {
  const rows = TEAM_IDS.map((id) => rowFor(save, id));
  rows.sort(comparePct);
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}

export function recordOf(save: SeasonSave, teamId: string): StandingRow {
  return rowFor(save, teamId);
}

export function formatRecord(r: StandingRow): string {
  return r.t > 0 ? `${r.w}-${r.l}-${r.t}` : `${r.w}-${r.l}`;
}

/** 1-based conference position, or 0 if the club is not in a listed conference. */
export function conferenceRank(save: SeasonSave, teamId: string): number {
  for (let c = 0; c < CONFERENCES.length; c++) {
    const row = standingsFor(save, c).find((r) => r.teamId === teamId);
    if (row) return row.rank;
  }
  return 0;
}

// ─────────────────────────────────────────────────────────── playoffs

function regularSeasonDone(save: SeasonSave): boolean {
  return save.schedule.length > 0 && save.schedule.every((g) => g.played);
}

/** Host advances a drawn playoff game — the host is always the better seed. */
export function playoffWinner(g: PlayoffGame): string | null {
  if (!g.played) return null;
  return g.awayScore > g.homeScore ? g.away : g.home;
}

function roundGames(save: SeasonSave, round: number): PlayoffGame[] {
  return save.playoffs.filter((g) => g.round === round);
}

function roundDone(save: SeasonSave, round: number, expected: number): boolean {
  const g = roundGames(save, round);
  return g.length === expected && g.every((x) => x.played);
}

function newPlayoffGame(round: number, home: string, away: string): PlayoffGame {
  return { round, home, away, homeScore: 0, awayScore: 0, played: false };
}

/**
 * Bring the bracket up to date: seed the semifinals once the regular season ends, add
 * each following round as the previous one finishes, and crown the champion.
 * Safe to call at any time — it only ever appends rounds that are missing.
 */
export function buildPlayoffs(save: SeasonSave): PlayoffGame[] {
  if (!regularSeasonDone(save)) return save.playoffs;

  if (roundGames(save, ROUND_SEMIFINAL).length === 0) {
    for (let c = 0; c < CONFERENCES.length; c++) {
      const seeds = standingsFor(save, c).slice(0, PLAYOFF_SEEDS);
      if (seeds.length < PLAYOFF_SEEDS) continue;
      save.playoffs.push(newPlayoffGame(ROUND_SEMIFINAL, seeds[0].teamId, seeds[3].teamId));
      save.playoffs.push(newPlayoffGame(ROUND_SEMIFINAL, seeds[1].teamId, seeds[2].teamId));
    }
  }

  if (roundDone(save, ROUND_SEMIFINAL, CONFERENCES.length * 2)
      && roundGames(save, ROUND_CONFERENCE_FINAL).length === 0) {
    const semis = roundGames(save, ROUND_SEMIFINAL);
    for (let c = 0; c < CONFERENCES.length; c++) {
      const seeds = standingsFor(save, c).slice(0, PLAYOFF_SEEDS).map((r) => r.teamId);
      const a = playoffWinner(semis[c * 2]);
      const b = playoffWinner(semis[c * 2 + 1]);
      if (!a || !b) continue;
      const rankA = seeds.indexOf(a);
      const rankB = seeds.indexOf(b);
      const host = rankA <= rankB ? a : b;
      const guest = host === a ? b : a;
      save.playoffs.push(newPlayoffGame(ROUND_CONFERENCE_FINAL, host, guest));
    }
  }

  if (roundDone(save, ROUND_CONFERENCE_FINAL, CONFERENCES.length)
      && roundGames(save, ROUND_CHAMPIONSHIP).length === 0) {
    const finals = roundGames(save, ROUND_CONFERENCE_FINAL);
    const a = playoffWinner(finals[0]);
    const b = playoffWinner(finals[1]);
    if (a && b) {
      const order = leagueStandings(save).map((r) => r.teamId);
      const host = order.indexOf(a) <= order.indexOf(b) ? a : b;
      const guest = host === a ? b : a;
      save.playoffs.push(newPlayoffGame(ROUND_CHAMPIONSHIP, host, guest));
    }
  }

  const title = roundGames(save, ROUND_CHAMPIONSHIP)[0];
  if (title && title.played) save.champion = playoffWinner(title);

  return save.playoffs;
}

/** Bracket grouped by round, for the UI. */
export function playoffBracket(save: SeasonSave): Fixture[][] {
  const out: Fixture[][] = [[], [], []];
  save.playoffs.forEach((g, i) => {
    const f = toPlayoffFixture(save, g, i);
    if (out[f.round]) out[f.round].push(f);
  });
  return out;
}

// ─────────────────────────────────────────────────────────── leaders

export type LeaderStat = 'passYds' | 'rushYds' | 'sacks' | 'ints' | 'tds';

export const LEADER_LABELS: Record<LeaderStat, string> = {
  passYds: 'PASSING YARDS',
  rushYds: 'RUSHING YARDS',
  sacks: 'SACKS',
  ints: 'INTERCEPTIONS',
  tds: 'TOUCHDOWNS',
};

export interface LeaderRow { teamId: string; value: number; rank: number }

/** Clubs ranked by one season stat, best first. */
export function leadersFor(save: SeasonSave, stat: LeaderStat, limit = 8): LeaderRow[] {
  const rows: LeaderRow[] = TEAM_IDS.map((id) => ({
    teamId: id,
    value: Math.round(save.leaders[id]?.[stat] ?? 0),
    rank: 0,
  }));
  rows.sort((a, b) => (b.value - a.value) || (a.teamId < b.teamId ? -1 : 1));
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows.slice(0, limit);
}
