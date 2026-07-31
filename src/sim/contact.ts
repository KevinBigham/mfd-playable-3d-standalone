import type { Athlete } from '../core/types.ts';
import {
  BODY_RADIUS, TACKLE_RADIUS, DIVE_TACKLE_RADIUS, POWER_TACKLE_RADIUS, BLOCK_RADIUS,
  BREAK_TACKLE_BASE, FUMBLE_BASE, FUMBLE_POWER_SCALE, FUMBLE_SPIN_MULT, FUMBLE_WEATHER_MULT,
  BIG_HIT_POWER, SPIN_EVADE, HURDLE_CLEAR_HEIGHT, HIGH_HURDLE_CLEAR, STIFFARM_RANGE,
  STIFFARM_CONE, MOVE_TICKS, OVERDRIVE_BREAK_TACKLE, FIXED_DT, s,
} from '../core/constants.ts';
import { clamp, clamp01, dist, angDelta, heading } from '../core/math.ts';
import type { World } from './world.ts';
import { OFF_START, DEF_START, carrier } from './world.ts';
import { knockDown, stun, isLineman } from './movement.ts';
import { dropLoose } from './ball.ts';

const DOWN_TICKS = s(1.15);

/** Separate overlapping bodies so nobody occupies the same point. */
export function resolveBodyOverlap(w: World): void {
  const list = w.athletes;
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (a.move === 'DOWN') continue;
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      if (b.move === 'DOWN') continue;
      if (Math.abs(a.y - b.y) > 1.1) continue;
      const dx = b.x - a.x, dz = b.z - a.z;
      const d2 = dx * dx + dz * dz;
      const min = BODY_RADIUS * 2;
      if (d2 > min * min || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      const push = (min - d) * 0.5;
      const nx = dx / d, nz = dz / d;
      const aMass = 0.6 + a.def.build * 0.8;
      const bMass = 0.6 + b.def.build * 0.8;
      const total = aMass + bMass;
      a.x -= nx * push * (bMass / total) * 2;
      a.z -= nz * push * (bMass / total) * 2;
      b.x += nx * push * (aMass / total) * 2;
      b.z += nz * push * (aMass / total) * 2;
    }
  }
}

/**
 * Blocking. Offensive linemen engage the nearest unblocked rusher; the rusher may shed.
 * Engagement slows both, creating temporary lanes without being sticky or scripted.
 */
export function updateBlocking(w: World): void {
  for (let i = 0; i < 7; i++) {
    const bl = w.athletes[OFF_START + i];
    if (bl.role !== 'LINE' || bl.hasBall) continue;
    if (bl.move === 'DOWN' || bl.move === 'GETUP') { releaseEngagement(w, bl); continue; }

    let target = bl.engagedWith >= 0 ? w.athletes[bl.engagedWith] : null;
    if (target && (dist(bl.x, bl.z, target.x, target.z) > BLOCK_RADIUS * 2.1 || target.move === 'DOWN')) {
      releaseEngagement(w, bl); target = null;
    }
    if (!target) {
      let best: Athlete | null = null; let bestD = 4.6;
      for (let j = 0; j < 7; j++) {
        const d = w.athletes[DEF_START + j];
        if (d.blockedBy >= 0 && d.blockedBy !== bl.id) continue;
        if (d.move === 'DOWN') continue;
        const dd = dist(bl.x, bl.z, d.x, d.z);
        if (dd < bestD) { bestD = dd; best = d; }
      }
      if (best && bestD < BLOCK_RADIUS * 1.7) {
        bl.engagedWith = best.id; best.blockedBy = bl.id;
        target = best;
        w.bus.emit({ type: 'block.win', tick: w.tick, by: bl.id, on: best.id, pancake: false });
      }
    }

    if (target) {
      // Sustained block: push the rusher backward relative to the blocker's facing.
      const strength = (bl.def.ratings.power - target.def.ratings.power) / 100;
      const push = (0.9 + strength) * 4.4 * FIXED_DT;
      const dx = target.x - bl.x, dz = target.z - bl.z;
      const d = Math.max(0.001, Math.hypot(dx, dz));
      target.x += (dx / d) * push; target.z += (dz / d) * push;
      target.vx *= 0.86; target.vz *= 0.86;

      // Shed attempt.
      const shedChance = clamp01(0.006 + (target.def.ratings.power - bl.def.ratings.power) * 0.00042
        + (target.turboHeld ? 0.004 : 0) + (target.onFire ? 0.006 : 0));
      if (w.rng.chance(shedChance)) {
        releaseEngagement(w, bl);
        stun(bl, s(0.35));
      } else if (w.rng.chance(0.0012 + clamp01(strength) * 0.0035)) {
        // Pancake.
        knockDown(target, s(1.0));
        releaseEngagement(w, bl);
        w.bus.emit({ type: 'block.win', tick: w.tick, by: bl.id, on: target.id, pancake: true });
        w.bus.emit({ type: 'camera.impulse', tick: w.tick, power: 0.35, at: { x: bl.x, y: 1, z: bl.z } });
      }
    }
  }
}

