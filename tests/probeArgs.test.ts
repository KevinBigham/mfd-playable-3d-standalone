import { describe, expect, it } from 'vitest';
import { parsePassProbeArgs } from '../tools/passprobe.ts';
import { parseDeepProbeArgs } from '../tools/deepprobe.ts';

describe('passprobe arguments', () => {
  it('preserves current defaults', () => {
    expect(parsePassProbeArgs([])).toEqual({ games: 8, seedStart: 9100, jsonPath: null });
  });

  it('accepts games, seed start, and a JSON receipt path', () => {
    expect(parsePassProbeArgs([
      '--games', '3', '--seed-start', '19100', '--json', 'reports/pass.json',
    ])).toEqual({ games: 3, seedStart: 19100, jsonPath: 'reports/pass.json' });
  });
});

describe('deepprobe arguments', () => {
  it('preserves current defaults', () => {
    expect(parseDeepProbeArgs([])).toEqual({
      games: 10, seedStart: 4400, deepAir: 18, jsonPath: null,
    });
  });

  it('accepts games, seed start, deep threshold, and a JSON receipt path', () => {
    expect(parseDeepProbeArgs([
      '--games', '4', '--seed-start', '19100', '--deep', '20', '--json', 'reports/deep.json',
    ])).toEqual({ games: 4, seedStart: 19100, deepAir: 20, jsonPath: 'reports/deep.json' });
  });
});
