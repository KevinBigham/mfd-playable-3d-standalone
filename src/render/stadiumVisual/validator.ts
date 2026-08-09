import { STADIUM_IDS, findStadium } from '../../data/stadiums.ts';
import { checkProtectedField } from './protection.ts';
import {
  STADIUM_VISUAL_SCHEMA, STADIUM_VISUAL_VERSION,
  type MfdStadiumVisualV1, type QualityTier, type RoofStyle,
  type StadiumVisualValidationIssue, type StadiumVisualValidationResult,
  type ValidateStadiumVisualOptions,
} from './types.ts';

export const STADIUM_VISUAL_LIMITS = {
  bowl: {
    centerZMin: 20, centerZMax: 80,
    halfXMin: 37, halfXMax: 100,
    halfZMin: 70, halfZMax: 160,
    cornerRadiusMin: 4, cornerRadiusMax: 60,
    aisleEveryMin: 2, aisleEveryMax: 32,
    profileMax: 24,
    openingMax: 8,
    openingFractionMax: 0.75,
  },
  features: { tunnels: 12, scoreboards: 6, lightTowers: 12, banners: 48, skyline: 48, total: 120 },
  semanticElements: 160,
} as const;

const ROOT_KEYS = ['schema', 'version', 'stadiumId', 'units', 'coordinateSystem', 'bowl', 'roof',
  'tunnels', 'scoreboards', 'lightTowers', 'banners', 'skyline', 'authoring'] as const;
const COORD_KEYS = ['x', 'y', 'z'] as const;
const BOWL_KEYS = ['centerZ', 'halfX', 'halfZ', 'cornerRadius', 'aisleEvery', 'profile', 'openings'] as const;
const PROFILE_KEYS = ['role', 'radialRunYd', 'riseYd'] as const;
const OPENING_KEYS = ['startT', 'endT'] as const;
const ROOF_KEYS = ['style', 'coverage', 'heightYd', 'radialOverhangYd'] as const;
const TUNNEL_KEYS = ['perimeterT', 'widthYd', 'heightYd'] as const;
const SCOREBOARD_KEYS = ['perimeterT', 'widthYd', 'heightYd', 'elevationYd', 'outwardOffsetYd'] as const;
const TOWER_KEYS = ['perimeterT', 'heightYd', 'outwardOffsetYd'] as const;
const BANNER_KEYS = ['perimeterT', 'widthYd', 'heightYd', 'elevationYd', 'colorRole', 'minQuality'] as const;
const SKYLINE_KEYS = ['kind', 'position', 'size', 'colorRole', 'minQuality'] as const;
const VEC_KEYS = ['x', 'y', 'z'] as const;
const AUTHORING_KEYS = ['author', 'notes', 'pascalSceneVersion', 'exportedAt'] as const;

const ROLES = new Set(['ground', 'signage', 'structure', 'dark', 'accent', 'seats', 'outer']);
const QUALITY = new Set<QualityTier>(['LOW', 'MEDIUM', 'HIGH']);
const BANNER_COLORS = new Set(['accent', 'home-primary', 'home-secondary', 'neutral']);
const SKYLINE_COLORS = new Set(['structure', 'dark', 'accent', 'neutral']);
const SKYLINE_KINDS = new Set(['block', 'stack', 'spire', 'tank', 'rock']);
const ROOF_STYLES = new Set<RoofStyle>(['none', 'canopy', 'dome']);

type Obj = Record<string, unknown>;

function objectAt(value: unknown, path: string, issues: StadiumVisualValidationIssue[]): Obj | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    issues.push({ path, code: 'TYPE', message: `${path} must be an object` });
    return null;
  }
  return value as Obj;
}

function rejectUnknown(obj: Obj, allowed: readonly string[], path: string, issues: StadiumVisualValidationIssue[]): void {
  const set = new Set(allowed);
  for (const key of Object.keys(obj)) {
    if (!set.has(key)) {
      issues.push({
        path: path ? `${path}.${key}` : key,
        code: 'UNKNOWN_FIELD',
        message: `${path ? `${path}.` : ''}${key} is not supported`,
      });
    }
  }
}

