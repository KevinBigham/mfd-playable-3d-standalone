import type { DefensePlay, MatchState, OffensePlay, TeamSide } from '../core/types.ts';
import { Rng } from '../core/rng.ts';
import { clamp, clamp01 } from '../core/math.ts';
import { dirOf, goalOf, distanceToGo } from '../rules/rulesEngine.ts';
import type { AiProfile } from './difficulty.ts';

export type FourthDownChoice = 'GO' | 'PUNT' | 'FIELD_GOAL';

export interface Situation {
  down: number;
  toGo: number;
  losZ: number;
  side: TeamSide;
  /** Yards from the opponent goal line. */
  yardsToGoal: number;
  scoreDiff: number;
  clockSeconds: number;
  quarter: number;
  isOvertime: boolean;
}

export function readSituation(m: MatchState, side: TeamSide): Situation {
  const dir = dirOf(side);
  const goal = goalOf(side);
  return {
    down: m.down,
    toGo: distanceToGo(m),
    losZ: m.losZ,
    side,
    yardsToGoal: Math.abs(goal - m.losZ),
    scoreDiff: m.teams[side].score - m.teams[side === 0 ? 1 : 0].score,
    clockSeconds: m.clockTicks / 60,
    quarter: m.quarter,
    isOvertime: m.quarter > 4,
  };
  void dir;
}

/** Tendency memory so the AI can adapt without cheating. */
export class TendencyTracker {
  private runs = 0;
  private passes = 0;
  private deep = 0;
  private plays = 0;
  note(p: OffensePlay): void {
    this.plays++;
    if (p.tags.includes('RUN')) this.runs++; else this.passes++;
    if (p.deepShot > 0.5) this.deep++;
  }
  runRate(): number { return this.plays < 4 ? 0.45 : this.runs / this.plays; }
  deepRate(): number { return this.plays < 4 ? 0.25 : this.deep / this.plays; }
  reset(): void { this.runs = this.passes = this.deep = this.plays = 0; }
}

export function chooseFourthDown(sit: Situation, profile: AiProfile, rng: Rng): FourthDownChoice {
  const { toGo, yardsToGoal, scoreDiff, clockSeconds, quarter } = sit;
  const desperate = (quarter >= 4 && scoreDiff < 0 && clockSeconds < 45) || (scoreDiff < -14 && quarter >= 4);
  if (desperate) return yardsToGoal < 34 && toGo > 12 ? 'FIELD_GOAL' : 'GO';
  if (yardsToGoal <= 43) {
    // In field-goal range (kick is from ~7 yards behind the LOS, max 50).
    if (toGo <= 6 && yardsToGoal <= 12) return rng.chance(0.55 + profile.riskTolerance * 0.2) ? 'GO' : 'FIELD_GOAL';
    return 'FIELD_GOAL';
  }
  if (toGo <= 5 && yardsToGoal < 62) return rng.chance(0.55) ? 'GO' : 'PUNT';
  if (yardsToGoal > 78) return 'PUNT';
  return rng.chance(0.12 + profile.riskTolerance * 0.15) ? 'GO' : 'PUNT';
}

export function shouldOnsideKick(m: MatchState, kicking: TeamSide, rng: Rng): boolean {
  const diff = m.teams[kicking].score - m.teams[kicking === 0 ? 1 : 0].score;
  const late = m.quarter >= 4 && m.clockTicks < 60 * 60;
  if (late && diff < 0 && diff >= -16) return rng.chance(0.7);
  if (m.quarter >= 4 && diff < -16) return rng.chance(0.35);
  return rng.chance(0.02);
}

export function chooseConversion(m: MatchState, side: TeamSide, rng: Rng, profile: AiProfile): 'KICK' | 'TWO' {
  const diff = m.teams[side].score - m.teams[side === 0 ? 1 : 0].score;
  const late = m.quarter >= 4;
  if (late) {
    if (diff === -2 || diff === -10 || diff === 5 || diff === -5) return 'TWO';
    if (diff === -1 || diff === -8) return 'KICK';
  }
  return rng.chance(0.10 + profile.riskTolerance * 0.12) ? 'TWO' : 'KICK';
}

