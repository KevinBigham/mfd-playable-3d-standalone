/**
 * GRIDIRON OVERDRIVE — knockout ladder logic.
 *
 * Pure logic, no DOM. The bracket is stored exactly as `TournamentSave`
 * (see persistence/save.ts) so it round-trips through JSON without a translation
 * layer. CPU-vs-CPU results come from the real engine via `simulateMatch`, never
 * from a coin flip, so a simulated bracket and a played bracket use the same rules.
 *
 * Bracket seeding is the classic recursive order — 1 v n, 2 v (n-1), … — arranged
 * so the top two seeds can only meet in the final. A short field is padded with
 * byes, which resolve the moment the round is built.
 */

import type { Difficulty, MatchConfig, TeamSide, WeatherKind } from '../core/types.ts';
import type { TournamentSave } from '../persistence/save.ts';
import { findTeam, teamRating, NEUTRAL_SITE_IDS } from '../data/index.ts';
import { simulateMatch } from '../testing/simRunner.ts';

/** An empty slot: a bye in round one, or an undecided feeder in a later round. */
export const BYE = '';

export type TournamentMatch = TournamentSave['rounds'][number][number];
export type TournamentEntrant = TournamentSave['entrants'][number];

export interface TournamentMatchup { round: number; index: number; a: string; b: string }

export interface CreateTournamentOptions {
  size: 4 | 8;
  bestOf3: boolean;
  entrants: Array<{ teamId: string; human: boolean; seat: number }>;
  seed: number;
}

/** Overrides for a simulated game. Anything omitted uses a sensible ladder default. */
export interface SimSettings {
  difficulty?: Difficulty;
  quarterSeconds?: number;
  stadium?: string;
  weather?: WeatherKind;
}

const WEATHER_TABLE: WeatherKind[] = ['CLEAR', 'CLEAR', 'CLEAR', 'CLEAR', 'RAIN', 'WIND', 'FOG', 'HEAT'];

// ── bracket shape ───────────────────────────────────────────────────────────

/**
 * Seed numbers (1-based) in bracket order: [1,8,4,5,2,7,3,6] for eight.
 * Read two at a time to get round-one pairings.
 */
export function bracketSeedOrder(size: number): number[] {
  let list = [1];
  let n = 1;
  while (n < size) {
    n *= 2;
    const next: number[] = [];
    for (const s of list) { next.push(s); next.push(n + 1 - s); }
    list = next;
  }
  return list;
}

export function winsNeeded(t: TournamentSave): number { return t.bestOf3 ? 2 : 1; }

export function totalRounds(t: TournamentSave): number {
  let r = 0;
  for (let n = Math.max(2, t.size); n > 1; n /= 2) r++;
  return r;
}

/** Matches contested in `round` (built or not). */
export function matchesInRound(t: TournamentSave, round: number): number {
  return Math.max(1, Math.round(t.size / Math.pow(2, round + 1)));
}

export function roundName(t: TournamentSave, round: number): string {
  const games = matchesInRound(t, round);
  if (games <= 1) return 'FINAL';
  if (games === 2) return 'SEMI-FINALS';
  if (games === 4) return 'QUARTER-FINALS';
  return `ROUND OF ${games * 2}`;
}

export function isBye(m: TournamentMatch): boolean { return m.a === BYE || m.b === BYE; }

/** Team id that advances, or BYE while the series is still live. */
export function matchWinner(m: TournamentMatch): string {
  if (m.a === BYE && m.b === BYE) return BYE;
  if (m.b === BYE) return m.a;
  if (m.a === BYE) return m.b;
  if (!m.done) return BYE;
  if (m.winsA > m.winsB) return m.a;
  if (m.winsB > m.winsA) return m.b;
  return BYE;
}

/** Team id currently ahead in a live series, or BYE when it is level. */
export function seriesLeader(m: TournamentMatch): string {
  if (m.winsA > m.winsB) return m.a;
  if (m.winsB > m.winsA) return m.b;
  return BYE;
}

function freshMatch(a: string, b: string, need: number): TournamentMatch {
  if (a !== BYE && b === BYE) return { a, b, winsA: need, winsB: 0, done: true };
  if (a === BYE && b !== BYE) return { a, b, winsA: 0, winsB: need, done: true };
  if (a === BYE && b === BYE) return { a, b, winsA: 0, winsB: 0, done: true };
  return { a, b, winsA: 0, winsB: 0, done: false };
}

// ── creation ────────────────────────────────────────────────────────────────

