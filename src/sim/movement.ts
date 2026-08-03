import type { Athlete, PlayerIntent } from '../core/types.ts';
import { Action, has } from '../input/actions.ts';
import {
  FIXED_DT, SPEED_SKILL_BASE, SPEED_SKILL_TURBO, SPEED_LINE_BASE, SPEED_LINE_TURBO,
  SPEED_RATING_SCALE, ACCEL_GROUND, DECEL_GROUND, TURN_RATE_BASE, TURN_RATE_SPRINT,
  TURBO_MAX, TURBO_DRAIN, TURBO_REGEN, TURBO_REGEN_DELAY_MIN, TURBO_REGEN_DELAY_MAX,
  TURBO_COST, MOVE_TICKS, DIVE_BOOST, FIELD_HALF_WIDTH, OVERDRIVE_SPEED, CARRIER_SPEED_BONUS,
  JUKE_LATERAL, PROTECT_SPEED, PROTECT_TURN,
} from '../core/constants.ts';
import { clamp, clamp01, angDelta, heading, lerp } from '../core/math.ts';
import type { World } from './world.ts';

const LINE_POSITIONS = new Set(['OL', 'DL']);

export function isLineman(a: Athlete): boolean { return LINE_POSITIONS.has(a.def.pos); }

/**
 * Who is allowed to block right now.
 *
 * This used to be `role === 'LINE'`, which meant that in a seven-man game exactly three players
 * could ever engage a defender. Every run play in the book assigns a lead blocker and a stalk
 * blocker on top of the three linemen — and both of them ran to a patch of grass and stood there,
 * because nothing outside the line was permitted to make contact. Measured over ten games, four
 * and a half of the seven defenders were unblocked at the handoff and the median designed run
 * gained one yard, with first contact 0.8 yards past the line.
 *
 * A man's route says whether he is blocking. The line always is; anybody else is blocking while
 * his current route node says BLOCK.
 */
export function isBlocking(a: Athlete): boolean {
  if (a.role === 'LINE') return true;
  const r = a.route;
  if (!r || a.routeIdx >= r.length) return false;
  return r[a.routeIdx].action === 'BLOCK';
}

export function baseSpeed(a: Athlete): number {
  const raw = isLineman(a) ? SPEED_LINE_BASE : SPEED_SKILL_BASE;
  return raw * (1 + (a.def.ratings.speed - 50) * SPEED_RATING_SCALE);
}
export function turboSpeed(a: Athlete): number {
  const raw = isLineman(a) ? SPEED_LINE_TURBO : SPEED_SKILL_TURBO;
  return raw * (1 + (a.def.ratings.speed - 50) * SPEED_RATING_SCALE);
}
/**
 * The fastest this athlete can travel right now, Overdrive included.
 *
 * `turboSpeed` is NOT that number and anybody timing a run against it is wrong by eleven per cent
 * the moment the man catches fire. That is exactly how the kick returner used to miss one kickoff
 * in a hundred: he solved his run-up against `turboSpeed`, set off in Overdrive, arrived a quarter
 * of a second early and ran out from under the ball.
 */
