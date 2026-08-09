import { describe, expect, it } from 'vitest';
import { getStadium, STADIUMS } from '../src/data/stadiums.ts';
import {
  CAMERA_LANE_MAX_Z,
  CAMERA_LANE_MIN_Z,
  CHAMFER_BOX_TRIANGLES,
  FIELD_APRON_HALF_WIDTH,
  FIELD_APRON_MAX_Z,
  FIELD_APRON_MIN_Z,
  FIELD_LOW_CLEARANCE_Y,
  LEGACY_ROOF_UNDERSIDE_RISE_Y,
  LEGACY_TIER,
  ROOF_MIN_CLEARANCE_Y,
  STADIUM_BUDGET_ADDED_BATCHES,
  STADIUM_BUDGET_TRIANGLE_RATIO,
  STADIUM_LOOP_SEGMENTS,
  StadiumVisualBudgetError,
  StadiumVisualValidationError,
  assertStadiumVisualBudget,
  canonicalStadiumVisualJson,
  compileStadiumVisual,
  legacyTier3NativeEstimate,
  legacyProfileMetrics,
  legacyVisualFromStadiumDef,
  nativeRoofCoveredSegmentCount,
  nativeRoofElevations,
  parseStadiumVisual,
  stableStadiumVisualHash,
  stadiumVisualBudgetReceipt,
  validateStadiumVisual,
  type MfdStadiumVisualV1,
  type QualityTier,
  type StadiumVisualValidationIssue,
} from '../src/render/stadiumVisual/index.ts';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function fixture(id = 'the-saltpan'): MfdStadiumVisualV1 {
  return legacyVisualFromStadiumDef(getStadium(id));
}

function errors(value: unknown, allowUnregistered = false): StadiumVisualValidationIssue[] {
  const result = validateStadiumVisual(value, { allowUnregistered });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('expected validation to fail');
  return result.errors;
}

function expectIssue(value: unknown, path: string, code: string, allowUnregistered = false): void {
  expect(errors(value, allowUnregistered)).toEqual(expect.arrayContaining([
    expect.objectContaining({ path, code }),
  ]));
}

