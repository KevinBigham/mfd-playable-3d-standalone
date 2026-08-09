import { describe, expect, it } from 'vitest';
import {
  catchHandTargets, classifyCatchTarget, makeCatchPresentationState,
  presentationBallPosition, stepCatchPresentation,
} from '../src/render/catchPresentation.ts';

describe('ball-targeted catch presentation', () => {
  it('classifies low, chest, high and behind targets deterministically', () => {
    const classify = (x: number, y: number, z: number) => classifyCatchTarget({ x, y, z }, 2);
    expect(classify(0, 0.8, 0.3)).toBe('LOW');
    expect(classify(0, 1.3, 0.3)).toBe('CHEST');
    expect(classify(0, 1.8, 0.3)).toBe('HIGH');
    expect(classify(0, 1.3, -0.2)).toBe('BEHIND');
    expect(classify(0, 1.3, -0.2)).toBe('BEHIND');
  });

  it('brackets the ball with stable left and right hand targets', () => {
    const left = { x: 0, y: 0, z: 0 }, right = { x: 0, y: 0, z: 0 };
    catchHandTargets({ x: 0.4, y: 1.4, z: 0.2 }, 2, left, right);
    expect(left.x).toBeLessThan(0.4);
    expect(right.x).toBeGreaterThan(0.4);
    expect((left.x + right.x) / 2).toBeCloseTo(0.4);
    expect(left.y).toBe(1.4);
    expect(right.z).toBe(0.2);
  });

  it('anticipates, secures, then releases with repeatable state', () => {
    const run = (secureFrames: number) => {
      const state = makeCatchPresentationState();
      const target = { x: 0.2, y: 1.6, z: 0.4 };
      for (let i = 0; i < 4; i++) stepCatchPresentation(state, { dt: 1 / 60, hasBall: false, caught: false, anticipating: true, target });
      stepCatchPresentation(state, { dt: 1 / 60, hasBall: true, caught: true, anticipating: false, target });
      for (let i = 0; i < secureFrames; i++) stepCatchPresentation(state, { dt: 1 / 60, hasBall: true, caught: false, anticipating: false, target });
      return state;
    };
    expect(run(6)).toEqual(run(6));
    expect(run(6).mode).toBe('SECURE');
    expect(run(20).mode).toBe('NONE');
  });

  it('never moves a failed catch away from the authoritative airborne ball', () => {
    const state = makeCatchPresentationState();
    const target = { x: 1, y: 2, z: 3 };
    stepCatchPresentation(state, { dt: 1 / 60, hasBall: false, caught: false, anticipating: true, target });
    const out = { x: 0, y: 0, z: 0 };
    presentationBallPosition(
      { x: 4, y: 5, z: 6 }, { x: 1, y: 2, z: 3 }, { x: 0, y: 0, z: 0 }, state, out,
    );
    expect(out).toEqual({ x: 4, y: 5, z: 6 });
  });

  it('moves a secured ball from the captured contact point toward the tuck', () => {
    const state = makeCatchPresentationState();
    const target = { x: 0.2, y: 1.4, z: 0.3 };
    stepCatchPresentation(state, { dt: 1 / 60, hasBall: true, caught: true, anticipating: false, target });
    for (let i = 0; i < 5; i++) {
      stepCatchPresentation(state, { dt: 1 / 60, hasBall: true, caught: false, anticipating: false, target });
    }
    const out = { x: 0, y: 0, z: 0 };
    presentationBallPosition(
      { x: 99, y: 99, z: 99 }, { x: 1, y: 2, z: 3 }, { x: 0, y: 1, z: 1 }, state, out,
    );
    expect(out.x).toBeGreaterThan(0);
    expect(out.x).toBeLessThan(1);
    expect(out.y).toBeGreaterThan(1);
    expect(out.y).toBeLessThan(2);
  });
});
