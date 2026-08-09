import type {
  AnyNodeDefinition,
  HandleDescriptor,
  NodeDefinition,
  ParametricDescriptor,
} from '@pascal-app/core'
import { clamp, metresToYards, roundYards, yardsToMetres } from '../units'
import {
  MfdBannerNode,
  MfdBowlOpeningNode,
  MfdBowlPlanNode,
  MfdDeckProfileNode,
  MfdFieldReferenceNode,
  MfdLightTowerNode,
  MfdRoofNode,
  MfdScoreboardNode,
  MfdSkylinePropNode,
  MfdStadiumRootNode,
  MfdTunnelNode,
} from './schemas'

type NumericKey<N> = {
  [K in keyof N]: N[K] extends number ? K : never
}[keyof N]

function yardHandle<N extends object>(args: {
  key: NumericKey<N>
  axis: 'x' | 'y' | 'z'
  minYd: number
  maxYd: number
  position: (node: N) => readonly [number, number, number]
  radial?: boolean
}): HandleDescriptor<N> {
  return {
    kind: args.radial ? 'radial-resize' : 'linear-resize',
    ...(args.radial ? {} : { anchor: 'min' as const }),
    axis: args.axis,
    currentValue: (node) => yardsToMetres(node[args.key] as number),
    apply: (_node: N, value: number) =>
      ({
        [args.key]: clamp(roundYards(metresToYards(value)), args.minYd, args.maxYd),
      }) as Partial<N>,
    min: yardsToMetres(args.minYd),
    max: yardsToMetres(args.maxYd),
    placement: { position: args.position },
  } as HandleDescriptor<N>
}

function defaultsOf<S extends { parse(value: unknown): Record<string, unknown> }>(schema: S) {
  return () => {
    const { id: _id, type: _type, ...defaults } = schema.parse({})
    return defaults
  }
}

const commonCapabilities = {
  selectable: { hitVolume: 'bbox' as const },
  duplicable: true,
  deletable: true,
  groupable: true,
}

const planParametrics: ParametricDescriptor<MfdBowlPlanNode> = {
  groups: [
    {
      label: 'Bowl plan — yards',
      fields: [
        { key: 'centerZYd', kind: 'number', unit: 'yd', min: 20, max: 80, step: 0.25 },
        { key: 'halfXYd', kind: 'number', unit: 'yd', min: 37.25, max: 100, step: 0.25 },
        { key: 'halfZYd', kind: 'number', unit: 'yd', min: 70, max: 160, step: 0.25 },
        { key: 'cornerRadiusYd', kind: 'number', unit: 'yd', min: 4, max: 60, step: 0.25 },
        { key: 'aisleEvery', kind: 'number', min: 2, max: 32, step: 1 },
      ],
    },
  ],
}

const deckParametrics: ParametricDescriptor<MfdDeckProfileNode> = {
  groups: [
    {
      label: 'Ordered profile segment',
      fields: [
        { key: 'order', kind: 'number', min: 0, max: 31, step: 1 },
        { key: 'role', kind: 'enum', options: ['ground', 'signage', 'structure', 'dark', 'accent', 'seats', 'outer'] },
        { key: 'radialRunYd', kind: 'number', unit: 'yd', min: 0, max: 40, step: 0.25 },
        { key: 'riseYd', kind: 'number', unit: 'yd', min: -80, max: 60, step: 0.25 },
      ],
    },
  ],
}

const openingParametrics: ParametricDescriptor<MfdBowlOpeningNode> = {
  groups: [{ label: 'Perimeter opening', fields: [
    { key: 'startT', kind: 'number', min: 0, max: 0.999999, step: 0.005 },
    { key: 'endT', kind: 'number', min: 0, max: 1, step: 0.005 },
  ] }],
  invariants: [(node) => node.endT > node.startT
    ? []
    : [{ field: 'endT', msg: 'endT must be greater than startT', severity: 'error' }]],
}

