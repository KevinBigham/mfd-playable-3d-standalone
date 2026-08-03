/**
 * Mastery drills (W5-004): short, named practice reps that each teach ONE read the corrected
 * game rewards — screen vs blitz, placement away from leverage, the deep safety split.
 *
 * A drill is nothing but a curated PracticeParams preset: the practice field already knows how
 * to freeze a defence, re-arm a spot, and count reps. No new match mode, no stat power —
 * rep counts are identity, exactly like team mastery counters.
 */
import { OFFENSE_PLAYS } from '../plays/offense.ts';
import { DEFENSE_PLAYS } from '../plays/defense.ts';
import type { DefensePlay, OffensePlay } from '../core/types.ts';

export interface Drill {
  id: string;
  label: string;
  /** What the rep is supposed to teach, in one line. */
  lesson: string;
  offenseId: string;
  defenseId: string;
  /** Yards from the offense's own goal line. */
  yard: number;
  down: number;
  routesOnly?: boolean;
}

export const DRILLS: Drill[] = [
  {
    id: 'drill-mesh-timing', label: 'MESH TIMING',
    lesson: 'Routes only — watch the crossers clear each other, then throw on time, not late.',
    offenseId: 'o-ripcord-mesh', defenseId: 'd-soft-shadow', yard: 25, down: 1, routesOnly: true,
  },
  {
    id: 'drill-screen-vs-blitz', label: 'SCREEN VS BLITZ',
    lesson: 'They send everyone — let the rush come, then hit the screen behind it.',
    offenseId: 'o-ladder-screen', defenseId: 'd-full-send', yard: 30, down: 2,
  },
  {
    id: 'drill-deep-split', label: 'THE DEEP SPLIT',
    lesson: 'Two deep safeties: aim the post at the gap between them, away from the closer one.',
    offenseId: 'o-deep-mine', defenseId: 'd-half-and-half', yard: 40, down: 1,
  },
  {
    id: 'drill-third-and-long', label: '3RD & LONG',
    lesson: 'Flood one side and read short-to-deep — the checkdown that moves the sticks is a win.',
    offenseId: 'o-tower-flood', defenseId: 'd-four-roof', yard: 25, down: 3,
  },
  {
    id: 'drill-red-zone', label: 'RED ZONE KNIFE',
    lesson: 'No room deep — quick timing beats a packed goal line. Throw before the window shuts.',
    offenseId: 'o-quick-nails', defenseId: 'd-goal-wall', yard: 90, down: 1,
  },
  {
    id: 'drill-run-lanes', label: 'RUN LANES',
    lesson: 'Press the dive, then cut off the double team — the lane opens late, not at the snap.',
    offenseId: 'o-anvil-dive', defenseId: 'd-gut-punch', yard: 35, down: 1,
  },
];

export function drillOffense(d: Drill): OffensePlay {
  return OFFENSE_PLAYS.find((p) => p.id === d.offenseId) ?? OFFENSE_PLAYS[0];
}

export function drillDefense(d: Drill): DefensePlay {
  return DEFENSE_PLAYS.find((p) => p.id === d.defenseId) ?? DEFENSE_PLAYS[0];
}
