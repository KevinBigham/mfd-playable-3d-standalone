/**
 * Reason-token pause ownership.
 *
 * A shared `paused` boolean cannot express nesting: the pause menu, a settings screen opened from
 * it, a portrait-rotation gate, and a backgrounded tab are four different reasons to be paused,
 * and any one of them clearing a boolean un-pauses all of the others. That is exactly the shipped
 * bug this replaces — the Pause screen's `unmount()` wrote `paused = false`, so opening Settings
 * resumed the hidden match behind it.
 *
 * The game is paused while at least one reason token is held. Screens and services acquire and
 * release their own tokens and can never release anyone else's.
 */

export type PauseReason =
  | 'USER'          // the player opened the pause menu
  | 'MODAL'         // a nested screen (settings, controls) is covering play
  | 'ORIENTATION'   // portrait rotation gate on a phone
  | 'LIFECYCLE'     // tab hidden / app backgrounded / page freeze
  | 'LOADING'       // match resources still being prepared
  | 'REPLAY'        // replay presentation owns the frame
  | 'RECOVERY';     // WebGL context loss recovery

export interface PauseToken {
  readonly id: number;
  readonly reason: PauseReason;
}

export class PauseController {
  private tokens = new Map<number, PauseReason>();
  private nextId = 1;
  private listeners: Array<(paused: boolean, reasons: readonly PauseReason[]) => void> = [];

  acquire(reason: PauseReason): PauseToken {
    const id = this.nextId++;
    const wasPaused = this.paused;
    this.tokens.set(id, reason);
    if (!wasPaused) this.notify();
    return { id, reason };
  }

  /** Releasing an unknown or already-released token is a no-op — never someone else's pause. */
  release(token: PauseToken | null | undefined): void {
    if (!token || !this.tokens.has(token.id)) return;
    this.tokens.delete(token.id);
    if (!this.paused) this.notify();
  }

  /** Drop every token of one reason. For services that own their reason exclusively. */
  clearReason(reason: PauseReason): void {
    let dropped = false;
    for (const [id, r] of this.tokens) if (r === reason) { this.tokens.delete(id); dropped = true; }
    if (dropped && !this.paused) this.notify();
  }

  /** Match teardown: nothing left to pause. */
  clearAll(): void {
    if (this.tokens.size === 0) return;
    this.tokens.clear();
    this.notify();
  }

  get paused(): boolean { return this.tokens.size > 0; }

  get reasons(): readonly PauseReason[] { return [...new Set(this.tokens.values())]; }

  has(reason: PauseReason): boolean {
    for (const r of this.tokens.values()) if (r === reason) return true;
    return false;
  }

  onChange(listener: (paused: boolean, reasons: readonly PauseReason[]) => void): () => void {
    this.listeners.push(listener);
    return () => { const i = this.listeners.indexOf(listener); if (i >= 0) this.listeners.splice(i, 1); };
  }

  private notify(): void {
    const p = this.paused; const r = this.reasons;
    for (const fn of this.listeners) { try { fn(p, r); } catch { /* a listener must not break pause */ } }
  }
}
