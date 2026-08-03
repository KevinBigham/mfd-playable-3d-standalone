#!/usr/bin/env tsx
/**
 * One command, one receipt bundle.
 *
 * Runs the whole verification battery — typecheck, unit tests, scenarios, determinism, the
 * scripted human, simulation performance, and every balance probe — captures each tool's raw
 * output under `reports/mobile/receipts/`, and writes a machine-readable `baseline.json` naming
 * what ran, what passed, and under which configuration fingerprint. Exits nonzero if any gate
 * fails, so CI and the wave process can trust a green run.
 *
 *   npm run mobile:baseline [-- --skip-slow]
 */
import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fingerprint } from './lib/fingerprint.ts';

const skipSlow = process.argv.includes('--skip-slow');

interface StepResult {
  name: string;
  command: string;
  ok: boolean;
  exitCode: number;
  seconds: number;
  receipt: string;
}

const OUT = 'reports/mobile/receipts';
mkdirSync(OUT, { recursive: true });

const steps: Array<{ name: string; command: string; slow?: boolean }> = [
  { name: 'typecheck', command: 'npx tsc --noEmit' },
  { name: 'unit-tests', command: 'npx vitest run' },
  { name: 'scenarios', command: 'npx tsx tools/scenarios.ts' },
  { name: 'determinism', command: 'npx tsx tools/determinism.ts' },
  { name: 'humanprobe', command: 'npx tsx tools/humanprobe.ts' },
  { name: 'simperf', command: 'npx tsx tools/simperf.ts', slow: true },
  { name: 'driveprobe', command: 'npx tsx tools/driveprobe.ts', slow: true },
  { name: 'passprobe', command: 'npx tsx tools/passprobe.ts', slow: true },
  { name: 'deepprobe', command: 'npx tsx tools/deepprobe.ts', slow: true },
  { name: 'runprobe', command: 'npx tsx tools/runprobe.ts', slow: true },
  { name: 'fieldpos', command: 'npx tsx tools/fieldpos.ts', slow: true },
  { name: 'policyprobe', command: 'npx tsx tools/policyprobe.ts', slow: true },
];

const results: StepResult[] = [];
for (const step of steps) {
  if (skipSlow && step.slow) continue;
  const receipt = `${OUT}/${step.name}.txt`;
  const started = Date.now();
  let ok = true; let exitCode = 0; let output = '';
  try {
    output = execSync(step.command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    ok = false;
    const e = err as { status?: number; stdout?: string; stderr?: string };
    exitCode = e.status ?? 1;
    output = `${e.stdout ?? ''}\n${e.stderr ?? ''}`;
  }
  const seconds = (Date.now() - started) / 1000;
  writeFileSync(receipt, output);
  results.push({ name: step.name, command: step.command, ok, exitCode, seconds, receipt });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${step.name.padEnd(14)} ${seconds.toFixed(1)}s  → ${receipt}`);
}

const fp = fingerprint({
  tool: 'mobile:baseline', seeds: 'per-tool (see each receipt)',
  teams: 'per-tool', difficulty: 'per-tool',
});
const allOk = results.every((r) => r.ok);
writeFileSync(`${OUT}/baseline.json`, JSON.stringify({ fingerprint: fp, allOk, results }, null, 2));
console.log(`\n  ${allOk ? 'ALL GREEN' : 'FAILURES PRESENT'} — bundle at ${OUT}/baseline.json\n`);
process.exit(allOk ? 0 : 1);
