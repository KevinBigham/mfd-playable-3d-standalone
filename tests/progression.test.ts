import { describe, it, expect } from 'vitest';
import {
  recordDrive, bestFor, pbKey, dailySeed, todayString,
  encodeChallenge, decodeChallenge, teamDriveCount,
} from '../src/progression/progression.ts';
import { RULES_VERSION } from '../src/core/constants.ts';

describe('personal bests', () => {
  it('partitions by ruleset, rules version, and difficulty — never cross-compared', () => {
    expect(pbKey('DRIVE_RUSH', 'PRO')).toBe(`DRIVE_RUSH:v${RULES_VERSION}:PRO`);
    const a = recordDrive('DRIVE_RUSH', 'PRO', 'team-a', 7, 42);
    expect(a.isNewBest).toBe(true);
    expect(a.previous).toBeNull();
    const b = recordDrive('DRIVE_RUSH', 'PRO', 'team-a', 6, 99);
    expect(b.isNewBest).toBe(false);           // fewer points never beats more points
    expect(bestFor('DRIVE_RUSH', 'PRO')?.points).toBe(7);
    expect(bestFor('DRIVE_RUSH', 'LEGEND')).toBeNull();   // different difficulty, different record
    expect(bestFor('CLASSIC', 'PRO')).toBeNull();
    expect(teamDriveCount('team-a')).toBe(2);
  });
});

describe('daily drive', () => {
  it('is the same problem for everyone on the same day, and a new one tomorrow', () => {
    expect(dailySeed('2026-08-03')).toBe(dailySeed('2026-08-03'));
    expect(dailySeed('2026-08-03')).not.toBe(dailySeed('2026-08-04'));
    expect(todayString(new Date(Date.UTC(2026, 7, 3, 23, 59)))).toBe('2026-08-03');
  });
});

describe('challenge codes', () => {
  const sample = {
    rulesVersion: RULES_VERSION, seed: 123456789, home: 'iron-harbor-anvils',
    away: 'quarry-point-monoliths', difficulty: 'PRO' as const, points: 7, yards: 40,
  };
  it('round-trips with a checksum and no private identifiers', () => {
    const code = encodeChallenge(sample);
    expect(code).toMatch(/^GO2-/);
    const r = decodeChallenge(code);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.code).toEqual(sample);
  });
  it('refuses mistyped and cross-version codes with an explanation', () => {
    const code = encodeChallenge(sample);
    expect(decodeChallenge(code.slice(0, -1) + (code.endsWith('A') ? 'B' : 'A')).ok).toBe(false);
    expect(decodeChallenge('garbage').ok).toBe(false);
    const old = encodeChallenge({ ...sample, rulesVersion: RULES_VERSION - 1 });
    const r = decodeChallenge(old);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.why).toBe('RULES_MISMATCH');
  });
});
