/**
 * GRIDIRON OVERDRIVE — formation library.
 *
 * Pure data. No `three`, no DOM, no RNG. See ARCHITECTURE.md §0.
 *
 * ALIGNMENT FRAME
 *   Origin is the ball, sitting on the line of scrimmage.
 *   +x = the OFFENSE's right hand.   +z = DOWNFIELD for the offense.
 *   The sim maps this to world space with dirOf(side): HOME multiplies by +1,
 *   AWAY by -1, so a play never has to know which end zone it is attacking.
 *
 * SPACING NOTE
 *   This is 7-on-7 on a full-width field with a 30-yard first down. Splits are
 *   compressed relative to real football so that three receivers still stress
 *   the whole width, and depth is compressed because athletes cover ground
 *   roughly 1.4x faster than real players.
 */

import type { OffenseRole } from '../core/types.ts';

// ── frame constants ────────────────────────────────────────────────────────

/** Offensive line depth off the ball. */
export const LINE_Z = -0.6;
/** QB depth under centre. */
export const QB_UNDER_Z = -1.6;
/** QB depth in the gun. */
export const QB_GUN_Z = -5.0;
/** Widest legal alignment for a skill player (keeps everyone inbounds). */
export const MAX_SPLIT_X = 22;
/** Minimum defensive depth off the ball. */
export const DEF_MIN_Z = 0.8;

export type DefenseRole = 'DL' | 'LB' | 'CB' | 'S';

export interface FormationSlot {
  role: OffenseRole;
  align: { x: number; z: number };
}

export interface Formation {
  name: string;
  slots: FormationSlot[]; // exactly 7
}

export interface DefFormationSlot {
  role: DefenseRole;
  align: { x: number; z: number };
}

export interface DefFormation {
  name: string;
  slots: DefFormationSlot[]; // exactly 7
}

// ── builders ───────────────────────────────────────────────────────────────

function o(role: OffenseRole, x: number, z: number): FormationSlot {
  return { role, align: { x, z } };
}
function d(role: DefenseRole, x: number, z: number): DefFormationSlot {
  return { role, align: { x, z } };
}

/** Three interior linemen at `spread` yards of guard split. */
function trio(spread: number): FormationSlot[] {
  return [o('LINE', -spread, LINE_Z), o('LINE', 0, LINE_Z), o('LINE', spread, LINE_Z)];
}

// ── offensive formations ───────────────────────────────────────────────────
//
// Every formation is 1 QB + 3 LINE + 3 skill. The three skill players are the
// only pass targets; their PRE-SNAP x ordering decides which button they answer
// to (leftmost = 0, middle = 1, rightmost = 2), so no two share an x value.

/** Balanced under-centre look: back, tight slot left, split end right. */
export const PRO_SET: Formation = {
  name: 'PRO_SET',
  slots: [
    o('QB', 0, QB_UNDER_Z),
    ...trio(2.2),
    o('SLOT', -8.0, -0.4),
    o('BACK', -2.6, -4.4),
    o('WIDE', 16.5, 0),
  ],
};

/** Two receivers right, one isolated left, quarterback under centre. */
export const SPREAD: Formation = {
  name: 'SPREAD',
  slots: [
    o('QB', 0, QB_UNDER_Z),
    ...trio(2.4),
    o('WIDE', -18.0, 0),
    o('SLOT', 8.5, -0.4),
    o('WIDE', 18.5, 0),
  ],
};

/** Three-receiver overload to the right out of the gun. */
export const TRIPS_RIGHT: Formation = {
  name: 'TRIPS_RIGHT',
  slots: [
    o('QB', 0, QB_GUN_Z),
    ...trio(2.3),
    o('SLOT', 5.5, -0.5),
    o('SLOT', 11.5, -0.3),
    o('WIDE', 18.5, 0),
  ],
};

/** Three-receiver overload to the left out of the gun. */
export const TRIPS_LEFT: Formation = {
  name: 'TRIPS_LEFT',
  slots: [
    o('QB', 0, QB_GUN_Z),
    ...trio(2.3),
    o('WIDE', -18.5, 0),
    o('SLOT', -11.5, -0.3),
    o('SLOT', -5.5, -0.5),
  ],
};

/** One-back gun with balanced split ends — the workhorse passing set. */
export const SHOTGUN_SPREAD: Formation = {
  name: 'SHOTGUN_SPREAD',
  slots: [
    o('QB', 0, QB_GUN_Z),
    ...trio(2.3),
    o('WIDE', -18.5, 0),
    o('BACK', 2.8, -4.6),
    o('WIDE', 18.5, 0),
  ],
};

/** Downhill two-back set with an attached tight end. */
export const I_HEAVY: Formation = {
  name: 'I_HEAVY',
  slots: [
    o('QB', 0, QB_UNDER_Z),
    ...trio(1.9),
    o('BACK', -0.7, -3.3),
    o('BACK', 0.6, -6.0),
    o('SLOT', 4.0, -0.3),
  ],
};

/** No backfield help — everyone is a route. Gun snap. */
export const EMPTY: Formation = {
  name: 'EMPTY',
  slots: [
    o('QB', 0, QB_GUN_Z),
    ...trio(2.3),
    o('WIDE', -19.5, 0),
    o('SLOT', -10.0, -0.3),
    o('WIDE', 18.0, 0),
  ],
};

