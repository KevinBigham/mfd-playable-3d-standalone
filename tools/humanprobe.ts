#!/usr/bin/env tsx
/**
 * Drive a real match with a SCRIPTED HUMAN and report what actually happens. `npm run human`
 *
 * Every other harness in this project plays CPU against CPU, which is why a batch of two hundred
 * clean games coexisted with a game that was broken in a player's hands. This one holds the
 * buttons a person holds and prints what the simulation does about it.
 *
 * Input is the same `PlayerIntent` a keyboard produces — the match computes the press and release
 * edges itself, exactly as it does for a real seat.
 */
import { Match, defaultMatchConfig } from '../src/rules/match.ts';
import { getTeam, TEAM_IDS } from '../src/data/index.ts';
import { Action } from '../src/input/actions.ts';
import { carrier } from '../src/sim/world.ts';
import type { PlayerIntent, TeamSide } from '../src/core/types.ts';

const held = { mask: 0, moveX: 0, moveZ: 0 };
const intent: PlayerIntent = { moveX: 0, moveZ: 0, held: 0, pressed: 0, released: 0 };

function makeMatch(humanSide: TeamSide, seed = 8801): Match {
  const cfg = defaultMatchConfig({
    seed, quarterSeconds: 120, difficulty: 'PRO',
    home: TEAM_IDS[0], away: TEAM_IDS[1],
    seats: [
      { side: humanSide, active: true }, { side: 1, active: false },
      { side: 0, active: false }, { side: 1, active: false },
    ],
  });
  return new Match({
    config: cfg,
    home: getTeam(cfg.home!),
    away: getTeam(cfg.away!),
    seatIntent: (seat) => {
      if (seat !== 0) return null;
      intent.moveX = held.moveX; intent.moveZ = held.moveZ; intent.held = held.mask;
      return intent;
    },
  });
}

function press(mask: number): void { held.mask |= mask; }
function release(mask: number): void { held.mask &= ~mask; }
function clearInput(): void { held.mask = 0; held.moveX = 0; held.moveZ = 0; }

function runTo(m: Match, phase: string, cap = 40000): boolean {
  let t = 0;
  while (t < cap && m.state.phase !== phase && !m.state.finished) { m.tick(); t++; }
  return m.state.phase === phase;
}
function runToPossession(m: Match, side: TeamSide, phase = 'PRE_SNAP', cap = 200000): boolean {
  let t = 0;
  while (t < cap && !m.state.finished) {
    if (m.state.phase === phase && m.state.possession === side) {
      // One tick so the phase's own bookkeeping — control assignment above all — has run.
      // Reading it on the entry frame measures the PREVIOUS play.
      m.tick();
      return true;
    }
    m.tick(); t++;
  }
  return false;
}

function seatAthlete(m: Match): number {
  return m.world.athletes.findIndex((a) => a.controlledBySeat === 0);
}

let pass = 0; let fail = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { pass++; console.log(`  PASS  ${name.padEnd(56)} ${detail}`); }
  else { fail++; console.log(`  FAIL  ${name.padEnd(56)} ${detail}`); }
}

console.log('\nGRIDIRON OVERDRIVE — scripted human\n'
  + '──────────────────────────────────────────────────────────────────────');

// ── 1. who is under the player's hands, and who has the ball ───────────────
{
  clearInput();
  const m = makeMatch(0);
  runToPossession(m, 0);
  const w = m.world;
  const seat = seatAthlete(m);
  const car = carrier(w);
  check('at pre-snap the player controls the quarterback',
    seat >= 0 && seat === w.qbId,
    `controlling=${seat} (${seat >= 0 ? w.athletes[seat].def.pos : '-'}) qb=${w.qbId}`);
  check('at pre-snap the quarterback has the ball',
    Boolean(car) && car!.id === w.qbId,
    `ball=${car ? `${car.id} (${car.def.pos})` : 'none'}`);
  const qb = w.athletes[w.qbId];
  const dir = w.possession === 0 ? 1 : -1;
  check('the quarterback starts behind the line of scrimmage',
    (qb.z - w.losZ) * dir < -0.5,
    `qb is ${((qb.z - w.losZ) * dir).toFixed(1)} yd relative to the line`);
}

