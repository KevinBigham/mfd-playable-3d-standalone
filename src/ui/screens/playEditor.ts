/**
 * GRIDIRON OVERDRIVE — play editor.
 *
 * A real authoring tool: drag alignments, draw route nodes, set per-node actions, assign
 * blocking and coverage, then run the thing on the practice field without leaving the screen
 * stack. Everything it edits is the same `OffensePlay` / `DefensePlay` shape the sim consumes,
 * so a play you build here is not a special case anywhere downstream.
 */

import type { Screen, ScreenContext, FocusItem } from '../uiKit.ts';
import { el, clear, FocusRing, button, panel } from '../uiKit.ts';
import { Action } from '../../input/actions.ts';
import type { Game } from '../../app/Game.ts';
import type {
  DefenseAssign, DefensePlay, OffensePlay, OffenseRole, RouteAction,
} from '../../core/types.ts';
import { DEFENSE_PLAYS } from '../../plays/defense.ts';
import { clamp } from '../../core/math.ts';
import {
  type EditorSide, SLOTS_PER_SIDE, ROUTE_ACTIONS, OFFENSE_ROLES, ASSIGN_KINDS,
  newCustomPlay, isOffensePlay, moveSlot, setRole, setBlockDir, addNode, moveNode, removeNode,
  setNodeAction, setAssignment, defaultAssignment, reassignTargets, validate,
  loadCustom, saveCustom, deleteCustom, copyCustom, listCustom, clonePlay,
  slotLimits, MAX_ROUTE_NODES,
} from '../../modes/playEditor.ts';

// Field view: 60 yards wide by 46 yards deep, LOS two-thirds of the way down.
const VIEW_W = 560;
const VIEW_H = 430;
const YD_X = VIEW_W / 58;
const YD_Z = VIEW_H / 44;
const LOS_Y = VIEW_H * 0.70;

function fx(x: number): number { return VIEW_W / 2 + x * YD_X; }
function fz(z: number): number { return LOS_Y - z * YD_Z; }
function unfx(px: number): number { return (px - VIEW_W / 2) / YD_X; }
function unfz(py: number): number { return (LOS_Y - py) / YD_Z; }

type Selection =
  | { kind: 'PLAYER'; index: number }
  | { kind: 'NODE'; index: number; node: number }
  | { kind: 'NONE' };

export class PlayEditorScreen implements Screen {
  name = 'playEditor';
  private ctx!: ScreenContext;
  private node: HTMLElement | null = null;
  private ring = new FocusRing();
  private side: EditorSide = 'OFF';
  private slot = 0;
  private play: OffensePlay | DefensePlay;
  private sel: Selection = { kind: 'PLAYER', index: 0 };
  private dirty = false;
  private message = '';
  private problems: string[] = [];
  private svgHost!: HTMLElement;
  private propsHost!: HTMLElement;
  private slotHost!: HTMLElement;
  private statusHost!: HTMLElement;
  private dragging = -1;

  constructor(private game: Game) {
    this.play = newCustomPlay('OFF', 'New Play', 0);
  }

  mount(ctx: ScreenContext): void {
    this.ctx = ctx;
    const existing = loadCustom(this.side, this.slot);
    this.play = existing ? clonePlay(existing.data) : newCustomPlay(this.side, 'New Play', this.slot);
    this.dirty = false;
    this.message = existing ? `Loaded "${existing.name}"` : 'New play';
    const s = el('div', 'go-screen');
    s.appendChild(el('div', 'go-dim'));
    ctx.root.appendChild(s);
    this.node = s;
    this.build();
  }

  unmount(): void { this.node?.remove(); this.node = null; }

  // ── layout ───────────────────────────────────────────────────────────────

  private build(): void {
    const s = this.node!;
    clear(s);
    s.appendChild(el('div', 'go-dim'));
    const p = panel('PLAY EDITOR', 'Build a call, test it, slot it into your playbook.');
    p.classList.add('wide');

    const cols = el('div');
    cols.style.cssText = 'display:grid;grid-template-columns:210px 1fr 260px;gap:14px;align-items:start';

    this.slotHost = el('div', 'stack');
    this.svgHost = el('div');
    this.svgHost.style.cssText = 'background:#0a1420;border:3px solid var(--edge);position:relative';
    this.propsHost = el('div', 'stack');
    cols.append(this.slotHost, this.svgHost, this.propsHost);

    this.statusHost = el('div', 'muted');
    this.statusHost.style.cssText = 'min-height:38px;margin-top:8px';

    p.append(cols, this.statusHost);
    s.appendChild(p);
    this.refresh();
  }

