/**
 * GRIDIRON OVERDRIVE — playbook facade.
 *
 * One import for everything that needs a play: the AI caller, the play-select
 * wheel, the play editor and the headless sim all come through here.
 */

import type { CustomPlay, DefensePlay, OffensePlay } from '../core/types.ts';
import { FIELD_HALF_WIDTH } from '../core/constants.ts';
import { DEFENSE_FORMATIONS, OFFENSE_FORMATIONS } from './formations.ts';
import { DEFENSE_PAGE, DEFENSE_PLAYS } from './defense.ts';
import { OFFENSE_PAGES, OFFENSE_PLAYS } from './offense.ts';
import { SPECIAL_DEFENSE, SPECIAL_OFFENSE, SPECIAL_PLAYS } from './special.ts';

export { OFFENSE_PLAYS, OFFENSE_PAGES } from './offense.ts';
export { DEFENSE_PLAYS, DEFENSE_PAGE } from './defense.ts';
export { SPECIAL_PLAYS } from './special.ts';

/** Slots per wheel page. */
export const PAGE_SIZE = 9;
/** Number of selectable offensive pages, not counting the custom page. */
export const OFFENSE_PAGE_COUNT = 3;
/** Page index reserved for player-authored plays. */
export const CUSTOM_PAGE = 3;

// ── lookup ─────────────────────────────────────────────────────────────────

const OFF_BY_ID = new Map<string, OffensePlay>();
for (const p of OFFENSE_PLAYS) OFF_BY_ID.set(p.id, p);
for (const p of SPECIAL_OFFENSE) OFF_BY_ID.set(p.id, p);

const DEF_BY_ID = new Map<string, DefensePlay>();
for (const p of DEFENSE_PLAYS) DEF_BY_ID.set(p.id, p);
for (const p of SPECIAL_DEFENSE) DEF_BY_ID.set(p.id, p);

/** Look up an offensive call. Falls back to the base run so a bad id never stalls a drive. */
export function getOffensePlay(id: string): OffensePlay {
  return OFF_BY_ID.get(id) ?? OFFENSE_PLAYS[0];
}

/** Look up a defensive call. Falls back to the base four-man front. */
export function getDefensePlay(id: string): DefensePlay {
  return DEF_BY_ID.get(id) ?? DEFENSE_PLAYS[0];
}

/** Offensive call by wheel coordinates. */
export function offensePlayAt(page: number, slot: number, custom?: CustomPlay[]): OffensePlay {
  return offensePage(page, custom)[Math.max(0, Math.min(PAGE_SIZE - 1, slot | 0))];
}

/** Defensive call by wheel slot (0-8 shown, 9-13 reachable from the extended pool). */
export function defensePlayAt(slot: number): DefensePlay {
  const i = Math.max(0, Math.min(DEFENSE_PLAYS.length - 1, slot | 0));
  return DEFENSE_PLAYS[i];
}

/**
 * The nine plays shown on a wheel page. Page 3 is the custom page: authored
 * plays fill their own slots and any empty slot falls back to the page-0 play
 * of the same index, so the wheel is never blank.
 */
export function offensePage(page: number, custom?: CustomPlay[]): OffensePlay[] {
  const p = page | 0;
  if (p >= 0 && p < OFFENSE_PAGE_COUNT) return OFFENSE_PAGES[p];

  const out = OFFENSE_PAGES[0].slice();
  if (custom) {
    for (const c of custom) {
      if (c.side !== 'OFF') continue;
      if (c.slot < 0 || c.slot >= PAGE_SIZE) continue;
      const data = c.data as OffensePlay;
      if (!Array.isArray(data.players)) continue;
      out[c.slot] = data;
    }
  }
  return out;
}

// ── audibles ───────────────────────────────────────────────────────────────
//
// Three offensive and three defensive calls reachable at the line without
// re-opening the wheel: one to stay on schedule, one to take what is given,
// one to change the game.

/** [ run, quick pass, deep shot ] */
export const DEFAULT_AUDIBLES_OFF: string[] = [
  'o-anvil-dive',
  'o-quick-nails',
  'o-cannonball',
];

/** [ press man, three-deep zone, edge pressure ] */
export const DEFAULT_AUDIBLES_DEF: string[] = [
  'd-iron-lock',
  'd-triple-sky',
  'd-corner-storm',
];

// ── validation ─────────────────────────────────────────────────────────────

