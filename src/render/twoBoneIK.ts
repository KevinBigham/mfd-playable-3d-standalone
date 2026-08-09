import * as THREE from 'three';
import { clamp01 } from '../core/math.ts';

export interface TwoBoneIKResult {
  reached: boolean;
  clamped: boolean;
  distance: number;
  error: number;
}

// Shared scratch keeps the hot render path allocation-free. The solver is deliberately synchronous
// and non-reentrant; the renderer invokes it one chain at a time.
const ROOT = new THREE.Vector3();
const MID = new THREE.Vector3();
const TIP = new THREE.Vector3();
const TARGET = new THREE.Vector3();
const DIR = new THREE.Vector3();
const HINT = new THREE.Vector3();
const DESIRED_MID = new THREE.Vector3();
const FROM = new THREE.Vector3();
const TO = new THREE.Vector3();
const FALLBACK = new THREE.Vector3();
const OFFSET = new THREE.Vector3();
const WORLD_Q = new THREE.Quaternion();
const TIP_WORLD_Q = new THREE.Quaternion();
const PARENT_Q = new THREE.Quaternion();
const DELTA_Q = new THREE.Quaternion();
const TARGET_Q = new THREE.Quaternion();

function rotateBoneWorld(bone: THREE.Bone, from: THREE.Vector3, to: THREE.Vector3, weight: number): void {
  if (from.lengthSq() < 1e-12 || to.lengthSq() < 1e-12) return;
  FROM.copy(from).normalize();
  TO.copy(to).normalize();
  DELTA_Q.setFromUnitVectors(FROM, TO);
  bone.getWorldQuaternion(WORLD_Q);
  TARGET_Q.copy(DELTA_Q).multiply(WORLD_Q);
  if (bone.parent) bone.parent.getWorldQuaternion(PARENT_Q).invert();
  else PARENT_Q.identity();
  TARGET_Q.premultiply(PARENT_Q);
  bone.quaternion.slerp(TARGET_Q, weight).normalize();
  bone.updateWorldMatrix(false, true);
}

/**
 * Aim a two-segment bone chain at a world-space target with a stable bend hint.
 *
 * The helper only changes the root and mid rotations. The tip's world orientation is restored after
 * the positional solve, so a planted cleat keeps its authored pitch and a reaching hand does not
 * inherit an arbitrary wrist twist from the elbow correction.
 */
export function solveTwoBoneIK(
  root: THREE.Bone,
  mid: THREE.Bone,
  tip: THREE.Bone,
  targetWorld: THREE.Vector3,
  bendHintWorld: THREE.Vector3,
  weight = 1,
  maxExtension = 0.995,
): TwoBoneIKResult {
  const w = clamp01(weight);
  root.updateWorldMatrix(true, true);
  ROOT.setFromMatrixPosition(root.matrixWorld);
  MID.setFromMatrixPosition(mid.matrixWorld);
  TIP.setFromMatrixPosition(tip.matrixWorld);
  tip.getWorldQuaternion(TIP_WORLD_Q);

  const upper = ROOT.distanceTo(MID);
  const lower = MID.distanceTo(TIP);
  const minDistance = Math.abs(upper - lower) + 1e-5;
  const maxDistance = Math.max(minDistance, (upper + lower) * Math.min(0.9999, Math.max(0.01, maxExtension)));
  DIR.copy(targetWorld).sub(ROOT);
  const requested = DIR.length();
  if (requested < 1e-8 || upper < 1e-8 || lower < 1e-8 || w <= 0) {
    return { reached: requested < 1e-8, clamped: false, distance: requested, error: TIP.distanceTo(targetWorld) };
  }

  const distance = Math.min(maxDistance, Math.max(minDistance, requested));
  const clamped = Math.abs(distance - requested) > 1e-6;
  DIR.multiplyScalar(1 / requested);
  TARGET.copy(ROOT).addScaledVector(DIR, distance);

  // Project the supplied hint onto the plane normal to the target direction. If the caller's hint
  // is collinear, preserve the chain's current bend; the final cross-product fallback is fixed so
  // a perfectly straight rest chain still chooses the same side on every engine.
  OFFSET.copy(bendHintWorld).sub(ROOT);
  HINT.copy(OFFSET).addScaledVector(DIR, -OFFSET.dot(DIR));
  if (HINT.lengthSq() < 1e-10) {
    OFFSET.copy(MID).sub(ROOT);
    HINT.copy(OFFSET).addScaledVector(DIR, -OFFSET.dot(DIR));
  }
  if (HINT.lengthSq() < 1e-10) {
    FALLBACK.set(Math.abs(DIR.y) < 0.9 ? 0 : 1, Math.abs(DIR.y) < 0.9 ? 1 : 0, 0);
    HINT.crossVectors(DIR, FALLBACK);
  }
  HINT.normalize();

  const along = (upper * upper - lower * lower + distance * distance) / (2 * distance);
  const bend = Math.sqrt(Math.max(0, upper * upper - along * along));
  DESIRED_MID.copy(ROOT).addScaledVector(DIR, along).addScaledVector(HINT, bend);

  rotateBoneWorld(root, MID.sub(ROOT), DESIRED_MID.sub(ROOT), w);
  MID.setFromMatrixPosition(mid.matrixWorld);
  TIP.setFromMatrixPosition(tip.matrixWorld);
  rotateBoneWorld(mid, TIP.sub(MID), TARGET.sub(MID), w);

  // Keep the authored wrist/cleat orientation in world space after the parent rotations.
  if (tip.parent) tip.parent.getWorldQuaternion(PARENT_Q).invert();
  else PARENT_Q.identity();
  tip.quaternion.copy(PARENT_Q.multiply(TIP_WORLD_Q)).normalize();
  tip.updateWorldMatrix(false, true);
  TIP.setFromMatrixPosition(tip.matrixWorld);
  const error = TIP.distanceTo(targetWorld);
  return { reached: !clamped && error <= 0.01, clamped, distance, error };
}