// ── 2. can the player walk downfield before the snap? ──────────────────────
{
  clearInput();
  const m = makeMatch(0);
  runToPossession(m, 0);
  const w = m.world;
  const id = seatAthlete(m);
  const startZ = id >= 0 ? w.athletes[id].z : 0;
  const los = w.losZ;
  held.moveZ = 1;                       // hold "forward" for two seconds
  for (let i = 0; i < 120 && m.state.phase === 'PRE_SNAP'; i++) m.tick();
  const a = w.athletes[id];
  const crossed = a.z - los;
  check('pre-snap movement cannot cross the line of scrimmage',
    crossed <= 0.6,
    `moved ${(a.z - startZ).toFixed(1)} yd, ended ${crossed.toFixed(1)} yd past the line`);
  clearInput();
}

// ── 3. does one press of ACTION snap, and does the next one throw? ─────────
{
  clearInput();
  const m = makeMatch(0);
  // Hold ACTION from the play-call screen onward, so the button is already down when pre-snap
  // begins. That is exactly what a player's hand is doing after they pick a play.
  let guard = 0;
  while (guard++ < 200000 && !m.state.finished) {
    if (m.state.phase === 'PLAY_CALL' && m.state.possession === 0) { press(Action.ACTION); break; }
    m.tick();
  }
  const w = m.world;
  for (let i = 0; i < 2000 && m.state.phase !== 'PRE_SNAP'; i++) m.tick();
  for (let i = 0; i < 40 && m.state.phase === 'PRE_SNAP'; i++) m.tick();
  const snappedWhileHeld = m.state.phase !== 'PRE_SNAP';
  check('a held button left over from play select does not snap the ball',
    !snappedWhileHeld, snappedWhileHeld ? 'snapped without a fresh press' : 'held ignored');
  release(Action.ACTION);
  for (let i = 0; i < 6; i++) m.tick();
  press(Action.ACTION);
  let t = 0;
  while (t < 120 && m.state.phase === 'PRE_SNAP') { m.tick(); t++; }
  check('a fresh press snaps the ball', m.state.phase === 'LIVE', `phase=${m.state.phase}`);
  release(Action.ACTION);

  // Now throw. Give the routes a moment, then press a receiver button.
  for (let i = 0; i < 45 && m.world.playPhase === 'LIVE'; i++) m.tick();
  const beforeThrow = m.world.ball.state.kind;
  press(Action.TARGET_M);
  m.tick(); m.tick();
  release(Action.TARGET_M);
  for (let i = 0; i < 3; i++) m.tick();
  const st = m.world.ball.state.kind;
  check('pressing a receiver button throws the ball',
    st === 'inAir' || m.world.passThrown,
    `ball ${beforeThrow} -> ${st}, passThrown=${m.world.passThrown}`);
  clearInput();
}

