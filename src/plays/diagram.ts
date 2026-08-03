/**
 * GRIDIRON OVERDRIVE — play diagrams.
 *
 * Pure function: a play in, an SVG string out. No DOM, no measurement, no
 * caching — the UI layer decides where to put it. Default canvas is 220x150,
 * designed to stay legible when the play-select wheel scales it to 110px wide,
 * which is why strokes are heavy, marks are large, and there is no text.
 *
 * Orientation is the way a coach draws it: the line of scrimmage is horizontal,
 * downfield is UP, and the offense's right hand is to the right of the page.
 */

import type {
  DefensePlay, DefensePlayerPlan, OffensePlay, OffensePlayerPlan, RouteNode,
} from '../core/types.ts';

export interface DiagramOptions {
  width?: number;
  height?: number;
  /** Fill for offensive marks. */
  offense?: string;
  /** Stroke for defensive marks. */
  defense?: string;
  /** Route polylines. */
  route?: string;
  /** Blocking assignments. */
  block?: string;
  /** Dashed zone circles. */
  zone?: string;
  /** Rush arrows. */
  rush?: string;
  /** Line of scrimmage. */
  los?: string;
  /** Background rect. Omit or pass 'none' for a transparent diagram. */
  bg?: string;
  /** Emit a <title> element with the play name. Default true. */
  title?: boolean;
}

const DEFAULTS = {
  width: 220,
  height: 150,
  offense: '#f2f4f8',
  defense: '#ff5a4d',
  route: '#f2f4f8',
  block: '#8fa0b8',
  zone: '#ffc94a',
  rush: '#ff5a4d',
  los: '#5c6a7e',
  bg: 'none',
};

const PAD_X = 10;
const TOP = 11;
const BOT = 139;

function f(v: number): string {
  const r = Math.round(v * 10) / 10;
  return Object.is(r, -0) ? '0' : String(r);
}

function esc(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function finite(v: number): number {
  return Number.isFinite(v) ? v : 0;
}

interface Frame {
  sx(x: number): number;
  sy(z: number): number;
  /** Pixels per yard across the field. */
  xScale: number;
  /** Pixels per yard downfield. The two differ: depth is compressed to fit. */
  zScale: number;
  losY: number;
}

function makeFrame(pts: { x: number; z: number }[], w: number, h: number): Frame {
  let maxAbsX = 7.5;
  let zLo = -6;
  let zHi = 10;
  for (const q of pts) {
    const ax = Math.abs(finite(q.x));
    if (ax > maxAbsX) maxAbsX = ax;
    const z = finite(q.z);
    if (z < zLo) zLo = z;
    if (z > zHi) zHi = z;
  }
  maxAbsX = Math.min(maxAbsX + 1.5, 27);
  zLo -= 1.5;
  zHi += 1.5;

  const cx = w / 2;
  const xScale = (w / 2 - PAD_X) / maxAbsX;
  const top = TOP * (h / DEFAULTS.height);
  const bot = BOT * (h / DEFAULTS.height);
  const zSpan = Math.max(zHi - zLo, 8);
  const zScale = (bot - top) / zSpan;

  const sy = (z: number) => top + (zHi - finite(z)) * zScale;
  return {
    sx: (x: number) => cx + finite(x) * xScale,
    sy,
    xScale,
    zScale,
    losY: sy(0),
  };
}

// ── primitives ─────────────────────────────────────────────────────────────

function polyline(pts: number[][], stroke: string, width: number, dash?: string): string {
  const d = pts.map((q) => `${f(q[0])},${f(q[1])}`).join(' ');
  const dashAttr = dash ? ` stroke-dasharray="${dash}"` : '';
  return `<polyline points="${d}" fill="none" stroke="${stroke}" stroke-width="${width}"`
    + ` stroke-linecap="round" stroke-linejoin="round"${dashAttr}/>`;
}

/** Solid triangle at `to`, pointing along (to - from). */
function arrowHead(from: number[], to: number[], fill: string, size = 5): string {
  let dx = to[0] - from[0];
  let dy = to[1] - from[1];
  const len = Math.hypot(dx, dy);
  if (len < 0.001) { dx = 0; dy = -1; } else { dx /= len; dy /= len; }
  const px = -dy;
  const py = dx;
  const bx = to[0] - dx * size;
  const by = to[1] - dy * size;
  const hw = size * 0.55;
  return `<polygon points="${f(to[0])},${f(to[1])} ${f(bx + px * hw)},${f(by + py * hw)}`
    + ` ${f(bx - px * hw)},${f(by - py * hw)}" fill="${fill}"/>`;
}

/** Perpendicular bar at `to` — the blocking terminator. */
function blockBar(from: number[], to: number[], stroke: string, width: number): string {
  let dx = to[0] - from[0];
  let dy = to[1] - from[1];
  const len = Math.hypot(dx, dy);
  if (len < 0.001) { dx = 0; dy = -1; } else { dx /= len; dy /= len; }
  const px = -dy * 4.2;
  const py = dx * 4.2;
  return `<line x1="${f(to[0] + px)}" y1="${f(to[1] + py)}" x2="${f(to[0] - px)}"`
    + ` y2="${f(to[1] - py)}" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round"/>`;
}

function cross(x: number, y: number, stroke: string, r = 4.4, width = 2.2): string {
  return `<line x1="${f(x - r)}" y1="${f(y - r)}" x2="${f(x + r)}" y2="${f(y + r)}"`
    + ` stroke="${stroke}" stroke-width="${width}" stroke-linecap="round"/>`
    + `<line x1="${f(x - r)}" y1="${f(y + r)}" x2="${f(x + r)}" y2="${f(y - r)}"`
    + ` stroke="${stroke}" stroke-width="${width}" stroke-linecap="round"/>`;
}

// ── route drawing ──────────────────────────────────────────────────────────

function routePoints(
  align: { x: number; z: number }, route: RouteNode[], fr: Frame,
): number[][] {
  const pts: number[][] = [[fr.sx(align.x), fr.sy(align.z)]];
  for (const nd of route) pts.push([fr.sx(align.x + nd.x), fr.sy(align.z + nd.z)]);
  return pts;
}

function drawRoute(
  align: { x: number; z: number }, route: RouteNode[], fr: Frame, c: typeof DEFAULTS,
): string {
  if (route.length === 0) return '';
  const pts = routePoints(align, route, fr);
  const last = route[route.length - 1];
  const isBlock = last.action === 'BLOCK';
  const stroke = isBlock ? c.block : c.route;
  const width = isBlock ? 1.7 : 2.1;

  // Trim the first segment so the line starts outside the player mark.
  const a = pts[0];
  const b = pts[1];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len > 6) { pts[0] = [a[0] + (dx / len) * 5, a[1] + (dy / len) * 5]; }

  let out = polyline(pts, stroke, width, isBlock ? '3 2.5' : undefined);
  const tail = pts[pts.length - 2];
  const tip = pts[pts.length - 1];
  out += isBlock ? blockBar(tail, tip, stroke, width + 0.4) : arrowHead(tail, tip, stroke);
  return out;
}