const roofParametrics: ParametricDescriptor<MfdRoofNode> = {
  groups: [{ label: 'Roof — yards', fields: [
    { key: 'style', kind: 'enum', options: ['none', 'canopy', 'dome'], display: 'segmented' },
    { key: 'coverage', kind: 'number', min: 0, max: 1, step: 0.01 },
    { key: 'heightYd', kind: 'number', unit: 'yd', min: 0, max: 100, step: 0.25 },
    { key: 'radialOverhangYd', kind: 'number', unit: 'yd', min: 0, max: 30, step: 0.25 },
  ] }],
  derive: (next, patch) => {
    if (patch.style === 'none') return { coverage: 0, heightYd: 0, radialOverhangYd: 0 }
    if (patch.style === 'canopy') return { coverage: 0.5, heightYd: Math.max(34, next.heightYd), radialOverhangYd: Math.max(8, next.radialOverhangYd) }
    if (patch.style === 'dome') return { coverage: 1, heightYd: Math.max(44, next.heightYd), radialOverhangYd: Math.max(10, next.radialOverhangYd) }
    return {}
  },
  invariants: [(node) => {
    if (node.style === 'none') return node.coverage === 0 && node.heightYd === 0 && node.radialOverhangYd === 0
      ? [] : [{ field: 'style', msg: 'none roof requires zero coverage, height, and overhang', severity: 'error' }]
    return node.heightYd > 24
      ? [] : [{ field: 'heightYd', msg: 'roof must clear the protected 24 yd volume', severity: 'error' }]
  }],
}

const tunnelParametrics: ParametricDescriptor<MfdTunnelNode> = {
  groups: [{ label: 'Tunnel — yards', fields: [
    { key: 'perimeterT', kind: 'number', min: 0, max: 0.999999, step: 0.005 },
    { key: 'widthYd', kind: 'number', unit: 'yd', min: 0.5, max: 20, step: 0.25 },
    { key: 'heightYd', kind: 'number', unit: 'yd', min: 1, max: 12, step: 0.25 },
  ] }],
}

const scoreboardParametrics: ParametricDescriptor<MfdScoreboardNode> = {
  groups: [{ label: 'Scoreboard — yards', fields: [
    { key: 'perimeterT', kind: 'number', min: 0, max: 0.999999, step: 0.005 },
    { key: 'widthYd', kind: 'number', unit: 'yd', min: 2, max: 80, step: 0.25 },
    { key: 'heightYd', kind: 'number', unit: 'yd', min: 1, max: 30, step: 0.25 },
    { key: 'elevationYd', kind: 'number', unit: 'yd', min: 1, max: 80, step: 0.25 },
    { key: 'outwardOffsetYd', kind: 'number', unit: 'yd', min: 0, max: 50, step: 0.25 },
  ] }],
}

const towerParametrics: ParametricDescriptor<MfdLightTowerNode> = {
  groups: [{ label: 'Light tower — yards', fields: [
    { key: 'perimeterT', kind: 'number', min: 0, max: 0.999999, step: 0.005 },
    { key: 'heightYd', kind: 'number', unit: 'yd', min: 12, max: 100, step: 0.25 },
    { key: 'outwardOffsetYd', kind: 'number', unit: 'yd', min: 0, max: 50, step: 0.25 },
  ] }],
}

const bannerParametrics: ParametricDescriptor<MfdBannerNode> = {
  groups: [{ label: 'Banner — yards', fields: [
    { key: 'perimeterT', kind: 'number', min: 0, max: 0.999999, step: 0.005 },
    { key: 'widthYd', kind: 'number', unit: 'yd', min: 0.5, max: 30, step: 0.25 },
    { key: 'heightYd', kind: 'number', unit: 'yd', min: 0.5, max: 12, step: 0.25 },
    { key: 'elevationYd', kind: 'number', unit: 'yd', min: 0.5, max: 80, step: 0.25 },
    { key: 'colorRole', kind: 'enum', options: ['accent', 'home-primary', 'home-secondary', 'neutral'] },
    { key: 'minQuality', kind: 'enum', options: ['LOW', 'MEDIUM', 'HIGH'], display: 'segmented' },
  ] }],
}

