/**
 * Type-only boundary to MFD's authoritative renderer contract. Nothing in this
 * module pulls Pascal into the game bundle or MFD renderer code into the browser.
 */
export type {
  MfdStadiumVisualV1,
  QualityTier,
  StadiumBudgetReceipt,
  StadiumComplexityEstimate,
  StadiumVisualValidationIssue,
} from '../../../src/render/stadiumVisual/types.ts'

export interface NativeStadiumDefinition {
  id: string
  name: string
  city: string
  roof: number
  surface: string
  tier: number
  crowdTint: string
  skyKind: string
  accent: string
}
