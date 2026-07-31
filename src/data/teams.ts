/**
 * GRIDIRON OVERDRIVE — the league.
 *
 * 16 wholly invented clubs across two invented conferences. Every city, nickname, colour
 * scheme, emblem and athlete in this file is original to this project; nothing here refers
 * to, parodies, or is derived from any real team, league, venue, or athlete.
 *
 * PURE. Rosters are generated at module load from a stable hash of each team id, so the
 * league is byte-identical in Node and in the browser, every run, forever.
 */

import type { TeamDef, TeamStyle } from '../core/types.ts';
import { Rng, hashSeed } from '../core/rng.ts';
import { makeRoster } from './names.ts';

type Power = TeamDef['power'];

interface TeamSpec {
  id: string;
  city: string;
  name: string;
  abbr: string;
  style: TeamStyle;
  logo: string;
  stadium: string;
  blurb: string;
  power: Power;
  primary: string;
  secondary: string;
  accent: string;
  ink: string;
  endzone: string;
}

function build(spec: TeamSpec): TeamDef {
  const rng = new Rng(hashSeed(`go.roster.v1:${spec.id}`));
  return {
    id: spec.id,
    city: spec.city,
    name: spec.name,
    abbr: spec.abbr,
    colors: {
      primary: spec.primary,
      secondary: spec.secondary,
      accent: spec.accent,
      ink: spec.ink,
      endzone: spec.endzone,
    },
    style: spec.style,
    power: spec.power,
    roster: makeRoster(spec.id, spec.style, rng, spec.power),
    logo: spec.logo,
    stadium: spec.stadium,
    blurb: spec.blurb,
  };
}

// ──────────────────────────────────────────────────────────────── the sixteen
//
// Palette rule: primaries are spread across BOTH hue and lightness, so the league stays
// separable for colour-blind players. Dark primaries: Iron Harbor, Nyx City, Cascadia,
// Auric Bay, Ravenmoor, Tempest Cay. Light primaries: Quarry Point, Arclight, Northreach.
// Everything else sits in the mid band with a distinct hue.