export function createTournament(opts: CreateTournamentOptions): TournamentSave {
  const size = opts.size === 4 ? 4 : 8;
  const entrants: TournamentEntrant[] = [];
  const seen = new Set<string>();
  for (const e of opts.entrants) {
    if (entrants.length >= size) break;
    if (!e || !e.teamId || seen.has(e.teamId)) continue;
    seen.add(e.teamId);
    const human = !!e.human;
    const seat = human ? Math.max(0, Math.min(3, Math.floor(e.seat))) : -1;
    entrants.push({ teamId: e.teamId, human, seat });
  }

  const need = opts.bestOf3 ? 2 : 1;
  const order = bracketSeedOrder(size);
  const first: TournamentMatch[] = [];
  for (let i = 0; i < order.length; i += 2) {
    const a = entrants[order[i] - 1]?.teamId ?? BYE;
    const b = entrants[order[i + 1] - 1]?.teamId ?? BYE;
    first.push(freshMatch(a, b, need));
  }

  const t: TournamentSave = {
    size,
    bestOf3: !!opts.bestOf3,
    entrants,
    rounds: [first],
    round: 0,
    champion: null,
    seed: (opts.seed >>> 0) || 1,
  };
  // Walk past any round that is nothing but byes.
  while (advanceRound(t)) { /* settle */ }
  return t;
}

// ── progression ─────────────────────────────────────────────────────────────

/**
 * Credit games to a match in the CURRENT round. `winsA`/`winsB` are increments —
 * report one game at a time (1,0) or (0,1). Wins are applied one at a time and
 * stop the instant the series is decided, so a match can never be over-credited,
 * end level, or be reported after it is done.
 */
export function reportResult(t: TournamentSave, matchIndex: number, winsA: number, winsB: number): void {
  const round = t.rounds[t.round];
  if (!round) return;
  const m = round[matchIndex];
  if (!m || m.done) return;
  const need = winsNeeded(t);
  const addA = Math.max(0, Math.floor(winsA));
  const addB = Math.max(0, Math.floor(winsB));
  for (let i = 0; i < addA && !m.done; i++) { m.winsA++; if (m.winsA >= need) m.done = true; }
  for (let i = 0; i < addB && !m.done; i++) { m.winsB++; if (m.winsB >= need) m.done = true; }
}

/**
 * Build the next round once the current one is complete, or crown the champion
 * when the final resolves. Returns true when the ladder moved on. Safe to call
 * as often as you like: it is a no-op while the round is still being played.
 */
export function advanceRound(t: TournamentSave): boolean {
  if (t.champion) return false;
  const cur = t.rounds[t.round];
  if (!cur || cur.length === 0) return false;
  for (const m of cur) if (!m.done) return false;

  if (cur.length === 1) {
    const w = matchWinner(cur[0]);
    if (!w) return false;
    t.champion = w;
    return true;
  }
  if (t.rounds.length > t.round + 1) { t.round++; return true; }

  const need = winsNeeded(t);
  const next: TournamentMatch[] = [];
  for (let i = 0; i < cur.length; i += 2) {
    next.push(freshMatch(matchWinner(cur[i]), matchWinner(cur[i + 1]), need));
  }
  t.rounds.push(next);
  t.round++;
  return true;
}

/** The next matchup that still has to be contested, or null when the ladder is done. */
export function nextMatch(t: TournamentSave): TournamentMatchup | null {
  if (t.champion) return null;
  for (let r = t.round; r < t.rounds.length; r++) {
    const round = t.rounds[r];
    for (let i = 0; i < round.length; i++) {
      const m = round[i];
      if (!m.done && m.a !== BYE && m.b !== BYE) return { round: r, index: i, a: m.a, b: m.b };
    }
  }
  return null;
}

export function isComplete(t: TournamentSave): boolean {
  return !!t.champion || nextMatch(t) === null;
}

// ── entrants ────────────────────────────────────────────────────────────────

export function entrantOf(t: TournamentSave, teamId: string): TournamentEntrant | null {
  for (const e of t.entrants) if (e.teamId === teamId) return e;
  return null;
}

/** 1-based bracket seed, or 0 when the team is not in this field. */
export function seedOf(t: TournamentSave, teamId: string): number {
  for (let i = 0; i < t.entrants.length; i++) if (t.entrants[i].teamId === teamId) return i + 1;
  return 0;
}

export function isHumanTeam(t: TournamentSave, teamId: string): boolean {
  const e = entrantOf(t, teamId);
  return !!e && e.human;
}

export function isHumanMatch(t: TournamentSave, m: { a: string; b: string }): boolean {
  return isHumanTeam(t, m.a) || isHumanTeam(t, m.b);
}

/** Seat table for a match: humans on their chosen seat, everyone else CPU. */
export function seatsFor(t: TournamentSave, m: { a: string; b: string }): MatchConfig['seats'] {
  const seats: MatchConfig['seats'] = [
    { side: 0, active: false }, { side: 1, active: false },
    { side: 0, active: false }, { side: 1, active: false },
  ];
  const taken = [false, false, false, false];
  const assign = (teamId: string, side: TeamSide): void => {
    if (teamId === BYE) return;
    for (const e of t.entrants) {
      if (!e.human || e.teamId !== teamId) continue;
      let seat = e.seat >= 0 && e.seat < 4 && !taken[e.seat] ? e.seat : -1;
      if (seat < 0) seat = taken.indexOf(false);
      if (seat < 0) return;
      taken[seat] = true;
      seats[seat] = { side, active: true };
    }
  };
  assign(m.a, 0);
  assign(m.b, 1);
  return seats;
}

