import * as THREE from 'three';
import type { AnimState } from '../core/types.ts';
import type { AthleteRig } from './athleteRig.ts';
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
}

const E = new THREE.Euler();

function set(b: THREE.Bone, x: number, y: number, z: number): void {
  E.set(x, y, z); b.quaternion.setFromEuler(E);
}

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

  // defaults
  set(b.hips, 0, 0, 0);
  set(b.chest, 0, 0, 0);
  set(b.neck, 0, 0, 0);
  set(b.head, 0, 0, 0);

  switch (s.state) {
    case 'RUN':
    case 'SPRINT': {
      const fast = s.state === 'SPRINT';
      const amp = fast ? 1.15 : 0.82;
      const a = p * TAU;
      const swing = Math.sin(a);
      const swing2 = Math.sin(a + Math.PI);
      bodyLean += fast ? 0.34 : 0.20;
      hipY = Math.abs(Math.sin(a * 2)) * 0.055 * (fast ? 1.3 : 1);
      hipRoll = swing * 0.10;
      set(b.thighL, swing * amp * 0.95 - 0.12, 0, 0);
      set(b.kneeL, -clamp(swing2 * amp * 1.15 + 0.35, 0.05, 2.0), 0, 0);
      set(b.thighR, swing2 * amp * 0.95 - 0.12, 0, 0);
      set(b.kneeR, -clamp(swing * amp * 1.15 + 0.35, 0.05, 2.0), 0, 0);
      set(b.footL, 0.25 - swing * 0.3, 0, 0);
      set(b.footR, 0.25 - swing2 * 0.3, 0, 0);
      set(b.shoulderL, swing2 * amp * 1.05, 0, 0.22);
      set(b.shoulderR, swing * amp * 1.05, 0, -0.22);
      set(b.elbowL, -1.05 - Math.max(0, swing2) * 0.5, 0, 0);
      set(b.elbowR, -1.05 - Math.max(0, swing) * 0.5, 0, 0);
      set(b.chest, -bodyLean * 0.35, swing * 0.14, 0);
      set(b.head, bodyLean * 0.5, -swing * 0.08, 0);
      break;
    }
    case 'BACKPEDAL': {
      const a = p * TAU;
      const swing = Math.sin(a);
      bodyLean -= 0.16;
      set(b.thighL, -swing * 0.5 + 0.28, 0, 0);
      set(b.thighR, swing * 0.5 + 0.28, 0, 0);
      set(b.kneeL, -0.85, 0, 0); set(b.kneeR, -0.85, 0, 0);
      set(b.shoulderL, 0.3, 0, 0.5); set(b.shoulderR, 0.3, 0, -0.5);
      set(b.elbowL, -1.4, 0, 0); set(b.elbowR, -1.4, 0, 0);
      break;
    }
    case 'IDLE':
    case 'SET': {
      const bob = Math.sin(p * TAU) * 0.03;
      const crouch = s.state === 'SET' ? 0.42 : 0.12;
      bodyLean += crouch * 0.6;
      hipY = -crouch * 0.22 + bob;
      set(b.thighL, crouch * 0.9, 0, 0.06); set(b.thighR, crouch * 0.9, 0, -0.06);
      set(b.kneeL, -crouch * 1.5, 0, 0); set(b.kneeR, -crouch * 1.5, 0, 0);
      set(b.shoulderL, -0.18, 0, 0.34); set(b.shoulderR, -0.18, 0, -0.34);
      set(b.elbowL, -0.75 - crouch, 0, 0); set(b.elbowR, -0.75 - crouch, 0, 0);
      break;
    }
    case 'THROW': {
      const t = clamp01(s.t / 0.32);
      const wind = Math.sin(clamp01(t * 1.6) * Math.PI);
      bodyLean += 0.12;
      set(b.shoulderR, -2.5 + t * 3.4, 0.4, -0.65 + wind * 0.4);
      set(b.elbowR, -1.9 + t * 1.7, 0, 0);
      set(b.shoulderL, 0.5 - t * 0.7, 0, 1.0);
      set(b.elbowL, -0.7, 0, 0);
      set(b.chest, 0, -0.55 + t * 1.1, 0);
      set(b.hips, 0, -0.30 + t * 0.55, 0);
      set(b.thighL, 0.35, 0, 0); set(b.kneeL, -0.5, 0, 0);
      set(b.thighR, -0.25, 0, 0); set(b.kneeR, -0.4, 0, 0);
      break;
    }
    case 'CATCH': {
      set(b.shoulderL, -1.85, 0, 0.55); set(b.shoulderR, -1.85, 0, -0.55);
      set(b.elbowL, -0.4, 0, 0); set(b.elbowR, -0.4, 0, 0);
      set(b.chest, -0.25, 0, 0);
      set(b.thighL, 0.4, 0, 0); set(b.thighR, 0.2, 0, 0);
      set(b.kneeL, -0.7, 0, 0); set(b.kneeR, -0.5, 0, 0);
      break;
    }
    case 'JUMP': {
      const t = clamp01(s.t / 0.6);
      const tuck = Math.sin(t * Math.PI);
      set(b.shoulderL, -2.4, 0, 0.35); set(b.shoulderR, -2.4, 0, -0.35);
      set(b.elbowL, -0.25, 0, 0); set(b.elbowR, -0.25, 0, 0);
      set(b.thighL, 0.9 * tuck, 0, 0); set(b.thighR, 0.6 * tuck, 0, 0);
      set(b.kneeL, -1.5 * tuck, 0, 0); set(b.kneeR, -1.1 * tuck, 0, 0);
      break;
    }
    case 'HURDLE': {
      const t = clamp01(s.t / 0.8);
      const k = Math.sin(t * Math.PI);
      bodyLean += 0.35 * k;
      set(b.thighL, -1.35 * k, 0, 0.25 * k);
      set(b.kneeL, -0.25, 0, 0);
      set(b.thighR, 0.95 * k, 0, -0.2 * k);
      set(b.kneeR, -1.85 * k, 0, 0);
      set(b.shoulderL, -1.2 * k, 0, 0.5);
      set(b.shoulderR, 1.0 * k, 0, -0.5);
      set(b.elbowL, -0.6, 0, 0); set(b.elbowR, -0.5, 0, 0);
      break;
    }
    case 'DIVE': {
      const t = clamp01(s.t / 0.7);
      bodyLean += lerp(0.6, 1.45, t);
      hipY = -0.25 * t;
      set(b.shoulderL, -2.6, 0, 0.2); set(b.shoulderR, -2.6, 0, -0.2);
      set(b.elbowL, -0.15, 0, 0); set(b.elbowR, -0.15, 0, 0);
      set(b.thighL, -0.5, 0, 0); set(b.thighR, -0.35, 0, 0);
      set(b.kneeL, -0.3, 0, 0); set(b.kneeR, -0.5, 0, 0);
      break;
    }
    case 'SPIN': {
      const a = p * TAU;
      bodyLean += 0.16;
      set(b.chest, 0, Math.sin(a) * 0.55, 0);
      set(b.shoulderL, -0.7, 0, 1.15); set(b.shoulderR, -0.7, 0, -1.15);
      set(b.elbowL, -1.2, 0, 0); set(b.elbowR, -1.2, 0, 0);
      set(b.thighL, Math.sin(a) * 0.7, 0, 0); set(b.thighR, -Math.sin(a) * 0.7, 0, 0);
      set(b.kneeL, -0.6, 0, 0); set(b.kneeR, -0.6, 0, 0);
      break;
    }
    case 'STIFFARM': {
      const t = clamp01(s.t / 0.4);
      bodyLean += 0.28;
      set(b.shoulderR, -1.55 * t, 0, -0.25);
      set(b.elbowR, -0.1, 0, 0);
      set(b.shoulderL, 0.8, 0, 0.4); set(b.elbowL, -1.5, 0, 0);
      set(b.chest, -0.1, -0.35 * t, 0);
      set(b.thighL, 0.6, 0, 0); set(b.thighR, -0.4, 0, 0);
      set(b.kneeL, -0.9, 0, 0); set(b.kneeR, -0.5, 0, 0);
      break;
    }
    case 'TACKLE': {
      const t = clamp01(s.t / 0.45);
      bodyLean += lerp(0.35, 0.95, t);
      set(b.shoulderL, -2.2 * t, 0, 0.4); set(b.shoulderR, -2.2 * t, 0, -0.4);
      set(b.elbowL, -0.5, 0, 0); set(b.elbowR, -0.5, 0, 0);
      set(b.thighL, 0.5 - t * 0.7, 0, 0); set(b.thighR, 0.2 - t * 0.4, 0, 0);
      set(b.kneeL, -0.7, 0, 0); set(b.kneeR, -0.5, 0, 0);
      break;
    }
    case 'TACKLED': {
      const t = clamp01(s.t / 0.9);
      hipY = -0.62 * clamp01(t * 2.2);
      bodyLean += lerp(0.4, 1.45, clamp01(t * 1.6));
      hipRoll = Math.sin(t * 7) * 0.25 * (1 - t);
      set(b.shoulderL, -1.2 + Math.sin(t * 9) * 0.6, 0, 0.9);
      set(b.shoulderR, -1.0 - Math.sin(t * 8) * 0.6, 0, -0.9);
      set(b.elbowL, -0.9, 0, 0); set(b.elbowR, -0.7, 0, 0);
      set(b.thighL, -0.9, 0, 0.3); set(b.thighR, -0.5, 0, -0.4);
      set(b.kneeL, -0.8, 0, 0); set(b.kneeR, -1.3, 0, 0);
      set(b.head, -0.35, 0, 0.2);
      break;
    }
    case 'GETUP': {
      const t = clamp01(s.t / 0.7);
      hipY = lerp(-0.6, 0, t);
      bodyLean += lerp(1.3, 0.15, t);
      set(b.thighL, lerp(-0.8, 0.1, t), 0, 0); set(b.thighR, lerp(-0.4, 0.05, t), 0, 0);
      set(b.kneeL, lerp(-1.1, -0.15, t), 0, 0); set(b.kneeR, lerp(-1.0, -0.1, t), 0, 0);
      set(b.shoulderL, lerp(-1.4, -0.2, t), 0, 0.4); set(b.shoulderR, lerp(-1.2, -0.2, t), 0, -0.4);
      set(b.elbowL, -0.9, 0, 0); set(b.elbowR, -0.9, 0, 0);
      break;
    }
    case 'STUMBLE': {
      const a = p * TAU;
      bodyLean += 0.5 + Math.sin(a * 2) * 0.2;
      hipRoll = Math.sin(a * 3) * 0.3;
      set(b.shoulderL, -1.6, 0, 1.1); set(b.shoulderR, -1.4, 0, -1.2);
      set(b.elbowL, -0.4, 0, 0); set(b.elbowR, -0.6, 0, 0);
      set(b.thighL, Math.sin(a) * 0.8, 0, 0.2); set(b.thighR, -Math.sin(a) * 0.6, 0, -0.2);
      set(b.kneeL, -0.9, 0, 0); set(b.kneeR, -0.7, 0, 0);
      break;
    }
    case 'BLOCK': {
      const push = 0.5 + Math.sin(p * TAU) * 0.12;
      bodyLean += 0.42;
      hipY = -0.16;
      set(b.shoulderL, -1.35, 0, 0.42); set(b.shoulderR, -1.35, 0, -0.42);
      set(b.elbowL, -0.55 + push * 0.4, 0, 0); set(b.elbowR, -0.55 + push * 0.4, 0, 0);
      set(b.thighL, 0.75, 0, 0.14); set(b.thighR, 0.55, 0, -0.14);
      set(b.kneeL, -1.15, 0, 0); set(b.kneeR, -0.95, 0, 0);
      break;
    }
    case 'KICK': {
      const t = clamp01(s.t / 0.55);
      const k = Math.sin(clamp01(t * 1.3) * Math.PI);
      set(b.thighR, -1.5 * k + 0.3, 0, 0); set(b.kneeR, -0.2, 0, 0);
      set(b.thighL, 0.35, 0, 0); set(b.kneeL, -0.5, 0, 0);
      set(b.shoulderL, -0.6, 0, 1.0); set(b.shoulderR, -0.4, 0, -1.0);
      set(b.chest, -0.25 * k, 0, 0);
      break;
    }
    case 'CELEBRATE': {
      const a = p * TAU;
      hipY = Math.abs(Math.sin(a)) * 0.16;
      set(b.shoulderL, -2.8, 0, 0.5 + Math.sin(a) * 0.3);
      set(b.shoulderR, -2.8, 0, -0.5 - Math.sin(a) * 0.3);
      set(b.elbowL, -0.3, 0, 0); set(b.elbowR, -0.3, 0, 0);
      set(b.chest, -0.2, Math.sin(a * 0.5) * 0.3, 0);
      set(b.thighL, Math.sin(a) * 0.5, 0, 0.1); set(b.thighR, -Math.sin(a) * 0.5, 0, -0.1);
      set(b.kneeL, -0.7, 0, 0); set(b.kneeR, -0.7, 0, 0);
      break;
    }
    default: break;
  }

  b.hips.position.y = rig.bones.hips.userData.baseY ?? b.hips.position.y;
  if (b.hips.userData.baseY === undefined) b.hips.userData.baseY = b.hips.position.y;
  b.hips.position.y = (b.hips.userData.baseY as number) + hipY;
  E.set(-bodyLean, 0, hipRoll);
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

export { clamp01, lerp };
