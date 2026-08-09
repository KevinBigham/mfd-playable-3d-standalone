import { describe, expect, it } from 'vitest';
import { makeFootLockState, updateFootLock, type FootLockInput } from '../src/render/footPlant.ts';

const point = { x: 1, y: 0, z: 2 };
function step(state: ReturnType<typeof makeFootLockState>, overrides: Partial<FootLockInput> = {}) {
  return updateFootLock(state, {
    eligible: true, acquire: true, candidate: 0, candidatePoint: point, candidateGrounded: true,
    anyGrounded: true, activeGrounded: true, activePoint: point, activeReach: 0, dt: 1 / 60, ...overrides,
  });
}

describe('hard-cut foot lock state', () => {
  it('requires two grounded frames before acquiring', () => {
    const state = makeFootLockState();
    step(state);
    expect(state.foot).toBe(-1);
    step(state, { candidatePoint: { x: 1.08, y: 0, z: 2.04 } });
    expect(state.foot).toBe(0);
    expect(state.holding).toBe(true);
    expect(state.anchor).toEqual({ x: 1.08, y: 0, z: 2.04 });
  });

  it('may collect grounded history before a hard turn but cannot lock early', () => {
    const state = makeFootLockState();
    step(state, { acquire: false });
    step(state, { acquire: false });
    expect(state.foot).toBe(-1);
    step(state, { acquire: true });
    expect(state.foot).toBe(0);
  });

  it('does not switch feet while the active lock is valid', () => {
    const state = makeFootLockState();
    step(state); step(state);
    step(state, { candidate: 1, candidatePoint: { x: -1, y: 0, z: 3 } });
    expect(state.foot).toBe(0);
    expect(state.anchor).toEqual(point);
  });

  it('hands off only after the old lock is invalid and the next foot was grounded twice', () => {
    const state = makeFootLockState();
    step(state); step(state);
    step(state, { candidate: 1, candidatePoint: { x: -1, y: 0, z: 3 } });
    step(state, { candidate: 1, candidatePoint: { x: -1, y: 0, z: 3 } });
    expect(state.foot).toBe(0);
    step(state, { candidate: 1, candidatePoint: { x: -1, y: 0, z: 3 }, activeReach: 0.27 });
    expect(state.foot).toBe(1);
    expect(state.holding).toBe(true);
    expect(state.anchor).toEqual({ x: -1, y: 0, z: 3 });
  });

  it('releases at the reach bound and fades before another acquisition', () => {
    const state = makeFootLockState();
    step(state); step(state);
    step(state, { activeReach: 0.27 });
    expect(state.holding).toBe(false);
    expect(state.foot).toBe(0);
    for (let i = 0; i < 20; i++) step(state, { eligible: false });
    expect(state.foot).toBe(-1);
    expect(state.weight).toBe(0);
  });

  it('is deterministic for repeated identical input', () => {
    const run = () => {
      const state = makeFootLockState();
      for (let i = 0; i < 12; i++) step(state, i > 7 ? { anyGrounded: false } : {});
      return state;
    };
    expect(run()).toEqual(run());
  });
});
