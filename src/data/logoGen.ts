/**
 * GRIDIRON OVERDRIVE — procedural team emblems.
 *
 * Every mark is authored here from primitives: polygons, paths, circles. No raster art,
 * no embedded fonts, no external references. All emblems are abstract geometry invented
 * for this league and are not derived from any existing sports mark.
 *
 * PURE and side-effect free: same team in, same string out, in any runtime.
 * Emblems are drawn on a 128x128 canvas and stay inside a radius-56 disc so the badge
 * ring never clips them. They are authored to stay legible at 64px and 32px.
 */

import type { TeamDef } from '../core/types.ts';

export const LOGO_KEYS = [
  'chevron', 'raptor', 'bolt', 'anvil', 'crest', 'star', 'wave', 'gear',
  'horns', 'flame', 'shield', 'wing', 'visor', 'orbit', 'trident', 'monolith',
] as const;

export type LogoKey = (typeof LOGO_KEYS)[number];

interface Pal {
  primary: string;
  secondary: string;
  accent: string;
  ink: string;
}

// ──────────────────────────────────────────────────────────────── tiny helpers

function n2(v: number): string {
  const s = v.toFixed(2);
  return s.indexOf('.') >= 0 ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}

function polar(cx: number, cy: number, r: number, a: number): string {
  return `${n2(cx + Math.cos(a) * r)} ${n2(cy + Math.sin(a) * r)}`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ──────────────────────────────────────────────────────────────── emblems
// Each returns markup only; the badge frame is added by teamLogoSvg().

function emChevron(p: Pal): string {
  const bar = (apex: number, fill: string): string =>
    `<path d="M64 ${apex} L96 ${apex + 26} L96 ${apex + 37} L64 ${apex + 11} L32 ${apex + 37} L32 ${apex + 26} Z" fill="${fill}"/>`;
  return [
    bar(30, p.secondary),
    bar(48, p.accent),
    bar(66, p.secondary),
    `<path d="M64 30 L96 56 L96 61 L64 35 L32 61 L32 56 Z" fill="${p.ink}" fill-opacity="0.22"/>`,
  ].join('');
}

function emRaptor(p: Pal): string {
  return [
    // Head in profile: domed crown, hooked beak, pointed jaw.
    `<path d="M28 72 C30 44 48 24 74 26 C86 30 90 38 92 48 L114 54 L94 68 L84 73 L70 96 L54 74 Z" fill="${p.secondary}"/>`,
    // Beak.
    `<path d="M92 48 L114 54 L94 68 Z" fill="${p.accent}"/>`,
    // Brow slash cut clean through to the badge, eye set into it.
    `<path d="M46 46 L80 39 L84 54 L50 61 Z" fill="${p.primary}"/>`,
    `<circle cx="66" cy="50" r="5.5" fill="${p.accent}"/>`,
    `<circle cx="92" cy="55" r="2.4" fill="${p.primary}"/>`,
  ].join('');
}

function emBolt(p: Pal): string {
  const d = 'M76 22 L38 68 L58 68 L48 106 L92 58 L70 58 Z';
  return [
    `<path d="${d}" fill="${p.ink}" fill-opacity="0.25" transform="translate(4,5)"/>`,
    `<path d="${d}" fill="${p.secondary}" stroke="${p.accent}" stroke-width="5" stroke-linejoin="round"/>`,
    `<path d="M70 34 L52 56 L62 56" fill="none" stroke="${p.accent}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`,
  ].join('');
}

function emAnvil(p: Pal): string {
  return [
    // Face plate with a horn to the right.
    `<path d="M28 42 H88 L106 56 L88 62 H28 Z" fill="${p.secondary}"/>`,
    // Waist.
    `<path d="M46 62 H74 L80 80 H40 Z" fill="${p.secondary}"/>`,
    // Base.
    `<path d="M32 80 H88 L92 98 H28 Z" fill="${p.secondary}"/>`,
    // Struck highlight.
    `<path d="M28 42 H88 L94 46 H28 Z" fill="${p.accent}"/>`,
    `<path d="M40 86 H80 L81 92 H39 Z" fill="${p.primary}" fill-opacity="0.55"/>`,
    // Strike spark, kept clear of the badge ring.
    `<path d="M92 22 L96 30 L104 32 L96 36 L92 46 L88 36 L80 32 L88 30 Z" fill="${p.accent}"/>`,
  ].join('');
}

/** A quartered standard with a swallowtail hem — deliberately NOT a shield silhouette. */
function emCrest(p: Pal): string {
  const banner = 'M30 36 H98 V92 L82 83 L64 98 L46 83 L30 92 Z';
  return [
    `<path d="${banner}" fill="${p.secondary}"/>`,
    // Opposing quarters.
    `<path d="M30 36 H64 V58 H30 Z" fill="${p.primary}" fill-opacity="0.5"/>`,
    `<path d="M64 68 H98 V92 L82 83 L64 98 Z" fill="${p.primary}" fill-opacity="0.5"/>`,
    // Cross bands.
    `<path d="M30 58 H98 V68 H30 Z" fill="${p.accent}"/>`,
    `<path d="M59 36 H69 V94 H59 Z" fill="${p.accent}"/>`,
    // Head rail.
    `<path d="M28 26 H100 V36 H28 Z" fill="${p.accent}"/>`,
    `<path d="${banner}" fill="none" stroke="${p.ink}" stroke-opacity="0.4" stroke-width="2"/>`,
  ].join('');
}

function emStar(p: Pal): string {
  const outer = 40, inner = 16;
  let star = '';
  for (let i = 0; i < 5; i++) {
    const a1 = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    const a2 = a1 + Math.PI / 5;
    star += `${i === 0 ? 'M' : 'L'}${polar(64, 64, outer, a1)} L${polar(64, 64, inner, a2)} `;
  }
  let spikes = '';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + Math.PI / 12;
    spikes += `M${polar(64, 64, 43, a - 0.05)} L${polar(64, 64, 52, a)} L${polar(64, 64, 43, a + 0.05)} Z `;
  }
  return [
    `<path d="${spikes.trim()}" fill="${p.accent}"/>`,
    `<path d="${star}Z" fill="${p.secondary}"/>`,
    `<path d="M64 24 L73.4 51.06 L54.6 51.06 Z" fill="${p.accent}" fill-opacity="0.85"/>`,
  ].join('');
}