describe('MfdStadiumVisualV1 validation', () => {
  it('accepts and parses the exact legacy visual for all registered venues', () => {
    for (const stadium of STADIUMS) {
      const visual = fixture(stadium.id);
      const result = validateStadiumVisual(visual);
      expect(result.ok, stadium.id).toBe(true);
      expect(parseStadiumVisual(visual)).toBe(visual);
      for (const quality of ['LOW', 'MEDIUM', 'HIGH'] as const) {
        expect(compileStadiumVisual(visual, quality).quality).toBe(quality);
      }
    }
  });

  it('fails closed on schema coordinates, unknown versions and exact-path unknown keys', () => {
    const cases: Array<[string, string, unknown]> = [
      ['schema', 'VALUE', { schema: 'mfd.other' }],
      ['version', 'VALUE', { version: 2 }],
      ['units', 'VALUE', { units: 'meters' }],
      ['coordinateSystem.z', 'VALUE', { coordinateSystem: { ...fixture().coordinateSystem, z: 'away-to-home' } }],
      ['futureRoot', 'UNKNOWN_FIELD', { futureRoot: true }],
      ['bowl.futurePlan', 'UNKNOWN_FIELD', { bowl: { ...fixture().bowl, futurePlan: 1 } }],
      ['bowl.profile[0].mesh', 'UNKNOWN_FIELD', {
        bowl: { ...fixture().bowl, profile: [{ ...fixture().bowl.profile[0], mesh: 'external.glb' }, ...fixture().bowl.profile.slice(1)] },
      }],
    ];
    for (const [path, code, patch] of cases) {
      const visual = Object.assign(clone(fixture()), patch) as unknown;
      expectIssue(visual, path, code);
    }
  });

  it('requires registered ids unless explicitly validating an isolated fixture', () => {
    const visual = fixture();
    visual.stadiumId = 'pascal-preview-only';
    expectIssue(visual, 'stadiumId', 'UNKNOWN_STADIUM');
    expect(validateStadiumVisual(visual, { allowUnregistered: true }).ok).toBe(true);
  });

  it('rejects non-finite, out-of-range, malformed and unordered profile values', () => {
    const nonFinite = fixture();
    nonFinite.bowl.halfX = Number.NaN;
    expectIssue(nonFinite, 'bowl.halfX', 'FINITE');

    const plan = fixture();
    plan.bowl.halfX = FIELD_APRON_HALF_WIDTH;
    expectIssue(plan, 'bowl.halfX', 'RANGE');

    const radius = fixture();
    radius.bowl.cornerRadius = radius.bowl.halfX;
    expectIssue(radius, 'bowl.cornerRadius', 'PLAN');

    const degenerate = fixture();
    degenerate.bowl.profile[2].radialRunYd = 0;
    expectIssue(degenerate, 'bowl.profile[2]', 'DEGENERATE');

    const noSeats = fixture();
    noSeats.bowl.profile.forEach((segment) => { if (segment.role === 'seats') segment.role = 'structure'; });
    expectIssue(noSeats, 'bowl.profile', 'SEAT_BAND');

    const outerEarly = fixture();
    outerEarly.bowl.profile[1].role = 'outer';
    expectIssue(outerEarly, 'bowl.profile[1].role', 'ORDER');

    const noReturn = fixture();
    noReturn.bowl.profile.at(-1)!.riseYd += 1;
    expectIssue(noReturn, 'bowl.profile', 'ORDER');
  });

  it('enforces sorted, non-wrapping openings and rejects targets on disabled segments', () => {
    const wrapped = fixture();
    wrapped.bowl.openings = [{ startT: 0.8, endT: 0.2 }];
    expectIssue(wrapped, 'bowl.openings[0]', 'OPENING_RANGE');

    const overlap = fixture();
    overlap.bowl.openings = [{ startT: 0.2, endT: 0.4 }, { startT: 0.3, endT: 0.5 }];
    expectIssue(overlap, 'bowl.openings[1].startT', 'OPENING_OVERLAP');

    const excessive = fixture();
    excessive.bowl.openings = [{ startT: 0, endT: 0.75 }];
    expectIssue(excessive, 'bowl.openings', 'OPENING_TOTAL');

    const targeted = fixture();
    targeted.bowl.openings = [{ startT: 0, endT: 0.01 }];
    expectIssue(targeted, 'lightTowers[0].perimeterT', 'OPENING_TARGET');
  });

  it('keeps registered StadiumDef roof presence/category authoritative', () => {
    for (const id of ['the-saltpan', 'kiln-row', 'turbine-hall']) {
      const missing = fixture(id) as unknown as Record<string, unknown>;
      delete missing.roof;
      expectIssue(missing, 'roof', 'REQUIRED');
    }

    const wrongMapping = fixture();
    wrongMapping.roof = { style: 'canopy', coverage: 0.5, heightYd: 25, radialOverhangYd: 1 };
    expectIssue(wrongMapping, 'roof.style', 'ROOF_COMPATIBILITY');
    expectIssue(wrongMapping, 'roof.style', 'ROOF_COMPATIBILITY', true);

    const dome = fixture('turbine-hall');
    dome.roof!.coverage = 0.9;
    expectIssue(dome, 'roof.coverage', 'ROOF_COVERAGE');
  });

  it('checks the actual lowest native canopy and dome surface at the exact boundary', () => {
    for (const id of ['kiln-row', 'turbine-hall']) {
      const visual = fixture(id);
      visual.roof!.heightYd = ROOF_MIN_CLEARANCE_Y;
      expect(nativeRoofElevations(visual.roof!)?.lowestY).toBe(ROOF_MIN_CLEARANCE_Y);
      expectIssue(visual, 'roof.heightYd', 'PROTECTED_CLEARANCE');

      visual.roof!.heightYd = ROOF_MIN_CLEARANCE_Y + 0.001;
      const elevations = nativeRoofElevations(visual.roof!);
      expect(elevations?.lowestY).toBe(ROOF_MIN_CLEARANCE_Y + 0.001);
      expect(elevations!.innerTopY).toBeGreaterThan(elevations!.lowestY);
      expect(elevations!.outerTopY).toBeGreaterThan(elevations!.innerTopY);
      if (visual.roof!.style === 'dome') expect(elevations!.panelY).toBeGreaterThan(elevations!.outerTopY);
      else expect(elevations!.panelY).toBeNull();
      expect(validateStadiumVisual(visual).ok).toBe(true);
    }
  });

  it('validates feature enums, finite ranges and nested unknown fields', () => {
    const visual = fixture();
    visual.banners = [{
      perimeterT: 0, widthYd: 2, heightYd: 1, elevationYd: 20,
      colorRole: 'accent', minQuality: 'LOW',
    }];
    (visual.banners[0] as unknown as Record<string, unknown>).externalAsset = 'banner.png';
    expectIssue(visual, 'banners[0].externalAsset', 'UNKNOWN_FIELD');
    delete (visual.banners[0] as unknown as Record<string, unknown>).externalAsset;
    (visual.banners[0] as unknown as { minQuality: string }).minQuality = 'ULTRA';
    expectIssue(visual, 'banners[0].minQuality', 'ENUM');
  });

  it('treats contact with every protected boundary as a violation', () => {
    expect(FIELD_APRON_MIN_Z).toBe(-26);
    expect(FIELD_APRON_MAX_Z).toBe(126);
    expect(CAMERA_LANE_MIN_Z).toBe(-32);
    expect(CAMERA_LANE_MAX_Z).toBe(132);

    const atSide = fixture();
    atSide.skyline = [{
      kind: 'block', position: { x: FIELD_APRON_HALF_WIDTH + 1, y: 0, z: 50 },
      size: { x: 2, y: 4, z: 2 }, colorRole: 'structure', minQuality: 'LOW',
    }];
    expectIssue(atSide, 'skyline[0]', 'PROTECTED_VOLUME');

    const inside = clone(atSide);
    inside.skyline![0].position.x -= 0.1;
    expectIssue(inside, 'skyline[0]', 'PROTECTED_VOLUME');

    const beyond = clone(atSide);
    beyond.skyline![0].position.x += 0.001;
    expect(validateStadiumVisual(beyond).ok).toBe(true);

    const atCeiling = clone(atSide);
    atCeiling.skyline![0].position.x = 0;
    atCeiling.skyline![0].position.y = FIELD_LOW_CLEARANCE_Y;
    expectIssue(atCeiling, 'skyline[0]', 'PROTECTED_VOLUME');
    atCeiling.skyline![0].position.y += 0.001;
    expect(validateStadiumVisual(atCeiling).ok).toBe(true);
  });

  it('throws a structured validation error from parse', () => {
    const visual = fixture() as unknown as Record<string, unknown>;
    delete visual.units;
    expect(() => parseStadiumVisual(visual)).toThrow(StadiumVisualValidationError);
    try {
      parseStadiumVisual(visual);
    } catch (error) {
      expect((error as StadiumVisualValidationError).errors).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: 'units', code: 'REQUIRED' }),
      ]));
    }
  });
});

