import type { MatchConfig, MatchResult, TeamDef } from '../core/types.ts';
import { Match, defaultMatchConfig } from '../rules/match.ts';
import { getTeam, TEAM_IDS } from '../data/index.ts';
import { Rng } from '../core/rng.ts';
import type { Violation } from '../rules/rulesEngine.ts';

export interface SimOptions extends Partial<MatchConfig> {
  maxTicks?: number;
  checkInvariants?: boolean;
  record?: boolean;
}

export interface SimReport extends MatchResult {
  violations: Violation[];
  watchdogs: number;
  completed: boolean;
  wallMs: number;
}

/** Run one CPU-vs-CPU match with no rendering. Deterministic for a given seed. */
export function simulateMatch(opts: SimOptions = {}): SimReport {
  const cfg = defaultMatchConfig({
    ...opts,
    seats: [
      { side: 0, active: false }, { side: 1, active: false },
      { side: 0, active: false }, { side: 1, active: false },
    ],
  });
  if (!cfg.home) cfg.home = TEAM_IDS[0];
  if (!cfg.away) cfg.away = TEAM_IDS[1];
  const home: TeamDef = getTeam(cfg.home);
  const away: TeamDef = getTeam(cfg.away);
  // Play at the home team's ground unless told otherwise. The venue owns the playing surface,
  // and twelve of eighteen grounds are not grass — batching every game on an implicit grass
  // field left every non-grass traction value completely unexercised.
  if (!cfg.stadium) cfg.stadium = home.stadium;
  const m = new Match({ config: cfg, home, away });
  if (opts.record !== false) m.bus.record();

  const maxTicks = opts.maxTicks ?? 60 * 60 * 24; // 24 minutes of wall-equivalent ticks
  const violations: Violation[] = [];
  const t0 = Date.now();
  let ticks = 0;
  while (!m.state.finished && ticks < maxTicks) {
    m.tick();
    ticks++;
    if (opts.checkInvariants && ticks % 7 === 0) {
      const v = m.checkInvariants();
      for (const x of v) if (violations.length < 40) violations.push(x);
    }
  }
  const res = m.result();
  const report: SimReport = {
    ...res,
    violations,
    watchdogs: m.watchdogCount,
    completed: m.state.finished,
    wallMs: Date.now() - t0,
  };
  m.dispose();
  return report;
}

export interface BatchSummary {
  games: number;
  completed: number;
  avgHome: number;
  avgAway: number;
  avgTotal: number;
  minTotal: number;
  maxTotal: number;
  ties: number;
  overtimes: number;
  avgPlays: number;
  /**
   * First downs are two different numbers and the old single `avgFirstDowns` field was the
   * first of them while every document quoted it as the second. It summed both teams, sat one
   * line above `avgPassYds`/`avgRushYds` which divide by two, and PROJECT_STATE.md reported the
   * result as "4.3 per team" when the per-team figure was half that. Both units are named here
   * so that no reader has to go and find the denominator.
   */
  avgFirstDownsBothTeams: number;
  avgFirstDownsPerTeam: number;
  avgPassYds: number;
  avgRushYds: number;
  avgSacks: number;
  avgInts: number;
  avgFumbles: number;
  avgOverdrives: number;
  avgTouchdowns: number;
  avgFieldGoals: number;
  avgPunts: number;
  avgSafeties: number;
  totalWatchdogs: number;
  violations: Violation[];
  shutouts: number;
  blowouts: number;
  avgWallMs: number;
  eventTotals: Record<string, number>;
}

export function simulateBatch(count: number, seed0 = 1000, opts: SimOptions = {}): BatchSummary {
  const rng = new Rng(seed0);
  const totals: number[] = [];
  const sum = {
    home: 0, away: 0, plays: 0, fd: 0, pass: 0, rush: 0, sacks: 0, ints: 0,
    fum: 0, od: 0, td: 0, fg: 0, punt: 0, safety: 0, wall: 0,
  };
  const events: Record<string, number> = {};
  const violations: Violation[] = [];
  let completed = 0, ties = 0, ots = 0, watchdogs = 0, shutouts = 0, blowouts = 0;

  for (let i = 0; i < count; i++) {
    const a = rng.int(0, TEAM_IDS.length - 1);
    let b = rng.int(0, TEAM_IDS.length - 1);
    if (b === a) b = (b + 1) % TEAM_IDS.length;
    const r = simulateMatch({
      ...opts,
      seed: seed0 + i * 7919,
      home: TEAM_IDS[a], away: TEAM_IDS[b],
      checkInvariants: opts.checkInvariants ?? (i < 12),
    });
    if (r.completed) completed++;
    if (r.winner === 'TIE') ties++;
    if (r.overtime > 0) ots++;
    watchdogs += r.watchdogs;
    for (const v of r.violations) if (violations.length < 60) violations.push(v);
    const t = r.homeScore + r.awayScore;
    totals.push(t);
    if (r.homeScore === 0 || r.awayScore === 0) shutouts++;
    if (Math.abs(r.homeScore - r.awayScore) >= 28) blowouts++;
    sum.home += r.homeScore; sum.away += r.awayScore; sum.wall += r.wallMs;
    for (const s of r.stats) {
      sum.plays += s.plays; sum.fd += s.firstDowns; sum.pass += s.passYds; sum.rush += s.rushYds;
      sum.sacks += s.sacks; sum.ints += s.ints; sum.fum += s.forcedFumbles; sum.od += s.overdrives;
      sum.fg += s.fgMade; sum.punt += s.punts;
    }
    for (const [k, v] of Object.entries(r.eventCounts)) events[k] = (events[k] ?? 0) + v;
    sum.td += (r.eventCounts['touchdown'] ?? 0);
    sum.safety += (r.eventCounts['safety'] ?? 0);
  }
  const n = Math.max(1, count);
  return {
    games: count, completed,
    avgHome: sum.home / n, avgAway: sum.away / n,
    avgTotal: totals.reduce((a, b) => a + b, 0) / n,
    minTotal: Math.min(...totals), maxTotal: Math.max(...totals),
    ties, overtimes: ots,
    avgPlays: sum.plays / n,
    avgFirstDownsBothTeams: sum.fd / n, avgFirstDownsPerTeam: sum.fd / n / 2,
    avgPassYds: sum.pass / n / 2, avgRushYds: sum.rush / n / 2,
    avgSacks: sum.sacks / n, avgInts: sum.ints / n, avgFumbles: sum.fum / n,
    avgOverdrives: sum.od / n, avgTouchdowns: sum.td / n,
    avgFieldGoals: sum.fg / n, avgPunts: sum.punt / n, avgSafeties: sum.safety / n,
    totalWatchdogs: watchdogs, violations, shutouts, blowouts,
    avgWallMs: sum.wall / n,
    eventTotals: events,
  };
}