function emWave(p: Pal): string {
  const band = (y: number, x0: number, x1: number, fill: string, w: number): string =>
    `<path d="M${x0} ${y} C${x0 + 18} ${y - 15}, ${x0 + 34} ${y + 15}, ${(x0 + x1) / 2} ${y}` +
    ` S${x1 - 12} ${y - 16}, ${x1} ${y - 7}" fill="none" stroke="${fill}" stroke-width="${w}"` +
    ` stroke-linecap="round"/>`;
  return [
    band(46, 28, 100, p.secondary, 11),
    band(66, 22, 106, p.accent, 12),
    band(86, 28, 100, p.secondary, 11),
    `<circle cx="98" cy="34" r="5" fill="${p.accent}"/>`,
  ].join('');
}

function emGear(p: Pal): string {
  const count = 10;
  let teeth = '';
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const hw = (Math.PI / count) * 0.48;
    const ht = hw * 0.58;
    teeth += `M${polar(64, 64, 34, a - hw)} L${polar(64, 64, 51, a - ht)} ` +
      `L${polar(64, 64, 51, a + ht)} L${polar(64, 64, 34, a + hw)} Z `;
  }
  let bolts = '';
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
    bolts += `<circle cx="${n2(64 + Math.cos(a) * 26)}" cy="${n2(64 + Math.sin(a) * 26)}" r="4" fill="${p.primary}"/>`;
  }
  return [
    `<path d="${teeth.trim()}" fill="${p.secondary}"/>`,
    `<circle cx="64" cy="64" r="37" fill="${p.secondary}"/>`,
    `<circle cx="64" cy="64" r="30" fill="${p.accent}"/>`,
    bolts,
    `<circle cx="64" cy="64" r="13" fill="${p.primary}"/>`,
    `<path d="M64 51 L74 69 L54 69 Z" fill="${p.secondary}"/>`,
  ].join('');
}

