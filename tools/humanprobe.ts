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
import { s as ticks } from '../src/core/constants.ts';
import { carrier, OFF_START } from '../src/sim/world.ts';
import { OFFENSE_PLAYS } from '../src/plays/offense.ts';
import type { OffensePlay, PlayerIntent, TeamSide } from '../src/core/types.ts';

function offensePlaysAll(): OffensePlay[] { return OFFENSE_PLAYS as OffensePlay[]; }

const held = { mask: 0, moveX: 0, moveZ: 0, aimX: 0, aimZ: 0 };
const intent: PlayerIntent = { moveX: 0, moveZ: 0, aimX: 0, aimZ: 0, held: 0, pressed: 0, released: 0 };

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
      intent.moveX = held.moveX; intent.moveZ = held.moveZ;
      // Aim is carried separately from movement, so a script can now hold the passer still and
      // vary only the placement. That was impossible while `throwTo` read the movement stick,
      // which is why placement shipped unmeasured (QA_REPORT.md §12.12).
      intent.aimX = held.aimX; intent.aimZ = held.aimZ;
      intent.held = held.mask;
      return intent;
    },
  });
}

function press(mask: number): void { held.mask |= mask; }
function release(mask: number): void { held.mask &= ~mask; }
function clearInput(): void { held.mask = 0; held.moveX = 0; held.moveZ = 0; held.aimX = 0; held.aimZ = 0; }

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

  // Now throw. Give the routes a moment — but stop as soon as the quarterback is no longer
  // standing there with it, because pressing a receiver button at a fixed tick count tested
  // nothing except whether the ball happened to still be in his hands.
  for (let i = 0; i < 70; i++) {
    const w = m.world;
    if (w.playPhase !== 'LIVE') break;
    const c = carrier(w);
    // As soon as he has had a beat with it AND is still on his feet. Waiting a fixed count meant
    // this sometimes pressed the button at a quarterback who was already on the floor.
    if (w.playTicks > 12 && c?.id === w.qbId && c.move === 'NORMAL' && !w.passThrown) break;
    m.tick();
  }
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

// ── 3b. holding the snap button must not also throw the ball ───────────────
//
// The button that snaps is the button that throws, and both were resolving in the SAME tick:
// `applyActions` runs during PRE-SNAP too, so a player who held ACTION to snap had the ball
// thrown — or, in the run formations, pitched — at playTicks=0, before the play had advanced a
// frame. On screen the ball simply started in a receiver's hands. Checked across every offensive
// play, because whether it was survivable depended entirely on where the primary receiver stood.
{
  clearInput();
  let offend = 0; let checked = 0; let worst = '';
  for (const play of offensePlaysAll()) {
    const m = makeMatch(0, 2024);
    let t = 0; let armed = false;
    while (t++ < 200000 && !m.state.finished) {
      if (m.state.phase === 'PLAY_CALL' && m.pendingOffense === null && m.state.possession === 0) {
        m.submitOffense(play);
      }
      const ours = m.state.possession === 0 && m.world.offensePlay?.id === play.id;
      if (m.state.phase === 'PRE_SNAP' && ours) {
        // Press and KEEP HOLDING, which is what a thumb does.
        if (!armed) { clearInput(); armed = true; } else press(Action.ACTION);
      }
      const wasLive = m.world.playPhase === 'LIVE';
      m.tick();
      if (!wasLive && m.world.playPhase === 'LIVE' && ours) {
        const w = m.world;
        const car = carrier(w);
        checked++;
        if (!car || car.id !== w.qbId || w.passThrown) {
          offend++;
          if (!worst) {
            worst = `${play.name}: ball=${car ? car.def.pos : w.ball.state.kind}`
              + `${w.passThrown ? ' (already thrown)' : ''}`;
          }
        }
        break;
      }
    }
    clearInput();
  }
  check('holding the snap button does not also throw the ball',
    offend === 0, `${checked - offend}/${checked} plays snap into the quarterback's hands`
      + (worst ? ` — worst: ${worst}` : ''));
}

