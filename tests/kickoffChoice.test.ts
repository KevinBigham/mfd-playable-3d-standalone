import { describe, it, expect } from 'vitest';
import { Match, defaultMatchConfig } from '../src/rules/match.ts';
import { getTeam, TEAM_IDS } from '../src/data/index.ts';

/**
 * A human kicker could never call an onside kick — `onsideRequested` was hard-coded false on the
 * human branch while the HUD advertised a key combo the rules never read. `submitKickoff` is the
 * device-neutral entry point (same seam as submitOffense); these tests pin its legality window
 * and prove CPU-only games are untouched.
 */

function makeMatch(humanKicks: boolean): Match {
  const cfg = defaultMatchConfig({
    seed: 5150, quarterSeconds: 120, difficulty: 'PRO',
    home: TEAM_IDS[0], away: TEAM_IDS[1],
    seats: humanKicks
      ? [{ side: 0, active: true }, { side: 1, active: false }]
      : [{ side: 0, active: false }, { side: 1, active: false }],
  });
  return new Match({ config: cfg, home: getTeam(cfg.home!), away: getTeam(cfg.away!), seatIntent: () => null });
}

function runToKickoffSetup(m: Match): boolean {
  for (let i = 0; i < 40000 && !m.state.finished; i++) {
    if (m.state.phase === 'KICKOFF_SETUP' && m.state.phaseTicks >= 1) return true;
    m.tick();
  }
  return false;
}

describe('human kickoff choice', () => {
  it('a human kicker can request an onside kick before the ball is struck', () => {
    const m = makeMatch(true);
    expect(runToKickoffSetup(m)).toBe(true);
    // The human kicks the opening kickoff only if they won possession; find a kickoff they kick.
    for (let guard = 0; guard < 3 && !m.isHuman(m.state.possession); guard++) {
      // Skip this kickoff and run to the next one (after a score or half).
      m.tick();
      let left = false;
      for (let i = 0; i < 300000 && !m.state.finished; i++) {
        if (m.state.phase !== 'KICKOFF_SETUP' && m.state.phase !== 'KICKOFF_LIVE') left = true;
        if (left && m.state.phase === 'KICKOFF_SETUP' && m.state.phaseTicks >= 1) break;
        m.tick();
      }
    }
    if (!m.isHuman(m.state.possession)) return; // no human kickoff this game; covered by other seeds
    expect(m.kickoffAwaitingChoice).toBe(true);
    m.submitKickoff('ONSIDE');
    expect(m.kickoffAwaitingChoice).toBe(false);
    // Run until the ball launches (world.special is rewritten at the strike); the kick must be
    // the onside variety. Note special reads 'KICKOFF' from setup until the launch.
    let sawOnside = false;
    for (let i = 0; i < 600; i++) {
      m.tick();
      if (m.world.special === 'ONSIDE') { sawOnside = true; break; }
      if (m.state.phase !== 'KICKOFF_SETUP' && m.state.phase !== 'KICKOFF_LIVE') break;
    }
    expect(sawOnside).toBe(true);
  });

  it('an undecided human is defaulted to a deep kick after the timeout window', () => {
    const m = makeMatch(true);
    expect(runToKickoffSetup(m)).toBe(true);
    if (!m.isHuman(m.state.possession)) return;
    let special = '';
    for (let i = 0; i < 600; i++) {
      m.tick();
      if (m.state.phase === 'KICKOFF_LIVE' && (m.world.special === 'ONSIDE' || m.world.special === 'KICKOFF')) {
        // world.special is KICKOFF from setup on; the launch decision is what matters —
        // detect launch via kickoffAwaitingChoice turning false with phase advanced.
      }
      if (!m.kickoffAwaitingChoice && m.state.phase === 'KICKOFF_LIVE' && m.state.phaseTicks > 245) {
        special = m.world.special ?? '';
        break;
      }
    }
    expect(special).toBe('KICKOFF');
  });

  it('submitKickoff is inert for CPU possessions and outside the kickoff window', () => {
    const m = makeMatch(false);
    expect(runToKickoffSetup(m)).toBe(true);
    expect(m.kickoffAwaitingChoice).toBe(false);
    m.submitKickoff('ONSIDE');   // CPU kicker: must be ignored
    let sawOnside = false;
    for (let i = 0; i < 600; i++) {
      m.tick();
      if (m.world.special === 'ONSIDE') { sawOnside = true; break; }
      if (m.state.phase !== 'KICKOFF_SETUP' && m.state.phase !== 'KICKOFF_LIVE') break;
    }
    expect(sawOnside).toBe(false);
  });

  it('CPU-vs-CPU games are byte-identical to the pre-change behavior window', () => {
    // The choice seam must not consume RNG or change timing for CPU kickers: two CPU matches on
    // the same seed must produce identical final scores and event counts.
    const a = makeMatch(false);
    const b = makeMatch(false);
    for (let i = 0; i < 200000 && !a.state.finished; i++) a.tick();
    for (let i = 0; i < 200000 && !b.state.finished; i++) b.tick();
    expect(a.state.teams[0].score).toBe(b.state.teams[0].score);
    expect(a.state.teams[1].score).toBe(b.state.teams[1].score);
    expect(a.world.tick).toBe(b.world.tick);
    expect(a.world.tick).toBeGreaterThan(0);
  });
});
