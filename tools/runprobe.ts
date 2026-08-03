#!/usr/bin/env tsx
/**
 * Run-game autopsy.
 *
 * The drive census says a designed run gains 4.09 yards and loses yardage a quarter of the time,
 * against a thirty-yard chain. That is not a running game, it is a way to burn a down. This asks
 * why: where the carrier is when he is first touched, who touches him, how long he survives, and
 * how many blockers were actually engaged when he crossed the line.
 *
 *   npm run runprobe [-- --games 10]
 */
import { Match, defaultMatchConfig } from '../src/rules/match.ts';
import { getTeam, TEAM_IDS } from '../src/data/index.ts';
import { OFFENSE_PLAYS } from '../src/plays/offense.ts';
import { carrier } from '../src/sim/world.ts';
import { dirOf } from '../src/rules/rulesEngine.ts';
import { dist } from '../src/core/math.ts';
import { DEF_START } from '../src/sim/world.ts';

const argv = process.argv.slice(2);
const games = Number(argv[argv.indexOf('--games') + 1]) || 10;

const runIds = new Set(OFFENSE_PLAYS.filter((p) => p.tags.includes('RUN')).map((p) => p.id));

interface Sample {
  yards: number;
  firstContactAt: number;   // yards past the LOS when a defender first got within 1.5 yd
  freeDefendersAtSnap: number; // unblocked defenders near the line, 0.4 s after the handoff
  ticksAlive: number;
}
const samples: Sample[] = [];
const hist = new Map<number, number>();

for (let g = 0; g < games; g++) {
  const cfg = defaultMatchConfig({
    seed: 7700 + g, quarterSeconds: 120, difficulty: 'PRO',
    home: TEAM_IDS[g % TEAM_IDS.length], away: TEAM_IDS[(g + 2) % TEAM_IDS.length],
    seats: [{ side: 0, active: false }, { side: 1, active: false }],
  });
  const m = new Match({ config: cfg, home: getTeam(cfg.home!), away: getTeam(cfg.away!), seatIntent: () => null });
  const bus = m.bus as unknown as { on: (t: string, f: (e: never) => void) => void };

  let isRun = false, live = false;
  let firstContactAt = NaN, freeAtHandoff = -1, startTick = 0;

  bus.on('play.start', ((e: { play: string }) => {
    isRun = runIds.has(e.play);
    live = false; firstContactAt = NaN; freeAtHandoff = -1;
  }) as never);

  bus.on('handoff', (() => {
    if (!isRun) return;
    live = true; startTick = m.world.tick;
    freeAtHandoff = -1;         // sampled 0.4 s later — see the tick loop
  }) as never);

  bus.on('play.end', ((e: { yards: number }) => {
    if (!isRun || !live) { live = false; return; }
    samples.push({
      yards: e.yards,
      firstContactAt: Number.isNaN(firstContactAt) ? 99 : firstContactAt,
      freeDefendersAtSnap: freeAtHandoff,
      ticksAlive: m.world.tick - startTick,
    });
    const bucket = Math.max(-5, Math.min(25, Math.round(e.yards / 5) * 5));
    hist.set(bucket, (hist.get(bucket) ?? 0) + 1);
    live = false;
  }) as never);

  for (let i = 0; i < 200000 && !m.state.finished; i++) {
    m.tick();
    if (!live) continue;
    const w = m.world;
    // Engagement is read from the sim's own bookkeeping rather than guessed from proximity, and
    // read a beat AFTER the handoff: a lead blocker is still three yards from his man at the
    // exchange, so sampling at the handoff counts every downfield blocker as absent.
    if (freeAtHandoff < 0 && w.tick - startTick >= 24) {
      let free = 0;
      for (let k = 0; k < 7; k++) {
        const d = w.athletes[DEF_START + k];
        if (Math.abs(d.z - w.losZ) > 12) continue;
        if (d.blockedBy < 0) free++;
      }
      freeAtHandoff = free;
    }
    if (!Number.isNaN(firstContactAt)) continue;
    const car = carrier(w);
    if (!car) continue;
    for (let k = 0; k < 7; k++) {
      const d = w.athletes[DEF_START + k];
      if (d.side === car.side) continue;
      if (dist(d.x, d.z, car.x, car.z) < 1.5) { firstContactAt = (car.z - w.losZ) * dirOf(car.side); break; }
    }
  }
}

const mean = (f: (s: Sample) => number): number => samples.reduce((a, s) => a + f(s), 0) / Math.max(1, samples.length);
const median = (f: (s: Sample) => number): number => {
  const v = samples.map(f).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : 0;
};

console.log(`\nRUN AUTOPSY — ${samples.length} designed runs over ${games} games`);
console.log('─'.repeat(66));
console.log(`  yards gained        mean ${mean((s) => s.yards).toFixed(2)}   median ${median((s) => s.yards).toFixed(0)}`);
console.log(`  first contact       mean ${mean((s) => Math.min(20, s.firstContactAt)).toFixed(2)} yd past the line   median ${median((s) => Math.min(20, s.firstContactAt)).toFixed(1)}`);
console.log(`  unblocked          mean ${mean((s) => Math.max(0, s.freeDefendersAtSnap)).toFixed(2)} of 7 defenders near the line, 0.4 s in`);
console.log(`  time with the ball  mean ${(mean((s) => s.ticksAlive) / 60).toFixed(2)} s`);
console.log('─'.repeat(66));
console.log('  gain distribution');
for (const k of [...hist.keys()].sort((a, b) => a - b)) {
  const c = hist.get(k)!;
  const label = k <= -5 ? '  ≤ -5' : k >= 25 ? '  25+ ' : `${String(k).padStart(4)}  `;
  console.log(`  ${label} ${'█'.repeat(Math.round((c / samples.length) * 90)).padEnd(46)} ${((c / samples.length) * 100).toFixed(0)}%`);
}
console.log('─'.repeat(66) + '\n');
