import type { Athlete, KickKind, TeamSide } from '../core/types.ts';
import {
  FG_MAX_YARDS, FG_METER_PERIOD, PUNT_POWER_PERIOD, KICKOFF_TARGET_MIN, KICKOFF_TARGET_MAX,
  ONSIDE_YARDS, GOALPOST_WIDTH, GOALPOST_HEIGHT, FIXED_DT,
} from '../core/constants.ts';
import { clamp, clamp01, lerp } from '../core/math.ts';
import type { World } from './world.ts';
import { dirOf, goalOf } from './world.ts';
import { launchKick } from './ball.ts';

/** Oscillating meter shared by FG accuracy and punt power. 0..1 triangle wave. */
export function meterValue(ticks: number, period: number): number {
  const t = (ticks % period) / period;
  return t < 0.5 ? t * 2 : (1 - t) * 2;
}

export interface KickPlan {
  kind: KickKind;
  /** -1..1 aim across the field. */
  aim: number;
  /** 0..1 power. */
  power: number;
  /** 0..1 accuracy quality (1 = perfect). */
  quality: number;
}

export function fieldGoalDistance(w: World, side: TeamSide): number {
  const goal = goalOf(side);
  return Math.abs(goal - w.losZ) + 7; // snap + hold depth
}

export function fieldGoalMakeChance(w: World, side: TeamSide, plan: KickPlan, kicker: Athlete): number {
  const d = fieldGoalDistance(w, side);
  if (d > FG_MAX_YARDS + 6) return 0;
  const range = clamp01(1 - Math.max(0, d - 22) / (FG_MAX_YARDS - 14));
  const skill = 0.55 + kicker.def.ratings.accuracy / 220;
  const wind = 1 - clamp01(Math.abs(w.conditions.windX) / 26);
  return clamp01(range * skill * plan.quality * wind * 1.35);
}

export function launchFieldGoal(w: World, kicker: Athlete, plan: KickPlan, good: boolean): void {
  const dir = dirOf(kicker.side);
  const dz = fieldGoalDistance(w, kicker.side);
  const speed = Math.sqrt(Math.max(120, dz * 12));
  const off = good ? w.rng.spread(2.4) : (w.rng.chance(0.5) ? 1 : -1) * w.rng.range(4.5, 11);
  const vy = lerp(11, 17, clamp01(dz / 55));
  launchKick(w, kicker.id, 'FIELD_GOAL',
    (plan.aim * 3 + off), vy, dir * speed * 1.15);
  const st = w.ball.state;
  if (st.kind === 'kicked') st.goodThroughUprights = good;
}

export function launchExtraPoint(w: World, kicker: Athlete, good: boolean): void {
  const dir = dirOf(kicker.side);
  launchKick(w, kicker.id, 'EXTRA_POINT', good ? w.rng.spread(1.5) : w.rng.range(6, 12) * (w.rng.chance(0.5) ? 1 : -1), 15, dir * 26);
  const st = w.ball.state;
  if (st.kind === 'kicked') st.goodThroughUprights = good;
}

export function launchPunt(w: World, kicker: Athlete, plan: KickPlan): number {
  const dir = dirOf(kicker.side);
  const power = lerp(0.55, 1.0, plan.power);
  const dist = lerp(26, 58, power) * (0.85 + kicker.def.ratings.accuracy / 400);
  const hang = lerp(11, 18, plan.quality);
  launchKick(w, kicker.id, 'PUNT', plan.aim * 7 + w.conditions.windX * 0.5, hang, dir * dist * 0.72);
  return dist;
}

export function launchKickoff(w: World, kicker: Athlete, onside: boolean): void {
  const dir = dirOf(kicker.side);
  if (onside) {
    launchKick(w, kicker.id, 'ONSIDE', w.rng.spread(6), 7.5, dir * ONSIDE_YARDS * 1.05);
    return;
  }
  const targetZ = w.rng.range(KICKOFF_TARGET_MIN, KICKOFF_TARGET_MAX);
  const goal = goalOf(kicker.side);
  const travel = Math.abs(goal - targetZ - w.losZ);
  launchKick(w, kicker.id, 'KICKOFF', w.rng.spread(5), 17.5, dir * travel * 0.62);
}

/** Did a kicked ball pass through the uprights of `side`'s target goal? */
export function checkUprights(w: World, side: TeamSide): boolean | null {
  const st = w.ball.state;
  if (st.kind !== 'kicked') return null;
  if (st.kickKind !== 'FIELD_GOAL' && st.kickKind !== 'EXTRA_POINT') return null;
  const goal = goalOf(side);
  const dir = dirOf(side);
  const crossed = dir > 0 ? w.ball.z >= goal : w.ball.z <= goal;
  if (!crossed) return null;
  const inside = Math.abs(w.ball.x) <= GOALPOST_WIDTH && w.ball.y >= 3.2 && w.ball.y <= GOALPOST_HEIGHT + 14;
  return inside;
}

export { clamp, FIXED_DT, PUNT_POWER_PERIOD, FG_METER_PERIOD };
