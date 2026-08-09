#!/usr/bin/env tsx
import { resolve } from 'node:path';
import {
  ASSET_DIR, ROOT, STAGING_DIR, listJsonFiles, parseArgs, readVisualFile, relativeToRoot,
} from './io.ts';
import { stableStadiumVisualHash } from '../../src/render/stadiumVisual/index.ts';

const { positional, flags } = parseArgs();
const requested = positional.map((file) => resolve(ROOT, file));
const files = requested.length > 0
  ? requested
  : [...listJsonFiles(ASSET_DIR), ...(flags.has('staged') ? listJsonFiles(STAGING_DIR) : [])];

if (files.length === 0) {
  console.error('No stadium visual JSON files found. Pass a file or stage one under .stadium-staging/.');
  process.exit(1);
}

let failed = 0;
for (const file of files) {
  try {
    const visual = readVisualFile(file, flags.has('allow-unregistered'));
    console.log(`PASS  ${relativeToRoot(file)}  ${visual.stadiumId}  ${stableStadiumVisualHash(visual)}`);
  } catch (error) {
    failed++;
    console.error(`FAIL  ${relativeToRoot(file)}\n${error instanceof Error ? error.message : String(error)}`);
  }
}
console.log(`${files.length - failed}/${files.length} stadium visual assets valid`);
process.exit(failed === 0 ? 0 : 1);
