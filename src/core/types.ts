/**
 * GRIDIRON OVERDRIVE — shared data contracts.
 * DATA ONLY. No imports, no classes, no methods. See ARCHITECTURE.md §5.
 */

// ─────────────────────────────────────────────────────────── identities

export type TeamSide = 0 | 1; // 0 = HOME (advances +Z), 1 = AWAY (advances -Z)
export type AthleteId = number;
export type SeatId = 0 | 1 | 2 | 3;

export const HOME: TeamSide = 0;
export const AWAY: TeamSide = 1;

// ─────────────────────────────────────────────────────────── geometry

export interface Vec2 { x: number; z: number }
export interface Vec3 { x: number; y: number; z: number }

// ─────────────────────────────────────────────────────────── league data

export type PositionCode = 'QB' | 'WR' | 'RB' | 'TE' | 'OL' | 'DL' | 'LB' | 'CB' | 'S';

export interface Ratings {
  speed: number;      // 0..100 top speed & acceleration
  power: number;      // 0..100 break/deliver contact
  hands: number;      // 0..100 catch radius & secure
  agility: number;    // 0..100 turn rate, special-move quality
  arm: number;        // 0..100 pass velocity + range (QB)
  accuracy: number;   // 0..100 pass placement (QB)
  coverage: number;   // 0..100 man/zone discipline
  awareness: number;  // 0..100 reaction speed, ball tracking
}

export interface PlayerDef {
  name: string;
  number: number;
  pos: PositionCode;
  ratings: Ratings;
  /** Cosmetic build: 0 = wiry, 1 = massive. Drives procedural geometry. */
  build: number;
  /** 0..1 skin tone index into the palette ramp. */
  tone: number;
  /** Cosmetic flair id: 0 none, 1 towel, 2 armband, 3 visor, 4 sleeves, 5 long socks */
  flair: number;
}

export interface TeamColors {
  primary: string;
  secondary: string;
  accent: string;
  /** Text/number colour that reads on `primary`. */
  ink: string;
  /** Field end-zone paint colour. */
  endzone: string;
}

export type TeamStyle = 'AIR' | 'GROUND' | 'BALANCED' | 'PRESSURE' | 'COVERAGE' | 'CHAOS';

export interface TeamDef {
  id: string;
  city: string;
  name: string;
  abbr: string;      // 2–3 chars
  colors: TeamColors;
  style: TeamStyle;
  /** 0..100 team-level tendencies shown on team select. */
  power: { passing: number; running: number; line: number; coverage: number; special: number };
  /** Fictional roster, 7 offense + 7 defense minimum, plus a kicker slot. */
  roster: PlayerDef[];
  /** Logo generator key in data/logoGen.ts */
  logo: string;
  /** Home stadium id in data/stadiums.ts */
  stadium: string;
  /** One-line flavour used on team select. */
  blurb: string;
}

export interface StadiumDef {
  id: string;
  name: string;
  city: string;
  /** 0 open, 1 half-roofed, 2 domed */
  roof: 0 | 1 | 2;
  surface: SurfaceKind;
  tier: 1 | 2 | 3;               // bowl size
  crowdTint: string;
  skyKind: 'DAY' | 'DUSK' | 'NIGHT' | 'STORM';
  accent: string;
}

export type SurfaceKind = 'GRASS' | 'TURF' | 'FROZEN' | 'MUD' | 'SAND' | 'ASPHALT';
export type WeatherKind = 'CLEAR' | 'RAIN' | 'SNOW' | 'FOG' | 'WIND' | 'HEAT';

export interface Conditions {
  weather: WeatherKind;
  surface: SurfaceKind;
  windX: number;   // yards/sec drift applied to airborne ball
  windZ: number;
  traction: number; // 1 = dry grass, < 1 slippery
}

// ─────────────────────────────────────────────────────────── plays

