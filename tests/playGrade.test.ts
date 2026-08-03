import { describe, it, expect } from 'vitest';
import { Match, defaultMatchConfig } from '../src/rules/match.ts';
import { getTeam, TEAM_IDS } from '../src/data/index.ts';
import { PlayGradeTracker } from '../src/gameplay/playGrade.ts';
import { recommendCards } from '../src/gameplay/playRecommendation.ts';
import { OFFENSE_PLAYS } from '../src/plays/offense.ts';

function cpuMatch(seed: number): Match {
  const cfg = defaultMatchConfig({
    seed, quarterSeconds: 120, difficulty: 'PRO',
    home: TEAM_IDS[0], away: TEAM_IDS[1],
    seats: [{ side: 0, active: false }, { side: 1, active: false }],
  });
  return new Match({ config: cfg, home: getTeam(cfg.home!), away: getTeam(cfg.away!), seatIntent: () => null });
}

describe('play grade facts', () => {
  it('produces one fact per resolved throw, with evidence, deterministically', () => {
    const run = () => {
      const m = cpuMatch(4242);
      const tracker = new PlayGradeTracker(m);
      for (let i = 0; i < 60000 && !m.state.finished; i++) m.tick();
      tracker.dispose();
      return tracker.facts;
    };
    const a = run();
    const b = run();
    expect(a.length).toBeGreaterThan(10);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));   // pure derivation, no dice of its own
    for (const f of a) {
      expect(f.evidence.length).toBeGreaterThan(0);
      expect(['CAUGHT', 'DROPPED', 'SWATTED', 'DEFENDER_POSSESSION', 'FELL_INCOMPLETE', 'SACKED'])
        .toContain(f.result);
      // No fake precision: a low-confidence fact never asserts leverage labels it cannot support.
      if (f.result !== 'SACKED' && f.confidence === 'HIGH' && f.opennessAtRelease !== undefined) {
        expect(f.leverage).toBeDefined();
        expect(f.releaseTiming).toBeDefined();
        expect(f.pressure).toBeDefined();
      }
    }
  });
});

describe('three-card recommendation', () => {
  it('offers three distinct risk bands with reasons, using observable context only', () => {
    const m = cpuMatch(9);
    for (let i = 0; i < 5000 && m.state.phase !== 'PLAY_CALL'; i++) m.tick();
    const cards = recommendCards(OFFENSE_PLAYS, m.state);
    expect(cards).toHaveLength(3);
    expect(cards.map((c) => c.role)).toEqual(['SAFE', 'BALANCED', 'SHOT']);
    const ids = new Set(cards.map((c) => c.play.id));
    expect(ids.size).toBe(3);
    for (const c of cards) expect(c.reason.length).toBeGreaterThan(4);
  });

  it('rotates suggestions under repetition instead of fossilizing', () => {
    const m = cpuMatch(9);
    for (let i = 0; i < 5000 && m.state.phase !== 'PLAY_CALL'; i++) m.tick();
    const first = recommendCards(OFFENSE_PLAYS, m.state);
    const again = recommendCards(OFFENSE_PLAYS, m.state, [first[0].play.id, first[1].play.id, first[2].play.id]);
    // At least one card changes when its play was just called (variety pressure, not a ban).
    const changed = again.some((c, i) => c.play.id !== first[i].play.id);
    expect(changed).toBe(true);
  });
});
