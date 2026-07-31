import { describe, it, expect } from 'vitest';
import { Rng } from '../core/rng.ts';
import { TEAM_IDS } from '../data/index.ts';
import type { TournamentSave } from '../persistence/save.ts';
import {
  BYE, advanceRound, bracketSeedOrder, createTournament, isComplete, isHumanMatch,
  isValidTournament, matchWinner, nextMatch, reportResult, roundName, seatsFor,
  simulateCpuMatch, totalRounds, winsNeeded,
} from './tournament.ts';

function field(n: number, humans = 0, offset = 0): Array<{ teamId: string; human: boolean; seat: number }> {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({ teamId: TEAM_IDS[(i + offset) % TEAM_IDS.length], human: i < humans, seat: i < humans ? i : -1 });
  }
  return out;
}

interface PlayedGame { round: number; index: number; a: string; b: string; game: number }

/** Drive a whole bracket with a caller-supplied winner rule. */
function playOut(t: TournamentSave, pick: (a: string, b: string, game: number) => 'A' | 'B'): PlayedGame[] {
  const log: PlayedGame[] = [];
  for (let guard = 0; guard < 400; guard++) {
    advanceRound(t);
    const nm = nextMatch(t);
    if (!nm) break;
    const m = t.rounds[nm.round][nm.index];
    expect(m.done).toBe(false);
    const game = m.winsA + m.winsB;
    const w = pick(nm.a, nm.b, game);
    reportResult(t, nm.index, w === 'A' ? 1 : 0, w === 'B' ? 1 : 0);
    log.push({ round: nm.round, index: nm.index, a: nm.a, b: nm.b, game });
  }
  advanceRound(t);
  return log;
}

function losers(t: TournamentSave): Set<string> {
  const out = new Set<string>();
  for (const round of t.rounds) {
    for (const m of round) {
      if (!m.done) continue;
      const w = matchWinner(m);
      if (m.a !== BYE && m.a !== w) out.add(m.a);
      if (m.b !== BYE && m.b !== w) out.add(m.b);
    }
  }
  return out;
}