function emHorns(p: Pal): string {
  const horn = 'M62 90 C42 90 24 78 19 57 C16 41 25 29 39 25 C31 41 39 62 57 69 Z';
  return [
    `<path d="${horn}" fill="${p.secondary}"/>`,
    `<g transform="translate(128,0) scale(-1,1)"><path d="${horn}" fill="${p.secondary}"/></g>`,
    // Centre plate, kept small so the horns carry the silhouette.
    `<path d="M64 44 L79 55 L79 77 L64 98 L49 77 L49 55 Z" fill="${p.accent}"/>`,
    `<path d="M64 57 L71 62 L71 74 L64 86 L57 74 L57 62 Z" fill="${p.secondary}"/>`,
  ].join('');
}

function emFlame(p: Pal): string {
  return [
    `<path d="M64 18 C76 42 98 52 98 74 C98 93 83 108 64 108 C45 108 30 93 30 74` +
      ` C30 57 44 50 50 32 C56 44 58 52 62 56 C67 44 64 30 64 18 Z" fill="${p.secondary}"/>`,
    `<path d="M64 50 C73 64 82 71 82 82 C82 92 74 101 64 101 C54 101 46 92 46 82` +
      ` C46 71 57 65 64 50 Z" fill="${p.accent}"/>`,
    `<path d="M64 74 C68 81 71 84 71 89 C71 93 68 96 64 96 C60 96 57 93 57 89 C57 84 60 81 64 74 Z" fill="${p.primary}"/>`,
  ].join('');
}

/** Shield carrying a portcullis — a gate, for a team that guards one. */
function emShield(p: Pal): string {
  const bars = [46, 60, 74]
    .map((x) => `<path d="M${x} 46 H${x + 8} V84 H${x} Z" fill="${p.accent}"/>`)
    .join('');
  return [
    `<path d="M64 22 L104 36 V68 C104 91 87 103 64 110 C41 103 24 91 24 68 V36 Z" fill="${p.secondary}"/>`,
    `<path d="M64 33 L94 43 V68 C94 85 81 95 64 100 C47 95 34 85 34 68 V43 Z" fill="${p.primary}" fill-opacity="0.4"/>`,
    bars,
    `<path d="M40 50 H88 V58 H40 Z" fill="${p.accent}"/>`,
    `<path d="M38 70 H90 V78 H38 Z" fill="${p.accent}"/>`,
    `<path d="M64 22 L104 36 V68 C104 91 87 103 64 110 C41 103 24 91 24 68 V36 Z" fill="none" stroke="${p.ink}" stroke-opacity="0.35" stroke-width="3"/>`,
  ].join('');
}

/** Swept wing: a leading edge with primaries hanging beneath it. */
function emWing(p: Pal): string {
  // Anchors ride the leading edge; each primary rakes further backward toward the tip.
  const anchors: readonly (readonly [number, number, number, number])[] = [
    [32, 48, 26, 14], [50, 41, 30, 22], [68, 43, 34, 30], [85, 51, 38, 38], [99, 62, 42, 46],
  ];
  let feathers = '';
  anchors.forEach(([x, y, len, rake], i) => {
    feathers += `<g transform="rotate(${rake} ${x} ${y})">` +
      `<path d="M${n2(x - 6)} ${n2(y - 2)} L${n2(x + 7)} ${n2(y)}` +
      ` L${n2(x + 2)} ${n2(y + len)} L${n2(x - 8)} ${n2(y + len - 8)} Z"` +
      ` fill="${i % 2 === 0 ? p.secondary : p.accent}"/></g>`;
  });
  return [
    feathers,
    `<path d="M24 50 C48 32 84 40 106 64" fill="none" stroke="${p.secondary}" stroke-width="14" stroke-linecap="round"/>`,
    `<path d="M28 47 C50 34 80 41 99 59" fill="none" stroke="${p.accent}" stroke-width="4" stroke-linecap="round"/>`,
    `<circle cx="28" cy="52" r="10" fill="${p.secondary}"/>`,
  ].join('');
}

