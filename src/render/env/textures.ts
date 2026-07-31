import * as THREE from 'three';
import type { SurfaceKind, TeamColors } from '../../core/types.ts';
import type { QualitySettings } from '../registry.ts';
import { VisualRng } from './geo.ts';

/**
 * Procedural canvas textures for the environment. 100 % generated, zero binary assets.
 *
 * Everything is memoised in a module-level cache keyed by its parameters, so a match build only
 * ever pays for each surface once. `disposeTextureCache()` frees the lot when the match unloads.
 *
 * COLOUR SPACE NOTE: textures that carry *colour* are tagged SRGBColorSpace. Textures that carry a
 * *modulation* (the turf detail map, the noise map) are tagged NoColorSpace so their values pass
 * through the sampler unchanged and can be used as multipliers.
 */

export const DISPLAY_FONT = 'Impact, "Arial Narrow", "Helvetica Neue", Arial, sans-serif';

const cache = new Map<string, THREE.Texture>();

function memo<T extends THREE.Texture>(key: string, make: () => T): T {
  const hit = cache.get(key);
  if (hit) return hit as T;
  const tex = make();
  cache.set(key, tex);
  return tex;
}

export function disposeTextureCache(): void {
  for (const t of cache.values()) t.dispose();
  cache.clear();
}

function canvas2d(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  if (!g) throw new Error('2D canvas context unavailable');
  return [c, g];
}

function finish(c: HTMLCanvasElement, srgb: boolean, repeat: boolean, aniso: number): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

// ───────────────────────────────────────────────────────────────── surfaces

interface SurfaceLook {
  /** Base field colour, painted into the markings texture. */
  base: string;
  /** Secondary blotch colour for the base fill. */
  blotch: string;
  /** Mown-stripe contrast, 0 = none. */
  stripe: number;
  /** Per-channel tint of the detail modulation. */
  tint: [number, number, number];
  grain: 'BLADE' | 'FIBRE' | 'CRACK' | 'CLUMP' | 'RIPPLE' | 'AGGREGATE';
}

export const SURFACE_LOOK: Record<SurfaceKind, SurfaceLook> = {
  GRASS:   { base: '#2c7a37', blotch: '#245f2b', stripe: 0.16, tint: [0.94, 1.06, 0.92], grain: 'BLADE' },
  TURF:    { base: '#1d7f48', blotch: '#17693c', stripe: 0.11, tint: [0.92, 1.05, 0.99], grain: 'FIBRE' },
  FROZEN:  { base: '#8fae95', blotch: '#d8e6ea', stripe: 0.07, tint: [1.02, 1.02, 1.06], grain: 'CRACK' },
  MUD:     { base: '#5b482c', blotch: '#3f3120', stripe: 0.05, tint: [1.05, 0.98, 0.90], grain: 'CLUMP' },
  SAND:    { base: '#c0a165', blotch: '#a98a51', stripe: 0.04, tint: [1.06, 1.00, 0.90], grain: 'RIPPLE' },
  ASPHALT: { base: '#3b4048', blotch: '#2c3037', stripe: 0.03, tint: [0.98, 0.99, 1.04], grain: 'AGGREGATE' },
};

/**
 * Tiling turf DETAIL map — one tile covers 10 × 10 yards.
 *
 * Encodes mown stripes (5-yard bands), blade/fibre noise and small-scale wear as a multiplier
 * around 0.5. The field material combines it with the markings colour map in a single pass.
 */
