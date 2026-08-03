import { describe, it, expect } from 'vitest';
import { FeedbackArbiter, FEEDBACK_PRIORITY as P } from '../src/ui/feedback.ts';

describe('FeedbackArbiter — one surface, one voice (W6-001)', () => {
  it('shows the first offer immediately', () => {
    const a = new FeedbackArbiter();
    expect(a.offer('FIRST DOWN', 1.1, P.FIRST_DOWN)).toBe(true);
    expect(a.current?.text).toBe('FIRST DOWN');
  });

  it('a lower-priority offer is dropped while something is showing', () => {
    const a = new FeedbackArbiter();
    a.offer('TOUCHDOWN!', 2.4, P.SCORE);
    expect(a.offer('BIG HIT!', 0.9, P.FLAVOR)).toBe(false);
    expect(a.current?.text).toBe('TOUCHDOWN!');
  });

  it('a higher-priority offer preempts immediately', () => {
    const a = new FeedbackArbiter();
    a.offer('FIRST DOWN', 1.1, P.FIRST_DOWN);
    expect(a.offer('INTERCEPTED!', 2.0, P.TURNOVER)).toBe(true);
    expect(a.current?.text).toBe('INTERCEPTED!');
  });

  it('equal priority: newer wins (two first downs read as two)', () => {
    const a = new FeedbackArbiter();
    a.offer('FIRST DOWN', 1.1, P.FIRST_DOWN);
    a.tick(0.5);
    expect(a.offer('FIRST DOWN', 1.1, P.FIRST_DOWN)).toBe(true);
    // the hold restarted — after another 0.9s the banner is still up
    a.tick(0.9);
    expect(a.current).not.toBeNull();
  });

  it('expires after its hold and frees the surface for anything', () => {
    const a = new FeedbackArbiter();
    a.offer('TOUCHDOWN!', 2.4, P.SCORE);
    a.tick(2.5);
    expect(a.current).toBeNull();
    expect(a.offer('BIG HIT!', 0.9, P.FLAVOR)).toBe(true);
  });

  it('a dropped item is NOT shown later — momentary feedback never queues', () => {
    const a = new FeedbackArbiter();
    a.offer('TOUCHDOWN!', 2.4, P.SCORE);
    a.offer('SACK!', 1.4, P.SACK); // dropped
    a.tick(2.5);
    expect(a.current).toBeNull(); // surface is empty, not showing a stale SACK!
  });

  it('MATCH_END outranks everything in the table', () => {
    const a = new FeedbackArbiter();
    a.offer('TOUCHDOWN!', 2.4, P.SCORE);
    expect(a.offer('FINAL', 2.4, P.MATCH_END)).toBe(true);
    expect(a.offer('TOUCHDOWN!', 2.4, P.SCORE)).toBe(false);
  });

  it('reset clears the surface (interruption semantics)', () => {
    const a = new FeedbackArbiter();
    a.offer('TOUCHDOWN!', 2.4, P.SCORE);
    a.reset();
    expect(a.current).toBeNull();
    expect(a.consumeDirty()).toBe(true);
  });

  it('dirty flag fires once per change and resets on read', () => {
    const a = new FeedbackArbiter();
    a.offer('SACK!', 1.4, P.SACK);
    expect(a.consumeDirty()).toBe(true);
    expect(a.consumeDirty()).toBe(false);
    a.tick(0.5);
    expect(a.consumeDirty()).toBe(false); // still showing, nothing changed
    a.tick(1.0);
    expect(a.consumeDirty()).toBe(true); // expiry is a change
  });
});