describe('bracket shape', () => {
  it('seeds 1 v n, 2 v (n-1) and keeps the top two apart until the final', () => {
    expect(bracketSeedOrder(4)).toEqual([1, 4, 2, 3]);
    expect(bracketSeedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    for (const size of [4, 8]) {
      const order = bracketSeedOrder(size);
      expect(new Set(order).size).toBe(size);
      // Halves: seed 1 in the top half, seed 2 in the bottom half.
      expect(order.indexOf(1)).toBeLessThan(size / 2);
      expect(order.indexOf(2)).toBeGreaterThanOrEqual(size / 2);
    }
  });

  it('lays out the right number of rounds and names them', () => {
    const t4 = createTournament({ size: 4, bestOf3: false, entrants: field(4), seed: 1 });
    expect(totalRounds(t4)).toBe(2);
    expect(t4.rounds[0].length).toBe(2);
    expect(roundName(t4, 0)).toBe('SEMI-FINALS');
    expect(roundName(t4, 1)).toBe('FINAL');

    const t8 = createTournament({ size: 8, bestOf3: false, entrants: field(8), seed: 1 });
    expect(totalRounds(t8)).toBe(3);
    expect(t8.rounds[0].length).toBe(4);
    expect(roundName(t8, 0)).toBe('QUARTER-FINALS');
    expect(t8.rounds[0][0].a).toBe(TEAM_IDS[0]);
    expect(t8.rounds[0][0].b).toBe(TEAM_IDS[7]);
    expect(t8.rounds[0][1].a).toBe(TEAM_IDS[3]);
    expect(t8.rounds[0][1].b).toBe(TEAM_IDS[4]);
  });
});

describe('a bracket always produces exactly one champion', () => {
  for (const size of [4, 8] as const) {
    for (const bestOf3 of [false, true]) {
      it(`${size}-team${bestOf3 ? ' best-of-3' : ''}`, () => {
        for (let seed = 1; seed <= 40; seed++) {
          const rng = new Rng(seed);
          const t = createTournament({ size, bestOf3, entrants: field(size, 0, seed), seed });
          playOut(t, () => (rng.chance(0.5) ? 'A' : 'B'));

          expect(t.champion).toBeTruthy();
          expect(isComplete(t)).toBe(true);
          expect(nextMatch(t)).toBeNull();
          expect(t.rounds.length).toBe(totalRounds(t));
          expect(t.rounds[t.rounds.length - 1].length).toBe(1);

          // Exactly one entrant never lost, and it is the champion.
          const beaten = losers(t);
          const unbeaten = t.entrants.filter((e) => !beaten.has(e.teamId));
          expect(unbeaten.length).toBe(1);
          expect(unbeaten[0].teamId).toBe(t.champion);
        }
      });
    }
  }

  it('gives byes in round one for a short field and still crowns one champion', () => {
    for (const count of [2, 3, 5, 6, 7]) {
      const t = createTournament({ size: 8, bestOf3: false, entrants: field(count, 0, count), seed: 9 });
      expect(t.entrants.length).toBe(count);
      const emptySlots = t.rounds[0].reduce((n, m) => n + (m.a === BYE ? 1 : 0) + (m.b === BYE ? 1 : 0), 0);
      expect(emptySlots).toBe(8 - count);
      const byes = t.rounds[0].filter((m) => m.a === BYE || m.b === BYE);
      for (const m of byes) expect(m.done).toBe(true);

      playOut(t, (a) => (a ? 'A' : 'B'));
      expect(t.champion).toBeTruthy();
      expect(t.entrants.some((e) => e.teamId === t.champion)).toBe(true);
      const beaten = losers(t);
      expect(t.entrants.filter((e) => !beaten.has(e.teamId)).length).toBe(1);
    }
  });

  it('crowns the only entrant when the field is a single team', () => {
    const t = createTournament({ size: 4, bestOf3: false, entrants: field(1), seed: 3 });
    expect(t.champion).toBe(TEAM_IDS[0]);
    expect(nextMatch(t)).toBeNull();
  });

  it('ignores duplicate entrants and an oversized field', () => {
    const dupes = [...field(4), ...field(4)];
    const t = createTournament({ size: 4, bestOf3: false, entrants: dupes, seed: 4 });
    expect(t.entrants.length).toBe(4);
    expect(new Set(t.entrants.map((e) => e.teamId)).size).toBe(4);
  });
});

describe('best-of-3 needs two wins', () => {
  it('does not close a series on one win', () => {
    const t = createTournament({ size: 4, bestOf3: true, entrants: field(4), seed: 11 });
    expect(winsNeeded(t)).toBe(2);
    reportResult(t, 0, 1, 0);
    expect(t.rounds[0][0].done).toBe(false);
    expect(matchWinner(t.rounds[0][0])).toBe(BYE);
    reportResult(t, 0, 0, 1);
    expect(t.rounds[0][0].done).toBe(false);
    reportResult(t, 0, 1, 0);
    expect(t.rounds[0][0].done).toBe(true);
    expect(t.rounds[0][0].winsA).toBe(2);
    expect(t.rounds[0][0].winsB).toBe(1);
    expect(matchWinner(t.rounds[0][0])).toBe(t.rounds[0][0].a);
  });

  it('closes a single-game series on one win', () => {
    const t = createTournament({ size: 4, bestOf3: false, entrants: field(4), seed: 12 });
    expect(winsNeeded(t)).toBe(1);
    reportResult(t, 0, 0, 1);
    expect(t.rounds[0][0].done).toBe(true);
    expect(matchWinner(t.rounds[0][0])).toBe(t.rounds[0][0].b);
  });

  it('never over-credits, never ends level, never exceeds the series length', () => {
    const t = createTournament({ size: 4, bestOf3: true, entrants: field(4), seed: 13 });
    reportResult(t, 0, 5, 5);
    const m = t.rounds[0][0];
    expect(m.done).toBe(true);
    expect(m.winsA).toBe(2);
    expect(m.winsB).toBe(0);
    expect(m.winsA + m.winsB).toBeLessThanOrEqual(3);
  });
});

describe('no match is ever played twice', () => {
  it('never re-offers a finished match and never repeats a pairing', () => {
    for (const bestOf3 of [false, true]) {
      for (let seed = 1; seed <= 25; seed++) {
        const rng = new Rng(seed * 31);
        const t = createTournament({ size: 8, bestOf3, entrants: field(8, 0, seed), seed });
        const log = playOut(t, () => (rng.chance(0.5) ? 'A' : 'B'));
        const need = winsNeeded(t);

        // A slot is only ever revisited to finish its own series, and the game
        // counter strictly increases each time it comes back up.
        const perSlot = new Map<string, number[]>();
        for (const g of log) {
          const key = `${g.round}:${g.index}`;
          const seenGames = perSlot.get(key) ?? [];
          expect(seenGames.includes(g.game)).toBe(false);
          seenGames.push(g.game);
          perSlot.set(key, seenGames);
        }
        for (const [, seenGames] of perSlot) {
          expect(seenGames.length).toBeLessThanOrEqual(need * 2 - 1);
          expect(seenGames).toEqual([...seenGames].sort((x, y) => x - y));
        }

        // Two teams never meet more than once across the whole ladder.
        const pairs = new Set<string>();
        for (const g of log) {
          const pair = [g.a, g.b].sort().join('|');
          if (g.game === 0) {
            expect(pairs.has(pair)).toBe(false);
            pairs.add(pair);
          }
        }
        expect(pairs.size).toBe(7);
        expect(log.length).toBeGreaterThanOrEqual(7);
        expect(log.length).toBeLessThanOrEqual(7 * (need * 2 - 1));
      }
    }
  });

  it('drops results reported into a finished match', () => {
    const t = createTournament({ size: 4, bestOf3: false, entrants: field(4), seed: 21 });
    reportResult(t, 0, 1, 0);
    const snapshot = JSON.stringify(t.rounds[0][0]);
    reportResult(t, 0, 0, 1);
    reportResult(t, 0, 1, 0);
    expect(JSON.stringify(t.rounds[0][0])).toBe(snapshot);
  });

  it('advanceRound is a no-op while the round is live and idempotent once done', () => {
    const t = createTournament({ size: 4, bestOf3: false, entrants: field(4), seed: 22 });
    expect(advanceRound(t)).toBe(false);
    expect(t.rounds.length).toBe(1);
    reportResult(t, 0, 1, 0);
    expect(advanceRound(t)).toBe(false);
    reportResult(t, 1, 1, 0);
    expect(advanceRound(t)).toBe(true);
    expect(t.rounds.length).toBe(2);
    expect(advanceRound(t)).toBe(false);
    reportResult(t, 0, 1, 0);
    expect(advanceRound(t)).toBe(true);
    expect(t.champion).toBe(t.rounds[1][0].a);
    expect(advanceRound(t)).toBe(false);
  });
});

describe('save round-trip', () => {
  it('restores from JSON identically and keeps playing the same way', () => {
    for (const bestOf3 of [false, true]) {
      const rngA = new Rng(77);
      const t = createTournament({ size: 8, bestOf3, entrants: field(8, 2), seed: 4242 });
      // Play part of the ladder, then freeze it.
      for (let i = 0; i < 5; i++) {
        advanceRound(t);
        const nm = nextMatch(t);
        if (!nm) break;
        reportResult(t, nm.index, rngA.chance(0.5) ? 1 : 0, 0);
        reportResult(t, nm.index, 0, 1);
      }
      const json = JSON.stringify(t);
      const restored = JSON.parse(json) as TournamentSave;
      expect(restored).toEqual(t);
      expect(JSON.stringify(restored)).toBe(json);
      expect(isValidTournament(restored)).toBe(true);

      // Both copies, driven the same way, stay identical to the champion.
      const pick = (): 'A' | 'B' => 'A';
      playOut(t, pick);
      playOut(restored, pick);
      expect(restored).toEqual(t);
      expect(restored.champion).toBe(t.champion);
      expect(restored.champion).toBeTruthy();
      expect(JSON.parse(JSON.stringify(restored))).toEqual(restored);
    }
  });

  it('rejects a corrupt bracket', () => {
    const t = createTournament({ size: 8, bestOf3: false, entrants: field(8), seed: 5 });
    expect(isValidTournament(t)).toBe(true);
    expect(isValidTournament(null)).toBe(false);
    const bad = JSON.parse(JSON.stringify(t)) as TournamentSave;
    bad.rounds[0][0].a = 'city-of-nowhere';
    expect(isValidTournament(bad)).toBe(false);
    const bad2 = JSON.parse(JSON.stringify(t)) as TournamentSave;
    bad2.round = 9;
    expect(isValidTournament(bad2)).toBe(false);
    const bad3 = JSON.parse(JSON.stringify(t)) as TournamentSave;
    bad3.size = 6;
    expect(isValidTournament(bad3)).toBe(false);
  });
});

describe('seats and human matches', () => {
  it('routes each human to its own seat on the right side', () => {
    const t = createTournament({
      size: 4,
      bestOf3: false,
      seed: 8,
      entrants: [
        { teamId: TEAM_IDS[0], human: true, seat: 0 },
        { teamId: TEAM_IDS[1], human: true, seat: 1 },
        { teamId: TEAM_IDS[2], human: false, seat: -1 },
        { teamId: TEAM_IDS[3], human: false, seat: -1 },
      ],
    });
    // Seeds 1 v 4 and 2 v 3 — each round-one match has exactly one human.
    const m0 = t.rounds[0][0];
    const seats = seatsFor(t, m0);
    expect(seats.length).toBe(4);
    expect(seats[0]).toEqual({ side: 0, active: true });
    expect(seats.filter((s) => s.active).length).toBe(1);
    expect(isHumanMatch(t, m0)).toBe(true);

    // A head-to-head between the two humans puts them on opposite sides.
    const derby = { a: TEAM_IDS[0], b: TEAM_IDS[1] };
    const dseats = seatsFor(t, derby);
    expect(dseats[0]).toEqual({ side: 0, active: true });
    expect(dseats[1]).toEqual({ side: 1, active: true });
    expect(dseats.filter((s) => s.active).length).toBe(2);

    // CPU-only matches leave every seat idle.
    expect(isHumanMatch(t, { a: TEAM_IDS[2], b: TEAM_IDS[3] })).toBe(false);
    expect(seatsFor(t, { a: TEAM_IDS[2], b: TEAM_IDS[3] }).some((s) => s.active)).toBe(false);
  });

  it('re-homes humans that share a seat number and ignores byes', () => {
    const t = createTournament({
      size: 4,
      bestOf3: false,
      seed: 8,
      entrants: [
        { teamId: TEAM_IDS[0], human: true, seat: 2 },
        { teamId: TEAM_IDS[1], human: true, seat: 2 },
        { teamId: TEAM_IDS[2], human: false, seat: -1 },
        { teamId: TEAM_IDS[3], human: false, seat: -1 },
      ],
    });
    const seats = seatsFor(t, { a: TEAM_IDS[0], b: TEAM_IDS[1] });
    const active = seats.map((s, i) => ({ ...s, i })).filter((s) => s.active);
    expect(active.length).toBe(2);
    expect(active[0].i).not.toBe(active[1].i);
    expect(new Set(active.map((s) => s.side)).size).toBe(2);
    expect(seatsFor(t, { a: TEAM_IDS[0], b: BYE }).filter((s) => s.active).length).toBe(1);
  });
});

describe('CPU games come from the real engine', () => {
  it('plays a whole four-team ladder headlessly and crowns a champion', () => {
    const t = createTournament({ size: 4, bestOf3: false, entrants: field(4, 0, 2), seed: 31337 });
    let played = 0;
    for (let guard = 0; guard < 20; guard++) {
      advanceRound(t);
      const nm = nextMatch(t);
      if (!nm) break;
      const m = t.rounds[nm.round][nm.index];
      const r = simulateCpuMatch(t, nm.a, nm.b, (nm.round * 97 + nm.index * 13 + 1) >>> 0, { quarterSeconds: 60 });
      expect(r.a).toBeGreaterThanOrEqual(0);
      expect(r.b).toBeGreaterThanOrEqual(0);
      expect(r.a).not.toBe(r.b);
      reportResult(t, nm.index, r.a > r.b ? 1 : 0, r.b > r.a ? 1 : 0);
      expect(m.done).toBe(true);
      played++;
    }
    advanceRound(t);
    expect(played).toBe(3);
    expect(t.champion).toBeTruthy();
    expect(t.entrants.some((e) => e.teamId === t.champion)).toBe(true);
  }, 120000);

  it('is deterministic for a given seed and resolves byes without simulating', () => {
    const t = createTournament({ size: 4, bestOf3: false, entrants: field(4), seed: 5 });
    const a = simulateCpuMatch(t, TEAM_IDS[0], TEAM_IDS[1], 2024, { quarterSeconds: 60 });
    const b = simulateCpuMatch(t, TEAM_IDS[0], TEAM_IDS[1], 2024, { quarterSeconds: 60 });
    expect(a).toEqual(b);
    expect(simulateCpuMatch(t, TEAM_IDS[0], BYE, 1)).toEqual({ a: 1, b: 0 });
    expect(simulateCpuMatch(t, BYE, TEAM_IDS[0], 1)).toEqual({ a: 0, b: 1 });
  }, 120000);
});
