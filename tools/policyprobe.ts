#!/usr/bin/env tsx
/**
 * Matched-seed policy harness — does making informed decisions actually beat blind repetition?
 *
 * Every policy plays the SAME seeds, the SAME matchups, and the SAME play-call rotation (except
 * the deep-spam arm, whose whole identity is its play calling), through the same scripted-human
 * seat the humanprobe uses. The only thing a policy owns is the decision layer: which receiver,
 * when to release, and where to place the ball. That isolation is the point — the fun gate for
 * this project is "read + placement beats repeated-target spam by ≥20% expected points per drive
 * with a lower turnover rate", and this file is the instrument that measures it.
 *
 * No policy is given information a player cannot see: openness, depth, and defender geometry are
 * all on the screen. Nothing reads future RNG or the defense's play call.
 *
 *   npm run policyprobe [-- --games 10]
 */
import { Match, defaultMatchConfig } from '../src/rules/match.ts';
import { getTeam, TEAM_IDS } from '../src/data/index.ts';
import { Action } from '../src/input/actions.ts';
import { s as ticks } from '../src/core/constants.ts';
import { carrier } from '../src/sim/world.ts';
import { OFFENSE_PLAYS } from '../src/plays/offense.ts';
import type { GameEvent, OffensePlay, PlayerIntent } from '../src/core/types.ts';
import type { World } from '../src/sim/world.ts';
import { ThrowLedger, rate } from './lib/throwLedger.ts';
import { fingerprint, printFingerprint } from './lib/fingerprint.ts';
import { writeFileSync, mkdirSync } from 'node:fs';

const argv = process.argv.slice(2);
const games = Number(argv[argv.indexOf('--games') + 1]) || 10;
const seeds = Array.from({ length: games }, (_, i) => 7700 + i);

// ── policy definitions ─────────────────────────────────────────────────────

interface TargetView {
  slot: number;
  id: number;
  /** Yards past the line of scrimmage, positive downfield. */
  depth: number;
  /** Distance to the nearest live opponent, yards. */
  separation: number;
  /** True when the receiver is deeper than his nearest defender — leverage won. */
  behindCoverage: number;
  /** Unit vector from the nearest defender to the receiver — the safe side of the catch point. */
  awayX: number;
  awayZ: number;
}

/** Everything a policy is allowed to know: what is visible on screen at this moment. */
function viewTargets(w: World): TargetView[] {
  const dir = w.possession === 0 ? 1 : -1;
  const out: TargetView[] = [];
  for (let slot = 0; slot < 3; slot++) {
    const id = w.passTargets[slot];
    if (id < 0) continue;
    const a = w.athletes[id];
    if (!a || a.move === 'DOWN') continue;
    let near = 99; let nx = 0; let nz = 0; let defDepth = -99;
    for (const d of w.athletes) {
      if (d.side === a.side || d.move === 'DOWN') continue;
      const dd = Math.hypot(d.x - a.x, d.z - a.z);
      if (dd < near) { near = dd; nx = d.x; nz = d.z; defDepth = (d.z - w.losZ) * dir; }
    }
    const depth = (a.z - w.losZ) * dir;
    const dxa = a.x - nx; const dza = a.z - nz;
    const m = Math.hypot(dxa, dza) || 1;
    out.push({
      slot, id, depth, separation: near,
      behindCoverage: depth > defDepth ? 1 : 0,
      awayX: dxa / m, awayZ: dza / m,
    });
  }
  return out;
}

interface PolicyDecision {
  slot: number;
  aimX: number;
  aimZ: number;
}

interface Policy {
  id: string;
  /** Human-readable one-liner for the receipt. */
  what: string;
  /** Restrict the play-call rotation, or null for the shared rotation. */
  playFilter: ((p: OffensePlay) => boolean) | null;
  /** Pick target and placement. Called once when the policy decides to release. */
  decide(w: World, rng: () => number): PolicyDecision;
  /** Whether to wait for the play to develop before releasing. */
  patient: boolean;
}

const pickBest = (ts: TargetView[], score: (t: TargetView) => number): TargetView =>
  ts.reduce((a, b) => (score(b) > score(a) ? b : a));

