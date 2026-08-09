import { stableStadiumVisualHash } from './canonical.ts';
import { nativeRoofCoveredSegmentCount } from './protection.ts';
import {
  type CompiledProfileSegment, type CompiledSeatBand, type CompiledStadiumVisual,
  type MfdStadiumVisualV1, type QualityTier, type StadiumBudgetReceipt,
  type StadiumBudgetViolation, type StadiumComplexityEstimate,
  type ValidateStadiumVisualOptions,
} from './types.ts';
import { STADIUM_VISUAL_LIMITS, parseStadiumVisual } from './validator.ts';

export const STADIUM_LOOP_SEGMENTS: Readonly<Record<QualityTier, number>> = {
  LOW: 64,
  MEDIUM: 96,
  HIGH: 128,
};

export const STADIUM_BUDGET_TRIANGLE_RATIO = 1.25;
export const STADIUM_BUDGET_ADDED_BATCHES = 8;

const QUALITY_RANK: Readonly<Record<QualityTier, number>> = { LOW: 0, MEDIUM: 1, HIGH: 2 };
const CROWD_DENSITY: Readonly<Record<QualityTier, number>> = { LOW: 0.22, MEDIUM: 0.55, HIGH: 1 };
const SEAT_WIDTH = 0.76;
const ROW_DEPTH = 0.84;
const MAX_CROWD = 24000;
/** Native GeoBatch chamferBox: 12 face + 24 bevel + 8 corner triangles. */
export const CHAMFER_BOX_TRIANGLES = 44;

/**
 * Exact measured object/resource shape of the open tier-3 fallback (`forgeworks-yard`). These
 * counts mirror the native builder itself: four merged bowl batches, two tower instances and two
 * scoreboard planes (eight draw calls), backed by seven unique geometries/materials and four
 * textures. Triangle totals include every rendered tower instance, as WebGLRenderer.info does.
 */
export function legacyTier3NativeEstimate(quality: QualityTier): StadiumComplexityEstimate {
  const segments = STADIUM_LOOP_SEGMENTS[quality];
  const profileTriangles = segments * 15 * 2;
  const tunnelTriangles = 4 * 2 * CHAMFER_BOX_TRIANGLES;
  const towerTriangles = 8 * 19 * CHAMFER_BOX_TRIANGLES;
  const scoreboardTriangles = 2 * (2 + 4 * CHAMFER_BOX_TRIANGLES);
  const triangles = profileTriangles + tunnelTriangles + towerTriangles + scoreboardTriangles;
  return {
    quality,
    triangles,
    // GeoBatch data is non-indexed. The two indexed scoreboard planes contribute four vertices
    // each instead of six, so the measured rendered-vertex total is four below 3x triangles.
    vertices: triangles * 3 - 4,
    materialBatches: 7,
    drawCalls: 8,
    semanticElements: 30,
    crowdCapacity: Math.max(900, Math.round(MAX_CROWD * CROWD_DENSITY[quality])),
    staticGeometries: 7,
    staticMaterials: 7,
    staticTextures: 4,
    activeSegments: segments,
    totalSegments: segments,
  };
}

function qualityAllows(minimum: QualityTier, quality: QualityTier): boolean {
  return QUALITY_RANK[quality] >= QUALITY_RANK[minimum];
}

function compileProfile(visual: MfdStadiumVisualV1): {
  profile: CompiledProfileSegment[];
  seatBands: CompiledSeatBand[];
  topR: number;
  topY: number;
} {
  const first = visual.bowl.profile[0];
  let r = -first.radialRunYd;
  let y = -first.riseYd;
  let topR = r;
  let topY = y;
  const profile: CompiledProfileSegment[] = [];
  const seatBands: CompiledSeatBand[] = [];

  for (const source of visual.bowl.profile) {
    const compiled: CompiledProfileSegment = {
      ...source,
      source,
      r0: r,
      y0: y,
      r1: r + source.radialRunYd,
      y1: y + source.riseYd,
    };
    profile.push(compiled);
    if (source.role === 'seats') {
      seatBands.push({ rStart: compiled.r0, rEnd: compiled.r1, yStart: compiled.y0, yEnd: compiled.y1 });
    }
    r = compiled.r1;
    y = compiled.y1;
    if (source.role !== 'outer') {
      topR = Math.max(topR, r);
      topY = Math.max(topY, y);
    }
  }
  return { profile, seatBands, topR, topY };
}

function activeMask(visual: MfdStadiumVisualV1, segments: number): boolean[] {
  const openings = visual.bowl.openings ?? [];
  return Array.from({ length: segments }, (_, i) => {
    const t = (i + 0.5) / segments;
    return !openings.some((opening) => t >= opening.startT && t < opening.endT);
  });
}

function openingBoundaryCount(mask: boolean[]): number {
  let transitions = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i] !== mask[(i + 1) % mask.length]) transitions++;
  return transitions;
}

function roundedPerimeter(visual: MfdStadiumVisualV1): number {
  const b = visual.bowl;
  return 4 * (b.halfX - b.cornerRadius + b.halfZ - b.cornerRadius) + 2 * Math.PI * b.cornerRadius;
}

