export interface FootPoint { x: number; y: number; z: number }

export const SOLE_SAMPLES = [-0.1325, -0.05, 0.06, 0.16, 0.2525] as const;
export const SOLE_DROP = -0.108;
/** Same fixed ball-of-foot contact used by the procedural run-cycle solve. */
export const PLANT_CONTACT_Z = 0.2525 * 0.67;

function transform(e: ArrayLike<number>, z: number): FootPoint {
  return { x: e[4] * SOLE_DROP + e[8] * z + e[12], y: e[5] * SOLE_DROP + e[9] * z + e[13], z: e[6] * SOLE_DROP + e[10] * z + e[14] };
}

export function solePointAt(e: ArrayLike<number>, z: number, out: FootPoint = { x: 0, y: 0, z: 0 }): FootPoint {
  const point = transform(e, z);
  out.x = point.x; out.y = point.y; out.z = point.z;
  return out;
}

/** Lowest sampled point of the cleat sole for the exact matrix used by the renderer probe. */
export function lowestSolePoint(e: ArrayLike<number>, out: FootPoint = { x: 0, y: 0, z: 0 }): FootPoint {
  let low = Infinity;
  for (const z of SOLE_SAMPLES) {
    const point = transform(e, z);
    if (point.y < low) { low = point.y; out.x = point.x; out.y = point.y; out.z = point.z; }
  }
  return out;
}

/** Lowest-sole displacement in yd/s for two consecutive planted-foot poses. */
export function plantedFootSlip(previous: ArrayLike<number>, current: ArrayLike<number>, previousY: number, currentY: number, tolerance = 0.012): number | null {
  const prevPoints = SOLE_SAMPLES.map((z) => transform(previous, z));
  const currPoints = SOLE_SAMPLES.map((z) => transform(current, z));
  const prevLow = lowestSolePoint(previous).y - previousY;
  const currLow = lowestSolePoint(current).y - currentY;
  if (prevLow > tolerance || currLow > tolerance) return null;
  let best = Infinity;
  for (let i = 0; i < SOLE_SAMPLES.length; i++) {
    const a = prevPoints[i], b = currPoints[i];
    best = Math.min(best, Math.hypot(b.x - a.x, b.z - a.z) * 60);
  }
  return best;
}
