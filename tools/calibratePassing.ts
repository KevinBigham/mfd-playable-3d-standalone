#!/usr/bin/env tsx
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createGunzip } from 'node:zlib';

export const NFLVERSE_SEASONS = [2022, 2023, 2024, 2025] as const;
const NFLVERSE_PBP_RELEASE = 'https://github.com/nflverse/nflverse-data/releases/download/pbp';
const DEFAULT_OUTPUT = 'reports/play-the-ball/nflverse-passing-calibration.json';
const MULTIPLIER_MIN = 0.85;
const MULTIPLIER_MAX = 1.15;

const REQUIRED_COLUMNS = [
  'season_type', 'play_type', 'pass_attempt', 'qb_spike', 'qb_kneel', 'two_point_attempt',
  'complete_pass', 'interception', 'yards_after_catch', 'air_yards', 'pass_location', 'goal_to_go',
] as const;

type RequiredColumn = typeof REQUIRED_COLUMNS[number];
type AirYardsBin = '<0' | '0-9' | '10-19' | '20+';
type PassLocation = 'left' | 'middle' | 'right';
type GoalToGo = 'false' | 'true';

interface Totals {
  attempts: number;
  completions: number;
  interceptions: number;
  yacSamples: number;
  yacYards: number;
}

export interface CalibrationMetric {
  attempts: number;
  completions: number;
  interceptions: number;
  yacSamples: number;
  yacYards: number;
  rates: {
    completion: number;
    interception: number;
    yardsAfterCatchPerCompletion: number;
  };
  relativeMultipliers: {
    completion: number;
    interception: number;
    yardsAfterCatch: number;
  };
}

export interface PassingCalibration {
  schemaVersion: 1;
  dataset: 'nflverse play-by-play';
  seasons: number[];
  sourceUrls: string[];
  sources: Array<{ season: number; file: string; url: string; sha256: string }>;
  filters: {
    seasonType: 'REG';
    passAttempt: 1;
    excluded: ['qb_spike', 'qb_kneel', 'two_point_attempt', 'no_play'];
    notes: string;
  };
  counts: {
    inputRows: number;
    includedAttempts: number;
    excluded: {
      notRegularSeason: number;
      notPassAttempt: number;
      spike: number;
      kneel: number;
      twoPointAttempt: number;
      noPlay: number;
    };
    unclassified: { airYards: number; passLocation: number; goalToGo: number };
  };
  overall: CalibrationMetric;
  dimensions: {
    airYards: Array<{ key: AirYardsBin } & CalibrationMetric>;
    passLocation: Array<{ key: PassLocation } & CalibrationMetric>;
    goalToGo: Array<{ key: GoalToGo } & CalibrationMetric>;
  };
}

export interface CalibrationOptions {
  inputDir: string;
  output: string;
}

/**
 * Streaming RFC-4180-style CSV parser. It handles quoted delimiters, escaped quotes,
 * embedded newlines, CRLF input, UTF-8 chunk boundaries and a final row without a newline.
 */
export async function* parseCsvChunks(
  chunks: AsyncIterable<string | Buffer>,
): AsyncGenerator<string[]> {
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  let quotePending = false;
  let skipLf = false;
  let firstField = true;

  const finishField = (): void => {
    if (firstField && field.charCodeAt(0) === 0xfeff) field = field.slice(1);
    firstField = false;
    row.push(field);
    field = '';
  };

  for await (const rawChunk of chunks) {
    const chunk = typeof rawChunk === 'string' ? rawChunk : rawChunk.toString('utf8');
    const completed: string[][] = [];

    const finishRow = (): void => {
      finishField();
      completed.push(row);
      row = [];
    };

    const outsideQuote = (character: string): void => {
      if (skipLf) {
        skipLf = false;
        if (character === '\n') return;
      }
      if (character === ',') finishField();
      else if (character === '\n') finishRow();
      else if (character === '\r') {
        finishRow();
        skipLf = true;
      } else if (character === '"' && field.length === 0) inQuotes = true;
      else field += character;
    };

    for (const character of chunk) {
      if (inQuotes) {
        if (quotePending) {
          if (character === '"') {
            field += '"';
            quotePending = false;
          } else {
            inQuotes = false;
            quotePending = false;
            outsideQuote(character);
          }
        } else if (character === '"') {
          quotePending = true;
        } else {
          field += character;
        }
      } else {
        outsideQuote(character);
      }
    }

    for (const completedRow of completed) yield completedRow;
  }

  if (inQuotes && !quotePending) throw new Error('Unterminated quoted CSV field');
  if (quotePending) {
    inQuotes = false;
    quotePending = false;
  }
  if (field.length > 0 || row.length > 0) {
    finishField();
    yield row;
  }
}