export function turfTexture(surface: SurfaceKind, quality: QualitySettings): THREE.CanvasTexture {
  const size = quality.turfDetail > 0.8 ? 512 : quality.turfDetail > 0.4 ? 384 : 256;
  return memo(`turf:${surface}:${size}`, () => {
    const look = SURFACE_LOOK[surface];
    const [c, g] = canvas2d(size, size);
    const rng = new VisualRng(0x51f0 ^ size ^ surface.length * 7919);
    const half = size / 2;

    const lvl = (v: number, ch: number): string => {
      const t = look.tint[ch];
      return String(Math.max(0, Math.min(255, Math.round(v * 255 * t))));
    };
    const grey = (v: number, a = 1): string => `rgba(${lvl(v, 0)},${lvl(v, 1)},${lvl(v, 2)},${a})`;

    // Mown bands: 5 yards each, so the boundary lands on every 5-yard line.
    g.fillStyle = grey(0.5 + look.stripe);
    g.fillRect(0, 0, size, half);
    g.fillStyle = grey(0.5 - look.stripe);
    g.fillRect(0, half, size, size - half);

    // Soft blend at the band seam so the mow line is a nap change, not a hard edge.
    for (const y of [0, half]) {
      const grad = g.createLinearGradient(0, y - size * 0.02, 0, y + size * 0.02);
      grad.addColorStop(0, grey(0.5, 0));
      grad.addColorStop(0.5, grey(0.5, 0.45));
      grad.addColorStop(1, grey(0.5, 0));
      g.fillStyle = grad;
      g.fillRect(0, y - size * 0.02, size, size * 0.04);
    }

    // Diagonal mower cross-hatch on the bright band only.
    if (look.stripe > 0.05) {
      g.save();
      g.beginPath(); g.rect(0, 0, size, half); g.clip();
      g.strokeStyle = grey(0.5, 0.10);
      g.lineWidth = Math.max(1, size / 200);
      for (let i = -size; i < size * 2; i += size / 22) {
        g.beginPath(); g.moveTo(i, 0); g.lineTo(i + half, half); g.stroke();
      }
      g.restore();
    }

    const strokes = Math.round(size * size * 0.02);
    switch (look.grain) {
      case 'BLADE':
      case 'FIBRE': {
        const len = look.grain === 'BLADE' ? size / 55 : size / 90;
        g.lineWidth = Math.max(1, size / 340);
        for (let i = 0; i < strokes; i++) {
          const x = rng.next() * size, y = rng.next() * size;
          const v = 0.5 + (rng.next() - 0.5) * 0.34;
          g.strokeStyle = grey(v, 0.5);
          const a = rng.range(-0.5, 0.5) + Math.PI / 2;
          g.beginPath(); g.moveTo(x, y);
          g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
          g.stroke();
        }
        break;
      }
      case 'CRACK': {
        for (let i = 0; i < strokes * 0.35; i++) {
          const x = rng.next() * size, y = rng.next() * size, r = rng.range(size / 60, size / 14);
          g.fillStyle = grey(rng.range(0.55, 0.72), 0.5);
          g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
        }
        g.lineWidth = Math.max(1, size / 300);
        g.strokeStyle = grey(0.34, 0.5);
        for (let i = 0; i < 60; i++) {
          let x = rng.next() * size, y = rng.next() * size;
          g.beginPath(); g.moveTo(x, y);
          for (let k = 0; k < 5; k++) { x += rng.range(-size / 16, size / 16); y += rng.range(-size / 16, size / 16); g.lineTo(x, y); }
          g.stroke();
        }
        break;
      }
      case 'CLUMP': {
        for (let i = 0; i < strokes * 0.5; i++) {
          const x = rng.next() * size, y = rng.next() * size, r = rng.range(size / 90, size / 20);
          g.fillStyle = grey(rng.range(0.3, 0.68), 0.55);
          g.beginPath();
          g.ellipse(x, y, r, r * rng.range(0.45, 1), rng.next() * Math.PI, 0, Math.PI * 2);
          g.fill();
        }
        break;
      }
      case 'RIPPLE': {
        g.lineWidth = Math.max(1, size / 220);
        for (let i = 0; i < 90; i++) {
          const y0 = rng.next() * size;
          g.strokeStyle = grey(rng.range(0.40, 0.62), 0.45);
          g.beginPath();
          for (let x = 0; x <= size; x += size / 16) {
            const y = y0 + Math.sin((x / size) * 8 + i) * size * 0.012;
            if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
          }
          g.stroke();
        }
        for (let i = 0; i < strokes * 0.6; i++) {
          g.fillStyle = grey(rng.range(0.35, 0.7), 0.4);
          g.fillRect(rng.next() * size, rng.next() * size, 1.5, 1.5);
        }
        break;
      }
      case 'AGGREGATE': {
        for (let i = 0; i < strokes * 0.8; i++) {
          const x = rng.next() * size, y = rng.next() * size, r = rng.range(0.8, size / 110);
          g.fillStyle = grey(rng.range(0.30, 0.75), 0.6);
          g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
        }
        break;
      }
    }

    // Small-scale wear mottling so tiled turf never looks perfectly uniform.
    for (let i = 0; i < 12; i++) {
      const x = rng.next() * size, y = rng.next() * size, r = rng.range(size * 0.06, size * 0.18);
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, grey(0.40, 0.30));
      grad.addColorStop(1, grey(0.40, 0));
      g.fillStyle = grad;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }

    return finish(c, false, true, quality.anisotropy);
  });
}

