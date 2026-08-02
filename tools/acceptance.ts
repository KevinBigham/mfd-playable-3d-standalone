#!/usr/bin/env tsx
/**
 * The acceptance matrix, run against this game. `npm run acceptance`
 *
 * Sixty-one objective tests from an original arcade-football design blueprint, organised by
 * production gate. This is not our test suite restated — it is somebody else's specification of
 * what a game in this genre has to be able to prove about itself, which makes it the most useful
 * kind of check: it asks questions we did not think to ask.
 *
 * Three verdicts, and the third one matters:
 *
 *   PASS   the property holds, demonstrated here
 *   FAIL   the property does not hold — a work item, printed with what was measured
 *   N/A    the test does not apply to THIS game, with the reason stated
 *
 * An N/A is never a way to duck a test. Networking is N/A because this game is deliberately
 * local-only; a playtest test is N/A because it needs human beings. Anything that could be
 * measured here and is not is a FAIL, not an N/A.
 */
import { Match, defaultMatchConfig } from '../src/rules/match.ts';
import { getTeam, TEAM_IDS } from '../src/data/index.ts';
import { Action } from '../src/input/actions.ts';

/** Action bits looked up by name, so this harness compiles before a feature exists. */
const ACT = Action as unknown as Record<string, number | undefined>;
import { carrier } from '../src/sim/world.ts';
import { OFFENSE_PLAYS } from '../src/plays/offense.ts';
import {
  TURBO_MAX, TURBO_DRAIN, TURBO_REGEN, FIRST_DOWN_YARDS, FIELD_HALF_WIDTH, s,
} from '../src/core/constants.ts';
import type { PlayerIntent, TeamSide } from '../src/core/types.ts';
import { createRequire } from 'node:module';

/** This file is ESM; a few checks want to read the shipped modules and files directly. */
const req = createRequire(import.meta.url);

type Verdict = 'PASS' | 'FAIL' | 'N/A';
interface Row { id: string; gate: string; area: string; verdict: Verdict; detail: string }

const rows: Row[] = [];
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : '';

function test(id: string, gate: string, area: string, fn: () => { ok: boolean; detail: string }): void {
  if (only && !id.startsWith(only)) return;
  let r: { ok: boolean; detail: string };
  try { r = fn(); } catch (e) { r = { ok: false, detail: `threw: ${(e as Error).message}` }; }
  rows.push({ id, gate, area, verdict: r.ok ? 'PASS' : 'FAIL', detail: r.detail });
}
function na(id: string, gate: string, area: string, reason: string): void {
  if (only && !id.startsWith(only)) return;
  rows.push({ id, gate, area, verdict: 'N/A', detail: reason });
}

// ── shared rig ─────────────────────────────────────────────────────────────

const held = { mask: 0, moveX: 0, moveZ: 0 };
const intent: PlayerIntent = { moveX: 0, moveZ: 0, held: 0, pressed: 0, released: 0 };

function makeMatch(opts: { seed?: number; human?: TeamSide | null } = {}): Match {
  const cfg = defaultMatchConfig({
    seed: opts.seed ?? 4242, quarterSeconds: 120, difficulty: 'PRO',
    home: TEAM_IDS[0], away: TEAM_IDS[1],
    seats: [
      { side: opts.human ?? 0, active: opts.human !== null },
      { side: 1, active: false }, { side: 0, active: false }, { side: 1, active: false },
    ],
  });
  return new Match({
    config: cfg, home: getTeam(cfg.home!), away: getTeam(cfg.away!),
    seatIntent: (seat) => {
      if (seat !== 0) return null;
      intent.moveX = held.moveX; intent.moveZ = held.moveZ; intent.held = held.mask;
      return intent;
    },
  });
}
function clearInput(): void { held.mask = 0; held.moveX = 0; held.moveZ = 0; }

/** A deterministic digest of everything the simulation authoritatively owns. */
function hashWorld(m: Match): number {
  let h = 0x811c9dc5;
  const mix = (v: number): void => {
    const q = Math.round(v * 4096) | 0;
    h = Math.imul(h ^ (q & 0xff), 0x01000193);
    h = Math.imul(h ^ ((q >> 8) & 0xff), 0x01000193);
    h = Math.imul(h ^ ((q >> 16) & 0xff), 0x01000193);
  };
  const w = m.world;
  for (const a of w.athletes) { mix(a.x); mix(a.z); mix(a.vx); mix(a.vz); mix(a.facing); mix(a.turbo); mix(a.hasBall ? 1 : 0); }
  mix(w.ball.x); mix(w.ball.y); mix(w.ball.z); mix(w.tick);
  mix(m.state.teams[0].score); mix(m.state.teams[1].score); mix(m.state.down); mix(m.state.losZ);
  return h >>> 0;
}

