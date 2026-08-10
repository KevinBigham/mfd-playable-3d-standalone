import type {
  Athlete, DefenderBallTechnique, PassKind, ReceiverCatchTechnique,
} from '../core/types.ts';
import {
  CATCH_RADIUS_BY_KIND, CATCH_HANDS_SCALE, CATCH_TARGET_RADIUS_SCALE,
  CATCH_TARGET_BEHIND_SCALE, CATCH_EXTEND_RADIUS_SCALE, DEFENDER_BEHIND_RADIUS_SCALE,
  INT_BASE, CONTEST_PENALTY, DROP_PRESSURE,
  OVERDRIVE_CATCH, BOBBLE_CONTESTED, BOBBLE_BULLET, BOBBLE_DIVING, BOBBLE_POP, BOBBLE_SCATTER,
  BOBBLE_GRAB, SWAT_TIP_UP, TIP_SELF_PENALTY, s,
  COVER_TIGHT_YD, COVER_BREAKUP_YD, COVER_CATCH_PENALTY, COVER_FLIGHT_FULL_S,
  SCREEN_DIAGNOSE_TICKS, TIP_OFFENSE_TRACK,
  FIELD_HALF_WIDTH, FIXED_DT, SIDELINE_FOOT_HALF_STANCE, SIDELINE_EPSILON,
  CATCH_CONTACT_NORMALIZED, CATCH_CONTACT_ARRIVAL_S,
} from '../core/constants.ts';
import { clamp, clamp01, dist } from '../core/math.ts';
import type { World } from './world.ts';
import { dirOf } from './world.ts';
import { giveBall, dropLoose, killBall, bobbleBall, hasBallAttempt, markBallAttempt } from './ball.ts';
import { knockDown, startJump } from './movement.ts';

const STAND_REACH = 2.35;
const JUMP_REACH = 3.6;

function reachOf(a: Athlete): number {
  const jumping = a.move === 'JUMP' || a.move === 'HIGH_HURDLE' || a.move === 'HURDLE';
  return (jumping ? JUMP_REACH : STAND_REACH) + a.y + (a.def.build - 0.5) * 0.25;
}

export interface BallReach {
  eligible: boolean;
  normalized: number;
  forward: number;
  lateral: number;
  radiusForward: number;
  radiusLateral: number;
}

export interface CatchCandidate {
  a: Athlete;
  d: number;
  claim: number;
  reach: BallReach;
  receiverTechnique: ReceiverCatchTechnique;
  defenderTechnique: DefenderBallTechnique;
}

export function compareCatchCandidates(p: CatchCandidate, q: CatchCandidate): number {
  return (q.claim - p.claim) || (p.a.id - q.a.id);
}

function defaultReceiverTechnique(a: Athlete): ReceiverCatchTechnique {
  if (a.move === 'DIVE') return 'EXTEND';
  if (a.move === 'JUMP' || a.move === 'HURDLE' || a.move === 'HIGH_HURDLE') return 'AGGRESSIVE';
  const t = a.ballPlayUntilTick >= 0 ? a.ballPlayTechnique : 'BALANCED';
  return t === 'RAC' || t === 'POSSESSION' || t === 'AGGRESSIVE' || t === 'EXTEND' ? t : 'BALANCED';
}

function defaultDefenderTechnique(a: Athlete): DefenderBallTechnique {
  const t = a.ballPlayUntilTick >= 0 ? a.ballPlayTechnique : 'AUTO';
  return t === 'PLAY_BALL' || t === 'SWAT' ? t : 'AUTO';
}

/**
 * Actual hands-and-body reach in the athlete's local frame. The old scalar bubble made a ball
 * behind a defender as catchable as one in front; this keeps the receiver's generous lateral
 * window while making body orientation matter.
 */
