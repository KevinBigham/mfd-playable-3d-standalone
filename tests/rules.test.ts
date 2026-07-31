import { describe, it, expect } from 'vitest';
import {
  createMatchState, applyOutcome, blankOutcome, computeFirstDown, distanceToGo, isAndGoal,
  touchbackSpot, kickoffSpot, conversionSpot, validateMatchState, noteCatch, noteSack,
  extinguish, winnerOf, matchShouldEnd, other, breakStreaks,
} from '../src/rules/rulesEngine.ts';
import type { TeamSide } from '../src/core/types.ts';
import { FIRST_DOWN_YARDS } from '../src/core/constants.ts';

const Q = 120 * 60;

describe('chains', () => {
  it('a first down is thirty yards, clamped at the goal line', () => {
    expect(computeFirstDown(20, 0)).toBe(50);
    expect(computeFirstDown(80, 0)).toBe(100);
    expect(computeFirstDown(80, 1)).toBe(50);
    expect(computeFirstDown(20, 1)).toBe(0);
    expect(FIRST_DOWN_YARDS).toBe(30);
  });

  it('reaching the marker resets to first down', () => {
    const m = createMatchState(Q);
    m.possession = 0; m.losZ = 20; m.firstDownZ = 50; m.down = 2;
    const o = blankOutcome();
    o.spotZ = 52; o.possessionAfter = 0; o.yards = 32;
    applyOutcome(m, o);
    expect(m.down).toBe(1);
    expect(m.firstDownZ).toBe(82);
    expect(o.firstDown).toBe(true);
  });

  it('four failed downs turn the ball over', () => {
    const m = createMatchState(Q);
    m.possession = 0; m.losZ = 20; m.firstDownZ = 50; m.down = 4;
    const o = blankOutcome();
    o.spotZ = 25; o.possessionAfter = 0; o.yards = 5;
    applyOutcome(m, o);
    expect(m.possession).toBe(1);
    expect(m.down).toBe(1);
    expect(o.turnoverKind).toBe('DOWNS');
    expect(validateMatchState(m)).toEqual([]);
  });

  it('and-goal is reported when the marker is the goal line', () => {
    const m = createMatchState(Q);
    m.possession = 0; m.losZ = 88; m.firstDownZ = computeFirstDown(88, 0);
    expect(isAndGoal(m)).toBe(true);
    expect(distanceToGo(m)).toBe(12);
  });
});

describe('scoring', () => {
  it('a touchdown is six and routes to a conversion', () => {
    const m = createMatchState(Q);
    const o = blankOutcome();
    o.scoreKind = 'TD'; o.scoringSide = 0;
    expect(applyOutcome(m, o)).toBe('SCORE_RESOLVE');
    expect(m.teams[0].score).toBe(6);
    expect(m.pendingScore).toEqual({ side: 0, kind: 'TD' });
  });

  it('a field goal is three and a safety is two for the other team', () => {
    const m = createMatchState(Q);
    const fg = blankOutcome(); fg.scoreKind = 'FG'; fg.scoringSide = 1;
    applyOutcome(m, fg);
    expect(m.teams[1].score).toBe(3);
    m.pendingScore = null;
    const sf = blankOutcome(); sf.scoreKind = 'SAFETY'; sf.scoringSide = 0;
    applyOutcome(m, sf);
    expect(m.teams[0].score).toBe(2);
  });
});

describe('spots', () => {
  it('touchbacks and kickoffs mirror correctly for both sides', () => {
    expect(touchbackSpot(0)).toBe(20);
    expect(touchbackSpot(1)).toBe(80);
    expect(kickoffSpot(0)).toBe(30);
    expect(kickoffSpot(1)).toBe(70);
    expect(conversionSpot(0, true)).toBe(95);
    expect(conversionSpot(1, true)).toBe(5);
  });
});

describe('overdrive', () => {
  it('three catches to the same receiver lights it', () => {
    const m = createMatchState(Q);
    expect(noteCatch(m, 0, 5).started).toBe(false);
    expect(noteCatch(m, 0, 5).started).toBe(false);
    expect(noteCatch(m, 0, 5).started).toBe(true);
    expect(m.teams[0].overdrive).toBe(true);
  });

  it('a different receiver restarts the same-receiver chain but keeps the team chain', () => {
    const m = createMatchState(Q);
    noteCatch(m, 0, 5); noteCatch(m, 0, 6);
    expect(m.teams[0].catchStreak).toBe(1);
    expect(m.teams[0].teamCatchStreak).toBe(2);
    expect(m.teams[0].overdrive).toBe(false);
  });

  it('three straight completions to different receivers still lights it, but shorter', () => {
    const perfect = createMatchState(Q);
    noteCatch(perfect, 0, 5); noteCatch(perfect, 0, 5); noteCatch(perfect, 0, 5);
    const mixed = createMatchState(Q);
    noteCatch(mixed, 0, 5); noteCatch(mixed, 0, 6); noteCatch(mixed, 0, 7);
    expect(perfect.teams[0].overdrive).toBe(true);
    expect(mixed.teams[0].overdrive).toBe(true);
    expect(perfect.teams[0].overdriveTicks).toBeGreaterThan(mixed.teams[0].overdriveTicks);
  });

  it('an incompletion wipes both chains', () => {
    const m = createMatchState(Q);
    noteCatch(m, 0, 5); noteCatch(m, 0, 6);
    breakStreaks(m, 0);
    expect(m.teams[0].catchStreak).toBe(0);
    expect(m.teams[0].teamCatchStreak).toBe(0);
  });

  it('two straight sacks light the defence, and the opponent can put it out', () => {
    const m = createMatchState(Q);
    expect(noteSack(m, 1).started).toBe(false);
    expect(noteSack(m, 1).started).toBe(true);
    expect(m.teams[1].overdrive).toBe(true);
    expect(extinguish(m, 1)).toBe(true);
    expect(m.teams[1].overdrive).toBe(false);
  });
});

describe('endgame', () => {
  it('regulation only ends when someone is ahead', () => {
    const m = createMatchState(Q);
    m.quarter = 4;
    m.teams[0].score = 21; m.teams[1].score = 21;
    expect(matchShouldEnd(m)).toBe(false);
    m.teams[0].score = 24;
    expect(matchShouldEnd(m)).toBe(true);
    expect(winnerOf(m)).toBe(0);
  });

  it('sudden death always resolves', () => {
    const m = createMatchState(Q);
    m.quarter = 7; m.overtimePeriod = 3;
    m.teams[0].score = 30; m.teams[1].score = 30;
    expect(matchShouldEnd(m)).toBe(true);
  });
});

describe('invariants', () => {
  it('a fresh state is valid and possession helpers are symmetric', () => {
    const m = createMatchState(Q);
    expect(validateMatchState(m)).toEqual([]);
    expect(other(0 as TeamSide)).toBe(1);
    expect(other(1 as TeamSide)).toBe(0);
  });

  it('catches invalid states', () => {
    const m = createMatchState(Q);
    m.down = 9; m.clockTicks = -5;
    const v = validateMatchState(m).map((x) => x.code);
    expect(v).toContain('DOWN_RANGE');
    expect(v).toContain('CLOCK_NEGATIVE');
  });
});