// ───────────────────────────────────────────────────────────── field markings

export interface MarkingsOptions {
  home: TeamColors;
  away: TeamColors;
  /** End-zone wordmark for the side that defends z = 0. Keep it short. */
  homeLabel: string;
  /** End-zone wordmark for the side that defends z = 100. */
  awayLabel: string;
  surface: SurfaceKind;
  /** Venue accent, used for the midfield emblem. */
  accent: string;
  quality: QualitySettings;
}

const HALF_W = 26.665;
const PAINT = '#f2f4ee';

/**
 * ONE opaque colour map covering the entire playing surface, z ∈ [-10, 110] × x ∈ [±26.665].
 *
 * Texel mapping (PlaneGeometry UVs + CanvasTexture flipY):
 *   canvasX = (x + 26.665) * S      canvasY = (z + 10) * S
 * Text drawn upright therefore reads correctly from behind the z = 110 end line; anything meant to
 * be read from the other end is drawn rotated 180°.
 */
export function fieldMarkingsTexture(o: MarkingsOptions): THREE.CanvasTexture {
  const H = o.quality.tier === 'HIGH' ? 3072 : o.quality.tier === 'MEDIUM' ? 2048 : 1024;
  const key = `marks:${H}:${o.surface}:${o.home.endzone}${o.home.secondary}${o.home.ink}:${o.away.endzone}${o.away.secondary}${o.away.ink}:${o.homeLabel}:${o.awayLabel}:${o.accent}`;
  return memo(key, () => {
    const S = H / 120;
    const W = Math.round(HALF_W * 2 * S);
    const [c, g] = canvas2d(W, H);
    const look = SURFACE_LOOK[o.surface];
    const rng = new VisualRng(0x9c31 ^ H);

    const X = (x: number): number => (x + HALF_W) * S;
    const Y = (z: number): number => (z + 10) * S;
    const yd = (v: number): number => v * S;

    // ── base surface ──────────────────────────────────────────────────────
    g.fillStyle = look.base;
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 140; i++) {
      const x = rng.next() * W, y = rng.next() * H, r = rng.range(yd(1.5), yd(9));
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, look.blotch);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.globalAlpha = 0.24;
      g.fillStyle = grad;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;

    // ── end zones ─────────────────────────────────────────────────────────
    const drawEndZone = (z0: number, z1: number, col: TeamColors, label: string, flip: boolean): void => {
      const top = Y(Math.min(z0, z1)), bot = Y(Math.max(z0, z1));
      g.save();
      g.beginPath(); g.rect(0, top, W, bot - top); g.clip();
      g.fillStyle = col.endzone;
      g.fillRect(0, top, W, bot - top);

      // Diagonal hatch in the secondary colour keeps the paint from reading flat.
      g.globalAlpha = 0.16;
      g.strokeStyle = col.secondary;
      g.lineWidth = yd(0.9);
      for (let i = -H; i < W + H; i += yd(2.6)) {
        g.beginPath(); g.moveTo(i, top - yd(2)); g.lineTo(i + (bot - top) + yd(4), bot + yd(2)); g.stroke();
      }
      g.globalAlpha = 1;

      // Wordmark.
      const cxp = W / 2, cyp = (top + bot) / 2;
      g.save();
      g.translate(cxp, cyp);
      if (flip) g.rotate(Math.PI);
      const text = label.toUpperCase().slice(0, 14);
      const maxW = W * 0.86;
      let px = yd(7.4);
      g.font = `900 ${px}px ${DISPLAY_FONT}`;
      const measured = g.measureText(text).width;
      const squeeze = Math.min(1, maxW / Math.max(1, measured));
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.scale(squeeze, 1);
      g.lineJoin = 'round';
      g.strokeStyle = col.primary;
      g.lineWidth = px * 0.20;
      g.strokeText(text, 0, 0);
      g.fillStyle = col.ink;
      g.fillText(text, 0, 0);
      g.globalAlpha = 0.35;
      g.fillStyle = col.accent;
      g.fillText(text, 0, -px * 0.06);
      g.globalAlpha = 1;
      g.restore();
      g.restore();
    };
    // HOME defends z = 0 → its wordmark lives in z ∈ [-10, 0] and reads from that end.
    drawEndZone(-10, 0, o.home, o.homeLabel, true);
    drawEndZone(100, 110, o.away, o.awayLabel, false);

    // ── centre wear ───────────────────────────────────────────────────────
    const wear = (x: number, z: number, r: number, a: number): void => {
      const grad = g.createRadialGradient(X(x), Y(z), 0, X(x), Y(z), yd(r));
      grad.addColorStop(0, `rgba(24,18,10,${a})`);
      grad.addColorStop(1, 'rgba(24,18,10,0)');
      g.fillStyle = grad;
      g.beginPath(); g.arc(X(x), Y(z), yd(r), 0, Math.PI * 2); g.fill();
    };
    for (let z = 16; z <= 84; z += 3.5) {
      wear(rng.range(-4, 4), z + rng.range(-1.5, 1.5), rng.range(5, 11), 0.055);
    }
    for (const z of [1.5, 98.5]) for (let i = 0; i < 7; i++) wear(rng.range(-12, 12), z + rng.range(-2, 2), rng.range(3, 7), 0.05);
    wear(0, 50, 16, 0.05);

    // ── paint ─────────────────────────────────────────────────────────────
    g.fillStyle = PAINT;
    const hLine = (z: number, wYd: number): void => g.fillRect(0, Y(z) - yd(wYd) / 2, W, yd(wYd));

    // Yard lines every 5 yards; goal lines heavier.
    for (let z = 5; z <= 95; z += 5) hLine(z, 0.16);
    hLine(0, 0.34);
    hLine(100, 0.34);

    // Sidelines + end lines, drawn as an inset border band.
    const bw = yd(0.42);
    g.fillRect(0, Y(-10), bw, Y(110) - Y(-10));
    g.fillRect(W - bw, Y(-10), bw, Y(110) - Y(-10));
    g.fillRect(0, Y(-10), W, bw);
    g.fillRect(0, Y(110) - bw, W, bw);

    // Coach/limit line dashes outside the numbers.
    g.globalAlpha = 0.75;
    for (const sx of [-1, 1]) {
      for (let z = 0; z <= 100; z += 2) {
        g.fillRect(X(sx * (HALF_W - 1.8)) - yd(0.09), Y(z) - yd(0.45), yd(0.18), yd(0.9));
      }
    }
    g.globalAlpha = 1;

    // Hash marks every yard, plus sideline ticks.
    for (let z = 1; z < 100; z++) {
      if (z % 5 === 0) continue;
      for (const hx of [-9.25, 9.25]) {
        g.fillRect(X(hx) - yd(0.36), Y(z) - yd(0.075), yd(0.72), yd(0.15));
      }
      for (const sx of [-1, 1]) {
        const x0 = sx > 0 ? X(HALF_W - 1.1) : X(-HALF_W + 0.4);
        g.fillRect(x0, Y(z) - yd(0.075), yd(0.7), yd(0.15));
      }
    }
    // Longer hash at each 5.
    for (let z = 5; z <= 95; z += 5) {
      for (const hx of [-9.25, 9.25]) g.fillRect(X(hx) - yd(0.5), Y(z) - yd(0.11), yd(1.0), yd(0.22));
    }

    // ── numbers ───────────────────────────────────────────────────────────
    // Painted the regulation way: the BOTTOM of each numeral faces its nearest sideline, so the
    // pair reads upright to a viewer standing on that side. `toGoal` is the world +z/-z direction
    // of the nearer goal line; it is converted into the rotated glyph frame per side.
    const numAt = (z: number, value: number, toGoal: -1 | 0 | 1): void => {
      const text = String(value);
      for (const sx of [-1, 1]) {
        const wx = sx * 14.8;
        const rot = sx > 0 ? -Math.PI / 2 : Math.PI / 2;
        // Glyph-local +X maps to world -z for the +x side and world +z for the -x side.
        const arrow = toGoal * (sx > 0 ? -1 : 1);
        g.save();
        g.translate(X(wx), Y(z));
        g.rotate(rot);
        const px = yd(4.6);
        g.font = `900 ${px}px ${DISPLAY_FONT}`;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.save();
        g.scale(0.82, 1);
        // Split the digits so they sit apart the way field numerals do.
        const gap = px * 0.46;
        g.fillStyle = PAINT;
        g.fillText(text[0], -gap, 0);
        g.fillText(text[1], gap, 0);
        g.restore();
        if (arrow !== 0) {
          const ax = arrow * px * 1.06;
          const ah = px * 0.26;
          g.beginPath();
          g.moveTo(ax + arrow * ah, 0);
          g.lineTo(ax - arrow * ah * 0.55, -ah);
          g.lineTo(ax - arrow * ah * 0.55, ah);
          g.closePath();
          g.fillStyle = PAINT;
          g.fill();
        }
        g.restore();
      }
    };
    for (let z = 10; z <= 90; z += 10) {
      const value = z <= 50 ? z : 100 - z;
      const toGoal: -1 | 0 | 1 = value === 50 ? 0 : (z < 50 ? -1 : 1);
      numAt(z, value, toGoal);
    }

    // ── midfield emblem (invented league mark) ────────────────────────────
    {
      const cxp = X(0), cyp = Y(50), R = yd(9.2);
      g.save();
      g.translate(cxp, cyp);
      g.globalAlpha = 0.92;
      // Outer diamond ring.
      g.lineWidth = R * 0.13;
      g.strokeStyle = o.accent;
      g.beginPath();
      g.moveTo(0, -R); g.lineTo(R * 0.78, 0); g.lineTo(0, R); g.lineTo(-R * 0.78, 0); g.closePath();
      g.stroke();
      // Inner disc split by team colours.
      g.beginPath(); g.arc(0, 0, R * 0.56, -Math.PI / 2, Math.PI / 2); g.closePath();
      g.fillStyle = o.away.primary; g.fill();
      g.beginPath(); g.arc(0, 0, R * 0.56, Math.PI / 2, -Math.PI / 2); g.closePath();
      g.fillStyle = o.home.primary; g.fill();
      // Chevron stack.
      g.strokeStyle = PAINT;
      g.lineWidth = R * 0.105;
      g.lineCap = 'round';
      for (let i = 0; i < 3; i++) {
        const yy = -R * 0.26 + i * R * 0.27;
        g.beginPath();
        g.moveTo(-R * 0.36, yy);
        g.lineTo(0, yy + R * 0.20);
        g.lineTo(R * 0.36, yy);
        g.stroke();
      }
      g.globalAlpha = 1;
      g.restore();
    }

    // Faint paint wear over the whole surface so nothing is perfectly crisp.
    g.globalAlpha = 0.05;
    for (let i = 0; i < 260; i++) {
      g.fillStyle = look.blotch;
      const r = rng.range(yd(0.4), yd(2.4));
      g.beginPath(); g.arc(rng.next() * W, rng.next() * H, r, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;

    return finish(c, true, false, o.quality.anisotropy);
  });
}

// ───────────────────────────────────────────────────────────────── structure

export function concreteTexture(quality: QualitySettings): THREE.CanvasTexture {
  const size = quality.tier === 'LOW' ? 256 : 512;
  return memo(`concrete:${size}`, () => {
    const [c, g] = canvas2d(size, size);
    const rng = new VisualRng(0x2f77 ^ size);
    g.fillStyle = '#8d8f92';
    g.fillRect(0, 0, size, size);
    for (let i = 0; i < size * 9; i++) {
      const v = Math.round(120 + rng.range(-28, 34));
      g.fillStyle = `rgba(${v},${v + 2},${v + 5},0.55)`;
      g.fillRect(rng.next() * size, rng.next() * size, rng.range(1, 3), rng.range(1, 3));
    }
    // Form-work panel joints.
    g.strokeStyle = 'rgba(52,54,58,0.45)';
    g.lineWidth = Math.max(1, size / 220);
    for (let i = 0; i <= 4; i++) {
      const p = (i / 4) * size;
      g.beginPath(); g.moveTo(p, 0); g.lineTo(p, size); g.stroke();
      g.beginPath(); g.moveTo(0, p); g.lineTo(size, p); g.stroke();
    }
    // Streaks of weathering.
    for (let i = 0; i < 26; i++) {
      const x = rng.next() * size;
      const grad = g.createLinearGradient(x, 0, x, size);
      grad.addColorStop(0, 'rgba(60,62,66,0.30)');
      grad.addColorStop(1, 'rgba(60,62,66,0)');
      g.fillStyle = grad;
      g.fillRect(x, 0, rng.range(2, size / 26), size);
    }
    for (let i = 0; i < 40; i++) {
      const x = rng.next() * size, y = rng.next() * size, r = rng.range(size / 30, size / 8);
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, 'rgba(168,170,172,0.30)');
      grad.addColorStop(1, 'rgba(168,170,172,0)');
      g.fillStyle = grad;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    return finish(c, true, true, quality.anisotropy);
  });
}

/** Tiling seat block: 6 rows × 10 seats per tile, tinted toward the venue's crowd colour. */
export function seatTexture(tint: string, quality: QualitySettings): THREE.CanvasTexture {
  const size = quality.tier === 'LOW' ? 256 : 512;
  return memo(`seats:${tint}:${size}`, () => {
    const [c, g] = canvas2d(size, size);
    const rng = new VisualRng(0x71ad ^ size ^ tint.length);
    const cols = 10, rows = 6;
    const cw = size / cols, ch = size / rows;
    const base = new THREE.Color(tint);
    const dark = base.clone().multiplyScalar(0.34);
    g.fillStyle = `rgb(${Math.round(dark.r * 255)},${Math.round(dark.g * 255)},${Math.round(dark.b * 255)})`;
    g.fillRect(0, 0, size, size);

    for (let r = 0; r < rows; r++) {
      // Row shadow band under each riser.
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(0, r * ch, size, ch * 0.22);
      for (let i = 0; i < cols; i++) {
        const jitter = rng.range(-0.10, 0.10);
        const col = base.clone().offsetHSL(rng.range(-0.03, 0.03), rng.range(-0.08, 0.05), jitter);
        const x = i * cw + cw * 0.10, y = r * ch + ch * 0.26;
        const w = cw * 0.80, h = ch * 0.62;
        g.fillStyle = `rgb(${Math.round(col.r * 255)},${Math.round(col.g * 255)},${Math.round(col.b * 255)})`;
        g.beginPath();
        const rad = Math.min(w, h) * 0.28;
        g.moveTo(x + rad, y);
        g.arcTo(x + w, y, x + w, y + h, rad);
        g.arcTo(x + w, y + h, x, y + h, rad);
        g.arcTo(x, y + h, x, y, rad);
        g.arcTo(x, y, x + w, y, rad);
        g.closePath();
        g.fill();
        // Seat-back highlight.
        g.fillStyle = 'rgba(255,255,255,0.16)';
        g.fillRect(x, y, w, h * 0.16);
        g.fillStyle = 'rgba(0,0,0,0.22)';
        g.fillRect(x, y + h * 0.80, w, h * 0.20);
      }
    }
    return finish(c, true, true, quality.anisotropy);
  });
}

/**
 * Crowd atlas — 2 × 2 tiles of white silhouettes, tinted per instance.
 *   tile (0,0) head    (1,0) torso A    (0,1) torso B (arms up)    (1,1) torso C (arms wide)
 */
export function crowdSpriteAtlas(quality: QualitySettings): THREE.CanvasTexture {
  const tile = quality.tier === 'LOW' ? 64 : 128;
  return memo(`crowd:${tile}`, () => {
    const [c, g] = canvas2d(tile * 2, tile * 2);
    g.clearRect(0, 0, tile * 2, tile * 2);
    g.fillStyle = '#ffffff';

    // (0,0) head + cap
    g.save();
    g.translate(tile * 0.5, tile * 0.5);
    g.beginPath(); g.arc(0, tile * 0.06, tile * 0.29, 0, Math.PI * 2); g.fill();
    g.beginPath();
    g.ellipse(0, -tile * 0.12, tile * 0.32, tile * 0.20, 0, Math.PI, 0);
    g.fill();
    g.fillRect(-tile * 0.34, -tile * 0.16, tile * 0.68, tile * 0.07);
    g.restore();

    const torso = (ox: number, oy: number, kind: 0 | 1 | 2): void => {
      g.save();
      g.translate(ox + tile * 0.5, oy + tile * 0.5);
      // Shoulders / body.
      g.beginPath();
      g.moveTo(-tile * 0.20, -tile * 0.34);
      g.lineTo(tile * 0.20, -tile * 0.34);
      g.quadraticCurveTo(tile * 0.34, -tile * 0.24, tile * 0.32, tile * 0.42);
      g.lineTo(-tile * 0.32, tile * 0.42);
      g.quadraticCurveTo(-tile * 0.34, -tile * 0.24, -tile * 0.20, -tile * 0.34);
      g.closePath();
      g.fill();
      const arm = (sx: number, ang: number, len: number): void => {
        g.save();
        g.translate(sx * tile * 0.27, -tile * 0.22);
        g.rotate(ang);
        g.fillRect(-tile * 0.075, 0, tile * 0.15, len);
        g.beginPath(); g.arc(0, len, tile * 0.085, 0, Math.PI * 2); g.fill();
        g.restore();
      };
      if (kind === 0) { arm(-1, 0.16, tile * 0.44); arm(1, -0.16, tile * 0.44); }
      else if (kind === 1) { arm(-1, Math.PI - 0.20, tile * 0.50); arm(1, Math.PI + 0.20, tile * 0.50); }
      else {
        arm(-1, Math.PI - 0.75, tile * 0.52); arm(1, Math.PI + 0.75, tile * 0.52);
        g.fillRect(-tile * 0.44, -tile * 0.44, tile * 0.88, tile * 0.09);
      }
      g.restore();
    };
    torso(tile, 0, 0);
    torso(0, tile, 1);
    torso(tile, tile, 2);

    const t = finish(c, true, false, 1);
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    return t;
  });
}

/** Perimeter signage strip. Sponsors are invented for this league. */
export function signageTexture(accent: string, quality: QualitySettings): THREE.CanvasTexture {
  const w = quality.tier === 'LOW' ? 1024 : 2048;
  const h = w / 16;
  return memo(`sign:${accent}:${w}`, () => {
    const [c, g] = canvas2d(w, h);
    const panels: Array<[string, string, string]> = [
      ['VOLTRAK ENERGY', '#0d1220', '#48e0ff'],
      ['HAMMERTON TOOLS', '#1a1005', '#ffb020'],
      ['DRAYCO FREIGHT', '#101a12', '#7dff9a'],
      ['MERIDIAN TRUST', '#141024', '#c9a6ff'],
      ['KILNWORKS STEEL', '#1c0d0d', '#ff7a55'],
      ['ORBIS TELECOM', '#04161c', '#38d9d0'],
      ['GRIDIRON OVERDRIVE', '#0b0d14', accent],
      ['PALLAS OUTFITTERS', '#181206', '#ffe08a'],
    ];
    const pw = w / panels.length;
    for (let i = 0; i < panels.length; i++) {
      const [label, bg, fg] = panels[i];
      const x = i * pw;
      g.fillStyle = bg;
      g.fillRect(x, 0, pw, h);
      const grad = g.createLinearGradient(x, 0, x, h);
      grad.addColorStop(0, 'rgba(255,255,255,0.14)');
      grad.addColorStop(0.5, 'rgba(255,255,255,0)');
      grad.addColorStop(1, 'rgba(0,0,0,0.35)');
      g.fillStyle = grad;
      g.fillRect(x, 0, pw, h);
      g.fillStyle = fg;
      g.fillRect(x + pw * 0.02, h * 0.12, pw * 0.012, h * 0.76);
      g.fillRect(x + pw * 0.966, h * 0.12, pw * 0.012, h * 0.76);
      g.font = `900 ${h * 0.46}px ${DISPLAY_FONT}`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = fg;
      g.fillText(label, x + pw / 2, h * 0.54, pw * 0.86);
      g.fillStyle = 'rgba(0,0,0,0.55)';
      g.fillRect(x, h - Math.max(2, h * 0.05), pw, Math.max(2, h * 0.05));
    }
    return finish(c, true, true, quality.anisotropy);
  });
}

// ───────────────────────────────────────────────────────────────────── sky

export type SkyKind = 'DAY' | 'DUSK' | 'NIGHT' | 'STORM';

const SKY_RAMPS: Record<SkyKind, Array<[number, string]>> = {
  DAY:   [[0, '#1f6fd0'], [0.34, '#4a9ae4'], [0.62, '#8fc6f2'], [0.82, '#cfe6f7'], [1, '#eaf3fb']],
  DUSK:  [[0, '#1b1442'], [0.28, '#4a2668'], [0.52, '#9c3f66'], [0.74, '#e8734a'], [0.9, '#ffb877'], [1, '#ffd9a8']],
  NIGHT: [[0, '#03040c'], [0.36, '#070c1e'], [0.66, '#10203c'], [0.86, '#1d3555'], [1, '#2a4666']],
  STORM: [[0, '#161a22'], [0.34, '#232a35'], [0.60, '#39424f'], [0.82, '#5a6470'], [1, '#79838f']],
};

/** Vertical sky ramp; canvas row 0 (uv.v = 1) is the zenith. */
export function skyGradient(kind: SkyKind): THREE.CanvasTexture {
  return memo(`sky:${kind}`, () => {
    const [c, g] = canvas2d(8, 256);
    const grad = g.createLinearGradient(0, 0, 0, 256);
    for (const [p, col] of SKY_RAMPS[kind]) grad.addColorStop(p, col);
    g.fillStyle = grad;
    g.fillRect(0, 0, 8, 256);
    const t = finish(c, true, false, 1);
    t.wrapS = THREE.ClampToEdgeWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.generateMipmaps = false;
    t.minFilter = THREE.LinearFilter;
    return t;
  });
}

/** Tiling RGBA value noise used by the weather and sky shaders. */
export function noiseTexture(size = 128): THREE.CanvasTexture {
  return memo(`noise:${size}`, () => {
    const [c, g] = canvas2d(size, size);
    const img = g.createImageData(size, size);
    const rng = new VisualRng(0x4d21 ^ size);
    for (let i = 0; i < size * size; i++) {
      img.data[i * 4 + 0] = Math.floor(rng.next() * 256);
      img.data[i * 4 + 1] = Math.floor(rng.next() * 256);
      img.data[i * 4 + 2] = Math.floor(rng.next() * 256);
      img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const t = finish(c, false, true, 1);
    t.generateMipmaps = false;
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    return t;
  });
}
