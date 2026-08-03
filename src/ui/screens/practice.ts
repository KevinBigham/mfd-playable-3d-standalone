/**
 * GRIDIRON OVERDRIVE — practice field.
 *
 * A drill room, not a game. You pick a look, a call and a spot on the field,
 * and then run it as many times as you like against a defence that is either
 * live or frozen in place. The screen stays mounted for the whole drill so it
 * can drive the two things a practice field needs and a match does not:
 * a frozen defence, and an instant re-arm of the same down at the same spot.
 *
 * WHY THIS SCREEN OWNS ITS MATCH
 *   Only the mounted screen receives update(dt) and un-drained input edges, so
 *   RESET-on-BACK and the dev overlay have to live on a screen that is still
 *   current while the ball is live. The match is still started through
 *   `game.startMatch()` with `mode: 'PRACTICE'` — the same entry point the match
 *   screen uses — and `params.returnScreen` decides where EXIT goes, so the play
 *   editor can bounce straight in and straight back out.
 */

import type { Screen, ScreenContext, FocusItem } from '../uiKit.ts';
import { el, clear, FocusRing, driveFocus, button, optionRow, panel, svgNode } from '../uiKit.ts';
import { Action } from '../../input/actions.ts';
import type { Game } from '../../app/Game.ts';
import type {
  DefensePlay, MatchConfig, OffensePlay, TeamSide, WeatherKind,
} from '../../core/types.ts';
import { TEAMS, findTeam, teamLogoSvg } from '../../data/index.ts';
import { getSave, writeSave } from '../../persistence/save.ts';
import { recordDrillRep } from '../../progression/progression.ts';
import { OFFENSE_PLAYS } from '../../plays/offense.ts';
import { DEFENSE_PLAYS } from '../../plays/defense.ts';
import { playDiagramSvg } from '../../plays/diagram.ts';
import { computeFirstDown } from '../../rules/rulesEngine.ts';
import { customDefensePlays, customOffensePlays } from '../../modes/playEditor.ts';
import { clamp } from '../../core/math.ts';

/** Everything another screen may hand the practice field. */
export interface PracticeParams {
  /** Where BACK / EXIT should go. Defaults to the previous screen. */
  returnScreen?: string;
  /** Drill this offensive call (the play editor passes its working play). */
  offense?: OffensePlay;
  /** Drill against this defensive call. */
  defense?: DefensePlay;
  /** Force ROUTES ONLY — the defence never moves. */
  routesOnly?: boolean;
  /** Which unit the human drives. */
  side?: 'OFF' | 'DEF';
  /** Skip the setup panel and drop straight onto the field. */
  autoStart?: boolean;
  /** Caption shown on the drill strip. */
  label?: string;
  /** Spot the ball here (yards from the offense's own goal line). */
  yard?: number;
  /** Start each rep on this down. */
  down?: number;
  /** Set for a mastery drill: banked reps are counted under this id. */
  drillId?: string;
}

type DrillMode = 'ROUTES' | 'VERSUS';

interface PracticeSetup {
  mode: DrillMode;
  humanSide: 'OFF' | 'DEF';
  home: string;
  away: string;
  yard: number;       // yards from the offense's own goal line
  down: number;       // 1..4
  offenseId: string;
  defenseId: string;
  repeatSpot: boolean;
  devOverlay: boolean;
}

const YARD_LINES = [1, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 99];
const DOWNS = [1, 2, 3, 4];
const DOWN_NAMES = ['1ST', '2ND', '3RD', '4TH'];

/**
 * Survives a remount so a drill interrupted by pause, the final screen or a trip
 * to the play editor comes back exactly as it was. Team ids still come from the
 * save file on every mount, so this is a convenience, not a second store.
 */
let memo: PracticeSetup | null = null;

function fmtYardLine(y: number): string {
  if (y === 50) return 'MIDFIELD';
  return y < 50 ? `OWN ${y}` : `OPP ${100 - y}`;
}

function screenShell(): HTMLElement {
  const s = el('div', 'go-screen');
  s.appendChild(el('div', 'go-dim'));
  return s;
}

export class PracticeScreen implements Screen {
  name = 'practice';

  private node: HTMLElement | null = null;
  private devNode: HTMLElement | null = null;
  private ring = new FocusRing();
  private ctx!: ScreenContext;
  private params: PracticeParams = {};
  private setup!: PracticeSetup;