export type RouteAction =
  | 'RUN'        // straight to next node
  | 'CUT'        // sharp break at node
  | 'SPEED'      // turbo to next node
  | 'SETTLE'     // stop and face QB
  | 'DRIFT'      // slow lateral float in zone
  | 'BLOCK'      // engage nearest defender
  | 'CARRY'      // take handoff at node
  | 'LEAK';      // delay then release

export interface RouteNode {
  /** Offsets in yards from the athlete's snap position. +z is downfield for the offense. */
  x: number;
  z: number;
  action: RouteAction;
  /** Ticks to wait at this node before continuing. */
  hold?: number;
}

export type OffenseRole = 'QB' | 'BACK' | 'SLOT' | 'WIDE' | 'LINE';
export type DefenseAssign =
  | { kind: 'RUSH'; lane: number }                      // lane -1..1 across the LOS
  | { kind: 'CONTAIN'; side: -1 | 1 }
  | { kind: 'MAN'; slot: number }                       // index of offensive skill slot
  | { kind: 'ZONE'; x: number; z: number; r: number }   // centre relative to LOS
  | { kind: 'SPY' }
  | { kind: 'BLITZ_DELAY'; lane: number; delay: number };

export interface OffensePlayerPlan {
  role: OffenseRole;
  /** Alignment relative to the ball at the LOS. +x right (from offense POV), +z downfield. */
  align: { x: number; z: number };
  route: RouteNode[];
  /** Which pass target button this athlete answers to. null = not a target. */
  target: 0 | 1 | 2 | null;
  /** Block direction for linemen: -1 left, 0 straight, 1 right. */
  blockDir?: -1 | 0 | 1;
}

export interface DefensePlayerPlan {
  align: { x: number; z: number };
  assign: DefenseAssign;
}

export type PlayTag =
  | 'RUN' | 'QUICK' | 'CROSS' | 'FLOOD' | 'DEEP' | 'MISDIRECT' | 'ROLLOUT'
  | 'SCREEN' | 'OPTION' | 'TRICK' | 'SHOTGUN' | 'GOALLINE' | 'CLOCK';

export interface OffensePlay {
  id: string;
  name: string;
  page: 0 | 1 | 2 | 3;   // 3 = custom page
  slot: number;          // 0..8
  formation: string;
  tags: PlayTag[];
  players: OffensePlayerPlan[];  // exactly 7
  /** Landmarks in ticks: when the primary read should be open. */
  timing: { primary: number; secondary: number };
  /** Index into players[] for the first and second read. */
  reads: [number, number];
  /** AI hint 0..1 — how much this play wants to be run in short yardage. */
  shortYardage: number;
  deepShot: number;
  diagram?: string;
}

export type DefenseTag =
  | 'MAN' | 'ZONE' | 'MIXED' | 'CONTAIN' | 'SPY' | 'EDGE' | 'INTERIOR' | 'ALLOUT'
  | 'GOALLINE' | 'PREVENT' | 'SPECIAL';

export interface DefensePlay {
  id: string;
  name: string;
  slot: number;
  formation: string;
  tags: DefenseTag[];
  players: DefensePlayerPlan[];  // exactly 7
  aggression: number;  // 0..1 — used by AI play caller & risk model
  deepHelp: number;    // 0..1
  diagram?: string;
}

export interface CustomPlay {
  id: string;
  name: string;
  side: 'OFF' | 'DEF';
  slot: number;
  data: OffensePlay | DefensePlay;
}

// ─────────────────────────────────────────────────────────── athletes / world

export type AnimState =
  | 'IDLE' | 'RUN' | 'SPRINT' | 'BACKPEDAL' | 'THROW' | 'CATCH' | 'DIVE' | 'HURDLE'
  | 'SPIN' | 'STIFFARM' | 'TACKLE' | 'TACKLED' | 'CELEBRATE' | 'BLOCK' | 'KICK'
  | 'GETUP' | 'STUMBLE' | 'SET' | 'JUMP';

export interface AnimSlot {
  state: AnimState;
  phase: number;   // 0..1
  /** Ticks remaining before the state auto-returns to locomotion. */
  ticks: number;
}

