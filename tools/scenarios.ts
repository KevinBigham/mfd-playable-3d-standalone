#!/usr/bin/env tsx
/** Deterministic scenario suite. `npm run scenarios` */
import { runAllScenarios } from '../src/testing/scenarios.ts';

const results = runAllScenarios();
let failed = 0;
console.log('\nGRIDIRON OVERDRIVE — scenario harness\n────────────────────────────────────────────────────────');
for (const r of results) {
  const mark = r.pass ? '  PASS' : '  FAIL';
  if (!r.pass) failed++;
  console.log(`${mark}  ${r.name.padEnd(46)} ${r.detail}`);
}
console.log(`────────────────────────────────────────────────────────\n${results.length - failed}/${results.length} scenarios passed\n`);
process.exit(failed ? 1 : 0);
