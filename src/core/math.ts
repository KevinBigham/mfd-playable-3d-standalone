/** Allocation-free math helpers. Sim code must not allocate in tick loops. */

export const TAU = Math.PI * 2;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
export function clamp01(v: number): number { return v < 0 ? 0 : v > 1 ? 1 : v; }
export function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
export function invLerp(a: number, b: number, v: number): number { return b === a ? 0 : (v - a) / (b - a); }
export function smoothstep(t: number): number { t = clamp01(t); return t * t * (3 - 2 * t); }
export function smootherstep(t: number): number { t = clamp01(t); return t * t * t * (t * (t * 6 - 15) + 10); }
export function sign(v: number): number { return v < 0 ? -1 : v > 0 ? 1 : 0; }

export function dist2(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz;
}
export function dist(ax: number, az: number, bx: number, bz: number): number {
  return Math.sqrt(dist2(ax, az, bx, bz));
}

/** Shortest signed angular difference b - a, in (-PI, PI]. */
export function angDelta(a: number, b: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d <= -Math.PI) d += TAU;
  return d;
}
export function angLerp(a: number, b: number, t: number): number { return a + angDelta(a, b) * t; }
/** Rotate `a` toward `b` by at most `maxStep`. */
export function angApproach(a: number, b: number, maxStep: number): number {
  const d = angDelta(a, b);
  return a + clamp(d, -maxStep, maxStep);
}
/** Heading of a vector where 0 = +Z. */
export function heading(x: number, z: number): number { return Math.atan2(x, z); }

export function approach(v: number, target: number, maxDelta: number): number {
  const d = target - v;
  if (d > maxDelta) return v + maxDelta;
  if (d < -maxDelta) return v - maxDelta;
  return target;
}

/** Exponential smoothing that is stable across variable dt. */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

/** Distance from point p to segment ab, in XZ. */
export function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const abx = bx - ax, abz = bz - az;
  const len2 = abx * abx + abz * abz;
  if (len2 < 1e-6) return dist(px, pz, ax, az);
  let t = ((px - ax) * abx + (pz - az) * abz) / len2;
  t = clamp01(t);
  return dist(px, pz, ax + abx * t, az + abz * t);
}

/** Deterministic 2D value noise, used for procedural surfaces (no RNG state). */
export function hash2(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function noise2(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = smoothstep(xf), v = smoothstep(yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}
export function fbm2(x: number, y: number, octaves = 4): number {
  let sum = 0, amp = 0.5, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise2(x * freq, y * freq) * amp; norm += amp; amp *= 0.5; freq *= 2;
  }
  return sum / norm;
}
