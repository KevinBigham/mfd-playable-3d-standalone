import type { Screen, ScreenContext, FocusItem } from '../uiKit.ts';
import {
  el, clear, FocusRing, driveFocus, button, optionRow, sliderRow, panel, svgNode, ordinal,
  coarsePointer,
} from '../uiKit.ts';
import { Action } from '../../input/actions.ts';
import type { Game } from '../../app/Game.ts';
import type { PauseToken } from '../../app/pauseController.ts';
import type { Difficulty, TeamDef, TeamSide, WeatherKind } from '../../core/types.ts';
import { TEAMS, getTeam, teamLogoSvg, STADIUMS, getStadium } from '../../data/index.ts';
import { QUARTER_OPTIONS } from '../../core/constants.ts';
import { getSave, writeSave, flushSave, resetSave, defaultSettings, storageKind } from '../../persistence/save.ts';
import type { QualityTier } from '../../render/registry.ts';
import { ACTION_LABELS, type ActionName } from '../../input/actions.ts';

const DIFFS: Difficulty[] = ['ROOKIE', 'PRO', 'ALLSTAR', 'LEGEND'];
const WEATHERS: WeatherKind[] = ['CLEAR', 'RAIN', 'SNOW', 'FOG', 'WIND', 'HEAT'];
const QUALITIES: QualityTier[] = ['LOW', 'MEDIUM', 'HIGH'];

function screenShell(cls = ''): HTMLElement {
  const s = el('div', `go-screen ${cls}`.trim());
  s.appendChild(el('div', 'go-dim'));
  return s;
}

// ── TITLE ────────────────────────────────────────────────────────────────
export class TitleScreen implements Screen {
  name = 'title';
  private node: HTMLElement | null = null;
  private ctx!: ScreenContext;
  private t = 0;
  private tapped = false;
  constructor(private game: Game) {}
  mount(ctx: ScreenContext): void {
    this.ctx = ctx;
    this.tapped = false;
    const s = screenShell();
    const mark = el('div');
    mark.style.cssText = 'text-align:center;position:relative';
    const l1 = el('div', '', 'GRIDIRON');
    l1.style.cssText = 'font-size:clamp(46px,10vw,132px);letter-spacing:6px;transform:skewX(-9deg);text-shadow:0 8px 0 #000';
    const l2 = el('div', '', 'OVERDRIVE');
    l2.style.cssText = 'font-size:clamp(52px,12vw,158px);letter-spacing:2px;color:var(--hot);transform:skewX(-9deg);text-shadow:0 8px 0 #6d1800, 0 0 60px rgba(255,90,30,.55);margin-top:-14px';
    const sub = el('div', 'muted', 'ORIGINAL 7-ON-7 ARCADE FOOTBALL · UNITED GRIDIRON CIRCUIT');
    sub.style.cssText = 'letter-spacing:.32em;margin-top:16px;font-size:14px';
    // A phone has no START button. Ask for what the device can actually do.
    const prompt = el('div', '', coarsePointer() ? 'TAP TO START' : 'PRESS START');
    prompt.style.cssText = 'margin-top:52px;font-size:26px;letter-spacing:.3em;animation:pulse .9s ease-in-out infinite alternate';
    mark.append(l1, l2, sub, prompt);
    s.appendChild(mark);
    /**
     * Touch users had no way off this screen: update() only ever asked the keyboard and the
     * gamepad. The listener is `click`, not `pointerdown`, and it only raises a flag that
     * update() consumes on the next frame. Both of those are deliberate. `click` is the last
     * event of a tap, so the title is still mounted when the sequence finishes; advancing on
     * `pointerdown` instead would unmount it under a finger that has not lifted yet, and the
     * release would land on whatever main-menu button had moved into that spot.
     */
    s.style.cursor = 'pointer';
    s.addEventListener('click', () => { this.tapped = true; });
    ctx.root.appendChild(s);
    this.node = s;
    this.game.audio.music.start();
  }
  update(dt: number): void {
    this.t += dt;
    const i = this.ctx.input;
    if (this.tapped || i.menuPressed(Action.ACTION) || i.menuPressed(Action.PAUSE)) {
      this.tapped = false;
      this.ctx.sound('select');
      this.ctx.go('mainMenu');
    }
  }
  unmount(): void { this.node?.remove(); this.node = null; }
}

