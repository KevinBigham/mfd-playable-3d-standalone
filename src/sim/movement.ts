import type { Athlete, PlayerIntent } from '../core/types.ts';
import { Action, has } from '../input/actions.ts';
import {
  FIXED_DT, SPEED_SKILL_BASE, SPEED_SKILL_TURBO, SPEED_LINE_BASE, SPEED_LINE_TURBO,
  SPEED_RATING_SCALE, ACCEL_GROUND, DECEL_GROUND, TURN_RATE_BASE, TURN_RATE_SPRINT,
  TURBO_MAX, TURBO_DRAIN, TURBO_REGEN, TURBO_REGEN_DELAY_MIN, TURBO_REGEN_DELAY_MAX,
  TURBO_COST, MOVE_TICKS, DIVE_BOOST, FIELD_HALF_WIDTH, OVERDRIVE_SPEED,
} from '../core/constants.ts';
import { clamp, clamp01, angApproach, heading, lerp } from '../core/math.ts';
import type { World } from './world.ts';

const LINE_POSITIONS = new Set(['OL', 'DL']);

export function isLineman(a: Athlete): boolean { return LINE_POSITIONS.has(a.def.pos); }

export function baseSpeed(a: Athlete): number {
  const raw = isLineman(a) ? SPEED_LINE_BASE : SPEED_SKILL_BASE;
  return raw * (1 + (a.def.ratings.speed - 50) * SPEED_RATING_SCALE);
}
export function turboSpeed(a: Athlete): number {
  const raw = isLineman(a) ? SPEED_LINE_TURBO : SPEED_SKILL_TURBO;
  return raw * (1 + (a.def.ratings.speed - 50) * SPEED_RATING_SCALE);
}

export function canAct(a: Athlete): boolean {
  return a.move !== 'DOWN' && a.move !== 'GETUP' && a.move !== 'STUNNED' && a.move !== 'CELEBRATE';
}

/** True while the athlete is locked into a committed animation. */
export function isCommitted(a: Athlete): boolean {
  return a.move === 'SPIN' || a.move === 'DIVE' || a.move === 'HURDLE' || a.move === 'HIGH_HURDLE'
    || a.move === 'DIVE_TACKLE' || a.move === 'POWER_TACKLE' || a.move === 'THROWING'
    || a.move === 'KICKING' || a.move === 'JUMP';
}

export function spendTurbo(a: Athlete, cost: number): boolean {
  if (a.turbo < cost) return false;
  a.turbo -= cost;
  a.turboLockTicks = Math.max(a.turboLockTicks, TURBO_REGEN_DELAY_MIN);
  return true;
}

/** Turbo bookkeeping; returns true when the athlete is actively sprinting this tick. */
function updateTurbo(a: Athlete, wantTurbo: boolean): boolean {
  if (a.onFire) { a.turbo = TURBO_MAX; a.turboHeld = wantTurbo; return wantTurbo; }
  const sprinting = wantTurbo && a.turbo > 0.5;
  if (sprinting) {
    a.turbo = Math.max(0, a.turbo - TURBO_DRAIN * FIXED_DT);
    const drained = 1 - a.turbo / TURBO_MAX;
    a.turboLockTicks = Math.round(lerp(TURBO_REGEN_DELAY_MIN, TURBO_REGEN_DELAY_MAX, drained));
  } else if (a.turboLockTicks > 0) {
    a.turboLockTicks--;
  } else if (a.turbo < TURBO_MAX) {
    a.turbo = Math.min(TURBO_MAX, a.turbo + TURBO_REGEN * FIXED_DT);
  }
  a.turboHeld = sprinting;
  return sprinting;
}

/**
 * Core locomotion. `desiredX/desiredZ` is a unit-ish direction; magnitude scales the target speed.
 * Returns the speed fraction (0..1) reached this tick, used to drive animation.
 */
