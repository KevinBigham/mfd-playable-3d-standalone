import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/core/events.ts';
import { Rng } from '../src/core/rng.ts';
import { s } from '../src/core/constants.ts';
import { getTeam, TEAM_IDS } from '../src/data/index.ts';
import { OFFENSE_PLAYS } from '../src/plays/offense.ts';
import { DEFENSE_PLAYS } from '../src/plays/defense.ts';
import { assignUnits, createWorld } from '../src/sim/world.ts';
import { routeSteer, screenBlockAssignments, setupPlay } from '../src/sim/playRunner.ts';
import {
  compressedLanePenalty, routeReadiness, screenCarrierSteer, screenThrowReady,
  shortYardageCarrierBias,
} from '../src/ai/athleteAI.ts';

function realScreenWorld() {
  const rng = new Rng(9100);
  const world = createWorld(
    getTeam(TEAM_IDS[0]), getTeam(TEAM_IDS[1]),
    { weather: 'CLEAR', surface: 'GRASS', windX: 0, windZ: 0, traction: 1 },
    rng, new EventBus(),
  );
  assignUnits(world, 0);
  setupPlay(world, {
    offense: OFFENSE_PLAYS.find((play) => play.id === 'o-ladder-screen')!,
    defense: DEFENSE_PLAYS[0], losZ: 30, spotX: 0, possession: 0,
  });
  return world;
}

describe('screen runtime behavior', () => {
  it('holds the puller in protection before deterministically releasing him', () => {
    const world = realScreenWorld();
    const puller = world.athletes[1];
    const out = { x: 0, z: 0, turbo: false };
    routeSteer(world, puller, out);
    expect(puller.routeIdx).toBe(0);
    for (let tick = 1; tick < s(0.3); tick++) routeSteer(world, puller, out);
    expect(puller.routeIdx).toBe(1);
    expect(puller.blockClock).toBe(0);
  });

  it('reserves distinct pursuit threats for two released screen blockers', () => {
    const world = realScreenWorld();
    const puller = world.athletes[1];
    const stalk = world.athletes[4];
    puller.routeIdx = 2;
    stalk.routeIdx = 1;
    puller.x = -3; puller.z = 31;
    stalk.x = 3; stalk.z = 32;
    const receiver = world.athletes[5];
    receiver.x = 0; receiver.z = 30; receiver.vx = 0; receiver.vz = 7;
    for (let i = 7; i < 14; i++) world.athletes[i].move = 'DOWN';
    world.athletes[7].move = 'NORMAL'; world.athletes[7].x = -2; world.athletes[7].z = 36;
    world.athletes[8].move = 'NORMAL'; world.athletes[8].x = 2; world.athletes[8].z = 37;
    const assignments = screenBlockAssignments(world);
    expect(assignments.get(puller.id)).toBeDefined();
    expect(assignments.get(stalk.id)).toBeDefined();
    expect(assignments.get(puller.id)).not.toBe(assignments.get(stalk.id));
  });

  it('activates convoy steering on an actual completed screen pass state', () => {
    const world = realScreenWorld();
    const carrier = world.athletes[5];
    carrier.hasBall = true; carrier.x = 0; carrier.z = 32;
    world.athletes[0].hasBall = false;
    world.passThrown = true;
    const blocker = world.athletes[1];
    blocker.routeIdx = 2; blocker.x = 0; blocker.z = 34;
    const out = { moveX: 0, moveZ: 0 };
    expect(screenCarrierSteer(world, carrier, out)).toBe(true);
    expect(out.moveX).not.toBe(0);
    expect(out.moveZ).toBeGreaterThan(0);
  });

  it('makes identical screen states produce identical carrier and blocker decisions', () => {
    const decide = () => {
      const world = realScreenWorld();
      const carrier = world.athletes[5];
      carrier.hasBall = true; carrier.x = 1; carrier.z = 32;
      world.athletes[0].hasBall = false; world.passThrown = true;
      world.athletes[1].routeIdx = 2; world.athletes[1].x = 1; world.athletes[1].z = 34;
      const out = { moveX: 0, moveZ: 0 };
      screenCarrierSteer(world, carrier, out);
      return { out, blocks: [...screenBlockAssignments(world)] };
    };
    expect(decide()).toEqual(decide());
  });

  it('does not allow a screen throw before the sell, but pressure can shorten the window', () => {
    const play = OFFENSE_PLAYS.find((candidate) => candidate.id === 'o-ladder-screen')!;
    expect(screenThrowReady(play, s(0.4), 1.5)).toBe(false);
    expect(screenThrowReady(play, s(1.1), 1.5)).toBe(true);
    expect(screenThrowReady(play, s(1.1), 8)).toBe(false);
    expect(screenThrowReady(play, s(1.4), 8)).toBe(true);
  });

  it('distinguishes route phases and compressed goal-line lanes', () => {
    const blocking = { route: [{ action: 'BLOCK' }], routeIdx: 0, routeHold: 0 } as any;
    const broken = { route: [{ action: 'RUN' }, { action: 'SETTLE' }], routeIdx: 1, routeHold: 0 } as any;
    expect(routeReadiness(blocking)).toBeLessThan(routeReadiness(broken));
    const qb = { x: 0, z: 80 } as any;
    expect(compressedLanePenalty({ x: 1, z: 86 } as any, { x: 2, z: 88 } as any, qb, 1)).toBeGreaterThan(0);
  });

  it('applies downhill short-yardage bias only when 1–3 yards are actually needed', () => {
    const normal = shortYardageCarrierBias({ shortYardage: 1 }, 1, 0.2, 1, 8);
    const short = shortYardageCarrierBias({ shortYardage: 1 }, 1, 0.2, 1, 2);
    expect(normal).toEqual({ x: 1, z: 0.2 });
    expect(short.x).toBeLessThan(normal.x);
    expect(short.z).toBeGreaterThan(normal.z);
  });
});