const SPECS: readonly TeamSpec[] = [
  // ── FOUNDRY CONFERENCE ───────────────────────────────────────────────────
  {
    id: 'iron-harbor-anvils',
    city: 'Iron Harbor', name: 'Anvils', abbr: 'IRH',
    style: 'GROUND', logo: 'anvil', stadium: 'forgeworks-yard',
    blurb: 'Four yards and a dented facemask. The trenches are the plan.',
    power: { passing: 58, running: 91, line: 92, coverage: 66, special: 72 },
    primary: '#37424D', secondary: '#FF7A18', accent: '#FFC53D', ink: '#FFEFD6', endzone: '#232C35',
  },
  {
    id: 'quarry-point-monoliths',
    city: 'Quarry Point', name: 'Monoliths', abbr: 'QPM',
    style: 'GROUND', logo: 'monolith', stadium: 'granite-bowl',
    blurb: 'They do not move. You move, eventually, backward.',
    power: { passing: 52, running: 88, line: 95, coverage: 71, special: 60 },
    primary: '#C9CDB4', secondary: '#2C3327', accent: '#E0552B', ink: '#1E2419', endzone: '#B8BDA2',
  },
  {
    id: 'verdigris-falls-turbines',
    city: 'Verdigris Falls', name: 'Turbines', abbr: 'VFT',
    style: 'PRESSURE', logo: 'gear', stadium: 'turbine-hall',
    blurb: 'A front that never idles. Two seconds is all you get.',
    power: { passing: 71, running: 68, line: 86, coverage: 74, special: 66 },
    primary: '#16B3A0', secondary: '#123B3F', accent: '#F2B233', ink: '#06231F', endzone: '#0E8C7D',
  },
  {
    id: 'kettle-basin-embers',
    city: 'Kettle Basin', name: 'Embers', abbr: 'KBE',
    style: 'PRESSURE', logo: 'flame', stadium: 'kiln-row',
    blurb: 'Live edge rushers, short fuses, shorter pockets.',
    power: { passing: 74, running: 63, line: 88, coverage: 62, special: 78 },
    primary: '#C2290A', secondary: '#FFD166', accent: '#2A0F08', ink: '#FFF1D6', endzone: '#8E1D06',
  },
  {
    id: 'nyx-city-nocturnes',
    city: 'Nyx City', name: 'Nocturnes', abbr: 'NYX',
    style: 'COVERAGE', logo: 'visor', stadium: 'umbra-park',
    blurb: 'Every window closes. Throw it and you gift-wrap it.',
    power: { passing: 69, running: 58, line: 70, coverage: 90, special: 74 },
    primary: '#16102E', secondary: '#6C4CE0', accent: '#D9C9FF', ink: '#F1ECFF', endzone: '#100B22',
  },
  {
    id: 'cobalt-reach-vanguard',
    city: 'Cobalt Reach', name: 'Vanguard', abbr: 'CBR',
    style: 'BALANCED', logo: 'chevron', stadium: 'cobalt-rotunda',
    blurb: 'No weakness, no gimmick, no mercy on third and long.',
    power: { passing: 79, running: 78, line: 79, coverage: 78, special: 80 },
    primary: '#1338CE', secondary: '#F2F5FF', accent: '#FFC300', ink: '#FFFFFF', endzone: '#0E2AA0',
  },
  {
    id: 'arclight-voltage',
    city: 'Arclight', name: 'Voltage', abbr: 'ARC',
    style: 'AIR', logo: 'bolt', stadium: 'the-filament',
    blurb: 'Snap to six in nine seconds. Bring a stopwatch.',
    power: { passing: 88, running: 61, line: 66, coverage: 68, special: 85 },
    primary: '#FFE81A', secondary: '#1A1A1E', accent: '#00D4FF', ink: '#14140F', endzone: '#E6CF00',
  },
  {
    id: 'copper-gulch-warhorns',
    city: 'Copper Gulch', name: 'Warhorns', abbr: 'CGW',
    style: 'BALANCED', logo: 'horns', stadium: 'rimyard',
    blurb: 'Downhill runs, play-action daggers, dust everywhere.',
    power: { passing: 72, running: 84, line: 82, coverage: 69, special: 63 },
    primary: '#B25A1E', secondary: '#F0D9A8', accent: '#2E5E4E', ink: '#FFF3E0', endzone: '#8C4416',
  },

  // ── FRONTIER CONFERENCE ──────────────────────────────────────────────────
  {
    id: 'cascadia-kestrels',
    city: 'Cascadia', name: 'Kestrels', abbr: 'CSK',
    style: 'AIR', logo: 'raptor', stadium: 'evergreen-spire',
    blurb: 'Take the ball vertical. Tackling is somebody else\'s job.',
    power: { passing: 93, running: 55, line: 52, coverage: 49, special: 76 },
    primary: '#0F6B45', secondary: '#EFE7D2', accent: '#FF6E3A', ink: '#F3FFF8', endzone: '#0B563A',
  },
  {
    id: 'sunspire-solstice',
    city: 'Sunspire', name: 'Solstice', abbr: 'SUN',
    style: 'AIR', logo: 'star', stadium: 'heliograph-field',
    blurb: 'All ceiling, no floor. The deep shot is the whole plan.',
    power: { passing: 95, running: 47, line: 48, coverage: 54, special: 88 },
    primary: '#FF9E00', secondary: '#2B1B4D', accent: '#FFE9A8', ink: '#2A1500', endzone: '#E88A00',
  },
  {
    id: 'vermilion-mesa-mirage',
    city: 'Vermilion Mesa', name: 'Mirage', abbr: 'VMM',
    style: 'CHAOS', logo: 'orbit', stadium: 'mirage-flats',
    blurb: 'Reverses, laterals, fake kicks. Nothing is what it looks like.',
    power: { passing: 81, running: 76, line: 58, coverage: 55, special: 95 },
    primary: '#E0407A', secondary: '#2B0F2E', accent: '#34E3C8', ink: '#FFF0F5', endzone: '#B32E60',
  },
  {
    id: 'northreach-glaciers',
    city: 'Northreach', name: 'Glaciers', abbr: 'NRG',
    style: 'BALANCED', logo: 'crest', stadium: 'hoarfrost-hollow',
    blurb: 'Cold, patient, inevitable. They win the fourth quarter.',
    power: { passing: 70, running: 80, line: 84, coverage: 76, special: 58 },
    primary: '#CDEEFF', secondary: '#0C3C5E', accent: '#FF6A4D', ink: '#08293F', endzone: '#A9DDF5',
  },
  {
    id: 'auric-bay-undertow',
    city: 'Auric Bay', name: 'Undertow', abbr: 'AUB',
    style: 'BALANCED', logo: 'wave', stadium: 'tidegate-basin',
    blurb: 'Calm surface, vicious current. They complete everything short.',
    power: { passing: 83, running: 70, line: 72, coverage: 73, special: 70 },
    primary: '#0E5B78', secondary: '#E8B221', accent: '#7CE0D0', ink: '#FFF8E1', endzone: '#0A4A62',
  },
  {
    id: 'ravenmoor-wardens',
    city: 'Ravenmoor', name: 'Wardens', abbr: 'RVW',
    style: 'COVERAGE', logo: 'shield', stadium: 'the-keep',
    blurb: 'The vault. Nine picks last season, none of them lucky.',
    power: { passing: 64, running: 66, line: 76, coverage: 94, special: 69 },
    primary: '#5B0F1E', secondary: '#C0B283', accent: '#E8E4D9', ink: '#F6E7C1', endzone: '#470B17',
  },
  {
    id: 'saltmarsh-harriers',
    city: 'Saltmarsh', name: 'Harriers', abbr: 'SLM',
    style: 'PRESSURE', logo: 'wing', stadium: 'brackwater-field',
    blurb: 'Swarming, sloppy-field specialists who never stop closing.',
    power: { passing: 67, running: 72, line: 87, coverage: 80, special: 55 },
    primary: '#93B83C', secondary: '#1F3226', accent: '#F2E1A0', ink: '#16210F', endzone: '#7CA02F',
  },
  {
    id: 'tempest-cay-corsairs',
    city: 'Tempest Cay', name: 'Corsairs', abbr: 'TCC',
    style: 'GROUND', logo: 'trident', stadium: 'windlass-yard',
    blurb: 'Board the pocket, take the ball, run out the clock.',
    power: { passing: 60, running: 93, line: 85, coverage: 64, special: 67 },
    primary: '#14213D', secondary: '#FF4A3D', accent: '#F1E4C3', ink: '#FFFFFF', endzone: '#101A31',
  },
];

