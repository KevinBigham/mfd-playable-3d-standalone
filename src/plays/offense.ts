/**
 * GRIDIRON OVERDRIVE — offensive playbook. 27 calls, three pages of nine.
 *
 * READING THE PLAYS
 *   `players` is always ordered [QB, LINE, LINE, LINE, skill, skill, skill], so
 *   `reads` always points at index 4, 5 or 6. Target buttons are never written
 *   by hand — assignTargetsByX() stamps them from pre-snap alignment so button 0
 *   is the leftmost eligible, 1 the middle, 2 the rightmost, every single play.
 *
 *   `timing.primary` is the tick the first read should come open, `timing.secondary`
 *   the tick the second one does. Both are measured from the snap and are tuned to
 *   actual route depth: about 0.55 s of snap-and-set plus depth / 11 yd-per-second
 *   of effective closing speed.
 *
 * CONCEPT NOTES
 *   Each play carries a one-line note saying which of the calls in defense.ts it
 *   is built to punish. A flood is only a flood if it actually puts a zone
 *   defender in conflict; a mesh is only a mesh if the crossers rub.
 */

import type { OffensePlay, OffensePlayerPlan, PlayTag, RouteNode } from '../core/types.ts';
import { s } from '../core/constants.ts';
import { getOffenseFormation } from './formations.ts';
import {
  assignTargetsByX, block, carry, comeback, corner, cross, dig, drag, flat, go,
  hitch, leak, option, out, post, screen, seam, slant, swing, wheel, type Side,
} from './routes.ts';

// ── authoring helpers ──────────────────────────────────────────────────────

function n(x: number, z: number, action: RouteNode['action'], hold?: number): RouteNode {
  return hold === undefined ? { x, z, action } : { x, z, action, hold };
}

interface SlotSpec {
  route: RouteNode[];
  /** Alignment tweak off the formation default, in yards. */
  dx?: number;
  dz?: number;
  blockDir?: -1 | 0 | 1;
}

/** Build 7 plans from a formation plus per-slot routes, then stamp targets. */
function mk(formation: string, specs: SlotSpec[]): OffensePlayerPlan[] {
  const f = getOffenseFormation(formation);
  const players: OffensePlayerPlan[] = f.slots.map((sl, i) => {
    const sp = specs[i];
    const plan: OffensePlayerPlan = {
      role: sl.role,
      align: { x: sl.align.x + (sp.dx ?? 0), z: sl.align.z + (sp.dz ?? 0) },
      route: sp.route,
      target: null,
    };
    if (sl.role === 'LINE') plan.blockDir = sp.blockDir ?? 0;
    else if (sp.blockDir !== undefined) plan.blockDir = sp.blockDir;
    return plan;
  });
  return assignTargetsByX(players);
}

interface PlaySpec {
  id: string;
  name: string;
  page: 0 | 1 | 2;
  slot: number;
  formation: string;
  tags: PlayTag[];
  players: OffensePlayerPlan[];
  primary: number;
  secondary: number;
  reads: [number, number];
  shortYardage: number;
  deepShot: number;
}

function play(p: PlaySpec): OffensePlay {
  return {
    id: p.id,
    name: p.name,
    page: p.page,
    slot: p.slot,
    formation: p.formation,
    tags: p.tags,
    players: p.players,
    timing: { primary: p.primary, secondary: p.secondary },
    reads: p.reads,
    shortYardage: p.shortYardage,
    deepShot: p.deepShot,
  };
}

// Quarterback paths.
const dropUnder = (): RouteNode[] => [n(0, -1.8, 'RUN'), n(-0.3, -3.6, 'SETTLE', s(3.0))];
const dropDeep = (): RouteNode[] => [n(0, -2.2, 'RUN'), n(-0.4, -4.6, 'SETTLE', s(3.2))];
const dropGun = (hold = 3.0): RouteNode[] => [n(0, -0.8, 'RUN'), n(0.3, -1.7, 'SETTLE', s(hold))];
const rollOut = (dir: Side): RouteNode[] =>
  [n(dir * 3.0, -2.4, 'RUN'), n(dir * 8.5, -3.0, 'SPEED'), n(dir * 13.0, -1.6, 'SETTLE', s(2.2))];
