import { describe, it, expect } from 'vitest';
import { computeLayout, clampStickOrigin, inStickZone, MIN_TARGET } from '../src/input/touch/controlLayout.ts';
import { defaultTouchProfile, sanitizeTouchProfile, type TouchProfile } from '../src/input/touch/touchProfile.ts';
import { GestureRecognizer, GESTURE_PRESETS } from '../src/input/touch/gestureRecognizer.ts';

/**
 * The automated half of the ergonomics gate: at every reference viewport, safe-area simulation,
 * control scale, and handedness, the full stick ring stays reachable, every fan target is at
 * least the minimum hit size and fully inside the safe rect, and zones do not overlap.
 * (Physical-thumb evidence is a separate, device-only gate.)
 */

const VIEWPORTS: Array<[number, number]> = [
  [667, 375], [740, 360], [844, 390], [896, 414], [932, 430], [1024, 768], [1180, 820],
];
const INSETS = [
  { top: 0, right: 0, bottom: 0, left: 0 },
  { top: 0, right: 47, bottom: 21, left: 47 },   // notched phone, landscape
  { top: 24, right: 0, bottom: 24, left: 0 },
];
const SCALES = [0.8, 1, 1.3];
const HANDS: Array<TouchProfile['handedness']> = ['RIGHT', 'LEFT'];

describe('control layout geometry', () => {
  it('keeps the full stick ring and every fan target reachable everywhere', () => {
    for (const [w, h] of VIEWPORTS) {
      for (const insets of INSETS) {
        for (const scale of SCALES) {
          for (const hand of HANDS) {
            const p: TouchProfile = {
              ...defaultTouchProfile(),
              stickScale: scale, actionScale: scale, handedness: hand,
            };
            const l = computeLayout(w, h, insets, p);
            const label = `${w}x${h} insets(${insets.left},${insets.top}) scale ${scale} ${hand}`;

            // Any accepted stick start yields a fully on-screen ring.
            const corners = [
              [l.stickZone.left, l.stickZone.top], [l.stickZone.right, l.stickZone.bottom],
              [l.stickZone.left, l.stickZone.bottom], [l.stickZone.right, l.stickZone.top],
              [(l.stickZone.left + l.stickZone.right) / 2, (l.stickZone.top + l.stickZone.bottom) / 2],
            ];
            for (const [x, y] of corners) {
              const o = clampStickOrigin(l, x, y);
              expect(o.x - l.stickRadius, label).toBeGreaterThanOrEqual(l.safe.left);
              expect(o.x + l.stickRadius, label).toBeLessThanOrEqual(l.safe.right);
              expect(o.y - l.stickRadius, label).toBeGreaterThanOrEqual(l.safe.top);
              expect(o.y + l.stickRadius, label).toBeLessThanOrEqual(l.safe.bottom);
            }

            // Fan targets: minimum size, fully inside the safe rect, in the action flank,
            // and separated enough not to overlap.
            expect(l.fanTargetSize, label).toBeGreaterThanOrEqual(MIN_TARGET);
            for (const c of l.fanCenters) {
              const half = l.fanTargetSize / 2;
              expect(c.x - half, label).toBeGreaterThanOrEqual(l.safe.left);
              expect(c.x + half, label).toBeLessThanOrEqual(l.safe.right);
              expect(c.y - half, label).toBeGreaterThanOrEqual(l.safe.top);
              expect(c.y + half, label).toBeLessThanOrEqual(l.safe.bottom);
              // Never in the movement flank — the two thumbs must not fight.
              expect(inStickZone(l, c.x, c.y), label).toBe(false);
            }
            for (let i = 0; i < 3; i++) {
              for (let j = i + 1; j < 3; j++) {
                const a = l.fanCenters[i]; const b = l.fanCenters[j];
                const gap = Math.hypot(a.x - b.x, a.y - b.y);
                expect(gap, `${label} slots ${i}/${j}`).toBeGreaterThanOrEqual(l.fanTargetSize + 8);
              }
            }

            // The zones themselves never overlap.
            const zoneOverlap = Math.min(l.stickZone.right, l.actionZone.right)
              - Math.max(l.stickZone.left, l.actionZone.left);
            expect(zoneOverlap, label).toBeLessThanOrEqual(0);

            // Fixed-mode stick center is itself a valid origin.
            const f = l.fixedStickCenter;
            expect(inStickZone(l, f.x, f.y), label).toBe(true);
          }
        }
      }
    }
  });

  it('mirrors zones for a left-handed grip', () => {
    const base = defaultTouchProfile();
    const right = computeLayout(844, 390, INSETS[1], base);
    const left = computeLayout(844, 390, INSETS[1], { ...base, handedness: 'LEFT' });
    expect(right.stickZone.left).toBeLessThan(right.actionZone.left);
    expect(left.stickZone.left).toBeGreaterThan(left.actionZone.left);
  });

  it('sanitize clamps out-of-range profiles instead of trusting them', () => {
    const p = sanitizeTouchProfile({ stickScale: 9, opacity: -3, targetFanSpread: 999,
      handedness: 'LEFT', targetSurface: 'THUMB_FAN' } as Partial<TouchProfile>);
    expect(p.stickScale).toBe(1.3);
    expect(p.opacity).toBe(0.25);
    expect(p.targetFanSpread).toBe(48);
    expect(p.handedness).toBe('LEFT');
    expect(p.targetSurface).toBe('THUMB_FAN');
  });
});

