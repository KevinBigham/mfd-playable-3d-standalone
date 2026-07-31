/**
 * GRIDIRON OVERDRIVE — play editor.
 *
 * Eighteen custom slots, nine a side. The centre panel is a live chalkboard:
 * drag a player, click the grass to drop a waypoint, cycle what he does when he
 * gets there. Everything the editor writes goes through `src/modes/playEditor.ts`,
 * which clamps as it writes, so the play on screen is always a play the engine
 * can run.
 *
 * NAVIGATION
 *   One focus ring, ordered slots → players → waypoints → properties → buttons.
 *   UP/DOWN walks it, LEFT/RIGHT adjusts the focused control, PAGE (Tab or a
 *   shoulder button) jumps to the next section, ACTION selects. Selecting a
 *   player or a waypoint enters NUDGE mode, where the movement keys move that
 *   mark half a yard at a time — two yards with turbo held — until ACTION or
 *   BACK drops back out. Mouse users can just drag.
 */

import type { Screen, ScreenContext, FocusItem } from '../uiKit.ts';
import { el, clear, FocusRing, driveFocus, button, optionRow, sliderRow, panel } from '../uiKit.ts';
import { Action } from '../../input/actions.ts';
import type { Game } from '../../app/Game.ts';
import type {
  DefenseAssign, DefensePlay, DefenseTag, OffensePlay, OffenseRole, PlayTag, RouteAction,
} from '../../core/types.ts';
import { OFFENSE_PLAYS } from '../../plays/offense.ts';
import { DEFENSE_PLAYS } from '../../plays/defense.ts';
import { s } from '../../core/constants.ts';
import { clamp } from '../../core/math.ts';
import {
  ASSIGN_KINDS, OFFENSE_ROLES, ROUTE_ACTIONS, SLOTS_PER_SIDE, type EditorSide,
  addNode, clonePlay, customDefensePlays, customOffensePlays, defaultAssignment, deleteCustom,
  firstFreeSlot, isOffensePlay, listCustom, loadCustom, moveNode, moveSlot, newCustomDefense,
  newCustomOffense, removeNode, sanitizeName, saveCustom, setAggression, setAssignment,
  setBlockDir, setDeepHelp, setDeepShot, setDefenseTag, setNodeAction, setNodeHold,
  setOffenseTag, setRead, setRole, setShortYardage, setTiming, validate as validatePlayEdit,
} from '../../modes/playEditor.ts';
import type { PracticeParams } from './practice.ts';

// ── chalkboard geometry ─────────────────────────────────────────────────────

const SVG_NS = 'http://www.w3.org/2000/svg';
const FW = 520;
const FH = 420;
const PAD = 10;
const X_MIN = -27;
const X_MAX = 27;
const Z_TOP = 32;
const Z_BOT = -16;
const SX = (FW - PAD * 2) / (X_MAX - X_MIN);
const SZ = (FH - PAD * 2) / (Z_TOP - Z_BOT);

const px = (x: number): number => PAD + (x - X_MIN) * SX;
const py = (z: number): number => PAD + (Z_TOP - z) * SZ;
const invX = (p: number): number => (p - PAD) / SX + X_MIN;
const invZ = (p: number): number => Z_TOP - (p - PAD) / SZ;

const ROUTE_LETTER: Record<RouteAction, string> = {
  RUN: 'RUN', CUT: 'CUT', SPEED: 'GO', SETTLE: 'SIT', DRIFT: 'DRIFT',
  BLOCK: 'BLK', CARRY: 'BALL', LEAK: 'LEAK',
};

/** Player-facing assignment names. No internal enum spelling ever reaches the panel. */
const ASSIGN_LABEL: Record<DefenseAssign['kind'], string> = {
  RUSH: 'RUSH',
  CONTAIN: 'CONTAIN EDGE',
  MAN: 'MAN COVER',
  ZONE: 'ZONE',
  SPY: 'SPY',
  BLITZ_DELAY: 'DELAYED RUSH',
};

const OFFENSE_TAGS: PlayTag[] = [
  'RUN', 'QUICK', 'CROSS', 'FLOOD', 'DEEP', 'MISDIRECT', 'ROLLOUT',
  'SCREEN', 'OPTION', 'TRICK', 'SHOTGUN', 'GOALLINE', 'CLOCK',
];
const DEFENSE_TAGS: DefenseTag[] = [
  'MAN', 'ZONE', 'MIXED', 'CONTAIN', 'SPY', 'EDGE', 'INTERIOR', 'ALLOUT', 'GOALLINE', 'PREVENT',
];

const TIMING_STEPS = [s(0.8), s(1.0), s(1.2), s(1.5), s(1.8), s(2.1), s(2.5), s(3.0)];
const HOLD_STEPS = [0, s(0.3), s(0.6), s(1.0), s(1.6), s(2.4)];

const NAME_ADJ = [
  'IRON', 'STORM', 'GHOST', 'ANVIL', 'CANNON', 'RIPCORD', 'TUNNEL', 'PYLON',
  'SKYLINE', 'GRINDER', 'HAMMER', 'CINDER', 'LANTERN', 'RIVET', 'COBALT', 'HARBOUR',
];
const NAME_OFF = ['MESH', 'FLOOD', 'VERTS', 'SCREEN', 'DIVE', 'SWEEP', 'HITCH', 'DRAW', 'WHEEL', 'POST', 'SAIL', 'CROSS'];
const NAME_DEF = ['LOCK', 'SHELL', 'WALL', 'TRAP', 'PRESS', 'ROOF', 'VICE', 'NET', 'FIRE', 'CLAMP', 'GATE', 'HOOK'];

function bankName(side: EditorSide, n: number): string {
  const nouns = side === 'OFF' ? NAME_OFF : NAME_DEF;
  const i = ((n % NAME_ADJ.length) + NAME_ADJ.length) % NAME_ADJ.length;
  const j = ((Math.floor(n / NAME_ADJ.length) % nouns.length) + nouns.length) % nouns.length;
  return `${NAME_ADJ[i]} ${nouns[j]}`;
}

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K, attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const n = document.createElementNS(SVG_NS, tag);
  for (const k of Object.keys(attrs)) n.setAttribute(k, String(attrs[k]));
  return n;
}

/** What a focusable mark on the chalkboard points at. */
interface Mark {
  kind: 'PLAYER' | 'NODE' | 'ZONE';
  player: number;
  node: number;
}

interface EditorMemo {
  side: EditorSide;
  slot: number;
  work: OffensePlay | DefensePlay;
  dirty: boolean;
  refOffId: string;
  refDefId: string;
  nameCounter: number;
}

/** Survives a trip out to the practice field, so unsaved work is never lost. */
let memo: EditorMemo | null = null;

export class PlayEditorScreen implements Screen {
  name = 'playEditor';

  private node: HTMLElement | null = null;
  private ring = new FocusRing();
  private ctx!: ScreenContext;

  private side: EditorSide = 'OFF';
  private slot = 0;
  private work!: OffensePlay | DefensePlay;
  private dirty = false;
  private nameCounter = 0;

  private sel: Mark = { kind: 'PLAYER', player: 0, node: -1 };
  private nudge = false;
  private problems: string[] = [];
  private status = '';

  private refOffId = OFFENSE_PLAYS[0].id;
  private refDefId = DEFENSE_PLAYS[0].id;

  private nameInput: HTMLInputElement | null = null;
  private typing = false;
  private needsRender = false;