/** Hand it off and carry out the fake away from the run. */
const fakeAway = (dir: Side): RouteNode[] =>
  [n(dir * 1.1, -1.1, 'RUN'), n(dir * 2.8, -2.5, 'SETTLE', s(2.1))];

/** Lead blocker: step to the hole and wall it off. */
const lead = (dx: number, dz: number): RouteNode[] =>
  [n(dx * 0.45, dz * 0.3 - 0.9, 'RUN'), n(dx, dz, 'BLOCK', s(2.0))];
/** Receiver stalk block on the perimeter. */
const stalk = (dx: number, dz: number): RouteNode[] =>
  [n(dx * 0.4, dz * 0.5, 'RUN'), n(dx, dz, 'BLOCK', s(2.2))];
/** Lineman who pulls out in front of a screen. */
const pull = (dir: Side): RouteNode[] => [
  n(dir * 1.1, 0.4, 'BLOCK', s(0.3)),
  n(dir * 5.0, 0.1, 'RUN'),
  n(dir * 9.0, 2.0, 'BLOCK', s(1.5)),
];

const B0 = block(0);
const BL = block(-1);
const BR = block(1);

// ═══════════════════════════════════════════════════════ PAGE 0 — base

/** Downhill dive behind a lead blocker. The 3rd-and-1 button. */
const ANVIL_DIVE = play({
  id: 'o-anvil-dive', name: 'Anvil Dive', page: 0, slot: 0,
  formation: 'I_HEAVY', tags: ['RUN', 'GOALLINE'],
  players: mk('I_HEAVY', [
    { route: [n(0, -1.0, 'RUN'), n(-1.8, -2.4, 'SETTLE', s(2.0))] },
    { route: BL, blockDir: -1 }, { route: B0, blockDir: 0 }, { route: BR, blockDir: 1 },
    { route: lead(1.2, 1.8) },
    { route: [n(0.9, -1.4, 'CARRY'), n(1.6, 1.2, 'RUN'), n(2.4, 11, 'SPEED')] },
    { route: block(1) },
  ]),
  primary: s(0.8), secondary: s(1.4), reads: [5, 4],
  shortYardage: 0.95, deepShot: 0.02,
});

/** Reach the edge and outrun the pursuit. Punishes interior-heavy fronts. */
const SIDEWINDER_SWEEP = play({
  id: 'o-sidewinder-sweep', name: 'Sidewinder Sweep', page: 0, slot: 1,
  formation: 'SPLIT_BACKS', tags: ['RUN'],
  players: mk('SPLIT_BACKS', [
    { route: [n(-0.8, -1.2, 'RUN'), n(-3.0, -2.6, 'SETTLE', s(2.0))] },
    { route: BR, blockDir: 1 }, { route: BR, blockDir: 1 }, { route: BR, blockDir: 1 },
    { route: [n(2.0, -1.4, 'RUN'), n(7.5, 0.6, 'BLOCK', s(1.8))] },
    { route: carry(1, 12) },
    { route: stalk(-1.4, 4.5) },
  ]),
  primary: s(0.85), secondary: s(1.5), reads: [5, 4],
  shortYardage: 0.55, deepShot: 0.03,
});

/** Slant / slant / flat. The three-step answer to Iron Lock and Full Send. */
const QUICK_NAILS = play({
  id: 'o-quick-nails', name: 'Quick Nails', page: 0, slot: 2,
  formation: 'SPREAD', tags: ['QUICK'],
  players: mk('SPREAD', [
    { route: [n(0, -1.4, 'RUN'), n(0, -2.3, 'SETTLE', s(2.2))] },
    { route: B0 }, { route: B0 }, { route: B0 },
    { route: slant(1, 3) },
    { route: flat(1, 2) },
    { route: slant(-1, 3) },
  ]),
  primary: s(1.15), secondary: s(1.6), reads: [6, 4],
  shortYardage: 0.50, deepShot: 0.05,
});

/** Full quick menu from trips: slant inside, hitch, comeback. Beats soft man. */
const SNAP_HITCH = play({
  id: 'o-snap-hitch', name: 'Snap Hitch', page: 0, slot: 3,
  formation: 'TRIPS_RIGHT', tags: ['QUICK', 'SHOTGUN'],
  players: mk('TRIPS_RIGHT', [
    { route: dropGun(2.4) },
    { route: B0 }, { route: B0 }, { route: B0 },
    { route: slant(-1, 3) },
    { route: hitch(8) },
    { route: comeback(1, 13) },
  ]),
  primary: s(1.25), secondary: s(1.7), reads: [5, 4],
  shortYardage: 0.45, deepShot: 0.06,
});

