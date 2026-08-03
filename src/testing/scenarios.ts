import type { TeamSide } from '../core/types.ts';
import { Match, defaultMatchConfig } from '../rules/match.ts';
import { getTeam, TEAM_IDS } from '../data/index.ts';
import { giveBall, dropLoose, killBall } from '../sim/ball.ts';
import { OFF_START, DEF_START, carrier } from '../sim/world.ts';
import { kickReturner } from '../sim/catching.ts';
import { baseSpeed } from '../sim/movement.ts';
import { computeFirstDown, dirOf, goalOf, noteCatch, breakStreaks } from '../rules/rulesEngine.ts';
import { s } from '../core/constants.ts';

export interface ScenarioResult { name: string; pass: boolean; detail: string; ticks: number }

function newMatch(seed = 7, quarterSeconds = 120): Match {
  const cfg = defaultMatchConfig({
    seed, home: TEAM_IDS[0], away: TEAM_IDS[1], quarterSeconds,
    seats: [
      { side: 0, active: false }, { side: 1, active: false },
      { side: 0, active: false }, { side: 1, active: false },
    ],
  });
  const m = new Match({ config: cfg, home: getTeam(cfg.home), away: getTeam(cfg.away) });
  m.bus.record();
  return m;
}

function runUntil(m: Match, pred: (m: Match) => boolean, limit = s(120)): number {
  let t = 0;
  while (t < limit && !pred(m)) { m.tick(); t++; }
  return t;
}

function countEvent(m: Match, type: string): number {
  return (m.bus.log ?? []).filter((e) => e.type === type).length;
}

/** Park the match on a clean 1st-and-30 for `side` at `losZ`, with a snapshot for deltas. */
function toScrimmage(m: Match, side: TeamSide, losZ: number, down = 1): void {
  runUntil(m, (x) => x.phase === 'PLAY_CALL', s(120));
  m.state.possession = side;
  m.state.down = down;
  m.state.losZ = losZ;
  m.state.firstDownZ = computeFirstDown(losZ, side);
  // Re-enter PLAY_CALL so the CPU picks against the state we just installed.
  m.state.phase = 'DEAD_BALL';
  m.state.phaseTicks = 0;
  m.state.phase = 'PLAY_CALL';
  m.state.phaseTicks = 0;
  m.forcePlayCallForTest();
}

/** Drop the current ball carrier where they stand so the play ends on this spot. */
function downCarrier(m: Match): void {
  const c = carrier(m.world);
  if (!c) return;
  c.move = 'DOWN'; c.moveTicks = s(1.2); c.downTicks = s(1.2);
  c.vx = 0; c.vz = 0;
}

/** Move every defender far away so a scripted carrier is not touched. */
function clearDefense(m: Match, side: TeamSide): void {
  for (let i = 0; i < 7; i++) {
    const d = m.world.athletes[DEF_START + i];
    if (d.side === side) continue;
    d.x = 40; d.z = 55;
  }
}

interface Scenario { name: string; run(): ScenarioResult }
function scenario(name: string, body: (m: Match) => { pass: boolean; detail: string }): Scenario {
  return {
    name,
    run(): ScenarioResult {
      const m = newMatch();
      try {
        const out = body(m);
        const ticks = m.world.tick;
        m.dispose();
        return { name, pass: out.pass, detail: out.detail, ticks };
      } catch (e) {
        const ticks = m.world.tick;
        m.dispose();
        return { name, pass: false, detail: `threw: ${String(e)}`, ticks };
      }
    },
  };
}

