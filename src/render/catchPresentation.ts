import * as THREE from 'three';
import { clamp, clamp01, smoothstep } from '../core/math.ts';
import type { BallPlayCue, BallPlayTechnique } from '../core/types.ts';
import type { AthleteRig } from './athleteRig.ts';
import { solveTwoBoneIK } from './twoBoneIK.ts';

export interface Point3 { x: number; y: number; z: number }

export type CatchReachKind = 'LOW' | 'CHEST' | 'HIGH' | 'BEHIND';
export type CatchPresentationMode = 'NONE' | 'ANTICIPATE' | 'CONTACT' | 'SECURE' | 'RELEASE';

export interface CatchPresentationState {
  mode: CatchPresentationMode;
  weight: number;
  secureTime: number;
  hadBall: boolean;
  target: Point3;
  technique: BallPlayTechnique;
  outcome: BallPlayCue['outcome'] | 'NONE';
  sideline: boolean;
}

export interface CatchPresentationInput {
  dt: number;
  hasBall: boolean;
  caught: boolean;
  anticipating: boolean;
  target: Point3;
}

export function makeCatchPresentationState(): CatchPresentationState {
  return {
    mode: 'NONE', weight: 0, secureTime: 0, hadBall: false,
    target: { x: 0, y: 0, z: 0 }, technique: 'BALANCED', outcome: 'NONE', sideline: false,
  };
}

export function resetCatchPresentation(state: CatchPresentationState): void {
  state.mode = 'NONE'; state.weight = 0; state.secureTime = 0; state.hadBall = false;
  state.technique = 'BALANCED'; state.outcome = 'NONE'; state.sideline = false;
  state.target.x = 0; state.target.y = 0; state.target.z = 0;
}

export function stepCatchPresentation(
  state: CatchPresentationState,
  input: CatchPresentationInput,
): CatchPresentationState {
  const dt = Math.max(0, input.dt);
  if (input.caught) {
    state.mode = 'SECURE';
    state.secureTime = 0;
    state.target.x = input.target.x; state.target.y = input.target.y; state.target.z = input.target.z;
  } else if (input.anticipating && !input.hasBall) {
    state.mode = 'ANTICIPATE';
    state.weight += (0.88 - state.weight) * (1 - Math.exp(-6 * dt));
    state.target.x = input.target.x; state.target.y = input.target.y; state.target.z = input.target.z;
  } else if (state.mode === 'SECURE') {
    state.secureTime += dt;
    const envelope = 1 - smoothstep(clamp01((state.secureTime - 0.08) / 0.12));
    state.weight += (envelope - state.weight) * (1 - Math.exp(-6 * dt));
    if (state.secureTime >= 0.20) state.mode = 'RELEASE';
  } else if (state.mode === 'CONTACT') {
    state.secureTime += dt;
    const envelope = smoothstep(clamp01(state.secureTime / 0.035))
      * (1 - smoothstep(clamp01((state.secureTime - 0.07) / 0.05)));
    state.weight += (envelope - state.weight) * (1 - Math.exp(-10 * dt));
    if (state.secureTime >= 0.12) state.mode = 'RELEASE';
  } else {
    state.mode = 'RELEASE';
    state.secureTime += dt;
    // An actor who tracked the ball but never received a contact event (a defender miss, for
    // example) must unwind with the same bounded cadence as the reach. Event-driven drops and
    // swats use the faster CONTACT envelope above and still finish in 0.12 seconds.
    state.weight *= Math.exp(-6 * dt);
    if (state.weight < 0.01 || state.secureTime >= 0.32) {
      state.weight = 0; state.mode = 'NONE';
    }
  }
  state.hadBall = input.hasBall;
  return state;
}

export function beginBallPlayPresentation(
  state: CatchPresentationState, cue: BallPlayCue, localTarget: Point3,
): void {
  state.target.x = localTarget.x; state.target.y = localTarget.y; state.target.z = localTarget.z;
  state.technique = cue.technique;
  state.outcome = cue.outcome;
  state.sideline = cue.sideline;
  state.secureTime = 0;
  state.weight = Math.min(state.weight, 0.88);
  state.mode = cue.outcome === 'CATCH' || cue.outcome === 'INTERCEPTION' ? 'SECURE' : 'CONTACT';
  state.hadBall = cue.outcome === 'CATCH' || cue.outcome === 'INTERCEPTION';
}

export function classifyCatchTarget(local: Point3, athleteHeight: number): CatchReachKind {
  if (local.z < -0.10) return 'BEHIND';
  if (local.y < athleteHeight * 0.52) return 'LOW';
  if (local.y > athleteHeight * 0.82) return 'HIGH';
  return 'CHEST';
}

/** Place the two palms to either side of the ball in athlete-local space. */
export function catchHandTargets(
  ball: Point3,
  athleteHeight: number,
  left: Point3,
  right: Point3,
): void {
  const half = clamp(athleteHeight * 0.045, 0.075, 0.105);
  left.x = ball.x - half; left.y = ball.y; left.z = ball.z;
  right.x = ball.x + half; right.y = ball.y; right.z = ball.z;
}