function required(obj: Obj, key: string, path: string, issues: StadiumVisualValidationIssue[]): unknown {
  if (!(key in obj)) {
    const p = path ? `${path}.${key}` : key;
    issues.push({ path: p, code: 'REQUIRED', message: `${p} is required` });
    return undefined;
  }
  return obj[key];
}

function exact(value: unknown, want: unknown, path: string, issues: StadiumVisualValidationIssue[]): void {
  if (value !== want) issues.push({ path, code: 'VALUE', message: `${path} must equal ${JSON.stringify(want)}` });
}

function stringAt(
  value: unknown, path: string, issues: StadiumVisualValidationIssue[],
  opts: { min?: number; max?: number; values?: Set<string> } = {},
): value is string {
  if (typeof value !== 'string') {
    issues.push({ path, code: 'TYPE', message: `${path} must be a string` });
    return false;
  }
  if ((opts.min ?? 0) > value.length || value.length > (opts.max ?? Infinity)) {
    issues.push({ path, code: 'RANGE', message: `${path} length is outside the supported range` });
  }
  if (opts.values && !opts.values.has(value)) {
    issues.push({ path, code: 'ENUM', message: `${path} has unsupported value ${JSON.stringify(value)}` });
  }
  return true;
}

function numberAt(
  value: unknown, path: string, issues: StadiumVisualValidationIssue[],
  opts: { min?: number; max?: number; minExclusive?: boolean; maxExclusive?: boolean; integer?: boolean } = {},
): value is number {
  if (typeof value !== 'number') {
    issues.push({ path, code: 'TYPE', message: `${path} must be a number` });
    return false;
  }
  if (!Number.isFinite(value)) {
    issues.push({ path, code: 'FINITE', message: `${path} must be finite` });
    return false;
  }
  if (opts.integer && !Number.isInteger(value)) {
    issues.push({ path, code: 'INTEGER', message: `${path} must be an integer` });
  }
  if (opts.min !== undefined && (opts.minExclusive ? value <= opts.min : value < opts.min)) {
    issues.push({ path, code: 'RANGE', message: `${path} must be ${opts.minExclusive ? 'greater than' : 'at least'} ${opts.min}` });
  }
  if (opts.max !== undefined && (opts.maxExclusive ? value >= opts.max : value > opts.max)) {
    issues.push({ path, code: 'RANGE', message: `${path} must be ${opts.maxExclusive ? 'less than' : 'at most'} ${opts.max}` });
  }
  return true;
}

function arrayAt(value: unknown, path: string, issues: StadiumVisualValidationIssue[], max: number): unknown[] | null {
  if (!Array.isArray(value)) {
    issues.push({ path, code: 'TYPE', message: `${path} must be an array` });
    return null;
  }
  if (value.length > max) issues.push({ path, code: 'COUNT', message: `${path} supports at most ${max} elements` });
  return value;
}

function perimeter(value: unknown, path: string, issues: StadiumVisualValidationIssue[]): void {
  numberAt(value, path, issues, { min: 0, max: 1, maxExclusive: true });
}

