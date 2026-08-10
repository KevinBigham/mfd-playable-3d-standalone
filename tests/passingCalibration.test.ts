import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  NFLVERSE_SEASONS, buildPassingCalibration, parseCalibrationArgs, parseCsvChunks,
  runPassingCalibration,
} from '../tools/calibratePassing.ts';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'go-passing-calibration-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function collect(chunks: string[]): Promise<string[][]> {
  async function* source(): AsyncGenerator<string> {
    for (const chunk of chunks) yield chunk;
  }
  const rows: string[][] = [];
  for await (const row of parseCsvChunks(source())) rows.push(row);
  return rows;
}

const HEADER = [
  'season_type', 'play_type', 'pass_attempt', 'qb_spike', 'qb_kneel', 'two_point_attempt',
  'complete_pass', 'interception', 'yards_after_catch', 'air_yards', 'pass_location', 'goal_to_go', 'desc',
].join(',');

function csvFixture(season: number): string {
  const rows = [
    ['REG', 'pass', 1, 0, 0, 0, 1, 0, 8, -2, 'left', 0, `"screen, season ${season}"`],
    ['REG', 'pass', 1, 0, 0, 0, 0, 0, '', 5, 'middle', 0, 'incomplete'],
    ['REG', 'pass', 1, 0, 0, 0, 0, 1, '', 15, 'right', 1, '"picked ""cleanly"""'],
    ['REG', 'pass', 1, 0, 0, 0, 1, 0, 4, 25, 'left', 1, '"sideline\nextension"'],
    ['REG', 'qb_spike', 1, 1, 0, 0, 0, 0, '', 0, 'middle', 0, 'spike'],
    ['REG', 'qb_kneel', 1, 0, 1, 0, 0, 0, '', 0, 'middle', 0, 'kneel'],
    ['REG', 'pass', 1, 0, 0, 1, 1, 0, 2, 1, 'middle', 0, 'two point'],
    ['REG', 'no_play', 1, 0, 0, 0, 1, 0, 9, 7, 'left', 0, 'no play'],
    ['POST', 'pass', 1, 0, 0, 0, 1, 0, 3, 3, 'left', 0, 'postseason'],
    ['REG', 'run', 0, 0, 0, 0, 0, 0, '', '', '', '', 'rush'],
  ];
  return `\ufeff${HEADER}\r\n${rows.map((row) => row.join(',')).join('\r\n')}\r\n`;
}

async function writeFixtures(directory: string): Promise<Map<number, Buffer>> {
  const fixtures = new Map<number, Buffer>();
  for (const season of NFLVERSE_SEASONS) {
    const fixture = gzipSync(csvFixture(season));
    fixtures.set(season, fixture);
    await writeFile(join(directory, `play_by_play_${season}.csv.gz`), fixture);
  }
  return fixtures;
}

describe('nflverse passing calibration sidecar', () => {
  it('parses quoted commas, escaped quotes, embedded newlines and chunk boundaries', async () => {
    const rows = await collect([
      '\ufeffname,desc\r', '\nA,"comma, and "', '"quote"""\r\nB,"two\n', 'lines"',
    ]);
    expect(rows).toEqual([
      ['name', 'desc'],
      ['A', 'comma, and "quote"'],
      ['B', 'two\nlines'],
    ]);
  });

  it('rejects an unterminated quoted field', async () => {
    await expect(collect(['a,b\n1,"unfinished'])).rejects.toThrow('Unterminated quoted CSV field');
  });

  it('filters actual regular-season attempts and aggregates every requested dimension', async () => {
    const directory = await temporaryDirectory();
    const fixtures = await writeFixtures(directory);
    const result = await buildPassingCalibration(directory);

    expect(result.seasons).toEqual([2022, 2023, 2024, 2025]);
    expect(result.counts).toEqual({
      inputRows: 40,
      includedAttempts: 16,
      excluded: {
        notRegularSeason: 4, notPassAttempt: 4, spike: 4, kneel: 4, twoPointAttempt: 4, noPlay: 4,
      },
      unclassified: { airYards: 0, passLocation: 0, goalToGo: 0 },
    });
    expect(result.overall).toMatchObject({
      attempts: 16,
      completions: 8,
      interceptions: 4,
      yacSamples: 8,
      yacYards: 48,
      rates: { completion: 0.5, interception: 0.25, yardsAfterCatchPerCompletion: 6 },
    });
    expect(result.dimensions.airYards.map(({ key, attempts }) => [key, attempts])).toEqual([
      ['<0', 4], ['0-9', 4], ['10-19', 4], ['20+', 4],
    ]);
    expect(result.dimensions.passLocation.map(({ key, attempts }) => [key, attempts])).toEqual([
      ['left', 8], ['middle', 4], ['right', 4],
    ]);
    expect(result.dimensions.goalToGo.map(({ key, attempts }) => [key, attempts])).toEqual([
      ['false', 8], ['true', 8],
    ]);
    expect(result.dimensions.airYards[0].relativeMultipliers).toEqual({
      completion: 1.15, interception: 0.85, yardsAfterCatch: 1.15,
    });
    expect(result.dimensions.airYards[3].relativeMultipliers.yardsAfterCatch).toBe(0.85);
    expect(result.sources.map((source) => source.sha256)).toEqual(
      NFLVERSE_SEASONS.map((season) => createHash('sha256').update(fixtures.get(season)!).digest('hex')),
    );
    expect(result.sourceUrls).toEqual(NFLVERSE_SEASONS.map(
      (season) => `https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_${season}.csv.gz`,
    ));
  });

  it('writes byte-identical timestamp-free JSON for identical inputs', async () => {
    const directory = await temporaryDirectory();
    await writeFixtures(directory);
    const first = join(directory, 'first.json');
    const second = join(directory, 'second.json');
    await runPassingCalibration({ inputDir: directory, output: first });
    await runPassingCalibration({ inputDir: directory, output: second });
    const [firstBytes, secondBytes] = await Promise.all([readFile(first), readFile(second)]);
    expect(firstBytes.equals(secondBytes)).toBe(true);
    expect(JSON.parse(firstBytes.toString('utf8'))).not.toHaveProperty('generatedAt');
  });

  it('supports both CLI flag forms and requires a local input directory', () => {
    const parsed = parseCalibrationArgs(['--input-dir=fixtures', '--output', 'report.json']);
    expect(parsed.inputDir).toMatch(/fixtures$/);
    expect(parsed.output).toMatch(/report\.json$/);
    expect(() => parseCalibrationArgs(['--output=result.json'])).toThrow('--input-dir');
    expect(() => parseCalibrationArgs(['--input-dir', 'fixtures', '--network'])).toThrow('Unknown argument');
  });
});
