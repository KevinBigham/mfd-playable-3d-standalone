/**
 * One owner for every way a phone takes the game away mid-play.
 *
 * A notification, an app switch, a locked screen, a tab losing focus — each of these used to be
 * handled (or not) by whichever listener happened to exist. This service is the single subscriber:
 * on any interruption it pauses through a reason token, hard-resets every touch-derived input so
 * no stale finger survives, suspends audio, and flushes the last prepared checkpoint. Returning is
 * always explicit — the game re-enters through the pause card, never straight into live movement.
 */
import type { PauseController, PauseToken } from './pauseController.ts';

export type LifecycleReason =
  | 'VISIBILITY_HIDDEN'
  | 'PAGE_HIDE'
  | 'FREEZE'
  | 'BLUR';

export interface MobileLifecycleDeps {
  pause: PauseController;
  input: { resetAll(reason: string): void };
  audio: { suspend(): void; resume(): void };
  checkpoint: { flushPrepared(reason: LifecycleReason): void };
  /** Whether an interruption needs guarding right now (a live, unfinished match). */
  shouldGuard(): boolean;
  /** Called on return to visibility so the app can present the explicit resume card. */
  onReturned(): void;
}

export class MobileLifecycle {
  private token: PauseToken | null = null;
  private disposers: Array<() => void> = [];

  constructor(private deps: MobileLifecycleDeps) {}

  attach(): void {
    const hidden = (reason: LifecycleReason) => () => this.interrupt(reason);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') this.interrupt('VISIBILITY_HIDDEN');
      else this.returned();
    };
    const onPageHide = hidden('PAGE_HIDE');
    const onFreeze = hidden('FREEZE');
    const onBlur = hidden('BLUR');
    const onFocus = () => this.returned();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('freeze', onFreeze);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    this.disposers.push(() => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('freeze', onFreeze);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
    });
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers.length = 0;
    this.deps.pause.release(this.token);
    this.token = null;
  }

  /** True while an interruption pause is held and the player has not explicitly resumed. */
  get interrupted(): boolean { return this.token !== null; }

  private interrupt(reason: LifecycleReason): void {
    // Input reset and checkpoint flush are unconditional: even in a menu, a stale touch or an
    // unfushed settings write must not survive a backgrounding.
    this.deps.input.resetAll(`lifecycle:${reason}`);
    this.deps.checkpoint.flushPrepared(reason);
    if (!this.deps.shouldGuard()) return;
    this.deps.audio.suspend();
    if (!this.token) this.token = this.deps.pause.acquire('LIFECYCLE');
  }

  private returned(): void {
    if (!this.token) return;
    // The pause hand-off is ordered so the game is never unpaused in between: the app presents
    // its explicit resume card (which acquires USER) first, then the LIFECYCLE token drops.
    this.deps.onReturned();
    this.deps.pause.release(this.token);
    this.token = null;
    this.deps.audio.resume();
  }
}