describe('canonical stadium visual representation', () => {
  it('sorts object keys, preserves semantic arrays and omits only authoring.exportedAt', () => {
    const visual = fixture();
    visual.authoring = { author: 'Pascal', notes: 'stable', exportedAt: '2026-08-09T01:00:00Z' };
    const reordered = JSON.parse(JSON.stringify(visual)) as MfdStadiumVisualV1;
    reordered.authoring!.exportedAt = '2030-01-01T00:00:00Z';
    const reverseKeys = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(reverseKeys);
      if (!value || typeof value !== 'object') return value;
      return Object.fromEntries(Object.entries(value as Record<string, unknown>)
        .reverse().map(([key, item]) => [key, reverseKeys(item)]));
    };
    const reversed = reverseKeys(reordered) as MfdStadiumVisualV1;
    expect(canonicalStadiumVisualJson(reversed)).toBe(canonicalStadiumVisualJson(visual));
    expect(stableStadiumVisualHash(reversed)).toBe(stableStadiumVisualHash(visual));
    expect(canonicalStadiumVisualJson(visual)).not.toContain('exportedAt');

    reversed.bowl.profile[4].riseYd += 0.001;
    expect(stableStadiumVisualHash(reversed)).not.toBe(stableStadiumVisualHash(visual));
  });

  it('normalizes negative zero deterministically', () => {
    const visual = fixture();
    visual.roof!.coverage = -0;
    expect(canonicalStadiumVisualJson(visual)).not.toContain('-0');
  });
});

