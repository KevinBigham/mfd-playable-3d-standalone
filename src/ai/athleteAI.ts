import type { Athlete, AthleteId, PlayerIntent, TeamSide } from '../core/types.ts';
import { Action } from '../input/actions.ts';
import { clamp, clamp01, dist, heading, angDelta, lerp } from '../core/math.ts';
import { FIELD_HALF_WIDTH, s, TURBO_COST } from '../core/constants.ts';
import type { World } from '../sim/world.ts';
import { OFF_START, DEF_START, dirOf, goalOf, carrier } from '../sim/world.ts';
import { routeSteer } from '../sim/playRunner.ts';
import { baseSpeed, turboSpeed } from '../sim/movement.ts';
import { ballLead, ballArrival } from '../sim/catching.ts';
import type { AiProfile } from './difficulty.ts';

const steer = { x: 0, z: 0, turbo: false };
const leadPt = { x: 0, z: 0 };
const arrival = { x: 0, z: 0, eta: 0 };

export interface AiContext {
  profile: AiProfile;
  /** Applied to pursuit speed only, bounded. */
  catchUp: [number, number];
}

export class AiController {
  constructor(private ctx: AiContext) {}

  produce(w: World, id: AthleteId, out: PlayerIntent): void {
    const a = w.athletes[id];
    out.moveX = 0; out.moveZ = 0; out.held = 0;
    if (w.playPhase === 'SETUP' || w.playPhase === 'PRESNAP') { presnap(w, a, out); return; }
    if (w.playPhase === 'POST') { postPlay(w, a, out); return; }
    if (w.playPhase !== 'LIVE') return;

    // Kick duties are decided BEFORE the offence/defence split, because on a kick play the two
    // words mean nothing useful: the kicking team has possession and is therefore "offence", so
    // eleven — seven — cover men were being handed pass-protection and route-running logic while
    // a kickoff sailed over their heads. Only the man actually holding the ball is exempt; he is
    // either the punter or the returner, and both want the carrier's brain, not a cover man's.
    const kick = w.special === 'KICKOFF' || w.special === 'ONSIDE' || w.special === 'PUNT';
    if (kick && !a.hasBall) {
      const st = w.ball.state;
      // The punting team protects until the ball is gone; a kickoff has nothing to protect.
      const away = st.kind === 'kicked' || st.kind === 'loose' || st.kind === 'dead';
      // Gunners. The two widest men on a punt team do not block anybody — they release on the
      // snap and race the ball. Without them the whole coverage starts a second and a half late,
      // arrives after the catch, and every punt return is a footrace the returner wins.
      const gunner = w.special === 'PUNT' && a.side === w.possession && isGunner(w, a);
      if (w.special !== 'PUNT' || away || gunner) { kickTeamAI(w, a, out, this.ctx); return; }
    }

    const onOffense = a.side === w.possession;
    if (a.hasBall) { carrierAI(w, a, out, this.ctx); return; }
    if (onOffense) { offenseAI(w, a, out, this.ctx); return; }
    defenseAI(w, a, out, this.ctx);
  }
}

/**
 * The two widest men on the punting team. Decided from alignment rather than a roster flag so it
 * survives any formation, and it is a pure function of the world, which the replay harness needs.
 */
function isGunner(w: World, a: Athlete): boolean {
  let wider = 0;
  for (let i = 0; i < w.athletes.length; i++) {
    const o = w.athletes[i];
    if (o.side !== a.side || o.id === a.id) continue;
    const d = Math.abs(o.homeX) - Math.abs(a.homeX);
    if (d > 0.001 || (Math.abs(d) <= 0.001 && o.id < a.id)) wider++;
  }
  return wider < 2;
}

/** Simple steering helper: head toward a world point at the given urgency. */
function driveTo(a: Athlete, tx: number, tz: number, out: PlayerIntent, urgency: number): void {
  const dx = tx - a.x, dz = tz - a.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.2) { out.moveX = 0; out.moveZ = 0; return; }
  out.moveX = (dx / d) * urgency;
  out.moveZ = (dz / d) * urgency;
}

function presnap(w: World, a: Athlete, out: PlayerIntent): void {
  // Hold formation.
  const dx = a.homeX - a.x, dz = a.homeZ - a.z;
  const d = Math.hypot(dx, dz);
  if (d > 0.3) { out.moveX = dx / d * 0.6; out.moveZ = dz / d * 0.6; }
}