  /** Plays offered on the panel — the shipped book plus anything the editor made. */
  private offenseList: OffensePlay[] = [];
  private defenseList: DefensePlay[] = [];

  private live = false;
  /** True once this rep's calls have been submitted, cleared when the play ends. */
  private called = false;
  private repCount = 0;
  private banner: HTMLElement | null = null;
  private bannerT = 0;

  constructor(private game: Game) {}

  // ── lifecycle ──────────────────────────────────────────────────────────

  mount(ctx: ScreenContext, params?: unknown): void {
    this.ctx = ctx;
    this.params = (params as PracticeParams) ?? {};
    this.buildLists();
    this.setup = this.restoreSetup();

    const s = screenShell();
    ctx.root.appendChild(s);
    this.node = s;

    const m = this.game.match;
    if (m && this.game.inMatch && m.config.mode === 'PRACTICE') {
      // Coming back from the pause menu — the drill never stopped.
      this.live = true;
      this.renderLive();
    } else if (this.params.autoStart) {
      this.startDrill();
    } else {
      this.live = false;
      this.renderSetup();
    }
  }

  unmount(): void {
    memo = { ...this.setup };
    this.devNode?.remove();
    this.devNode = null;
    this.banner = null;
    this.node?.remove();
    this.node = null;
  }

  // ── setup state ────────────────────────────────────────────────────────

  private buildLists(): void {
    const customOff = customOffensePlays();
    const customDef = customDefensePlays();
    this.offenseList = [];
    this.defenseList = [];
    if (this.params.offense) this.offenseList.push(this.params.offense);
    if (this.params.defense) this.defenseList.push(this.params.defense);
    for (const p of customOff) if (!this.offenseList.some((q) => q.id === p.id)) this.offenseList.push(p);
    for (const p of customDef) if (!this.defenseList.some((q) => q.id === p.id)) this.defenseList.push(p);
    for (const p of OFFENSE_PLAYS) this.offenseList.push(p);
    for (const p of DEFENSE_PLAYS) this.defenseList.push(p);
  }

  private restoreSetup(): PracticeSetup {
    const save = getSave();
    const homeId = findTeam(save.lastTeams.home)?.id ?? TEAMS[0].id;
    const awayId = findTeam(save.lastTeams.away)?.id ?? TEAMS[1].id;
    const base: PracticeSetup = memo ? { ...memo } : {
      mode: 'VERSUS',
      humanSide: 'OFF',
      home: homeId,
      away: awayId === homeId ? TEAMS[1].id : awayId,
      yard: 25,
      down: 1,
      offenseId: this.offenseList[0]?.id ?? OFFENSE_PLAYS[0].id,
      defenseId: this.defenseList[0]?.id ?? DEFENSE_PLAYS[0].id,
      repeatSpot: true,
      devOverlay: false,
    };
    if (!findTeam(base.home)) base.home = homeId;
    if (!findTeam(base.away) || base.away === base.home) {
      base.away = TEAMS.find((t) => t.id !== base.home)!.id;
    }
    // Anything the caller asked for wins over the remembered drill.
    if (this.params.offense) base.offenseId = this.params.offense.id;
    if (this.params.defense) base.defenseId = this.params.defense.id;
    if (this.params.side) base.humanSide = this.params.side;
    if (this.params.routesOnly) base.mode = 'ROUTES';
    if (this.params.yard !== undefined) base.yard = clamp(Math.round(this.params.yard), 1, 99);
    if (this.params.down !== undefined) base.down = clamp(Math.round(this.params.down), 1, 4);
    if (base.mode === 'ROUTES') base.humanSide = 'OFF';
    if (!this.offenseList.some((p) => p.id === base.offenseId)) {
      base.offenseId = this.offenseList[0]?.id ?? OFFENSE_PLAYS[0].id;
    }
    if (!this.defenseList.some((p) => p.id === base.defenseId)) {
      base.defenseId = this.defenseList[0]?.id ?? DEFENSE_PLAYS[0].id;
    }
    base.down = clamp(Math.round(base.down), 1, 4);
    base.yard = clamp(Math.round(base.yard), 1, 99);
    return base;
  }