  private refresh(): void {
    this.paintSlots();
    this.paintField();
    this.paintProps();
    this.paintStatus();
    this.rebuildFocus();
  }

  // ── slot list ────────────────────────────────────────────────────────────

  private paintSlots(): void {
    clear(this.slotHost);
    const head = el('div', 'row');
    for (const sd of ['OFF', 'DEF'] as EditorSide[]) {
      const t = el('button', `tag ${this.side === sd ? 'on' : ''}`.trim(), sd === 'OFF' ? 'OFFENCE' : 'DEFENCE');
      t.addEventListener('click', () => this.switchSide(sd));
      head.appendChild(t);
    }
    this.slotHost.appendChild(head);

    const saved = listCustom(this.side);
    for (let i = 0; i < SLOTS_PER_SIDE; i++) {
      const rec = saved.find((c) => c.slot === i);
      const b = el('div', `go-opt ${i === this.slot ? 'focused' : ''}`.trim());
      b.style.cssText = 'grid-template-columns:1fr auto;font-size:15px;cursor:pointer';
      b.append(el('span', 'go-opt-label', rec ? rec.name : `— slot ${i + 1} —`));
      b.append(el('span', 'go-opt-value', rec ? '●' : ''));
      b.addEventListener('click', () => this.selectSlot(i));
      this.slotHost.appendChild(b);
    }
  }

  private switchSide(sd: EditorSide): void {
    if (sd === this.side) return;
    this.side = sd;
    this.slot = 0;
    this.loadSlot();
  }

  private selectSlot(i: number): void {
    this.slot = i;
    this.loadSlot();
  }

  private loadSlot(): void {
    const rec = loadCustom(this.side, this.slot);
    this.play = rec ? clonePlay(rec.data) : newCustomPlay(this.side, `New ${this.side === 'OFF' ? 'Offence' : 'Defence'}`, this.slot);
    this.sel = { kind: 'PLAYER', index: 0 };
    this.dirty = false;
    this.problems = [];
    this.message = rec ? `Loaded "${rec.name}"` : 'Empty slot — start from the default look';
    this.ctx.sound('move');
    this.refresh();
  }

  // ── field view ───────────────────────────────────────────────────────────

