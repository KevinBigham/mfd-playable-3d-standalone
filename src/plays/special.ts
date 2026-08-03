/**
 * GRIDIRON OVERDRIVE — special teams.
 *
 * Every special-teams call is shaped as a normal OffensePlay or DefensePlay so
 * sim/playRunner.ts reuses exactly one runner. The kicking specialist always
 * occupies a slot aligned deep behind the line; the sim decides when the ball
 * is struck, the play only says where everybody stands and where they go.
 *
 * Offensive special calls live on page 3 (the custom/utility page) at slots
 * 0-6. Defensive special calls take slots 14-16, past the 14-deep call pool in
 * defense.ts, so no wheel slot ever collides.
 */

import type {
  DefenseAssign, DefensePlay, DefensePlayerPlan, OffensePlay, OffensePlayerPlan, RouteNode,
} from '../core/types.ts';
import { s } from '../core/constants.ts';
import { getOffenseFormation } from './formations.ts';
import { assignTargetsByX, block, comeback, flat, slant } from './routes.ts';

type BlockDir = -1 | 0 | 1;

function n(x: number, z: number, action: RouteNode['action'], hold?: number): RouteNode {
  return hold === undefined ? { x, z, action } : { x, z, action, hold };
}

function mk(formation: string, routes: RouteNode[][], blockDirs?: BlockDir[]): OffensePlayerPlan[] {
  const f = getOffenseFormation(formation);
  return assignTargetsByX(f.slots.map((sl, i) => {
    const plan: OffensePlayerPlan = {
      role: sl.role,
      align: { x: sl.align.x, z: sl.align.z },
      route: routes[i],
      target: null,
    };
    if (sl.role === 'LINE') plan.blockDir = blockDirs?.[i] ?? 0;
    return plan;
  }));
}

function dp(x: number, z: number, assign: DefenseAssign): DefensePlayerPlan {
  return { align: { x, z }, assign };
}
const rush = (lane: number): DefenseAssign => ({ kind: 'RUSH', lane });
const contain = (side: -1 | 1): DefenseAssign => ({ kind: 'CONTAIN', side });
const man = (slot: number): DefenseAssign => ({ kind: 'MAN', slot });
const zone = (x: number, z: number, r: number): DefenseAssign => ({ kind: 'ZONE', x, z, r });

const B0 = block(0);
/** Protect for a beat, then sprint into coverage. */
const coverRelease = (dir: BlockDir): RouteNode[] => [
  n(dir * 0.8, 0.5, 'BLOCK', s(0.45)),
  n(dir * 2.5, 12, 'SPEED'),
  n(dir * 4.0, 34, 'SPEED'),
];
/** Gunner: no protection duty, straight down the boundary to the ball. */
const gunner = (dir: -1 | 1): RouteNode[] => [
  n(dir * 0.4, 12, 'SPEED'),
  n(dir * 1.2, 40, 'SPEED'),
];
/** Kicking motion: step into the ball and hold the follow-through. */
const strike = (approach: number): RouteNode[] => [
  n(0, approach * 0.4, 'RUN'),
  n(0, approach, 'SETTLE', s(2.0)),
];

// ── offensive special teams ────────────────────────────────────────────────

/** Standard punt. Wing protection first, then release into the cover lanes. */
const PUNT: OffensePlay = {
  id: 'sp-punt', name: 'Punt', page: 3, slot: 0,
  formation: 'PUNT_SHOW', tags: ['CLOCK'],
  players: mk('PUNT_SHOW', [
    strike(1.6),
    coverRelease(-1), coverRelease(0), coverRelease(1),
    gunner(-1),
    [n(0, 1.2, 'BLOCK', s(0.7)), n(0.5, 14, 'SPEED'), n(1.0, 36, 'SPEED')],
    gunner(1),
  ], [0, -1, 0, 1, 0, 0, 0]),
  timing: { primary: s(1.4), secondary: s(2.0) },
  reads: [4, 6],
  shortYardage: 0.0, deepShot: 0.0,
};

/** Punt look, punter throws. The gunners are already gone; nobody is on them. */
const FAKE_PUNT: OffensePlay = {
  id: 'sp-fake-punt', name: 'Fake Punt', page: 3, slot: 1,
  formation: 'PUNT_SHOW', tags: ['TRICK'],
  players: mk('PUNT_SHOW', [
    [n(0, 0.8, 'RUN'), n(1.6, 0.2, 'SETTLE', s(2.2))],
    B0, B0, B0,
    [n(0.6, 10, 'SPEED'), n(2.0, 22, 'SPEED')],
    [n(1.2, -0.6, 'RUN'), n(5.5, 2.5, 'RUN'), n(9.0, 7, 'SETTLE', s(0.8))],
    comeback(1, 14),
  ]),
  timing: { primary: s(1.7), secondary: s(2.3) },
  reads: [5, 6],
  shortYardage: 0.8, deepShot: 0.25,
};

