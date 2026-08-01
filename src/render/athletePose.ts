import * as THREE from 'three';
import type { AnimState } from '../core/types.ts';
import { BONE_NAMES, SHOE, type AthleteRig } from './athleteRig.ts';
import { clamp, clamp01, lerp, TAU } from '../core/math.ts';

export interface AnimSample {
  state: AnimState;
  phase: number;     // 0..1
  speed01: number;
  /** Extra forward lean, radians. */
  lean: number;
  /** Overdrive 0..1 for aura. */
  fire: number;
  /** Seconds since the state began, for one-shot poses. */
  t: number;
  /**
   * Yards the athlete covers in one full stride cycle, taken from the cadence the simulation is
   * actually using. The run cycle needs it to keep a planted foot travelling backwards at
   * exactly the speed the body travels forwards — that is the whole difference between running
   * and skating.
   */
  stride: number;
}

/*
 * ── sign conventions, stated once, because getting them wrong is invisible in code ──
 *
 * Every rotation below is about X. A bone's child hangs at local −Y for a limb and +Y for the
 * spine, and a positive X rotation turns local −Y toward −Z. So the same positive number means
 * opposite things on a leg and on a back:
 *
 *   limbs (thigh, knee, foot, shoulder, elbow):  POSITIVE swings the limb BACKWARD
 *   spine (hips→chest→neck→head):                POSITIVE leans the torso FORWARD
 *
 * In pose terms:
 *   bodyLean > 0   torso forward          thigh < 0   knee lifted in front
 *   knee     > 0   heel folds up behind   foot  > 0   toes pointed down
 *   shoulder < 0   hand swung forward     elbow < 0   elbow flexed (the only way one bends)
 *   shoulder/thigh Z: the RIGHT limb swings away from the body with POSITIVE z, the left with
 *   negative.
 *
 * Every one of those was inverted here before this pass. The knees hyperextended, the lean tipped
 * everyone backwards — a dive was a man falling on his back — and both arms crossed inward
 * through the chest. It read as "awkward" rather than as any single obvious fault, which is
 * exactly how a whole-file sign error looks.
 *
 * The poses are written in WORLD angles (relative to the athlete's own upright facing) and the
 * helpers subtract the parent's pitch, so a lean can be changed without re-tuning every limb.
 */

const E = new THREE.Euler();
const READ = new THREE.Euler();

function set(b: THREE.Bone, x: number, y: number, z: number): void {
  E.set(x, y, z); b.quaternion.setFromEuler(E);
}

type Bones = AthleteRig['bones'];

/** Place one leg from world angles. `toe` is the foot's world pitch, positive = toes down. */
function poseLeg(
  b: Bones, right: boolean, hipsX: number,
  thighW: number, knee: number, toe: number, splay = 0,
): void {
  set(right ? b.thighR : b.thighL, thighW - hipsX, 0, right ? splay : -splay);
  set(right ? b.kneeR : b.kneeL, knee, 0, 0);
  set(right ? b.footR : b.footL, toe - thighW - knee, 0, 0);
}

/** Place one arm from world angles. `upper`/`fore` are the pitches of the two segments. */
function poseArm(
  b: Bones, right: boolean, chestX: number,
  upper: number, fore: number, out = 0.14, yaw = 0,
): void {
  set(right ? b.shoulderR : b.shoulderL, upper - chestX, yaw, right ? out : -out);
  set(right ? b.elbowR : b.elbowL, fore - upper, 0, 0);
}

/*
 * Where the shoe touches down, and how the ankle has to sit to put it there.
 *
 * `PSI_*` is the foot's world pitch at the two ends of a stance — a shade of heel-first at the
 * strike, up on the toe at push-off — and `CREF` is the point along the sole that carries the
 * weight. That point is FIXED, at the ball of the foot, and it is worth saying why: a version
 * that rolled the reference from heel to toe through the stance looked right in stills and
 * measured 4.7 yd/s of slip, because a flat sole cannot roll. Migrating the reference along the
 * sole scrubs the shoe against the turf at exactly the migration rate. One fixed point is
 * stationary by construction; the price is the heel sinking about 3cm at the strike and the toe
 * about 5cm at push-off, which on a cleat reads as digging in.
 */
const PSI_STRIKE = -0.10, PSI_PUSH = 0.70;
const CREF = SHOE.toe * 0.67;

