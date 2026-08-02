import type {
  Athlete, Ball, Conditions, DeadReason, PlayerDef, TeamDef, TeamSide,
  OffensePlay, DefensePlay, PlayerIntent, AthleteId, SurfaceKind, WeatherKind,
} from '../core/types.ts';
import { Rng } from '../core/rng.ts';
import { EventBus } from '../core/events.ts';
import { SURFACE_TRACTION, WEATHER_TRACTION } from '../core/constants.ts';

export type PlayPhase = 'SETUP' | 'PRESNAP' | 'LIVE' | 'DEAD' | 'POST';

export const OFF_START = 0;
export const DEF_START = 7;
export const ATHLETE_COUNT = 14;

export interface World {
  tick: number;
  rng: Rng;
  bus: EventBus;
  athletes: Athlete[];
  intents: PlayerIntent[];        // parallel to athletes
  ball: Ball;
  conditions: Conditions;
  teams: [TeamDef, TeamDef];

  possession: TeamSide;
  losZ: number;
  playPhase: PlayPhase;
  playTicks: number;
  snapTick: number;
  deadReason: DeadReason | null;
  spotZ: number;
  spotX: number;
  /** z the ball was at when the current carrier gained possession (for yardage). */
  gainOriginZ: number;
  lastCarrier: AthleteId;
  /** Set when the play is a special-teams play so the runner branches. */
  special: null | 'PUNT' | 'FIELD_GOAL' | 'EXTRA_POINT' | 'KICKOFF' | 'ONSIDE';

  offensePlay: OffensePlay | null;
  defensePlay: DefensePlay | null;

  /** True while the QB still holds the ball behind the LOS (for sack detection). */
  qbId: AthleteId;
  passThrown: boolean;
  handedOff: boolean;
  /** Yards the pass travelled in the air, for stats. */
  lastPassAirYards: number;
  /** Prevents multiple scores from a single play. */
  scoreLocked: boolean;
  /** Athlete whose catch could extend an Overdrive streak. */
  lastCatcher: AthleteId;
  /** Cosmetic: last big-hit power, for camera/audio. */
  lastHitPower: number;

  /** Seats that pressed "switch defender" this tick; drained by the match. */
  switchRequests: number[];
  /** Currently highlighted pass target (icon passing keeps snap-alignment binding). */
  qbTarget: AthleteId;
  /** Athlete ids answering pass buttons 0/1/2, frozen at the snap. */
  passTargets: [AthleteId, AthleteId, AthleteId];
  /** Post-whistle contact allowed (cosmetic only). */
  lateHits: boolean;
  /** Set while a kick is in the air so rules can resolve it. */
  kickPending: null | { kind: 'FIELD_GOAL' | 'EXTRA_POINT' | 'PUNT' | 'KICKOFF' | 'ONSIDE'; good: boolean; distance: number };
  /** Practice/dev: freeze the defense. */
  freezeDefense: boolean;
  /** Receiver with a live Overdrive catch streak (mirrors MatchState), or -1. */
  hotReceiver: AthleteId;
  hotStreak: number;
  /** Athlete slated to take a handoff/pitch on this play, or -1. */
  handoffTarget: AthleteId;
  /** Tick (relative to the snap) when the exchange should happen. */
  handoffTick: number;
}

export function dirOf(side: TeamSide): number { return side === 0 ? 1 : -1; }
export function goalOf(side: TeamSide): number { return side === 0 ? 100 : 0; }
export function ownGoalOf(side: TeamSide): number { return side === 0 ? 0 : 100; }
export function other(side: TeamSide): TeamSide { return side === 0 ? 1 : 0; }

export function makeConditions(weather: WeatherKind, surface: SurfaceKind, rng: Rng): Conditions {
  const strength = weather === 'WIND' ? 4.2 : weather === 'SNOW' ? 1.5 : weather === 'RAIN' ? 1.9 : 0.5;
  const ang = rng.range(0, Math.PI * 2);
  return {
    weather, surface,
    windX: Math.sin(ang) * strength,
    windZ: Math.cos(ang) * strength,
    traction: (SURFACE_TRACTION[surface] ?? 1) * (WEATHER_TRACTION[weather] ?? 1),
  };
}

function blankAthlete(id: number): Athlete {
  return {
    id, side: 0, slotIndex: 0, unit: 'OFF',
    def: {
      name: '', number: 0, pos: 'WR',
      ratings: { speed: 50, power: 50, hands: 50, agility: 50, arm: 50, accuracy: 50, coverage: 50, awareness: 50 },
      build: 0.5, tone: 0.5, flair: 0,
    },
    x: 0, z: 0, y: 0, vx: 0, vz: 0, vy: 0, facing: 0, turnVel: 0,
    prevX: 0, prevZ: 0, prevY: 0, prevFacing: 0,
    move: 'NORMAL', moveTicks: 0,
    anim: {
      state: 'IDLE', phase: 0, prevPhase: 0, ticks: 0,
      speed01: 0, accelFwd: 0, accelLat: 0, ground: 0, lastX: 0, lastZ: 0,
    },
    hasBall: false, turbo: 100, turboHeld: false, protecting: false, turboLockTicks: 0, stamina: 100,
    downTicks: 0, stunTicks: 0, blockedBy: -1, engagedWith: -1, onFire: false,
    role: 'WIDE', route: null, routeIdx: 0, routeHold: 0, assign: null, targetButton: null,
    homeX: 0, homeZ: 0,
    controlledBySeat: -1, reactionQueue: 0, aiMemoryTick: 0, aiScratch: 0,
  };
}

