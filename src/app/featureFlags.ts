/**
 * Migration feature flags for the mobile transformation.
 *
 * These are temporary scaffolding, not a settings menu: each flag guards a replacement while its
 * predecessor still exists, so a regression can be isolated by flipping one boolean. A flag is
 * deleted — with the old code path — once the replacement's gates pass and the migration window
 * closes. Defaults are the single source of truth and are recorded in every wave receipt.
 *
 * Override for testing via URL: `?ff=touchControlsV2:off,driveRush:on`.
 */

const DEFAULTS = {
  /** Wave 1 */
  pauseControllerV2: true,
  mobileLifecycleV2: true,
  touchControlsV2: true,
  /** Wave 2 */
  targetFan: false,
  directFieldTargets: true,
  compactHudV2: false,
  /** Wave 3 */
  rulesetsV2: false,
  driveRush: false,
  playGradeV1: false,
  overdriveSkillCharge: false,
  /** Wave 4 */
  mobileHomeV2: false,
  mobilePlayCardsV2: false,
  persistenceV2: false,
  performanceGovernorV2: false,
};

export type FeatureFlag = keyof typeof DEFAULTS;

const overrides = new Map<FeatureFlag, boolean>();

function parseOverrides(): void {
  try {
    if (typeof location === 'undefined') return;
    const ff = new URLSearchParams(location.search).get('ff');
    if (!ff) return;
    for (const part of ff.split(',')) {
      const [name, value] = part.split(':');
      if (name in DEFAULTS) overrides.set(name as FeatureFlag, value !== 'off' && value !== '0');
    }
  } catch { /* not a browser, or malformed — defaults stand */ }
}
parseOverrides();

export function flag(name: FeatureFlag): boolean {
  return overrides.get(name) ?? DEFAULTS[name];
}

/** For receipts: the complete flag table as currently resolved. */
export function flagTable(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const k of Object.keys(DEFAULTS) as FeatureFlag[]) out[k] = flag(k);
  return out;
}
