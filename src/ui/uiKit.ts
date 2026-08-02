import { Action } from '../input/actions.ts';
import type { InputManager } from '../input/manager.ts';

/**
 * Tiny DOM UI kit. Every screen is a Screen; navigation works identically on keyboard,
 * gamepad and mouse. No framework, no virtual DOM — menus must feel instant.
 */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, className?: string, text?: string,
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined) n.textContent = text;
  return n;
}

export function clear(node: HTMLElement): void { while (node.firstChild) node.removeChild(node.firstChild); }

/**
 * True for a finger, false for a mouse. Used to word prompts for the device actually in
 * front of the player — a phone has no START button and no keyboard to press it with.
 * Guarded like the audio engine is: headless harnesses have no `matchMedia`, and a screen
 * that throws while mounting is worse than one that says "PRESS START" to a mouse user.
 */
export function coarsePointer(): boolean {
  if (typeof matchMedia !== 'function') return false;
  return matchMedia('(pointer: coarse)').matches;
}

export interface FocusItem {
  el: HTMLElement;
  onSelect?: () => void;
  onLeft?: () => void;
  onRight?: () => void;
  /** Grid row for 2-D navigation; -1 means a plain vertical list. */
  row?: number;
  col?: number;
  disabled?: boolean;
}

export type NavEvent = 'move' | 'select' | 'back' | 'adjust';

export class FocusRing {
  items: FocusItem[] = [];
  index = 0;
  onNav: ((e: NavEvent) => void) | null = null;
  private grid = false;

  set(items: FocusItem[], keepIndex = false): void {
    this.items = items.filter((i) => !i.disabled);
    this.grid = this.items.some((i) => i.row !== undefined);
    if (!keepIndex || this.index >= this.items.length) this.index = 0;
    this.paint();
  }

