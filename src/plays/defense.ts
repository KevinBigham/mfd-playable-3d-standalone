/**
 * GRIDIRON OVERDRIVE — defensive playbook.
 *
 * 14 calls. Slots 0-8 are the page shown on the play-select wheel; slots 9-13
 * are the extended pool the AI play caller and the situational audible system
 * draw from.
 *
 * FRAME
 *   align.x / align.z and every ZONE centre are relative to the ball at the LOS,
 *   in the DEFENSE's frame: +z is downfield toward the offense's back, i.e. the
 *   direction the defence is retreating. +x is the defence's view of the
 *   offense's right, so a MAN assignment on skill slot 0 (offense's leftmost)
 *   lives at negative x. Nothing aligns closer than 0.8 yards off the ball.
 *
 * BUDGET
 *   Seven defenders against three blockers. Every rusher past the third is a
 *   receiver left uncovered somewhere — the aggression/deepHelp numbers below
 *   report that trade honestly so the AI risk model is not lying to itself.
 */

import type { DefenseAssign, DefensePlay, DefensePlayerPlan } from '../core/types.ts';
import { s } from '../core/constants.ts';

function p(x: number, z: number, assign: DefenseAssign): DefensePlayerPlan {
  return { align: { x, z }, assign };
}
const rush = (lane: number): DefenseAssign => ({ kind: 'RUSH', lane });
const contain = (side: -1 | 1): DefenseAssign => ({ kind: 'CONTAIN', side });
const man = (slot: number): DefenseAssign => ({ kind: 'MAN', slot });
const zone = (x: number, z: number, r: number): DefenseAssign => ({ kind: 'ZONE', x, z, r });
const spy = (): DefenseAssign => ({ kind: 'SPY' });
const delay = (lane: number, ticks: number): DefenseAssign =>
  ({ kind: 'BLITZ_DELAY', lane, delay: ticks });

// ── page 0 (slots 0-8) ─────────────────────────────────────────────────────

/** Press man, four rushers, nothing over the top. Dies to double moves. */
const IRON_LOCK: DefensePlay = {
  id: 'd-iron-lock',
  name: 'Iron Lock',
  slot: 0,
  formation: 'NICKEL_4',
  tags: ['MAN', 'EDGE'],
  players: [
    p(-3.2, 0.9, rush(-0.6)),
    p(-1.1, 0.9, rush(-0.2)),
    p(1.1, 0.9, rush(0.2)),
    p(3.2, 0.9, rush(0.6)),
    p(-1.5, 3.6, man(1)),
    p(-13.0, 1.7, man(0)),
    p(13.0, 1.7, man(2)),
  ],
  aggression: 0.82,
  deepHelp: 0.0,
};

/** Off man with a post safety. Gives up the hitch, takes away the shot. */
const SOFT_SHADOW: DefensePlay = {
  id: 'd-soft-shadow',
  name: 'Soft Shadow',
  slot: 1,
  formation: 'NICKEL_4',
  tags: ['MAN'],
  players: [
    p(-2.6, 0.9, rush(-0.5)),
    p(0, 0.9, rush(0)),
    p(2.6, 0.9, rush(0.5)),
    p(-1.0, 6.4, man(1)),
    p(-13.5, 7.6, man(0)),
    p(13.5, 7.6, man(2)),
    p(0, 15.0, zone(0, 22, 14)),
  ],
  aggression: 0.44,
  deepHelp: 0.52,
};

/** Two deep halves, three underneath. The seam and the deep middle are the rent. */
const SPLIT_DECK: DefensePlay = {
  id: 'd-split-deck',
  name: 'Split Deck',
  slot: 2,
  formation: 'DIME_5',
  tags: ['ZONE'],
  players: [
    p(-1.9, 0.9, rush(-0.35)),
    p(1.9, 0.9, rush(0.35)),
    p(-11.0, 6.0, zone(-14, 7, 8.5)),
    p(0, 6.0, zone(0, 9.5, 8.0)),
    p(11.0, 6.0, zone(14, 7, 8.5)),
    p(-10.5, 14.0, zone(-11, 23, 14)),
    p(10.5, 14.0, zone(11, 23, 14)),
  ],
  aggression: 0.30,
  deepHelp: 0.72,
};

