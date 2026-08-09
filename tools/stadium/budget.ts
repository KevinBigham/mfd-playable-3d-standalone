#!/usr/bin/env tsx
import { STADIUMS } from '../../src/data/stadiums.ts';
import { assertStadiumVisualBudget, stadiumVisualBudgetReceipt } from '../../src/render/stadiumVisual/index.ts';
import { QUALITY_TIERS, flagString, parseArgs, visualForStadium } from './io.ts';

const { positional, flags } = parseArgs();
const stadiumId = flagString(flags, 'stadium') ?? positional[0] ?? null;
const ids = stadiumId ? [stadiumId] : STADIUMS.map((s) => s.id);
let failed = 0;

for (const id of ids) {
  let visual;
  try { visual = visualForStadium(id); }
  catch (error) {
    failed++;
    console.error(`FAIL  ${id}  ${error instanceof Error ? error.message : String(error)}`);
    continue;
  }
  console.log(`\n${id}`);
  console.log('tier      tris   vertices  draws  batches  elements  crowd  legacyΔ');
  for (const tier of QUALITY_TIERS) {
    const receipt = stadiumVisualBudgetReceipt(visual, tier);
    try { assertStadiumVisualBudget(receipt); }
    catch (error) { failed++; console.error(`  ${error instanceof Error ? error.message : String(error)}`); }
    const e = receipt.authored;
    const delta = receipt.legacyTier3.triangles === 0 ? 0 : e.triangles / receipt.legacyTier3.triangles;
    console.log(`${tier.padEnd(8)} ${String(e.triangles).padStart(6)}  ${String(e.vertices).padStart(8)}  `
      + `${String(e.drawCalls).padStart(5)}  ${String(e.materialBatches).padStart(7)}  `
      + `${String(e.semanticElements).padStart(8)}  ${String(e.crowdCapacity).padStart(5)}  ${delta.toFixed(3)}x`);
  }
}

process.exit(failed === 0 ? 0 : 1);