export function releaseEngagement(w: World, blocker: Athlete): void {
  if (blocker.engagedWith >= 0) {
    const t = w.athletes[blocker.engagedWith];
    if (t && t.blockedBy === blocker.id) t.blockedBy = -1;
  }
  blocker.engagedWith = -1;
}

export function clearAllEngagements(w: World): void {
  for (const a of w.athletes) { a.engagedWith = -1; a.blockedBy = -1; }
}

export interface TackleOutcome {
  tackled: boolean;
  broken: boolean;
  fumble: boolean;
  power: number;
}

/**
 * Resolve every defender's contact with the ball carrier this tick.
 * Deterministic; visual ragdoll never feeds back into this.
 */
export function updateTackling(w: World): TackleOutcome {
  const out: TackleOutcome = { tackled: false, broken: false, fumble: false, power: 0 };
  const car = carrier(w);
  if (!car) return out;
  if (car.move === 'DOWN') return out;

  const defStart = car.side === w.athletes[OFF_START].side ? DEF_START : OFF_START;

  for (let i = 0; i < 7; i++) {
    const d = w.athletes[defStart + i];
    if (d.id === car.id) continue;
    if (d.move === 'DOWN' || d.move === 'GETUP' || d.move === 'STUNNED') continue;

    let radius = TACKLE_RADIUS;
    let powerMult = 1;
    if (d.move === 'DIVE_TACKLE') { radius = DIVE_TACKLE_RADIUS; powerMult = 1.25; }
    else if (d.move === 'POWER_TACKLE') { radius = POWER_TACKLE_RADIUS; powerMult = 1.95; }
    else if (d.turboHeld) { powerMult = 1.22; }

    const dd = dist(d.x, d.z, car.x, car.z);
    if (dd > radius + BODY_RADIUS) continue;

    // Hurdles clear low tackle volumes.
    const tackleHeight = d.move === 'DIVE_TACKLE' ? 0.55 : d.move === 'POWER_TACKLE' ? 1.25 : 1.0;
    if (car.y > HURDLE_CLEAR_HEIGHT && tackleHeight <= car.y) {
      if (car.move === 'HIGH_HURDLE' || car.y >= HIGH_HURDLE_CLEAR * 0.5) {
        w.bus.emit({ type: 'move', tick: w.tick, by: car.id, move: car.move === 'HIGH_HURDLE' ? 'HIGH_HURDLE' : 'HURDLE' });
        continue;
      }
      continue;
    }

    // Stiff arm: knock the tackler down if he is in the cone.
    if (car.move === 'STIFFARM') {
      const toD = heading(d.x - car.x, d.z - car.z);
      if (Math.abs(angDelta(car.facing, toD)) < STIFFARM_CONE && dd < STIFFARM_RANGE) {
        knockDown(d, s(1.05));
        w.bus.emit({ type: 'brokenTackle', tick: w.tick, by: car.id, on: d.id });
        w.bus.emit({ type: 'camera.impulse', tick: w.tick, power: 0.45, at: { x: car.x, y: 1, z: car.z } });
        continue;
      }
    }

    // Spin evasion.
    if (car.move === 'SPIN' && w.rng.chance(SPIN_EVADE)) {
      stun(d, s(0.4));
      w.bus.emit({ type: 'brokenTackle', tick: w.tick, by: car.id, on: d.id });
      continue;
    }

    // Contact power: closing speed + power ratings + move multiplier.
    const closing = Math.hypot(d.vx - car.vx, d.vz - car.vz);
    const power = (0.45 + closing / 16) * powerMult * (0.7 + d.def.ratings.power / 140)
      * (d.onFire ? 1.2 : 1);
    out.power = Math.max(out.power, power);

    // Break-tackle roll.
    const breakChance = clamp01(
      BREAK_TACKLE_BASE
      + (car.def.ratings.power - d.def.ratings.power) * 0.0034
      + (car.def.ratings.agility - 50) * 0.0016
      + (car.turboHeld ? 0.06 : 0)
      + (car.onFire ? BREAK_TACKLE_BASE * (OVERDRIVE_BREAK_TACKLE - 1) * 2.2 : 0)
      - (power - 1) * 0.16
      - (d.move === 'POWER_TACKLE' ? 0.16 : 0),
    ) * (isLineman(d) ? 1.15 : 1);

    if (w.rng.chance(breakChance)) {
      out.broken = true;
      stun(d, s(0.5));
      car.vx *= 0.72; car.vz *= 0.72;
      w.bus.emit({ type: 'brokenTackle', tick: w.tick, by: car.id, on: d.id });
      w.bus.emit({ type: 'camera.impulse', tick: w.tick, power: 0.3, at: { x: car.x, y: 1, z: car.z } });
      continue;
    }

    // Fumble roll happens before the tackle registers.
    const fumbleChance = clamp01(
      (FUMBLE_BASE + (power - 1) * FUMBLE_POWER_SCALE)
      * (car.move === 'SPIN' ? FUMBLE_SPIN_MULT : 1)
      * (w.conditions.weather === 'RAIN' || w.conditions.weather === 'SNOW' ? FUMBLE_WEATHER_MULT : 1)
      * (1 - (car.def.ratings.hands - 50) * 0.006)
      * (d.move === 'POWER_TACKLE' ? 2.1 : 1),
    );
    const isBig = power > BIG_HIT_POWER;

    if (w.rng.chance(fumbleChance)) {
      out.fumble = true;
      const ang = w.rng.range(0, Math.PI * 2);
      dropLoose(w, car.id, Math.sin(ang) * w.rng.range(3, 9) + car.vx * 0.4, w.rng.range(4, 8),
        Math.cos(ang) * w.rng.range(3, 9) + car.vz * 0.4, true);
      w.bus.emit({ type: 'fumble', tick: w.tick, by: car.id, forcedBy: d.id });
      w.bus.emit({ type: 'camera.impulse', tick: w.tick, power: 0.8, at: { x: car.x, y: 1, z: car.z } });
    }

    knockDown(car, DOWN_TICKS);
    if (d.move !== 'POWER_TACKLE' && d.move !== 'DIVE_TACKLE') { d.move = 'TACKLING'; d.moveTicks = MOVE_TICKS.TACKLE; }
    // Big hits fling the tackler's momentum into the carrier for the visual.
    car.vx = car.vx * 0.3 + d.vx * 0.35;
    car.vz = car.vz * 0.3 + d.vz * 0.35;
    w.lastHitPower = power;

    w.bus.emit({ type: 'tackle', tick: w.tick, by: d.id, on: car.id, power });
    if (isBig) {
      w.bus.emit({ type: 'bigHit', tick: w.tick, by: d.id, on: car.id, power });
      w.bus.emit({ type: 'camera.impulse', tick: w.tick, power: clamp(power * 0.45, 0.3, 1.1), at: { x: car.x, y: 1, z: car.z } });
    } else {
      w.bus.emit({ type: 'camera.impulse', tick: w.tick, power: 0.22, at: { x: car.x, y: 1, z: car.z } });
    }
    out.tackled = true;
    return out;
  }
  return out;
}

