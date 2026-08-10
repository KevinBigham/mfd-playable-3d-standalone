import { describe, expect, it } from 'vitest';
import { Action } from '../src/input/actions.ts';
import { AiController } from '../src/ai/athleteAI.ts';
import { profileFor } from '../src/ai/difficulty.ts';
import { getTeam, TEAM_IDS } from '../src/data/index.ts';
import { EventBus } from '../src/core/events.ts';
import { Rng } from '../src/core/rng.ts';
import type { Athlete, TeamSide } from '../src/core/types.ts';
import { defaultMatchConfig, Match } from '../src/rules/match.ts';
import { matchShouldEnd, validateMatchState } from '../src/rules/rulesEngine.ts';
import { dropLoose, giveBall, launchKick, releasePass, stepBall } from '../src/sim/ball.ts';
import { resolveLooseBall } from '../src/sim/catching.ts';
import { applyActions, detectDead, tryLateral } from '../src/sim/playRunner.ts';
import { assignUnits, createWorld, DEF_START, livePossessionSide, OFF_START, type World } from '../src/sim/world.ts';

/** Pin the authored snap side without changing live ball ownership. */
function setSnapSide(world: World, side: TeamSide): void {
  world.snapSide = side;
  world.ball.possession = side;
}

function worldFor(snapSide: TeamSide = 0): World {
  const bus = new EventBus();
  const world = createWorld(
    getTeam(TEAM_IDS[0]), getTeam(TEAM_IDS[1]),
    { weather: 'CLEAR', surface: 'GRASS', windX: 0, windZ: 0, traction: 1 },
    new Rng(701), bus,
  );
  assignUnits(world, snapSide);
  setSnapSide(world, snapSide);
  world.losZ = 50;
  world.playPhase = 'LIVE';
  return world;
}

function matchFor(): Match {
  const config = defaultMatchConfig({
    seed: 701, home: TEAM_IDS[0], away: TEAM_IDS[1], quarterSeconds: 120,
    seats: [
      { side: 0, active: false }, { side: 1, active: false },
      { side: 0, active: false }, { side: 1, active: false },
    ],
  });
  return new Match({ config, home: getTeam(config.home), away: getTeam(config.away) });
}

/** Drive the actual Match dead-ball resolver without exposing a production-only test API. */
function resolveDead(m: Match, reason: Parameters<typeof detectDead>[0]['deadReason']): void {
  m.world.playPhase = 'DEAD';
  m.world.deadReason = reason;
  m.state.phase = 'DEAD_BALL';
  m.state.phaseTicks = 999;
  m.tick();
}

function quarterback(world: World): Athlete {
  return world.athletes[world.qbId];
}

describe('turnover truth: state contract', () => {
  it('keeps snap ownership immutable while recording every real live-possession change', () => {
    const world = worldFor(0);
    const qb = quarterback(world);
    const defender = world.athletes[DEF_START];
    const recovery = world.athletes[OFF_START + 1];
    giveBall(world, qb.id);
    expect(world.possessionHistory).toEqual({ count: 0, first: null, last: null });
    giveBall(world, defender.id);
    dropLoose(world, defender.id, 0, 0, 0, true);
    giveBall(world, recovery.id);
    expect(world.snapSide).toBe(0);
    expect(livePossessionSide(world)).toBe(0);
    expect(world.possessionHistory).toMatchObject({
      count: 2,
      first: { from: 0, to: 1, kind: 'INTERCEPTION' },
      last: { from: 1, to: 0, kind: 'FUMBLE' },
    });
  });
});

