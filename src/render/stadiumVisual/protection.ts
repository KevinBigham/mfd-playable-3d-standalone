import { ENDZONE_DEPTH, FIELD_HALF_WIDTH, FIELD_LENGTH } from '../../core/constants.ts';
import type {
  MfdStadiumVisualV1, RoofStyle, StadiumBowlPlan, StadiumRoof, StadiumVisualValidationIssue,
} from './types.ts';

/** Field apron used by the native field renderer, expressed from authoritative field constants. */
export const FIELD_APRON_HALF_WIDTH = FIELD_HALF_WIDTH + 10.335; // 37 yd
export const FIELD_APRON_END_CLEARANCE = 16;
export const FIELD_LOW_CLEARANCE_Y = 16;
export const FIELD_APRON_MIN_Z = -ENDZONE_DEPTH - FIELD_APRON_END_CLEARANCE;
export const FIELD_APRON_MAX_Z = FIELD_LENGTH + ENDZONE_DEPTH + FIELD_APRON_END_CLEARANCE;

/** Central end-camera lanes extend six yards beyond the broad field apron. */
export const CAMERA_LANE_HALF_WIDTH = 18;
export const CAMERA_LANE_EXTRA_END_CLEARANCE = 6;
export const CAMERA_LANE_MIN_Z = FIELD_APRON_MIN_Z - CAMERA_LANE_EXTRA_END_CLEARANCE;
export const CAMERA_LANE_MAX_Z = FIELD_APRON_MAX_Z + CAMERA_LANE_EXTRA_END_CLEARANCE;

/** A roof touching this plane is invalid; it must clear it. */
export const ROOF_MIN_CLEARANCE_Y = 24;
/** Thickness of the native perimeter roof shell. */
export const NATIVE_ROOF_THICKNESS_Y = 0.65;
/** Rise from the inner roof edge to the outer roof edge. */
export const NATIVE_ROOF_SLOPE_RISE_Y = 2.9;
/** Rise from the dome perimeter's outer edge to its centre panel. */
export const NATIVE_DOME_PANEL_RISE_Y = 1.2;
/** Canopies cover the sideline-facing samples selected by this native silhouette threshold. */
export const NATIVE_CANOPY_NORMAL_X_THRESHOLD = 0.55;

export interface NativeRoofElevations {
  /** The protected clearance plane and actual lowest vertex of the roof shell. */
  lowestY: number;
  innerTopY: number;
  outerTopY: number;
  /** Dome centre panel elevation; null for a canopy or open roof. */
  panelY: number | null;
}

/**
 * Convert the semantic underside clearance into the exact elevations used by the native builder.
 * Every generated perimeter, panel and truss vertex is at or above `lowestY`.
 */
export function nativeRoofElevations(roof: StadiumRoof): NativeRoofElevations | null {
  if (roof.style === 'none') return null;
  const lowestY = roof.heightYd;
  const innerTopY = lowestY + NATIVE_ROOF_THICKNESS_Y;
  const outerTopY = innerTopY + NATIVE_ROOF_SLOPE_RISE_Y;
  return {
    lowestY,
    innerTopY,
    outerTopY,
    panelY: roof.style === 'dome' ? outerTopY + NATIVE_DOME_PANEL_RISE_Y : null,
  };
}

export interface ProtectedFieldVolume {
  name: 'field-apron' | 'home-camera-lane' | 'away-camera-lane';
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  minY: number;
  maxY: number;
}

export const PROTECTED_FIELD_VOLUMES: readonly ProtectedFieldVolume[] = [
  {
    name: 'field-apron',
    minX: -FIELD_APRON_HALF_WIDTH,
    maxX: FIELD_APRON_HALF_WIDTH,
    minZ: FIELD_APRON_MIN_Z,
    maxZ: FIELD_APRON_MAX_Z,
    minY: 0,
    maxY: FIELD_LOW_CLEARANCE_Y,
  },
  {
    name: 'home-camera-lane',
    minX: -CAMERA_LANE_HALF_WIDTH,
    maxX: CAMERA_LANE_HALF_WIDTH,
    minZ: CAMERA_LANE_MIN_Z,
    maxZ: FIELD_APRON_MIN_Z,
    minY: 0,
    maxY: FIELD_LOW_CLEARANCE_Y,
  },
  {
    name: 'away-camera-lane',
    minX: -CAMERA_LANE_HALF_WIDTH,
    maxX: CAMERA_LANE_HALF_WIDTH,
    minZ: FIELD_APRON_MAX_Z,
    maxZ: CAMERA_LANE_MAX_Z,
    minY: 0,
    maxY: FIELD_LOW_CLEARANCE_Y,
  },
] as const;