describe('gesture recognizer', () => {
  const T = GESTURE_PRESETS.STANDARD;

  it('classifies a clean tap', () => {
    const r = new GestureRecognizer(T);
    r.begin(1, 100, 100, 0);
    expect(r.move(1, 103, 102, 40)).toBeNull();
    expect(r.end(1, 120)).toEqual({ type: 'TAP' });
  });

  it('commits a swipe only after the direction sustains', () => {
    const r = new GestureRecognizer(T);
    r.begin(1, 100, 100, 0);
    expect(r.move(1, 130, 100, 10)).toBeNull();          // candidate set, window not elapsed
    const g = r.move(1, 145, 100, 10 + T.confirmWindowMs + 5);
    expect(g).toEqual({ type: 'SWIPE', direction: 'RIGHT', urgent: false });
    // One action per contact: further movement is inert.
    expect(r.move(1, 300, 100, 400)).toBeNull();
    expect(r.end(1, 500)).toBeNull();
  });

  it('a reversal before commitment cancels instead of firing the wrong verb', () => {
    const r = new GestureRecognizer(T);
    r.begin(1, 100, 100, 0);
    expect(r.move(1, 130, 100, 10)).toBeNull();          // heading right
    const g = r.move(1, 70, 100, 20);                    // hard reversal to the left
    expect(g).toEqual({ type: 'CANCELLED' });
    expect(r.end(1, 100)).toBeNull();
  });

  it('urgent context may commit early, ordinary context may not', () => {
    const strict = new GestureRecognizer(T);
    strict.begin(1, 100, 100, 0);
    expect(strict.move(1, 100, 60, 5, false)).toBeNull();   // 40px up instantly: not sustained
    const urgent = new GestureRecognizer(T);
    urgent.begin(2, 100, 100, 0);
    const g = urgent.move(2, 100, 100 - T.urgentTravelPx - 2, 5, true);
    expect(g).toEqual({ type: 'SWIPE', direction: 'UP', urgent: true });
  });

  it('a parked finger becomes a hold exactly once', () => {
    const r = new GestureRecognizer(T);
    r.begin(1, 100, 100, 0);
    expect(r.checkHold(1, T.holdDurationMs - 10)).toBeNull();
    expect(r.checkHold(1, T.holdDurationMs + 10)).toEqual({ type: 'HOLD' });
    expect(r.checkHold(1, T.holdDurationMs + 500)).toBeNull();
  });
});
