/**
 * Tuning constants. One place, so playtest changes are auditable.
 * Yards + seconds unless noted. Ticks are 1/60 s.
 */

export const FIXED_DT = 1 / 60;
export const TICK_HZ = 60;
export const MAX_SUBSTEPS = 5;

export function s(seconds: number): number { return Math.round(seconds * TICK_HZ); }

// ── field ──────────────────────────────────────────────────────────────────
export const FIELD_HALF_WIDTH = 26.665;   // 53.33 yd wide
export const FIELD_LENGTH = 100;
export const ENDZONE_DEPTH = 10;
export const GOAL_HOME = 0;               // home defends z=0, attacks z=100
export const GOAL_AWAY = 100;
export const HASH_X = 9.25;
export const GOALPOST_WIDTH = 9.25;       // half-width of uprights
export const GOALPOST_HEIGHT = 10;
export const FIRST_DOWN_YARDS = 30;
export const DOWNS = 4;

// ── movement ───────────────────────────────────────────────────────────────
export const SPEED_SKILL_BASE = 9.4;
export const SPEED_SKILL_TURBO = 13.6;
export const SPEED_LINE_BASE = 7.6;
export const SPEED_LINE_TURBO = 10.4;
/** Rating 50 = 1.0×; each point is ±0.35 %. */
export const SPEED_RATING_SCALE = 0.0035;
export const ACCEL_GROUND = 46;           // yd/s²
export const ACCEL_AIRBORNE = 6;
export const DECEL_GROUND = 58;
export const TURN_RATE_BASE = 8.2;        // rad/s at low speed
export const TURN_RATE_SPRINT = 3.4;      // rad/s at top speed
export const BACKPEDAL_FACTOR = 0.72;
/**
 * The ball carrier runs a little faster than the eleven — sorry, six — people chasing him.
 * This is an arcade convention, not physics: without it seven pursuers erase every breakaway
 * and the game has no explosive plays. Small enough that angles still beat speed.
 */
export const CARRIER_SPEED_BONUS = 1.06;

// ── turbo ──────────────────────────────────────────────────────────────────
export const TURBO_MAX = 100;
export const TURBO_DRAIN = 31;            // per second held (~3.2 s of sprint from full)
export const TURBO_REGEN = 26;            // per second once unlocked
export const TURBO_REGEN_DELAY_MIN = s(0.25);
export const TURBO_REGEN_DELAY_MAX = s(0.85);
export const TURBO_COST = {
  JUKE: 10,
  SPIN: 20, STIFFARM: 15, HIGH_HURDLE: 25, DIVE: 18,
  POWER_TACKLE: 25, DIVE_TACKLE: 10, PUSH: 12, BULLET: 8, JUMP_PASS: 10,
} as const;

// ── special moves (ticks) ──────────────────────────────────────────────────
export const MOVE_TICKS = {
  SPIN: s(0.52), HURDLE: s(0.58), HIGH_HURDLE: s(0.86), DIVE: s(0.75), JUKE: s(0.33),
  STIFFARM: s(0.40), DIVE_TACKLE: s(0.62), POWER_TACKLE: s(0.50), TACKLE: s(0.34),
  GETUP: s(0.70), STUN: s(0.55), THROW: s(0.26), KICK: s(0.55), JUMP: s(0.62),
  /** Recovery frames: a high hurdle lands helpless, a missed power tackle is committed. */
  LANDING: s(0.18), WHIFF: s(0.20),
} as const;

/**
 * The juke: a short plant and cut, cheap, and specifically a counter to a COMMITTED dive.
 *
 * It is not a small spin. A spin beats one close side threat and costs most of the meter; a juke
 * beats a defender who has already left his feet or overcommitted his angle, costs little, and
 * does almost nothing against a patient wrap tackler who is still balanced. That distinction is
 * the whole reason to have both — a move that is good against everything is a button you hold.
 */
export const JUKE_LATERAL = 2.3;          // yards of sideways displacement across the cut
export const JUKE_EVADE_DIVE = 0.86;      // chance a committed dive tackle whiffs through a juke
export const JUKE_EVADE_STANDING = 0.18;  // ...and how little it does against a balanced tackler

/**
 * Protect the ball: trade speed and agility for security. Deliberately unglamorous — it is the
 * option a player takes when they have already won and only need to finish.
 */
export const PROTECT_SPEED = 0.88;        // fraction of top speed
export const PROTECT_TURN = 0.85;         // fraction of turn rate
export const PROTECT_FUMBLE = 0.55;       // multiplier on fumble chance

