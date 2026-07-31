import type { DeadReason, MatchState, TeamSide, TeamStats } from '../core/types.ts';
import {
  FIRST_DOWN_YARDS, DOWNS, TOUCHBACK_Z, KICKOFF_FROM_Z, TWO_POINT_Z, ENDZONE_DEPTH,
  OVERDRIVE_CATCH_STREAK, OVERDRIVE_SACK_STREAK, OVERDRIVE_MAX_TICKS, OVERTIME_PERIODS,
} from '../core/constants.ts';
import { clamp } from '../core/math.ts';

export function dirOf(side: TeamSide): number { return side === 0 ? 1 : -1; }
export function goalOf(side: TeamSide): number { return side === 0 ? 100 : 0; }
export function ownGoalOf(side: TeamSide): number { return side === 0 ? 0 : 100; }
export function other(side: TeamSide): TeamSide { return side === 0 ? 1 : 0; }

export function emptyStats(): TeamStats {
  return {
    passAtt: 0, passComp: 0, passYds: 0, passTd: 0, ints: 0,
    rushAtt: 0, rushYds: 0, rushTd: 0,
    sacks: 0, tackles: 0, bigHits: 0, forcedFumbles: 0,
    firstDowns: 0, totalYds: 0, plays: 0,
    fgAtt: 0, fgMade: 0, punts: 0, possessionTicks: 0,
    longestPlay: 0, overdrives: 0,
  };
}

export function createMatchState(quarterTicks: number): MatchState {
  return {
    phase: 'PREGAME', phaseTicks: 0, quarter: 1,
    clockTicks: quarterTicks, quarterTicks, playClockTicks: 0,
    possession: 0, down: 1, losZ: 25, firstDownZ: 55,
    teams: [
      { score: 0, timeouts: 0, overdrive: false, overdriveTicks: 0, catchStreakReceiver: -1, catchStreak: 0, sackStreak: 0, stats: emptyStats() },
      { score: 0, timeouts: 0, overdrive: false, overdriveTicks: 0, catchStreakReceiver: -1, catchStreak: 0, sackStreak: 0, stats: emptyStats() },
    ],
    lastDead: null, pendingScore: null, conversionChoice: null,
    kickoffReceiving: 0, secondHalfReceiver: 1, overtimePeriod: 0,
    finished: false, winner: null, driveStartZ: 25, driveSide: 0,
  };
}

// ── play outcome ───────────────────────────────────────────────────────────

export interface PlayOutcome {
  reason: DeadReason;
  spotZ: number;
  spotX: number;
  /** Who has the ball when the next snap happens. */
  possessionAfter: TeamSide;
  yards: number;
  turnover: boolean;
  turnoverKind: 'INT' | 'FUMBLE' | 'DOWNS' | 'PUNT' | 'MISSED_FG' | null;
  scoringSide: TeamSide | null;
  scoreKind: 'TD' | 'FG' | 'SAFETY' | null;
  firstDown: boolean;
  touchback: boolean;
}

export function blankOutcome(): PlayOutcome {
  return {
    reason: 'TACKLE', spotZ: 25, spotX: 0, possessionAfter: 0, yards: 0,
    turnover: false, turnoverKind: null, scoringSide: null, scoreKind: null,
    firstDown: false, touchback: false,
  };
}

/** Clamp a spot to the legal playing surface (end-zone spots become the goal line). */
export function clampSpot(z: number): number { return clamp(z, 0.5, 99.5); }

export function distanceToGo(m: MatchState): number {
  return Math.abs(m.firstDownZ - m.losZ);
}
export function isAndGoal(m: MatchState): boolean {
  return m.firstDownZ === goalOf(m.possession);
}

/**
 * Apply a resolved play to the match. Pure with respect to the world; only touches MatchState.
 * Returns the phase the match should move to next.
 */