export type MoveState =
  | 'NORMAL' | 'SPIN' | 'HURDLE' | 'HIGH_HURDLE' | 'DIVE' | 'STIFFARM'
  | 'TACKLING' | 'DIVE_TACKLE' | 'POWER_TACKLE' | 'DOWN' | 'GETUP'
  | 'BLOCK_ENGAGE' | 'THROWING' | 'JUMP' | 'KICKING' | 'CELEBRATE' | 'STUNNED';

export interface Athlete {
  id: AthleteId;
  side: TeamSide;
  slotIndex: number;          // 0..6 within the unit currently on the field
  unit: 'OFF' | 'DEF' | 'KICK';
  def: PlayerDef;

  // transform
  x: number; z: number; y: number;
  vx: number; vz: number; vy: number;
  facing: number;              // radians, 0 = +Z
  prevX: number; prevZ: number; prevY: number; prevFacing: number;

  // state
  move: MoveState;
  moveTicks: number;           // ticks remaining in `move`
  anim: AnimSlot;
  hasBall: boolean;
  turbo: number;               // 0..100
  turboHeld: boolean;
  turboLockTicks: number;      // regen delay
  stamina: number;             // 0..100 (slow drain, cosmetic pressure)
  downTicks: number;
  stunTicks: number;
  blockedBy: AthleteId | -1;
  engagedWith: AthleteId | -1;
  onFire: boolean;

  // assignment (rewritten at each snap)
  role: OffenseRole | 'DEF';
  route: RouteNode[] | null;
  routeIdx: number;
  routeHold: number;
  assign: DefenseAssign | null;
  targetButton: 0 | 1 | 2 | null;
  homeX: number; homeZ: number;   // snap alignment in world space

  // controller
  controlledBySeat: SeatId | -1;
  reactionQueue: number;          // ticks until AI may react to the current stimulus
  aiMemoryTick: number;
  aiScratch: number;              // per-controller scratch (e.g. juke cooldown)
}

export type PassKind = 'TOUCH' | 'NORMAL' | 'BULLET' | 'LATERAL' | 'PUMP';
export type KickKind = 'KICKOFF' | 'ONSIDE' | 'PUNT' | 'FIELD_GOAL' | 'EXTRA_POINT';

export type BallState =
  | { kind: 'held'; carrier: AthleteId }
  | {
      kind: 'inAir';
      from: AthleteId;
      intended: AthleteId | null;
      passKind: PassKind;
      t: number;        // seconds elapsed in flight
      flightTime: number;
      sx: number; sy: number; sz: number;
      tx: number; ty: number; tz: number;
      arc: number;
      contested: boolean;
    }
  | { kind: 'loose'; lastTouch: AthleteId | -1; ticks: number; fromFumble: boolean }
  | {
      kind: 'kicked';
      from: AthleteId;
      kickKind: KickKind;
      t: number;
      landed: boolean;
      goodThroughUprights: boolean | null;
    }
  | { kind: 'dead' };

export interface Ball {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  prevX: number; prevY: number; prevZ: number;
  spin: number;
  state: BallState;
  /** Team that owns possession for rules purposes — always valid, even mid-air. */
  possession: TeamSide;
}

// ─────────────────────────────────────────────────────────── match / rules

export type MatchPhase =
  | 'PREGAME' | 'COIN_TOSS' | 'KICKOFF_SETUP' | 'KICKOFF_LIVE'
  | 'PLAY_CALL' | 'PRE_SNAP' | 'LIVE' | 'DEAD_BALL' | 'POST_PLAY'
  | 'SCORE_RESOLVE' | 'CONVERSION_CALL' | 'CONVERSION_LIVE' | 'CONVERSION_RESOLVE'
  | 'QUARTER_BREAK' | 'HALFTIME' | 'OVERTIME_SETUP' | 'FINAL';

