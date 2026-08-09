import {
  existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getStadium, STADIUM_IDS } from '../../src/data/stadiums.ts';
import {
  assertStadiumVisualBudget,
  canonicalStadiumVisualJson,
  legacyVisualFromStadiumDef,
  parseStadiumVisual,
  stableStadiumVisualHash,
  stadiumVisualBudgetReceipt,
  type MfdStadiumVisualV1,
  type QualityTier,
  type StadiumBudgetReceipt,
} from '../../src/render/stadiumVisual/index.ts';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const STAGING_DIR = join(ROOT, '.stadium-staging');
export const ASSET_DIR = join(ROOT, 'src/render/stadiumVisual/assets');
export const REGISTRY_FILE = join(ROOT, 'src/render/stadiumVisual/generatedRegistry.ts');
export const QUALITY_TIERS: readonly QualityTier[] = ['LOW', 'MEDIUM', 'HIGH'];

const STADIUM_ID_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Validate user-controlled IDs before they participate in any filesystem path. */
export function requireKnownStadiumId(value: string): string {
  if (!STADIUM_ID_SLUG.test(value) || !STADIUM_IDS.includes(value)) {
    throw new Error(`Unknown stadium id: ${JSON.stringify(value)}`);
  }
  return value;
}

/** Resolve one filename beneath a trusted directory and reject separators or containment loss. */
export function resolveContainedFile(directory: string, fileName: string): string {
  if (basename(fileName) !== fileName) throw new Error(`Unsafe stadium file name: ${JSON.stringify(fileName)}`);
  const root = resolve(directory);
  const file = resolve(root, fileName);
  if (!file.startsWith(`${root}${sep}`)) throw new Error(`Stadium path escapes asset directory: ${JSON.stringify(fileName)}`);
  return file;
}

export function parseArgs(argv = process.argv.slice(2)): {
  positional: string[];
  flags: Map<string, string | true>;
} {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) { positional.push(arg); continue; }
    const eq = arg.indexOf('=');
    if (eq >= 0) { flags.set(arg.slice(2, eq), arg.slice(eq + 1)); continue; }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) { flags.set(key, next); i++; }
    else flags.set(key, true);
  }
  return { positional, flags };
}

export function flagString(flags: Map<string, string | true>, name: string): string | null {
  const v = flags.get(name);
  return typeof v === 'string' ? v : null;
}

export function listJsonFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => join(dir, name));
}

export function readVisualFile(file: string, allowUnregistered = false): MfdStadiumVisualV1 {
  let decoded: unknown;
  try { decoded = JSON.parse(readFileSync(file, 'utf8')) as unknown; }
  catch (error) {
    throw new Error(`${file}: invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return parseStadiumVisual(decoded, { allowUnregistered });
}

export function promotedVisual(stadiumId: string): MfdStadiumVisualV1 | null {
  const file = join(ASSET_DIR, `${stadiumId}.json`);
  return existsSync(file) ? readVisualFile(file) : null;
}

export function visualForStadium(stadiumId: string): MfdStadiumVisualV1 {
  return promotedVisual(stadiumId) ?? legacyVisualFromStadiumDef(getStadium(stadiumId));
}

export function budgetAllTiers(visual: MfdStadiumVisualV1): StadiumBudgetReceipt[] {
  return QUALITY_TIERS.map((quality) => {
    const receipt = stadiumVisualBudgetReceipt(visual, quality);
    assertStadiumVisualBudget(receipt);
    return receipt;
  });
}

export function canonicalAssetText(visual: MfdStadiumVisualV1): string {
  return `${canonicalStadiumVisualJson(visual)}\n`;
}

export interface RegistryEntry { stadiumId: string; fileName: string; hash: string }

export function registryEntriesWith(candidate?: MfdStadiumVisualV1): RegistryEntry[] {
  const byId = new Map<string, RegistryEntry>();
  for (const file of listJsonFiles(ASSET_DIR)) {
    const visual = readVisualFile(file);
    byId.set(visual.stadiumId, {
      stadiumId: visual.stadiumId,
      fileName: `${visual.stadiumId}.json`,
      hash: stableStadiumVisualHash(visual),
    });
  }
  if (candidate) {
    byId.set(candidate.stadiumId, {
      stadiumId: candidate.stadiumId,
      fileName: `${candidate.stadiumId}.json`,
      hash: stableStadiumVisualHash(candidate),
    });
  }
  return [...byId.values()].sort((a, b) => a.stadiumId.localeCompare(b.stadiumId));
}

export function renderRegistry(entries: readonly RegistryEntry[]): string {
  const imports = entries.map((entry, i) => `import asset${i} from './assets/${entry.fileName}';`).join('\n');
  const rows = entries.map((entry, i) =>
    `  ${JSON.stringify(entry.stadiumId)}: { visual: asset${i} as unknown as MfdStadiumVisualV1, hash: ${JSON.stringify(entry.hash)} },`)
    .join('\n');
  return `/**\n * Generated by \`npm run stadium:promote\` / \`npm run stadium:rollback\`.\n * Do not hand-edit entries. Only validated, reviewed, local semantic JSON is imported.\n */\nimport type { MfdStadiumVisualV1 } from './types.ts';\n${imports}${imports ? '\n' : ''}\nexport interface RegisteredStadiumVisual {\n  visual: MfdStadiumVisualV1;\n  hash: string;\n}\n\nconst PROMOTED: Readonly<Record<string, RegisteredStadiumVisual>> = Object.freeze({\n${rows}\n});\n\nexport function resolveStadiumVisual(stadiumId: string): RegisteredStadiumVisual | null {\n  return PROMOTED[stadiumId] ?? null;\n}\n\nexport const PROMOTED_STADIUM_VISUAL_IDS: readonly string[] = Object.freeze(\n  Object.keys(PROMOTED).sort(),\n);\n`;
}

export function atomicWrite(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(temp, text, 'utf8');
    renameSync(temp, file);
  } catch (error) {
    try { rmSync(temp, { force: true }); } catch { /* preserve the original error */ }
    throw error;
  }
}

export function relativeToRoot(file: string): string {
  return file.startsWith(`${ROOT}/`) ? file.slice(ROOT.length + 1) : file;
}