export function applyOutcome(m: MatchState, o: PlayOutcome): 'SCORE_RESOLVE' | 'PLAY_CALL' | 'KICKOFF_SETUP' {
  const off = m.possession;
  const t = m.teams[off];

  t.stats.plays++;
  if (o.yards > t.stats.longestPlay) t.stats.longestPlay = o.yards;
  if (!o.turnover && o.scoreKind !== 'SAFETY') t.stats.totalYds += o.yards;

  if (o.scoreKind === 'TD' && o.scoringSide !== null) {
    m.teams[o.scoringSide].score += 6;
    m.pendingScore = { side: o.scoringSide, kind: 'TD' };
    m.lastDead = o.reason;
    return 'SCORE_RESOLVE';
  }
  if (o.scoreKind === 'FG' && o.scoringSide !== null) {
    m.teams[o.scoringSide].score += 3;
    m.teams[o.scoringSide].stats.fgMade++;
    m.pendingScore = { side: o.scoringSide, kind: 'FG' };
    m.lastDead = o.reason;
    return 'SCORE_RESOLVE';
  }
  if (o.scoreKind === 'SAFETY' && o.scoringSide !== null) {
    m.teams[o.scoringSide].score += 2;
    m.pendingScore = { side: o.scoringSide, kind: 'SAFETY' };
    m.lastDead = o.reason;
    return 'SCORE_RESOLVE';
  }

  m.lastDead = o.reason;

  if (o.turnover) {
    const next = o.possessionAfter;
    m.possession = next;
    m.down = 1;
    m.losZ = o.touchback ? touchbackSpot(next) : clampSpot(o.spotZ);
    m.firstDownZ = computeFirstDown(m.losZ, next);
    m.driveStartZ = m.losZ; m.driveSide = next;
    if (o.turnoverKind === 'INT') m.teams[next].stats.ints++;
    return 'PLAY_CALL';
  }

  // Same possession: advance the chains.
  const dir = dirOf(off);
  const newLos = clampSpot(o.spotZ);
  const reached = dir > 0 ? newLos >= m.firstDownZ - 1e-6 : newLos <= m.firstDownZ + 1e-6;
  m.losZ = newLos;
  if (reached) {
    m.down = 1;
    m.firstDownZ = computeFirstDown(newLos, off);
    t.stats.firstDowns++;
    o.firstDown = true;
  } else {
    m.down++;
    if (m.down > DOWNS) {
      const next = other(off);
      m.possession = next;
      m.down = 1;
      m.firstDownZ = computeFirstDown(m.losZ, next);
      m.driveStartZ = m.losZ; m.driveSide = next;
      o.turnover = true;
      o.turnoverKind = 'DOWNS';
    }
  }
  return 'PLAY_CALL';
}

export function computeFirstDown(losZ: number, side: TeamSide): number {
  const dir = dirOf(side);
  const goal = goalOf(side);
  const raw = losZ + FIRST_DOWN_YARDS * dir;
  return dir > 0 ? Math.min(raw, goal) : Math.max(raw, goal);
}

export function touchbackSpot(side: TeamSide): number {
  return side === 0 ? TOUCHBACK_Z : 100 - TOUCHBACK_Z;
}

export function kickoffSpot(kicking: TeamSide): number {
  return kicking === 0 ? KICKOFF_FROM_Z : 100 - KICKOFF_FROM_Z;
}

export function conversionSpot(side: TeamSide, two: boolean): number {
  const goal = goalOf(side);
  const dir = dirOf(side);
  return goal - dir * (two ? TWO_POINT_Z : 12);
}

export function safetyFreeKickSpot(conceding: TeamSide): number {
  return conceding === 0 ? 20 : 80;
}

// ── overdrive (momentum) ───────────────────────────────────────────────────

export interface OverdriveResult { started: boolean; cause: 'CATCH' | 'SACK' | null }

export function noteCatch(m: MatchState, side: TeamSide, receiverId: number): OverdriveResult {
  const t = m.teams[side];
  if (t.catchStreakReceiver === receiverId) t.catchStreak++;
  else { t.catchStreakReceiver = receiverId; t.catchStreak = 1; }
  m.teams[other(side)].sackStreak = 0;
  if (!t.overdrive && t.catchStreak >= OVERDRIVE_CATCH_STREAK) {
    t.overdrive = true; t.overdriveTicks = OVERDRIVE_MAX_TICKS; t.stats.overdrives++;
    t.catchStreak = 0; t.catchStreakReceiver = -1;
    return { started: true, cause: 'CATCH' };
  }
  return { started: false, cause: null };
}