const skylineParametrics: ParametricDescriptor<MfdSkylinePropNode> = {
  groups: [
    { label: 'Skyline position — yards', fields: [
      { key: 'xYd', kind: 'number', unit: 'yd', min: -200, max: 200, step: 0.25 },
      { key: 'yYd', kind: 'number', unit: 'yd', min: 0, max: 120, step: 0.25 },
      { key: 'zYd', kind: 'number', unit: 'yd', min: -150, max: 250, step: 0.25 },
    ] },
    { label: 'Skyline shape — yards', fields: [
      { key: 'kind', kind: 'enum', options: ['block', 'stack', 'spire', 'tank', 'rock'] },
      { key: 'sizeXYd', kind: 'number', unit: 'yd', min: 0.5, max: 80, step: 0.25 },
      { key: 'sizeYYd', kind: 'number', unit: 'yd', min: 0.5, max: 150, step: 0.25 },
      { key: 'sizeZYd', kind: 'number', unit: 'yd', min: 0.5, max: 80, step: 0.25 },
      { key: 'colorRole', kind: 'enum', options: ['structure', 'dark', 'accent', 'neutral'] },
      { key: 'minQuality', kind: 'enum', options: ['LOW', 'MEDIUM', 'HIGH'], display: 'segmented' },
    ] },
  ],
}

export const mfdStadiumRootDefinition: NodeDefinition<typeof MfdStadiumRootNode> = {
  kind: 'mfd:stadium-root', schemaVersion: 1, schema: MfdStadiumRootNode, category: 'site',
  defaults: defaultsOf(MfdStadiumRootNode) as never,
  capabilities: { selectable: { hitVolume: 'bbox' }, deletable: false },
  renderer: { kind: 'parametric', module: () => import('./renderer') },
  presentation: { label: 'MFD Stadium', icon: { kind: 'iconify', name: 'lucide:landmark' }, hidden: true },
  mcp: { description: 'MFD semantic stadium root. Official Pascal MCP cannot validate this external kind.' },
}

export const mfdFieldReferenceDefinition: NodeDefinition<typeof MfdFieldReferenceNode> = {
  kind: 'mfd:field-reference', schemaVersion: 1, schema: MfdFieldReferenceNode, category: 'utility',
  defaults: defaultsOf(MfdFieldReferenceNode) as never,
  capabilities: {}, dirtyTracking: false,
  renderer: { kind: 'parametric', module: () => import('./renderer') },
  presentation: { label: 'Locked MFD field reference', icon: { kind: 'iconify', name: 'lucide:lock' }, hidden: true, actionMenu: false },
}

export const mfdBowlPlanDefinition: NodeDefinition<typeof MfdBowlPlanNode> = {
  kind: 'mfd:bowl-plan', schemaVersion: 1, schema: MfdBowlPlanNode, category: 'structure',
  defaults: defaultsOf(MfdBowlPlanNode) as never, capabilities: commonCapabilities,
  parametrics: planParametrics,
  handles: [
    yardHandle<MfdBowlPlanNode>({ key: 'halfXYd', axis: 'x', minYd: 37.25, maxYd: 100, radial: true,
      position: (node) => [yardsToMetres(node.halfXYd), 0, 0] }),
    yardHandle<MfdBowlPlanNode>({ key: 'halfZYd', axis: 'z', minYd: 70, maxYd: 160, radial: true,
      position: (node) => [0, 0, yardsToMetres(node.halfZYd)] }),
    yardHandle<MfdBowlPlanNode>({ key: 'cornerRadiusYd', axis: 'x', minYd: 4, maxYd: 60, radial: true,
      position: (node) => [yardsToMetres(node.halfXYd - node.cornerRadiusYd), 0.3, yardsToMetres(node.halfZYd)] }),
  ],
  renderer: { kind: 'parametric', module: () => import('./renderer') },
  presentation: { label: 'Bowl plan', icon: { kind: 'iconify', name: 'lucide:circle-dashed' }, hidden: true },
}

