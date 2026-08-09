import { BaseNode, nodeType, objectId } from '@pascal-app/core'
import { z } from 'zod'

export const MFD_STADIUM_KINDS = {
  root: 'mfd:stadium-root',
  fieldReference: 'mfd:field-reference',
  bowlPlan: 'mfd:bowl-plan',
  deckProfile: 'mfd:deck-profile',
  bowlOpening: 'mfd:bowl-opening',
  roof: 'mfd:roof',
  tunnel: 'mfd:tunnel',
  scoreboard: 'mfd:scoreboard',
  lightTower: 'mfd:light-tower',
  banner: 'mfd:banner',
  skylineProp: 'mfd:skyline-prop',
} as const

export const MFD_STADIUM_IDS = [
  'forgeworks-yard',
  'granite-bowl',
  'turbine-hall',
  'kiln-row',
  'umbra-park',
  'cobalt-rotunda',
  'the-filament',
  'rimyard',
  'evergreen-spire',
  'heliograph-field',
  'mirage-flats',
  'hoarfrost-hollow',
  'tidegate-basin',
  'the-keep',
  'brackwater-field',
  'windlass-yard',
  'grand-meridian',
  'the-saltpan',
] as const

export type MfdStadiumId = (typeof MFD_STADIUM_IDS)[number]

const vector3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()])
const positioned = {
  position: vector3.default([0, 0, 0]),
  rotation: vector3.default([0, 0, 0]),
}

export const MfdStadiumRootNode = BaseNode.extend({
  id: objectId('mfdroot'),
  type: nodeType(MFD_STADIUM_KINDS.root),
  children: z.array(z.string()).default([]),
  stadiumId: z.enum(MFD_STADIUM_IDS).default('the-saltpan'),
  inheritedName: z.string().default('The Saltpan'),
  inheritedCity: z.string().default('Alkali Reach'),
  inheritedSurface: z.string().default('SAND'),
  inheritedSkyKind: z.string().default('DUSK'),
  inheritedRoofCategory: z.number().int().min(0).max(2).default(0),
  inheritedCrowdTint: z.string().default('#C8B99A'),
  inheritedAccent: z.string().default('#3FB6C8'),
  source: z.enum(['legacy', 'preset', 'showcase']).default('legacy'),
})
export type MfdStadiumRootNode = z.infer<typeof MfdStadiumRootNode>

export const MfdFieldReferenceNode = BaseNode.extend({
  id: objectId('mfdfield'),
  type: nodeType(MFD_STADIUM_KINDS.fieldReference),
  ...positioned,
  fieldHalfWidthYd: z.literal(26.665).default(26.665),
  fieldLengthYd: z.literal(100).default(100),
  endZoneDepthYd: z.literal(10).default(10),
  apronHalfWidthYd: z.literal(37).default(37),
  apronEndClearanceYd: z.literal(16).default(16),
  cameraLaneHalfWidthYd: z.literal(18).default(18),
  cameraLaneExtraEndClearanceYd: z.literal(6).default(6),
  lowClearanceYd: z.literal(16).default(16),
  goalHalfWidthYd: z.literal(9.25).default(9.25),
  goalCrossbarYd: z.literal(10 / 3).default(10 / 3),
  goalUprightTopYd: z.literal(40 / 3).default(40 / 3),
  goalSupportOffsetYd: z.literal(1.35).default(1.35),
  protectedEnvelope: z.boolean().default(true),
  cameraPreset: z.enum(['none', 'top', 'perspective', 'end', 'side']).default('none'),
})
export type MfdFieldReferenceNode = z.infer<typeof MfdFieldReferenceNode>

export const MfdBowlPlanNode = BaseNode.extend({
  id: objectId('mfdbowl'),
  type: nodeType(MFD_STADIUM_KINDS.bowlPlan),
  ...positioned,
  centerZYd: z.number().min(20).max(80).default(50),
  halfXYd: z.number().gt(37).max(100).default(61),
  halfZYd: z.number().min(70).max(160).default(88),
  cornerRadiusYd: z.number().min(4).max(60).default(19),
  aisleEvery: z.number().int().min(2).max(32).default(8),
})
export type MfdBowlPlanNode = z.infer<typeof MfdBowlPlanNode>

export const MfdDeckProfileNode = BaseNode.extend({
  id: objectId('mfddeck'),
  type: nodeType(MFD_STADIUM_KINDS.deckProfile),
  ...positioned,
  order: z.number().int().min(0).max(31).default(0),
  role: z
    .enum(['ground', 'signage', 'structure', 'dark', 'accent', 'seats', 'outer'])
    .default('seats'),
  radialRunYd: z.number().min(0).max(40).default(9),
  riseYd: z.number().min(-80).max(60).default(5),
})
export type MfdDeckProfileNode = z.infer<typeof MfdDeckProfileNode>

export const MfdBowlOpeningNode = BaseNode.extend({
  id: objectId('mfdopen'),
  type: nodeType(MFD_STADIUM_KINDS.bowlOpening),
  ...positioned,
  startT: z.number().min(0).lt(1).default(0.43),
  endT: z.number().min(0).max(1).default(0.57),
})
export type MfdBowlOpeningNode = z.infer<typeof MfdBowlOpeningNode>

