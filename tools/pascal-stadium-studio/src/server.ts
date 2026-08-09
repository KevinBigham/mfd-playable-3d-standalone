import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { STADIUMS, getStadium } from '../../../src/data/stadiums.ts'
import {
  canonicalStadiumVisualJson,
  compileStadiumVisual,
  legacyVisualFromStadiumDef,
  stableStadiumVisualHash,
  stadiumVisualBudgetReceipt,
  validateStadiumVisual,
} from '../../../src/render/stadiumVisual/index.ts'
import { resolveStadiumVisual } from '../../../src/render/stadiumVisual/generatedRegistry.ts'
import type { MfdStadiumVisualV1, QualityTier } from './contract'
import { studioSceneToVisual, visualToStudioScene } from './scene-adapter'
import { THE_SALTPAN_NATIVE, THE_SALTPAN_SHOWCASE_VISUAL } from './showcase'

const TOOL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MFD_ROOT = resolve(TOOL_ROOT, '..', '..')
export const DEFAULT_STAGING_DIR = join(MFD_ROOT, '.stadium-staging')

export interface SemanticDiffEntry {
  path: string
  before: unknown
  after: unknown
}

export function semanticVisualDiff(before: unknown, after: unknown, path = '$'): SemanticDiffEntry[] {
  if (Object.is(before, after)) return []
  if (Array.isArray(before) && Array.isArray(after)) {
    const out: SemanticDiffEntry[] = []
    const count = Math.max(before.length, after.length)
    for (let index = 0; index < count; index++) {
      out.push(...semanticVisualDiff(before[index], after[index], `${path}[${index}]`))
    }
    return out
  }
  if (before && after && typeof before === 'object' && typeof after === 'object') {
    const left = before as Record<string, unknown>
    const right = after as Record<string, unknown>
    const keys = Array.from(new Set([...Object.keys(left), ...Object.keys(right)])).sort()
    return keys.flatMap((key) => semanticVisualDiff(left[key], right[key], `${path}.${key}`))
  }
  return [{ path, before, after }]
}

export function analyzeVisualCandidate(input: unknown) {
  const validation = validateStadiumVisual(input)
  if (!validation.ok) {
    return { ok: false as const, errors: validation.errors }
  }
  const visual = validation.value
  const qualities: QualityTier[] = ['LOW', 'MEDIUM', 'HIGH']
  const budgets = qualities.map((quality) => stadiumVisualBudgetReceipt(visual, quality))
  const compiled = qualities.map((quality) => compileStadiumVisual(visual, quality).estimate)
  const promoted = resolveStadiumVisual(visual.stadiumId)?.visual ?? null
  const allDiff = semanticVisualDiff(promoted, visual)
  const diff = allDiff.slice(0, 250)
  const details = {
    hash: stableStadiumVisualHash(visual),
    budgets,
    compiled,
    promotedHash: promoted ? stableStadiumVisualHash(promoted) : null,
    diff,
    diffTruncated: allDiff.length > diff.length,
  }
  const budgetErrors = budgets.flatMap((receipt) => receipt.violations.map((violation) => ({
    path: `budgets.${receipt.quality}.${violation.path}`,
    code: 'BUDGET',
    quality: receipt.quality,
    actual: violation.actual,
    limit: violation.limit,
    message: violation.message,
  })))
  if (budgetErrors.length > 0) return { ok: false as const, errors: budgetErrors, ...details }
  return { ok: true as const, errors: [] as const, ...details }
}

export function listLegacyDefinitions() {
  return STADIUMS.map((stadium) => {
    const visual = legacyVisualFromStadiumDef(stadium)
    return {
      stadium: {
        id: stadium.id,
        name: stadium.name,
        city: stadium.city,
        roof: stadium.roof,
        surface: stadium.surface,
        tier: stadium.tier,
        crowdTint: stadium.crowdTint,
        skyKind: stadium.skyKind,
        accent: stadium.accent,
      },
      visual,
      hash: stableStadiumVisualHash(visual),
    }
  })
}

function safeFileName(stadiumId: string): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(stadiumId)) {
    throw new Error(`unsafe stadiumId for staging path: ${stadiumId}`)
  }
  return `${stadiumId}.json`
}

export async function stageVisualToDirectory(
  input: unknown,
  directory: string,
): Promise<{ path: string; hash: string }> {
  const analysis = analyzeVisualCandidate(input)
  if (!analysis.ok) {
    throw new Error(analysis.errors.map((issue) => `${issue.path}: ${issue.message}`).join('\n'))
  }
  const visual = input as MfdStadiumVisualV1
  const outputPath = join(directory, safeFileName(visual.stadiumId))
  const tempPath = `${outputPath}.tmp-${process.pid}`
  await mkdir(directory, { recursive: true })
  try {
    const canonical = JSON.parse(canonicalStadiumVisualJson(visual)) as MfdStadiumVisualV1
    canonical.authoring = { ...canonical.authoring, exportedAt: new Date().toISOString() }
    await writeFile(tempPath, `${JSON.stringify(canonical, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    await rename(tempPath, outputPath)
  } finally {
    await rm(tempPath, { force: true })
  }
  return { path: outputPath, hash: analysis.hash }
}

export async function stageVisualCandidate(input: unknown) {
  return stageVisualToDirectory(input, DEFAULT_STAGING_DIR)
}

/**
 * Deterministic proof that the committed showcase passed through Pascal scene
 * nodes and back through the studio adapter before staging.
 */
export async function exportCommittedSaltpanShowcase(directory = DEFAULT_STAGING_DIR) {
  const scene = visualToStudioScene(THE_SALTPAN_SHOWCASE_VISUAL, THE_SALTPAN_NATIVE, 'showcase')
  const adapted = studioSceneToVisual(scene.nodes)
  if (!adapted.ok) {
    throw new Error(adapted.errors.map((issue) => `${issue.path}: ${issue.message}`).join('\n'))
  }
  return stageVisualToDirectory(adapted.value, directory)
}

export async function readStagedVisual(stadiumId: string): Promise<MfdStadiumVisualV1 | null> {
  try {
    return JSON.parse(await readFile(join(DEFAULT_STAGING_DIR, safeFileName(stadiumId)), 'utf8')) as MfdStadiumVisualV1
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export function sceneForLegacyStadium(stadiumId: string) {
  const stadium = getStadium(stadiumId)
  return visualToStudioScene(legacyVisualFromStadiumDef(stadium), stadium, 'legacy')
}