/** Mesh: two shallows rub at the midline while the back runs the wheel. Man dies. */
const RIPCORD_MESH = play({
  id: 'o-ripcord-mesh', name: 'Ripcord Mesh', page: 0, slot: 4,
  formation: 'SHOTGUN_SPREAD', tags: ['CROSS', 'SHOTGUN'],
  players: mk('SHOTGUN_SPREAD', [
    { route: dropGun() },
    { route: B0 }, { route: B0 }, { route: B0 },
    { route: drag(1, 3) },
    { route: wheel(1, 22) },
    { route: drag(-1, 4.6) },
  ]),
  primary: s(1.5), secondary: s(2.0), reads: [4, 6],
  shortYardage: 0.40, deepShot: 0.15,
});

/** Three levels right: go, corner, flat. Triple Sky's curl/flat man cannot have both. */
const TOWER_FLOOD = play({
  id: 'o-tower-flood', name: 'Tower Flood', page: 0, slot: 5,
  formation: 'TRIPS_RIGHT', tags: ['FLOOD', 'SHOTGUN'],
  players: mk('TRIPS_RIGHT', [
    { route: dropGun() },
    { route: B0 }, { route: B0 }, { route: B0 },
    { route: flat(1, 2) },
    { route: corner(1, 11) },
    { route: go(32) },
  ]),
  primary: s(2.15), secondary: s(2.65), reads: [5, 4],
  shortYardage: 0.10, deepShot: 0.45,
});

/** Three verticals from empty. The seam splits Triple Sky's third and post. */
const FOUR_ALARM = play({
  id: 'o-four-alarm', name: 'Four Alarm', page: 0, slot: 6,
  formation: 'EMPTY', tags: ['DEEP', 'SHOTGUN'],
  players: mk('EMPTY', [
    { route: dropGun(2.6) },
    { route: B0 }, { route: B0 }, { route: B0 },
    { route: go(33) },
    { route: seam(30, 4) },
    { route: go(33) },
  ]),
  primary: s(2.6), secondary: s(3.0), reads: [5, 6],
  shortYardage: 0.02, deepShot: 0.95,
});

/** Open one way, run the other, backside crosser as the bail-out. */
const GHOST_COUNTER = play({
  id: 'o-ghost-counter', name: 'Ghost Counter', page: 0, slot: 7,
  formation: 'SPLIT_BACKS', tags: ['RUN', 'MISDIRECT'],
  players: mk('SPLIT_BACKS', [
    { route: fakeAway(1) },
    { route: BL, blockDir: -1 }, { route: BL, blockDir: -1 }, { route: B0 },
    {
      route: [
        n(1.6, -1.0, 'RUN'), n(-1.0, -1.7, 'CARRY'),
        n(-5.5, 1.4, 'SPEED'), n(-8.0, 10, 'SPEED'),
      ],
    },
    { route: [n(-2.0, -0.8, 'RUN'), n(-6.0, 0.8, 'BLOCK', s(1.8))] },
    { route: drag(-1, 4) },
  ]),
  primary: s(1.0), secondary: s(1.8), reads: [4, 6],
  shortYardage: 0.60, deepShot: 0.05,
});

/** Let the rush come, then throw behind it with a lineman out front. */
const LADDER_SCREEN = play({
  id: 'o-ladder-screen', name: 'Ladder Screen', page: 0, slot: 8,
  formation: 'SHOTGUN_SPREAD', tags: ['SCREEN', 'SHOTGUN'],
  players: mk('SHOTGUN_SPREAD', [
    { route: [n(0, -1.0, 'RUN'), n(1.2, -2.4, 'SETTLE', s(2.6))] },
    { route: pull(-1), blockDir: -1 }, { route: B0 }, { route: BR, blockDir: 1 },
    { route: stalk(2.4, 6.0) },
    { route: screen(-1) },
    { route: drag(-1, 5) },
  ]),
  primary: s(1.6), secondary: s(2.2), reads: [5, 6],
  shortYardage: 0.25, deepShot: 0.05,
});

// ═══════════════════════════════════════════════════════ PAGE 1 — attack

