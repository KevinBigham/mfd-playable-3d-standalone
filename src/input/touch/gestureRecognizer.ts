/**
 * Turns a pointer's path into at most one gesture, on purpose.
 *
 * The old surface path fired a swipe the instant travel crossed 26 px — before direction was
 * settled, with no way to change your mind. This recognizer classifies with configurable
 * thresholds: taps by travel+duration, holds by duration, swipes by travel through a direction
 * sector after a short confirmation window, and a reversal before commitment cancels instead of
 * firing the wrong verb. One committed action per contact, always.
 *
 * The one deliberate exception: an "urgent" swipe (a tackle lunge) may commit early when the
 * caller says the context justifies it — waiting the full window on defense hands the play to
 * the offense.
 */

export interface GestureThresholds {
  tapMaxTravelPx: number;
  tapMaxDurationMs: number;
  holdDurationMs: number;
  holdMaxTravelPx: number;
  swipeMinTravelPx: number;
  /** Extra travel before an early (urgent) commit is allowed. */
  urgentTravelPx: number;
  /** How long a swipe must sustain its direction before committing, ms. */
  confirmWindowMs: number;
  /** Degrees of direction change that cancels an uncommitted swipe. */
  reversalCancelDeg: number;
}

export const GESTURE_PRESETS: Record<'RELAXED' | 'STANDARD' | 'PRECISE', GestureThresholds> = {
  // Relaxed: forgiving distances and windows for unsteady thumbs.
  RELAXED: {
    tapMaxTravelPx: 18, tapMaxDurationMs: 320, holdDurationMs: 320, holdMaxTravelPx: 18,
    swipeMinTravelPx: 34, urgentTravelPx: 44, confirmWindowMs: 90, reversalCancelDeg: 100,
  },
  STANDARD: {
    tapMaxTravelPx: 12, tapMaxDurationMs: 260, holdDurationMs: 260, holdMaxTravelPx: 14,
    swipeMinTravelPx: 28, urgentTravelPx: 38, confirmWindowMs: 65, reversalCancelDeg: 110,
  },
  // Precise: shorter, stricter — for players who want minimum latency and own their misses.
  PRECISE: {
    tapMaxTravelPx: 9, tapMaxDurationMs: 220, holdDurationMs: 220, holdMaxTravelPx: 10,
    swipeMinTravelPx: 22, urgentTravelPx: 28, confirmWindowMs: 35, reversalCancelDeg: 130,
  },
};

export type SwipeDirection = 'LEFT' | 'RIGHT' | 'UP' | 'DOWN';

export type Gesture =
  | { type: 'TAP' }
  | { type: 'HOLD' }
  | { type: 'SWIPE'; direction: SwipeDirection; urgent: boolean }
  | { type: 'CANCELLED' };

interface Contact {
  x0: number; y0: number;
  t0: number;
  maxTravel: number;
  committed: boolean;
  /** Direction candidate and when it was first seen. */
  candidate: SwipeDirection | null;
  candidateSince: number;
  candidateAngle: number;
  cancelled: boolean;
  holdReported: boolean;
}

function directionOf(dx: number, dy: number): { dir: SwipeDirection; angle: number } {
  const angle = Math.atan2(dy, dx);
  const dir: SwipeDirection = Math.abs(dx) > Math.abs(dy)
    ? (dx > 0 ? 'RIGHT' : 'LEFT')
    : (dy > 0 ? 'DOWN' : 'UP');
  return { dir, angle };
}

export class GestureRecognizer {
  private contacts = new Map<number, Contact>();
  constructor(public thresholds: GestureThresholds) {}

  begin(id: number, x: number, y: number, now: number): void {
    this.contacts.set(id, {
      x0: x, y0: y, t0: now, maxTravel: 0, committed: false,
      candidate: null, candidateSince: 0, candidateAngle: 0,
      cancelled: false, holdReported: false,
    });
  }

  /**
   * Feed a move sample. Returns a committed swipe when one is ready, else null.
   * `urgentOk` lets the caller allow early commitment (legal tackle context only).
   */
  move(id: number, x: number, y: number, now: number, urgentOk = false): Gesture | null {
    const c = this.contacts.get(id);
    if (!c || c.committed || c.cancelled) return null;
    const t = this.thresholds;
    const dx = x - c.x0, dy = y - c.y0;
    const travel = Math.hypot(dx, dy);
    c.maxTravel = Math.max(c.maxTravel, travel);
    if (travel < t.swipeMinTravelPx * 0.6) return null;

    const { dir, angle } = directionOf(dx, dy);
    if (c.candidate === null) {
      c.candidate = dir;
      c.candidateSince = now;
      c.candidateAngle = angle;
      // An urgent lunge can arrive as one large first sample — commit without the window.
      if (urgentOk && travel >= t.urgentTravelPx && travel >= t.swipeMinTravelPx) {
        c.committed = true;
        return { type: 'SWIPE', direction: dir, urgent: true };
      }
      return null;
    }
    // Direction reversal before commitment: cancel the whole contact — the player changed
    // their mind, and firing either direction would be wrong.
    let dAngle = Math.abs(angle - c.candidateAngle) * (180 / Math.PI);
    if (dAngle > 180) dAngle = 360 - dAngle;
    if (dAngle > t.reversalCancelDeg) {
      c.cancelled = true;
      return { type: 'CANCELLED' };
    }
    if (dir !== c.candidate) {
      // Drifted to a neighboring sector without a hard reversal: re-candidate.
      c.candidate = dir;
      c.candidateSince = now;
      c.candidateAngle = angle;
      return null;
    }
    const sustained = now - c.candidateSince >= t.confirmWindowMs;
    const urgent = urgentOk && travel >= t.urgentTravelPx;
    if (travel >= t.swipeMinTravelPx && (sustained || urgent)) {
      c.committed = true;
      return { type: 'SWIPE', direction: dir, urgent: urgent && !sustained };
    }
    return null;
  }

  /** A parked finger becomes a hold exactly once. Poll from the frame loop. */
  checkHold(id: number, now: number): Gesture | null {
    const c = this.contacts.get(id);
    if (!c || c.committed || c.cancelled || c.holdReported) return null;
    const t = this.thresholds;
    if (now - c.t0 >= t.holdDurationMs && c.maxTravel <= t.holdMaxTravelPx) {
      c.holdReported = true;
      return { type: 'HOLD' };
    }
    return null;
  }

  /**
   * The finger lifted. A short small contact is a tap; a qualified flick that ended before the
   * confirmation window elapsed commits on release — a fast flick is the most natural swipe
   * there is, and swallowing it would punish exactly the players with the best hands.
   */
  end(id: number, now: number, lastX?: number, lastY?: number): Gesture | null {
    const c = this.contacts.get(id);
    this.contacts.delete(id);
    if (!c || c.committed || c.cancelled) return null;
    const t = this.thresholds;
    if (now - c.t0 <= t.tapMaxDurationMs && c.maxTravel <= t.tapMaxTravelPx) return { type: 'TAP' };
    if (c.candidate !== null && c.maxTravel >= t.swipeMinTravelPx) {
      // Direction from the final position when the caller has it, else the candidate stands.
      if (lastX !== undefined && lastY !== undefined) {
        const { dir } = directionOf(lastX - c.x0, lastY - c.y0);
        return { type: 'SWIPE', direction: dir, urgent: false };
      }
      return { type: 'SWIPE', direction: c.candidate, urgent: false };
    }
    return null;
  }

  cancel(id: number): void { this.contacts.delete(id); }

  reset(): void { this.contacts.clear(); }

  get pending(): boolean { return this.contacts.size > 0; }
}