  private offensePlay(): OffensePlay {
    return this.offenseList.find((p) => p.id === this.setup.offenseId) ?? this.offenseList[0] ?? OFFENSE_PLAYS[0];
  }

  private defensePlay(): DefensePlay {
    return this.defenseList.find((p) => p.id === this.setup.defenseId) ?? this.defenseList[0] ?? DEFENSE_PLAYS[0];
  }

  private possession(): TeamSide { return this.setup.humanSide === 'OFF' ? 0 : 1; }

  /** Absolute z of the chosen spot, from the offense's own goal line. */
  private losZ(): number {
    const y = clamp(this.setup.yard, 1, 99);
    return this.possession() === 0 ? y : 100 - y;
  }

  private isCustom(id: string): boolean { return id.startsWith('cst-'); }

  // ── setup panel ────────────────────────────────────────────────────────

  private renderSetup(): void {
    const s = this.node!;
    clear(s);
    s.appendChild(el('div', 'go-dim'));

    const p = panel('PRACTICE FIELD', 'Run one call over and over. BACK re-arms the same down at the same spot.');
    p.classList.add('wide');

    const body = el('div');
    body.style.cssText = 'display:grid;grid-template-columns:minmax(340px,1fr) minmax(280px,340px);gap:18px;align-items:start';

    const left = el('div', 'stack');
    const right = el('div', 'stack');

    const strip = el('div', 'vs-strip');
    const diagrams = el('div');
    diagrams.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:10px';
    const note = el('div', 'muted');
    note.style.minHeight = '34px';

    const repaint = (): void => {
      const home = findTeam(this.setup.home) ?? TEAMS[0];
      const away = findTeam(this.setup.away) ?? TEAMS[1];
      clear(strip);
      const sideCard = (t: typeof home, tag: string): HTMLElement => {
        const d = el('div', 'side');
        d.appendChild(svgNode(teamLogoSvg(t, 84)));
        d.appendChild(el('div', 'nm', t.abbr));
        d.appendChild(el('div', 'muted', tag));
        return d;
      };
      strip.append(
        sideCard(home, this.setup.humanSide === 'OFF' ? 'YOU · OFFENSE' : 'YOU · DEFENSE'),
        el('div', 'vs', 'VS'),
        sideCard(away, 'CPU'),
      );

      const off = this.offensePlay();
      const def = this.defensePlay();
      clear(diagrams);
      const cell = (title: string, svg: string, tag: string): HTMLElement => {
        const c = el('div');
        c.style.cssText = 'border:2px solid var(--edge);background:#0b1220;padding:6px';
        c.appendChild(el('div', 'muted', title));
        c.appendChild(svgNode(svg));
        const t = el('div', 'tag', tag);
        t.style.marginTop = '4px';
        c.appendChild(t);
        return c;
      };
      diagrams.append(
        cell('OFFENCE', playDiagramSvg(off, { width: 200, height: 140 }), off.name.toUpperCase()),
        cell('DEFENCE', playDiagramSvg(def, { width: 200, height: 140 }), def.name.toUpperCase()),
      );

      const dist = 30;
      note.textContent = this.setup.mode === 'ROUTES'
        ? `Routes only — the defence stands still so you can read the concept. Ball on the ${fmtYardLine(this.setup.yard).toLowerCase()}, ${DOWN_NAMES[this.setup.down - 1]} and ${dist}.`
        : `Live look. Ball on the ${fmtYardLine(this.setup.yard).toLowerCase()}, ${DOWN_NAMES[this.setup.down - 1]} and ${dist}.`;
    };

    const fmtOff = (id: string): string => {
      const pl = this.offenseList.find((q) => q.id === id);
      return pl ? `${pl.name.toUpperCase()}${this.isCustom(id) ? ' · CUSTOM' : ''}` : '—';
    };
    const fmtDef = (id: string): string => {
      const pl = this.defenseList.find((q) => q.id === id);
      return pl ? `${pl.name.toUpperCase()}${this.isCustom(id) ? ' · CUSTOM' : ''}` : '—';
    };

    const items: FocusItem[] = [
      optionRow<DrillMode>({
        label: 'DRILL', values: ['ROUTES', 'VERSUS'],
        format: (v) => (v === 'ROUTES' ? 'ROUTES ONLY' : 'OFFENCE vs DEFENCE'),
        get: () => this.setup.mode,
        set: (v) => {
          this.setup.mode = v;
          if (v === 'ROUTES') this.setup.humanSide = 'OFF';
        },
      }, () => this.renderSetup()),
      optionRow<'OFF' | 'DEF'>({
        label: 'YOU PLAY', values: ['OFF', 'DEF'],
        format: (v) => (v === 'OFF' ? 'OFFENCE' : 'DEFENCE'),
        get: () => this.setup.humanSide,
        set: (v) => {
          this.setup.humanSide = v;
          // A frozen defence cannot be the side you are driving.
          if (v === 'DEF') this.setup.mode = 'VERSUS';
        },
      }, () => this.renderSetup()),
      optionRow<string>({
        label: 'YOUR TEAM', values: TEAMS.map((t) => t.id),
        format: (v) => (findTeam(v)?.name ?? v).toUpperCase(),
        get: () => this.setup.home,
        set: (v) => {
          this.setup.home = v;
          if (this.setup.away === v) {
            this.setup.away = TEAMS.find((t) => t.id !== v)!.id;
          }
        },
      }, repaint),
      optionRow<string>({
        label: 'OPPOSING TEAM', values: TEAMS.map((t) => t.id),
        format: (v) => (findTeam(v)?.name ?? v).toUpperCase(),
        get: () => this.setup.away,
        set: (v) => {
          this.setup.away = v;
          if (this.setup.home === v) {
            this.setup.home = TEAMS.find((t) => t.id !== v)!.id;
          }
        },
      }, repaint),
      optionRow<number>({
        label: 'BALL ON', values: YARD_LINES, format: fmtYardLine,
        get: () => this.setup.yard, set: (v) => { this.setup.yard = v; },
      }, repaint),
      optionRow<number>({
        label: 'DOWN', values: DOWNS, format: (v) => `${DOWN_NAMES[v - 1]} & 30`,
        get: () => this.setup.down, set: (v) => { this.setup.down = v; },
      }, repaint),
      optionRow<string>({
        label: 'OFFENSIVE PLAY', values: this.offenseList.map((q) => q.id), format: fmtOff,
        get: () => this.setup.offenseId, set: (v) => { this.setup.offenseId = v; },
      }, repaint),
      optionRow<string>({
        label: 'DEFENSIVE PLAY', values: this.defenseList.map((q) => q.id), format: fmtDef,
        get: () => this.setup.defenseId, set: (v) => { this.setup.defenseId = v; },
      }, repaint),
      optionRow<boolean>({
        label: 'REPEAT SPOT', values: [true, false], format: (v) => (v ? 'ON' : 'OFF'),
        get: () => this.setup.repeatSpot, set: (v) => { this.setup.repeatSpot = v; },
      }, repaint),
      optionRow<boolean>({
        label: 'DEV OVERLAY', values: [false, true], format: (v) => (v ? 'ON' : 'OFF'),
        get: () => this.setup.devOverlay,
        set: (v) => {
          this.setup.devOverlay = v;
          if (!v) { this.devNode?.remove(); this.devNode = null; }
        },
      }, repaint),
    ];
    for (const it of items) left.appendChild(it.el);

    const start = button('START DRILL', () => this.startDrill());
    const back = button('BACK', () => this.leave(), 'ghost');
    items.push(start, back);
    left.append(start.el, back.el);

    right.append(strip, diagrams, note);
    const help = el('div', 'muted');
    help.innerHTML = 'On the field — <b>BACK</b> (Backspace / B): re-arm the same down.'
      + ' <b>HIDE PLAY</b> (H / Select): leave the drill. <b>PAUSE</b> (Esc / Start): pause menu.';
    right.appendChild(help);

    body.append(left, right);
    p.appendChild(body);
    s.appendChild(p);

    repaint();
    this.ring.set(items, true);
    this.ring.onNav = (e) => this.ctx.sound(e === 'select' ? 'select' : 'move');
  }