function postPlay(w: World, a: Athlete, out: PlayerIntent): void {
  if (!w.lateHits) return;
  const car = w.athletes[w.lastCarrier];
  if (!car || car.side === a.side) return;
  const d = dist(a.x, a.z, car.x, car.z);
  if (d < 9 && w.rng.chance(0.02)) {
    out.moveX = (car.x - a.x) / d; out.moveZ = (car.z - a.z) / d; out.held |= Action.TURBO;
  }
}

// ── offense ────────────────────────────────────────────────────────────────

function offenseAI(w: World, a: Athlete, out: PlayerIntent, ctx: AiContext): void {
  const dir = dirOf(a.side);

  if (a.role === 'LINE') {
    // Protect whoever has the ball: the passer in the pocket, the runner downfield.
    const car = carrier(w);
    const protectee = car && car.side === a.side ? car : w.athletes[w.qbId];
    const runBlocking = !!car && car.id !== w.qbId;
    let threat: Athlete | null = null; let best = 1e9;
    for (let i = 0; i < 7; i++) {
      const d = w.athletes[DEF_START + i];
      if (d.move === 'DOWN') continue;
      if (d.blockedBy >= 0 && d.blockedBy !== a.id) continue;
      const toCarrier = dist(d.x, d.z, protectee.x, protectee.z);
      const toMe = dist(d.x, d.z, a.x, a.z);
      const score = toCarrier * (runBlocking ? 1.0 : 1.25) + toMe * 0.7;
      if (score < best) { best = score; threat = d; }
    }
    if (threat) {
      // Sit on the ball-carrier side of the defender so he has to go through the block.
      const mix = runBlocking ? 0.55 : 0.72;
      driveTo(a, threat.x * mix + protectee.x * (1 - mix), threat.z * mix + protectee.z * (1 - mix), out, 1);
      if (runBlocking) out.held |= Action.TURBO;
    } else {
      driveTo(a, protectee.x, protectee.z + dir * 2.5, out, 0.9);
      if (runBlocking) out.held |= Action.TURBO;
    }
    return;
  }

  // Route running.
  routeSteer(w, a, steer);
  out.moveX = steer.x; out.moveZ = steer.z;
  if (steer.turbo) out.held |= Action.TURBO;

  // Attack a ball in the air that is coming to us.
  const st = w.ball.state;
  if (st.kind === 'inAir' && st.passKind !== 'LATERAL') {
    if (a.reactionQueue > 0) { a.reactionQueue--; }
    else if (ballArrival(w, arrival)) {
      const d = dist(a.x, a.z, arrival.x, arrival.z);
      if (d < 26) {
        out.moveX = (arrival.x - a.x) / Math.max(0.001, d);
        out.moveZ = (arrival.z - a.z) / Math.max(0.001, d);
        out.held |= Action.TURBO;
        if (arrival.eta < 0.34 && d < 3.0) {
          if (w.ball.y > 2.1 && w.rng.chance(0.4)) out.held |= Action.JUMP;
          else if (d > 1.4 && w.rng.chance(0.35 * ctx.profile.catchFocus)) out.held |= Action.DIVE;
        }
      }
    }
  } else if (w.ball.state.kind === 'loose') {
    const b = w.ball;
    const d = dist(a.x, a.z, b.x, b.z);
    if (d < 20) {
      out.moveX = (b.x - a.x) / Math.max(0.001, d);
      out.moveZ = (b.z - a.z) / Math.max(0.001, d);
      out.held |= Action.TURBO;
      if (shouldGoUpForTip(w, a, d)) out.held |= Action.JUMP;
      else if (shouldDiveOnLoose(w, a, d)) out.held |= Action.DIVE;
    }
  } else if (w.passThrown === false && w.playTicks > s(1.4)) {
    // Nobody blocking for a scrambling QB: come back to the ball.
    const qb = w.athletes[w.qbId];
    if (qb.hasBall && (qb.z - w.losZ) * dir < -6) {
      const d = dist(a.x, a.z, qb.x, qb.z);
      if (d > 14) { out.moveX = (qb.x - a.x) / d * 0.6; out.moveZ = (qb.z - a.z) / d * 0.6; }
    }
  }
}