  private paintField(): void {
    clear(this.svgHost);
    const off = isOffensePlay(this.play);
    const parts: string[] = [];
    parts.push(`<svg viewBox="0 0 ${VIEW_W} ${VIEW_H}" width="${VIEW_W}" height="${VIEW_H}" style="display:block">`);
    parts.push(`<rect width="${VIEW_W}" height="${VIEW_H}" fill="#10361f"/>`);
    for (let z = -10; z <= 32; z += 5) {
      const y = fz(z);
      parts.push(`<line x1="0" y1="${y.toFixed(1)}" x2="${VIEW_W}" y2="${y.toFixed(1)}" stroke="#ffffff" stroke-opacity="${z === 0 ? 0.85 : 0.16}" stroke-width="${z === 0 ? 2.5 : 1}"/>`);
    }
    for (const hx of [-9.25, 9.25]) {
      parts.push(`<line x1="${fx(hx)}" y1="0" x2="${fx(hx)}" y2="${VIEW_H}" stroke="#ffffff" stroke-opacity="0.10" stroke-dasharray="3 7"/>`);
    }
    parts.push(`<line x1="0" y1="${fz(30)}" x2="${VIEW_W}" y2="${fz(30)}" stroke="#ffd23f" stroke-opacity="0.75" stroke-width="2" stroke-dasharray="8 6"/>`);
    parts.push(`<text x="6" y="${fz(30) - 5}" fill="#ffd23f" font-size="11" font-family="system-ui">FIRST DOWN</text>`);

    // routes / zones
    this.play.players.forEach((pl, i) => {
      const ax = fx(pl.align.x), az = fz(pl.align.z);
      if (off) {
        const o = pl as OffensePlay['players'][number];
        if (o.route.length) {
          const pts = [`${ax.toFixed(1)},${az.toFixed(1)}`];
          for (const n of o.route) pts.push(`${fx(pl.align.x + n.x).toFixed(1)},${fz(pl.align.z + n.z).toFixed(1)}`);
          parts.push(`<polyline points="${pts.join(' ')}" fill="none" stroke="#ffd23f" stroke-opacity="0.9" stroke-width="2.4"/>`);
          o.route.forEach((n, k) => {
            const nx = fx(pl.align.x + n.x), nz = fz(pl.align.z + n.z);
            const on = this.sel.kind === 'NODE' && this.sel.index === i && this.sel.node === k;
            parts.push(`<circle cx="${nx.toFixed(1)}" cy="${nz.toFixed(1)}" r="${on ? 7 : 4.5}" fill="${on ? '#ff4d1f' : '#ffd23f'}" stroke="#0a1420" stroke-width="1.5" data-node="${i}:${k}"/>`);
            parts.push(`<text x="${(nx + 8).toFixed(1)}" y="${(nz - 6).toFixed(1)}" fill="#cfe3ff" font-size="9" font-family="system-ui">${n.action}</text>`);
          });
        }
      } else {
        const d = (this.play as DefensePlay).players[i];
        if (d.assign.kind === 'ZONE') {
          parts.push(`<circle cx="${fx(d.assign.x).toFixed(1)}" cy="${fz(d.assign.z).toFixed(1)}" r="${(d.assign.r * YD_X).toFixed(1)}" fill="#3fd0ff" fill-opacity="0.10" stroke="#3fd0ff" stroke-opacity="0.7" stroke-dasharray="6 4"/>`);
        } else if (d.assign.kind === 'RUSH' || d.assign.kind === 'BLITZ_DELAY') {
          parts.push(`<line x1="${ax}" y1="${az}" x2="${fx(pl.align.x + d.assign.lane * 2.4)}" y2="${fz(-4)}" stroke="#ff4d1f" stroke-width="2.4" marker-end="url(#ar)"/>`);
        }
      }
    });

    // players
    this.play.players.forEach((pl, i) => {
      const ax = fx(pl.align.x), az = fz(pl.align.z);
      const on = (this.sel.kind === 'PLAYER' || this.sel.kind === 'NODE') && this.sel.index === i;
      const label = off
        ? (pl as OffensePlay['players'][number]).role[0]
        : (this.play as DefensePlay).players[i].assign.kind[0];
      parts.push(`<circle cx="${ax.toFixed(1)}" cy="${az.toFixed(1)}" r="${on ? 12 : 9.5}" fill="${off ? '#f4f7ff' : '#1d2739'}" stroke="${on ? '#ff4d1f' : '#8ea3c4'}" stroke-width="${on ? 3.5 : 2}" data-player="${i}" style="cursor:grab"/>`);
      parts.push(`<text x="${ax.toFixed(1)}" y="${(az + 4).toFixed(1)}" text-anchor="middle" font-size="11" font-family="Impact,system-ui" fill="${off ? '#0a1420' : '#dbe6f7'}" pointer-events="none">${label}</text>`);
    });
    parts.push('<defs><marker id="ar" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#ff4d1f"/></marker></defs>');
    parts.push('</svg>');
    this.svgHost.innerHTML = parts.join('');

    const svg = this.svgHost.querySelector('svg') as SVGSVGElement;
    svg.addEventListener('pointerdown', (e) => this.onPointer(e as PointerEvent, svg, 'down'));
    svg.addEventListener('pointermove', (e) => this.onPointer(e as PointerEvent, svg, 'move'));
    svg.addEventListener('pointerup', () => { this.dragging = -1; });
    svg.addEventListener('pointerleave', () => { this.dragging = -1; });
  }

  private toField(e: PointerEvent, svg: SVGSVGElement): { x: number; z: number } {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * VIEW_W;
    const py = ((e.clientY - r.top) / r.height) * VIEW_H;
    return { x: unfx(px), z: unfz(py) };
  }

