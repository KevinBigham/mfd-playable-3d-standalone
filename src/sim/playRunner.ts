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
  locomote, tickMoveState, syncAnim, resetGait, startSpin, startHurdle, startDive, startStiffArm,
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

/**
 * Bind roster people to play slots by ROLE, not by index.
 * Playbook files order offensive slots [QB, LINE, LINE, LINE, skill, skill, skill];
 * rosters are stored [QB, skill, skill, skill, OL, OL, OL, front, front, front, DB…].
 * Without this remap, linemen would run routes with receiver bodies.
 */
function bindRoster(w: World, setup: PlaySetup): void {
  const offRoster = w.teams[setup.possession].roster;
  const defRoster = w.teams[setup.possession === 0 ? 1 : 0].roster;
  const skillPool = [1, 2, 3];
  const linePool = [4, 5, 6];
  let sI = 0, lI = 0;
  const kicker = w.special === 'PUNT' || w.special === 'FIELD_GOAL' || w.special === 'EXTRA_POINT'
    || w.special === 'KICKOFF' || w.special === 'ONSIDE';
  for (let i = 0; i < 7; i++) {
    const a = w.athletes[OFF_START + i];
    const plan = setup.offense.players[i];
    let idx: number;
    if (plan.role === 'LINE') idx = linePool[Math.min(lI++, 2)];
    else if (plan.role === 'QB') idx = kicker ? 14 : 0;
    else idx = skillPool[Math.min(sI++, 2)];
    a.def = offRoster[idx] ?? offRoster[0];
  }
  // Defence: rushers and contain come from the front, coverage from the secondary.
  const front = [7, 8, 9];
  const backs = [10, 11, 12, 13];
  let fI = 0, bI = 0;
  for (let i = 0; i < 7; i++) {
    const d = w.athletes[DEF_START + i];
    const kind = setup.defense.players[i].assign.kind;
    const isFront = kind === 'RUSH' || kind === 'CONTAIN' || kind === 'BLITZ_DELAY';
    let idx: number;
    if (isFront && fI < 3) idx = front[fI++];
    else if (!isFront && bI < 4) idx = backs[bI++];
    else if (fI < 3) idx = front[fI++];
    else idx = backs[Math.min(bI++, 3)];
    d.def = defRoster[idx] ?? defRoster[7] ?? defRoster[0];
  }
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
  bindRoster(w, setup);

  for (let i = 0; i < 7; i++) {
    const a = w.athletes[OFF_START + i];
    const plan = setup.offense.players[i];
    a.role = plan.role;
    a.route = plan.route;
    a.routeIdx = 0;
    a.routeHold = 0;
    a.targetButton = plan.target;
    a.x = setup.spotX + plan.align.x * mir * dir;
    // Backed up against your own goal you line up ON the goal line, not behind it. Without this
    // clamp a shotgun snap from the 1 starts the quarterback inside his own end zone and every
    // tackle is a safety.
    const rawZ = setup.losZ + plan.align.z * dir;
    a.z = dir > 0 ? Math.max(rawZ, 0.4) : Math.min(rawZ, 99.6);
    a.homeX = a.x; a.homeZ = a.z;
    a.y = 0; a.vx = 0; a.vz = 0; a.vy = 0;
    a.facing = dir > 0 ? 0 : Math.PI;
    a.move = 'NORMAL'; a.moveTicks = 0; a.anim.state = 'SET'; a.anim.phase = 0;
    resetGait(a);
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
    resetGait(d);
    d.stunTicks = 0; d.downTicks = 0;
    d.hasBall = false;
  }

  // A route whose first action is CARRY marks the handoff/pitch man.
  w.handoffTarget = -1;
  w.handoffTick = s(0.28);
  for (let i = 0; i < 7; i++) {
    const plan = setup.offense.players[i];
    const idx = plan.route.findIndex((n) => n.action === 'CARRY');
    if (idx >= 0) {
      w.handoffTarget = w.athletes[OFF_START + i].id;
      w.handoffTick = s(idx === 0 ? 0.30 : 0.55);
      break;
    }
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
  // Solve the lead point: the ball has to arrive where the receiver WILL be, and the
  // flight time depends on that point, so iterate to a fixed point.
  let tx = receiver.x;
  let tz = receiver.z;
  for (let i = 0; i < 3; i++) {
    const ft = estimateFlight(qb.x, qb.z, tx, tz, kind);
    tx = receiver.x + receiver.vx * ft * LEAD_TIME_SCALE;
    tz = receiver.z + receiver.vz * ft * LEAD_TIME_SCALE;
  }
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

/** Exchange the ball to the designated back — a handoff up close, a pitch when further out. */
export function tryHandoff(w: World): void {
  if (w.handoffTarget < 0 || w.handedOff || w.passThrown) return;
  if (w.playTicks < w.handoffTick) return;
  const st = w.ball.state;
  if (st.kind !== 'held' || st.carrier !== w.qbId) { w.handoffTarget = -1; return; }
  const qb = w.athletes[w.qbId];
  const back = w.athletes[w.handoffTarget];
  if (back.move === 'DOWN') { w.handoffTarget = -1; return; }
  const d = dist(qb.x, qb.z, back.x, back.z);
  if (d > 9) {
    if (w.playTicks > w.handoffTick + s(0.7)) w.handoffTarget = -1;
    return;
  }
  if (d > 3.2) {
    releasePass(w, qb.id, back.id, back.x + back.vx * 0.22, back.z + back.vz * 0.22, 'LATERAL');
    w.bus.emit({ type: 'lateral', tick: w.tick, from: qb.id, to: back.id });
  } else {
    giveBall(w, back.id);
    w.bus.emit({ type: 'handoff', tick: w.tick, to: back.id });
  }
  w.handedOff = true;
  w.handoffTarget = -1;
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

  // A kick play cannot legitimately run forever: without a cap a returner who gets boxed in and
  // oscillates holds the play open until the phase watchdog fires. The limit is generous enough
  // for a full-length return (hang time plus 100 yards at top speed is about 12 s).
  const kickCap = (w.special === 'KICKOFF' || w.special === 'ONSIDE' || w.special === 'PUNT') ? s(17) : s(9);
  if (w.special !== null && w.playPhase === 'LIVE' && w.playTicks > kickCap) {
    if (st.kind === 'held') return 'TACKLE';
    if (st.kind === 'loose' || st.kind === 'kicked') return 'FUMBLE_DEAD';
    return 'KICK_RESULT';
  }

  if (st.kind === 'held') {
    const a = w.athletes[st.carrier];
    const attackGoal = goalOf(a.side);
    const ownGoal = ownGoalOf(a.side);
    if (a.side === 0 ? a.z >= attackGoal : a.z <= attackGoal) return 'TOUCHDOWN';

    const inOwnEndZone = a.side === 0 ? a.z <= ownGoal : a.z >= ownGoal;
    const oob = Math.abs(a.x) > FIELD_HALF_WIDTH;
    // Standing in your own end zone is not a safety — being DOWN there is. And a player who
    // GAINED possession in his own end zone (a returner fielding a kick, a defender picking off
    // a goal-line throw) takes a touchback, not two points against his own team.
    if (inOwnEndZone && (a.move === 'DOWN' || oob)) {
      // Forgiving by design: a defender who picks the ball off inside his own five and gets
      // carried back into the end zone takes a touchback. Only a team that already had the ball,
      // or one that retreats there from real field position, concedes two points.
      const ownGoalZ = a.side === 0 ? 0 : 100;
      const gainedThere = Math.abs(w.gainOriginZ - ownGoalZ) <= 5;
      if (a.side !== w.possession && gainedThere) return 'TOUCHBACK';
      return 'SAFETY';
    }
    if (oob) return 'OUT_OF_BOUNDS';
    if (a.move === 'DOWN') return 'TACKLE';
    return null;
  }

  if (st.kind === 'loose') {
    // Kick plays route through resolveKickPlay, which already knows what a ball in an end zone
    // means for a return. Only scrimmage fumbles get the touchback/safety treatment here.
    if (w.special !== null) {
      if (Math.abs(b.x) > FIELD_HALF_WIDTH || b.z < -10.5 || b.z > 110.5) return 'OUT_OF_BOUNDS';
      if (st.ticks > s(4.5)) return 'FUMBLE_DEAD';
      return null;
    }
    const offGoal = goalOf(w.possession);
    const ownGoal = ownGoalOf(w.possession);
    const pastAttackLine = offGoal === 100 ? b.z > 110.5 : b.z < -10.5;
    const pastOwnLine = ownGoal === 100 ? b.z > 110.5 : b.z < -10.5;
    if (pastAttackLine) return 'TOUCHBACK';
    if (pastOwnLine) return 'SAFETY';
    const inOffEndZone = offGoal === 100 ? b.z > 100 : b.z < 0;
    const inOwnEndZone = ownGoal === 100 ? b.z > 100 : b.z < 0;
    if (Math.abs(b.x) > FIELD_HALF_WIDTH) {
      if (inOffEndZone) return 'TOUCHBACK';
      if (inOwnEndZone) return 'SAFETY';
      return 'OUT_OF_BOUNDS';
    }
    if (st.ticks > s(4.5)) {
      if (inOffEndZone) return 'TOUCHBACK';
      if (inOwnEndZone) return 'SAFETY';
      return 'FUMBLE_DEAD';
    }
    return null;
  }

  if (st.kind === 'inAir') {
    if (st.t >= st.flightTime && st.passKind !== 'LATERAL') return 'INCOMPLETE';
    if (Math.abs(b.x) > FIELD_HALF_WIDTH + 2) return 'INCOMPLETE';
    return null;
  }

  // A forward pass that was dropped or batted down kills the ball outright.
  if (st.kind === 'dead' && w.playPhase === 'LIVE') return 'INCOMPLETE';

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

/**
 * Between-play animation step, for every match phase that does not run `stepPlay`.
 *
 * Those phases used to leave the world completely untouched, which had two visible costs.
 * `prevX` stayed stale while the renderer kept sweeping `alpha` from 0 to 1 every frame, so
 * the entire field sawtoothed between two positions at any refresh rate above 60 Hz — about a
 * fifth of a yard at 144 Hz, invisible at exactly 60. And nobody moved at all, so a touchdown
 * was celebrated by fourteen statues.
 *
 * Deliberately narrow: no contact, no ball authority, no rules, no RNG. Bodies coast to a stop,
 * anyone on the turf gets up, and the scoring side celebrates.
 *
 * Two details worth stating precisely, because "presentation only" is easy to claim and easy to
 * get wrong. Move and stun timers DO advance — that is what makes a tackled athlete stand up
 * between plays, and it is presentation. Turbo does NOT: it is a gameplay resource, and twelve
 * seconds of play-call at 26 a second would silently hand everyone three full meters. It is
 * saved and restored around the locomotion call rather than left to the fact that `setupPlay`
 * happens to reset it, so a future change to turbo carry-over cannot quietly break this.
 */
/**
 * Nobody crosses the line of scrimmage before the snap.
 *
 * Pre-snap motion is a real part of the game — shifting a receiver, walking the quarterback to
 * a better angle — and it ran with full unrestricted locomotion, which meant a human could
 * simply jog the ball twenty yards downfield and then snap it. The yardage counted, because
 * gain is measured from the line, and the quarterback arrived past the line already, where the
 * rules correctly refuse to let him throw. One missing constraint produced three separate
 * complaints.
 *
 * The neutral zone is a third of a yard either side, which is enough to keep the two lines from
 * interpenetrating without making legal motion feel sticky.
 */
const NEUTRAL_ZONE = 0.35;

function holdTheLine(w: World): void {
  const dir = dirOf(w.possession);
  for (let i = 0; i < w.athletes.length; i++) {
    const a = w.athletes[i];
    // `own` points from the line toward the athlete's own half of the field.
    const own = a.side === w.possession ? dir : -dir;
    if ((a.z - w.losZ) * own > -NEUTRAL_ZONE) {
      a.z = w.losZ - own * NEUTRAL_ZONE;
      if (a.vz * own > 0) a.vz = 0;
    }
  }
}

export function idleStep(w: World, celebrateSide: TeamSide | null = null): void {
  savePrev(w);
  // The camera's orientation comes from `dirOf(w.possession)`, and possession still holds the
  // side that SNAPPED the ball, which is not the side that scored on a pick-six, a fumble
  // return, a kick return or a safety. Keying the turn to the scoring side pointed 40 % of
  // celebrations away from the camera — the exact defect this is here to fix.
  const faceCamera = dirOf(w.possession) > 0 ? Math.PI : 0;
  for (let i = 0; i < w.athletes.length; i++) {
    const a = w.athletes[i];
    if (celebrateSide !== null) {
      if (a.side === celebrateSide && a.move === 'NORMAL') a.move = 'CELEBRATE';
      if (a.move === 'CELEBRATE') a.facing += angDelta(a.facing, faceCamera) * 0.06;
    } else if (a.move === 'CELEBRATE') {
      a.move = 'NORMAL';
    }
    const turbo = a.turbo, turboLock = a.turboLockTicks, held = a.turboHeld;
    const sp = locomote(w, a, 0, 0, false);
    a.turbo = turbo; a.turboLockTicks = turboLock; a.turboHeld = held;
    tickMoveState(a);
    syncAnim(a, sp);
  }
  if (w.ball.state.kind === 'held') syncHeldBall(w);
}

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

  if (w.playPhase === 'LIVE') tryHandoff(w);

  for (let i = 0; i < w.athletes.length; i++) {
    const a = w.athletes[i];
    const it = w.intents[i];
    if (w.freezeDefense && a.side !== w.possession) { locomote(w, a, 0, 0, false); tickMoveState(a); syncAnim(a, 0); continue; }
    const sp = locomote(w, a, it.moveX, it.moveZ, has(it.held, Action.TURBO));
    tickMoveState(a);
    syncAnim(a, sp);
  }

  if (w.playPhase === 'PRESNAP') holdTheLine(w);

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
