/**
 * Beat My Drive — paste a friend's GO2 challenge code and play their exact drive.
 *
 * The code carries everything (seed, matchup, difficulty, bar to beat) and the decoder is
 * honest about failure: a mistyped code, a truncated one, and a code from a different rules
 * version each get their own explanation instead of silently starting a different game.
 */
import type { Screen, ScreenContext, FocusItem } from '../uiKit.ts';
import { el, FocusRing, driveFocus, button, panel } from '../uiKit.ts';
import type { Game } from '../../app/Game.ts';
import { decodeChallenge, type ChallengeCode } from '../../progression/progression.ts';
import { findTeam } from '../../data/index.ts';

export class ChallengeEntryScreen implements Screen {
  name = 'challengeEntry';
  private node: HTMLElement | null = null;
  private ring = new FocusRing();
  private ctx!: ScreenContext;
  private input: HTMLInputElement | null = null;
  private errorEl: HTMLElement | null = null;
  private typing = false;
  private keyGuard: ((e: KeyboardEvent) => void) | null = null;
  constructor(private game: Game) { void this.game; }

  mount(ctx: ScreenContext): void {
    this.ctx = ctx;
    const s = el('div', 'go-screen');
    s.appendChild(el('div', 'go-dim'));
    const p = panel('BEAT MY DRIVE', 'Enter a challenge code to play the exact same drive — same seed, same matchup — and beat the bar.');

    const input = el('input') as HTMLInputElement;
    input.type = 'text';
    input.placeholder = 'GO2-…';
    input.autocapitalize = 'characters';
    input.spellcheck = false;
    input.maxLength = 64;
    input.style.cssText = 'width:100%;background:#0a0f1a;border:2px solid var(--edge);color:var(--hot-2);'
      + 'font-family:ui-monospace,monospace;font-size:16px;padding:10px 12px;letter-spacing:.06em;margin:10px 0';
    input.addEventListener('focus', () => { this.typing = true; });
    input.addEventListener('blur', () => { this.typing = false; });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { input.blur(); this.submit(); }
      if (e.key === 'Escape') input.blur();
    });
    this.input = input;
    p.appendChild(input);

    // The input manager listens on window; while the code is being typed, swallow key events
    // before they get there (same guard the play editor's name field uses).
    this.keyGuard = (e: KeyboardEvent) => {
      if (this.typing && document.activeElement === this.input) e.stopPropagation();
    };
    window.addEventListener('keydown', this.keyGuard, true);
    window.addEventListener('keyup', this.keyGuard, true);

    const err = el('p', 'muted', '');
    err.style.cssText = 'color:var(--hot-2);min-height:34px;letter-spacing:.04em';
    this.errorEl = err;
    p.appendChild(err);

    const items: FocusItem[] = [
      button('PLAY THE CHALLENGE', () => this.submit()),
      button('PASTE', () => { void this.paste(); }, 'ghost'),
      button('BACK', () => { ctx.sound('back'); ctx.back(); }, 'ghost'),
    ];
    for (const it of items) p.appendChild(it.el);
    s.appendChild(p);
    ctx.root.appendChild(s);
    this.node = s;
    this.ring.set(items);
    this.ring.onNav = (e) => ctx.sound(e === 'select' ? 'select' : 'move');
  }

  private async paste(): Promise<void> {
    try {
      const text = await navigator.clipboard.readText();
      if (this.input && text) { this.input.value = text.trim(); this.setError(''); }
    } catch {
      this.setError('Clipboard not available — long-press the field and paste instead.');
    }
  }

  private setError(text: string): void { if (this.errorEl) this.errorEl.textContent = text; }

  private submit(): void {
    const raw = this.input?.value ?? '';
    if (!raw.trim()) { this.setError('Enter or paste a GO2-… code first.'); this.ctx.sound('error'); return; }
    const r = decodeChallenge(raw);
    if (!r.ok) {
      const lead = r.why === 'CHECKSUM' ? 'CODE CHECK FAILED' : r.why === 'RULES_MISMATCH' ? 'DIFFERENT RULES VERSION' : 'NOT A VALID CODE';
      this.setError(`${lead} — ${r.detail}`);
      this.ctx.sound('error');
      return;
    }
    const c = r.code;
    if (!findTeam(c.home) || !findTeam(c.away)) {
      this.setError('This code names a team this build does not have.');
      this.ctx.sound('error');
      return;
    }
    this.launch(c);
  }

  private launch(c: ChallengeCode): void {
    this.ctx.go('match', {
      config: {
        seed: c.seed, home: c.home, away: c.away,
        ruleset: 'DRIVE_RUSH', quarterSeconds: 120, difficulty: c.difficulty,
        seats: [{ side: 0, active: true }, { side: 1, active: false }],
        mode: 'QUICKPLAY',
      },
      returnScreen: 'mobileHome',
      challenge: { points: c.points, yards: c.yards },
    });
  }

  update(): void {
    if (this.typing) return; // the field owns the keys while focused
    driveFocus(this.ring, this.ctx.input, this.ctx);
  }

  unmount(): void {
    if (this.keyGuard) {
      window.removeEventListener('keydown', this.keyGuard, true);
      window.removeEventListener('keyup', this.keyGuard, true);
      this.keyGuard = null;
    }
    this.typing = false;
    this.input = null;
    this.errorEl = null;
    this.node?.remove();
    this.node = null;
  }
}