function validateProfile(bowl: Obj, issues: StadiumVisualValidationIssue[]): void {
  const raw = required(bowl, 'profile', 'bowl', issues);
  const list = arrayAt(raw, 'bowl.profile', issues, STADIUM_VISUAL_LIMITS.bowl.profileMax);
  if (!list) return;
  if (list.length < 3) issues.push({ path: 'bowl.profile', code: 'COUNT', message: 'bowl.profile needs at least three segments' });

  const firstRaw = list[0] as Obj | undefined;
  const firstRun = typeof firstRaw?.radialRunYd === 'number' && Number.isFinite(firstRaw.radialRunYd)
    ? firstRaw.radialRunYd : 0;
  const firstRise = typeof firstRaw?.riseYd === 'number' && Number.isFinite(firstRaw.riseYd)
    ? firstRaw.riseYd : 0;
  // The ground segment begins beneath/inside the loop and terminates at loop r=0,y=0.
  let r = -firstRun; let y = -firstRise; let radialSpan = 0; let maxY = y; let seatCount = 0;
  for (let i = 0; i < list.length; i++) {
    const path = `bowl.profile[${i}]`;
    const seg = objectAt(list[i], path, issues);
    if (!seg) continue;
    rejectUnknown(seg, PROFILE_KEYS, path, issues);
    const role = required(seg, 'role', path, issues);
    const run = required(seg, 'radialRunYd', path, issues);
    const rise = required(seg, 'riseYd', path, issues);
    stringAt(role, `${path}.role`, issues, { values: ROLES });
    const runOk = numberAt(run, `${path}.radialRunYd`, issues, { min: 0, max: 40 });
    const riseOk = numberAt(rise, `${path}.riseYd`, issues, { min: -80, max: 60 });
    if (!runOk || !riseOk) continue;
    if (Math.abs(run) < 1e-9 && Math.abs(rise) < 1e-9) {
      issues.push({ path, code: 'DEGENERATE', message: `${path} must have radial run or rise` });
    }
    if (role !== 'outer' && rise < 0) {
      issues.push({ path: `${path}.riseYd`, code: 'ORDER', message: 'only the final outer segment may descend' });
    }
    if (role === 'outer' && i !== list.length - 1) {
      issues.push({ path: `${path}.role`, code: 'ORDER', message: 'outer must be the final profile segment' });
    }
    if (role === 'seats') {
      seatCount++;
      if (run <= 0 || rise <= 0) {
        issues.push({ path, code: 'SEAT_BAND', message: 'seat bands require positive radial run and rise' });
      }
    }
    r += run; radialSpan += run; y += rise; maxY = Math.max(maxY, y);
    if (y < -1e-6) issues.push({ path, code: 'ORDER', message: 'profile descends below grade' });
  }
  const first = list[0] as Obj | undefined;
  const last = list[list.length - 1] as Obj | undefined;
  if (first?.role !== 'ground') issues.push({ path: 'bowl.profile[0].role', code: 'ORDER', message: 'profile must start with ground' });
  if (last?.role !== 'outer') issues.push({ path: `bowl.profile[${Math.max(0, list.length - 1)}].role`, code: 'ORDER', message: 'profile must end with outer' });
  if (seatCount === 0) issues.push({ path: 'bowl.profile', code: 'SEAT_BAND', message: 'profile requires at least one seat band' });
  if (radialSpan < 10 || radialSpan > 100) issues.push({ path: 'bowl.profile', code: 'RANGE', message: 'profile radial extent must be between 10 and 100 yards' });
  if (maxY < 5 || maxY > 80) issues.push({ path: 'bowl.profile', code: 'RANGE', message: 'profile height must be between 5 and 80 yards' });
  if (Math.abs(y) > 1e-6) issues.push({ path: 'bowl.profile', code: 'ORDER', message: 'final outer segment must return the profile to grade' });
}