function carrierAI(w: World, a: Athlete, out: PlayerIntent, ctx: AiContext): void {
  const dir = dirOf(a.side);
  // Waiting to hand off: ride the mesh point, do not start reading routes.
  if (a.id === w.qbId && w.handoffTarget >= 0 && !w.handedOff && w.special === null) {
    const back = w.athletes[w.handoffTarget];
    driveTo(a, back.x, back.z, out, 0.55);
    return;
  }
  const isQb = a.id === w.qbId && !w.passThrown && !w.handedOff
    && (a.z - w.losZ) * dir < 1.0 && w.special === null;
  if (isQb) { quarterbackAI(w, a, out, ctx); return; }
  runToDaylight(w, a, out, ctx);
}

function quarterbackAI(w: World, a: Athlete, out: PlayerIntent, ctx: AiContext): void {
  const dir = dirOf(a.side);
  const p = ctx.profile;
  const t = w.playTicks;
  const play = w.offensePlay;
  const dropDepth = play && play.formation.includes('SHOTGUN') ? 2.5 : 5.5;

  // Pressure check.
  let pressure = 99; let pressureX = 0;
  for (let i = 0; i < 7; i++) {
    const d = w.athletes[DEF_START + i];
    if (d.move === 'DOWN') continue;
    const dd = dist(a.x, a.z, d.x, d.z);
    if (dd < pressure) { pressure = dd; pressureX = d.x; }
  }

  // Drop back first — but never behind your own goal line.
  const ownGoal = a.side === 0 ? 0 : 100;
  const rawDrop = w.losZ - dir * dropDepth;
  const targetZ = dir > 0 ? Math.max(rawDrop, ownGoal + 0.6) : Math.min(rawDrop, ownGoal - 0.6);
  const backedUp = (a.z - targetZ) * dir <= 0.4;

  // Evaluate reads once the timing landmark passes.
  const primaryTick = play ? play.timing.primary : s(1.0);
  const secondaryTick = play ? play.timing.secondary : s(1.8);
  const readyTick = Math.max(s(0.35), primaryTick - p.reactionTicks);

  if (t > readyTick) {
    const cand = bestReceiver(w, a, t >= secondaryTick ? 2 : 1, p);
    // Under pressure or late in the down, take what is there.
    const desperation = clamp01((t - secondaryTick) / s(1.4)) * 1.6 + (pressure < 3.4 ? 0.9 : 0);
    // Arcade passing: throw into windows a simulation would call covered.
    const need = 1.05 - p.riskTolerance * 0.9 - desperation;
    if (cand.id >= 0 && cand.open > need) {
      out.held |= Action.ACTION;
      // Choose the matching target button so latency matches a human's.
      const idx = w.passTargets.indexOf(cand.id);
      if (idx === 0) out.held |= Action.TARGET_L;
      else if (idx === 1) out.held |= Action.TARGET_M;
      else if (idx === 2) out.held |= Action.TARGET_R;
      if (cand.deep > 22 && w.rng.chance(0.35)) out.held |= Action.LOB;
      else if (cand.tight && w.rng.chance(0.55)) out.held |= Action.TURBO;
      return;
    }
  }

  // Under real pressure, get rid of it. A quarterback who scrambles into a sack costs the drive
  // three yards and a down; an incompletion costs the down only.
  if (pressure < 3.4 && t > readyTick) {
    const bail = bestReceiver(w, a, 2, p);
    if (bail.id >= 0 && bail.open > -0.6) {
      out.held |= Action.ACTION;
      const idx = w.passTargets.indexOf(bail.id);
      if (idx === 0) out.held |= Action.TARGET_L;
      else if (idx === 1) out.held |= Action.TARGET_M;
      else if (idx === 2) out.held |= Action.TARGET_R;
      return;
    }
  }

  // Sack avoidance / scramble.
  if (pressure < 3.0) {
    const away = a.x - pressureX;
    out.moveX = clamp(away * 0.75, -1, 1);
    out.moveZ = dir * 0.3;
    out.held |= Action.TURBO;
    // Backed up near your own goal, eat nothing: get rid of it rather than take a safety.
    const backedUp = Math.abs((a.side === 0 ? a.z : 100 - a.z)) < 12;
    if ((t > s(2.4) || backedUp) && w.rng.chance(backedUp ? 0.16 : 0.08)) out.held |= Action.ACTION;
    return;
  }

  if (!backedUp) {
    out.moveZ = -dir * 0.9;
    out.moveX = clamp((play ? 0 : 0) - a.x * 0.02, -0.3, 0.3);
    return;
  }

  // Climb / slide in the pocket.
  if (t > s(2.9)) {
    // Nothing there: take off.
    const lane = bestLane(w, a, dir);
    out.moveX = lane.x; out.moveZ = lane.z;
    out.held |= Action.TURBO;
    return;
  }
  out.moveX = clamp(-a.x * 0.03, -0.4, 0.4);
  out.moveZ = 0;
}

