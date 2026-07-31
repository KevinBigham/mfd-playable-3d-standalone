import type { Athlete } from '../core/types.ts';
import {
  CATCH_RADIUS_BY_KIND, CATCH_HANDS_SCALE, INT_BASE, CONTEST_PENALTY, DROP_PRESSURE,
  OVERDRIVE_CATCH, s,
} from '../core/constants.ts';
import { clamp, clamp01, dist } from '../core/math.ts';
import type { World } from './world.ts';
import { OFF_START, DEF_START } from './world.ts';
import { giveBall, dropLoose, killBall } from './ball.ts';
import { knockDown, startJump } from './movement.ts';

const STAND_REACH = 2.35;
const JUMP_REACH = 3.6;

function reachOf(a: Athlete): number {
  const jumping = a.move === 'JUMP' || a.move === 'HIGH_HURDLE' || a.move === 'HURDLE';
  return (jumping ? JUMP_REACH : STAND_REACH) + a.y + (a.def.build - 0.5) * 0.25;
}

export interface CatchCandidate { a: Athlete; d: number; claim: number }

/**
 * Called every tick while the ball is in the air.
 * Returns true if the ball's flight was resolved (caught, picked, swatted or dropped).
 */
export function resolveAirBall(w: World): boolean {
  const st = w.ball.state;
  if (st.kind !== 'inAir') return false;
  const b = w.ball;

  // Only allow contests once the ball has cleared the thrower a bit.
  if (st.t < 0.055) return false;

  const cands: CatchCandidate[] = [];
  for (const a of w.athletes) {
    if (a.id === st.from && st.t < 0.35) continue;
    if (a.move === 'DOWN' || a.move === 'GETUP' || a.move === 'STUNNED') continue;
    const reach = reachOf(a);
    if (b.y > reach || b.y < 0.25) continue;
    const d = dist(a.x, a.z, b.x, b.z);
    const isTarget = a.id === st.intended;
    const kindR = CATCH_RADIUS_BY_KIND[st.passKind] ?? 1.35;
    const r = kindR
      * (1 + (a.def.ratings.hands - 50) * CATCH_HANDS_SCALE)
      * (isTarget ? 1.32 : 0.92)
      * (a.onFire ? OVERDRIVE_CATCH : 1)
      * (a.move === 'JUMP' ? 1.15 : 1);
    if (d > r) continue;
    const claim = (r - d) + (isTarget ? 0.55 : 0) + (a.def.ratings.awareness - 50) * 0.004;
    cands.push({ a, d, claim });
  }
  if (cands.length === 0) return false;

  cands.sort((p, q) => q.claim - p.claim);
  const winner = cands[0].a;
  const contested = cands.length > 1 && cands[1].d < cands[0].d + 1.4
    && cands[1].a.side !== winner.side;

  const isDefense = winner.side !== w.athletes[st.from].side;
  const diving = winner.move === 'DIVE' || winner.move === 'JUMP';

  if (isDefense) {
    // Defender arrives: intercept, swat, or fail to do either.
    const facingBall = 1;
    const intChance = clamp01(
      INT_BASE
      + (winner.def.ratings.hands - 50) * 0.006
      + (winner.def.ratings.awareness - 50) * 0.005
      + (winner.move === 'JUMP' ? 0.10 : 0)
      - (st.passKind === 'BULLET' ? 0.16 : 0)
      - (contested ? 0.20 : 0),
    ) * facingBall;
    if (w.rng.chance(intChance)) {
      giveBall(w, winner.id);
      w.bus.emit({ type: 'interception', tick: w.tick, by: winner.id });
      w.bus.emit({ type: 'camera.impulse', tick: w.tick, power: 0.7, at: { x: winner.x, y: 1, z: winner.z } });
      w.bus.emit({ type: 'crowd.swell', tick: w.tick, power: 1, side: winner.side });
      return true;
    }
    // Swat: a batted-down forward pass is incomplete, not a live ball.
    w.bus.emit({ type: 'swat', tick: w.tick, by: winner.id });
    if (st.passKind === 'LATERAL') {
      dropLoose(w, winner.id, w.rng.spread(5), 4.5, w.rng.spread(5), false);
    } else {
      killBall(w);
      w.ball.x = b.x; w.ball.y = 0.3; w.ball.z = b.z;
    }
    return true;
  }

  // Receiver catch.
  const pressure = contested ? CONTEST_PENALTY : 0;
  const catchChance = clamp01(
    0.70
    + (winner.def.ratings.hands - 50) * 0.0075
    + (winner.id === st.intended ? 0.12 : -0.06)
    + (winner.onFire ? 0.10 : 0)
    - pressure
    - (st.passKind === 'BULLET' ? 0.06 : 0)
    - (diving ? 0.10 : 0)
    - DROP_PRESSURE * (w.conditions.weather === 'RAIN' || w.conditions.weather === 'SNOW' ? 1 : 0),
  );

  if (w.rng.chance(catchChance)) {
    const yards = (winner.side === 0 ? 1 : -1) * (winner.z - w.losZ);
    giveBall(w, winner.id);
    w.lastCatcher = winner.id;
    w.lastPassAirYards = Math.abs(w.ball.z - st.sz);
    if (st.passKind === 'LATERAL') {
      w.bus.emit({ type: 'lateral', tick: w.tick, from: st.from, to: winner.id });
      return true;
    }
    w.bus.emit({ type: 'catch', tick: w.tick, by: winner.id, contested, diving, yards });
    w.bus.emit({ type: 'crowd.swell', tick: w.tick, power: contested ? 0.9 : 0.5, side: winner.side });
    if (contested) {
      const defender = cands[1].a;
      if (w.rng.chance(0.45)) knockDown(defender, s(0.9));
      w.bus.emit({ type: 'camera.impulse', tick: w.tick, power: 0.5, at: { x: winner.x, y: 1, z: winner.z } });
    }
    return true;
  }

  w.bus.emit({ type: 'drop', tick: w.tick, by: winner.id });
  if (st.passKind === 'LATERAL') {
    dropLoose(w, winner.id, w.rng.spread(3), 3.0, w.rng.spread(3), false);
  } else {
    killBall(w);
    w.ball.x = b.x; w.ball.y = 0.3; w.ball.z = b.z;
  }
  return true;
}

/** Loose-ball recovery: whoever gets a body on it first, with a dive bonus. */
export function resolveLooseBall(w: World): boolean {
  const st = w.ball.state;
  if (st.kind !== 'loose') return false;
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