export const SPIN_EVADE = 0.62;           // base chance a tackle attempt whiffs during a spin
export const HURDLE_CLEAR_HEIGHT = 0.75;  // tackle volumes below this are ignored
export const HIGH_HURDLE_CLEAR = 1.7;
export const STIFFARM_RANGE = 1.9;
export const STIFFARM_CONE = 1.15;        // radians half-angle
export const DIVE_BOOST = 1.55;           // forward yards

// ── contact ────────────────────────────────────────────────────────────────
export const BODY_RADIUS = 0.42;
export const TACKLE_RADIUS = 1.05;
export const DIVE_TACKLE_RADIUS = 1.5;
export const POWER_TACKLE_RADIUS = 1.25;
export const BLOCK_RADIUS = 0.95;
export const BREAK_TACKLE_BASE = 0.25;    // baseline chance to shrug a routine tackle
export const FUMBLE_BASE = 0.012;
export const FUMBLE_POWER_SCALE = 0.040;
export const FUMBLE_SPIN_MULT = 2.0;
export const FUMBLE_WEATHER_MULT = 1.45;
export const BIG_HIT_POWER = 1.35;

// ── passing ────────────────────────────────────────────────────────────────
export const PASS_MAX_YARDS = 60;
export const PASS_SPEED = { TOUCH: 15.5, NORMAL: 21.0, BULLET: 30.0, LATERAL: 14.0, PUMP: 0 } as const;
export const PASS_ARC = { TOUCH: 0.85, NORMAL: 0.5, BULLET: 0.17, LATERAL: 0.28, PUMP: 0 } as const;
export const CATCH_RADIUS_BASE = 1.35;
export const CATCH_RADIUS_BY_KIND = { TOUCH: 1.55, NORMAL: 1.35, BULLET: 1.05, LATERAL: 1.5, PUMP: 0 } as const;
export const CATCH_HANDS_SCALE = 0.006;   // per rating point over 50
export const CATCH_WINDOW_TICKS = s(0.34);
export const INT_BASE = 0.30;             // defender in position → chance to pick vs swat
export const SWAT_ANGLE_BONUS = 0.25;
export const CONTEST_PENALTY = 0.34;      // catch chance reduction when contested
export const DROP_PRESSURE = 0.12;
export const LEAD_TIME_SCALE = 0.92;
/**
 * Throw error is angular. `spread = baseErr * (NEAR + range * PER_YARD)`, so a five-yard flat is
 * thrown tighter than the old flat error and a forty-five yard bomb much looser. Calibrated so the
 * short game is untouched (×0.71 at 5 yd, ×1.0 at 14 yd) and the deep ball is genuinely hard
 * (×1.7 at 40 yd).
 */
export const PASS_ERROR_NEAR = 0.60;
export const PASS_ERROR_PER_YARD = 0.0275;

// ── bobbles ────────────────────────────────────────────────────────────────
// A failed catch that juggles instead of dying. These are chances that a DROP becomes a bobble,
// not chances that a catch fails, so they compose on top of the existing catch roll and do not
// change how often the ball is caught. They are additive and are allowed to exceed 1 in the
// worst case (contested + bullet + diving = 1.02), which simply means that particular drop always
// juggles — a diving contested grab at a bullet is exactly the ball that should never die quietly.
export const BOBBLE_CONTESTED = 0.62;
export const BOBBLE_BULLET = 0.22;
export const BOBBLE_DIVING = 0.18;
export const BOBBLE_POP = 4.6;            // yd/s upward off the hands: ≈0.6 s of hang
export const BOBBLE_SCATTER = 2.2;        // ± lateral drift, small enough to stay contestable
export const BOBBLE_GRAB = 0.34;          // per-tick chance a man in reach secures a tumbling ball
export const SWAT_TIP_UP = 0.22;          // share of batted forward passes that go up, not down
export const TIP_SELF_PENALTY = 0.26;     // how much worse the man who tipped it is at recovering it

// ── kicking ────────────────────────────────────────────────────────────────
export const FG_MAX_YARDS = 50;
export const FG_METER_PERIOD = s(1.05);
export const PUNT_POWER_PERIOD = s(1.0);
export const KICKOFF_FROM_Z = 30;         // own 30
/**
 * Where a kickoff comes down, as a yard line for the receiving team.
 *
 * The floor used to be the 3. Measured over sixty games, that put the median catch on the four
 * and a tenth of them inside the goal line, which is not a return, it is an ambush — the coverage
 * arrives before the returner has taken a stride, and the game was paying out two points for it
 * two and a half times a match. A kick has to leave the man a runway or it should simply be a
 * touchback.
 */