export const mfdDeckProfileDefinition: NodeDefinition<typeof MfdDeckProfileNode> = {
  kind: 'mfd:deck-profile', schemaVersion: 1, schema: MfdDeckProfileNode, category: 'structure',
  defaults: defaultsOf(MfdDeckProfileNode) as never, capabilities: commonCapabilities,
  parametrics: deckParametrics,
  handles: [
    yardHandle<MfdDeckProfileNode>({ key: 'radialRunYd', axis: 'x', minYd: 0, maxYd: 40, radial: true,
      position: (node) => [yardsToMetres(node.radialRunYd), yardsToMetres(Math.max(0, node.riseYd)), 0] }),
    yardHandle<MfdDeckProfileNode>({ key: 'riseYd', axis: 'y', minYd: -80, maxYd: 60,
      position: (node) => [0, yardsToMetres(Math.max(0.25, node.riseYd)), 0] }),
  ],
  renderer: { kind: 'parametric', module: () => import('./renderer') },
  presentation: { label: 'Deck profile segment', icon: { kind: 'iconify', name: 'lucide:chart-no-axes-column-increasing' }, hidden: true },
}

export const mfdBowlOpeningDefinition: NodeDefinition<typeof MfdBowlOpeningNode> = {
  kind: 'mfd:bowl-opening', schemaVersion: 1, schema: MfdBowlOpeningNode, category: 'structure',
  defaults: defaultsOf(MfdBowlOpeningNode) as never, capabilities: commonCapabilities,
  parametrics: openingParametrics,
  renderer: { kind: 'parametric', module: () => import('./renderer') },
  presentation: { label: 'Bowl opening', icon: { kind: 'iconify', name: 'lucide:brackets' }, hidden: true },
}

export const mfdRoofDefinition: NodeDefinition<typeof MfdRoofNode> = {
  kind: 'mfd:roof', schemaVersion: 1, schema: MfdRoofNode, category: 'structure',
  defaults: defaultsOf(MfdRoofNode) as never, capabilities: commonCapabilities,
  parametrics: roofParametrics,
  handles: [yardHandle<MfdRoofNode>({ key: 'heightYd', axis: 'y', minYd: 0, maxYd: 100,
    position: (node) => [0, yardsToMetres(node.heightYd), 0] })],
  renderer: { kind: 'parametric', module: () => import('./renderer') },
  presentation: { label: 'Roof', icon: { kind: 'iconify', name: 'lucide:warehouse' }, hidden: true },
}

export const mfdTunnelDefinition: NodeDefinition<typeof MfdTunnelNode> = {
  kind: 'mfd:tunnel', schemaVersion: 1, schema: MfdTunnelNode, category: 'structure',
  defaults: defaultsOf(MfdTunnelNode) as never, capabilities: commonCapabilities,
  parametrics: tunnelParametrics,
  handles: [
    yardHandle<MfdTunnelNode>({ key: 'widthYd', axis: 'x', minYd: 0.5, maxYd: 20, radial: true,
      position: (node) => [yardsToMetres(node.widthYd / 2), yardsToMetres(node.heightYd / 2), 0] }),
    yardHandle<MfdTunnelNode>({ key: 'heightYd', axis: 'y', minYd: 1, maxYd: 12,
      position: (node) => [0, yardsToMetres(node.heightYd), 0] }),
  ],
  renderer: { kind: 'parametric', module: () => import('./renderer') },
  presentation: { label: 'Tunnel', icon: { kind: 'iconify', name: 'lucide:door-open' }, hidden: true },
}

export const mfdScoreboardDefinition: NodeDefinition<typeof MfdScoreboardNode> = {
  kind: 'mfd:scoreboard', schemaVersion: 1, schema: MfdScoreboardNode, category: 'structure',
  defaults: defaultsOf(MfdScoreboardNode) as never, capabilities: commonCapabilities,
  parametrics: scoreboardParametrics,
  handles: [
    yardHandle<MfdScoreboardNode>({ key: 'widthYd', axis: 'x', minYd: 2, maxYd: 80, radial: true,
      position: (node) => [yardsToMetres(node.widthYd / 2), yardsToMetres(node.elevationYd), 0] }),
    yardHandle<MfdScoreboardNode>({ key: 'heightYd', axis: 'y', minYd: 1, maxYd: 30,
      position: (node) => [0, yardsToMetres(node.elevationYd + node.heightYd / 2), 0] }),
    yardHandle<MfdScoreboardNode>({ key: 'elevationYd', axis: 'y', minYd: 1, maxYd: 80,
      position: (node) => [0, yardsToMetres(node.elevationYd), 0] }),
  ],
  renderer: { kind: 'parametric', module: () => import('./renderer') },
  presentation: { label: 'Scoreboard', icon: { kind: 'iconify', name: 'lucide:monitor-up' }, hidden: true },
}