  // ── drill ──────────────────────────────────────────────────────────────

  private startDrill(): void {
    const save = getSave();
    const home = findTeam(this.setup.home) ?? TEAMS[0];
    const away = findTeam(this.setup.away) ?? TEAMS[1];
    save.lastTeams.home = home.id;
    save.lastTeams.away = away.id;
    writeSave();

    const weather: WeatherKind = save.lastTeams.weather || 'CLEAR';
    const cfg: Partial<MatchConfig> = {
      seed: (Date.now() & 0x7fffffff) >>> 0,
      home: home.id,
      away: away.id,
      stadium: home.stadium,
      weather,
      difficulty: this.game.settings.difficulty,
      // Long quarters plus a clock we hold full below: a drill should not expire.
      quarterSeconds: 360,
      playClock: false,
      seats: [
        { side: 0, active: true },
        { side: 1, active: false },
        { side: 0, active: false },
        { side: 1, active: false },
      ],
      mode: 'PRACTICE',
    };

    // The match screen leaves its own end-of-match handler on the Game; a drill
    // must not inherit it and jump to a stale results screen.
    this.game.onMatchEnd = null;
    this.game.startMatch(cfg);
    this.live = true;
    this.called = false;
    this.repCount = 0;
    this.arm();
    this.game.hud.showHelp = this.game.settings.helpPrompts;
    this.game.hud.help('PRACTICE · BACK re-arms the down · HIDE PLAY leaves the drill', 5);
    this.renderLive();
  }