  private onPointer(e: PointerEvent, svg: SVGSVGElement, kind: 'down' | 'move'): void {
    const target = e.target as SVGElement;
    const pos = this.toField(e, svg);
    if (kind === 'down') {
      const pIdx = target.getAttribute('data-player');
      const nIdx = target.getAttribute('data-node');
      if (pIdx !== null) {
        this.sel = { kind: 'PLAYER', index: Number(pIdx) };
        this.dragging = Number(pIdx);
        this.refresh();
        return;
      }
      if (nIdx !== null) {
        const [i, k] = nIdx.split(':').map(Number);
        this.sel = { kind: 'NODE', index: i, node: k };
        this.refresh();
        return;
      }
      // Empty field click: append a route node to the selected offensive player.
      if (isOffensePlay(this.play) && this.sel.kind !== 'NONE') {
        const i = this.sel.index;
        const pl = this.play.players[i];
        const ok = addNode(this.play, i, pos.x - pl.align.x, pos.z - pl.align.z, 'RUN');
        if (ok) {
          this.dirty = true;
          this.sel = { kind: 'NODE', index: i, node: this.play.players[i].route.length - 1 };
          this.message = `Node added (${this.play.players[i].route.length}/${MAX_ROUTE_NODES})`;
        } else {
          this.message = 'Route is full';
        }
        this.refresh();
      }
      return;
    }
    if (this.dragging >= 0 && e.buttons) {
      moveSlot(this.play, this.dragging, pos.x, pos.z);
      if (isOffensePlay(this.play)) reassignTargets(this.play);
      this.dirty = true;
      this.paintField();
      this.paintProps();
    }
  }

  // ── properties ───────────────────────────────────────────────────────────

  private paintProps(): void {
    clear(this.propsHost);
    const off = isOffensePlay(this.play);

    const nameRow = el('div', 'go-opt');
    nameRow.style.gridTemplateColumns = '1fr';
    const input = el('input');
    input.value = this.play.name;
    input.maxLength = 20;
    input.style.cssText = 'width:100%;background:#0a0f1a;border:2px solid var(--edge);color:var(--ink);font:inherit;font-size:17px;padding:4px 8px';
    input.addEventListener('input', () => { this.play.name = input.value; this.dirty = true; });
    nameRow.appendChild(input);
    this.propsHost.append(el('div', 'muted', 'PLAY NAME'), nameRow);

    if (this.sel.kind === 'NONE') return;
    const i = this.sel.index;
    const pl = this.play.players[i];

    this.propsHost.appendChild(el('div', 'muted', `PLAYER ${i + 1}`));

    if (off) {
      const o = (this.play as OffensePlay).players[i];
      this.propsHost.appendChild(this.cycleRow('ROLE', OFFENSE_ROLES, o.role, (v) => {
        setRole(this.play as OffensePlay, i, v as OffenseRole);
        reassignTargets(this.play as OffensePlay);
        this.dirty = true; this.refresh();
      }));
      this.propsHost.appendChild(this.readonlyRow('TARGET', o.target === null ? '—' : ['LEFT', 'MIDDLE', 'RIGHT'][o.target]));
      if (o.role === 'LINE') {
        this.propsHost.appendChild(this.cycleRow('BLOCK', ['-1', '0', '1'], String(o.blockDir ?? 0), (v) => {
          setBlockDir(this.play as OffensePlay, i, Number(v) as -1 | 0 | 1);
          this.dirty = true; this.refresh();
        }));
      }
      if (this.sel.kind === 'NODE') {
        const k = this.sel.node;
        const n = o.route[k];
        if (n) {
          this.propsHost.appendChild(el('div', 'muted', `NODE ${k + 1} / ${o.route.length}`));
          this.propsHost.appendChild(this.cycleRow('ACTION', ROUTE_ACTIONS, n.action, (v) => {
            setNodeAction(this.play as OffensePlay, i, k, v as RouteAction);
            this.dirty = true; this.refresh();
          }));
          const del = button('DELETE NODE', () => {
            removeNode(this.play as OffensePlay, i, k);
            this.sel = { kind: 'PLAYER', index: i };
            this.dirty = true; this.refresh();
          }, 'ghost');
          this.propsHost.appendChild(del.el);
        }
      } else {
        this.propsHost.appendChild(el('div', 'muted', 'Click the field to add a route node.'));
      }
    } else {
      const d = (this.play as DefensePlay).players[i];
      this.propsHost.appendChild(this.cycleRow('ASSIGNMENT', ASSIGN_KINDS, d.assign.kind, (v) => {
        setAssignment(this.play as DefensePlay, i,
          defaultAssignment(v as DefenseAssign['kind'], pl.align));
        this.dirty = true; this.refresh();
      }));
      if (d.assign.kind === 'MAN') {
        this.propsHost.appendChild(this.cycleRow('COVERS', ['0', '1', '2'], String(d.assign.slot), (v) => {
          setAssignment(this.play as DefensePlay, i, { kind: 'MAN', slot: Number(v) });
          this.dirty = true; this.refresh();
        }));
      }
      if (d.assign.kind === 'ZONE') {
        const a = d.assign;
        this.propsHost.appendChild(this.nudgeRow('ZONE DEPTH', a.z.toFixed(0), (dz) => {
          setAssignment(this.play as DefensePlay, i, { kind: 'ZONE', x: a.x, z: clamp(a.z + dz * 2, 0, 40), r: a.r });
          this.dirty = true; this.refresh();
        }));
        this.propsHost.appendChild(this.nudgeRow('ZONE WIDTH', a.r.toFixed(0), (dr) => {
          setAssignment(this.play as DefensePlay, i, { kind: 'ZONE', x: a.x, z: a.z, r: clamp(a.r + dr, 3, 20) });
          this.dirty = true; this.refresh();
        }));
      }
    }

    const lim = slotLimits(this.play, i);
    this.propsHost.appendChild(el('div', 'muted',
      `x ${pl.align.x.toFixed(1)} · z ${pl.align.z.toFixed(1)}  (limits ${lim.minX.toFixed(0)}..${lim.maxX.toFixed(0)}, ${lim.minZ.toFixed(0)}..${lim.maxZ.toFixed(0)})`));
  }

