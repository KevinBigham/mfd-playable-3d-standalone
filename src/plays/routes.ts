/**
 * GRIDIRON OVERDRIVE — route DSL.
 *
 * A route is a list of waypoints. Every node's (x, z) is an OFFSET IN YARDS
 * FROM THE ATHLETE'S SNAP POSITION, in the offense-relative frame (+x right,
 * +z downfield). Nodes are absolute offsets, not deltas: a 12-yard dig is
 * [ (0,12), (-8,13), (-20,14) ], not three separate 8-yard hops.
 *
 * DEPTHS ARE COMPRESSED. A first down is 30 yards and athletes cover ground
 * about 1.4x faster than real players, so a "deep" route here tops out around
 * 34 yards and intermediate breaks sit at 10-16 instead of 12-18. Holds are in
 * ticks (60 Hz) via s().
 */

import type {
  DefenseAssign, DefensePlay, DefensePlayerPlan, OffensePlay, OffensePlayerPlan, RouteNode,
} from '../core/types.ts';
import { s } from '../core/constants.ts';
import { mirrorFormationName } from './formations.ts';

/** Break direction: -1 = toward the offense's left, +1 = toward its right. */
export type Side = -1 | 1;

function n(x: number, z: number, action: RouteNode['action'], hold?: number): RouteNode {
  return hold === undefined ? { x, z, action } : { x, z, action, hold };
}

// ── vertical stems ─────────────────────────────────────────────────────────

/** Outside vertical. Wins on a corner with no over-the-top help. */
export function go(depth = 34): RouteNode[] {
  return [n(0, 9, 'SPEED'), n(0.9, 20, 'SPEED'), n(0.4, depth, 'SPEED')];
}

/** Inside vertical up the seam. `drift` bends it toward a hole in zone. */
export function seam(depth = 30, drift = 0): RouteNode[] {
  return [n(drift * 0.4, 9, 'SPEED'), n(drift, depth, 'SPEED')];
}

/** Bend across the safety's face. `dir` points toward the middle of the field. */
export function post(dir: Side, depth = 13): RouteNode[] {
  return [n(0, depth, 'SPEED'), n(dir * 9, depth + 11, 'CUT'), n(dir * 15, depth + 19, 'SPEED')];
}

/** Break away from the safety toward the sideline pylon. */
export function corner(dir: Side, depth = 12): RouteNode[] {
  return [n(0, depth, 'SPEED'), n(dir * 7, depth + 8, 'CUT'), n(dir * 13, depth + 15, 'SPEED')];
}

// ── quick game ─────────────────────────────────────────────────────────────

/** Three-step angle inside. The answer to press man. */
export function slant(dir: Side, depth = 3): RouteNode[] {
  return [n(0, depth, 'RUN'), n(dir * 6, depth + 4.5, 'CUT'), n(dir * 14, depth + 10, 'SPEED')];
}

/** Speed out to the sideline. */
export function out(dir: Side, depth = 8): RouteNode[] {
  return [n(0, depth, 'RUN'), n(dir * 6, depth + 0.8, 'CUT'), n(dir * 10, depth + 1.6, 'SPEED')];
}

/** Square in at intermediate depth. `dir` points inside. */
export function in_(dir: Side, depth = 10): RouteNode[] {
  return [n(0, depth, 'RUN'), n(dir * 6, depth + 0.8, 'CUT'), n(dir * 13, depth + 1.8, 'SPEED')];
}

/** Stop route: stem, plant, work back toward the ball. */
export function hitch(depth = 7): RouteNode[] {
  return [n(0, depth, 'RUN'), n(0, depth - 1.6, 'SETTLE', s(0.55))];
}

/** Sell vertical, then snap back downhill to the sideline shoulder. */
export function comeback(dir: Side, depth = 16): RouteNode[] {
  return [n(0, depth, 'SPEED'), n(dir * 2.2, depth - 3.2, 'CUT'), n(dir * 4.0, depth - 4.0, 'SETTLE', s(0.35))];
}

