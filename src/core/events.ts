import type { GameEvent, GameEventType } from './types.ts';

type Handler = (e: GameEvent) => void;

/**
 * Typed, allocation-light event bus.
 * The sim emits into a per-tick queue; presentation drains it once per frame.
 * Handlers must never mutate simulation state.
 */
export class EventBus {
  private handlers = new Map<string, Handler[]>();
  private any: Handler[] = [];
  /** Events emitted since the last drain. */
  readonly queue: GameEvent[] = [];
  /** Full log, only kept when `recording` is on (tests / replays). */
  log: GameEvent[] | null = null;

  on(type: GameEventType | '*', fn: Handler): () => void {
    if (type === '*') { this.any.push(fn); return () => { const i = this.any.indexOf(fn); if (i >= 0) this.any.splice(i, 1); }; }
    let arr = this.handlers.get(type);
    if (!arr) { arr = []; this.handlers.set(type, arr); }
    arr.push(fn);
    return () => { const i = arr!.indexOf(fn); if (i >= 0) arr!.splice(i, 1); };
  }

  emit(e: GameEvent): void {
    this.queue.push(e);
    if (this.log) this.log.push(e);
    const arr = this.handlers.get(e.type);
    if (arr) for (let i = 0; i < arr.length; i++) arr[i](e);
    for (let i = 0; i < this.any.length; i++) this.any[i](e);
  }

  drain(fn: (e: GameEvent) => void): void {
    for (let i = 0; i < this.queue.length; i++) fn(this.queue[i]);
    this.queue.length = 0;
  }

  clearQueue(): void { this.queue.length = 0; }

  record(): void { this.log = []; }

  counts(): Record<string, number> {
    const out: Record<string, number> = {};
    if (!this.log) return out;
    for (const e of this.log) out[e.type] = (out[e.type] ?? 0) + 1;
    return out;
  }

  dispose(): void { this.handlers.clear(); this.any.length = 0; this.queue.length = 0; this.log = null; }
}