function blankIntent(): PlayerIntent {
  return { moveX: 0, moveZ: 0, held: 0, pressed: 0, released: 0 };
}

export function createWorld(
  home: TeamDef, away: TeamDef, conditions: Conditions, rng: Rng, bus: EventBus,
): World {
  const athletes: Athlete[] = [];
  const intents: PlayerIntent[] = [];
  for (let i = 0; i < ATHLETE_COUNT; i++) { athletes.push(blankAthlete(i)); intents.push(blankIntent()); }
  return {
    tick: 0, rng, bus, athletes, intents,
    ball: {
      x: 0, y: 0.5, z: 50, vx: 0, vy: 0, vz: 0,
      prevX: 0, prevY: 0.5, prevZ: 50, spin: 0,
      state: { kind: 'dead' }, possession: 0,
    },
    conditions, teams: [home, away],
    possession: 0, losZ: 25, playPhase: 'SETUP', playTicks: 0, snapTick: 0,
    deadReason: null, spotZ: 25, spotX: 0, gainOriginZ: 25, lastCarrier: -1,
    special: null, offensePlay: null, defensePlay: null,
    qbId: 0, passThrown: false, handedOff: false, lastPassAirYards: 0,
    scoreLocked: false, lastCatcher: -1, lastHitPower: 0,
    switchRequests: [], qbTarget: -1, passTargets: [-1, -1, -1],
    lateHits: false, kickPending: null, freezeDefense: false,
    hotReceiver: -1, hotStreak: 0, handoffTarget: -1, handoffTick: 0,
  };
}

/** Populate the 14 on-field athletes from team rosters for the current possession. */
export function assignUnits(w: World, offenseSide: TeamSide, kickerForOffense = false): void {
  const defSide = other(offenseSide);
  const offRoster = w.teams[offenseSide].roster;
  const defRoster = w.teams[defSide].roster;
  for (let i = 0; i < 7; i++) {
    const a = w.athletes[OFF_START + i];
    resetAthlete(a, offenseSide, i, 'OFF', pickOffense(offRoster, i, kickerForOffense));
  }
  for (let i = 0; i < 7; i++) {
    const a = w.athletes[DEF_START + i];
    resetAthlete(a, defSide, i, 'DEF', defRoster[7 + i] ?? defRoster[i]);
  }
  w.qbId = OFF_START;
}

function pickOffense(roster: PlayerDef[], slot: number, kicker: boolean): PlayerDef {
  if (kicker && slot === 0) return roster[14] ?? roster[0];
  return roster[slot] ?? roster[0];
}

export function resetAthlete(a: Athlete, side: TeamSide, slot: number, unit: 'OFF' | 'DEF' | 'KICK', def: PlayerDef): void {
  a.side = side; a.slotIndex = slot; a.unit = unit; a.def = def;
  a.vx = 0; a.vz = 0; a.vy = 0; a.y = 0; a.turnVel = 0;
  a.move = 'NORMAL'; a.moveTicks = 0;
  a.anim.state = 'SET'; a.anim.phase = 0; a.anim.prevPhase = 0; a.anim.ticks = 0;
  a.anim.speed01 = 0; a.anim.accelFwd = 0; a.anim.accelLat = 0;
  a.anim.ground = 0; a.anim.lastX = a.x; a.anim.lastZ = a.z;
  a.hasBall = false; a.turbo = 100; a.turboHeld = false; a.protecting = false; a.turboLockTicks = 0;
  a.downTicks = 0; a.stunTicks = 0; a.blockedBy = -1; a.engagedWith = -1;
  a.route = null; a.routeIdx = 0; a.routeHold = 0; a.assign = null; a.targetButton = null;
  a.reactionQueue = 0; a.aiScratch = 0;
}

export function offenseAthletes(w: World): Athlete[] {
  return w.athletes.slice(OFF_START, OFF_START + 7);
}
export function defenseAthletes(w: World): Athlete[] {
  return w.athletes.slice(DEF_START, DEF_START + 7);
}
export function isOffense(id: AthleteId): boolean { return id >= OFF_START && id < DEF_START; }

export function carrier(w: World): Athlete | null {
  const st = w.ball.state;
  return st.kind === 'held' ? w.athletes[st.carrier] : null;
}

export function savePrev(w: World): void {
  for (let i = 0; i < w.athletes.length; i++) {
    const a = w.athletes[i];
    a.prevX = a.x; a.prevZ = a.z; a.prevY = a.y; a.prevFacing = a.facing;
    a.anim.prevPhase = a.anim.phase;
  }
  w.ball.prevX = w.ball.x; w.ball.prevY = w.ball.y; w.ball.prevZ = w.ball.z;
}