export function evaluateBallReach(
  a: Athlete, ballX: number, ballY: number, ballZ: number, passKind: PassKind,
  isTarget: boolean, isDefense: boolean, technique: ReceiverCatchTechnique = 'BALANCED',
): BallReach {
  const dx = ballX - a.x, dz = ballZ - a.z;
  const forward = dx * Math.sin(a.facing) + dz * Math.cos(a.facing);
  const lateral = dx * Math.cos(a.facing) - dz * Math.sin(a.facing);
  const base = (CATCH_RADIUS_BY_KIND[passKind] ?? 1.35)
    * (1 + (a.def.ratings.hands - 50) * CATCH_HANDS_SCALE)
    * (a.onFire ? OVERDRIVE_CATCH : 1)
    * (a.move === 'JUMP' ? 1.15 : 1);
  let forwardScale = 0.92;
  let lateralScale = 0.92;
  if (isTarget && !isDefense) {
    forwardScale = technique === 'EXTEND' ? CATCH_EXTEND_RADIUS_SCALE : CATCH_TARGET_RADIUS_SCALE;
    lateralScale = forwardScale;
    if (forward < 0) forwardScale = CATCH_TARGET_BEHIND_SCALE;
  } else if (isDefense && forward < 0) {
    forwardScale = DEFENDER_BEHIND_RADIUS_SCALE;
  }
  const radiusForward = Math.max(0.05, base * forwardScale);
  const radiusLateral = Math.max(0.05, base * lateralScale);
  const normalized = Math.hypot(forward / radiusForward, lateral / radiusLateral);
  const vertical = ballY >= 0.25 && ballY <= reachOf(a);
  return { eligible: vertical && normalized <= 1, normalized, forward, lateral, radiusForward, radiusLateral };
}

export interface DefenderBallGeometry {
  facing: number;
  lateralSeparation: number;
  trail: number;
  inPhase: boolean;
}

export function defenderBallGeometry(
  defender: Athlete, receiver: Athlete | null, ballX: number, ballZ: number,
  pathX: number, pathZ: number,
): DefenderBallGeometry {
  const toX = ballX - defender.x, toZ = ballZ - defender.z;
  const toLen = Math.hypot(toX, toZ);
  const facing = toLen < 1e-6 ? 1
    : clamp((toX * Math.sin(defender.facing) + toZ * Math.cos(defender.facing)) / toLen, -1, 1);
  const pathLen = Math.hypot(pathX, pathZ) || 1;
  const px = pathX / pathLen, pz = pathZ / pathLen;
  let lateralSeparation = 99; let trail = -99;
  if (receiver) {
    const rx = defender.x - receiver.x, rz = defender.z - receiver.z;
    lateralSeparation = Math.abs(rx * pz - rz * px);
    trail = rx * px + rz * pz;
  }
  const inPhase = facing >= 0.25 && lateralSeparation <= 1.25 && trail >= -0.75;
  return { facing, lateralSeparation, trail, inPhase };
}

export function automaticDefenderTechnique(g: DefenderBallGeometry): DefenderBallTechnique {
  return g.inPhase ? 'PLAY_BALL' : 'SWAT';
}

/** One-foot arcade boundary check, using simulation stance rather than renderer bones. */
export function oneFootInBounds(a: Athlete): { legal: boolean; sideline: boolean; projectedX: number } {
  let projectedX = a.x;
  if (a.move === 'JUMP' || a.move === 'DIVE') {
    const remaining = Math.min(0.75, Math.max(0, a.moveTicks) * FIXED_DT);
    projectedX += a.vx * remaining;
  }
  const footOffset = Math.cos(a.facing) * SIDELINE_FOOT_HALF_STANCE;
  const limit = FIELD_HALF_WIDTH + SIDELINE_EPSILON;
  const legal = Math.abs(projectedX - footOffset) <= limit || Math.abs(projectedX + footOffset) <= limit;
  return { legal, sideline: Math.abs(projectedX) >= FIELD_HALF_WIDTH - 0.55, projectedX };
}

