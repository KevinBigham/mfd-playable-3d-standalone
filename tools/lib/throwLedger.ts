/**
 * One ledger entry per actual forward throw, closed by the first terminal outcome.
 *
 * Exists because the old drive census divided catches by `catches + incompletes` and printed the
 * result as a completion percentage — a denominator that silently excluded drops, swats,
 * interceptions, and bobble resolutions, and inflated the DEEP figure both audit reports repeated.
 * Every rate this project publishes now names its numerator and denominator, and this module is
 * the single definition of what a throw outcome is.
 *
 * Outcome taxonomy (mutually exclusive, reconciles to actual throws):
 *   CAUGHT               — offense secured the ball (`catch`), including after a bobble
 *   DROPPED              — receiver got hands on it and dropped it (`drop`)
 *   SWATTED              — defender knocked it dead (`swat`)
 *   DEFENDER_POSSESSION  — a defender came down with it (`interception` EVENT; this is not the
 *                          same thing as the credited stat, and not the same as a turnover drive)
 *   FELL_INCOMPLETE      — nobody touched it before the play died (throwaways land here)
 *
 * `bobbled` is an intermediate fact, not an outcome: a bobble always resolves into one of the
 * buckets above.
 */
import type { GameEvent } from '../../src/core/types.ts';

export type ThrowOutcome =
  | 'CAUGHT'
  | 'DROPPED'
  | 'SWATTED'
  | 'DEFENDER_POSSESSION'
  | 'FELL_INCOMPLETE';

export const THROW_OUTCOMES: readonly ThrowOutcome[] = [
  'CAUGHT', 'DROPPED', 'SWATTED', 'DEFENDER_POSSESSION', 'FELL_INCOMPLETE',
];

export interface ThrowRecord {
  tick: number;
  /** Caller-supplied label — play family, policy arm, whatever the report groups by. */
  bucket: string;
  outcome: ThrowOutcome;
  bobbled: boolean;
  /** True when the throw event had no target (a deliberate throwaway). */
  throwaway: boolean;
}

export interface ThrowTally {
  throws: number;
  caught: number;
  dropped: number;
  swatted: number;
  defenderPossession: number;
  fellIncomplete: number;
  bobbled: number;
  bobbledToDefender: number;
  bobbledToOffense: number;
}

export function emptyTally(): ThrowTally {
  return {
    throws: 0, caught: 0, dropped: 0, swatted: 0,
    defenderPossession: 0, fellIncomplete: 0, bobbled: 0,
    bobbledToDefender: 0, bobbledToOffense: 0,
  };
}

export class ThrowLedger {
  readonly records: ThrowRecord[] = [];
  private open: { tick: number; bucket: string; bobbled: boolean; throwaway: boolean } | null = null;

  constructor(private bucketOf: () => string = () => 'ALL') {}

  /** Feed every game event through here (subscribe with `bus.on('*', e => ledger.handle(e))`). */
  handle(e: GameEvent): void {
    switch (e.type) {
      case 'throw':
        // A second throw before the first resolved would mean the sim allowed two live balls;
        // close the stale one as incomplete rather than corrupt the count.
        if (this.open) this.close('FELL_INCOMPLETE');
        this.open = { tick: e.tick, bucket: this.bucketOf(), bobbled: false, throwaway: e.to === null };
        break;
      case 'catch': this.close('CAUGHT'); break;
      case 'drop': this.close('DROPPED'); break;
      case 'swat': this.close('SWATTED'); break;
      case 'interception': this.close('DEFENDER_POSSESSION'); break;
      case 'bobble': if (this.open) this.open.bobbled = true; break;
      case 'play.end': this.close('FELL_INCOMPLETE'); break;
      default: break;
    }
  }

  private close(outcome: ThrowOutcome): void {
    if (!this.open) return;
    this.records.push({
      tick: this.open.tick, bucket: this.open.bucket,
      outcome, bobbled: this.open.bobbled, throwaway: this.open.throwaway,
    });
    this.open = null;
  }

  /** Tally for one bucket, or for everything when no bucket is given. */
  tally(bucket?: string): ThrowTally {
    const t = emptyTally();
    for (const r of this.records) {
      if (bucket !== undefined && r.bucket !== bucket) continue;
      t.throws++;
      if (r.bobbled) t.bobbled++;
      switch (r.outcome) {
        case 'CAUGHT':
          t.caught++;
          if (r.bobbled) t.bobbledToOffense++;
          break;
        case 'DROPPED': t.dropped++; break;
        case 'SWATTED': t.swatted++; break;
        case 'DEFENDER_POSSESSION':
          t.defenderPossession++;
          if (r.bobbled) t.bobbledToDefender++;
          break;
        case 'FELL_INCOMPLETE': t.fellIncomplete++; break;
      }
    }
    return t;
  }

  buckets(): string[] {
    const seen = new Set<string>();
    for (const r of this.records) seen.add(r.bucket);
    return [...seen];
  }

  /** Every outcome bucket must sum back to the number of actual throws. */
  static reconciles(t: ThrowTally): boolean {
    return t.throws === t.caught + t.dropped + t.swatted + t.defenderPossession + t.fellIncomplete;
  }
}

/** `numerator/denominator = rate` — the only format a rate is allowed to be printed in. */
export function rate(num: number, den: number, label: string): string {
  const pct = den === 0 ? '—' : `${((num / den) * 100).toFixed(1)}%`;
  return `${num}/${den} = ${pct} ${label}`;
}
