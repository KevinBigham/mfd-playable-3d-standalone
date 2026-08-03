import type { Athlete, AthleteId, PassKind, KickKind, TeamSide } from '../core/types.ts';
import {
  FIXED_DT, PASS_SPEED, PASS_ARC, PASS_MAX_YARDS, FIELD_HALF_WIDTH,
} from '../core/constants.ts';
import { clamp, clamp01, lerp } from '../core/math.ts';
import type { World } from './world.ts';
import { other } from './world.ts';

/**
 * THE ONLY module allowed to mutate `world.ball.state`. ARCHITECTURE.md §10.
 */

export function giveBall(w: World, id: AthleteId): void {
  for (const a of w.athletes) a.hasBall = false;
  const a = w.athletes[id];
  a.hasBall = true;
  w.ball.state = { kind: 'held', carrier: id };
  w.ball.possession = a.side;
  w.lastCarrier = id;
  // Where possession was gained decides safety vs touchback later on. It also resets forward
  // progress: a new carrier has not advanced anything yet, and inheriting the last man's progress
  // would spot an interception at the receiver's deepest point.
  w.gainOriginZ = a.z;
  w.progressZ = a.z;
  w.progressArmed = false;
  w.ball.vx = 0; w.ball.vy = 0; w.ball.vz = 0;
  syncHeldBall(w);
}

export function killBall(w: World): void {
  for (const a of w.athletes) a.hasBall = false;
  w.ball.state = { kind: 'dead' };
  w.ball.vx = 0; w.ball.vy = 0; w.ball.vz = 0;
}

export function releasePass(
  w: World, from: AthleteId, intended: AthleteId | null,
  tx: number, tz: number, passKind: PassKind,
): void {
  const thrower = w.athletes[from];
  thrower.hasBall = false;
  const sx = thrower.x + Math.sin(thrower.facing) * 0.6;
  const sz = thrower.z + Math.cos(thrower.facing) * 0.6;
  const sy = 1.85 + thrower.y;

  let dx = tx - sx, dz = tz - sz;
  let d = Math.hypot(dx, dz);
  if (d > PASS_MAX_YARDS) { const k = PASS_MAX_YARDS / d; dx *= k; dz *= k; d = PASS_MAX_YARDS; tx = sx + dx; tz = sz + dz; }

  const speed = PASS_SPEED[passKind] || PASS_SPEED.NORMAL;
  const flight = Math.max(0.14, d / speed);
  const arc = (PASS_ARC[passKind] ?? PASS_ARC.NORMAL) * Math.max(1.2, d * 0.42);

  // Wind pushes the landing point a little.
  const windScale = flight * 0.35;
  tx += w.conditions.windX * windScale * 0.12;
  tz += w.conditions.windZ * windScale * 0.12;

  w.ball.state = {
    kind: 'inAir', from, intended, passKind, t: 0, flightTime: flight,
    sx, sy, sz, tx, ty: passKind === 'LATERAL' ? 1.2 : 1.55, tz, arc,
    contested: false,
  };
  w.ball.possession = thrower.side;
  w.ball.x = sx; w.ball.y = sy; w.ball.z = sz;
  w.ball.spin = passKind === 'BULLET' ? 34 : 22;
}

export function dropLoose(w: World, from: AthleteId, vx: number, vy: number, vz: number, fromFumble: boolean): void {
  for (const a of w.athletes) a.hasBall = false;
  const st = w.ball.state;
  const a = w.athletes[from];
  if (st.kind === 'held') { w.ball.x = a.x; w.ball.y = 1.2; w.ball.z = a.z; }
  w.ball.vx = vx; w.ball.vy = vy; w.ball.vz = vz;
  w.ball.state = { kind: 'loose', lastTouch: from, ticks: 0, fromFumble };
}

/**
 * A pass that was juggled instead of caught cleanly. The ball pops up off the hands and stays
 * live IN THE AIR — either team can still take it — but it is legally still a forward pass, so
 * touching the ground ends the play as incomplete. `stepBall` and `detectDead` both key off
 * `tipped` for that.
 *
 * Note the position: unlike a fumble, the ball does not start at the athlete's chest. It starts
 * where the BALL was, because that is the point in space both players were reaching for.
 */
export function bobbleBall(w: World, from: AthleteId, vx: number, vy: number, vz: number): void {
  for (const a of w.athletes) a.hasBall = false;
  w.ball.vx = vx; w.ball.vy = vy; w.ball.vz = vz;
  w.ball.state = { kind: 'loose', lastTouch: from, ticks: 0, fromFumble: false, tipped: true };
}

export function launchKick(
  w: World, from: AthleteId, kickKind: KickKind, vx: number, vy: number, vz: number,
): void {
  const a = w.athletes[from];
  a.hasBall = false;
  w.ball.x = a.x; w.ball.y = 0.7; w.ball.z = a.z;
  w.ball.vx = vx; w.ball.vy = vy; w.ball.vz = vz;
  w.ball.spin = 26;
  w.ball.state = { kind: 'kicked', from, kickKind, t: 0, landed: false, goodThroughUprights: null };
  w.ball.possession = a.side;
}

