/**
 * Input conditioning and action buffering.
 *
 * Two jobs, both of which the game was doing badly or not at all.
 *
 * **A round stick.** The dead zone used to threshold each axis on its own, which carves a SQUARE
 * hole out of a round stick: push straight up past 0.22 and you move, push diagonally at the same
 * physical deflection and you get a different magnitude, because the corner of the square is
 * 1.41× further from the centre than its edge. Sweeping a circle at constant deflection produced a
 * constant-ish speed on the cardinals and a different one on the diagonals. It is measured by
 * `npm run acceptance` (INP-002) as radial symmetry error.
 *
 * **A press that arrives early is not a press that never happened.** Actions in this game are
 * legal only in certain states — you cannot snap during the settle window, cannot throw before the
 * snap, cannot kick before the meter arms. A press a few frames early used to be dropped on the
 * floor, and the player, who felt themselves press the button, concludes the game missed it. They
 * are right. Ordinary actions are now held for a few frames and fire on the first tick they become
 * legal; anything that expires unfired is recorded with a reason, because an input that vanishes
 * without explanation is the hardest class of bug to be told about.
 */
import { ACTION_NAMES, Action, type ActionName } from './actions.ts';

/** Blueprint baselines: 0.18 radial dead zone, 1.30 response exponent, four-frame buffer. */
export const RADIAL_DEADZONE = 0.18;
export const RESPONSE_EXPONENT = 1.3;
export const BUFFER_FRAMES = 4;
/** Catch, recovery and goal-line dives get a shorter, tighter grace instead. */
export const GRACE_FRAMES = 2;

export interface Stick { x: number; y: number }

/**
 * Radial dead zone with a response curve. The magnitude is thresholded and rescaled, the
 * DIRECTION is preserved exactly, so a circle in is a circle out.
 */
export function applyDeadzone(x: number, y: number): Stick {
  const mag = Math.hypot(x, y);
  if (mag <= RADIAL_DEADZONE) return { x: 0, y: 0 };
  const scaled = Math.min(1, (mag - RADIAL_DEADZONE) / (1 - RADIAL_DEADZONE));
  const curved = Math.pow(scaled, RESPONSE_EXPONENT);
  const k = curved / mag;
  return { x: x * k, y: y * k };
}

/** Why a buffered action never fired. Surfaced for debugging; never silently discarded. */
export interface Rejection { action: string; reason: string; heldFrames: number; tick: number }

export const inputDebug = {
  /** Bounded: this is a debugging aid, not a leak. */
  rejections: [] as Rejection[],
  fired: 0,
  buffered: 0,
};
const MAX_REJECTIONS = 64;

interface Slot { bit: number; framesLeft: number; addedTick: number }

/**
 * One buffer per seat. Holds recently pressed actions until whatever consumes them says they were
 * legal, or until they expire.
 */
export class ActionBuffer {
  private slots: Slot[] = [];

  /** Record this tick's fresh presses. `pressed` is an edge mask, not a held mask. */
  push(pressed: number, tick: number, frames = BUFFER_FRAMES): void {
    if (pressed === 0) return;
    for (const name of ACTION_NAMES) {
      const bit = Action[name];
      if ((pressed & bit) === 0) continue;
      const existing = this.slots.find((sl) => sl.bit === bit);
      if (existing) { existing.framesLeft = frames; existing.addedTick = tick; continue; }
      this.slots.push({ bit, framesLeft: frames, addedTick: tick });
      inputDebug.buffered++;
    }
  }

  /** Every action currently held in the buffer, as a mask. */
  pending(): number {
    let m = 0;
    for (const sl of this.slots) m |= sl.bit;
    return m;
  }

  /** True if `bit` is buffered. Does not consume it. */
  has(bit: number): boolean { return this.slots.some((sl) => sl.bit === bit); }

  /** Take `bit` out of the buffer because it has now been acted on. */
  consume(bit: number): boolean {
    const i = this.slots.findIndex((sl) => sl.bit === bit);
    if (i < 0) return false;
    this.slots.splice(i, 1);
    inputDebug.fired++;
    return true;
  }

  /**
   * Age everything by one tick. Anything that runs out is recorded with the reason it was still
   * sitting there, which the caller supplies — it is the only part of the system that knows.
   */
  age(tick: number, reasonFor: (bit: number) => string): void {
    for (let i = this.slots.length - 1; i >= 0; i--) {
      const sl = this.slots[i];
      sl.framesLeft--;
      if (sl.framesLeft > 0) continue;
      this.slots.splice(i, 1);
      if (inputDebug.rejections.length >= MAX_REJECTIONS) inputDebug.rejections.shift();
      inputDebug.rejections.push({
        action: nameOf(sl.bit),
        reason: reasonFor(sl.bit),
        heldFrames: tick - sl.addedTick,
        tick,
      });
    }
  }

  clear(): void { this.slots.length = 0; }
}

function nameOf(bit: number): string {
  for (const n of ACTION_NAMES) if (Action[n] === bit) return n as ActionName;
  return `0x${bit.toString(16)}`;
}
