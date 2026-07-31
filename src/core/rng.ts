/**
 * Deterministic RNG — xoshiro128** with a splitmix32 seeder.
 * The only source of randomness allowed inside deterministic layers.
 */
export class Rng {
  private s0 = 0; private s1 = 0; private s2 = 0; private s3 = 0;

  constructor(seed = 1) { this.reseed(seed); }

  reseed(seed: number): void {
    let x = (seed >>> 0) || 0x9e3779b9;
    const next = () => {
      x = (x + 0x9e3779b9) >>> 0;
      let z = x;
      z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
      z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
      return (z ^ (z >>> 15)) >>> 0;
    };
    this.s0 = next(); this.s1 = next(); this.s2 = next(); this.s3 = next();
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) this.s0 = 1;
    for (let i = 0; i < 12; i++) this.u32();
  }

  u32(): number {
    const r = (Math.imul(this.s1 * 5, 1) >>> 0);
    const result = (((r << 7) | (r >>> 25)) * 9) >>> 0;
    const t = (this.s1 << 9) >>> 0;
    this.s2 ^= this.s0; this.s3 ^= this.s1; this.s1 ^= this.s2; this.s0 ^= this.s3;
    this.s2 ^= t;
    this.s3 = ((this.s3 << 11) | (this.s3 >>> 21)) >>> 0;
    return result >>> 0;
  }

  /** [0,1) */
  next(): number { return this.u32() / 4294967296; }
  /** [min,max) */
  range(min: number, max: number): number { return min + this.next() * (max - min); }
  /** integer in [min,max] */
  int(min: number, max: number): number { return min + Math.floor(this.next() * (max - min + 1)); }
  /** true with probability p */
  chance(p: number): boolean { return this.next() < p; }
  /** -spread..+spread, triangular (centre-biased) */
  spread(spread: number): number { return (this.next() + this.next() - 1) * spread; }
  pick<T>(arr: readonly T[]): T { return arr[Math.floor(this.next() * arr.length) % arr.length]; }
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  /** Normal-ish sample, mean 0, sd ~1 */
  gauss(): number { return (this.next() + this.next() + this.next() + this.next() - 2) * 1.1; }

  save(): [number, number, number, number] { return [this.s0, this.s1, this.s2, this.s3]; }
  load(s: [number, number, number, number]): void { this.s0 = s[0]; this.s1 = s[1]; this.s2 = s[2]; this.s3 = s[3]; }
}

/** Stable string hash → seed. */
export function hashSeed(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
