/**
 * GRIDIRON OVERDRIVE — play editor logic.
 *
 * Pure logic: no DOM, no three, no ambient randomness. The editor screen owns
 * pixels; this file owns *meaning*. Everything here operates on the same
 * `OffensePlay` / `DefensePlay` structures the shipped playbook uses, so an
 * authored play is indistinguishable from a hand-written one by the time it
 * reaches `setupPlay()`.
 *
 * THE CONTRACT
 *   - Alignments and route nodes are always clamped into legal territory as
 *     they are written, never "validated later and hopefully fixed". A play in
 *     memory is always a play the simulation can run.
 *   - Target buttons are never authored by hand. `reassignTargets()` restamps
 *     them left-to-right from pre-snap x, exactly like `assignTargetsByX()`
 *     does for the shipped playbook, so button 0 is always the leftmost
 *     eligible receiver no matter how the player drags people around.
 *   - Persistence is `save.customPlays` and nothing else. 18 slots: 9 offensive
 *     and 9 defensive, addressed by (side, slot).
 */

import type {
  CustomPlay, DefenseAssign, DefensePlay, DefensePlayerPlan, OffensePlay,
  OffensePlayerPlan, OffenseRole, RouteAction, RouteNode,
} from '../core/types.ts';
import { s } from '../core/constants.ts';
import { clamp } from '../core/math.ts';
import { assignTargetsByX, block, flat, go } from '../plays/routes.ts';
import { CUSTOM_PAGE, PAGE_SIZE, validatePlay } from '../plays/playbook.ts';
import { DEF_MIN_Z, LINE_Z, MAX_SPLIT_X, getOffenseFormation } from '../plays/formations.ts';
import { getSave, writeSave } from '../persistence/save.ts';

// ── limits ──────────────────────────────────────────────────────────────────

export type EditorSide = 'OFF' | 'DEF';

/** Slots on one side of the custom page. */
export const SLOTS_PER_SIDE = PAGE_SIZE;
/** Hard cap enforced by the save schema. */
export const MAX_CUSTOM_PLAYS = 18;
/** Nobody needs a twelve-cut route, and the wheel diagram stops reading past this. */
export const MAX_ROUTE_NODES = 8;
/** Interior linemen stay inside this many yards of the ball. */
export const LINE_SPLIT_LIMIT = 4;
/** The quarterback must be at least this far behind the ball. */
export const QB_MIN_DEPTH = 1.0;
export const QB_MAX_DEPTH = 12;
/** Deepest legal backfield alignment for a skill player. */
export const SKILL_MAX_DEPTH = 12;
/** Nobody lines up past the line of scrimmage (validatePlay allows 0.35). */
export const OFF_MAX_Z = 0.3;
/** Deepest legal pre-snap defensive alignment. */
export const DEF_MAX_DEPTH = 42;
/** Route node depth window, a shade inside what validatePlay accepts. */
export const NODE_MAX_Z = 60;
export const NODE_MIN_Z = -15;
/** Widest a route node may end up, measured from the middle of the field. */
export const NODE_MAX_X = 25.5;
/** Zone radius window. */
export const ZONE_MIN_R = 3;
export const ZONE_MAX_R = 20;
/** Longest legal play name. */
export const MAX_NAME_LENGTH = 20;

/** Every route action the editor can stamp onto a node, in cycle order. */
export const ROUTE_ACTIONS: RouteAction[] = [
  'RUN', 'CUT', 'SPEED', 'SETTLE', 'DRIFT', 'BLOCK', 'CARRY', 'LEAK',
];

/** Offensive roles the editor can assign, in cycle order. */
export const OFFENSE_ROLES: OffenseRole[] = ['QB', 'LINE', 'BACK', 'SLOT', 'WIDE'];

/** Defensive assignment kinds the editor can assign, in cycle order. */
export const ASSIGN_KINDS: DefenseAssign['kind'][] = [
  'RUSH', 'CONTAIN', 'MAN', 'ZONE', 'SPY', 'BLITZ_DELAY',
];

// ── small helpers ───────────────────────────────────────────────────────────

function r2(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 10) / 10;
}