describe('turnover truth: boundaries and possession provenance', () => {
  it.each([
    [0 as TeamSide, -10.6, 'SAFETY'],
    [1 as TeamSide, 110.6, 'SAFETY'],
  ])('ends an upright carrier across side %i own back line', (side, z, expected) => {
    const world = worldFor(side);
    const carrier = quarterback(world);
    giveBall(world, carrier.id);
    carrier.z = z;
    expect(detectDead(world)).toBe(expected);
  });

  it('keeps a real goal-line takeaway as a touchback but calls a voluntary retreat a safety', () => {
    const world = worldFor(0);
    const defender = world.athletes[DEF_START];
    defender.z = 100;
    giveBall(world, defender.id);
    defender.move = 'DOWN';
    expect(detectDead(world)).toBe('TOUCHBACK');

    defender.move = 'DOWN';
    defender.z = 95;
    giveBall(world, defender.id);
    defender.z = 100;
    expect(detectDead(world)).toBe('SAFETY');
  });

  it.each([
    [111, 'SAFETY'],
    [-11, 'TOUCHBACK'],
  ])('uses the live fumbler side for defender loose-ball end-zone rulings at z=%i', (z, expected) => {
    const world = worldFor(0);
    const defender = world.athletes[DEF_START];
    defender.z = 50;
    giveBall(world, defender.id);
    dropLoose(world, defender.id, 0, 0, 0, true);
    world.ball.z = z;
    expect(detectDead(world)).toBe(expected);
  });

  it('spots forward fumbles out at their fumble origin rather than the later exit point', () => {
    const m = matchFor();
    const world = m.world;
    assignUnits(world, 0);
    m.state.possession = 0; m.state.losZ = 50; m.state.down = 1;
    setSnapSide(world, 0);
    const runner = world.athletes[OFF_START];
    runner.z = 54;
    giveBall(world, runner.id);
    dropLoose(world, runner.id, 0, 0, 0, true);
    world.ball.x = 30; world.ball.z = 60;
    resolveDead(m, 'OUT_OF_BOUNDS');
    expect(m.state.losZ).toBeCloseTo(54, 6);
  });

  it('keeps backward fumbles out of bounds at the boundary exit point', () => {
    const m = matchFor();
    const world = m.world;
    assignUnits(world, 0);
    m.state.possession = 0; m.state.losZ = 50; m.state.down = 1;
    setSnapSide(world, 0);
    const runner = world.athletes[OFF_START];
    runner.z = 54;
    giveBall(world, runner.id);
    dropLoose(world, runner.id, 0, 0, 0, true);
    world.ball.x = 30; world.ball.z = 48;
    resolveDead(m, 'OUT_OF_BOUNDS');
    expect(m.state.losZ).toBeCloseTo(48, 6);
  });

  it('mirrors forward-origin and backward-boundary fumble spots for side 1', () => {
    const forward = matchFor();
    assignUnits(forward.world, 1);
    forward.state.possession = 1; forward.state.losZ = 50; forward.state.down = 1;
    setSnapSide(forward.world, 1);
    const forwardRunner = forward.world.athletes[OFF_START];
    forwardRunner.z = 46;
    giveBall(forward.world, forwardRunner.id);
    dropLoose(forward.world, forwardRunner.id, 0, 0, 0, true);
    forward.world.ball.x = 30; forward.world.ball.z = 40;
    resolveDead(forward, 'OUT_OF_BOUNDS');
    expect(forward.state.losZ).toBeCloseTo(46, 6);

    const backward = matchFor();
    assignUnits(backward.world, 1);
    backward.state.possession = 1; backward.state.losZ = 50; backward.state.down = 1;
    setSnapSide(backward.world, 1);
    const backwardRunner = backward.world.athletes[OFF_START];
    backwardRunner.z = 46;
    giveBall(backward.world, backwardRunner.id);
    dropLoose(backward.world, backwardRunner.id, 0, 0, 0, true);
    backward.world.ball.x = 30; backward.world.ball.z = 52;
    resolveDead(backward, 'OUT_OF_BOUNDS');
    expect(backward.state.losZ).toBeCloseTo(52, 6);
  });
});

