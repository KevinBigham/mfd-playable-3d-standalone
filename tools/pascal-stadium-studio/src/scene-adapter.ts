import type { AnyNode } from '@pascal-app/core'
import type { MfdStadiumVisualV1, NativeStadiumDefinition } from './contract'
import {
  MFD_NODE_SCHEMAS,
  MFD_STADIUM_KINDS,
  type MfdBannerNode,
  type MfdBowlOpeningNode,
  type MfdBowlPlanNode,
  type MfdDeckProfileNode,
  type MfdFieldReferenceNode,
  type MfdLightTowerNode,
  type MfdRoofNode,
  type MfdScoreboardNode,
  type MfdSkylinePropNode,
  type MfdStadiumRootNode,
  type MfdStudioNode,
  type MfdTunnelNode,
} from './nodes/schemas'
import { yardsToMetres } from './units'

export interface StudioSceneGraph {
  nodes: Record<string, unknown>
  rootNodeIds: string[]
  installedPlugins: string[]
}

export interface StudioAdapterIssue {
  path: string
  code: 'MISSING_NODE' | 'DUPLICATE_NODE' | 'INVALID_NODE'
  message: string
}

export type StudioAdapterResult =
  | { ok: true; value: MfdStadiumVisualV1; errors: [] }
  | { ok: false; errors: StudioAdapterIssue[] }

function sortedParsedNodes(nodes: Record<string, unknown>): {
  parsed: MfdStudioNode[]
  errors: StudioAdapterIssue[]
} {
  const parsed: MfdStudioNode[] = []
  const errors: StudioAdapterIssue[] = []
  for (const id of Object.keys(nodes).sort()) {
    const raw = nodes[id]
    if (!raw || typeof raw !== 'object') continue
    const type = (raw as { type?: unknown }).type
    if (typeof type !== 'string' || !(type in MFD_NODE_SCHEMAS)) continue
    const schema = MFD_NODE_SCHEMAS[type as keyof typeof MFD_NODE_SCHEMAS]
    const result = schema.safeParse(raw)
    if (!result.success) {
      for (const issue of result.error.issues) {
        errors.push({
          path: `nodes.${id}.${issue.path.join('.')}`,
          code: 'INVALID_NODE',
          message: issue.message,
        })
      }
      continue
    }
    parsed.push(result.data as MfdStudioNode)
  }
  return { parsed, errors }
}

function exactlyOne<N extends MfdStudioNode>(
  nodes: MfdStudioNode[],
  kind: N['type'],
  errors: StudioAdapterIssue[],
): N | null {
  const matches = nodes.filter((node) => node.type === kind) as N[]
  if (matches.length === 0) {
    errors.push({ path: kind, code: 'MISSING_NODE', message: `scene requires exactly one ${kind}` })
    return null
  }
  if (matches.length > 1) {
    errors.push({ path: kind, code: 'DUPLICATE_NODE', message: `scene has ${matches.length} ${kind} nodes` })
    return null
  }
  return matches[0] ?? null
}

function byKind<N extends MfdStudioNode>(nodes: MfdStudioNode[], kind: N['type']): N[] {
  return nodes.filter((node) => node.type === kind) as N[]
}