/** Field goal. Everybody holds the wall; nobody releases. */
const FIELD_GOAL: OffensePlay = {
  id: 'sp-field-goal', name: 'Field Goal', page: 3, slot: 2,
  formation: 'KICK_SHOW', tags: ['CLOCK'],
  players: mk('KICK_SHOW', [
    [n(0.2, 0.4, 'SETTLE', s(2.4))],
    B0, B0, B0,
    block(-1),
    strike(2.2),
    block(1),
  ]),
  timing: { primary: s(1.2), secondary: s(1.6) },
  reads: [4, 6],
  shortYardage: 0.0, deepShot: 0.0,
};

/** Holder stands up and throws. Wings slip out as the rush crashes inside. */
const FAKE_FIELD_GOAL: OffensePlay = {
  id: 'sp-fake-field-goal', name: 'Fake Field Goal', page: 3, slot: 3,
  formation: 'KICK_SHOW', tags: ['TRICK'],
  players: mk('KICK_SHOW', [
    [n(0.6, 1.4, 'RUN'), n(2.4, 1.0, 'SETTLE', s(2.0))],
    B0, B0, B0,
    flat(-1, 3),
    [n(-1.4, 1.0, 'BLOCK', s(0.5)), n(-4.0, 4.0, 'LEAK'), n(-7.0, 9, 'SPEED')],
    slant(-1, 4),
  ]),
  timing: { primary: s(1.3), secondary: s(1.75) },
  reads: [4, 6],
  shortYardage: 0.7, deepShot: 0.15,
};

/** Extra point. Same protection as the field goal, shorter hold. */
const EXTRA_POINT: OffensePlay = {
  id: 'sp-extra-point', name: 'Extra Point', page: 3, slot: 4,
  formation: 'KICK_SHOW', tags: ['CLOCK'],
  players: mk('KICK_SHOW', [
    [n(0.2, 0.4, 'SETTLE', s(2.2))],
    B0, B0, B0,
    block(-1),
    strike(2.0),
    block(1),
  ]),
  timing: { primary: s(1.1), secondary: s(1.5) },
  reads: [4, 6],
  shortYardage: 0.0, deepShot: 0.0,
};

/** Kickoff. Kicker deep, six cover men in lanes. */
const KICKOFF: OffensePlay = {
  id: 'sp-kickoff', name: 'Kickoff', page: 3, slot: 5,
  formation: 'KICKOFF_SHOW', tags: ['CLOCK'],
  players: mk('KICKOFF_SHOW', [
    strike(2.6),
    [n(-1.0, 20, 'SPEED'), n(-2.5, 48, 'SPEED')],
    [n(0, 20, 'SPEED'), n(0, 48, 'SPEED')],
    [n(1.0, 20, 'SPEED'), n(2.5, 48, 'SPEED')],
    [n(1.5, 20, 'SPEED'), n(3.5, 46, 'SPEED')],
    [n(-1.5, 20, 'SPEED'), n(-3.5, 48, 'SPEED')],
    [n(-1.5, 20, 'SPEED'), n(-3.5, 46, 'SPEED')],
  ]),
  timing: { primary: s(2.0), secondary: s(3.0) },
  reads: [4, 6],
  shortYardage: 0.0, deepShot: 0.0,
};

/** Onside. Everybody crowds the kick side and attacks the first bounce. */
const ONSIDE: OffensePlay = {
  id: 'sp-onside', name: 'Onside Kick', page: 3, slot: 6,
  formation: 'KICKOFF_SHOW', tags: ['TRICK'],
  players: mk('KICKOFF_SHOW', [
    strike(2.2),
    [n(6.0, 4.0, 'RUN'), n(11.0, 11, 'SPEED')],
    [n(9.0, 3.0, 'RUN'), n(14.0, 11, 'SPEED')],
    [n(3.0, 3.0, 'RUN'), n(6.0, 12, 'SPEED')],
    [n(14.0, 6.0, 'RUN'), n(20.0, 12, 'SPEED')],
    [n(6.0, 3.0, 'RUN'), n(10.0, 11, 'SPEED')],
    [n(-4.0, 5.0, 'RUN'), n(-8.0, 12, 'SPEED')],
  ]),
  timing: { primary: s(0.9), secondary: s(1.4) },
  reads: [4, 6],
  shortYardage: 0.0, deepShot: 0.0,
};