/**
 * The deep man on a kick return: whoever on the receiving team lined up furthest from the kicker.
 *
 * Read off alignment rather than a roster flag or a slot index, so it survives any formation and
 * stays a pure function of the world — which the replay harness requires.
 */
export function kickReturner(w: World): Athlete | null {
  const dir = dirOf(w.possession);          // the kicking team kicks this way; deepest is furthest
  let best: Athlete | null = null;
  for (const a of w.athletes) {
    if (a.side === w.possession) continue;
    if (best === null || a.homeZ * dir > best.homeZ * dir) best = a;
  }
  return best;
}

/** How close the returner has to be to a falling kickoff to take it. Generous on purpose. */
const FIELD_RADIUS = 2.4;

/**
 * Fielding a kickoff. The only catch in this file with no dice in it.
 *
 * A kickoff used to have no catch at all: the ball hit the turf, bounced, and `resolveLooseBall`
 * gave it to whoever fell on it. Measured over sixty games that is worth 3.9 yards a return, and
 * one return in six went BACKWARDS. The deep man now sets up in the back of his own end zone, runs
 * up underneath it and catches it moving — and there is nothing a coin flip adds to a man standing
 * alone under a ball with his hands out. What he does with it afterwards is the play.
 *
 * Onside kicks are deliberately excluded: a ball nobody is meant to catch cleanly is the whole
 * point of one, and it keeps its scramble.
 */
export function fieldKickoff(w: World): boolean {
  const st = w.ball.state;
  if (st.kind !== 'kicked' || st.kickKind !== 'KICKOFF') return false;
  const b = w.ball;
  if (b.vy >= 0) return false;                       // still on the way up
  const r = kickReturner(w);
  if (!r || r.move === 'DOWN' || r.move === 'GETUP' || r.move === 'STUNNED') return false;
  if (b.y > reachOf(r)) return false;
  if (dist(r.x, r.z, b.x, b.z) > FIELD_RADIUS) return false;

  giveBall(w, r.id);
  // `recover`, not `catch`, and the distinction is not cosmetic: a `catch` in this game is a
  // COMPLETION — it carries yards past the line of scrimmage, it feeds the Overdrive streak and
  // it is what every probe counts as a reception. Fielding a kick is none of those. `recover` is
  // also exactly what this moment emitted before, when it came out of the loose-ball scramble, so
  // it sounds the same and no counter moves.
  w.bus.emit({ type: 'recover', tick: w.tick, by: r.id, side: r.side });
  return true;
}

/**
 * Called every tick while the ball is in the air.
 * Returns true if the ball's flight was resolved (caught, picked, swatted or dropped).
 */
