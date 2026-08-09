import { stadiumPerimeterPoint, type RoundedBowlPlan } from './perimeter'

export interface PreviewProfileSource {
  id: string
  order: number
  role: 'ground' | 'signage' | 'structure' | 'dark' | 'accent' | 'seats' | 'outer'
  radialRunYd: number
  riseYd: number
}

export interface CompiledPreviewProfileSegment extends PreviewProfileSource {
  r0: number
  y0: number
  r1: number
  y1: number
}

/** Browser-safe mirror of the native compiler profile origin and segment accumulation. */
export function compilePreviewProfile(input: readonly PreviewProfileSource[]): {
  profile: CompiledPreviewProfileSegment[]
  topR: number
  topY: number
} {
  const sources = [...input].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  const first = sources[0]
  if (!first) return { profile: [], topR: 0, topY: 0 }
  let r = -first.radialRunYd
  let y = -first.riseYd
  let topR = r
  let topY = y
  const profile: CompiledPreviewProfileSegment[] = []
  for (const source of sources) {
    const segment = {
      ...source,
      r0: r,
      y0: y,
      r1: r + source.radialRunYd,
      y1: y + source.riseYd,
    }
    profile.push(segment)
    r = segment.r1
    y = segment.y1
    if (source.role !== 'outer') {
      topR = Math.max(topR, r)
      topY = Math.max(topY, y)
    }
  }
  return { profile, topR, topY }
}

export function perimeterPreviewTransform(plan: RoundedBowlPlan, perimeterT: number, radialYd: number) {
  const point = stadiumPerimeterPoint(plan, perimeterT)
  return {
    xYd: point.x + point.nx * radialYd,
    zYd: point.z + point.nz * radialYd,
    // Same inward-facing yaw used by the native authored stadium builder.
    yaw: Math.atan2(-point.nx, -point.nz),
  }
}

export function verticalCenterYd(bottomYd: number, heightYd: number): number {
  return bottomYd + heightYd * 0.5
}

// Browser-safe mirror of the finalized native roof constants. The studio source is copied into
// a detached Pascal checkout, so it cannot import the MFD repository at runtime. Native parity
// tests compare every value and decision below to the root pure helpers.
export const PREVIEW_ROOF_THICKNESS_Y = 0.65
export const PREVIEW_ROOF_SLOPE_RISE_Y = 2.9
export const PREVIEW_DOME_PANEL_RISE_Y = 1.2
export const PREVIEW_CANOPY_NORMAL_X_THRESHOLD = 0.55

export interface PreviewRoofInput {
  style: 'none' | 'canopy' | 'dome'
  coverage: number
  heightYd: number
  radialOverhangYd: number
}

export interface PreviewRoofElevations {
  lowestY: number
  innerTopY: number
  outerTopY: number
  panelY: number | null
}

export interface PreviewRoofOpening {
  startT: number
  endT: number
}

export type PreviewPoint3 = readonly [number, number, number]

export interface PreviewRoofSegment {
  index: number
  top: readonly [PreviewPoint3, PreviewPoint3, PreviewPoint3, PreviewPoint3]
  underside: readonly [PreviewPoint3, PreviewPoint3, PreviewPoint3, PreviewPoint3]
}

export interface PreviewRoofTransform {
  elevations: PreviewRoofElevations
  innerR: number
  outerR: number
  segments: PreviewRoofSegment[]
  panel: null | {
    center: PreviewPoint3
    size: readonly [number, number]
  }
}

export function previewRoofElevations(roof: PreviewRoofInput): PreviewRoofElevations | null {
  if (roof.style === 'none') return null
  const lowestY = roof.heightYd
  const innerTopY = lowestY + PREVIEW_ROOF_THICKNESS_Y
  const outerTopY = innerTopY + PREVIEW_ROOF_SLOPE_RISE_Y
  return {
    lowestY,
    innerTopY,
    outerTopY,
    panelY: roof.style === 'dome' ? outerTopY + PREVIEW_DOME_PANEL_RISE_Y : null,
  }
}

