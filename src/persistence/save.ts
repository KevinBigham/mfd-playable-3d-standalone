import type { CustomPlay, Difficulty, WeatherKind } from '../core/types.ts';
import type { QualityTier } from '../render/registry.ts';
import { KEYBOARD_P1, KEYBOARD_P2, type KeyboardBinding } from '../input/bindings.ts';
import { defaultTouchProfile, sanitizeTouchProfile, type TouchProfile } from '../input/touch/touchProfile.ts';

export const SAVE_KEY = 'go.save.v1';
export const SAVE_VERSION = 1 as const;

export interface Settings {
  difficulty: Difficulty;
  quarterSeconds: number;
  playClock: boolean;
  helpPrompts: boolean;
  cameraShake: number;      // 0..1
  screenFlash: number;      // 0..1
  reducedMotion: boolean;
  largeHud: boolean;
  colorBlindMarkers: boolean;
  volumes: { master: number; sfx: number; crowd: number; music: number; ui: number };
  quality: QualityTier;
  /**
   * While true, `quality` is a measurement, not a choice: the performance governor may promote
   * or demote the tier from what it observes and persist the result. Touching GRAPHICS in
   * Settings pins the tier and clears this. Missing on old saves → default true via the merge.
   */
  autoQuality: boolean;
  resolutionScale: number;  // 0.5..1
  /** Let the game lower the render resolution when frames run long, and raise it back. */
  dynamicResolution: boolean;
  fullscreen: boolean;
  bindings: [KeyboardBinding, KeyboardBinding];
  catchUpBias: boolean;
  lateHits: boolean;
  passingMode: 'ICON' | 'DIRECTIONAL';
  /** Versioned thumb layout — see input/touch/touchProfile.ts. */
  touchProfile: TouchProfile;
}

export interface SeasonSave {
  teamId: string;
  week: number;
  schedule: Array<{ week: number; home: string; away: string; homeScore: number; awayScore: number; played: boolean }>;
  standings: Record<string, { w: number; l: number; t: number; pf: number; pa: number }>;
  playoffs: Array<{ round: number; home: string; away: string; homeScore: number; awayScore: number; played: boolean }>;
  champion: string | null;
  difficulty: Difficulty;
  seed: number;
  /** Locked when the season starts so CPU results stay comparable week to week. */
  quarterSeconds?: number;
  leaders: Record<string, { passYds: number; rushYds: number; sacks: number; ints: number; tds: number }>;
}

export interface TournamentSave {
  size: number;
  bestOf3: boolean;
  entrants: Array<{ teamId: string; human: boolean; seat: number }>;
  rounds: Array<Array<{ a: string; b: string; winsA: number; winsB: number; done: boolean }>>;
  round: number;
  champion: string | null;
  seed: number;
}

export interface SaveFile {
  version: 1;
  settings: Settings;
  /**
   * A match paused mid-game. One slot: this is "put the controller down", not a save-state
   * library, and a second slot would need a UI that earns its place on the pause menu.
   * Cleared when the match is resumed or abandoned, so it never resurrects a game you finished.
   */
  suspendedMatch: unknown | null;
  season: SeasonSave | null;
  tournament: TournamentSave | null;
  customPlays: CustomPlay[];
  records: { wins: number; losses: number; ties: number; longestTd: number; mostPoints: number; gamesPlayed: number };
  lastTeams: { home: string; away: string; stadium: string; weather: WeatherKind };
}

/**
 * The single-file artifact starts one graphics tier down. It runs inside someone else's page,
 * usually on a machine already busy rendering a chat, and a first impression that stutters is
 * worse than one that is slightly softer. Everything is still changeable in Settings, and the
 * adaptive-resolution governor works either way.
 */