interface ReadResult { id: AthleteId; open: number; deep: number; tight: boolean }

function bestReceiver(w: World, qb: Athlete, depth: number, p: AiProfile): ReadResult {
  const dir = dirOf(qb.side);
  const play = w.offensePlay;
  const order = play ? [play.reads[0], play.reads[1]] : [1, 2];
  const res: ReadResult = { id: -1, open: -99, deep: 0, tight: false };
  const consider: AthleteId[] = [];
  for (let i = 0; i < Math.min(depth, order.length); i++) {
    const idx = order[i];
    const ath = w.athletes[OFF_START + idx];
    if (ath && ath.targetButton !== null) consider.push(ath.id);
  }
  for (const id of w.passTargets) if (id >= 0 && !consider.includes(id)) consider.push(id);

  for (const id of consider) {
    const r = w.athletes[id];
    if (!r || r.move === 'DOWN') continue;
    const dz = (r.z - qb.z) * dir;
    if (dz < -8) continue;
    const range = dist(qb.x, qb.z, r.x, r.z);
    if (range > 58) continue;
    let nearest = 99; let inLane = 0;
    for (let i = 0; i < 7; i++) {
      const d = w.athletes[DEF_START + i];
      if (d.move === 'DOWN') continue;
      nearest = Math.min(nearest, dist(r.x, r.z, d.x, d.z));
      // Defender sitting in the throwing lane — only counts once the ball has cleared
      // the rush, otherwise every pass rusher would veto every throw.
      const t = clamp01(((d.x - qb.x) * (r.x - qb.x) + (d.z - qb.z) * (r.z - qb.z)) / Math.max(1, range * range));
      const lx = qb.x + (r.x - qb.x) * t, lz = qb.z + (r.z - qb.z) * t;
      if (dist(d.x, d.z, lx, lz) < 2.0 && t > 0.32 && t < 0.9 && dist(d.x, d.z, qb.x, qb.z) > 5) inLane += 1.3;
    }
    const noise = w.rng.spread(p.decisionNoise * 2.2);
    // Ride the hot hand: a receiver two catches into an Overdrive streak is worth forcing to.
    const hot = id === w.hotReceiver ? 0.55 + w.hotStreak * 0.45 : 0;
    // Push the ball downfield. Weighting openness alone made the quarterback take the shortest
    // available completion every snap, which is correct simulation and terrible arcade football.
    const open = nearest - inLane + noise + hot + clamp(dz, -4, 34) * 0.105;
    if (open > res.open) { res.id = id; res.open = open; res.deep = dz; res.tight = nearest < 3.4; }
  }
  return res;
}

function bestLane(w: World, a: Athlete, dir: number): { x: number; z: number } {
  let bestX = 0, bestZ = dir, bestScore = -1e9;
  for (let k = -4; k <= 4; k++) {
    const ang = (k / 4) * 1.15;
    const hx = Math.sin(ang) * (dir > 0 ? 1 : -1);
    const hz = Math.cos(ang) * dir;
    const px = a.x + hx * 7, pz = a.z + hz * 7;
    if (Math.abs(px) > FIELD_HALF_WIDTH - 1.2) continue;
    let nearest = 40;
    const defStart = a.side === w.athletes[OFF_START].side ? DEF_START : OFF_START;
    for (let i = 0; i < 7; i++) {
      const d = w.athletes[defStart + i];
      if (d.move === 'DOWN') continue;
      nearest = Math.min(nearest, dist(px, pz, d.x, d.z));
    }
    const progress = (pz - a.z) * dir;
    // Forward progress is the point; open space only matters if it is downhill.
    const score = nearest * 1.15 + progress * 2.0 - Math.abs(px) * 0.05
      + (progress < 0 ? progress * 2.5 : 0);
    if (score > bestScore) { bestScore = score; bestX = hx; bestZ = hz; }
  }
  return { x: bestX, z: bestZ };
}