function semanticElementCount(compiled: {
  visual: MfdStadiumVisualV1;
  tunnels: unknown[];
  scoreboards: unknown[];
  lightTowers: unknown[];
  banners: unknown[];
  skyline: unknown[];
}): number {
  const visual = compiled.visual;
  return 1 + visual.bowl.profile.length + (visual.roof && visual.roof.style !== 'none' ? 1 : 0)
    + (visual.bowl.openings?.length ?? 0) + compiled.tunnels.length + compiled.scoreboards.length
    + compiled.lightTowers.length + compiled.banners.length + compiled.skyline.length;
}

function skylineBoxes(kind: MfdStadiumVisualV1['skyline'] extends Array<infer T> | undefined
  ? T extends { kind: infer K } ? K : never : never): number {
  switch (kind) {
    case 'stack': case 'spire': return 2;
    case 'tank': return 5;
    default: return 1;
  }
}

function estimateComplexity(input: {
  visual: MfdStadiumVisualV1;
  quality: QualityTier;
  segments: number;
  activeSegmentMask: boolean[];
  activeSegmentCount: number;
  activeFraction: number;
  profile: CompiledProfileSegment[];
  seatBands: CompiledSeatBand[];
  tunnels: MfdStadiumVisualV1['tunnels'] extends Array<infer T> | undefined ? T[] : never[];
  scoreboards: MfdStadiumVisualV1['scoreboards'] extends Array<infer T> | undefined ? T[] : never[];
  lightTowers: MfdStadiumVisualV1['lightTowers'] extends Array<infer T> | undefined ? T[] : never[];
  banners: MfdStadiumVisualV1['banners'] extends Array<infer T> | undefined ? T[] : never[];
  skyline: MfdStadiumVisualV1['skyline'] extends Array<infer T> | undefined ? T[] : never[];
}): StadiumComplexityEstimate {
  const profileTriangles = input.activeSegmentCount * input.profile.length * 2;
  const capTriangles = openingBoundaryCount(input.activeSegmentMask) * Math.max(1, input.profile.length - 1);
  const roof = input.visual.roof;
  const coveredSegments = roof
    ? nativeRoofCoveredSegmentCount(input.visual.bowl, roof.style, input.segments, input.activeSegmentMask)
    : 0;
  const roofTriangles = coveredSegments * 6 + (roof?.style === 'dome' ? 2 + 18 * CHAMFER_BOX_TRIANGLES : 0);
  const tunnelTriangles = input.tunnels.length * 2 * CHAMFER_BOX_TRIANGLES;
  const towerTriangles = input.lightTowers.length * 19 * CHAMFER_BOX_TRIANGLES;
  const scoreboardTriangles = input.scoreboards.length * (2 + 4 * CHAMFER_BOX_TRIANGLES);
  const bannerTriangles = input.banners.length * CHAMFER_BOX_TRIANGLES;
  const skylineTriangles = input.skyline.reduce((sum, prop) => sum + skylineBoxes(prop.kind) * CHAMFER_BOX_TRIANGLES, 0);
  const triangles = profileTriangles + capTriangles + roofTriangles + tunnelTriangles
    + towerTriangles + scoreboardTriangles + bannerTriangles + skylineTriangles;
  // All native GeoBatch primitives are non-indexed. Scoreboard and dome planes are indexed quads
  // (four vertices for two triangles), including each scoreboard instance in the rendered total.
  const indexedQuadSavings = input.scoreboards.length * 2 + (roof?.style === 'dome' ? 2 : 0);

  const roles = new Set(input.profile.map((segment) => segment.role));
  // Structure/dark/ground/outer share one material; optional decoration stays merged by role.
  let materialBatches = roles.has('seats') ? 2 : 1;
  if (roles.has('signage')) materialBatches++;
  const hasTrim = roles.has('accent') || input.banners.length > 0
    || input.tunnels.length > 0 || input.scoreboards.length > 0
    || input.skyline.some((prop) => prop.kind === 'spire');
  if (hasTrim) materialBatches++;
  if (input.lightTowers.length > 0) materialBatches++; // emissive lamp batch
  if (input.scoreboards.length > 0) materialBatches++; // shared instanced live board surface
  if (roof?.style === 'dome') materialBatches++; // translucent centre panel

  const perimeter = roundedPerimeter(input.visual);
  const rows = input.seatBands.reduce((sum, band) =>
    sum + Math.max(1, Math.floor(Math.hypot(band.rEnd - band.rStart, band.yEnd - band.yStart) / ROW_DEPTH)), 0);
  const latticeSlots = rows * Math.max(8, Math.floor(perimeter / SEAT_WIDTH));
  const crowdTarget = Math.max(900, Math.round(MAX_CROWD * CROWD_DENSITY[input.quality]));
  const crowdCapacity = Math.max(1, Math.min(
    Math.round(crowdTarget * input.activeFraction),
    Math.round(latticeSlots * input.activeFraction),
  ));
  const semanticElements = semanticElementCount(input);
  const staticTextures = 1 + (roles.has('seats') ? 1 : 0) + (roles.has('signage') ? 1 : 0)
    + (input.scoreboards.length > 0 ? 1 : 0);
  return {
    quality: input.quality,
    triangles,
    vertices: triangles * 3 - indexedQuadSavings,
    materialBatches,
    drawCalls: materialBatches,
    semanticElements,
    crowdCapacity,
    staticGeometries: materialBatches,
    staticMaterials: materialBatches,
    staticTextures,
    activeSegments: input.activeSegmentCount,
    totalSegments: input.segments,
  };
}