/** Three deep thirds over two curl/flat defenders. Flood concepts hurt this. */
const TRIPLE_SKY: DefensePlay = {
  id: 'd-triple-sky',
  name: 'Triple Sky',
  slot: 3,
  formation: 'NICKEL_4',
  tags: ['ZONE'],
  players: [
    p(-1.8, 0.9, rush(-0.35)),
    p(1.8, 0.9, rush(0.35)),
    p(-8.5, 5.6, zone(-12, 7.5, 9)),
    p(8.5, 5.6, zone(12, 7.5, 9)),
    p(-14.5, 8.5, zone(-16, 23, 12)),
    p(14.5, 8.5, zone(16, 23, 12)),
    p(0, 13.0, zone(0, 25, 12)),
  ],
  aggression: 0.28,
  deepHelp: 0.80,
};

/** Quarters. Four over the top, one hook, two rushers. Everything short is free. */
const FOUR_ROOF: DefensePlay = {
  id: 'd-four-roof',
  name: 'Four Roof',
  slot: 4,
  formation: 'PREVENT',
  tags: ['ZONE', 'PREVENT'],
  players: [
    p(-1.7, 0.9, rush(-0.3)),
    p(1.7, 0.9, rush(0.3)),
    p(0, 8.0, zone(0, 11, 10)),
    p(-16.0, 11.0, zone(-17, 26, 12)),
    p(16.0, 11.0, zone(17, 26, 12)),
    p(-8.0, 19.5, zone(-6, 28, 12)),
    p(8.0, 19.5, zone(6, 28, 12)),
  ],
  aggression: 0.18,
  deepHelp: 0.95,
};

/** Man to the field, zone to the boundary. Reads like man until it isn't. */
const HALF_AND_HALF: DefensePlay = {
  id: 'd-half-and-half',
  name: 'Half And Half',
  slot: 5,
  formation: 'NICKEL_4',
  tags: ['MIXED'],
  players: [
    p(-3.2, 0.9, rush(-0.6)),
    p(-1.1, 0.9, rush(-0.2)),
    p(1.1, 0.9, rush(0.2)),
    p(1.5, 5.4, man(1)),
    p(13.0, 5.0, man(2)),
    p(-13.5, 7.5, zone(-16, 14, 11)),
    p(-4.0, 14.5, zone(-6, 24, 13)),
  ],
  aggression: 0.52,
  deepHelp: 0.44,
};

/** A linebacker mirrors the quarterback. Rollouts and scrambles go nowhere. */
const MIRROR_WATCH: DefensePlay = {
  id: 'd-mirror-watch',
  name: 'Mirror Watch',
  slot: 6,
  formation: 'NICKEL_4',
  tags: ['SPY', 'MAN'],
  players: [
    p(-2.6, 0.9, rush(-0.5)),
    p(2.6, 0.9, rush(0.5)),
    p(0, 4.2, spy()),
    p(-5.5, 6.6, man(1)),
    p(-13.0, 6.2, man(0)),
    p(13.0, 6.2, man(2)),
    p(0.5, 15.5, zone(0, 24, 14)),
  ],
  aggression: 0.40,
  deepHelp: 0.50,
};

/** Both edges come hard off the corners. Straight man behind it, no help. */
const CORNER_STORM: DefensePlay = {
  id: 'd-corner-storm',
  name: 'Corner Storm',
  slot: 7,
  formation: 'EDGE_HEAVY',
  tags: ['EDGE', 'MAN'],
  players: [
    p(-5.2, 0.9, rush(-0.95)),
    p(-2.0, 0.9, rush(-0.25)),
    p(2.0, 0.9, rush(0.25)),
    p(5.2, 0.9, rush(0.95)),
    p(-0.8, 4.8, man(1)),
    p(-12.5, 4.6, man(0)),
    p(12.5, 4.6, man(2)),
  ],
  aggression: 0.78,
  deepHelp: 0.05,
};

/** Three heavies inside plus a late A-gap runner, three-deep zone behind. */
const GUT_PUNCH: DefensePlay = {
  id: 'd-gut-punch',
  name: 'Gut Punch',
  slot: 8,
  formation: 'BEAR_3',
  tags: ['INTERIOR', 'ZONE'],
  players: [
    p(-2.6, 0.9, rush(-0.35)),
    p(0, 0.9, rush(0)),
    p(2.6, 0.9, rush(0.35)),
    p(-5.0, 3.8, delay(-0.1, s(0.32))),
    p(-14.0, 6.8, zone(-16, 17, 12)),
    p(14.0, 6.8, zone(16, 17, 12)),
    p(0.5, 12.0, zone(0, 24, 14)),
  ],
  aggression: 0.70,
  deepHelp: 0.55,
};

// ── extended pool (slots 9-13) ─────────────────────────────────────────────