// ── venue & seeds ───────────────────────────────────────────────────────────

/** Stable per-game seed so a replayed bracket produces the same football. */
export function matchSeed(t: TournamentSave, round: number, index: number, game: number): number {
  let h = ((t.seed >>> 0) ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (round + 1), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (index + 17), 0xc2b2ae35) >>> 0;
  h = Math.imul(h ^ (game + 101), 0x27d4eb2f) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  return h || 1;
}

/** Finals are played at a neutral site; earlier rounds at the higher seed's ground. */
export function venueFor(
  t: TournamentSave, round: number, index: number, hostTeamId: string,
): { stadium: string; weather: WeatherKind } {
  const isFinal = round >= totalRounds(t) - 1;
  if (isFinal) return { stadium: NEUTRAL_SITE_IDS[0] ?? '', weather: 'CLEAR' };
  const host = findTeam(hostTeamId);
  const h = matchSeed(t, round, index, 0);
  return {
    stadium: host ? host.stadium : (NEUTRAL_SITE_IDS[0] ?? ''),
    weather: WEATHER_TABLE[h % WEATHER_TABLE.length],
  };
}

/**
 * Who advances when a game cannot be separated: the better bracket seed, then
 * the stronger squad, then a stable id compare. Never random, never a stall.
 */
export function tieBreakWinner(t: TournamentSave, a: string, b: string): string {
  const sa = seedOf(t, a), sb = seedOf(t, b);
  if (sa && sb && sa !== sb) return sa < sb ? a : b;
  const ta = findTeam(a), tb = findTeam(b);
  const ra = ta ? teamRating(ta) : 0, rb = tb ? teamRating(tb) : 0;
  if (ra !== rb) return ra > rb ? a : b;
  return a <= b ? a : b;
}

// ── CPU games ───────────────────────────────────────────────────────────────

function reseed(x: number): number {
  let h = Math.imul((x >>> 0) ^ 0x6d2b79f5, 0x85ebca6b) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  return h || 1;
}

/**
 * Play one CPU-vs-CPU game with the real engine. `a` is home, `b` is away.
 * Ties are re-played with a derived seed a few times before falling back to the
 * deterministic tie-break, so the ladder always resolves.
 */
export function simulateCpuMatch(
  t: TournamentSave, a: string, b: string, seed: number, opts: SimSettings = {},
): { a: number; b: number } {
  if (a === BYE && b === BYE) return { a: 0, b: 0 };
  if (b === BYE) return { a: 1, b: 0 };
  if (a === BYE) return { a: 0, b: 1 };

  const quarterSeconds = opts.quarterSeconds ?? 120;
  const home = findTeam(a);
  const stadium = opts.stadium || (home ? home.stadium : '');
  let s = (seed >>> 0) || 1;
  let last = { a: 0, b: 0 };

  for (let attempt = 0; attempt < 4; attempt++) {
    const r = simulateMatch({
      seed: s,
      home: a,
      away: b,
      stadium,
      weather: opts.weather ?? 'CLEAR',
      difficulty: opts.difficulty ?? 'PRO',
      quarterSeconds,
      playClock: false,
      // ARCHITECTURE §14: comeback assist is off on the ladder.
      catchUpBias: false,
      lateHits: false,
      mode: 'TOURNAMENT',
      record: false,
      checkInvariants: false,
      maxTicks: Math.round(quarterSeconds * 60 * 6) + 40000,
    });
    last = { a: r.homeScore, b: r.awayScore };
    if (r.homeScore !== r.awayScore) return last;
    s = reseed(s);
  }

  const winner = tieBreakWinner(t, a, b);
  return winner === a ? { a: last.a + 3, b: last.b } : { a: last.a, b: last.b + 3 };
}

// ── restore ─────────────────────────────────────────────────────────────────

/** Defensive check for a bracket read back out of a save file. */
export function isValidTournament(t: TournamentSave | null | undefined): t is TournamentSave {
  if (!t || typeof t !== 'object') return false;
  if (t.size !== 4 && t.size !== 8) return false;
  if (!Array.isArray(t.entrants) || !Array.isArray(t.rounds) || t.rounds.length === 0) return false;
  if (typeof t.round !== 'number' || t.round < 0 || t.round >= t.rounds.length) return false;
  for (const e of t.entrants) if (!e || !findTeam(e.teamId)) return false;
  for (const round of t.rounds) {
    if (!Array.isArray(round) || round.length === 0) return false;
    for (const m of round) {
      if (!m || typeof m.winsA !== 'number' || typeof m.winsB !== 'number') return false;
      if (m.a !== BYE && !findTeam(m.a)) return false;
      if (m.b !== BYE && !findTeam(m.b)) return false;
    }
  }
  if (t.champion && !findTeam(t.champion)) return false;
  return true;
}