/** Fullback on the linebacker, tailback in the crease behind him. */
const HAMMER_ISO = play({
  id: 'o-hammer-iso', name: 'Hammer Iso', page: 1, slot: 0,
  formation: 'I_HEAVY', tags: ['RUN'],
  players: mk('I_HEAVY', [
    { route: [n(0, -1.0, 'RUN'), n(-2.2, -2.4, 'SETTLE', s(2.0))] },
    { route: BL, blockDir: -1 }, { route: B0 }, { route: B0 },
    { route: lead(-1.8, 2.0) },
    { route: carry(-1, 12) },
    { route: block(1) },
  ]),
  primary: s(0.9), secondary: s(1.5), reads: [5, 4],
  shortYardage: 0.90, deepShot: 0.02,
});

/** Sell the drop, hand it late. Aimed straight at Corner Storm and Full Send. */
const ANCHOR_DRAW = play({
  id: 'o-anchor-draw', name: 'Anchor Draw', page: 1, slot: 1,
  formation: 'SHOTGUN_SPREAD', tags: ['RUN', 'MISDIRECT', 'SHOTGUN'],
  players: mk('SHOTGUN_SPREAD', [
    { route: [n(0, -1.6, 'RUN'), n(-0.6, -2.7, 'SETTLE', s(1.4))] },
    { route: B0 }, { route: B0 }, { route: B0 },
    { route: go(28) },
    {
      route: [
        n(-0.6, -0.6, 'RUN', s(0.3)), n(-1.6, -2.2, 'CARRY'),
        n(-2.4, 2.0, 'SPEED'), n(-1.0, 12, 'SPEED'),
      ],
    },
    { route: go(28) },
  ]),
  primary: s(1.3), secondary: s(2.0), reads: [5, 4],
  shortYardage: 0.55, deepShot: 0.06,
});

/** Stick: inside man sits at 6 facing out, flat under, go over the top. */
const STICK_TRIGGER = play({
  id: 'o-stick-trigger', name: 'Stick Trigger', page: 1, slot: 2,
  formation: 'TRIPS_LEFT', tags: ['QUICK', 'SHOTGUN'],
  players: mk('TRIPS_LEFT', [
    { route: dropGun(2.4) },
    { route: B0 }, { route: B0 }, { route: B0 },
    { route: go(30) },
    { route: flat(-1, 2) },
    { route: hitch(6.5) },
  ]),
  primary: s(1.2), secondary: s(1.55), reads: [6, 5],
  shortYardage: 0.50, deepShot: 0.08,
});

/** Sail to the boundary — deep, out, swing. Same conflict, other hash. */
const BOUNDARY_FLOOD = play({
  id: 'o-boundary-flood', name: 'Boundary Flood', page: 1, slot: 3,
  formation: 'TRIPS_LEFT', tags: ['FLOOD', 'SHOTGUN'],
  players: mk('TRIPS_LEFT', [
    { route: dropGun() },
    { route: B0 }, { route: B0 }, { route: B0 },
    { route: go(31) },
    { route: out(-1, 10) },
    { route: swing(-1) },
  ]),
  primary: s(1.85), secondary: s(2.3), reads: [5, 6],
  shortYardage: 0.15, deepShot: 0.30,
});

/** Post over the top of the dig. Two-deep shells have to pick one. */
const DEEP_MINE = play({
  id: 'o-deep-mine', name: 'Deep Mine', page: 1, slot: 4,
  formation: 'PRO_SET', tags: ['DEEP', 'CROSS'],
  players: mk('PRO_SET', [
    { route: dropDeep() },
    { route: B0 }, { route: B0 }, { route: B0 },
    { route: post(1, 14) },
    { route: leak(1, 10) },
    { route: dig(-1, 15) },
  ]),
  primary: s(2.5), secondary: s(2.95), reads: [4, 6],
  shortYardage: 0.05, deepShot: 0.80,
});