function validateOpenings(bowl: Obj, issues: StadiumVisualValidationIssue[]): void {
  if (!('openings' in bowl)) return;
  const list = arrayAt(bowl.openings, 'bowl.openings', issues, STADIUM_VISUAL_LIMITS.bowl.openingMax);
  if (!list) return;
  let previousEnd = -1;
  let opened = 0;
  for (let i = 0; i < list.length; i++) {
    const path = `bowl.openings[${i}]`;
    const item = objectAt(list[i], path, issues);
    if (!item) continue;
    rejectUnknown(item, OPENING_KEYS, path, issues);
    const start = required(item, 'startT', path, issues);
    const end = required(item, 'endT', path, issues);
    const startOk = numberAt(start, `${path}.startT`, issues, { min: 0, max: 1, maxExclusive: true });
    const endOk = numberAt(end, `${path}.endT`, issues, { min: 0, max: 1 });
    if (!startOk || !endOk) continue;
    if (start >= end) issues.push({ path, code: 'OPENING_RANGE', message: 'opening must be non-wrapping with startT < endT' });
    if (start < previousEnd) issues.push({ path: `${path}.startT`, code: 'OPENING_OVERLAP', message: 'openings must be sorted and non-overlapping' });
    previousEnd = Math.max(previousEnd, end);
    opened += Math.max(0, end - start);
  }
  if (opened >= STADIUM_VISUAL_LIMITS.bowl.openingFractionMax) {
    issues.push({
      path: 'bowl.openings', code: 'OPENING_TOTAL',
      message: `openings must remove less than ${STADIUM_VISUAL_LIMITS.bowl.openingFractionMax * 100}% of the bowl`,
    });
  }
}

function validateBowl(root: Obj, issues: StadiumVisualValidationIssue[]): void {
  const bowl = objectAt(required(root, 'bowl', '', issues), 'bowl', issues);
  if (!bowl) return;
  rejectUnknown(bowl, BOWL_KEYS, 'bowl', issues);
  numberAt(required(bowl, 'centerZ', 'bowl', issues), 'bowl.centerZ', issues,
    { min: STADIUM_VISUAL_LIMITS.bowl.centerZMin, max: STADIUM_VISUAL_LIMITS.bowl.centerZMax });
  numberAt(required(bowl, 'halfX', 'bowl', issues), 'bowl.halfX', issues,
    { min: STADIUM_VISUAL_LIMITS.bowl.halfXMin, minExclusive: true, max: STADIUM_VISUAL_LIMITS.bowl.halfXMax });
  numberAt(required(bowl, 'halfZ', 'bowl', issues), 'bowl.halfZ', issues,
    { min: STADIUM_VISUAL_LIMITS.bowl.halfZMin, max: STADIUM_VISUAL_LIMITS.bowl.halfZMax });
  const radius = required(bowl, 'cornerRadius', 'bowl', issues);
  const radiusOk = numberAt(radius, 'bowl.cornerRadius', issues,
    { min: STADIUM_VISUAL_LIMITS.bowl.cornerRadiusMin, max: STADIUM_VISUAL_LIMITS.bowl.cornerRadiusMax });
  const halfX = bowl.halfX; const halfZ = bowl.halfZ;
  if (radiusOk && typeof halfX === 'number' && Number.isFinite(halfX)
    && typeof halfZ === 'number' && Number.isFinite(halfZ)
    && radius >= Math.min(halfX, halfZ)) {
    issues.push({ path: 'bowl.cornerRadius', code: 'PLAN', message: 'cornerRadius must be smaller than both bowl half-extents' });
  }
  numberAt(required(bowl, 'aisleEvery', 'bowl', issues), 'bowl.aisleEvery', issues, {
    min: STADIUM_VISUAL_LIMITS.bowl.aisleEveryMin,
    max: STADIUM_VISUAL_LIMITS.bowl.aisleEveryMax,
    integer: true,
  });
  validateProfile(bowl, issues);
  validateOpenings(bowl, issues);
}