export function locomote(w: World, a: Athlete, desiredX: number, desiredZ: number, wantTurbo: boolean): number {
  const traction = w.conditions.traction;
  const sprinting = updateTurbo(a, wantTurbo);

  if (!canAct(a)) {
    a.vx *= 0.82; a.vz *= 0.82;
    integrate(a, traction);
    return 0;
  }

  let mag = Math.hypot(desiredX, desiredZ);
  if (mag > 1) { desiredX /= mag; desiredZ /= mag; mag = 1; }

  const maxSpeed = (sprinting ? turboSpeed(a) : baseSpeed(a))
    * (a.onFire ? OVERDRIVE_SPEED : 1)
    * (a.engagedWith >= 0 ? 0.55 : 1)
    * (a.stunTicks > 0 ? 0.6 : 1);

  // Committed moves override steering.
  if (isCommitted(a)) {
    applyCommittedMove(a, maxSpeed);
    integrate(a, traction);
    return Math.hypot(a.vx, a.vz) / Math.max(1, maxSpeed);
  }

  const targetVx = desiredX * maxSpeed * mag;
  const targetVz = desiredZ * maxSpeed * mag;

  const curSpeed = Math.hypot(a.vx, a.vz);
  const accel = (mag > 0.05 ? ACCEL_GROUND : DECEL_GROUND) * traction
    * (isLineman(a) ? 0.9 : 1);

  const dvx = targetVx - a.vx, dvz = targetVz - a.vz;
  const dv = Math.hypot(dvx, dvz);
  const step = accel * FIXED_DT;
  if (dv > 1e-4) {
    const k = Math.min(1, step / dv);
    a.vx += dvx * k; a.vz += dvz * k;
  }

  // Facing follows velocity, but turning is harder at speed.
  const sp = Math.hypot(a.vx, a.vz);
  if (sp > 0.35) {
    const t = clamp01(sp / Math.max(1, maxSpeed));
    const turnRate = lerp(TURN_RATE_BASE, TURN_RATE_SPRINT, t) * (0.75 + a.def.ratings.agility / 200);
    a.facing = angApproach(a.facing, heading(a.vx, a.vz), turnRate * FIXED_DT);
  } else if (mag > 0.05) {
    a.facing = angApproach(a.facing, heading(desiredX, desiredZ), TURN_RATE_BASE * FIXED_DT);
  }

  integrate(a, traction);
  return clamp01(curSpeed / Math.max(1, maxSpeed));
}

function applyCommittedMove(a: Athlete, maxSpeed: number): void {
  switch (a.move) {
    case 'DIVE':
    case 'DIVE_TACKLE': {
      const t = 1 - a.moveTicks / MOVE_TICKS.DIVE;
      const push = (1 - t) * 1.25;
      a.vx = Math.sin(a.facing) * maxSpeed * (0.85 + push);
      a.vz = Math.cos(a.facing) * maxSpeed * (0.85 + push);
      a.y = Math.max(0, Math.sin(t * Math.PI) * 0.55);
      break;
    }
    case 'SPIN': {
      const t = 1 - a.moveTicks / MOVE_TICKS.SPIN;
      a.facing += Math.PI * 2 * (1 / MOVE_TICKS.SPIN);
      const sp = maxSpeed * (0.72 + 0.28 * t);
      const h = a.aiScratch; // stored entry heading
      a.vx = Math.sin(h) * sp; a.vz = Math.cos(h) * sp;
      break;
    }
    case 'HURDLE':
    case 'HIGH_HURDLE': {
      const total = a.move === 'HURDLE' ? MOVE_TICKS.HURDLE : MOVE_TICKS.HIGH_HURDLE;
      const t = 1 - a.moveTicks / total;
      const peak = a.move === 'HURDLE' ? 0.95 : 1.85;
      a.y = Math.sin(clamp01(t) * Math.PI) * peak;
      a.vx *= 0.995; a.vz *= 0.995;
      break;
    }
    case 'JUMP': {
      const t = 1 - a.moveTicks / MOVE_TICKS.JUMP;
      a.y = Math.sin(clamp01(t) * Math.PI) * 1.5;
      a.vx *= 0.97; a.vz *= 0.97;
      break;
    }
    case 'POWER_TACKLE': {
      a.vx = Math.sin(a.facing) * maxSpeed * 1.28;
      a.vz = Math.cos(a.facing) * maxSpeed * 1.28;
      break;
    }
    case 'THROWING':
    case 'KICKING': {
      a.vx *= 0.75; a.vz *= 0.75;
      break;
    }
    default: break;
  }
}

