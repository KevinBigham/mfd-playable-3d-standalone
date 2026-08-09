'use client'

import {
  clearSceneHistory,
  emitter,
  type AnyNode,
  type AnyNodeId,
  useLiveNodeOverrides,
  useLiveTransforms,
  useScene,
} from '@pascal-app/core'
import { useSelection } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { MfdStadiumVisualV1, NativeStadiumDefinition } from './contract'
import {
  applyStadiumPreset,
  STADIUM_PRESET_LABELS,
  type StadiumPresetId,
} from './presets'
import {
  cameraNodeId,
  studioNodesFromPascal,
  studioSceneToVisual,
  visualToStudioScene,
} from './scene-adapter'
import { THE_SALTPAN_NATIVE, THE_SALTPAN_SHOWCASE_VISUAL } from './showcase'
import {
  budgetStatusRows,
  isStageDisabled,
  type NativeAnalysisPayload,
} from './budget-presentation'
import {
  MFD_NODE_SCHEMAS,
  MFD_STADIUM_KINDS,
  type MfdStadiumRootNode,
} from './nodes/schemas'

interface LegacyDefinition {
  stadium: NativeStadiumDefinition
  visual: MfdStadiumVisualV1
  hash: string
}

const panelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  padding: 14,
  fontSize: 12,
  overflowY: 'auto',
  height: '100%',
}

const sectionStyle: React.CSSProperties = {
  display: 'grid',
  gap: 7,
  padding: 10,
  border: '1px solid color-mix(in srgb, currentColor 18%, transparent)',
  borderRadius: 8,
}

const buttonStyle: React.CSSProperties = {
  border: '1px solid color-mix(in srgb, currentColor 25%, transparent)',
  borderRadius: 6,
  padding: '6px 8px',
  background: 'color-mix(in srgb, currentColor 7%, transparent)',
  cursor: 'pointer',
  textAlign: 'left',
}

function sceneContext(graph: { nodes: Record<string, unknown> }) {
  const entries = Object.values(graph.nodes) as Array<{ id?: string; type?: string }>
  return {
    buildingId: entries.find((node) => node.type === 'building')?.id ?? null,
    levelId: entries.find((node) => node.type === 'level')?.id ?? null,
    rootId: entries.find((node) => node.type === MFD_STADIUM_KINDS.root)?.id ?? null,
  }
}

function activateGraph(graph: ReturnType<typeof visualToStudioScene>, resetHistory: boolean) {
  const context = sceneContext(graph)
  useScene.getState().setScene(
    graph.nodes as Record<AnyNodeId, AnyNode>,
    graph.rootNodeIds as AnyNodeId[],
    { installedPlugins: graph.installedPlugins },
  )
  if (resetHistory) clearSceneHistory()
  useViewer.getState().setSelection({
    buildingId: context.buildingId as AnyNodeId | null,
    levelId: context.levelId as AnyNodeId | null,
    zoneId: null,
    selectedIds: context.rootId ? [context.rootId as AnyNodeId] : [],
  } as never)
}

function refreshAfterHistoryJump() {
  useLiveNodeOverrides.getState().clearAll()
  useLiveTransforms.getState().clearAll()
  const state = useScene.getState()
  Object.values(state.nodes).forEach((node) => state.markDirty(node.id))
}