// ── 4. the same throw, over a whole game, without ever moving ──────────────
{
  clearInput();
  const m = makeMatch(0);
  let throws = 0; let snaps = 0; let catches = 0; let picks = 0; let tds = 0;
  m.bus.on('throw', () => { throws++; });
  m.bus.on('snap', () => { snaps++; });
  m.bus.on('catch', () => { catches++; });
  m.bus.on('interception', () => { picks++; });
  m.bus.on('touchdown', (e: any) => { if (e.side === 0) tds++; });
  let t = 0;
  let armed = false;
  while (!m.state.finished && t < 60 * 60 * 25) {
    const w = m.world;
    // A person picks a play in about a second rather than letting the timer run out.
    if (m.state.phase === 'PLAY_CALL' && m.pendingOffense === null && m.state.possession === 0) {
      m.submitOffense(m.offensePlays[(snaps * 5) % m.offensePlays.length]);
    }
    if (m.state.phase === 'PRE_SNAP' && m.state.possession === 0) {
      // Release, then press, so the edge is real; then throw a beat after the snap.
      if (!armed) { release(Action.ACTION); armed = true; }
      else press(Action.ACTION);
    } else if (w.playPhase === 'LIVE' && m.state.possession === 0) {
      release(Action.ACTION);
      armed = false;
      if (w.playTicks > 40 && !w.passThrown && carrier(w)?.id === w.qbId) press(Action.TARGET_M);
      else release(Action.TARGET_M);
      // Once the ball is caught the seat drives the receiver, and a person runs with it.
      const car = carrier(w);
      const mine = car && car.controlledBySeat === 0 && car.id !== w.qbId;
      held.moveZ = mine ? 1 : 0;
      if (mine) press(Action.TURBO); else release(Action.TURBO);
    } else {
      clearInput(); armed = false;
    }
    m.tick(); t++;
  }
  check('a human-offence game reaches a final',
    m.state.finished, `${t} ticks, ${snaps} snaps`);
  check('a human offence throws repeatedly across a game',
    throws >= 8, `${throws} throws in ${snaps} snaps`);
  check('those throws are actually caught',
    catches >= Math.max(3, throws * 0.25),
    `${catches} catches, ${picks} picked, from ${throws} throws`);
  check('a human offence scores',
    m.state.teams[0].score > 0,
    `final ${m.state.teams[0].score}-${m.state.teams[1].score}, ${tds} human touchdowns`);
  clearInput();
}

// ── 5. kickoff: can the player kick, and does he get the returner? ─────────
{
  clearInput();
  const m = makeMatch(0);
  const gotKickoff = runTo(m, 'KICKOFF_SETUP');
  check('a kickoff phase is reached', gotKickoff, `phase=${m.state.phase}`);
  if (gotKickoff) {
    const kicking = m.state.possession;
    let t = 0;
    let armed = false;
    while (t < 1200 && (m.state.phase === 'KICKOFF_SETUP' || m.state.phase === 'KICKOFF_LIVE')) {
      // Same grammar as a field goal: release to arm, press to strike.
      if (m.state.phase === 'KICKOFF_SETUP') {
        if (!armed) { release(Action.ACTION); armed = true; } else press(Action.ACTION);
      } else {
        release(Action.ACTION);
      }
      m.tick(); t++;
    }
    check('the kickoff leaves the setup phase', m.state.phase !== 'KICKOFF_SETUP',
      `phase=${m.state.phase} after ${t} ticks`);
    let u = 0;
    while (u < 900 && m.state.phase !== 'PLAY_CALL' && m.state.phase !== 'PRE_SNAP'
      && !m.state.finished) { m.tick(); u++; }
    check('the kickoff resolves to a live scrimmage down',
      m.state.phase === 'PLAY_CALL' || m.state.phase === 'PRE_SNAP',
      `phase=${m.state.phase} possession=${m.state.possession} (kicked by ${kicking}) los=${m.state.losZ.toFixed(1)}`);
    check('the kick changes possession to the receiving team',
      m.state.possession !== kicking, `possession=${m.state.possession}, kicked by ${kicking}`);
  }
  clearInput();
}

// ── 6. kickoff return under human control ──────────────────────────────────
{
  clearInput();
  const m = makeMatch(1);          // human receives
  runTo(m, 'KICKOFF_LIVE');
  let sawControl = false; let sawCarry = false;
  for (let i = 0; i < 900 && m.state.phase === 'KICKOFF_LIVE'; i++) {
    m.tick();
    const id = seatAthlete(m);
    if (id >= 0) {
      sawControl = true;
      if (m.world.athletes[id].hasBall) sawCarry = true;
    }
  }
  check('the receiving player is given an athlete during the return', sawControl);
  check('the receiving player ends up controlling the returner', sawCarry,
    sawCarry ? '' : 'never held the ball');
  clearInput();
}

console.log('──────────────────────────────────────────────────────────────────────');
console.log(`${pass}/${pass + fail} human-input checks passed\n`);
process.exit(fail === 0 ? 0 : 1);