export function isOffensePlay(p: OffensePlay | DefensePlay): p is OffensePlay {
  return 'page' in p;
}

/** Trim, upper-case and strip anything that would not read on an arcade panel. */
export function sanitizeName(name: string): string {
  const cleaned = String(name ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9 '\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME_LENGTH);
  return cleaned;
}

/** Stable id for a saved slot, so a play always overwrites its own wheel cell. */
export function customId(side: EditorSide, slot: number): string {
  return `cst-${side === 'OFF' ? 'off' : 'def'}-${Math.max(0, Math.min(SLOTS_PER_SIDE - 1, slot | 0))}`;
}

/** Deep copy. Plays round-trip through JSON, so a structural clone is enough. */
export function clonePlay<T extends OffensePlay | DefensePlay>(p: T): T {
  return JSON.parse(JSON.stringify(p)) as T;
}

// ── templates ───────────────────────────────────────────────────────────────

function qbDrop(): RouteNode[] {
  return [
    { x: 0, z: -0.8, action: 'RUN' },
    { x: 0.3, z: -1.7, action: 'SETTLE', hold: s(3) },
  ];
}

/**
 * A fresh offensive play: shotgun, three blockers, two verticals and a flat.
 * Legal the moment it is created — `validate()` on the result is empty — so the
 * editor never starts the player off in a broken state.
 */
export function newCustomOffense(name: string, slot = 0): OffensePlay {
  const f = getOffenseFormation('SHOTGUN_SPREAD');
  const routes: RouteNode[][] = [
    qbDrop(),
    block(-1), block(0), block(1),
    go(26),      // left split end
    flat(1, 2),  // back to the right flat
    go(26),      // right split end
  ];
  const blockDirs: Array<-1 | 0 | 1 | undefined> = [undefined, -1, 0, 1, undefined, undefined, undefined];
  const players: OffensePlayerPlan[] = f.slots.map((sl, i) => {
    const plan: OffensePlayerPlan = {
      role: sl.role,
      align: { x: r2(sl.align.x), z: r2(sl.align.z) },
      route: routes[i].map((n) => ({ ...n })),
      target: null,
    };
    if (blockDirs[i] !== undefined) plan.blockDir = blockDirs[i];
    return plan;
  });
  assignTargetsByX(players);
  const play: OffensePlay = {
    id: customId('OFF', slot),
    name: sanitizeName(name) || 'NEW PLAY',
    page: CUSTOM_PAGE,
    slot: clamp(slot | 0, 0, SLOTS_PER_SIDE - 1),
    formation: 'SHOTGUN_SPREAD',
    tags: ['SHOTGUN'],
    players,
    timing: { primary: s(1.5), secondary: s(2.2) },
    reads: [4, 6],
    shortYardage: 0.2,
    deepShot: 0.5,
  };
  clampAllRoutes(play);
  return play;
}

/**
 * A fresh defensive play: four-man front, everybody in man, nothing over the
 * top. Also legal on creation.
 */
export function newCustomDefense(name: string, slot = 0): DefensePlay {
  const mk = (x: number, z: number, assign: DefenseAssign): DefensePlayerPlan =>
    ({ align: { x, z }, assign });
  const play: DefensePlay = {
    id: customId('DEF', slot),
    name: sanitizeName(name) || 'NEW CALL',
    slot: clamp(slot | 0, 0, SLOTS_PER_SIDE - 1),
    formation: 'NICKEL_4',
    tags: ['MAN'],
    players: [
      mk(-3.2, 0.9, { kind: 'RUSH', lane: -0.6 }),
      mk(-1.1, 0.9, { kind: 'RUSH', lane: -0.2 }),
      mk(1.1, 0.9, { kind: 'RUSH', lane: 0.2 }),
      mk(3.2, 0.9, { kind: 'RUSH', lane: 0.6 }),
      mk(0, 5.2, { kind: 'MAN', slot: 1 }),
      mk(-13, 6.5, { kind: 'MAN', slot: 0 }),
      mk(13, 6.5, { kind: 'MAN', slot: 2 }),
    ],
    aggression: 0.6,
    deepHelp: 0.2,
  };
  return play;
}

/** A blank play of either side, ready for the given slot. */
export function newCustomPlay(side: EditorSide, name: string, slot = 0): OffensePlay | DefensePlay {
  return side === 'OFF' ? newCustomOffense(name, slot) : newCustomDefense(name, slot);
}

// ── alignment ───────────────────────────────────────────────────────────────

/** Legal alignment window for one player, used by the editor to draw guides. */
export interface SlotLimits { minX: number; maxX: number; minZ: number; maxZ: number }

export function slotLimits(play: OffensePlay | DefensePlay, index: number): SlotLimits {
  if (!isOffensePlay(play)) return { minX: -MAX_SPLIT_X, maxX: MAX_SPLIT_X, minZ: DEF_MIN_Z, maxZ: DEF_MAX_DEPTH };
  const role = play.players[index]?.role;
  if (role === 'LINE') return { minX: -LINE_SPLIT_LIMIT, maxX: LINE_SPLIT_LIMIT, minZ: LINE_Z, maxZ: LINE_Z };
  if (role === 'QB') return { minX: -12, maxX: 12, minZ: -QB_MAX_DEPTH, maxZ: -QB_MIN_DEPTH };
  return { minX: -MAX_SPLIT_X, maxX: MAX_SPLIT_X, minZ: -SKILL_MAX_DEPTH, maxZ: OFF_MAX_Z };
}

/**
 * Move a player's pre-snap alignment, clamped into legal territory:
 * offense stays inside ±22 across, linemen stay on the line within 4 yards of
 * the ball, the quarterback stays behind it, and nobody lines up past it.
 * Defenders stay at least 0.8 yards off the ball.
 *
 * Offensive moves restamp the target buttons, because the buttons are defined
 * by alignment — dragging a receiver across the formation is supposed to change
 * which button he answers to.
 *
 * Returns the clamped position actually written.
 */
export function moveSlot(
  play: OffensePlay | DefensePlay, index: number, x: number, z: number,
): { x: number; z: number } {
  const players = play.players as Array<OffensePlayerPlan | DefensePlayerPlan>;
  if (!Array.isArray(players) || index < 0 || index >= players.length) return { x: 0, z: 0 };
  const lim = slotLimits(play, index);
  const nx = r2(clamp(Number.isFinite(x) ? x : 0, lim.minX, lim.maxX));
  const nz = r2(clamp(Number.isFinite(z) ? z : 0, lim.minZ, lim.maxZ));
  const p = players[index];
  p.align.x = nx;
  p.align.z = nz;
  if (isOffensePlay(play)) {
    clampRoute(play.players[index]);
    reassignTargets(play);
  }
  return { x: nx, z: nz };
}

function isEligibleRole(r: OffenseRole): boolean { return r !== 'QB' && r !== 'LINE'; }

/** Nearest player (by pre-snap x) matching a predicate, excluding `index`. */
function nearestBy(
  play: OffensePlay, index: number, pick: (p: OffensePlayerPlan) => boolean,
): number {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < play.players.length; i++) {
    if (i === index || !pick(play.players[i])) continue;
    const d = Math.abs(play.players[i].align.x - play.players[index].align.x);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/**
 * Change an offensive player's role.
 *
 * A 7-on-7 unit is always one quarterback, three blockers and three eligible
 * receivers, so promoting a lineman *swaps* him with the nearest receiver
 * rather than producing a fourth target. The quarterback slot never moves.
 * Returns false when the change is impossible.
 */
export function setRole(play: OffensePlay, index: number, role: OffenseRole): boolean {
  const p = play.players?.[index];
  if (!p) return false;
  if (p.role === role) return true;
  if (p.role === 'QB' || role === 'QB') return false; // one quarterback, and he stays put

  const was = p.role;
  const crossesTheLine = isEligibleRole(was) !== isEligibleRole(role);
  if (crossesTheLine) {
    // The two players trade jobs outright — alignment, route and blocking
    // assignment move with the role, so the formation stays legal and the swap
    // is obvious on the diagram.
    const partner = isEligibleRole(role)
      ? nearestBy(play, index, (q) => isEligibleRole(q.role))
      : nearestBy(play, index, (q) => q.role === 'LINE');
    if (partner < 0) return false;
    const q = play.players[partner];
    const align = p.align; p.align = q.align; q.align = align;
    const route = p.route; p.route = q.route; q.route = route;
    q.role = was;
    if (was === 'LINE') { if (q.blockDir === undefined) q.blockDir = 0; } else delete q.blockDir;
  }

  p.role = role;
  if (role === 'LINE') {
    if (p.blockDir === undefined) p.blockDir = 0;
    p.target = null;
  } else {
    delete p.blockDir;
  }
  // Re-clamp both players into their new role windows, then restamp buttons.
  for (let i = 0; i < play.players.length; i++) {
    moveSlot(play, i, play.players[i].align.x, play.players[i].align.z);
  }
  reassignTargets(play);
  return true;
}

/** Point the primary (0) or secondary (1) read at a player who carries a target. */
export function setRead(play: OffensePlay, which: 0 | 1, playerIndex: number): boolean {
  if (!Array.isArray(play.players) || !play.players[playerIndex]) return false;
  if (play.players[playerIndex].target === null) return false;
  const other = play.reads[which === 0 ? 1 : 0];
  if (other === playerIndex) return false;
  play.reads[which] = playerIndex;
  return true;
}

/** Read timing in ticks. The secondary read is always kept after the primary. */
export function setTiming(play: OffensePlay, primary: number, secondary: number): void {
  const pri = Math.round(clamp(Number.isFinite(primary) ? primary : s(1.2), s(0.4), s(3.4)));
  const sec = Math.round(clamp(Number.isFinite(secondary) ? secondary : pri + s(0.6), pri + 6, s(4.2)));
  play.timing = { primary: pri, secondary: sec };
}

/** Replace the play's tag list with a single tag. Drives the AI play caller. */
export function setOffenseTag(play: OffensePlay, tag: OffensePlay['tags'][number]): void {
  play.tags = [tag];
}

export function setDefenseTag(play: DefensePlay, tag: DefensePlay['tags'][number]): void {
  play.tags = [tag];
}

/** Defensive risk knobs, 0..1. */
export function setAggression(play: DefensePlay, v: number): void {
  play.aggression = r2(clamp(Number.isFinite(v) ? v : 0.5, 0, 1));
}
export function setDeepHelp(play: DefensePlay, v: number): void {
  play.deepHelp = r2(clamp(Number.isFinite(v) ? v : 0.5, 0, 1));
}
/** Offensive situational hints, 0..1. */
export function setShortYardage(play: OffensePlay, v: number): void {
  play.shortYardage = r2(clamp(Number.isFinite(v) ? v : 0.5, 0, 1));
}
export function setDeepShot(play: OffensePlay, v: number): void {
  play.deepShot = r2(clamp(Number.isFinite(v) ? v : 0.5, 0, 1));
}

/** Blocking direction for a lineman (or a kept-in back). */
export function setBlockDir(play: OffensePlay, index: number, dir: -1 | 0 | 1): void {
  const p = play.players?.[index];
  if (!p) return;
  p.blockDir = dir;
}

// ── routes ──────────────────────────────────────────────────────────────────

function clampNode(align: { x: number; z: number }, node: RouteNode): void {
  const lo = -NODE_MAX_X - align.x;
  const hi = NODE_MAX_X - align.x;
  node.x = r2(clamp(Number.isFinite(node.x) ? node.x : 0, lo, hi));
  node.z = r2(clamp(Number.isFinite(node.z) ? node.z : 0, NODE_MIN_Z, NODE_MAX_Z));
  if (node.hold !== undefined) {
    if (!Number.isFinite(node.hold) || node.hold <= 0) delete node.hold;
    else node.hold = Math.round(clamp(node.hold, 0, s(4)));
  }
}

function clampRoute(p: OffensePlayerPlan): void {
  if (!Array.isArray(p.route)) { p.route = [{ x: 0, z: 4, action: 'RUN' }]; return; }
  if (p.route.length > MAX_ROUTE_NODES) p.route.length = MAX_ROUTE_NODES;
  for (const n of p.route) clampNode(p.align, n);
  if (p.route.length === 0) p.route.push({ x: 0, z: 4, action: 'RUN' });
}

function clampAllRoutes(play: OffensePlay): void {
  for (const p of play.players) clampRoute(p);
}

/**
 * Append a waypoint to a player's route. `x` / `z` are offsets in yards from
 * that player's alignment, the same frame the route DSL uses.
 * Returns the new node's index, or -1 if the route is full.
 */
export function addNode(
  play: OffensePlay, index: number, x: number, z: number, action: RouteAction = 'RUN',
): number {
  const p = play.players?.[index];
  if (!p) return -1;
  if (!Array.isArray(p.route)) p.route = [];
  if (p.route.length >= MAX_ROUTE_NODES) return -1;
  const node: RouteNode = { x, z, action: ROUTE_ACTIONS.includes(action) ? action : 'RUN' };
  clampNode(p.align, node);
  p.route.push(node);
  return p.route.length - 1;
}

/** Move an existing waypoint. Offsets are clamped so the route stays inbounds. */
export function moveNode(
  play: OffensePlay, index: number, node: number, x: number, z: number,
): { x: number; z: number } {
  const p = play.players?.[index];
  const nd = p?.route?.[node];
  if (!p || !nd) return { x: 0, z: 0 };
  nd.x = x;
  nd.z = z;
  clampNode(p.align, nd);
  return { x: nd.x, z: nd.z };
}

/** Remove a waypoint. The last remaining node is kept — a route may not be empty. */
export function removeNode(play: OffensePlay, index: number, node: number): boolean {
  const p = play.players?.[index];
  if (!p || !Array.isArray(p.route)) return false;
  if (node < 0 || node >= p.route.length) return false;
  if (p.route.length <= 1) return false;
  p.route.splice(node, 1);
  return true;
}

export function setNodeAction(
  play: OffensePlay, index: number, node: number, action: RouteAction,
): void {
  const nd = play.players?.[index]?.route?.[node];
  if (!nd) return;
  if (!ROUTE_ACTIONS.includes(action)) return;
  nd.action = action;
}

/** Hold time at a waypoint, in ticks. 0 clears it. */
export function setNodeHold(play: OffensePlay, index: number, node: number, hold: number): void {
  const p = play.players?.[index];
  const nd = p?.route?.[node];
  if (!p || !nd) return;
  nd.hold = hold;
  clampNode(p.align, nd);
}

// ── defensive assignments ───────────────────────────────────────────────────

/** Clamp an assignment into the window `validatePlay` accepts. */
export function normalizeAssignment(a: DefenseAssign): DefenseAssign {
  switch (a.kind) {
    case 'RUSH': return { kind: 'RUSH', lane: r2(clamp(a.lane, -1, 1)) };
    case 'CONTAIN': return { kind: 'CONTAIN', side: a.side < 0 ? -1 : 1 };
    case 'MAN': return { kind: 'MAN', slot: clamp(Math.round(a.slot), 0, 2) };
    case 'ZONE': return {
      kind: 'ZONE',
      x: r2(clamp(a.x, -MAX_SPLIT_X, MAX_SPLIT_X)),
      z: r2(clamp(a.z, 0, NODE_MAX_Z)),
      r: r2(clamp(a.r, ZONE_MIN_R, ZONE_MAX_R)),
    };
    case 'SPY': return { kind: 'SPY' };
    case 'BLITZ_DELAY': return {
      kind: 'BLITZ_DELAY',
      lane: r2(clamp(a.lane, -1, 1)),
      delay: Math.round(clamp(a.delay, 0, s(3))),
    };
  }
}

/** A sensible default assignment of each kind, used when cycling the property row. */
export function defaultAssignment(kind: DefenseAssign['kind'], align: { x: number; z: number }): DefenseAssign {
  switch (kind) {
    case 'RUSH': return { kind: 'RUSH', lane: r2(clamp(align.x / 5, -1, 1)) };
    case 'CONTAIN': return { kind: 'CONTAIN', side: align.x < 0 ? -1 : 1 };
    case 'MAN': return { kind: 'MAN', slot: align.x < -5 ? 0 : align.x > 5 ? 2 : 1 };
    case 'ZONE': return { kind: 'ZONE', x: r2(clamp(align.x, -MAX_SPLIT_X, MAX_SPLIT_X)), z: r2(Math.max(6, align.z + 4)), r: 9 };
    case 'SPY': return { kind: 'SPY' };
    case 'BLITZ_DELAY': return { kind: 'BLITZ_DELAY', lane: r2(clamp(align.x / 5, -1, 1)), delay: s(0.8) };
  }
}

export function setAssignment(play: DefensePlay, index: number, assign: DefenseAssign): void {
  const p = play.players?.[index];
  if (!p) return;
  p.assign = normalizeAssignment(assign);
}

// ── targets ─────────────────────────────────────────────────────────────────

/**
 * Restamp target buttons 0 / 1 / 2 left-to-right by pre-snap x.
 *
 * If fewer than three eligible receivers exist — the player demoted too many
 * people to the line — the widest linemen are promoted back to SLOT so the
 * invariant "exactly one each of 0, 1 and 2" always holds for a 7-man unit with
 * one quarterback. Mutates and returns the play.
 */
export function reassignTargets(play: OffensePlay): OffensePlay {
  const players = play.players;
  if (!Array.isArray(players)) return play;

  let eligible = players.filter((p) => isEligibleRole(p.role)).length;
  if (eligible < 3) {
    // Promote the widest linemen until three targets exist.
    const line = players
      .map((p, i) => ({ p, i }))
      .filter((e) => e.p.role === 'LINE')
      .sort((a, b) => Math.abs(b.p.align.x) - Math.abs(a.p.align.x));
    for (const e of line) {
      if (eligible >= 3) break;
      e.p.role = 'SLOT';
      delete e.p.blockDir;
      eligible++;
    }
  }
  assignTargetsByX(players);
  repairReads(play);
  return play;
}

/** Keep `reads` pointing at two different players who actually carry a target. */
function repairReads(play: OffensePlay): void {
  const targets: number[] = [];
  for (let i = 0; i < play.players.length; i++) {
    if (play.players[i].target !== null) targets.push(i);
  }
  if (targets.length < 2) return;
  const ok = (r: number): boolean =>
    Number.isInteger(r) && r >= 0 && r < play.players.length && play.players[r].target !== null;
  const a = ok(play.reads?.[0]) ? play.reads[0] : targets[0];
  let b = ok(play.reads?.[1]) ? play.reads[1] : targets[targets.length - 1];
  if (b === a) b = targets.find((i) => i !== a) ?? b;
  play.reads = [a, b];
}

// ── validation ──────────────────────────────────────────────────────────────

function pushOverlaps(
  players: Array<{ align: { x: number; z: number } }>, label: string, out: string[],
): void {
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const dx = players[i].align.x - players[j].align.x;
      const dz = players[i].align.z - players[j].align.z;
      if (Math.hypot(dx, dz) < 0.7) {
        out.push(`${label} ${i} and ${j} are standing on top of each other`);
      }
    }
  }
}