async function api<T>(body?: unknown): Promise<T> {
  const response = await fetch('/api/mfd-stadium-studio', body === undefined
    ? undefined
    : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const payload = await response.json() as T & { error?: string }
  if (!response.ok) throw new Error(payload.error ?? `Studio host adapter returned ${response.status}`)
  return payload
}

function inheritedDefinition(root: MfdStadiumRootNode): NativeStadiumDefinition {
  return {
    id: root.stadiumId,
    name: root.inheritedName,
    city: root.inheritedCity,
    roof: root.inheritedRoofCategory,
    surface: root.inheritedSurface,
    tier: 0,
    crowdTint: root.inheritedCrowdTint,
    skyKind: root.inheritedSkyKind,
    accent: root.inheritedAccent,
  }
}

export default function StadiumStudioPanel() {
  const nodes = useScene((state) => state.nodes)
  const selection = useSelection()
  const [legacy, setLegacy] = useState<LegacyDefinition[]>([])
  const [venueId, setVenueId] = useState('the-saltpan')
  const [analysis, setAnalysis] = useState<NativeAnalysisPayload | null>(null)
  const [hostError, setHostError] = useState<string | null>(null)
  const [status, setStatus] = useState('Ready')

  const adapted = useMemo(() => studioSceneToVisual(studioNodesFromPascal(nodes)), [nodes])
  const root = useMemo(
    () => Object.values(nodes).find((node) => (node as unknown as { type: string }).type === MFD_STADIUM_KINDS.root) as unknown as MfdStadiumRootNode | undefined,
    [nodes],
  )

  useEffect(() => {
    let cancelled = false
    api<{ legacy: LegacyDefinition[] }>().then((payload) => {
      if (!cancelled) setLegacy(payload.legacy)
    }).catch((error: unknown) => {
      if (!cancelled) setHostError(error instanceof Error ? error.message : String(error))
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!adapted.ok) {
      setAnalysis(null)
      return
    }
    // Never leave an earlier valid receipt stageable while the edited scene is awaiting analysis.
    setAnalysis(null)
    let cancelled = false
    const timer = window.setTimeout(() => {
      api<NativeAnalysisPayload>({ action: 'analyze', visual: adapted.value }).then((payload) => {
        if (!cancelled) { setAnalysis(payload); setHostError(null) }
      }).catch((error: unknown) => {
        if (!cancelled) setHostError(error instanceof Error ? error.message : String(error))
      })
    }, 250)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [adapted])

  const importDefinition = useCallback((definition: LegacyDefinition, resetHistory = true) => {
    activateGraph(visualToStudioScene(definition.visual, definition.stadium, 'legacy'), resetHistory)
    setVenueId(definition.stadium.id)
    setStatus(`Imported locked native definition: ${definition.stadium.name}`)
  }, [])

  const loadShowcase = useCallback(() => {
    activateGraph(visualToStudioScene(THE_SALTPAN_SHOWCASE_VISUAL, THE_SALTPAN_NATIVE, 'showcase'), true)
    setVenueId('the-saltpan')
    setStatus('Loaded committed Pascal semantic showcase')
  }, [])

  const applyPreset = useCallback((preset: StadiumPresetId) => {
    if (!adapted.ok || !root) return
    const next = applyStadiumPreset(adapted.value, preset)
    activateGraph(visualToStudioScene(next, inheritedDefinition(root), 'preset'), false)
    setStatus(`Applied ${STADIUM_PRESET_LABELS[preset]} (one undo step)`)
  }, [adapted, root])

  const addNode = useCallback((kind: keyof typeof MFD_NODE_SCHEMAS) => {
    if (!root) return
    if (kind === MFD_STADIUM_KINDS.roof && Object.values(nodes).some((node) => (node as unknown as { type: string }).type === kind)) {
      setHostError('The scene already has a roof; select it in Scene instead of adding another.')
      return
    }
    const schema = MFD_NODE_SCHEMAS[kind]
    const base: Record<string, unknown> = { parentId: root.id }
    if (kind === MFD_STADIUM_KINDS.deckProfile) {
      const orders = Object.values(nodes)
        .filter((node) => (node as unknown as { type: string }).type === kind)
        .map((node) => Number((node as unknown as { order?: number }).order ?? -1))
      base.order = Math.max(-1, ...orders) + 1
    }
    const node = schema.parse(base) as unknown as AnyNode
    useScene.getState().createNode(node, root.id as AnyNodeId)
    useViewer.getState().setSelection({ selectedIds: [node.id] })
    setStatus(`Added semantic ${kind}`)
  }, [nodes, root])

  const exportStage = useCallback(async () => {
    if (!adapted.ok) return
    setStatus('Validating with native compiler…')
    try {
      const result = await api<{ path: string; hash: string }>({ action: 'stage', visual: adapted.value })
      setStatus(`Staged ${result.path} · ${result.hash}`)
      setHostError(null)
    } catch (error) {
      setHostError(error instanceof Error ? error.message : String(error))
      setStatus('Stage export rejected')
    }
  }, [adapted])

  const view = useCallback((preset: 'top' | 'perspective' | 'end' | 'side') => {
    const id = cameraNodeId(nodes as unknown as Record<string, unknown>, preset)
    if (id) {
      useViewer.getState().setCameraMode(preset === 'top' ? 'orthographic' : 'perspective')
      emitter.emit('camera-controls:view', { nodeId: id as AnyNodeId })
    }
  }, [nodes])

  const localErrors = adapted.ok ? [] : adapted.errors
  const nativeErrors = analysis?.errors ?? []
  const hasErrors = localErrors.length > 0 || nativeErrors.length > 0 || Boolean(hostError)
  const budgetRows = budgetStatusRows(analysis)
  const stageDisabled = isStageDisabled({
    adaptedOk: adapted.ok,
    analysis,
    localErrorCount: localErrors.length,
    hostError,
  })

  return (
    <div style={panelStyle}>
      <div>
        <div style={{ fontSize: 15, fontWeight: 700 }}>MFD Stadium Visual Studio</div>
        <div style={{ opacity: 0.68 }}>Football semantics in yards · Pascal viewport in metres</div>
      </div>

      <section style={sectionStyle}>
        <strong>Venue import (18 locked native definitions)</strong>
        <select value={venueId} onChange={(event) => setVenueId(event.target.value)}>
          {(legacy.length ? legacy : [{ stadium: THE_SALTPAN_NATIVE } as LegacyDefinition]).map((entry) => (
            <option key={entry.stadium.id} value={entry.stadium.id}>{entry.stadium.name}</option>
          ))}
        </select>
        <button style={buttonStyle} type="button" onClick={() => {
          const entry = legacy.find((item) => item.stadium.id === venueId)
          if (entry) importDefinition(entry)
        }}>Import legacy semantic definition</button>
        <button style={buttonStyle} type="button" onClick={loadShowcase}>Load committed The Saltpan showcase</button>
      </section>

      {root && (
        <section style={sectionStyle}>
          <strong>Inherited from StadiumDef · locked</strong>
          <span>{root.inheritedName} · {root.inheritedCity}</span>
          <span>ID {root.stadiumId} · surface {root.inheritedSurface} · sky {root.inheritedSkyKind}</span>
          <span>roof category {root.inheritedRoofCategory} · crowd {root.inheritedCrowdTint} · accent {root.inheritedAccent}</span>
        </section>
      )}

      <section style={sectionStyle}>
        <strong>Supported camera presets</strong>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
          <button style={buttonStyle} type="button" onClick={() => view('perspective')}>Perspective</button>
          <button style={buttonStyle} type="button" onClick={() => view('top')}>Top · orthographic</button>
          <button style={buttonStyle} type="button" onClick={() => view('end')}>End zone</button>
          <button style={buttonStyle} type="button" onClick={() => view('side')}>Sideline</button>
        </div>
      </section>

      <section style={sectionStyle}>
        <strong>History</strong>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
          <button style={buttonStyle} type="button" onClick={() => {
            useScene.temporal.getState().undo(); refreshAfterHistoryJump(); setStatus('Undo')
          }}>Undo · ⌘Z</button>
          <button style={buttonStyle} type="button" onClick={() => {
            useScene.temporal.getState().redo(); refreshAfterHistoryJump(); setStatus('Redo')
          }}>Redo · ⇧⌘Z</button>
        </div>
        <span>Selected: {selection.selectedNode?.type ?? 'none'} · use the native right Inspector and in-world handles.</span>
      </section>

      <section style={sectionStyle}>
        <strong>Safe presets</strong>
        {(Object.keys(STADIUM_PRESET_LABELS) as StadiumPresetId[]).map((preset) => {
          const incompatibleRoof = (preset === 'half-canopy' && root?.inheritedRoofCategory !== 1)
            || (preset === 'dome' && root?.inheritedRoofCategory !== 2)
          return (
          <button key={preset} style={buttonStyle} type="button" disabled={!adapted.ok || incompatibleRoof} onClick={() => applyPreset(preset)}>
            {STADIUM_PRESET_LABELS[preset]}
          </button>
          )
        })}
      </section>

      <section style={sectionStyle}>
        <strong>Add semantic feature</strong>
        {([
          MFD_STADIUM_KINDS.deckProfile,
          MFD_STADIUM_KINDS.bowlOpening,
          MFD_STADIUM_KINDS.roof,
          MFD_STADIUM_KINDS.tunnel,
          MFD_STADIUM_KINDS.scoreboard,
          MFD_STADIUM_KINDS.lightTower,
          MFD_STADIUM_KINDS.banner,
          MFD_STADIUM_KINDS.skylineProp,
        ] as const).map((kind) => (
          <button key={kind} style={buttonStyle} type="button" disabled={!root} onClick={() => addNode(kind)}>
            + {kind.replace('mfd:', '')}
          </button>
        ))}
      </section>

      <section style={{ ...sectionStyle, borderColor: hasErrors ? '#d54d62' : '#3b9d77' }}>
        <strong>{hasErrors ? 'Validation / budget errors' : analysis?.ok ? 'Native validation + all budgets · valid' : 'Native validation · pending'}</strong>
        {hostError && <div style={{ color: '#d54d62', whiteSpace: 'pre-wrap' }}>{hostError}</div>}
        {[...localErrors, ...nativeErrors].map((error, index) => (
          <div key={`${error.path}-${index}`} style={{ color: '#d54d62' }}>
            <code>{error.path}</code> · {error.message}
          </div>
        ))}
        {analysis?.hash && (
          <>
            <code>{analysis.hash}</code>
            {(analysis.compiled ?? []).map((estimate) => (
              <span key={estimate.quality}>
                {estimate.quality}: {estimate.triangles.toLocaleString()} tri · {estimate.drawCalls} batches · {estimate.semanticElements} elements · crowd {estimate.crowdCapacity.toLocaleString()}
              </span>
            ))}
            <strong>LOW / MEDIUM / HIGH budget receipts</strong>
            {budgetRows.map((budget) => (
              <div key={budget.quality} style={{ display: 'grid', gap: 3, color: budget.passed ? '#3b9d77' : '#d54d62' }}>
                <strong>{budget.quality} · {budget.passed ? 'PASS' : 'FAIL'}</strong>
                <span>{budget.summary}</span>
                {budget.violations.map((message, index) => <span key={index}>Violation · {message}</span>)}
              </div>
            ))}
            <span>Diff against promoted: {analysis.diff?.length ?? 0}{analysis.diffTruncated ? '+' : ''} paths · promoted {analysis.promotedHash ?? 'legacy fallback'}</span>
            {(analysis.diff ?? []).slice(0, 8).map((entry) => <code key={entry.path}>{entry.path}</code>)}
          </>
        )}
      </section>

      <button
        style={{ ...buttonStyle, background: stageDisabled ? '#6b2f37' : '#176b54', color: '#fff' }}
        type="button"
        disabled={stageDisabled}
        onClick={exportStage}
      >Validate + export to ignored staging</button>
      <div style={{ opacity: 0.72, whiteSpace: 'pre-wrap' }}>{status}</div>
      <div style={{ opacity: 0.55 }}>
        The protected field/envelope is nonselectable and never exported. Promotion remains a separate MFD command.
      </div>
    </div>
  )
}
