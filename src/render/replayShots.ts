/** Strict, data-only replay shot contract. No executable callbacks or simulation references. */

export type ReplayEventKind =
  | 'TOUCHDOWN' | 'INTERCEPTION' | 'FUMBLE_RECOVERY' | 'SACK' | 'EXPLOSIVE_RUN'
  | 'EXPLOSIVE_PASS' | 'TACKLE_FOR_LOSS' | 'FOURTH_DOWN_STOP' | 'FIELD_GOAL' | 'GAME_WINNING';

export type ReplayTargetRole =
  | 'BALL' | 'CARRIER' | 'PASSER' | 'RECEIVER' | 'DEFENDER' | 'SCORER'
  | 'NEAREST_CONTEST' | 'FORMATION_CENTER';

export type ReplayEasing = 'LINEAR' | 'SMOOTH' | 'EASE_IN' | 'EASE_OUT' | 'EASE_IN_OUT';

export interface ReplayShotV1 {
  id: string;
  start: number;
  end: number;
  target: ReplayTargetRole;
  cameraOffset: { x: number; y: number; z: number };
  fieldOffset: { x: number; z: number };
  fov: number;
  easing: ReplayEasing;
  lookAhead?: number;
  slowMotion?: number;
  hold?: number;
  hud?: 'FULL' | 'MINIMAL' | 'HIDDEN';
}

export interface MfdReplayShotSetV1 {
  version: 1;
  id: string;
  eventKinds: ReplayEventKind[];
  minClipSeconds: number;
  shots: ReplayShotV1[];
}

export interface ReplayValidation { ok: boolean; errors: string[]; value?: MfdReplayShotSetV1 }

const EVENTS = new Set<ReplayEventKind>([
  'TOUCHDOWN', 'INTERCEPTION', 'FUMBLE_RECOVERY', 'SACK', 'EXPLOSIVE_RUN', 'EXPLOSIVE_PASS',
  'TACKLE_FOR_LOSS', 'FOURTH_DOWN_STOP', 'FIELD_GOAL', 'GAME_WINNING',
]);
const TARGETS = new Set<ReplayTargetRole>([
  'BALL', 'CARRIER', 'PASSER', 'RECEIVER', 'DEFENDER', 'SCORER', 'NEAREST_CONTEST', 'FORMATION_CENTER',
]);
const EASINGS = new Set<ReplayEasing>(['LINEAR', 'SMOOTH', 'EASE_IN', 'EASE_OUT', 'EASE_IN_OUT']);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const bounded = (v: unknown, lo: number, hi: number): boolean => finite(v) && v >= lo && v <= hi;
const vec3 = (v: any): boolean => v && bounded(v.x, -40, 40) && bounded(v.y, -10, 40) && bounded(v.z, -40, 40);
const vec2 = (v: any): boolean => v && bounded(v.x, -40, 40) && bounded(v.z, -40, 40);

