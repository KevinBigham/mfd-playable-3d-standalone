import type {
  Athlete, AthleteId, BallState, PassKind, KickKind, TeamSide,
  KickProvenance, PossessionChangeKind, ReturnKickKind,
} from '../core/types.ts';
import {
  FIXED_DT, PASS_SPEED, PASS_ARC, PASS_MAX_YARDS, FIELD_HALF_WIDTH,
} from '../core/constants.ts';
import { clamp, clamp01, lerp } from '../core/math.ts';
import type { World } from './world.ts';
import { other, livePossessionSide } from './world.ts';

/**
 * THE ONLY module allowed to mutate `world.ball.state`. ARCHITECTURE.md §10.
 */

/** Read the per-flight contact bitset while remaining compatible with legacy snapshots. */
export function hasBallAttempt(state: BallState, id: AthleteId): boolean {
  if (state.kind !== 'inAir' && !(state.kind === 'loose' && state.tipped)) return false;
  return ((state.attemptMask ?? 0) & (1 << id)) !== 0;
}

/** Mark one physical play on an airborne ball; only this authority module mutates the bitset. */
export function markBallAttempt(state: BallState, id: AthleteId): void {
  if (state.kind !== 'inAir' && !(state.kind === 'loose' && state.tipped)) return;
  state.attemptMask = (state.attemptMask ?? 0) | (1 << id);
}

/** Materialize the legacy default when restoring an older airborne-ball snapshot. */
export function normalizeBallAttempts(state: BallState): void {
  if ((state.kind === 'inAir' || (state.kind === 'loose' && state.tipped))
      && !Number.isInteger(state.attemptMask)) state.attemptMask = 0;
}

export function giveBall(w: World, id: AthleteId): void {
  const priorState = w.ball.state;
  const priorSide = livePossessionSide(w);
  for (const a of w.athletes) a.hasBall = false;
  const a = w.athletes[id];
  if (priorSide !== a.side) {
    const kind = possessionChangeKind(w, priorState);
    const change = { from: priorSide, to: a.side, kind, tick: w.tick, x: w.ball.x, z: w.ball.z };
    w.possessionHistory.count++;
    if (w.possessionHistory.first === null) w.possessionHistory.first = change;
    w.possessionHistory.last = change;
  }
  if (w.kickProvenance !== null) {
    const kick = w.kickProvenance;
    const receiving = a.side !== kick.kickingSide;
    if (priorState.kind === 'loose' && priorState.lastTouch >= 0
      && w.athletes[priorState.lastTouch].side !== kick.kickingSide) {
      kick.receivingTouched = true;
    }
    if (receiving) {
      kick.receivingTouched = true;
      kick.receivingPossessed = true;
    }
    kick.recovery = {
      kind: receiving ? 'RECEIVING_RECOVERY' : 'KICKING_RECOVERY',
      actor: a.id,
      side: a.side,
      x: w.ball.x,
      z: w.ball.z,
    };
  }
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

function possessionChangeKind(w: World, state: BallState): PossessionChangeKind {
  if (w.kickProvenance !== null || state.kind === 'kicked') return 'KICK';
  if ((state.kind === 'loose' && (state.fromFumble || state.fromLateral))
    || (state.kind === 'inAir' && state.passKind === 'LATERAL')) return 'FUMBLE';
  return 'INTERCEPTION';
}

export function killBall(w: World): void {
  for (const a of w.athletes) a.hasBall = false;
  w.ball.state = { kind: 'dead' };
  w.ball.vx = 0; w.ball.vy = 0; w.ball.vz = 0;
}

/**
 * End a return-kick recovery at its contact spot. Kicking-team recoveries and downed punts are
 * never live returns: the provenance records both the touching athlete and the side awarded the
 * next snap without briefly handing a runner the ball.
 */
export function deadKickRecovery(
  w: World, actor: AthleteId, side: TeamSide, kind: 'PUNT_DOWNED' | 'KICKING_RECOVERY',
): void {
  const kick = w.kickProvenance;
  if (kick === null) return;
  kick.recovery = { kind, actor, side, x: w.ball.x, z: w.ball.z };
  w.ball.possession = side;
  killBall(w);
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
    contested: false, attemptMask: 0,
  };
  w.ball.possession = thrower.side;
  w.ball.x = sx; w.ball.y = sy; w.ball.z = sz;
  w.ball.spin = passKind === 'BULLET' ? 34 : 22;
  // Coverage players no longer receive a magnetic 2.3-yard breakup. Once the pass is visibly
  // released they must instead diagnose it and run to a point where a hand can reach it. Preserve
  // a small awareness-based read delay, but discard the longer run-diagnosis queue from the snap.
  for (const defender of w.athletes) {
    if (defender.side === thrower.side) continue;
    const readTicks = Math.max(0, Math.round((95 - defender.def.ratings.awareness) / 18));
    defender.reactionQueue = Math.min(defender.reactionQueue, readTicks);
  }
}

export function dropLoose(w: World, from: AthleteId, vx: number, vy: number, vz: number, fromFumble: boolean): void {
  for (const a of w.athletes) a.hasBall = false;
  const st = w.ball.state;
  const a = w.athletes[from];
  if (st.kind === 'held') { w.ball.x = a.x; w.ball.y = 1.2; w.ball.z = a.z; }
  if (fromFumble) {
    w.fumbleOrigin = { carrier: from, side: a.side, tick: w.tick, x: w.ball.x, z: w.ball.z };
    // Once the receiving team establishes a return, a later fumble is ordinary football rather
    // than a continuing kick. A kicking-team recovery is still a kick until its resolver deadens
    // it, so keep provenance for that downstream rule.
    if (w.kickProvenance?.receivingPossessed) w.kickProvenance = null;
  }
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
  w.ball.state = { kind: 'loose', lastTouch: from, ticks: 0, fromFumble: false, tipped: true, attemptMask: 0 };
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
  w.kickProvenance = isReturnKick(kickKind) ? {
    kind: kickKind,
    kickingSide: a.side,
    launchX: w.ball.x,
    launchZ: w.ball.z,
    maxDownfieldTravel: 0,
    receivingTouched: false,
    receivingPossessed: false,
    recovery: null,
  } : null;
}