// ── MAIN MENU ────────────────────────────────────────────────────────────
export class MainMenuScreen implements Screen {
  name = 'mainMenu';
  private node: HTMLElement | null = null;
  private ring = new FocusRing();
  private ctx!: ScreenContext;
  constructor(private game: Game) {}
  mount(ctx: ScreenContext): void {
    this.ctx = ctx;
    const s = screenShell();
    const p = panel('GRIDIRON <em>OVERDRIVE</em>'.replace(/<em>|<\/em>/g, ''), 'CHOOSE YOUR MODE');
    (p.querySelector('.go-title') as HTMLElement).innerHTML = 'GRIDIRON <em>OVERDRIVE</em>';
    const save = getSave();
    const items: FocusItem[] = [];
    // A game you walked away from is the first thing you want back, so it goes above everything
    // else — and it names the score and the clock, because "CONTINUE" on its own is a question.
    const suspended = this.game.suspendedMatchLabel();
    if (suspended) {
      items.push(button(`CONTINUE MATCH · ${suspended}`, () => {
        ctx.reset('match', { config: {}, resume: true, returnScreen: 'mainMenu' });
      }));
    }
    items.push(
      button('QUICK PLAY', () => ctx.go('quickPlay')),
      button('TOURNAMENT', () => ctx.go('tournament')),
      button(save.season ? 'SEASON · CONTINUE' : 'SEASON', () => ctx.go('season')),
      button('PRACTICE', () => ctx.go('practice')),
      button('PLAY EDITOR', () => ctx.go('playEditor')),
      button('SETTINGS', () => ctx.go('settings')),
      button('CONTROLS', () => ctx.go('controls')),
      button('CREDITS & LEGAL', () => ctx.go('credits')),
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

// ── QUICK PLAY SETUP ─────────────────────────────────────────────────────
interface QuickPlayState {
  home: string; away: string; stadium: string; weather: WeatherKind;
  difficulty: Difficulty; quarterSeconds: number;
  seats: Array<{ side: TeamSide; active: boolean }>;
  step: 'SEATS' | 'HOME' | 'AWAY' | 'OPTIONS';
}

export class QuickPlayScreen implements Screen {
  name = 'quickPlay';
  private node: HTMLElement | null = null;
  private ring = new FocusRing();
  private ctx!: ScreenContext;
  private st!: QuickPlayState;
  constructor(private game: Game) {}

  mount(ctx: ScreenContext): void {
    this.ctx = ctx;
    const save = getSave();
    this.st = {
      home: save.lastTeams.home || TEAMS[0].id,
      away: save.lastTeams.away || TEAMS[1].id,
      stadium: '',
      weather: save.lastTeams.weather || 'CLEAR',
      difficulty: save.settings.difficulty,
      quarterSeconds: save.settings.quarterSeconds,
      seats: [{ side: 0, active: true }, { side: 1, active: false }, { side: 0, active: false }, { side: 1, active: false }],
      step: 'SEATS',
    };
    this.game.input.refreshPads();
    const s = screenShell();
    ctx.root.appendChild(s);
    this.node = s;
    this.render();
  }

  private render(): void {
    const s = this.node!;
    clear(s);
    s.appendChild(el('div', 'go-dim'));
    switch (this.st.step) {
      case 'SEATS': this.renderSeats(s); break;
      case 'HOME': this.renderTeams(s, true); break;
      case 'AWAY': this.renderTeams(s, false); break;
      default: this.renderOptions(s); break;
    }
  }

  private renderSeats(s: HTMLElement): void {
    const p = panel('PLAYERS', 'Assign seats. Empty seats are played by the CPU.');
    const pads = this.game.input.connectedPads();
    p.appendChild(el('p', 'muted', pads.length
      ? `${pads.length} controller${pads.length > 1 ? 's' : ''} detected · seat 1 uses the keyboard when no pad is present`
      : 'No controllers detected · seat 1 = keyboard (WASD), seat 2 = arrows + numpad'));
    const items: FocusItem[] = [];
    for (let i = 0; i < 4; i++) {
      const seat = this.st.seats[i];
      const row = optionRow<string>({
        label: `SEAT ${i + 1}`,
        values: ['OFF', 'HOME', 'AWAY'],
        get: () => (!seat.active ? 'OFF' : seat.side === 0 ? 'HOME' : 'AWAY'),
        set: (v) => {
          if (v === 'OFF') seat.active = false;
          else { seat.active = true; seat.side = v === 'HOME' ? 0 : 1; }
        },
      });
      items.push(row);
      p.appendChild(row.el);
    }
    const next = button('CHOOSE HOME TEAM →', () => { this.st.step = 'HOME'; this.render(); });
    const back = button('BACK', () => this.ctx.back(), 'ghost');
    items.push(next, back);
    p.append(next.el, back.el);
    s.appendChild(p);
    this.ring.set(items);
    this.ring.onNav = (e) => this.ctx.sound(e === 'select' ? 'select' : 'move');
  }

  private renderTeams(s: HTMLElement, home: boolean): void {
    const p = panel(home ? 'HOME TEAM' : 'AWAY TEAM', 'Ratings shape play style, not raw power.');
    p.classList.add('wide');
    const grid = el('div', 'go-grid teams');
    const detail = el('div', 'muted');
    detail.style.cssText = 'min-height:44px;margin-top:10px';
    const items: FocusItem[] = [];
    TEAMS.forEach((t, i) => {
      const card = el('div', 'go-card');
      card.appendChild(svgNode(teamLogoSvg(t, 96), 'logo'));
      card.appendChild(el('div', 'ct', t.city.toUpperCase()));
      card.appendChild(el('div', 'nm', t.name.toUpperCase()));
      const bar = el('div', 'bar');
      bar.style.background = t.colors.primary;
      card.appendChild(bar);
      card.style.borderColor = t.colors.primary;
      const pick = () => {
        if (home) this.st.home = t.id; else this.st.away = t.id;
        if (home) { this.st.step = 'AWAY'; } else { this.st.stadium = getTeam(this.st.home).stadium; this.st.step = 'OPTIONS'; }
        this.render();
      };
      card.addEventListener('click', pick);
      card.addEventListener('mouseenter', () => { detail.textContent = `${t.blurb} · PASS ${t.power.passing} RUN ${t.power.running} LINE ${t.power.line} COV ${t.power.coverage} ST ${t.power.special}`; });
      grid.appendChild(card);
      items.push({ el: card, onSelect: pick, row: Math.floor(i / 5), col: i % 5 });
    });
    p.append(grid, detail);
    const back = button('BACK', () => { this.st.step = home ? 'SEATS' : 'HOME'; this.render(); }, 'ghost');
    p.appendChild(back.el);
    items.push({ ...back, row: 99, col: 0 });
    s.appendChild(p);
    this.ring.set(items);
    const cur = home ? this.st.home : this.st.away;
    const idx = TEAMS.findIndex((t) => t.id === cur);
    if (idx >= 0) this.ring.focusIndex(idx);
    this.ring.onNav = (e) => {
      this.ctx.sound(e === 'select' ? 'select' : 'move');
      const it = this.ring.items[this.ring.index];
      const t = TEAMS[this.ring.index];
      if (t && it) detail.textContent = `${t.blurb} · PASS ${t.power.passing} RUN ${t.power.running} LINE ${t.power.line} COV ${t.power.coverage} ST ${t.power.special}`;
    };
  }

  private renderOptions(s: HTMLElement): void {
    const home = getTeam(this.st.home);
    const away = getTeam(this.st.away);
    const p = panel('MATCH SETUP');
    p.classList.add('wide');
    const strip = el('div', 'vs-strip');
    const mk = (t: TeamDef) => {
      const d = el('div', 'side');
      d.appendChild(svgNode(teamLogoSvg(t, 132)));
      d.appendChild(el('div', 'nm', `${t.city.toUpperCase()} ${t.name.toUpperCase()}`));
      return d;
    };
    strip.append(mk(home), el('div', 'vs', 'VS'), mk(away));
    p.appendChild(strip);

    const stadiumIds = [home.stadium, away.stadium, ...STADIUMS.filter((x) => x.id.includes('neutral')).map((x) => x.id)];
    const items: FocusItem[] = [
      optionRow<string>({
        label: 'STADIUM', values: stadiumIds,
        format: (v) => getStadium(v).name.toUpperCase(),
        get: () => this.st.stadium || home.stadium, set: (v) => { this.st.stadium = v; },
      }),
      optionRow<WeatherKind>({ label: 'WEATHER', values: WEATHERS, get: () => this.st.weather, set: (v) => { this.st.weather = v; } }),
      optionRow<Difficulty>({ label: 'DIFFICULTY', values: DIFFS, get: () => this.st.difficulty, set: (v) => { this.st.difficulty = v; } }),
      optionRow<number>({
        label: 'QUARTER LENGTH', values: QUARTER_OPTIONS,
        format: (v) => `${v / 60}:00`, get: () => this.st.quarterSeconds, set: (v) => { this.st.quarterSeconds = v; },
      }),
    ];
    for (const it of items) p.appendChild(it.el);
    const kick = button('KICK OFF', () => this.launch());
    const back = button('BACK', () => { this.st.step = 'AWAY'; this.render(); }, 'ghost');
    items.push(kick, back);
    p.append(kick.el, back.el);
    s.appendChild(p);
    this.ring.set(items);
    this.ring.focusIndex(items.length - 2);
    this.ring.onNav = (e) => this.ctx.sound(e === 'select' ? 'select' : 'move');
  }

  private launch(): void {
    const save = getSave();
    save.lastTeams = { home: this.st.home, away: this.st.away, stadium: this.st.stadium, weather: this.st.weather };
    save.settings.difficulty = this.st.difficulty;
    save.settings.quarterSeconds = this.st.quarterSeconds;
    writeSave();
    this.game.settings = save.settings;
    this.ctx.go('match', {
      config: {
        seed: (Date.now() & 0x7fffffff) >>> 0,
        home: this.st.home, away: this.st.away, stadium: this.st.stadium,
        weather: this.st.weather, difficulty: this.st.difficulty,
        quarterSeconds: this.st.quarterSeconds, seats: this.st.seats, mode: 'QUICKPLAY',
      },
      returnScreen: 'mainMenu',
    });
  }

  update(): void {
    const i = this.ctx.input;
    if (i.menuPressed(Action.UP)) this.ring.move(0, -1);
    if (i.menuPressed(Action.DOWN)) this.ring.move(0, 1);
    if (i.menuPressed(Action.LEFT)) { if (this.ring.items[this.ring.index]?.onLeft) this.ring.adjust(-1); else this.ring.move(-1, 0); }
    if (i.menuPressed(Action.RIGHT)) { if (this.ring.items[this.ring.index]?.onRight) this.ring.adjust(1); else this.ring.move(1, 0); }
    if (i.menuPressed(Action.ACTION)) this.ring.select();
    if (i.menuPressed(Action.BACK)) {
      this.ctx.sound('back');
      if (this.st.step === 'SEATS') this.ctx.back();
      else { this.st.step = this.st.step === 'HOME' ? 'SEATS' : this.st.step === 'AWAY' ? 'HOME' : 'AWAY'; this.render(); }
    }
  }

  unmount(): void { this.node?.remove(); this.node = null; }
}

// ── PAUSE ────────────────────────────────────────────────────────────────
export class PauseScreen implements Screen {
  name = 'pause';
  private node: HTMLElement | null = null;
  private ring = new FocusRing();
  private ctx!: ScreenContext;
  /**
   * The USER pause token. Held from the moment this screen first mounts until the player
   * explicitly resumes or quits — and deliberately NOT released by `unmount()`, because
   * navigating to Settings unmounts this screen while the match must stay frozen behind it.
   * That unmount-unpauses write was the shipped bug: ten seconds in Settings meant ten seconds
   * of hidden play.
   */
  private token: PauseToken | null = null;
  constructor(private game: Game) {}
  private resume(): void {
    this.game.pause.release(this.token);
    this.token = null;
    this.ctx.back();
  }
  mount(ctx: ScreenContext): void {
    this.ctx = ctx;
    if (!this.token) this.token = this.game.pause.acquire('USER');
    const s = screenShell();
    const p = panel('PAUSED');
    const items: FocusItem[] = [
      button('RESUME', () => this.resume()),
      button('SETTINGS', () => ctx.go('settings')),
      button('CONTROLS', () => ctx.go('controls')),
    ];
    // Saving and quitting is only offered when there is something worth keeping. A finished match
    // is a result, not a game in progress, and offering to "continue" into a final whistle is
    // worse than not offering at all.
    if (this.game.match && !this.game.match.state.finished) {
      items.push(button(storageKind() === 'MEMORY' ? 'SAVE & QUIT (SESSION ONLY)' : 'SAVE & QUIT', () => {
        this.token = null; // endMatch clears every reason
        if (!this.game.suspendMatch()) this.game.endMatch();
        ctx.reset('mainMenu');
      }));
    }
    items.push(
      button('QUIT TO MENU', () => {
        this.token = null; // endMatch clears every reason
        this.game.discardSuspendedMatch();
        this.game.endMatch();
        ctx.reset('mainMenu');
      }, 'danger'),
    );
    for (const it of items) p.appendChild(it.el);
    s.appendChild(p);
    ctx.root.appendChild(s);
    this.node = s;
    this.ring.set(items);
    this.ring.onNav = (e) => ctx.sound(e === 'select' ? 'select' : 'move');
  }
  update(): void {
    const i = this.ctx.input;
    if (i.menuPressed(Action.PAUSE)) { this.resume(); return; }
    driveFocus(this.ring, i, this.ctx);
  }
  unmount(): void { this.node?.remove(); this.node = null; }
}

// ── SETTINGS ─────────────────────────────────────────────────────────────
export class SettingsScreen implements Screen {
  name = 'settings';
  private node: HTMLElement | null = null;
  private ring = new FocusRing();
  private ctx!: ScreenContext;
  /** Holds MODAL while mounted so opening Settings over Pause can never resume the hidden match. */
  private token: PauseToken | null = null;
  constructor(private game: Game) {}
  mount(ctx: ScreenContext): void {
    this.ctx = ctx;
    this.token = this.game.pause.acquire('MODAL');
    const g = this.game;
    const st = g.settings;
    const apply = () => { g.applySettings(); };
    const s = screenShell();
    const p = panel('SETTINGS');
    p.classList.add('wide');
    const items: FocusItem[] = [
      optionRow<Difficulty>({ label: 'DIFFICULTY', values: DIFFS, get: () => st.difficulty, set: (v) => { st.difficulty = v; }, }, apply),
      optionRow<number>({ label: 'QUARTER LENGTH', values: QUARTER_OPTIONS, format: (v) => `${v / 60}:00`, get: () => st.quarterSeconds, set: (v) => { st.quarterSeconds = v; } }, apply),
      optionRow<boolean>({ label: 'PLAY CLOCK', values: [false, true], format: (v) => (v ? 'ON' : 'OFF'), get: () => st.playClock, set: (v) => { st.playClock = v; } }, apply),
      optionRow<string>({ label: 'PASSING', values: ['ICON', 'DIRECTIONAL'], get: () => st.passingMode, set: (v) => { st.passingMode = v as 'ICON' | 'DIRECTIONAL'; } }, apply),
      optionRow<boolean>({ label: 'HELP PROMPTS', values: [true, false], format: (v) => (v ? 'ON' : 'OFF'), get: () => st.helpPrompts, set: (v) => { st.helpPrompts = v; g.hud.showHelp = v; } }, apply),
      optionRow<boolean>({ label: 'COMEBACK ASSIST', values: [true, false], format: (v) => (v ? 'ON' : 'OFF'), get: () => st.catchUpBias, set: (v) => { st.catchUpBias = v; } }, apply),
      optionRow<boolean>({ label: 'POST-WHISTLE SHOVES', values: [false, true], format: (v) => (v ? 'ON' : 'OFF'), get: () => st.lateHits, set: (v) => { st.lateHits = v; } }, apply),
      sliderRow('CAMERA SHAKE', () => st.cameraShake, (v) => { st.cameraShake = v; }, 0.1, apply),
      sliderRow('SCREEN FLASH', () => st.screenFlash, (v) => { st.screenFlash = v; }, 0.1, apply),
      optionRow<boolean>({ label: 'REDUCED MOTION', values: [false, true], format: (v) => (v ? 'ON' : 'OFF'), get: () => st.reducedMotion, set: (v) => { st.reducedMotion = v; } }, apply),
      optionRow<boolean>({ label: 'LARGE HUD', values: [false, true], format: (v) => (v ? 'ON' : 'OFF'), get: () => st.largeHud, set: (v) => { st.largeHud = v; } }, apply),
      optionRow<boolean>({ label: 'COLOUR-SAFE MARKERS', values: [false, true], format: (v) => (v ? 'ON' : 'OFF'), get: () => st.colorBlindMarkers, set: (v) => { st.colorBlindMarkers = v; } }, apply),
      sliderRow('MASTER VOLUME', () => st.volumes.master, (v) => { st.volumes.master = v; }, 0.05, apply),
      sliderRow('EFFECTS', () => st.volumes.sfx, (v) => { st.volumes.sfx = v; }, 0.05, apply),
      sliderRow('CROWD', () => st.volumes.crowd, (v) => { st.volumes.crowd = v; }, 0.05, apply),
      sliderRow('STINGERS', () => st.volumes.music, (v) => { st.volumes.music = v; }, 0.05, apply),
      sliderRow('INTERFACE', () => st.volumes.ui, (v) => { st.volumes.ui = v; }, 0.05, apply),
      optionRow<QualityTier>({ label: 'GRAPHICS', values: QUALITIES, get: () => st.quality, set: (v) => { st.quality = v; } }, apply),
      optionRow<number>({ label: 'RESOLUTION SCALE', values: [0.5, 0.65, 0.8, 1], format: (v) => `${Math.round(v * 100)}%`, get: () => st.resolutionScale, set: (v) => { st.resolutionScale = v; } }, apply),
      optionRow<boolean>({ label: 'ADAPTIVE RESOLUTION', values: [false, true], format: (v) => (v ? 'ON' : 'OFF'), get: () => st.dynamicResolution, set: (v) => { st.dynamicResolution = v; } }, apply),
      optionRow<boolean>({
        label: 'FULLSCREEN', values: [false, true], format: (v) => (v ? 'ON' : 'OFF'),
        get: () => !!document.fullscreenElement,
        // An embedded page is usually denied fullscreen, and browsers disagree about whether the
        // refusal is a rejected promise or a synchronous throw. Both are non-events here.
        set: (v) => {
          try {
            const p = v ? document.documentElement.requestFullscreen?.() : document.exitFullscreen?.();
            p?.catch(() => { /* refused */ });
          } catch { /* refused synchronously */ }
        },
      }),
      button('RESET SAVED DATA', () => {
        resetSave();
        g.settings = defaultSettings();
        g.applySettings();
        ctx.sound('select');
        this.ctx.replace('settings');
      }, 'danger'),
      button('BACK', () => ctx.back(), 'ghost'),
    ];
    const scroll = el('div', 'scroll');
    for (const it of items) scroll.appendChild(it.el);
    // Honesty about durability: when storage is unavailable (private browsing, sandboxed frame,
    // full quota) the game keeps working from memory — but the player must not believe a season
    // will survive a reload when it will not.
    if (storageKind() === 'MEMORY') {
      const warn = el('p', 'muted',
        '⚠ STORAGE UNAVAILABLE — settings and saves last only for this session.');
      warn.style.cssText = 'color:var(--bad,#ff7a5c);letter-spacing:.06em';
      scroll.appendChild(warn);
    }
    p.appendChild(scroll);
    s.appendChild(p);
    ctx.root.appendChild(s);
    this.node = s;
    this.ring.set(items);
    this.ring.onNav = (e) => ctx.sound(e === 'select' ? 'select' : 'move');
  }
  update(): void { driveFocus(this.ring, this.ctx.input, this.ctx); }
  unmount(): void {
    writeSave({ settings: this.game.settings });
    flushSave();
    this.game.pause.release(this.token);
    this.token = null;
    this.node?.remove(); this.node = null;
  }
}

// ── CONTROLS ─────────────────────────────────────────────────────────────
export class ControlsScreen implements Screen {
  name = 'controls';
  private node: HTMLElement | null = null;
  private ring = new FocusRing();
  private ctx!: ScreenContext;
  private rebinding: ActionName | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  /** Holds MODAL while mounted — same contract as Settings. */
  private token: PauseToken | null = null;
  constructor(private game: Game) {}

  mount(ctx: ScreenContext): void {
    this.ctx = ctx;
    this.token = this.game.pause.acquire('MODAL');
    const s = screenShell();
    ctx.root.appendChild(s);
    this.node = s;
    this.render();
    this.keyHandler = (e: KeyboardEvent) => {
      if (!this.rebinding) return;
      e.preventDefault();
      const b = this.game.settings.bindings[0];
      for (const k of Object.keys(b)) if (b[k] === this.rebinding) delete b[k];
      b[e.code] = this.rebinding;
      this.rebinding = null;
      this.game.applySettings();
      this.render();
    };
    window.addEventListener('keydown', this.keyHandler, true);
  }

  private render(): void {
    const s = this.node!;
    clear(s);
    s.appendChild(el('div', 'go-dim'));
    const p = panel('CONTROLS', 'Seat 1 keyboard is remappable. Controllers use the standard layout.');
    p.classList.add('wide');
    const b = this.game.settings.bindings[0];
    const table = el('table', 'go-table');
    const rows: FocusItem[] = [];
    const order: ActionName[] = [
      'UP', 'DOWN', 'LEFT', 'RIGHT', 'TURBO', 'ACTION', 'JUMP', 'DIVE', 'SPECIAL',
      'TARGET_L', 'TARGET_M', 'TARGET_R', 'LOB', 'AUDIBLE', 'MOTION', 'PAGE', 'HIDE_PLAY', 'PAUSE',
    ];
    for (const a of order) {
      const key = Object.keys(b).find((k) => b[k] === a) ?? '—';
      const tr = el('tr');
      const td1 = el('td', '', ACTION_LABELS[a]);
      const td2 = el('td', 'mono', this.rebinding === a ? 'PRESS A KEY…' : key.replace('Key', '').replace('Digit', ''));
      tr.append(td1, td2);
      table.appendChild(tr);
      rows.push({
        el: tr as unknown as HTMLElement,
        onSelect: () => { this.rebinding = a; this.render(); },
      });
    }
    const gp = el('div', 'muted');
    gp.innerHTML = `
      <b>GAMEPAD</b> — Left stick: move · A: pass / snap / switch · B: jump / tackle / hurdle ·
      X: dive · Y: spin / power tackle · RB or RT: turbo · LB: touch pass ·
      D-pad ◀ ▲ ▶: throw to left / middle / right receiver · LT: audible · Start: pause.<br>
      <b>COMBOS</b> — Turbo + B = high hurdle (carrier) / power tackle (defence) ·
      Turbo + A = bullet pass (QB) / stiff arm (carrier past the line) · A past the line = lateral.`;
    p.append(table, gp);
    const back = button('BACK', () => this.ctx.back(), 'ghost');
    rows.push(back);
    p.appendChild(back.el);
    s.appendChild(p);
    this.ring.set(rows, true);
    this.ring.onNav = (e) => this.ctx.sound(e === 'select' ? 'select' : 'move');
  }

  update(): void { if (!this.rebinding) driveFocus(this.ring, this.ctx.input, this.ctx); }
  unmount(): void {
    if (this.keyHandler) window.removeEventListener('keydown', this.keyHandler, true);
    this.game.pause.release(this.token);
    this.token = null;
    this.node?.remove(); this.node = null;
  }
}

// ── FINAL STATS ──────────────────────────────────────────────────────────
export class FinalScreen implements Screen {
  name = 'final';
  private node: HTMLElement | null = null;
  private ring = new FocusRing();
  private ctx!: ScreenContext;
  constructor(private game: Game) {}
  mount(ctx: ScreenContext, params?: unknown): void {
    this.ctx = ctx;
    const p2 = (params as { returnScreen?: string; onFinish?: (r: { home: number; away: number }) => void }) ?? {};
    const m = this.game.match;
    const s = screenShell();
    const p = panel('FINAL');
    p.classList.add('wide');
    if (m && this.game.matchTeams) {
      const [home, away] = this.game.matchTeams;
      const st = m.state;
      const strip = el('div', 'vs-strip');
      const side = (t: TeamDef, score: number, win: boolean) => {
        const d = el('div', 'side');
        d.appendChild(svgNode(teamLogoSvg(t, 118)));
        d.appendChild(el('div', 'nm', t.name.toUpperCase()));
        const sc = el('div', 'big-num', String(score));
        if (win) sc.style.color = 'var(--hot-2)';
        d.appendChild(sc);
        return d;
      };
      const w = st.winner;
      strip.append(
        side(home, st.teams[0].score, w === 0),
        el('div', 'vs', w === 'TIE' ? 'TIE' : 'FINAL'),
        side(away, st.teams[1].score, w === 1),
      );
      p.appendChild(strip);
      if (st.overtimePeriod > 0) p.appendChild(el('p', 'muted', `Decided in overtime period ${st.overtimePeriod}${st.quarter > 4 ? ` (${ordinal(st.quarter)})` : ''}`));

      const table = el('table', 'go-table');
      const head = el('tr');
      head.append(el('th', '', 'TEAM STATS'), el('th', '', home.abbr), el('th', '', away.abbr));
      table.appendChild(head);
      const rows: Array<[string, number, number]> = [
        ['First downs', st.teams[0].stats.firstDowns, st.teams[1].stats.firstDowns],
        ['Total yards', st.teams[0].stats.totalYds, st.teams[1].stats.totalYds],
        ['Passing yards', st.teams[0].stats.passYds, st.teams[1].stats.passYds],
        ['Rushing yards', st.teams[0].stats.rushYds, st.teams[1].stats.rushYds],
        ['Completions', st.teams[0].stats.passComp, st.teams[1].stats.passComp],
        ['Attempts', st.teams[0].stats.passAtt, st.teams[1].stats.passAtt],
        ['Sacks', st.teams[0].stats.sacks, st.teams[1].stats.sacks],
        ['Interceptions', st.teams[0].stats.ints, st.teams[1].stats.ints],
        ['Forced fumbles', st.teams[0].stats.forcedFumbles, st.teams[1].stats.forcedFumbles],
        ['Big hits', st.teams[0].stats.bigHits, st.teams[1].stats.bigHits],
        ['Overdrives', st.teams[0].stats.overdrives, st.teams[1].stats.overdrives],
        ['Longest play', st.teams[0].stats.longestPlay, st.teams[1].stats.longestPlay],
      ];
      for (const [label, a, b] of rows) {
        const tr = el('tr');
        tr.append(el('td', '', label), el('td', '', String(Math.round(a))), el('td', '', String(Math.round(b))));
        table.appendChild(tr);
      }
      p.appendChild(table);

      const save = getSave();
      save.records.gamesPlayed++;
      if (w === 0) save.records.wins++; else if (w === 1) save.records.losses++; else save.records.ties++;
      save.records.mostPoints = Math.max(save.records.mostPoints, st.teams[0].score, st.teams[1].score);
      writeSave();
      p2.onFinish?.({ home: st.teams[0].score, away: st.teams[1].score });
    }

    const items: FocusItem[] = [
      button('REMATCH', () => {
        const cfg = this.game.match?.config;
        this.game.endMatch();
        ctx.reset('match', {
          config: { ...cfg, seed: (Date.now() & 0x7fffffff) >>> 0 },
          returnScreen: p2.returnScreen ?? 'mainMenu',
          // Carry the callback through so a rematched tournament/season fixture still records.
          onFinish: p2.onFinish,
        });
      }),
      button('MAIN MENU', () => { this.game.endMatch(); ctx.reset(p2.returnScreen ?? 'mainMenu'); }),
    ];
    for (const it of items) p.appendChild(it.el);
    s.appendChild(p);
    ctx.root.appendChild(s);
    this.node = s;
    this.ring.set(items);
    this.ring.onNav = (e) => ctx.sound(e === 'select' ? 'select' : 'move');
  }
  update(): void { driveFocus(this.ring, this.ctx.input, this.ctx); }
  unmount(): void { this.node?.remove(); this.node = null; }
}

// ── CREDITS / LEGAL ──────────────────────────────────────────────────────
export class CreditsScreen implements Screen {
  name = 'credits';
  private node: HTMLElement | null = null;
  private ring = new FocusRing();
  private ctx!: ScreenContext;
  mount(ctx: ScreenContext): void {
    this.ctx = ctx;
    const s = screenShell();
    const p = panel('CREDITS & LEGAL');
    p.classList.add('wide');
    const body = el('div', 'muted');
    body.innerHTML = `
      <p><b>GRIDIRON OVERDRIVE</b> is an original arcade football game. Every team, athlete,
      stadium, logo, sound and line of code in it was created for this project.</p>
      <p>It is <b>not affiliated with, endorsed by, or derived from</b> any real football league,
      players' association, team, broadcaster, arcade operator or console manufacturer. It contains
      no real-world league, team or athlete names, marks, uniforms, likenesses or data, and reuses
      no code, art, audio or text from any existing game.</p>
      <p>The design draws on the shared design language of late-1990s arcade sports games —
      short quarters, seven a side, long first downs, fast play selection, exaggerated contact —
      the way any sports game draws on the sport it depicts. All expression is original.</p>
      <p>Art is generated procedurally at runtime from geometry, canvas drawing and shaders.
      Audio is synthesised in the browser with the Web Audio API. There are no imported assets.</p>
      <p>Built with TypeScript, three.js (MIT) and Vite (MIT).</p>
      <p class="mono">The United Gridiron Circuit, its sixteen clubs, their venues and every athlete
      named in this game are fictional. Any resemblance to real people or organisations is
      coincidental.</p>`;
    p.appendChild(body);
    const back = button('BACK', () => ctx.back(), 'ghost');
    p.appendChild(back.el);
    s.appendChild(p);
    ctx.root.appendChild(s);
    this.node = s;
    this.ring.set([back]);
    this.ring.onNav = (e) => ctx.sound(e === 'select' ? 'select' : 'move');
  }
  update(): void { driveFocus(this.ring, this.ctx.input, this.ctx); }
  unmount(): void { this.node?.remove(); this.node = null; }
}
