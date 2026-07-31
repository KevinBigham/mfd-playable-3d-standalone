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
}

const SPECIAL_SLOT = 9;

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

    if (this.panels.length === 0) { this.active = false; this.wrap.style.display = 'none'; return; }

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
    this.paintAll();
  }

  close(): void {
    this.active = false;
    this.wrap.style.display = 'none';
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
    wrap.append(head, grid, hint);
    const cells: HTMLElement[] = [];
    for (let i = 0; i < 9; i++) {
      const c = el('div', 'ps-cell');
      c.addEventListener('click', () => { this.setCursor(panel, i); this.confirm(panel); });
      grid.appendChild(c);
      cells.push(c);
    }
    const panel: SidePanel = {
      wrap, grid, head, cells, page: 0, cursor: 4, hidden: false, locked: false,
      side, seat, isOffense, mirrored: false,
    };
    return panel;
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
    const showSpecial = p.isOffense && m.state.down === 4;
    for (let i = 0; i < 9; i++) {
      const cell = p.cells[i];
      clear(cell);
      cell.classList.toggle('focused', i === p.cursor && !p.locked);
      cell.classList.toggle('hidden-pick', p.hidden);
      let play = list[i] ?? null;
      let label = '';
      if (showSpecial && i === SPECIAL_SLOT - 1 && p.page === 2) { play = null; label = 'PUNT'; }
      if (play) {
        cell.innerHTML = playDiagramSvg(play, { mirrored: p.mirrored });
        label = play.name;
      } else if (!label) {
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
        if (it.pressed & Action.TURBO || it.pressed & Action.PAGE) {
          p.page = (p.page + 1) % (p.isOffense ? 3 : 2);
          this.paint(p);
          this.onSound?.('move');
        }
        if (it.pressed & Action.JUMP && p.isOffense) { p.mirrored = !p.mirrored; this.paint(p); this.onSound?.('move'); }
        if (it.pressed & Action.HIDE_PLAY) { p.hidden = !p.hidden; this.paint(p); }
        if (it.pressed & Action.DIVE && p.isOffense && this.match.state.down === 4) this.special(p, 'PUNT');
        if (it.pressed & Action.SPECIAL && p.isOffense && this.match.state.down === 4) this.special(p, 'FIELD_GOAL');
        if (it.pressed & Action.ACTION) this.confirm(p);
      }
    }
    if (this.panels.every((p) => p.locked)) this.close();
  }
}