  private cycleRow(label: string, values: readonly string[], current: string, onSet: (v: string) => void): HTMLElement {
    const row = el('div', 'go-opt');
    row.append(el('span', 'go-opt-label', label));
    const left = el('button', 'go-opt-arrow', '‹');
    const val = el('span', 'go-opt-value', current);
    const right = el('button', 'go-opt-arrow', '›');
    const step = (d: number) => {
      let idx = values.indexOf(current);
      if (idx < 0) idx = 0;
      onSet(values[(idx + d + values.length) % values.length]);
    };
    left.addEventListener('click', () => step(-1));
    right.addEventListener('click', () => step(1));
    row.append(left, val, right);
    return row;
  }

  private nudgeRow(label: string, current: string, onStep: (d: number) => void): HTMLElement {
    const row = el('div', 'go-opt');
    row.append(el('span', 'go-opt-label', label));
    const left = el('button', 'go-opt-arrow', '‹');
    const val = el('span', 'go-opt-value', current);
    const right = el('button', 'go-opt-arrow', '›');
    left.addEventListener('click', () => onStep(-1));
    right.addEventListener('click', () => onStep(1));
    row.append(left, val, right);
    return row;
  }

  private readonlyRow(label: string, value: string): HTMLElement {
    const row = el('div', 'go-opt');
    row.append(el('span', 'go-opt-label', label), el('span', ''), el('span', 'go-opt-value', value), el('span', ''));
    return row;
  }

  // ── status + actions ─────────────────────────────────────────────────────

  private paintStatus(): void {
    clear(this.statusHost);
    const msg = el('div', '', this.message + (this.dirty ? '  ·  UNSAVED' : ''));
    msg.style.color = this.dirty ? 'var(--hot-2)' : 'var(--ink-dim)';
    this.statusHost.appendChild(msg);
    if (this.problems.length) {
      for (const pr of this.problems.slice(0, 4)) {
        const l = el('div', '', `• ${pr}`);
        l.style.color = 'var(--bad)';
        this.statusHost.appendChild(l);
      }
    }
  }