/** Hook up in the soft spot between zone defenders and sit down. */
export function curl(dir: Side, depth = 11): RouteNode[] {
  return [n(0, depth, 'SPEED'), n(dir * 2.4, depth - 2.2, 'SETTLE', s(0.6))];
}

// ── horizontal stretchers ──────────────────────────────────────────────────

/** Shallow crosser under the linebackers. Man coverage's nightmare. */
export function drag(dir: Side, depth = 3): RouteNode[] {
  return [n(0, depth, 'RUN'), n(dir * 11, depth + 1.6, 'CUT'), n(dir * 23, depth + 3.4, 'SPEED')];
}

/** Intermediate crosser, climbing as it goes. Pairs with drag to build a mesh. */
export function cross(dir: Side, depth = 6): RouteNode[] {
  return [n(0, depth, 'RUN'), n(dir * 9, depth + 4, 'CUT'), n(dir * 21, depth + 8, 'SPEED')];
}

/** Deep in-cut. The strong-side answer to a two-deep shell. */
export function dig(dir: Side, depth = 14): RouteNode[] {
  return [n(0, depth, 'SPEED'), n(dir * 7, depth + 1.0, 'CUT'), n(dir * 19, depth + 2.6, 'SPEED')];
}

/** Immediate release to the flat, then sit facing the quarterback. */
export function flat(dir: Side, depth = 2): RouteNode[] {
  return [n(dir * 6, depth, 'RUN'), n(dir * 12, depth + 1.2, 'SETTLE', s(0.4))];
}

/** Backfield release that bellies out and turns up the boundary. */
export function swing(dir: Side): RouteNode[] {
  return [n(dir * 5, -2.8, 'RUN'), n(dir * 12, -0.8, 'RUN'), n(dir * 16.5, 3.5, 'SPEED')];
}

/** Flare from the backfield up the sideline. Beats a linebacker every time. */
export function wheel(dir: Side, depth = 24): RouteNode[] {
  return [n(dir * 6, 0.5, 'RUN'), n(dir * 9.5, 4, 'CUT'), n(dir * 11, depth, 'SPEED')];
}

// ── specialty ──────────────────────────────────────────────────────────────

/** Sell protection, then slide out and wait behind the rush. */
export function screen(dir: Side): RouteNode[] {
  return [
    n(dir * 2.5, -1.4, 'BLOCK', s(0.3)),
    n(dir * 9, -3.2, 'SETTLE', s(0.45)),
    n(dir * 13, 2.5, 'SPEED'),
  ];
}

/** Stay in to protect, then release late into vacated grass. */
export function leak(dir: Side, depth = 11): RouteNode[] {
  return [
    n(dir * 0.8, 0.4, 'BLOCK', s(0.6)),
    n(dir * 5, 3, 'LEAK'),
    n(dir * 10, depth, 'SPEED'),
  ];
}

/** Pure protection. Linemen and kept-in backs. */
export function block(dir: -1 | 0 | 1 = 0): RouteNode[] {
  return [n(dir * 0.8, 0.3, 'BLOCK', s(1.4)), n(dir * 1.7, 0.7, 'BLOCK', s(2.6))];
}

/** Take the handoff at the mesh point and press the crease. */
export function carry(dir: Side, depth = 9): RouteNode[] {
  return [
    n(dir * 1.4, -1.3, 'CARRY'),
    n(dir * 4.2, 1.4, 'RUN'),
    n(dir * 6.4, depth, 'SPEED'),
  ];
}

/** Trail the ball carrier in pitch relationship, then turn it up. */
export function option(dir: Side): RouteNode[] {
  return [n(dir * 3.4, -1.8, 'RUN'), n(dir * 8.5, -2.4, 'RUN'), n(dir * 14, 1.5, 'SPEED')];
}

// ── analysis + mirroring ───────────────────────────────────────────────────

/** Deepest downfield point of a route, in yards past the athlete's alignment. */
export function routeDepth(route: RouteNode[]): number {
  let m = 0;
  for (const node of route) if (node.z > m) m = node.z;
  return m;
}