  private stopDrill(): void {
    this.game.endMatch();
    this.game.onMatchEnd = null;
    this.live = false;
    this.devNode?.remove();
    this.devNode = null;
  }

  private leave(): void {
    const dest = this.params.returnScreen;
    this.ctx.sound('back');
    if (dest && dest !== this.name) this.ctx.reset(dest);
    else this.ctx.back();
  }

  /**
   * Put the ball back on the chosen spot with the chosen down and call, then let
   * PLAY_CALL run. Deliberately minimal: it writes the fields the rules engine
   * reads at the start of a snap and submits both calls, rather than trying to
   * drive the state machine from outside.
   */
  private arm(): void {
    const m = this.game.match;
    if (!m) return;
    const st = m.state;
    const w = m.world;
    const poss = this.possession();

    st.possession = poss;
    st.down = clamp(Math.round(this.setup.down), 1, 4);
    st.losZ = this.losZ();
    st.firstDownZ = computeFirstDown(st.losZ, poss);
    st.lastDead = null;
    st.pendingScore = null;
    st.conversionChoice = null;
    // A drill has no clock: hold the quarter full so FINAL is never reached.
    st.quarter = 1;
    st.clockTicks = st.quarterTicks;
    st.phase = 'PLAY_CALL';
    st.phaseTicks = 0;

    w.special = null;
    w.kickPending = null;
    m.pendingSpecial = null;
    m.mirrorOffense = false;
    m.submitOffense(this.offensePlay());
    m.submitDefense(this.defensePlay());
    this.called = true;
    this.applyFreeze();
  }

  private applyFreeze(): void {
    const m = this.game.match;
    if (!m) return;
    m.world.freezeDefense = this.setup.mode === 'ROUTES';
  }

  private flash(text: string): void {
    if (!this.banner) return;
    this.banner.textContent = text;
    this.banner.style.opacity = '1';
    this.bannerT = 1.1;
  }

  // ── live overlay ───────────────────────────────────────────────────────