  private rebuildFocus(): void {
    const items: FocusItem[] = [];
    const actions = el('div', 'row');
    actions.style.marginTop = '10px';
    const mk = (label: string, fn: () => void, cls = '') => {
      const b = button(label, fn, cls);
      b.el.style.width = 'auto';
      b.el.style.minWidth = '128px';
      actions.appendChild(b.el);
      items.push(b);
    };
    mk('SAVE', () => this.save());
    mk('VALIDATE', () => this.validateNow());
    mk('PREVIEW', () => this.runPractice(true));
    mk('PRACTICE', () => this.runPractice(false));
    mk('CLEAR', () => { this.play = newCustomPlay(this.side, 'New Play', this.slot); this.dirty = true; this.sel = { kind: 'PLAYER', index: 0 }; this.refresh(); }, 'ghost');
    mk('DELETE', () => { deleteCustom(this.side, this.slot); this.loadSlot(); }, 'danger');
    mk('COPY →', () => {
      const to = (this.slot + 1) % SLOTS_PER_SIDE;
      copyCustom(this.side, this.slot, to);
      this.message = `Copied to slot ${to + 1}`;
      this.refresh();
    }, 'ghost');
    mk('BACK', () => this.ctx.back(), 'ghost');
    this.statusHost.appendChild(actions);
    this.ring.set(items);
    this.ring.onNav = (e) => this.ctx.sound(e === 'select' ? 'select' : 'move');
  }

  private validateNow(): void {
    this.problems = validate(this.play);
    this.message = this.problems.length ? `${this.problems.length} problem(s)` : 'Play is legal';
    this.ctx.sound(this.problems.length ? 'error' : 'select');
    this.paintStatus();
  }

  private save(): void {
    this.problems = validate(this.play);
    if (this.problems.length) {
      this.message = 'Fix the problems before saving';
      this.ctx.sound('error');
      this.paintStatus();
      return;
    }
    const rec = saveCustom(this.side, this.slot, this.play, this.play.name);
    this.dirty = false;
    this.message = rec ? `Saved "${rec.name}" to slot ${this.slot + 1}` : 'Save failed';
    this.ctx.sound('select');
    this.refresh();
  }

  private runPractice(routesOnly: boolean): void {
    const problems = validate(this.play);
    if (problems.length) {
      this.problems = problems;
      this.message = 'Play is not legal yet';
      this.ctx.sound('error');
      this.paintStatus();
      return;
    }
    const offense = isOffensePlay(this.play) ? clonePlay(this.play) : undefined;
    const defense = isOffensePlay(this.play)
      ? DEFENSE_PLAYS[0]
      : clonePlay(this.play as DefensePlay);
    this.ctx.go('practice', {
      returnScreen: 'playEditor',
      offense,
      defense,
      routesOnly,
      autoStart: true,
      side: isOffensePlay(this.play) ? 'OFF' : 'DEF',
      label: `EDITOR · ${this.play.name}`,
    });
  }

  update(): void {
    const i = this.ctx.input;
    if (i.menuPressed(Action.BACK)) { this.ctx.sound('back'); this.ctx.back(); return; }
    if (i.menuPressed(Action.PAGE)) { this.switchSide(this.side === 'OFF' ? 'DEF' : 'OFF'); return; }

    // Movement nudges the selected player (or node) rather than the focus ring.
    const nudge = 0.5;
    let dx = 0, dz = 0;
    if (i.menuPressed(Action.LEFT)) dx -= nudge;
    if (i.menuPressed(Action.RIGHT)) dx += nudge;
    if (i.menuPressed(Action.UP)) dz += nudge;
    if (i.menuPressed(Action.DOWN)) dz -= nudge;
    if ((dx || dz) && this.sel.kind !== 'NONE') {
      const idx = this.sel.index;
      const pl = this.play.players[idx];
      if (this.sel.kind === 'NODE' && isOffensePlay(this.play)) {
        const n = (this.play as OffensePlay).players[idx].route[this.sel.node];
        if (n) moveNode(this.play as OffensePlay, idx, this.sel.node, n.x + dx, n.z + dz);
      } else {
        moveSlot(this.play, idx, pl.align.x + dx, pl.align.z + dz);
        if (isOffensePlay(this.play)) reassignTargets(this.play);
      }
      this.dirty = true;
      this.paintField();
      this.paintProps();
      return;
    }
    // TAB-equivalent: cycle the selected player.
    if (i.menuPressed(Action.ACTION)) { this.ring.select(); return; }
    if (i.menuPressed(Action.PAUSE)) {
      this.sel = { kind: 'PLAYER', index: (this.sel.kind === 'NONE' ? 0 : this.sel.index + 1) % 7 };
      this.refresh();
    }
  }
}