function validateRoof(root: Obj, stadiumId: unknown, issues: StadiumVisualValidationIssue[]): void {
  // The development flag permits an unknown preview ID; it never weakens an existing StadiumDef.
  const stadium = typeof stadiumId === 'string' ? findStadium(stadiumId) : null;
  if (!('roof' in root)) {
    if (stadium) {
      issues.push({
        path: 'roof',
        code: 'REQUIRED',
        message: `roof is required because StadiumDef owns the roof category for ${stadiumId}`,
      });
    }
    return;
  }
  const roof = objectAt(root.roof, 'roof', issues);
  if (!roof) return;
  rejectUnknown(roof, ROOF_KEYS, 'roof', issues);
  const style = required(roof, 'style', 'roof', issues);
  const coverage = required(roof, 'coverage', 'roof', issues);
  const height = required(roof, 'heightYd', 'roof', issues);
  const overhang = required(roof, 'radialOverhangYd', 'roof', issues);
  stringAt(style, 'roof.style', issues, { values: ROOF_STYLES });
  const coverageOk = numberAt(coverage, 'roof.coverage', issues, { min: 0, max: 1 });
  const heightOk = numberAt(height, 'roof.heightYd', issues, { min: 0, max: 100 });
  const overhangOk = numberAt(overhang, 'roof.radialOverhangYd', issues, { min: 0, max: 30 });
  if (style === 'none' && coverageOk && heightOk && overhangOk
    && (coverage !== 0 || height !== 0 || overhang !== 0)) {
    issues.push({ path: 'roof', code: 'ROOF_NONE', message: 'none roof must use zero coverage, height, and overhang' });
  }
  if (style === 'canopy' && coverageOk && (coverage <= 0 || coverage >= 1)) {
    issues.push({ path: 'roof.coverage', code: 'ROOF_COVERAGE', message: 'canopy coverage must be greater than 0 and less than 1' });
  }
  if (style === 'dome' && coverageOk && coverage !== 1) {
    issues.push({ path: 'roof.coverage', code: 'ROOF_COVERAGE', message: 'dome coverage must equal 1' });
  }
  if (stadium) {
    const expected: RoofStyle = stadium.roof === 0 ? 'none' : stadium.roof === 1 ? 'canopy' : 'dome';
    if (style !== expected) {
      issues.push({ path: 'roof.style', code: 'ROOF_COMPATIBILITY', message: `roof.style must be ${expected} for ${stadiumId}` });
    }
  }
}

function validateObjectArray(
  root: Obj,
  key: string,
  max: number,
  allowedKeys: readonly string[],
  validate: (obj: Obj, path: string) => void,
  issues: StadiumVisualValidationIssue[],
): void {
  if (!(key in root)) return;
  const list = arrayAt(root[key], key, issues, max);
  if (!list) return;
  for (let i = 0; i < list.length; i++) {
    const path = `${key}[${i}]`;
    const obj = objectAt(list[i], path, issues);
    if (!obj) continue;
    rejectUnknown(obj, allowedKeys, path, issues);
    validate(obj, path);
  }
}