/**
 * `validatePlay()` from the playbook plus the checks that only matter when a
 * human is dragging marks around a diagram. An empty list means the play is
 * safe to save, run and share.
 */
export function validate(play: OffensePlay | DefensePlay): string[] {
  const problems = validatePlay(play);

  const name = String(play.name ?? '');
  if (sanitizeName(name).length === 0) problems.push('play needs a name');
  else if (name.length > MAX_NAME_LENGTH) problems.push(`name is longer than ${MAX_NAME_LENGTH} characters`);

  if (!Array.isArray(play.players) || play.players.length !== 7) return problems;

  if (isOffensePlay(play)) {
    pushOverlaps(play.players, 'player', problems);

    let carriers = 0;
    const eligibleX: Array<{ i: number; x: number }> = [];

    for (let i = 0; i < play.players.length; i++) {
      const p = play.players[i];
      const who = `player ${i}`;
      const lim = slotLimits(play, i);
      if (p.align.x < lim.minX - 0.05 || p.align.x > lim.maxX + 0.05) {
        problems.push(`${who} (${p.role}) is outside its legal split`);
      }
      if (p.align.z < lim.minZ - 0.05 || p.align.z > lim.maxZ + 0.05) {
        problems.push(`${who} (${p.role}) is at an illegal depth for its role`);
      }
      if (p.role !== 'QB' && p.role !== 'LINE') eligibleX.push({ i, x: p.align.x });

      const route = Array.isArray(p.route) ? p.route : [];
      if (route.length > MAX_ROUTE_NODES) {
        problems.push(`${who} has more than ${MAX_ROUTE_NODES} route nodes`);
      }
      for (let k = 0; k < route.length; k++) {
        if (route[k].action === 'CARRY') {
          carriers++;
          if (p.role === 'LINE' || p.role === 'QB') {
            problems.push(`${who} is a ${p.role} and cannot take the handoff`);
          }
          if (k > 1) problems.push(`${who} takes the handoff too late in the route`);
        }
      }
      if (route.length >= 2) {
        const a = route[route.length - 2];
        const b = route[route.length - 1];
        if (Math.hypot(b.x - a.x, b.z - a.z) < 0.25 && b.action !== 'SETTLE' && b.action !== 'BLOCK') {
          problems.push(`${who} has two route nodes in the same spot`);
        }
      }
    }

    if (carriers > 1) problems.push('two players cannot both take the handoff');

    eligibleX.sort((a, b) => a.x - b.x);
    for (let k = 1; k < eligibleX.length; k++) {
      if (Math.abs(eligibleX[k].x - eligibleX[k - 1].x) < 0.3) {
        problems.push(
          `players ${eligibleX[k - 1].i} and ${eligibleX[k].i} share a split — target buttons would be ambiguous`,
        );
      }
    }
    if (!play.players.some((p) => p.role === 'LINE')) {
      problems.push('nobody is blocking — keep at least one lineman');
    }
  } else {
    pushOverlaps(play.players, 'defender', problems);
    const manned = new Map<number, number>();
    let deepest = 0;
    for (let i = 0; i < play.players.length; i++) {
      const d = play.players[i];
      if (d.align.z > DEF_MAX_DEPTH) problems.push(`defender ${i} lines up deeper than ${DEF_MAX_DEPTH} yards`);
      if (Math.abs(d.align.x) > MAX_SPLIT_X) problems.push(`defender ${i} lines up outside the numbers`);
      deepest = Math.max(deepest, d.align.z);
      const a = d.assign;
      if (a.kind === 'MAN') {
        const prev = manned.get(a.slot);
        if (prev !== undefined) problems.push(`defenders ${prev} and ${i} both cover skill slot ${a.slot}`);
        else manned.set(a.slot, i);
      } else if (a.kind === 'ZONE') {
        if (a.r < ZONE_MIN_R) problems.push(`defender ${i} has a zone smaller than ${ZONE_MIN_R} yards`);
        if (a.r > ZONE_MAX_R) problems.push(`defender ${i} has a zone wider than ${ZONE_MAX_R} yards`);
      }
    }
    const covering = play.players.filter(
      (d) => d.assign.kind === 'MAN' || d.assign.kind === 'ZONE' || d.assign.kind === 'SPY',
    ).length;
    if (covering === 0) problems.push('nobody is covering anybody — leave at least one defender in coverage');
    void deepest;
  }

  return problems;
}