describe('legacy adapter and pure quality compiler', () => {
  it('reproduces tier profiles, roof mapping, tunnels, scoreboards and towers', () => {
    const metrics = {
      1: { topR: 22.4, topY: 19.7 },
      2: { topR: 38.9, topY: 39.8 },
      3: { topR: 48.4, topY: 50.3 },
    } as const;
    for (const stadium of STADIUMS) {
      const visual = fixture(stadium.id);
      const expected = metrics[stadium.tier];
      expect(legacyProfileMetrics(stadium.tier).topR).toBeCloseTo(expected.topR, 10);
      expect(legacyProfileMetrics(stadium.tier).topY).toBeCloseTo(expected.topY, 10);
      const compiled = compileStadiumVisual(visual, 'HIGH');
      expect(compiled.topR).toBeCloseTo(expected.topR, 10);
      expect(compiled.topY).toBeCloseTo(expected.topY, 10);
      expect(compiled.tunnels).toHaveLength(4);
      expect(compiled.scoreboards).toHaveLength(2);
      expect(compiled.scoreboards[0].widthYd).toBe(stadium.tier === 1 ? 24 : stadium.tier === 2 ? 30 : 36);
      expect(compiled.lightTowers).toHaveLength(LEGACY_TIER[stadium.tier].towers);
      expect(compiled.lightTowers[0].heightYd).toBe(13 + stadium.tier * 2.5);
      expect(compiled.lightTowers[0].outwardOffsetYd).toBeCloseTo(expected.topR - 1, 10);
      expect(visual.roof!.style).toBe(stadium.roof === 0 ? 'none' : stadium.roof === 1 ? 'canopy' : 'dome');
      if (stadium.roof !== 0) {
        expect(visual.roof!.heightYd).toBeCloseTo(Math.max(
          expected.topY + LEGACY_ROOF_UNDERSIDE_RISE_Y,
          ROOF_MIN_CLEARANCE_Y + 0.01,
        ), 10);
      }
    }
  });

  it('uses exact quality loop counts and opening center-sample masks', () => {
    const visual = fixture();
    visual.tunnels = [];
    visual.scoreboards = [];
    visual.lightTowers = [];
    visual.bowl.openings = [{ startT: 0.25, endT: 0.375 }];
    const expectedActive: Record<QualityTier, number> = { LOW: 56, MEDIUM: 84, HIGH: 112 };
    for (const quality of ['LOW', 'MEDIUM', 'HIGH'] as const) {
      const compiled = compileStadiumVisual(visual, quality);
      expect(compiled.segments).toBe(STADIUM_LOOP_SEGMENTS[quality]);
      expect(compiled.activeSegmentMask).toHaveLength(compiled.segments);
      expect(compiled.activeSegmentCount).toBe(expectedActive[quality]);
      expect(compiled.activeFraction).toBe(expectedActive[quality] / compiled.segments);
    }
  });

  it('filters optional features monotonically without changing the asset hash', () => {
    const visual = fixture();
    visual.banners = (['LOW', 'MEDIUM', 'HIGH'] as const).map((minQuality, i) => ({
      perimeterT: 0.1 + i * 0.1, widthYd: 2, heightYd: 1, elevationYd: 20,
      colorRole: 'accent' as const, minQuality,
    }));
    visual.skyline = (['LOW', 'MEDIUM', 'HIGH'] as const).map((minQuality, i) => ({
      kind: 'block' as const, position: { x: 100 + i * 5, y: 0, z: 50 },
      size: { x: 2, y: 4, z: 2 }, colorRole: 'structure' as const, minQuality,
    }));
    const compiled = (['LOW', 'MEDIUM', 'HIGH'] as const).map((quality) => compileStadiumVisual(visual, quality));
    expect(compiled.map((item) => item.banners.length)).toEqual([1, 2, 3]);
    expect(compiled.map((item) => item.skyline.length)).toEqual([1, 2, 3]);
    expect(new Set(compiled.map((item) => item.hash)).size).toBe(1);
    expect(compiled[2].profile.every((segment) => segment.source.role === segment.role)).toBe(true);
  });

  it('counts every native material batch even without an accent profile', () => {
    const visual = fixture();
    visual.bowl.profile.forEach((segment) => {
      if (segment.role === 'accent') segment.role = 'structure';
    });
    visual.tunnels = [];
    visual.scoreboards = [];
    visual.lightTowers = [];
    visual.banners = [];
    visual.skyline = [];
    const base = compileStadiumVisual(visual, 'LOW').estimate.materialBatches;

    visual.tunnels = [{ perimeterT: 0.2, widthYd: 5, heightYd: 4 }];
    expect(compileStadiumVisual(visual, 'LOW').estimate.materialBatches).toBe(base + 1);
    visual.tunnels = [];
    visual.skyline = [{
      kind: 'spire', position: { x: 100, y: 0, z: 50 }, size: { x: 8, y: 20, z: 8 },
      colorRole: 'structure', minQuality: 'LOW',
    }];
    expect(compileStadiumVisual(visual, 'LOW').estimate.materialBatches).toBe(base + 1);
  });

  it('uses the exact native canopy predicate for arbitrary bowl plans and opening masks', () => {
    const visual = fixture('kiln-row');
    visual.bowl.halfX = 50;
    visual.bowl.halfZ = 150;
    visual.bowl.cornerRadius = 8;
    visual.bowl.openings = [{ startT: 0.2, endT: 0.3 }];
    visual.tunnels = [];
    visual.scoreboards = [];
    visual.lightTowers = [];
    const canopy = compileStadiumVisual(visual, 'LOW');
    const covered = nativeRoofCoveredSegmentCount(
      visual.bowl, 'canopy', canopy.segments, canopy.activeSegmentMask,
    );
    expect(covered).not.toBe(Math.round(canopy.activeSegmentCount * 0.55));

    const open = clone(visual);
    open.stadiumId = 'pascal-preview-only';
    open.roof = { style: 'none', coverage: 0, heightYd: 0, radialOverhangYd: 0 };
    const withoutRoof = compileStadiumVisual(open, 'LOW', { allowUnregistered: true });
    expect(canopy.estimate.triangles - withoutRoof.estimate.triangles).toBe(covered * 6);
  });
});