export function compileStadiumVisual(
  input: MfdStadiumVisualV1,
  quality: QualityTier,
  validationOptions: ValidateStadiumVisualOptions = {},
): CompiledStadiumVisual {
  const visual = parseStadiumVisual(input, validationOptions);
  const segments = STADIUM_LOOP_SEGMENTS[quality];
  if (!segments) throw new Error(`Unsupported stadium quality: ${String(quality)}`);
  const activeSegmentMask = activeMask(visual, segments);
  const activeSegmentCount = activeSegmentMask.reduce((sum, active) => sum + (active ? 1 : 0), 0);
  const activeFraction = activeSegmentCount / segments;
  const profile = compileProfile(visual);
  const tunnels = [...(visual.tunnels ?? [])];
  const scoreboards = [...(visual.scoreboards ?? [])];
  const lightTowers = [...(visual.lightTowers ?? [])];
  const banners = (visual.banners ?? []).filter((item) => qualityAllows(item.minQuality, quality));
  const skyline = (visual.skyline ?? []).filter((item) => qualityAllows(item.minQuality, quality));
  const semanticElements = semanticElementCount({ visual, tunnels, scoreboards, lightTowers, banners, skyline });
  const partial = {
    visual, quality, segments, activeSegmentMask, activeSegmentCount, activeFraction,
    profile: profile.profile, seatBands: profile.seatBands,
    tunnels, scoreboards, lightTowers, banners, skyline,
  };
  return {
    ...partial,
    hash: stableStadiumVisualHash(visual),
    topR: profile.topR,
    topY: profile.topY,
    semanticElementCount: semanticElements,
    estimate: estimateComplexity(partial),
  };
}

export function stadiumVisualBudgetReceipt(
  visual: MfdStadiumVisualV1,
  quality: QualityTier,
): StadiumBudgetReceipt {
  const compiled = compileStadiumVisual(visual, quality);
  // Open tier-3 is the conservative native reference: authored roofs earn their own cost instead
  // of inheriting the legacy dome/truss allowance.
  const legacyTier3 = legacyTier3NativeEstimate(quality);
  const triangleLimit = Math.floor(legacyTier3.triangles * STADIUM_BUDGET_TRIANGLE_RATIO);
  const batchLimit = legacyTier3.materialBatches + STADIUM_BUDGET_ADDED_BATCHES;
  const violations: StadiumBudgetViolation[] = [];
  if (compiled.estimate.triangles > triangleLimit) {
    violations.push({
      path: 'triangles', actual: compiled.estimate.triangles, limit: triangleLimit,
      message: `triangles ${compiled.estimate.triangles} exceed 1.25x legacy tier-3 limit ${triangleLimit}`,
    });
  }
  if (compiled.estimate.materialBatches > batchLimit) {
    violations.push({
      path: 'materialBatches', actual: compiled.estimate.materialBatches, limit: batchLimit,
      message: `material batches ${compiled.estimate.materialBatches} exceed legacy tier-3 + 8 limit ${batchLimit}`,
    });
  }
  if (compiled.estimate.semanticElements > STADIUM_VISUAL_LIMITS.semanticElements) {
    violations.push({
      path: 'semanticElements', actual: compiled.estimate.semanticElements,
      limit: STADIUM_VISUAL_LIMITS.semanticElements,
      message: `semantic elements ${compiled.estimate.semanticElements} exceed ${STADIUM_VISUAL_LIMITS.semanticElements}`,
    });
  }
  return {
    stadiumId: visual.stadiumId,
    quality,
    assetHash: compiled.hash,
    authored: compiled.estimate,
    legacyTier3,
    triangleRatio: compiled.estimate.triangles / Math.max(1, legacyTier3.triangles),
    addedMaterialBatches: compiled.estimate.materialBatches - legacyTier3.materialBatches,
    passed: violations.length === 0,
    violations,
  };
}

export class StadiumVisualBudgetError extends Error {
  readonly receipt: StadiumBudgetReceipt;
  constructor(receipt: StadiumBudgetReceipt) {
    super(receipt.violations.map((violation) => violation.message).join('\n'));
    this.name = 'StadiumVisualBudgetError';
    this.receipt = receipt;
  }
}

export function assertStadiumVisualBudget(
  visualOrReceipt: MfdStadiumVisualV1 | StadiumBudgetReceipt,
  quality?: QualityTier,
): StadiumBudgetReceipt {
  const receipt = 'passed' in visualOrReceipt
    ? visualOrReceipt
    : stadiumVisualBudgetReceipt(visualOrReceipt, quality ?? 'HIGH');
  if (!receipt.passed) throw new StadiumVisualBudgetError(receipt);
  return receipt;
}