// ── entry point ────────────────────────────────────────────────────────────

function isOffense(p: OffensePlay | DefensePlay): p is OffensePlay {
  return 'page' in p;
}

// Defensive against plays loaded from an older save file.
function offPlayers(p: OffensePlay): OffensePlayerPlan[] {
  return Array.isArray(p.players) ? p.players : [];
}
function defPlayers(p: DefensePlay): DefensePlayerPlan[] {
  return Array.isArray(p.players) ? p.players : [];
}

/**
 * Render a play as a standalone SVG string. Deterministic: the same play and
 * options always produce the same bytes.
 */
export function playDiagramSvg(p: OffensePlay | DefensePlay, opts: DiagramOptions = {}): string {
  const c = { ...DEFAULTS, ...opts } as typeof DEFAULTS;
  const w = opts.width ?? DEFAULTS.width;
  const h = opts.height ?? DEFAULTS.height;

  // Collect every point the diagram must contain so the frame can fit them.
  const pts: { x: number; z: number }[] = [];

  if (isOffense(p)) {
    for (const pl of offPlayers(p)) {
      pts.push({ x: pl.align.x, z: pl.align.z });
      for (const nd of pl.route ?? []) pts.push({ x: pl.align.x + nd.x, z: pl.align.z + nd.z });
    }
  } else {
    for (const pl of defPlayers(p)) {
      pts.push({ x: pl.align.x, z: pl.align.z });
      const a = pl.assign;
      if (a.kind === 'ZONE') {
        pts.push({ x: a.x - a.r, z: a.z - a.r });
        pts.push({ x: a.x + a.r, z: a.z + a.r });
      } else if (a.kind === 'RUSH' || a.kind === 'BLITZ_DELAY' || a.kind === 'CONTAIN') {
        pts.push({ x: pl.align.x, z: -3 });
      }
    }
  }

  const fr = makeFrame(pts, w, h);
  const body: string[] = [];

  if (c.bg && c.bg !== 'none') {
    body.push(`<rect x="0" y="0" width="${f(w)}" height="${f(h)}" fill="${c.bg}"/>`);
  }

  // Line of scrimmage.
  body.push(`<line x1="4" y1="${f(fr.losY)}" x2="${f(w - 4)}" y2="${f(fr.losY)}"`
    + ` stroke="${c.los}" stroke-width="1.6"/>`);

  if (isOffense(p)) {
    // Routes first so marks sit on top of them.
    for (const pl of offPlayers(p)) body.push(drawRoute(pl.align, pl.route ?? [], fr, c));
    for (const pl of offPlayers(p)) {
      const x = fr.sx(pl.align.x);
      const y = fr.sy(pl.align.z);
      if (pl.role === 'LINE') {
        body.push(`<circle cx="${f(x)}" cy="${f(y)}" r="3.0" fill="none" stroke="${c.offense}"`
          + ` stroke-width="1.7"/>`);
      } else if (pl.role === 'QB') {
        body.push(`<circle cx="${f(x)}" cy="${f(y)}" r="4.3" fill="${c.offense}"/>`);
        body.push(`<circle cx="${f(x)}" cy="${f(y)}" r="1.6" fill="${c.los}"/>`);
      } else {
        body.push(`<circle cx="${f(x)}" cy="${f(y)}" r="4.1" fill="${c.offense}"/>`);
      }
    }
  } else {
    for (const pl of defPlayers(p)) {
      const x = fr.sx(pl.align.x);
      const y = fr.sy(pl.align.z);
      const a = pl.assign;
      switch (a.kind) {
        case 'ZONE': {
          const rx = Math.max(3, a.r * fr.xScale);
          const ry = Math.max(3, a.r * fr.zScale);
          body.push(`<ellipse cx="${f(fr.sx(a.x))}" cy="${f(fr.sy(a.z))}" rx="${f(rx)}"`
            + ` ry="${f(ry)}" fill="none" stroke="${c.zone}" stroke-width="1.4"`
            + ` stroke-opacity="0.8" stroke-dasharray="4 3"/>`);
          const to = [fr.sx(a.x), fr.sy(a.z)];
          if (Math.hypot(to[0] - x, to[1] - y) > 9) {
            body.push(polyline([[x, y], to], c.zone, 1.2, '2 3'));
          }
          break;
        }
        case 'RUSH':
        case 'BLITZ_DELAY': {
          const to = [fr.sx(pl.align.x + a.lane * 2.2), fr.sy(-2.6)];
          const dash = a.kind === 'BLITZ_DELAY' ? '4 3' : undefined;
          body.push(polyline([[x, y + 5], to], c.rush, 2.0, dash));
          body.push(arrowHead([x, y + 5], to, c.rush));
          break;
        }
        case 'CONTAIN': {
          const to = [fr.sx(pl.align.x + a.side * 3.4), fr.sy(-1.2)];
          body.push(polyline([[x, y + 5], [fr.sx(pl.align.x + a.side * 3.4), fr.sy(1.5)], to],
            c.rush, 1.8, '5 3'));
          body.push(arrowHead([fr.sx(pl.align.x + a.side * 3.4), fr.sy(1.5)], to, c.rush));
          break;
        }
        case 'MAN': {
          const to = [fr.sx((a.slot - 1) * 11), fr.sy(-1.5)];
          body.push(polyline([[x, y], to], c.defense, 1.5, '3 3'));
          body.push(arrowHead([x, y], to, c.defense, 4));
          break;
        }
        case 'SPY': {
          body.push(`<circle cx="${f(x)}" cy="${f(y)}" r="8.5" fill="none" stroke="${c.defense}"`
            + ` stroke-width="1.3" stroke-dasharray="2 3"/>`);
          break;
        }
      }
    }
    for (const pl of defPlayers(p)) {
      body.push(cross(fr.sx(pl.align.x), fr.sy(pl.align.z), c.defense));
    }
  }

  const titleTag = (opts.title ?? true) ? `<title>${esc(p.name ?? p.id ?? 'Play')}</title>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f(w)} ${f(h)}"`
    + ` width="${f(w)}" height="${f(h)}" role="img">${titleTag}${body.join('')}</svg>`;
}

/** Convenience for the UI: a data URI ready to drop into an <img src>. */
export function playDiagramDataUri(p: OffensePlay | DefensePlay, opts?: DiagramOptions): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(playDiagramSvg(p, opts))}`;
}