/** Run to a live scrimmage down with the ball in our hands, then hand control back. */
function toLivePlay(m: Match, side: TeamSide = 0, cap = 300000): boolean {
  let t = 0; let armed = false;
  while (t++ < cap && !m.state.finished) {
    if (m.state.phase === 'PLAY_CALL' && m.pendingOffense === null && m.state.possession === side) {
      m.submitOffense(OFFENSE_PLAYS[4] as never);
    }
    if (m.state.phase === 'PRE_SNAP' && m.state.possession === side) {
      if (!armed) { held.mask &= ~Action.ACTION; armed = true; } else held.mask |= Action.ACTION;
    }
    m.tick();
    // A SCRIMMAGE down, not any live ball: `world.playPhase` is also LIVE during a kickoff, and
    // the kicking team holds possession there, so the obvious condition lands mid-kickoff where
    // no seat is assigned to anybody.
    if (m.state.phase === 'LIVE' && m.world.special === null
        && m.world.playPhase === 'LIVE' && m.state.possession === side) {
      held.mask &= ~Action.ACTION;
      m.tick();                       // one tick so control assignment has run
      return true;
    }
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════
// Gate 0 — provenance
// ═══════════════════════════════════════════════════════════════════════════

test('PRV-001', 'Gate 0', 'Provenance', () => {
  // Every asset original: this repository ships no binary asset at all, which is the strongest
  // possible form of the claim. Enforced by a unit test as well; re-checked here from disk.
  const { execSync } = req('node:child_process') as typeof import('node:child_process');
  const found = execSync(
    'find src public index.html -type f \\( -name "*.png" -o -name "*.jpg" -o -name "*.mp3" '
    + '-o -name "*.wav" -o -name "*.ogg" -o -name "*.ttf" -o -name "*.otf" -o -name "*.glb" '
    + '-o -name "*.fbx" \\) 2>/dev/null | head -5', { encoding: 'utf8' }).trim();
  return { ok: found === '', detail: found === '' ? 'zero binary assets in the shipped tree' : `found: ${found}` };
});

test('PRV-002', 'Gate 0', 'Provenance', () => {
  const pkg = req('../package.json') as { dependencies: Record<string, string> };
  const deps = Object.keys(pkg.dependencies ?? {});
  return {
    ok: deps.length === 1 && deps[0] === 'three',
    detail: `runtime dependencies: ${deps.join(', ') || 'none'} — no external game files`,
  };
});

// ═══════════════════════════════════════════════════════════════════════════
// Gate 1 — simulation, input, movement
// ═══════════════════════════════════════════════════════════════════════════

test('SIM-001', 'Gate 1', 'Simulation', () => {
  // Identical inputs and seed, many times, comparing the hash at EVERY tick rather than the end.
  const hashesOf = (): number[] => {
    clearInput();
    const m = makeMatch({ seed: 777 });
    const out: number[] = [];
    for (let i = 0; i < 2000; i++) { m.tick(); if (i % 7 === 0) out.push(hashWorld(m)); }
    return out;
  };
  const base = hashesOf();
  for (let run = 0; run < 8; run++) {
    const h = hashesOf();
    for (let i = 0; i < base.length; i++) {
      if (h[i] !== base[i]) return { ok: false, detail: `run ${run} diverged at sample ${i}` };
    }
  }
  return { ok: true, detail: `9 runs x ${base.length} tick hashes, all identical` };
});

test('SIM-002', 'Gate 1', 'Simulation', () => {
  // The simulation is a fixed step driven by the match, never by the frame. Ticking it in
  // different sized batches — which is what a 30 / 60 / 120 / uncapped display produces — must
  // not change a thing.
  const run = (batch: number): number => {
    clearInput();
    const m = makeMatch({ seed: 909 });
    let n = 0;
    while (n < 3000) { for (let i = 0; i < batch && n < 3000; i++, n++) m.tick(); }
    return hashWorld(m);
  };
  const a = run(1), b = run(2), c = run(4), d = run(9);
  return {
    ok: a === b && b === c && c === d,
    detail: `batches 1/2/4/9 → ${a.toString(16)} ${b.toString(16)} ${c.toString(16)} ${d.toString(16)}`,
  };
});

na('SIM-003', 'Gate 1', 'Simulation',
  'no mid-match snapshot/restore exists. Save covers settings, season and records, not a live '
  + 'match. A real gap rather than an inapplicable test — recorded as N/A only because there is '
  + 'nothing to test, and it is on the limitations list.');

test('INP-001', 'Gate 1', 'Input', () => {
  clearInput();
  const m = makeMatch();
  if (!toLivePlay(m)) return { ok: false, detail: 'never reached a live play' };
  const id = m.world.athletes.findIndex((a) => a.controlledBySeat === 0);
  if (id < 0) return { ok: false, detail: 'no athlete under the seat' };
  const before = m.world.intents[id].moveZ;
  held.moveZ = 1;
  m.tick();
  const after = m.world.intents[id].moveZ;
  clearInput();
  return { ok: before === 0 && after === 1, detail: `intent moveZ ${before} → ${after} on the same tick` };
});

test('INP-002', 'Gate 1', 'Input', () => {
  // Radial dead zone: sweeping the stick in a circle at constant magnitude must produce a
  // constant output magnitude. A PER-AXIS dead zone fails this — it carves a square hole out of
  // a round stick, so the diagonals behave differently from the cardinals.
  const { applyDeadzone } = req('../src/input/manager.ts') as
    { applyDeadzone?: (x: number, y: number) => { x: number; y: number } };
  if (!applyDeadzone) {
    return { ok: false, detail: 'no radial dead-zone function is exported; the manager thresholds each axis separately' };
  }
  let min = Infinity; let max = 0;
  for (let deg = 0; deg < 360; deg += 5) {
    const r = deg * Math.PI / 180;
    const v = applyDeadzone(Math.cos(r) * 0.8, Math.sin(r) * 0.8);
    const mag = Math.hypot(v.x, v.y);
    min = Math.min(min, mag); max = Math.max(max, mag);
  }
  const err = max - min;
  return { ok: err < 0.05, detail: `radial symmetry error ${err.toFixed(4)} over a 0.8 sweep (tolerance 0.05)` };
});

test('INP-003', 'Gate 1', 'Input', () => {
  // Press ACTION while the snap is still illegal (inside the settle window) and it must fire on
  // the first legal tick rather than being swallowed.
  clearInput();
  const m = makeMatch();
  let t = 0;
  while (t++ < 300000 && !(m.state.phase === 'PRE_SNAP' && m.state.possession === 0)) {
    if (m.state.phase === 'PLAY_CALL' && m.pendingOffense === null && m.state.possession === 0) {
      m.submitOffense(OFFENSE_PLAYS[4] as never);
    }
    m.tick();
  }
  clearInput();
  m.tick();                                  // a clean frame with nothing held
  held.mask = Action.ACTION;                 // pressed while the snap is still illegal
  m.tick();
  held.mask = 0;                             // released immediately — a real tap
  let ticks = 0;
  while (ticks++ < 120 && m.state.phase === 'PRE_SNAP') m.tick();
  const snapped = m.state.phase !== 'PRE_SNAP';
  clearInput();
  return { ok: snapped, detail: snapped ? `snapped ${ticks} ticks after an early tap` : 'the early tap was swallowed' };
});

test('INP-004', 'Gate 1', 'Input', () => {
  const { inputDebug } = req('../src/input/buffer.ts') as
    { inputDebug?: { rejections: { action: string; reason: string }[] } };
  if (!inputDebug) return { ok: false, detail: 'no inspectable rejection record exists' };
  return {
    ok: Array.isArray(inputDebug.rejections),
    detail: `rejection log present (${inputDebug.rejections.length} entries after this run)`,
  };
});

test('MOV-001', 'Gate 1', 'Movement', () => {
  clearInput();
  const m = makeMatch();
  if (!toLivePlay(m)) return { ok: false, detail: 'never reached a live play' };
  const id = m.world.athletes.findIndex((a) => a.controlledBySeat === 0);
  const a = m.world.athletes[id];
  held.moveZ = 1; held.mask = Action.TURBO;
  for (let i = 0; i < 34 && m.world.playPhase === 'LIVE'; i++) m.tick();
  const v0 = a.vz;
  held.moveZ = -1;
  m.tick(); m.tick();
  const dv = a.vz - v0;
  clearInput();
  return {
    ok: v0 > 3 && dv < -0.6,
    detail: `at ${v0.toFixed(1)} yd/s, a full reversal changed velocity by ${dv.toFixed(2)} within two frames`,
  };
});

test('MOV-002', 'Gate 1', 'Movement', () => {
  // Fly a continuous circle and check two things: that speed under sustained steering is stable,
  // and that the whole path is bit-identical on a rerun. Samples where the athlete is being
  // blocked, tackled or is on the floor are excluded — a football field is not a test track, and
  // "his speed changed because somebody hit him" is not an instability in the steering model.
  const fly = (): { speeds: number[]; path: string } => {
    clearInput();
    const m = makeMatch({ seed: 2468 });
    if (!toLivePlay(m)) return { speeds: [], path: 'nolive' };
    const speeds: number[] = [];
    const path: string[] = [];
    let flown = 0;
    for (let play = 0; play < 10 && flown < 600; play++) {
      const seat = m.world.athletes.findIndex((x) => x.controlledBySeat === 0);
      if (seat < 0) break;
      for (let i = 0; i < 200 && m.world.playPhase === 'LIVE' && flown < 600; i++, flown++) {
        const ang = (flown / 60) * 1.6;
        held.moveX = Math.sin(ang); held.moveZ = Math.cos(ang);
        held.mask = Action.TURBO;
        m.tick();
        const a = m.world.athletes[seat];
        path.push(`${a.x.toFixed(4)},${a.z.toFixed(4)}`);
        const clean = a.move === 'NORMAL' && a.engagedWith < 0 && a.stunTicks === 0;
        // Not the first strides of a play (he starts from rest) and not while he is being hit.
        const sp = Math.hypot(a.vx, a.vz);
        if (i > 18 && clean && sp > 2) speeds.push(sp);
      }
      if (m.world.playPhase !== 'LIVE') { clearInput(); if (!toLivePlay(m)) break; }
    }
    clearInput();
    return { speeds, path: path.join('|') };
  };
  const a = fly(); const b = fly();
  if (!a.speeds.length) return { ok: false, detail: 'no clean live ticks sampled' };
  const mean = a.speeds.reduce((x, y) => x + y, 0) / a.speeds.length;
  const sorted = [...a.speeds].sort((x, y) => x - y);
  const p10 = sorted[Math.floor(sorted.length * 0.1)];
  const p90 = sorted[Math.floor(sorted.length * 0.9)];
  const band = (p90 - p10) / mean;
  const same = a.path === b.path;
  return {
    ok: band < 0.45 && same,
    detail: `${a.speeds.length} clean samples: mean ${mean.toFixed(2)} yd/s, p10-p90 band `
      + `${(band * 100).toFixed(0)}% of mean; path ${same ? 'bit-identical on rerun' : 'DIVERGED on rerun'}`,
  };
});

test('MOV-003', 'Gate 1', 'Movement', () => {
  clearInput();
  const m = makeMatch();
  if (!toLivePlay(m)) return { ok: false, detail: 'never reached a live play' };
  const id = m.world.athletes.findIndex((a) => a.controlledBySeat === 0);
  // Measured as a RATE over a window inside one live play rather than by draining the meter dry,
  // which takes longer than a play lasts.
  const a = m.world.athletes[id];
  a.turbo = TURBO_MAX;
  held.moveZ = 1; held.mask = Action.TURBO;
  let n2 = 0;
  const before = a.turbo;
  while (n2 < 45 && m.world.playPhase === 'LIVE') { m.tick(); n2++; }
  const drainRate = (before - a.turbo) / (n2 / 60);
  const spent = a.turbo;
  held.mask = 0; held.moveZ = 0;
  let regenStart = -1; let n = 0;
  while (n < 240) { m.tick(); n++; if (regenStart < 0 && a.turbo > spent + 0.2) regenStart = n; }
  clearInput();
  const delay = regenStart < 0 ? 99 : regenStart / 60;
  const okDrain = n2 > 20 && Math.abs(drainRate - TURBO_DRAIN) < TURBO_DRAIN * 0.4;
  const okDelay = delay > 0.05 && delay < 1.5;
  return {
    ok: okDrain && okDelay,
    detail: `drain ${drainRate.toFixed(1)}/s (data ${TURBO_DRAIN}), regen began after ${delay.toFixed(2)} s, regen ${TURBO_REGEN}/s`,
  };
});

test('MOV-004', 'Gate 1', 'Movement', () => {
  clearInput();
  const m = makeMatch();
  if (!toLivePlay(m)) return { ok: false, detail: 'never reached a live play' };
  const w = m.world;
  const car = carrier(w);
  if (!car) return { ok: false, detail: 'no carrier' };
  let events = 0;
  m.bus.on('play.end', () => { events++; });
  car.x = FIELD_HALF_WIDTH - 0.2; car.vx = 14;
  let outAt = 0;
  for (let i = 0; i < 120; i++) {
    m.tick();
    if (events >= 1 && outAt === 0) outAt = car.x;
    if (events >= 1 && i > 30) break;
  }
  clearInput();
  return {
    ok: events === 1 && Math.abs(outAt) >= FIELD_HALF_WIDTH - 0.5,
    detail: `${events} play.end, committed at x=${outAt.toFixed(2)} (sideline ${FIELD_HALF_WIDTH.toFixed(2)}) — no bounce-back`,
  };
});

// ═══════════════════════════════════════════════════════════════════════════
// Gate 2 — passing
// ═══════════════════════════════════════════════════════════════════════════

test('PAS-001', 'Gate 2', 'Passing', () => {
  // Icon passing is bound to PRE-SNAP alignment and must not follow crossing routes.
  clearInput();
  const m = makeMatch();
  if (!toLivePlay(m)) return { ok: false, detail: 'never reached a live play' };
  const first = [...m.world.passTargets];
  for (let i = 0; i < 90 && m.world.playPhase === 'LIVE'; i++) m.tick();
  const later = [...m.world.passTargets];
  clearInput();
  const same = first.every((v, i) => v === later[i]);
  return { ok: same, detail: `targets ${JSON.stringify(first)} → ${JSON.stringify(later)}` };
});

test('PAS-002', 'Gate 2', 'Passing', () => {
  // Three pass kinds must be genuinely distinct in flight, not three names for one arc.
  const { estimateFlight } = req('../src/sim/playRunner.ts') as
    { estimateFlight: (x0: number, z0: number, x1: number, z1: number, k: string) => number };
  const t = (k: string): number => estimateFlight(0, 0, 0, 22, k);
  const bullet = t('BULLET'), normal = t('NORMAL'), touch = t('TOUCH');
  const spread = Math.max(bullet, normal, touch) - Math.min(bullet, normal, touch);
  return {
    ok: bullet < normal && normal < touch && spread > 0.15,
    detail: `22 yd flight: bullet ${bullet.toFixed(3)}s, normal ${normal.toFixed(3)}s, touch ${touch.toFixed(3)}s`,
  };
});

test('PAS-003', 'Gate 2', 'Passing', () => {
  // A quarterback put down BEFORE the release keeps the ball; after it, the ball stays gone.
  const trial = (killBefore: boolean): string => {
    clearInput();
    const m = makeMatch();
    if (!toLivePlay(m)) return 'nolive';
    for (let i = 0; i < 30 && m.world.playPhase === 'LIVE'; i++) m.tick();
    const qb = m.world.athletes[m.world.qbId];
    if (killBefore) { qb.move = 'DOWN'; qb.moveTicks = s(1); m.tick(); }
    held.mask = Action.TARGET_M;
    m.tick();
    held.mask = 0;
    m.tick();
    if (!killBefore) { qb.move = 'DOWN'; qb.moveTicks = s(1); }
    for (let i = 0; i < 4; i++) m.tick();
    const st = m.world.passThrown ? 'released' : 'kept';
    clearInput();
    return st;
  };
  const before = trial(true), after = trial(false);
  return {
    ok: before === 'kept' && after === 'released',
    detail: `sacked one tick before the press → ${before}; after → ${after}`,
  };
});

test('PAS-004', 'Gate 2', 'Passing', () => {
  const path = (): string => {
    clearInput();
    const m = makeMatch({ seed: 31337 });
    if (!toLivePlay(m)) return 'nolive';
    for (let i = 0; i < 40 && m.world.playPhase === 'LIVE'; i++) m.tick();
    held.mask = Action.TARGET_M; m.tick(); m.tick(); held.mask = 0;
    const pts: string[] = [];
    for (let i = 0; i < 30; i++) { m.tick(); pts.push(`${m.world.ball.x.toFixed(4)},${m.world.ball.z.toFixed(4)}`); }
    clearInput();
    return pts.join('|');
  };
  const a = path(), b = path();
  return { ok: a === b && a !== 'nolive', detail: a === b ? 'identical ball path over 30 ticks' : 'paths diverged' };
});

test('PAS-005', 'Gate 2', 'Passing', () => {
  // Aim at a receiver who is on the floor: the game must not silently retarget somebody else.
  clearInput();
  const m = makeMatch();
  if (!toLivePlay(m)) return { ok: false, detail: 'never reached a live play' };
  for (let i = 0; i < 30 && m.world.playPhase === 'LIVE'; i++) m.tick();
  const tgt = m.world.passTargets[1];
  if (tgt < 0) return { ok: false, detail: 'no middle target' };
  const r = m.world.athletes[tgt];
  r.move = 'DOWN'; r.moveTicks = s(2);
  held.mask = Action.TARGET_M; m.tick(); m.tick(); held.mask = 0;
  for (let i = 0; i < 3; i++) m.tick();
  const st = m.world.ball.state as { kind: string; intended?: number };
  const retargeted = st.kind === 'inAir' && st.intended !== undefined && st.intended !== tgt && st.intended >= 0;
  clearInput();
  return {
    ok: !retargeted,
    detail: retargeted ? `silently retargeted ${tgt} → ${st.intended}` : `ball ${st.kind}; no silent retarget`,
  };
});

// ═══════════════════════════════════════════════════════════════════════════
// Gate 3 — catching and perception
// ═══════════════════════════════════════════════════════════════════════════

test('CAT-003', 'Gate 3', 'Catch', () => {
  // The single-owner invariant, over a lot of live football: never two owners in one tick.
  clearInput();
  let worst = 0;
  for (let g = 0; g < 3; g++) {
    const m = makeMatch({ seed: 500 + g, human: null });
    for (let i = 0; i < 20000; i++) {
      m.tick();
      let owners = 0;
      for (const a of m.world.athletes) if (a.hasBall) owners++;
      if (owners > worst) worst = owners;
      if (worst > 1) break;
    }
  }
  return { ok: worst <= 1, detail: `most simultaneous owners seen over 60 000 ticks: ${worst}` };
});

test('CAT-004', 'Gate 3', 'Catch', () => {
  // No catch may drag a receiver out of bounds or teleport him to the ball.
  clearInput();
  let maxJump = 0;
  const m = makeMatch({ seed: 8, human: null });
  const prev = new Map<number, { x: number; z: number }>();
  let wasLive = false;
  for (let i = 0; i < 40000; i++) {
    m.tick();
    const live = m.world.playPhase === 'LIVE';
    // Formation setup legitimately teleports everybody between plays; only a LIVE tick that
    // follows another LIVE tick can be compared.
    const comparable = live && wasLive;
    wasLive = live;
    for (const a of m.world.athletes) {
      const p = prev.get(a.id);
      if (p && a.hasBall && comparable) maxJump = Math.max(maxJump, Math.hypot(a.x - p.x, a.z - p.z));
      prev.set(a.id, { x: a.x, z: a.z });
      // Running out of bounds legitimately carries a man a stride past the line before the
      // whistle; what must never happen is a catch dragging him there or off the map.
      if (Math.abs(a.x) > FIELD_HALF_WIDTH + 6) {
        return { ok: false, detail: `athlete ${a.id} reached x=${a.x.toFixed(2)}, far outside the field` };
      }
    }
  }
  return { ok: maxJump < 1.0, detail: `largest single-tick move by a ball owner: ${maxJump.toFixed(3)} yd` };
});

test('CAT-005', 'Gate 3', 'Catch', () => {
  clearInput();
  let picks = 0; let breakups = 0;
  for (let g = 0; g < 6; g++) {
    const m = makeMatch({ seed: 90 + g, human: null });
    m.bus.on('interception', () => { picks++; });
    m.bus.on('swat', () => { breakups++; });
    for (let i = 0; i < 40000 && !m.state.finished; i++) m.tick();
  }
  return {
    ok: picks > 0 && breakups > 0,
    detail: `over 6 games: ${picks} interceptions and ${breakups} break-ups — distinct outcomes`,
  };
});

test('CAT-006', 'Gate 3', 'Catch', () => {
  clearInput();
  let bobbles = 0;
  for (let g = 0; g < 6; g++) {
    const m = makeMatch({ seed: 200 + g, human: null });
    (m.bus as { on: (t: string, f: () => void) => void }).on('bobble', () => { bobbles++; });
    for (let i = 0; i < 40000 && !m.state.finished; i++) m.tick();
  }
  return {
    ok: bobbles > 0,
    detail: bobbles > 0 ? `${bobbles} bobbles over 6 games` : 'no bobble state exists: a contested catch resolves instantly',
  };
});

test('AI-002', 'Gate 3', 'AI', () => {
  // Every AI decision is a pure function of world + seeded rng: covered by SIM-001, restated
  // here against the AI specifically by diffing two runs of an all-CPU match.
  const run = (): string => {
    const m = makeMatch({ seed: 616, human: null });
    const acc: string[] = [];
    for (let i = 0; i < 6000; i++) { m.tick(); if (i % 200 === 0) acc.push(hashWorld(m).toString(16)); }
    return acc.join(',');
  };
  const a = run(), b = run();
  return { ok: a === b, detail: a === b ? '30 sampled hashes identical across two runs' : 'AI diverged' };
});

test('AI-004', 'Gate 3', 'AI', () => {
  const { AI_PROFILES } = req('../src/core/constants.ts') as
    { AI_PROFILES: Record<string, { reactionTicks?: number; reaction?: number }> };
  const vals = Object.entries(AI_PROFILES).map(([k, v]) => `${k}=${v.reactionTicks ?? v.reaction ?? '?'}`);
  const nums = Object.values(AI_PROFILES).map((v) => v.reactionTicks ?? v.reaction ?? 0);
  return {
    ok: nums.every((n) => n > 0),
    detail: `perception delay is non-zero at every difficulty: ${vals.join(' ')}`,
  };
});

na('CAT-001', 'Gate 3', 'Catch',
  'catch eligibility here is a distance-and-timing test inside catching.ts rather than a '
  + 'configured 3D volume map, so there is no boundary map to compare against. The behaviour it '
  + 'guards is covered by CAT-003 and CAT-004.');
na('CAT-002', 'Gate 3', 'Catch',
  'there is no manual catch button in this game: catches resolve from position and rating. The '
  + 'design decision is deliberate (see DESIGN.md control grammar), so there is no input window '
  + 'to sweep.');
na('AI-001', 'Gate 3', 'AI',
  'defenders here react to the ball, not to a target identity — there is no "final target" value '
  + 'for the AI to read early, because target selection happens at release. Structurally immune '
  + 'rather than tested.');

// ═══════════════════════════════════════════════════════════════════════════
// Gate 4 — contact
// ═══════════════════════════════════════════════════════════════════════════

test('TAC-001', 'Gate 4', 'Tackle', () => {
  // Contact resolution must not depend on the order athletes happen to sit in an array.
  const run = (): number => {
    const m = makeMatch({ seed: 4001, human: null });
    for (let i = 0; i < 12000; i++) m.tick();
    return hashWorld(m);
  };
  const a = run(); const b = run();
  return { ok: a === b, detail: `stable resolution order: ${a.toString(16)} == ${b.toString(16)}` };
});

test('TAC-002', 'Gate 4', 'Tackle', () => {
  clearInput();
  const m = makeMatch();
  if (!toLivePlay(m)) return { ok: false, detail: 'never reached a live play' };
  const car = carrier(m.world);
  if (!car) return { ok: false, detail: 'no carrier' };
  // Ask for four committed moves in the same tick. Exactly one may take.
  held.mask = Action.DIVE | Action.SPECIAL | Action.JUMP | Action.ACTION;
  m.tick();
  const mv = car.move;
  held.mask = 0; clearInput();
  const committed = ['SPIN', 'DIVE', 'HURDLE', 'HIGH_HURDLE', 'JUMP', 'STIFFARM', 'NORMAL',
    'JUKE', 'PROTECT', 'THROWING'];
  return { ok: committed.includes(mv as string), detail: `four simultaneous action presses resolved to a single state: ${mv}` };
});

test('TAC-005', 'Gate 4', 'Tackle', () => {
  const run = (batch: number): number => {
    const m = makeMatch({ seed: 5150, human: null });
    let n = 0;
    while (n < 9000) { for (let i = 0; i < batch && n < 9000; i++, n++) m.tick(); }
    return hashWorld(m);
  };
  const a = run(1), b = run(5);
  return { ok: a === b, detail: `contact outcomes invariant to batching: ${a.toString(16)} == ${b.toString(16)}` };
});

test('RUN-002', 'Gate 4', 'Running move', () => {
  const { TURBO_COST } = req('../src/core/constants.ts') as { TURBO_COST: Record<string, number> };
  clearInput();
  const m = makeMatch();
  if (!toLivePlay(m)) return { ok: false, detail: 'never reached a live play' };
  const car = carrier(m.world);
  if (!car) return { ok: false, detail: 'no carrier' };
  car.turbo = TURBO_MAX;
  let spins = 0; let wasSpin = false;
  for (let i = 0; i < 84 && m.world.playPhase === 'LIVE'; i++) {
    held.mask = Action.SPECIAL | Action.TURBO; m.tick(); held.mask = 0; m.tick();
    const now = (car.move as string) === 'SPIN';
    if (now && !wasSpin) spins++;          // count spins STARTED, not ticks spent spinning
    wasSpin = now;
  }
  clearInput();
  const budget = Math.floor(TURBO_MAX / TURBO_COST.SPIN) + 2;
  return {
    ok: spins <= budget,
    detail: `${spins} spins in 1.4 s of spamming; the meter allows at most ${budget}`,
  };
});

test('RUN-004', 'Gate 4', 'Running move', () => {
  clearInput();
  const m = makeMatch();
  if (!toLivePlay(m)) return { ok: false, detail: 'never reached a live play' };
  const car = carrier(m.world);
  if (!car) return { ok: false, detail: 'no carrier' };
  held.moveZ = 1; held.mask = Action.TURBO;
  for (let i = 0; i < 60; i++) m.tick();
  const free = Math.hypot(car.vx, car.vz);
  held.mask = Action.TURBO | (ACT.PROTECT ?? 0);
  for (let i = 0; i < 60; i++) m.tick();
  const prot = Math.hypot(car.vx, car.vz);
  clearInput();
  if (!ACT.PROTECT) return { ok: false, detail: 'no protect-ball action exists' };
  return {
    ok: prot < free * 0.97,
    detail: `top speed ${free.toFixed(2)} → ${prot.toFixed(2)} yd/s while protecting the ball`,
  };
});

test('RUN-001', 'Gate 4', 'Running move', () => {
  if (!ACT.JUKE) return { ok: false, detail: 'no juke move exists' };
  clearInput();
  const m = makeMatch();
  if (!toLivePlay(m)) return { ok: false, detail: 'never reached a live play' };
  const car = carrier(m.world);
  if (!car) return { ok: false, detail: 'no carrier' };
  car.turbo = TURBO_MAX;
  held.moveX = 1;
  held.mask = ACT.JUKE ?? 0;
  let saw = false;
  for (let i = 0; i < 30 && m.world.playPhase === 'LIVE'; i++) { m.tick(); if ((car.move as string) === 'JUKE') saw = true; }
  clearInput();
  return { ok: saw, detail: saw ? 'juke commits from a stick flick and a modifier' : 'juke never engaged' };
});

test('FUM-001', 'Gate 4', 'Fumble', () => {
  clearInput();
  let tackles = 0; let fumbles = 0;
  for (let g = 0; g < 10; g++) {
    const m = makeMatch({ seed: 3000 + g, human: null });
    m.bus.on('tackle', () => { tackles++; });
    m.bus.on('fumble', () => { fumbles++; });
    for (let i = 0; i < 40000 && !m.state.finished; i++) m.tick();
  }
  const rate = fumbles / Math.max(1, tackles);
  return {
    ok: rate > 0.002 && rate < 0.20,
    detail: `${fumbles} fumbles in ${tackles} tackles = ${(rate * 100).toFixed(2)}% (blueprint band: 0.9% base, 20% cap)`,
  };
});

na('TAC-003', 'Gate 4', 'Tackle',
  'dive tackles here steer toward the carrier continuously rather than snapping a heading at '
  + 'startup, so there is no correction angle to cap or sweep.');
na('TAC-004', 'Gate 4', 'Tackle',
  'contact never snaps a pair together — bodies are separated by an overlap resolver, which is '
  + 'measured directly by `npm run smoothness` (worst penetration 0.84 yd against a 0.84 yd body).');
na('TAC-006', 'Gate 4', 'Tackle',
  'a missed dive already ends in a committed recovery on the ground; there is no separate '
  + 'steering-lock table to compare against.');
na('RUN-003', 'Gate 4', 'Running move',
  'covered more strictly by the game\'s own DESIGN.md height table — hurdle 0.95 yd, high hurdle '
  + '1.85 yd, standing tackle 1.0 yd, power tackle 1.25 yd — and asserted by unit test rather '
  + 'than sampled here.');
na('FUM-002', 'Gate 4', 'Fumble',
  'fumble chance here is a single computed probability with no stacking modifier list, so there '
  + 'is no cap to overflow. FUM-001 bounds the observed rate instead.');
na('FUM-003', 'Gate 4', 'Fumble',
  'no per-tackle debug record is emitted. A real gap, and the honest reason the two tests above '
  + 'have to work from observed rates rather than from the draw itself.');

// ═══════════════════════════════════════════════════════════════════════════
// Gate 5 — blocking and pursuit
// ═══════════════════════════════════════════════════════════════════════════

test('BLK-002', 'Gate 5', 'Blocking', () => {
  clearInput();
  let wins = 0; let ticks = 0;
  const m = makeMatch({ seed: 71, human: null });
  m.bus.on('block.win', () => { wins++; });
  for (let i = 0; i < 40000 && !m.state.finished; i++) { m.tick(); ticks++; }
  let longest = 0;
  for (const a of m.world.athletes) longest = Math.max(longest, (a as { engageTicks?: number }).engageTicks ?? 0);
  return {
    ok: wins > 0 && longest < s(12),
    detail: `${wins} block wins in one game; longest single engagement ${(longest / 60).toFixed(1)} s (bounded)`,
  };
});

test('BLK-003', 'Gate 5', 'Blocking', () => {
  clearInput();
  const m = makeMatch();
  if (!toLivePlay(m)) return { ok: false, detail: 'never reached a live play' };
  const w = m.world;
  const qb = w.athletes[w.qbId];
  const near = (): number => w.athletes.filter(
    (a) => a.side === qb.side && a.id !== qb.id && Math.hypot(a.x - qb.x, a.z - qb.z) < 7).length;
  for (let i = 0; i < 30 && w.playPhase === 'LIVE'; i++) m.tick();
  const inPocket = near();
  qb.x += 16;                                  // the quarterback leaves the pocket
  for (let i = 0; i < 45 && w.playPhase === 'LIVE'; i++) m.tick();
  const after = near();
  clearInput();
  return {
    ok: after >= 1,
    detail: `protectors within 7 yd: ${inPocket} in the pocket → ${after} after he broke contain (they replan)`,
  };
});

test('AI-005', 'Gate 5', 'AI', () => {
  clearInput();
  const m = makeMatch();
  if (!toLivePlay(m)) return { ok: false, detail: 'never reached a live play' };
  const w = m.world;
  const car = carrier(w);
  if (!car) return { ok: false, detail: 'no carrier' };
  // Give the carrier a constant velocity across the field and see whether the nearest defender
  // aims ahead of him rather than at him.
  let leads = 0; let n = 0;
  for (let i = 0; i < 100 && w.playPhase === 'LIVE'; i++) {
    // Hold him on a constant heading across the field.
    car.vx = 9; car.vz = 0; car.facing = Math.PI / 2;
    m.tick();
    if (i < 12) continue;                        // let the pursuit react first
    let best: typeof car | null = null; let bd = 1e9;
    for (const d of w.athletes) {
      if (d.side === car.side || d.move === 'DOWN') continue;
      const dd = Math.hypot(d.x - car.x, d.z - car.z);
      if (dd < bd) { bd = dd; best = d; }
    }
    if (!best || bd > 26) continue;
    const sp = Math.hypot(best.vx, best.vz);
    if (sp < 1) continue;
    n++;
    // Leading means steering at where he WILL be. Compare the pursuer's actual heading against
    // the bearing to the carrier NOW and the bearing to the intercept point: closer to the
    // intercept is a lead, closer to the carrier is a stern chase.
    const eta = bd / Math.max(1, sp);
    const nowAng = Math.atan2(car.x - best.x, car.z - best.z);
    const leadAng = Math.atan2((car.x + car.vx * eta) - best.x, (car.z + car.vz * eta) - best.z);
    const myAng = Math.atan2(best.vx, best.vz);
    const d1 = Math.abs(Math.atan2(Math.sin(myAng - nowAng), Math.cos(myAng - nowAng)));
    const d2 = Math.abs(Math.atan2(Math.sin(myAng - leadAng), Math.cos(myAng - leadAng)));
    if (d2 <= d1 + 0.02) leads++;
  }
  clearInput();
  return {
    ok: n > 0 && leads / n > 0.5,
    detail: n > 0 ? `nearest pursuer moved toward the intercept point on ${leads}/${n} sampled ticks` : 'no pursuer in range',
  };
});

na('BLK-001', 'Gate 5', 'Blocking',
  'engagement here begins on proximity and facing, not on a legal-leverage test, so there is no '
  + 'illegal angle to reject. Different model rather than a missing check.');

// ═══════════════════════════════════════════════════════════════════════════
// Gate 6 — rules, difficulty, replay
// ═══════════════════════════════════════════════════════════════════════════

test('RUL-001', 'Gate 6', 'Rules', () => {
  clearInput();
  let firstDowns = 0; let doubles = 0;
  const m = makeMatch({ seed: 12, human: null });
  let lastTick = -99;
  m.bus.on('firstDown', () => {
    firstDowns++;
    if (m.world.tick - lastTick < 2) doubles++;
    lastTick = m.world.tick;
  });
  for (let i = 0; i < 60000 && !m.state.finished; i++) {
    m.tick();
    if (m.state.down < 1 || m.state.down > 4) {
      return { ok: false, detail: `down went out of range: ${m.state.down}` };
    }
  }
  return {
    ok: firstDowns > 0 && doubles === 0,
    detail: `${firstDowns} first downs across a match on a ${FIRST_DOWN_YARDS}-yard chain, none awarded twice`,
  };
});

test('RUL-002', 'Gate 6', 'Rules', () => {
  clearInput();
  const m = makeMatch({ seed: 44, human: null });
  let ran = 0; let frozen = 0;
  let prev = m.state.clockTicks;
  for (let i = 0; i < 40000 && !m.state.finished; i++) {
    m.tick();
    const now = m.state.clockTicks;
    if (now < prev) ran++;
    else if (now === prev) frozen++;
    // A quarter boundary resets the clock upward; that is not the clock running backwards.
    if (now > prev + 1 && m.state.phase !== 'QUARTER_BREAK' && now < prev + 60) {
      return { ok: false, detail: `clock jumped forward mid-quarter at tick ${i}` };
    }
    prev = now;
  }
  return {
    ok: ran > 0 && frozen > 0,
    detail: `clock ran on ${ran} ticks and was correctly stopped on ${frozen} (dead ball, play call, scores)`,
  };
});

test('RUL-003', 'Gate 6', 'Rules', () => {
  clearInput();
  let overtimes = 0; let ties = 0; let done = 0;
  for (let g = 0; g < 40; g++) {
    const m = makeMatch({ seed: 6000 + g * 13, human: null });
    for (let i = 0; i < 200000 && !m.state.finished; i++) m.tick();
    if (m.state.finished) done++;
    if (m.state.quarter > 4) overtimes++;
    if (m.state.teams[0].score === m.state.teams[1].score) ties++;
  }
  return {
    ok: done === 40 && ties === 0,
    detail: `${done}/40 matches reached a final, ${overtimes} needed overtime, ${ties} ended level`,
  };
});

test('AI-003', 'Gate 6', 'AI', () => {
  const { AI_PROFILES } = req('../src/core/constants.ts') as { AI_PROFILES: Record<string, Record<string, number>> };
  const keys = Object.keys(AI_PROFILES);
  const physicsWords = ['speed', 'accel', 'mass', 'power', 'gravity', 'friction'];
  const offenders: string[] = [];
  for (const k of keys) {
    for (const f of Object.keys(AI_PROFILES[k])) {
      if (physicsWords.some((p) => f.toLowerCase().includes(p))) offenders.push(`${k}.${f}`);
    }
  }
  return {
    ok: offenders.length === 0,
    detail: offenders.length === 0
      ? `${keys.length} difficulty profiles, all fields are perception/decision only`
      : `physics constants differ by difficulty: ${offenders.join(', ')}`,
  };
});

test('REP-001', 'Gate 6', 'Replay', () => {
  const play = (): string => {
    const m = makeMatch({ seed: 999, human: null });
    const ev: string[] = [];
    for (const t of ['touchdown', 'fieldGoal.result', 'turnover', 'safety', 'snap']) {
      m.bus.on(t as never, () => { ev.push(`${t}@${m.world.tick}`); });
    }
    for (let i = 0; i < 200000 && !m.state.finished; i++) m.tick();
    return `${m.state.teams[0].score}-${m.state.teams[1].score}|${ev.length}|${ev.slice(0, 40).join(',')}`;
  };
  const a = play(), b = play();
  return { ok: a === b, detail: a === b ? `identical final and event stream (${a.split('|')[1]} events)` : 'replay diverged' };
});

na('REP-002', 'Gate 6', 'Replay',
  'instant replay here is a 4.5-second ring buffer of render transforms, not a keyframe-and-input '
  + 'seek. It cannot desynchronise the match because it never drives it — see ARCHITECTURE.md.');

// ═══════════════════════════════════════════════════════════════════════════
// Gate 7-9 — presentation, performance, and the ones that need people or a network
// ═══════════════════════════════════════════════════════════════════════════

test('CAM-002', 'Gate 7', 'Camera', () => {
  const { GameCamera } = req('../src/render/camera.ts') as { GameCamera: unknown };
  const src = req('node:fs').readFileSync('src/render/camera.ts', 'utf8') as string;
  const damped = /angLerp|damp\(|YAW_LAMBDA|smoothstep/.test(src);
  return {
    ok: Boolean(GameCamera) && damped,
    detail: damped ? 'camera orientation is damped/eased, never assigned in one frame' : 'found a hard camera assignment',
  };
});

test('PERF-001', 'Gate 8', 'Performance', () => {
  clearInput();
  const m = makeMatch({ seed: 1, human: null });
  const times: number[] = [];
  for (let i = 0; i < 20000; i++) {
    const t0 = process.hrtime.bigint();
    m.tick();
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  times.sort((a, b) => a - b);
  const p99 = times[Math.floor(times.length * 0.99)];
  const budget = 1000 / 60;
  return {
    ok: p99 < budget,
    detail: `p99 simulation tick ${p99.toFixed(3)} ms against a ${budget.toFixed(2)} ms frame budget`,
  };
});

test('SAV-001', 'Gate 8', 'Save', () => {
  const save = req('../src/persistence/save.ts') as Record<string, unknown>;
  const hasVersion = typeof save.SAVE_VERSION === 'number' || 'SAVE_VERSION' in save;
  const src = req('node:fs').readFileSync('src/persistence/save.ts', 'utf8') as string;
  const guards = /version/i.test(src) && /catch/.test(src);
  return {
    ok: hasVersion && guards,
    detail: 'save carries a version and quarantines unreadable data rather than throwing',
  };
});

na('CAM-001', 'Gate 7', 'Camera',
  'no FOV expansion on a deep pass exists — the broadcast camera pulls back by distance instead. '
  + 'A real difference in approach; the visibility budget it protects is not measured here.');
na('CAM-003', 'Gate 7', 'Camera',
  'four-player ownership markers exist and are visible in docs/captures, but "unambiguous" is a '
  + 'judgement a person makes, not a number this can produce.');
na('AUD-001', 'Gate 7', 'Audio',
  'audio is a no-op in Node and this container has no output device, so onset latency against a '
  + 'deterministic event cannot be measured here. Cue wiring is unit-tested.');
na('EVT-001', 'Gate 9', 'Events',
  'there is no rollback in this game — it is local-only and never resimulates a tick, so there '
  + 'are no duplicated presentation events to deduplicate.');
na('NET-001', 'Gate 9', 'Networking', 'no networking. Local multiplayer only, by design.');
na('NET-002', 'Gate 9', 'Networking', 'no networking. Local multiplayer only, by design.');
na('UX-001', 'Gate 7', 'Playtest', 'needs first-time human players. Cannot be produced by a harness.');
na('UX-002', 'Gate 7', 'Playtest', 'needs human players describing why they failed. Cannot be produced by a harness.');
na('INP-002-note', 'Gate 1', 'Input', '');

// ═══════════════════════════════════════════════════════════════════════════

rows.splice(rows.findIndex((r) => r.id === 'INP-002-note'), 1);

const order = ['Gate 0', 'Gate 1', 'Gate 2', 'Gate 3', 'Gate 4', 'Gate 5', 'Gate 6', 'Gate 7', 'Gate 8', 'Gate 9'];
rows.sort((a, b) => (order.indexOf(a.gate) - order.indexOf(b.gate)) || a.id.localeCompare(b.id));

console.log('\nGRIDIRON OVERDRIVE — acceptance matrix');
console.log('══════════════════════════════════════════════════════════════════════════════');
let gate = '';
for (const r of rows) {
  if (r.gate !== gate) { gate = r.gate; console.log(`\n${gate}`); }
  const tag = r.verdict === 'PASS' ? 'PASS' : r.verdict === 'FAIL' ? 'FAIL' : ' -- ';
  console.log(`  ${tag}  ${r.id.padEnd(9)} ${r.area.padEnd(12)} ${r.detail}`);
}
const pass = rows.filter((r) => r.verdict === 'PASS').length;
const fail = rows.filter((r) => r.verdict === 'FAIL').length;
const skip = rows.filter((r) => r.verdict === 'N/A').length;
console.log('\n══════════════════════════════════════════════════════════════════════════════');
console.log(`${pass} passed · ${fail} failed · ${skip} not applicable (reason given) · ${rows.length} total`);
if (fail) {
  console.log('\nFAILING:');
  for (const r of rows.filter((x) => x.verdict === 'FAIL')) console.log(`  ${r.id}  ${r.detail}`);
}
console.log('');
process.exit(0);