export function validateReplayShotSet(input: unknown): ReplayValidation {
  const errors: string[] = [];
  const s = input as any;
  if (!s || typeof s !== 'object') return { ok: false, errors: ['shot set must be an object'] };
  if (s.version !== 1) errors.push('version must be 1');
  if (typeof s.id !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(s.id)) errors.push('id is invalid');
  if (!Array.isArray(s.eventKinds) || s.eventKinds.length === 0 || s.eventKinds.some((e: unknown) => !EVENTS.has(e as ReplayEventKind))) errors.push('eventKinds contains an invalid kind');
  if (!bounded(s.minClipSeconds, 0.5, 12)) errors.push('minClipSeconds must be 0.5..12');
  if (!Array.isArray(s.shots) || s.shots.length < 1 || s.shots.length > 12) errors.push('shots must contain 1..12 entries');
  let previous = 0;
  for (let i = 0; i < (Array.isArray(s.shots) ? s.shots.length : 0); i++) {
    const sh = s.shots[i];
    const at = `shots[${i}]`;
    if (!sh || typeof sh !== 'object') { errors.push(`${at} must be an object`); continue; }
    const allowed = new Set(['id', 'start', 'end', 'target', 'cameraOffset', 'fieldOffset', 'fov', 'easing', 'lookAhead', 'slowMotion', 'hold', 'hud']);
    for (const key of Object.keys(sh)) if (!allowed.has(key)) errors.push(`${at}.${key} is not permitted`);
    if (typeof sh.id !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(sh.id)) errors.push(`${at}.id is invalid`);
    if (!bounded(sh.start, 0, 1) || !bounded(sh.end, 0, 1) || sh.end <= sh.start) errors.push(`${at} time range is invalid`);
    if (i > 0 && sh.start < previous) errors.push(`${at} is not ordered`);
    previous = finite(sh.end) ? sh.end : previous;
    if (!TARGETS.has(sh.target)) errors.push(`${at}.target is invalid`);
    if (!vec3(sh.cameraOffset) || !vec2(sh.fieldOffset)) errors.push(`${at} offset is invalid`);
    if (!bounded(sh.fov, 25, 90)) errors.push(`${at}.fov is invalid`);
    if (!EASINGS.has(sh.easing)) errors.push(`${at}.easing is invalid`);
    if (sh.lookAhead !== undefined && !bounded(sh.lookAhead, 0, 2)) errors.push(`${at}.lookAhead is invalid`);
    if (sh.slowMotion !== undefined && !bounded(sh.slowMotion, 0.1, 1)) errors.push(`${at}.slowMotion is invalid`);
    if (sh.hold !== undefined && !bounded(sh.hold, 0, 3)) errors.push(`${at}.hold is invalid`);
    if (sh.hud !== undefined && !['FULL', 'MINIMAL', 'HIDDEN'].includes(sh.hud)) errors.push(`${at}.hud is invalid`);
  }
  return errors.length ? { ok: false, errors } : { ok: true, errors: [], value: canonicalizeReplayShotSet(s) };
}

export function canonicalizeReplayShotSet(s: MfdReplayShotSetV1): MfdReplayShotSetV1 {
  return JSON.parse(JSON.stringify({ version: 1, id: s.id, eventKinds: [...s.eventKinds].sort(), minClipSeconds: s.minClipSeconds,
    shots: s.shots.map((x) => ({ id: x.id, start: x.start, end: x.end, target: x.target, cameraOffset: x.cameraOffset,
      fieldOffset: x.fieldOffset, fov: x.fov, easing: x.easing, ...(x.lookAhead === undefined ? {} : { lookAhead: x.lookAhead }),
      ...(x.slowMotion === undefined ? {} : { slowMotion: x.slowMotion }), ...(x.hold === undefined ? {} : { hold: x.hold }),
      ...(x.hud === undefined ? {} : { hud: x.hud }) })) })) as MfdReplayShotSetV1;
}

/** Stable non-cryptographic asset fingerprint; sufficient for deterministic asset identity. */
export function replayShotSetHash(s: MfdReplayShotSetV1): string {
  const text = JSON.stringify(canonicalizeReplayShotSet(s));
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16).padStart(8, '0');
}

export const FALLBACK_REPLAY_SHOTS: MfdReplayShotSetV1 = {
  version: 1, id: 'fallback-broadcast', eventKinds: [
    'TOUCHDOWN', 'INTERCEPTION', 'FUMBLE_RECOVERY', 'SACK', 'EXPLOSIVE_RUN', 'EXPLOSIVE_PASS',
    'TACKLE_FOR_LOSS', 'FOURTH_DOWN_STOP', 'FIELD_GOAL', 'GAME_WINNING',
  ], minClipSeconds: 1.5,
  shots: [
    { id: 'wide', start: 0, end: 0.42, target: 'BALL', cameraOffset: { x: 0, y: 7, z: 16 }, fieldOffset: { x: 0, z: 0 }, fov: 44, easing: 'SMOOTH', hud: 'MINIMAL' },
    { id: 'field-level', start: 0.42, end: 0.76, target: 'CARRIER', cameraOffset: { x: 5, y: 3, z: 9 }, fieldOffset: { x: 0, z: 0 }, fov: 38, easing: 'EASE_IN_OUT', slowMotion: 0.55, hud: 'HIDDEN' },
    { id: 'end-zone', start: 0.76, end: 1, target: 'FORMATION_CENTER', cameraOffset: { x: -8, y: 6, z: 11 }, fieldOffset: { x: 0, z: 0 }, fov: 42, easing: 'EASE_OUT', hold: 0.4, hud: 'MINIMAL' },
  ],
};
