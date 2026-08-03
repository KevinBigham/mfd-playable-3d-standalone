import * as THREE from 'three';
import type { TeamColors, TeamDef } from '../core/types.ts';

/**
 * Kit clash resolution.
 *
 * Two teams whose on-field colours look alike is not a cosmetic problem — it is a readability
 * failure, and readability is rule 2 of the design. Real football solves it with a light away
 * strip; so do we, but only when the palettes actually collide.
 */

function toLab(hex: string): [number, number, number] {
  const c = new THREE.Color(hex);
  // Fast, good-enough perceptual space: luma plus two opponent axes.
  const l = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
  return [l, c.r - c.g, 0.5 * (c.r + c.g) - c.b];
}

/** 0 = identical, ~1.4 = maximally different. */
export function kitDistance(a: string, b: string): number {
  const A = toLab(a); const B = toLab(b);
  const dl = (A[0] - B[0]) * 1.55;   // lightness matters most at a glance and for colour blindness
  const d1 = A[1] - B[1];
  const d2 = A[2] - B[2];
  return Math.sqrt(dl * dl + d1 * d1 + d2 * d2);
}

const CLASH_THRESHOLD = 0.42;

export interface ResolvedKits {
  home: TeamColors;
  away: TeamColors;
  /** True when the away strip was swapped to avoid a clash. */
  swapped: boolean;
}

/**
 * The renderer dresses HOME in `primary` and AWAY in `secondary`. If those two read alike,
 * put AWAY in a bright neutral strip trimmed in its own primary.
 */
export function resolveKits(home: TeamDef, away: TeamDef): ResolvedKits {
  const homeShirt = home.colors.primary;
  const awayShirt = away.colors.secondary;
  const d = kitDistance(homeShirt, awayShirt);
  if (d >= CLASH_THRESHOLD) {
    return { home: home.colors, away: away.colors, swapped: false };
  }
  // Try the away team's own primary first — often already a strong contrast.
  const alt = away.colors.primary;
  if (kitDistance(homeShirt, alt) >= CLASH_THRESHOLD + 0.06) {
    return {
      home: home.colors,
      away: { ...away.colors, secondary: alt, primary: away.colors.secondary },
      swapped: true,
    };
  }
  // Fall back to a light or dark neutral, whichever is further from the home strip.
  const light = '#eef2f7';
  const dark = '#12161f';
  const strip = kitDistance(homeShirt, light) >= kitDistance(homeShirt, dark) ? light : dark;
  const trim = away.colors.primary;
  return {
    home: home.colors,
    away: {
      primary: trim,
      secondary: strip,
      accent: away.colors.accent,
      ink: strip === light ? '#12161f' : '#eef2f7',
      endzone: away.colors.endzone,
    },
    swapped: true,
  };
}
