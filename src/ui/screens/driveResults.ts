/**
 * Drive Results: outcome, one cause, and ONE MORE DRIVE — enabled from the first frame.
 *
 * No reward chain, no mandatory replay, no stat wall. The primary action re-enters the same
 * matchup immediately; everything else is secondary.
 */
import type { Screen, ScreenContext, FocusItem } from '../uiKit.ts';
import { el, FocusRing, driveFocus, button, panel } from '../uiKit.ts';
import type { Game } from '../../app/Game.ts';
import { chipFor, type PlayGradeFacts } from '../../gameplay/playGrade.ts';

export interface DriveResultsParams {
  outcome: string;
  yards: number;
  points: number;
  facts: PlayGradeFacts[];
  /** Personal-best outcome from recordDrive, when progression is live. */
  pb?: { previous: { points: number; yards: number } | null; isNewBest: boolean };
  /** Beat-my-drive challenge code for this attempt. */
  share?: string;
  /** Restart with the same matchup. */
  retry: () => void;
}

export class DriveResultsScreen implements Screen {
  name = 'driveResults';
  private node: HTMLElement | null = null;
  private ring = new FocusRing();
  private ctx!: ScreenContext;
  constructor(private game: Game) {}

  mount(ctx: ScreenContext, params?: unknown): void {
    this.ctx = ctx;
    const p0 = (params as DriveResultsParams | undefined) ?? {
      outcome: 'DRIVE OVER', yards: 0, points: 0, facts: [], retry: () => ctx.reset('mobileHome'),
    };
    const s = el('div', 'go-screen');
    s.appendChild(el('div', 'go-dim'));
    const p = panel(p0.outcome, `${p0.points} points · ${Math.max(0, Math.round(p0.yards))} yards`);
    // One cause line from the last high-confidence graded throw — what to do differently,
    // not a stat dump.
    if (p0.pb) {
      const line = p0.pb.isNewBest
        ? (p0.pb.previous ? `★ NEW BEST — previous ${p0.pb.previous.points} pts / ${Math.round(p0.pb.previous.yards)} yd` : '★ FIRST RECORDED DRIVE')
        : (p0.pb.previous ? `best: ${p0.pb.previous.points} pts / ${Math.round(p0.pb.previous.yards)} yd` : '');
      if (line) {
        const pbEl = el('p', '', line);
        pbEl.style.cssText = p0.pb.isNewBest ? 'color:var(--hot-2);letter-spacing:.1em' : 'color:var(--ink-dim);letter-spacing:.08em';
        p.appendChild(pbEl);
      }
    }
    const last = [...p0.facts].reverse().find((f) => chipFor(f) !== null);
    if (last) {
      const chip = el('p', 'muted', `LAST READ: ${chipFor(last)} → ${last.result.replace(/_/g, ' ')}`);
      chip.style.cssText = 'letter-spacing:.08em';
      p.appendChild(chip);
    }
    if (p0.share) {
      const sh = el('p', 'muted', `CHALLENGE CODE · ${p0.share}`);
      sh.style.cssText = 'font-family:monospace;font-size:11px;letter-spacing:.04em;user-select:text;-webkit-user-select:text';
      p.appendChild(sh);
    }
    const items: FocusItem[] = [
      button('⟳ ONE MORE DRIVE', () => p0.retry()),
      button('HOME', () => ctx.reset('mobileHome'), 'ghost'),
    ];
    items[0].el.style.fontSize = '30px';
    for (const it of items) p.appendChild(it.el);
    s.appendChild(p);
    ctx.root.appendChild(s);
    this.node = s;
    this.ring.set(items);
    this.ring.onNav = (e) => ctx.sound(e === 'select' ? 'select' : 'move');
  }
  update(): void { driveFocus(this.ring, this.ctx.input, this.ctx); }
  unmount(): void { this.node?.remove(); this.node = null; void this.game; }
}
