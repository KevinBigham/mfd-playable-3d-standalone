import type { MfdStadiumVisualV1 } from './types.ts';

function canonicalValue(value: unknown, parentKey = ''): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalValue(item));
  if (typeof value === 'number') return Object.is(value, -0) ? 0 : value;
  if (typeof value !== 'object' || value === null) return value;

  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    if (parentKey === 'authoring' && key === 'exportedAt') continue;
    if (source[key] !== undefined) out[key] = canonicalValue(source[key], key);
  }
  return out;
}

/** Stable, compact JSON. Object keys are sorted; array order remains semantic. */
export function canonicalStadiumVisualJson(visual: MfdStadiumVisualV1): string {
  return JSON.stringify(canonicalValue(visual));
}

/** Pure FNV-1a 64-bit hash so runtime code needs neither Node crypto nor a browser API. */
export function stableStadiumVisualHash(visual: MfdStadiumVisualV1): string {
  const text = canonicalStadiumVisualJson(visual);
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  // Hash UTF-8 bytes, not UTF-16 code units, so authoring metadata is portable across hosts.
  for (const char of text) {
    const cp = char.codePointAt(0)!;
    const bytes = cp <= 0x7f ? [cp]
      : cp <= 0x7ff ? [0xc0 | (cp >> 6), 0x80 | (cp & 0x3f)]
        : cp <= 0xffff
          ? [0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f)]
          : [0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f)];
    for (const byte of bytes) {
      hash ^= BigInt(byte);
      hash = (hash * prime) & mask;
    }
  }
  return `v1-fnv1a64-${hash.toString(16).padStart(16, '0')}`;
}