  private itemKeys: string[] = [];
  private sections: number[] = [];
  private wantKey = '';

  private svg: SVGSVGElement | null = null;
  private dragging: Mark | null = null;
  private keyGuard: ((e: KeyboardEvent) => void) | null = null;
  private moveHandler: ((e: PointerEvent) => void) | null = null;
  private upHandler: ((e: PointerEvent) => void) | null = null;

  constructor(private game: Game) {}

  // ── lifecycle ──────────────────────────────────────────────────────────

  mount(ctx: ScreenContext): void {
    this.ctx = ctx;
    if (memo) {
      this.side = memo.side;
      this.slot = memo.slot;
      this.work = clonePlay(memo.work);
      this.dirty = memo.dirty;
      this.refOffId = memo.refOffId;
      this.refDefId = memo.refDefId;
      this.nameCounter = memo.nameCounter;
    } else {
      this.loadSlot('OFF', 0);
    }
    this.sel = { kind: 'PLAYER', player: 0, node: -1 };
    this.nudge = false;
    this.problems = [];
    this.status = 'PAGE (Tab or a shoulder button) jumps between the slot list, the field and the properties.';

    const input = el('input') as HTMLInputElement;
    input.type = 'text';
    input.maxLength = 20;
    input.className = 'mono';
    input.style.cssText = 'flex:1;min-width:0;width:100%;background:#0a0f1a;border:2px solid var(--edge);'
      + 'color:var(--hot-2);font:inherit;font-size:17px;padding:3px 6px;letter-spacing:.06em';
    input.addEventListener('focus', () => { this.typing = true; });
    input.addEventListener('blur', () => {
      this.typing = false;
      this.commitName();
      if (this.needsRender) { this.needsRender = false; this.render(); }
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'Escape') input.blur();
    });
    this.nameInput = input;

    // The input manager listens on window. While a play name is being typed,
    // swallow key events before they get there — stopPropagation leaves the
    // browser's own text editing untouched.
    this.keyGuard = (e: KeyboardEvent) => {
      if (this.typing && document.activeElement === this.nameInput) e.stopPropagation();
    };
    window.addEventListener('keydown', this.keyGuard, true);
    window.addEventListener('keyup', this.keyGuard, true);