const POLICIES: Policy[] = [
  {
    id: 'REPEATED_PRIMARY', what: 'always the middle button, no aim — the blind spam arm',
    playFilter: null, patient: false,
    decide: () => ({ slot: 1, aimX: 0, aimZ: 0 }),
  },
  {
    id: 'REPEATED_DEEPEST', what: 'always the deepest receiver, no aim',
    playFilter: null, patient: false,
    decide: (w) => {
      const ts = viewTargets(w);
      if (!ts.length) return { slot: 1, aimX: 0, aimZ: 0 };
      return { slot: pickBest(ts, (t) => t.depth).slot, aimX: 0, aimZ: 0 };
    },
  },
  {
    id: 'RANDOM_TARGET', what: 'uniform random receiver, no aim',
    playFilter: null, patient: false,
    decide: (w, rng) => {
      const ts = viewTargets(w);
      if (!ts.length) return { slot: 1, aimX: 0, aimZ: 0 };
      return { slot: ts[Math.floor(rng() * ts.length)].slot, aimX: 0, aimZ: 0 };
    },
  },
  {
    id: 'CONSERVATIVE_CHECKDOWN', what: 'always the shallowest receiver, no aim',
    playFilter: null, patient: false,
    decide: (w) => {
      const ts = viewTargets(w);
      if (!ts.length) return { slot: 1, aimX: 0, aimZ: 0 };
      return { slot: pickBest(ts, (t) => -t.depth).slot, aimX: 0, aimZ: 0 };
    },
  },
  {
    id: 'HIGHEST_SEPARATION', what: 'most open receiver by raw distance, no aim',
    playFilter: null, patient: false,
    decide: (w) => {
      const ts = viewTargets(w);
      if (!ts.length) return { slot: 1, aimX: 0, aimZ: 0 };
      return { slot: pickBest(ts, (t) => t.separation).slot, aimX: 0, aimZ: 0 };
    },
  },
  {
    id: 'LEVERAGE_READ', what: 'separation weighted by won leverage, no aim',
    playFilter: null, patient: false,
    decide: (w) => {
      const ts = viewTargets(w);
      if (!ts.length) return { slot: 1, aimX: 0, aimZ: 0 };
      return { slot: pickBest(ts, (t) => t.separation + 3 * t.behindCoverage).slot, aimX: 0, aimZ: 0 };
    },
  },
  {
    id: 'READ_TIMING', what: 'leverage read, released on the play clock the play names',
    playFilter: null, patient: true,
    decide: (w) => {
      const ts = viewTargets(w);
      if (!ts.length) return { slot: 1, aimX: 0, aimZ: 0 };
      return { slot: pickBest(ts, (t) => t.separation + 3 * t.behindCoverage).slot, aimX: 0, aimZ: 0 };
    },
  },
  {
    id: 'READ_PLACEMENT', what: 'leverage read on time, ball placed away from the covering defender',
    playFilter: null, patient: true,
    decide: (w) => {
      const ts = viewTargets(w);
      if (!ts.length) return { slot: 1, aimX: 0, aimZ: 0 };
      const best = pickBest(ts, (t) => t.separation + 3 * t.behindCoverage);
      return { slot: best.slot, aimX: best.awayX * 0.7, aimZ: best.awayZ * 0.7 };
    },
  },
  {
    id: 'DEEP_SPAM', what: 'only DEEP plays, always the deepest receiver',
    playFilter: (p) => p.tags.includes('DEEP'), patient: false,
    decide: (w) => {
      const ts = viewTargets(w);
      if (!ts.length) return { slot: 1, aimX: 0, aimZ: 0 };
      return { slot: pickBest(ts, (t) => t.depth).slot, aimX: 0, aimZ: 0 };
    },
  },
];

// ── the scripted seat ──────────────────────────────────────────────────────

/** Deterministic PRNG so RANDOM_TARGET reproduces run to run. */
function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface GameResult {
  points: number;
  yards: number;
  drives: number;
  turnoverDrives: number;
  downsDrives: number;
  explosives: number;
  sacks: number;
  throws: ReturnType<ThrowLedger['tally']>;
}