/** Ankle position relative to a contact point at `cRef` on the sole, with the foot pitched `psi`. */
function shoe(psi: number, cRef: number): { dz: number; dy: number } {
  const c = Math.cos(psi), sn = Math.sin(psi);
  return { dz: SHOE.drop * sn - cRef * c, dy: SHOE.drop * (c - 1) + cRef * sn };
}

/** Lowest the ankle may sit, pitched `psi`, without any part of the sole going under the turf. */
function clearance(psi: number): number {
  const c = Math.cos(psi), sn = Math.sin(psi);
  return SHOE.drop * (c - 1) + Math.max(SHOE.toe * sn, SHOE.heel * sn);
}

/** States that are legitimately off the turf; the foot-planting pass must leave them alone. */
const AIRBORNE: Partial<Record<AnimState, true>> = {
  JUMP: true, DIVE: true, HURDLE: true, TACKLED: true, GETUP: true, CELEBRATE: true,
  RUN: true, SPRINT: true,      // these solve their own pelvis height exactly
};

/**
 * Procedural posing. Fast, allocation-free, readable at arcade speed.
 * Exaggeration is deliberate: big arm swing, deep knee drive, heavy shoulder roll.
 */
export function poseAthlete(rig: AthleteRig, s: AnimSample): void {
  const b = rig.bones;
  const p = s.phase;
  const sp = clamp01(s.speed01);
  let bodyLean = s.lean;
  let hipY = 0;
  let hipRoll = 0;
  // Hip yaw has to be accumulated rather than written to the bone: the final block below
  // rebuilds the hip quaternion from lean and roll, which silently threw away the rotation the
  // throw case set — the quarterback's hip drive never actually rendered.
  let hipYaw = 0;

  // Skeleton measurements read from the rig, not assumed. Athletes differ in height by 10%, and
  // a run cycle that plants the feet has to know how long the legs actually are.
  const thighLen = -b.kneeR.position.y;
  const shinLen = -b.footR.position.y;
  const legL = thighLen + shinLen;
  const hipOff = b.thighR.position.y;               // hip joint below the hips bone (negative)
  if (b.hips.userData.baseY === undefined) b.hips.userData.baseY = b.hips.position.y;
  const baseY = b.hips.userData.baseY as number;

  // defaults
  set(b.hips, 0, 0, 0);
  set(b.chest, 0, 0, 0);
  set(b.neck, 0, 0, 0);
  set(b.head, 0, 0, 0);

  switch (s.state) {
    case 'RUN':
    case 'SPRINT': {
      // The cycle is solved rather than swept. Each foot is given a target path — flat on the
      // turf through stance, an arc through swing — and a two-link solve turns that into thigh
      // and knee angles. Contact time is chosen so the planted foot slides backwards at exactly
      // the speed the body moves forwards, so the feet grip instead of skating.
      //
      // Phase 0 is the right foot striking the ground.
      const drive = clamp01(sp / 0.72);

      // Pelvis height as a fraction of leg length: lower and more driving at speed.
      const k0 = lerp(0.925, 0.865, drive);
      const kb = lerp(0.016, 0.030, drive);

      // How far in front of and behind the hip the CONTACT POINT can be and still be reachable.
      // The two are not symmetric, and the asymmetry is most of the stride: at push-off the
      // athlete is up on his toes, which lifts the ankle and rolls the contact forward along the
      // sole, buying a much longer reach behind him than in front. Ignoring it cost about a third
      // of the stride — small mincing steps under a body sliding forward, which is a good part of
      // what "running looks awkward" looked like.
      const kHi = k0 + kb;
      const pivotHi = legL * kHi;
      const reach = legL * 0.99;
      const at0 = shoe(PSI_STRIKE, CREF);
      const at1 = shoe(PSI_PUSH, CREF);
      const frontMax = Math.max(0.05,
        Math.sqrt(Math.max(0.01, reach * reach - pivotHi * pivotHi)) - at0.dz);
      const backMax = Math.max(0.05, Math.sqrt(Math.max(0.01,
        reach * reach - (pivotHi - at1.dy) * (pivotHi - at1.dy))) + at1.dz);
      const span = (frontMax + backMax) * 0.92;     // leave a little flex at both ends
      const stride = Math.max(0.6, s.stride);
      // Contact length is capped by that reach; the duty factor follows from it. Clamping duty
      // rather than contact keeps the no-slide property in both directions: a very long stride
      // just gets a shorter contact, never a sliding one.
      const duty = clamp(span / stride, 0.20, 0.52);
      const contact = duty * stride;
      const front = contact * (frontMax / (frontMax + backMax));
      const back = contact - front;
      const lift = legL * lerp(0.18, 0.42, drive);

      // The pelvis is lowest at the middle of each stance and highest in the float between them.
      const bob = -Math.cos(2 * TAU * (p - duty * 0.5));
      const kNow = k0 + kb * bob;
      hipY = legL * (kNow - 1);
      const pivot = legL * kNow;                    // hip joint above the standing ankle line

      const lean = lerp(0.14, 0.42, drive) + s.lean;
      bodyLean = lean * 0.30;                       // the pelvis tips a little…
      const spine = lean;                           // …the ribcage carries the rest
      hipRoll = Math.sin(TAU * p) * 0.05;
      hipYaw = Math.sin(TAU * p) * 0.12;

      for (let i = 0; i < 2; i++) {
        const right = i === 0;
        const u = right ? p : (p + 0.5) % 1;
        let az: number, ay: number, toe: number;
        if (u < duty) {
          // Stance. What is held still is the patch of sole touching the turf, not the ankle:
          // the shoe rolls heel-to-toe underneath, so the ankle has to rise and drift to keep
          // that patch planted. Driving the ankle directly instead is what made the feet skate —
          // the ankle held station while the sole scrubbed a third of a yard through the ground.
          const t = u / duty;
          toe = lerp(PSI_STRIKE, PSI_PUSH, t * t);
          const off = shoe(toe, CREF);
          az = (front - contact * t) + off.dz;
          ay = off.dy;
        } else {
          // Swing. Heel flicks up behind, knee comes through, shin reaches out for the strike.
          // The arc is floored by whatever it takes to keep the pointed toe out of the turf.
          const v = (u - duty) / (1 - duty);
          az = -back + contact * (1 - Math.cos(Math.PI * v)) * 0.5;
          toe = lerp(PSI_PUSH * 0.8, -0.16, clamp01(v * 2.0));
          ay = Math.max(lift * Math.sin(Math.PI * Math.pow(v, 0.62)), clearance(toe) + 0.015);
        }
        // Two-link solve from the hip to that ankle, in the sagittal plane.
        const dy = ay - pivot;
        const d = clamp(Math.hypot(dy, az), Math.abs(thighLen - shinLen) + 0.04, legL * 0.995);
        const line = Math.atan2(-az, -dy);
        const inner = Math.acos(clamp(
          (thighLen * thighLen + shinLen * shinLen - d * d) / (2 * thighLen * shinLen), -1, 1));
        const alpha = Math.asin(clamp((shinLen * Math.sin(inner)) / d, -1, 1));
        poseLeg(b, right, bodyLean, line - alpha, Math.PI - inner, toe);
        (rig as any).__dbg = (rig as any).__dbg || {};
        (rig as any).__dbg[right ? 'R' : 'L'] = { u, az, ay, toe, duty, contact, front, stride, thighW: line - alpha, knee: Math.PI - inner };
      }

      // Arms oppose the legs: the right arm is furthest back as the right foot strikes.
      const c = Math.cos(TAU * p);
      const amp = lerp(0.32, 0.56, drive);
      const mid = lerp(0.16, 0.26, drive);
      const fold = lerp(-0.88, -1.06, drive);
      poseArm(b, true, spine, mid + c * amp, mid + c * amp + fold + c * 0.20, 0.09);
      poseArm(b, false, spine, mid - c * amp, mid - c * amp + fold - c * 0.20, 0.09);

      set(b.chest, spine - bodyLean, -Math.sin(TAU * p) * 0.16, 0);
      set(b.head, -spine * 0.62, Math.sin(TAU * p) * 0.05, 0);
      break;
    }
    case 'BACKPEDAL': {
      const a = p * TAU;
      const sw = Math.sin(a);
      bodyLean = -0.13 + s.lean * 0.4;              // weight sits back over the heels
      hipY = -legL * 0.11;
      const chestX = 0.22;
      poseLeg(b, true, bodyLean, -0.34 - sw * 0.34, 0.85 + Math.max(0, sw) * 0.35, 0.10, 0.07);
      poseLeg(b, false, bodyLean, -0.34 + sw * 0.34, 0.85 + Math.max(0, -sw) * 0.35, 0.10, 0.07);
      poseArm(b, true, chestX, 0.06 + sw * 0.30, 0.06 + sw * 0.30 - 0.85, 0.16);
      poseArm(b, false, chestX, 0.06 - sw * 0.30, 0.06 - sw * 0.30 - 0.85, 0.16);
      set(b.chest, chestX - bodyLean, 0, 0);
      break;
    }
    case 'IDLE':
    case 'SET': {
      const bob = Math.sin(p * TAU) * 0.022;
      const crouch = s.state === 'SET' ? 0.42 : 0.14;
      bodyLean += crouch * 0.95;
      hipY = bob;                                   // depth comes from the planting pass below
      const chestX = bodyLean + crouch * 0.30;
      poseLeg(b, true, bodyLean, -crouch * 1.30, crouch * 2.10, 0, 0.09);
      poseLeg(b, false, bodyLean, -crouch * 1.30, crouch * 2.10, 0, 0.09);
      const up = -0.08 - crouch * 0.30;
      poseArm(b, true, chestX, up, up - 0.45 - crouch * 1.10, 0.13 + crouch * 0.22);
      poseArm(b, false, chestX, up, up - 0.45 - crouch * 1.10, 0.13 + crouch * 0.22);
      set(b.chest, chestX - bodyLean, 0, 0);
      set(b.head, -chestX * 0.55, 0, 0);
      break;
    }
    case 'THROW': {
      const t = clamp01(s.t / 0.32);
      const wind = Math.sin(clamp01(t * 1.6) * Math.PI);
      bodyLean += 0.12;
      // The near shoulder turns away from the target and then drives through it. Both the chest
      // and the hips rotate; the hip drive is what makes an arm throw read as a body throw.
      const chestY = 0.55 - t * 1.10;
      hipYaw = 0.30 - t * 0.55;
      const chestX = bodyLean + 0.10;
      // Right arm: cocked out, up and back, then whipped forward and across.
      set(b.shoulderR, 0.90 - t * 1.50 - chestX, 0.50 - t * 1.10, 1.30 - t * 0.40 + wind * 0.10);
      set(b.elbowR, -1.50 + t * 1.35, 0, 0);
      poseArm(b, false, chestX, -0.90 + t * 0.90, -2.30 + t * 0.80, 0.50);
      set(b.chest, chestX - bodyLean, chestY, 0);
      poseLeg(b, false, bodyLean, -0.55, 0.45, 0.05, 0.10);
      poseLeg(b, true, bodyLean, 0.35 - t * 0.25, 0.55, 0.40, 0.10);
      break;
    }
    case 'CATCH': {
      bodyLean += 0.16;
      const chestX = bodyLean + 0.10;
      poseArm(b, true, chestX, -1.45, -1.90, 0.12);
      poseArm(b, false, chestX, -1.45, -1.90, 0.12);
      set(b.chest, chestX - bodyLean, 0, 0);
      set(b.head, -chestX * 0.4, 0, 0);
      poseLeg(b, true, bodyLean, -0.30, 0.55, 0.05, 0.08);
      poseLeg(b, false, bodyLean, -0.45, 0.70, 0.05, 0.08);
      break;
    }
    case 'JUMP': {
      const t = clamp01(s.t / 0.6);
      const tuck = Math.sin(t * Math.PI);
      bodyLean += 0.10;
      poseArm(b, true, bodyLean, -2.35, -2.55, 0.30);
      poseArm(b, false, bodyLean, -2.35, -2.55, 0.30);
      poseLeg(b, false, bodyLean, -0.85 * tuck, 1.50 * tuck, 0.30, 0.08);
      poseLeg(b, true, bodyLean, -0.55 * tuck, 1.10 * tuck, 0.30, 0.08);
      break;
    }
    case 'HURDLE': {
      const t = clamp01(s.t / 0.8);
      const k = Math.sin(t * Math.PI);
      bodyLean += 0.28 + 0.42 * k;
      // Lead knee drives up and through; the trail leg folds and tucks behind.
      poseLeg(b, false, bodyLean, -1.30 * k, 0.30 + 0.40 * k, 0.20, 0.22 * k);
      poseLeg(b, true, bodyLean, 0.35 * k, 1.70 * k, 0.50, 0.18 * k);
      poseArm(b, false, bodyLean, 0.90 * k, 0.90 * k - 1.05, 0.34);
      poseArm(b, true, bodyLean, -1.10 * k, -1.10 * k - 0.90, 0.34);
      break;
    }
    case 'DIVE': {
      const t = clamp01(s.t / 0.7);
      bodyLean += lerp(0.55, 1.35, t);              // pitched forward, nearly flat at full stretch
      hipY = -0.22 * t;
      const chestX = bodyLean + 0.12;
      poseArm(b, true, chestX, -1.45, -1.60, 0.18);
      poseArm(b, false, chestX, -1.45, -1.60, 0.18);
      set(b.chest, chestX - bodyLean, 0, 0);
      set(b.head, -bodyLean * 0.55, 0, 0);          // chin up, eyes on the ball
      poseLeg(b, true, bodyLean, 0.55, 0.45, 0.60, 0.10);
      poseLeg(b, false, bodyLean, 0.40, 0.60, 0.60, 0.10);
      break;
    }
    case 'SPIN': {
      const a = p * TAU;
      bodyLean += 0.18;
      const chestX = bodyLean;
      set(b.chest, 0, Math.sin(a) * 0.5, 0);
      poseArm(b, true, chestX, -0.45, -1.55, 0.32);
      poseArm(b, false, chestX, -0.45, -1.55, 0.32);
      poseLeg(b, true, bodyLean, -0.15 - Math.sin(a) * 0.55, 0.75, 0.12, 0.10);
      poseLeg(b, false, bodyLean, -0.15 + Math.sin(a) * 0.55, 0.75, 0.12, 0.10);
      break;
    }
    case 'STIFFARM': {
      const t = clamp01(s.t / 0.4);
      bodyLean += 0.26;
      const chestX = bodyLean;
      set(b.chest, 0, -0.32 * t, 0);                // right shoulder drives forward
      poseArm(b, true, chestX, -0.35 - 1.15 * t, -0.45 - 1.15 * t, 0.24);
      poseArm(b, false, chestX, 0.30, -1.35, 0.20);
      poseLeg(b, false, bodyLean, -0.55, 0.55, 0.10, 0.08);
      poseLeg(b, true, bodyLean, 0.40, 0.80, 0.45, 0.08);
      break;
    }
    case 'TACKLE': {
      const t = clamp01(s.t / 0.45);
      bodyLean += lerp(0.32, 0.85, t);
      const chestX = bodyLean;
      poseArm(b, true, chestX, -0.25 - 1.30 * t, -0.80 - 1.30 * t, 0.26);
      poseArm(b, false, chestX, -0.25 - 1.30 * t, -0.80 - 1.30 * t, 0.26);
      poseLeg(b, false, bodyLean, -0.70 + t * 0.30, 0.55, 0.15, 0.10);
      poseLeg(b, true, bodyLean, 0.45 + t * 0.30, 0.85, 0.55, 0.10);
      break;
    }
    case 'TACKLED': {
      const t = clamp01(s.t / 0.9);
      hipY = -legL * 0.72 * clamp01(t * 2.2);
      bodyLean += lerp(0.4, 1.42, clamp01(t * 1.6));
      hipRoll = Math.sin(t * 7) * 0.25 * (1 - t);
      const chestX = bodyLean;
      poseArm(b, true, chestX, -0.9 - Math.sin(t * 8) * 0.6, -1.5, 0.85);
      poseArm(b, false, chestX, -1.1 + Math.sin(t * 9) * 0.6, -1.7, 0.85);
      poseLeg(b, true, bodyLean, 0.65, 1.25, 0.35, 0.28);
      poseLeg(b, false, bodyLean, 0.85, 0.75, 0.35, -0.20);
      set(b.head, -bodyLean * 0.6, 0.2, 0);
      break;
    }
    case 'GETUP': {
      const t = clamp01(s.t / 0.7);
      hipY = lerp(-legL * 0.68, 0, t);
      bodyLean += lerp(1.25, 0.15, t);
      const chestX = bodyLean;
      poseArm(b, true, chestX, lerp(-1.35, -0.16, t), lerp(-1.80, -0.72, t), 0.26);
      poseArm(b, false, chestX, lerp(-1.35, -0.16, t), lerp(-1.80, -0.72, t), 0.26);
      poseLeg(b, true, bodyLean, lerp(0.70, -0.12, t), lerp(1.30, 0.22, t), lerp(0.5, 0.05, t), 0.10);
      poseLeg(b, false, bodyLean, lerp(0.45, -0.12, t), lerp(1.05, 0.22, t), lerp(0.5, 0.05, t), 0.10);
      break;
    }
    case 'STUMBLE': {
      const a = p * TAU;
      bodyLean += 0.45 + Math.sin(a * 2) * 0.18;
      hipRoll = Math.sin(a * 3) * 0.28;
      const chestX = bodyLean;
      poseArm(b, true, chestX, -1.30, -1.50, 0.72);
      poseArm(b, false, chestX, -1.10, -1.35, 0.62);
      poseLeg(b, true, bodyLean, -0.20 - Math.sin(a) * 0.70, 0.85, 0.15, 0.18);
      poseLeg(b, false, bodyLean, -0.20 + Math.sin(a) * 0.55, 0.70, 0.15, -0.12);
      break;
    }
    case 'BLOCK': {
      const push = 0.5 + Math.sin(p * TAU) * 0.12;
      bodyLean += 0.40;
      const chestX = bodyLean;
      poseArm(b, true, chestX, -1.05, -1.35 + push * 0.35, 0.26);
      poseArm(b, false, chestX, -1.05, -1.35 + push * 0.35, 0.26);
      poseLeg(b, true, bodyLean, -0.35, 0.95, 0.10, 0.16);
      poseLeg(b, false, bodyLean, -0.60, 1.15, 0.10, 0.16);
      break;
    }
    case 'KICK': {
      const t = clamp01(s.t / 0.55);
      const k = Math.sin(clamp01(t * 1.3) * Math.PI);
      bodyLean += 0.10 - 0.22 * k;                  // leans back through the strike
      const chestX = bodyLean;
      poseLeg(b, true, bodyLean, 0.30 - 1.55 * k, 0.70 - 0.62 * k, 0.55, 0.06);
      poseLeg(b, false, bodyLean, -0.18, 0.32, 0.02, 0.06);
      poseArm(b, false, chestX, -0.45 - 0.35 * k, -1.15, 0.58);
      poseArm(b, true, chestX, 0.40 + 0.30 * k, -0.45, 0.48);
      set(b.chest, 0, 0.28 * k, 0);
      break;
    }
    case 'CELEBRATE': {
      const a = p * TAU;
      hipY = Math.abs(Math.sin(a)) * 0.16;
      const chestX = bodyLean;
      poseArm(b, true, chestX, -2.85, -3.05, 0.42 + Math.sin(a) * 0.28);
      poseArm(b, false, chestX, -2.85, -3.05, 0.42 + Math.sin(a) * 0.28);
      set(b.chest, 0.12, Math.sin(a * 0.5) * 0.3, 0);
      poseLeg(b, true, bodyLean, -0.15 - Math.sin(a) * 0.45, 0.60, 0.15, 0.10);
      poseLeg(b, false, bodyLean, -0.15 + Math.sin(a) * 0.45, 0.60, 0.15, 0.10);
      break;
    }
    default: break;
  }

  // ── plant the feet ────────────────────────────────────────────────────────
  //
  // Every standing pose above bends the knees, and a bent knee shortens the leg: posed naively,
  // the athlete hovers with his cleats a hand's width off the turf. Rather than hand-tune a hip
  // height into each case and re-tune it whenever a knee angle changes, measure where the lower
  // ankle actually landed and drop the pelvis onto it. The correction is bounded so a pose that
  // is deliberately off the ground, or already on it, cannot be dragged somewhere strange.
  if (!AIRBORNE[s.state]) {
    const drop = Math.max(
      ankleDrop(b.thighR, b.kneeR, thighLen, shinLen, bodyLean),
      ankleDrop(b.thighL, b.kneeL, thighLen, shinLen, bodyLean),
    );
    const ankle = baseY + hipY + hipOff * Math.cos(bodyLean) - drop;
    hipY += clamp((baseY + hipOff - legL) - ankle, -0.30, 0.12);
  }

  b.hips.position.y = rig.bones.hips.userData.baseY ?? b.hips.position.y;
  if (b.hips.userData.baseY === undefined) b.hips.userData.baseY = b.hips.position.y;
  b.hips.position.y = (b.hips.userData.baseY as number) + hipY;
  E.set(bodyLean, hipYaw, hipRoll);
  b.hips.quaternion.setFromEuler(E);

  if (rig.aura) {
    const m = rig.aura.material as THREE.MeshBasicMaterial;
    const want = s.fire * (0.30 + Math.sin(s.t * 11) * 0.09);
    m.opacity = want;
    rig.aura.visible = want > 0.01;
    const sc = 1 + s.fire * 0.12 + Math.sin(s.t * 8) * 0.03 * s.fire;
    rig.aura.scale.setScalar(sc);
  }
}

