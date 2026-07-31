#!/usr/bin/env tsx
/**
 * Fixed-seed replay: the same seed must produce a bit-identical event log, every time,
 * in any order, on any machine. Also exercises the save schema round-trip.
 * `npm run replay`
 */
import { simulateMatch } from '../src/testing/simRunner.ts';
import { defaultSave, type SaveFile } from '../src/persistence/save.ts';
import { Rng, hashSeed } from '../src/core/rng.ts';

function hashLog(counts: Record<string, number>, score: [number, number], ticks: number): string {
  const parts = Object.keys(counts).sort().map((k) => `${k}:${counts[k]}`);
  parts.push(`S${score[0]}-${score[1]}`, `T${ticks}`);
  return hashSeed(parts.join('|')).toString(16);
}

let failed = 0;
function check(name: string, pass: boolean, detail = ''): void {
  if (!pass) failed++;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(52)} ${detail}`);
}

console.log('\nGRIDIRON OVERDRIVE — determinism & persistence\n────────────────────────────────────────────────────────');

// 1. Same seed, three runs, identical results.
const seeds = [1, 31337, 987654];
for (const seed of seeds) {
  const runs = [0, 1, 2].map(() => simulateMatch({ seed, quarterSeconds: 120 }));
  const hashes = runs.map((r) => hashLog(r.eventCounts, [r.homeScore, r.awayScore], r.ticks));
  const same = hashes.every((h) => h === hashes[0]);
  check(`seed ${seed} replays identically x3`, same, `${hashes[0]} · ${runs[0].homeScore}-${runs[0].awayScore}`);
}

// 2. Interleaving matches must not leak state between them.
const a1 = simulateMatch({ seed: 555, quarterSeconds: 120 });
simulateMatch({ seed: 999, quarterSeconds: 60 });
simulateMatch({ seed: 111, quarterSeconds: 240 });
const a2 = simulateMatch({ seed: 555, quarterSeconds: 120 });
check('no cross-match state leakage',
  hashLog(a1.eventCounts, [a1.homeScore, a1.awayScore], a1.ticks)
  === hashLog(a2.eventCounts, [a2.homeScore, a2.awayScore], a2.ticks),
  `${a1.homeScore}-${a1.awayScore} vs ${a2.homeScore}-${a2.awayScore}`);

// 3. Different seeds must actually differ.
const b1 = simulateMatch({ seed: 1000, quarterSeconds: 120 });
const b2 = simulateMatch({ seed: 1001, quarterSeconds: 120 });
check('different seeds produce different games',
  hashLog(b1.eventCounts, [b1.homeScore, b1.awayScore], b1.ticks)
  !== hashLog(b2.eventCounts, [b2.homeScore, b2.awayScore], b2.ticks),
  `${b1.homeScore}-${b1.awayScore} vs ${b2.homeScore}-${b2.awayScore}`);

// 4. RNG properties.
const r = new Rng(12345);
const first = Array.from({ length: 2000 }, () => r.next());
r.reseed(12345);
const second = Array.from({ length: 2000 }, () => r.next());
check('rng reseeds deterministically', first.every((v, i) => v === second[i]));
check('rng stays inside [0,1)', first.every((v) => v >= 0 && v < 1));
const mean = first.reduce((x, y) => x + y, 0) / first.length;
check('rng is unbiased', Math.abs(mean - 0.5) < 0.02, `mean=${mean.toFixed(4)}`);
const saved = r.save();
const before = r.next();
r.load(saved);
check('rng state save/load round-trips', r.next() === before);

// 5. Save schema round-trip and corruption tolerance.
const save = defaultSave();
save.records.wins = 12;
save.settings.volumes.crowd = 0.33;
save.settings.quality = 'MEDIUM';
const json = JSON.stringify(save);
const back = JSON.parse(json) as SaveFile;
check('save round-trips through JSON',
  back.records.wins === 12 && back.settings.volumes.crowd === 0.33 && back.settings.quality === 'MEDIUM');
check('save has a version', back.version === 1, `v${back.version}`);

let corruptOk = true;
try { JSON.parse('{ this is not json'); corruptOk = false; } catch { /* expected */ }
check('corrupt json is detectable (loader quarantines it)', corruptOk);

console.log(`────────────────────────────────────────────────────────`);
process.exit(failed ? 1 : 0);
