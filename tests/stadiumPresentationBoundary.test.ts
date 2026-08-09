import { describe, expect, it } from 'vitest';
import { defaultSave } from '../src/persistence/save.ts';
import { Match, defaultMatchConfig } from '../src/rules/match.ts';
import { getTeam, TEAM_IDS } from '../src/data/index.ts';
import { hashSeed } from '../src/core/rng.ts';
import { resolveStadiumVisual } from '../src/render/stadiumVisual/generatedRegistry.ts';

const FORBIDDEN_PRESENTATION_KEYS = [
  'stadiumVisual', 'stadium-visual', 'pascalSceneVersion', 'authoring', 'visualHash',
];

function fixedSeedReplayReceipt(override: { hash: string } | null): {
  revision: string;
  eventLog: unknown[];
  eventHash: string;
  snapshot: unknown;
  result: unknown;
} {
  // The resolved visual is intentionally consumed only as a presentation receipt. Match has no
  // visual argument, which is the architectural seam this A/B regression test protects.
  const revision = override?.hash ?? 'legacy';
  const config = defaultMatchConfig({
    seed: 7711,
    home: TEAM_IDS[0],
    away: TEAM_IDS[1],
    stadium: 'the-saltpan',
    quarterSeconds: 60,
    seats: [{ side: 0, active: false }, { side: 1, active: false }],
  });
  const match = new Match({
    config,
    home: getTeam(config.home),
    away: getTeam(config.away),
    seatIntent: () => null,
  });
  match.bus.record();
  let ticks = 0;
  while (!match.state.finished && ticks < 60 * 60 * 12) {
    match.tick();
    ticks++;
  }
  expect(match.state.finished).toBe(true);
  const eventLog = JSON.parse(JSON.stringify(match.bus.log ?? [])) as unknown[];
  const eventHash = hashSeed(JSON.stringify(eventLog)).toString(16);
  const snapshot = JSON.parse(JSON.stringify(match.captureSnapshot())) as unknown;
  const result = JSON.parse(JSON.stringify(match.result())) as unknown;
  match.dispose();
  return { revision, eventLog, eventHash, snapshot, result };
}

describe('authored stadiums stay presentation-only', () => {
  it('adds no authored visual payload to save data', () => {
    const json = JSON.stringify(defaultSave());
    for (const key of FORBIDDEN_PRESENTATION_KEYS) expect(json).not.toContain(key);
    expect(Object.keys(defaultSave().lastTeams).sort()).toEqual(['away', 'home', 'stadium', 'weather']);
  });

  it('snapshots retain only the existing stadium id', () => {
    const config = defaultMatchConfig({
      seed: 7711,
      home: TEAM_IDS[0],
      away: TEAM_IDS[1],
      stadium: 'the-saltpan',
      seats: [{ side: 0, active: false }, { side: 1, active: false }],
    });
    const match = new Match({
      config,
      home: getTeam(config.home),
      away: getTeam(config.away),
      seatIntent: () => null,
    });
    match.tick();
    const snapshot = match.captureSnapshot();
    const json = JSON.stringify(snapshot);
    expect(snapshot.stadium).toBe('the-saltpan');
    for (const key of FORBIDDEN_PRESENTATION_KEYS) expect(json).not.toContain(key);
  });

  it('keeps a fixed-seed replay, event log and hash identical with the override present or absent', () => {
    const promoted = resolveStadiumVisual('the-saltpan');
    expect(promoted).not.toBeNull();
    const authored = fixedSeedReplayReceipt(promoted);
    const legacy = fixedSeedReplayReceipt(null);
    expect(authored.revision).toMatch(/^v1-fnv1a64-/);
    expect(legacy.revision).toBe('legacy');
    expect(authored.eventLog.length).toBeGreaterThan(0);
    expect(authored.eventLog).toEqual(legacy.eventLog);
    expect(authored.eventHash).toBe(legacy.eventHash);
    expect(authored.snapshot).toEqual(legacy.snapshot);
    expect(authored.result).toEqual(legacy.result);
    for (const key of FORBIDDEN_PRESENTATION_KEYS) {
      expect(JSON.stringify(authored.eventLog)).not.toContain(key);
      expect(JSON.stringify(authored.snapshot)).not.toContain(key);
    }
  });
});
