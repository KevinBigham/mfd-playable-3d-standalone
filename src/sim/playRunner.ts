import type {
  Athlete, AthleteId, DeadReason, DefensePlay, OffensePlay, PassKind, PlayerIntent, TeamSide,
} from '../core/types.ts';
import { Action, has } from '../input/actions.ts';
import {
  FIELD_HALF_WIDTH, MOVE_TICKS, TURBO_COST, LEAD_TIME_SCALE, PASS_SPEED,
  OVERDRIVE_ACCURACY, s, FIXED_DT,
} from '../core/constants.ts';
import { clamp, clamp01, dist, heading, angDelta } from '../core/math.ts';
import type { World } from './world.ts';
import { OFF_START, DEF_START, dirOf, goalOf, ownGoalOf, other, carrier, savePrev } from './world.ts';
import {
  locomote, tickMoveState, syncAnim, startSpin, startHurdle, startDive, startStiffArm,
  startJump, startDiveTackle, startPowerTackle, spendTurbo, canAct, isCommitted, isLineman,
} from './movement.ts';
import { giveBall, releasePass, stepBall, killBall, syncHeldBall, dropLoose } from './ball.ts';
import { resolveAirBall, resolveLooseBall } from './catching.ts';
import {
  updateBlocking, updateTackling, resolveBodyOverlap, clearAllEngagements, applyPush,
  updatePostPlaySlapstick,
} from './contact.ts';

// ── setup ──────────────────────────────────────────────────────────────────

export interface PlaySetup {
  offense: OffensePlay;
  defense: DefensePlay;
  losZ: number;
  spotX: number;
  possession: TeamSide;
  mirrored?: boolean;
}

export function setupPlay(w: World, setup: PlaySetup): void {
  const dir = dirOf(setup.possession);
  const mir = setup.mirrored ? -1 : 1;
  w.losZ = setup.losZ;
  w.spotX = setup.spotX;
  w.possession = setup.possession;
  w.offensePlay = setup.offense;
  w.defensePlay = setup.defense;
  w.playPhase = 'SETUP';
  w.playTicks = 0;
  w.deadReason = null;
  w.passThrown = false;
  w.handedOff = false;
  w.scoreLocked = false;
  w.lastPassAirYards = 0;
  w.kickPending = null;
  w.switchRequests.length = 0;
  clearAllEngagements(w);

  const targets: AthleteId[] = [-1, -1, -1];

  for (let i = 0; i < 7; i++) {
    const a = w.athletes[OFF_START + i];
    const plan = setup.offense.players[i];
    a.role = plan.role;
    a.route = plan.route;
    a.routeIdx = 0;
    a.routeHold = 0;
    a.targetButton = plan.target;
    a.x = setup.spotX + plan.align.x * mir * dir;
    a.z = setup.losZ + plan.align.z * dir;
    a.homeX = a.x; a.homeZ = a.z;
    a.y = 0; a.vx = 0; a.vz = 0; a.vy = 0;
    a.facing = dir > 0 ? 0 : Math.PI;
    a.move = 'NORMAL'; a.moveTicks = 0; a.anim.state = 'SET'; a.anim.phase = 0;
    a.stunTicks = 0; a.downTicks = 0;
    a.hasBall = false;
    a.assign = null;
    if (plan.target !== null && plan.target !== undefined) targets[plan.target] = a.id;
    if (plan.role === 'QB') w.qbId = a.id;
  }

  for (let i = 0; i < 7; i++) {
    const d = w.athletes[DEF_START + i];
    const plan = setup.defense.players[i];
    d.role = 'DEF';
    d.route = null;
    d.assign = plan.assign;
    d.targetButton = null;
    d.x = setup.spotX + plan.align.x * mir * dir;
    d.z = setup.losZ + plan.align.z * dir;
    d.homeX = d.x; d.homeZ = d.z;
    d.y = 0; d.vx = 0; d.vz = 0; d.vy = 0;
    d.facing = dir > 0 ? Math.PI : 0;
    d.move = 'NORMAL'; d.moveTicks = 0; d.anim.state = 'SET'; d.anim.phase = 0;
    d.stunTicks = 0; d.downTicks = 0;
    d.hasBall = false;
  }

  w.passTargets = [targets[0], targets[1], targets[2]];
  w.qbTarget = targets[1] >= 0 ? targets[1] : targets[0];
  giveBall(w, w.qbId);
  w.gainOriginZ = setup.losZ;
  w.spotZ = setup.losZ;
  w.playPhase = 'PRESNAP';
  w.bus.emit({ type: 'play.start', tick: w.tick, play: setup.offense.id, side: setup.possession });
}