/** Convert Pascal semantic nodes to the only format MFD accepts: strict yard JSON. */
export function studioSceneToVisual(nodes: Record<string, unknown>): StudioAdapterResult {
  const parsedResult = sortedParsedNodes(nodes)
  const errors = [...parsedResult.errors]
  const semanticNodes = parsedResult.parsed
  const root = exactlyOne<MfdStadiumRootNode>(semanticNodes, MFD_STADIUM_KINDS.root, errors)
  const plan = exactlyOne<MfdBowlPlanNode>(semanticNodes, MFD_STADIUM_KINDS.bowlPlan, errors)
  const profiles = byKind<MfdDeckProfileNode>(semanticNodes, MFD_STADIUM_KINDS.deckProfile)
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  if (profiles.length === 0) {
    errors.push({ path: MFD_STADIUM_KINDS.deckProfile, code: 'MISSING_NODE', message: 'scene requires at least one profile segment' })
  }
  if (!profiles.some((segment) => segment.role === 'seats')) {
    errors.push({ path: MFD_STADIUM_KINDS.deckProfile, code: 'MISSING_NODE', message: 'profile requires at least one seats segment' })
  }
  if (!root || !plan || errors.length > 0) return { ok: false, errors }

  const roof = byKind<MfdRoofNode>(semanticNodes, MFD_STADIUM_KINDS.roof)[0]
  const openings = byKind<MfdBowlOpeningNode>(semanticNodes, MFD_STADIUM_KINDS.bowlOpening)
  const tunnels = byKind<MfdTunnelNode>(semanticNodes, MFD_STADIUM_KINDS.tunnel)
  const scoreboards = byKind<MfdScoreboardNode>(semanticNodes, MFD_STADIUM_KINDS.scoreboard)
  const towers = byKind<MfdLightTowerNode>(semanticNodes, MFD_STADIUM_KINDS.lightTower)
  const banners = byKind<MfdBannerNode>(semanticNodes, MFD_STADIUM_KINDS.banner)
  const skyline = byKind<MfdSkylinePropNode>(semanticNodes, MFD_STADIUM_KINDS.skylineProp)

  const value: MfdStadiumVisualV1 = {
    schema: 'mfd.stadium-visual',
    version: 1,
    stadiumId: root.stadiumId,
    units: 'yards',
    coordinateSystem: {
      x: 'sideline-to-sideline',
      y: 'up',
      z: 'home-goal-to-away-goal',
    },
    bowl: {
      centerZ: plan.centerZYd,
      halfX: plan.halfXYd,
      halfZ: plan.halfZYd,
      cornerRadius: plan.cornerRadiusYd,
      aisleEvery: plan.aisleEvery,
      profile: profiles.map((segment) => ({
        role: segment.role,
        radialRunYd: segment.radialRunYd,
        riseYd: segment.riseYd,
      })),
      ...(openings.length > 0
        ? { openings: openings
          .sort((a, b) => a.startT - b.startT || a.id.localeCompare(b.id))
          .map((opening) => ({ startT: opening.startT, endT: opening.endT })) }
        : {}),
    },
    ...(roof ? { roof: {
      style: roof.style,
      coverage: roof.coverage,
      heightYd: roof.heightYd,
      radialOverhangYd: roof.radialOverhangYd,
    } } : {}),
    ...(tunnels.length > 0 ? { tunnels: tunnels
      .sort((a, b) => a.perimeterT - b.perimeterT || a.id.localeCompare(b.id))
      .map((node) => ({ perimeterT: node.perimeterT, widthYd: node.widthYd, heightYd: node.heightYd })) } : {}),
    ...(scoreboards.length > 0 ? { scoreboards: scoreboards
      .sort((a, b) => a.perimeterT - b.perimeterT || a.id.localeCompare(b.id))
      .map((node) => ({ perimeterT: node.perimeterT, widthYd: node.widthYd, heightYd: node.heightYd,
        elevationYd: node.elevationYd, outwardOffsetYd: node.outwardOffsetYd })) } : {}),
    ...(towers.length > 0 ? { lightTowers: towers
      .sort((a, b) => a.perimeterT - b.perimeterT || a.id.localeCompare(b.id))
      .map((node) => ({ perimeterT: node.perimeterT, heightYd: node.heightYd,
        outwardOffsetYd: node.outwardOffsetYd })) } : {}),
    ...(banners.length > 0 ? { banners: banners
      .sort((a, b) => a.perimeterT - b.perimeterT || a.id.localeCompare(b.id))
      .map((node) => ({ perimeterT: node.perimeterT, widthYd: node.widthYd, heightYd: node.heightYd,
        elevationYd: node.elevationYd, colorRole: node.colorRole, minQuality: node.minQuality })) } : {}),
    ...(skyline.length > 0 ? { skyline: skyline
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((node) => ({
        kind: node.kind,
        position: { x: node.xYd, y: node.yYd, z: node.zYd },
        size: { x: node.sizeXYd, y: node.sizeYYd, z: node.sizeZYd },
        colorRole: node.colorRole,
        minQuality: node.minQuality,
      })) } : {}),
    authoring: {
      author: 'MFD Pascal Stadium Visual Studio',
      notes: `Semantic ${root.source} scene; native identity fields remain locked to StadiumDef`,
      pascalSceneVersion: 'pascal-editor-0.9.2',
    },
  }
  return { ok: true, value, errors: [] }
}

function idToken(stadiumId: string): string {
  return stadiumId.replace(/[^a-z0-9]+/g, '_')
}

