import { describe, it, expect } from 'vitest';
import { ThrowLedger } from '../tools/lib/throwLedger.ts';
import type { GameEvent } from '../src/core/types.ts';

/**
 * The metric fixture the evidence repair hangs on: one synthetic sequence containing every throw
 * outcome — catch, untouched incompletion, drop, swat, bobble resolving both ways, a sack that is
 * not a throw, and a throwaway — must reconcile exactly to the number of actual throws. This is
 * the guarantee the old `catches/(catches+incompletes)` "completion percentage" violated.
 */

const t = (partial: Record<string, unknown>): GameEvent => ({ tick: 0, ...partial } as unknown as GameEvent);

function feed(ledger: ThrowLedger, events: GameEvent[]): void {
  for (const e of events) ledger.handle(e);
}

describe('throw outcome ledger', () => {
  it('reconciles every mutually exclusive outcome to actual throws', () => {
    const ledger = new ThrowLedger();
    feed(ledger, [
      // 1: clean catch
      t({ type: 'throw', from: 0, to: 5, passKind: 'NORMAL' }),
      t({ type: 'catch', by: 5, contested: false, diving: false, yards: 12 }),
      t({ type: 'play.end', reason: 'TACKLE', spotZ: 40, yards: 12 }),
      // 2: untouched incompletion
      t({ type: 'throw', from: 0, to: 5, passKind: 'NORMAL' }),
      t({ type: 'play.end', reason: 'INCOMPLETE', spotZ: 30, yards: 0 }),
      // 3: drop
      t({ type: 'throw', from: 0, to: 6, passKind: 'NORMAL' }),
      t({ type: 'drop', by: 6 }),
      t({ type: 'play.end', reason: 'INCOMPLETE', spotZ: 30, yards: 0 }),
      // 4: swat
      t({ type: 'throw', from: 0, to: 6, passKind: 'BULLET' }),
      t({ type: 'swat', by: 11 }),
      t({ type: 'play.end', reason: 'INCOMPLETE', spotZ: 30, yards: 0 }),
      // 5: bobble resolved by the defence — a defender-possession event, not a "catch that missed"
      t({ type: 'throw', from: 0, to: 7, passKind: 'LOB' }),
      t({ type: 'bobble', by: 7, contested: true }),
      t({ type: 'interception', by: 12 }),
      t({ type: 'play.end', reason: 'TACKLE', spotZ: 35, yards: 0 }),
      // 6: bobble secured by the offence — still simply a catch in the outcome taxonomy
      t({ type: 'throw', from: 0, to: 7, passKind: 'NORMAL' }),
      t({ type: 'bobble', by: 7, contested: false }),
      t({ type: 'catch', by: 7, contested: true, diving: false, yards: 8 }),
      t({ type: 'play.end', reason: 'TACKLE', spotZ: 38, yards: 8 }),
      // a sack: no throw event, so it must not appear anywhere in the throw ledger
      t({ type: 'sack', by: 13, on: 0, yards: -6 }),
      t({ type: 'play.end', reason: 'TACKLE', spotZ: 24, yards: -6 }),
      // 7: throwaway — a real throw with no target, falls incomplete
      t({ type: 'throw', from: 0, to: null, passKind: 'NORMAL' }),
      t({ type: 'play.end', reason: 'INCOMPLETE', spotZ: 30, yards: 0 }),
      // 8: clean defender possession
      t({ type: 'throw', from: 0, to: 5, passKind: 'NORMAL' }),
      t({ type: 'interception', by: 11 }),
      t({ type: 'play.end', reason: 'TACKLE', spotZ: 33, yards: 0 }),
    ]);

    const tally = ledger.tally();
    expect(tally.throws).toBe(8);
    expect(tally.caught).toBe(2);
    expect(tally.fellIncomplete).toBe(2);      // untouched + throwaway
    expect(tally.dropped).toBe(1);
    expect(tally.swatted).toBe(1);
    expect(tally.defenderPossession).toBe(2);  // tipped pick + clean pick
    expect(tally.bobbled).toBe(2);
    expect(tally.bobbledToDefender).toBe(1);
    expect(tally.bobbledToOffense).toBe(1);
    // The whole point: outcomes are exhaustive and mutually exclusive.
    expect(ThrowLedger.reconciles(tally)).toBe(true);
    expect(tally.caught + tally.dropped + tally.swatted + tally.defenderPossession
      + tally.fellIncomplete).toBe(tally.throws);
  });

  it('never counts a sack or a lateral as a throw', () => {
    const ledger = new ThrowLedger();
    feed(ledger, [
      t({ type: 'sack', by: 13, on: 0, yards: -6 }),
      t({ type: 'lateral', from: 2, to: 3 }),
      t({ type: 'play.end', reason: 'TACKLE', spotZ: 24, yards: -6 }),
    ]);
    expect(ledger.tally().throws).toBe(0);
  });

  it('groups by the caller-supplied bucket', () => {
    let bucket = 'DEEP';
    const ledger = new ThrowLedger(() => bucket);
    feed(ledger, [
      t({ type: 'throw', from: 0, to: 5, passKind: 'NORMAL' }),
      t({ type: 'catch', by: 5, contested: false, diving: false, yards: 30 }),
      t({ type: 'play.end', reason: 'TACKLE', spotZ: 60, yards: 30 }),
    ]);
    bucket = 'QUICK';
    feed(ledger, [
      t({ type: 'throw', from: 0, to: 6, passKind: 'BULLET' }),
      t({ type: 'swat', by: 11 }),
      t({ type: 'play.end', reason: 'INCOMPLETE', spotZ: 30, yards: 0 }),
    ]);
    expect(ledger.tally('DEEP').caught).toBe(1);
    expect(ledger.tally('QUICK').swatted).toBe(1);
    expect(ledger.tally().throws).toBe(2);
  });
});