// ── persistence ─────────────────────────────────────────────────────────────

function slotOk(slot: number): boolean {
  return Number.isInteger(slot) && slot >= 0 && slot < SLOTS_PER_SIDE;
}

/** Structural sanity for a play read back out of a save file. */
function playLooksSane(side: EditorSide, data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const p = data as Partial<OffensePlay & DefensePlay>;
  if (!Array.isArray(p.players) || p.players.length !== 7) return false;
  const off = 'page' in p;
  return side === 'OFF' ? off : !off;
}

/** Every custom play in the save, optionally filtered to one side. */
export function listCustom(side?: EditorSide): CustomPlay[] {
  const all = getSave().customPlays;
  if (!Array.isArray(all)) return [];
  const out = all.filter((c) => c && slotOk(c.slot) && (side === undefined || c.side === side));
  return out.slice().sort((a, b) => a.slot - b.slot);
}

/** The play saved in (side, slot), or null. Broken entries read as empty. */
export function loadCustom(side: EditorSide, slot: number): CustomPlay | null {
  if (!slotOk(slot)) return null;
  const found = getSave().customPlays.find((c) => c && c.side === side && c.slot === slot);
  if (!found || !playLooksSane(side, found.data)) return null;
  return found;
}

/**
 * Write a play into (side, slot). Overwrites an existing entry in that slot;
 * otherwise appends while the 18-play budget lasts. The play's id, slot and
 * page are restamped so a copied play never collides with its source.
 * Returns the stored entry, or null if the write was refused.
 */
