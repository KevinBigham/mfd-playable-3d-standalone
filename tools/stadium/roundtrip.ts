#!/usr/bin/env tsx
import { STADIUMS } from '../../src/data/stadiums.ts';
import {
  canonicalStadiumVisualJson, legacyVisualFromStadiumDef, parseStadiumVisual,
  stableStadiumVisualHash,
} from '../../src/render/stadiumVisual/index.ts';
import { ASSET_DIR, listJsonFiles, readVisualFile } from './io.ts';

const visuals = [
  ...STADIUMS.map((stadium) => ({ label: `legacy:${stadium.id}`, visual: legacyVisualFromStadiumDef(stadium) })),
  ...listJsonFiles(ASSET_DIR).map((file) => ({ label: `promoted:${file.split('/').pop()}`, visual: readVisualFile(file) })),
];

let failed = 0;
for (const { label, visual } of visuals) {
  try {
    const text = canonicalStadiumVisualJson(visual);
    const reparsed = parseStadiumVisual(JSON.parse(text) as unknown);
    const text2 = canonicalStadiumVisualJson(reparsed);
    const timestampVariant = {
      ...reparsed,
      authoring: { ...(reparsed.authoring ?? {}), exportedAt: '2099-12-31T23:59:59.999Z' },
    };
    if (text !== text2) throw new Error('canonical serialization changed after parse');
    if (stableStadiumVisualHash(visual) !== stableStadiumVisualHash(reparsed)) throw new Error('hash changed after parse');
    if (stableStadiumVisualHash(reparsed) !== stableStadiumVisualHash(timestampVariant)) {
      throw new Error('volatile authoring.exportedAt changed stable hash');
    }
    console.log(`PASS  ${label}  ${stableStadiumVisualHash(reparsed)}`);
  } catch (error) {
    failed++;
    console.error(`FAIL  ${label}  ${error instanceof Error ? error.message : String(error)}`);
  }
}
console.log(`${visuals.length - failed}/${visuals.length} canonical round trips passed`);
process.exit(failed === 0 ? 0 : 1);