/** Compressed short-yardage set: two tights and a back. */
export const GOALLINE: Formation = {
  name: 'GOALLINE',
  slots: [
    o('QB', 0, QB_UNDER_Z),
    ...trio(1.4),
    o('SLOT', -3.2, -0.2),
    o('BACK', -0.5, -3.6),
    o('SLOT', 3.2, -0.2),
  ],
};

/** Two backs beside the quarterback — the misdirection chassis. */
export const SPLIT_BACKS: Formation = {
  name: 'SPLIT_BACKS',
  slots: [
    o('QB', 0, QB_UNDER_Z),
    ...trio(2.2),
    o('BACK', -3.4, -3.9),
    o('BACK', 3.4, -3.9),
    o('WIDE', 17.5, 0),
  ],
};

export const OFFENSE_FORMATIONS: Record<string, Formation> = {
  PRO_SET,
  SPREAD,
  TRIPS_RIGHT,
  TRIPS_LEFT,
  SHOTGUN_SPREAD,
  I_HEAVY,
  EMPTY,
  GOALLINE,
  SPLIT_BACKS,
};

// ── defensive formations ───────────────────────────────────────────────────
//
// Seven defenders. Nothing aligns closer than DEF_MIN_Z off the ball.

/** Four-man front, one linebacker, two corners. The default. */
export const NICKEL_4: DefFormation = {
  name: 'NICKEL_4',
  slots: [
    d('DL', -3.2, 0.9),
    d('DL', -1.1, 0.9),
    d('DL', 1.1, 0.9),
    d('DL', 3.2, 0.9),
    d('LB', 0, 5.2),
    d('CB', -13.0, 6.5),
    d('CB', 13.0, 6.5),
  ],
};

/** Two rushers, five in coverage, one deep middle. Passing-down look. */
export const DIME_5: DefFormation = {
  name: 'DIME_5',
  slots: [
    d('DL', -1.9, 0.9),
    d('DL', 1.9, 0.9),
    d('LB', -6.2, 5.4),
    d('LB', 6.2, 5.4),
    d('CB', -15.0, 7.0),
    d('CB', 15.0, 7.0),
    d('S', 0, 13.5),
  ],
};

/** Three interior heavies, two plugging linebackers, corner and post safety. */
export const BEAR_3: DefFormation = {
  name: 'BEAR_3',
  slots: [
    d('DL', -2.6, 0.9),
    d('DL', 0, 0.9),
    d('DL', 2.6, 0.9),
    d('LB', -5.6, 3.6),
    d('LB', 5.6, 3.6),
    d('CB', -14.0, 5.8),
    d('S', 1.5, 12.0),
  ],
};

/** Everything crowded inside the five. */
export const GOALLINE_D: DefFormation = {
  name: 'GOALLINE_D',
  slots: [
    d('DL', -3.0, 0.9),
    d('DL', -1.0, 0.9),
    d('DL', 1.0, 0.9),
    d('DL', 3.0, 0.9),
    d('LB', -6.4, 2.6),
    d('LB', 6.4, 2.6),
    d('S', 0, 4.6),
  ],
};

/** Two rushers, everybody else bailing. Kill-the-clock shell. */
export const PREVENT: DefFormation = {
  name: 'PREVENT',
  slots: [
    d('DL', -1.7, 0.9),
    d('DL', 1.7, 0.9),
    d('LB', 0, 7.5),
    d('CB', -16.0, 11.0),
    d('CB', 16.0, 11.0),
    d('S', -8.0, 19.5),
    d('S', 8.0, 19.5),
  ],
};

/** Wide rushers outside the tackle box — squeeze the pocket from the corners. */
export const EDGE_HEAVY: DefFormation = {
  name: 'EDGE_HEAVY',
  slots: [
    d('DL', -5.2, 0.9),
    d('DL', -2.0, 0.9),
    d('DL', 2.0, 0.9),
    d('DL', 5.2, 0.9),
    d('LB', 0, 4.4),
    d('CB', -12.5, 6.2),
    d('CB', 12.5, 6.2),
  ],
};

export const DEFENSE_FORMATIONS: Record<string, DefFormation> = {
  NICKEL_4,
  DIME_5,
  BEAR_3,
  GOALLINE_D,
  PREVENT,
  EDGE_HEAVY,
};

// ── lookups ────────────────────────────────────────────────────────────────

export function getOffenseFormation(name: string): Formation {
  return OFFENSE_FORMATIONS[name] ?? PRO_SET;
}

export function getDefenseFormation(name: string): DefFormation {
  return DEFENSE_FORMATIONS[name] ?? NICKEL_4;
}

/** The three pass-eligible slots of a formation, sorted leftmost → rightmost. */
export function skillSlots(f: Formation): FormationSlot[] {
  return f.slots.filter((sl) => sl.role !== 'QB' && sl.role !== 'LINE')
    .slice()
    .sort((a, b) => a.align.x - b.align.x);
}

/** Formation name after a left/right flip. */
export function mirrorFormationName(name: string): string {
  if (name === 'TRIPS_RIGHT') return 'TRIPS_LEFT';
  if (name === 'TRIPS_LEFT') return 'TRIPS_RIGHT';
  return name;
}
