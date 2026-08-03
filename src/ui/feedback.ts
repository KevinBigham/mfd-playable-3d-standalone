/**
 * W6-001 — the single-priority feedback arbiter.
 *
 * One surface, one voice: at any moment exactly one piece of momentary feedback owns the HUD
 * banner. Simultaneous events resolve by priority, not by arrival order — a FIRST DOWN chip
 * must never stomp the TOUCHDOWN banner just because it fired one event later.
 *
 * Rules, stated once:
 *  - An offer at priority >= the showing item preempts it immediately (equal priority is
 *    "newer wins": two first downs in a row should read as two, not one).
 *  - An offer at lower priority while something is showing is DROPPED, not queued. Momentary
 *    feedback shown late is wrong feedback — "SACK!" two seconds after the whistle explains
 *    nothing. The play-by-play record, stats, and grade facts keep the full history.
 *
 * Pure logic, no DOM: the Hud renders whatever `current` is. Deterministic and unit-tested.
 */

export interface FeedbackItem {
  text: string;
  /** Seconds the item holds the surface (also its remaining time once showing). */
  hold: number;
  priority: number;
}

/** Priority bands for match events. Gaps are deliberate — tuning room without renumbering. */
export const FEEDBACK_PRIORITY = {
  MATCH_END: 100,
  SCORE: 90,        // touchdown, safety, field goal result, two-point result
  TURNOVER: 85,     // interception, fumble, turnover on downs
  PERIOD: 75,       // quarter end, halftime, overtime
  OVERDRIVE: 70,
  CONVERSION: 65,   // extra point
  SACK: 60,
  FIRST_DOWN: 50,
  FLAVOR: 30,       // big hits
} as const;

export class FeedbackArbiter {
  private showing: FeedbackItem | null = null;
  /** Set for one read after a change so the renderer knows to repaint. */
  private dirty = false;

  /** Offer feedback. Returns true when the item took the surface, false when it was dropped. */
  offer(text: string, hold: number, priority: number): boolean {
    if (this.showing && priority < this.showing.priority) return false;
    this.showing = { text, hold, priority };
    this.dirty = true;
    return true;
  }

  /** Advance time. Returns the item that should be on the surface right now (null = clear). */
  tick(dt: number): FeedbackItem | null {
    if (this.showing) {
      this.showing.hold -= dt;
      if (this.showing.hold <= 0) { this.showing = null; this.dirty = true; }
    }
    return this.showing;
  }

  get current(): FeedbackItem | null { return this.showing; }

  /** True once after any change; reading it resets it. The renderer polls this. */
  consumeDirty(): boolean {
    const d = this.dirty;
    this.dirty = false;
    return d;
  }

  /** Interruptions clear all transient feedback, same as they clear all touch state. */
  reset(): void {
    if (this.showing) this.dirty = true;
    this.showing = null;
  }
}