export const MfdRoofNode = BaseNode.extend({
  id: objectId('mfdroof'),
  type: nodeType(MFD_STADIUM_KINDS.roof),
  ...positioned,
  style: z.enum(['none', 'canopy', 'dome']).default('none'),
  coverage: z.number().min(0).max(1).default(0),
  heightYd: z.number().min(0).max(100).default(0),
  radialOverhangYd: z.number().min(0).max(30).default(0),
})
export type MfdRoofNode = z.infer<typeof MfdRoofNode>

export const MfdTunnelNode = BaseNode.extend({
  id: objectId('mfdtunnel'),
  type: nodeType(MFD_STADIUM_KINDS.tunnel),
  ...positioned,
  perimeterT: z.number().min(0).lt(1).default(0.25),
  widthYd: z.number().min(0.5).max(20).default(7),
  heightYd: z.number().min(1).max(12).default(5),
})
export type MfdTunnelNode = z.infer<typeof MfdTunnelNode>

export const MfdScoreboardNode = BaseNode.extend({
  id: objectId('mfdscore'),
  type: nodeType(MFD_STADIUM_KINDS.scoreboard),
  ...positioned,
  perimeterT: z.number().min(0).lt(1).default(0.5),
  widthYd: z.number().min(2).max(80).default(24),
  heightYd: z.number().min(1).max(30).default(10),
  elevationYd: z.number().min(1).max(80).default(25),
  outwardOffsetYd: z.number().min(0).max(50).default(4),
})
export type MfdScoreboardNode = z.infer<typeof MfdScoreboardNode>

export const MfdLightTowerNode = BaseNode.extend({
  id: objectId('mfdtower'),
  type: nodeType(MFD_STADIUM_KINDS.lightTower),
  ...positioned,
  perimeterT: z.number().min(0).lt(1).default(0.125),
  heightYd: z.number().min(12).max(100).default(38),
  outwardOffsetYd: z.number().min(0).max(50).default(9),
})
export type MfdLightTowerNode = z.infer<typeof MfdLightTowerNode>

export const MfdBannerNode = BaseNode.extend({
  id: objectId('mfdbanner'),
  type: nodeType(MFD_STADIUM_KINDS.banner),
  ...positioned,
  perimeterT: z.number().min(0).lt(1).default(0.2),
  widthYd: z.number().min(0.5).max(30).default(8),
  heightYd: z.number().min(0.5).max(12).default(3),
  elevationYd: z.number().min(0.5).max(80).default(18),
  colorRole: z
    .enum(['accent', 'home-primary', 'home-secondary', 'neutral'])
    .default('accent'),
  minQuality: z.enum(['LOW', 'MEDIUM', 'HIGH']).default('MEDIUM'),
})
export type MfdBannerNode = z.infer<typeof MfdBannerNode>

export const MfdSkylinePropNode = BaseNode.extend({
  id: objectId('mfdsky'),
  type: nodeType(MFD_STADIUM_KINDS.skylineProp),
  ...positioned,
  kind: z.enum(['block', 'stack', 'spire', 'tank', 'rock']).default('rock'),
  xYd: z.number().min(-200).max(200).default(72),
  yYd: z.number().min(0).max(120).default(8),
  zYd: z.number().min(-150).max(250).default(50),
  sizeXYd: z.number().min(0.5).max(80).default(10),
  sizeYYd: z.number().min(0.5).max(150).default(16),
  sizeZYd: z.number().min(0.5).max(80).default(10),
  colorRole: z.enum(['structure', 'dark', 'accent', 'neutral']).default('neutral'),
  minQuality: z.enum(['LOW', 'MEDIUM', 'HIGH']).default('HIGH'),
})
export type MfdSkylinePropNode = z.infer<typeof MfdSkylinePropNode>

export const MFD_NODE_SCHEMAS = {
  [MFD_STADIUM_KINDS.root]: MfdStadiumRootNode,
  [MFD_STADIUM_KINDS.fieldReference]: MfdFieldReferenceNode,
  [MFD_STADIUM_KINDS.bowlPlan]: MfdBowlPlanNode,
  [MFD_STADIUM_KINDS.deckProfile]: MfdDeckProfileNode,
  [MFD_STADIUM_KINDS.bowlOpening]: MfdBowlOpeningNode,
  [MFD_STADIUM_KINDS.roof]: MfdRoofNode,
  [MFD_STADIUM_KINDS.tunnel]: MfdTunnelNode,
  [MFD_STADIUM_KINDS.scoreboard]: MfdScoreboardNode,
  [MFD_STADIUM_KINDS.lightTower]: MfdLightTowerNode,
  [MFD_STADIUM_KINDS.banner]: MfdBannerNode,
  [MFD_STADIUM_KINDS.skylineProp]: MfdSkylinePropNode,
} as const

export type MfdStudioNode =
  | MfdStadiumRootNode
  | MfdFieldReferenceNode
  | MfdBowlPlanNode
  | MfdDeckProfileNode
  | MfdBowlOpeningNode
  | MfdRoofNode
  | MfdTunnelNode
  | MfdScoreboardNode
  | MfdLightTowerNode
  | MfdBannerNode
  | MfdSkylinePropNode
