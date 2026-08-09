import { describe, expect, it } from 'vitest';
import { lowestSolePoint, plantedFootSlip } from '../src/render/footSlip.ts';

function foot(x: number, z: number, y = 0): number[] {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
}

describe('planted-foot measurement geometry', () => {
  it('reports zero for a stationary grounded sole and physical speed for translation', () => {
    expect(plantedFootSlip(foot(0, 0), foot(0, 0), 0, 0)).toBeCloseTo(0);
    expect(plantedFootSlip(foot(0, 0), foot(0.02, 0), 0, 0)).toBeCloseTo(1.2);
  });

  it('rejects a foot that is not planted on both samples', () => {
    expect(plantedFootSlip(foot(0, 0), foot(0, 0, 0.2), 0, 0)).toBeNull();
  });

  it('uses the same lowest-sole sample consumed by the renderer anchor', () => {
    const point = lowestSolePoint(foot(3, -4));
    expect(point.x).toBeCloseTo(3);
    expect(point.y).toBeLessThan(0);
    expect(point.z).toBeGreaterThan(-4.2);
    expect(point.z).toBeLessThan(-3.7);
  });
});
