import type { AnimState } from '../core/types.ts';
import type { World } from '../sim/world.ts';
import { carryArm } from '../sim/ball.ts';

/**
 * Deterministic short-clip replay.
 *
 * This records RENDER TRANSFORMS only — never simulation state — into a fixed ring buffer, so it
 * cannot destabilise the match. Playback re-poses the existing rigs from the buffer; the simulation
 * is paused and untouched throughout. Worst case, a replay looks wrong; it can never break a game.
 */

const HZ = 30;
const SECONDS = 4.5;
const FRAMES = Math.round(HZ * SECONDS);
const ATHLETES = 14;
const PER_ATHLETE = 6;   // x, y, z, facing, animPhase, carryArm
const STRIDE = ATHLETES * PER_ATHLETE + 3;  // + ball xyz

export interface ReplayFrame {
  athletes: Array<{ x: number; y: number; z: number; facing: number; state: AnimState; phase: number; carry: number }>;
  ball: { x: number; y: number; z: number };
}

export class ReplayBuffer {
  private data = new Float32Array(FRAMES * STRIDE);
  private states = new Array<AnimState>(FRAMES * ATHLETES).fill('IDLE');
  private jerseys = new Int16Array(FRAMES * ATHLETES);
  private sides = new Uint8Array(FRAMES * ATHLETES);
  private head = 0;
  private count = 0;
  private accum = 0;

  /** Call once per rendered frame; it self-throttles to the capture rate. */
  capture(w: World, dt: number): void {
    this.accum += dt;
    if (this.accum < 1 / HZ) return;
    this.accum = 0;
    const base = this.head * STRIDE;
    for (let i = 0; i < ATHLETES; i++) {
      const a = w.athletes[i];
      const o = base + i * PER_ATHLETE;
      this.data[o] = a.x; this.data[o + 1] = a.y; this.data[o + 2] = a.z;
      this.data[o + 3] = a.facing; this.data[o + 4] = a.anim.phase;
      this.data[o + 5] = a.hasBall ? carryArm(a) : 0;
      this.states[this.head * ATHLETES + i] = a.anim.state;
      this.jerseys[this.head * ATHLETES + i] = a.def.number;
      this.sides[this.head * ATHLETES + i] = a.side;
    }
    const b = base + ATHLETES * PER_ATHLETE;
    this.data[b] = w.ball.x; this.data[b + 1] = w.ball.y; this.data[b + 2] = w.ball.z;
    this.head = (this.head + 1) % FRAMES;
    this.count = Math.min(FRAMES, this.count + 1);
  }

  get length(): number { return this.count; }
  get ready(): boolean { return this.count >= HZ; }

  /** Read frame `i` counting back from the oldest retained frame (0 = oldest). */
  read(i: number, out: ReplayView): boolean {
    if (i < 0 || i >= this.count) return false;
    const idx = (this.head - this.count + i + FRAMES * 2) % FRAMES;
    const base = idx * STRIDE;
    for (let k = 0; k < ATHLETES; k++) {
      const o = base + k * PER_ATHLETE;
      const t = out.athletes[k];
      t.x = this.data[o]; t.y = this.data[o + 1]; t.z = this.data[o + 2];
      t.facing = this.data[o + 3]; t.phase = this.data[o + 4]; t.carry = this.data[o + 5];
      t.state = this.states[idx * ATHLETES + k];
      t.jersey = this.jerseys[idx * ATHLETES + k];
      t.side = this.sides[idx * ATHLETES + k];
    }
    const b = base + ATHLETES * PER_ATHLETE;
    out.ball.x = this.data[b]; out.ball.y = this.data[b + 1]; out.ball.z = this.data[b + 2];
    return true;
  }

  clear(): void { this.count = 0; this.head = 0; this.accum = 0; }
}

export interface ReplayView {
  athletes: Array<{
    x: number; y: number; z: number; facing: number; phase: number;
    state: AnimState; jersey: number; side: number; carry: number;
  }>;
  ball: { x: number; y: number; z: number };
}

export function makeReplayView(): ReplayView {
  return {
    athletes: Array.from({ length: ATHLETES }, () => ({
      x: 0, y: 0, z: 0, facing: 0, phase: 0, state: 'IDLE' as AnimState, jersey: 0, side: 0, carry: 0,
    })),
    ball: { x: 0, y: 0, z: 0 },
  };
}

/** Drives playback timing: which buffered frame should be on screen right now. */
export class ReplayPlayer {
  private t = 0;
  private speed = 0.62;
  private frames = 0;
  active = false;
  label = 'REPLAY';

  start(frames: number, label = 'REPLAY', speed = 0.62): void {
    if (frames < HZ) return;
    this.frames = frames;
    this.t = 0;
    this.speed = speed;
    this.label = label;
    this.active = true;
  }

  stop(): void { this.active = false; }

  /** Returns the frame index to show, or -1 when the clip has finished. */
  advance(dt: number): number {
    if (!this.active) return -1;
    this.t += dt * this.speed * HZ;
    const i = Math.floor(this.t);
    if (i >= this.frames) { this.active = false; return -1; }
    return i;
  }

  get progress(): number { return this.frames ? Math.min(1, this.t / this.frames) : 0; }
}

export const REPLAY_HZ = HZ;
export const REPLAY_FRAMES = FRAMES;
