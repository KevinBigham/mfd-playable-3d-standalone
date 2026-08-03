import type { Screen, ScreenContext } from '../uiKit.ts';
import { el, clear, coarsePointer } from '../uiKit.ts';
import { PlaySelect } from '../playSelect.ts';
import { Action } from '../../input/actions.ts';
import type { Game } from '../../app/Game.ts';
import type { MatchConfig } from '../../core/types.ts';
import { PlayGradeTracker } from '../../gameplay/playGrade.ts';
import { recordDrive, markDailyDone, todayString, encodeChallenge } from '../../progression/progression.ts';
import { RULES_VERSION } from '../../core/constants.ts';

export interface MatchParams {
  config: Partial<MatchConfig>;
  /** Where to go when the match finishes. */
  onFinish?: (result: { home: number; away: number }) => void;
  returnScreen?: string;
  /**
   * Pick up the suspended match instead of starting a new one. The screen still owns the match
   * lifecycle either way — it would be too easy for a caller to start the game and then have this
   * screen immediately start another one over the top of it.
   */
  resume?: boolean;
  /** Set when this attempt is the Daily Drive for the given date string. */
  daily?: string;
  /** Set when this attempt is a Beat My Drive challenge: the bar to beat. */
  challenge?: { points: number; yards: number };
}

/**
 * The in-match screen: owns the play-select overlay, pause entry and the conversion prompt.
 * The HUD lives on Game and is always mounted while a match is running.
 */
export class MatchScreen implements Screen {
  name = 'match';
  private ctx!: ScreenContext;
  private ps!: PlaySelect;
  private layer!: HTMLElement;
  private convo: HTMLElement | null = null;
  private game: Game;
  private params: MatchParams | null = null;
  private lastPhase = '';
  private finished = false;
  private grades: PlayGradeTracker | null = null;

  constructor(game: Game) { this.game = game; }

  mount(ctx: ScreenContext, params?: unknown): void {
    this.ctx = ctx;
    this.params = (params as MatchParams) ?? { config: {} };
    this.finished = false;
    this.layer = el('div');
    this.layer.style.cssText = 'position:absolute;inset:0;pointer-events:none';
    ctx.root.appendChild(this.layer);
    this.ps = new PlaySelect(this.layer);
    this.ps.onSound = (k) => ctx.sound(k === 'move' ? 'move' : 'select');

    const m = this.params.resume
      ? (this.game.resumeSuspendedMatch() ?? this.game.startMatch(this.params.config))
      : this.game.startMatch(this.params.config);
    this.grades?.dispose();
    this.grades = new PlayGradeTracker(m);
    this.game.onMatchEnd = () => {
      if (this.finished) return;
      this.finished = true;
      // Drive Rush ends on its own result card with instant retry; Classic keeps the final
      // whistle ceremony.
      if (m.ruleset.endOnDriveEnd) {
        const cfg = this.params?.config ?? {};
        const facts = this.grades?.facts ?? [];
        const st = m.state;
        const scored = st.teams[0].score > 0 && st.teams[0].score > st.teams[1].score;
        const outcome = scored ? 'TOUCHDOWN DRIVE' : st.teams[1].score > 0 ? 'SAFETY — DRIVE OVER' : 'DRIVE OVER';
        const yards = st.teams[0].stats.totalYds;
        const points = st.teams[0].score;
        const pb = recordDrive(m.ruleset.id, m.config.difficulty, m.config.home, points, yards);
        if (this.params?.daily) markDailyDone(this.params.daily === 'today' ? todayString() : this.params.daily);
        const share = encodeChallenge({
          rulesVersion: RULES_VERSION,
          seed: m.config.seed, home: m.config.home, away: m.config.away,
          difficulty: m.config.difficulty, points, yards,
        });
        const challenge = this.params?.challenge;
        setTimeout(() => {
          this.ctx.go('driveResults', {
            outcome, yards, points, facts, pb, share, challenge,
            // A challenge retry replays the SAME drive — that is the whole point of the code.
            // A normal retry rolls the seed so the next drive is a fresh problem.
            retry: () => this.ctx.reset('match', {
              config: challenge ? { ...cfg } : { ...cfg, seed: ((cfg.seed ?? 0) + 1) >>> 0 },
              returnScreen: this.params?.returnScreen ?? 'mobileHome',
              challenge,
            }),
          });
        }, 900);
        return;
      }
      setTimeout(() => {
        this.ctx.go('final', { returnScreen: this.params?.returnScreen ?? 'mainMenu', onFinish: this.params?.onFinish });
      }, 2200);
    };
    this.game.hud.showHelp = this.game.settings.helpPrompts;
    // Silent on a phone. Naming keys to a device with none is worse than saying nothing, and the
    // touch pad's own banner already teaches each verb set at the moment it becomes available —
    // two instruction bars stacked at the bottom of a 390px-tall screen is one too many.
    if (!coarsePointer()) {
      this.game.hud.help('MOVE: stick/WASD · TURBO: RB/Shift · PASS: A/Space · TARGETS: D-pad or U I O', 7);
    }
    void m;
  }

