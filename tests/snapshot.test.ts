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
import { assertBallInvariant, dropLoose, giveBall, launchKick } from '../src/sim/ball.ts';
import { resolveLooseBall } from '../src/sim/catching.ts';
import { assignUnits, DEF_START, OFF_START } from '../src/sim/world.ts';

function makeMatch(seed = 5150): Match {
  const cfg = defaultMatchConfig({
    seed, quarterSeconds: 120, difficulty: 'PRO',
    home: TEAM_IDS[0], away: TEAM_IDS[3],
    seats: [{ side: 0, active: false }, { side: 1, active: false }],
  });
  return new Match({ config: cfg, home: getTeam(cfg.home!), away: getTeam(cfg.away!), seatIntent: () => null });
}

function restore(snap: ReturnType<Match['captureSnapshot']>): Match {
  const b = new Match({
    config: defaultMatchConfig(configFromSnapshot(snap) as never),
    home: getTeam(snap.homeId), away: getTeam(snap.awayId), seatIntent: () => null,
  });
  b.applySnapshot(snap);
  return b;
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

  it('derives safe provenance when a legacy snapshot is restored mid-fumble', () => {
    const a = makeMatch(1701);
    const w = a.world;
    assignUnits(w, 0);
    w.snapSide = 0; w.ball.possession = 0;
    const runner = w.athletes[OFF_START];
    runner.x = 3; runner.z = 46;
    giveBall(w, runner.id);
    dropLoose(w, runner.id, 1, 2, 3, true);
    const legacy = JSON.parse(JSON.stringify(a.captureSnapshot())) as ReturnType<Match['captureSnapshot']>;
    delete legacy.world.snapSide;
    delete legacy.world.possessionHistory;
    delete legacy.world.crossedLos;
    delete legacy.world.fumbleOrigin;
    delete legacy.world.kickProvenance;

    const b = restore(legacy);
    expect(b.world.snapSide).toBe(0);
    expect(b.world.possessionHistory).toEqual({ count: 0, first: null, last: null });
    expect(b.world.crossedLos).toBe(false);
    expect(b.world.fumbleOrigin).toMatchObject({ carrier: runner.id, side: 0, x: 3, z: 46 });
    expect(b.world.kickProvenance).toBeNull();
    expect(() => assertBallInvariant(b.world)).not.toThrow();
  });

  it('derives a receiving return from a legacy held kick snapshot', () => {
    const a = makeMatch(1702);
    const w = a.world;
    assignUnits(w, 0);
    w.snapSide = 0; w.ball.possession = 0; w.special = 'PUNT';
    const kicker = w.athletes[OFF_START];
    const returner = w.athletes[DEF_START];
    kicker.x = -2; kicker.z = 40; returner.x = 4; returner.z = 63;
    giveBall(w, kicker.id);
    launchKick(w, kicker.id, 'PUNT', 0, 8, 12);
    giveBall(w, returner.id);
    const legacy = JSON.parse(JSON.stringify(a.captureSnapshot())) as ReturnType<Match['captureSnapshot']>;
    delete legacy.world.snapSide;
    delete legacy.world.possessionHistory;
    delete legacy.world.crossedLos;
    delete legacy.world.fumbleOrigin;
    delete legacy.world.kickProvenance;

    const b = restore(legacy);
    expect(b.world.kickProvenance).toMatchObject({
      kind: 'PUNT', kickingSide: 0, receivingTouched: true, receivingPossessed: true,
      recovery: { kind: 'RECEIVING_RECOVERY', actor: returner.id, side: 1 },
    });
    expect(() => assertBallInvariant(b.world)).not.toThrow();
  });

  it('restores a legacy post-return fumble as an ordinary fumble, not an unresolved kick', () => {
    const a = makeMatch(1704);
    const w = a.world;
    assignUnits(w, 0);
    w.snapSide = 0; w.ball.possession = 0; w.special = 'PUNT';
    const kicker = w.athletes[OFF_START];
    const returner = w.athletes[DEF_START];
    kicker.z = 40; returner.z = 63;
    giveBall(w, kicker.id);
    launchKick(w, kicker.id, 'PUNT', 0, 8, 12);
    giveBall(w, returner.id);
    dropLoose(w, returner.id, 1, 2, -1, true);
    expect(w.kickProvenance).toBeNull();

    const legacy = JSON.parse(JSON.stringify(a.captureSnapshot())) as ReturnType<Match['captureSnapshot']>;
    delete legacy.world.snapSide;
    delete legacy.world.possessionHistory;
    delete legacy.world.crossedLos;
    delete legacy.world.fumbleOrigin;
    delete legacy.world.kickProvenance;

    const b = restore(legacy);
    expect(b.world.kickProvenance).toBeNull();
    expect(b.world.fumbleOrigin).toMatchObject({ carrier: returner.id, side: 1, z: returner.z });
    expect(() => assertBallInvariant(b.world)).not.toThrow();
  });

  it('continues a post-return fumble recovery identically after a new snapshot round trip', () => {
    const a = makeMatch(1705);
    const w = a.world;
    assignUnits(w, 0);
    w.snapSide = 0; w.ball.possession = 0; w.special = 'PUNT';
    const kicker = w.athletes[OFF_START];
    const returner = w.athletes[DEF_START];
    const recovery = w.athletes[OFF_START + 1];
    kicker.z = 40; returner.z = 63;
    giveBall(w, kicker.id);
    launchKick(w, kicker.id, 'PUNT', 0, 8, 12);
    giveBall(w, returner.id);
    dropLoose(w, returner.id, 0, 0, 0, true);
    w.ball.x = 0; w.ball.y = 0.12; w.ball.z = 63;
    if (w.ball.state.kind === 'loose') w.ball.state.ticks = 4;
    for (const athlete of w.athletes) { athlete.x = 20; athlete.z = 40; }
    recovery.x = 0; recovery.z = 63;
    a.bus.clearQueue();

    const b = restore(a.captureSnapshot());
    a.bus.record(); b.bus.record();
    expect(resolveLooseBall(a.world)).toBe(true);
    expect(resolveLooseBall(b.world)).toBe(true);
    expect(b.world.ball.state).toEqual(a.world.ball.state);
    expect(b.world.possessionHistory).toEqual(a.world.possessionHistory);
    expect(b.world.kickProvenance).toEqual(a.world.kickProvenance);
    expect(b.bus.log).toEqual(a.bus.log);
  });

  it('keeps legacy airborne and untouched loose kicks unclaimed', () => {
    const a = makeMatch(1703);
    const w = a.world;
    assignUnits(w, 0);
    w.snapSide = 0; w.ball.possession = 0; w.special = 'KICKOFF';
    const kicker = w.athletes[OFF_START];
    kicker.z = 30;
    giveBall(w, kicker.id);
    launchKick(w, kicker.id, 'KICKOFF', 0, 8, 16);

    const restoreLegacy = (): Match => {
      const legacy = JSON.parse(JSON.stringify(a.captureSnapshot())) as ReturnType<Match['captureSnapshot']>;
      delete legacy.world.snapSide;
      delete legacy.world.possessionHistory;
      delete legacy.world.crossedLos;
      delete legacy.world.fumbleOrigin;
      delete legacy.world.kickProvenance;
      return restore(legacy);
    };

    const airborne = restoreLegacy();
    expect(airborne.world.kickProvenance).toMatchObject({
      kind: 'KICKOFF', receivingTouched: false, receivingPossessed: false, recovery: null,
    });
    expect(() => assertBallInvariant(airborne.world)).not.toThrow();

    w.ball.state = { kind: 'loose', lastTouch: -1, ticks: 2, fromFumble: false };
    const loose = restoreLegacy();
    expect(loose.world.kickProvenance).toMatchObject({
      kind: 'KICKOFF', receivingTouched: false, receivingPossessed: false, recovery: null,
    });
    expect(() => assertBallInvariant(loose.world)).not.toThrow();
  });
});
