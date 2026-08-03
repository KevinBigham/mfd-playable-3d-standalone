/**
 * The versioned description of how this player's thumbs are laid out.
 *
 * Everything the touch layer treats as a constant today becomes a field here: handedness, stick
 * behavior, scale, deadzone, turbo mode, gesture strictness, and which receiver-target surface
 * owns the throw. The profile is persisted with the save file and stamped with a version so a
 * future migration can tell what it is looking at.
 */

export type Handedness = 'RIGHT' | 'LEFT';
export type StickMode = 'FLOATING' | 'FIXED';
export type TurboMode = 'HOLD_EDGE' | 'EDGE_BOOST' | 'AUTO';
export type TargetSurfaceId = 'THUMB_FAN' | 'DIRECT_FIELD';
export type GesturePreset = 'RELAXED' | 'STANDARD' | 'PRECISE';

export interface TouchProfile {
  version: 1;
  handedness: Handedness;
  stickMode: StickMode;
  /** Multiplier on control sizes, 0.8..1.3. */
  stickScale: number;
  actionScale: number;
  /** Control opacity, 0.25..1. */
  opacity: number;
  deadzonePx: number;
  turboMode: TurboMode;
  gesturePreset: GesturePreset;
  targetSurface: TargetSurfaceId;
  /** Fan arc spread in degrees between adjacent targets. */
  targetFanSpread: number;
  reducedActions: boolean;
  /** Advanced: show the explicit LOB (touch pass) button. Beginners get the adaptive default. */
  explicitLob: boolean;
  haptics: 'OFF' | 'LOW' | 'STANDARD';
}

export function defaultTouchProfile(): TouchProfile {
  return {
    version: 1,
    handedness: 'RIGHT',
    stickMode: 'FLOATING',
    stickScale: 1,
    actionScale: 1,
    opacity: 0.9,
    deadzonePx: 6,
    turboMode: 'HOLD_EDGE',
    gesturePreset: 'STANDARD',
    // DIRECT_FIELD is the shipped behavior and stays the default until a physical-phone A/B
    // selects a winner. THUMB_FAN is the candidate, reachable from settings or ?ff=targetFan.
    targetSurface: 'DIRECT_FIELD',
    targetFanSpread: 34,
    reducedActions: false,
    explicitLob: false,
    haptics: 'STANDARD',
  };
}

/** Clamp any persisted or user-edited profile back into its legal ranges. */
export function sanitizeTouchProfile(p: Partial<TouchProfile> | null | undefined): TouchProfile {
  const d = defaultTouchProfile();
  if (!p || typeof p !== 'object') return d;
  const num = (v: unknown, lo: number, hi: number, dflt: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt;
  return {
    version: 1,
    handedness: p.handedness === 'LEFT' ? 'LEFT' : 'RIGHT',
    stickMode: p.stickMode === 'FIXED' ? 'FIXED' : 'FLOATING',
    stickScale: num(p.stickScale, 0.8, 1.3, d.stickScale),
    actionScale: num(p.actionScale, 0.8, 1.3, d.actionScale),
    opacity: num(p.opacity, 0.25, 1, d.opacity),
    deadzonePx: num(p.deadzonePx, 2, 16, d.deadzonePx),
    turboMode: p.turboMode === 'EDGE_BOOST' || p.turboMode === 'AUTO' ? p.turboMode : 'HOLD_EDGE',
    gesturePreset: p.gesturePreset === 'RELAXED' || p.gesturePreset === 'PRECISE' ? p.gesturePreset : 'STANDARD',
    targetSurface: p.targetSurface === 'THUMB_FAN' ? 'THUMB_FAN' : 'DIRECT_FIELD',
    targetFanSpread: num(p.targetFanSpread, 24, 48, d.targetFanSpread),
    reducedActions: p.reducedActions === true,
    explicitLob: p.explicitLob === true,
    haptics: p.haptics === 'OFF' || p.haptics === 'LOW' ? p.haptics : 'STANDARD',
  };
}
