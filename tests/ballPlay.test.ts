import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/core/events.ts';
import { FIELD_HALF_WIDTH } from '../src/core/constants.ts';
import { Rng } from '../src/core/rng.ts';
import { getTeam, TEAM_IDS } from '../src/data/index.ts';
import { Action } from '../src/input/actions.ts';
import {
  automaticDefenderTechnique, compareCatchCandidates, defenderBallGeometry,
  evaluateBallReach, oneFootInBounds, resolveAirBall, resolveLooseBall,
} from '../src/sim/catching.ts';
import { applyActions } from '../src/sim/playRunner.ts';
import { assignUnits, createWorld } from '../src/sim/world.ts';
import { Match, defaultMatchConfig, receiverAssistWeight, shouldAutoSwitchReceiver } from '../src/rules/match.ts';

function airWorld(seed = 117) {
  const bus = new EventBus(); bus.record();
  const world = createWorld(
    getTeam(TEAM_IDS[0]), getTeam(TEAM_IDS[1]),
    { weather: 'CLEAR', surface: 'GRASS', windX: 0, windZ: 0, traction: 1 },
    new Rng(seed), bus,
  );
  assignUnits(world, 0);
  world.playPhase = 'LIVE';
  for (const athlete of world.athletes) {
    athlete.x = 50; athlete.z = 50; athlete.y = 0; athlete.facing = 0;
    athlete.def = { ...athlete.def, ratings: { ...athlete.def.ratings, hands: 50, awareness: 50 } };
  }
  world.ball.x = 0; world.ball.y = 1.5; world.ball.z = 0;
  world.ball.state = {
    kind: 'inAir', from: 0, intended: 1, passKind: 'NORMAL', t: 0.5, flightTime: 1,
    sx: 0, sy: 1.85, sz: -10, tx: 0, ty: 1.55, tz: 0, arc: 1,
    contested: false, attemptMask: 0,
  };
  return world;
}