function runToDaylight(w: World, a: Athlete, out: PlayerIntent, ctx: AiContext): void {
  const dir = dirOf(a.side);
  const lane = bestLane(w, a, dir);
  out.moveX = lane.x; out.moveZ = lane.z;
  void 0;
  // Early in a designed run, honour the called hole before improvising.
  if (a.route && a.routeIdx < a.route.length && w.playTicks < s(1.1) && w.handedOff) {
    routeSteer(w, a, steer);
    const m = Math.hypot(steer.x, steer.z);
    if (m > 0.05) {
      out.moveX = out.moveX * 0.4 + steer.x * 0.6;
      out.moveZ = out.moveZ * 0.4 + steer.z * 0.6;
    }
  }
  // Nearest threat → decide on a move.
  const defStart = a.side === w.athletes[OFF_START].side ? DEF_START : OFF_START;
  let near: Athlete | null = null; let nd = 99;
  for (let i = 0; i < 7; i++) {
    const d = w.athletes[defStart + i];
    if (d.move === 'DOWN' || d.move === 'STUNNED') continue;
    const dd = dist(a.x, a.z, d.x, d.z);
    if (dd < nd) { nd = dd; near = d; }
  }

  // Sprint into space, but bank a reserve when contact is imminent — a carrier who has emptied
  // the meter has no spin, no stiff arm and no high hurdle exactly when he needs one.
  const wantsMoveSoon = nd < 6.5;
  if (!wantsMoveSoon || a.turbo > 34) out.held |= Action.TURBO;

  if (!near) return;
  const timing = ctx.profile.moveTiming;
  if (nd < 3.0 && w.rng.chance(0.14 * timing + 0.03)) {
    const bearing = heading(near.x - a.x, near.z - a.z);
    const rel = Math.abs(angDelta(a.facing, bearing));
    if (near.move === 'DIVE_TACKLE') { out.held &= ~Action.TURBO; out.held |= Action.JUMP; }
    else if (rel > 1.1 && a.turbo >= 25) out.held |= Action.TURBO | Action.JUMP;    // high hurdle
    else if (rel < 0.65 && a.turbo >= 15 && w.rng.chance(0.55)) out.held |= Action.TURBO | Action.ACTION; // stiff arm
    else if (a.turbo >= 20) out.held |= Action.SPECIAL;                             // spin
    else { out.held &= ~Action.TURBO; out.held |= Action.JUMP; }                    // free hurdle
  }
  // Dive for the pylon / first down.
  const goal = goalOf(a.side);
  if (Math.abs(goal - a.z) < 2.4 && nd < 3.2) out.held |= Action.DIVE;
}

// ── defense ────────────────────────────────────────────────────────────────