// ── defensive special teams ────────────────────────────────────────────────

/** Punt return: jam both gunners, two rushers, build a wall, one man deep. */
const PUNT_RETURN: DefensePlay = {
  id: 'sp-punt-return', name: 'Punt Return', slot: 14,
  formation: 'PUNT_RETURN_SHOW', tags: ['SPECIAL'],
  players: [
    dp(-3.0, 0.9, rush(-0.4)),
    dp(3.0, 0.9, rush(0.4)),
    dp(-12.0, 1.2, man(0)),
    dp(12.0, 1.2, man(2)),
    dp(-6.5, 9.0, zone(-9, 20, 9)),
    dp(6.5, 9.0, zone(9, 20, 9)),
    dp(0, 42.0, zone(0, 44, 16)),
  ],
  aggression: 0.30, deepHelp: 0.60,
};

/** Kick return: two walls and a returner. Nobody rushes a kickoff. */
const KICK_RETURN: DefensePlay = {
  id: 'sp-kick-return', name: 'Kick Return', slot: 15,
  formation: 'KICK_RETURN_SHOW', tags: ['SPECIAL'],
  players: [
    dp(-9.0, 12.0, zone(-8, 26, 10)),
    dp(9.0, 12.0, zone(8, 26, 10)),
    dp(-18.0, 20.0, zone(-16, 32, 10)),
    dp(18.0, 20.0, zone(16, 32, 10)),
    dp(-5.0, 34.0, zone(-4, 44, 11)),
    dp(5.0, 34.0, zone(4, 44, 11)),
    dp(0, 60.0, zone(0, 62, 18)),
  ],
  aggression: 0.10, deepHelp: 1.0,
};

/** Kick block: four inside, both edges contained, one back for the miss. */
const BLOCK_KICK: DefensePlay = {
  id: 'sp-block-kick', name: 'Kick Block', slot: 16,
  formation: 'BLOCK_SHOW', tags: ['SPECIAL', 'ALLOUT'],
  players: [
    dp(-4.5, 0.9, rush(-0.7)),
    dp(-1.5, 0.9, rush(-0.2)),
    dp(1.5, 0.9, rush(0.2)),
    dp(4.5, 0.9, rush(0.7)),
    dp(-7.8, 1.2, contain(-1)),
    dp(7.8, 1.2, contain(1)),
    dp(0, 6.0, zone(0, 16, 13)),
  ],
  aggression: 0.95, deepHelp: 0.10,
};

// ── export ─────────────────────────────────────────────────────────────────

export interface SpecialPlaybook {
  punt: OffensePlay;
  fakePunt: OffensePlay;
  fieldGoal: OffensePlay;
  fakeFieldGoal: OffensePlay;
  extraPoint: OffensePlay;
  kickoff: OffensePlay;
  onside: OffensePlay;
  kickReturn: DefensePlay;
  puntReturn: DefensePlay;
  blockKick: DefensePlay;
}

export const SPECIAL_PLAYS: SpecialPlaybook = {
  punt: PUNT,
  fakePunt: FAKE_PUNT,
  fieldGoal: FIELD_GOAL,
  fakeFieldGoal: FAKE_FIELD_GOAL,
  extraPoint: EXTRA_POINT,
  kickoff: KICKOFF,
  onside: ONSIDE,
  kickReturn: KICK_RETURN,
  puntReturn: PUNT_RETURN,
  blockKick: BLOCK_KICK,
};

/** Every offensive special-teams call, for validation and the play viewer. */
export const SPECIAL_OFFENSE: OffensePlay[] = [
  PUNT, FAKE_PUNT, FIELD_GOAL, FAKE_FIELD_GOAL, EXTRA_POINT, KICKOFF, ONSIDE,
];

/** Every defensive special-teams call. */
export const SPECIAL_DEFENSE: DefensePlay[] = [PUNT_RETURN, KICK_RETURN, BLOCK_KICK];

/** Used by the sim to pick a return call from the kick that is coming. */
export function returnFor(kick: 'PUNT' | 'KICKOFF' | 'ONSIDE' | 'FIELD_GOAL' | 'EXTRA_POINT'): DefensePlay {
  switch (kick) {
    case 'PUNT': return PUNT_RETURN;
    case 'KICKOFF': return KICK_RETURN;
    case 'ONSIDE': return BLOCK_KICK;
    case 'FIELD_GOAL': return BLOCK_KICK;
    case 'EXTRA_POINT': return BLOCK_KICK;
  }
}