function cameraReference(id: string, parentId: string, preset: 'top' | 'perspective' | 'end' | 'side') {
  const centerZ = yardsToMetres(50)
  const camera = preset === 'top'
    ? { position: [0, yardsToMetres(145), centerZ], target: [0, 0, centerZ], mode: 'orthographic' as const, zoom: 0.72 }
    : preset === 'perspective'
    ? { position: [yardsToMetres(82), yardsToMetres(58), yardsToMetres(142)], target: [0, yardsToMetres(9), centerZ], mode: 'perspective' as const, fov: 45 }
    : preset === 'end'
      ? { position: [0, yardsToMetres(28), yardsToMetres(-112)], target: [0, yardsToMetres(10), centerZ], mode: 'perspective' as const, fov: 45 }
      : { position: [yardsToMetres(132), yardsToMetres(30), centerZ], target: [0, yardsToMetres(9), centerZ], mode: 'perspective' as const, fov: 45 }
  return {
    object: 'node', id, type: MFD_STADIUM_KINDS.fieldReference, parentId,
    visible: false, metadata: { mfdCameraPreset: preset }, position: [0, 0, 0], rotation: [0, 0, 0],
    fieldHalfWidthYd: 26.665, fieldLengthYd: 100, endZoneDepthYd: 10,
    apronHalfWidthYd: 37, apronEndClearanceYd: 16, cameraLaneHalfWidthYd: 18,
    cameraLaneExtraEndClearanceYd: 6, lowClearanceYd: 16,
    goalHalfWidthYd: 9.25, goalCrossbarYd: 10 / 3, goalUprightTopYd: 40 / 3,
    goalSupportOffsetYd: 1.35,
    protectedEnvelope: false, cameraPreset: preset, camera,
  }
}

