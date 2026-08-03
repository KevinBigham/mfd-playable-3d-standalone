/**
 * Mid-match snapshot: freeze a live game, put it down, pick it up later.
 *
 * The one thing the acceptance matrix could not test because it did not exist. Save covered
 * settings, season and records — everything except the match you were actually in the middle of —
 * so quitting a game threw it away, and there was no way to answer "does the simulation survive a
 * round trip through storage", which is the question SIM-003 asks.
 *
 * WHY A STATE SNAPSHOT AND NOT AN INPUT LOG. This simulation is deterministic, so a seed plus every
 * tick's input would reproduce a match exactly and cost nothing to store per-tick. It would also
 * grow without bound over a long game and take as long to restore as the match took to play. A
 * state snapshot is fixed size and restores in one step. The determinism buys something better
 * anyway: it makes the round trip *verifiable*. Snapshot, keep playing, and separately restore and
 * play the same number of ticks — if the two event streams are not identical, something in this
 * file is not being carried, and `SIM-003` in the acceptance matrix says so.
 *
 * PURITY. This module is data in, data out. No storage, no JSON, no DOM: the caller decides where
 * the object goes. That is what lets the harness round-trip it without a browser.
 *
 * WHAT IS DELIBERATELY NOT CARRIED. Team definitions, rosters, stadium and playbooks are looked up
 * by id on restore rather than embedded — they are content, not state, and a save that embedded
 * them would break the moment a roster changed. Event subscribers are not carried either: a
 * restored match starts with whatever listeners the new host attaches, which is correct, because
 * the sounds and camera shakes of the old session are not part of the game state.
 */
import type {
  AthleteId, BallState, DeadReason, MatchState, PlayerDef, SeatId, TeamSide,
} from '../core/types.ts';

export const SNAPSHOT_VERSION = 1 as const;

/** Everything about one athlete that the simulation can change. */
export interface AthleteSnapshot {
  id: AthleteId; side: TeamSide; slotIndex: number; unit: 'OFF' | 'DEF' | 'KICK';
  /** Roster identity, by number+name, so the athlete is re-bound rather than re-created. */
  defNumber: number; defName: string;
  x: number; z: number; y: number;
  vx: number; vz: number; vy: number;
  facing: number; turnVel: number;
  move: string; moveTicks: number;
  animState: string; animPhase: number; animTicks: number; animSpeed01: number;
  hasBall: boolean; turbo: number; turboHeld: boolean; protecting: boolean;
  turboLockTicks: number; stamina: number; downTicks: number; stunTicks: number;
  blockedBy: number; engagedWith: number; onFire: boolean;
  role: string; routeIdx: number; routeHold: number; blockDir: -1 | 0 | 1;
  targetButton: 0 | 1 | 2 | null;
  homeX: number; homeZ: number;
  controlledBySeat: SeatId | -1;
  reactionQueue: number; aiMemoryTick: number; aiScratch: number;
}

export interface WorldSnapshot {
  tick: number;
  rng: [number, number, number, number];
  athletes: AthleteSnapshot[];
  /**
   * Last tick's held-button mask per athlete.
   *
   * Easy to think of as transient and it is not: press edges are derived as
   * `held & ~prevHeld`, so an athlete restored with prevHeld = 0 sees every button he is ALREADY
   * holding as a brand-new press. Caught by the acceptance harness as a defender who was
   * mid-dive-tackle at the save re-triggering the move on the first tick after the load. Without
   * this the restore diverges immediately, and only when the snapshot happens to land between
   * plays does it look like it worked.
   */
  intents: number[];
  ball: { x: number; y: number; z: number; vx: number; vy: number; vz: number; spin: number; possession: TeamSide; state: BallState };
  possession: TeamSide;
  losZ: number; spotZ: number; spotX: number;
  playPhase: string; playTicks: number; snapTick: number;
  deadReason: DeadReason | null;
  gainOriginZ: number; progressZ: number; progressArmed: boolean;
  lastCarrier: AthleteId;
  special: string | null;
  /** Plays are carried by id and re-looked-up, so a restored match uses the current playbook. */
  offensePlayId: string | null;
  defensePlayId: string | null;
  qbId: AthleteId; passThrown: boolean; handedOff: boolean;
  lastPassAirYards: number; scoreLocked: boolean; lastCatcher: AthleteId; lastHitPower: number;
  qbTarget: AthleteId; passTargets: [AthleteId, AthleteId, AthleteId];
  lateHits: boolean;
  kickPending: unknown;
  freezeDefense: boolean;
  hotReceiver: AthleteId; hotStreak: number;
  handoffTarget: AthleteId; handoffTick: number;
  conditions: { weather: string; surface: string; windX: number; windZ: number; traction: number };
}