/**
 * Which arm the ball is tucked under: +1 the athlete's right, -1 his left.
 *
 * The renderer poses the tucking arm and draws the ball in the cradle it makes, so the sign has
 * to be the same one the offset below uses. It lives here, next to the code that decides it,
 * rather than being re-derived in the render layer where it could quietly drift out of step.
 */
export function carryArm(a: Athlete): number {
  return (a.move === 'STIFFARM' ? -1 : 1) * (a.side === 0 ? 1 : -1);
}

/** Keep the ball glued to the carrier's hands. */
export function syncHeldBall(w: World): void {
  const st = w.ball.state;
  if (st.kind !== 'held') return;
  const a = w.athletes[st.carrier];
  const side = carryArm(a) * (a.move === 'STIFFARM' ? 0.55 : 0.42);
  w.ball.x = a.x + Math.cos(a.facing) * side;
  w.ball.z = a.z - Math.sin(a.facing) * side;
  w.ball.y = 1.15 + a.y + (a.anim.state === 'DIVE' ? -0.35 : 0);
  w.ball.spin = 0;
}

/** Advance airborne / loose / kicked ball. Returns true when the ball hit the ground this tick. */
export function stepBall(w: World): boolean {
  const b = w.ball;
  const st = b.state;
  switch (st.kind) {
    case 'held': syncHeldBall(w); return false;
    case 'inAir': {
      st.t += FIXED_DT;
      const u = clamp01(st.t / st.flightTime);
      b.x = lerp(st.sx, st.tx, u);
      b.z = lerp(st.sz, st.tz, u);
      b.y = lerp(st.sy, st.ty, u) + Math.sin(u * Math.PI) * st.arc;
      b.spin = 24;
      if (u >= 1) {
        // Uncaught: lateral stays live, forward pass is incomplete (handled by rules).
        if (st.passKind === 'LATERAL') {
          b.state = { kind: 'loose', lastTouch: st.from, ticks: 0, fromFumble: false };
          b.vx = (st.tx - st.sx) * 0.25; b.vz = (st.tz - st.sz) * 0.25; b.vy = -2;
        }
        return true;
      }
      return false;
    }
    case 'loose': {
      st.ticks++;
      b.vy -= 32 * FIXED_DT;
      b.x += b.vx * FIXED_DT; b.y += b.vy * FIXED_DT; b.z += b.vz * FIXED_DT;
      if (b.y <= 0.12) {
        b.y = 0.12;
        // A tipped forward pass does not bounce back into play. It is down where it landed and
        // the down is over; `detectDead` reads that as INCOMPLETE.
        if (st.tipped) { b.vx = 0; b.vy = 0; b.vz = 0; return true; }
        if (b.vy < -1.2) {
          b.vy = -b.vy * 0.42;
          // Prolate spheroid: bounces sideways unpredictably (deterministic RNG).
          b.vx = b.vx * 0.6 + w.rng.spread(3.4);
          b.vz = b.vz * 0.6 + w.rng.spread(3.4);
        } else { b.vy = 0; b.vx *= 0.86; b.vz *= 0.86; }
      }
      b.spin = 12;
      return b.y <= 0.13;
    }
    case 'kicked': {
      st.t += FIXED_DT;
      b.vy -= 32 * FIXED_DT;
      b.vx += w.conditions.windX * 0.08 * FIXED_DT * 6;
      b.vz += w.conditions.windZ * 0.08 * FIXED_DT * 6;
      b.x += b.vx * FIXED_DT; b.y += b.vy * FIXED_DT; b.z += b.vz * FIXED_DT;
      b.spin = 20;
      if (b.y <= 0.12 && !st.landed) {
        b.y = 0.12; st.landed = true;
        if (st.kickKind === 'PUNT' || st.kickKind === 'KICKOFF' || st.kickKind === 'ONSIDE') {
          b.state = { kind: 'loose', lastTouch: -1, ticks: 0, fromFumble: false };
          b.vy = 6.5; b.vx *= 0.5; b.vz *= 0.5;
        }
        return true;
      }
      return false;
    }
    case 'dead': return false;
    default: return false;
  }
}

export function ballOutOfBounds(w: World): boolean {
  const b = w.ball;
  return Math.abs(b.x) > FIELD_HALF_WIDTH || b.z < -11 || b.z > 111;
}

export function possessionSideOf(w: World): TeamSide {
  const st = w.ball.state;
  if (st.kind === 'held') return w.athletes[st.carrier].side;
  return w.ball.possession;
}

/** Dev/test invariant. Throws when the ball authority is violated. */
export function assertBallInvariant(w: World): void {
  const st = w.ball.state;
  let owners = 0;
  for (const a of w.athletes) if (a.hasBall) owners++;
  if (st.kind === 'held') {
    if (owners !== 1) throw new Error(`ball held but ${owners} athletes claim it`);
    if (!w.athletes[st.carrier].hasBall) throw new Error('carrier does not have hasBall');
  } else if (owners !== 0) {
    throw new Error(`ball ${st.kind} but ${owners} athletes claim it`);
  }
  if (!Number.isFinite(w.ball.x) || !Number.isFinite(w.ball.y) || !Number.isFinite(w.ball.z)) {
    throw new Error('ball transform is NaN');
  }
}

export { other, clamp };
