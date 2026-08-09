/**
 * Renderer-only semantic stadium contract.
 *
 * This is deliberately plain data. Pascal may author it and the native renderer may compile it,
 * but no editor state, mesh data, executable hook, or external asset reference crosses this
 * boundary.
 */

export const STADIUM_VISUAL_SCHEMA = 'mfd.stadium-visual' as const;
export const STADIUM_VISUAL_VERSION = 1 as const;

export type QualityTier = 'LOW' | 'MEDIUM' | 'HIGH';
export type StadiumVisualRole = 'ground' | 'signage' | 'structure' | 'dark' | 'accent' | 'seats' | 'outer';
export type StadiumColorRole = 'accent' | 'home-primary' | 'home-secondary' | 'neutral';
export type SkylineColorRole = 'structure' | 'dark' | 'accent' | 'neutral';
export type SkylineKind = 'block' | 'stack' | 'spire' | 'tank' | 'rock';
export type RoofStyle = 'none' | 'canopy' | 'dome';

export interface StadiumVisualCoordinateSystem {
  x: 'sideline-to-sideline';
  y: 'up';
  z: 'home-goal-to-away-goal';
}

export interface StadiumProfileSegment {
  role: StadiumVisualRole;
  radialRunYd: number;
  riseYd: number;
}

export interface StadiumBowlOpening {
  /** Normalized perimeter position, inclusive. Openings do not wrap across 1 -> 0. */
  startT: number;
  /** Normalized perimeter position, exclusive. */
  endT: number;
}

export interface StadiumBowlPlan {
  centerZ: number;
  halfX: number;
  halfZ: number;
  cornerRadius: number;
  aisleEvery: number;
  profile: StadiumProfileSegment[];
  openings?: StadiumBowlOpening[];
}

export interface StadiumRoof {
  style: RoofStyle;
  /** Radial share of the distance from the bowl top toward the playing field. */
  coverage: number;
  /** Absolute clearance from field grade to the lowest native roof surface. */
  heightYd: number;
  radialOverhangYd: number;
}

export interface StadiumTunnel {
  perimeterT: number;
  widthYd: number;
  heightYd: number;
}

export interface StadiumScoreboard {
  perimeterT: number;
  widthYd: number;
  heightYd: number;
  /** Bottom elevation above field grade. */
  elevationYd: number;
  /** Direct radial offset outward from the bowl plan loop. */
  outwardOffsetYd: number;
}

export interface StadiumLightTower {
  perimeterT: number;
  /** Lamp-head rise above the bowl top; the native mast begins at compiled topY. */
  heightYd: number;
  /** Direct radial offset outward from the bowl plan loop. */
  outwardOffsetYd: number;
}

export interface StadiumBanner {
  perimeterT: number;
  widthYd: number;
  heightYd: number;
  /** Bottom elevation above field grade. */
  elevationYd: number;
  colorRole: StadiumColorRole;
  minQuality: QualityTier;
}

export interface StadiumSkylineProp {
  kind: SkylineKind;
  /** x/z locate the footprint center; y is the base elevation. */
  position: { x: number; y: number; z: number };
  size: { x: number; y: number; z: number };
  colorRole: SkylineColorRole;
  minQuality: QualityTier;
}

export interface StadiumVisualAuthoring {
  author?: string;
  notes?: string;
  pascalSceneVersion?: string;
  /** Volatile provenance. Canonical serialization and the stable hash deliberately omit it. */
  exportedAt?: string;
}

export interface MfdStadiumVisualV1 {
  schema: typeof STADIUM_VISUAL_SCHEMA;
  version: typeof STADIUM_VISUAL_VERSION;
  stadiumId: string;
  units: 'yards';
  coordinateSystem: StadiumVisualCoordinateSystem;
  bowl: StadiumBowlPlan;
  roof?: StadiumRoof;
  tunnels?: StadiumTunnel[];
  scoreboards?: StadiumScoreboard[];
  lightTowers?: StadiumLightTower[];
  banners?: StadiumBanner[];
  skyline?: StadiumSkylineProp[];
  authoring?: StadiumVisualAuthoring;
}

export interface StadiumVisualValidationIssue {
  path: string;
  code: string;
  message: string;
}

export type StadiumVisualValidationResult =
  | { ok: true; value: MfdStadiumVisualV1; errors: [] }
  | { ok: false; errors: StadiumVisualValidationIssue[] };

export interface ValidateStadiumVisualOptions {
  /** Allows isolated fixtures without weakening production's known-stadium default. */
  allowUnregistered?: boolean;
}

export interface CompiledProfileSegment extends StadiumProfileSegment {
  source: StadiumProfileSegment;
  r0: number;
  y0: number;
  r1: number;
  y1: number;
}

export interface CompiledSeatBand {
  rStart: number;
  rEnd: number;
  yStart: number;
  yEnd: number;
}

export interface StadiumComplexityEstimate {
  quality: QualityTier;
  triangles: number;
  vertices: number;
  /** Unique native material batches/resources. A shared material may participate in two draws. */
  materialBatches: number;
  /** Static stadium draw calls after native merging/instancing. */
  drawCalls: number;
  semanticElements: number;
  crowdCapacity: number;
  staticGeometries: number;
  staticMaterials: number;
  staticTextures: number;
  activeSegments: number;
  totalSegments: number;
}

export interface CompiledStadiumVisual {
  visual: MfdStadiumVisualV1;
  hash: string;
  quality: QualityTier;
  segments: number;
  activeSegmentMask: boolean[];
  activeSegmentCount: number;
  activeFraction: number;
  profile: CompiledProfileSegment[];
  seatBands: CompiledSeatBand[];
  topR: number;
  topY: number;
  tunnels: StadiumTunnel[];
  scoreboards: StadiumScoreboard[];
  lightTowers: StadiumLightTower[];
  banners: StadiumBanner[];
  skyline: StadiumSkylineProp[];
  semanticElementCount: number;
  estimate: StadiumComplexityEstimate;
}

export interface StadiumBudgetViolation {
  path: 'triangles' | 'materialBatches' | 'semanticElements';
  actual: number;
  limit: number;
  message: string;
}

export interface StadiumBudgetReceipt {
  stadiumId: string;
  quality: QualityTier;
  assetHash: string;
  authored: StadiumComplexityEstimate;
  legacyTier3: StadiumComplexityEstimate;
  triangleRatio: number;
  addedMaterialBatches: number;
  passed: boolean;
  violations: StadiumBudgetViolation[];
}