function emptyTotals(): Totals {
  return { attempts: 0, completions: 0, interceptions: 0, yacSamples: 0, yacYards: 0 };
}

function numeric(value: string): number | null {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function flag(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === '1.0' || normalized === 'true'
    || normalized === 't' || normalized === 'yes';
}

function noPlay(value: string): boolean {
  return value.trim().toLowerCase() === 'no_play';
}

function airYardsBin(value: string): AirYardsBin | null {
  const yards = numeric(value);
  if (yards === null) return null;
  if (yards < 0) return '<0';
  if (yards < 10) return '0-9';
  if (yards < 20) return '10-19';
  return '20+';
}

function passLocation(value: string): PassLocation | null {
  const normalized = value.trim().toLowerCase();
  return normalized === 'left' || normalized === 'middle' || normalized === 'right'
    ? normalized : null;
}

function goalToGo(value: string): GoalToGo | null {
  if (value.trim() === '') return null;
  return flag(value) ? 'true' : 'false';
}

function addAttempt(totals: Totals, row: Record<RequiredColumn, string>): void {
  totals.attempts++;
  if (flag(row.complete_pass)) totals.completions++;
  if (flag(row.interception)) totals.interceptions++;
  const yac = numeric(row.yards_after_catch);
  if (flag(row.complete_pass) && yac !== null) {
    totals.yacSamples++;
    totals.yacYards += yac;
  }
}

function round(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const rounded = Number(value.toFixed(6));
  return Object.is(rounded, -0) ? 0 : rounded;
}

function rate(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function multiplier(value: number, baseline: number, sampled: boolean): number {
  if (!sampled || baseline === 0) return 1;
  return round(Math.min(MULTIPLIER_MAX, Math.max(MULTIPLIER_MIN, value / baseline)));
}

function metric(totals: Totals, overall: Totals): CalibrationMetric {
  const completion = rate(totals.completions, totals.attempts);
  const interception = rate(totals.interceptions, totals.attempts);
  const yardsAfterCatch = rate(totals.yacYards, totals.yacSamples);
  const overallCompletion = rate(overall.completions, overall.attempts);
  const overallInterception = rate(overall.interceptions, overall.attempts);
  const overallYac = rate(overall.yacYards, overall.yacSamples);
  return {
    attempts: totals.attempts,
    completions: totals.completions,
    interceptions: totals.interceptions,
    yacSamples: totals.yacSamples,
    yacYards: round(totals.yacYards),
    rates: {
      completion: round(completion),
      interception: round(interception),
      yardsAfterCatchPerCompletion: round(yardsAfterCatch),
    },
    relativeMultipliers: {
      completion: multiplier(completion, overallCompletion, totals.attempts > 0),
      interception: multiplier(interception, overallInterception, totals.attempts > 0),
      yardsAfterCatch: multiplier(yardsAfterCatch, overallYac, totals.yacSamples > 0),
    },
  };
}

async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

async function* gzipCsvRows(file: string): AsyncGenerator<string[]> {
  const input = createReadStream(file);
  const gunzip = createGunzip();
  gunzip.setEncoding('utf8');
  input.pipe(gunzip);
  yield* parseCsvChunks(gunzip);
}

function columnIndex(header: string[]): Record<RequiredColumn, number> {
  const positions = new Map(header.map((name, index) => [name.trim(), index]));
  const missing = REQUIRED_COLUMNS.filter((name) => !positions.has(name));
  if (missing.length > 0) throw new Error(`Missing required nflverse columns: ${missing.join(', ')}`);
  return Object.fromEntries(REQUIRED_COLUMNS.map((name) => [name, positions.get(name)!])) as Record<RequiredColumn, number>;
}

export async function buildPassingCalibration(inputDir: string): Promise<PassingCalibration> {
  const overall = emptyTotals();
  const air = new Map<AirYardsBin, Totals>([['<0', emptyTotals()], ['0-9', emptyTotals()], ['10-19', emptyTotals()], ['20+', emptyTotals()]]);
  const locations = new Map<PassLocation, Totals>([['left', emptyTotals()], ['middle', emptyTotals()], ['right', emptyTotals()]]);
  const goal = new Map<GoalToGo, Totals>([['false', emptyTotals()], ['true', emptyTotals()]]);
  const counts: PassingCalibration['counts'] = {
    inputRows: 0,
    includedAttempts: 0,
    excluded: { notRegularSeason: 0, notPassAttempt: 0, spike: 0, kneel: 0, twoPointAttempt: 0, noPlay: 0 },
    unclassified: { airYards: 0, passLocation: 0, goalToGo: 0 },
  };
  const sources: PassingCalibration['sources'] = [];

  for (const season of NFLVERSE_SEASONS) {
    const file = resolve(inputDir, `play_by_play_${season}.csv.gz`);
    const url = `${NFLVERSE_PBP_RELEASE}/play_by_play_${season}.csv.gz`;
    const rows = gzipCsvRows(file);
    const first = await rows.next();
    if (first.done) throw new Error(`${basename(file)} is empty`);
    const indices = columnIndex(first.value);
    sources.push({ season, file: basename(file), url, sha256: await sha256File(file) });

    for await (const values of rows) {
      if (values.length === 1 && values[0].trim() === '') continue;
      counts.inputRows++;
      const row = Object.fromEntries(REQUIRED_COLUMNS.map((name) => [name, values[indices[name]] ?? ''])) as Record<RequiredColumn, string>;
      if (row.season_type.trim().toUpperCase() !== 'REG') { counts.excluded.notRegularSeason++; continue; }
      // Classify nullified snaps before pass_attempt: nflverse deliberately clears the attempt
      // flag on most `no_play` penalty rows, but they are still a distinct requested exclusion.
      if (noPlay(row.play_type)) { counts.excluded.noPlay++; continue; }
      if (!flag(row.pass_attempt)) { counts.excluded.notPassAttempt++; continue; }
      if (flag(row.qb_spike)) { counts.excluded.spike++; continue; }
      if (flag(row.qb_kneel)) { counts.excluded.kneel++; continue; }
      if (flag(row.two_point_attempt)) { counts.excluded.twoPointAttempt++; continue; }

      counts.includedAttempts++;
      addAttempt(overall, row);
      const airKey = airYardsBin(row.air_yards);
      const locationKey = passLocation(row.pass_location);
      const goalKey = goalToGo(row.goal_to_go);
      if (airKey) addAttempt(air.get(airKey)!, row); else counts.unclassified.airYards++;
      if (locationKey) addAttempt(locations.get(locationKey)!, row); else counts.unclassified.passLocation++;
      if (goalKey) addAttempt(goal.get(goalKey)!, row); else counts.unclassified.goalToGo++;
    }
  }

  const sourceUrls = sources.map((source) => source.url);
  return {
    schemaVersion: 1,
    dataset: 'nflverse play-by-play',
    seasons: [...NFLVERSE_SEASONS],
    sourceUrls,
    sources,
    filters: {
      seasonType: 'REG',
      passAttempt: 1,
      excluded: ['qb_spike', 'qb_kneel', 'two_point_attempt', 'no_play'],
      notes: 'Actual regular-season pass attempts only; rates use attempts, and YAC uses completed passes with numeric yards_after_catch.',
    },
    counts,
    overall: metric(overall, overall),
    dimensions: {
      airYards: [...air].map(([key, totals]) => ({ key, ...metric(totals, overall) })),
      passLocation: [...locations].map(([key, totals]) => ({ key, ...metric(totals, overall) })),
      goalToGo: [...goal].map(([key, totals]) => ({ key, ...metric(totals, overall) })),
    },
  };
}

export async function runPassingCalibration(options: CalibrationOptions): Promise<PassingCalibration> {
  const calibration = await buildPassingCalibration(options.inputDir);
  const output = resolve(options.output);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(calibration, null, 2)}\n`, 'utf8');
  return calibration;
}

export function parseCalibrationArgs(argv: string[]): CalibrationOptions {
  let inputDir = '';
  let output = DEFAULT_OUTPUT;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--input-dir') inputDir = argv[++index] ?? '';
    else if (argument.startsWith('--input-dir=')) inputDir = argument.slice('--input-dir='.length);
    else if (argument === '--output') output = argv[++index] ?? '';
    else if (argument.startsWith('--output=')) output = argument.slice('--output='.length);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!inputDir) throw new Error('Usage: calibratePassing.ts --input-dir <directory> [--output <file>]');
  if (!output) throw new Error('--output requires a file path');
  return { inputDir: resolve(inputDir), output: resolve(output) };
}

async function main(): Promise<void> {
  const options = parseCalibrationArgs(process.argv.slice(2));
  const result = await runPassingCalibration(options);
  console.log(`Passing calibration: ${result.counts.includedAttempts} attempts from ${result.sources.length} seasons`);
  console.log(`Wrote ${options.output}`);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
