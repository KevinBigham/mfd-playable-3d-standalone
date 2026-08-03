/**
 * Where the controls are allowed to live, as pure geometry.
 *
 * Every number here is computed against the safe-area rectangle so a notch, a home indicator, or
 * a curved corner can never hide a control. Zones: the movement thumb owns one 44% flank, the
 * action thumb owns the other, a 12% neutral gutter separates them; handedness mirrors the whole
 * arrangement. Nothing in here touches the DOM — it is all testable at reference viewports.
 */
import type { TouchProfile } from './touchProfile.ts';

export interface Rect { left: number; top: number; right: number; bottom: number }
export interface Insets { top: number; right: number; bottom: number; left: number }
export interface Point { x: number; y: number }

/** Base stick ring radius in CSS px before profile scaling (matches the shipped visual). */
export const STICK_RADIUS = 54;
/** Minimum hit size for any general touch target after layout. */
export const MIN_TARGET = 48;
/** Fan target diameter before user scaling. */
export const FAN_TARGET = 64;

export interface ControlLayout {
  safe: Rect;
  /** The flank the movement stick may start in. */
  stickZone: Rect;
  /** The flank contextual actions and the target fan live in. */
  actionZone: Rect;
  stickRadius: number;
  /** Where a fixed-mode stick sits. */
  fixedStickCenter: Point;
  /** Three fan-target centers in the natural action-thumb arc, slot 0..2. */
  fanCenters: [Point, Point, Point];
  fanTargetSize: number;
}

export function safeRect(viewportW: number, viewportH: number, insets: Insets): Rect {
  return {
    left: insets.left, top: insets.top,
    right: viewportW - insets.right, bottom: viewportH - insets.bottom,
  };
}

export function computeLayout(
  viewportW: number, viewportH: number, insets: Insets, profile: TouchProfile,
): ControlLayout {
  const safe = safeRect(viewportW, viewportH, insets);
  const w = safe.right - safe.left;
  const mirror = profile.handedness === 'LEFT';
  const flank = (fromLeft: boolean): Rect => (fromLeft
    ? { left: safe.left, top: safe.top, right: safe.left + w * 0.44, bottom: safe.bottom }
    : { left: safe.right - w * 0.44, top: safe.top, right: safe.right, bottom: safe.bottom });
  const stickZone = flank(!mirror);
  const actionZone = flank(mirror);
  const stickRadius = STICK_RADIUS * profile.stickScale;

  const fixedStickCenter: Point = {
    x: mirror ? safe.right - (stickRadius + 36) : safe.left + stickRadius + 36,
    y: safe.bottom - (stickRadius + 30),
  };

  // The fan sits in the arc a thumb sweeps when the hand grips the corner of the phone: anchored
  // at the action-side bottom corner, three targets on one arc. Slot 0 stands straight up the
  // flank; slot 2 sweeps inward toward the screen center. Spread is the angle between slots.
  const fanSize = FAN_TARGET * profile.actionScale;
  const anchorX = mirror ? safe.left + 40 : safe.right - 40;
  const anchorY = safe.bottom - 36;
  const arcRadius = Math.max(128, fanSize * 2.1);
  const spreadRad = (profile.targetFanSpread * Math.PI) / 180;
  // Angle 0 points straight up-screen from the anchor; positive sweeps toward screen center.
  const startAngle = Math.PI * 0.06;
  const fan: Point[] = [0, 1, 2].map((slot) => {
    const a = startAngle + spreadRad * slot;
    return {
      x: anchorX + (mirror ? 1 : -1) * Math.sin(a) * arcRadius,
      y: anchorY - Math.cos(a) * arcRadius,
    };
  });
  // Clamp every fan target fully inside the safe rect.
  const half = fanSize / 2 + 4;
  const clampPt = (p: Point): Point => ({
    x: Math.min(safe.right - half, Math.max(safe.left + half, p.x)),
    y: Math.min(safe.bottom - half, Math.max(safe.top + half, p.y)),
  });
  const fanCenters = [clampPt(fan[0]), clampPt(fan[1]), clampPt(fan[2])] as [Point, Point, Point];

  return { safe, stickZone, actionZone, stickRadius, fixedStickCenter, fanCenters, fanTargetSize: fanSize };
}

/**
 * Clamp a floating-stick origin so the ENTIRE ring (plus knob travel) stays inside both the
 * stick zone and the safe rect. The touch keeps working from where the finger actually is — the
 * visual ring shifts, the vector math uses the clamped origin.
 */
export function clampStickOrigin(layout: ControlLayout, x: number, y: number): Point {
  const m = layout.stickRadius + 10;   // ring plus a knob's worth of slack
  const z = layout.stickZone;
  const left = Math.max(z.left, layout.safe.left) + m;
  const right = Math.min(z.right, layout.safe.right) - m;
  const top = Math.max(z.top, layout.safe.top) + m;
  const bottom = Math.min(z.bottom, layout.safe.bottom) - m;
  return {
    x: Math.min(right, Math.max(left, x)),
    y: Math.min(bottom, Math.max(top, y)),
  };
}

/** Whether a point falls in the movement flank (stick grabs) for this layout. */
export function inStickZone(layout: ControlLayout, x: number, y: number): boolean {
  const z = layout.stickZone;
  return x >= z.left && x <= z.right && y >= z.top && y <= z.bottom;
}

/** Read the live safe-area insets off the document, with zeros when unavailable. */
export function readSafeInsets(): Insets {
  try {
    const cs = getComputedStyle(document.documentElement);
    const read = (name: string): number => {
      const v = cs.getPropertyValue(name);
      const n = parseFloat(v);
      return Number.isFinite(n) ? n : 0;
    };
    return {
      top: read('--sat') || 0, right: read('--sar') || 0,
      bottom: read('--sab') || 0, left: read('--sal') || 0,
    };
  } catch { return { top: 0, right: 0, bottom: 0, left: 0 }; }
}