function defenseAI(w: World, a: Athlete, out: PlayerIntent, ctx: AiContext): void {
  const p = ctx.profile;
  const offSide = w.possession;
  const dir = dirOf(offSide);
  const car = carrier(w);
  const st = w.ball.state;

  // Kick coverage / return duties.
  if (w.special === 'KICKOFF' || w.special === 'ONSIDE' || w.special === 'PUNT') {
    kickTeamAI(w, a, out, ctx);
    return;
  }

  // Ball in the air — converge after a believable recognition delay.
  if (st.kind === 'inAir' && st.passKind !== 'LATERAL') {
    if (a.reactionQueue > 0) { a.reactionQueue--; }
    else if (ballArrival(w, arrival)) {
      const d = dist(a.x, a.z, arrival.x, arrival.z);
      if (d < 22) {
        pursue(w, a, arrival.x, arrival.z, out, ctx, 1);
        if (arrival.eta < 0.3 && d < 3.0 && w.rng.chance(0.3 + p.catchFocus * 0.4)) {
          out.held |= Action.JUMP;
        }
        return;
      }
    }
  }

  if (st.kind === 'loose') {
    const b = w.ball;
    const d = dist(a.x, a.z, b.x, b.z);
    if (d < 22) {
      pursue(w, a, b.x, b.z, out, ctx, 1);
      if (shouldGoUpForTip(w, a, d)) out.held |= Action.JUMP;
      else if (shouldDiveOnLoose(w, a, d)) out.held |= Action.DIVE;
      return;
    }
  }

  // Live carrier: pursue, unless still inside the coverage-discipline window.
  if (car && car.side === offSide) {
    // Coverage needs a beat to diagnose a run — that beat is the running lane.
    if (a.reactionQueue > 0 && a.assign?.kind !== 'RUSH' && a.assign?.kind !== 'CONTAIN'
        && a.assign?.kind !== 'SPY' && a.assign?.kind !== 'BLITZ_DELAY') {
      a.reactionQueue--;
    }
    const recognised = a.reactionQueue <= 0;
    const carrierIsRunner = (car.id !== w.qbId || w.handedOff) && recognised;
    const brokeContainment = (car.z - w.losZ) * dir > 1.2 && recognised;
    // A QB who is still in the pocket is the rushers' problem, not the coverage's.
    const scrambleRecognised = car.id === w.qbId && !w.passThrown
      && (brokeContainment || w.playTicks > s(2.6));
    const pursueNow = carrierIsRunner || brokeContainment || w.passThrown || scrambleRecognised
      || a.assign?.kind === 'RUSH' || a.assign?.kind === 'BLITZ_DELAY'
      || a.assign?.kind === 'CONTAIN' || a.assign?.kind === 'SPY';
    if (pursueNow) {
      pursueCarrier(w, a, car, out, ctx);
      return;
    }
  }

  // Coverage.
  const assign = a.assign;
  if (!assign) { holdZone(w, a, a.homeX, a.homeZ, out, ctx); return; }
  switch (assign.kind) {
    case 'RUSH':
    case 'BLITZ_DELAY': {
      const qb = w.athletes[w.qbId];
      const target = car ?? qb;
      if (assign.kind === 'BLITZ_DELAY' && w.playTicks < assign.delay) { holdZone(w, a, a.homeX, a.homeZ, out, ctx); return; }
      const laneX = a.homeX + (assign.kind === 'RUSH' ? assign.lane : assign.lane) * 2.0;
      const stage = w.playTicks < s(0.4) ? 0.5 : 1;
      pursue(w, a, lerp(laneX, target.x, stage), target.z, out, ctx, 1);
      if (dist(a.x, a.z, target.x, target.z) < 2.4 && w.rng.chance(0.05 * p.moveTiming)) out.held |= Action.DIVE;
      break;
    }
    case 'CONTAIN': {
      const qb = car ?? w.athletes[w.qbId];
      const edgeX = clamp(qb.x + assign.side * 6.5, -FIELD_HALF_WIDTH + 3, FIELD_HALF_WIDTH - 3);
      pursue(w, a, edgeX, qb.z + dir * 0.5, out, ctx, 0.92);
      break;
    }
    case 'SPY': {
      const qb = car ?? w.athletes[w.qbId];
      pursue(w, a, qb.x, qb.z + dir * 5.5, out, ctx, 0.85);
      break;
    }
    case 'MAN': {
      // assign.slot is a pass-target index (0 = leftmost eligible), not a roster index.
      const id = w.passTargets[assign.slot] ?? -1;
      const r = id >= 0 ? w.athletes[id] : null;
      if (!r) { holdZone(w, a, a.homeX, a.homeZ, out, ctx); break; }
      const disc = p.coverageDiscipline;
      // Defenders LAG the receiver — that lag is where separation on a break comes from.
      // A defender who tracks the receiver's exact position is uncoverable-by-design.
      // The base lag is what separation on a break is made of; discipline only shrinks it.
      const lag = 0.14 + (1 - disc) * 0.34;
      const cushion = 1.2 + (1 - disc) * 2.4;
      const tx = r.x - r.vx * lag + w.rng.spread((1 - disc) * 1.6);
      const tz = r.z - r.vz * lag + dir * cushion;
      pursue(w, a, tx, tz, out, ctx, 1);
      if (dist(a.x, a.z, r.x, r.z) < 1.5 && w.playTicks < s(1.0) && w.rng.chance(0.02)) {
        out.held |= Action.TURBO | Action.SPECIAL; // jam
      }
      break;
    }
    case 'ZONE': {
      const cx = w.spotX + assign.x * dir;
      const cz = w.losZ + assign.z * dir;
      // Drive on the most dangerous receiver in the zone.
      let threat: Athlete | null = null; let bestD = assign.r;
      for (let i = 0; i < 7; i++) {
        const r = w.athletes[OFF_START + i];
        if (r.targetButton === null) continue;
        const d = dist(r.x, r.z, cx, cz);
        if (d < bestD) { bestD = d; threat = r; }
      }
      if (threat) {
        // Zone defenders drive on the threat but stay anchored to the landmark until
        // the ball is actually in the air.
        const drive = w.ball.state.kind === 'inAir' ? 0.95 : p.coverageDiscipline * 0.6;
        pursue(w, a, lerp(cx, threat.x, drive), lerp(cz, threat.z + dir * 1.4, drive), out, ctx, 1);
      } else {
        holdZone(w, a, cx, cz, out, ctx);
      }
      break;
    }
    default: holdZone(w, a, a.homeX, a.homeZ, out, ctx);
  }
}