export function saveCustom(
  side: EditorSide, slot: number, play: OffensePlay | DefensePlay, name?: string,
): CustomPlay | null {
  if (!slotOk(slot)) return null;
  if (isOffensePlay(play) !== (side === 'OFF')) return null;
  if (!Array.isArray(play.players) || play.players.length !== 7) return null;

  const data = clonePlay(play);
  data.id = customId(side, slot);
  data.slot = slot;
  data.name = sanitizeName(name ?? data.name) || (side === 'OFF' ? 'NEW PLAY' : 'NEW CALL');
  if (isOffensePlay(data)) {
    data.page = CUSTOM_PAGE;
    reassignTargets(data);
  }

  const save = getSave();
  if (!Array.isArray(save.customPlays)) save.customPlays = [];
  const entry: CustomPlay = { id: data.id, name: data.name, side, slot, data };
  const at = save.customPlays.findIndex((c) => c && c.side === side && c.slot === slot);
  if (at >= 0) {
    save.customPlays[at] = entry;
  } else {
    const sameSide = save.customPlays.filter((c) => c && c.side === side).length;
    if (sameSide >= SLOTS_PER_SIDE) return null;
    if (save.customPlays.length >= MAX_CUSTOM_PLAYS) return null;
    save.customPlays.push(entry);
  }
  writeSave();
  return entry;
}

