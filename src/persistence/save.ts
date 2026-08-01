import type { CustomPlay, Difficulty, WeatherKind } from '../core/types.ts';
import type { QualityTier } from '../render/registry.ts';
import { KEYBOARD_P1, KEYBOARD_P2, type KeyboardBinding } from '../input/bindings.ts';

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
  resolutionScale: number;  // 0.5..1
  /** Let the game lower the render resolution when frames run long, and raise it back. */
  dynamicResolution: boolean;
  fullscreen: boolean;
  bindings: [KeyboardBinding, KeyboardBinding];
  catchUpBias: boolean;
  lateHits: boolean;
  passingMode: 'ICON' | 'DIRECTIONAL';
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
  season: SeasonSave | null;
  tournament: TournamentSave | null;
  customPlays: CustomPlay[];
  records: { wins: number; losses: number; ties: number; longestTd: number; mostPoints: number; gamesPlayed: number };
  lastTeams: { home: string; away: string; stadium: string; weather: WeatherKind };
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
    quality: 'HIGH',
    resolutionScale: 1,
    dynamicResolution: true,
    fullscreen: false,
    bindings: [{ ...KEYBOARD_P1 }, { ...KEYBOARD_P2 }],
    catchUpBias: true,
    lateHits: false,
    passingMode: 'ICON',
  };
}

export function defaultSave(): SaveFile {
  return {
    version: SAVE_VERSION,
    settings: defaultSettings(),
    season: null,
    tournament: null,
    customPlays: [],
    records: { wins: 0, losses: 0, ties: 0, longestTd: 0, mostPoints: 0, gamesPlayed: 0 },
    lastTeams: { home: '', away: '', stadium: '', weather: 'CLEAR' },
  };
}

function hasStorage(): boolean {
  try { return typeof localStorage !== 'undefined' && localStorage !== null; } catch { return false; }
}

/** Defensive load: unknown/older versions and corrupt JSON fall back to defaults. */
export function loadSave(): SaveFile {
  if (!hasStorage()) return defaultSave();
  let raw: string | null = null;
  try { raw = localStorage.getItem(SAVE_KEY); } catch { return defaultSave(); }
  if (!raw) return defaultSave();
  try {
    const parsed = JSON.parse(raw) as Partial<SaveFile>;
    if (!parsed || typeof parsed !== 'object' || parsed.version !== SAVE_VERSION) {
      return migrate(parsed);
    }
    const base = defaultSave();
    return {
      version: SAVE_VERSION,
      settings: { ...base.settings, ...(parsed.settings ?? {}), volumes: { ...base.settings.volumes, ...(parsed.settings?.volumes ?? {}) }, bindings: parsed.settings?.bindings ?? base.settings.bindings },
      season: parsed.season ?? null,
      tournament: parsed.tournament ?? null,
      customPlays: Array.isArray(parsed.customPlays) ? parsed.customPlays : [],
      records: { ...base.records, ...(parsed.records ?? {}) },
      lastTeams: { ...base.lastTeams, ...(parsed.lastTeams ?? {}) },
    };
  } catch {
    try { localStorage.setItem(`${SAVE_KEY}.corrupt`, raw); } catch { /* ignore */ }
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

export function getSave(): SaveFile {
  if (!cache) cache = loadSave();
  return cache;
}

export function writeSave(next?: Partial<SaveFile>): void {
  const s = getSave();
  if (next) Object.assign(s, next);
  if (!hasStorage()) return;
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch { /* quota — ignore */ }
}

export function resetSave(): void {
  cache = defaultSave();
  if (!hasStorage()) return;
  try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
}

export { KEYBOARD_P1, KEYBOARD_P2 };