function playGame(policy: Policy, seed: number): GameResult {
  const held = { mask: 0, moveX: 0, moveZ: 0, aimX: 0, aimZ: 0 };
  const intent: PlayerIntent = { moveX: 0, moveZ: 0, aimX: 0, aimZ: 0, held: 0, pressed: 0, released: 0 };
  const cfg = defaultMatchConfig({
    seed, quarterSeconds: 120, difficulty: 'PRO',
    home: TEAM_IDS[0], away: TEAM_IDS[1],
    seats: [
      { side: 0, active: true }, { side: 1, active: false },
      { side: 0, active: false }, { side: 1, active: false },
    ],
  });
  const m = new Match({
    config: cfg, home: getTeam(cfg.home!), away: getTeam(cfg.away!),
    seatIntent: (seat) => {
      if (seat !== 0) return null;
      intent.moveX = held.moveX; intent.moveZ = held.moveZ;
      intent.aimX = held.aimX; intent.aimZ = held.aimZ;
      intent.held = held.mask;
      return intent;
    },
  });
  const rng = mulberry(seed * 31 + 7);

  const ledger = new ThrowLedger();
  m.bus.on('*', (e: GameEvent) => ledger.handle(e));
  let drives = 0; let turnoverDrives = 0; let downsDrives = 0;
  let explosives = 0; let sacks = 0; let inDrive = false;
  const bus = m.bus as unknown as { on: (t: string, f: (e: unknown) => void) => void };
  bus.on('play.start', () => {
    if (m.state.possession === 0 && !inDrive) { inDrive = true; drives++; }
  });
  bus.on('turnover', (e) => {
    if (!inDrive) return;
    inDrive = false;
    const kind = (e as { kind: string }).kind;
    if (kind === 'INT' || kind === 'FUMBLE') turnoverDrives++;
    else if (kind === 'DOWNS') downsDrives++;
  });
  for (const ev of ['touchdown', 'fieldGoal.result', 'safety', 'punt', 'quarter.end']) {
    bus.on(ev, () => { inDrive = false; });
  }
  bus.on('play.end', (e) => {
    if (m.state.possession === 0 && (e as { yards: number }).yards >= 20) explosives++;
  });
  bus.on('sack', () => { if (m.state.possession === 0) sacks++; });

  const rotation = policy.playFilter
    ? (OFFENSE_PLAYS as OffensePlay[]).filter(policy.playFilter)
    : (m.offensePlays as OffensePlay[]);
  let snaps = 0; let armed = false;
  const press = (mask: number): void => { held.mask |= mask; };
  const release = (mask: number): void => { held.mask &= ~mask; };
  const clearInput = (): void => { held.mask = 0; held.moveX = 0; held.moveZ = 0; held.aimX = 0; held.aimZ = 0; };
  m.bus.on('snap', () => { snaps++; });

  let t = 0;
  while (!m.state.finished && t < 60 * 60 * 25) {
    const w = m.world;
    if (m.state.phase === 'PLAY_CALL' && m.pendingOffense === null && m.state.possession === 0) {
      m.submitOffense(rotation[(snaps * 5) % rotation.length]);
    }
    if (m.state.phase === 'PRE_SNAP' && m.state.possession === 0) {
      if (!armed) { release(Action.ACTION); armed = true; } else press(Action.ACTION);
    } else if (w.playPhase === 'LIVE' && m.state.possession === 0) {
      release(Action.ACTION);
      armed = false;
      const qb = w.athletes[w.qbId];
      let pressure = 99;
      for (const d of w.athletes) {
        if (d.side === qb.side || d.move === 'DOWN') continue;
        pressure = Math.min(pressure, Math.hypot(d.x - qb.x, d.z - qb.z));
      }
      const holdingIt = !w.passThrown && carrier(w)?.id === w.qbId;
      const hurried = w.playTicks > ticks(0.7) && pressure < 3.2;
      const readAt = policy.patient
        ? (w.offensePlay?.timing?.primary ?? ticks(1.5))
        : ticks(0.9);
      for (const b of [Action.TARGET_L, Action.TARGET_M, Action.TARGET_R]) release(b);
      held.aimX = 0; held.aimZ = 0;
      if (holdingIt && (w.playTicks > readAt || hurried)) {
        const d = policy.decide(w, rng);
        const btn = d.slot === 0 ? Action.TARGET_L : d.slot === 2 ? Action.TARGET_R : Action.TARGET_M;
        held.aimX = d.aimX; held.aimZ = d.aimZ;
        press(btn);
      }
      const car = carrier(w);
      const mine = car && car.controlledBySeat === 0 && car.id !== w.qbId;
      held.moveZ = mine ? 1 : 0;
      if (mine) press(Action.TURBO); else release(Action.TURBO);
    } else {
      clearInput(); armed = false;
      const car = carrier(w);
      if (car && car.controlledBySeat === 0) { held.moveZ = 1; press(Action.TURBO); }
    }
    m.tick(); t++;
  }

  return {
    points: m.state.teams[0].score,
    yards: m.state.teams[0].stats.totalYds,
    drives, turnoverDrives, downsDrives, explosives, sacks,
    throws: ledger.tally(),
  };
}

// ── run the matrix ─────────────────────────────────────────────────────────