function validateFeatures(root: Obj, issues: StadiumVisualValidationIssue[]): void {
  validateObjectArray(root, 'tunnels', STADIUM_VISUAL_LIMITS.features.tunnels, TUNNEL_KEYS, (obj, path) => {
    perimeter(required(obj, 'perimeterT', path, issues), `${path}.perimeterT`, issues);
    numberAt(required(obj, 'widthYd', path, issues), `${path}.widthYd`, issues, { min: 0.5, max: 20 });
    numberAt(required(obj, 'heightYd', path, issues), `${path}.heightYd`, issues, { min: 1, max: 12 });
  }, issues);
  validateObjectArray(root, 'scoreboards', STADIUM_VISUAL_LIMITS.features.scoreboards, SCOREBOARD_KEYS, (obj, path) => {
    perimeter(required(obj, 'perimeterT', path, issues), `${path}.perimeterT`, issues);
    numberAt(required(obj, 'widthYd', path, issues), `${path}.widthYd`, issues, { min: 2, max: 80 });
    numberAt(required(obj, 'heightYd', path, issues), `${path}.heightYd`, issues, { min: 1, max: 30 });
    numberAt(required(obj, 'elevationYd', path, issues), `${path}.elevationYd`, issues, { min: 1, max: 80 });
    numberAt(required(obj, 'outwardOffsetYd', path, issues), `${path}.outwardOffsetYd`, issues, { min: 0, max: 50 });
  }, issues);
  validateObjectArray(root, 'lightTowers', STADIUM_VISUAL_LIMITS.features.lightTowers, TOWER_KEYS, (obj, path) => {
    perimeter(required(obj, 'perimeterT', path, issues), `${path}.perimeterT`, issues);
    numberAt(required(obj, 'heightYd', path, issues), `${path}.heightYd`, issues, { min: 12, max: 100 });
    numberAt(required(obj, 'outwardOffsetYd', path, issues), `${path}.outwardOffsetYd`, issues, { min: 0, max: 50 });
  }, issues);
  validateObjectArray(root, 'banners', STADIUM_VISUAL_LIMITS.features.banners, BANNER_KEYS, (obj, path) => {
    perimeter(required(obj, 'perimeterT', path, issues), `${path}.perimeterT`, issues);
    numberAt(required(obj, 'widthYd', path, issues), `${path}.widthYd`, issues, { min: 0.5, max: 30 });
    numberAt(required(obj, 'heightYd', path, issues), `${path}.heightYd`, issues, { min: 0.5, max: 12 });
    numberAt(required(obj, 'elevationYd', path, issues), `${path}.elevationYd`, issues, { min: 0.5, max: 80 });
    stringAt(required(obj, 'colorRole', path, issues), `${path}.colorRole`, issues, { values: BANNER_COLORS });
    stringAt(required(obj, 'minQuality', path, issues), `${path}.minQuality`, issues, { values: QUALITY });
  }, issues);
  validateObjectArray(root, 'skyline', STADIUM_VISUAL_LIMITS.features.skyline, SKYLINE_KEYS, (obj, path) => {
    stringAt(required(obj, 'kind', path, issues), `${path}.kind`, issues, { values: SKYLINE_KINDS });
    for (const [key, positive] of [['position', false], ['size', true]] as const) {
      const vecPath = `${path}.${key}`;
      const vec = objectAt(required(obj, key, path, issues), vecPath, issues);
      if (!vec) continue;
      rejectUnknown(vec, VEC_KEYS, vecPath, issues);
      numberAt(required(vec, 'x', vecPath, issues), `${vecPath}.x`, issues, positive ? { min: 0.5, max: 80 } : { min: -200, max: 200 });
      numberAt(required(vec, 'y', vecPath, issues), `${vecPath}.y`, issues, positive ? { min: 0.5, max: 150 } : { min: 0, max: 120 });
      numberAt(required(vec, 'z', vecPath, issues), `${vecPath}.z`, issues, positive ? { min: 0.5, max: 80 } : { min: -150, max: 250 });
    }
    stringAt(required(obj, 'colorRole', path, issues), `${path}.colorRole`, issues, { values: SKYLINE_COLORS });
    stringAt(required(obj, 'minQuality', path, issues), `${path}.minQuality`, issues, { values: QUALITY });
  }, issues);

  const featureCount = ['tunnels', 'scoreboards', 'lightTowers', 'banners', 'skyline']
    .reduce((sum, key) => sum + (Array.isArray(root[key]) ? root[key].length : 0), 0);
  if (featureCount > STADIUM_VISUAL_LIMITS.features.total) {
    issues.push({ path: '$', code: 'FEATURE_BUDGET', message: `visual supports at most ${STADIUM_VISUAL_LIMITS.features.total} features` });
  }
}

function validateAuthoring(root: Obj, issues: StadiumVisualValidationIssue[]): void {
  if (!('authoring' in root)) return;
  const authoring = objectAt(root.authoring, 'authoring', issues);
  if (!authoring) return;
  rejectUnknown(authoring, AUTHORING_KEYS, 'authoring', issues);
  for (const [key, max] of [['author', 120], ['notes', 4000], ['pascalSceneVersion', 120], ['exportedAt', 120]] as const) {
    if (key in authoring) stringAt(authoring[key], `authoring.${key}`, issues, { max });
  }
}