/** Widest legal position for anybody, with a little sideline margin. */
const X_LIMIT = FIELD_HALF_WIDTH - 0.4;
/** Deepest a route may reach past the LOS, and furthest it may drop behind it. */
const Z_MAX = 62;
const Z_MIN = -16;

function isOffense(p: OffensePlay | DefensePlay): p is OffensePlay {
  return 'page' in p;
}

function n2(v: number): boolean {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Structural check for a play from any source — the shipped playbook, the play
 * editor, or a save file written by an older build. Returns a list of
 * human-readable problems; an empty list means the play is safe to run.
 */
export function validatePlay(p: OffensePlay | DefensePlay): string[] {
  const problems: string[] = [];
  const label = p.id || '(no id)';

  if (!p.id) problems.push('play has no id');
  if (!p.name) problems.push(`${label}: play has no name`);
  if (!Array.isArray(p.players) || p.players.length !== 7) {
    problems.push(`${label}: expected 7 players, found ${p.players?.length ?? 0}`);
    return problems; // everything below assumes a full unit
  }

  if (isOffense(p)) validateOffense(p, label, problems);
  else validateDefense(p, label, problems);

  return problems;
}

function validateOffense(p: OffensePlay, label: string, problems: string[]): void {
  if (!(p.formation in OFFENSE_FORMATIONS)) {
    problems.push(`${label}: unknown formation "${p.formation}"`);
  }
  if (p.page < 0 || p.page > CUSTOM_PAGE) problems.push(`${label}: page ${p.page} out of range`);
  if (p.slot < 0 || p.slot >= PAGE_SIZE) problems.push(`${label}: slot ${p.slot} out of range`);

  const seen = new Set<number>();
  let qbCount = 0;

  for (let i = 0; i < p.players.length; i++) {
    const pl = p.players[i];
    const who = `${label}: player ${i}`;

    if (!n2(pl.align.x) || !n2(pl.align.z)) { problems.push(`${who} has a non-finite alignment`); continue; }
    if (Math.abs(pl.align.x) > X_LIMIT) {
      problems.push(`${who} aligns out of bounds at x=${pl.align.x.toFixed(1)}`);
    }
    // Split ends and gunners stand on the line; nobody may be past it.
    if (pl.align.z > 0.35) problems.push(`${who} aligns past the line of scrimmage at z=${pl.align.z}`);

    if (pl.role === 'QB') qbCount++;

    const eligible = pl.role !== 'QB' && pl.role !== 'LINE';
    if (!eligible && pl.target !== null) {
      problems.push(`${who} is a ${pl.role} but carries target ${pl.target}`);
    }
    if (eligible) {
      if (pl.target === null) problems.push(`${who} is eligible but has no target button`);
      else if (seen.has(pl.target)) problems.push(`${who} duplicates target ${pl.target}`);
      else seen.add(pl.target);
    }

    if (!Array.isArray(pl.route) || pl.route.length === 0) {
      problems.push(`${who} has no route`);
      continue;
    }
    for (let k = 0; k < pl.route.length; k++) {
      const nd = pl.route[k];
      if (!n2(nd.x) || !n2(nd.z)) { problems.push(`${who} node ${k} is non-finite`); continue; }
      const ax = pl.align.x + nd.x;
      if (Math.abs(ax) > X_LIMIT) {
        problems.push(`${who} route node ${k} leaves the field at x=${ax.toFixed(1)}`);
      }
      if (nd.z > Z_MAX || nd.z < Z_MIN) {
        problems.push(`${who} route node ${k} has illegal depth z=${nd.z}`);
      }
      if (nd.hold !== undefined && (!n2(nd.hold) || nd.hold < 0)) {
        problems.push(`${who} route node ${k} has a bad hold`);
      }
    }
  }

  if (qbCount !== 1) problems.push(`${label}: expected exactly 1 QB, found ${qbCount}`);
  if (seen.size !== 3) {
    problems.push(`${label}: expected 3 pass targets, found ${seen.size}`);
  } else if (!seen.has(0) || !seen.has(1) || !seen.has(2)) {
    problems.push(`${label}: targets must be exactly 0, 1 and 2`);
  }

  // Targets are stamped left-to-right by pre-snap x.
  const order = p.players
    .map((pl, i) => ({ i, x: pl.align.x, t: pl.target }))
    .filter((e) => e.t !== null)
    .sort((a, b) => a.x - b.x);
  for (let k = 0; k < order.length; k++) {
    if (order[k].t !== k) {
      problems.push(`${label}: player ${order[k].i} should hold target ${k}, holds ${order[k].t}`);
    }
  }

  for (const r of p.reads) {
    if (r < 0 || r >= 7) problems.push(`${label}: read index ${r} out of range`);
    else if (p.players[r].target === null) {
      problems.push(`${label}: read index ${r} points at a player who is not a target`);
    }
  }
  if (p.reads[0] === p.reads[1]) problems.push(`${label}: both reads point at the same player`);

  if (p.timing.primary <= 0) problems.push(`${label}: primary timing must be positive`);
  if (p.timing.secondary <= p.timing.primary) {
    problems.push(`${label}: secondary read must come after the primary`);
  }
  if (p.shortYardage < 0 || p.shortYardage > 1) problems.push(`${label}: shortYardage out of 0..1`);
  if (p.deepShot < 0 || p.deepShot > 1) problems.push(`${label}: deepShot out of 0..1`);
  if (p.tags.length === 0) problems.push(`${label}: play has no tags`);
}

function validateDefense(p: DefensePlay, label: string, problems: string[]): void {
  if (!(p.formation in DEFENSE_FORMATIONS)) {
    problems.push(`${label}: unknown defensive formation "${p.formation}"`);
  }
  if (p.slot < 0) problems.push(`${label}: slot ${p.slot} out of range`);

  for (let i = 0; i < p.players.length; i++) {
    const pl = p.players[i];
    const who = `${label}: defender ${i}`;
    if (!n2(pl.align.x) || !n2(pl.align.z)) { problems.push(`${who} has a non-finite alignment`); continue; }
    if (Math.abs(pl.align.x) > X_LIMIT) {
      problems.push(`${who} aligns out of bounds at x=${pl.align.x.toFixed(1)}`);
    }
    if (pl.align.z < 0.8) problems.push(`${who} aligns offside at z=${pl.align.z}`);

    const a = pl.assign;
    switch (a.kind) {
      case 'RUSH':
        if (a.lane < -1 || a.lane > 1) problems.push(`${who} rush lane ${a.lane} out of -1..1`);
        break;
      case 'MAN':
        if (a.slot < 0 || a.slot > 2) problems.push(`${who} covers unknown skill slot ${a.slot}`);
        break;
      case 'ZONE':
        if (a.r <= 0) problems.push(`${who} zone has a non-positive radius`);
        if (Math.abs(a.x) > FIELD_HALF_WIDTH + 6) problems.push(`${who} zone centre is off the field`);
        if (a.z < 0) problems.push(`${who} zone centre is behind the line of scrimmage`);
        break;
      case 'BLITZ_DELAY':
        if (a.lane < -1 || a.lane > 1) problems.push(`${who} delay lane ${a.lane} out of -1..1`);
        if (a.delay < 0) problems.push(`${who} has a negative delay`);
        break;
      case 'CONTAIN':
      case 'SPY':
        break;
    }
  }

  if (p.aggression < 0 || p.aggression > 1) problems.push(`${label}: aggression out of 0..1`);
  if (p.deepHelp < 0 || p.deepHelp > 1) problems.push(`${label}: deepHelp out of 0..1`);
  if (p.tags.length === 0) problems.push(`${label}: play has no tags`);
}

/** Everything the playbook ships, for QA sweeps and the play viewer. */
export function allPlays(): (OffensePlay | DefensePlay)[] {
  return [
    ...OFFENSE_PLAYS,
    ...DEFENSE_PLAYS,
    ...SPECIAL_OFFENSE,
    ...SPECIAL_DEFENSE,
  ];
}

/** Convenience for the AI caller: every offensive play carrying a tag. */
export function offenseByTag(tag: OffensePlay['tags'][number]): OffensePlay[] {
  return OFFENSE_PLAYS.filter((p) => p.tags.includes(tag));
}

/** Convenience for the AI caller: every defensive play carrying a tag. */
export function defenseByTag(tag: DefensePlay['tags'][number]): DefensePlay[] {
  return DEFENSE_PLAYS.filter((p) => p.tags.includes(tag));
}

/** The defensive calls shown on the wheel, kept beside the offensive pages. */
export const DEFENSE_WHEEL: DefensePlay[] = DEFENSE_PAGE;

/** Re-exported so callers need only one import for the special-teams table. */
export const SPECIALS = SPECIAL_PLAYS;