  private renderLive(): void {
    const s = this.node!;
    clear(s);
    // No dimmer: the field has to be visible.
    s.style.pointerEvents = 'none';
    s.style.alignItems = 'flex-start';
    s.style.justifyContent = 'flex-start';

    const strip = el('div', 'go-panel');
    strip.style.cssText = 'position:absolute;left:16px;top:calc(16px + 96px);min-width:250px;max-width:290px;'
      + 'padding:12px 14px;pointer-events:auto;opacity:.94';
    strip.appendChild(el('h2', 'go-title', this.params.label ? this.params.label : 'PRACTICE'));

    const info = el('div', 'stack');
    info.style.gap = '4px';
    const line = (label: string, value: string): HTMLElement => {
      const r = el('div', 'spread');
      r.append(el('span', 'muted', label), el('span', '', value));
      return r;
    };
    info.append(
      line('DRILL', this.setup.mode === 'ROUTES' ? 'ROUTES ONLY' : 'VS DEFENCE'),
      line('YOU', this.setup.humanSide === 'OFF' ? 'OFFENCE' : 'DEFENCE'),
      line('OFFENCE', this.offensePlay().name.toUpperCase()),
      line('DEFENCE', this.defensePlay().name.toUpperCase()),
      line('SPOT', `${fmtYardLine(this.setup.yard)} · ${DOWN_NAMES[this.setup.down - 1]}`),
    );
    strip.appendChild(info);

    const reps = el('div', 'pill', 'REP 0');
    reps.style.marginTop = '8px';
    strip.appendChild(reps);
    this.repNode = reps;

    const row = el('div', 'row');
    row.style.marginTop = '10px';
    const mk = (label: string, onClick: () => void): HTMLElement => {
      const b = el('button', 'go-btn ghost', label);
      b.type = 'button';
      b.style.width = 'auto';
      b.addEventListener('click', onClick);
      return b;
    };
    row.append(
      mk('RESET', () => { this.arm(); this.flash('RE-ARMED'); this.ctx.sound('select'); }),
      mk('REPEAT', () => {
        this.setup.repeatSpot = !this.setup.repeatSpot;
        this.flash(this.setup.repeatSpot ? 'REPEAT SPOT ON' : 'REPEAT SPOT OFF');
        this.ctx.sound('move');
      }),
      mk('EXIT', () => { this.stopDrill(); this.ctx.sound('back'); this.exitDrill(); }),
    );
    strip.appendChild(row);

    const hint = el('div', 'muted');
    hint.style.marginTop = '8px';
    hint.innerHTML = 'BACK = re-arm · HIDE PLAY = exit · PAUSE = menu';
    strip.appendChild(hint);

    const banner = el('div');
    banner.style.cssText = 'position:absolute;left:50%;top:22%;transform:translateX(-50%) skewX(-9deg);'
      + 'font-size:34px;letter-spacing:.2em;color:var(--hot-2);text-shadow:0 4px 0 #000;opacity:0;'
      + 'transition:opacity .25s ease;pointer-events:none';
    this.banner = banner;

    s.append(strip, banner);
    if (this.setup.devOverlay) this.buildDevOverlay();
    this.ring.set([]);
  }

  private repNode: HTMLElement | null = null;

  private exitDrill(): void {
    if (this.params.autoStart || this.params.returnScreen) this.leave();
    else { this.renderSetup(); }
  }

  private buildDevOverlay(): void {
    if (this.devNode) return;
    const box = el('div');
    box.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:6;min-width:250px;'
      + 'background:rgba(4,7,12,.88);border:2px solid var(--edge);padding:8px 10px;'
      + 'font-family:ui-monospace,monospace;font-size:12px;line-height:1.5;color:var(--ink);'
      + 'pointer-events:none;white-space:pre';
    const head = el('div', '', 'DEV OVERLAY');
    head.style.cssText = 'color:var(--hot-2);letter-spacing:.16em;margin-bottom:4px;font-family:inherit';
    const bodyEl = el('div', 'mono');
    box.append(head, bodyEl);
    this.ctx.root.appendChild(box);
    this.devNode = box;
    this.devBody = bodyEl;
  }

  private devBody: HTMLElement | null = null;

  private syncDevOverlay(): void {
    const m = this.game.match;
    if (!m) return;
    if (this.setup.devOverlay && !this.devNode) this.buildDevOverlay();
    if (!this.setup.devOverlay || !this.devBody) return;

    const w = m.world;
    const st = m.state;
    const b = w.ball;
    let ballLine: string;
    switch (b.state.kind) {
      case 'held': ballLine = `held  by #${w.athletes[b.state.carrier]?.def.number ?? '?'} (id ${b.state.carrier})`; break;
      case 'inAir': ballLine = `inAir ${b.state.passKind} from ${b.state.from} to ${b.state.intended ?? '-'}`; break;
      case 'loose': ballLine = `loose last ${b.state.lastTouch} ${b.state.tipped ? 'tipped' : b.state.fromFumble ? 'fumble' : 'muff'}`; break;
      case 'kicked': ballLine = `kick  ${b.state.kickKind}${b.state.landed ? ' landed' : ''}`; break;
      default: ballLine = 'dead'; break;
    }
    const me = w.athletes.find((a) => a.controlledBySeat === 0);
    const pad = (label: string, v: string): string => `${label.padEnd(9, ' ')}${v}`;
    this.devBody.textContent = [
      pad('BALL', ballLine),
      pad('POSSESS', `${st.possession === 0 ? 'HOME' : 'AWAY'} (ball.poss ${b.possession === 0 ? 'HOME' : 'AWAY'})`),
      pad('PHASE', `${st.phase} +${st.phaseTicks}`),
      pad('PLAY', `${w.playPhase} tick ${w.playTicks}${w.deadReason ? ` · ${w.deadReason}` : ''}`),
      pad('LOS', `${st.losZ.toFixed(1)}  1st-dn ${st.firstDownZ.toFixed(1)}  spot ${w.spotZ.toFixed(1)}`),
      pad('DOWN', `${DOWN_NAMES[clamp(st.down, 1, 4) - 1]} · rep ${this.repCount}`),
      pad('YOU', me ? `id ${me.id} #${me.def.number} ${me.def.pos} ${me.move}` : 'none'),
      pad('FREEZE', `${w.freezeDefense ? 'defence frozen' : 'live'}  tick ${w.tick}`),
    ].join('\n');
  }

