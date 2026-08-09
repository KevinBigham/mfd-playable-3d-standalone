export interface NativeAnalysisIssue {
  path: string
  code: string
  message: string
  actual?: number
  limit?: number
  quality?: string
}

export interface NativeBudgetReceipt {
  quality: string
  passed: boolean
  triangleRatio: number
  addedMaterialBatches: number
  authored: {
    triangles: number
    materialBatches: number
    semanticElements: number
  }
  violations: Array<{ path: string; actual: number; limit: number; message: string }>
}

export interface NativeAnalysisPayload {
  ok: boolean
  errors: readonly NativeAnalysisIssue[]
  hash?: string
  promotedHash?: string | null
  compiled?: Array<{
    quality: string
    triangles: number
    drawCalls: number
    semanticElements: number
    crowdCapacity: number
  }>
  budgets?: NativeBudgetReceipt[]
  diff?: Array<{ path: string; before: unknown; after: unknown }>
  diffTruncated?: boolean
}

export interface BudgetStatusRow {
  quality: string
  passed: boolean
  summary: string
  violations: string[]
}

/** Pure panel view model, kept testable without a DOM or Pascal host. */
export function budgetStatusRows(analysis: NativeAnalysisPayload | null): BudgetStatusRow[] {
  return (analysis?.budgets ?? []).map((budget) => ({
    quality: budget.quality,
    passed: budget.passed,
    summary: `${budget.authored.triangles.toLocaleString()} tri · ${budget.authored.materialBatches} batches · ${budget.authored.semanticElements} elements · ${(budget.triangleRatio * 100).toFixed(1)}% legacy triangles · ${budget.addedMaterialBatches >= 0 ? '+' : ''}${budget.addedMaterialBatches} batches`,
    violations: budget.violations.map((violation) => violation.message),
  }))
}

export function isStageDisabled(input: {
  adaptedOk: boolean
  analysis: NativeAnalysisPayload | null
  localErrorCount: number
  hostError: string | null
}): boolean {
  return !input.adaptedOk || input.analysis?.ok !== true || input.localErrorCount > 0 || Boolean(input.hostError)
}