function integrate(a: Athlete, traction: number): void {
  a.x += a.vx * FIXED_DT;
  a.z += a.vz * FIXED_DT;
  if (a.y > 0 && a.move !== 'HURDLE' && a.move !== 'HIGH_HURDLE' && a.move !== 'JUMP' && a.move !== 'DIVE' && a.move !== 'DIVE_TACKLE') {
    a.vy -= 32 * FIXED_DT;
    a.y = Math.max(0, a.y + a.vy * FIXED_DT);
    if (a.y === 0) a.vy = 0;
  }
  // Soft sideline containment for non-carriers so nobody strays into the stands.
  const lim = FIELD_HALF_WIDTH + 4.5;
  if (a.x > lim) { a.x = lim; a.vx = Math.min(a.vx, 0); }
  if (a.x < -lim) { a.x = -lim; a.vx = Math.max(a.vx, 0); }
  if (a.z > 116) { a.z = 116; a.vz = Math.min(a.vz, 0); }
  if (a.z < -16) { a.z = -16; a.vz = Math.max(a.vz, 0); }
  void traction;
}

/** Advance timed move/animation state. Call once per athlete per tick after locomotion. */
export function tickMoveState(a: Athlete): void {
  if (a.moveTicks > 0) {
    a.moveTicks--;
    if (a.moveTicks === 0) {
      if (a.move === 'DOWN') { a.move = 'GETUP'; a.moveTicks = MOVE_TICKS.GETUP; }
      else if (a.move === 'DIVE') { a.move = 'DOWN'; a.moveTicks = MOVE_TICKS.GETUP; a.y = 0; }
      else { a.move = 'NORMAL'; a.y = 0; }
    }
  }
  if (a.stunTicks > 0) a.stunTicks--;
  if (a.downTicks > 0) a.downTicks--;
}

// ── move initiators ────────────────────────────────────────────────────────

export function startSpin(a: Athlete): boolean {
  if (!canAct(a) || isCommitted(a)) return false;
  if (!spendTurbo(a, TURBO_COST.SPIN)) return false;
  a.move = 'SPIN'; a.moveTicks = MOVE_TICKS.SPIN;
  a.aiScratch = a.facing;
  a.anim.state = 'SPIN'; a.anim.phase = 0;
  return true;
}

export function startHurdle(a: Athlete, high: boolean): boolean {
  if (!canAct(a) || isCommitted(a)) return false;
  if (high && !spendTurbo(a, TURBO_COST.HIGH_HURDLE)) return false;
  a.move = high ? 'HIGH_HURDLE' : 'HURDLE';
  a.moveTicks = high ? MOVE_TICKS.HIGH_HURDLE : MOVE_TICKS.HURDLE;
  a.anim.state = 'HURDLE'; a.anim.phase = 0;
  return true;
}

export function startDive(a: Athlete): boolean {
  if (!canAct(a) || isCommitted(a)) return false;
  if (!spendTurbo(a, TURBO_COST.DIVE)) return false;
  a.move = 'DIVE'; a.moveTicks = MOVE_TICKS.DIVE;
  a.anim.state = 'DIVE'; a.anim.phase = 0;
  a.x += Math.sin(a.facing) * DIVE_BOOST * 0.25;
  a.z += Math.cos(a.facing) * DIVE_BOOST * 0.25;
  return true;
}

