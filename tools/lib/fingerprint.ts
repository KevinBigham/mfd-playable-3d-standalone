/**
 * Configuration fingerprint stamped on every probe receipt.
 *
 * A number without its configuration is not evidence: two probe runs can only be compared when
 * build, rules version, seeds, teams, difficulty, and assist profile all match. Every tool prints
 * this block and includes it in any JSON it writes.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { RULES_VERSION, FIRST_DOWN_YARDS } from '../../src/core/constants.ts';

export interface ProbeFingerprint {
  tool: string;
  buildVersion: string;
  gitCommit: string;
  rulesVersion: number;
  firstDownYards: number;
  seeds: string;
  teams: string;
  difficulty: string;
  quarterSeconds: number | null;
  assistProfile: string;
  policy: string | null;
  generatedAt: string;
  node: string;
}

let pkgVersion: string | null = null;
function packageVersion(): string {
  if (pkgVersion === null) {
    try {
      const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version?: string };
      pkgVersion = pkg.version ?? 'unknown';
    } catch { pkgVersion = 'unknown'; }
  }
  return pkgVersion;
}

function gitCommit(): string {
  try { return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
  catch { return 'no-git'; }
}

export function fingerprint(opts: {
  tool: string;
  seeds: string;
  teams: string;
  difficulty: string;
  quarterSeconds?: number;
  assistProfile?: string;
  policy?: string;
}): ProbeFingerprint {
  return {
    tool: opts.tool,
    buildVersion: packageVersion(),
    gitCommit: gitCommit(),
    rulesVersion: RULES_VERSION,
    firstDownYards: FIRST_DOWN_YARDS,
    seeds: opts.seeds,
    teams: opts.teams,
    difficulty: opts.difficulty,
    quarterSeconds: opts.quarterSeconds ?? null,
    assistProfile: opts.assistProfile ?? 'NONE',
    policy: opts.policy ?? null,
    generatedAt: new Date().toISOString(),
    node: process.version,
  };
}

export function printFingerprint(fp: ProbeFingerprint): void {
  console.log(`  fingerprint  ${fp.tool} · build ${fp.buildVersion}@${fp.gitCommit} · rules v${fp.rulesVersion}`
    + ` · chain ${fp.firstDownYards} yd`);
  console.log(`               seeds ${fp.seeds} · teams ${fp.teams} · ${fp.difficulty}`
    + (fp.quarterSeconds !== null ? ` · ${fp.quarterSeconds}s quarters` : '')
    + ` · assist ${fp.assistProfile}`
    + (fp.policy ? ` · policy ${fp.policy}` : ''));
}