/** Both edges set the fence instead of rushing. The answer to a rollout. */
const BOTTLE_CAP: DefensePlay = {
  id: 'd-bottle-cap',
  name: 'Bottle Cap',
  slot: 9,
  formation: 'NICKEL_4',
  tags: ['CONTAIN'],
  players: [
    p(-4.8, 0.9, contain(-1)),
    p(4.8, 0.9, contain(1)),
    p(-1.4, 0.9, rush(-0.2)),
    p(1.4, 0.9, rush(0.2)),
    p(0, 5.4, zone(0, 9, 9.5)),
    p(-13.0, 7.0, man(0)),
    p(13.0, 7.0, man(2)),
  ],
  aggression: 0.50,
  deepHelp: 0.18,
};

/** Edges come, an interior lineman drops into the hook. Bait for a quick read. */
const SWAP_FIRE: DefensePlay = {
  id: 'd-swap-fire',
  name: 'Swap Fire',
  slot: 10,
  formation: 'EDGE_HEAVY',
  tags: ['ZONE', 'EDGE'],
  players: [
    p(-5.0, 0.9, rush(-0.9)),
    p(-1.6, 0.9, rush(-0.2)),
    p(1.6, 0.9, zone(2.5, 8, 9)),
    p(5.0, 0.9, rush(0.9)),
    p(0, 4.6, delay(0.15, s(0.28))),
    p(-11.0, 7.0, zone(-11, 22, 14)),
    p(11.0, 7.0, zone(11, 22, 14)),
  ],
  aggression: 0.68,
  deepHelp: 0.48,
};

/** Five at the quarterback. The middle receiver is on his own — that is the deal. */
const FULL_SEND: DefensePlay = {
  id: 'd-full-send',
  name: 'Full Send',
  slot: 11,
  formation: 'EDGE_HEAVY',
  tags: ['ALLOUT', 'EDGE'],
  players: [
    p(-5.2, 0.9, rush(-0.95)),
    p(-2.0, 0.9, rush(-0.3)),
    p(2.0, 0.9, rush(0.3)),
    p(5.2, 0.9, rush(0.95)),
    p(0, 3.8, delay(0, s(0.18))),
    p(-12.0, 2.0, man(0)),
    p(12.0, 2.0, man(2)),
  ],
  aggression: 1.0,
  deepHelp: 0.0,
};

/** Everything inside the five. Nothing gets in on the ground; play action kills it. */
const GOAL_WALL: DefensePlay = {
  id: 'd-goal-wall',
  name: 'Goal Wall',
  slot: 12,
  formation: 'GOALLINE_D',
  tags: ['GOALLINE', 'MAN'],
  players: [
    p(-3.0, 0.9, rush(-0.55)),
    p(-1.0, 0.9, rush(-0.18)),
    p(1.0, 0.9, rush(0.18)),
    p(3.0, 0.9, rush(0.55)),
    p(-6.4, 2.6, man(0)),
    p(6.4, 2.6, man(2)),
    p(0, 4.6, man(1)),
  ],
  aggression: 0.75,
  deepHelp: 0.05,
};

/** Bail everybody. No touchdowns, no big plays, set up the return. */
const VAULT: DefensePlay = {
  id: 'd-vault',
  name: 'Vault',
  slot: 13,
  formation: 'PREVENT',
  tags: ['PREVENT', 'ZONE', 'SPECIAL'],
  players: [
    p(-1.7, 0.9, rush(-0.3)),
    p(1.7, 0.9, rush(0.3)),
    p(0, 9.0, zone(0, 13, 11)),
    p(-16.0, 12.0, zone(-18, 30, 13)),
    p(16.0, 12.0, zone(18, 30, 13)),
    p(-7.0, 21.0, zone(-6, 34, 14)),
    p(7.0, 21.0, zone(6, 34, 14)),
  ],
  aggression: 0.12,
  deepHelp: 1.0,
};

export const DEFENSE_PLAYS: DefensePlay[] = [
  IRON_LOCK,
  SOFT_SHADOW,
  SPLIT_DECK,
  TRIPLE_SKY,
  FOUR_ROOF,
  HALF_AND_HALF,
  MIRROR_WATCH,
  CORNER_STORM,
  GUT_PUNCH,
  BOTTLE_CAP,
  SWAP_FIRE,
  FULL_SEND,
  GOAL_WALL,
  VAULT,
];

/** The nine calls shown on the defensive play-select wheel. */
export const DEFENSE_PAGE: DefensePlay[] = DEFENSE_PLAYS.slice(0, 9);