function emVisor(p: Pal): string {
  return [
    // Brow chevron.
    `<path d="M22 46 L64 28 L106 46 L106 37 L64 19 L22 37 Z" fill="${p.accent}"/>`,
    // Visor slab, raked.
    `<path d="M24 56 L104 48 L104 76 L24 84 Z" fill="${p.secondary}"/>`,
    // Lens slit.
    `<path d="M32 61 L96 55 L96 70 L32 76 Z" fill="${p.accent}"/>`,
    // Nose bridge.
    `<path d="M61 50 H67 V82 H61 Z" fill="${p.primary}"/>`,
    // Chin bar.
    `<path d="M36 88 H92 L86 98 H42 Z" fill="${p.secondary}"/>`,
  ].join('');
}

function emOrbit(p: Pal): string {
  return [
    `<g transform="rotate(-28 64 64)"><ellipse cx="64" cy="64" rx="48" ry="18" fill="none" stroke="${p.secondary}" stroke-width="7"/></g>`,
    `<g transform="rotate(34 64 64)"><ellipse cx="64" cy="64" rx="46" ry="16" fill="none" stroke="${p.accent}" stroke-width="6"/></g>`,
    `<circle cx="64" cy="64" r="19" fill="${p.secondary}"/>`,
    `<circle cx="64" cy="64" r="11" fill="${p.accent}"/>`,
    `<circle cx="102" cy="46" r="6" fill="${p.accent}"/>`,
    `<circle cx="28" cy="80" r="4.5" fill="${p.secondary}"/>`,
  ].join('');
}

function emTrident(p: Pal): string {
  return [
    `<path d="M34 54 L40 22 L48 54 Z" fill="${p.secondary}"/>`,
    `<path d="M80 54 L88 22 L94 54 Z" fill="${p.secondary}"/>`,
    `<path d="M57 54 L64 16 L71 54 Z" fill="${p.accent}"/>`,
    `<path d="M32 54 H96 V66 H32 Z" fill="${p.secondary}"/>`,
    `<path d="M58 66 H70 V102 H58 Z" fill="${p.secondary}"/>`,
    `<path d="M48 100 H80 V110 H48 Z" fill="${p.accent}"/>`,
    `<circle cx="64" cy="60" r="5" fill="${p.primary}"/>`,
  ].join('');
}

function emMonolith(p: Pal): string {
  return [
    // Ground shelf, behind the slab.
    `<path d="M34 96 H98 L102 106 H30 Z" fill="${p.accent}" fill-opacity="0.85"/>`,
    // Front face.
    `<path d="M38 22 L78 16 L84 100 L36 104 Z" fill="${p.secondary}"/>`,
    // Lit side face.
    `<path d="M78 16 L96 30 L98 92 L84 100 Z" fill="${p.accent}"/>`,
    // Bevelled cap.
    `<path d="M38 22 L78 16 L96 30 L56 35 Z" fill="${p.ink}" fill-opacity="0.3"/>`,
    // Carved glyph.
    `<path d="M48 48 H72 V57 H48 Z" fill="${p.primary}"/>`,
    `<path d="M48 65 H72 V73 H48 Z" fill="${p.primary}"/>`,
    `<path d="M48 81 H64 V89 H48 Z" fill="${p.primary}"/>`,
  ].join('');
}

const EMBLEMS: Record<LogoKey, (p: Pal) => string> = {
  chevron: emChevron,
  raptor: emRaptor,
  bolt: emBolt,
  anvil: emAnvil,
  crest: emCrest,
  star: emStar,
  wave: emWave,
  gear: emGear,
  horns: emHorns,
  flame: emFlame,
  shield: emShield,
  wing: emWing,
  visor: emVisor,
  orbit: emOrbit,
  trident: emTrident,
  monolith: emMonolith,
};

function isLogoKey(k: string): k is LogoKey {
  return (LOGO_KEYS as readonly string[]).indexOf(k) >= 0;
}

// ──────────────────────────────────────────────────────────────── public API