export function noteSack(m: MatchState, defenseSide: TeamSide): OverdriveResult {
  const t = m.teams[defenseSide];
  t.sackStreak++;
  const offense = m.teams[other(defenseSide)];
  offense.catchStreak = 0; offense.catchStreakReceiver = -1;
  if (!t.overdrive && t.sackStreak >= OVERDRIVE_SACK_STREAK) {
    t.overdrive = true; t.overdriveTicks = OVERDRIVE_MAX_TICKS; t.stats.overdrives++;
    t.sackStreak = 0;
    return { started: true, cause: 'SACK' };
  }
  return { started: false, cause: null };
}

export function breakStreaks(m: MatchState, side: TeamSide): void {
  m.teams[side].catchStreak = 0;
  m.teams[side].catchStreakReceiver = -1;
}

/** The opponent extinguishes an active Overdrive by converting a first down or a sack. */
export function extinguish(m: MatchState, side: TeamSide): boolean {
  const t = m.teams[side];
  if (!t.overdrive) return false;
  t.overdrive = false; t.overdriveTicks = 0;
  return true;
}

export function tickOverdrive(m: MatchState): TeamSide[] {
  const ended: TeamSide[] = [];
  for (const side of [0, 1] as TeamSide[]) {
    const t = m.teams[side];
    if (!t.overdrive) continue;
    t.overdriveTicks--;
    if (t.overdriveTicks <= 0) { t.overdrive = false; ended.push(side); }
  }
  return ended;
}

// ── clock & quarters ───────────────────────────────────────────────────────

export function quarterExpired(m: MatchState): boolean { return m.clockTicks <= 0; }

export function isHalftime(m: MatchState): boolean { return m.quarter === 2; }

export function matchShouldEnd(m: MatchState): boolean {
  if (m.quarter < 4) return false;
  if (m.quarter === 4) return m.teams[0].score !== m.teams[1].score;
  return m.teams[0].score !== m.teams[1].score || m.overtimePeriod >= OVERTIME_PERIODS;
}

export function winnerOf(m: MatchState): TeamSide | 'TIE' {
  if (m.teams[0].score > m.teams[1].score) return 0;
  if (m.teams[1].score > m.teams[0].score) return 1;
  return 'TIE';
}

// ── validation ─────────────────────────────────────────────────────────────

export interface Violation { code: string; detail: string }

export function validateMatchState(m: MatchState): Violation[] {
  const v: Violation[] = [];
  if (m.down < 1 || m.down > DOWNS) v.push({ code: 'DOWN_RANGE', detail: `down=${m.down}` });
  if (m.losZ < -ENDZONE_DEPTH || m.losZ > 100 + ENDZONE_DEPTH) v.push({ code: 'LOS_RANGE', detail: `los=${m.losZ}` });
  if (!Number.isFinite(m.losZ)) v.push({ code: 'LOS_NAN', detail: 'los is NaN' });
  if (m.clockTicks < 0) v.push({ code: 'CLOCK_NEGATIVE', detail: `${m.clockTicks}` });
  for (const side of [0, 1] as TeamSide[]) {
    const sc = m.teams[side].score;
    if (sc < 0 || !Number.isFinite(sc)) v.push({ code: 'SCORE_INVALID', detail: `side ${side} = ${sc}` });
  }
  if (m.possession !== 0 && m.possession !== 1) v.push({ code: 'POSSESSION_INVALID', detail: `${m.possession}` });
  const dir = dirOf(m.possession);
  const beyond = dir > 0 ? m.firstDownZ < m.losZ - 0.01 : m.firstDownZ > m.losZ + 0.01;
  if (beyond) v.push({ code: 'FIRST_DOWN_BEHIND', detail: `los=${m.losZ} fd=${m.firstDownZ}` });
  return v;
}

export { clamp };
