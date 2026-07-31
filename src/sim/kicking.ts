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

const G = 32; // yd/s^2

/** Solve a ballistic launch that covers `travel` yards in `hang` seconds. */
function ballistic(travel: number, hang: number): { vy: number; vz: number } {
  return { vy: (G * hang) / 2, vz: travel / hang };
}

export function launchFieldGoal(w: World, kicker: Athlete, plan: KickPlan, good: boolean): void {
  const dir = dirOf(kicker.side);
  const dz = fieldGoalDistance(w, kicker.side);
  // Aim past the posts so the ball is still climbing/level as it crosses.
  const travel = dz + 12;
  const hang = clamp(1.15 + dz * 0.022, 1.15, 2.3);
  const { vy, vz } = ballistic(travel, hang);
  const off = good ? w.rng.spread(1.6) : (w.rng.chance(0.5) ? 1 : -1) * w.rng.range(5.5, 12);
  launchKick(w, kicker.id, 'FIELD_GOAL', plan.aim * 2.5 + off, vy, dir * vz);
  const st = w.ball.state;
  if (st.kind === 'kicked') st.goodThroughUprights = good;
}

export function launchExtraPoint(w: World, kicker: Athlete, good: boolean): void {
  const dir = dirOf(kicker.side);
  const { vy, vz } = ballistic(26, 1.35);
  const off = good ? w.rng.spread(1.2) : (w.rng.chance(0.5) ? 1 : -1) * w.rng.range(6, 12);
  launchKick(w, kicker.id, 'EXTRA_POINT', off, vy, dir * vz);
  const st = w.ball.state;
  if (st.kind === 'kicked') st.goodThroughUprights = good;
}

export function launchPunt(w: World, kicker: Athlete, plan: KickPlan): number {
  const dir = dirOf(kicker.side);
  const power = lerp(0.55, 1.0, plan.power);
  const distance = lerp(28, 52, power) * (0.88 + kicker.def.ratings.accuracy / 500);
  // Hang time is the whole point of a punt: it is what lets coverage arrive.
  const hang = lerp(2.0, 2.85, plan.quality);
  const { vy, vz } = ballistic(distance, hang);
  launchKick(w, kicker.id, 'PUNT', plan.aim * 6 + w.conditions.windX * 0.4, vy, dir * vz);
  return distance;
}

export function launchKickoff(w: World, kicker: Athlete, onside: boolean): void {
  const dir = dirOf(kicker.side);
  if (onside) {
    const { vy, vz } = ballistic(ONSIDE_YARDS, 1.0);
    launchKick(w, kicker.id, 'ONSIDE', w.rng.spread(5), vy * 0.75, dir * vz * 1.35);
    return;
  }
  const targetZ = w.rng.range(KICKOFF_TARGET_MIN, KICKOFF_TARGET_MAX);
  const goal = goalOf(kicker.side);
  // Land `targetZ` yards short of the goal line, on the correct side of the field.
  const landing = goal - dir * targetZ;
  const travel = Math.abs(landing - w.losZ);
  const hang = 2.75 + w.rng.range(-0.15, 0.2);
  const { vy, vz } = ballistic(travel, hang);
  launchKick(w, kicker.id, 'KICKOFF', w.rng.spread(4), vy, dir * vz);
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