/**
 * The tier a machine starts on, before the player has ever opened Settings.
 *
 * A coarse pointer takes LOW, and it is not a guess about taste — it is the measured spread.
 * On a strong GPU every tier costs the same (2.7 ms at p50, all three) so the choice is free;
 * on a weak one HIGH runs 67.5 ms at p95 against LOW's 16.8, a 4x gap that is the difference
 * between a game and a slideshow. Phones live at the weak end and this file cannot tell an A18
 * from a five-year-old Android, so it takes the option that is recoverable: too low is a
 * settings change away, too high is a player who leaves.
 *
 * Dynamic resolution does not cover this. It scales the framebuffer and nothing else — the
 * shadow map, the post chain and the crowd are all fixed by the tier.
 *
 * `matchMedia` is read inline rather than through `uiKit.coarsePointer` on purpose: persistence
 * has no other reason to depend on the interface layer, and this is the only line that would
 * create the edge.
 */
function defaultQuality(): QualityTier {
  try {
    if (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) return 'LOW';
    if (typeof window !== 'undefined' && (window as unknown as { __GO_ARTIFACT__?: boolean }).__GO_ARTIFACT__) {
      return 'MEDIUM';
    }
  } catch { /* not a browser */ }
  return 'HIGH';
}

export function defaultSettings(): Settings {
  return {
    difficulty: 'PRO',
    quarterSeconds: 120,
    playClock: false,
    helpPrompts: true,
    cameraShake: 0.8,
    screenFlash: 0.7,
    reducedMotion: false,
    largeHud: false,
    colorBlindMarkers: false,
    volumes: { master: 0.85, sfx: 0.9, crowd: 0.7, music: 0.6, ui: 0.8 },
    quality: defaultQuality(),
    autoQuality: true,
    resolutionScale: 1,
    dynamicResolution: true,
    fullscreen: false,
    bindings: [{ ...KEYBOARD_P1 }, { ...KEYBOARD_P2 }],
    catchUpBias: true,
    lateHits: false,
    passingMode: 'ICON',
    touchProfile: defaultTouchProfile(),
  };
}

export function defaultSave(): SaveFile {
  return {
    version: SAVE_VERSION,
    settings: defaultSettings(),
    season: null,
    tournament: null,
    suspendedMatch: null,
    customPlays: [],
    records: { wins: 0, losses: 0, ties: 0, longestTd: 0, mostPoints: 0, gamesPlayed: 0 },
    lastTeams: { home: '', away: '', stadium: '', weather: 'CLEAR' },
  };
}

/**
 * Storage backend.
 *
 * `localStorage` when it actually works, an in-memory map when it does not. It fails to work in
 * more places than you would think: private browsing, a sandboxed iframe with no storage access,
 * a quota that is already full, and the single-file artifact build. The old code simply gave up
 * in those cases, so settings changed during a session were forgotten the moment you left the
 * settings screen. Memory keeps a session coherent; only persistence between sessions is lost.
 *
 * Detection is a real write-then-remove probe. Testing for the object's existence is not enough —
 * the throw happens on ACCESS, not on lookup.
 */
const memory = new Map<string, string>();
let backend: 'LOCAL' | 'MEMORY' | null = null;

function pickBackend(): 'LOCAL' | 'MEMORY' {
  if (backend) return backend;
  try {
    const probe = `${SAVE_KEY}.probe`;
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    backend = 'LOCAL';
  } catch {
    backend = 'MEMORY';
  }
  return backend;
}

/** Which backend is live. Shown in Settings so a player knows whether a season will survive. */
export function storageKind(): 'LOCAL' | 'MEMORY' { return pickBackend(); }