export function resolveAirBall(w: World): boolean {
  const st = w.ball.state;
  if (st.kind !== 'inAir' || st.t < 0.055) return false;
  const b = w.ball;
  const offenseSide = w.athletes[st.from].side;
  const target = st.intended === null ? null : w.athletes[st.intended];
  const cands: CatchCandidate[] = [];

  for (const a of w.athletes) {
    if (a.id === st.from && st.t < 0.35) continue;
    if (a.move === 'DOWN' || a.move === 'GETUP' || a.move === 'STUNNED') continue;
    const isDefense = a.side !== offenseSide;
    if (isDefense && hasBallAttempt(st, a.id)) continue;
    const isTarget = a.id === st.intended;
    let receiverTechnique = defaultReceiverTechnique(a);
    if (a.ballPlayUntilTick < w.tick && receiverTechnique !== 'AGGRESSIVE' && receiverTechnique !== 'EXTEND') {
      receiverTechnique = 'BALANCED';
    }
    let reach = evaluateBallReach(a, b.x, b.y, b.z, st.passKind, isTarget, isDefense, receiverTechnique);
    if (!reach.eligible) continue;
    const d = dist(a.x, a.z, b.x, b.z);
    const claim = (1 - reach.normalized) + (isTarget ? 0.55 : 0)
      + (a.def.ratings.awareness - 50) * 0.004;
    cands.push({
      a, d, claim, reach, receiverTechnique,
      defenderTechnique: defaultDefenderTechnique(a),
    });
  }
  if (cands.length === 0) return false;
  cands.sort(compareCatchCandidates);

  let receiver: CatchCandidate | null = null;
  let defender: CatchCandidate | null = null;
  for (const c of cands) {
    if (c.a.side === offenseSide) { if (!receiver) receiver = c; }
    else if (!defender) defender = c;
  }
  if (!receiver && !defender) return false;
  const remaining = st.flightTime - st.t;
  let nearbyCoverage = false;
  if (receiver) {
    for (const athlete of w.athletes) {
      if (athlete.side === receiver.a.side || athlete.move === 'DOWN' || athlete.move === 'GETUP') continue;
      if (dist(athlete.x, athlete.z, receiver.a.x, receiver.a.z) <= COVER_BREAKUP_YD) {
        nearbyCoverage = true; break;
      }
    }
  }
  if (!defender && receiver && nearbyCoverage
      && receiver.reach.normalized > CATCH_CONTACT_NORMALIZED
      && remaining > CATCH_CONTACT_ARRIVAL_S) return false;
  const contested = !!receiver && !!defender && Math.abs(receiver.claim - defender.claim) <= 0.75;
  const contact = { x: b.x, y: b.y, z: b.z };
  const primaryRoll = w.rng.next();
  let receiverRoll = primaryRoll;

  // A defender whose hand can physically reach the ball gets one play regardless of the target
  // receiver's route/awareness claim bonus. Geometry and the primary roll decide whether that
  // play succeeds; a miss leaves the same roll's remainder for the receiver.
  if (defender) {
    const d = defender.a;
    const geometry = defenderBallGeometry(d, target, b.x, b.z, st.tx - st.sx, st.tz - st.sz);
    let technique = defender.defenderTechnique;
    if (d.ballPlayUntilTick < w.tick || technique === 'AUTO') technique = automaticDefenderTechnique(geometry);
    const facingQuality = clamp01((geometry.facing + 0.15) / 1.15);
    const reachQuality = clamp01(1 - defender.reach.normalized * 0.55);
    const canPick = technique === 'PLAY_BALL' && geometry.inPhase;
    const intChance = canPick ? clamp01(
      INT_BASE
      + (d.def.ratings.hands - 50) * 0.006
      + (d.def.ratings.awareness - 50) * 0.005
      + (d.move === 'JUMP' ? 0.10 : 0)
      - (st.passKind === 'BULLET' ? 0.16 : 0)
      - (contested ? 0.16 : 0),
    ) * facingQuality * reachQuality : 0;
    const swatRaw = 0.90
      + (d.def.ratings.awareness - 50) * 0.004
      + (technique === 'SWAT' ? 0.18 : 0)
      - (st.passKind === 'BULLET' ? 0.06 : 0)
      - defender.reach.normalized * 0.18;
    // Facing is decisive for possession, but a defender who has physically put a hand inside the
    // ellipse may still bat the ball while trailing or looking through the receiver. SWAT is the
    // deliberate safe technique; a failed PLAY_BALL attempt has less fallback breakup control.
    const swatFacing = (technique === 'SWAT' ? 0.95 : 0.40)
      + facingQuality * (technique === 'SWAT' ? 0.05 : 0.40);
    const swatChance = clamp01(swatRaw) * swatFacing;
    const swatCut = intChance + (1 - intChance) * swatChance;
    markBallAttempt(st, d.id);

    if (primaryRoll < intChance) {
      const boundary = oneFootInBounds(d);
      if (!boundary.legal) {
        w.bus.emit({ type: 'drop', tick: w.tick, by: d.id, at: contact, technique: 'PLAY_BALL',
          sideline: true, reason: 'OUT_OF_BOUNDS' });
        killBall(w);
        w.ball.x = contact.x; w.ball.y = 0.3; w.ball.z = contact.z;
        return true;
      }
      giveBall(w, d.id);
      w.bus.emit({ type: 'interception', tick: w.tick, by: d.id, at: contact, technique: 'PLAY_BALL' });
      w.bus.emit({ type: 'camera.impulse', tick: w.tick, power: 0.7, at: { x: d.x, y: 1, z: d.z } });
      w.bus.emit({ type: 'crowd.swell', tick: w.tick, power: 1, side: d.side });
      return true;
    }
    if (primaryRoll < swatCut) {
      w.bus.emit({ type: 'swat', tick: w.tick, by: d.id, at: contact, technique });
      if (st.passKind === 'LATERAL') {
        dropLoose(w, d.id, w.rng.spread(5), 4.5, w.rng.spread(5), false);
      } else if (((primaryRoll * 65536) % 1) < SWAT_TIP_UP) {
        w.bus.emit({ type: 'bobble', tick: w.tick, by: d.id, contested });
        bobbleBall(w, d.id, w.rng.spread(BOBBLE_SCATTER * 1.4), BOBBLE_POP + w.rng.range(0, 1.8), w.rng.spread(BOBBLE_SCATTER * 1.4));
      } else {
        killBall(w);
        w.ball.x = contact.x; w.ball.y = 0.3; w.ball.z = contact.z;
      }
      return true;
    }
    // Conditional remainder of the same primary roll; no second gameplay die is drawn.
    receiverRoll = swatCut < 0.999 ? clamp01((primaryRoll - swatCut) / (1 - swatCut)) : 1;
    if (!receiver) return false;
  }

  if (!receiver) return false;
  const winner = receiver.a;
  const technique = receiver.receiverTechnique === 'BALANCED'
    ? contextualReceiverTechnique(w, receiver, contested) : receiver.receiverTechnique;
  const boundary = oneFootInBounds(winner);
  if (!boundary.legal) {
    w.bus.emit({ type: 'drop', tick: w.tick, by: winner.id, at: contact, technique,
      sideline: true, reason: 'OUT_OF_BOUNDS' });
    killBall(w);
    w.ball.x = contact.x; w.ball.y = 0.3; w.ball.z = contact.z;
    return true;
  }

  let defDist = 99;
  for (const d of w.athletes) {
    if (d.side === winner.side || d.move === 'DOWN' || d.move === 'GETUP' || d.move === 'STUNNED') continue;
    defDist = Math.min(defDist, dist(d.x, d.z, winner.x, winner.z));
  }
  const flightScale = clamp01(st.flightTime / COVER_FLIGHT_FULL_S);
  const coverage = contested ? 0 : clamp01((COVER_TIGHT_YD - defDist) / COVER_TIGHT_YD) * flightScale;
  const pressure = contested ? CONTEST_PENALTY : coverage * COVER_CATCH_PENALTY;
  const highOrContested = b.y > 2.25 || contested;
  const screenBonus = w.offensePlay?.tags.includes('SCREEN') ? 0.45 : 0;
  const compressedTechniqueBonus = w.offensePlay?.tags.includes('QUICK')
    && Math.abs((winner.side === 0 ? 100 : 0) - w.losZ) <= 12
    && (technique === 'POSSESSION' || technique === 'AGGRESSIVE') ? 0.08 : 0;
  const techniqueBonus = technique === 'POSSESSION' ? (boundary.sideline || contested ? 0.10 : 0.02)
    : technique === 'AGGRESSIVE' ? (highOrContested ? 0.10 : -0.08)
      : technique === 'EXTEND' ? -0.16 : 0;
  const diving = technique === 'EXTEND' || winner.move === 'DIVE';
  const extensionPenalty = receiver.reach.normalized > 0.78 ? (receiver.reach.normalized - 0.78) * 0.35 : 0;
  const catchChance = clamp01(
    0.45
    + (winner.def.ratings.hands - 50) * 0.0075
    + (winner.id === st.intended ? 0.12 : -0.06)
    + (winner.onFire ? 0.10 : 0)
    + screenBonus
    + compressedTechniqueBonus
    + techniqueBonus
    - extensionPenalty
    - pressure
    - (st.passKind === 'BULLET' ? 0.06 : 0)
    - (diving ? 0.06 : 0)
    - DROP_PRESSURE * (w.conditions.weather === 'RAIN' || w.conditions.weather === 'SNOW' ? 1 : 0),
  );

  if (receiverRoll < catchChance) {
    const yards = (winner.side === 0 ? 1 : -1) * (winner.z - w.losZ);
    const from = st.from; const sz = st.sz; const passKind = st.passKind;
    giveBall(w, winner.id);
    if (technique === 'POSSESSION') { winner.vx *= 0.75; winner.vz *= 0.75; }
    w.lastCatcher = winner.id;
    w.lastPassAirYards = Math.abs(contact.z - sz);
    if (passKind === 'LATERAL') {
      w.bus.emit({ type: 'lateral', tick: w.tick, from, to: winner.id });
      return true;
    }
    w.bus.emit({ type: 'catch', tick: w.tick, by: winner.id, contested, diving, yards,
      at: contact, technique, sideline: boundary.sideline });
    w.bus.emit({ type: 'crowd.swell', tick: w.tick, power: contested ? 0.9 : 0.5, side: winner.side });
    const dir = winner.side === 0 ? 1 : -1;
    if ((winner.z - w.losZ) * dir < -0.5) {
      for (const d of w.athletes) {
        if (d.side === winner.side || d.move === 'DOWN') continue;
        d.reactionQueue = Math.max(d.reactionQueue, SCREEN_DIAGNOSE_TICKS);
      }
    }
    if (contested && defender) {
      // Reuse the contest roll: ball-skill resolution owns exactly one gameplay draw. The
      // fractional lane is deterministic and cannot perturb the simulation RNG stream.
      if (((primaryRoll * 4096) % 1) < 0.45) knockDown(defender.a, s(0.9));
      w.bus.emit({ type: 'camera.impulse', tick: w.tick, power: 0.5, at: { x: winner.x, y: 1, z: winner.z } });
    }
    return true;
  }

  const failRoll = catchChance < 0.999 ? clamp01((receiverRoll - catchChance) / (1 - catchChance)) : 1;
  if (st.passKind !== 'LATERAL') {
    const bobbleChance = clamp01((contested ? BOBBLE_CONTESTED : 0)
      + (st.passKind === 'BULLET' ? BOBBLE_BULLET : 0)
      + (diving ? BOBBLE_DIVING : 0));
    if (failRoll < bobbleChance) {
      w.bus.emit({ type: 'bobble', tick: w.tick, by: winner.id, contested });
      w.bus.emit({ type: 'crowd.swell', tick: w.tick, power: 0.55, side: winner.side });
      bobbleBall(w, winner.id, w.rng.spread(BOBBLE_SCATTER), BOBBLE_POP + w.rng.range(0, 1.4), w.rng.spread(BOBBLE_SCATTER));
      return true;
    }
  }

  // Eligibility at maximum extension means the athlete can attempt the play, not that the ball
  // necessarily touched a hand. Keep the drop census honest: failures near the body are drops;
  // failures on the outer reach ellipse continue as untouched incompletions.
  const touched = receiver.reach.normalized <= 0.72;
  if (touched) w.bus.emit({ type: 'drop', tick: w.tick, by: winner.id, at: contact, technique,
    sideline: boundary.sideline, reason: 'HANDS' });
  if (st.passKind === 'LATERAL') dropLoose(w, winner.id, w.rng.spread(3), 3.0, w.rng.spread(3), false);
  else {
    killBall(w);
    w.ball.x = contact.x; w.ball.y = 0.3; w.ball.z = contact.z;
  }
  return true;
}