/** Widest lateral displacement of a route, in yards. */
export function routeWidth(route: RouteNode[]): number {
  let m = 0;
  for (const node of route) { const a = Math.abs(node.x); if (a > m) m = a; }
  return m;
}

/** Left/right flip of a route. Returns a fresh array; inputs are untouched. */
export function mirrorRoute(route: RouteNode[]): RouteNode[] {
  return route.map((node) =>
    node.hold === undefined
      ? { x: -node.x, z: node.z, action: node.action }
      : { x: -node.x, z: node.z, action: node.action, hold: node.hold });
}

/**
 * Stamp target buttons onto a plan set by PRE-SNAP alignment: of the three
 * pass-eligible players, leftmost answers button 0, middle 1, rightmost 2.
 * Linemen and the quarterback are never targets. Mutates and returns `players`.
 *
 * This is the single source of truth for target assignment — every play is
 * built through it so the button layout always matches what the player sees.
 */
export function assignTargetsByX(players: OffensePlayerPlan[]): OffensePlayerPlan[] {
  const eligible: number[] = [];
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    p.target = null;
    if (p.role !== 'QB' && p.role !== 'LINE') eligible.push(i);
  }
  eligible.sort((a, b) => players[a].align.x - players[b].align.x);
  for (let k = 0; k < eligible.length && k < 3; k++) {
    players[eligible[k]].target = k as 0 | 1 | 2;
  }
  return players;
}

function mirrorPlan(p: OffensePlayerPlan): OffensePlayerPlan {
  const out: OffensePlayerPlan = {
    role: p.role,
    align: { x: -p.align.x, z: p.align.z },
    route: mirrorRoute(p.route),
    target: p.target,
  };
  if (p.blockDir !== undefined) out.blockDir = -p.blockDir as -1 | 0 | 1;
  return out;
}

/**
 * Left/right flip of a whole offensive play. Alignments, routes and block
 * directions mirror; targets are re-stamped from the new alignment so button 0
 * is still the leftmost receiver. `reads` are player indices and do not move.
 */
export function mirrorOffensePlay(p: OffensePlay, id?: string, name?: string): OffensePlay {
  const players = assignTargetsByX(p.players.map(mirrorPlan));
  const out: OffensePlay = {
    id: id ?? `${p.id}-flip`,
    name: name ?? `${p.name} Flip`,
    page: p.page,
    slot: p.slot,
    formation: mirrorFormationName(p.formation),
    tags: p.tags.slice(),
    players,
    timing: { primary: p.timing.primary, secondary: p.timing.secondary },
    reads: [p.reads[0], p.reads[1]],
    shortYardage: p.shortYardage,
    deepShot: p.deepShot,
  };
  return out;
}

function mirrorAssign(a: DefenseAssign): DefenseAssign {
  switch (a.kind) {
    case 'RUSH': return { kind: 'RUSH', lane: -a.lane };
    case 'CONTAIN': return { kind: 'CONTAIN', side: (-a.side) as -1 | 1 };
    // Man slots are the offense's skill players ordered left→right, so a flip
    // swaps the outside two and leaves the middle one alone.
    case 'MAN': return { kind: 'MAN', slot: a.slot === 0 ? 2 : a.slot === 2 ? 0 : a.slot };
    case 'ZONE': return { kind: 'ZONE', x: -a.x, z: a.z, r: a.r };
    case 'SPY': return { kind: 'SPY' };
    case 'BLITZ_DELAY': return { kind: 'BLITZ_DELAY', lane: -a.lane, delay: a.delay };
  }
}

/** Left/right flip of a defensive call. */
export function mirrorDefensePlay(p: DefensePlay, id?: string, name?: string): DefensePlay {
  const players: DefensePlayerPlan[] = p.players.map((d) => ({
    align: { x: -d.align.x, z: d.align.z },
    assign: mirrorAssign(d.assign),
  }));
  return {
    id: id ?? `${p.id}-flip`,
    name: name ?? `${p.name} Flip`,
    slot: p.slot,
    formation: p.formation,
    tags: p.tags.slice(),
    players,
    aggression: p.aggression,
    deepHelp: p.deepHelp,
  };
}
