export {
  STADIUM_VISUAL_SCHEMA,
  STADIUM_VISUAL_VERSION,
} from './types.ts';
export type {
  QualityTier,
  StadiumVisualRole,
  StadiumColorRole,
  SkylineColorRole,
  SkylineKind,
  RoofStyle,
  StadiumVisualCoordinateSystem,
  StadiumProfileSegment,
  StadiumBowlOpening,
  StadiumBowlPlan,
  StadiumRoof,
  StadiumTunnel,
  StadiumScoreboard,
  StadiumLightTower,
  StadiumBanner,
  StadiumSkylineProp,
  StadiumVisualAuthoring,
  MfdStadiumVisualV1,
  StadiumVisualValidationIssue,
  StadiumVisualValidationResult,
  ValidateStadiumVisualOptions,
  CompiledProfileSegment,
  CompiledSeatBand,
  StadiumComplexityEstimate,
  CompiledStadiumVisual,
  StadiumBudgetViolation,
  StadiumBudgetReceipt,
} from './types.ts';

export {
  STADIUM_VISUAL_LIMITS,
  StadiumVisualValidationError,
  validateStadiumVisual,
  parseStadiumVisual,
} from './validator.ts';

export {
  canonicalStadiumVisualJson,
  stableStadiumVisualHash,
} from './canonical.ts';

export {
  FIELD_APRON_HALF_WIDTH,
  FIELD_APRON_END_CLEARANCE,
  FIELD_LOW_CLEARANCE_Y,
  FIELD_APRON_MIN_Z,
  FIELD_APRON_MAX_Z,
  CAMERA_LANE_HALF_WIDTH,
  CAMERA_LANE_EXTRA_END_CLEARANCE,
  CAMERA_LANE_MIN_Z,
  CAMERA_LANE_MAX_Z,
  ROOF_MIN_CLEARANCE_Y,
  NATIVE_ROOF_THICKNESS_Y,
  NATIVE_ROOF_SLOPE_RISE_Y,
  NATIVE_DOME_PANEL_RISE_Y,
  NATIVE_CANOPY_NORMAL_X_THRESHOLD,
  PROTECTED_FIELD_VOLUMES,
  stadiumPerimeterPoint,
  nativeRoofElevations,
  nativeRoofSegmentCovered,
  nativeRoofCoveredSegmentCount,
  checkProtectedField,
} from './protection.ts';
export type { ProtectedFieldVolume, PerimeterPoint, NativeRoofElevations } from './protection.ts';

export {
  LEGACY_BOWL_HALF_X,
  LEGACY_BOWL_HALF_Z,
  LEGACY_BOWL_RADIUS,
  LEGACY_BOWL_CENTER_Z,
  LEGACY_AISLE_EVERY,
  LEGACY_ROOF_UNDERSIDE_RISE_Y,
  LEGACY_TIER,
  legacyVisualFromStadiumDef,
  legacyProfileMetrics,
} from './legacy.ts';

export {
  STADIUM_LOOP_SEGMENTS,
  STADIUM_BUDGET_TRIANGLE_RATIO,
  STADIUM_BUDGET_ADDED_BATCHES,
  CHAMFER_BOX_TRIANGLES,
  legacyTier3NativeEstimate,
  StadiumVisualBudgetError,
  compileStadiumVisual,
  stadiumVisualBudgetReceipt,
  assertStadiumVisualBudget,
} from './compiler.ts';