export const TEAMS: readonly TeamDef[] = SPECS.map(build);

export const TEAM_IDS: string[] = TEAMS.map((t) => t.id);

export interface ConferenceDef { name: string; teamIds: string[] }

export const CONFERENCES: ConferenceDef[] = [
  {
    name: 'Foundry Conference',
    teamIds: [
      'iron-harbor-anvils',
      'quarry-point-monoliths',
      'verdigris-falls-turbines',
      'kettle-basin-embers',
      'nyx-city-nocturnes',
      'cobalt-reach-vanguard',
      'arclight-voltage',
      'copper-gulch-warhorns',
    ],
  },
  {
    name: 'Frontier Conference',
    teamIds: [
      'cascadia-kestrels',
      'sunspire-solstice',
      'vermilion-mesa-mirage',
      'northreach-glaciers',
      'auric-bay-undertow',
      'ravenmoor-wardens',
      'saltmarsh-harriers',
      'tempest-cay-corsairs',
    ],
  },
];

const BY_ID = new Map<string, TeamDef>(TEAMS.map((t) => [t.id, t]));

export function getTeam(id: string): TeamDef {
  const t = BY_ID.get(id);
  if (!t) throw new Error(`Unknown team id: ${id}`);
  return t;
}

/** Safe lookup for UI code that may hold a stale id from a save file. */
export function findTeam(id: string): TeamDef | null {
  return BY_ID.get(id) ?? null;
}

/** Conference containing `id`, or null. */
export function conferenceOf(id: string): ConferenceDef | null {
  for (const c of CONFERENCES) if (c.teamIds.indexOf(id) >= 0) return c;
  return null;
}

/** `City Nickname`, for headers and score bugs. */
export function fullName(team: TeamDef): string {
  return `${team.city} ${team.name}`;
}

/** Crude single-number strength, only for seeding ladders and CPU matchmaking. */
export function teamRating(team: TeamDef): number {
  const p = team.power;
  return Math.round((p.passing + p.running + p.line + p.coverage + p.special) / 5);
}