export const KICKOFF_TARGET_MIN = 9;
export const KICKOFF_TARGET_MAX = 22;
/**
 * How far from his own goal line a player may take possession of somebody else's ball and still
 * be granted a touchback rather than a safety when he is driven back over it. Football's momentum
 * exception, widened from five because the ball was routinely being fielded just outside it.
 */
export const MOMENTUM_YARDS = 10;
export const ONSIDE_YARDS = 11;
export const TOUCHBACK_Z = 20;
export const PAT_MAKE_BASE = 0.965;
export const PAT_DISTANCE = 12;
export const TWO_POINT_Z = 5;             // spot for the 2-pt try relative to goal line

// ── clock ──────────────────────────────────────────────────────────────────
export const QUARTER_OPTIONS = [60, 120, 180, 240, 360];
export const DEFAULT_QUARTER_SECONDS = 120;
/**
 * The game clock runs faster than real time during live play. With the clock stopped
 * between every snap, 1.0 would produce ~120 plays a game; 2.6 lands on the ~50-play,
 * 10-12 minute arcade rhythm we are aiming for.
 */
export const CLOCK_SCALE = 2.6;
export const PLAY_CLOCK_SECONDS = 10;
export const PLAY_CALL_SECONDS = 12;
export const DEAD_BALL_TICKS = s(0.55);
export const POST_PLAY_TICKS = s(0.9);
export const PRE_SNAP_MIN_TICKS = s(0.35);
export const SCORE_CELEBRATION_TICKS = s(2.6);
export const QUARTER_BREAK_TICKS = s(2.2);
export const OVERTIME_PERIODS = 3;

// ── overdrive (momentum) ───────────────────────────────────────────────────
/** Three straight completions light it. All three to the SAME receiver lights it for longer. */
export const OVERDRIVE_TEAM_STREAK = 3;
export const OVERDRIVE_CATCH_STREAK = 3;
export const OVERDRIVE_SACK_STREAK = 2;
export const OVERDRIVE_MAX_TICKS = s(36);          // normal duration
export const OVERDRIVE_PERFECT_TICKS = s(52);      // same receiver three times running
export const OVERDRIVE_SPEED = 1.11;
export const OVERDRIVE_BREAK_TACKLE = 1.45;
export const OVERDRIVE_CATCH = 1.16;
export const OVERDRIVE_PRESSURE = 1.18;
export const OVERDRIVE_ACCURACY = 1.12;

// ── AI ─────────────────────────────────────────────────────────────────────
export const AI_PROFILES = {
  ROOKIE:  { reactionTicks: 17, aimErrorYd: 2.4, decisionNoise: 0.34, coverageDiscipline: 0.55, riskTolerance: 0.35, moveTiming: 0.35, playCallQuality: 0.45, pursuitAngleError: 0.30, catchFocus: 0.72 },
  PRO:     { reactionTicks: 11, aimErrorYd: 1.5, decisionNoise: 0.20, coverageDiscipline: 0.74, riskTolerance: 0.50, moveTiming: 0.58, playCallQuality: 0.68, pursuitAngleError: 0.18, catchFocus: 0.84 },
  ALLSTAR: { reactionTicks: 7,  aimErrorYd: 0.9, decisionNoise: 0.11, coverageDiscipline: 0.87, riskTolerance: 0.62, moveTiming: 0.76, playCallQuality: 0.84, pursuitAngleError: 0.10, catchFocus: 0.91 },
  LEGEND:  { reactionTicks: 5,  aimErrorYd: 0.55, decisionNoise: 0.06, coverageDiscipline: 0.94, riskTolerance: 0.72, moveTiming: 0.88, playCallQuality: 0.93, pursuitAngleError: 0.06, catchFocus: 0.96 },
} as const;

/** Bounded, documented, disableable. See DESIGN.md § Comeback bias. */
export const CATCHUP_MAX = 0.06;

// ── weather ────────────────────────────────────────────────────────────────
export const SURFACE_TRACTION: Record<string, number> = {
  GRASS: 1.0, TURF: 1.02, FROZEN: 0.84, MUD: 0.86, SAND: 0.9, ASPHALT: 1.04,
};
export const WEATHER_TRACTION: Record<string, number> = {
  CLEAR: 1.0, RAIN: 0.92, SNOW: 0.87, FOG: 1.0, WIND: 1.0, HEAT: 0.99,
};