describe('stadium complexity receipts', () => {
  it('uses measured native fallback draw/resource counts and exact tier-3 triangles', () => {
    expect(CHAMFER_BOX_TRIANGLES).toBe(12 + 24 + 8);
    const expectedByQuality: Record<QualityTier, number> = {
      LOW: 64 * 15 * 2 + 4 * 2 * 44 + 8 * 19 * 44 + 2 * (2 + 4 * 44),
      MEDIUM: 96 * 15 * 2 + 4 * 2 * 44 + 8 * 19 * 44 + 2 * (2 + 4 * 44),
      HIGH: 128 * 15 * 2 + 4 * 2 * 44 + 8 * 19 * 44 + 2 * (2 + 4 * 44),
    };
    for (const quality of ['LOW', 'MEDIUM', 'HIGH'] as const) {
      const receipt = stadiumVisualBudgetReceipt(fixture(), quality);
      expect(receipt.legacyTier3.triangles).toBe(expectedByQuality[quality]);
      expect(receipt.legacyTier3).toEqual(legacyTier3NativeEstimate(quality));
      expect(receipt.legacyTier3.drawCalls).toBe(8);
      expect(receipt.legacyTier3.materialBatches).toBe(7);
      expect(receipt.legacyTier3.staticGeometries).toBe(7);
      expect(receipt.legacyTier3.staticMaterials).toBe(7);
      expect(receipt.legacyTier3.staticTextures).toBe(4);
      expect(receipt.passed).toBe(true);
      expect(receipt.authored.triangles).toBeLessThanOrEqual(
        Math.floor(receipt.legacyTier3.triangles * STADIUM_BUDGET_TRIANGLE_RATIO),
      );
      expect(receipt.addedMaterialBatches).toBeLessThanOrEqual(STADIUM_BUDGET_ADDED_BATCHES);
      expect(assertStadiumVisualBudget(receipt)).toBe(receipt);
    }
  });

  it('fails closed with a structured receipt when authored geometry exceeds the guard', () => {
    const visual = fixture();
    visual.skyline = Array.from({ length: 48 }, (_, i) => ({
      kind: 'tank' as const,
      position: { x: i % 2 ? 100 : -100, y: 0, z: 30 + i * 2 },
      size: { x: 10, y: 20, z: 10 },
      colorRole: 'structure' as const,
      minQuality: 'LOW' as const,
    }));
    expect(validateStadiumVisual(visual).ok).toBe(true);
    const receipt = stadiumVisualBudgetReceipt(visual, 'HIGH');
    expect(receipt.passed).toBe(false);
    expect(receipt.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'triangles' }),
    ]));
    expect(() => assertStadiumVisualBudget(receipt)).toThrow(StadiumVisualBudgetError);
  });
});
