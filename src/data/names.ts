/**
 * GRIDIRON OVERDRIVE — name banks + roster generation.
 *
 * PURE. No browser globals, no ambient randomness. Every draw comes from the caller's Rng,
 * so a given (teamId, style, seed) always produces the identical 15-athlete roster.
 *
 * Every name here is invented for this league: ordinary, culturally varied surnames and
 * given names chosen so that no combination reads as a real, living athlete.
 */

import type { PlayerDef, PositionCode, Ratings, TeamDef, TeamStyle } from '../core/types.ts';
import type { Rng } from '../core/rng.ts';
import { clamp } from '../core/math.ts';

// ──────────────────────────────────────────────────────────────── name banks

export const FIRST_NAMES: readonly string[] = [
  'Andre', 'Marcus', 'Devin', 'Tobias', 'Rashad', 'Elias', 'Julian', 'Cortez', 'Damon', 'Nikolai',
  'Sione', 'Malik', 'Everett', 'Casey', 'Dante', 'Emilio', 'Ozzie', 'Roland', 'Bennett', 'Grady',
  'Kenji', 'Ravi', 'Omar', 'Silas', 'Trevon', 'Wes', 'Yusuf', 'Zane', 'Alonzo', 'Bartek',
  'Cedric', 'Darnell', 'Ephraim', 'Finn', 'Gustavo', 'Hakeem', 'Ignacio', 'Jalen', 'Kwame', 'Lucien',
  'Mateo', 'Ned', 'Osman', 'Paavo', 'Quentin', 'Rufus', 'Stefan', 'Tariq', 'Ulises', 'Vance',
  'Wendell', 'Xavier', 'Yannick', 'Zeke', 'Amari', 'Brody', 'Carsten', 'Dominic', 'Edwin', 'Fabian',
  'Garrett', 'Hugo', 'Isaiah', 'Jonah', 'Keegan', 'Lars', 'Micah', 'Nico', 'Otto', 'Pablo',
  'Quincy', 'Reggie', 'Soren', 'Terrence', 'Uriel', 'Vito', 'Wyatt', 'Yuri', 'Ade', 'Bruno',
  'Corbin', 'Deshawn', 'Enzo', 'Felipe', 'Gio', 'Horace', 'Ira', 'Jarrett', 'Kai', 'Levon',
  'Moses', 'Nasir', 'Obi', 'Priit', 'Rasheed', 'Sergei', 'Tevita', 'Umar', 'Valentin', 'Wallace',
  'Ari', 'Bodhi', 'Cyrus', 'Dmitri', 'Eero', 'Franklin', 'Gerald', 'Hollis', 'Ivan', 'Joaquin',
  'Kellan', 'Landon', 'Marlon', 'Noel', 'Orson', 'Pascal', 'Rueben', 'Samir', 'Thaddeus', 'Ulrich',
  'Vaughn', 'Willem', 'Ximeno', 'Yosef', 'Zaid', 'Abel', 'Boone', 'Clarence', 'Desmond', 'Emmett',
  'Ferris', 'Gideon', 'Hector', 'Ignatius', 'Jamal', 'Kirby', 'Lorenzo', 'Milo', 'Nkosi', 'Oscar',
  'Percy', 'Rowan', 'Stig', 'Tomas', 'Ulf', 'Vernon', 'Wilbur', 'Yannis', 'Zoltan', 'Amos',
  'Bertrand', 'Cato', 'Dario', 'Ellis', 'Fulton', 'Gustaf', 'Hamza', 'Idris', 'Jules', 'Konrad',
  'Leandro', 'Mattias', 'Nathanael', 'Oleg', 'Pierce', 'Rafael', 'Sullivan', 'Tavian', 'Ulric', 'Viktor',
];