  paint(): void {
    this.items.forEach((it, i) => it.el.classList.toggle('focused', i === this.index));
    const cur = this.items[this.index];
    if (cur) cur.el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  move(dx: number, dy: number): void {
    if (this.items.length === 0) return;
    if (!this.grid) {
      const n = this.items.length;
      const step = dy !== 0 ? dy : dx;
      if (step === 0) return;
      this.index = (this.index + step + n) % n;
    } else {
      const cur = this.items[this.index];
      const row = cur.row ?? 0, col = cur.col ?? 0;
      let best = -1, bestScore = Infinity;
      for (let i = 0; i < this.items.length; i++) {
        if (i === this.index) continue;
        const it = this.items[i];
        const dr = (it.row ?? 0) - row, dc = (it.col ?? 0) - col;
        if (dy !== 0 && Math.sign(dr) !== Math.sign(dy)) continue;
        if (dx !== 0 && Math.sign(dc) !== Math.sign(dx)) continue;
        if (dy !== 0 && dr === 0) continue;
        if (dx !== 0 && dc === 0) continue;
        const score = Math.abs(dr) * (dy !== 0 ? 1 : 6) + Math.abs(dc) * (dx !== 0 ? 1 : 6);
        if (score < bestScore) { bestScore = score; best = i; }
      }
      if (best >= 0) this.index = best;
      else {
        // wrap within the row/column
        const n = this.items.length;
        this.index = (this.index + (dx || dy) + n) % n;
      }
    }
    this.paint();
    this.onNav?.('move');
  }

  select(): void {
    const it = this.items[this.index];
    if (!it) return;
    this.onNav?.('select');
    it.onSelect?.();
  }

  adjust(dir: -1 | 1): void {
    const it = this.items[this.index];
    if (!it) return;
    if (dir < 0 && it.onLeft) { it.onLeft(); this.onNav?.('adjust'); }
    if (dir > 0 && it.onRight) { it.onRight(); this.onNav?.('adjust'); }
  }

  focusIndex(i: number): void { this.index = Math.max(0, Math.min(this.items.length - 1, i)); this.paint(); }
}

export interface ScreenContext {
  root: HTMLElement;
  input: InputManager;
  go(name: string, params?: unknown): void;
  /** Replace the current screen (does not grow the stack). */
  replace(name: string, params?: unknown): void;
  /** Clear the stack and start fresh at `name`. */
  reset(name: string, params?: unknown): void;
  back(): void;
  sound(kind: 'move' | 'select' | 'back' | 'error'): void;
}

export interface Screen {
  name: string;
  mount(ctx: ScreenContext, params?: unknown): void;
  update?(dt: number): void;
  unmount(): void;
  /** Return true to swallow the input (screen handles its own navigation). */
  handleInput?(input: InputManager): boolean;
}

/** Standard navigation loop shared by simple menu screens. */
export function driveFocus(ring: FocusRing, input: InputManager, ctx: ScreenContext): void {
  if (input.menuPressed(Action.UP)) ring.move(0, -1);
  if (input.menuPressed(Action.DOWN)) ring.move(0, 1);
  if (input.menuPressed(Action.LEFT)) { if (ring.items[ring.index]?.onLeft) ring.adjust(-1); else ring.move(-1, 0); }
  if (input.menuPressed(Action.RIGHT)) { if (ring.items[ring.index]?.onRight) ring.adjust(1); else ring.move(1, 0); }
  if (input.menuPressed(Action.ACTION)) ring.select();
  if (input.menuPressed(Action.BACK)) { ctx.sound('back'); ctx.back(); }
}

export function button(label: string, onSelect: () => void, cls = ''): FocusItem {
  const b = el('button', `go-btn ${cls}`.trim(), label);
  b.type = 'button';
  b.addEventListener('click', onSelect);
  return { el: b, onSelect };
}

export interface OptionSpec<T> {
  label: string;
  values: readonly T[];
  format?: (v: T) => string;
  get(): T;
  set(v: T): void;
}

export function optionRow<T>(spec: OptionSpec<T>, onChange?: () => void): FocusItem {
  const row = el('div', 'go-opt');
  const name = el('span', 'go-opt-label', spec.label);
  const val = el('span', 'go-opt-value');
  const left = el('button', 'go-opt-arrow', '‹');
  const right = el('button', 'go-opt-arrow', '›');
  const paint = () => {
    const cur = spec.get();
    val.textContent = spec.format ? spec.format(cur) : String(cur);
  };
  const step = (d: number) => {
    const cur = spec.get();
    let i = spec.values.findIndex((v) => v === cur);
    if (i < 0) i = 0;
    const n = spec.values.length;
    spec.set(spec.values[(i + d + n) % n]);
    paint();
    onChange?.();
  };
  left.addEventListener('click', (e) => { e.stopPropagation(); step(-1); });
  right.addEventListener('click', (e) => { e.stopPropagation(); step(1); });
  row.append(name, left, val, right);
  paint();
  return { el: row, onLeft: () => step(-1), onRight: () => step(1), onSelect: () => step(1) };
}

export function sliderRow(
  label: string, get: () => number, set: (v: number) => void, step = 0.05, onChange?: () => void,
): FocusItem {
  const row = el('div', 'go-opt');
  const name = el('span', 'go-opt-label', label);
  const bar = el('div', 'go-slider');
  const fill = el('i');
  bar.appendChild(fill);
  const val = el('span', 'go-opt-value');
  const paint = () => {
    const v = Math.max(0, Math.min(1, get()));
    fill.style.width = `${Math.round(v * 100)}%`;
    val.textContent = `${Math.round(v * 100)}%`;
  };
  const nudge = (d: number) => { set(Math.max(0, Math.min(1, get() + d * step))); paint(); onChange?.(); };
  bar.addEventListener('click', (e) => {
    const r = bar.getBoundingClientRect();
    set(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)));
    paint(); onChange?.();
  });
  row.append(name, bar, val);
  paint();
  return { el: row, onLeft: () => nudge(-1), onRight: () => nudge(1) };
}

export function panel(title: string, subtitle?: string): HTMLDivElement {
  const p = el('div', 'go-panel');
  const h = el('h2', 'go-title', title);
  p.appendChild(h);
  if (subtitle) p.appendChild(el('p', 'go-sub', subtitle));
  return p;
}

export function svgNode(svg: string, className = ''): HTMLElement {
  const wrap = el('div', className);
  wrap.innerHTML = svg;
  return wrap;
}

export function fmtClock(ticks: number): string {
  const total = Math.max(0, Math.ceil(ticks / 60));
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

export function ordinal(n: number): string {
  if (n === 1) return '1ST'; if (n === 2) return '2ND'; if (n === 3) return '3RD'; if (n === 4) return '4TH';
  return `OT${n - 4}`;
}

export { Action };