function contextualReceiverTechnique(w: World, c: CatchCandidate, contested: boolean): ReceiverCatchTechnique {
  const b = w.ball;
  if (c.reach.normalized > 0.88 && c.reach.forward >= -0.05) return 'EXTEND';
  if (b.y > 2.25 || contested) return 'AGGRESSIVE';
  if (Math.abs(c.a.x) >= FIELD_HALF_WIDTH - 1) return 'POSSESSION';
  return 'RAC';
}

/** Loose-ball recovery: whoever gets a body on it first, with a dive bonus. */
export function resolveLooseBall(w: World): boolean {
  const st = w.ball.state;
  if (st.kind !== 'loose') return false;
  // A tipped pass is contested IN THE AIR, by reach and by hands, not by falling on it. It gets
  // its own resolution and it gets it immediately — waiting four ticks would let the ball fall
  // past the shoulders of everybody standing under it.
  if (st.tipped) return resolveTippedBall(w);
  if (st.ticks < 4) return false;
  const b = w.ball;
  if (b.y > 1.6) return false;

  let best: Athlete | null = null; let bestScore = -1;
  for (const a of w.athletes) {
    if (a.move === 'DOWN' || a.move === 'GETUP') continue;
    const d = dist(a.x, a.z, b.x, b.z);
    const r = a.move === 'DIVE' ? 1.85 : 1.15;
    if (d > r) continue;
    const score = (r - d) + (a.move === 'DIVE' ? 0.5 : 0) + (a.def.ratings.awareness - 50) * 0.004
      + w.rng.range(0, 0.45);
    if (score > bestScore) { bestScore = score; best = a; }
  }
  if (!best) return false;
  giveBall(w, best.id);
  w.bus.emit({ type: 'recover', tick: w.tick, by: best.id, side: best.side });
  return true;
}