function isReturnKick(kind: KickKind): kind is ReturnKickKind {
  return kind === 'PUNT' || kind === 'KICKOFF' || kind === 'ONSIDE';
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
          b.state = { kind: 'loose', lastTouch: st.from, ticks: 0, fromFumble: false, fromLateral: true };
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
      updateKickTravel(w);
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
      updateKickTravel(w);
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

/** Latch signed free-kick travel so a legal ten-yard crossing survives a later bounce backward. */
function updateKickTravel(w: World): void {
  const kick = w.kickProvenance;
  if (kick === null || kick.receivingPossessed) return;
  const dir = kick.kickingSide === 0 ? 1 : -1;
  const signed = (w.ball.z - kick.launchZ) * dir;
  kick.maxDownfieldTravel = Math.max(kick.maxDownfieldTravel ?? 0, signed);
}

export function ballOutOfBounds(w: World): boolean {
  const b = w.ball;
  return Math.abs(b.x) > FIELD_HALF_WIDTH || b.z < -11 || b.z > 111;
}

export const possessionSideOf = livePossessionSide;

/** Dev/test invariant. Throws when the ball authority is violated. */
export function assertBallInvariant(w: World): void {
  const st = w.ball.state;
  let owners = 0;
  for (const a of w.athletes) if (a.hasBall) owners++;
  if (st.kind === 'held') {
    if (owners !== 1) throw new Error(`ball held but ${owners} athletes claim it`);
    if (!w.athletes[st.carrier].hasBall) throw new Error('carrier does not have hasBall');
    if (w.athletes[st.carrier].side !== w.ball.possession) throw new Error('held carrier side disagrees with ball possession');
  } else if (owners !== 0) {
    throw new Error(`ball ${st.kind} but ${owners} athletes claim it`);
  }
  if (!Number.isFinite(w.ball.x) || !Number.isFinite(w.ball.y) || !Number.isFinite(w.ball.z)) {
    throw new Error('ball transform is NaN');
  }
  if (w.ball.possession !== 0 && w.ball.possession !== 1) throw new Error('live ball possession is invalid');
  if (w.snapSide !== 0 && w.snapSide !== 1) throw new Error('snap side is invalid');
  const history = w.possessionHistory;
  if (!Number.isInteger(history.count) || history.count < 0) throw new Error('possession history count is invalid');
  if ((history.count === 0 && (history.first !== null || history.last !== null))
    || (history.count > 0 && (history.first === null || history.last === null))) {
    throw new Error('possession history shape is invalid');
  }
  for (const change of [history.first, history.last]) {
    if (change === null) continue;
    if ((change.from !== 0 && change.from !== 1) || (change.to !== 0 && change.to !== 1)
      || (change.kind !== 'INTERCEPTION' && change.kind !== 'FUMBLE' && change.kind !== 'KICK')
      || !Number.isFinite(change.x) || !Number.isFinite(change.z) || !Number.isInteger(change.tick) || change.tick < 0) {
      throw new Error('possession change is invalid');
    }
  }
  const fumble = w.fumbleOrigin;
  if (fumble && ((fumble.side !== 0 && fumble.side !== 1) || !Number.isInteger(fumble.carrier)
    || fumble.carrier < 0 || fumble.carrier >= w.athletes.length || !Number.isInteger(fumble.tick) || fumble.tick < 0
    || !Number.isFinite(fumble.x) || !Number.isFinite(fumble.z))) {
    throw new Error('fumble origin is invalid');
  }
  const kick: KickProvenance | null = w.kickProvenance;
  if (kick && ((kick.kind !== 'PUNT' && kick.kind !== 'KICKOFF' && kick.kind !== 'ONSIDE')
    || (kick.kickingSide !== 0 && kick.kickingSide !== 1)
    || !Number.isFinite(kick.launchX) || !Number.isFinite(kick.launchZ)
    || (kick.maxDownfieldTravel !== undefined
      && (!Number.isFinite(kick.maxDownfieldTravel) || kick.maxDownfieldTravel < 0))
    || (kick.receivingPossessed && !kick.receivingTouched)
    || (kick.recovery !== null && ((kick.recovery.kind !== 'PUNT_DOWNED' && kick.recovery.kind !== 'KICKING_RECOVERY' && kick.recovery.kind !== 'RECEIVING_RECOVERY')
      || (kick.recovery.side !== 0 && kick.recovery.side !== 1)
      || !Number.isInteger(kick.recovery.actor) || kick.recovery.actor < 0 || kick.recovery.actor >= w.athletes.length
      || (kick.recovery.kind !== 'PUNT_DOWNED' && w.athletes[kick.recovery.actor].side !== kick.recovery.side)
      || (kick.recovery.kind === 'PUNT_DOWNED' && w.athletes[kick.recovery.actor].side !== kick.kickingSide)
      || !Number.isFinite(kick.recovery.x) || !Number.isFinite(kick.recovery.z))))) {
    throw new Error('kick provenance is invalid');
  }
}

export { other, clamp };
