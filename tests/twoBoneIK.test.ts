import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { solveTwoBoneIK } from '../src/render/twoBoneIK.ts';

function chain(): { root: THREE.Bone; mid: THREE.Bone; tip: THREE.Bone } {
  const root = new THREE.Bone();
  const mid = new THREE.Bone();
  const tip = new THREE.Bone();
  root.add(mid); mid.add(tip);
  mid.position.set(0, -1, 0);
  tip.position.set(0, -1, 0);
  root.updateMatrixWorld(true);
  return { root, mid, tip };
}

function tipPosition(tip: THREE.Bone): THREE.Vector3 {
  tip.updateWorldMatrix(true, false);
  return new THREE.Vector3().setFromMatrixPosition(tip.matrixWorld);
}

describe('native two-bone IK', () => {
  it('reaches a reachable target without changing segment lengths', () => {
    const { root, mid, tip } = chain();
    const result = solveTwoBoneIK(root, mid, tip, new THREE.Vector3(0.6, -1.6, 0), new THREE.Vector3(0, -1, 1));
    expect(result.clamped).toBe(false);
    expect(result.error).toBeLessThan(0.01);
    expect(tipPosition(tip).distanceTo(new THREE.Vector3(0.6, -1.6, 0))).toBeLessThan(0.01);
    expect(root.getWorldPosition(new THREE.Vector3()).distanceTo(mid.getWorldPosition(new THREE.Vector3()))).toBeCloseTo(1, 6);
    expect(mid.getWorldPosition(new THREE.Vector3()).distanceTo(tip.getWorldPosition(new THREE.Vector3()))).toBeCloseTo(1, 6);
  });

  it('clamps unreachable targets and never emits NaNs', () => {
    const { root, mid, tip } = chain();
    const result = solveTwoBoneIK(root, mid, tip, new THREE.Vector3(10, 0, 0), new THREE.Vector3(0, -1, 1));
    expect(result.clamped).toBe(true);
    expect(tipPosition(tip).length()).toBeLessThanOrEqual(2.001);
    expect([...tip.quaternion.toArray(), result.error].every(Number.isFinite)).toBe(true);
  });

  it('uses the bend hint consistently and is deterministic', () => {
    const solve = (hintZ: number) => {
      const { root, mid, tip } = chain();
      solveTwoBoneIK(root, mid, tip, new THREE.Vector3(0, -1.5, 0), new THREE.Vector3(0, -0.5, hintZ));
      return { mid: mid.getWorldPosition(new THREE.Vector3()), q: [...root.quaternion.toArray(), ...mid.quaternion.toArray()] };
    };
    const forward = solve(1);
    const repeated = solve(1);
    const backward = solve(-1);
    expect(forward.mid.z).toBeGreaterThan(0);
    expect(backward.mid.z).toBeLessThan(0);
    expect(forward.q).toEqual(repeated.q);
  });

  it('leaves the chain untouched at zero weight', () => {
    const { root, mid, tip } = chain();
    const before = [root.quaternion.clone(), mid.quaternion.clone(), tip.quaternion.clone()];
    solveTwoBoneIK(root, mid, tip, new THREE.Vector3(0.7, -1.4, 0), new THREE.Vector3(0, -1, 1), 0);
    expect(root.quaternion.equals(before[0])).toBe(true);
    expect(mid.quaternion.equals(before[1])).toBe(true);
    expect(tip.quaternion.equals(before[2])).toBe(true);
  });
});