export function previewRoofSegmentCovered(
  plan: RoundedBowlPlan,
  style: PreviewRoofInput['style'],
  segmentIndex: number,
  segments: number,
): boolean {
  if (style === 'none') return false
  if (style === 'dome') return true
  return Math.abs(stadiumPerimeterPoint(plan, segmentIndex / segments).nx) > PREVIEW_CANOPY_NORMAL_X_THRESHOLD
}

/**
 * Exact semantic roof shell transform used by the preview.
 *
 * Coverage is radial depth from the compiled bowl top, never longitudinal length. Canopies emit
 * only native sideline-selected samples; domes emit the whole active perimeter plus the centre
 * panel. Every returned vertex is at or above `heightYd`, the contract's lowest roof surface.
 */
export function previewRoofTransform(
  plan: RoundedBowlPlan,
  roof: PreviewRoofInput,
  compiledTopR: number,
  openings: readonly PreviewRoofOpening[] = [],
  segmentCount = 128,
): PreviewRoofTransform | null {
  const elevations = previewRoofElevations(roof)
  if (!elevations || roof.coverage <= 0) return null
  const segments = Math.max(16, Math.trunc(segmentCount))
  const innerR = compiledTopR - Math.max(1, compiledTopR * Math.min(1, roof.coverage))
  const outerR = compiledTopR + roof.radialOverhangYd
  const shell: PreviewRoofSegment[] = []
  const pointAt = (index: number, radius: number, y: number): PreviewPoint3 => {
    const point = stadiumPerimeterPoint(plan, index / segments)
    return [point.x + point.nx * radius, y, point.z + point.nz * radius]
  }
  for (let index = 0; index < segments; index++) {
    const midpointT = (index + 0.5) / segments
    if (openings.some((opening) => midpointT >= opening.startT && midpointT < opening.endT)) continue
    if (!previewRoofSegmentCovered(plan, roof.style, index, segments)) continue
    const inner0 = pointAt(index, innerR, elevations.innerTopY)
    const inner1 = pointAt(index + 1, innerR, elevations.innerTopY)
    const outer0 = pointAt(index, outerR, elevations.outerTopY)
    const outer1 = pointAt(index + 1, outerR, elevations.outerTopY)
    shell.push({
      index,
      top: [inner0, inner1, outer1, outer0],
      underside: [
        [inner0[0], elevations.lowestY, inner0[2]],
        [inner1[0], elevations.lowestY, inner1[2]],
        [outer1[0], elevations.outerTopY - PREVIEW_ROOF_THICKNESS_Y, outer1[2]],
        [outer0[0], elevations.outerTopY - PREVIEW_ROOF_THICKNESS_Y, outer0[2]],
      ],
    })
  }
  return {
    elevations,
    innerR,
    outerR,
    segments: shell,
    panel: roof.style === 'dome'
      ? {
          center: [0, elevations.panelY!, plan.centerZ],
          size: [(plan.halfX - 2) * 2, (plan.halfZ - 2) * 2],
        }
      : null,
  }
}

export interface ProtectedPreviewInput {
  fieldLengthYd: number
  endZoneDepthYd: number
  apronHalfWidthYd: number
  apronEndClearanceYd: number
  cameraLaneHalfWidthYd: number
  cameraLaneExtraEndClearanceYd: number
  lowClearanceYd: number
}

export interface PreviewBox {
  id: string
  center: readonly [number, number, number]
  size: readonly [number, number, number]
}

/** Exact native protected apron and both additional end-camera lanes, in yards. */
export function protectedFieldPreviewVolumes(input: ProtectedPreviewInput): PreviewBox[] {
  const apronMinZ = -input.endZoneDepthYd - input.apronEndClearanceYd
  const apronMaxZ = input.fieldLengthYd + input.endZoneDepthYd + input.apronEndClearanceYd
  const cameraMinZ = apronMinZ - input.cameraLaneExtraEndClearanceYd
  const cameraMaxZ = apronMaxZ + input.cameraLaneExtraEndClearanceYd
  const heightCenter = input.lowClearanceYd * 0.5
  return [
    {
      id: 'field-apron',
      center: [0, heightCenter, (apronMinZ + apronMaxZ) * 0.5],
      size: [input.apronHalfWidthYd * 2, input.lowClearanceYd, apronMaxZ - apronMinZ],
    },
    {
      id: 'home-camera-lane',
      center: [0, heightCenter, (cameraMinZ + apronMinZ) * 0.5],
      size: [input.cameraLaneHalfWidthYd * 2, input.lowClearanceYd, apronMinZ - cameraMinZ],
    },
    {
      id: 'away-camera-lane',
      center: [0, heightCenter, (apronMaxZ + cameraMaxZ) * 0.5],
      size: [input.cameraLaneHalfWidthYd * 2, input.lowClearanceYd, cameraMaxZ - apronMaxZ],
    },
  ]
}

