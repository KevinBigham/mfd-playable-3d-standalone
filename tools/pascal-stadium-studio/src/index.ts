import type { AnyNodeDefinition, Plugin } from '@pascal-app/core'
import type { EditorHostPanel } from '@pascal-app/editor'
import { MFD_STADIUM_NODE_DEFINITIONS } from './nodes/definitions'

export const mfdStadiumPlugin: Plugin = {
  id: 'mfd:stadium-visual-studio',
  apiVersion: 1,
  nodes: MFD_STADIUM_NODE_DEFINITIONS as AnyNodeDefinition[],
}

export const mfdStadiumHostPanel: EditorHostPanel = {
  id: 'mfd:stadium-visual-studio:panel',
  label: 'MFD Stadium',
  icon: { kind: 'iconify', name: 'lucide:landmark' },
  component: () => import('./panel'),
  kinds: MFD_STADIUM_NODE_DEFINITIONS.map((definition) => definition.kind),
  pluginId: mfdStadiumPlugin.id,
  description: 'Constrained football-semantic stadium authoring and staging for MFD.',
  creator: { name: 'MFD contributors' },
  defaultInstalled: true,
}

export { MFD_STADIUM_NODE_DEFINITIONS } from './nodes/definitions'
export * from './nodes/schemas'
export * from './scene-adapter'
export * from './showcase'
export * from './perimeter'
export * from './preview-coordinates'
export * from './budget-presentation'
export * from './units'