export function snap(w: World): void {
  if (w.playPhase !== 'PRESNAP') return;
  w.playPhase = 'LIVE';
  w.snapTick = w.tick;
  w.playTicks = 0;
  w.bus.emit({ type: 'snap', tick: w.tick, side: w.possession });
  for (const a of w.athletes) { a.anim.state = 'RUN'; }
}

// ── passing ────────────────────────────────────────────────────────────────

export function estimateFlight(fromX: number, fromZ: number, toX: number, toZ: number, kind: PassKind): number {
  const d = Math.hypot(toX - fromX, toZ - fromZ);
  return Math.max(0.14, d / (PASS_SPEED[kind] || PASS_SPEED.NORMAL));
}

export function throwTo(w: World, qb: Athlete, receiver: Athlete, kind: PassKind, aimErrorYd = 0): void {
  const rough = estimateFlight(qb.x, qb.z, receiver.x, receiver.z, kind);
  let tx = receiver.x + receiver.vx * rough * LEAD_TIME_SCALE;
  let tz = receiver.z + receiver.vz * rough * LEAD_TIME_SCALE;
  const acc = qb.def.ratings.accuracy * (qb.onFire ? OVERDRIVE_ACCURACY : 1);
  const baseErr = clamp(1.9 - acc / 70, 0.05, 2.2) + aimErrorYd;
  tx += w.rng.spread(baseErr);
  tz += w.rng.spread(baseErr);
  tx = clamp(tx, -FIELD_HALF_WIDTH - 2, FIELD_HALF_WIDTH + 2);
  tz = clamp(tz, -12, 112);
  qb.move = 'THROWING'; qb.moveTicks = MOVE_TICKS.THROW;
  qb.anim.state = 'THROW'; qb.anim.phase = 0;
  qb.facing = heading(tx - qb.x, tz - qb.z);
  releasePass(w, qb.id, receiver.id, tx, tz, kind);
  w.passThrown = true;
  w.bus.emit({ type: 'throw', tick: w.tick, from: qb.id, to: receiver.id, passKind: kind });
}

export function throwAway(w: World, qb: Athlete): void {
  const dir = dirOf(qb.side);
  const tx = clamp(qb.x + (qb.x > 0 ? 16 : -16), -FIELD_HALF_WIDTH - 3, FIELD_HALF_WIDTH + 3);
  const tz = qb.z + dir * 12;
  qb.move = 'THROWING'; qb.moveTicks = MOVE_TICKS.THROW;
  qb.anim.state = 'THROW';
  releasePass(w, qb.id, null, tx, tz, 'NORMAL');
  w.passThrown = true;
  w.bus.emit({ type: 'throw', tick: w.tick, from: qb.id, to: null, passKind: 'NORMAL' });
}