/**
 * How far the ankle hangs below the hip joint, given the angles a pose just wrote. Read back off
 * the quaternions rather than threaded through every case: the leg bones only ever carry a pitch
 * and a small splay, so the X term recovers exactly what was set.
 */
function ankleDrop(
  thigh: THREE.Bone, knee: THREE.Bone, thighLen: number, shinLen: number, hipsX: number,
): number {
  READ.setFromQuaternion(thigh.quaternion, 'XYZ');
  const tw = hipsX + READ.x;
  READ.setFromQuaternion(knee.quaternion, 'XYZ');
  return thighLen * Math.cos(tw) + shinLen * Math.cos(tw + READ.x);
}

// ── cross-fading ───────────────────────────────────────────────────────────
//
// Every pose above writes bone rotations absolutely, so changing state used to teleport every
// limb in the same frame. Athletes change state a couple of times a second each, which is a
// constant flicker of snapping arms and legs across fourteen bodies.
//
// Rather than rewrite the poses as additive layers, the renderer snapshots the pose an athlete
// is leaving and eases out of it. The cost is one quaternion array per athlete and seventeen
// slerps per athlete per frame.

export const POSE_FLOATS = BONE_NAMES.length * 4 + 1;
const _q = new THREE.Quaternion();

/** Snapshot the rig's current bone rotations (and hip height) into `out`. */
export function capturePose(rig: AthleteRig, out: Float32Array): void {
  let k = 0;
  for (const n of BONE_NAMES) {
    const q = rig.bones[n].quaternion;
    out[k++] = q.x; out[k++] = q.y; out[k++] = q.z; out[k++] = q.w;
  }
  out[k] = rig.bones.hips.position.y;
}