export function topSpeed(a: Athlete): number {
  return turboSpeed(a) * (a.onFire ? OVERDRIVE_SPEED : 1);
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

/**
 * Turbo bookkeeping; returns true when the athlete is actively sprinting this tick.
 *
 * The regen delay is armed ONCE, on the tick sprinting stops — arming it every sprinting tick
 * soft-locks the meter: it crosses the restart threshold, sprints for a single tick, re-arms a
 * full-length lock, and never recovers. Restarting also needs a real reserve (hysteresis), so a
 * held button cannot stutter in and out of sprint one tick at a time.
 */
const TURBO_RESTART = 26;   // a quarter tank, so an auto-restart is a real burst not a stutter
const TURBO_HELD_REGEN = 0.6; // holding an empty button recharges slower — let go and it comes back

function updateTurbo(a: Athlete, wantTurbo: boolean): boolean {
  if (a.onFire) { a.turbo = TURBO_MAX; a.turboHeld = wantTurbo; return wantTurbo; }
  const wasSprinting = a.turboHeld;
  const threshold = wasSprinting ? 0.5 : TURBO_RESTART;
  const sprinting = wantTurbo && a.turbo > threshold && a.turboLockTicks <= 0;

  if (sprinting) {
    a.turbo = Math.max(0, a.turbo - TURBO_DRAIN * FIXED_DT);
  } else {
    if (wasSprinting) {
      // Just released, or just ran dry: the deeper the burn, the longer the wait.
      const drained = 1 - a.turbo / TURBO_MAX;
      a.turboLockTicks = Math.round(lerp(TURBO_REGEN_DELAY_MIN, TURBO_REGEN_DELAY_MAX, drained));
    }
    if (a.turboLockTicks > 0) a.turboLockTicks--;
    else if (a.turbo < TURBO_MAX) {
      const rate = TURBO_REGEN * (wantTurbo ? TURBO_HELD_REGEN : 1);
      a.turbo = Math.min(TURBO_MAX, a.turbo + rate * FIXED_DT);
    }
  }
  a.turboHeld = sprinting;
  return sprinting;
}

/**
 * Gait bookkeeping, run once per athlete per tick from `locomote`.
 *
 * Gait is driven by GROUND COVERED, not by velocity. Blocking shoves, pile separation and
 * sideline clamps all move an athlete without touching his velocity, so a velocity-driven run
 * cycle showed a defender strolling while he was in fact sliding four yards a second. The
 * difference between the two positions spans a whole tick, so it picks up every one of those
 * corrections — and reading it costs nothing in gameplay terms, because it changes only what
 * the legs do.
 *
 * `speed01` is normalised against the athlete's OWN top speed rather than his current cap.
 * Normalising against the current cap made the number fall off a cliff the instant turbo
 * engaged — the denominator jumped from base to turbo speed in a single tick — which flipped
 * the animation state backwards at the exact moment the athlete accelerated. (The denominator
 * still steps by 11 % when Overdrive ignites, which is small enough for the hysteresis in
 * `syncAnim` to absorb.)
 *
 * The two acceleration terms are in the athlete's own frame and exist so the renderer can
 * lean the body into what it is doing without re-deriving anything.
 */
const GAIT_SMOOTH = 0.24;
const ACCEL_SMOOTH = 0.16;

/**
 * Second-order heading control.
 *
 * `angApproach` rotates at a constant clamped rate and then stops dead the tick the error
 * falls inside one step. Constant rate then zero is an infinite angular acceleration, and it
 * is what made bodies whip round and halt. Chasing an angular VELOCITY instead — proportional
 * to the error, capped by the turn rate, and itself rate-limited — costs one number per
 * athlete and removes the snap entirely.
 */
const TURN_P = 9.5;         // 1/s: how hard the athlete chases the heading error
const TURN_ACCEL = 0.30;    // fraction of the angular-velocity error closed per tick

function steerFacing(a: Athlete, target: number, maxRate: number): void {
  const err = angDelta(a.facing, target);
  const want = clamp(err * TURN_P, -maxRate, maxRate);
  a.turnVel += (want - a.turnVel) * TURN_ACCEL;
  a.facing += a.turnVel * FIXED_DT;
}

/** Re-anchor the gait after an athlete is teleported (formation setup), so the tick in which
 *  he appears at his alignment is not read as one tick of enormous ground speed. */
export function resetGait(a: Athlete): void {
  const an = a.anim;
  an.lastX = a.x; an.lastZ = a.z;
  an.ground = 0; an.speed01 = 0; an.accelFwd = 0; an.accelLat = 0;
  a.turnVel = 0;
}

function decayTurn(a: Athlete): void {
  a.turnVel *= 0.72;
  if (Math.abs(a.turnVel) < 1e-4) a.turnVel = 0;
  else a.facing += a.turnVel * FIXED_DT;
}

function updateGait(a: Athlete, vx0: number, vz0: number): void {
  const top = topSpeed(a);
  const an = a.anim;
  // Distance covered since the last update, which is exactly one tick, however it was covered.
  // Clamped so a formation reset or a teleporting spawn cannot spike the stride.
  const ground = Math.min(
    Math.hypot(a.x - an.lastX, a.z - an.lastZ) / FIXED_DT, top * 1.7,
  );
  an.lastX = a.x; an.lastZ = a.z;
  an.ground = ground;
  const raw = clamp01(ground / Math.max(1e-3, top));
  an.speed01 += (raw - an.speed01) * GAIT_SMOOTH;

  const ax = (a.vx - vx0) / FIXED_DT, az = (a.vz - vz0) / FIXED_DT;
  const fx = Math.sin(a.facing), fz = Math.cos(a.facing);
  an.accelFwd += ((ax * fx + az * fz) - an.accelFwd) * ACCEL_SMOOTH;
  an.accelLat += ((ax * fz - az * fx) - an.accelLat) * ACCEL_SMOOTH;
}

/**
 * Core locomotion. `desiredX/desiredZ` is a unit-ish direction; magnitude scales the target speed.
 * Returns the smoothed gait fraction (0..1), used to drive animation.
 */
export function locomote(w: World, a: Athlete, desiredX: number, desiredZ: number, wantTurbo: boolean): number {
  const traction = w.conditions.traction;
  const sprinting = updateTurbo(a, wantTurbo);
  const vx0 = a.vx, vz0 = a.vz;

  if (!canAct(a)) {
    a.vx *= 0.82; a.vz *= 0.82;
    decayTurn(a);
    integrate(a, traction);
    updateGait(a, vx0, vz0);
    return a.anim.speed01;
  }

  let mag = Math.hypot(desiredX, desiredZ);
  if (mag > 1) { desiredX /= mag; desiredZ /= mag; mag = 1; }

  const maxSpeed = (sprinting ? turboSpeed(a) : baseSpeed(a))
    * (a.protecting && a.hasBall ? PROTECT_SPEED : 1)
    * (a.onFire ? OVERDRIVE_SPEED : 1)
    * (a.hasBall ? CARRIER_SPEED_BONUS : 1)
    * (a.engagedWith >= 0 ? 0.55 : 1)
    * (a.stunTicks > 0 ? 0.6 : 1);

  // Committed moves override steering.
  if (isCommitted(a)) {
    a.turnVel = 0;
    applyCommittedMove(a, maxSpeed);
    integrate(a, traction);
    updateGait(a, vx0, vz0);
    return a.anim.speed01;
  }

  const targetVx = desiredX * maxSpeed * mag;
  const targetVz = desiredZ * maxSpeed * mag;

  const accel = (mag > 0.05 ? ACCEL_GROUND : DECEL_GROUND) * traction
    * (isLineman(a) ? 0.9 : 1);

  const dvx = targetVx - a.vx, dvz = targetVz - a.vz;
  const dv = Math.hypot(dvx, dvz);
  const step = accel * FIXED_DT;
  if (dv > 1e-4) {
    const k = Math.min(1, step / dv);
    a.vx += dvx * k; a.vz += dvz * k;
  }

  // Facing follows a blend of where the athlete is going and where he is asking to go. The
  // old code hard-switched between the two at 0.35 yd/s, so an athlete slowing through that
  // speed snapped his heading; below it he also turned at full rate regardless of momentum.
  const sp = Math.hypot(a.vx, a.vz);
  const dux = mag > 1e-4 ? desiredX / mag : 0;
  const duz = mag > 1e-4 ? desiredZ / mag : 0;
  if (sp > 0.05 || mag > 0.05) {
    const wVel = clamp01((sp - 0.15) / 1.2);
    let tx = 0, tz = 0;
    if (sp > 1e-4) { tx += (a.vx / sp) * wVel; tz += (a.vz / sp) * wVel; }
    tx += dux * (1 - wVel); tz += duz * (1 - wVel);
    if (Math.abs(tx) > 1e-5 || Math.abs(tz) > 1e-5) {
      // Squared so the turn stays loose through mid speed and only tightens near the top.
      const t = clamp01(sp / Math.max(1, maxSpeed));
      const turnRate = lerp(TURN_RATE_BASE, TURN_RATE_SPRINT, t * t)
        * (0.75 + a.def.ratings.agility / 200)
        // Both hands on the ball is a worse posture to cut from, not just a slower one.
        * (a.protecting && a.hasBall ? PROTECT_TURN : 1);
      steerFacing(a, heading(tx, tz), turnRate);
    } else {
      decayTurn(a);
    }
  } else {
    decayTurn(a);
  }

  integrate(a, traction);
  updateGait(a, vx0, vz0);
  return a.anim.speed01;
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
    case 'JUKE': {
      // A cut, not a turn: he keeps travelling roughly where he was going while his body shifts
      // sideways out of the tackler's path. Heading is nudged, not swung, so the exit is smooth.
      const t = 1 - a.moveTicks / MOVE_TICKS.JUKE;
      const bite = Math.sin(t * Math.PI);              // strongest through the middle of the cut
      const side = a.aiScratch >= 0 ? 1 : -1;
      const rx = Math.cos(a.facing), rz = -Math.sin(a.facing);   // athlete's right
      const lat = JUKE_LATERAL * bite * side;
      a.vx += rx * lat * 0.5; a.vz += rz * lat * 0.5;
      a.facing += side * 0.05 * bite;
      const sp = Math.hypot(a.vx, a.vz);
      const cap = maxSpeed * 0.97;
      if (sp > cap) { a.vx = (a.vx / sp) * cap; a.vz = (a.vz / sp) * cap; }
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
      // Committed moves have recovery. Without it a high hurdle is free invulnerability and a
      // dive tackle is a spammable reach with no downside.
      if (a.move === 'DOWN') { a.move = 'GETUP'; a.moveTicks = MOVE_TICKS.GETUP; }
      else if (a.move === 'DIVE') { a.move = 'DOWN'; a.moveTicks = MOVE_TICKS.GETUP; a.y = 0; }
      else if (a.move === 'DIVE_TACKLE') { a.move = 'DOWN'; a.moveTicks = MOVE_TICKS.GETUP; a.y = 0; }
      else if (a.move === 'HIGH_HURDLE') { a.move = 'STUNNED'; a.moveTicks = MOVE_TICKS.LANDING; a.stunTicks = MOVE_TICKS.LANDING; a.y = 0; }
      else if (a.move === 'POWER_TACKLE') { a.move = 'STUNNED'; a.moveTicks = MOVE_TICKS.WHIFF; a.stunTicks = MOVE_TICKS.WHIFF; }
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

/**
 * Plant and cut. Cheap, short, and only worth pressing against somebody who has committed.
 *
 * The cut direction comes from the stick relative to the athlete's own facing, so it reads as a
 * cut rather than a turn: the displacement is sideways, the heading barely changes, and he keeps
 * most of his forward speed. That is what separates it from simply steering.
 */
export function startJuke(a: Athlete, lateral: number): boolean {
  if (!canAct(a) || isCommitted(a)) return false;
  if (!spendTurbo(a, TURBO_COST.JUKE)) return false;
  a.move = 'JUKE'; a.moveTicks = MOVE_TICKS.JUKE;
  // Sign of the cut, remembered for the whole move so it cannot be steered mid-flight.
  a.aiScratch = lateral >= 0 ? 1 : -1;
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

/**
 * Derive the animation state from movement + intent for rendering.
 *
 * The locomotion bands carry hysteresis. Fixed thresholds meant an athlete holding a speed
 * near a boundary changed state every single tick, and every change restarts a procedural
 * pose — the visible result was a vibrating athlete, not a running one.
 */
const SPRINT_IN = 0.80, SPRINT_OUT = 0.71;
const RUN_IN = 0.10, RUN_OUT = 0.055;
/** Yards covered by one full stride cycle. Cadence is derived from ground speed so feet
 *  travel with the turf instead of buzzing at a fixed rate. */
export const STRIDE_YARDS = 3.4;

/**
 * Yards covered by one full stride cycle at a given ground speed. Below the cadence floor the
 * stride shortens instead of the legs slowing further, so this is not simply STRIDE_YARDS. The
 * renderer needs the real figure: its run cycle plants each foot for exactly the fraction of the
 * cycle that keeps the foot still against the turf.
 */
export function strideLengthFor(ground: number): number {
  const hz = clamp(ground / STRIDE_YARDS, 1.15, 4.6);
  return ground / hz;
}

export function syncAnim(a: Athlete, speed01: number): void {
  const st = a.anim;
  const wasSprint = st.state === 'SPRINT';
  const wasMoving = wasSprint || st.state === 'RUN';

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
  else if (speed01 > (wasSprint ? SPRINT_OUT : SPRINT_IN)) { st.state = 'SPRINT'; }
  else if (speed01 > (wasMoving ? RUN_OUT : RUN_IN)) { st.state = 'RUN'; }
  else { st.state = 'IDLE'; }

  let cadence: number;
  if (st.state === 'RUN' || st.state === 'SPRINT') {
    const hz = clamp(a.anim.ground / STRIDE_YARDS, 1.15, 4.6);
    cadence = hz * FIXED_DT;
  } else {
    cadence = 0.02 * (0.4 + speed01);
  }
  st.phase = (st.phase + cadence) % 1;
}

export function intentDir(i: PlayerIntent): { x: number; z: number } {
  return { x: i.moveX, z: i.moveZ };
}

export function wantsTurbo(i: PlayerIntent): boolean { return has(i.held, Action.TURBO); }

export { clamp };