function validateFeatureOpeningTargets(visual: MfdStadiumVisualV1, issues: StadiumVisualValidationIssue[]): void {
  const openings = visual.bowl.openings ?? [];
  if (!openings.length) return;
  const blocked = (t: number) => openings.some((opening) => t >= opening.startT && t < opening.endT);
  for (const key of ['tunnels', 'scoreboards', 'lightTowers', 'banners'] as const) {
    const list = visual[key] ?? [];
    for (let i = 0; i < list.length; i++) {
      if (blocked(list[i].perimeterT)) {
        issues.push({
          path: `${key}[${i}].perimeterT`,
          code: 'OPENING_TARGET',
          message: `${key}[${i}] targets a disabled bowl segment`,
        });
      }
    }
  }
}

export function validateStadiumVisual(
  input: unknown,
  options: ValidateStadiumVisualOptions = {},
): StadiumVisualValidationResult {
  const issues: StadiumVisualValidationIssue[] = [];
  const root = objectAt(input, '$', issues);
  if (!root) return { ok: false, errors: issues };
  rejectUnknown(root, ROOT_KEYS, '', issues);

  exact(required(root, 'schema', '', issues), STADIUM_VISUAL_SCHEMA, 'schema', issues);
  exact(required(root, 'version', '', issues), STADIUM_VISUAL_VERSION, 'version', issues);
  const stadiumId = required(root, 'stadiumId', '', issues);
  if (stringAt(stadiumId, 'stadiumId', issues, { min: 1, max: 100 })
    && !options.allowUnregistered && !STADIUM_IDS.includes(stadiumId)) {
    issues.push({ path: 'stadiumId', code: 'UNKNOWN_STADIUM', message: `stadiumId ${stadiumId} is not registered` });
  }
  exact(required(root, 'units', '', issues), 'yards', 'units', issues);

  const coord = objectAt(required(root, 'coordinateSystem', '', issues), 'coordinateSystem', issues);
  if (coord) {
    rejectUnknown(coord, COORD_KEYS, 'coordinateSystem', issues);
    exact(required(coord, 'x', 'coordinateSystem', issues), 'sideline-to-sideline', 'coordinateSystem.x', issues);
    exact(required(coord, 'y', 'coordinateSystem', issues), 'up', 'coordinateSystem.y', issues);
    exact(required(coord, 'z', 'coordinateSystem', issues), 'home-goal-to-away-goal', 'coordinateSystem.z', issues);
  }

  validateBowl(root, issues);
  validateRoof(root, stadiumId, issues);
  validateFeatures(root, issues);
  validateAuthoring(root, issues);
  if (issues.length) return { ok: false, errors: issues };

  const visual = input as MfdStadiumVisualV1;
  validateFeatureOpeningTargets(visual, issues);
  issues.push(...checkProtectedField(visual));
  const semanticElements = 1 + visual.bowl.profile.length + (visual.roof && visual.roof.style !== 'none' ? 1 : 0)
    + (visual.bowl.openings?.length ?? 0) + (visual.tunnels?.length ?? 0) + (visual.scoreboards?.length ?? 0)
    + (visual.lightTowers?.length ?? 0) + (visual.banners?.length ?? 0) + (visual.skyline?.length ?? 0);
  if (semanticElements > STADIUM_VISUAL_LIMITS.semanticElements) {
    issues.push({
      path: '$', code: 'SEMANTIC_BUDGET',
      message: `visual has ${semanticElements} semantic elements; limit is ${STADIUM_VISUAL_LIMITS.semanticElements}`,
    });
  }
  return issues.length ? { ok: false, errors: issues } : { ok: true, value: visual, errors: [] };
}

export class StadiumVisualValidationError extends Error {
  readonly errors: StadiumVisualValidationIssue[];
  constructor(errors: StadiumVisualValidationIssue[]) {
    super(errors.map((issue) => `${issue.path}: ${issue.message}`).join('\n'));
    this.name = 'StadiumVisualValidationError';
    this.errors = errors;
  }
}

export function parseStadiumVisual(input: unknown, options: ValidateStadiumVisualOptions = {}): MfdStadiumVisualV1 {
  const result = validateStadiumVisual(input, options);
  if (!result.ok) throw new StadiumVisualValidationError(result.errors);
  return result.value;
}