/**
 * A complete, standalone team badge as an SVG string.
 * `size` sets the rendered px box; the artwork itself is always a 128-unit square.
 */
export function teamLogoSvg(team: TeamDef, size = 128): string {
  const p: Pal = {
    primary: team.colors.primary,
    secondary: team.colors.secondary,
    accent: team.colors.accent,
    ink: team.colors.ink,
  };
  const key: LogoKey = isLogoKey(team.logo) ? team.logo : 'crest';
  const label = esc(`${team.city} ${team.name}`);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="${n2(size)}" height="${n2(size)}"` +
    ` role="img" aria-label="${label}">` +
    `<circle cx="64" cy="64" r="60" fill="${p.primary}"/>` +
    `<path d="M64 4 A60 60 0 0 1 124 64 L4 64 A60 60 0 0 1 64 4 Z" fill="${p.ink}" fill-opacity="0.07"/>` +
    EMBLEMS[key](p) +
    `<circle cx="64" cy="64" r="60" fill="none" stroke="${p.accent}" stroke-width="6"/>` +
    `<circle cx="64" cy="64" r="53" fill="none" stroke="${p.ink}" stroke-opacity="0.3" stroke-width="2"/>` +
    `</svg>`
  );
}

/** Just the emblem geometry, unframed — for 3D extrusion and field decals. */
export function teamEmblemMarkup(team: TeamDef): string {
  const p: Pal = {
    primary: team.colors.primary,
    secondary: team.colors.secondary,
    accent: team.colors.accent,
    ink: team.colors.ink,
  };
  const key: LogoKey = isLogoKey(team.logo) ? team.logo : 'crest';
  return EMBLEMS[key](p);
}

const FONT_STACK = 'Impact, Haettenschweiler, &quot;Arial Narrow Bold&quot;, sans-serif';

/**
 * Skewed, outlined wordmark. Uses a generic condensed-heavy font stack only —
 * no font is shipped or fetched, so it degrades to the system sans if none is present.
 */
export function teamWordmarkSvg(team: TeamDef): string {
  const c = team.colors;
  const cityRaw = team.city.toUpperCase();
  const nameRaw = team.name.toUpperCase();
  const city = esc(cityRaw);
  const name = esc(nameRaw);
  const label = esc(`${team.city} ${team.name}`);

  // `textLength` + `spacingAndGlyphs` pins the run to an exact width, so the mark fits its
  // box whether the heavy condensed face is present or the system sans is substituted.
  const cityLen = Math.min(300, Math.max(90, cityRaw.length * 19));
  const nameLen = Math.min(396, Math.max(120, nameRaw.length * 44));
  const common =
    `font-family="${FONT_STACK}" text-anchor="middle" lengthAdjust="spacingAndGlyphs"` +
    ` stroke-linejoin="round" paint-order="stroke"`;
  // Skew pivots on the mark's own centre line so neither row walks out of the box.
  const skew = 'translate(0,70) skewX(-11) translate(0,-70)';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 460 140" width="460" height="140"` +
    ` role="img" aria-label="${label}">` +
    `<g transform="${skew}">` +
    `<text x="230" y="46" ${common} font-size="32" textLength="${n2(cityLen)}"` +
    ` fill="${c.accent}" stroke="${c.ink}" stroke-width="7">${city}</text>` +
    `<text x="235" y="115" ${common} font-size="74" textLength="${n2(nameLen)}"` +
    ` fill="${c.secondary}" stroke="${c.ink}" stroke-width="12" opacity="0.5">${name}</text>` +
    `<text x="230" y="110" ${common} font-size="74" textLength="${n2(nameLen)}"` +
    ` fill="${c.primary}" stroke="${c.ink}" stroke-width="10">${name}</text>` +
    `</g>` +
    `<path d="M30 126 H430 V133 H30 Z" fill="${c.accent}"/>` +
    `</svg>`
  );
}

/**
 * Inline data URL for an SVG string. Uses percent-encoding rather than base64 so
 * non-ASCII team text survives without a unicode-safe base64 shim.
 */
export function logoDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
