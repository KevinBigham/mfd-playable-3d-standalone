/**
 * Horizontal replayability: personal bests, the Daily Drive, team mastery, and shareable
 * challenge codes. No stat power, no currencies, no streak punishment — every record is
 * partitioned by ruleset and rules version so incompatible results are never compared as equals.
 */
import { RULES_VERSION } from '../core/constants.ts';
import { getSave, writeSave } from '../persistence/save.ts';
import type { Difficulty } from '../core/types.ts';

export interface PersonalBest {
  points: number;
  yards: number;
  timestampMs: number;
}

export interface ProgressionData {
  version: 1;
  /** Keyed `${rulesetId}:v${rulesVersion}:${difficulty}` — cross-version records never compete. */
  bests: Record<string, PersonalBest>;
  /** Drives completed per team id — identity and variety, never a stat boost. */
  teamDrives: Record<string, number>;
  /** Daily Drive: date string of the last completed daily, for the "done today" chip. */
  lastDailyCompleted: string | null;
}

export function defaultProgression(): ProgressionData {
  return { version: 1, bests: {}, teamDrives: {}, lastDailyCompleted: null };
}

function data(): ProgressionData {
  const save = getSave() as unknown as { progression?: ProgressionData };
  if (!save.progression || save.progression.version !== 1) save.progression = defaultProgression();
  return save.progression;
}

export function pbKey(rulesetId: string, difficulty: Difficulty): string {
  return `${rulesetId}:v${RULES_VERSION}:${difficulty}`;
}

/** Record a finished drive. Returns the previous best (null when this is the first). */
export function recordDrive(
  rulesetId: string, difficulty: Difficulty, teamId: string, points: number, yards: number,
): { previous: PersonalBest | null; isNewBest: boolean } {
  const d = data();
  const key = pbKey(rulesetId, difficulty);
  const prev = d.bests[key] ?? null;
  const better = !prev || points > prev.points || (points === prev.points && yards > prev.yards);
  if (better) d.bests[key] = { points, yards, timestampMs: Date.now() };
  d.teamDrives[teamId] = (d.teamDrives[teamId] ?? 0) + 1;
  writeSave();
  return { previous: prev, isNewBest: better };
}

export function bestFor(rulesetId: string, difficulty: Difficulty): PersonalBest | null {
  return data().bests[pbKey(rulesetId, difficulty)] ?? null;
}

export function teamDriveCount(teamId: string): number { return data().teamDrives[teamId] ?? 0; }

export function markDailyDone(date: string): void {
  data().lastDailyCompleted = date;
  writeSave();
}
export function dailyDoneToday(date: string): boolean { return data().lastDailyCompleted === date; }

// ── the Daily Drive ────────────────────────────────────────────────────────
// Everyone gets the same problem: the seed is a pure function of the UTC date and the rules
// version, so two phones on the same day play the identical drive — and a new rules version
// starts a fresh, honestly-incomparable series. No streak exists to lose.

function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

export function todayString(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
}

export function dailySeed(date: string): number {
  return fnv(`daily:${date}:rules${RULES_VERSION}`) & 0x7fffffff;
}

// ── challenge codes (Beat My Drive) ────────────────────────────────────────
// A code carries everything needed to reproduce the setup and to display the bar to beat —
// and nothing else: no identifiers, no backend. Version-stamped so a code from different rules
// is refused with an explanation instead of a silently different game.

export interface ChallengeCode {
  rulesVersion: number;
  seed: number;
  home: string;
  away: string;
  difficulty: Difficulty;
  points: number;
  yards: number;
}

const DIFFS: Difficulty[] = ['ROOKIE', 'PRO', 'ALLSTAR', 'LEGEND'];

export function encodeChallenge(c: ChallengeCode): string {
  const body = [c.rulesVersion, c.seed, c.home, c.away, DIFFS.indexOf(c.difficulty), c.points,
    Math.round(c.yards)].join('.');
  const check = (fnv(body) & 0xffff).toString(36);
  return `GO2-${body}-${check}`.toUpperCase();
}

export type DecodeResult =
  | { ok: true; code: ChallengeCode }
  | { ok: false; why: 'MALFORMED' | 'CHECKSUM' | 'RULES_MISMATCH'; detail: string };

export function decodeChallenge(text: string): DecodeResult {
  const m = /^GO2-(.+)-([A-Z0-9]+)$/i.exec(text.trim());
  if (!m) return { ok: false, why: 'MALFORMED', detail: 'not a GO2 challenge code' };
  const body = m[1].toLowerCase();
  if ((fnv(body) & 0xffff).toString(36) !== m[2].toLowerCase()) {
    return { ok: false, why: 'CHECKSUM', detail: 'the code was mistyped or truncated' };
  }
  const parts = body.split('.');
  if (parts.length !== 7) return { ok: false, why: 'MALFORMED', detail: 'wrong field count' };
  const rulesVersion = Number(parts[0]);
  if (rulesVersion !== RULES_VERSION) {
    return {
      ok: false, why: 'RULES_MISMATCH',
      detail: `this code is from rules v${rulesVersion}; this build plays v${RULES_VERSION} — the same drive would not reproduce`,
    };
  }
  const code: ChallengeCode = {
    rulesVersion,
    seed: Number(parts[1]) >>> 0,
    home: parts[2],
    away: parts[3],
    difficulty: DIFFS[Number(parts[4])] ?? 'PRO',
    points: Number(parts[5]),
    yards: Number(parts[6]),
  };
  if (!Number.isFinite(code.seed) || !code.home || !code.away) {
    return { ok: false, why: 'MALFORMED', detail: 'bad field values' };
  }
  return { ok: true, code };
}