/** Lateral: only legal backwards. Returns true when a pitch was made. */
export function tryLateral(w: World, car: Athlete): boolean {
  const dir = dirOf(car.side);
  let best: Athlete | null = null; let bestD = 12;
  for (let i = 0; i < 7; i++) {
    const t = w.athletes[OFF_START + i];
    if (t.side !== car.side || t.id === car.id) continue;
    if (t.move === 'DOWN') continue;
    const behind = (t.z - car.z) * dir;
    if (behind > -0.4) continue;
    const d = dist(car.x, car.z, t.x, t.z);
    if (d < bestD) { bestD = d; best = t; }
  }
  if (!best) return false;
  releasePass(w, car.id, best.id, best.x + best.vx * 0.25, best.z + best.vz * 0.25, 'LATERAL');
  w.bus.emit({ type: 'lateral', tick: w.tick, from: car.id, to: best.id });
  return true;
}

// ── per-athlete action application ─────────────────────────────────────────

export function applyActions(w: World, a: Athlete, it: PlayerIntent): void {
  if (!canAct(a)) return;
  const car = carrier(w);
  const isCarrier = a.hasBall;
  const dir = dirOf(a.side);
  const offenseSide = w.possession;
  const onOffense = a.side === offenseSide;
  const pastLos = (a.z - w.losZ) * dir > 0.8;
  const turbo = has(it.held, Action.TURBO);

  if (isCarrier) {
    const isQb = a.id === w.qbId && !pastLos && !w.passThrown;

    // Icon passing — bound to snap alignment, does not follow crossing routes.
    if (isQb) {
      let tgt = -1;
      if (has(it.pressed, Action.TARGET_L)) tgt = w.passTargets[0];
      else if (has(it.pressed, Action.TARGET_M)) tgt = w.passTargets[1];
      else if (has(it.pressed, Action.TARGET_R)) tgt = w.passTargets[2];
      if (tgt >= 0) {
        const kind: PassKind = turbo ? 'BULLET' : has(it.held, Action.LOB) ? 'TOUCH' : 'NORMAL';
        if (kind === 'BULLET') spendTurbo(a, TURBO_COST.BULLET);
        throwTo(w, a, w.athletes[tgt], kind);
        return;
      }
      // Directional passing: stick picks the receiver whose bearing best matches.
      if (has(it.pressed, Action.ACTION)) {
        const mag = Math.hypot(it.moveX, it.moveZ);
        let pick = -1;
        if (mag > 0.35) {
          const want = heading(it.moveX * dir, it.moveZ * dir);
          let bestScore = -Infinity;
          for (const id of w.passTargets) {
            if (id < 0) continue;
            const r = w.athletes[id];
            if (r.move === 'DOWN') continue;
            const bearing = heading((r.x - a.x) * dir, (r.z - a.z) * dir);
            const score = -Math.abs(angDelta(want, bearing)) + clamp01((r.z - a.z) * dir / 40) * 0.35;
            if (score > bestScore) { bestScore = score; pick = id; }
          }
        } else {
          pick = pickOpenReceiver(w, a);
        }
        if (pick >= 0) {
          const kind: PassKind = turbo ? 'BULLET' : has(it.held, Action.LOB) ? 'TOUCH' : 'NORMAL';
          if (kind === 'BULLET') spendTurbo(a, TURBO_COST.BULLET);
          throwTo(w, a, w.athletes[pick], kind);
          return;
        }
      }
    } else if (has(it.pressed, Action.ACTION)) {
      // Past the LOS: turbo+action = stiff arm, action alone = lateral.
      if (turbo) { if (startStiffArm(a)) { w.bus.emit({ type: 'move', tick: w.tick, by: a.id, move: 'STIFFARM' }); return; } }
      else if (tryLateral(w, a)) return;
    }

    if (has(it.pressed, Action.JUMP)) {
      if (isQb && turbo) { startJump(a); return; }
      const high = turbo;
      if (startHurdle(a, high)) {
        w.bus.emit({ type: 'move', tick: w.tick, by: a.id, move: high ? 'HIGH_HURDLE' : 'HURDLE' });
        return;
      }
    }
    if (has(it.pressed, Action.DIVE)) {
      if (startDive(a)) { w.bus.emit({ type: 'move', tick: w.tick, by: a.id, move: 'DIVE' }); return; }
    }
    if (has(it.pressed, Action.SPECIAL)) {
      if (startSpin(a)) { w.bus.emit({ type: 'move', tick: w.tick, by: a.id, move: 'SPIN' }); return; }
    }
    return;
  }

  if (onOffense) {
    // Non-carrier offense (free receiver / blocker under human control).
    if (has(it.pressed, Action.JUMP)) startJump(a);
    if (has(it.pressed, Action.DIVE)) startDive(a);
    if (has(it.pressed, Action.SPECIAL) && turbo) applyPush(w, a);
    return;
  }

  // Defense.
  const ballInAir = w.ball.state.kind === 'inAir';
  if (has(it.pressed, Action.JUMP)) {
    if (ballInAir) { startJump(a); return; }
    if (turbo) { if (startPowerTackle(a)) return; }
    if (startDiveTackle(a)) return;
  }
  if (has(it.pressed, Action.DIVE)) { startDiveTackle(a); return; }
  if (has(it.pressed, Action.SPECIAL)) {
    if (turbo) { if (startPowerTackle(a)) return; }
    else if (spendTurbo(a, TURBO_COST.PUSH)) { applyPush(w, a); return; }
  }
  if (has(it.pressed, Action.ACTION)) {
    if (turbo) { if (spendTurbo(a, TURBO_COST.PUSH)) applyPush(w, a); }
    else w.switchRequests.push(a.controlledBySeat);
  }
  void car;
}