describe('authoritative ball-play geometry', () => {
  it('switches at the deterministic ETA boundary, protects a second human, and blends route assist', () => {
    expect(shouldAutoSwitchReceiver(0.901, 0, 0, -1, 0)).toBe(false);
    expect(shouldAutoSwitchReceiver(0.900, 0, 0, -1, 0)).toBe(true);
    expect(shouldAutoSwitchReceiver(0.4, 0, 0, 1, 0)).toBe(false);
    expect(receiverAssistWeight(0.15)).toBe(1);
    expect(receiverAssistWeight(0.25)).toBeCloseTo(0.5);
    expect(receiverAssistWeight(0.35)).toBe(0);
  });

  it('transfers the live seat at 0.90s and requires a fresh catch-action edge', () => {
    let held = Action.ACTION | Action.PROTECT;
    const config = defaultMatchConfig({ seed: 73, difficulty: 'PRO', home: TEAM_IDS[0], away: TEAM_IDS[1], seats: [
      { side: 0, active: true }, { side: 1, active: false },
      { side: 0, active: false }, { side: 1, active: false },
    ] });
    const match = new Match({ config, home: getTeam(config.home!), away: getTeam(config.away!),
      seatIntent: () => ({ moveX: 0, moveZ: 0, aimX: 0, aimZ: 0, held, pressed: 0, released: 0 }) });
    match.state.phase = 'LIVE'; match.world.playPhase = 'LIVE'; match.world.snapSide = 0;
    match.world.passThrown = true;
    const target = match.world.athletes[1]; target.x = 20; target.z = 20;
    match.world.ball.state = { kind: 'inAir', from: 0, intended: target.id, passKind: 'NORMAL',
      t: 0.1, flightTime: 1, sx: 0, sy: 1.85, sz: 0, tx: 20, ty: 1.55, tz: 20,
      arc: 1, contested: false, attemptMask: 0 };
    match.tick();
    expect(target.controlledBySeat).toBe(0);
    expect(target.ballPlayTechnique).toBe('BALANCED');
    expect(match.world.intents[target.id].held & (Action.ACTION | Action.PROTECT)).toBe(0);
    held = 0; match.tick();
    held = Action.PROTECT; match.tick();
    expect(target.ballPlayTechnique).toBe('POSSESSION');
    expect(match.world.intents[target.id].held & Action.TURBO).toBe(0);
  });
  it('preserves the widened receiver envelope and extends only a committed forward/lateral play', () => {
    const world = airWorld(); const receiver = world.athletes[1];
    receiver.x = 1.9; receiver.z = 0;
    expect(evaluateBallReach(receiver, 0, 1.5, 0, 'NORMAL', true, false).eligible).toBe(true);
    receiver.x = 2.1;
    expect(evaluateBallReach(receiver, 0, 1.5, 0, 'NORMAL', true, false).eligible).toBe(false);
    receiver.x = 0; receiver.z = -2.2;
    expect(evaluateBallReach(receiver, 0, 1.5, 0, 'NORMAL', true, false, 'EXTEND').eligible).toBe(true);
    expect(evaluateBallReach(receiver, 0, 1.5, 0, 'NORMAL', true, false, 'BALANCED').eligible).toBe(false);
  });

  it('does not give the receiver-only radius to defenders', () => {
    const defender = airWorld().athletes[7]; defender.x = 1.9; defender.z = 0;
    expect(evaluateBallReach(defender, 0, 1.5, 0, 'NORMAL', false, true).eligible).toBe(false);
  });

  it('uses stable athlete-id ordering for exact claim ties', () => {
    const world = airWorld();
    const reach = evaluateBallReach(world.athletes[1], 50, 1.5, 50, 'NORMAL', true, false);
    const base = { d: 0, claim: 1, reach, receiverTechnique: 'RAC', defenderTechnique: 'AUTO' } as const;
    const candidates = [
      { ...base, a: world.athletes[3] },
      { ...base, a: world.athletes[1] },
    ];
    candidates.sort(compareCatchCandidates);
    expect(candidates.map((candidate) => candidate.a.id)).toEqual([1, 3]);
  });

  it('uses that stable ordering at the runtime contest seam', () => {
    const world = airWorld(1);
    world.athletes[1].x = 40; world.athletes[1].z = 40;
    for (const id of [7, 8]) {
      const defender = world.athletes[id];
      defender.x = 0; defender.z = -0.35; defender.facing = 0;
      defender.ballPlayTechnique = 'SWAT'; defender.ballPlayUntilTick = 999;
      defender.def = { ...defender.def, ratings: { ...defender.def.ratings, hands: 50, awareness: 50 } };
    }
    expect(resolveAirBall(world)).toBe(true);
    expect(world.bus.log?.find((event) => event.type === 'swat')).toMatchObject({ by: 7 });
  });

  it('distinguishes in-phase leverage from a trail defender', () => {
    const world = airWorld(); const receiver = world.athletes[1]; const defender = world.athletes[7];
    receiver.x = 0; receiver.z = 0;
    defender.x = 0.2; defender.z = -0.2; defender.facing = 0;
    const phase = defenderBallGeometry(defender, receiver, 0, 0, 0, 10);
    expect(phase.inPhase).toBe(true);
    expect(automaticDefenderTechnique(phase)).toBe('PLAY_BALL');
    defender.z = -1.2;
    const trail = defenderBallGeometry(defender, receiver, 0, 0, 0, 10);
    expect(trail.inPhase).toBe(false);
    expect(automaticDefenderTechnique(trail)).toBe('SWAT');
  });

  it('allows only one failed defender attempt on the same flight', () => {
    const world = airWorld(1); // primary roll 0.950... deliberately exercises the miss branch
    world.athletes[1].x = 50; world.athletes[1].z = 50;
    const defender = world.athletes[7]; defender.x = 0; defender.z = -0.4; defender.facing = Math.PI;
    expect(resolveAirBall(world)).toBe(false);
    expect((world.ball.state.kind === 'inAir' ? world.ball.state.attemptMask ?? 0 : 0) & (1 << 7)).not.toBe(0);
    const afterFirst = world.rng.save();
    expect(resolveAirBall(world)).toBe(false);
    expect(world.rng.save()).toEqual(afterFirst);
    expect(world.bus.log?.some((event) => event.type === 'swat')).toBe(false);
  });

  it('consumes exactly one gameplay roll for a clean contact resolution', () => {
    const world = airWorld(44); const receiver = world.athletes[1];
    receiver.x = 0; receiver.z = 0; receiver.onFire = true;
    receiver.def = { ...receiver.def, ratings: { ...receiver.def.ratings, hands: 100 } };
    const expected = new Rng(44); expected.next();
    expect(resolveAirBall(world)).toBe(true);
    expect(world.bus.log?.some((event) => event.type === 'catch')).toBe(true);
    expect(world.rng.save()).toEqual(expected.save());
  });
});