/** Defenders can shove receivers off routes (pass interference is legal here). */
export function applyPush(w: World, pusher: Athlete): boolean {
  let best: Athlete | null = null; let bestD = 2.1;
  const targetStart = pusher.id >= DEF_START ? OFF_START : DEF_START;
  for (let i = 0; i < 7; i++) {
    const t = w.athletes[targetStart + i];
    if (t.move === 'DOWN') continue;
    const toT = heading(t.x - pusher.x, t.z - pusher.z);
    if (Math.abs(angDelta(pusher.facing, toT)) > 1.2) continue;
    const d = dist(pusher.x, pusher.z, t.x, t.z);
    if (d < bestD) { bestD = d; best = t; }
  }
  if (!best) return false;
  const strength = 5.4 + (pusher.def.ratings.power - best.def.ratings.power) * 0.05;
  best.vx += Math.sin(pusher.facing) * strength;
  best.vz += Math.cos(pusher.facing) * strength;
  if (w.rng.chance(0.16 + clamp01((pusher.def.ratings.power - best.def.ratings.power) / 180))) {
    knockDown(best, s(0.85));
  } else {
    stun(best, s(0.28));
  }
  w.bus.emit({ type: 'camera.impulse', tick: w.tick, power: 0.18, at: { x: best.x, y: 1, z: best.z } });
  return true;
}

/** Post-whistle slapstick: cosmetic knockdowns with zero rules consequence. */
export function updatePostPlaySlapstick(w: World, enabled: boolean): void {
  if (!enabled) return;
  for (let i = 0; i < w.athletes.length; i++) {
    const a = w.athletes[i];
    if (a.move === 'DOWN' || a.move === 'GETUP') continue;
    for (let j = i + 1; j < w.athletes.length; j++) {
      const b = w.athletes[j];
      if (a.side === b.side) continue;
      if (b.move === 'DOWN' || b.move === 'GETUP') continue;
      const d = dist(a.x, a.z, b.x, b.z);
      if (d > 1.2) continue;
      const aFast = Math.hypot(a.vx, a.vz), bFast = Math.hypot(b.vx, b.vz);
      if (aFast > bFast + 2.5) { knockDown(b, s(1.1)); w.bus.emit({ type: 'camera.impulse', tick: w.tick, power: 0.3, at: { x: b.x, y: 1, z: b.z } }); }
      else if (bFast > aFast + 2.5) { knockDown(a, s(1.1)); w.bus.emit({ type: 'camera.impulse', tick: w.tick, power: 0.3, at: { x: a.x, y: 1, z: a.z } }); }
    }
  }
}