/** The match-level machinery that lives outside the world: staging, meters, latches. */
export interface MatchSnapshot {
  version: typeof SNAPSHOT_VERSION;
  /** Config identity, so a restore can refuse a save from a different matchup outright. */
  seed: number; homeId: string; awayId: string; stadium: string;
  quarterSeconds: number; difficulty: string;
  seats: Array<{ side: TeamSide; active: boolean }>;
  state: MatchState;
  world: WorldSnapshot;
  pendingOffenseId: string | null;
  pendingDefenseId: string | null;
  pendingSpecial: 'PUNT' | 'FIELD_GOAL' | null;
  pendingConversion: 'KICK' | 'TWO' | null;
  offenseLocked: boolean; defenseLocked: boolean; mirrorOffense: boolean;
  kickMeterTicks: number; kickMeterActive: boolean;
  kickPlan: { kind: string; aim: number; power: number; quality: number };
  kickLaunched: boolean; onsideRequested: boolean;
  lastOffenseId: string;
  watchdogFired: number;
  conversionTwoActive: boolean; conversionActive: boolean; freeKickAfterSafety: boolean;
  snapArmed: boolean; snapHeldPrev: boolean; snapRequested: boolean;
  seatHeldPrev: number[];
  actionSpent: number[];
  catchUp: [number, number];
  /** Play-call tendency memory, so the defence does not forget what you have been doing. */
  tendency: Array<{ runs: number; passes: number; deep: number; plays: number }>;
}

/** Identify a roster entry the same way on both sides of a round trip. */
export function playerKey(d: PlayerDef): string { return `${d.number}|${d.name}`; }

/**
 * Whether a snapshot can legally be restored into a match built from this config.
 *
 * Refusing loudly matters more here than in most load paths. A mismatched restore does not throw
 * or corrupt anything — it writes one team's positions and stats into another team's game and runs
 * perfectly, producing a match that is quietly wrong. The check is on identity, not on content:
 * the same two clubs, the same ground, the same seed, the same quarter length.
 */
export function snapshotMatches(
  snap: { version: number; seed: number; homeId: string; awayId: string; stadium: string; quarterSeconds: number },
  cfg: { seed: number; home: string; away: string; stadium: string; quarterSeconds: number },
): { ok: true } | { ok: false; reason: string } {
  if (snap.version !== SNAPSHOT_VERSION) {
    return { ok: false, reason: `snapshot version ${snap.version}, this build reads ${SNAPSHOT_VERSION}` };
  }
  if (snap.homeId !== cfg.home || snap.awayId !== cfg.away) {
    return { ok: false, reason: `saved ${snap.homeId} v ${snap.awayId}, asked for ${cfg.home} v ${cfg.away}` };
  }
  if (snap.stadium !== cfg.stadium) return { ok: false, reason: `saved at ${snap.stadium}, asked for ${cfg.stadium}` };
  if (snap.seed !== cfg.seed) return { ok: false, reason: 'different seed' };
  if (snap.quarterSeconds !== cfg.quarterSeconds) return { ok: false, reason: 'different quarter length' };
  return { ok: true };
}

/** Rebuild the config a snapshot was taken from, so a host can construct the match to restore into. */
export function configFromSnapshot(snap: MatchSnapshot): {
  seed: number; home: string; away: string; stadium: string; quarterSeconds: number;
  difficulty: string; seats: Array<{ side: TeamSide; active: boolean }>;
} {
  return {
    seed: snap.seed, home: snap.homeId, away: snap.awayId, stadium: snap.stadium,
    quarterSeconds: snap.quarterSeconds, difficulty: snap.difficulty,
    seats: snap.seats.map((s) => ({ side: s.side, active: s.active })),
  };
}
