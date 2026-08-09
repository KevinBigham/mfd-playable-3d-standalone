import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  stableStadiumVisualHash,
  stadiumPerimeterPoint as nativePerimeterPoint,
  validateStadiumVisual,
} from '../../../src/render/stadiumVisual/index.ts'
import { MFD_STADIUM_NODE_DEFINITIONS } from '../src/nodes/definitions'
import { MFD_STADIUM_KINDS } from '../src/nodes/schemas'
import { applyStadiumPreset, type StadiumPresetId } from '../src/presets'
import { stadiumPerimeterPoint as studioPerimeterPoint } from '../src/perimeter'
import {
  cameraNodeId,
  studioSceneToVisual,
  visualToStudioScene,
} from '../src/scene-adapter'
import {
  analyzeVisualCandidate,
  exportCommittedSaltpanShowcase,
  listLegacyDefinitions,
  semanticVisualDiff,
} from '../src/server'
import { THE_SALTPAN_NATIVE, THE_SALTPAN_SHOWCASE_VISUAL } from '../src/showcase'
import { metresToYards, yardsToMetres } from '../src/units'

const TOOL_ROOT = resolve(import.meta.dirname, '..')

describe('official Pascal plugin surface', () => {
  it('registers every required football-semantic kind once', () => {
    const kinds = MFD_STADIUM_NODE_DEFINITIONS.map((definition) => definition.kind)
    expect(new Set(kinds).size).toBe(kinds.length)
    expect([...kinds].sort()).toEqual([...Object.values(MFD_STADIUM_KINDS)].sort())
    expect(MFD_STADIUM_NODE_DEFINITIONS.every((definition) => definition.schemaVersion === 1)).toBe(true)
  })

  it('uses the exact yard/metre adapter at all Pascal boundaries', () => {
    expect(yardsToMetres(1)).toBe(0.9144)
    expect(metresToYards(0.9144)).toBe(1)
    expect(metresToYards(yardsToMetres(132.25))).toBeCloseTo(132.25, 12)
  })

  it('keeps the browser-safe bowl perimeter mirror in native parity', () => {
    const plan = THE_SALTPAN_SHOWCASE_VISUAL.bowl
    for (const t of [0, 0.1, 0.25, 0.49, 0.75, 0.999]) {
      expect(studioPerimeterPoint(plan, t)).toEqual(nativePerimeterPoint(plan, t))
    }
  })
})

