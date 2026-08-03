import type { DefensePlay, OffensePlay, TeamSide } from '../core/types.ts';
import type { Match, SpecialCall } from '../rules/match.ts';
import type { InputManager } from '../input/manager.ts';
import { Action } from '../input/actions.ts';
import { el, clear } from './uiKit.ts';
import { playDiagramSvg } from '../plays/diagram.ts';
import { OFFENSE_PAGES } from '../plays/offense.ts';
import { DEFENSE_PAGE, DEFENSE_PLAYS } from '../plays/defense.ts';
import { clamp, clamp01 } from '../core/math.ts';
import { PLAY_CALL_SECONDS } from '../core/constants.ts';

interface SidePanel {
  wrap: HTMLElement;
  grid: HTMLElement;
  head: HTMLElement;
  cells: HTMLElement[];
  page: number;
  cursor: number;
  hidden: boolean;
  locked: boolean;
  side: TeamSide;
  seat: number;
  isOffense: boolean;
  mirrored: boolean;
  specialBar: HTMLElement;
}

/**
 * Fast play-selection overlay. One press to pick. Pages cycle with the turbo/page button.
 * Each human picks on their own panel; hidden picks blur so a couch opponent can't read them.
 */
export class PlaySelect {
  private root: HTMLElement;
  private wrap: HTMLElement;
  private panels: SidePanel[] = [];
  private match: Match | null = null;
  private timerBar!: HTMLElement;
  private timerFill!: HTMLElement;
  private active = false;
  private t = 0;
  onSound: ((k: 'move' | 'select') => void) | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    this.wrap = el('div', 'ps-wrap');
    this.wrap.style.display = 'none';
    root.appendChild(this.wrap);
  }

  get isActive(): boolean { return this.active; }

  open(m: Match): void {
    this.match = m;
    this.active = true;
    this.t = 0;
    clear(this.wrap);
    this.panels = [];

    const offSide = m.state.possession;
    const defSide: TeamSide = offSide === 0 ? 1 : 0;
    const build = (side: TeamSide, isOffense: boolean): void => {
      const seats = m.seatsFor(side);
      if (seats.length === 0) return;
      this.panels.push(this.makePanel(side, seats[0], isOffense));
    };
    build(offSide, true);
    build(defSide, false);

    if (this.panels.length === 0) {
      this.active = false;
      this.wrap.style.display = 'none';
      document.body.classList.remove('ps-open');
      return;
    }

    const bar = el('div', 'ps-timer');
    const fill = el('i');
    bar.appendChild(fill);
    this.timerBar = bar; this.timerFill = fill;

    const col = el('div', 'stack');
    const row = el('div', 'row');
    for (const p of this.panels) row.appendChild(p.wrap);
    col.append(row, bar);
    this.wrap.appendChild(col);
    this.wrap.style.display = 'flex';
    document.body.classList.add('ps-open');
    this.paintAll();
  }

  close(): void {
    this.active = false;
    this.wrap.style.display = 'none';
    document.body.classList.remove('ps-open');
    this.match = null;
  }

  private makePanel(side: TeamSide, seat: number, isOffense: boolean): SidePanel {
    const wrap = el('div', 'ps-side');
    const head = el('div', 'ps-head');
    const grid = el('div', 'ps-grid');
    const hint = el('div', 'ps-hint',
      isOffense
        ? 'MOVE: choose  ·  PASS/A: call  ·  TURBO: next page  ·  JUMP: flip  ·  H/SELECT: hide'
        : 'MOVE: choose  ·  PASS/A: call  ·  TURBO: next page');
    // Every verb a hardware button owns is also a real on-screen button. Before this, page
    // changes, mirroring, and the special calls were action-bit-only: a touch player could tap
    // the visible cells but never reach page two, a flipped formation, or a punt.
    const bar = el('div', 'ps-bar');
    bar.style.cssText = 'display:flex;gap:8px;justify-content:center;margin:6px 0;pointer-events:auto';
    const mkBtn = (label: string, onTap: () => void): HTMLElement => {
      const b = el('div', 'go-btn ps-tool', label);
      b.style.cssText = 'padding:8px 14px;min-width:48px;min-height:34px;cursor:pointer;font-size:14px';
      b.addEventListener('click', onTap);
      return b;
    };
    bar.appendChild(mkBtn('PAGE ▸', () => this.cyclePage(panel)));
    if (isOffense) bar.appendChild(mkBtn('⇄ FLIP', () => this.toggleMirror(panel)));
    bar.appendChild(mkBtn('● HIDE', () => { panel.hidden = !panel.hidden; this.paint(panel); }));
    const specialBar = el('div', 'ps-special');
    specialBar.style.cssText = 'display:none;gap:8px;justify-content:center;margin:6px 0;pointer-events:auto';
    wrap.append(head, bar, specialBar, grid, hint);
    const cells: HTMLElement[] = [];
    for (let i = 0; i < 9; i++) {
      const c = el('div', 'ps-cell');
      c.addEventListener('click', () => { this.setCursor(panel, i); this.confirm(panel); });
      grid.appendChild(c);
      cells.push(c);
    }
    const panel: SidePanel = {
      wrap, grid, head, cells, page: 0, cursor: 4, hidden: false, locked: false,
      side, seat, isOffense, mirrored: false, specialBar,
    };
    // The special decisions are whole buttons that dispatch the real special path — a displayed
    // "PUNT" cell that routed through the normal confirm() silently did nothing (F-005).
    if (isOffense) {
      specialBar.appendChild(mkBtn('PUNT', () => this.special(panel, 'PUNT')));
      specialBar.appendChild(mkBtn('FIELD GOAL', () => this.special(panel, 'FIELD_GOAL')));
    }
    return panel;
  }

  private cyclePage(p: SidePanel): void {
    if (p.locked) return;
    p.page = (p.page + 1) % (p.isOffense ? 3 : 2);
    this.paint(p);
    this.onSound?.('move');
  }

  private toggleMirror(p: SidePanel): void {
    if (p.locked || !p.isOffense) return;
    p.mirrored = !p.mirrored;
    this.paint(p);
    this.onSound?.('move');
  }

  private playsFor(p: SidePanel): Array<OffensePlay | DefensePlay | null> {
    const m = this.match!;
    if (p.isOffense) {
      if (p.page === 3) {
        const out: Array<OffensePlay | null> = new Array(9).fill(null);
        out[0] = null;
        return out;
      }
      const page = OFFENSE_PAGES[p.page] ?? [];
      const arr: Array<OffensePlay | null> = new Array(9).fill(null);
      for (const pl of page) arr[pl.slot] = pl;
      // 4th-down special slots ride on page 2.
      return arr;
    }
    const arr: Array<DefensePlay | null> = new Array(9).fill(null);
    const src = p.page === 0 ? DEFENSE_PAGE : DEFENSE_PLAYS.slice(9);
    src.forEach((d, i) => { if (i < 9) arr[i] = d; });
    void m;
    return arr;
  }

  private paintAll(): void { for (const p of this.panels) this.paint(p); }

  private paint(p: SidePanel): void {
    const m = this.match;
    if (!m) return;
    const team = m.world.teams[p.side];
    const pages = p.isOffense ? 3 : 2;
    p.head.textContent = '';
    const nm = el('span', '', `${team.abbr} ${p.isOffense ? 'OFFENSE' : 'DEFENSE'}`);
    const pg = el('span', 'pg', `PAGE ${p.page + 1}/${pages}${p.mirrored ? '  ⇄' : ''}${p.hidden ? '  ●HIDDEN' : ''}`);
    p.head.append(nm, pg);
    const list = this.playsFor(p);
    // Fourth down: the special decisions appear as real buttons above the grid. The old path
    // painted a "PUNT" label onto a dead cell whose click handler could never dispatch it.
    p.specialBar.style.display = p.isOffense && m.state.down === 4 && !p.locked ? 'flex' : 'none';
    for (let i = 0; i < 9; i++) {
      const cell = p.cells[i];
      clear(cell);
      cell.classList.toggle('focused', i === p.cursor && !p.locked);
      cell.classList.toggle('hidden-pick', p.hidden);
      const play = list[i] ?? null;
      let label = '';
      if (play) {
        cell.innerHTML = playDiagramSvg(play);
        label = play.name;
      } else {
        label = '—';
      }
      const nmEl = el('div', 'nm', label);
      cell.appendChild(nmEl);
    }
  }

  private setCursor(p: SidePanel, i: number): void {
    p.cursor = clamp(i, 0, 8);
    this.paint(p);
    this.onSound?.('move');
  }

  private move(p: SidePanel, dx: number, dy: number): void {
    let r = Math.floor(p.cursor / 3), c = p.cursor % 3;
    r = (r + dy + 3) % 3; c = (c + dx + 3) % 3;
    this.setCursor(p, r * 3 + c);
  }

  private confirm(p: SidePanel): void {
    const m = this.match;
    if (!m || p.locked) return;
    const list = this.playsFor(p);
    const play = list[p.cursor];
    if (p.isOffense) {
      const special: SpecialCall = null;
      if (!play) return;
      m.submitOffense(play as OffensePlay, special, p.mirrored);
    } else {
      if (!play) return;
      m.submitDefense(play as DefensePlay);
    }
    p.locked = true;
    p.wrap.style.opacity = '0.55';
    this.onSound?.('select');
    this.paint(p);
  }

  private special(p: SidePanel, kind: SpecialCall): void {
    const m = this.match;
    if (!m || p.locked || !p.isOffense) return;
    m.submitOffense(null, kind, false);
    p.locked = true;
    p.wrap.style.opacity = '0.55';
    p.specialBar.style.display = 'none';
    this.onSound?.('select');
  }

  update(dt: number, input: InputManager): void {
    if (!this.active || !this.match) return;
    this.t += dt;
    const frac = clamp01(1 - this.t / PLAY_CALL_SECONDS);
    this.timerFill.style.width = `${frac * 100}%`;
    this.timerFill.style.background = frac < 0.25 ? 'var(--bad)' : 'var(--hot)';

    for (const p of this.panels) {
      if (p.locked) continue;
      const seat = p.seat;
      if (input.menuPressedBySeat(seat, Action.UP)) this.move(p, 0, -1);
      if (input.menuPressedBySeat(seat, Action.DOWN)) this.move(p, 0, 1);
      if (input.menuPressedBySeat(seat, Action.LEFT)) this.move(p, -1, 0);
      if (input.menuPressedBySeat(seat, Action.RIGHT)) this.move(p, 1, 0);
      const it = input.intentFor(seat);
      if (it) {
        if (it.pressed & Action.TURBO || it.pressed & Action.PAGE) this.cyclePage(p);
        if (it.pressed & Action.JUMP && p.isOffense) this.toggleMirror(p);
        if (it.pressed & Action.HIDE_PLAY) { p.hidden = !p.hidden; this.paint(p); }
        if (it.pressed & Action.DIVE && p.isOffense && this.match.state.down === 4) this.special(p, 'PUNT');
        if (it.pressed & Action.SPECIAL && p.isOffense && this.match.state.down === 4) this.special(p, 'FIELD_GOAL');
        if (it.pressed & Action.ACTION) this.confirm(p);
      }
    }
    if (this.panels.every((p) => p.locked)) this.close();
  }
}