export const LAST_NAMES: readonly string[] = [
  'Alvarado', 'Beckwith', 'Calloway', 'Dunmore', 'Eastwick', 'Farrow', 'Gainey', 'Halstead', 'Ibarra', 'Jessup',
  'Kowalczyk', 'Lindgren', 'Mabry', 'Nakamura', 'Ogundele', 'Prendergast', 'Quintero', 'Radcliffe', 'Sabatini', 'Thorne',
  'Underhill', 'Vasquez', 'Whitlock', 'Yarborough', 'Zelinski', 'Abernathy', 'Bracken', 'Castellano', 'Devereaux', 'Ellingson',
  'Fontenot', 'Garrity', 'Holloway', 'Ivers', 'Jankowski', 'Kirkpatrick', 'Lachance', 'Marchetti', 'Nwosu', 'Okafor',
  'Pemberton', 'Quigley', 'Rasmussen', 'Stoddard', 'Tremaine', 'Ustinov', 'Valdez', 'Wexler', 'Yates', 'Zamora',
  'Ashford', 'Bellamy', 'Coker', 'Delacroix', 'Escobar', 'Fairbanks', 'Gustafson', 'Hargrove', 'Ingersoll', 'Jimenez',
  'Kellerman', 'Lindquist', 'Merriweather', 'Nakashima', 'Ogilvie', 'Padilla', 'Quiroga', 'Ruvalcaba', 'Sandoval', 'Tillman',
  'Ubina', 'Vermeer', 'Wainwright', 'Ybarra', 'Zuniga', 'Ackerley', 'Boudreaux', 'Chatterjee', 'Dombrowski', 'Eaves',
  'Fitzhugh', 'Gallardo', 'Hutchings', 'Iyer', 'Jarreau', 'Kaminski', 'Lombard', 'Maldonado', 'Ndiaye', 'Ottoson',
  'Pankhurst', 'Quarles', 'Rylander', 'Solberg', 'Tanaka', 'Uphoff', 'Vandermeer', 'Wozniak', 'Yoshida', 'Zabala',
  'Alcott', 'Brannigan', 'Cisneros', 'Dukes', 'Engelhardt', 'Ferraro', 'Grimaldi', 'Hollenbeck', 'Ismail', 'Jorgensen',
  'Kirschner', 'Laskaris', 'Montoya', 'Nystrom', 'Oyelaran', 'Petrakis', 'Quintana', 'Rembert', 'Stavros', 'Tuala',
  'Ulmer', 'Vanterpool', 'Whitaker', 'Yildirim', 'Zajac', 'Ambrose', 'Blanchard', 'Corrigan', 'Dinsmore', 'Ekwueme',
  'Fournier', 'Gilliam', 'Hoyt', 'Imhoff', 'Jelinek', 'Kessler', 'Lansing', 'Mbaye', 'Novotny', 'Orsini',
  'Paxton', 'Quillen', 'Rimmer', 'Sowinski', 'Trejo', 'Ulrich', 'Verdugo', 'Wheelock', 'Yancey', 'Zoric',
  'Aguirre', 'Barlowe', 'Chastain', 'Dagenais', 'Everly', 'Fenwick', 'Gutierrez', 'Hobart', 'Isakov', 'Jovanovic',
  'Kimura', 'Laroche', 'Mancuso', 'Nakoa', 'Ozawa', 'Pettigrew', 'Rahimi', 'Sedlacek', 'Thibault', 'Uzoma',
  'Vellucci', 'Warrender', 'Xanthos', 'Yeager', 'Zwick', 'Anselmo', 'Bhatt', 'Crenshaw', 'Dupuis', 'Eberhardt',
  'Falzone', 'Grierson', 'Hasegawa', 'Ivanov', 'Juhasz', 'Krajewski', 'Lofthouse', 'Mireles', 'Nyberg', 'Ohanian',
  'Pruitt', 'Quon', 'Rossiter', 'Salazar', 'Tolliver', 'Umeh', 'Vachon', 'Weatherby', 'Yamada', 'Zdrojewski',
  'Ackley', 'Bergstrom', 'Cavazos', 'Delgado', 'Emmerich', 'Fugate', 'Ghosh', 'Haverford', 'Ilunga', 'Jansen',
  'Kettleman', 'Lisowski', 'Mwangi', 'Nunez', 'Ordonez', 'Piedmont', 'Ruiz', 'Stanfield', 'Turnbull', 'Villareal',
];

// ──────────────────────────────────────────────────────────────── roster shape

/** Roster slot roles. `K` is the kicker slot; PlayerDef.pos has no kicker code. */
export type RosterRole = PositionCode | 'K';

/** Fixed roster size for every team in the league. */
export const ROSTER_SIZE = 15;
/** Index of the kicker in every roster. `ratings.accuracy` drives kick quality. */
export const KICKER_SLOT = 14;
/** PositionCode stamped on the kicker (types.ts has no `K` code). */
export const KICKER_POS: PositionCode = 'WR';

