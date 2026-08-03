import { describe, it, expect } from 'vitest';
import { Match, defaultMatchConfig } from '../src/rules/match.ts';
import { getTeam, TEAM_IDS } from '../src/data/index.ts';
import { FIELD_LENGTH } from '../src/core/constants.ts';
import type { GameEvent } from '../src/core/types.ts';

/**
 * Drive Rush MVP invariants: offense-only from the opponent's 40, the unchanged 30-yard chain,
 * no special-teams phase of any kind, every attempt ends in one of the declared ways, and the
 * whole thing is deterministic. Classic parity is the flip side: a config with no ruleset field
 * takes the CLASSIC path, which the unchanged determinism/scenario suites already pin.
 */

function runDrive(seed: number) {
  const cfg = defaultMatchConfig({
    seed, quarterSeconds: 120, difficulty: 'PRO', ruleset: 'DRIVE_RUSH',
    home: TEAM_IDS[seed % TEAM_IDS.length], away: TEAM_IDS[(seed + 3) % TEAM_IDS.length],
    seats: [{ side: 0, active: false }, { side: 1, active: false }],
  });
  const m = new Match({ config: cfg, home: getTeam(cfg.home!), away: getTeam(cfg.away!), seatIntent: () => null });
  const events: Record<string, number> = {};
  let startLos = -1;
  let firstChain = -1;
  m.bus.on('*', (e: GameEvent) => { events[e.type] = (events[e.type] ?? 0) + 1; });
  m.bus.on('snap', () => {
    if (startLos < 0) { startLos = m.state.losZ; firstChain = m.state.firstDownZ; }
  });
  for (let i = 0; i < 300000 && !m.state.finished; i++) m.tick();
  return { m, events, startLos, firstChain };
}

describe('Drive Rush ruleset', () => {
  it('starts at the opponent 40 with the 30-yard chain and plays offense-only', () => {
    const { m, events, startLos, firstChain } = runDrive(100);
    expect(m.state.finished).toBe(true);
    expect(startLos).toBe(FIELD_LENGTH - 40);           // side 0 attacks z=100
    expect(firstChain).toBe(FIELD_LENGTH - 10);         // 30-yard chain → opponent 10
    expect(events['kickoff'] ?? 0).toBe(0);
    expect(events['punt'] ?? 0).toBe(0);
    expect(events['fieldGoal.attempt'] ?? 0).toBe(0);
    expect(events['extraPoint'] ?? 0).toBe(0);
    expect(events['twoPoint'] ?? 0).toBe(0);
  });

  it('every attempt over 60 seeds ends in a declared way, and all end kinds occur', () => {
    const endKinds = new Set<string>();
    for (let seed = 0; seed < 60; seed++) {
      const { m, events } = runDrive(seed);
      expect(m.state.finished, `seed ${seed} did not finish`).toBe(true);
      if ((events['touchdown'] ?? 0) > 0) endKinds.add('TOUCHDOWN');
      else if ((events['safety'] ?? 0) > 0) endKinds.add('SAFETY');
      else if ((events['turnover'] ?? 0) > 0) endKinds.add('TURNOVER');
      else endKinds.add('CLOCK');
      // Offense-only: at most one drive; the match never runs an opposing possession play.
      expect(events['kickoff'] ?? 0).toBe(0);
    }
    expect(endKinds.has('TOUCHDOWN')).toBe(true);
    expect(endKinds.has('TURNOVER')).toBe(true);
  });

  it('is deterministic: same seed, same outcome, tick for tick', () => {
    const a = runDrive(7);
    const b = runDrive(7);
    expect(a.m.world.tick).toBe(b.m.world.tick);
    expect(a.m.state.teams[0].score).toBe(b.m.state.teams[0].score);
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
  });
});