export function pickOpenReceiver(w: World, qb: Athlete): AthleteId {
  let best = -1; let bestScore = -Infinity;
  const dir = dirOf(qb.side);
  for (const id of w.passTargets) {
    if (id < 0) continue;
    const r = w.athletes[id];
    if (r.move === 'DOWN') continue;
    let nearest = 99;
    for (let i = 0; i < 7; i++) {
      const d = w.athletes[DEF_START + i];
      if (d.side === qb.side) continue;
      nearest = Math.min(nearest, dist(r.x, r.z, d.x, d.z));
    }
    const depth = (r.z - qb.z) * dir;
    const score = nearest * 1.6 + clamp(depth, -6, 34) * 0.22;
    if (score > bestScore) { bestScore = score; best = id; }
  }
  return best;
}

// ── route running ──────────────────────────────────────────────────────────

export function routeSteer(w: World, a: Athlete, out: { x: number; z: number; turbo: boolean }): void {
  out.x = 0; out.z = 0; out.turbo = false;
  const route = a.route;
  const dir = dirOf(a.side);
  if (!route || route.length === 0) return;
  if (a.routeIdx >= route.length) {
    // Route finished: drift to find space.
    const qb = w.athletes[w.qbId];
    out.x = clamp((a.x - qb.x) * 0.12, -1, 1) * 0.4;
    out.z = 0.12 * dir;
    return;
  }
  if (a.routeHold > 0) { a.routeHold--; return; }
  const node = route[a.routeIdx];
  const tx = a.homeX + node.x * dir;
  const tz = a.homeZ + node.z * dir;
  const dx = tx - a.x, dz = tz - a.z;
  const d = Math.hypot(dx, dz);
  if (d < 1.1) {
    a.routeIdx++;
    a.routeHold = node.hold ?? 0;
    return;
  }
  out.x = dx / d; out.z = dz / d;
  out.turbo = node.action === 'SPEED' || (node.action === 'RUN' && d > 9);
}

// ── dead-ball detection ────────────────────────────────────────────────────

