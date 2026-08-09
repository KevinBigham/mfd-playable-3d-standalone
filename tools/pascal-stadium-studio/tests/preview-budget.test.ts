import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CAMERA_LANE_EXTRA_END_CLEARANCE,
  CAMERA_LANE_HALF_WIDTH,
  compileStadiumVisual,
  FIELD_APRON_END_CLEARANCE,
  FIELD_APRON_HALF_WIDTH,
  FIELD_LOW_CLEARANCE_Y,
  NATIVE_CANOPY_NORMAL_X_THRESHOLD,
  NATIVE_DOME_PANEL_RISE_Y,
  NATIVE_ROOF_SLOPE_RISE_Y,
  NATIVE_ROOF_THICKNESS_Y,
  PROTECTED_FIELD_VOLUMES,
  nativeRoofCoveredSegmentCount,
  nativeRoofElevations,
  nativeRoofSegmentCovered,
} from '../../../src/render/stadiumVisual/index.ts'
import { CROSSBAR_Y, GOAL_HALF_WIDTH, UPRIGHT_TOP_Y } from '../../../src/render/env/field.ts'
import { budgetStatusRows, isStageDisabled } from '../src/budget-presentation'
import {
  compilePreviewProfile,
  goalpostPreviewCoordinates,
  perimeterPreviewTransform,
  PREVIEW_CANOPY_NORMAL_X_THRESHOLD,
  PREVIEW_DOME_PANEL_RISE_Y,
  PREVIEW_ROOF_SLOPE_RISE_Y,
  PREVIEW_ROOF_THICKNESS_Y,
  previewRoofElevations,
  previewRoofTransform,
  protectedFieldPreviewVolumes,
  skylinePreviewParts,
  verticalCenterYd,
} from '../src/preview-coordinates'
import { visualToStudioScene } from '../src/scene-adapter'
import { analyzeVisualCandidate, stageVisualToDirectory } from '../src/server'
import { THE_SALTPAN_NATIVE, THE_SALTPAN_SHOWCASE_VISUAL } from '../src/showcase'
import { MFD_STADIUM_KINDS, type MfdDeckProfileNode, type MfdFieldReferenceNode } from '../src/nodes/schemas'

const TOOL_ROOT = resolve(import.meta.dirname, '..')

function overBudgetCandidate() {
  const visual = structuredClone(THE_SALTPAN_SHOWCASE_VISUAL)
  delete visual.bowl.openings
  visual.lightTowers = Array.from({ length: 12 }, (_, index) => ({
    perimeterT: (index + 0.5) / 12,
    heightYd: 100,
    outwardOffsetYd: 50,
  }))
  visual.skyline = Array.from({ length: 48 }, (_, index) => ({
    kind: 'tank' as const,
    position: { x: index % 2 ? 150 : -150, y: 30, z: -100 + (index % 24) * 10 },
    size: { x: 10, y: 20, z: 10 },
    colorRole: 'neutral' as const,
    minQuality: 'LOW' as const,
  }))
  return visual
}