describe('turnover truth: return progression, roles, and passing legality', () => {
  it('protects the interceptor return spot when the returner is driven backward', () => {
    const m = matchFor();
    const world = m.world;
    assignUnits(world, 0);
    m.state.possession = 0; m.state.losZ = 50;
    setSnapSide(world, 0);
    const interceptor = world.athletes[DEF_START];
    interceptor.z = 55;
    giveBall(world, interceptor.id);
    world.progressArmed = true;
    world.progressZ = 60;
    interceptor.move = 'DOWN';
    resolveDead(m, 'TACKLE');
    expect(m.state.possession).toBe(1);
    expect(m.state.losZ).toBeCloseTo(60, 6);
  });

  it('starts a fresh series when an interception is fumbled back to the original offense', () => {
    const m = matchFor();
    const world = m.world;
    assignUnits(world, 0);
    m.state.possession = 0; m.state.down = 3; m.state.losZ = 50; m.state.firstDownZ = 90;
    setSnapSide(world, 0); world.passThrown = true;
    const interceptor = world.athletes[DEF_START];
    const originalOffense = world.athletes[OFF_START + 1];
    interceptor.z = 60;
    originalOffense.z = 57;
    giveBall(world, interceptor.id);
    dropLoose(world, interceptor.id, 0, 0, 0, true);
    giveBall(world, originalOffense.id);
    originalOffense.move = 'DOWN';
    resolveDead(m, 'TACKLE');
    expect(m.state.possession).toBe(0);
    expect(m.state.down).toBe(1);
  });

  it('mirrors protected return progress and chained-turnover series reset for side 1', () => {
    const progress = matchFor();
    assignUnits(progress.world, 1);
    progress.state.possession = 1; progress.state.losZ = 50;
    setSnapSide(progress.world, 1);
    const interceptor = progress.world.athletes[DEF_START];
    interceptor.z = 45;
    giveBall(progress.world, interceptor.id);
    progress.world.progressArmed = true;
    progress.world.progressZ = 50;
    interceptor.move = 'DOWN';
    resolveDead(progress, 'TACKLE');
    expect(progress.state.possession).toBe(0);
    expect(progress.state.losZ).toBeCloseTo(50, 6);

    const chain = matchFor();
    assignUnits(chain.world, 1);
    chain.state.possession = 1; chain.state.down = 3; chain.state.losZ = 50; chain.state.firstDownZ = 10;
    setSnapSide(chain.world, 1); chain.world.passThrown = true;
    const firstRecovery = chain.world.athletes[DEF_START];
    const originalOffense = chain.world.athletes[OFF_START + 1];
    firstRecovery.z = 40; originalOffense.z = 43;
    giveBall(chain.world, firstRecovery.id);
    dropLoose(chain.world, firstRecovery.id, 0, 0, 0, true);
    giveBall(chain.world, originalOffense.id);
    originalOffense.move = 'DOWN';
    resolveDead(chain, 'TACKLE');
    expect(chain.state.possession).toBe(1);
    expect(chain.state.down).toBe(1);
  });

  it('does not allow the original quarterback to throw after a live possession change', () => {
    const world = worldFor(0);
    const qb = quarterback(world);
    const defender = world.athletes[DEF_START];
    const receiver = world.athletes[OFF_START + 1];
    qb.z = 49; receiver.z = 60;
    world.passTargets = [receiver.id, -1, -1];
    giveBall(world, defender.id);
    giveBall(world, qb.id);
    applyActions(world, qb, { moveX: 0, moveZ: 0, aimX: 0, aimZ: 0,
      held: 0, pressed: Action.TARGET_L, released: 0 });
    expect(world.ball.state.kind).toBe('held');
  });

  it('does not allow a QB to cross the line, retreat, and then throw', () => {
    const world = worldFor(0);
    const qb = quarterback(world);
    const receiver = world.athletes[OFF_START + 1];
    receiver.z = 62;
    world.passTargets = [receiver.id, -1, -1];
    giveBall(world, qb.id);
    qb.z = 51;
    applyActions(world, qb, { moveX: 0, moveZ: 0, aimX: 0, aimZ: 0, held: 0, pressed: 0, released: 0 });
    qb.z = 49;
    applyActions(world, qb, { moveX: 0, moveZ: 0, aimX: 0, aimZ: 0,
      held: 0, pressed: Action.TARGET_L, released: 0 });
    expect(world.ball.state.kind).toBe('held');
  });

  it('does not classify an actual forward release as a lateral', () => {
    const world = worldFor(0);
    const runner = quarterback(world);
    const teammate = world.athletes[OFF_START + 1];
    runner.z = 50; runner.facing = Math.PI; // release point is 49.4, behind the runner
    teammate.z = 49.5; teammate.x = runner.x;
    giveBall(world, runner.id);
    tryLateral(world, runner);
    expect(world.ball.state).not.toMatchObject({ kind: 'inAir', passKind: 'LATERAL' });
  });

  it('records an opponent recovery of a lateral as a fumble change, not an interception', () => {
    const world = worldFor(0);
    const runner = quarterback(world);
    const defender = world.athletes[DEF_START];
    giveBall(world, runner.id);
    releasePass(world, runner.id, null, runner.x, runner.z - 2, 'LATERAL');
    giveBall(world, defender.id);
    expect(world.possessionHistory.last).toMatchObject({ from: 0, to: 1, kind: 'FUMBLE' });
  });

  it('gives former offense pursuit and the return team deterministic escort support', () => {
    const make = () => {
      const world = worldFor(0);
      const returner = world.athletes[DEF_START];
      const escort = world.athletes[DEF_START + 1];
      const pursuer = world.athletes[OFF_START + 1];
      returner.x = 0; returner.z = 60;
      escort.x = 0; escort.z = 58; escort.homeX = 0; escort.homeZ = 58; escort.assign = null;
      pursuer.x = 0; pursuer.z = 56; pursuer.homeX = 0; pursuer.homeZ = 56; pursuer.route = null;
      giveBall(world, returner.id);
      const ai = new AiController({ profile: profileFor('PRO'), catchUp: [1, 1], down: 1, distanceToGo: 30, goalToGo: false });
      const pursuit = { moveX: 0, moveZ: 0, aimX: 0, aimZ: 0, held: 0, pressed: 0, released: 0 };
      const support = { ...pursuit };
      ai.produce(world, pursuer.id, pursuit);
      ai.produce(world, escort.id, support);
      return { pursuit, support };
    };
    const a = make();
    const b = make();
    expect(a).toEqual(b);
    expect(a.pursuit.moveZ).toBeGreaterThan(0.5);
    expect(a.support.moveZ).toBeLessThan(-0.25);
  });

  it('leaves kick AI after an established punt return is fumbled and recovered', () => {
    const world = worldFor(0);
    world.special = 'PUNT';
    const kicker = quarterback(world);
    const returner = world.athletes[DEF_START];
    const recovery = world.athletes[OFF_START + 1];
    const escort = world.athletes[OFF_START + 2];
    const pursuer = world.athletes[DEF_START + 1];
    kicker.z = 35;
    launchKick(world, kicker.id, 'PUNT', 0, 8, 12);
    returner.z = 60;
    giveBall(world, returner.id);
    dropLoose(world, returner.id, 0, 0, 0, true);
    recovery.x = 0; recovery.z = 60;
    escort.x = 0; escort.z = 58;
    pursuer.x = 0; pursuer.z = 64;
    giveBall(world, recovery.id);
    expect(world.kickProvenance).toBeNull();

    const ai = new AiController({ profile: profileFor('PRO'), catchUp: [1, 1], down: 1, distanceToGo: 30, goalToGo: false });
    const pursuit = { moveX: 0, moveZ: 0, aimX: 0, aimZ: 0, held: 0, pressed: 0, released: 0 };
    const support = { ...pursuit };
    ai.produce(world, pursuer.id, pursuit);
    ai.produce(world, escort.id, support);
    expect(pursuit.moveZ).toBeLessThan(-0.5);
    expect(support.moveZ).toBeGreaterThan(0.25);
  });
});

