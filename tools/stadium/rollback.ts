#!/usr/bin/env tsx
import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import {
  ASSET_DIR, REGISTRY_FILE, STAGING_DIR, atomicWrite, flagString, parseArgs,
  registryEntriesWith, renderRegistry, requireKnownStadiumId, resolveContainedFile,
} from './io.ts';

const { positional, flags } = parseArgs();
const stadiumId = flagString(flags, 'stadium') ?? positional[0] ?? null;
if (!stadiumId) {
  console.error('Usage: npm run stadium:rollback -- --stadium <existing-stadium-id>');
  process.exit(2);
}
// Validate both the slug grammar and native ID allowlist before the value participates in a path.
const safeStadiumId = requireKnownStadiumId(stadiumId);
const target = resolveContainedFile(ASSET_DIR, `${safeStadiumId}.json`);
if (!existsSync(target)) {
  console.error(`No promoted override exists for ${safeStadiumId}; it is already on the legacy path.`);
  process.exit(2);
}

mkdirSync(STAGING_DIR, { recursive: true });
const parked = resolveContainedFile(STAGING_DIR, `${safeStadiumId}.rollback-${Date.now()}.json`);
const oldRegistry = readFileSync(REGISTRY_FILE, 'utf8');
try {
  renameSync(target, parked);
  atomicWrite(REGISTRY_FILE, renderRegistry(registryEntriesWith()));
  console.log(`ROLLED BACK  ${safeStadiumId} now resolves through the legacy procedural path`);
  console.log(`Recoverable asset parked at ${parked}`);
} catch (error) {
  try {
    if (existsSync(parked)) renameSync(parked, target);
    atomicWrite(REGISTRY_FILE, oldRegistry);
  } catch (restoreError) {
    throw new AggregateError([error, restoreError], 'Rollback failed and restoration also failed');
  }
  throw error;
}
