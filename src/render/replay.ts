import type { AnimState, BallPlayCue, GameEvent, TeamSide } from '../core/types.ts';
import type { World } from '../sim/world.ts';
import { carryArm } from '../sim/ball.ts';
import { FALLBACK_REPLAY_SHOTS, type MfdReplayShotSetV1, type ReplayEventKind, validateReplayShotSet, type ReplayShotV1 } from './replayShots.ts';

/**
 * Deterministic short-clip replay.
 *
 * This records RENDER TRANSFORMS only — never simulation state — into a fixed ring buffer, so it
 * cannot destabilise the match. Playback re-poses the existing rigs from the buffer; the simulation
 * is paused and untouched throughout. Worst case, a replay looks wrong; it can never break a game.
 */

const HZ = 30;
const SECONDS = 6.5;
const FRAMES = Math.round(HZ * SECONDS);
const ATHLETES = 14;
const PER_ATHLETE = 6;   // x, y, z, facing, animPhase, carryArm
const STRIDE = ATHLETES * PER_ATHLETE + 3;  // + ball xyz
const MAX_BALL_PLAY_CUES = 32;

export interface ReplayFrame {
  athletes: Array<{ x: number; y: number; z: number; facing: number; state: AnimState; phase: number; carry: number }>;
  ball: { x: number; y: number; z: number };
}

export class ReplayBuffer {
  private data = new Float32Array(FRAMES * STRIDE);
  private states = new Array<AnimState>(FRAMES * ATHLETES).fill('IDLE');
  private jerseys = new Int16Array(FRAMES * ATHLETES);
  private sides = new Uint8Array(FRAMES * ATHLETES);
  private frameSerial = new Int32Array(FRAMES);
  private ballPlayCues: Array<{ serial: number; cue: BallPlayCue }> = [];
  private pendingBallPlayCues: BallPlayCue[] = [];
  private serial = 0;
  private head = 0;
  private count = 0;
  private accum = 0;

  /** Call once per rendered frame; it self-throttles to the capture rate. */
  capture(w: World, dt: number): void {
    this.accum += dt;
    if (this.accum < 1 / HZ) return;
    this.accum = 0;
    this.writeFrame(w);
  }

  /** Preserve a terminal ball-play cue even when the event changed LIVE to DEAD this tick. */
  flushPending(w: World): void {
    if (this.pendingBallPlayCues.length === 0) return;
    this.accum = 0;
    this.writeFrame(w);
  }

  private writeFrame(w: World): void {
    const base = this.head * STRIDE;
    const serial = ++this.serial;
    this.frameSerial[this.head] = serial;
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
    for (const cue of this.pendingBallPlayCues) this.ballPlayCues.push({ serial, cue });
    this.pendingBallPlayCues.length = 0;
    const oldestSerial = serial - FRAMES + 1;
    this.ballPlayCues = this.ballPlayCues.filter((entry) => entry.serial >= oldestSerial).slice(-MAX_BALL_PLAY_CUES);
    this.head = (this.head + 1) % FRAMES;
    this.count = Math.min(FRAMES, this.count + 1);
  }

  get length(): number { return this.count; }
  get ready(): boolean { return this.count >= HZ; }

  /** Queue presentation metadata emitted by the authoritative simulation for the next frame. */
  observe(event: GameEvent): void {
    const cue = ballPlayCueFromEvent(event);
    if (!cue) return;
    this.pendingBallPlayCues.push(cue);
    if (this.pendingBallPlayCues.length > MAX_BALL_PLAY_CUES) this.pendingBallPlayCues.shift();
  }

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
    out.cues.length = 0;
    const serial = this.frameSerial[idx];
    for (const entry of this.ballPlayCues) if (entry.serial === serial) out.cues.push(entry.cue);
    return true;
  }

  clear(): void {
    this.count = 0; this.head = 0; this.accum = 0; this.serial = 0;
    this.ballPlayCues.length = 0; this.pendingBallPlayCues.length = 0;
  }
}