export type DeadReason =
  | 'TACKLE' | 'OUT_OF_BOUNDS' | 'INCOMPLETE' | 'TOUCHDOWN' | 'TOUCHBACK'
  | 'SAFETY' | 'INTERCEPTION_DEAD' | 'FUMBLE_DEAD' | 'KICK_RESULT'
  | 'QB_SLIDE' | 'TIME_EXPIRED' | 'FIELD_GOAL_GOOD' | 'FIELD_GOAL_MISS' | 'WATCHDOG';

export interface TeamMatchState {
  score: number;
  timeouts: number;                  // unused (no timeouts) — kept for stat parity
  overdrive: boolean;
  overdriveTicks: number;
  catchStreakReceiver: AthleteId | -1;
  catchStreak: number;
  sackStreak: number;
  stats: TeamStats;
}

export interface TeamStats {
  passAtt: number; passComp: number; passYds: number; passTd: number; ints: number;
  rushAtt: number; rushYds: number; rushTd: number;
  sacks: number; tackles: number; bigHits: number; forcedFumbles: number;
  firstDowns: number; totalYds: number; plays: number;
  fgAtt: number; fgMade: number; punts: number; possessionTicks: number;
  longestPlay: number; overdrives: number;
}

export interface MatchState {
  phase: MatchPhase;
  phaseTicks: number;
  quarter: number;              // 1..4, 5+ = OT
  clockTicks: number;           // remaining in quarter
  quarterTicks: number;         // length of a quarter
  playClockTicks: number;
  possession: TeamSide;
  down: number;                 // 1..4
  losZ: number;                 // absolute z of the line of scrimmage
  firstDownZ: number;           // absolute z target
  teams: [TeamMatchState, TeamMatchState];
  lastDead: DeadReason | null;
  /** Set while resolving a score so the conversion knows what happened. */
  pendingScore: null | { side: TeamSide; kind: 'TD' | 'FG' | 'SAFETY'; };
  conversionChoice: null | 'KICK' | 'TWO';
  kickoffReceiving: TeamSide;
  secondHalfReceiver: TeamSide;
  overtimePeriod: number;
  finished: boolean;
  winner: TeamSide | null | 'TIE';
  driveStartZ: number;
  driveSide: TeamSide;
}

// ─────────────────────────────────────────────────────────── config

export type Difficulty = 'ROOKIE' | 'PRO' | 'ALLSTAR' | 'LEGEND';

export interface MatchConfig {
  seed: number;
  home: string;   // team id
  away: string;   // team id
  stadium: string;
  weather: WeatherKind;
  quarterSeconds: number;    // 60 | 120 | 180 | 240 | 360
  difficulty: Difficulty;
  playClock: boolean;
  /** Seat -> team, or -1 for unassigned. */
  seats: Array<{ side: TeamSide; active: boolean }>;
  catchUpBias: boolean;
  lateHits: boolean;
  mode: 'QUICKPLAY' | 'TOURNAMENT' | 'SEASON' | 'PRACTICE';
}

// ─────────────────────────────────────────────────────────── events

export interface BaseEvent { tick: number }

