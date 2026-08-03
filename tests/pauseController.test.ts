import { describe, it, expect } from 'vitest';
import { PauseController } from '../src/app/pauseController.ts';

/**
 * The contract that fixes the shipped nested-screen bug: pausing is a set of held reason tokens,
 * releasing one reason can never release another, and unknown releases are inert.
 */
describe('PauseController', () => {
  it('is paused while at least one reason is held', () => {
    const pc = new PauseController();
    expect(pc.paused).toBe(false);
    const t = pc.acquire('USER');
    expect(pc.paused).toBe(true);
    pc.release(t);
    expect(pc.paused).toBe(false);
  });

  it('nested modal over user pause: releasing the modal keeps the user pause', () => {
    const pc = new PauseController();
    const user = pc.acquire('USER');
    const modal = pc.acquire('MODAL');   // Settings opened from Pause
    pc.release(modal);                    // Settings closed
    expect(pc.paused).toBe(true);         // the match must still be frozen
    expect(pc.reasons).toEqual(['USER']);
    pc.release(user);
    expect(pc.paused).toBe(false);
  });

  it('orientation return releases only orientation', () => {
    const pc = new PauseController();
    pc.acquire('USER');
    const rot = pc.acquire('ORIENTATION');
    pc.release(rot);
    expect(pc.paused).toBe(true);
    expect(pc.has('USER')).toBe(true);
    expect(pc.has('ORIENTATION')).toBe(false);
  });

  it('double release and foreign tokens are inert', () => {
    const pc = new PauseController();
    const a = pc.acquire('USER');
    const b = pc.acquire('MODAL');
    pc.release(a);
    pc.release(a);            // double release: no-op
    pc.release(null);         // nothing: no-op
    expect(pc.paused).toBe(true);
    expect(pc.reasons).toEqual(['MODAL']);
    pc.release(b);
    expect(pc.paused).toBe(false);
  });

  it('clearReason drops every token of that reason and nothing else', () => {
    const pc = new PauseController();
    pc.acquire('LIFECYCLE');
    pc.acquire('LIFECYCLE');
    pc.acquire('USER');
    pc.clearReason('LIFECYCLE');
    expect(pc.reasons).toEqual(['USER']);
  });

  it('clearAll empties everything (match teardown)', () => {
    const pc = new PauseController();
    pc.acquire('USER'); pc.acquire('MODAL'); pc.acquire('RECOVERY');
    pc.clearAll();
    expect(pc.paused).toBe(false);
    expect(pc.reasons).toEqual([]);
  });

  it('notifies only on real paused-state transitions', () => {
    const pc = new PauseController();
    const events: boolean[] = [];
    pc.onChange((p) => events.push(p));
    const a = pc.acquire('USER');    // false -> true
    const b = pc.acquire('MODAL');   // still true: no event
    pc.release(b);                    // still true: no event
    pc.release(a);                    // true -> false
    expect(events).toEqual([true, false]);
  });
});