/**
 * The second contest, on a ball that is already loose in the air off a tip.
 *
 * The rules here are deliberately not the rules of the first contest. Nobody is the intended
 * receiver of a ball that is spinning off somebody's fingertips, so there is no target bonus and
 * no separate defensive branch: the man who reaches it grabs it, and if that man is on defence the
 * event is an interception. Grabbing is harder than a clean catch — the ball is tumbling — which
 * is what keeps a tip from being a free turnover.
 */
function resolveTippedBall(w: World): boolean {
  const st = w.ball.state;
  if (st.kind !== 'loose' || !st.tipped) return false;
  const b = w.ball;
  if (b.y < 0.3) return false;                 // on the deck: the down is over, not a scramble

  let best: Athlete | null = null; let bestReach: BallReach | null = null; let bestClaim = -Infinity;
  for (const a of w.athletes) {
    if (a.move === 'DOWN' || a.move === 'GETUP' || a.move === 'STUNNED') continue;
    if (hasBallAttempt(st, a.id)) continue;
    const isDefense = a.side !== w.possession;
    // The target relationship is gone after a tip, but a defender still has to see the current
    // ball. This deliberately uses no future endpoint and grants no in-phase shortcut.
    if (isDefense && defenderBallGeometry(a, null, b.x, b.z, b.vx, b.vz).facing < 0.25) continue;
    const technique = !isDefense && a.move === 'DIVE' ? 'EXTEND' : 'BALANCED';
    const reach = evaluateBallReach(a, b.x, b.y, b.z, 'NORMAL', false, isDefense, technique);
    if (!reach.eligible) continue;
    const claim = (1 - reach.normalized) + (a.def.ratings.awareness - 50) * 0.004
      // The man who caused the tip is the WORST placed to recover it, and he is also the one
      // standing closest, which is why the first version of this handed the defence a tipped
      // interception on two thirds of them. He swung through the ball; his hands are past it and
      // his momentum is going the wrong way. Anyone else in the area is better placed than he is.
      + (a.id === st.lastTouch ? -TIP_SELF_PENALTY : 0)
      // The offense knows where this ball was supposed to be — they are tracking it, the defense
      // is reacting to it. Keeps a bobble a chaotic highlight instead of a 62% takeaway.
      + (a.side === w.possession ? TIP_OFFENSE_TRACK : 0);
    if (claim > bestClaim || (claim === bestClaim && best !== null && a.id < best.id)) {
      bestClaim = claim; best = a; bestReach = reach;
    }
  }
  if (!best || !bestReach) return false;

  const boundary = oneFootInBounds(best);
  if (!boundary.legal) {
    markBallAttempt(st, best.id);
    const contact = { x: b.x, y: b.y, z: b.z };
    w.bus.emit({ type: 'drop', tick: w.tick, by: best.id,
      at: contact,
      technique: best.side === w.possession ? 'BALANCED' : 'PLAY_BALL',
      sideline: true, reason: 'OUT_OF_BOUNDS' });
    killBall(w);
    w.ball.x = contact.x; w.ball.y = 0.3; w.ball.z = contact.z;
    return true;
  }

  const grab = clamp01(
    BOBBLE_GRAB + (best.def.ratings.hands - 50) * 0.006 + (best.onFire ? 0.1 : 0)
    - (best.id === st.lastTouch ? TIP_SELF_PENALTY : 0) - bestReach.normalized * 0.12,
  );
  markBallAttempt(st, best.id);
  if (w.rng.next() >= grab) return false;       // a hand on it and still no ball: it stays live

  const stolen = best.side !== w.possession;
  const contact = { x: b.x, y: b.y, z: b.z };
  giveBall(w, best.id);
  w.lastCatcher = best.id;
  if (stolen) {
    w.bus.emit({ type: 'interception', tick: w.tick, by: best.id, at: contact, technique: 'PLAY_BALL' });
    w.bus.emit({ type: 'crowd.swell', tick: w.tick, power: 1, side: best.side });
  } else {
    const yards = (best.side === 0 ? 1 : -1) * (best.z - w.losZ);
    w.bus.emit({ type: 'catch', tick: w.tick, by: best.id, contested: true,
      diving: best.move === 'DIVE', yards, at: contact,
      technique: best.move === 'DIVE' ? 'EXTEND' : 'AGGRESSIVE', sideline: boundary.sideline });
    w.bus.emit({ type: 'crowd.swell', tick: w.tick, power: 0.95, side: best.side });
  }
  w.bus.emit({ type: 'camera.impulse', tick: w.tick, power: 0.8, at: { x: best.x, y: 1.4, z: best.z } });
  return true;
}