describe('native-parity preview coordinates', () => {
  const scene = visualToStudioScene(THE_SALTPAN_SHOWCASE_VISUAL, THE_SALTPAN_NATIVE, 'showcase')
  const profileNodes = Object.values(scene.nodes)
    .filter((node) => (node as { type?: string }).type === MFD_STADIUM_KINDS.deckProfile) as MfdDeckProfileNode[]
  const field = Object.values(scene.nodes)
    .find((node) => (node as { type?: string; cameraPreset?: string }).type === MFD_STADIUM_KINDS.fieldReference
      && (node as { cameraPreset?: string }).cameraPreset === 'none') as MfdFieldReferenceNode

  it('matches the native compiler deck origin, every segment, topR, and topY', () => {
    const preview = compilePreviewProfile(profileNodes)
    const native = compileStadiumVisual(THE_SALTPAN_SHOWCASE_VISUAL, 'HIGH')
    expect(preview.profile.map(({ r0, y0, r1, y1 }) => ({ r0, y0, r1, y1 })))
      .toEqual(native.profile.map(({ r0, y0, r1, y1 }) => ({ r0, y0, r1, y1 })))
    expect(preview.profile[0]).toEqual(expect.objectContaining({ r0: -4, y0: -0.5, r1: 0, y1: 0 }))
    expect(preview.topR).toBe(native.topR)
    expect(preview.topY).toBe(native.topY)
  })

  it('uses native feature yaw, perimeter offsets, bottom centers, and tower base topY', () => {
    const native = compileStadiumVisual(THE_SALTPAN_SHOWCASE_VISUAL, 'HIGH')
    const plan = THE_SALTPAN_SHOWCASE_VISUAL.bowl
    const tower = THE_SALTPAN_SHOWCASE_VISUAL.lightTowers![0]
    const position = perimeterPreviewTransform(plan, tower.perimeterT, tower.outwardOffsetYd)
    expect(position.yaw).toBe(Math.atan2(
      -(position.xYd - perimeterPreviewTransform(plan, tower.perimeterT, 0).xYd),
      -(position.zYd - perimeterPreviewTransform(plan, tower.perimeterT, 0).zYd),
    ))
    expect(native.topY).toBe(compilePreviewProfile(profileNodes).topY)
    expect(native.topY).toBe(19.5)
    const board = THE_SALTPAN_SHOWCASE_VISUAL.scoreboards![0]
    const banner = THE_SALTPAN_SHOWCASE_VISUAL.banners![0]
    expect(verticalCenterYd(board.elevationYd, board.heightYd)).toBe(33.5)
    expect(verticalCenterYd(banner.elevationYd, banner.heightYd)).toBe(20.5)
    expect(native.topR + 0.35).toBeCloseTo(30.1, 12)
  })

  it('matches every native protected field volume including camera-lane extras', () => {
    expect(field).toEqual(expect.objectContaining({
      apronHalfWidthYd: FIELD_APRON_HALF_WIDTH,
      apronEndClearanceYd: FIELD_APRON_END_CLEARANCE,
      cameraLaneHalfWidthYd: CAMERA_LANE_HALF_WIDTH,
      cameraLaneExtraEndClearanceYd: CAMERA_LANE_EXTRA_END_CLEARANCE,
      lowClearanceYd: FIELD_LOW_CLEARANCE_Y,
    }))
    const preview = protectedFieldPreviewVolumes(field)
    const expanded = preview.map((volume) => ({
      name: volume.id,
      minX: volume.center[0] - volume.size[0] / 2,
      maxX: volume.center[0] + volume.size[0] / 2,
      minY: volume.center[1] - volume.size[1] / 2,
      maxY: volume.center[1] + volume.size[1] / 2,
      minZ: volume.center[2] - volume.size[2] / 2,
      maxZ: volume.center[2] + volume.size[2] / 2,
    }))
    expect(expanded).toEqual(PROTECTED_FIELD_VOLUMES)
  })

  it('matches native goal line, crossbar, upright, and rear-support coordinates', () => {
    const goals = goalpostPreviewCoordinates(field)
    expect(field.goalHalfWidthYd).toBe(GOAL_HALF_WIDTH)
    expect(field.goalCrossbarYd).toBe(CROSSBAR_Y)
    expect(field.goalUprightTopYd).toBe(UPRIGHT_TOP_Y)
    expect(goals.map((goal) => ({ id: goal.id, goalZ: goal.goalZ, baseZ: goal.baseZ }))).toEqual([
      { id: 'home', goalZ: 0, baseZ: -1.35 },
      { id: 'away', goalZ: 100, baseZ: 101.35 },
    ])
    expect(goals[0].crossbarCenter).toEqual([0, CROSSBAR_Y, 0])
    expect(goals[1].crossbarCenter).toEqual([0, CROSSBAR_Y, 100])
    expect(goals[0].uprightCenters.map((center) => center[0])).toEqual([-GOAL_HALF_WIDTH, GOAL_HALF_WIDTH])
  })

  it('uses native base-elevation centers for every skyline primitive kind', () => {
    const common = { xYd: 10, yYd: 20, zYd: 30, sizeXYd: 10, sizeYYd: 100, sizeZYd: 8 }
    expect(skylinePreviewParts({ ...common, kind: 'block' })[0].center[1]).toBe(70)
    expect(skylinePreviewParts({ ...common, kind: 'rock' })[0].center[1]).toBe(68)
    expect(skylinePreviewParts({ ...common, kind: 'stack' }).map((part) => part.center[1])).toEqual([48, 95])
    expect(skylinePreviewParts({ ...common, kind: 'spire' }).map((part) => part.center[1])).toEqual([58, 108])
    expect(skylinePreviewParts({ ...common, kind: 'tank' }).map((part) => part.center[1])).toEqual([82, 42, 42, 42, 42])
  })

  it('matches native roof elevations exactly and never emits a vertex below heightYd', () => {
    expect(PREVIEW_ROOF_THICKNESS_Y).toBe(NATIVE_ROOF_THICKNESS_Y)
    expect(PREVIEW_ROOF_SLOPE_RISE_Y).toBe(NATIVE_ROOF_SLOPE_RISE_Y)
    expect(PREVIEW_DOME_PANEL_RISE_Y).toBe(NATIVE_DOME_PANEL_RISE_Y)
    expect(PREVIEW_CANOPY_NORMAL_X_THRESHOLD).toBe(NATIVE_CANOPY_NORMAL_X_THRESHOLD)
    const plan = THE_SALTPAN_SHOWCASE_VISUAL.bowl
    for (const roof of [
      { style: 'canopy' as const, coverage: 0.000001, heightYd: 24.000001, radialOverhangYd: 0 },
      { style: 'canopy' as const, coverage: 0.999999, heightYd: 100, radialOverhangYd: 30 },
      { style: 'dome' as const, coverage: 1, heightYd: 48, radialOverhangYd: 12 },
    ]) {
      expect(previewRoofElevations(roof)).toEqual(nativeRoofElevations(roof))
      const preview = previewRoofTransform(plan, roof, 29.75, [], 64)!
      const vertices = preview.segments.flatMap((segment) => [...segment.top, ...segment.underside])
      if (preview.panel) vertices.push(preview.panel.center)
      expect(Math.min(...vertices.map((vertex) => vertex[1]))).toBe(roof.heightYd)
      expect(vertices.every((vertex) => vertex[1] >= roof.heightYd)).toBe(true)
    }
  })

  it('treats canopy coverage as radial depth and uses exact sideline segment selection', () => {
    const plan = THE_SALTPAN_SHOWCASE_VISUAL.bowl
    const topR = 29.75
    const openings = [{ startT: 0.43, endT: 0.57 }]
    const segmentCount = 64
    const nearZero = previewRoofTransform(plan, {
      style: 'canopy', coverage: 0.000001, heightYd: 36, radialOverhangYd: 0,
    }, topR, openings, segmentCount)!
    expect(nearZero.innerR).toBe(topR - 1)
    expect(nearZero.outerR).toBe(topR)

    const nearFull = previewRoofTransform(plan, {
      style: 'canopy', coverage: 0.999999, heightYd: 36, radialOverhangYd: 30,
    }, topR, openings, segmentCount)!
    expect(nearFull.innerR).toBeCloseTo(topR - topR * 0.999999, 12)
    expect(nearFull.outerR).toBe(topR + 30)
    const activeMask = Array.from({ length: segmentCount }, (_, index) => {
      const t = (index + 0.5) / segmentCount
      return !openings.some((opening) => t >= opening.startT && t < opening.endT)
    })
    expect(nearFull.segments).toHaveLength(
      nativeRoofCoveredSegmentCount(plan, 'canopy', segmentCount, activeMask),
    )
    expect(nearFull.segments.every((segment) =>
      nativeRoofSegmentCovered(plan, 'canopy', segment.index, segmentCount))).toBe(true)
  })

  it('renders a full radial dome perimeter and native elevated centre-panel footprint', () => {
    const plan = THE_SALTPAN_SHOWCASE_VISUAL.bowl
    const roof = { style: 'dome' as const, coverage: 1, heightYd: 48, radialOverhangYd: 12 }
    const preview = previewRoofTransform(plan, roof, 29.75, [], 128)!
    const elevations = nativeRoofElevations(roof)!
    expect(preview.innerR).toBe(0)
    expect(preview.outerR).toBe(41.75)
    expect(preview.segments).toHaveLength(nativeRoofCoveredSegmentCount(plan, 'dome', 128))
    expect(preview.panel).toEqual({
      center: [0, elevations.panelY, plan.centerZ],
      size: [(plan.halfX - 2) * 2, (plan.halfZ - 2) * 2],
    })
    expect(previewRoofTransform(plan, { ...roof, style: 'none', coverage: 0 }, 29.75)).toBeNull()
  })
})