/** Fake, boot away, crosser runs with you. Mirror Watch is the only real answer. */
const BOOTLEG_RIPCORD = play({
  id: 'o-bootleg-ripcord', name: 'Bootleg Ripcord', page: 1, slot: 5,
  formation: 'PRO_SET', tags: ['ROLLOUT', 'MISDIRECT'],
  players: mk('PRO_SET', [
    { route: [n(-1.4, -1.4, 'RUN'), n(4.0, -2.8, 'SPEED'), n(11.0, -1.4, 'SETTLE', s(2.2))] },
    { route: BL, blockDir: -1 }, { route: BL, blockDir: -1 }, { route: BR, blockDir: 1 },
    { route: drag(1, 4) },
    { route: [n(0.6, -0.4, 'RUN'), n(-3.0, 0.6, 'BLOCK', s(1.6))] },
    { route: comeback(1, 14) },
  ]),
  primary: s(1.9), secondary: s(2.4), reads: [4, 6],
  shortYardage: 0.20, deepShot: 0.30,
});

/** Sprint right, throw on the move. Cuts the field in half against zone. */
const SPRINT_CANNON = play({
  id: 'o-sprint-cannon', name: 'Sprint Cannon', page: 1, slot: 6,
  formation: 'SPREAD', tags: ['ROLLOUT', 'QUICK'],
  players: mk('SPREAD', [
    { route: rollOut(1) },
    { route: BR, blockDir: 1 }, { route: BR, blockDir: 1 }, { route: BR, blockDir: 1 },
    { route: drag(1, 5) },
    { route: flat(1, 3) },
    { route: comeback(1, 12) },
  ]),
  primary: s(1.45), secondary: s(1.95), reads: [5, 6],
  shortYardage: 0.35, deepShot: 0.12,
});

/** Two deep crossers over one shallow. Three defenders end up chasing hips. */
const GRINDER_MESH = play({
  id: 'o-grinder-mesh', name: 'Grinder Mesh', page: 1, slot: 7,
  formation: 'EMPTY', tags: ['CROSS', 'SHOTGUN'],
  players: mk('EMPTY', [
    { route: dropGun() },
    { route: B0 }, { route: B0 }, { route: B0 },
    { route: cross(1, 7) },
    { route: drag(1, 3) },
    { route: cross(-1, 6) },
  ]),
  primary: s(1.6), secondary: s(2.15), reads: [5, 4],
  shortYardage: 0.30, deepShot: 0.20,
});

/** Outside man works back inside behind two blockers and a pulling lineman. */
const TUNNEL_SWEEP = play({
  id: 'o-tunnel-sweep', name: 'Tunnel Sweep', page: 1, slot: 8,
  formation: 'TRIPS_RIGHT', tags: ['SCREEN', 'SHOTGUN'],
  players: mk('TRIPS_RIGHT', [
    { route: [n(0, -0.9, 'RUN'), n(-1.2, -2.2, 'SETTLE', s(2.2))] },
    { route: BL, blockDir: -1 }, { route: B0 }, { route: pull(1), blockDir: 1 },
    { route: [n(3.5, 0.6, 'RUN'), n(7.0, 2.4, 'BLOCK', s(2.0))] },
    { route: [n(1.5, 2.0, 'RUN'), n(3.0, 4.0, 'BLOCK', s(2.0))] },
    {
      route: [
        n(-3.0, -1.0, 'RUN'), n(-6.5, -1.8, 'SETTLE', s(0.35)),
        n(-9.0, 3.0, 'SPEED'), n(-11.0, 12, 'SPEED'),
      ],
    },
  ]),
  primary: s(1.35), secondary: s(1.9), reads: [6, 4],
  shortYardage: 0.20, deepShot: 0.05,
});

// ═══════════════════════════════════════════════════════ PAGE 2 — situational

/** Everybody down-blocks, back follows the wedge. Goal Wall's actual test. */
const IRON_WEDGE = play({
  id: 'o-iron-wedge', name: 'Iron Wedge', page: 2, slot: 0,
  formation: 'GOALLINE', tags: ['RUN', 'GOALLINE'],
  players: mk('GOALLINE', [
    { route: [n(0, -0.8, 'RUN'), n(-1.6, -2.0, 'SETTLE', s(1.6))] },
    { route: B0 }, { route: B0 }, { route: B0 },
    { route: block(-1) },
    { route: [n(0.2, -1.4, 'CARRY'), n(0.6, 1.2, 'SPEED'), n(1.0, 6, 'SPEED')] },
    { route: block(1) },
  ]),
  primary: s(0.75), secondary: s(1.2), reads: [5, 6],
  shortYardage: 1.0, deepShot: 0.0,
});