export interface ReplayView {
  athletes: Array<{
    x: number; y: number; z: number; facing: number; phase: number;
    state: AnimState; jersey: number; side: number; carry: number;
  }>;
  ball: { x: number; y: number; z: number };
  /** Bounded presentation-only cues associated with this recorded transform frame. */
  cues: BallPlayCue[];
}

export function makeReplayView(): ReplayView {
  return {
    athletes: Array.from({ length: ATHLETES }, () => ({
      x: 0, y: 0, z: 0, facing: 0, phase: 0, state: 'IDLE' as AnimState, jersey: 0, side: 0, carry: 0,
    })),
    ball: { x: 0, y: 0, z: 0 }, cues: [],
  };
}

/** Preserve event compatibility while enriching only the presentation path. */
export function ballPlayCueFromEvent(event: GameEvent): BallPlayCue | null {
  if (event.type !== 'catch' && event.type !== 'drop'
      && event.type !== 'swat' && event.type !== 'interception') return null;
  if (!event.at) return null;
  const outcome = event.type === 'catch' ? 'CATCH'
    : event.type === 'drop' ? 'DROP'
      : event.type === 'swat' ? 'SWAT' : 'INTERCEPTION';
  const technique = event.technique ?? (event.type === 'swat' ? 'SWAT'
    : event.type === 'interception' ? 'PLAY_BALL' : 'BALANCED');
  return {
    tick: event.tick, by: event.by, technique, outcome,
    at: { x: event.at.x, y: event.at.y, z: event.at.z },
    sideline: (event.type === 'catch' || event.type === 'drop') && !!event.sideline,
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
  advance(dt: number, speedScale = 1): number {
    if (!this.active) return -1;
    this.t += dt * this.speed * Math.max(0.1, speedScale) * HZ;
    const i = Math.floor(this.t);
    if (i >= this.frames) { this.active = false; return -1; }
    return i;
  }

  get progress(): number { return this.frames ? Math.min(1, this.t / this.frames) : 0; }
  get currentFrame(): number { return this.active ? Math.min(this.frames - 1, Math.floor(this.t)) : -1; }
}

/** Presentation-only shot sequencer. It selects bounded authored data; it never reads or writes World. */
export class ReplayDirector {
  private set: MfdReplayShotSetV1 = FALLBACK_REPLAY_SHOTS;
  private shots: ReplayShotV1[] = FALLBACK_REPLAY_SHOTS.shots;
  private index = 0;

  load(input: unknown): boolean {
    const result = validateReplayShotSet(input);
    if (!result.ok || !result.value) { this.set = FALLBACK_REPLAY_SHOTS; this.shots = FALLBACK_REPLAY_SHOTS.shots; this.index = 0; return false; }
    this.set = result.value; this.shots = result.value.shots; this.index = 0; return true;
  }

  begin(event: ReplayEventKind, seed: number): ReplayShotV1 {
    void seed;
    this.shots = this.set.eventKinds.includes(event) ? this.set.shots : FALLBACK_REPLAY_SHOTS.shots;
    this.index = 0;
    return this.current;
  }

  at(progress: number): ReplayShotV1 {
    const p = Math.max(0, Math.min(0.999999, progress));
    let found = this.shots.length - 1;
    for (let i = 0; i < this.shots.length; i++) {
      if (p >= this.shots[i].start && p < this.shots[i].end) { found = i; break; }
    }
    this.index = Math.max(0, found);
    return this.current;
  }

  choose(event: ReplayEventKind, seed: number): ReplayShotV1 { return this.begin(event, seed); }
  speedAt(progress: number): number { return this.at(progress).slowMotion ?? 1; }

  get current(): ReplayShotV1 { return this.shots[this.index] ?? FALLBACK_REPLAY_SHOTS.shots[0]; }
  get shotSet(): MfdReplayShotSetV1 { return this.set; }
}

export function replayTarget(view: ReplayView, role: ReplayShotV1['target']): { x: number; z: number } {
  if (role === 'BALL') return view.ball;
  const carrier = view.athletes.find((athlete) => athlete.carry !== 0);
  if (role === 'CARRIER' || role === 'RECEIVER' || role === 'SCORER') return carrier ?? view.ball;
  if (role === 'PASSER') return view.athletes[0] ?? view.ball;
  if (role === 'FORMATION_CENTER') {
    let x = 0, z = 0;
    for (const athlete of view.athletes) { x += athlete.x; z += athlete.z; }
    return view.athletes.length ? { x: x / view.athletes.length, z: z / view.athletes.length } : view.ball;
  }
  const subject = carrier ?? view.ball;
  let best = view.athletes[0] ?? subject;
  let bestDistance = Infinity;
  for (const athlete of view.athletes) {
    if (role === 'DEFENDER' && carrier && athlete.side === carrier.side) continue;
    const distance = Math.hypot(athlete.x - subject.x, athlete.z - subject.z);
    if (distance < bestDistance) { bestDistance = distance; best = athlete; }
  }
  return best;
}

const REPLAY_PRIORITY: Record<ReplayEventKind, number> = {
  TOUCHDOWN: 100, FIELD_GOAL: 100, GAME_WINNING: 110,
  INTERCEPTION: 90, FUMBLE_RECOVERY: 90, FOURTH_DOWN_STOP: 85,
  SACK: 80, TACKLE_FOR_LOSS: 45, EXPLOSIVE_PASS: 35, EXPLOSIVE_RUN: 35,
};

/** Converts actual emitted simulation events into one non-overwritable replay package per play. */
export class ReplayEventRouter {
  private current: ReplayEventKind | null = null;
  private fumbleLive = false;
  private threwPass = false;
  private completedPass = false;
  private lastMoment: { tick: number; side: TeamSide } | null = null;

  observe(event: GameEvent): ReplayEventKind | null {
    switch (event.type) {
      case 'play.start':
        this.fumbleLive = false; this.threwPass = false; this.completedPass = false;
        break;
      case 'throw': this.threwPass = true; break;
      case 'catch': this.completedPass = true; break;
      case 'fumble': this.fumbleLive = true; break;
      case 'recover':
        if (this.fumbleLive) this.offer('FUMBLE_RECOVERY');
        this.fumbleLive = false;
        break;
      case 'interception': this.offer('INTERCEPTION'); break;
      case 'sack': this.offer('SACK'); break;
      case 'touchdown':
        this.offer('TOUCHDOWN'); this.lastMoment = { tick: event.tick, side: event.side };
        break;
      case 'fieldGoal.result':
        if (event.good) { this.offer('FIELD_GOAL'); this.lastMoment = { tick: event.tick, side: event.side }; }
        break;
      case 'turnover':
        if (event.kind === 'DOWNS') { this.offer('FOURTH_DOWN_STOP'); this.lastMoment = { tick: event.tick, side: event.to }; }
        break;
      case 'play.end':
        if (event.yards >= 18) this.offer(this.threwPass && this.completedPass ? 'EXPLOSIVE_PASS' : 'EXPLOSIVE_RUN');
        else if (event.reason === 'TACKLE' && event.yards <= -1) this.offer('TACKLE_FOR_LOSS');
        break;
      case 'match.end':
        if (event.winner !== 'TIE' && this.lastMoment?.side === event.winner
            && event.tick - this.lastMoment.tick <= 40 * 60) this.offer('GAME_WINNING');
        break;
      default: break;
    }
    return this.current;
  }

  take(): ReplayEventKind | null { const value = this.current; this.current = null; return value; }
  get pending(): ReplayEventKind | null { return this.current; }
  reset(): void {
    this.current = null; this.fumbleLive = false; this.threwPass = false;
    this.completedPass = false; this.lastMoment = null;
  }
  private offer(kind: ReplayEventKind): void {
    if (!this.current || REPLAY_PRIORITY[kind] > REPLAY_PRIORITY[this.current]) this.current = kind;
  }
}

export const REPLAY_HZ = HZ;
export const REPLAY_FRAMES = FRAMES;