/** Clear a slot. Returns true if something was actually removed. */
export function deleteCustom(side: EditorSide, slot: number): boolean {
  if (!slotOk(slot)) return false;
  const save = getSave();
  if (!Array.isArray(save.customPlays)) return false;
  const before = save.customPlays.length;
  save.customPlays = save.customPlays.filter((c) => !(c && c.side === side && c.slot === slot));
  if (save.customPlays.length === before) return false;
  writeSave();
  return true;
}

/** Duplicate a saved play into another slot on the same side. */
export function copyCustom(side: EditorSide, fromSlot: number, toSlot: number): CustomPlay | null {
  const src = loadCustom(side, fromSlot);
  if (!src) return null;
  const copy = clonePlay(src.data as OffensePlay | DefensePlay);
  return saveCustom(side, toSlot, copy, `${src.name} B`.slice(0, MAX_NAME_LENGTH));
}

/** Rename in place. Returns the new name, or null if the slot is empty. */
export function renameCustom(side: EditorSide, slot: number, name: string): string | null {
  const cur = loadCustom(side, slot);
  if (!cur) return null;
  const stored = saveCustom(side, slot, cur.data as OffensePlay | DefensePlay, name);
  return stored ? stored.name : null;
}

/** Saved offensive plays as plain plays, for `Match`'s customOffense option. */
export function customOffensePlays(): OffensePlay[] {
  return listCustom('OFF')
    .map((c) => c.data as OffensePlay)
    .filter((p) => Array.isArray(p.players) && p.players.length === 7);
}

/** Saved defensive calls as plain plays. */
export function customDefensePlays(): DefensePlay[] {
  return listCustom('DEF')
    .map((c) => c.data as DefensePlay)
    .filter((p) => Array.isArray(p.players) && p.players.length === 7);
}

/** First free slot on a side, or -1 when all nine are used. */
export function firstFreeSlot(side: EditorSide): number {
  const used = new Set(listCustom(side).map((c) => c.slot));
  for (let i = 0; i < SLOTS_PER_SIDE; i++) if (!used.has(i)) return i;
  return -1;
}
