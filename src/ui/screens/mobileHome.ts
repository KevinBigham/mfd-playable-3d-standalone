/**
 * The phone front door: one dominant action, no mode directory.
 *
 * PLAY DRIVE starts (or RESUME continues) immediately — team grids, seat assignment, and the
 * desktop mode list live behind MORE. Portrait and landscape both work; live play itself asks
 * for landscape through the existing rotate gate.
 */
import type { Screen, ScreenContext, FocusItem } from '../uiKit.ts';
import { el, FocusRing, driveFocus, button, panel } from '../uiKit.ts';
import type { Game } from '../../app/Game.ts';
import { getSave } from '../../persistence/save.ts';
import { TEAM_IDS } from '../../data/index.ts';
import { dailySeed, todayString, dailyDoneToday } from '../../progression/progression.ts';

export class MobileHomeScreen implements Screen {
  name = 'mobileHome';
  private node: HTMLElement | null = null;
  private ring = new FocusRing();
  private ctx!: ScreenContext;
  constructor(private game: Game) {}

  private startDrive(): void {
    const save = getSave();
    // A fresh seed per attempt; the matchup persists so retry stays instant and familiar.
    const home = save.lastTeams.home || TEAM_IDS[0];
    const away = save.lastTeams.away || TEAM_IDS[1];
    this.ctx.go('match', {
      config: {
        seed: (Date.now() & 0x7fffffff) >>> 0,
        home, away, ruleset: 'DRIVE_RUSH', quarterSeconds: 120,
        seats: [{ side: 0, active: true }, { side: 1, active: false }],
        mode: 'QUICKPLAY',
      },
      returnScreen: 'mobileHome',
    });
  }

  mount(ctx: ScreenContext): void {
    this.ctx = ctx;
    const s = el('div', 'go-screen');
    s.appendChild(el('div', 'go-dim'));
    const p = panel('GRIDIRON <em>OVERDRIVE</em>'.replace(/<em>|<\/em>/g, ''));
    (p.querySelector('.go-title') as HTMLElement).innerHTML = 'GRIDIRON <em>OVERDRIVE</em>';
    const items: FocusItem[] = [];
    const suspended = this.game.suspendedMatchLabel();
    if (suspended) {
      items.push(button(`RESUME · ${suspended}`, () => {
        ctx.reset('match', { config: {}, resume: true, returnScreen: 'mobileHome' });
      }));
    }
    const play = button('▶ PLAY DRIVE', () => this.startDrive());
    play.el.style.fontSize = '32px';
    items.push(play);
    // The Daily Drive: the same deterministic problem for everyone today. No streak to lose —
    // the chip just says whether today's is done.
    const today = todayString();
    items.push(button(dailyDoneToday(today) ? `DAILY DRIVE ✓ ${today}` : `DAILY DRIVE · ${today}`, () => {
      const save = getSave();
      this.ctx.go('match', {
        config: {
          seed: dailySeed(today),
          home: save.lastTeams.home || TEAM_IDS[0], away: save.lastTeams.away || TEAM_IDS[1],
          ruleset: 'DRIVE_RUSH', quarterSeconds: 120, difficulty: 'PRO',
          seats: [{ side: 0, active: true }, { side: 1, active: false }],
          mode: 'QUICKPLAY',
        },
        returnScreen: 'mobileHome',
        daily: today,
      });
    }));
    items.push(
      button('CLASSIC MATCH', () => ctx.go('quickPlay'), 'ghost'),
      button('MORE · SEASON, PRACTICE, EDITOR…', () => ctx.go('mainMenu'), 'ghost'),
      button('⚙ SETTINGS', () => ctx.go('settings'), 'ghost'),
    );
    for (const it of items) p.appendChild(it.el);
    s.appendChild(p);
    ctx.root.appendChild(s);
    this.node = s;
    this.ring.set(items);
    this.ring.onNav = (e) => ctx.sound(e === 'select' ? 'select' : 'move');
    this.game.audio.music.start();
  }
  update(): void { driveFocus(this.ring, this.ctx.input, this.ctx); }
  unmount(): void { this.node?.remove(); this.node = null; }
}