/** Slots 0..14. 0 QB, 1-3 skill, 4-6 OL, 7-9 front, 10-13 secondary, 14 kicker. */
export function rosterRoles(style: TeamStyle): RosterRole[] {
  switch (style) {
    case 'AIR':
      return ['QB', 'WR', 'WR', 'RB', 'OL', 'OL', 'OL', 'DL', 'LB', 'LB', 'CB', 'CB', 'S', 'S', 'K'];
    case 'GROUND':
      return ['QB', 'RB', 'TE', 'WR', 'OL', 'OL', 'OL', 'DL', 'DL', 'LB', 'CB', 'CB', 'S', 'S', 'K'];
    case 'PRESSURE':
      return ['QB', 'WR', 'RB', 'TE', 'OL', 'OL', 'OL', 'DL', 'DL', 'LB', 'CB', 'CB', 'S', 'S', 'K'];
    case 'COVERAGE':
      return ['QB', 'WR', 'RB', 'TE', 'OL', 'OL', 'OL', 'DL', 'LB', 'LB', 'CB', 'CB', 'CB', 'S', 'K'];
    case 'CHAOS':
      return ['QB', 'WR', 'WR', 'RB', 'OL', 'OL', 'OL', 'DL', 'LB', 'LB', 'CB', 'CB', 'S', 'S', 'K'];
    case 'BALANCED':
    default:
      return ['QB', 'WR', 'RB', 'TE', 'OL', 'OL', 'OL', 'DL', 'DL', 'LB', 'CB', 'CB', 'S', 'S', 'K'];
  }
}

// ──────────────────────────────────────────────────────────────── jersey numbers

type Band = readonly [number, number];

/** Position-plausible jersey bands, preferred band first. */
const NUMBER_BANDS: Record<RosterRole, readonly Band[]> = {
  QB: [[1, 19]],
  WR: [[80, 89], [10, 19]],
  RB: [[20, 49]],
  TE: [[80, 89], [40, 49]],
  OL: [[50, 79]],
  DL: [[90, 99]],
  LB: [[40, 59]],
  CB: [[20, 49]],
  S: [[20, 49]],
  K: [[1, 9]],
};

function pickNumber(role: RosterRole, rng: Rng, used: Set<number>): number {
  const bands = NUMBER_BANDS[role];
  for (let attempt = 0; attempt < 24; attempt++) {
    const band = bands[attempt < 16 ? 0 : Math.min(attempt - 16, bands.length - 1)];
    const n = rng.int(band[0], band[1]);
    if (!used.has(n)) { used.add(n); return n; }
  }
  // Deterministic sweep of every plausible band, then the whole 0..99 space.
  for (const band of bands) {
    for (let n = band[0]; n <= band[1]; n++) if (!used.has(n)) { used.add(n); return n; }
  }
  for (let n = 0; n <= 99; n++) if (!used.has(n)) { used.add(n); return n; }
  return 0;
}

// ──────────────────────────────────────────────────────────────── ratings

function ratings(
  speed: number, power: number, hands: number, agility: number,
  arm: number, accuracy: number, coverage: number, awareness: number,
): Ratings {
  return { speed, power, hands, agility, arm, accuracy, coverage, awareness };
}

/** Positional archetype before style, team power, and noise are applied. */
const BASE: Record<RosterRole, Ratings> = {
  QB: ratings(62, 55, 55, 66, 84, 82, 42, 80),
  WR: ratings(88, 52, 84, 85, 42, 40, 48, 72),
  RB: ratings(84, 74, 68, 86, 44, 40, 46, 70),
  TE: ratings(72, 78, 79, 66, 42, 40, 50, 73),
  OL: ratings(55, 90, 42, 52, 40, 40, 40, 66),
  DL: ratings(66, 89, 48, 62, 40, 40, 44, 68),
  LB: ratings(76, 80, 56, 72, 40, 40, 66, 76),
  CB: ratings(90, 52, 66, 88, 40, 40, 87, 76),
  S: ratings(84, 68, 64, 78, 40, 40, 80, 80),
  K: ratings(58, 56, 50, 55, 64, 88, 40, 62),
};

const KEYS: readonly (keyof Ratings)[] = [
  'speed', 'power', 'hands', 'agility', 'arm', 'accuracy', 'coverage', 'awareness',
];

