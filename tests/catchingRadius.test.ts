import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/core/events.ts';
import { Rng } from '../src/core/rng.ts';
import { getTeam, TEAM_IDS } from '../src/data/index.ts';
import { resolveAirBall } from '../src/sim/catching.ts';
import { assignUnits, createWorld } from '../src/sim/world.ts';

function airBallWorld() {
  const world = createWorld(
    getTeam(TEAM_IDS[0]), getTeam(TEAM_IDS[1]),
    { weather: 'CLEAR', surface: 'GRASS', windX: 0, windZ: 0, traction: 1 },
    new Rng(117), new EventBus(),
  );
  assignUnits(world, 0);
  for (const athlete of world.athletes) {
    athlete.x = 50; athlete.z = 50; athlete.y = 0;
    athlete.def = { ...athlete.def, ratings: { ...athlete.def.ratings, hands: 50, awareness: 50 } };
  }
  world.ball.x = 0; world.ball.y = 1.5; world.ball.z = 0;
  world.ball.state = {
    kind: 'inAir', from: 0, intended: 1, passKind: 'NORMAL', t: 0.5, flightTime: 1,
    sx: 0, sy: 1.85, sz: -10, tx: 0, ty: 1.55, tz: 0, arc: 1, contested: false,
  };
  return world;
}

describe('receiver catch radius', () => {
  it('lets the intended receiver make a play just outside the previous normal-pass boundary', () => {
    const world = airBallWorld();
    world.athletes[1].x = 1.9; world.athletes[1].z = 0;

    expect(resolveAirBall(world)).toBe(true);
    expect(world.ball.state.kind).not.toBe('inAir');
  });

  it('still rejects a throw beyond the widened receiver envelope', () => {
    const world = airBallWorld();
    world.athletes[1].x = 2.1; world.athletes[1].z = 0;

    expect(resolveAirBall(world)).toBe(false);
    expect(world.ball.state.kind).toBe('inAir');
  });

  it('does not give defenders the receiver-only radius increase', () => {
    const world = airBallWorld();
    world.athletes[1].x = 50; world.athletes[1].z = 50;
    world.athletes[7].x = 1.9; world.athletes[7].z = 0;

    expect(resolveAirBall(world)).toBe(false);
    expect(world.ball.state.kind).toBe('inAir');
  });
});
