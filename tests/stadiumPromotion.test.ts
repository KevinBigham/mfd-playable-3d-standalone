import { describe, expect, it } from 'vitest';
import {
  existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ASSET_DIR, REGISTRY_FILE, renderRegistry, type RegistryEntry } from '../tools/stadium/io.ts';

function assetSnapshot(): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(ASSET_DIR)) return out;
  for (const name of readdirSync(ASSET_DIR).sort()) {
    if (name.endsWith('.json')) out[name] = readFileSync(join(ASSET_DIR, name), 'utf8');
  }
  return out;
}

describe('stadium promotion lifecycle', () => {
  it('renders a deterministic generated registry independent of input ordering', () => {
    const entries: RegistryEntry[] = [
      { stadiumId: 'the-saltpan', fileName: 'the-saltpan.json', hash: 'sv1-bbbb' },
      { stadiumId: 'grand-meridian', fileName: 'grand-meridian.json', hash: 'sv1-aaaa' },
    ];
    const ordered = [...entries].sort((a, b) => a.stadiumId.localeCompare(b.stadiumId));
    expect(renderRegistry(ordered)).toBe(renderRegistry([...entries].reverse().sort((a, b) => a.stadiumId.localeCompare(b.stadiumId))));
  });

  it('leaves promoted assets and registry byte-identical when validation fails', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mfd-stadium-invalid-'));
    const staged = join(dir, 'invalid.json');
    writeFileSync(staged, JSON.stringify({ schema: 'wrong', version: 999 }), 'utf8');
    const beforeAssets = assetSnapshot();
    const beforeRegistry = readFileSync(REGISTRY_FILE, 'utf8');
    try {
      const run = spawnSync('npx', ['tsx', 'tools/stadium/promote.ts', '--file', staged], {
        cwd: process.cwd(), encoding: 'utf8', timeout: 30_000,
      });
      expect(run.status).not.toBe(0);
      expect(`${run.stdout}\n${run.stderr}`).toMatch(/schema|validation|invalid/i);
      expect(assetSnapshot()).toEqual(beforeAssets);
      expect(readFileSync(REGISTRY_FILE, 'utf8')).toBe(beforeRegistry);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('restores both tracked surfaces when promotion fails after the asset write', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mfd-stadium-atomic-'));
    const staged = join(dir, 'the-saltpan-replacement.json');
    const current = JSON.parse(readFileSync(join(ASSET_DIR, 'the-saltpan.json'), 'utf8')) as {
      authoring?: { notes?: string };
    };
    current.authoring = { ...current.authoring, notes: 'failure-injection replacement must never persist' };
    writeFileSync(staged, JSON.stringify(current), 'utf8');
    const beforeAssets = assetSnapshot();
    const beforeRegistry = readFileSync(REGISTRY_FILE, 'utf8');
    try {
      const run = spawnSync('npx', [
        'tsx', 'tools/stadium/promote.ts', '--file', staged, '--replace',
      ], {
        cwd: process.cwd(), encoding: 'utf8', timeout: 30_000,
        env: {
          ...process.env,
          NODE_ENV: 'test',
          MFD_STADIUM_PROMOTE_FAILPOINT: 'after-asset-write',
        },
      });
      expect(run.status).not.toBe(0);
      expect(`${run.stdout}\n${run.stderr}`).toMatch(/injected stadium promotion failure after asset write/i);
      expect(assetSnapshot()).toEqual(beforeAssets);
      expect(readFileSync(REGISTRY_FILE, 'utf8')).toBe(beforeRegistry);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects traversal and encoded/path-like rollback targets before touching promoted files', () => {
    const beforeAssets = assetSnapshot();
    const beforeRegistry = readFileSync(REGISTRY_FILE, 'utf8');
    const attacks = [
      '../../package',
      '../the-saltpan',
      'the-saltpan/../../package',
      '/tmp/the-saltpan',
      '..\\..\\package',
      '%2e%2e%2fpackage',
      'the-saltpan.json',
      'THE-SALTPAN',
    ];
    for (const attack of attacks) {
      const run = spawnSync('npx', ['tsx', 'tools/stadium/rollback.ts', '--stadium', attack], {
        cwd: process.cwd(), encoding: 'utf8', timeout: 30_000,
      });
      expect(run.status, attack).not.toBe(0);
      expect(`${run.stdout}\n${run.stderr}`, attack).toMatch(/unknown stadium/i);
    }
    expect(assetSnapshot()).toEqual(beforeAssets);
    expect(readFileSync(REGISTRY_FILE, 'utf8')).toBe(beforeRegistry);
  });
});
