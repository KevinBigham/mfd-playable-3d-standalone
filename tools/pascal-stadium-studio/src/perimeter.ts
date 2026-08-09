export interface RoundedBowlPlan {
  centerZ: number
  halfX: number
  halfZ: number
  cornerRadius: number
  aisleEvery?: number
  profile?: unknown[]
}

export interface PerimeterPoint {
  x: number
  z: number
  nx: number
  nz: number
  tx: number
  tz: number
}

/**
 * Browser-safe mirror of MFD's rounded-plan arc-length parameterization.
 * A parity test guards this small rendering-boundary copy against native drift.
 */
export function stadiumPerimeterPoint(plan: RoundedBowlPlan, perimeterT: number): PerimeterPoint {
  const r = plan.cornerRadius
  const sx = plan.halfX - r
  const sz = plan.halfZ - r
  const straightX = 2 * sx
  const straightZ = 2 * sz
  const arc = (Math.PI / 2) * r
  const perimeter = 2 * straightX + 2 * straightZ + 4 * arc
  let d = Math.min(1, Math.max(0, perimeterT)) * perimeter
  let x = 0; let z = 0; let nx = 0; let nz = 0

  if (d < straightZ) {
    x = plan.halfX; z = -sz + d; nx = 1
  } else if ((d -= straightZ) < arc) {
    const a = d / r
    x = sx + Math.cos(a) * r; z = sz + Math.sin(a) * r
    nx = Math.cos(a); nz = Math.sin(a)
  } else if ((d -= arc) < straightX) {
    x = sx - d; z = plan.halfZ; nz = 1
  } else if ((d -= straightX) < arc) {
    const a = d / r + Math.PI / 2
    x = -sx + Math.cos(a) * r; z = sz + Math.sin(a) * r
    nx = Math.cos(a); nz = Math.sin(a)
  } else if ((d -= arc) < straightZ) {
    x = -plan.halfX; z = sz - d; nx = -1
  } else if ((d -= straightZ) < arc) {
    const a = d / r + Math.PI
    x = -sx + Math.cos(a) * r; z = -sz + Math.sin(a) * r
    nx = Math.cos(a); nz = Math.sin(a)
  } else if ((d -= arc) < straightX) {
    x = -sx + d; z = -plan.halfZ; nz = -1
  } else {
    const a = (d - straightX) / r + Math.PI * 1.5
    x = sx + Math.cos(a) * r; z = -sz + Math.sin(a) * r
    nx = Math.cos(a); nz = Math.sin(a)
  }
  return { x, z: z + plan.centerZ, nx, nz, tx: -nz, tz: nx }
}
