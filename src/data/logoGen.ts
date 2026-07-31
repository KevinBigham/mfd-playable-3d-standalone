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
    // Angular head wedge, facing right.
    `<path d="M30 54 L52 30 L82 32 L92 48 L110 44 L96 66 L104 82 L78 76 L66 98 L52 74 L28 72 Z" fill="${p.secondary}"/>`,
    // Beak.
    `<path d="M92 48 L110 44 L96 66 Z" fill="${p.accent}"/>`,
    // Brow slash + eye.
    `<path d="M50 46 L82 42 L84 52 L54 56 Z" fill="${p.primary}"/>`,
    `<circle cx="70" cy="60" r="6" fill="${p.primary}"/>`,
    `<circle cx="70" cy="60" r="2.6" fill="${p.accent}"/>`,
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
    // Sparks.
    `<path d="M96 30 l6 -10 l2 11 l9 -3 l-8 8 Z" fill="${p.accent}"/>`,
  ].join('');
}

function emCrest(p: Pal): string {
  return [
    `<path d="M64 24 L102 38 V68 C102 92 86 104 64 110 C42 104 26 92 26 68 V38 Z" fill="${p.secondary}"/>`,
    // Diagonal band.
    `<path d="M28 68 L100 48 V64 L30 84 Z" fill="${p.accent}"/>`,
    // Quartering.
    `<path d="M64 30 L96 42 V58 L64 68 Z" fill="${p.primary}" fill-opacity="0.5"/>`,
    `<path d="M64 78 L94 68 V72 C94 88 80 98 64 103 Z" fill="${p.primary}" fill-opacity="0.5"/>`,
    // Rim.
    `<path d="M64 24 L102 38 V68 C102 92 86 104 64 110 C42 104 26 92 26 68 V38 Z" fill="none" stroke="${p.ink}" stroke-opacity="0.5" stroke-width="3"/>`,
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
  const horn = 'M62 88 C46 88 32 78 26 60 C22 47 28 36 39 33 C35 47 44 62 58 66 Z';
  return [
    `<path d="${horn}" fill="${p.secondary}"/>`,
    `<g transform="translate(128,0) scale(-1,1)"><path d="${horn}" fill="${p.secondary}"/></g>`,
    // Central plate.
    `<path d="M64 34 L84 46 L84 74 L64 98 L44 74 L44 46 Z" fill="${p.accent}"/>`,
    `<path d="M64 44 L76 52 L76 72 L64 86 L52 72 L52 52 Z" fill="${p.secondary}"/>`,
    `<path d="M64 56 L70 64 L64 74 L58 64 Z" fill="${p.accent}"/>`,
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

function emShield(p: Pal): string {
  return [
    `<path d="M64 22 L104 36 V68 C104 91 87 103 64 110 C41 103 24 91 24 68 V36 Z" fill="${p.secondary}"/>`,
    `<path d="M64 32 L94 42 V68 C94 85 81 95 64 100 C47 95 34 85 34 68 V42 Z" fill="none" stroke="${p.primary}" stroke-width="3"/>`,
    `<path d="M30 58 H98 V72 H30 Z" fill="${p.accent}"/>`,
    `<path d="M60 36 H68 V96 H60 Z" fill="${p.accent}" fill-opacity="0.65"/>`,
    `<circle cx="44" cy="65" r="4" fill="${p.primary}"/>`,
    `<circle cx="84" cy="65" r="4" fill="${p.primary}"/>`,
  ].join('');
}

function emWing(p: Pal): string {
  let feathers = '';
  for (let i = 0; i < 5; i++) {
    const y = 40 + i * 11;
    const x0 = 26 + i * 5;
    const x1 = 104 - i * 13;
    const h = 8 - i * 0.7;
    feathers += `<path d="M${n2(x0)} ${n2(y)} L${n2(x1)} ${n2(y - 6 + i * 1.5)}` +
      ` L${n2(x1 - 6)} ${n2(y + h)} L${n2(x0)} ${n2(y + h + 2)} Z"` +
      ` fill="${i % 2 === 0 ? p.secondary : p.accent}"/>`;
  }
  return [
    `<path d="M22 36 L34 32 L40 100 L26 96 Z" fill="${p.secondary}"/>`,
    feathers,
  ].join('');
}

function emVisor(p: Pal): string {
  return [
    `<path d="M22 62 C22 44 41 34 64 34 C87 34 106 44 106 62 L100 80` +
      ` C86 90 42 90 28 80 Z" fill="${p.secondary}"/>`,
    `<path d="M30 60 C34 49 47 43 64 43 C81 43 94 49 98 60 L94 72 C80 79 48 79 34 72 Z" fill="${p.accent}"/>`,
    `<path d="M36 58 C42 51 52 48 64 48 C76 48 86 51 92 58" fill="none" stroke="${p.primary}" stroke-width="4" stroke-linecap="round"/>`,
    `<path d="M40 84 H56 V92 H38 Z" fill="${p.secondary}"/>`,
    `<path d="M72 84 H88 L90 92 H72 Z" fill="${p.secondary}"/>`,
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
    `<path d="M42 30 L80 24 L86 100 L44 104 Z" fill="${p.secondary}"/>`,
    `<path d="M80 24 L96 36 L98 94 L86 100 Z" fill="${p.accent}"/>`,
    `<path d="M42 30 L80 24 L96 36 L56 33 Z" fill="${p.ink}" fill-opacity="0.35"/>`,
    // Carved glyph.
    `<path d="M54 46 H72 V54 H54 Z" fill="${p.primary}"/>`,
    `<path d="M54 62 H72 V68 H54 Z" fill="${p.primary}"/>`,
    `<path d="M54 76 H66 V82 H54 Z" fill="${p.primary}"/>`,
    // Ground bars.
    `<path d="M24 104 H104 V110 H24 Z" fill="${p.accent}" fill-opacity="0.8"/>`,
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
  const city = esc(team.city.toUpperCase());
  const name = esc(team.name.toUpperCase());
  const label = esc(`${team.city} ${team.name}`);
  const common =
    `font-family="${FONT_STACK}" text-anchor="middle" letter-spacing="2"` +
    ` stroke-linejoin="round" paint-order="stroke"`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 440 132" width="440" height="132"` +
    ` role="img" aria-label="${label}">` +
    `<g transform="skewX(-11)">` +
    `<text x="240" y="48" ${common} font-size="34" fill="${c.accent}" fill-opacity="0.95"` +
    ` stroke="${c.ink}" stroke-width="7">${city}</text>` +
    `<text x="234" y="112" ${common} font-size="72" fill="${c.secondary}"` +
    ` stroke="${c.ink}" stroke-width="12" opacity="0.55">${name}</text>` +
    `<text x="228" y="107" ${common} font-size="72" fill="${c.primary}"` +
    ` stroke="${c.ink}" stroke-width="10">${name}</text>` +
    `</g>` +
    `<path d="M18 122 H422 V128 H18 Z" fill="${c.accent}"/>` +
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