function pursueCarrier(w: World, a: Athlete, car: Athlete, out: PlayerIntent, ctx: AiContext): void {
  const p = ctx.profile;
  const mySpeed = turboSpeed(a) * ctx.catchUp[a.side];
  // Iterate an intercept point.
  let t = dist(a.x, a.z, car.x, car.z) / Math.max(1, mySpeed);
  for (let i = 0; i < 2; i++) {
    const px = car.x + car.vx * t, pz = car.z + car.vz * t;
    t = dist(a.x, a.z, px, pz) / Math.max(1, mySpeed);
  }
  const err = p.pursuitAngleError;
  const tx = car.x + car.vx * t + w.rng.spread(err * 3.2);
  const tz = car.z + car.vz * t + w.rng.spread(err * 3.2);
  pursue(w, a, tx, tz, out, ctx, 1);

  const d = dist(a.x, a.z, car.x, car.z);
  if (d < 2.9) {
    const roll = w.rng.next();
    if (a.turbo > 40 && roll < 0.10 * p.moveTiming) out.held |= Action.TURBO | Action.SPECIAL; // power tackle
    else if (roll < 0.22 * p.moveTiming) out.held |= Action.DIVE;
  }
}

function pursue(w: World, a: Athlete, tx: number, tz: number, out: PlayerIntent, ctx: AiContext, urgency: number): void {
  const dx = tx - a.x, dz = tz - a.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.25) { out.moveX = 0; out.moveZ = 0; return; }
  out.moveX = (dx / d) * urgency;
  out.moveZ = (dz / d) * urgency;
  // Defenders do not hold turbo the whole play. They burn it to close, and they keep a reserve
  // for the tackle attempt — otherwise seven pursuers all sprinting erase every yard after
  // catch and the game stops being explosive.
  const closing = d > 2.4 && d < 22;
  const reserve = d < 9 ? 8 : 30;
  if (closing && a.turbo > reserve) out.held |= Action.TURBO;
}

function holdZone(w: World, a: Athlete, cx: number, cz: number, out: PlayerIntent, ctx: AiContext): void {
  const d = dist(a.x, a.z, cx, cz);
  if (d > 1.4) pursue(w, a, cx, cz, out, ctx, clamp01(d / 6));
}

/**
 * Blocking a kick return.
 *
 * Every blocker used to aim at the same point three yards beside the returner and six ahead of
 * him, which put all six of them in one scrum around the man they were supposed to be freeing.
 * Instead each takes a COVER MAN — the cheapest one to reach that is still a threat — and gets
 * between him and the returner.
 *
 * They spread without talking to each other: the cost of a target includes how far it is from the
 * blocker's own alignment, and the return formation lines them up across the field, so the man on
 * the left naturally takes the left-hand coverage. No assignment table, no shared state, and it
 * stays deterministic, which the replay harness requires.
 */
function returnBlockAI(w: World, a: Athlete, car: Athlete, out: PlayerIntent, ctx: AiContext): void {
  const dir = dirOf(a.side);
  let target: Athlete | null = null;
  let bestCost = Infinity;
  for (let i = 0; i < w.athletes.length; i++) {
    const d = w.athletes[i];
    if (d.side === a.side || d.move === 'DOWN') continue;
    const ahead = (d.z - car.z) * dir;
    if (ahead < -4 || ahead > 34) continue;        // already beaten, or not yet relevant
    const cost = dist(a.x, a.z, d.x, d.z)
      + Math.abs(d.x - car.x) * 0.45               // prefer men in the returner's path
      + Math.abs(d.x - a.homeX) * 0.60;            // and men on my own side of the field
    if (cost < bestCost) { bestCost = cost; target = d; }
  }
  if (target === null) {
    // Nobody left to block: get out in front and lead him up the field.
    pursue(w, a, car.x, car.z + dir * 12, out, ctx, 1);
    return;
  }
  // Take a position a quarter of the way from the cover man toward the returner: goal side of
  // him, which is the side that actually obstructs.
  pursue(w, a, target.x + (car.x - target.x) * 0.25, target.z + (car.z - target.z) * 0.25,
    out, ctx, 1);
  if (a.turbo > 12) out.held |= Action.TURBO;
}

