import { describe, expect, it } from 'vitest';
import { interceptPoint } from '../src/sim/movement.ts';
import { laneTrafficPenalty, pursuitAngleMiss } from '../src/ai/athleteAI.ts';

describe('native movement intelligence', () => {
  it('solves a bounded future intercept deterministically', () => {
    const a = interceptPoint(0, 0, 10, 0, 10, 4, 0);
    const b = interceptPoint(0, 0, 10, 0, 10, 4, 0);
    expect(a).toEqual(b);
    expect(a.eta).toBeLessThanOrEqual(1.25);
    expect(a.x).toBeGreaterThan(0);
  });

  it('does not project beyond the configured horizon', () => {
    const hit = interceptPoint(0, 0, 1, 0, 0, 40, 0, 0.5);
    expect(hit.eta).toBe(0);
    expect(hit.x).toBe(0);
  });

  it('penalizes a teammate in the immediate carrier path more than an open crease', () => {
    const carrier = { id: 5, side: 0, x: 0, z: 20 } as any;
    const teammate = { id: 1, side: 0, x: 0, z: 22, move: 'NORMAL' } as any;
    expect(laneTrafficPenalty(carrier, [teammate], 0, 1)).toBeGreaterThan(
      laneTrafficPenalty(carrier, [teammate], 1, 0.25),
    );
  });

  it('keeps pursuit error stable inside a decision window', () => {
    const a = pursuitAngleMiss(8, 100, 2, 0.8);
    const b = pursuitAngleMiss(8, 100, 10, 0.8);
    const c = pursuitAngleMiss(8, 100, 20, 0.8);
    expect(a).toBe(b);
    expect(c).not.toBe(a);
  });
});