const fp = fingerprint({
  tool: 'policyprobe', seeds: `${seeds[0]}..${seeds[seeds.length - 1]}`,
  teams: `${TEAM_IDS[0]} vs ${TEAM_IDS[1]}`, difficulty: 'PRO', quarterSeconds: 120,
  policy: 'matrix',
});

interface PolicySummary {
  id: string;
  what: string;
  games: number;
  pointsPerGame: number;
  epPerDrive: number;
  drives: number;
  turnoverDrives: number;
  turnoverDriveRate: number;
  yardsPerGame: number;
  throws: number;
  caught: number;
  completionRate: number;
  defenderPossession: number;
  explosivesPerGame: number;
  sacksPerGame: number;
}

const summaries: PolicySummary[] = [];
for (const policy of POLICIES) {
  let points = 0; let yards = 0; let drives = 0; let tods = 0; let downs = 0;
  let explosives = 0; let sacks = 0;
  let throws = 0; let caught = 0; let defPoss = 0;
  for (const seed of seeds) {
    const r = playGame(policy, seed);
    points += r.points; yards += r.yards; drives += r.drives;
    tods += r.turnoverDrives; downs += r.downsDrives;
    explosives += r.explosives; sacks += r.sacks;
    throws += r.throws.throws; caught += r.throws.caught; defPoss += r.throws.defenderPossession;
  }
  summaries.push({
    id: policy.id, what: policy.what, games,
    pointsPerGame: points / games,
    epPerDrive: drives ? points / drives : 0,
    drives, turnoverDrives: tods,
    turnoverDriveRate: drives ? tods / drives : 0,
    yardsPerGame: yards / games,
    throws, caught,
    completionRate: throws ? caught / throws : 0,
    defenderPossession: defPoss,
    explosivesPerGame: explosives / games,
    sacksPerGame: sacks / games,
  });
}

console.log(`\nPOLICY MATRIX — ${games} matched-seed games per policy, human seat 0\n${'─'.repeat(96)}`);
printFingerprint(fp);
console.log('─'.repeat(96));
console.log('  policy                  pts/gm  EP/drive  TO-drives      comp            defPoss     20+/gm  sack/gm');
for (const p of summaries) {
  console.log(`  ${p.id.padEnd(22)} ${p.pointsPerGame.toFixed(1).padStart(6)}  ${p.epPerDrive.toFixed(2).padStart(8)}`
    + `  ${rate(p.turnoverDrives, p.drives, '').padEnd(15)}`
    + ` ${rate(p.caught, p.throws, '').padEnd(17)}`
    + ` ${rate(p.defenderPossession, p.throws, '').padEnd(14)}`
    + ` ${p.explosivesPerGame.toFixed(1).padStart(5)} ${p.sacksPerGame.toFixed(1).padStart(8)}`);
}
console.log('─'.repeat(96));

const spam = summaries.find((p) => p.id === 'REPEATED_PRIMARY')!;
const informed = summaries.find((p) => p.id === 'READ_PLACEMENT')!;
const edge = spam.epPerDrive > 0 ? (informed.epPerDrive / spam.epPerDrive - 1) * 100 : 0;
console.log('  CORE-FUN GATE — read+placement must beat repeated-target spam by ≥20% EP/drive');
console.log(`    read+placement EP/drive   ${informed.epPerDrive.toFixed(2)}  (turnover drives ${rate(informed.turnoverDrives, informed.drives, '')})`);
console.log(`    repeated-primary EP/drive ${spam.epPerDrive.toFixed(2)}  (turnover drives ${rate(spam.turnoverDrives, spam.drives, '')})`);
console.log(`    informed edge             ${edge >= 0 ? '+' : ''}${edge.toFixed(1)}%  ·  gate ${edge >= 20 && informed.turnoverDriveRate < spam.turnoverDriveRate ? 'PASS' : 'FAIL'}`);
console.log('─'.repeat(96) + '\n');

mkdirSync('reports/mobile/receipts', { recursive: true });
writeFileSync('reports/mobile/receipts/policyprobe.json', JSON.stringify({
  fingerprint: fp,
  policies: summaries,
  gate: {
    name: 'informed-beats-blind',
    informedPolicy: 'READ_PLACEMENT',
    blindPolicy: 'REPEATED_PRIMARY',
    edgePct: edge,
    informedTurnoverRate: informed.turnoverDriveRate,
    blindTurnoverRate: spam.turnoverDriveRate,
    pass: edge >= 20 && informed.turnoverDriveRate < spam.turnoverDriveRate,
  },
}, null, 2));
console.log('  wrote reports/mobile/receipts/policyprobe.json\n');