function readItem(key: string): string | null {
  if (pickBackend() === 'MEMORY') return memory.get(key) ?? null;
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeItem(key: string, value: string): void {
  if (pickBackend() === 'MEMORY') { memory.set(key, value); return; }
  try { localStorage.setItem(key, value); } catch { memory.set(key, value); }
}
function removeItem(key: string): void {
  memory.delete(key);
  if (pickBackend() === 'MEMORY') return;
  try { localStorage.removeItem(key); } catch { /* nothing to undo */ }
}

/** Defensive load: unknown/older versions and corrupt JSON fall back to defaults. */
export function loadSave(): SaveFile {
  const raw = readItem(SAVE_KEY);
  if (!raw) return defaultSave();
  try {
    const parsed = JSON.parse(raw) as Partial<SaveFile>;
    if (!parsed || typeof parsed !== 'object' || parsed.version !== SAVE_VERSION) {
      return migrate(parsed);
    }
    const base = defaultSave();
    return {
      version: SAVE_VERSION,
      settings: {
        ...base.settings, ...(parsed.settings ?? {}),
        volumes: { ...base.settings.volumes, ...(parsed.settings?.volumes ?? {}) },
        bindings: parsed.settings?.bindings ?? base.settings.bindings,
        touchProfile: sanitizeTouchProfile(parsed.settings?.touchProfile),
      },
      season: parsed.season ?? null,
      tournament: parsed.tournament ?? null,
      suspendedMatch: parsed.suspendedMatch ?? null,
      customPlays: Array.isArray(parsed.customPlays) ? parsed.customPlays : [],
      records: { ...base.records, ...(parsed.records ?? {}) },
      lastTeams: { ...base.lastTeams, ...(parsed.lastTeams ?? {}) },
    };
  } catch {
    writeItem(`${SAVE_KEY}.corrupt`, raw);
    return defaultSave();
  }
}

function migrate(parsed: unknown): SaveFile {
  const base = defaultSave();
  if (parsed && typeof parsed === 'object' && 'settings' in parsed) {
    const s = (parsed as { settings?: Partial<Settings> }).settings;
    if (s) base.settings = { ...base.settings, ...s, volumes: { ...base.settings.volumes, ...(s.volumes ?? {}) }, bindings: base.settings.bindings };
  }
  return base;
}

let cache: SaveFile | null = null;

/**
 * Optional v2 write-through, attached at boot when the persistenceV2 flag is on. Every settled
 * write also lands as a checksummed IndexedDB revision; reads still come from the fast local
 * cache, with v2 recovery handled during boot before the first getSave().
 */
let v2Sink: ((payload: SaveFile) => void) | null = null;
export function attachV2Sink(sink: (payload: SaveFile) => void): void { v2Sink = sink; }
/** Boot-time restore: replace the cache with a recovered/migrated payload before first use. */
export function primeCache(payload: SaveFile): void { cache = payload; }

export function getSave(): SaveFile {
  if (!cache) cache = loadSave();
  return cache;
}

export function writeSave(next?: Partial<SaveFile>): void {
  const s = getSave();
  if (next) Object.assign(s, next);
  writeItem(SAVE_KEY, JSON.stringify(s));
  v2Sink?.(s);
}

/**
 * Settings write discipline: apply to memory immediately, hit storage once after the dial stops
 * moving. A volume slider fires per step, and serialising the whole save file per step is layout
 * and I/O churn a phone notices. Anything that must survive a sudden death — a suspended match,
 * a lifecycle interruption — uses `writeSave` or `flushSave` directly.
 */
let writeTimer: ReturnType<typeof setTimeout> | null = null;

export function writeSaveDebounced(next?: Partial<SaveFile>, delayMs = 350): void {
  const s = getSave();
  if (next) Object.assign(s, next);
  if (writeTimer !== null) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => { writeTimer = null; writeItem(SAVE_KEY, JSON.stringify(getSave())); }, delayMs);
}

/** Force any pending debounced write to storage now. Safe to call when nothing is pending. */
export function flushSave(): void {
  if (writeTimer === null) return;
  clearTimeout(writeTimer);
  writeTimer = null;
  writeItem(SAVE_KEY, JSON.stringify(getSave()));
}

export function resetSave(): void {
  cache = defaultSave();
  removeItem(SAVE_KEY);
}

export { KEYBOARD_P1, KEYBOARD_P2 };