export function detectDead(w: World): DeadReason | null {
  const b = w.ball;
  const st = b.state;

  if (st.kind === 'held') {
    const a = w.athletes[st.carrier];
    if (Math.abs(a.x) > FIELD_HALF_WIDTH) return 'OUT_OF_BOUNDS';
    const attackGoal = goalOf(a.side);
    const ownGoal = ownGoalOf(a.side);
    if (a.side === 0 ? a.z >= attackGoal : a.z <= attackGoal) {
      return w.special === 'KICKOFF' || w.special === 'ONSIDE' || w.special === 'PUNT'
        ? 'TOUCHDOWN' : 'TOUCHDOWN';
    }
    if (a.side === 0 ? a.z <= ownGoal : a.z >= ownGoal) return 'SAFETY';
    if (a.move === 'DOWN') return 'TACKLE';
    return null;
  }

  if (st.kind === 'loose') {
    if (Math.abs(b.x) > FIELD_HALF_WIDTH || b.z < -10.5 || b.z > 110.5) return 'OUT_OF_BOUNDS';
    if (st.ticks > s(4.5)) return 'FUMBLE_DEAD';
    return null;
  }

  if (st.kind === 'inAir') {
    if (st.t >= st.flightTime && st.passKind !== 'LATERAL') return 'INCOMPLETE';
    if (Math.abs(b.x) > FIELD_HALF_WIDTH + 2) return 'INCOMPLETE';
    return null;
  }

  if (st.kind === 'kicked') {
    if (st.kickKind === 'FIELD_GOAL' || st.kickKind === 'EXTRA_POINT') {
      if (st.landed || Math.abs(b.z - 50) > 62) {
        return st.goodThroughUprights ? 'FIELD_GOAL_GOOD' : 'FIELD_GOAL_MISS';
      }
      return null;
    }
    if (Math.abs(b.x) > FIELD_HALF_WIDTH) return 'OUT_OF_BOUNDS';
    return null;
  }
  return null;
}

// ── main step ──────────────────────────────────────────────────────────────

export interface Controller { produce(w: World, id: AthleteId, out: PlayerIntent): void }

const steerScratch = { x: 0, z: 0, turbo: false };

export function stepPlay(w: World, controllers: (Controller | null)[]): DeadReason | null {
  savePrev(w);
  w.tick++;
  w.playTicks++;
  w.switchRequests.length = 0;

  for (let i = 0; i < w.athletes.length; i++) {
    const it = w.intents[i];
    it.moveX = 0; it.moveZ = 0; it.pressed = 0; it.released = 0;
    const prevHeld = it.held;
    it.held = 0;
    const c = controllers[i];
    if (c) c.produce(w, i, it);
    it.pressed = it.held & ~prevHeld;
    it.released = prevHeld & ~it.held;
  }

  if (w.playPhase === 'LIVE' || w.playPhase === 'PRESNAP') {
    for (let i = 0; i < w.athletes.length; i++) applyActions(w, w.athletes[i], w.intents[i]);
  }

  for (let i = 0; i < w.athletes.length; i++) {
    const a = w.athletes[i];
    const it = w.intents[i];
    if (w.freezeDefense && a.side !== w.possession) { locomote(w, a, 0, 0, false); tickMoveState(a); syncAnim(a, 0); continue; }
    const sp = locomote(w, a, it.moveX, it.moveZ, has(it.held, Action.TURBO));
    tickMoveState(a);
    syncAnim(a, sp);
  }

  if (w.playPhase === 'LIVE') {
    updateBlocking(w);
    resolveBodyOverlap(w);
    const hit = updateTackling(w);
    void hit;
  } else if (w.playPhase === 'POST') {
    resolveBodyOverlap(w);
    updatePostPlaySlapstick(w, w.lateHits);
  } else {
    resolveBodyOverlap(w);
  }

  stepBall(w);
  if (w.playPhase === 'LIVE') {
    if (w.ball.state.kind === 'inAir') resolveAirBall(w);
    if (w.ball.state.kind === 'loose') resolveLooseBall(w);
    if (w.ball.state.kind === 'held') syncHeldBall(w);
  }

  if (w.playPhase !== 'LIVE') return null;
  return detectDead(w);
}

export { steerScratch, clamp, clamp01, dist, killBall, dropLoose, giveBall, isLineman, isCommitted, FIXED_DT, other };
