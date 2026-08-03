import type { Difficulty } from '../core/types.ts';
import { AI_PROFILES, CATCHUP_MAX } from '../core/constants.ts';
import { clamp, clamp01 } from '../core/math.ts';

export interface AiProfile {
  reactionTicks: number;
  aimErrorYd: number;
  decisionNoise: number;
  coverageDiscipline: number;
  riskTolerance: number;
  moveTiming: number;
  playCallQuality: number;
  pursuitAngleError: number;
  catchFocus: number;
}

export function profileFor(d: Difficulty): AiProfile {
  return { ...AI_PROFILES[d] };
}

/**
 * Comeback bias. Bounded to +/-CATCHUP_MAX on pursuit speed and pressure only — never on
 * catch probability, never on hidden stat inflation. Documented in DESIGN.md and disableable.
 */
export function catchUpFactor(enabled: boolean, myScore: number, theirScore: number): number {
  if (!enabled) return 1;
  const deficit = theirScore - myScore;
  const t = clamp01((deficit - 7) / 21);
  return 1 + t * CATCHUP_MAX;
}

export { clamp };
