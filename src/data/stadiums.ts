/**
 * GRIDIRON OVERDRIVE — venues.
 *
 * 16 home grounds plus 2 neutral sites used for finals and exhibitions. Every venue name
 * is invented for this league; there are no sponsors, real or implied.
 *
 * `crowdTint` biases the procedural crowd texture, `accent` drives concourse and
 * structural trim in the environment renderer. PURE data.
 */

import type { StadiumDef } from '../core/types.ts';

export const STADIUMS: StadiumDef[] = [
  // ── Foundry Conference homes ─────────────────────────────────────────────
  {
    id: 'forgeworks-yard',
    name: 'Forgeworks Yard',
    city: 'Iron Harbor',
    roof: 0, surface: 'MUD', tier: 3,
    crowdTint: '#B4441A', skyKind: 'STORM', accent: '#FF7A18',
  },
  {
    id: 'granite-bowl',
    name: 'The Granite Bowl',
    city: 'Quarry Point',
    roof: 0, surface: 'GRASS', tier: 2,
    crowdTint: '#8E9280', skyKind: 'DUSK', accent: '#E0552B',
  },
  {
    id: 'turbine-hall',
    name: 'Turbine Hall',
    city: 'Verdigris Falls',
    roof: 2, surface: 'TURF', tier: 3,
    crowdTint: '#0E7C70', skyKind: 'NIGHT', accent: '#F2B233',
  },
  {
    id: 'kiln-row',
    name: 'Kiln Row',
    city: 'Kettle Basin',
    roof: 1, surface: 'ASPHALT', tier: 1,
    crowdTint: '#8E1D06', skyKind: 'DAY', accent: '#FFD166',
  },
  {
    id: 'umbra-park',
    name: 'Umbra Park',
    city: 'Nyx City',
    roof: 1, surface: 'TURF', tier: 3,
    crowdTint: '#2A2050', skyKind: 'NIGHT', accent: '#6C4CE0',
  },
  {
    id: 'cobalt-rotunda',
    name: 'The Cobalt Rotunda',
    city: 'Cobalt Reach',
    roof: 2, surface: 'TURF', tier: 3,
    crowdTint: '#1E44C8', skyKind: 'NIGHT', accent: '#FFC300',
  },
  {
    id: 'the-filament',
    name: 'The Filament',
    city: 'Arclight',
    roof: 2, surface: 'TURF', tier: 2,
    crowdTint: '#D9C41A', skyKind: 'NIGHT', accent: '#00D4FF',
  },
  {
    id: 'rimyard',
    name: 'Rimyard',
    city: 'Copper Gulch',
    roof: 0, surface: 'SAND', tier: 1,
    crowdTint: '#A5642A', skyKind: 'DUSK', accent: '#2E5E4E',
  },

  // ── Frontier Conference homes ────────────────────────────────────────────
  {
    id: 'evergreen-spire',
    name: 'Evergreen Spire',
    city: 'Cascadia',
    roof: 1, surface: 'GRASS', tier: 3,
    crowdTint: '#17614A', skyKind: 'STORM', accent: '#FF6E3A',
  },
  {
    id: 'heliograph-field',
    name: 'Heliograph Field',
    city: 'Sunspire',
    roof: 0, surface: 'TURF', tier: 2,
    crowdTint: '#E8912A', skyKind: 'DAY', accent: '#FFE9A8',
  },
  {
    id: 'mirage-flats',
    name: 'Mirage Flats',
    city: 'Vermilion Mesa',
    roof: 0, surface: 'SAND', tier: 1,
    crowdTint: '#C6486F', skyKind: 'DAY', accent: '#34E3C8',
  },
  {
    id: 'hoarfrost-hollow',
    name: 'Hoarfrost Hollow',
    city: 'Northreach',
    roof: 0, surface: 'FROZEN', tier: 2,
    crowdTint: '#9FC4DA', skyKind: 'DUSK', accent: '#FF6A4D',
  },
  {
    id: 'tidegate-basin',
    name: 'Tidegate Basin',
    city: 'Auric Bay',
    roof: 0, surface: 'GRASS', tier: 3,
    crowdTint: '#1B6E88', skyKind: 'DUSK', accent: '#E8B221',
  },
  {
    id: 'the-keep',
    name: 'Wardens Keep',
    city: 'Ravenmoor',
    roof: 1, surface: 'GRASS', tier: 2,
    crowdTint: '#6B2130', skyKind: 'STORM', accent: '#C0B283',
  },
  {
    id: 'brackwater-field',
    name: 'Brackwater Field',
    city: 'Saltmarsh',
    roof: 0, surface: 'MUD', tier: 1,
    crowdTint: '#7E9B45', skyKind: 'STORM', accent: '#F2E1A0',
  },
  {
    id: 'windlass-yard',
    name: 'Windlass Yard',
    city: 'Tempest Cay',
    roof: 0, surface: 'GRASS', tier: 2,
    crowdTint: '#25355C', skyKind: 'DUSK', accent: '#FF4A3D',
  },

  // ── Neutral sites ────────────────────────────────────────────────────────
  {
    id: 'grand-meridian',
    name: 'The Grand Meridian',
    city: 'Meridian Flats',
    roof: 2, surface: 'TURF', tier: 3,
    crowdTint: '#D8D2C4', skyKind: 'NIGHT', accent: '#F5A623',
  },
  {
    id: 'the-saltpan',
    name: 'The Saltpan',
    city: 'Alkali Reach',
    roof: 0, surface: 'SAND', tier: 2,
    crowdTint: '#C8B99A', skyKind: 'DUSK', accent: '#3FB6C8',
  },
];

export const STADIUM_IDS: string[] = STADIUMS.map((s) => s.id);

/** Venues not owned by any club — finals, exhibitions, and the tournament ladder. */
export const NEUTRAL_SITE_IDS: string[] = ['grand-meridian', 'the-saltpan'];

const BY_ID = new Map<string, StadiumDef>(STADIUMS.map((s) => [s.id, s]));

export function getStadium(id: string): StadiumDef {
  const v = BY_ID.get(id);
  if (!v) throw new Error(`Unknown stadium id: ${id}`);
  return v;
}

/** Safe lookup for save files that may reference a retired venue. */
export function findStadium(id: string): StadiumDef | null {
  return BY_ID.get(id) ?? null;
}

export function isNeutralSite(id: string): boolean {
  return NEUTRAL_SITE_IDS.indexOf(id) >= 0;
}
