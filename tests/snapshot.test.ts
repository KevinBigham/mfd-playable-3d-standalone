/**
 * Mid-match snapshot: does a live game survive a round trip through plain data?
 *
 * A deterministic simulation makes this answerable exactly rather than approximately. Play a while,
 * snapshot, then play the SAME number of ticks twice — once by continuing, once by restoring into a
 * fresh match — and compare the event streams tick for tick. Anything the snapshot fails to carry
 * shows up as a divergence, usually within a second or two of play. "It looked fine when I loaded
 * it" is not a test; this is.
 */
import { describe, it, expect } from 'vitest';
import { Match, defaultMatchConfig } from '../src/rules/match.ts';
import { snapshotMatches, configFromSnapshot, SNAPSHOT_VERSION } from '../src/rules/snapshot.ts';
import { getTeam, TEAM_IDS } from '../src/data/index.ts';

function makeMatch(seed = 5150): Match {
  const cfg = defaultMatchConfig({
    seed, quarterSeconds: 120, difficulty: 'PRO',
    home: TEAM_IDS[0], away: TEAM_IDS[3],
    seats: [{ side: 0, active: false }, { side: 1, active: false }],
  });
  return new Match({ config: cfg, home: getTeam(cfg.home!), away: getTeam(cfg.away!), seatIntent: () => null });
}

/** Every event, in order, as a comparable string. */
function record(m: Match, ticks: number): string[] {
  const log: string[] = [];
  const bus = m.bus as unknown as { onAny?: (f: (e: unknown) => void) => void };
  void bus;
  const sub = (m.bus as unknown as { on: (t: string, f: (e: never) => void) => void });
  for (const t of [
    'snap', 'throw', 'catch', 'drop', 'bobble', 'swat', 'interception', 'tackle', 'sack',
    'fumble', 'recover', 'touchdown', 'firstDown', 'turnover', 'play.start', 'play.end',
    'down.change', 'kickoff', 'fieldGoal', 'safety', 'quarter.end',
  ]) {
    sub.on(t, ((e: Record<string, unknown>) => {
      const keys = Object.keys(e).filter((k) => k !== 'tick').sort();
      log.push(`${t}:${keys.map((k) => `${k}=${JSON.stringify(e[k])}`).join(',')}`);
    }) as never);
  }
  for (let i = 0; i < ticks && !m.state.finished; i++) m.tick();
  return log;
}

describe('mid-match snapshot', () => {
  // Taken at four different points on purpose. A snapshot between plays carries almost nothing and
  // round-trips trivially; the ones that find bugs land mid-play, mid-flight and mid-kick. Both
  // faults this suite caught on the way in were exactly those — the previous held-input mask, and
  // the special-teams formations, which are not in the playbook and so restored with every
  // defender's assignment set to null.
  for (const at of [1500, 4000, 7000, 11000]) {
    it(`round-trips a live match snapshotted at tick ${at} and continues identically`, () => {
      const a = makeMatch(5150 + at);
      for (let i = 0; i < at; i++) a.tick();
      const snap = a.captureSnapshot();
      const afterA = record(a, 2500);

      const b = new Match({
        config: defaultMatchConfig(configFromSnapshot(snap) as never),
        home: getTeam(snap.homeId), away: getTeam(snap.awayId), seatIntent: () => null,
      });
      b.applySnapshot(snap);
      const afterB = record(b, 2500);

      expect(afterB.length).toBeGreaterThan(10);
      expect(afterB).toEqual(afterA);
    });
  }

  it('restores the visible state exactly', () => {
    const a = makeMatch(777);
    for (let i = 0; i < 2500; i++) a.tick();
    const snap = a.captureSnapshot();
    const b = new Match({
      config: defaultMatchConfig(configFromSnapshot(snap) as never),
      home: getTeam(snap.homeId), away: getTeam(snap.awayId), seatIntent: () => null,
    });
    b.applySnapshot(snap);

    expect(b.state.quarter).toBe(a.state.quarter);
    expect(b.state.clockTicks).toBe(a.state.clockTicks);
    expect(b.state.down).toBe(a.state.down);
    expect(b.state.losZ).toBeCloseTo(a.state.losZ, 6);
    expect(b.state.teams[0].score).toBe(a.state.teams[0].score);
    expect(b.state.teams[1].score).toBe(a.state.teams[1].score);
    expect(b.world.tick).toBe(a.world.tick);
    expect(b.world.playPhase).toBe(a.world.playPhase);
    for (let i = 0; i < a.world.athletes.length; i++) {
      expect(b.world.athletes[i].x).toBeCloseTo(a.world.athletes[i].x, 6);
      expect(b.world.athletes[i].z).toBeCloseTo(a.world.athletes[i].z, 6);
      expect(b.world.athletes[i].hasBall).toBe(a.world.athletes[i].hasBall);
    }
  });

  it('survives a JSON round trip, which is how it will actually be stored', () => {
    const a = makeMatch(31337);
    for (let i = 0; i < 3200; i++) a.tick();
    const snap = JSON.parse(JSON.stringify(a.captureSnapshot()));
    const afterA = record(a, 1800);

    const b = new Match({
      config: defaultMatchConfig(configFromSnapshot(snap) as never),
      home: getTeam(snap.homeId), away: getTeam(snap.awayId), seatIntent: () => null,
    });
    b.applySnapshot(snap);
    expect(record(b, 1800)).toEqual(afterA);
  });

  it('refuses a snapshot from a different matchup rather than quietly loading it', () => {
    const a = makeMatch();
    for (let i = 0; i < 600; i++) a.tick();
    const snap = a.captureSnapshot();
    expect(snapshotMatches(snap, {
      seed: snap.seed, home: snap.homeId, away: snap.awayId,
      stadium: snap.stadium, quarterSeconds: snap.quarterSeconds,
    }).ok).toBe(true);
    // A mismatched restore does not throw — it produces a game that is quietly wrong, which is
    // exactly why the check has to be explicit.
    const wrong = snapshotMatches(snap, {
      seed: snap.seed, home: TEAM_IDS[9], away: snap.awayId,
      stadium: snap.stadium, quarterSeconds: snap.quarterSeconds,
    });
    expect(wrong.ok).toBe(false);
    expect(snapshotMatches({ ...snap, version: 99 }, {
      seed: snap.seed, home: snap.homeId, away: snap.awayId,
      stadium: snap.stadium, quarterSeconds: snap.quarterSeconds,
    }).ok).toBe(false);
  });

  it('carries a version', () => {
    const a = makeMatch();
    expect(a.captureSnapshot().version).toBe(SNAPSHOT_VERSION);
  });
});
