import type { StadiumDef } from '../../core/types.ts';
import { ROOF_MIN_CLEARANCE_Y, stadiumPerimeterPoint } from './protection.ts';
import {
  STADIUM_VISUAL_SCHEMA, STADIUM_VISUAL_VERSION,
  type MfdStadiumVisualV1, type StadiumBowlPlan, type StadiumProfileSegment,
} from './types.ts';

export const LEGACY_BOWL_HALF_X = 44;
export const LEGACY_BOWL_HALF_Z = 86;
export const LEGACY_BOWL_RADIUS = 28;
export const LEGACY_BOWL_CENTER_Z = 50;
export const LEGACY_AISLE_EVERY = 8;
/** Legacy shell bottom is 0.65 yd below its inner top at `topY + 3.5`. */
export const LEGACY_ROOF_UNDERSIDE_RISE_Y = 2.85;

interface LegacyTierSpec {
  lowerRun: number;
  lowerRise: number;
  upperRun: number;
  upperRise: number;
  concourse: number;
  towers: number;
}

export const LEGACY_TIER: Readonly<Record<1 | 2 | 3, LegacyTierSpec>> = {
  1: { lowerRun: 13.5, lowerRise: 9.5, upperRun: 0, upperRise: 0, concourse: 2.8, towers: 4 },
  2: { lowerRun: 16.5, lowerRise: 12, upperRun: 13.5, upperRise: 15.5, concourse: 3.4, towers: 6 },
  3: { lowerRun: 19.5, lowerRise: 14.5, upperRun: 20, upperRise: 23, concourse: 3.9, towers: 8 },
};

function legacyProfile(tier: 1 | 2 | 3): { profile: StadiumProfileSegment[]; topR: number; topY: number } {
  const spec = LEGACY_TIER[tier];
  const profile: StadiumProfileSegment[] = [];
  let r = -24;
  let y = -0.08;
  const add = (radialRunYd: number, riseYd: number, role: StadiumProfileSegment['role']): void => {
    profile.push({ role, radialRunYd, riseYd });
    r += radialRunYd;
    y += riseYd;
  };
  add(24, 0.08, 'ground');
  add(0, 2.7, 'signage');
  add(2.2, 0, 'structure');
  add(0, 0.75, 'accent');
  add(spec.lowerRun, spec.lowerRise, 'seats');
  add(1.7, 0, 'structure');
  add(0, spec.concourse, 'dark');
  add(0, 0.55, 'accent');
  add(3.2, 0, 'structure');
  if (tier > 1) {
    add(0, 1.5, 'accent');
    add(spec.upperRun, spec.upperRise, 'seats');
  }
  add(1.8, 0, 'structure');
  add(0, 2.9, 'structure');
  add(0, 0.5, 'accent');
  const topR = r;
  const topY = y;
  add(2.6, -topY, 'outer');
  return { profile, topR, topY };
}

function nearestPerimeterT(plan: StadiumBowlPlan, targetX: number, targetZ: number): number {
  let bestT = 0;
  let bestD = Infinity;
  // Deterministic authoring adapter only; the runtime compiler does not perform this search.
  for (let i = 0; i < 4096; i++) {
    const t = i / 4096;
    const p = stadiumPerimeterPoint(plan, t);
    const d = (p.x - targetX) ** 2 + (p.z - targetZ) ** 2;
    if (d < bestD) { bestD = d; bestT = t; }
  }
  return bestT;
}

/**
 * Exact semantic description of the pre-authored native stadium path.
 *
 * Geometry remains native; this adapter only carries the existing tier/profile/roof/tunnel,
 * scoreboard, and tower decisions into the versioned contract.
 */
export function legacyVisualFromStadiumDef(stadium: StadiumDef): MfdStadiumVisualV1 {
  const tier = stadium.tier;
  const spec = LEGACY_TIER[tier];
  const compiledProfile = legacyProfile(tier);
  const bowl: StadiumBowlPlan = {
    centerZ: LEGACY_BOWL_CENTER_Z,
    halfX: LEGACY_BOWL_HALF_X,
    halfZ: LEGACY_BOWL_HALF_Z,
    cornerRadius: LEGACY_BOWL_RADIUS,
    aisleEvery: LEGACY_AISLE_EVERY,
    profile: compiledProfile.profile,
  };

  const boardW = tier === 1 ? 24 : tier === 2 ? 30 : 36;
  const boardH = boardW * (384 / 1024);
  const boardY = compiledProfile.topY * (tier === 1 ? 0.66 : 0.60) + boardH * 0.5;
  const mastRise = 12 + tier * 2.5 + 1;
  const towerOffset = compiledProfile.topR - 1;
  // The original tier-1 canopy underside predates the authored protection contract and sits at
  // 22.55 yd. Studio imports lift that semantic roof to the first safely valid clearance; the
  // renderer's no-override fallback remains byte-for-byte on its original procedural path.
  const authoredRoofClearance = Math.max(
    compiledProfile.topY + LEGACY_ROOF_UNDERSIDE_RISE_Y,
    ROOF_MIN_CLEARANCE_Y + 0.01,
  );

  return {
    schema: STADIUM_VISUAL_SCHEMA,
    version: STADIUM_VISUAL_VERSION,
    stadiumId: stadium.id,
    units: 'yards',
    coordinateSystem: {
      x: 'sideline-to-sideline',
      y: 'up',
      z: 'home-goal-to-away-goal',
    },
    bowl,
    roof: stadium.roof === 0
      ? { style: 'none', coverage: 0, heightYd: 0, radialOverhangYd: 0 }
      : stadium.roof === 1
        ? { style: 'canopy', coverage: 0.5, heightYd: authoredRoofClearance, radialOverhangYd: 1.4 }
        : { style: 'dome', coverage: 1, heightYd: authoredRoofClearance, radialOverhangYd: 1.4 },
    tunnels: [
      [LEGACY_BOWL_HALF_X, 22], [-LEGACY_BOWL_HALF_X, 22],
      [LEGACY_BOWL_HALF_X, 78], [-LEGACY_BOWL_HALF_X, 78],
    ].map(([x, z]) => ({
      perimeterT: nearestPerimeterT(bowl, x, z),
      widthYd: 5.4,
      heightYd: 2.4,
    })),
    scoreboards: [-1, 1].map((end) => ({
      perimeterT: nearestPerimeterT(bowl, 0, LEGACY_BOWL_CENTER_Z + end * LEGACY_BOWL_HALF_Z),
      widthYd: boardW,
      heightYd: boardH,
      elevationYd: boardY - boardH * 0.5,
      outwardOffsetYd: 1.2,
    })),
    lightTowers: Array.from({ length: spec.towers }, (_, i) => ({
      perimeterT: i / spec.towers,
      heightYd: mastRise,
      outwardOffsetYd: towerOffset,
    })),
    authoring: {
      notes: `Generated from native legacy tier ${tier}; visual identity fields remain inherited from StadiumDef.`,
    },
  };
}

export function legacyProfileMetrics(tier: 1 | 2 | 3): { topR: number; topY: number } {
  const { topR, topY } = legacyProfile(tier);
  return { topR, topY };
}