/** Arrow to the pylon, slant across the face, back leaks late. Tight-window stuff. */
const PYLON_DART = play({
  id: 'o-pylon-dart', name: 'Pylon Dart', page: 2, slot: 1,
  formation: 'GOALLINE', tags: ['QUICK', 'GOALLINE'],
  players: mk('GOALLINE', [
    { route: [n(0, -1.2, 'RUN'), n(0.4, -2.4, 'SETTLE', s(2.0))] },
    { route: B0 }, { route: B0 }, { route: B0 },
    { route: flat(-1, 2) },
    { route: leak(1, 5) },
    { route: slant(-1, 2) },
  ]),
  primary: s(1.05), secondary: s(1.45), reads: [6, 4],
  shortYardage: 0.90, deepShot: 0.05,
});

/** Quarterback attacks the edge with a pitch man trailing. Make the end wrong. */
const PITCH_CHAIN = play({
  id: 'o-pitch-chain', name: 'Pitch Chain', page: 2, slot: 2,
  formation: 'SPLIT_BACKS', tags: ['OPTION', 'RUN'],
  players: mk('SPLIT_BACKS', [
    { route: [n(2.0, -1.0, 'RUN'), n(6.0, -0.6, 'SPEED'), n(10.0, 2.5, 'SPEED')] },
    { route: BR, blockDir: 1 }, { route: BR, blockDir: 1 }, { route: BR, blockDir: 1 },
    { route: [n(3.0, -0.6, 'RUN'), n(8.0, 1.2, 'BLOCK', s(1.8))] },
    { route: option(1) },
    { route: stalk(-1.6, 5.5) },
  ]),
  primary: s(1.1), secondary: s(1.7), reads: [5, 6],
  shortYardage: 0.65, deepShot: 0.04,
});

/** Flow right, hand it back left. Pursuit-angle punishment. */
const BACKDOOR_REVERSE = play({
  id: 'o-backdoor-reverse', name: 'Backdoor Reverse', page: 2, slot: 3,
  formation: 'SPREAD', tags: ['RUN', 'MISDIRECT'],
  players: mk('SPREAD', [
    { route: [n(-1.2, -1.2, 'RUN'), n(-4.0, -2.4, 'SETTLE', s(2.2))] },
    { route: BL, blockDir: -1 }, { route: BL, blockDir: -1 }, { route: BL, blockDir: -1 },
    { route: [n(4.0, 3.0, 'RUN'), n(7.0, 5.5, 'BLOCK', s(2.0))] },
    {
      route: [
        n(-4.0, -1.4, 'RUN'), n(-9.0, -2.3, 'CARRY'),
        n(-14.0, 0.5, 'SPEED'), n(-18.0, 9, 'SPEED'),
      ],
    },
    { route: go(24) },
  ]),
  primary: s(1.5), secondary: s(2.2), reads: [5, 6],
  shortYardage: 0.30, deepShot: 0.08,
});

/** Punt look, direct snap, up-back runs it. Fourth and short, one time only. */
const FUSE_SPECIAL = play({
  id: 'o-fuse-special', name: 'Fuse Special', page: 2, slot: 4,
  formation: 'PUNT_SHOW', tags: ['TRICK', 'MISDIRECT'],
  players: mk('PUNT_SHOW', [
    { route: [n(1.0, -0.5, 'RUN'), n(3.2, -1.6, 'SETTLE', s(2.0))] },
    { route: B0 }, { route: B0 }, { route: BR, blockDir: 1 },
    { route: go(26) },
    { route: [n(0.5, -1.0, 'CARRY'), n(3.0, 1.5, 'SPEED'), n(6.5, 9, 'SPEED')] },
    { route: go(26) },
  ]),
  primary: s(1.0), secondary: s(1.8), reads: [5, 4],
  shortYardage: 0.85, deepShot: 0.10,
});

/** Switch release verticals with a post into the deep middle. Kills single-high. */
const SKYLINE_VERTS = play({
  id: 'o-skyline-verts', name: 'Skyline Verticals', page: 2, slot: 5,
  formation: 'TRIPS_RIGHT', tags: ['DEEP', 'SHOTGUN'],
  players: mk('TRIPS_RIGHT', [
    { route: dropGun(2.8) },
    { route: B0 }, { route: B0 }, { route: B0 },
    { route: seam(29, -3) },
    { route: [n(3.5, 3, 'SPEED'), n(5.0, 14, 'SPEED'), n(5.5, 30, 'SPEED')] },
    { route: post(-1, 15) },
  ]),
  primary: s(2.55), secondary: s(2.95), reads: [6, 4],
  shortYardage: 0.02, deepShot: 0.92,
});