    const shell = el('div', 'go-screen');
    shell.appendChild(el('div', 'go-dim'));
    ctx.root.appendChild(shell);
    this.node = shell;
    this.render();
  }

  unmount(): void {
    this.saveMemo();
    this.endDrag();
    if (this.keyGuard) {
      window.removeEventListener('keydown', this.keyGuard, true);
      window.removeEventListener('keyup', this.keyGuard, true);
      this.keyGuard = null;
    }
    this.node?.remove();
    this.node = null;
    this.svg = null;
    this.nameInput = null;
  }

  private saveMemo(): void {
    if (!this.work) return;
    memo = {
      side: this.side,
      slot: this.slot,
      work: clonePlay(this.work),
      dirty: this.dirty,
      refOffId: this.refOffId,
      refDefId: this.refDefId,
      nameCounter: this.nameCounter,
    };
  }

  // ── slots ──────────────────────────────────────────────────────────────

  private loadSlot(side: EditorSide, slot: number): void {
    this.side = side;
    this.slot = clamp(slot, 0, SLOTS_PER_SIDE - 1);
    const saved = loadCustom(side, this.slot);
    if (saved) {
      this.work = clonePlay(saved.data as OffensePlay | DefensePlay);
      this.dirty = false;
    } else {
      const nm = bankName(side, this.nameCounter);
      this.work = side === 'OFF' ? newCustomOffense(nm, this.slot) : newCustomDefense(nm, this.slot);
      this.dirty = true;
    }
    this.sel = { kind: 'PLAYER', player: 0, node: -1 };
    this.nudge = false;
    this.problems = [];
  }

  private get off(): OffensePlay | null { return isOffensePlay(this.work) ? this.work : null; }
  private get def(): DefensePlay | null { return isOffensePlay(this.work) ? null : this.work; }

  private touch(msg?: string): void {
    this.dirty = true;
    if (msg !== undefined) this.status = msg;
    this.render();
  }

  private commitName(): void {
    if (!this.nameInput) return;
    const next = sanitizeName(this.nameInput.value);
    if (next && next !== this.work.name) { this.work.name = next; this.dirty = true; }
    this.nameInput.value = this.work.name;
  }

  private noteDroppedEdits(): void {
    if (this.dirty) this.status = 'Unsaved edits on the previous slot were dropped.';
  }

  // ── the opposing call, used by the diagram and by PRACTICE ─────────────

  private offenseChoices(): OffensePlay[] { return [...customOffensePlays(), ...OFFENSE_PLAYS]; }
  private defenseChoices(): DefensePlay[] { return [...customDefensePlays(), ...DEFENSE_PLAYS]; }

  private refOffense(): OffensePlay {
    const list = this.offenseChoices();
    return list.find((p) => p.id === this.refOffId) ?? list[0] ?? OFFENSE_PLAYS[0];
  }

  private refDefense(): DefensePlay {
    const list = this.defenseChoices();
    return list.find((p) => p.id === this.refDefId) ?? list[0] ?? DEFENSE_PLAYS[0];
  }

  // ── render ─────────────────────────────────────────────────────────────

  private render(): void {
    if (this.typing) { this.needsRender = true; return; }
    const shell = this.node;
    if (!shell) return;
    clear(shell);
    shell.appendChild(el('div', 'go-dim'));

    const p = panel('PLAY EDITOR');
    p.classList.add('wide');
    p.style.maxWidth = '96vw';

    const items: FocusItem[] = [];
    const keys: string[] = [];
    this.sections = [];
    const section = (): void => { this.sections.push(items.length); };
    const add = (it: FocusItem, key: string): FocusItem => { items.push(it); keys.push(key); return it; };

    const body = el('div');
    body.style.cssText = 'display:grid;grid-template-columns:224px minmax(300px,540px) 296px;'
      + 'gap:14px;align-items:start';

    section();
    body.appendChild(this.buildSlots(add));
    section();
    body.appendChild(this.buildBoard(add));
    section();
    body.appendChild(this.buildProps(add));
    p.appendChild(body);

    section();
    p.appendChild(this.buildActions(add));
    shell.appendChild(p);

    this.itemKeys = keys;
    this.ring.set(items);
    const want = keys.indexOf(this.wantKey);
    if (want >= 0) this.ring.focusIndex(want);
    else this.wantKey = keys[this.ring.index] ?? '';
    this.ring.onNav = (e) => {
      this.wantKey = this.itemKeys[this.ring.index] ?? '';
      this.ctx.sound(e === 'select' ? 'select' : 'move');
    };
  }

  // ── left: the eighteen slots ───────────────────────────────────────────

  private buildSlots(add: (it: FocusItem, key: string) => FocusItem): HTMLElement {
    const col = el('div', 'stack');
    col.appendChild(el('div', 'muted', 'CUSTOM SLOTS · 9 OFFENCE · 9 DEFENCE'));

    const scroll = el('div', 'scroll');
    scroll.style.maxHeight = '340px';

    const saved = new Map<string, string>();
    for (const c of listCustom()) saved.set(`${c.side}${c.slot}`, c.name);

    for (const side of ['OFF', 'DEF'] as EditorSide[]) {
      const head = el('div', 'muted', side === 'OFF' ? 'OFFENCE' : 'DEFENCE');
      head.style.cssText = 'margin-top:6px;letter-spacing:.18em';
      scroll.appendChild(head);
      for (let i = 0; i < SLOTS_PER_SIDE; i++) {
        const here = side === this.side && i === this.slot;
        const stored = saved.get(`${side}${i}`);
        const row = el('div', 'go-opt');
        row.style.cssText = 'grid-template-columns:30px 1fr auto;font-size:15px;padding:5px 9px;cursor:pointer;gap:6px';
        row.append(
          el('span', 'go-opt-label', `${side === 'OFF' ? 'O' : 'D'}${i + 1}`),
          el('span', 'go-opt-value', here ? this.work.name : (stored ?? '—')),
          el('span', 'tag', here && this.dirty ? 'EDIT' : stored ? 'SAVED' : 'EMPTY'),
        );
        if (here) row.style.boxShadow = 'inset 4px 0 0 var(--hot-2)';
        const pick = (): void => {
          if (side === this.side && i === this.slot) return;
          this.noteDroppedEdits();
          this.loadSlot(side, i);
          this.wantKey = `slot-${side}-${i}`;
          this.render();
        };
        row.addEventListener('click', pick);
        scroll.appendChild(row);
        add({ el: row, onSelect: pick }, `slot-${side}-${i}`);
      }
    }
    col.appendChild(scroll);

    const mk = (label: string, fn: () => void, key: string, cls = 'ghost'): void => {
      const b = button(label, fn, cls);
      b.el.style.fontSize = '17px';
      col.appendChild(b.el);
      add(b, key);
    };

    mk('NEW', () => {
      const free = firstFreeSlot(this.side);
      if (free < 0) {
        this.ctx.sound('error');
        this.status = `All nine ${this.side === 'OFF' ? 'offensive' : 'defensive'} slots are in use — delete one first.`;
        this.render();
        return;
      }
      this.noteDroppedEdits();
      this.nameCounter++;
      this.loadSlot(this.side, free);
      this.work.name = sanitizeName(bankName(this.side, this.nameCounter));
      this.dirty = true;
      this.status = `New play started in ${this.side === 'OFF' ? 'O' : 'D'}${free + 1}.`;
      this.render();
    }, 'btn-new');

    mk('RENAME', () => {
      this.nameCounter++;
      this.work.name = sanitizeName(bankName(this.side, this.nameCounter));
      this.touch(`Renamed to ${this.work.name}. Select the name box to type your own.`);
    }, 'btn-rename');

    mk('COPY', () => {
      const free = firstFreeSlot(this.side);
      if (free < 0) {
        this.ctx.sound('error');
        this.status = 'No free slot to copy into.';
        this.render();
        return;
      }
      const problems = validatePlayEdit(this.work);
      if (problems.length) {
        this.ctx.sound('error');
        this.problems = problems;
        this.status = 'Fix the problems listed below before copying.';
        this.render();
        return;
      }
      const stored = saveCustom(this.side, free, this.work, `${this.work.name} B`);
      if (!stored) {
        this.ctx.sound('error');
        this.status = 'Copy refused — the custom playbook is full.';
        this.render();
        return;
      }
      this.loadSlot(this.side, free);
      this.status = `Copied into ${this.side === 'OFF' ? 'O' : 'D'}${free + 1}.`;
      this.render();
    }, 'btn-copy');

    mk('CLEAR', () => {
      this.nameCounter++;
      const nm = bankName(this.side, this.nameCounter);
      this.work = this.side === 'OFF' ? newCustomOffense(nm, this.slot) : newCustomDefense(nm, this.slot);
      this.sel = { kind: 'PLAYER', player: 0, node: -1 };
      this.problems = [];
      this.touch('Reset to a blank template. SAVE to overwrite what is stored in this slot.');
    }, 'btn-clear');

    mk('DELETE', () => {
      if (!deleteCustom(this.side, this.slot)) {
        this.ctx.sound('error');
        this.status = 'That slot is already empty.';
        this.render();
        return;
      }
      this.loadSlot(this.side, this.slot);
      this.status = 'Slot deleted.';
      this.render();
    }, 'btn-delete', 'ghost danger');

    return col;
  }

  // ── centre: the chalkboard ─────────────────────────────────────────────

  private buildBoard(add: (it: FocusItem, key: string) => FocusItem): HTMLElement {
    const col = el('div', 'stack');

    const head = el('div', 'spread');
    const title = el('div', '', `${this.side === 'OFF' ? 'OFFENCE' : 'DEFENCE'} · ${this.work.name}`);
    title.style.fontSize = '20px';
    const pill = el('span', 'pill', this.dirty ? 'UNSAVED' : 'SAVED');
    if (this.dirty) { pill.style.background = 'var(--hot)'; pill.style.color = '#180600'; }
    head.append(title, pill);
    col.appendChild(head);

    const svg = svgEl('svg', { viewBox: `0 0 ${FW} ${FH}`, width: FW, height: FH, role: 'img' });
    svg.style.cssText = 'width:100%;max-width:540px;height:auto;background:#08111c;'
      + 'border:3px solid var(--edge);touch-action:none;cursor:crosshair';
    this.svg = svg;
    this.paintField(svg);

    for (const m of this.paintPlays(svg)) {
      const key = m.mark.kind === 'PLAYER'
        ? `mark-p${m.mark.player}`
        : m.mark.kind === 'ZONE' ? `mark-z${m.mark.player}` : `mark-n${m.mark.player}-${m.mark.node}`;
      add({
        el: m.el as unknown as HTMLElement,
        onSelect: () => {
          this.sel = { ...m.mark };
          this.nudge = true;
          this.wantKey = key;
          this.status = 'NUDGE — movement keys move the mark (turbo for big steps), ACTION or BACK to stop.';
          this.render();
        },
      }, key);
      m.el.addEventListener('pointerdown', (e: Event) => {
        const pe = e as PointerEvent;
        pe.preventDefault();
        pe.stopPropagation();
        this.sel = { ...m.mark };
        this.wantKey = key;
        this.beginDrag(m.mark);
        this.render();
      });
    }

    svg.addEventListener('pointerdown', (e: PointerEvent) => {
      const t = e.target as Element;
      if (t !== svg && t.getAttribute('data-bg') !== '1') return;
      this.fieldClick(e);
    });
    col.appendChild(svg);

    const legend = el('div', 'muted');
    legend.innerHTML = this.side === 'OFF'
      ? 'Filled circle = receiver (L/M/R is his pass button) · ringed = quarterback · hollow = blocker'
        + ' · squares are waypoints. Click the grass to drop a waypoint on the selected player.'
      : 'Crosses are defenders · dashed rings are zones · the diamond is a zone centre.'
        + ' Click the grass to move the selected defender\'s zone.';
    col.appendChild(legend);

    if (this.status) {
      const st = el('div', 'muted', this.status);
      st.style.color = 'var(--hot-2)';
      col.appendChild(st);
    }

    if (this.problems.length) {
      const box = el('div');
      box.style.cssText = 'border:2px solid var(--bad);background:rgba(255,59,92,.09);'
        + 'padding:8px 10px;max-height:140px;overflow:auto';
      box.appendChild(el('div', 'tag', `${this.problems.length} PROBLEM${this.problems.length > 1 ? 'S' : ''}`));
      const list = el('div', 'muted');
      for (const problem of this.problems) list.appendChild(el('div', '', `· ${problem}`));
      box.appendChild(list);
      col.appendChild(box);
    }

    return col;
  }

  private paintField(svg: SVGSVGElement): void {
    svg.appendChild(svgEl('rect', { x: 0, y: 0, width: FW, height: FH, fill: '#0b1a12', 'data-bg': '1' }));
    svg.appendChild(svgEl('rect', {
      x: px(-26.665), y: 0, width: 26.665 * 2 * SX, height: FH, fill: '#0e2418', 'data-bg': '1',
    }));

    for (let z = -15; z <= 30; z += 5) {
      const y = py(z);
      const major = z % 10 === 0;
      svg.appendChild(svgEl('line', {
        x1: px(-26.665), y1: y, x2: px(26.665), y2: y,
        stroke: major ? '#2c4b39' : '#1d3527', 'stroke-width': major ? 1.5 : 1,
      }));
      if (z !== 0) {
        const label = svgEl('text', {
          x: px(-26.665) + 4, y: y - 3, fill: '#3f6650', 'font-size': 10,
          'font-family': 'ui-monospace,monospace',
        });
        label.textContent = `${z > 0 ? '+' : ''}${z}`;
        svg.appendChild(label);
      }
    }
    for (const hx of [-9.25, 9.25]) {
      svg.appendChild(svgEl('line', {
        x1: px(hx), y1: PAD, x2: px(hx), y2: FH - PAD,
        stroke: '#1d3527', 'stroke-width': 1, 'stroke-dasharray': '3 7',
      }));
    }
    for (const line of [-26.665, 26.665]) {
      svg.appendChild(svgEl('line', {
        x1: px(line), y1: PAD, x2: px(line), y2: FH - PAD, stroke: '#4a6d58', 'stroke-width': 2,
      }));
    }
    svg.appendChild(svgEl('line', {
      x1: px(-26.665), y1: py(30), x2: px(26.665), y2: py(30),
      stroke: '#ffb02e', 'stroke-width': 1.6, 'stroke-dasharray': '7 5', 'stroke-opacity': 0.5,
    }));
    const fd = svgEl('text', {
      x: px(-26.665) + 26, y: py(30) - 4, fill: '#ffb02e', 'font-size': 10,
      'font-family': 'ui-monospace,monospace', 'fill-opacity': 0.7,
    });
    fd.textContent = 'FIRST DOWN';
    svg.appendChild(fd);

    svg.appendChild(svgEl('line', {
      x1: px(-26.665), y1: py(0), x2: px(26.665), y2: py(0), stroke: '#f2f4f8', 'stroke-width': 2.4,
    }));
    const losLabel = svgEl('text', {
      x: px(26.665) - 32, y: py(0) - 6, fill: '#9aa6bd', 'font-size': 11,
      'font-family': 'ui-monospace,monospace',
    });
    losLabel.textContent = 'LOS';
    svg.appendChild(losLabel);
    void Z_BOT;
  }

  /** Draws both units and returns the interactive marks, in focus-ring order. */
  private paintPlays(svg: SVGSVGElement): Array<{ el: SVGElement; mark: Mark }> {
    const out: Array<{ el: SVGElement; mark: Mark }> = [];
    const offense = this.off ?? this.refOffense();
    const defense = this.def ?? this.refDefense();
    const editOff = this.off !== null;
    const liveOp = 1;
    const ghostOp = 0.34;

    // Defence first so offensive routes read over the top of it.
    const dop = editOff ? ghostOp : liveOp;
    for (let i = 0; i < defense.players.length; i++) {
      const d = defense.players[i];
      const a = d.assign;
      if (a.kind === 'ZONE') {
        svg.appendChild(svgEl('ellipse', {
          cx: px(a.x), cy: py(a.z), rx: Math.max(6, a.r * SX), ry: Math.max(6, a.r * SZ),
          fill: 'none', stroke: '#ffc94a', 'stroke-width': 1.6, 'stroke-dasharray': '5 4',
          'stroke-opacity': dop * 0.85,
        }));
        svg.appendChild(svgEl('line', {
          x1: px(d.align.x), y1: py(d.align.z), x2: px(a.x), y2: py(a.z),
          stroke: '#ffc94a', 'stroke-width': 1, 'stroke-dasharray': '2 4', 'stroke-opacity': dop * 0.55,
        }));
      } else if (a.kind === 'RUSH' || a.kind === 'BLITZ_DELAY') {
        svg.appendChild(svgEl('line', {
          x1: px(d.align.x), y1: py(d.align.z), x2: px(d.align.x + a.lane * 2.4), y2: py(-3),
          stroke: '#ff5a4d', 'stroke-width': 2, 'stroke-opacity': dop,
          'stroke-dasharray': a.kind === 'BLITZ_DELAY' ? '5 4' : '',
        }));
      } else if (a.kind === 'CONTAIN') {
        svg.appendChild(svgEl('line', {
          x1: px(d.align.x), y1: py(d.align.z), x2: px(d.align.x + a.side * 3.6), y2: py(-2),
          stroke: '#ff5a4d', 'stroke-width': 1.8, 'stroke-dasharray': '6 4', 'stroke-opacity': dop,
        }));
      } else if (a.kind === 'MAN') {
        const cover = offense.players.find((q) => q.target === a.slot);
        if (cover) {
          svg.appendChild(svgEl('line', {
            x1: px(d.align.x), y1: py(d.align.z), x2: px(cover.align.x), y2: py(cover.align.z),
            stroke: '#ff5a4d', 'stroke-width': 1.2, 'stroke-dasharray': '3 4', 'stroke-opacity': dop * 0.75,
          }));
        }
      } else {
        svg.appendChild(svgEl('circle', {
          cx: px(d.align.x), cy: py(d.align.z), r: 13, fill: 'none',
          stroke: '#ff5a4d', 'stroke-width': 1.2, 'stroke-dasharray': '2 4', 'stroke-opacity': dop,
        }));
      }

      const on = !editOff && this.sel.player === i;
      const g = svgEl('g', { opacity: dop });
      const cx = px(d.align.x);
      const cy = py(d.align.z);
      const arm = 8;
      const stroke = on ? '#ffd23f' : '#ff5a4d';
      const w = on ? 4 : 3;
      g.appendChild(svgEl('line', {
        x1: cx - arm, y1: cy - arm, x2: cx + arm, y2: cy + arm,
        stroke, 'stroke-width': w, 'stroke-linecap': 'round',
      }));
      g.appendChild(svgEl('line', {
        x1: cx - arm, y1: cy + arm, x2: cx + arm, y2: cy - arm,
        stroke, 'stroke-width': w, 'stroke-linecap': 'round',
      }));
      g.appendChild(svgEl('circle', { cx, cy, r: 12, fill: 'transparent' }));
      if (!editOff) {
        g.style.cursor = 'grab';
        out.push({ el: g, mark: { kind: 'PLAYER', player: i, node: -1 } });
      }
      svg.appendChild(g);
    }

    // Offence.
    const oop = editOff ? liveOp : ghostOp;
    for (let i = 0; i < offense.players.length; i++) {
      const p = offense.players[i];
      const route = Array.isArray(p.route) ? p.route : [];
      const pts: string[] = [`${px(p.align.x).toFixed(1)},${py(p.align.z).toFixed(1)}`];
      for (const nd of route) {
        pts.push(`${px(p.align.x + nd.x).toFixed(1)},${py(p.align.z + nd.z).toFixed(1)}`);
      }
      const blocking = route.length > 0 && route[route.length - 1].action === 'BLOCK';
      if (pts.length > 1) {
        svg.appendChild(svgEl('polyline', {
          points: pts.join(' '), fill: 'none',
          stroke: blocking ? '#8fa0b8' : '#f2f4f8',
          'stroke-width': blocking ? 1.8 : 2.2,
          'stroke-linejoin': 'round', 'stroke-linecap': 'round',
          'stroke-dasharray': blocking ? '4 3' : '', 'stroke-opacity': oop,
        }));
      }

      const on = editOff && this.sel.player === i;
      const g = svgEl('g', { opacity: oop });
      const cx = px(p.align.x);
      const cy = py(p.align.z);
      const ring = on ? '#ffd23f' : '#0b1a12';
      if (p.role === 'LINE') {
        g.appendChild(svgEl('circle', {
          cx, cy, r: 7, fill: 'none', stroke: on ? '#ffd23f' : '#f2f4f8', 'stroke-width': 2.6,
        }));
      } else if (p.role === 'QB') {
        g.appendChild(svgEl('circle', { cx, cy, r: 8.5, fill: '#f2f4f8', stroke: ring, 'stroke-width': 2.4 }));
        g.appendChild(svgEl('circle', { cx, cy, r: 3, fill: '#0b1a12' }));
      } else {
        g.appendChild(svgEl('circle', { cx, cy, r: 8, fill: '#f2f4f8', stroke: ring, 'stroke-width': 2.4 }));
        if (p.target !== null) {
          const t = svgEl('text', {
            x: cx, y: cy + 4, fill: '#0b1a12', 'font-size': 11, 'text-anchor': 'middle',
            'font-family': 'ui-monospace,monospace', 'font-weight': 'bold',
          });
          t.textContent = ['L', 'M', 'R'][p.target];
          g.appendChild(t);
        }
      }
      g.appendChild(svgEl('circle', { cx, cy, r: 12, fill: 'transparent' }));
      if (editOff) {
        g.style.cursor = 'grab';
        out.push({ el: g, mark: { kind: 'PLAYER', player: i, node: -1 } });
      }
      svg.appendChild(g);
    }

    // Waypoints of the selected offensive player.
    if (editOff && this.sel.player >= 0 && this.sel.player < offense.players.length) {
      const p = offense.players[this.sel.player];
      const route = Array.isArray(p.route) ? p.route : [];
      for (let k = 0; k < route.length; k++) {
        const nd = route[k];
        const x = px(p.align.x + nd.x);
        const y = py(p.align.z + nd.z);
        const on = this.sel.kind === 'NODE' && this.sel.node === k;
        const g = svgEl('g', {});
        g.appendChild(svgEl('rect', {
          x: x - 5.5, y: y - 5.5, width: 11, height: 11,
          fill: on ? '#ffd23f' : '#2fd4ff', stroke: '#04070c', 'stroke-width': 1.5,
        }));
        const t = svgEl('text', {
          x: x + 9, y: y + 4, fill: on ? '#ffd23f' : '#9aa6bd', 'font-size': 10,
          'font-family': 'ui-monospace,monospace',
        });
        t.textContent = ROUTE_LETTER[nd.action];
        g.appendChild(t);
        g.appendChild(svgEl('circle', { cx: x, cy: y, r: 11, fill: 'transparent' }));
        g.style.cursor = 'grab';
        svg.appendChild(g);
        out.push({ el: g, mark: { kind: 'NODE', player: this.sel.player, node: k } });
      }
    }

    // Zone handle of the selected defender.
    if (!editOff && this.sel.player >= 0 && this.sel.player < defense.players.length) {
      const a = defense.players[this.sel.player].assign;
      if (a.kind === 'ZONE') {
        const x = px(a.x);
        const y = py(a.z);
        const on = this.sel.kind === 'ZONE';
        const g = svgEl('g', {});
        g.appendChild(svgEl('polygon', {
          points: `${x},${y - 8} ${x + 8},${y} ${x},${y + 8} ${x - 8},${y}`,
          fill: on ? '#ffd23f' : '#ffc94a', stroke: '#04070c', 'stroke-width': 1.5,
        }));
        g.appendChild(svgEl('circle', { cx: x, cy: y, r: 12, fill: 'transparent' }));
        g.style.cursor = 'grab';
        svg.appendChild(g);
        out.push({ el: g, mark: { kind: 'ZONE', player: this.sel.player, node: -1 } });
      }
    }

    return out;
  }

  // ── right: properties ──────────────────────────────────────────────────

  private buildProps(add: (it: FocusItem, key: string) => FocusItem): HTMLElement {
    const col = el('div', 'stack');
    const scroll = el('div', 'scroll');
    scroll.style.maxHeight = '540px';

    const nameRow = el('div', 'go-opt');
    nameRow.style.gridTemplateColumns = '1fr auto auto auto';
    const input = this.nameInput!;
    input.value = this.work.name;
    const cycle = (d: number): void => {
      this.nameCounter += d;
      this.work.name = sanitizeName(bankName(this.side, this.nameCounter));
      this.touch();
    };
    const lArrow = el('button', 'go-opt-arrow', '‹');
    const rArrow = el('button', 'go-opt-arrow', '›');
    lArrow.addEventListener('click', (e) => { e.stopPropagation(); cycle(-1); });
    rArrow.addEventListener('click', (e) => { e.stopPropagation(); cycle(1); });
    nameRow.append(input, lArrow, el('span', 'muted', 'NAME'), rArrow);
    scroll.appendChild(nameRow);
    add({
      el: nameRow,
      onSelect: () => { input.focus(); input.select(); },
      onLeft: () => cycle(-1),
      onRight: () => cycle(1),
    }, 'prop-name');

    const sideRow = optionRow<EditorSide>({
      label: 'SIDE', values: ['OFF', 'DEF'],
      format: (v) => (v === 'OFF' ? 'OFFENCE' : 'DEFENCE'),
      get: () => this.side,
      set: (v) => {
        if (v === this.side) return;
        this.noteDroppedEdits();
        this.loadSlot(v, this.slot);
      },
    }, () => this.render());
    scroll.appendChild(sideRow.el);
    add(sideRow, 'prop-side');

    const off = this.off;
    const def = this.def;

    if (off) {
      const tagRow = optionRow<PlayTag>({
        label: 'PLAY TYPE', values: OFFENSE_TAGS,
        get: () => off.tags[0] ?? 'QUICK',
        set: (v) => { setOffenseTag(off, v); },
      }, () => this.touch());
      scroll.appendChild(tagRow.el);
      add(tagRow, 'prop-tag');

      const targetIdx = off.players
        .map((q, i) => ({ i, t: q.target }))
        .filter((e) => e.t !== null)
        .sort((a, b) => (a.t as number) - (b.t as number))
        .map((e) => e.i);
      const readLabel = (i: number): string => {
        const q = off.players[i];
        if (!q || q.target === null) return '—';
        return `${['LEFT', 'MIDDLE', 'RIGHT'][q.target]} · ${q.role}`;
      };
      const readRow = (which: 0 | 1, key: string, label: string): void => {
        const row = optionRow<number>({
          label, values: targetIdx, format: readLabel,
          get: () => off.reads[which],
          set: (v) => { if (!setRead(off, which, v)) this.ctx.sound('error'); },
        }, () => this.touch());
        scroll.appendChild(row.el);
        add(row, key);
      };
      readRow(0, 'prop-read0', 'PRIMARY READ');
      readRow(1, 'prop-read1', 'SECOND READ');

      const timeRow = optionRow<number>({
        label: 'READ TIMING', values: TIMING_STEPS,
        format: (v) => `${(v / 60).toFixed(1)}s`,
        get: () => TIMING_STEPS.reduce(
          (a, b) => (Math.abs(b - off.timing.primary) < Math.abs(a - off.timing.primary) ? b : a),
          TIMING_STEPS[0],
        ),
        set: (v) => { setTiming(off, v, v + s(0.7)); },
      }, () => this.touch());
      scroll.appendChild(timeRow.el);
      add(timeRow, 'prop-timing');

      const sy = sliderRow('SHORT YARDAGE', () => off.shortYardage, (v) => setShortYardage(off, v), 0.1, () => this.touch());
      scroll.appendChild(sy.el);
      add(sy, 'prop-short');
      const ds = sliderRow('DEEP SHOT', () => off.deepShot, (v) => setDeepShot(off, v), 0.1, () => this.touch());
      scroll.appendChild(ds.el);
      add(ds, 'prop-deep');

      const vs = optionRow<string>({
        label: 'VS DEFENCE', values: this.defenseChoices().map((q) => q.id),
        format: (v) => (this.defenseChoices().find((q) => q.id === v)?.name ?? v).toUpperCase(),
        get: () => this.refDefense().id,
        set: (v) => { this.refDefId = v; },
      }, () => this.render());
      scroll.appendChild(vs.el);
      add(vs, 'prop-vs');
    }

    if (def) {
      const tagRow = optionRow<DefenseTag>({
        label: 'CALL TYPE', values: DEFENSE_TAGS,
        get: () => def.tags[0] ?? 'MAN',
        set: (v) => { setDefenseTag(def, v); },
      }, () => this.touch());
      scroll.appendChild(tagRow.el);
      add(tagRow, 'prop-tag');

      const ag = sliderRow('AGGRESSION', () => def.aggression, (v) => setAggression(def, v), 0.1, () => this.touch());
      scroll.appendChild(ag.el);
      add(ag, 'prop-agg');
      const dh = sliderRow('DEEP HELP', () => def.deepHelp, (v) => setDeepHelp(def, v), 0.1, () => this.touch());
      scroll.appendChild(dh.el);
      add(dh, 'prop-help');

      const vs = optionRow<string>({
        label: 'VS OFFENCE', values: this.offenseChoices().map((q) => q.id),
        format: (v) => (this.offenseChoices().find((q) => q.id === v)?.name ?? v).toUpperCase(),
        get: () => this.refOffense().id,
        set: (v) => { this.refOffId = v; },
      }, () => this.render());
      scroll.appendChild(vs.el);
      add(vs, 'prop-vs');
    }

    scroll.appendChild(this.divider(off ? `PLAYER ${this.sel.player + 1} OF 7` : `DEFENDER ${this.sel.player + 1} OF 7`));
    if (off) this.buildOffenseProps(off, scroll, add);
    else if (def) this.buildDefenseProps(def, scroll, add);

    col.appendChild(scroll);
    return col;
  }

  private divider(text: string): HTMLElement {
    const d = el('div', 'muted', text);
    d.style.cssText = 'margin-top:10px;border-top:2px solid var(--edge);padding-top:8px;letter-spacing:.18em';
    return d;
  }

  private staticRow(label: string, value: string): HTMLElement {
    const r = el('div', 'go-opt');
    r.style.gridTemplateColumns = '1fr auto';
    r.append(el('span', 'go-opt-label', label), el('span', 'go-opt-value', value));
    return r;
  }

  private buildOffenseProps(
    off: OffensePlay, scroll: HTMLElement, add: (it: FocusItem, key: string) => FocusItem,
  ): void {
    const i = clamp(this.sel.player, 0, off.players.length - 1);
    const p = off.players[i];

    const roleRow = optionRow<OffenseRole>({
      label: 'ROLE', values: OFFENSE_ROLES,
      get: () => p.role,
      set: (v) => { if (!setRole(off, i, v)) this.ctx.sound('error'); },
    }, () => this.touch('A unit is always one quarterback, three blockers and three targets, so roles swap in pairs.'));
    scroll.appendChild(roleRow.el);
    add(roleRow, 'sel-role');

    scroll.appendChild(this.staticRow(
      'TARGET BUTTON', p.target === null ? 'NONE' : ['LEFT', 'MIDDLE', 'RIGHT'][p.target],
    ));
    scroll.appendChild(this.staticRow('ALIGNMENT', `${p.align.x.toFixed(1)} , ${p.align.z.toFixed(1)}`));

    if (p.role === 'LINE' || p.blockDir !== undefined) {
      const bd = optionRow<-1 | 0 | 1>({
        label: 'BLOCK DIR', values: [-1, 0, 1],
        format: (v) => (v === -1 ? 'LEFT' : v === 1 ? 'RIGHT' : 'STRAIGHT'),
        get: () => p.blockDir ?? 0,
        set: (v) => { setBlockDir(off, i, v); },
      }, () => this.touch());
      scroll.appendChild(bd.el);
      add(bd, 'sel-block');
    }

    const nudgeBtn = button(
      this.nudge && this.sel.kind === 'PLAYER' ? 'STOP NUDGING' : 'NUDGE PLAYER',
      () => {
        const stop = this.nudge && this.sel.kind === 'PLAYER';
        this.sel = { kind: 'PLAYER', player: i, node: -1 };
        this.nudge = !stop;
        this.status = this.nudge ? 'NUDGE — movement keys move the mark.' : '';
        this.render();
      }, 'ghost',
    );
    scroll.appendChild(nudgeBtn.el);
    add(nudgeBtn, 'sel-nudge');

    const addBtn = button('ADD WAYPOINT', () => {
      const last = p.route[p.route.length - 1];
      const k = addNode(off, i, last?.x ?? 0, (last?.z ?? 0) + 6, 'RUN');
      if (k < 0) {
        this.ctx.sound('error');
        this.status = 'That route already has the maximum number of waypoints.';
        this.render();
        return;
      }
      this.sel = { kind: 'NODE', player: i, node: k };
      this.wantKey = `mark-n${i}-${k}`;
      this.touch('Waypoint added. Drag it, or nudge it with the movement keys.');
    }, 'ghost');
    scroll.appendChild(addBtn.el);
    add(addBtn, 'sel-add');

    if (this.sel.kind === 'NODE' && this.sel.node >= 0 && this.sel.node < p.route.length) {
      const k = this.sel.node;
      const nd = p.route[k];
      scroll.appendChild(this.divider(`WAYPOINT ${k + 1} OF ${p.route.length}`));

      const actRow = optionRow<RouteAction>({
        label: 'ACTION', values: ROUTE_ACTIONS,
        get: () => nd.action,
        set: (v) => { setNodeAction(off, i, k, v); },
      }, () => this.touch());
      scroll.appendChild(actRow.el);
      add(actRow, 'node-action');

      const holdRow = optionRow<number>({
        label: 'HOLD', values: HOLD_STEPS,
        format: (v) => (v === 0 ? 'NONE' : `${(v / 60).toFixed(1)}s`),
        get: () => nd.hold ?? 0,
        set: (v) => { setNodeHold(off, i, k, v); },
      }, () => this.touch());
      scroll.appendChild(holdRow.el);
      add(holdRow, 'node-hold');

      scroll.appendChild(this.staticRow('OFFSET', `${nd.x.toFixed(1)} , ${nd.z.toFixed(1)}`));

      const del = button('DELETE WAYPOINT', () => {
        if (!removeNode(off, i, k)) {
          this.ctx.sound('error');
          this.status = 'A route needs at least one waypoint.';
          this.render();
          return;
        }
        this.sel = { kind: 'PLAYER', player: i, node: -1 };
        this.wantKey = `mark-p${i}`;
        this.touch('Waypoint removed.');
      }, 'ghost danger');
      scroll.appendChild(del.el);
      add(del, 'node-delete');
    }
  }

  private buildDefenseProps(
    def: DefensePlay, scroll: HTMLElement, add: (it: FocusItem, key: string) => FocusItem,
  ): void {
    const i = clamp(this.sel.player, 0, def.players.length - 1);
    const d = def.players[i];
    const a = d.assign;

    const kindRow = optionRow<DefenseAssign['kind']>({
      label: 'ASSIGNMENT', values: ASSIGN_KINDS,
      format: (v) => ASSIGN_LABEL[v],
      get: () => a.kind,
      set: (v) => { setAssignment(def, i, defaultAssignment(v, d.align)); },
    }, () => {
      if (this.sel.kind === 'ZONE') this.sel = { kind: 'PLAYER', player: i, node: -1 };
      this.touch();
    });
    scroll.appendChild(kindRow.el);
    add(kindRow, 'sel-assign');

    scroll.appendChild(this.staticRow('ALIGNMENT', `${d.align.x.toFixed(1)} , ${d.align.z.toFixed(1)}`));

    if (a.kind === 'RUSH' || a.kind === 'BLITZ_DELAY') {
      const lane = optionRow<number>({
        label: 'LANE', values: [-1, -0.6, -0.3, 0, 0.3, 0.6, 1],
        format: (v) => (v < 0 ? `LEFT ${Math.abs(v).toFixed(1)}` : v > 0 ? `RIGHT ${v.toFixed(1)}` : 'STRAIGHT'),
        get: () => a.lane,
        set: (v) => { setAssignment(def, i, { ...a, lane: v }); },
      }, () => this.touch());
      scroll.appendChild(lane.el);
      add(lane, 'sel-lane');
    }
    if (a.kind === 'BLITZ_DELAY') {
      const dl = optionRow<number>({
        label: 'DELAY', values: [s(0.2), s(0.5), s(0.8), s(1.2), s(1.8)],
        format: (v) => `${(v / 60).toFixed(1)}s`,
        get: () => a.delay,
        set: (v) => { setAssignment(def, i, { ...a, delay: v }); },
      }, () => this.touch());
      scroll.appendChild(dl.el);
      add(dl, 'sel-delay');
    }
    if (a.kind === 'CONTAIN') {
      const sd = optionRow<-1 | 1>({
        label: 'EDGE', values: [-1, 1],
        format: (v) => (v === -1 ? 'LEFT' : 'RIGHT'),
        get: () => a.side,
        set: (v) => { setAssignment(def, i, { kind: 'CONTAIN', side: v }); },
      }, () => this.touch());
      scroll.appendChild(sd.el);
      add(sd, 'sel-edge');
    }
    if (a.kind === 'MAN') {
      const sl = optionRow<number>({
        label: 'COVERS', values: [0, 1, 2],
        format: (v) => `${['LEFT', 'MIDDLE', 'RIGHT'][v]} RECEIVER`,
        get: () => a.slot,
        set: (v) => { setAssignment(def, i, { kind: 'MAN', slot: v }); },
      }, () => this.touch());
      scroll.appendChild(sl.el);
      add(sl, 'sel-man');
    }
    if (a.kind === 'ZONE') {
      const rad = optionRow<number>({
        label: 'ZONE SIZE', values: [4, 6, 8, 10, 12, 14, 16, 18, 20],
        format: (v) => `${v} YD`,
        get: () => a.r,
        set: (v) => { setAssignment(def, i, { ...a, r: v }); },
      }, () => this.touch());
      scroll.appendChild(rad.el);
      add(rad, 'sel-zone-r');
      scroll.appendChild(this.staticRow('ZONE CENTRE', `${a.x.toFixed(1)} , ${a.z.toFixed(1)}`));

      const zn = button(
        this.nudge && this.sel.kind === 'ZONE' ? 'STOP NUDGING' : 'NUDGE ZONE',
        () => {
          const stop = this.nudge && this.sel.kind === 'ZONE';
          this.sel = { kind: 'ZONE', player: i, node: -1 };
          this.nudge = !stop;
          this.status = this.nudge ? 'NUDGE — movement keys move the zone centre.' : '';
          this.render();
        }, 'ghost',
      );
      scroll.appendChild(zn.el);
      add(zn, 'sel-zone-nudge');
    }

    const nudgeBtn = button(
      this.nudge && this.sel.kind === 'PLAYER' ? 'STOP NUDGING' : 'NUDGE DEFENDER',
      () => {
        const stop = this.nudge && this.sel.kind === 'PLAYER';
        this.sel = { kind: 'PLAYER', player: i, node: -1 };
        this.nudge = !stop;
        this.status = this.nudge ? 'NUDGE — movement keys move the mark.' : '';
        this.render();
      }, 'ghost',
    );
    scroll.appendChild(nudgeBtn.el);
    add(nudgeBtn, 'sel-nudge');
  }

  // ── bottom: the verbs ──────────────────────────────────────────────────

  private buildActions(add: (it: FocusItem, key: string) => FocusItem): HTMLElement {
    const row = el('div', 'row');
    row.style.marginTop = '12px';
    const mk = (label: string, fn: () => void, key: string, cls = ''): void => {
      const b = button(label, fn, cls);
      b.el.style.width = 'auto';
      b.el.style.minWidth = '148px';
      row.appendChild(b.el);
      add(b, key);
    };

    mk('SAVE', () => {
      this.problems = validatePlayEdit(this.work);
      if (this.problems.length) {
        this.ctx.sound('error');
        this.status = 'Not saved — fix the problems listed below.';
        this.render();
        return;
      }
      const stored = saveCustom(this.side, this.slot, this.work);
      if (!stored) {
        this.ctx.sound('error');
        this.status = 'Save refused — the custom playbook is full.';
        this.render();
        return;
      }
      this.work = clonePlay(stored.data as OffensePlay | DefensePlay);
      this.dirty = false;
      this.status = `Saved to ${this.side === 'OFF' ? 'O' : 'D'}${this.slot + 1}. It is now offered on the practice field.`;
      this.render();
    }, 'act-save');

    mk('VALIDATE', () => {
      this.problems = validatePlayEdit(this.work);
      this.ctx.sound(this.problems.length ? 'error' : 'select');
      this.status = this.problems.length
        ? `${this.problems.length} problem${this.problems.length > 1 ? 's' : ''} to fix.`
        : 'Clean — this play is ready to run.';
      this.render();
    }, 'act-validate');

    mk('PREVIEW', () => this.launch(true), 'act-preview');
    mk('PRACTICE', () => this.launch(false), 'act-practice');
    mk('BACK', () => { this.saveMemo(); this.ctx.sound('back'); this.ctx.back(); }, 'act-back', 'ghost');

    return row;
  }

  /**
   * PREVIEW watches the call with nothing fighting it — a frozen defence for an
   * offensive play, the other side of the ball for a defensive one. PRACTICE
   * hands you the controls against the chosen opponent. Both run the working
   * copy, saved or not.
   */
  private launch(preview: boolean): void {
    this.problems = validatePlayEdit(this.work);
    if (this.problems.length) {
      this.ctx.sound('error');
      this.status = 'A play with problems cannot be run — fix them first.';
      this.render();
      return;
    }
    const off = this.off;
    const label = preview ? 'PREVIEW' : 'PRACTICE';
    const params: PracticeParams = off
      ? {
        offense: clonePlay(off),
        defense: this.refDefense(),
        routesOnly: preview,
        side: 'OFF',
        autoStart: true,
        returnScreen: this.name,
        label,
      }
      : {
        offense: this.refOffense(),
        defense: clonePlay(this.def!),
        routesOnly: false,
        side: preview ? 'OFF' : 'DEF',
        autoStart: true,
        returnScreen: this.name,
        label,
      };
    this.saveMemo();
    this.ctx.sound('select');
    this.ctx.go('practice', params);
  }

  // ── dragging ───────────────────────────────────────────────────────────

  private beginDrag(mark: Mark): void {
    this.endDrag();
    this.dragging = { ...mark };
    this.moveHandler = (e: PointerEvent) => this.dragMove(e);
    this.upHandler = () => this.endDrag();
    window.addEventListener('pointermove', this.moveHandler);
    window.addEventListener('pointerup', this.upHandler);
    window.addEventListener('pointercancel', this.upHandler);
  }

  private endDrag(): void {
    if (this.moveHandler) window.removeEventListener('pointermove', this.moveHandler);
    if (this.upHandler) {
      window.removeEventListener('pointerup', this.upHandler);
      window.removeEventListener('pointercancel', this.upHandler);
    }
    this.moveHandler = null;
    this.upHandler = null;
    this.dragging = null;
  }

  /** Client coordinates → yards, honouring the SVG's letterboxed scaling. */
  private toField(e: { clientX: number; clientY: number }): { x: number; z: number } | null {
    const svg = this.svg;
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    const scale = Math.min(r.width / FW, r.height / FH);
    const ox = (r.width - FW * scale) / 2;
    const oy = (r.height - FH * scale) / 2;
    return {
      x: invX((e.clientX - r.left - ox) / scale),
      z: invZ((e.clientY - r.top - oy) / scale),
    };
  }

  private dragMove(e: PointerEvent): void {
    const d = this.dragging;
    if (!d) return;
    const at = this.toField(e);
    if (at) this.applyMove(d, at.x, at.z, true);
  }

  private fieldClick(e: PointerEvent): void {
    const at = this.toField(e);
    if (!at) return;
    const off = this.off;
    if (off) {
      const i = clamp(this.sel.player, 0, off.players.length - 1);
      const p = off.players[i];
      const k = addNode(off, i, at.x - p.align.x, at.z - p.align.z, 'RUN');
      if (k < 0) {
        this.ctx.sound('error');
        this.status = 'That route already has the maximum number of waypoints.';
        this.render();
        return;
      }
      this.sel = { kind: 'NODE', player: i, node: k };
      this.wantKey = `mark-n${i}-${k}`;
      this.ctx.sound('select');
      this.touch('Waypoint added.');
      return;
    }
    const def = this.def;
    if (!def) return;
    const i = clamp(this.sel.player, 0, def.players.length - 1);
    const a = def.players[i].assign;
    if (a.kind !== 'ZONE') {
      this.ctx.sound('error');
      this.status = 'Give this defender a zone before placing one.';
      this.render();
      return;
    }
    setAssignment(def, i, { ...a, x: at.x, z: at.z });
    this.sel = { kind: 'ZONE', player: i, node: -1 };
    this.ctx.sound('select');
    this.touch('Zone moved.');
  }

  /** Absolute (drag) or relative (nudge) move of whatever is selected. */
  private applyMove(mark: Mark, x: number, z: number, absolute: boolean): void {
    const off = this.off;
    const def = this.def;
    if (mark.kind === 'PLAYER') {
      const cur = this.work.players[mark.player];
      if (!cur) return;
      moveSlot(
        this.work, mark.player,
        absolute ? x : cur.align.x + x,
        absolute ? z : cur.align.z + z,
      );
    } else if (mark.kind === 'NODE' && off) {
      const p = off.players[mark.player];
      const nd = p?.route?.[mark.node];
      if (!nd) return;
      moveNode(
        off, mark.player, mark.node,
        absolute ? x - p.align.x : nd.x + x,
        absolute ? z - p.align.z : nd.z + z,
      );
    } else if (mark.kind === 'ZONE' && def) {
      const a = def.players[mark.player]?.assign;
      if (!a || a.kind !== 'ZONE') return;
      setAssignment(def, mark.player, {
        ...a, x: absolute ? x : a.x + x, z: absolute ? z : a.z + z,
      });
    } else {
      return;
    }
    this.dirty = true;
    this.render();
  }

  // ── frame ──────────────────────────────────────────────────────────────

  update(): void {
    const input = this.ctx.input;
    if (this.typing) return;

    if (this.nudge) {
      let dx = 0;
      let dz = 0;
      if (input.menuPressed(Action.UP)) dz += 1;
      if (input.menuPressed(Action.DOWN)) dz -= 1;
      if (input.menuPressed(Action.LEFT)) dx -= 1;
      if (input.menuPressed(Action.RIGHT)) dx += 1;
      if (dx !== 0 || dz !== 0) {
        const step = this.turboHeld() ? 2 : 0.5;
        this.applyMove(this.sel, dx * step, dz * step, false);
        this.ctx.sound('move');
        return;
      }
      if (input.menuPressed(Action.ACTION) || input.menuPressed(Action.BACK)) {
        this.nudge = false;
        this.status = '';
        this.ctx.sound('back');
        this.render();
      }
      return;
    }

    if (input.menuPressed(Action.PAGE)) {
      this.jumpSection();
      this.ctx.sound('move');
      return;
    }

    const before = this.wantKey;
    driveFocus(this.ring, input, this.ctx);
    if (this.wantKey !== before) this.syncSelectionFromFocus();
  }

  private turboHeld(): boolean {
    for (let seat = 0; seat < 4; seat++) {
      const it = this.game.input.intentFor(seat);
      if (it && (it.held & Action.TURBO) !== 0) return true;
    }
    return false;
  }

  private jumpSection(): void {
    if (this.sections.length === 0) return;
    const cur = this.ring.index;
    const next = this.sections.find((i) => i > cur) ?? this.sections[0];
    this.ring.focusIndex(next);
    this.wantKey = this.itemKeys[this.ring.index] ?? '';
    this.syncSelectionFromFocus();
  }

  /** Walking the ring onto a chalkboard mark selects it, without entering nudge. */
  private syncSelectionFromFocus(): void {
    const key = this.itemKeys[this.ring.index] ?? '';
    const player = /^mark-p(\d+)$/.exec(key);
    if (player) {
      this.sel = { kind: 'PLAYER', player: Number(player[1]), node: -1 };
      this.render();
      return;
    }
    const node = /^mark-n(\d+)-(\d+)$/.exec(key);
    if (node) {
      this.sel = { kind: 'NODE', player: Number(node[1]), node: Number(node[2]) };
      this.render();
      return;
    }
    const zone = /^mark-z(\d+)$/.exec(key);
    if (zone) {
      this.sel = { kind: 'ZONE', player: Number(zone[1]), node: -1 };
      this.render();
    }
  }
}
