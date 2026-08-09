/** Exact international-yard conversion. MFD semantic data stays in yards. */
export const METRES_PER_YARD = 0.9144

export function yardsToMetres(yards: number): number {
  return yards * METRES_PER_YARD
}

export function metresToYards(metres: number): number {
  return metres / METRES_PER_YARD
}

export function roundYards(yards: number, precision = 0.25): number {
  return Math.round(yards / precision) * precision
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