/** Build a deterministic, undoable Pascal scene from a native semantic definition. */
export function visualToStudioScene(
  visual: MfdStadiumVisualV1,
  stadium: NativeStadiumDefinition,
  source: MfdStadiumRootNode['source'] = 'legacy',
): StudioSceneGraph {
  const token = idToken(visual.stadiumId)
  const siteId = `site_mfd_${token}`
  const buildingId = `building_mfd_${token}`
  const levelId = `level_mfd_${token}`
  const rootId = `mfdroot_${token}`
  const nodes: Record<string, unknown> = {}
  const semanticIds: string[] = []
  const add = (node: Record<string, unknown> & { id: string }) => {
    nodes[node.id] = node
    semanticIds.push(node.id)
  }

  add({
    object: 'node', id: rootId, type: MFD_STADIUM_KINDS.root, parentId: levelId,
    visible: true, metadata: {}, children: semanticIds,
    stadiumId: visual.stadiumId, inheritedName: stadium.name, inheritedCity: stadium.city,
    inheritedSurface: stadium.surface, inheritedSkyKind: stadium.skyKind,
    inheritedRoofCategory: stadium.roof, inheritedCrowdTint: stadium.crowdTint,
    inheritedAccent: stadium.accent, source,
  })
  add({
    object: 'node', id: `mfdfield_${token}`, type: MFD_STADIUM_KINDS.fieldReference, parentId: rootId,
    visible: true, metadata: { locked: true, transientReference: true }, position: [0, 0, 0], rotation: [0, 0, 0],
    fieldHalfWidthYd: 26.665, fieldLengthYd: 100, endZoneDepthYd: 10,
    apronHalfWidthYd: 37, apronEndClearanceYd: 16, cameraLaneHalfWidthYd: 18,
    cameraLaneExtraEndClearanceYd: 6, lowClearanceYd: 16,
    goalHalfWidthYd: 9.25, goalCrossbarYd: 10 / 3, goalUprightTopYd: 40 / 3,
    goalSupportOffsetYd: 1.35,
    protectedEnvelope: true, cameraPreset: 'none',
  })
  add(cameraReference(`mfdfield_${token}_camera_perspective`, rootId, 'perspective'))
  add(cameraReference(`mfdfield_${token}_camera_top`, rootId, 'top'))
  add(cameraReference(`mfdfield_${token}_camera_end`, rootId, 'end'))
  add(cameraReference(`mfdfield_${token}_camera_side`, rootId, 'side'))
  add({
    object: 'node', id: `mfdbowl_${token}`, type: MFD_STADIUM_KINDS.bowlPlan, parentId: rootId,
    visible: true, metadata: {}, position: [0, 0, 0], rotation: [0, 0, 0],
    centerZYd: visual.bowl.centerZ, halfXYd: visual.bowl.halfX, halfZYd: visual.bowl.halfZ,
    cornerRadiusYd: visual.bowl.cornerRadius, aisleEvery: visual.bowl.aisleEvery,
  })
  visual.bowl.profile.forEach((segment, index) => add({
    object: 'node', id: `mfddeck_${token}_${String(index).padStart(2, '0')}`,
    type: MFD_STADIUM_KINDS.deckProfile, parentId: rootId, visible: true, metadata: {},
    position: [0, 0, 0], rotation: [0, 0, 0], order: index, ...segment,
  }))
  visual.bowl.openings?.forEach((opening, index) => add({
    object: 'node', id: `mfdopen_${token}_${String(index).padStart(2, '0')}`,
    type: MFD_STADIUM_KINDS.bowlOpening, parentId: rootId, visible: true, metadata: {},
    position: [0, 0, 0], rotation: [0, 0, 0], ...opening,
  }))
  if (visual.roof) add({
    object: 'node', id: `mfdroof_${token}`, type: MFD_STADIUM_KINDS.roof, parentId: rootId,
    visible: true, metadata: {}, position: [0, 0, 0], rotation: [0, 0, 0], ...visual.roof,
  })
  visual.tunnels?.forEach((item, index) => add({
    object: 'node', id: `mfdtunnel_${token}_${String(index).padStart(2, '0')}`,
    type: MFD_STADIUM_KINDS.tunnel, parentId: rootId, visible: true, metadata: {},
    position: [0, 0, 0], rotation: [0, 0, 0], ...item,
  }))
  visual.scoreboards?.forEach((item, index) => add({
    object: 'node', id: `mfdscore_${token}_${String(index).padStart(2, '0')}`,
    type: MFD_STADIUM_KINDS.scoreboard, parentId: rootId, visible: true, metadata: {},
    position: [0, 0, 0], rotation: [0, 0, 0], ...item,
  }))
  visual.lightTowers?.forEach((item, index) => add({
    object: 'node', id: `mfdtower_${token}_${String(index).padStart(2, '0')}`,
    type: MFD_STADIUM_KINDS.lightTower, parentId: rootId, visible: true, metadata: {},
    position: [0, 0, 0], rotation: [0, 0, 0], ...item,
  }))
  visual.banners?.forEach((item, index) => add({
    object: 'node', id: `mfdbanner_${token}_${String(index).padStart(2, '0')}`,
    type: MFD_STADIUM_KINDS.banner, parentId: rootId, visible: true, metadata: {},
    position: [0, 0, 0], rotation: [0, 0, 0], ...item,
  }))
  visual.skyline?.forEach((item, index) => add({
    object: 'node', id: `mfdsky_${token}_${String(index).padStart(2, '0')}`,
    type: MFD_STADIUM_KINDS.skylineProp, parentId: rootId, visible: true, metadata: {},
    position: [0, 0, 0], rotation: [0, 0, 0], kind: item.kind,
    xYd: item.position.x, yYd: item.position.y, zYd: item.position.z,
    sizeXYd: item.size.x, sizeYYd: item.size.y, sizeZYd: item.size.z,
    colorRole: item.colorRole, minQuality: item.minQuality,
  }))

  // Root.children points at all semantic children, but not at the root itself.
  const root = nodes[rootId] as { children: string[] }
  root.children = semanticIds.filter((id) => id !== rootId)
  nodes[levelId] = { object: 'node', id: levelId, type: 'level', parentId: buildingId, visible: true,
    metadata: {}, children: [rootId], level: 0 }
  nodes[buildingId] = { object: 'node', id: buildingId, type: 'building', parentId: siteId, visible: true,
    metadata: {}, children: [levelId], position: [0, 0, 0], rotation: [0, 0, 0] }
  nodes[siteId] = { object: 'node', id: siteId, type: 'site', parentId: null, visible: true,
    metadata: {}, children: [buildingId], polygon: { type: 'polygon', points: [[-180, -180], [180, -180], [180, 240], [-180, 240]] } }

  return { nodes, rootNodeIds: [siteId], installedPlugins: ['mfd:stadium-visual-studio'] }
}

export function studioNodesFromPascal(nodes: Record<string, AnyNode>): Record<string, unknown> {
  return nodes as unknown as Record<string, unknown>
}

export function cameraNodeId(nodes: Record<string, unknown>, preset: 'top' | 'perspective' | 'end' | 'side'): string | null {
  for (const [id, value] of Object.entries(nodes)) {
    if (!value || typeof value !== 'object') continue
    const node = value as Partial<MfdFieldReferenceNode>
    if (node.type === MFD_STADIUM_KINDS.fieldReference && node.cameraPreset === preset) return id
  }
  return null
}