describe('turnover truth: special teams, event ownership, and overtime', () => {
  it.each([
    [0 as TeamSide, 100.2, 'TOUCHDOWN'],
    [1 as TeamSide, -0.2, 'TOUCHDOWN'],
  ])('scores a return before the special-teams watchdog for side %i', (side, z, expected) => {
    const world = worldFor(side);
    world.special = 'KICKOFF'; world.playTicks = 2000;
    const returner = quarterback(world);
    giveBall(world, returner.id);
    returner.z = z;
    expect(detectDead(world)).toBe(expected);
  });

  it('calls a returner crossing his own goal line a safety before the watchdog', () => {
    const world = worldFor(0);
    world.special = 'KICKOFF'; world.playTicks = 2000;
    const returner = quarterback(world);
    giveBall(world, returner.id);
    returner.z = -0.2;
    returner.move = 'DOWN';
    expect(detectDead(world)).toBe('SAFETY');
  });

  it('does not let the kicking team advance an untouched punt recovery', () => {
    const world = worldFor(0);
    world.special = 'PUNT';
    const kicker = quarterback(world);
    kicker.z = 35;
    launchKick(world, kicker.id, 'PUNT', 0, 0, 0);
    world.ball.state = { kind: 'loose', lastTouch: -1, ticks: 4, fromFumble: false };
    world.ball.x = kicker.x; world.ball.y = 0.12; world.ball.z = 65;
    kicker.z = 65;
    resolveLooseBall(world);
    expect(world.ball.state).not.toMatchObject({ kind: 'held', carrier: kicker.id });
  });

  it('turns a punt downed in the receiving end zone into a touchback', () => {
    const m = matchFor();
    const world = m.world;
    assignUnits(world, 0);
    m.state.possession = 0;
    setSnapSide(world, 0); world.special = 'PUNT';
    const kicker = world.athletes[OFF_START];
    kicker.z = 35;
    launchKick(world, kicker.id, 'PUNT', 0, 0, 0);
    world.ball.state = { kind: 'loose', lastTouch: -1, ticks: 4, fromFumble: false };
    world.ball.x = kicker.x; world.ball.y = 0.12; world.ball.z = 100.5;
    kicker.z = 100.5;
    expect(resolveLooseBall(world)).toBe(true);
    resolveDead(m, 'KICK_RESULT');
    expect(m.state.possession).toBe(1);
    expect(m.state.losZ).toBeCloseTo(80, 6);
  });

  it('mirrors a punt downed in the receiving end zone into a side-0 touchback', () => {
    const m = matchFor();
    const world = m.world;
    assignUnits(world, 1);
    m.state.possession = 1;
    setSnapSide(world, 1); world.special = 'PUNT';
    const kicker = world.athletes[OFF_START];
    kicker.z = 65;
    launchKick(world, kicker.id, 'PUNT', 0, 0, 0);
    world.ball.state = { kind: 'loose', lastTouch: -1, ticks: 4, fromFumble: false };
    world.ball.x = kicker.x; world.ball.y = 0.12; world.ball.z = -0.5;
    kicker.z = -0.5;
    expect(resolveLooseBall(world)).toBe(true);
    resolveDead(m, 'KICK_RESULT');
    expect(m.state.possession).toBe(0);
    expect(m.state.losZ).toBeCloseTo(20, 6);
  });

  it('awards a muffed punt to the kicking team at the recovery spot without an advance', () => {
    const m = matchFor();
    const world = m.world;
    assignUnits(world, 0);
    m.state.possession = 0;
    setSnapSide(world, 0); world.special = 'PUNT';
    const kicker = world.athletes[OFF_START];
    const returner = world.athletes[DEF_START];
    kicker.z = 65; returner.z = 45;
    launchKick(world, kicker.id, 'PUNT', 0, 0, 0);
    world.ball.state = { kind: 'loose', lastTouch: returner.id, ticks: 4, fromFumble: false };
    world.ball.x = kicker.x; world.ball.y = 0.12; world.ball.z = 65;
    expect(resolveLooseBall(world)).toBe(true);
    kicker.z = 72;
    resolveDead(m, 'TACKLE');
    expect(m.state.possession).toBe(0);
    expect(m.state.losZ).toBeCloseTo(65, 6);
  });

  it('does not allow an untouched free kick to be recovered before it travels ten yards', () => {
    const world = worldFor(0);
    world.special = 'KICKOFF';
    const kicker = quarterback(world);
    kicker.z = 30;
    launchKick(world, kicker.id, 'KICKOFF', 0, 0, 0);
    world.ball.state = { kind: 'loose', lastTouch: -1, ticks: 4, fromFumble: false };
    world.ball.x = kicker.x; world.ball.y = 0.12; world.ball.z = 35;
    kicker.z = 35;
    resolveLooseBall(world);
    expect(world.ball.state).not.toMatchObject({ kind: 'held', carrier: kicker.id });
  });

  it('awards a legal ten-yard free-kick recovery to the kicking team at the recovery spot', () => {
    const m = matchFor();
    const world = m.world;
    assignUnits(world, 0);
    m.state.possession = 0;
    setSnapSide(world, 0); world.special = 'KICKOFF';
    const kicker = world.athletes[OFF_START];
    kicker.z = 30;
    launchKick(world, kicker.id, 'KICKOFF', 0, 0, 0);
    world.ball.state = { kind: 'loose', lastTouch: -1, ticks: 4, fromFumble: false };
    kicker.z = 42;
    world.ball.x = kicker.x; world.ball.y = 0.12; world.ball.z = 42;
    expect(resolveLooseBall(world)).toBe(true);
    kicker.z = 49;
    resolveDead(m, 'TACKLE');
    expect(m.state.possession).toBe(0);
    expect(m.state.losZ).toBeCloseTo(42, 6);
  });

  it('mirrors muffed-punt and legal free-kick recoveries for side 1', () => {
    const punt = matchFor();
    assignUnits(punt.world, 1);
    punt.state.possession = 1;
    setSnapSide(punt.world, 1); punt.world.special = 'PUNT';
    const puntKicker = punt.world.athletes[OFF_START];
    const puntReturner = punt.world.athletes[DEF_START];
    puntKicker.z = 65; puntReturner.z = 75;
    launchKick(punt.world, puntKicker.id, 'PUNT', 0, 0, 0);
    punt.world.ball.state = { kind: 'loose', lastTouch: puntReturner.id, ticks: 4, fromFumble: false };
    punt.world.ball.x = puntKicker.x; punt.world.ball.y = 0.12; punt.world.ball.z = 35;
    puntKicker.z = 35;
    expect(resolveLooseBall(punt.world)).toBe(true);
    resolveDead(punt, 'KICK_RESULT');
    expect(punt.state.possession).toBe(1);
    expect(punt.state.losZ).toBeCloseTo(35, 6);

    const kick = matchFor();
    assignUnits(kick.world, 1);
    kick.state.possession = 1;
    setSnapSide(kick.world, 1); kick.world.special = 'KICKOFF';
    const kickKicker = kick.world.athletes[OFF_START];
    kickKicker.z = 70;
    launchKick(kick.world, kickKicker.id, 'KICKOFF', 0, 0, 0);
    kick.world.ball.state = { kind: 'loose', lastTouch: -1, ticks: 4, fromFumble: false };
    kick.world.ball.x = kickKicker.x; kick.world.ball.y = 0.12; kick.world.ball.z = 58;
    kickKicker.z = 58;
    expect(resolveLooseBall(kick.world)).toBe(true);
    resolveDead(kick, 'KICK_RESULT');
    expect(kick.state.possession).toBe(1);
    expect(kick.state.losZ).toBeCloseTo(58, 6);
  });

  it('requires signed free-kick travel and latches a legal ten-yard crossing through a bounce', () => {
    const backward = worldFor(0);
    backward.special = 'KICKOFF';
    const backKicker = quarterback(backward);
    backKicker.z = 30;
    launchKick(backward, backKicker.id, 'KICKOFF', 0, 0, -60);
    for (let i = 0; i < 12; i++) stepBall(backward);
    expect(backward.kickProvenance?.maxDownfieldTravel ?? 0).toBe(0);
    backward.ball.state = { kind: 'loose', lastTouch: -1, ticks: 4, fromFumble: false };
    backward.ball.x = backKicker.x; backward.ball.y = 0.12; backward.ball.z = 18;
    backKicker.z = 18;
    expect(resolveLooseBall(backward)).toBe(false);

    const bounced = worldFor(0);
    bounced.special = 'KICKOFF';
    const legalKicker = quarterback(bounced);
    legalKicker.z = 30;
    launchKick(bounced, legalKicker.id, 'KICKOFF', 0, 0, 60);
    for (let i = 0; i < 12; i++) stepBall(bounced);
    expect(bounced.kickProvenance?.maxDownfieldTravel ?? 0).toBeGreaterThanOrEqual(10);
    bounced.ball.state = { kind: 'loose', lastTouch: -1, ticks: 4, fromFumble: false };
    bounced.ball.x = legalKicker.x; bounced.ball.y = 0.12; bounced.ball.z = 35;
    legalKicker.z = 35;
    expect(resolveLooseBall(bounced)).toBe(true);
    expect(bounced.kickProvenance?.recovery).toMatchObject({ kind: 'KICKING_RECOVERY', z: 35 });
  });

  it.each([
    [0 as TeamSide, 55, 1 as TeamSide, 65],
    [1 as TeamSide, 45, 0 as TeamSide, 35],
  ])('places a direct kickoff out of bounds at side %i receiving own 35', (kicking, outAt, receiving, expectedSpot) => {
    const m = matchFor();
    const world = m.world;
    assignUnits(world, kicking);
    m.state.possession = kicking;
    setSnapSide(world, kicking); world.special = 'KICKOFF';
    world.ball.state = { kind: 'loose', lastTouch: -1, ticks: 10, fromFumble: false };
    world.ball.x = 30; world.ball.y = 0.12; world.ball.z = outAt;
    resolveDead(m, 'OUT_OF_BOUNDS');
    expect(m.state.possession).toBe(receiving);
    expect(m.state.losZ).toBeCloseTo(expectedSpot, 6);
  });

  it('spots a receiving-touched free kick out of bounds at the exit rather than the own 35', () => {
    const m = matchFor();
    const world = m.world;
    assignUnits(world, 0);
    m.state.possession = 0;
    setSnapSide(world, 0); world.special = 'KICKOFF';
    const kicker = world.athletes[OFF_START];
    kicker.z = 30;
    launchKick(world, kicker.id, 'KICKOFF', 0, 0, 0);
    world.ball.state = { kind: 'loose', lastTouch: DEF_START, ticks: 10, fromFumble: false };
    world.ball.x = 30; world.ball.y = 0.12; world.ball.z = 55;
    expect(resolveLooseBall(world)).toBe(false);
    expect(world.kickProvenance?.receivingTouched).toBe(true);
    resolveDead(m, 'OUT_OF_BOUNDS');
    expect(m.state.possession).toBe(1);
    expect(m.state.losZ).toBeCloseTo(55, 6);
  });

  it('credits a turnover-return tackle to the actual defender, not the snap offense', () => {
    const m = matchFor();
    m.state.possession = 0;
    m.bus.emit({ type: 'tackle', tick: 0, by: OFF_START, on: DEF_START, power: 1 });
    (m as unknown as { consumeEvents(): void }).consumeEvents();
    expect(m.state.teams[0].stats.tackles).toBe(1);
    expect(m.state.teams[1].stats.tackles).toBe(0);
  });

  it('retains the interception credit even when the original offense recovers the return fumble', () => {
    const m = matchFor();
    m.state.possession = 0;
    m.bus.emit({ type: 'interception', tick: 0, by: DEF_START });
    m.bus.emit({ type: 'fumble', tick: 1, by: DEF_START, forcedBy: OFF_START });
    m.bus.emit({ type: 'recover', tick: 2, by: OFF_START, side: 0 });
    (m as unknown as { consumeEvents(): void }).consumeEvents();
    expect(m.state.teams[1].stats.ints).toBe(1);
  });

  it('does not classify a defensive return touchdown as a rushing or passing touchdown', () => {
    const m = matchFor();
    const world = m.world;
    assignUnits(world, 0);
    m.state.possession = 0;
    setSnapSide(world, 0);
    const returner = world.athletes[DEF_START];
    returner.z = 0;
    giveBall(world, returner.id);
    resolveDead(m, 'TOUCHDOWN');
    expect(m.state.teams[1].stats.rushTd).toBe(0);
    expect(m.state.teams[1].stats.passTd).toBe(0);
  });

  it('emits a defensive two-point return for the scoring side', () => {
    const m = matchFor();
    const world = m.world;
    assignUnits(world, 0);
    m.bus.record();
    m.state.possession = 0;
    m.state.phase = 'CONVERSION_RESOLVE';
    m.state.phaseTicks = 0;
    m.state.conversionChoice = 'TWO';
    giveBall(world, world.athletes[DEF_START].id);
    (m as unknown as { lastOutcome: { reason: string } }).lastOutcome = { reason: 'TOUCHDOWN' };
    m.tick();
    expect(m.bus.log?.find((event) => event.type === 'twoPoint')).toMatchObject({ side: 1, good: true });
  });

  it('does not end a tied third overtime; it enters the sudden-death period', () => {
    const m = matchFor().state;
    m.quarter = 7; m.overtimePeriod = 3;
    m.teams[0].score = 30; m.teams[1].score = 30;
    expect(matchShouldEnd(m)).toBe(false);
  });

  it('ends sudden death on the next score once the sudden-death period begins', () => {
    const m = matchFor().state;
    m.quarter = 8; m.overtimePeriod = 4;
    m.teams[0].score = 32; m.teams[1].score = 30;
    expect(matchShouldEnd(m)).toBe(true);
  });

  it('drives a tied OT3 expiration into OT4 and a tied OT4 expiration into OT5', () => {
    const m = matchFor();
    m.state.quarter = 7; m.state.overtimePeriod = 3; m.state.clockTicks = 0;
    m.state.teams[0].score = 30; m.state.teams[1].score = 30;
    (m as unknown as { endQuarter(): void }).endQuarter();
    expect(m.state.phase).toBe('OVERTIME_SETUP');
    for (let i = 0; i < 600 && m.state.overtimePeriod < 4; i++) m.tick();
    expect(m.state.overtimePeriod).toBe(4);

    m.state.quarter = 8; m.state.overtimePeriod = 4; m.state.clockTicks = 0;
    m.state.teams[0].score = 30; m.state.teams[1].score = 30;
    (m as unknown as { endQuarter(): void }).endQuarter();
    for (let i = 0; i < 600 && m.state.overtimePeriod < 5; i++) m.tick();
    expect(m.state.overtimePeriod).toBe(5);
    expect(m.state.finished).toBe(false);
  });

  it.each([
    ['TOUCHDOWN', 6],
    ['FIELD_GOAL_GOOD', 3],
    ['SAFETY', 2],
  ] as const)('ends OT4 immediately on a %s with no conversion', (reason, points) => {
    const m = matchFor();
    assignUnits(m.world, 0);
    m.state.quarter = 8; m.state.overtimePeriod = 4; m.state.possession = 0;
    m.state.teams[0].score = 20; m.state.teams[1].score = 20;
    setSnapSide(m.world, 0);
    if (reason === 'TOUCHDOWN') {
      const scorer = m.world.athletes[OFF_START];
      scorer.z = 100;
      giveBall(m.world, scorer.id);
    } else if (reason === 'SAFETY') {
      const conceded = m.world.athletes[OFF_START];
      conceded.z = -1;
      giveBall(m.world, conceded.id);
    }
    resolveDead(m, reason);
    expect(m.state.finished).toBe(true);
    expect(m.state.phase).toBe('FINAL');
    const winningSide = reason === 'SAFETY' ? 1 : 0;
    expect(m.state.teams[winningSide].score).toBe(20 + points);
    expect(m.state.pendingScore).toBeNull();
  });

  it('serializes provenance fields across a live fumble snapshot', () => {
    const m = matchFor();
    assignUnits(m.world, 0);
    setSnapSide(m.world, 0);
    const runner = m.world.athletes[OFF_START];
    runner.z = 54;
    giveBall(m.world, runner.id);
    dropLoose(m.world, runner.id, 0, 0, 0, true);
    const world = m.captureSnapshot().world as unknown as Record<string, unknown>;
    expect(world).toMatchObject({
      snapSide: 0,
      possessionHistory: expect.objectContaining({ count: 0 }),
      fumbleOrigin: expect.objectContaining({ side: 0, z: 54 }),
      crossedLos: false,
      kickProvenance: null,
    });
  });

  it('rejects invalid first-down, quarter, drive, and pending-score fields', () => {
    const m = matchFor().state;
    m.firstDownZ = Number.NaN;
    m.quarter = -9;
    m.driveSide = 7 as TeamSide;
    m.pendingScore = { side: 7 as TeamSide, kind: 'TD' };
    const codes = validateMatchState(m).map((violation) => violation.code);
    expect(codes).toEqual(expect.arrayContaining([
      'FIRST_DOWN_NAN', 'QUARTER_RANGE', 'DRIVE_SIDE_INVALID', 'PENDING_SCORE_INVALID',
    ]));
  });

  it('rejects malformed pending-score kinds, first-down ranges, and kick provenance', () => {
    const state = matchFor().state;
    state.firstDownZ = 101;
    state.pendingScore = { side: 0, kind: 'NOPE' as 'TD' };
    const codes = validateMatchState(state).map((violation) => violation.code);
    expect(codes).toEqual(expect.arrayContaining(['FIRST_DOWN_RANGE', 'PENDING_SCORE_INVALID']));

    const m = matchFor();
    assignUnits(m.world, 0);
    const kicker = m.world.athletes[OFF_START];
    launchKick(m.world, kicker.id, 'KICKOFF', 0, 8, 12);
    if (m.world.kickProvenance) m.world.kickProvenance.maxDownfieldTravel = -1;
    expect(m.checkInvariants().map((violation) => violation.code)).toContain('BALL');
  });
});