export interface GoalPreviewInput {
  fieldLengthYd: number
  goalHalfWidthYd: number
  goalCrossbarYd: number
  goalUprightTopYd: number
  goalSupportOffsetYd: number
}

export interface GoalpostPreview {
  id: 'home' | 'away'
  goalZ: number
  baseZ: number
  crossbarCenter: readonly [number, number, number]
  crossbarLength: number
  uprightCenters: readonly [readonly [number, number, number], readonly [number, number, number]]
  uprightLength: number
  supportCenter: readonly [number, number, number]
  supportLength: number
}

/** Native goal-line, crossbar, upright, and rear support coordinates. */
export function goalpostPreviewCoordinates(input: GoalPreviewInput): GoalpostPreview[] {
  return ([['home', 0, -1], ['away', input.fieldLengthYd, 1]] as const).map(([id, goalZ, back]) => {
    const baseZ = goalZ + back * input.goalSupportOffsetYd
    const uprightBottom = input.goalCrossbarYd - 0.12
    const uprightLength = input.goalUprightTopYd - uprightBottom
    const supportBottom = 0.1
    const supportTop = input.goalCrossbarYd - 0.55
    return {
      id,
      goalZ,
      baseZ,
      crossbarCenter: [0, input.goalCrossbarYd, goalZ],
      crossbarLength: input.goalHalfWidthYd * 2,
      uprightCenters: [
        [-input.goalHalfWidthYd, uprightBottom + uprightLength * 0.5, goalZ],
        [input.goalHalfWidthYd, uprightBottom + uprightLength * 0.5, goalZ],
      ],
      uprightLength,
      supportCenter: [0, supportBottom + (supportTop - supportBottom) * 0.5, baseZ],
      supportLength: supportTop - supportBottom,
    }
  })
}

export interface SkylinePreviewInput {
  kind: 'block' | 'stack' | 'spire' | 'tank' | 'rock'
  xYd: number
  yYd: number
  zYd: number
  sizeXYd: number
  sizeYYd: number
  sizeZYd: number
}

/** Exact primitive centers/sizes used by the native skyline switch. */
export function skylinePreviewParts(node: SkylinePreviewInput): PreviewBox[] {
  const part = (id: string, yFactor: number, syFactor: number, sxFactor = 1, szFactor = 1): PreviewBox => ({
    id,
    center: [node.xYd, node.yYd + node.sizeYYd * yFactor, node.zYd],
    size: [node.sizeXYd * sxFactor, node.sizeYYd * syFactor, node.sizeZYd * szFactor],
  })
  switch (node.kind) {
    case 'stack': return [part('stack-lower', 0.28, 0.56), part('stack-upper', 0.75, 0.38, 0.68, 0.68)]
    case 'spire': return [part('spire-base', 0.38, 0.76), part('spire-tip', 0.88, 0.24, 0.18, 0.18)]
    case 'tank': return [
      part('tank-body', 0.62, 0.58),
      ...([-1, 1] as const).flatMap((sx) => ([-1, 1] as const).map((sz) => ({
        id: `tank-leg-${sx}-${sz}`,
        center: [node.xYd + sx * node.sizeXYd * 0.34, node.yYd + node.sizeYYd * 0.22,
          node.zYd + sz * node.sizeZYd * 0.34] as const,
        size: [node.sizeXYd * 0.09, node.sizeYYd * 0.44, node.sizeZYd * 0.09] as const,
      }))),
    ]
    case 'rock': return [part('rock', 0.48, 0.96)]
    default: return [part('block', 0.5, 1)]
  }
}
