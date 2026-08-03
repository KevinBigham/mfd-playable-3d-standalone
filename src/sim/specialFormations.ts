import type { DefensePlay, OffensePlay, OffensePlayerPlan, DefensePlayerPlan } from '../core/types.ts';

/**
 * Self-contained special-teams formations. Kept in sim/ so the kicking game never depends on
 * playbook authoring, which keeps the rules path robust.
 * Alignments use the offense-forward frame: +x offense right, +z downfield.
 */

function off(role: OffensePlayerPlan['role'], x: number, z: number, target: 0 | 1 | 2 | null = null): OffensePlayerPlan {
  return { role, align: { x, z }, route: [], target, blockDir: 0 };
}
function def(x: number, z: number, assign: DefensePlayerPlan['assign']): DefensePlayerPlan {
  return { align: { x, z }, assign };
}

function makeOffense(id: string, name: string, players: OffensePlayerPlan[], formation: string): OffensePlay {
  return {
    id, name, page: 3, slot: 0, formation, tags: ['CLOCK'],
    players, timing: { primary: 30, secondary: 60 }, reads: [1, 2],
    shortYardage: 0, deepShot: 0,
  };
}
function makeDefense(id: string, name: string, players: DefensePlayerPlan[], formation: string): DefensePlay {
  return { id, name, slot: 0, formation, tags: ['SPECIAL'], players, aggression: 0.5, deepHelp: 0.5 };
}

// ── kickoff ────────────────────────────────────────────────────────────────
// Offense = kicking team. Kicker in slot 0 (roster kicker substituted by the match).
export const KICKOFF_OFFENSE: OffensePlay = makeOffense('sp.kickoff', 'Kickoff', [
  off('QB', 0, -6),
  off('WIDE', -20, 0), off('WIDE', -11, 0), off('WIDE', 11, 0),
  off('WIDE', 20, 0), off('LINE', -4, 0), off('LINE', 4, 0),
], 'KICK_TEAM');

export const KICKOFF_DEFENSE: DefensePlay = makeDefense('sp.kickReturn', 'Kick Return', [
  def(0, 58, { kind: 'SPY' }),
  def(-13, 40, { kind: 'CONTAIN', side: -1 }), def(13, 40, { kind: 'CONTAIN', side: 1 }),
  def(-20, 26, { kind: 'ZONE', x: -20, z: 26, r: 8 }), def(20, 26, { kind: 'ZONE', x: 20, z: 26, r: 8 }),
  def(-7, 22, { kind: 'ZONE', x: -7, z: 22, r: 8 }), def(7, 22, { kind: 'ZONE', x: 7, z: 22, r: 8 }),
], 'RETURN');

// ── punt ───────────────────────────────────────────────────────────────────
export const PUNT_OFFENSE: OffensePlay = makeOffense('sp.punt', 'Punt', [
  off('QB', 0, -11),
  off('WIDE', -22, 0), off('WIDE', 22, 0), off('BACK', 0, -4),
  off('LINE', -2.4, -0.6), off('LINE', 0, -0.6), off('LINE', 2.4, -0.6),
], 'PUNT');

export const PUNT_DEFENSE: DefensePlay = makeDefense('sp.puntReturn', 'Punt Return', [
  def(0, 42, { kind: 'SPY' }),
  def(-3, 1.4, { kind: 'RUSH', lane: -0.4 }), def(3, 1.4, { kind: 'RUSH', lane: 0.4 }),
  def(-18, 6, { kind: 'CONTAIN', side: -1 }), def(18, 6, { kind: 'CONTAIN', side: 1 }),
  def(-9, 16, { kind: 'ZONE', x: -9, z: 16, r: 9 }), def(9, 16, { kind: 'ZONE', x: 9, z: 16, r: 9 }),
], 'PUNT_RETURN');

// ── field goal / extra point ───────────────────────────────────────────────
export const FG_OFFENSE: OffensePlay = makeOffense('sp.fieldGoal', 'Field Goal', [
  off('QB', 0, -7),
  off('BACK', 0, -4.2), off('WIDE', -6, -0.6), off('WIDE', 6, -0.6),
  off('LINE', -2.4, -0.6), off('LINE', 0, -0.6), off('LINE', 2.4, -0.6),
], 'FG');

export const FG_DEFENSE: DefensePlay = makeDefense('sp.blockKick', 'Block Kick', [
  def(-1.2, 1.2, { kind: 'RUSH', lane: -0.2 }), def(1.2, 1.2, { kind: 'RUSH', lane: 0.2 }),
  def(-3.6, 1.2, { kind: 'RUSH', lane: -0.6 }), def(3.6, 1.2, { kind: 'RUSH', lane: 0.6 }),
  def(-7, 1.6, { kind: 'CONTAIN', side: -1 }), def(7, 1.6, { kind: 'CONTAIN', side: 1 }),
  def(0, 12, { kind: 'SPY' }),
], 'BLOCK');

// ── two-point / safety free kick reuse the normal playbook ─────────────────
export const FREE_KICK_OFFENSE = KICKOFF_OFFENSE;
export const FREE_KICK_DEFENSE = KICKOFF_DEFENSE;