export const mfdLightTowerDefinition: NodeDefinition<typeof MfdLightTowerNode> = {
  kind: 'mfd:light-tower', schemaVersion: 1, schema: MfdLightTowerNode, category: 'structure',
  defaults: defaultsOf(MfdLightTowerNode) as never, capabilities: commonCapabilities,
  parametrics: towerParametrics,
  handles: [yardHandle<MfdLightTowerNode>({ key: 'heightYd', axis: 'y', minYd: 12, maxYd: 100,
    position: (node) => [0, yardsToMetres(node.heightYd), 0] })],
  renderer: { kind: 'parametric', module: () => import('./renderer') },
  presentation: { label: 'Light tower', icon: { kind: 'iconify', name: 'lucide:lamp-wall-up' }, hidden: true },
}

export const mfdBannerDefinition: NodeDefinition<typeof MfdBannerNode> = {
  kind: 'mfd:banner', schemaVersion: 1, schema: MfdBannerNode, category: 'furnish',
  defaults: defaultsOf(MfdBannerNode) as never, capabilities: commonCapabilities,
  parametrics: bannerParametrics,
  handles: [
    yardHandle<MfdBannerNode>({ key: 'widthYd', axis: 'x', minYd: 0.5, maxYd: 30, radial: true,
      position: (node) => [yardsToMetres(node.widthYd / 2), yardsToMetres(node.elevationYd), 0] }),
    yardHandle<MfdBannerNode>({ key: 'elevationYd', axis: 'y', minYd: 0.5, maxYd: 80,
      position: (node) => [0, yardsToMetres(node.elevationYd), 0] }),
  ],
  renderer: { kind: 'parametric', module: () => import('./renderer') },
  presentation: { label: 'Banner', icon: { kind: 'iconify', name: 'lucide:flag-triangle-right' }, hidden: true },
}

export const mfdSkylinePropDefinition: NodeDefinition<typeof MfdSkylinePropNode> = {
  kind: 'mfd:skyline-prop', schemaVersion: 1, schema: MfdSkylinePropNode, category: 'furnish',
  defaults: defaultsOf(MfdSkylinePropNode) as never, capabilities: commonCapabilities,
  parametrics: skylineParametrics,
  handles: [
    yardHandle<MfdSkylinePropNode>({ key: 'sizeXYd', axis: 'x', minYd: 0.5, maxYd: 80, radial: true,
      position: (node) => [yardsToMetres(node.sizeXYd / 2), yardsToMetres(node.sizeYYd / 2), 0] }),
    yardHandle<MfdSkylinePropNode>({ key: 'sizeYYd', axis: 'y', minYd: 0.5, maxYd: 150,
      position: (node) => [0, yardsToMetres(node.sizeYYd), 0] }),
  ],
  renderer: { kind: 'parametric', module: () => import('./renderer') },
  presentation: { label: 'Skyline prop', icon: { kind: 'iconify', name: 'lucide:building-2' }, hidden: true },
}

export const MFD_STADIUM_NODE_DEFINITIONS: AnyNodeDefinition[] = [
  mfdStadiumRootDefinition,
  mfdFieldReferenceDefinition,
  mfdBowlPlanDefinition,
  mfdDeckProfileDefinition,
  mfdBowlOpeningDefinition,
  mfdRoofDefinition,
  mfdTunnelDefinition,
  mfdScoreboardDefinition,
  mfdLightTowerDefinition,
  mfdBannerDefinition,
  mfdSkylinePropDefinition,
] as unknown as AnyNodeDefinition[]