/** Blend the rig `w` of the way back toward a snapshot. w = 1 is the snapshot exactly. */
export function blendPose(rig: AthleteRig, from: Float32Array, w: number): void {
  if (w <= 0.0005) return;
  let k = 0;
  for (const n of BONE_NAMES) {
    _q.set(from[k], from[k + 1], from[k + 2], from[k + 3]); k += 4;
    rig.bones[n].quaternion.slerp(_q, w);
  }
  rig.bones.hips.position.y = lerp(rig.bones.hips.position.y, from[k], w);
}

/**
 * How long to ease into each state. Impacts are deliberately short — a tackle should still
 * land like a tackle — while locomotion and idle poses get a full blend.
 */
const FADE_DEFAULT = 0.12;
const FADE: Partial<Record<AnimState, number>> = {
  TACKLED: 0.05, DIVE: 0.06, TACKLE: 0.06, THROW: 0.05, STIFFARM: 0.05,
  CATCH: 0.07, JUMP: 0.06, HURDLE: 0.06, SPIN: 0.06, KICK: 0.06, STUMBLE: 0.07,
  GETUP: 0.10, BLOCK: 0.10, BACKPEDAL: 0.12, RUN: 0.13, SPRINT: 0.13,
  IDLE: 0.14, SET: 0.14, CELEBRATE: 0.14,
};
export function fadeTimeFor(state: AnimState): number { return FADE[state] ?? FADE_DEFAULT; }

/**
 * Whether two states are the same pose wearing different amplitudes, in which case there is
 * nothing to cross-fade between and fading is actively harmful.
 *
 * RUN and SPRINT are one continuous solved cycle that differs only by `drive`, and athletes flip
 * between them about once every two seconds. Blending back toward the pose being "left" froze the
 * legs for the fade's 130ms — nearly half a stride at speed — and then snapped them forward to
 * catch up. Measured at the shoe, that alone was several yards a second of skating, on top of
 * looking like a stutter.
 */
export function samePoseFamily(a: AnimState, b: AnimState): boolean {
  const loco = (s: AnimState): boolean => s === 'RUN' || s === 'SPRINT';
  return a === b || (loco(a) && loco(b));
}

export { clamp01, lerp };
