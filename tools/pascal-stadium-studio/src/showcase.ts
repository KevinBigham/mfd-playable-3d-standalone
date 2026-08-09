import type { MfdStadiumVisualV1, NativeStadiumDefinition } from './contract'

export const THE_SALTPAN_NATIVE: NativeStadiumDefinition = {
  id: 'the-saltpan',
  name: 'The Saltpan',
  city: 'Alkali Reach',
  roof: 0,
  surface: 'SAND',
  tier: 2,
  crowdTint: '#C8B99A',
  skyKind: 'DUSK',
  accent: '#3FB6C8',
}

/**
 * Committed Pascal-authored proof scene: an open south-east bowl with a raised
 * scoreboard, native score plumbing, four semantic towers, one tunnel and a
 * sparse HIGH-only salt-rock skyline. No mesh data or runtime asset URLs.
 */
export const THE_SALTPAN_SHOWCASE_VISUAL: MfdStadiumVisualV1 = {
  schema: 'mfd.stadium-visual',
  version: 1,
  stadiumId: 'the-saltpan',
  units: 'yards',
  coordinateSystem: {
    x: 'sideline-to-sideline',
    y: 'up',
    z: 'home-goal-to-away-goal',
  },
  bowl: {
    centerZ: 50,
    halfX: 61,
    halfZ: 88,
    cornerRadius: 19,
    aisleEvery: 8,
    profile: [
      { role: 'ground', radialRunYd: 4, riseYd: 0.5 },
      { role: 'structure', radialRunYd: 3, riseYd: 2 },
      { role: 'seats', radialRunYd: 13, riseYd: 8.5 },
      { role: 'signage', radialRunYd: 1.5, riseYd: 1 },
      { role: 'seats', radialRunYd: 11, riseYd: 7.5 },
      { role: 'accent', radialRunYd: 1.25, riseYd: 0.5 },
      { role: 'outer', radialRunYd: 3.5, riseYd: -19.5 },
    ],
    openings: [{ startT: 0.43, endT: 0.57 }],
  },
  roof: { style: 'none', coverage: 0, heightYd: 0, radialOverhangYd: 0 },
  tunnels: [{ perimeterT: 0.25, widthYd: 8, heightYd: 5.5 }],
  scoreboards: [{
    perimeterT: 0.74,
    widthYd: 29,
    heightYd: 11,
    elevationYd: 28,
    outwardOffsetYd: 5,
  }],
  lightTowers: [
    { perimeterT: 0.12, heightYd: 40, outwardOffsetYd: 10 },
    { perimeterT: 0.36, heightYd: 40, outwardOffsetYd: 10 },
    { perimeterT: 0.64, heightYd: 40, outwardOffsetYd: 10 },
    { perimeterT: 0.88, heightYd: 40, outwardOffsetYd: 10 },
  ],
  banners: [
    { perimeterT: 0.16, widthYd: 8, heightYd: 3, elevationYd: 19, colorRole: 'accent', minQuality: 'MEDIUM' },
    { perimeterT: 0.84, widthYd: 8, heightYd: 3, elevationYd: 19, colorRole: 'neutral', minQuality: 'MEDIUM' },
  ],
  skyline: [
    { kind: 'rock', position: { x: -94, y: 7, z: 22 }, size: { x: 16, y: 14, z: 13 }, colorRole: 'neutral', minQuality: 'HIGH' },
    { kind: 'rock', position: { x: 96, y: 5, z: 82 }, size: { x: 13, y: 10, z: 17 }, colorRole: 'structure', minQuality: 'HIGH' },
    { kind: 'tank', position: { x: 82, y: 10, z: -25 }, size: { x: 12, y: 20, z: 12 }, colorRole: 'accent', minQuality: 'HIGH' },
  ],
  authoring: {
    author: 'MFD Pascal Stadium Visual Studio',
    notes: 'Committed semantic showcase preset; export through scene adapter before promotion.',
    pascalSceneVersion: 'pascal-editor-0.9.2',
  },
}