/** How much of a team's identity leaks into individual athletes. */
function styleMod(style: TeamStyle, role: RosterRole): Partial<Ratings> {
  switch (style) {
    case 'AIR':
      if (role === 'QB') return { arm: 7, accuracy: 8, awareness: 4, speed: -2 };
      if (role === 'WR' || role === 'TE') return { speed: 5, hands: 7, agility: 4 };
      if (role === 'RB') return { hands: 8, speed: 3, power: -5 };
      if (role === 'OL') return { power: -7, awareness: 3 };
      if (role === 'DL' || role === 'LB') return { power: -5, speed: 2 };
      if (role === 'CB' || role === 'S') return { coverage: -6, speed: 3 };
      return { accuracy: 2 };
    case 'GROUND':
      if (role === 'QB') return { arm: -4, accuracy: -6, power: 8, speed: 5 };
      if (role === 'RB') return { power: 9, speed: 3, agility: 3, awareness: 3 };
      if (role === 'TE') return { power: 7, hands: 2 };
      if (role === 'WR') return { hands: -4, power: 6 };
      if (role === 'OL') return { power: 8, awareness: 4, agility: 2 };
      if (role === 'DL') return { power: 5 };
      if (role === 'LB') return { power: 6, coverage: -4 };
      if (role === 'CB' || role === 'S') return { power: 5, coverage: -3 };
      return { power: 3 };
    case 'PRESSURE':
      if (role === 'DL') return { power: 8, speed: 6, agility: 4 };
      if (role === 'LB') return { power: 6, speed: 4, agility: 3, coverage: -3 };
      if (role === 'OL') return { power: 4, awareness: 2 };
      if (role === 'S') return { power: 5, awareness: 3 };
      if (role === 'CB') return { coverage: 2 };
      if (role === 'QB') return { awareness: 3, power: 3 };
      return {};
    case 'COVERAGE':
      if (role === 'CB') return { coverage: 8, awareness: 6, hands: 5 };
      if (role === 'S') return { coverage: 7, awareness: 7, hands: 4 };
      if (role === 'LB') return { coverage: 7, awareness: 4, power: -3 };
      if (role === 'DL') return { awareness: 4, power: -2 };
      if (role === 'QB') return { awareness: 5, accuracy: 2 };
      if (role === 'WR' || role === 'TE') return { awareness: 3, hands: 2 };
      return {};
    case 'CHAOS':
      if (role === 'QB') return { agility: 9, speed: 8, arm: 4, accuracy: -7, awareness: -5 };
      if (role === 'WR' || role === 'RB' || role === 'TE') return { agility: 8, speed: 5, hands: -3, arm: 9 };
      if (role === 'OL') return { agility: 6, power: -4 };
      if (role === 'DL' || role === 'LB') return { agility: 6, speed: 4, awareness: -5 };
      if (role === 'CB' || role === 'S') return { agility: 7, hands: 6, coverage: -5, awareness: -4 };
      return { arm: 12, accuracy: 2 };
    case 'BALANCED':
    default:
      return { awareness: 4, agility: 2 };
  }
}

/** Team power sliders pull the athletes who own that phase of the game. */
function powerMod(power: TeamDef['power'] | undefined, role: RosterRole): Partial<Ratings> {
  if (!power) return {};
  const pass = (power.passing - 70) * 0.26;
  const run = (power.running - 70) * 0.24;
  const line = (power.line - 70) * 0.26;
  const cov = (power.coverage - 70) * 0.26;
  const spec = (power.special - 70) * 0.3;
  switch (role) {
    case 'QB': return { arm: pass, accuracy: pass, awareness: pass * 0.6, speed: run * 0.3 };
    case 'WR': return { speed: pass * 0.5, hands: pass, agility: pass * 0.4 };
    case 'TE': return { hands: pass * 0.7, power: run * 0.5, speed: pass * 0.3 };
    case 'RB': return { speed: run * 0.7, power: run, agility: run * 0.6, hands: pass * 0.4 };
    case 'OL': return { power: line, awareness: line * 0.5, agility: run * 0.3 };
    case 'DL': return { power: line * 0.9, speed: line * 0.4, agility: line * 0.4 };
    case 'LB': return { power: line * 0.6, coverage: cov * 0.6, speed: cov * 0.3, awareness: cov * 0.4 };
    case 'CB': return { coverage: cov, awareness: cov * 0.6, speed: cov * 0.4, hands: cov * 0.4 };
    case 'S': return { coverage: cov * 0.9, awareness: cov * 0.7, power: line * 0.3 };
    case 'K': return { accuracy: spec, arm: spec * 0.8, awareness: spec * 0.4 };
    default: return {};
  }
}

/** Spread of individual talent inside a roster — a few standouts, a few liabilities. */
const ROLE_VARIANCE: Record<RosterRole, number> = {
  QB: 4.5, WR: 6, RB: 6, TE: 5.5, OL: 5, DL: 5.5, LB: 5.5, CB: 6, S: 5.5, K: 5,
};