describe('committed semantic showcase', () => {
  const scene = visualToStudioScene(THE_SALTPAN_SHOWCASE_VISUAL, THE_SALTPAN_NATIVE, 'showcase')

  it('round-trips through Pascal nodes into valid native yard JSON', () => {
    const adapted = studioSceneToVisual(scene.nodes)
    expect(adapted.ok).toBe(true)
    if (!adapted.ok) return
    const validation = validateStadiumVisual(adapted.value)
    expect(validation).toEqual(expect.objectContaining({ ok: true }))
    expect(adapted.value.stadiumId).toBe('the-saltpan')
    expect(adapted.value.units).toBe('yards')
    expect(adapted.value.bowl.openings).toEqual([{ startT: 0.43, endT: 0.57 }])
  })

  it('keeps field/protected references and all four camera presets non-exported', () => {
    expect(cameraNodeId(scene.nodes, 'top')).toBeTruthy()
    expect(cameraNodeId(scene.nodes, 'perspective')).toBeTruthy()
    expect(cameraNodeId(scene.nodes, 'end')).toBeTruthy()
    expect(cameraNodeId(scene.nodes, 'side')).toBeTruthy()
    const top = scene.nodes[cameraNodeId(scene.nodes, 'top')!] as { camera: { mode: string; position: number[] } }
    expect(top.camera.mode).toBe('orthographic')
    expect(top.camera.position[1]).toBeGreaterThan(100)
    const adapted = studioSceneToVisual(scene.nodes)
    expect(adapted.ok).toBe(true)
    if (!adapted.ok) return
    expect(JSON.stringify(adapted.value)).not.toContain('fieldHalfWidthYd')
    expect(JSON.stringify(adapted.value)).not.toContain('cameraPreset')
    expect(JSON.stringify(adapted.value)).not.toContain('protectedEnvelope')
    expect(JSON.stringify(adapted.value)).not.toContain('cameraLaneHalfWidthYd')
    expect(JSON.stringify(adapted.value)).not.toContain('goalCrossbarYd')
  })

  it('passes native LOW/MEDIUM/HIGH compiler budgets and has a stable volatile-free hash', () => {
    const adapted = studioSceneToVisual(scene.nodes)
    expect(adapted.ok).toBe(true)
    if (!adapted.ok) return
    const analysis = analyzeVisualCandidate(adapted.value)
    expect(analysis.ok).toBe(true)
    if (!analysis.ok) return
    expect(analysis.budgets.map((receipt) => receipt.passed)).toEqual([true, true, true])
    expect(analysis.compiled.map((receipt) => receipt.quality)).toEqual(['LOW', 'MEDIUM', 'HIGH'])
    const changedTimestamp = {
      ...adapted.value,
      authoring: { ...adapted.value.authoring, exportedAt: '2099-01-01T00:00:00.000Z' },
    }
    expect(stableStadiumVisualHash(changedTimestamp)).toBe(stableStadiumVisualHash(adapted.value))
    const changed = structuredClone(adapted.value)
    changed.bowl.aisleEvery += 1
    expect(semanticVisualDiff(adapted.value, changed)).toEqual([
      { path: '$.bowl.aisleEvery', before: adapted.value.bowl.aisleEvery, after: changed.bowl.aisleEvery },
    ])
  })

  it('surfaces native protected-field violations before staging', () => {
    const invalid = structuredClone(THE_SALTPAN_SHOWCASE_VISUAL)
    invalid.bowl.halfX = 37.01
    const validation = validateStadiumVisual(invalid)
    expect(validation.ok).toBe(false)
    if (!validation.ok) expect(validation.errors.some((issue) => issue.code === 'PROTECTED_VOLUME')).toBe(true)
  })

  it('writes only a canonical stadium-id file in an explicit staging directory', async () => {
    const directory = await mkdtemp(join(TOOL_ROOT, 'staging-test-'))
    try {
      const receipt = await exportCommittedSaltpanShowcase(directory)
      expect(receipt.path).toBe(join(directory, 'the-saltpan.json'))
      const staged = JSON.parse(await readFile(receipt.path, 'utf8'))
      expect(validateStadiumVisual(staged).ok).toBe(true)
      expect(stableStadiumVisualHash(staged)).toBe(receipt.hash)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})

describe('legacy imports and presets', () => {
  it('imports all 18 native venues into semantic Pascal scenes', () => {
    const legacy = listLegacyDefinitions()
    expect(legacy).toHaveLength(18)
    for (const definition of legacy) {
      const scene = visualToStudioScene(definition.visual, definition.stadium, 'legacy')
      const adapted = studioSceneToVisual(scene.nodes)
      expect(adapted.ok, definition.stadium.id).toBe(true)
      if (adapted.ok) expect(validateStadiumVisual(adapted.value).ok, definition.stadium.id).toBe(true)
    }
  })

  it('keeps every safe preset constrained; roof presets are valid for compatible venues', () => {
    const simplePresets: StadiumPresetId[] = [
      'compact-single-deck',
      'large-double-deck',
      'open-end-bowl',
      'giant-end-zone-scoreboard',
      'sparse-low-quality-exterior',
    ]
    for (const preset of simplePresets) {
      const result = applyStadiumPreset(THE_SALTPAN_SHOWCASE_VISUAL, preset)
      expect(validateStadiumVisual(result).ok, preset).toBe(true)
    }
    const legacy = listLegacyDefinitions()
    const canopy = legacy.find((entry) => entry.stadium.roof === 1)!
    const dome = legacy.find((entry) => entry.stadium.roof === 2)!
    expect(validateStadiumVisual(applyStadiumPreset(canopy.visual, 'half-canopy')).ok).toBe(true)
    expect(validateStadiumVisual(applyStadiumPreset(dome.visual, 'dome')).ok).toBe(true)
  })
})
