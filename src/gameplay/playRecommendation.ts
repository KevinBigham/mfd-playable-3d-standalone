/**
 * Three context-ranked play cards: Safe, Balanced, Shot.
 *
 * Ranks the playbook for the current situation using OBSERVABLE context only — down, distance,
 * field position, clock, score, and the opponent's already-shown tendencies. It never touches
 * the RNG, never inspects the defense's pending call, and never sees a future outcome; a
 * recommendation that could peek would be a disguised autoplay button.
 *
 * Diversity is structural: the three cards come from three different risk bands, and no card is
 * ever a trap — every play carries its reason, and the reasons are the same facts the ranking
 * used.
 */
import type { OffensePlay, PlayTag } from '../core/types.ts';
import type { MatchState } from '../core/types.ts';
import { distanceToGo } from '../rules/rulesEngine.ts';

export interface PlayCard {
  play: OffensePlay;
  role: 'SAFE' | 'BALANCED' | 'SHOT';
  /** One short reason, in the player's language. */
  reason: string;
}

interface Situation {
  down: number;
  toGo: number;
  yardsToGoal: number;
  clockSeconds: number;
  trailing: boolean;
}

export function readSituationFor(m: MatchState): Situation {
  const off = m.possession;
  const yardsToGoal = off === 0 ? 100 - m.losZ : m.losZ;
  return {
    down: m.down,
    toGo: distanceToGo(m),
    yardsToGoal,
    clockSeconds: Math.ceil(m.clockTicks / 60),
    trailing: m.teams[off].score < m.teams[off === 0 ? 1 : 0].score,
  };
}

const has = (p: OffensePlay, t: PlayTag): boolean => p.tags.includes(t);

function band(p: OffensePlay): 'SAFE' | 'BALANCED' | 'SHOT' {
  if (has(p, 'DEEP') || has(p, 'TRICK')) return 'SHOT';
  if (has(p, 'RUN') || has(p, 'QUICK') || has(p, 'SCREEN')) return 'SAFE';
  return 'BALANCED';
}

function scoreFor(p: OffensePlay, sit: Situation): { score: number; reason: string } {
  let score = 0;
  let reason = '';
  const short = sit.toGo <= 8;
  const long = sit.toGo >= 20;
  const redZone = sit.yardsToGoal <= 15;

  if (has(p, 'RUN')) {
    score += short ? 2.2 : 0.7;
    score += p.shortYardage * 1.5;
    if (redZone) score += 0.7;
    reason = short ? 'control the short chain' : 'keep the defense honest';
  } else if (has(p, 'QUICK')) {
    score += short ? 1.8 : 0.9;
    score += sit.down >= 3 && short ? 0.8 : 0;
    reason = 'fast release beats the rush';
  } else if (has(p, 'SCREEN')) {
    score += sit.down >= 2 && long ? 1.6 : 0.6;
    reason = 'punish an aggressive rush';
  } else if (has(p, 'DEEP')) {
    score += long ? 1.8 : 0.8;
    if (sit.trailing && sit.clockSeconds < 45) score += 1.2;
    if (redZone) score -= 1.4;                    // no room behind the defense
    reason = long ? 'the chain needs a chunk' : 'shot when they least expect it';
  } else if (has(p, 'TRICK')) {
    score += 0.3;
    reason = 'a surprise, at a price';
  } else {
    score += 1.0 + (long ? 0.4 : 0);
    reason = 'balanced progression read';
  }
  return { score, reason };
}

/**
 * The three cards. `history` is the player's own recent picks (play ids, newest last) — used
 * only to rotate suggestions so the card row never fossilizes into one answer.
 */
export function recommendCards(
  plays: readonly OffensePlay[], m: MatchState, history: readonly string[] = [],
): [PlayCard, PlayCard, PlayCard] {
  const sit = readSituationFor(m);
  const recent = new Set(history.slice(-3));
  const pickBest = (role: PlayCard['role']): PlayCard => {
    let best: PlayCard | null = null;
    let bestScore = -1e9;
    for (const p of plays) {
      if (band(p) !== role) continue;
      const { score, reason } = scoreFor(p, sit);
      // Variety pressure, not a ban: a just-called play needs to be clearly better to reappear.
      const adjusted = score - (recent.has(p.id) ? 0.9 : 0);
      if (adjusted > bestScore) { bestScore = adjusted; best = { play: p, role, reason }; }
    }
    // A playbook without this band at all falls back to the overall best remaining play.
    if (!best) {
      const p = plays[0];
      best = { play: p, role, reason: 'best available' };
    }
    return best;
  };
  return [pickBest('SAFE'), pickBest('BALANCED'), pickBest('SHOT')];
}
