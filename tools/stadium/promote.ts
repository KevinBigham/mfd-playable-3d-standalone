#!/usr/bin/env tsx
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  ASSET_DIR, REGISTRY_FILE, ROOT, STAGING_DIR, atomicWrite, budgetAllTiers,
  canonicalAssetText, flagString, parseArgs, readVisualFile, registryEntriesWith, renderRegistry,
} from './io.ts';
import { stableStadiumVisualHash } from '../../src/render/stadiumVisual/index.ts';

const { positional, flags } = parseArgs();
const requested = flagString(flags, 'file') ?? positional[0] ?? null;
let source: string;
if (requested) source = resolve(ROOT, requested);
else {
  const id = flagString(flags, 'stadium');
  if (!id) {
    console.error('Usage: npm run stadium:promote -- --file .stadium-staging/<stadium>.json [--replace]');
    process.exit(2);
  }
  source = join(STAGING_DIR, `${id}.json`);
}

if (!existsSync(source)) {
  console.error(`Staged asset not found: ${source}`);
  process.exit(2);
}

const visual = readVisualFile(source);
budgetAllTiers(visual);
const hash = stableStadiumVisualHash(visual);
const target = join(ASSET_DIR, `${visual.stadiumId}.json`);
if (existsSync(target) && !flags.has('replace')) {
  console.error(`${visual.stadiumId} is already promoted. Re-run with --replace to replace it explicitly.`);
  process.exit(2);
}

const oldAsset = existsSync(target) ? readFileSync(target, 'utf8') : null;
const oldRegistry = existsSync(REGISTRY_FILE) ? readFileSync(REGISTRY_FILE, 'utf8') : null;
const nextAsset = canonicalAssetText(visual);
const nextRegistry = renderRegistry(registryEntriesWith(visual));

try {
  mkdirSync(ASSET_DIR, { recursive: true });
  // Registry moves last, so a newly promoted file cannot become reachable before it exists.
  atomicWrite(target, nextAsset);
  // Test-only fault injection proves the two-file transaction restores the first write if the
  // second step cannot commit. Requiring NODE_ENV=test prevents accidental production use.
  if (process.env.NODE_ENV === 'test'
      && process.env.MFD_STADIUM_PROMOTE_FAILPOINT === 'after-asset-write') {
    throw new Error('Injected stadium promotion failure after asset write');
  }
  atomicWrite(REGISTRY_FILE, nextRegistry);
} catch (error) {
  // Restore both tracked surfaces byte-for-byte if either atomic move fails.
  try {
    if (oldAsset === null) rmSync(target, { force: true });
    else atomicWrite(target, oldAsset);
    if (oldRegistry === null) rmSync(REGISTRY_FILE, { force: true });
    else atomicWrite(REGISTRY_FILE, oldRegistry);
  } catch (restoreError) {
    throw new AggregateError([error, restoreError], 'Promotion failed and restoration also failed');
  }
  throw error;
}

console.log(`PROMOTED  ${visual.stadiumId}  ${hash}`);
console.log(`asset: ${target}`);
console.log(`registry: ${REGISTRY_FILE}`);