describe('catch techniques and arcade boundary possession', () => {
  it('latches manual catch techniques through the existing PlayerIntent boundary', () => {
    const mappings = [
      [Action.ACTION, 'RAC'], [Action.PROTECT, 'POSSESSION'],
      [Action.JUMP, 'AGGRESSIVE'], [Action.DIVE, 'EXTEND'],
    ] as const;
    for (const [action, technique] of mappings) {
      const world = airWorld(); const receiver = world.athletes[1]; receiver.x = 0; receiver.z = 0;
      applyActions(world, receiver, { moveX: 0, moveZ: 0, aimX: 0, aimZ: 0,
        held: action, pressed: action, released: 0 });
      expect(receiver.ballPlayTechnique).toBe(technique);
      expect(receiver.ballPlayUntilTick).toBeGreaterThan(world.tick);
    }
    for (const [action, technique] of [[Action.JUMP, 'PLAY_BALL'], [Action.DIVE, 'SWAT']] as const) {
      const world = airWorld(); const defender = world.athletes[7]; defender.x = 0; defender.z = -0.2;
      applyActions(world, defender, { moveX: 0, moveZ: 0, aimX: 0, aimZ: 0,
        held: action, pressed: action, released: 0 });
      expect(defender.ballPlayTechnique).toBe(technique);
    }
  });

  it('accepts one inbounds foot and rejects a receiver wholly outside', () => {
    const athlete = airWorld().athletes[1]; athlete.facing = 0;
    athlete.x = FIELD_HALF_WIDTH + 0.15;
    expect(oneFootInBounds(athlete).legal).toBe(true);
    athlete.x = FIELD_HALF_WIDTH + 0.4;
    expect(oneFootInBounds(athlete).legal).toBe(false);
  });

  it('credits a legal sideline catch and records an illegal one as an out-of-bounds drop', () => {
    const legal = airWorld(44); const receiver = legal.athletes[1];
    receiver.x = FIELD_HALF_WIDTH + 0.15; receiver.z = 0; receiver.onFire = true;
    receiver.def = { ...receiver.def, ratings: { ...receiver.def.ratings, hands: 100 } };
    legal.ball.x = receiver.x;
    expect(resolveAirBall(legal)).toBe(true);
    expect(legal.bus.log?.find((event) => event.type === 'catch')).toMatchObject({ sideline: true });

    const illegal = airWorld(44); const outside = illegal.athletes[1];
    outside.x = FIELD_HALF_WIDTH + 0.4; outside.z = 0;
    illegal.ball.x = outside.x;
    expect(resolveAirBall(illegal)).toBe(true);
    expect(illegal.bus.log?.find((event) => event.type === 'drop')).toMatchObject({
      reason: 'OUT_OF_BOUNDS', sideline: true,
    });
    expect(illegal.bus.log?.some((event) => event.type === 'catch')).toBe(false);
  });

  it('does not award a direct interception when the defender cannot land one foot inbounds', () => {
    const world = airWorld(2); const receiver = world.athletes[1]; const defender = world.athletes[7];
    receiver.x = FIELD_HALF_WIDTH + 0.4; receiver.z = 0.25;
    defender.x = FIELD_HALF_WIDTH + 0.4; defender.z = -0.1; defender.facing = 0;
    defender.ballPlayTechnique = 'PLAY_BALL'; defender.ballPlayUntilTick = 999;
    defender.def = { ...defender.def, ratings: { ...defender.def.ratings, hands: 100, awareness: 100 } };
    world.ball.x = defender.x; world.ball.z = 0;
    const flight = world.ball.state as Extract<typeof world.ball.state, { kind: 'inAir' }>;
    flight.tx = defender.x; flight.tz = 10;
    expect(resolveAirBall(world)).toBe(true);
    expect(world.bus.log?.some((event) => event.type === 'interception')).toBe(false);
    expect(world.bus.log?.find((event) => event.type === 'drop')).toMatchObject({
      by: defender.id, reason: 'OUT_OF_BOUNDS', technique: 'PLAY_BALL',
    });
  });

  it('requires a defender to face the current tipped ball before attempting a recovery', () => {
    const world = airWorld(4); const defender = world.athletes[7];
    world.athletes[1].x = 40; world.athletes[1].z = 40;
    defender.x = 0; defender.z = -0.2; defender.facing = Math.PI;
    world.ball.x = 0; world.ball.y = 1.5; world.ball.z = 0;
    world.ball.vx = 0; world.ball.vy = 2; world.ball.vz = 1;
    world.ball.state = { kind: 'loose', lastTouch: 1, ticks: 1, fromFumble: false,
      tipped: true, attemptMask: 0 };
    expect(resolveLooseBall(world)).toBe(false);
    expect(world.rng.save()).toEqual(new Rng(4).save());
    defender.facing = 0;
    expect(resolveLooseBall(world)).toBe(true);
    expect(world.bus.log?.some((event) => event.type === 'interception')).toBe(true);
  });

  it('ends an illegal sideline tip recovery at the contact point', () => {
    const world = airWorld(4); const defender = world.athletes[7];
    world.athletes[1].x = 40; world.athletes[1].z = 40;
    defender.x = FIELD_HALF_WIDTH + 0.4; defender.z = 0; defender.facing = 0;
    world.ball.x = defender.x; world.ball.y = 1.5; world.ball.z = 0;
    world.ball.vx = 0; world.ball.vy = 2; world.ball.vz = 1;
    world.ball.state = { kind: 'loose', lastTouch: 1, ticks: 1, fromFumble: false,
      tipped: true, attemptMask: 0 };
    expect(resolveLooseBall(world)).toBe(true);
    expect(world.ball.state.kind).toBe('dead');
    expect(world.bus.log?.find((event) => event.type === 'drop')).toMatchObject({
      by: defender.id, reason: 'OUT_OF_BOUNDS', technique: 'PLAY_BALL',
    });
    expect(world.bus.log?.some((event) => event.type === 'interception')).toBe(false);
  });
});