function buildRatings(
  role: RosterRole, style: TeamStyle, power: TeamDef['power'] | undefined, rng: Rng, star: number,
): Ratings {
  const base = BASE[role];
  const sm = styleMod(style, role);
  const pm = powerMod(power, role);
  const v = ROLE_VARIANCE[role];
  const out = {} as Ratings;
  for (const k of KEYS) {
    const raw = base[k] + (sm[k] ?? 0) + (pm[k] ?? 0) + star + rng.spread(v);
    out[k] = Math.round(clamp(raw, 40, 97));
  }
  return out;
}

// ──────────────────────────────────────────────────────────────── cosmetics

/** Cosmetic build range per role: 0 wiry, 1 massive. */
const BUILD_RANGE: Record<RosterRole, readonly [number, number]> = {
  QB: [0.34, 0.52],
  WR: [0.16, 0.36],
  RB: [0.42, 0.62],
  TE: [0.60, 0.78],
  OL: [0.82, 1.00],
  DL: [0.76, 0.96],
  LB: [0.55, 0.74],
  CB: [0.14, 0.32],
  S: [0.30, 0.50],
  K: [0.24, 0.42],
};

/** Flair pools (0 none, 1 towel, 2 armband, 3 visor, 4 sleeves, 5 long socks). */
const FLAIR_POOL: Record<RosterRole, readonly number[]> = {
  QB: [0, 1, 1, 2, 3, 3],
  WR: [0, 2, 2, 3, 4, 5],
  RB: [0, 1, 2, 2, 4, 5],
  TE: [0, 1, 2, 4, 4, 5],
  OL: [0, 0, 2, 4, 4, 5],
  DL: [0, 0, 2, 3, 4, 4],
  LB: [0, 1, 2, 2, 4, 5],
  CB: [0, 2, 3, 3, 5, 5],
  S: [0, 1, 2, 3, 4, 5],
  K: [0, 0, 1, 2, 3, 5],
};

// ──────────────────────────────────────────────────────────────── generation

/**
 * Build a fixed-order 15-athlete roster.
 *
 * Order: 0 QB | 1-3 skill | 4-6 OL | 7-9 front | 10-13 secondary | 14 kicker.
 * `power` is optional; supplying a team's power sliders shapes the roster to match.
 */
export function makeRoster(
  teamId: string,
  style: TeamStyle,
  rng: Rng,
  power?: TeamDef['power'],
): PlayerDef[] {
  const roles = rosterRoles(style);
  const usedNumbers = new Set<number>();
  const usedNames = new Set<string>();

  // Skin tones are laid out as an even ladder, jittered, then shuffled into slots so
  // no roster clusters at one end of the palette ramp.
  const tones: number[] = [];
  for (let i = 0; i < ROSTER_SIZE; i++) {
    tones.push(clamp((i + 0.5) / ROSTER_SIZE + rng.spread(0.022), 0.02, 0.98));
  }
  rng.shuffle(tones);

  // Two athletes per roster get a talent bump, two get a dip — arcade rosters need faces.
  const starIdx = rng.int(0, 3);
  const star2Idx = 4 + rng.int(0, 9);
  const dipIdx = 4 + rng.int(0, 9);

  const out: PlayerDef[] = [];
  for (let i = 0; i < ROSTER_SIZE; i++) {
    const role = roles[i];

    let name = '';
    for (let attempt = 0; attempt < 40; attempt++) {
      const candidate = `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
      if (!usedNames.has(candidate)) { name = candidate; break; }
    }
    if (name === '') name = `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)} ${usedNames.size}`;
    usedNames.add(name);

    let star = 0;
    if (i === starIdx || i === star2Idx) star += 6;
    if (i === dipIdx && i !== starIdx && i !== star2Idx) star -= 6;

    const br = BUILD_RANGE[role];
    out.push({
      name,
      number: pickNumber(role, rng, usedNumbers),
      pos: role === 'K' ? KICKER_POS : role,
      ratings: buildRatings(role, style, power, rng, star),
      build: Math.round(rng.range(br[0], br[1]) * 1000) / 1000,
      tone: Math.round(tones[i] * 1000) / 1000,
      flair: rng.pick(FLAIR_POOL[role]),
    });
  }
  return out;
}

/** Depth-chart label for UI. The kicker slot is reported as `K`. */
export function slotLabel(index: number, style: TeamStyle): RosterRole {
  const roles = rosterRoles(style);
  return roles[clamp(index, 0, ROSTER_SIZE - 1) | 0];
}
