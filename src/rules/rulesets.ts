/**
 * Versioned rulesets: what kind of football this match is.
 *
 * Classic is the complete game — pregame, kickoffs, quarters, conversions, special teams.
 * Drive Rush is the phone front door: one offensive drive from the opponent's 40, four downs to
 * cross the opponent's 10 (the same 30-yard chain), then goal-to-go; touchdown, turnover,
 * turnover on downs, safety, or the clock ends the attempt. No kickoff, punt, field goal, PAT,
 * quarter, or opponent possession.
 *
 * The seam exists so the mobile product never scatters `if (mobile)` through authoritative
 * rules: a match is parameterized by WHICH football it is playing, not by which device is
 * watching. Every snapshot and challenge code carries the ruleset id and version.
 */
import type { TeamSide } from '../core/types.ts';
import { FIELD_LENGTH } from '../core/constants.ts';

export type RulesetId = 'CLASSIC' | 'DRIVE_RUSH';

export interface Ruleset {
  readonly id: RulesetId;
  readonly version: number;
  /** PREGAME runs the full coin-toss/kickoff ceremony; DRIVE starts at the ball. */
  readonly opening: 'PREGAME' | 'DRIVE';
  /** Offense-only modes pin possession to one side for the whole match. */
  readonly fixedPossession: TeamSide | null;
  /** Punts, field goals, kickoffs, and conversions exist. */
  readonly specialTeams: boolean;
  /** Quarter machinery (breaks, halftime, overtime). Off = one timed period ends the match. */
  readonly quarters: boolean;
  /** The match ends the moment the opening drive ends (score, turnover, downs, safety). */
  readonly endOnDriveEnd: boolean;
  /** Line of scrimmage for a DRIVE opening. */
  driveStartZ(possession: TeamSide): number;
}

export const CLASSIC_RULESET: Ruleset = {
  id: 'CLASSIC',
  version: 1,
  opening: 'PREGAME',
  fixedPossession: null,
  specialTeams: true,
  quarters: true,
  endOnDriveEnd: false,
  driveStartZ: () => FIELD_LENGTH / 2,
};

export const DRIVE_RUSH_RULESET: Ruleset = {
  id: 'DRIVE_RUSH',
  version: 1,
  opening: 'DRIVE',
  fixedPossession: 0,
  specialTeams: false,
  quarters: false,
  endOnDriveEnd: true,
  // The opponent's 40: forty yards from the goal line being attacked. Side 0 attacks z=100.
  driveStartZ: (possession) => (possession === 0 ? FIELD_LENGTH - 40 : 40),
};

export function rulesetById(id: RulesetId | undefined): Ruleset {
  return id === 'DRIVE_RUSH' ? DRIVE_RUSH_RULESET : CLASSIC_RULESET;
}