/** AI/defender ball-tracking helper: where will the ball be in `t` seconds? */
export function ballLead(w: World, t: number, out: { x: number; z: number }): void {
  const st = w.ball.state;
  const b = w.ball;
  if (st.kind === 'inAir') {
    const u = clamp01((st.t + t) / st.flightTime);
    out.x = st.sx + (st.tx - st.sx) * u;
    out.z = st.sz + (st.tz - st.sz) * u;
  } else {
    out.x = b.x + b.vx * t;
    out.z = b.z + b.vz * t;
  }
}

/**
 * Where the pass will actually come down. Receivers and defenders must run HERE,
 * not to where the ball currently is, or nobody ever arrives in time.
 */
export function ballArrival(w: World, out: { x: number; z: number; eta: number }): boolean {
  const st = w.ball.state;
  if (st.kind === 'inAir') {
    out.x = st.tx; out.z = st.tz; out.eta = Math.max(0, st.flightTime - st.t);
    return true;
  }
  if (st.kind === 'kicked' || st.kind === 'loose') {
    // Simple ballistic landing estimate.
    const b = w.ball;
    const vy = b.vy;
    const t = Math.max(0, (vy + Math.sqrt(Math.max(0, vy * vy + 64 * Math.max(0, b.y - 0.4)))) / 32);
    out.x = b.x + b.vx * t; out.z = b.z + b.vz * t; out.eta = t;
    return true;
  }
  return false;
}

export { startJump, clamp };