export type GameEvent =
  | ({ type: 'play.start'; play: string; side: TeamSide } & BaseEvent)
  | ({ type: 'snap'; side: TeamSide } & BaseEvent)
  | ({ type: 'handoff'; to: AthleteId } & BaseEvent)
  | ({ type: 'throw'; from: AthleteId; to: AthleteId | null; passKind: PassKind } & BaseEvent)
  | ({ type: 'pass.arrive'; at: Vec3 } & BaseEvent)
  | ({ type: 'catch'; by: AthleteId; contested: boolean; diving: boolean; yards: number } & BaseEvent)
  | ({ type: 'drop'; by: AthleteId } & BaseEvent)
  | ({ type: 'swat'; by: AthleteId } & BaseEvent)
  | ({ type: 'interception'; by: AthleteId } & BaseEvent)
  | ({ type: 'lateral'; from: AthleteId; to: AthleteId } & BaseEvent)
  | ({ type: 'fumble'; by: AthleteId; forcedBy: AthleteId | -1 } & BaseEvent)
  | ({ type: 'recover'; by: AthleteId; side: TeamSide } & BaseEvent)
  | ({ type: 'tackle'; by: AthleteId; on: AthleteId; power: number } & BaseEvent)
  | ({ type: 'bigHit'; by: AthleteId; on: AthleteId; power: number } & BaseEvent)
  | ({ type: 'brokenTackle'; by: AthleteId; on: AthleteId } & BaseEvent)
  | ({ type: 'sack'; by: AthleteId; on: AthleteId; yards: number } & BaseEvent)
  | ({ type: 'move'; by: AthleteId; move: 'HURDLE' | 'HIGH_HURDLE' | 'SPIN' | 'DIVE' | 'STIFFARM' } & BaseEvent)
  | ({ type: 'block.win'; by: AthleteId; on: AthleteId; pancake: boolean } & BaseEvent)
  | ({ type: 'firstDown'; side: TeamSide } & BaseEvent)
  | ({ type: 'down.change'; down: number; distance: number } & BaseEvent)
  | ({ type: 'turnover'; to: TeamSide; kind: 'INT' | 'FUMBLE' | 'DOWNS' | 'PUNT' | 'MISSED_FG' } & BaseEvent)
  | ({ type: 'touchdown'; side: TeamSide; by: AthleteId; yards: number } & BaseEvent)
  | ({ type: 'fieldGoal.attempt'; side: TeamSide; distance: number } & BaseEvent)
  | ({ type: 'fieldGoal.result'; side: TeamSide; good: boolean; distance: number } & BaseEvent)
  | ({ type: 'punt'; side: TeamSide; distance: number } & BaseEvent)
  | ({ type: 'kickoff'; side: TeamSide; onside: boolean } & BaseEvent)
  | ({ type: 'safety'; against: TeamSide } & BaseEvent)
  | ({ type: 'touchback' } & BaseEvent)
  | ({ type: 'extraPoint'; side: TeamSide; good: boolean } & BaseEvent)
  | ({ type: 'twoPoint'; side: TeamSide; good: boolean } & BaseEvent)
  | ({ type: 'outOfBounds'; at: Vec3 } & BaseEvent)
  | ({ type: 'overdrive.charge'; side: TeamSide; progress: number } & BaseEvent)
  | ({ type: 'overdrive.start'; side: TeamSide; cause: 'CATCH' | 'SACK' } & BaseEvent)
  | ({ type: 'overdrive.end'; side: TeamSide; cause: string } & BaseEvent)
  | ({ type: 'play.end'; reason: DeadReason; spotZ: number; yards: number } & BaseEvent)
  | ({ type: 'quarter.end'; quarter: number } & BaseEvent)
  | ({ type: 'half' } & BaseEvent)
  | ({ type: 'overtime'; period: number } & BaseEvent)
  | ({ type: 'match.end'; winner: TeamSide | 'TIE' } & BaseEvent)
  | ({ type: 'camera.impulse'; power: number; at: Vec3 } & BaseEvent)
  | ({ type: 'crowd.swell'; power: number; side: TeamSide | -1 } & BaseEvent)
  | ({ type: 'rules.watchdog'; phase: MatchPhase } & BaseEvent)
  | ({ type: 'ui.tick' } & BaseEvent)
  | ({ type: 'ui.confirm' } & BaseEvent)
  | ({ type: 'ui.back' } & BaseEvent);

export type GameEventType = GameEvent['type'];

// ─────────────────────────────────────────────────────────── input

export interface PlayerIntent {
  moveX: number;
  moveZ: number;
  held: number;
  pressed: number;
  released: number;
}

// ─────────────────────────────────────────────────────────── results

export interface MatchResult {
  homeScore: number;
  awayScore: number;
  winner: TeamSide | 'TIE';
  quarters: number;
  overtime: number;
  stats: [TeamStats, TeamStats];
  ticks: number;
  eventCounts: Record<string, number>;
  seed: number;
}