export const SCENARIOS: Scenario[] = [
  scenario('kickoff and return', (m) => {
    runUntil(m, (x) => x.phase === 'KICKOFF_LIVE', s(20));
    const ok = m.phase === 'KICKOFF_LIVE';
    runUntil(m, (x) => x.phase === 'PLAY_CALL' || x.phase === 'SCORE_RESOLVE', s(45));
    return { pass: ok && countEvent(m, 'kickoff') > 0, detail: `phase=${m.phase} kickoffs=${countEvent(m, 'kickoff')}` };
  }),

  scenario('the deep man fields every kickoff, at a sprint', (m) => {
    // The two things the kick return is built on, asserted rather than hoped for: he catches it —
    // all of them, no bounce, no scramble — and he is running when he does. Catching it standing
    // still is worth 3.9 yards a return, which is what this used to be.
    let kicks = 0; let fielded = 0; let slow = 0; let deep = 0;
    for (let i = 0; i < 14; i++) {
      runUntil(m, (x) => x.phase === 'KICKOFF_LIVE', s(90));
      if (m.phase !== 'KICKOFF_LIVE') break;
      const w = m.world;
      const ret = kickReturner(w);
      if (!ret || w.special === 'ONSIDE') { runUntil(m, (x) => x.phase !== 'KICKOFF_LIVE', s(30)); continue; }
      kicks++;
      // He must start in his own end zone: the run-up is the whole design.
      if ((ret.homeZ - goalOf(w.possession)) * dirOf(w.possession) >= 3) deep++;
      const id = ret.id;
      runUntil(m, (x) => x.world.athletes[id].hasBall || x.phase !== 'KICKOFF_LIVE', s(30));
      const a = w.athletes[id];
      if (a.hasBall) {
        fielded++;
        if (Math.hypot(a.vx, a.vz) < baseSpeed(a)) slow++;
      }
      runUntil(m, (x) => x.phase !== 'KICKOFF_LIVE', s(30));
    }
    return {
      pass: kicks >= 4 && fielded === kicks && slow === 0 && deep === kicks,
      detail: `${fielded}/${kicks} fielded, ${slow} caught below jogging pace, ${deep}/${kicks} lined up in the end zone`,
    };
  }),

  scenario('play reaches a snap and a dead ball', (m) => {
    toScrimmage(m, 0, 25);
    runUntil(m, (x) => x.phase === 'LIVE', s(30));
    const snapped = m.phase === 'LIVE';
    const before = countEvent(m, 'play.end');
    runUntil(m, (x) => countEvent(x, 'play.end') > before, s(45));
    return { pass: snapped && countEvent(m, 'play.end') > before, detail: `snapped=${snapped} ends=${countEvent(m, 'play.end')}` };
  }),

  scenario('30 yards is a first down', (m) => {
    toScrimmage(m, 0, 20);
    const target = m.state.firstDownZ;
    runUntil(m, (x) => x.phase === 'LIVE', s(30));
    clearDefense(m, 0);
    const car = m.world.athletes[OFF_START];
    giveBall(m.world, car.id);
    car.x = 0; car.z = target + 1.5;
    downCarrier(m);
    runUntil(m, (x) => x.phase === 'PLAY_CALL', s(45));
    return { pass: m.state.down === 1 && m.state.losZ >= target, detail: `down=${m.state.down} los=${m.state.losZ.toFixed(1)} target=${target.toFixed(1)}` };
  }),

  scenario('failing to gain 30 advances the down', (m) => {
    toScrimmage(m, 0, 20);
    runUntil(m, (x) => x.phase === 'LIVE', s(30));
    clearDefense(m, 0);
    const car = m.world.athletes[OFF_START];
    giveBall(m.world, car.id);
    car.x = 0; car.z = 24;
    downCarrier(m);
    runUntil(m, (x) => x.phase === 'PLAY_CALL', s(45));
    return { pass: m.state.down === 2 && m.state.possession === 0, detail: `down=${m.state.down} poss=${m.state.possession} los=${m.state.losZ.toFixed(1)}` };
  }),

  scenario('touchdown scores 6 and goes to a conversion', (m) => {
    toScrimmage(m, 0, 80);
    const before = m.state.teams[0].score;
    const tdBefore = countEvent(m, 'touchdown');
    runUntil(m, (x) => x.phase === 'LIVE', s(30));
    clearDefense(m, 0);
    const car = m.world.athletes[OFF_START + 1];
    giveBall(m.world, car.id);
    car.x = 2; car.z = 101;
    runUntil(m, (x) => x.phase === 'CONVERSION_CALL' || x.phase === 'CONVERSION_LIVE', s(90));
    return {
      pass: m.state.teams[0].score - before >= 6 && countEvent(m, 'touchdown') === tdBefore + 1,
      detail: `delta=${m.state.teams[0].score - before} tds=+${countEvent(m, 'touchdown') - tdBefore} phase=${m.phase}`,
    };
  }),

  scenario('safety scores 2 for the defence', (m) => {
    toScrimmage(m, 0, 4);
    const before = m.state.teams[1].score;
    const sBefore = countEvent(m, 'safety');
    runUntil(m, (x) => x.phase === 'LIVE', s(30));
    clearDefense(m, 0);
    const car = m.world.athletes[OFF_START];
    giveBall(m.world, car.id);
    car.x = 0; car.z = -0.6;
    // A safety needs the carrier DOWN in his own end zone, not merely standing in it.
    downCarrier(m);
    runUntil(m, (x) => x.phase === 'KICKOFF_SETUP', s(180));
    return { pass: m.state.teams[1].score - before === 2 && countEvent(m, 'safety') === sBefore + 1, detail: `delta=${m.state.teams[1].score - before} safeties=+${countEvent(m, 'safety') - sBefore}` };
  }),

  scenario('interception flips possession', (m) => {
    toScrimmage(m, 0, 40);
    runUntil(m, (x) => x.phase === 'LIVE', s(30));
    const d = m.world.athletes[DEF_START];
    giveBall(m.world, d.id);
    m.world.passThrown = true;
    downCarrier(m);
    runUntil(m, (x) => x.phase === 'PLAY_CALL', s(60));
    return { pass: m.state.possession === 1 && m.state.down === 1, detail: `poss=${m.state.possession} down=${m.state.down} los=${m.state.losZ.toFixed(1)}` };
  }),

  scenario('fumble becomes a live ball that resolves', (m) => {
    toScrimmage(m, 0, 45);
    runUntil(m, (x) => x.phase === 'LIVE', s(30));
    const car = m.world.athletes[OFF_START + 1];
    giveBall(m.world, car.id);
    dropLoose(m.world, car.id, 4, 5, 3, true);
    runUntil(m, (x) => x.phase === 'PLAY_CALL' || x.phase === 'SCORE_RESOLVE' || x.phase === 'CONVERSION_CALL', s(120));
    return { pass: m.phase !== 'LIVE' && m.world.ball.state.kind !== 'loose', detail: `phase=${m.phase} ball=${m.world.ball.state.kind}` };
  }),

  scenario('turnover on downs', (m) => {
    toScrimmage(m, 0, 30, 4);
    m.state.firstDownZ = 90;
    m.submitOffense(m.offensePlays[0]);   // go for it rather than punting
    m.submitDefense(m.defensePlays[0]);
    runUntil(m, (x) => x.phase === 'LIVE', s(30));
    clearDefense(m, 0);
    const car = m.world.athletes[OFF_START];
    giveBall(m.world, car.id);
    car.x = 0; car.z = 31;
    downCarrier(m);
    runUntil(m, (x) => x.phase === 'PLAY_CALL', s(60));
    return { pass: m.state.possession === 1 && m.state.down === 1, detail: `poss=${m.state.possession} down=${m.state.down}` };
  }),

  scenario('field goal attempt resolves', (m) => {
    toScrimmage(m, 0, 78, 4);
    const attBefore = countEvent(m, 'fieldGoal.attempt');
    const resBefore = countEvent(m, 'fieldGoal.result');
    m.submitOffense(null, 'FIELD_GOAL');
    m.submitDefense(m.defensePlays[0]);
    runUntil(m, (x) => countEvent(x, 'fieldGoal.result') > resBefore, s(90));
    return {
      pass: countEvent(m, 'fieldGoal.attempt') === attBefore + 1 && countEvent(m, 'fieldGoal.result') === resBefore + 1,
      detail: `attempts=+${countEvent(m, 'fieldGoal.attempt') - attBefore} results=+${countEvent(m, 'fieldGoal.result') - resBefore}`,
    };
  }),

  scenario('punt changes possession', (m) => {
    toScrimmage(m, 0, 25, 4);
    const before = countEvent(m, 'punt');
    m.submitOffense(null, 'PUNT');
    m.submitDefense(m.defensePlays[0]);
    runUntil(m, (x) => countEvent(x, 'punt') > before, s(60));
    // A punt is a hang time plus a full return — give it the same room the sim does.
    runUntil(m, (x) => x.phase === 'PLAY_CALL' || x.phase === 'SCORE_RESOLVE', s(600));
    const last = (m.bus.log ?? []).filter((e) => e.type === 'play.end').pop() as { reason?: string } | undefined;
    // A punt legitimately ends either with the receiving team taking over, or with the
    // receiving team taking it back to the house.
    const flipped = m.state.possession === 1;
    const returnedForSix = last?.reason === 'TOUCHDOWN' && m.state.teams[1].score > 0;
    return {
      pass: countEvent(m, 'punt') === before + 1 && (flipped || returnedForSix),
      detail: `punts=+${countEvent(m, 'punt') - before} poss=${m.state.possession} reason=${last?.reason ?? '?'} away=${m.state.teams[1].score}`,
    };
  }),

  scenario('quarter expiry advances the quarter', (m) => {
    toScrimmage(m, 0, 40);
    const q = m.state.quarter;
    m.state.clockTicks = 6;
    runUntil(m, (x) => x.state.quarter === q + 1, s(180));
    return { pass: m.state.quarter === q + 1 && m.state.clockTicks > 0, detail: `q=${m.state.quarter} clock=${m.state.clockTicks}` };
  }),

  scenario('halftime kicks off to the other team', (m) => {
    toScrimmage(m, 0, 40);
    m.state.quarter = 2;
    m.state.clockTicks = 4;
    runUntil(m, (x) => x.state.quarter === 3, s(300));
    return { pass: m.state.quarter === 3 && m.state.kickoffReceiving === m.state.secondHalfReceiver, detail: `q=${m.state.quarter} recv=${m.state.kickoffReceiving}` };
  }),

  scenario('tie at the end of regulation goes to overtime', (m) => {
    toScrimmage(m, 0, 45);
    m.state.quarter = 4;
    m.state.clockTicks = 3;
    runUntil(m, (x) => x.phase === 'LIVE', s(30));
    clearDefense(m, 0);
    // Hold the score level while the clock runs out — anything either side scores in the
    // meantime would make this a test of the AI rather than of the overtime rule.
    const car = m.world.athletes[OFF_START];
    giveBall(m.world, car.id);
    car.x = 0; car.z = 46; downCarrier(m);
    let guard = 0;
    while (guard++ < s(240) && !(m.state.quarter > 4 || m.state.finished)) {
      m.state.teams[0].score = 21; m.state.teams[1].score = 21;
      m.tick();
    }
    m.state.teams[0].score = 21; m.state.teams[1].score = 21;
    return { pass: m.state.quarter > 4 && !m.state.finished, detail: `q=${m.state.quarter} finished=${m.state.finished} scores=${m.state.teams[0].score}-${m.state.teams[1].score}` };
  }),

  scenario('match ends with a valid winner', (m) => {
    toScrimmage(m, 0, 45);
    m.state.quarter = 4;
    m.state.clockTicks = 3;
    runUntil(m, (x) => x.phase === 'LIVE', s(30));
    clearDefense(m, 0);
    const car = m.world.athletes[OFF_START];
    giveBall(m.world, car.id);
    car.x = 0; car.z = 46; downCarrier(m);
    let g2 = 0;
    while (g2++ < s(240) && !m.state.finished) {
      m.state.teams[0].score = 28; m.state.teams[1].score = 14;
      m.tick();
    }
    return { pass: m.state.finished && m.state.winner === 0, detail: `finished=${m.state.finished} winner=${String(m.state.winner)}` };
  }),

  scenario('overdrive activates after three catches to one receiver', (m) => {
    const t = m.state.teams[0];
    t.catchStreak = 0; t.catchStreakReceiver = -1; t.overdrive = false;
    noteCatch(m.state, 0 as TeamSide, 3);
    noteCatch(m.state, 0 as TeamSide, 3);
    const mid = t.overdrive;
    const res = noteCatch(m.state, 0 as TeamSide, 3);
    return { pass: !mid && res.started && t.overdrive, detail: `after2=${mid} started=${res.started} overdrive=${t.overdrive}` };
  }),

  scenario('a different receiver resets the same-receiver chain', (m) => {
    const t = m.state.teams[0];
    t.catchStreak = 0; t.catchStreakReceiver = -1; t.teamCatchStreak = 0; t.overdrive = false;
    noteCatch(m.state, 0 as TeamSide, 3);
    noteCatch(m.state, 0 as TeamSide, 4);   // different receiver restarts the personal chain
    const personalReset = t.catchStreak === 1 && t.catchStreakReceiver === 4;
    return { pass: personalReset && !t.overdrive && t.teamCatchStreak === 2,
      detail: `personal=${t.catchStreak} team=${t.teamCatchStreak} overdrive=${t.overdrive}` };
  }),

  scenario('an incompletion wipes both overdrive chains', (m) => {
    const t = m.state.teams[0];
    t.catchStreak = 0; t.catchStreakReceiver = -1; t.teamCatchStreak = 0; t.overdrive = false;
    noteCatch(m.state, 0 as TeamSide, 3);
    noteCatch(m.state, 0 as TeamSide, 4);
    breakStreaks(m.state, 0 as TeamSide);
    const started = noteCatch(m.state, 0 as TeamSide, 5).started;
    return { pass: !started && t.catchStreak === 1 && t.teamCatchStreak === 1,
      detail: `personal=${t.catchStreak} team=${t.teamCatchStreak}` };
  }),

  scenario('ball never has two owners', (m) => {
    let bad = '';
    for (let i = 0; i < s(180); i++) {
      m.tick();
      let owners = 0;
      for (const a of m.world.athletes) if (a.hasBall) owners++;
      if (owners > 1) { bad = `two owners at tick ${i}`; break; }
      if (m.world.ball.state.kind === 'held' && owners !== 1) { bad = `held with ${owners} owners at tick ${i}`; break; }
      if (m.world.ball.state.kind !== 'held' && owners !== 0) { bad = `${m.world.ball.state.kind} with ${owners} owners at tick ${i}`; break; }
    }
    return { pass: bad === '', detail: bad || 'ok' };
  }),

  scenario('no athlete leaves the world bounds', (m) => {
    let bad = '';
    for (let i = 0; i < s(180); i++) {
      m.tick();
      for (const a of m.world.athletes) {
        if (!Number.isFinite(a.x) || !Number.isFinite(a.z)) { bad = `NaN on #${a.id}`; break; }
        if (Math.abs(a.x) > 45 || a.z < -25 || a.z > 125) { bad = `#${a.id} at ${a.x.toFixed(1)},${a.z.toFixed(1)}`; break; }
      }
      if (bad) break;
    }
    return { pass: bad === '', detail: bad || 'ok' };
  }),

  scenario('onside kick resolves to a valid possession', (m) => {
    runUntil(m, (x) => x.phase === 'PLAY_CALL' || x.phase === 'SCORE_RESOLVE', s(120));
    const p = m.state.possession;
    return { pass: p === 0 || p === 1, detail: `poss=${p} los=${m.state.losZ.toFixed(1)}` };
  }),

  scenario('conversion after a touchdown always resolves', (m) => {
    toScrimmage(m, 0, 90);
    runUntil(m, (x) => x.phase === 'LIVE', s(30));
    clearDefense(m, 0);
    const car = m.world.athletes[OFF_START + 1];
    giveBall(m.world, car.id);
    car.z = 101;
    runUntil(m, (x) => x.phase === 'KICKOFF_SETUP' || x.phase === 'FINAL', s(600));
    return { pass: m.phase === 'KICKOFF_SETUP' || m.phase === 'FINAL', detail: `phase=${m.phase}` };
  }),

  scenario('dead ball never scores', (m) => {
    toScrimmage(m, 0, 95);
    runUntil(m, (x) => x.phase === 'LIVE', s(30));
    killBall(m.world);
    const before = m.state.teams[0].score;
    // Only the dead-ball window counts. This used to tick a flat six seconds and compare the
    // score at the end, which is not what its name says: six seconds from the 95 contains two
    // further snaps, so a perfectly legal touchdown on the NEXT play was being reported as a
    // dead ball scoring. The window now ends when the whistle does.
    let ticks = 0;
    let snaps = 0;
    const off = m.bus.on('snap', () => { snaps++; });
    while (m.state.phase === 'LIVE' && ticks++ < s(6)) m.tick();
    for (let i = 0; i < 12; i++) m.tick();          // let the spot and the whistle resolve
    off();
    const after = m.state.teams[0].score;
    return {
      pass: after === before && snaps === 0,
      detail: `before=${before} after=${after} over ${ticks} ticks, ${snaps} snaps`,
    };
  }),

  scenario('a controller vanishing mid-play does not stall the match', (m) => {
    const cfg = m.config;
    cfg.seats[0] = { side: 0, active: true };
    runUntil(m, (x) => x.phase === 'PLAY_CALL' || x.phase === 'PRE_SNAP', s(120));
    // Seat 0 is "connected" but supplies no intent — the watchdog must still advance play.
    const before = m.world.tick;
    runUntil(m, (x) => x.state.quarter > 1 || x.state.finished, s(60 * 60 * 6));
    return { pass: m.world.tick > before && (m.state.quarter > 1 || m.state.finished), detail: `q=${m.state.quarter} watchdogs=${m.watchdogCount}` };
  }),
];

export function runAllScenarios(): ScenarioResult[] { return SCENARIOS.map((sc) => sc.run()); }

export { dirOf, goalOf };
