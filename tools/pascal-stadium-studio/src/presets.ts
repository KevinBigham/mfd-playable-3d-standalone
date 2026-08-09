import type { MfdStadiumVisualV1 } from './contract'

export type StadiumPresetId =
  | 'compact-single-deck'
  | 'large-double-deck'
  | 'open-end-bowl'
  | 'half-canopy'
  | 'dome'
  | 'giant-end-zone-scoreboard'
  | 'sparse-low-quality-exterior'

export const STADIUM_PRESET_LABELS: Record<StadiumPresetId, string> = {
  'compact-single-deck': 'Compact single deck',
  'large-double-deck': 'Large double deck',
  'open-end-bowl': 'Open-end bowl',
  'half-canopy': 'Half canopy',
  dome: 'Dome',
  'giant-end-zone-scoreboard': 'Giant end-zone scoreboard',
  'sparse-low-quality-exterior': 'Sparse low-quality exterior',
}

function clone(visual: MfdStadiumVisualV1): MfdStadiumVisualV1 {
  return structuredClone(visual)
}

/** Pure semantic transforms; the panel replaces the scene in one undoable step. */
export function applyStadiumPreset(
  input: MfdStadiumVisualV1,
  preset: StadiumPresetId,
): MfdStadiumVisualV1 {
  const next = clone(input)
  if (preset === 'compact-single-deck') {
    next.bowl.halfX = 54
    // 84 yd is the smallest useful compact plan that still strictly contains
    // the native field apron and both protected end-camera lanes.
    next.bowl.halfZ = 84
    next.bowl.cornerRadius = 15
    next.bowl.profile = [
      { role: 'ground', radialRunYd: 4, riseYd: 0.5 },
      { role: 'structure', radialRunYd: 2, riseYd: 1.5 },
      { role: 'seats', radialRunYd: 13, riseYd: 8 },
      { role: 'outer', radialRunYd: 3, riseYd: -9.5 },
    ]
    delete next.bowl.openings
  } else if (preset === 'large-double-deck') {
    next.bowl.halfX = 68
    next.bowl.halfZ = 96
    next.bowl.cornerRadius = 22
    next.bowl.profile = [
      { role: 'ground', radialRunYd: 5, riseYd: 0.5 },
      { role: 'structure', radialRunYd: 3, riseYd: 2 },
      { role: 'seats', radialRunYd: 15, riseYd: 10 },
      { role: 'signage', radialRunYd: 2, riseYd: 1.5 },
      { role: 'structure', radialRunYd: 4, riseYd: 3 },
      { role: 'seats', radialRunYd: 14, riseYd: 10 },
      { role: 'outer', radialRunYd: 4, riseYd: -26.5 },
    ]
  } else if (preset === 'open-end-bowl') {
    next.bowl.openings = [{ startT: 0.43, endT: 0.57 }]
  } else if (preset === 'half-canopy') {
    next.roof = { style: 'canopy', coverage: 0.5, heightYd: 36, radialOverhangYd: 10 }
  } else if (preset === 'dome') {
    next.roof = { style: 'dome', coverage: 1, heightYd: 48, radialOverhangYd: 12 }
  } else if (preset === 'giant-end-zone-scoreboard') {
    next.scoreboards = [{ perimeterT: 0.74, widthYd: 48, heightYd: 18, elevationYd: 34, outwardOffsetYd: 8 }]
  } else {
    next.banners = []
    next.skyline = [
      { kind: 'block', position: { x: 88, y: 4, z: 50 }, size: { x: 10, y: 8, z: 10 }, colorRole: 'neutral', minQuality: 'LOW' },
    ]
  }
  next.authoring = { ...next.authoring, notes: `Applied studio preset: ${preset}` }
  return next
}