/**
 * A ball tumbling in the air off a tip is not a fumble on the turf, and diving at it is exactly
 * wrong — you go under it and land on your face. You go UP. This says when.
 */
function shouldGoUpForTip(w: World, a: Athlete, d: number): boolean {
  const st = w.ball.state;
  if (st.kind !== 'loose' || !st.tipped) return false;
  // Only worth the commitment when the ball is genuinely overhead and genuinely close: a jump
  // freezes him for the better part of a second and the ball is only up for about that long.
  return d < 2.6 && w.ball.y > 2.0 && w.ball.vy > -6;
}

/**
 * Whether to leave your feet for a loose ball.
 *
 * A dive buys certainty and pays for it with the entire rest of the play: it is a committed move
 * that ends with the diver on the ground, wherever he lands. That is the right trade when someone
 * else can reach the ball too, and a terrible one when nobody can — the kick returner used to
 * dive on every kickoff he fielded and tackle himself with the nearest cover man twenty-five
 * yards away and running the other direction. Uncontested, you pick it up and go.
 */
function shouldDiveOnLoose(w: World, a: Athlete, d: number): boolean {
  if (d > 2.2 || w.ball.y > 1.1) return false;
  const b = w.ball;
  for (let i = 0; i < w.athletes.length; i++) {
    const o = w.athletes[i];
    if (o.id === a.id || o.side === a.side || o.move === 'DOWN') continue;
    if (dist(o.x, o.z, b.x, b.z) < d + 3.0) return true;
  }
  return false;
}

function kickTeamAI(w: World, a: Athlete, out: PlayerIntent, ctx: AiContext): void {
  const b = w.ball;
  const st = b.state;
  const car = carrier(w);
  const receiving = a.side !== w.possession ? a.side : null;

  if (car) {
    if (car.side === a.side) {
      returnBlockAI(w, a, car, out, ctx);
    } else {
      pursueCarrier(w, a, car, out, ctx);
    }
    return;
  }

  if (st.kind === 'kicked' || st.kind === 'loose') {
    const d = dist(a.x, a.z, b.x, b.z);
    // The two deepest returners chase; everyone else forms up.
    if (receiving !== null && d < 30) {
      pursue(w, a, b.x + b.vx * 0.3, b.z + b.vz * 0.3, out, ctx, 1);
      if (st.kind === 'loose' && shouldDiveOnLoose(w, a, d)) out.held |= Action.DIVE;
      return;
    }
    if (receiving === null) {
      // Coverage, running the ball down. They sprint the WHOLE way: `pursue` only spends turbo
      // inside twenty-two yards, which is a sensible rule for a defender shadowing a play and a
      // disastrous one on a kickoff, where the ball lands sixty yards away. They were jogging the
      // first half of every kick and arriving thirty yards late.
      // Lane discipline. Six men converging on one point is exactly what a return wall is built
      // to beat — block the first two and the other four are already behind the play. Each cover
      // man instead runs a share of the field's width, blended toward the ball as he closes, and
      // only abandons his lane inside fourteen yards. Spread coverage cannot be walled off; it
      // has to be beaten one man at a time.
      const lane = clamp(a.homeX * 1.25, -FIELD_HALF_WIDTH + 3, FIELD_HALF_WIDTH - 3);
      const close = clamp01((30 - d) / 16);
      pursue(w, a, lane + (b.x - lane) * close, b.z, out, ctx, 1);
      // Sprint down, but keep something back. Draining to empty on the way meant coverage
      // arrived two yards from the returner and then watched him run away from them: the ball
      // carrier gets a small speed bonus by design, and a gassed cover man cannot answer it.
      if (a.turbo > 28) out.held |= Action.TURBO;
      return;
    }
    pursue(w, a, a.homeX, a.homeZ, out, ctx, 0.6);
    return;
  }
  pursue(w, a, a.homeX, a.homeZ, out, ctx, 0.5);
}

export { clamp, baseSpeed, TURBO_COST };