  // ── frame ──────────────────────────────────────────────────────────────

  update(dt: number): void {
    const input = this.ctx.input;

    if (!this.live) {
      driveFocus(this.ring, input, this.ctx);
      return;
    }

    const m = this.game.match;
    if (!m || !this.game.inMatch) {
      // Something else ended the match (quit from the pause menu).
      this.live = false;
      this.renderSetup();
      return;
    }
    if (this.game.paused) return;

    if (this.bannerT > 0) {
      this.bannerT -= dt;
      if (this.bannerT <= 0 && this.banner) this.banner.style.opacity = '0';
    }

    // ── input ──
    if (input.menuPressed(Action.PAUSE)) {
      this.ctx.go('pause', { returnScreen: this.name });
      return;
    }
    const ballLive = m.world.playPhase === 'LIVE';
    // Backspace reaches us as a gameplay bit (keyboard only) and as a menu edge
    // (keyboard + pad B). Pad B is the tackle button, so only trust the menu edge
    // between plays.
    if (this.pressed(Action.BACK) || (input.menuPressed(Action.BACK) && !ballLive)) {
      this.arm();
      this.flash('RE-ARMED');
      this.ctx.sound('select');
      return;
    }
    if (this.pressed(Action.HIDE_PLAY)) {
      this.stopDrill();
      this.ctx.sound('back');
      this.exitDrill();
      return;
    }

    // ── keep the drill running ──
    this.applyFreeze();
    const phase = m.phase;

    if (phase === 'PLAY_CALL') {
      if (!this.called) {
        if (this.setup.repeatSpot) this.arm();
        else {
          m.submitOffense(this.offensePlay());
          m.submitDefense(this.defensePlay());
          this.called = true;
        }
      }
    } else if (phase === 'PRE_SNAP' || phase === 'LIVE') {
      // Still the rep we called; leave it alone.
    } else if (phase === 'DEAD_BALL' || phase === 'POST_PLAY') {
      // The whistle has gone: bank the rep and let the next PLAY_CALL re-arm.
      if (this.called) {
        this.called = false;
        this.repCount++;
        if (this.repNode) this.repNode.textContent = `REP ${this.repCount}`;
        if (this.params.drillId) recordDrillRep(this.params.drillId);
      }
    } else if (phase === 'CONVERSION_CALL') {
      if (m.pendingConversion === null) m.submitConversion('KICK');
      this.called = false;
    } else if (this.setup.repeatSpot
      && (phase === 'KICKOFF_SETUP' || phase === 'KICKOFF_LIVE' || phase === 'QUARTER_BREAK'
        || phase === 'HALFTIME' || phase === 'OVERTIME_SETUP'
        || (phase === 'SCORE_RESOLVE' && m.state.phaseTicks > 96))) {
      this.arm();
    } else {
      this.called = false;
    }

    if (m.state.finished) {
      this.stopDrill();
      this.renderSetup();
      return;
    }

    this.syncDevOverlay();
  }

  /** Gameplay-layer edge for any seat. Keyboard BACK / HIDE PLAY live here. */
  private pressed(mask: number): boolean {
    for (let seat = 0; seat < 4; seat++) {
      const it = this.game.input.intentFor(seat);
      if (it && (it.pressed & mask) !== 0) return true;
    }
    return false;
  }
}