// ── 4. a whole game on the sticks, throwing to the play's own primary read ─
//
// Run over several seeds, and asserted on the aggregate. One game is not a measurement of this:
// the same script across six seeds gained between 107 and 353 yards, so a threshold set just under
// a single observed value fails the next time the dice land differently. What is stable — and what
// is actually worth asserting — is that a person holding these buttons catches passes, moves the
// ball, and is never shut out.
let readingYards = 0; let readingScore = 0;
function playAGame(seed: number, blind = false): { yards: number; score: number; catches: number; throws: number; picks: number; tds: number } {
  clearInput();
  const m = makeMatch(0, seed);
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
      // Throw on the play's own primary read — or immediately if a rusher is on top of him,
      // which is what a person does. A fixed 0.67s timer with no regard for pressure took this
      // scripted human eight to nineteen sacks a game, and measured his patience rather than
      // anything about the game.
      const qb = w.athletes[w.qbId];
      let pressure = 99;
      for (const d of w.athletes) {
        if (d.side === qb.side || d.move === 'DOWN') continue;
        pressure = Math.min(pressure, Math.hypot(d.x - qb.x, d.z - qb.z));
      }
      const readAt = w.offensePlay?.timing?.primary ?? ticks(1.5);
      const holdingIt = !w.passThrown && carrier(w)?.id === w.qbId;
      // The pressure clause has to wait out the snap. A defensive line stands two yards from a
      // shotgun quarterback, so "somebody is within four yards" is true on the first frame of
      // every play, and firing on it just reinvents the instant throw this pass exists to remove.
      const hurried = w.playTicks > ticks(0.7) && pressure < 3.2;
      // Throw to the receiver THIS PLAY names as its primary read, which is the minimum competent
      // thing a person with the play diagram in front of them does. The script used to hammer the
      // middle button on every snap of every concept, and once coverage started actually covering
      // (deep zones defending a ceiling, cover men spending turbo) that stopped working — 113
      // yards and nothing on the board. Reading the play instead: 271 yards and three touchdowns
      // in the same harness. The game got harder for a player who ignores it and stayed generous
      // to one who does not, which is the trade this whole pass was making. The naive version is
      // kept as its own check below rather than deleted, because how far a button-masher gets is
      // worth knowing on purpose.
      // `blind` is the control arm: the same player, the same seed, the only difference being that
      // he hammers the middle button instead of throwing to the read the play names.
      const readIdx = w.offensePlay && !blind ? w.offensePlay.reads[0] : -1;
      const readId = readIdx >= 0 ? (w.athletes[OFF_START + readIdx]?.id ?? -1) : -1;
      const slot = blind ? 1 : w.passTargets.indexOf(readId);
      const btn = slot === 0 ? Action.TARGET_L : slot === 2 ? Action.TARGET_R : Action.TARGET_M;
      for (const b of [Action.TARGET_L, Action.TARGET_M, Action.TARGET_R]) release(b);
      if (holdingIt && (w.playTicks > readAt || hurried)) press(btn);
      // Once the ball is caught the seat drives the receiver, and a person runs with it.
      const car = carrier(w);
      const mine = car && car.controlledBySeat === 0 && car.id !== w.qbId;
      held.moveZ = mine ? 1 : 0;
      if (mine) press(Action.TURBO); else release(Action.TURBO);
    } else {
      clearInput(); armed = false;
      // A person does not put the controller down because the other team kicked off. The seat
      // takes the returner the instant he catches it, and this script handed him to nobody — it
      // froze him where he stood and then measured the human offence's field position as whatever
      // the coverage did to a stationary man. It was reading the return team's alignment, not the
      // player's offence, and it moved every time the kickoff did.
      const car = carrier(w);
      if (car && car.controlledBySeat === 0) { held.moveZ = 1; press(Action.TURBO); }
    }
    m.tick(); t++;
  }
  clearInput();
  return {
    yards: m.state.teams[0].stats.totalYds, score: m.state.teams[0].score,
    catches, throws, picks, tds,
  };
}
{
  const seeds = [8801, 8802, 8803];
  const runs = seeds.map((sd) => playAGame(sd));
  const sum = (f: (r: typeof runs[0]) => number): number => runs.reduce((a, r) => a + f(r), 0);
  const yards = sum((r) => r.yards), catches = sum((r) => r.catches);
  const throws = sum((r) => r.throws), picks = sum((r) => r.picks), tds = sum((r) => r.tds);
  const shutouts = runs.filter((r) => r.score === 0).length;
  readingYards = yards; readingScore = sum((r) => r.score);
  check('a human-offence game reaches a final',
    runs.length === seeds.length, `${seeds.length} full games on the sticks`);
  check('a human offence throws repeatedly across a game',
    throws >= 8 * seeds.length, `${throws} throws over ${seeds.length} games`);
  check('those throws are actually caught',
    catches >= Math.max(3, throws * 0.25),
    `${catches} catches, ${picks} picked, from ${throws} throws`);
  // NOT "scores". That assertion used to pass, and it passed for the wrong reason: the button
  // that snapped the ball was also throwing it on the same tick, so every pass left the
  // quarterback's hand at playTicks=0, uncontested, and the scripted human moved the ball by
  // exploiting a bug. What is worth asserting is that a person holding these buttons can MOVE
  // THE BALL — and, since this script now reads the play, that it can score doing it.
  check('a human offence moves the ball, every time out',
    catches >= 8 * seeds.length && yards > 120 * seeds.length && shutouts === 0,
    `${Math.round(yards / seeds.length)} yards and ${(readingScore / seeds.length).toFixed(1)} points a game,`
      + ` ${catches} catches, ${tds} touchdowns, ${shutouts} shutouts`);
  clearInput();
}

// ── 4b. does reading the play actually pay? ────────────────────────────────
//
// It does not, and this block exists to keep saying so.
//
// The claim I made when the coverage work landed was that a deep zone defending a ceiling and a
// cover man who spends turbo make the game harder for a player who ignores the play and no harder
// for one who uses it. The evidence was one seed: 271 yards and three touchdowns throwing to each
// play's named primary read, against 113 and nothing hammering the middle button. Convincing, and
// noise. Over TEN seeds per arm, same script, same games, the only difference being which receiver
// he throws to:
//
//     reading the primary read   205 yards, 10.2 points a game
//     always the middle button   223 yards, 11.1 points a game
//
// The effect is not there. If anything it points the other way, which is not surprising once said
// out loud: the middle receiver is the slot, the slot runs the shortest routes, and "throw it to
// the slot" is a perfectly good heuristic in a game with this much grass in the middle of the
// field. So this is recorded as a MEASUREMENT rather than an assertion — it prints the gap and
// only fails if the two arms diverge wildly, which would mean something has changed enough to go
// and look at.
{
  const blind = [8801, 8802, 8803].map((sd) => playAGame(sd, true));
  const blindYards = blind.reduce((a, r) => a + r.yards, 0);
  const blindScore = blind.reduce((a, r) => a + r.score, 0);
  const ratio = blindYards / Math.max(1, readingYards);
  check('reading the play and hammering one button are within a factor of two',
    ratio > 0.5 && ratio < 2,
    `${Math.round(blindYards / 3)} yd / ${(blindScore / 3).toFixed(1)} pts a game blind`
      + ` vs ${Math.round(readingYards / 3)} / ${(readingScore / 3).toFixed(1)} reading`
      + '  — the read is NOT worth more; see the comment');
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