function scoreOffensePlay(p: OffensePlay, sit: Situation, profile: AiProfile, rng: Rng): number {
  const { down, toGo, yardsToGoal, scoreDiff, clockSeconds, quarter } = sit;
  let score = 0;
  const isRun = p.tags.includes('RUN');
  const isDeep = p.deepShot;
  const isQuick = p.tags.includes('QUICK') || p.tags.includes('SCREEN');

  // Distance fit: how far this concept typically travels vs what's needed.
  const conceptYards = isRun ? 8 : isQuick ? 9 : isDeep > 0.5 ? 32 : 18;
  score -= Math.abs(conceptYards - clamp(toGo, 4, 34)) * 0.10;

  if (down === 1) score += isRun ? 1.1 : 0.6;
  if (down === 2 && toGo > 20) score += isDeep * 1.4;
  if (down === 3) score += toGo > 18 ? isDeep * 1.6 + (isRun ? -2.2 : 0.8) : (isQuick ? 1.4 : 0.3);
  if (down === 4) score += isRun && toGo < 6 ? 1.6 : 0.2;

  if (yardsToGoal < 12) { score += p.shortYardage * 2.0; score -= isDeep * 2.2; }
  if (yardsToGoal < 34 && yardsToGoal >= 12) score += isDeep * 0.5;
  if (yardsToGoal > 92) score += isRun ? 0.9 : -0.4; // backed up

  const trailingLate = quarter >= 4 && scoreDiff < 0 && clockSeconds < 60;
  if (trailingLate) { score += isDeep * 1.5 + (p.tags.includes('CLOCK') ? -1 : 0); score -= isRun ? 1.6 : 0; }
  const leadingLate = quarter >= 4 && scoreDiff > 0 && clockSeconds < 60;
  if (leadingLate) score += isRun ? 1.4 : -0.4;

  // Difficulty: worse callers pick noisier.
  score += rng.spread((1 - profile.playCallQuality) * 5.5);
  return score;
}

export function chooseOffensePlay(
  plays: OffensePlay[], sit: Situation, profile: AiProfile, rng: Rng, avoidId?: string,
): OffensePlay {
  let best = plays[0]; let bestScore = -1e9;
  for (const p of plays) {
    if (p.tags.includes('TRICK') && !rng.chance(0.06)) continue;
    let sc = scoreOffensePlay(p, sit, profile, rng);
    if (avoidId && p.id === avoidId) sc -= 1.5;
    if (sc > bestScore) { bestScore = sc; best = p; }
  }
  return best;
}

export function chooseDefensePlay(
  plays: DefensePlay[], sit: Situation, tend: TendencyTracker, profile: AiProfile, rng: Rng,
): DefensePlay {
  let best = plays[0]; let bestScore = -1e9;
  const runLean = tend.runRate();
  const deepLean = tend.deepRate();
  for (const p of plays) {
    let sc = 0;
    const isZone = p.tags.includes('ZONE');
    const isMan = p.tags.includes('MAN');
    const isPressure = p.tags.includes('EDGE') || p.tags.includes('INTERIOR') || p.tags.includes('ALLOUT');

    if (sit.toGo > 22) { sc += p.deepHelp * 1.6; sc -= isPressure ? 0.4 : 0; }
    if (sit.toGo < 8) { sc += isPressure ? 1.2 : 0; sc += p.tags.includes('GOALLINE') ? 0.4 : 0; }
    if (sit.down === 3 && sit.toGo > 14) sc += isPressure ? 0.9 : 0.2;
    if (sit.yardsToGoal < 12) sc += p.tags.includes('GOALLINE') ? 2.2 : -0.6;
    if (sit.yardsToGoal > 88) sc += p.aggression * 0.8;

    sc += (runLean - 0.5) * (isPressure ? 1.4 : -0.6);
    sc += (deepLean - 0.25) * p.deepHelp * 2.0;
    if (sit.quarter >= 4 && sit.clockSeconds < 40 && sit.scoreDiff > 0) sc += p.tags.includes('PREVENT') ? 1.8 : 0;
    else sc -= p.tags.includes('PREVENT') ? 1.4 : 0;

    sc += rng.spread((1 - profile.playCallQuality) * 5.0);
    if (sc > bestScore) { bestScore = sc; best = p; }
  }
  return best;
}

export { clamp01 };