export function catchBodyAdjustment(kind: CatchReachKind, local: Point3): { pitch: number; yaw: number } {
  if (kind === 'LOW') return { pitch: 0.16, yaw: clamp(local.x * 0.12, -0.10, 0.10) };
  if (kind === 'HIGH') return { pitch: -0.07, yaw: clamp(local.x * 0.10, -0.10, 0.10) };
  if (kind === 'BEHIND') return { pitch: 0.04, yaw: local.x < 0 ? -0.34 : 0.34 };
  return { pitch: 0, yaw: clamp(local.x * 0.08, -0.08, 0.08) };
}

/** Only a secured possession may pull the drawn ball away from its authoritative position. */
export function presentationBallPosition(
  authoritative: Point3,
  contact: Point3,
  tuck: Point3,
  state: CatchPresentationState,
  out: Point3,
): Point3 {
  if (!state.hadBall || state.mode !== 'SECURE') {
    out.x = authoritative.x; out.y = authoritative.y; out.z = authoritative.z;
    return out;
  }
  const k = smoothstep(clamp01(state.secureTime / 0.18));
  out.x = contact.x + (tuck.x - contact.x) * k;
  out.y = contact.y + (tuck.y - contact.y) * k;
  out.z = contact.z + (tuck.z - contact.z) * k;
  return out;
}

export interface CatchReachResult {
  kind: CatchReachKind;
  beforeError: number;
  afterError: number;
  clamped: boolean;
}

const LOCAL_LEFT = new THREE.Vector3();
const LOCAL_RIGHT = new THREE.Vector3();
const WORLD_LEFT = new THREE.Vector3();
const WORLD_RIGHT = new THREE.Vector3();
const HINT_LEFT = new THREE.Vector3();
const HINT_RIGHT = new THREE.Vector3();
const HAND_LEFT = new THREE.Vector3();
const HAND_RIGHT = new THREE.Vector3();
const CHEST_DELTA = new THREE.Quaternion();
const CHEST_EULER = new THREE.Euler();

/** Apply the catch overlay after the authored pose and cross-fade have produced the drawn pose. */
export function applyCatchReach(rig: AthleteRig, state: CatchPresentationState): CatchReachResult {
  const kind = classifyCatchTarget(state.target, rig.height);
  const weight = clamp01(state.weight);
  rig.root.updateWorldMatrix(true, true);
  HAND_LEFT.setFromMatrixPosition(rig.bones.handL.matrixWorld);
  HAND_RIGHT.setFromMatrixPosition(rig.bones.handR.matrixWorld);

  catchHandTargets(state.target, rig.height, LOCAL_LEFT, LOCAL_RIGHT);
  WORLD_LEFT.copy(LOCAL_LEFT); rig.root.localToWorld(WORLD_LEFT);
  WORLD_RIGHT.copy(LOCAL_RIGHT); rig.root.localToWorld(WORLD_RIGHT);
  const singleArm = state.technique === 'SWAT'
    || (state.technique === 'EXTEND' && Math.abs(state.target.x) > rig.height * 0.34)
    ? (state.target.x < 0 ? -1 : 1) : 0;
  const beforeError = singleArm < 0 ? HAND_LEFT.distanceTo(WORLD_LEFT)
    : singleArm > 0 ? HAND_RIGHT.distanceTo(WORLD_RIGHT)
      : (HAND_LEFT.distanceTo(WORLD_LEFT) + HAND_RIGHT.distanceTo(WORLD_RIGHT)) * 0.5;

  const body = catchBodyAdjustment(kind, state.target);
  if (state.technique === 'EXTEND') body.pitch += 0.08;
  if (state.technique === 'POSSESSION') body.yaw *= 1.25;
  CHEST_EULER.set(body.pitch * weight, body.yaw * weight, 0, 'YXZ');
  CHEST_DELTA.setFromEuler(CHEST_EULER);
  rig.bones.chest.quaternion.multiply(CHEST_DELTA).normalize();
  rig.root.updateWorldMatrix(true, true);

  // Hints are points outside the ribcage, so elbows bend away from it instead of folding through it.
  HINT_LEFT.set(-rig.height * 0.34, rig.height * 0.66, 0.04); rig.root.localToWorld(HINT_LEFT);
  HINT_RIGHT.set(rig.height * 0.34, rig.height * 0.66, 0.04); rig.root.localToWorld(HINT_RIGHT);
  const left = solveTwoBoneIK(
    rig.bones.shoulderL, rig.bones.elbowL, rig.bones.handL,
    WORLD_LEFT, HINT_LEFT, singleArm === 1 ? 0 : weight, 0.97,
  );
  const right = solveTwoBoneIK(
    rig.bones.shoulderR, rig.bones.elbowR, rig.bones.handR,
    WORLD_RIGHT, HINT_RIGHT, singleArm === -1 ? 0 : weight, 0.97,
  );
  rig.root.updateWorldMatrix(true, true);
  HAND_LEFT.setFromMatrixPosition(rig.bones.handL.matrixWorld);
  HAND_RIGHT.setFromMatrixPosition(rig.bones.handR.matrixWorld);
  const afterError = singleArm < 0 ? HAND_LEFT.distanceTo(WORLD_LEFT)
    : singleArm > 0 ? HAND_RIGHT.distanceTo(WORLD_RIGHT)
      : (HAND_LEFT.distanceTo(WORLD_LEFT) + HAND_RIGHT.distanceTo(WORLD_RIGHT)) * 0.5;
  return { kind, beforeError, afterError, clamped: left.clamped || right.clamped };
}