/** Full play-action, deepest drop in the book, one shot down the sideline. */
const CANNONBALL = play({
  id: 'o-cannonball', name: 'Cannonball', page: 2, slot: 6,
  formation: 'PRO_SET', tags: ['DEEP', 'MISDIRECT'],
  players: mk('PRO_SET', [
    { route: [n(-1.0, -1.2, 'RUN'), n(-0.4, -4.6, 'RUN'), n(0.4, -5.8, 'SETTLE', s(3.0))] },
    { route: B0 }, { route: B0 }, { route: B0 },
    { route: dig(1, 16) },
    { route: [n(1.0, -0.6, 'RUN'), n(-1.5, 0.4, 'BLOCK', s(2.4))] },
    { route: go(36) },
  ]),
  primary: s(2.8), secondary: s(3.2), reads: [6, 4],
  shortYardage: 0.05, deepShot: 1.0,
});

/** Zone right, plant, cut all the way back. Over-pursuing fronts get gutted. */
const CUTBACK_CRUSH = play({
  id: 'o-cutback-crush', name: 'Cutback Crush', page: 2, slot: 7,
  formation: 'I_HEAVY', tags: ['RUN', 'MISDIRECT'],
  players: mk('I_HEAVY', [
    { route: [n(0.8, -1.0, 'RUN'), n(2.4, -2.4, 'SETTLE', s(2.0))] },
    { route: BR, blockDir: 1 }, { route: BR, blockDir: 1 }, { route: BR, blockDir: 1 },
    { route: [n(1.4, -0.8, 'RUN'), n(3.0, 1.8, 'BLOCK', s(2.0))] },
    {
      route: [
        n(2.6, -1.6, 'CARRY'), n(4.0, 1.0, 'RUN'),
        n(-0.5, 4.5, 'CUT'), n(-3.5, 13, 'SPEED'),
      ],
    },
    { route: block(1) },
  ]),
  primary: s(1.05), secondary: s(1.7), reads: [5, 4],
  shortYardage: 0.75, deepShot: 0.03,
});

/** Sprint out into a three-level flood: crosser, swing, go. Nowhere to hide. */
const SAIL_OVERLOAD = play({
  id: 'o-sail-overload', name: 'Sail Overload', page: 2, slot: 8,
  formation: 'SHOTGUN_SPREAD', tags: ['FLOOD', 'ROLLOUT'],
  players: mk('SHOTGUN_SPREAD', [
    { route: rollOut(1) },
    { route: BR, blockDir: 1 }, { route: BR, blockDir: 1 }, { route: BR, blockDir: 1 },
    { route: cross(1, 6) },
    { route: swing(1) },
    { route: go(30) },
  ]),
  primary: s(1.95), secondary: s(2.4), reads: [4, 5],
  shortYardage: 0.20, deepShot: 0.28,
});

// ── exports ────────────────────────────────────────────────────────────────

export const OFFENSE_PLAYS: OffensePlay[] = [
  // page 0
  ANVIL_DIVE, SIDEWINDER_SWEEP, QUICK_NAILS, SNAP_HITCH, RIPCORD_MESH,
  TOWER_FLOOD, FOUR_ALARM, GHOST_COUNTER, LADDER_SCREEN,
  // page 1
  HAMMER_ISO, ANCHOR_DRAW, STICK_TRIGGER, BOUNDARY_FLOOD, DEEP_MINE,
  BOOTLEG_RIPCORD, SPRINT_CANNON, GRINDER_MESH, TUNNEL_SWEEP,
  // page 2
  IRON_WEDGE, PYLON_DART, PITCH_CHAIN, BACKDOOR_REVERSE, FUSE_SPECIAL,
  SKYLINE_VERTS, CANNONBALL, CUTBACK_CRUSH, SAIL_OVERLOAD,
];

/** The same 27 plays, bucketed into the three wheel pages the player sees. */
export const OFFENSE_PAGES: OffensePlay[][] = [
  OFFENSE_PLAYS.slice(0, 9),
  OFFENSE_PLAYS.slice(9, 18),
  OFFENSE_PLAYS.slice(18, 27),
];