export function startStiffArm(a: Athlete): boolean {
  if (!canAct(a) || isCommitted(a)) return false;
  if (!spendTurbo(a, TURBO_COST.STIFFARM)) return false;
  a.move = 'STIFFARM'; a.moveTicks = MOVE_TICKS.STIFFARM;
  a.anim.state = 'STIFFARM'; a.anim.phase = 0;
  return true;
}

export function startJump(a: Athlete): boolean {
  if (!canAct(a) || isCommitted(a)) return false;
  a.move = 'JUMP'; a.moveTicks = MOVE_TICKS.JUMP;
  a.anim.state = 'JUMP'; a.anim.phase = 0;
  return true;
}

export function startDiveTackle(a: Athlete): boolean {
  if (!canAct(a) || isCommitted(a)) return false;
  if (!spendTurbo(a, TURBO_COST.DIVE_TACKLE)) return false;
  a.move = 'DIVE_TACKLE'; a.moveTicks = MOVE_TICKS.DIVE_TACKLE;
  a.anim.state = 'DIVE'; a.anim.phase = 0;
  return true;
}

export function startPowerTackle(a: Athlete): boolean {
  if (!canAct(a) || isCommitted(a)) return false;
  if (!spendTurbo(a, TURBO_COST.POWER_TACKLE)) return false;
  a.move = 'POWER_TACKLE'; a.moveTicks = MOVE_TICKS.POWER_TACKLE;
  a.anim.state = 'TACKLE'; a.anim.phase = 0;
  return true;
}

export function knockDown(a: Athlete, ticks: number): void {
  a.move = 'DOWN'; a.moveTicks = ticks; a.downTicks = ticks;
  a.anim.state = 'TACKLED'; a.anim.phase = 0;
  a.vx *= 0.25; a.vz *= 0.25;
}

export function stun(a: Athlete, ticks: number): void {
  if (a.move === 'DOWN') return;
  a.move = 'STUNNED'; a.moveTicks = ticks; a.stunTicks = ticks;
  a.anim.state = 'STUMBLE'; a.anim.phase = 0;
}

/** Derive the animation state from movement + intent for rendering. */
export function syncAnim(a: Athlete, speed01: number): void {
  const st = a.anim;
  if (a.move === 'DOWN') { st.state = 'TACKLED'; }
  else if (a.move === 'GETUP') { st.state = 'GETUP'; }
  else if (a.move === 'STUNNED') { st.state = 'STUMBLE'; }
  else if (a.move === 'SPIN') { st.state = 'SPIN'; }
  else if (a.move === 'DIVE' || a.move === 'DIVE_TACKLE') { st.state = 'DIVE'; }
  else if (a.move === 'HURDLE' || a.move === 'HIGH_HURDLE') { st.state = 'HURDLE'; }
  else if (a.move === 'JUMP') { st.state = 'JUMP'; }
  else if (a.move === 'STIFFARM') { st.state = 'STIFFARM'; }
  else if (a.move === 'THROWING') { st.state = 'THROW'; }
  else if (a.move === 'KICKING') { st.state = 'KICK'; }
  else if (a.move === 'POWER_TACKLE' || a.move === 'TACKLING') { st.state = 'TACKLE'; }
  else if (a.move === 'CELEBRATE') { st.state = 'CELEBRATE'; }
  else if (a.engagedWith >= 0) { st.state = 'BLOCK'; }
  else if (speed01 > 0.72) { st.state = 'SPRINT'; }
  else if (speed01 > 0.08) { st.state = 'RUN'; }
  else { st.state = 'IDLE'; }

  const cadence = st.state === 'SPRINT' ? 0.115 : st.state === 'RUN' ? 0.085 : 0.02;
  st.phase = (st.phase + cadence * (0.4 + speed01)) % 1;
}

export function intentDir(i: PlayerIntent): { x: number; z: number } {
  return { x: i.moveX, z: i.moveZ };
}

export function wantsTurbo(i: PlayerIntent): boolean { return has(i.held, Action.TURBO); }

export { clamp };