export interface PerimeterPoint {
  x: number;
  z: number;
  nx: number;
  nz: number;
  tx: number;
  tz: number;
}

/**
 * Native rounded-rectangle arc-length parameterization without importing renderer geometry.
 * t=0 starts on the +X side at the home-end corner exit and walks counter-clockwise.
 */
export function stadiumPerimeterPoint(plan: StadiumBowlPlan, perimeterT: number): PerimeterPoint {
  const r = plan.cornerRadius;
  const sx = plan.halfX - r;
  const sz = plan.halfZ - r;
  const straightX = 2 * sx;
  const straightZ = 2 * sz;
  const arc = (Math.PI / 2) * r;
  const perimeter = 2 * straightX + 2 * straightZ + 4 * arc;
  let d = Math.min(1, Math.max(0, perimeterT)) * perimeter;
  let x = 0; let z = 0; let nx = 0; let nz = 0;

  if (d < straightZ) {
    x = plan.halfX; z = -sz + d; nx = 1;
  } else if ((d -= straightZ) < arc) {
    const a = d / r;
    x = sx + Math.cos(a) * r; z = sz + Math.sin(a) * r;
    nx = Math.cos(a); nz = Math.sin(a);
  } else if ((d -= arc) < straightX) {
    x = sx - d; z = plan.halfZ; nz = 1;
  } else if ((d -= straightX) < arc) {
    const a = d / r + Math.PI / 2;
    x = -sx + Math.cos(a) * r; z = sz + Math.sin(a) * r;
    nx = Math.cos(a); nz = Math.sin(a);
  } else if ((d -= arc) < straightZ) {
    x = -plan.halfX; z = sz - d; nx = -1;
  } else if ((d -= straightZ) < arc) {
    const a = d / r + Math.PI;
    x = -sx + Math.cos(a) * r; z = -sz + Math.sin(a) * r;
    nx = Math.cos(a); nz = Math.sin(a);
  } else if ((d -= arc) < straightX) {
    x = -sx + d; z = -plan.halfZ; nz = -1;
  } else {
    const a = (d - straightX) / r + Math.PI * 1.5;
    x = sx + Math.cos(a) * r; z = -sz + Math.sin(a) * r;
    nx = Math.cos(a); nz = Math.sin(a);
  }
  return { x, z: z + plan.centerZ, nx, nz, tx: -nz, tz: nx };
}

/** Shared native canopy decision used by both geometry generation and budget accounting. */
export function nativeRoofSegmentCovered(
  plan: StadiumBowlPlan,
  style: RoofStyle,
  segmentIndex: number,
  segments: number,
): boolean {
  if (style === 'none') return false;
  if (style === 'dome') return true;
  const p = stadiumPerimeterPoint(plan, segmentIndex / segments);
  return Math.abs(p.nx) > NATIVE_CANOPY_NORMAL_X_THRESHOLD;
}

/** Exact number of roof segments emitted by the native builder for this plan and opening mask. */
export function nativeRoofCoveredSegmentCount(
  plan: StadiumBowlPlan,
  style: RoofStyle,
  segments: number,
  activeSegments?: ArrayLike<boolean | number>,
): number {
  let covered = 0;
  for (let i = 0; i < segments; i++) {
    if (activeSegments && !activeSegments[i]) continue;
    if (nativeRoofSegmentCovered(plan, style, i, segments)) covered++;
  }
  return covered;
}

/** Strict containment: a point touching the plan boundary is not protected. */
function roundedPlanStrictlyContains(plan: StadiumBowlPlan, x: number, z: number): boolean {
  const localZ = z - plan.centerZ;
  const innerX = plan.halfX - plan.cornerRadius;
  const innerZ = plan.halfZ - plan.cornerRadius;
  const dx = Math.max(Math.abs(x) - innerX, 0);
  const dz = Math.max(Math.abs(localZ) - innerZ, 0);
  return dx * dx + dz * dz < plan.cornerRadius * plan.cornerRadius - 1e-9;
}

function boxOverlapsVolume(
  box: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number },
  volume: ProtectedFieldVolume,
): boolean {
  // Inclusive comparisons are intentional: touching any protected boundary is a violation.
  return box.maxX >= volume.minX && box.minX <= volume.maxX
    && box.maxZ >= volume.minZ && box.minZ <= volume.maxZ
    && box.maxY >= volume.minY && box.minY <= volume.maxY;
}