describe('budget analysis and panel staging policy', () => {
  it('wires the parity helpers into the renderer and budget policy into the visible panel', async () => {
    const [renderer, panel] = await Promise.all([
      readFile(resolve(TOOL_ROOT, 'src/nodes/renderer.tsx'), 'utf8'),
      readFile(resolve(TOOL_ROOT, 'src/panel.tsx'), 'utf8'),
    ])
    for (const helper of [
      'compilePreviewProfile', 'goalpostPreviewCoordinates', 'protectedFieldPreviewVolumes',
      'previewRoofTransform', 'skylinePreviewParts', 'verticalCenterYd',
    ]) expect(renderer).toContain(`${helper}(`)
    expect(panel).toContain('budgetStatusRows(analysis)')
    expect(panel).toContain("budget.passed ? 'PASS' : 'FAIL'")
    expect(panel).toContain('Violation · {message}')
    expect(panel).toContain('disabled={stageDisabled}')
  })

  it('returns invalid when any quality budget fails and exposes all violation receipts', () => {
    const analysis = analyzeVisualCandidate(overBudgetCandidate())
    expect(analysis.ok).toBe(false)
    expect('budgets' in analysis).toBe(true)
    if (!('budgets' in analysis)) return
    expect(analysis.budgets.map((budget) => [budget.quality, budget.passed])).toEqual([
      ['LOW', false], ['MEDIUM', false], ['HIGH', false],
    ])
    expect(analysis.errors).toHaveLength(3)
    expect(analysis.errors.every((error) => error.code === 'BUDGET')).toBe(true)
  })

  it('renders quality status and violations in the pure panel view model and disables Stage', () => {
    const analysis = analyzeVisualCandidate(overBudgetCandidate())
    expect('budgets' in analysis).toBe(true)
    if (!('budgets' in analysis)) return
    const rows = budgetStatusRows(analysis)
    expect(rows.map((row) => `${row.quality}:${row.passed ? 'PASS' : 'FAIL'}`)).toEqual([
      'LOW:FAIL', 'MEDIUM:FAIL', 'HIGH:FAIL',
    ])
    expect(rows.every((row) => row.violations.some((message) => message.includes('triangles')))).toBe(true)
    expect(isStageDisabled({ adaptedOk: true, analysis, localErrorCount: 0, hostError: null })).toBe(true)
    expect(isStageDisabled({ adaptedOk: true, analysis: null, localErrorCount: 0, hostError: null })).toBe(true)

    const passing = analyzeVisualCandidate(THE_SALTPAN_SHOWCASE_VISUAL)
    expect(passing.ok).toBe(true)
    expect(isStageDisabled({ adaptedOk: true, analysis: passing, localErrorCount: 0, hostError: null })).toBe(false)
  })

  it('rejects an over-budget candidate before writing any staging file', async () => {
    const directory = await mkdtemp(join(TOOL_ROOT, 'budget-stage-test-'))
    try {
      await expect(stageVisualToDirectory(overBudgetCandidate(), directory)).rejects.toThrow('triangles')
      expect(await readdir(directory)).toEqual([])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