  update(dt: number): void {
    const g = this.game;
    const m = g.match;
    if (!m) return;
    const input = g.input;

    if (input.menuPressed(Action.PAUSE)) {
      // The pause screen acquires its own USER token on mount; nothing here writes pause state.
      this.ctx.go('pause', { returnScreen: 'match' });
      return;
    }

    const phase = m.phase;
    if (phase !== this.lastPhase) {
      this.onPhase(phase);
      this.lastPhase = phase;
    }

    if (this.ps.isActive) this.ps.update(dt, input);

    // Kickoff choice prompt — deep or onside, for a human kicker. Replaces a dead HUD hint that
    // promised a key combo the rules never read.
    if (m.kickoffAwaitingChoice && !this.kickPrompt) this.openKickoff();
    if (!m.kickoffAwaitingChoice && this.kickPrompt) this.closeKickoff();
    if (this.kickPrompt) {
      if (input.menuPressed(Action.LEFT) || input.menuPressed(Action.RIGHT)) {
        this.kickPick = this.kickPick === 'DEEP' ? 'ONSIDE' : 'DEEP';
        this.paintKickoff();
        this.ctx.sound('move');
      }
      if (input.menuPressed(Action.ACTION)) {
        m.submitKickoff(this.kickPick);
        this.ctx.sound('select');
        this.closeKickoff();
      }
    }

    // Conversion choice prompt.
    if (phase === 'CONVERSION_CALL' && m.isHuman(m.state.possession) && !this.convo) this.openConversion();
    if (phase !== 'CONVERSION_CALL' && this.convo) this.closeConversion();
    if (this.convo) {
      if (input.menuPressed(Action.LEFT) || input.menuPressed(Action.RIGHT)) {
        this.convoPick = this.convoPick === 'KICK' ? 'TWO' : 'KICK';
        this.paintConversion();
        this.ctx.sound('move');
      }
      if (input.menuPressed(Action.ACTION)) {
        m.submitConversion(this.convoPick);
        this.ctx.sound('select');
        this.closeConversion();
      }
    }
  }

  private convoPick: 'KICK' | 'TWO' = 'KICK';
  private kickPrompt: HTMLElement | null = null;
  private kickPick: 'DEEP' | 'ONSIDE' = 'DEEP';

  private openKickoff(): void {
    this.kickPick = 'DEEP';
    const box = el('div', 'go-panel');
    box.style.cssText = 'position:absolute;left:50%;top:52%;transform:translate(-50%,-50%);min-width:420px;pointer-events:auto';
    box.appendChild(el('h2', 'go-title', 'KICKOFF'));
    const row = el('div', 'row');
    row.style.justifyContent = 'center';
    const deep = el('div', 'go-btn', 'KICK DEEP');
    const onside = el('div', 'go-btn', 'ONSIDE KICK');
    deep.style.width = '48%'; onside.style.width = '48%';
    deep.addEventListener('click', () => { this.game.match?.submitKickoff('DEEP'); this.closeKickoff(); });
    onside.addEventListener('click', () => { this.game.match?.submitKickoff('ONSIDE'); this.closeKickoff(); });
    row.append(deep, onside);
    box.appendChild(row);
    this.layer.appendChild(box);
    this.kickPrompt = box;
    this.paintKickoff();
  }

  private paintKickoff(): void {
    if (!this.kickPrompt) return;
    const btns = this.kickPrompt.querySelectorAll('.go-btn');
    btns[0]?.classList.toggle('focused', this.kickPick === 'DEEP');
    btns[1]?.classList.toggle('focused', this.kickPick === 'ONSIDE');
  }

  private closeKickoff(): void {
    if (!this.kickPrompt) return;
    this.kickPrompt.remove();
    this.kickPrompt = null;
  }

  private onPhase(phase: string): void {
    const g = this.game;
    const m = g.match!;
    if (phase === 'PLAY_CALL') {
      if (m.anyHuman()) this.ps.open(m);
    } else if (this.ps.isActive) {
      this.ps.close();
    }
    if (phase === 'PRE_SNAP' && m.isHuman(m.state.possession) && !coarsePointer()) {
      g.hud.help('PASS/A to snap · MOTION to shift a receiver · AUDIBLE to change the call', 2.4);
    }
    // The old hint here promised an onside key combo the rules never read. The real choice is
    // now the on-screen kickoff prompt, which works for every input device.
  }

  private openConversion(): void {
    this.convoPick = 'KICK';
    const box = el('div', 'go-panel');
    box.style.cssText = 'position:absolute;left:50%;top:52%;transform:translate(-50%,-50%);min-width:420px;pointer-events:auto';
    box.appendChild(el('h2', 'go-title', 'CONVERSION'));
    const row = el('div', 'row');
    row.style.justifyContent = 'center';
    const kick = el('div', 'go-btn', 'KICK · 1 PT');
    const two = el('div', 'go-btn', 'GO FOR TWO');
    kick.style.width = '48%'; two.style.width = '48%';
    kick.addEventListener('click', () => { this.game.match?.submitConversion('KICK'); this.closeConversion(); });
    two.addEventListener('click', () => { this.game.match?.submitConversion('TWO'); this.closeConversion(); });
    row.append(kick, two);
    box.appendChild(row);
    this.layer.appendChild(box);
    this.convo = box;
    this.paintConversion();
  }

  private paintConversion(): void {
    if (!this.convo) return;
    const btns = this.convo.querySelectorAll('.go-btn');
    btns[0]?.classList.toggle('focused', this.convoPick === 'KICK');
    btns[1]?.classList.toggle('focused', this.convoPick === 'TWO');
  }

  private closeConversion(): void {
    if (!this.convo) return;
    this.convo.remove();
    this.convo = null;
  }

  unmount(): void {
    this.grades?.dispose();
    this.grades = null;
    this.ps?.close();
    this.closeConversion();
    this.closeKickoff();
    clear(this.layer);
    this.layer.remove();
  }
}