function perimeterBox(
  plan: StadiumBowlPlan,
  perimeterT: number,
  outwardOffset: number,
  width: number,
  depth: number,
  minY: number,
  maxY: number,
): { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number } {
  const p = stadiumPerimeterPoint(plan, perimeterT);
  const cx = p.x + p.nx * outwardOffset;
  const cz = p.z + p.nz * outwardOffset;
  const halfX = Math.abs(p.tx) * width * 0.5 + Math.abs(p.nx) * depth * 0.5;
  const halfZ = Math.abs(p.tz) * width * 0.5 + Math.abs(p.nz) * depth * 0.5;
  return { minX: cx - halfX, maxX: cx + halfX, minY, maxY, minZ: cz - halfZ, maxZ: cz + halfZ };
}

function pushOverlap(
  issues: StadiumVisualValidationIssue[],
  path: string,
  box: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number },
): void {
  for (const volume of PROTECTED_FIELD_VOLUMES) {
    if (boxOverlapsVolume(box, volume)) {
      issues.push({
        path,
        code: 'PROTECTED_VOLUME',
        message: `${path} touches protected ${volume.name}`,
      });
      return;
    }
  }
}

function profileTopY(visual: MfdStadiumVisualV1): number {
  const first = visual.bowl.profile[0];
  let y = -first.riseYd;
  let top = y;
  for (const segment of visual.bowl.profile) {
    y += segment.riseYd;
    top = Math.max(top, y);
  }
  return top;
}

/** Presentation-only protected-volume checker shared by validation and studio previews. */
export function checkProtectedField(visual: MfdStadiumVisualV1): StadiumVisualValidationIssue[] {
  const issues: StadiumVisualValidationIssue[] = [];
  const plan = visual.bowl;

  for (const volume of PROTECTED_FIELD_VOLUMES) {
    const corners = [
      [volume.minX, volume.minZ], [volume.minX, volume.maxZ],
      [volume.maxX, volume.minZ], [volume.maxX, volume.maxZ],
    ];
    if (corners.some(([x, z]) => !roundedPlanStrictlyContains(plan, x, z))) {
      issues.push({
        path: 'bowl',
        code: 'PROTECTED_VOLUME',
        message: `bowl touches or enters protected ${volume.name}`,
      });
    }
  }

  const roofElevations = visual.roof ? nativeRoofElevations(visual.roof) : null;
  if (roofElevations && roofElevations.lowestY <= ROOF_MIN_CLEARANCE_Y) {
    issues.push({
      path: 'roof.heightYd',
      code: 'PROTECTED_CLEARANCE',
      message: `roof underside must be greater than ${ROOF_MIN_CLEARANCE_Y} yards above field grade`,
    });
  }

  for (let i = 0; i < (visual.tunnels?.length ?? 0); i++) {
    const item = visual.tunnels![i];
    pushOverlap(issues, `tunnels[${i}]`, perimeterBox(plan, item.perimeterT, 0, item.widthYd, 2, 0, item.heightYd));
  }
  for (let i = 0; i < (visual.scoreboards?.length ?? 0); i++) {
    const item = visual.scoreboards![i];
    pushOverlap(issues, `scoreboards[${i}]`, perimeterBox(
      plan, item.perimeterT, item.outwardOffsetYd, item.widthYd, 2,
      item.elevationYd, item.elevationYd + item.heightYd,
    ));
  }
  const towerBaseY = profileTopY(visual);
  for (let i = 0; i < (visual.lightTowers?.length ?? 0); i++) {
    const item = visual.lightTowers![i];
    pushOverlap(issues, `lightTowers[${i}]`, perimeterBox(
      plan, item.perimeterT, item.outwardOffsetYd, 3.5, 3.5, towerBaseY, towerBaseY + item.heightYd,
    ));
  }
  for (let i = 0; i < (visual.banners?.length ?? 0); i++) {
    const item = visual.banners![i];
    pushOverlap(issues, `banners[${i}]`, perimeterBox(
      plan, item.perimeterT, 0, item.widthYd, 0.5,
      item.elevationYd, item.elevationYd + item.heightYd,
    ));
  }
  for (let i = 0; i < (visual.skyline?.length ?? 0); i++) {
    const item = visual.skyline![i];
    pushOverlap(issues, `skyline[${i}]`, {
      minX: item.position.x - item.size.x * 0.5,
      maxX: item.position.x + item.size.x * 0.5,
      minY: item.position.y,
      maxY: item.position.y + item.size.y,
      minZ: item.position.z - item.size.z * 0.5,
      maxZ: item.position.z + item.size.z * 0.5,
    });
  }

  return issues;
}
