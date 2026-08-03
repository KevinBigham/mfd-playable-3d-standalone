import * as THREE from 'three';
import type { PlayerDef, TeamColors } from '../core/types.ts';
import type { SceneRegistry, QualitySettings } from './registry.ts';
import { clamp, clamp01, lerp } from '../core/math.ts';
import { SURF, applySurfaceShader, makeRimUniforms, type Surface, type RimUniforms } from './surfaces.ts';

/**
 * Procedural chunky arcade athletes.
 *
 * Each athlete is ONE SkinnedMesh with rigid (single-bone, weight 1) skinning and vertex colours,
 * so a full 7-on-7 costs ~14 draw calls. That budget is the shape of this whole file: there is no
 * second mesh to hang a helmet decal on and no per-athlete texture to print a number with, so
 * every piece of identity — the jersey number, the facemask, the thigh pads, the tape on a
 * forearm — has to be geometry, merged into the same buffer, coloured by a vertex attribute and
 * classified by the `aSurf` surface attribute from surfaces.ts.
 *
 * Two consequences worth stating outright:
 *
 * 1. **Numbers are extruded boxes.** A jersey number is drawn from a 3x5 stroke font, each digit
 *    decomposed into the fewest axis-aligned rectangles that cover it (`digitRects`). The strokes
 *    are deliberately *deep* — they punch well into the torso — because the jersey they sit on is
 *    a rounded box, and a shallow decal would float off the surface wherever it curves away.
 *
 * 2. **Variation is a pure function of the PlayerDef.** A line of seven athletes has to read as
 *    seven people, but the same athlete must build identically every time or fixed-seed capture
 *    and replay stop matching. So neck thickness, gut, sleeve length, sock height, glove and shoe
 *    colours all come out of a hash of the athlete's own identity fields. There is no Math.random
 *    in this file and there must never be one.
 */

/**
 * The cleat, in foot-bone space: how far the sole sits below the ankle, and where the toe and
 * heel ends of it are. The pose solver needs these to keep a planted shoe on the turf instead of
 * hovering over it or sinking through it, and they have to agree with the geometry built below —
 * see the cleat section of the leg loop.
 */
export const SHOE = { drop: 0.108, toe: 0.2525, heel: -0.1325 } as const;

/**
 * The athlete, measured.
 *
 * Every vertical landmark here is a fraction of STATURE — the crown of the helmet above the turf.
 * An athlete is therefore one number with a shape attached, rather than a pile of independent
 * multipliers that happened to look right together. The fractions are anthropometric (Drillis &
 * Contini, corrected for a helmet adding about 2% to standing height), with two departures made
 * on purpose:
 *
 *  - The head unit is exactly S/6, so the figure reads at **six heads tall**. Real helmeted
 *    proportion is 6.4 and a late-90s arcade cabinet is about 5. Six is unmistakably athletic in
 *    silhouette while still stylised enough for an 800-triangle LOW tier.
 *  - The ankle sits at the cleat's sole thickness rather than the anatomical 0.038·S, because a
 *    shoe hovering over the turf is a worse lie than a shin a centimetre short.
 *
 * What this replaced: a nominal `height` that nothing consumed, with independent multipliers
 * stacking a 0.36 neck riser and a 0.29 head offset on top of a chest at 0.70 of nominal. The
 * figure that actually rendered was 18% taller than the number configuring it — every athlete
 * stood 7ft 2 to 7ft 5, carrying an eighteen-inch head, at 4.7 heads tall, with legs 31% of the
 * body against a real 47%. `npm run anthro` asserts these numbers now so they cannot drift back.
 */
export const PROP = {
  knee: 0.285,
  hip: 0.519,           // greater trochanter — the leg pivots here, not at the belt
  chest: 0.630,         // lumbar bend, where the trunk pitches from
  shoulder: 0.800,      // glenohumeral joint
  neck: 0.815,          // C7, base of the collar
  head: 0.875,          // ear canal — the head's pivot, not its centre
  chin: 1 - 1 / 6,      // head unit = S/6 → six heads, exactly
  crown: 1,
  shoulderX: 0.098,     // half the span between shoulder joints
  hipX: 0.052,
  upperArm: 0.186,
  foreArm: 0.146,
} as const;

/** Stature in yards, from the athlete's cosmetic build and power. 2.02 yd = 6ft 1, 2.14 = 6ft 5. */
export function statureOf(build: number, power: number): number {
  return lerp(2.02, 2.14, clamp01(build * 0.6 + power / 300));
}

export const BONE_NAMES = [
  'root', 'hips', 'chest', 'neck', 'head',
  'shoulderL', 'elbowL', 'handL', 'shoulderR', 'elbowR', 'handR',
  'thighL', 'kneeL', 'footL', 'thighR', 'kneeR', 'footR',
] as const;
export type BoneName = typeof BONE_NAMES[number];

export interface AthleteRig {
  root: THREE.Group;
  mesh: THREE.SkinnedMesh;
  bones: Record<BoneName, THREE.Bone>;
  /** Cosmetic accessory attached to the chest for Overdrive glow. */
  aura: THREE.Mesh;
  height: number;
  dispose(): void;
}

const SKIN_RAMP = ['#f0c8a0', '#e0a97a', '#c98a5c', '#a06840', '#7a4a2c', '#54321e'];

function skinColor(tone: number): THREE.Color {
  const t = clamp01(tone) * (SKIN_RAMP.length - 1);
  const i = Math.floor(t);
  const c1 = new THREE.Color(SKIN_RAMP[i]);
  const c2 = new THREE.Color(SKIN_RAMP[Math.min(SKIN_RAMP.length - 1, i + 1)]);
  return c1.lerp(c2, t - i);
}

function luma(c: THREE.Color): number { return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; }

/**
 * Pick a colour that actually reads on `on`. Kit palettes are authored for a badge, not for a
 * number seen at twenty yards, so `ink` sometimes lands within a few per cent of the shirt it is
 * printed on. When it does, fall back to the neutral that contrasts.
 */
function readable(on: THREE.Color, want: THREE.Color, minDelta = 0.26): THREE.Color {
  if (Math.abs(luma(on) - luma(want)) >= minDelta) return want.clone();
  return luma(on) > 0.45 ? new THREE.Color('#12151b') : new THREE.Color('#f3f6fb');
}

// ── deterministic per-athlete variation ────────────────────────────────────

/** FNV-1a. Stable across engines, which a hash used for geometry has to be. */
function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 0x01000193); }
  return h >>> 0;
}

/** xorshift32 over that hash — the only randomness this file is allowed. */
class Variation {
  private s: number;
  constructor(seed: number) { this.s = (seed >>> 0) || 0x9e3779b9; }
  unit(): number {
    let x = this.s;
    x = (x ^ (x << 13)) >>> 0;
    x = (x ^ (x >>> 17)) >>> 0;
    x = (x ^ (x << 5)) >>> 0;
    this.s = x;
    return x / 4294967296;
  }
  range(a: number, b: number): number { return a + (b - a) * this.unit(); }
  pick<T>(list: readonly T[]): T { return list[Math.min(list.length - 1, (this.unit() * list.length) | 0)]; }
  chance(p: number): boolean { return this.unit() < p; }
}

// ── geometry primitives ────────────────────────────────────────────────────

interface PartOpts {
  color: THREE.Color;
  bone: number;
  surf?: Surface;
  /**
   * Smooth skinning across one joint. The vertex's weight on `to` ramps from 0 at local y = `y0`
   * to 1 at y = `y1`, smoothstepped, with the remainder staying on `bone`. Either direction
   * works: an upper arm ramps downward into the elbow, a forearm ramps upward into the shoulder,
   * and the two meet at half and half so the joint bends as one surface instead of two solids
   * grinding past each other.
   */
  joint?: { to: number; y0: number; y1: number };
}

/** Rounded box that reads as moulded equipment rather than a cube. */
function chunk(w: number, h: number, d: number, seg: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d, seg, seg, seg);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const r = Math.min(w, h, d) * 0.34;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const cx = clamp(x, -(w / 2 - r), w / 2 - r);
    const cy = clamp(y, -(h / 2 - r), h / 2 - r);
    const cz = clamp(z, -(d / 2 - r), d / 2 - r);
    const dx = x - cx, dy = y - cy, dz = z - cz;
    const len = Math.hypot(dx, dy, dz) || 1;
    pos.setXYZ(i, cx + (dx / len) * r, cy + (dy / len) * r, cz + (dz / len) * r);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * One ring of a lofted limb: how far down the bone it sits (0 at the bone, 1 at its child), its
 * half-width across the body, its half-depth front-to-back, and how far the ring's centre sits
 * behind the bone's axis. `t` may run slightly outside 0..1 so a limb can overshoot its joint
 * and meet the next segment inside the elbow or knee rather than at a visible butt seam.
 */
type Ring = readonly [t: number, rx: number, rz: number, dz?: number];

/**
 * A limb, lofted rather than boxed.
 *
 * A rounded box has no profile: the upper arm and the forearm come out the same diameter, and so
 * do the thigh and the shin. There is no deltoid, no taper to the wrist, no quad sweep, no calf
 * belly and no ankle — and none of that can be bought at any segment count, because the shape a
 * box is missing is not detail, it is silhouette. At the size an athlete actually occupies on
 * screen (~128px on a desktop, ~56px on a phone) silhouette is very nearly the whole budget.
 *
 * It is also CHEAPER than what it replaces. A `chunk` at HIGH is a 4×4×4 BoxGeometry — 192
 * triangles spent on a shape with no profile at all — where an eight-sided five-ring loft is 80
 * with a full one. Across ten limb segments that is about 1 600 triangles per athlete returned.
 *
 * The `dz` offset is what makes a calf a calf: the belly of it sits behind the shin's axis, and
 * an ellipse centred on the bone can only ever be a symmetric sausage.
 */
function limb(len: number, rings: readonly Ring[], sides: number): THREE.BufferGeometry {
  // At the lowest tier a five-ring profile is more shape than a 56-pixel athlete can show, so
  // every other interior ring is dropped. Both ends always survive — they are where this limb
  // meets the next one, and a gap there is visible at any size.
  if (sides <= 4 && rings.length > 3) {
    rings = rings.filter((_, i) => i === 0 || i === rings.length - 1 || i % 2 === 1);
  }
  const R = rings.length;
  const pos = new Float32Array((R * sides + 2) * 3);
  let k = 0;
  for (const [t, rx, rz, dz] of rings) {
    const y = -t * len;
    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * Math.PI * 2;
      pos[k++] = Math.cos(a) * rx;
      pos[k++] = y;
      pos[k++] = Math.sin(a) * rz + (dz ?? 0);
    }
  }
  const top = R * sides, bot = top + 1;
  pos[k++] = 0; pos[k++] = -rings[0][0] * len; pos[k++] = rings[0][3] ?? 0;
  pos[k++] = 0; pos[k++] = -rings[R - 1][0] * len; pos[k++] = rings[R - 1][3] ?? 0;

  const idx: number[] = [];
  for (let r = 0; r < R - 1; r++) {
    for (let s = 0; s < sides; s++) {
      const n = (s + 1) % sides;
      const a = r * sides + s, b = r * sides + n, c = (r + 1) * sides + s, d = (r + 1) * sides + n;
      idx.push(a, b, c, b, d, c);
    }
  }
  for (let s = 0; s < sides; s++) {
    const n = (s + 1) % sides;
    idx.push(top, n, s);
    idx.push(bot, (R - 1) * sides + s, (R - 1) * sides + n);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Where a ring list sits at `t`, linearly between the two rings that straddle it. */
function ringAt(rings: readonly Ring[], t: number): [rx: number, rz: number, dz: number] {
  let i = 0;
  while (i < rings.length - 2 && rings[i + 1][0] < t) i++;
  const a = rings[i], b = rings[i + 1];
  const k = clamp01((t - a[0]) / (b[0] - a[0] || 1));
  return [lerp(a[1], b[1], k), lerp(a[2], b[2], k), lerp(a[3] ?? 0, b[3] ?? 0, k)];
}

/**
 * A band wrapped around a limb — a sleeve hem, an armband, wrist tape, the top of a sock.
 *
 * These were flat boxes, which was fine while the limb underneath was a flat-sided box too. Once
 * the limb became a tapered tube every one of them turned into a fin sticking out of a round
 * arm. Sampling the profile they sit on is the only way trim stays trim.
 */
function band(
  len: number, rings: readonly Ring[], t: number, w: number, swell: number, sides: number,
): THREE.BufferGeometry {
  const lo = ringAt(rings, t - w * 0.5), hi = ringAt(rings, t + w * 0.5);
  return limb(len, [
    [t - w * 0.5, lo[0] * swell, lo[1] * swell, lo[2]],
    [t + w * 0.5, hi[0] * swell, hi[1] * swell, hi[2]],
  ], sides);
}

/** Flat trim: tape, stripes, belts, soles. Twelve triangles, no rounding. */
function slab(w: number, h: number, d: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(w, h, d);
}

/** Round bar along Y — facemask uprights, chin posts. */
function bar(len: number, r: number, seg: number): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(r, r, len, seg, 1);
}

/**
 * Squashed ellipsoid. `chunk` derives its corner radius from the smallest dimension, so a wide
 * flat pad comes out of it with a flat top — exactly the plank silhouette the pads are trying not
 * to be. A scaled sphere is rounder, and at these sizes it is also cheaper.
 */
function blob(rx: number, ry: number, rz: number, wSeg: number, hSeg: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, wSeg, hSeg);
  g.scale(rx, ry, rz);
  return g;
}

/**
 * A horizontal arc centred on +Z (the direction the athlete faces): one facemask bar.
 * Built in the XY plane then laid flat and spun so the arc's midpoint is dead ahead.
 */
function frontArc(radius: number, tube: number, arc: number, seg: number): THREE.BufferGeometry {
  const g = new THREE.TorusGeometry(radius, tube, 3, seg, arc);
  g.rotateX(-Math.PI / 2);
  g.rotateY(-(Math.PI / 2 + arc / 2));
  return g;
}

/** A sagittal arc from the back of the helmet over the crown to the front: the helmet stripe. */
function crownArc(radius: number, tube: number, seg: number): THREE.BufferGeometry {
  const g = new THREE.TorusGeometry(radius, tube, 3, seg, Math.PI);
  g.rotateY(Math.PI / 2);
  return g;
}

// ── jersey numbers ─────────────────────────────────────────────────────────
//
// A 3x5 stroke font. Blocky is not a compromise here: at thirteen to twenty yards a one-cell
// stroke is roughly six screen pixels, which is exactly the weight a number needs to survive
// motion blur and a rim light. Anything finer would dissolve.

const DIGIT_ROWS: readonly string[] = [
  '111101101101111', // 0
  '010110010010111', // 1
  '111001111100111', // 2
  '111001111001111', // 3
  '101101111001001', // 4
  '111100111001111', // 5
  '111100111101111', // 6
  '111001010010010', // 7
  '111101111101111', // 8
  '111101111001111', // 9
];

interface Rect { c0: number; c1: number; r0: number; r1: number }

/**
 * Cover a digit's lit cells with as few axis-aligned rectangles as possible: run-length the rows,
 * then extend a run downward whenever the row below repeats it exactly. A '0' collapses from
 * eleven cells to four boxes, which is the difference between a legible number and a tenth of the
 * athlete's triangle budget.
 */
function digitRects(d: number): Rect[] {
  const bits = DIGIT_ROWS[d];
  const out: Rect[] = [];
  let prev = new Map<number, Rect>();
  for (let r = 0; r < 5; r++) {
    const cur = new Map<number, Rect>();
    let c = 0;
    while (c < 3) {
      if (bits[r * 3 + c] === '1') {
        let e = c;
        while (e < 3 && bits[r * 3 + e] === '1') e++;
        const key = c * 4 + e;
        const open = prev.get(key);
        if (open) { open.r1 = r + 1; cur.set(key, open); }
        else { const n: Rect = { c0: c, c1: e, r0: r, r1: r + 1 }; out.push(n); cur.set(key, n); }
        c = e;
      } else c++;
    }
    prev = cur;
  }
  return out;
}

interface NumberOpts {
  bone: number;
  color: THREE.Color;
  /** Optional contrasting under-layer, drawn slightly larger and slightly less proud. */
  outline?: THREE.Color;
  /** Cell size in yards; a digit is three cells wide and five and a bit tall. */
  cell: number;
  /** How far the ink stands off the nominal surface plane. */
  proud: number;
  /**
   * Total stroke depth. Numbers sit on rounded boxes, so a stroke has to be deep enough to still
   * break the surface where the jersey curves away from the plane it was placed on.
   */
  deep: number;
}

const _m4 = new THREE.Matrix4();

/**
 * Weld a jersey number onto a surface. `base` maps digit space — +X reading direction, +Y up,
 * +Z out of the surface toward the reader — into bone space.
 */
function addNumber(rb: RigBuilder, value: number, base: THREE.Matrix4, o: NumberOpts): void {
  const text = String(Math.max(0, Math.round(value)) % 100);
  const cw = o.cell;
  const ch = o.cell * 1.16;
  const gap = cw * 0.52;
  const dw = 3 * cw;
  const total = text.length * dw + (text.length - 1) * gap;
  const ol = cw * 0.30;
  for (let i = 0; i < text.length; i++) {
    const d = text.charCodeAt(i) - 48;
    if (d < 0 || d > 9) continue;
    const ox = -total / 2 + i * (dw + gap) + dw / 2;
    for (const rc of digitRects(d)) {
      const w = (rc.c1 - rc.c0) * cw;
      const h = (rc.r1 - rc.r0) * ch;
      const x = ox + ((rc.c0 + rc.c1) / 2 - 1.5) * cw;
      const y = (2.5 - (rc.r0 + rc.r1) / 2) * ch;
      if (o.outline) {
        _m4.makeTranslation(x, y, o.proud * 0.35 - o.deep / 2).premultiply(base);
        rb.add(slab(w + ol, h + ol, o.deep), _m4, { color: o.outline, bone: o.bone, surf: SURF.TRIM });
      }
      _m4.makeTranslation(x, y, o.proud - o.deep / 2).premultiply(base);
      rb.add(slab(w, h, o.deep), _m4, { color: o.color, bone: o.bone, surf: SURF.TRIM });
    }
  }
}

// ── merge ──────────────────────────────────────────────────────────────────

/**
 * Parts are authored in their own bone's space — a helmet around the head bone, a shin hanging
 * off the knee — and then moved into REST-POSE space here, with the skeleton holding matching
 * bind inverses. That indirection is what buys smooth skinning.
 *
 * Before, the bind inverses were identity (the skeleton was built before any `updateMatrixWorld`,
 * so every bone's world matrix was still identity when three captured them) and the geometry was
 * left in bone space. That works perfectly for one bone at weight 1 and cannot work for two: the
 * shoulder and the elbow map the same authored point to two different places, so any blended
 * vertex gets torn between them. Authoring into rest space makes both bones agree at rest, which
 * is precisely the condition for a weighted average of them to mean anything.
 *
 * It also leaves the merged buffer in a single body-space frame, which is what Stage C's ambient
 * occlusion bake walks.
 */
class RigBuilder {
  private geos: THREE.BufferGeometry[] = [];
  private rest: THREE.Matrix4[];

  constructor(rest: THREE.Matrix4[]) { this.rest = rest; }

  add(geo: THREE.BufferGeometry, m: THREE.Matrix4, o: PartOpts): void {
    geo.applyMatrix4(m);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const n = pos.count;
    const colors = new Float32Array(n * 3);
    const surf = new Float32Array(n * 3);
    const si = new Uint16Array(n * 4);
    const sw = new Float32Array(n * 4);
    const sf = o.surf ?? SURF.JERSEY;
    const j = o.joint;
    for (let i = 0; i < n; i++) {
      colors[i * 3] = o.color.r; colors[i * 3 + 1] = o.color.g; colors[i * 3 + 2] = o.color.b;
      surf[i * 3] = sf.rough; surf[i * 3 + 1] = sf.metal; surf[i * 3 + 2] = sf.rim;
      let w = 0;
      if (j) {
        const t = clamp01((pos.getY(i) - j.y0) / (j.y1 - j.y0));
        w = t * t * (3 - 2 * t);
      }
      si[i * 4] = o.bone; sw[i * 4] = 1 - w;
      if (j) { si[i * 4 + 1] = j.to; sw[i * 4 + 1] = w; }
    }
    geo.applyMatrix4(this.rest[o.bone]);
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('aSurf', new THREE.BufferAttribute(surf, 3));
    geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    this.geos.push(geo);
  }

  merge(): THREE.BufferGeometry {
    const out = mergeGeometries(this.geos);
    for (const g of this.geos) g.dispose();
    this.geos.length = 0;
    return out;
  }
}

/** Minimal geometry merge (avoids pulling in the addons build). */
function mergeGeometries(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let vCount = 0, iCount = 0;
  for (const g of list) {
    vCount += g.attributes.position.count;
    iCount += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(vCount * 3);
  const nor = new Float32Array(vCount * 3);
  const col = new Float32Array(vCount * 3);
  const srf = new Float32Array(vCount * 3);
  const si = new Uint16Array(vCount * 4);
  const sw = new Float32Array(vCount * 4);
  const idx = vCount > 65535 ? new Uint32Array(iCount) : new Uint16Array(iCount);
  let vo = 0, io = 0;
  for (const g of list) {
    const p = g.attributes.position as THREE.BufferAttribute;
    const nAttr = g.attributes.normal as THREE.BufferAttribute;
    const c = g.attributes.color as THREE.BufferAttribute;
    const sf = g.attributes.aSurf as THREE.BufferAttribute;
    const s = g.attributes.skinIndex as THREE.BufferAttribute;
    const wgt = g.attributes.skinWeight as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      pos[(vo + i) * 3] = p.getX(i); pos[(vo + i) * 3 + 1] = p.getY(i); pos[(vo + i) * 3 + 2] = p.getZ(i);
      nor[(vo + i) * 3] = nAttr.getX(i); nor[(vo + i) * 3 + 1] = nAttr.getY(i); nor[(vo + i) * 3 + 2] = nAttr.getZ(i);
      col[(vo + i) * 3] = c.getX(i); col[(vo + i) * 3 + 1] = c.getY(i); col[(vo + i) * 3 + 2] = c.getZ(i);
      srf[(vo + i) * 3] = sf.getX(i); srf[(vo + i) * 3 + 1] = sf.getY(i); srf[(vo + i) * 3 + 2] = sf.getZ(i);
      // All four influences, not just the first. This copied component 0 only, which was
      // invisible while every vertex was bound to one bone at weight 1 and would have silently
      // collapsed every blended vertex to the origin the moment a second weight existed. It is
      // the reason smooth skinning could not simply be switched on.
      si[(vo + i) * 4] = s.getX(i); sw[(vo + i) * 4] = wgt.getX(i);
      si[(vo + i) * 4 + 1] = s.getY(i); sw[(vo + i) * 4 + 1] = wgt.getY(i);
      si[(vo + i) * 4 + 2] = s.getZ(i); sw[(vo + i) * 4 + 2] = wgt.getZ(i);
      si[(vo + i) * 4 + 3] = s.getW(i); sw[(vo + i) * 4 + 3] = wgt.getW(i);
    }
    if (g.index) { for (let i = 0; i < g.index.count; i++) idx[io + i] = g.index.getX(i) + vo; io += g.index.count; }
    else { for (let i = 0; i < p.count; i++) idx[io + i] = i + vo; io += p.count; }
    vo += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setAttribute('aSurf', new THREE.BufferAttribute(srf, 3));
  out.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  out.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

const B = Object.fromEntries(BONE_NAMES.map((n, i) => [n, i])) as Record<BoneName, number>;

/** Two endpoints and a radius, in rest-body space. */
type Capsule = readonly [ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number];

/**
 * Bake ambient occlusion into the vertex colours the mesh already carries.
 *
 * The athletes had no contact shadows anywhere: nothing in the armpit, nothing under the shoulder
 * pads, nothing beneath the chin, nothing between the legs. Every form was lit identically, so
 * the parts sat NEAR each other instead of joining, which is most of what made a body read as a
 * bag of separate plastic pieces.
 *
 * This costs nothing at runtime and nothing in bandwidth: there is no new attribute, no shader
 * change and no extra draw call, because the darkening is multiplied straight into `color` at
 * build time. About 5 500 vertices against 15 capsules per athlete, fourteen athletes — under a
 * million distance tests at match load, which is a couple of milliseconds.
 *
 * The occluders are capsules laid along the bones rather than the real geometry. That is not a
 * shortcut for its own sake: a proxy narrower than the limb it stands for leaves every convex
 * surface point outside it and facing away, so convex surfaces stay bright and only genuine
 * concavities — the places two proxies overlap — go dark. Ray-tracing the actual triangles would
 * cost a thousand times more and mostly reproduce this.
 */
function bakeAO(geo: THREE.BufferGeometry, caps: readonly Capsule[], gain: number, floor: number): void {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const nor = geo.attributes.normal as THREE.BufferAttribute;
  const col = geo.attributes.color as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
    const nx = nor.getX(i), ny = nor.getY(i), nz = nor.getZ(i);
    let occ = 0;
    for (const c of caps) {
      const ex = c[3] - c[0], ey = c[4] - c[1], ez = c[5] - c[2];
      const ee = ex * ex + ey * ey + ez * ez;
      const t = ee > 1e-9
        ? clamp01(((px - c[0]) * ex + (py - c[1]) * ey + (pz - c[2]) * ez) / ee)
        : 0;
      const dx = px - (c[0] + ex * t), dy = py - (c[1] + ey * t), dz = pz - (c[2] + ez * t);
      const len = Math.hypot(dx, dy, dz);
      if (len < 1e-5) continue;
      // Negative dot means the surface is turned TOWARD the proxy — the definition of sitting in
      // a pocket. Anything facing away from an occluder is simply not occluded by it.
      const facing = -(nx * dx + ny * dy + nz * dz) / len;
      if (facing <= 0) continue;
      const k = c[6] / (c[6] + len);
      occ += facing * k * k;
    }
    const light = clamp(1 - gain * occ, floor, 1);
    col.setXYZ(i, col.getX(i) * light, col.getY(i) * light, col.getZ(i) * light);
  }
}

/**
 * Rim colour is shared by every athlete in the match so a single assignment retunes all of them
 * when the sky changes. Set by the renderer from the venue palette.
 */
export const rimUniforms: RimUniforms = makeRimUniforms(new THREE.Color('#8fb8ff'), 0.5, 2.6);

/**
 * The Overdrive shell. A plain additive sphere reads as a bubble; this is an upright teardrop
 * with a few soft vertical lobes, wide at the hips and drawn to a point above the helmet, so it
 * reads as something rising off the athlete. Shaped in the geometry rather than the transform
 * because the pose scales the aura uniformly every frame.
 */
function buildAura(height: number, seg: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, seg * 2, seg + 3);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const half = height * 0.56;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const t = clamp01((y + 1) * 0.5);           // 0 at the feet, 1 overhead
    const az = Math.atan2(z, x);
    // Fat through the body, drawn to a point above the helmet, still broad at the base.
    let r = 0.88 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.60)), 0.7);
    r *= 1 + 0.14 * Math.sin(az * 5 + t * 6.0) * (0.25 + t);
    const hor = Math.hypot(x, z) || 1e-6;
    pos.setXYZ(i, (x / hor) * r, y * half * (1 + 0.10 * t), (z / hor) * r);
  }
  g.computeVertexNormals();
  return g;
}

export function buildAthleteRig(
  reg: SceneRegistry, def: PlayerDef, colors: TeamColors, quality: QualitySettings, away: boolean,
): AthleteRig {
  const detail = quality.athleteDetail;
  const HI = detail > 0.85;
  const MED = detail > 0.5;
  const seg = HI ? 4 : MED ? 2 : 1;
  // Sides around a lofted limb. Eight is where a bare arm stops showing facets at the distance
  // the gameplay camera actually sits; five still reads round in a 56-pixel athlete on a phone.
  const sides = HI ? 8 : MED ? 6 : 4;
  /** A trunk needs more than a limb does — at eight sides a chest is visibly a stop sign. */
  const trunkSides = HI ? 16 : MED ? 12 : 8;

  const build = clamp01(def.build);
  // `build` drove one uniform `bulk`, which made a lineman a receiver at 130% — bigger, never a
  // different shape. It is four independent axes now, because those are the things that actually
  // differ between a corner and a tackle:
  //
  //   mass    how thick the limbs are
  //   wide    breadth across the trunk
  //   deep    …front to back, which grows FASTER: a lineman is a barrel, not a wide receiver
  //   waistK  the waist as a fraction of the chest — the V, and the loudest of the four
  //   limbK   long-limbed sprinter against short-limbed, low-slung tackle
  //
  // `BUILD_RANGE` in src/data/names.ts already separates a corner (0.14–0.32) from a tackle
  // (0.82–1.00). No new data was needed; the number was simply never being asked for more than
  // one thing.
  const mass = lerp(0.84, 1.34, build);
  const wide = lerp(0.90, 1.24, build);
  const deep = lerp(0.82, 1.46, build);
  const waistK = lerp(0.75, 1.00, build);
  const limbK = lerp(1.050, 0.955, build);
  const S = statureOf(build, def.ratings.power);
  const height = S;

  // Every dimension below that is not driven by build comes out of this stream.
  const v = new Variation(hashStr(`${def.name}|${def.number}|${def.pos}|${def.tone}`));
  const neckT = v.range(0.80, 1.34) * lerp(0.94, 1.14, build);
  const gut = clamp01(build * 0.65 + v.range(-0.20, 0.45));
  const padW = v.range(0.93, 1.13);
  const armT = v.range(0.90, 1.14);
  const legT = v.range(0.90, 1.14);
  const sleeve = def.flair === 4 ? 1 : v.range(0.24, 0.88);
  const sockHi = def.flair === 5 ? 0.98 : v.range(0.26, 0.86);
  const towel = def.flair === 1 || v.chance(0.22);
  const armBand = def.flair === 2 || v.chance(0.32);
  const wristTape = v.chance(0.45);
  const kneePads = v.chance(0.72);
  const gloveKind = (v.unit() * 4) | 0;
  const shoeKind = (v.unit() * 3) | 0;
  const sockKind = (v.unit() * 3) | 0;
  const maskFlip = v.chance(0.35);

  const jersey = new THREE.Color(away ? colors.secondary : colors.primary);
  const jerseyPad = jersey.clone().multiplyScalar(1.09);
  const deltoidC = jersey.clone().multiplyScalar(0.90);
  const pants = new THREE.Color(away ? colors.primary : colors.secondary).multiplyScalar(0.92);
  const pantsLit = pants.clone().multiplyScalar(1.16);
  const accent = new THREE.Color(colors.accent);
  // Away helmets pick up the strip colour so the two teams differ from the shoulders up too.
  const helmet = new THREE.Color(away ? colors.secondary : colors.primary).multiplyScalar(away ? 0.92 : 1.05);
  // A helmet the same value as the shirt fuses head and shoulder pads into one blob from behind,
  // which is the view the game spends most of its time in. Push them apart when they collide.
  if (Math.abs(luma(helmet) - luma(jersey)) < 0.10) helmet.multiplyScalar(luma(jersey) > 0.5 ? 0.70 : 1.45);
  const skin = skinColor(def.tone);
  const dark = new THREE.Color('#171a20');
  const bone = new THREE.Color('#eef1f6');
  const ink = new THREE.Color(colors.ink);
  const num = readable(jersey, ink);
  const numOut = HI ? readable(num, accent, 0.20) : undefined;
  const beltC = readable(pants, dark, 0.16);
  const sockC = [ink, bone, accent][sockKind];
  const shoeC = [dark, accent, bone][shoeKind];
  const gloveC = [dark, accent, ink, skin][gloveKind];
  const gloveS = gloveKind === 3 ? SURF.SKIN : SURF.LEATHER;
  const maskC = maskFlip ? readable(helmet, accent, 0.22) : dark;
  const stripeC = readable(helmet, accent, 0.16);

  const M = new THREE.Matrix4();
  const place = (x: number, y: number, z: number): THREE.Matrix4 => M.makeTranslation(x, y, z);
  const rot = (x: number, y: number, z: number, rx: number, ry: number, rz: number): THREE.Matrix4 => {
    M.makeRotationFromEuler(new THREE.Euler(rx, ry, rz));
    M.setPosition(x, y, z);
    return M;
  };

  // ── proportions (yards) ──
  //
  // Landmarks are world heights; the geometry below is authored in bone space, so each block
  // carries the landmark it sits on minus the bone it hangs from. Writing it that way is what
  // makes the figure the height it claims: there is nowhere left for an unaccounted riser to hide.
  const hipY = PROP.hip * limbK * S;
  const chestY = PROP.chest * S;
  const shoulderY = PROP.shoulder * S;
  const neckY = PROP.neck * S;
  const headY = PROP.head * S;
  const shoulderW = PROP.shoulderX * S * lerp(0.94, 1.14, build);
  const torsoW = 0.235 * S * wide;
  const torsoD = 0.150 * S * deep;
  const hipW = 0.215 * S * wide;
  const hipD = 0.152 * S * deep;
  // The pads are the widest thing on the athlete and they are NOT the shoulder joint: the bone
  // sits where the arm actually pivots and the shell hangs well outboard of it. Conflating the
  // two is how the old rig ended up with shoulder joints thirty-four inches apart.
  const padHalf = shoulderW * 1.46 * padW;
  const padSpan = padHalf * 2;
  // The ankle lands at the sole thickness, so a standing athlete's cleat rests exactly on the
  // turf — which is also the height `athletePose` drops the pelvis onto.
  const thighLen = (PROP.hip - PROP.knee) * limbK * S;
  const shinLen = PROP.knee * limbK * S - SHOE.drop;

  // ── skeleton ──
  //
  // Built before a single triangle, because the geometry is authored in bone space and then
  // moved into rest space by the builder, and the bind inverses have to be captured from the
  // same rest pose. Every offset below is a landmark minus its parent's landmark; nothing is a
  // tuned constant, so there is no riser left over to make an athlete taller than his stature.
  const bones: Partial<Record<BoneName, THREE.Bone>> = {};
  for (const n of BONE_NAMES) { const b = new THREE.Bone(); b.name = n; bones[n] = b; }
  const bb = bones as Record<BoneName, THREE.Bone>;
  bb.root.add(bb.hips); bb.hips.position.set(0, hipY, 0);
  bb.hips.add(bb.chest); bb.chest.position.set(0, chestY - hipY, 0);
  bb.chest.add(bb.neck); bb.neck.position.set(0, neckY - chestY, 0);
  bb.neck.add(bb.head); bb.head.position.set(0, headY - neckY, 0);
  const hipHalf = PROP.hipX * S * lerp(0.94, 1.16, build);
  for (const side of [-1, 1]) {
    const SB = side < 0 ? bb.shoulderL : bb.shoulderR;
    const EB = side < 0 ? bb.elbowL : bb.elbowR;
    const HB = side < 0 ? bb.handL : bb.handR;
    bb.chest.add(SB); SB.position.set(side * shoulderW, shoulderY - chestY, 0);
    SB.add(EB); EB.position.set(0, -PROP.upperArm * S * limbK, 0);
    EB.add(HB); HB.position.set(0, -PROP.foreArm * S * limbK, 0);
    const T = side < 0 ? bb.thighL : bb.thighR;
    const K = side < 0 ? bb.kneeL : bb.kneeR;
    const F = side < 0 ? bb.footL : bb.footR;
    // The hips bone IS the hip joint line, so the thigh hangs off it with no vertical offset:
    // the legs swing about the point they swing about on a person, and the pelvic list rolls
    // about the midpoint between the two joints rather than about a belt buckle.
    bb.hips.add(T); T.position.set(side * hipHalf, 0, 0);
    T.add(K); K.position.set(0, -thighLen, 0);
    K.add(F); F.position.set(0, -shinLen, 0);
  }
  const boneList = BONE_NAMES.map((n) => bb[n]);
  bb.root.updateMatrixWorld(true);
  const rest = boneList.map((b) => b.matrixWorld.clone());
  const skeleton = new THREE.Skeleton(boneList);

  const rb = new RigBuilder(rest);
  const upperArm = PROP.upperArm * S * limbK;
  const foreArm = PROP.foreArm * S * limbK;
  // How wide a band each joint blends over. Wider reads as rubber, narrower as a hinge; a
  // sixth of the shorter of the two segments is about where a padded elbow stops creasing.
  const blend = 0.030 * S;
  // Limb radii. Hoisted out of the two side loops because the ambient-occlusion bake below needs
  // the same numbers to size its capsule proxies, and a proxy that disagrees with the limb it
  // stands for puts the shadows in the wrong places.
  const ar = 0.037 * S * mass * armT;
  const fr = 0.031 * S * mass * armT;
  const tw = 0.100 * S * mass * legT;
  const sw = 0.076 * S * mass * legT;
  const tr = tw * 0.50;
  const sr = sw * 0.50;

  // Limb profiles, named because the trim that wraps them has to sample the same rings. Sleeve
  // length is the cheapest per-athlete tell there is: cut-off to full compression. The deltoid
  // cap and the sleeve used to be two parts with a seam between them; they are one garment, so
  // they are one loft that runs from the shoulder to wherever this athlete's sleeve ends.
  const slT = Math.max(0.30, (0.018 * S + 0.150 * S * sleeve) / upperArm);
  const sleeved = sleeve > 0.93;
  const ARM: Ring[] = [
    [-0.02, ar * 1.10, ar * 1.06], [0.16, ar * 1.32, ar * 1.26], [0.46, ar * 1.00, ar * 1.06],
    [0.76, ar * 0.86, ar * 0.94], [1.04, ar * 0.82, ar * 0.86],
  ];
  const SLEEVE: Ring[] = [
    [-0.06, ar * 1.16, ar * 1.12], [0.16, ar * 1.42, ar * 1.36],
    [slT * 0.62, ar * 1.14, ar * 1.16], [slT, ar * 1.04, ar * 1.08],
  ];
  const FORE: Ring[] = [
    [-0.10, fr * 0.98, fr * 1.02], [0.20, fr * 1.20, fr * 1.24],
    [0.60, fr * 0.92, fr * 0.96], [1.02, fr * 0.70, fr * 0.76],
  ];
  const THIGH: Ring[] = [
    [-0.08, tr * 1.02, tr * 1.06], [0.18, tr * 1.18, tr * 1.14], [0.55, tr * 1.00, tr * 1.02],
    [0.86, tr * 0.80, tr * 0.86], [1.06, tr * 0.72, tr * 0.80],
  ];
  const SHIN: Ring[] = [
    [-0.06, sr * 0.94, sr * 0.98], [0.08, sr * 1.00, sr * 1.06, -sr * 0.06],
    [0.30, sr * 1.10, sr * 1.20, -sr * 0.18], [0.64, sr * 0.80, sr * 0.88, -sr * 0.08],
    [1.02, sr * 0.56, sr * 0.64],
  ];

  // ── hips / pants ──
  // The hips BONE is the hip joint, not the belt: it is the axis the legs swing about and the
  // axis the pelvis lists around, so the pelvis mass is drawn above it rather than around it.
  rb.add(chunk(hipW, 0.126 * S, hipD, seg), place(0, 0.026 * S, 0), { color: pants, bone: B.hips, surf: SURF.PANTS });
  rb.add(slab(hipW * 1.035, 0.026 * S, hipD * 1.04), place(0, 0.081 * S, 0), { color: beltC, bone: B.hips, surf: SURF.TRIM });
  if (MED) {
    rb.add(slab(0.048 * S, 0.019 * S, 0.014 * S), place(0, 0.081 * S, hipD * 0.53),
      { color: accent, bone: B.hips, surf: SURF.METAL });
    if (towel) {
      rb.add(slab(0.055 * S, 0.100 * S, 0.013 * S), place(hipW * 0.34, -0.020 * S, hipD * 0.51),
        { color: bone, bone: B.hips, surf: SURF.MATTE });
      rb.add(slab(0.055 * S, 0.024 * S, 0.015 * S), place(hipW * 0.34, 0.036 * S, hipD * 0.51),
        { color: accent, bone: B.hips, surf: SURF.TRIM });
    }
  }

  // ── torso ──
  // Gut and chest are separate masses so build actually changes the profile rather than just
  // scaling one box: a heavy athlete gets a belly that hangs over the belt.
  // The gut only bulges forward and sideways: its back face stays flush with the chest so the
  // back number has one continuous plane to sit on whatever the athlete's build.
  // Broad through the chest, cut in at the waist, flaring back onto the hips — the V. It was two
  // rounded boxes stacked, which is why `build` could make an athlete bigger but never a
  // different shape: a box has one width and it has it everywhere.
  //
  // Lofted top-down so the rings stay in sweep order, then dropped onto the shoulder line.
  const tw2 = torsoW * 0.5, td2 = torsoD * 0.5;
  const gutK = 0.94 + gut * 0.32;
  const gutZ = td2 * gut * 0.34;
  const trunkTop = 0.182 * S, trunkLen = 0.240 * S;
  rb.add(limb(trunkLen, [
    [0.00, tw2 * 0.99, td2 * 1.00],
    [0.20, tw2 * 1.00, td2 * 1.08],
    [0.52, tw2 * waistK, td2 * 0.92 * gutK, gutZ * 0.7],
    [0.82, tw2 * (waistK + 0.05) * gutK, td2 * 0.96 * gutK, gutZ],
    [1.00, tw2 * (waistK + 0.11) * gutK, td2 * 0.98 * gutK, gutZ * 0.8],
  ], trunkSides), place(0, trunkTop, 0), {
    color: jersey, bone: B.chest, surf: SURF.JERSEY,
    // The waist. Without it the trunk is a solid that pivots out of the pelvis, and a deep lean
    // at sprint opens a gap you can see through.
    joint: { to: B.hips, y0: -0.014 * S, y1: -0.058 * S },
  });

  // Shoulder pads. One slab reads as a plank, so this is two arched halves with a neck gap
  // between them, a drooping epaulette on each end, and a shadow line along the pad's lower lip.
  // The gap matters twice over: it is what makes the pads read as armour worn over a shirt, and
  // it keeps every horizontal pad edge clear of the helmet, which a full-width slab is not.
  const yokeX = padSpan * 0.32;
  const yokeW = padSpan * 0.38;
  const padSegW = HI ? 12 : MED ? 9 : 6;
  const padSegH = HI ? 8 : MED ? 6 : 4;
  const epX = padHalf * 0.78;
  for (const side of [-1, 1]) {
    // Each half is a dome that slopes away from the neck. A pad that is level across is a plank;
    // the arch is most of what says "shoulder pad" from behind, which is the view the game
    // mostly gives. The gap between the halves is what lets a neck exist.
    rb.add(blob(yokeW * 0.52, 0.036 * S, torsoD * 0.56, padSegW, padSegH),
      rot(side * yokeX, 0.158 * S, 0, 0, 0, -side * 0.20), { color: jerseyPad, bone: B.chest, surf: SURF.JERSEY });
    const ex = side * epX;
    const tilt = -side * 0.42;
    rb.add(blob(0.034 * S * mass, 0.024 * S, torsoD * 0.50, padSegW, padSegH), rot(ex, 0.150 * S, 0, 0, 0, tilt),
      { color: jerseyPad, bone: B.chest, surf: SURF.JERSEY });
    // A narrow band over the shoulder, not a full-footprint plate: from a camera looking down
    // the top face of an epaulette is a big target and a bright one swallows the whole pad.
    rb.add(slab(0.076 * S * mass, 0.011 * S, 0.026 * S), rot(ex, 0.170 * S, torsoD * 0.30, 0, 0, tilt),
      { color: accent, bone: B.chest, surf: SURF.TRIM });
  }
  // Neck roll. Two teams whose helmet and shirt are the same colour otherwise merge into one
  // white mass from the shoulders up; a dark ring at the base of the shell cuts them apart.
  if (MED) {
    const collar = new THREE.TorusGeometry(0.050 * S, 0.016 * S, 3, 12);
    collar.rotateX(-Math.PI / 2);
    rb.add(collar, place(0, 0.181 * S, -0.002 * S), { color: dark, bone: B.chest, surf: SURF.MATTE });
  }

  // Numbers. Back is the big one — most of the game is played looking at somebody's back.
  addNumber(rb, def.number, place(0, 0.100 * S, -torsoD * 0.5).multiply(new THREE.Matrix4().makeRotationY(Math.PI)), {
    bone: B.chest, color: num, outline: numOut, cell: 0.0224 * S, proud: 0.0151 * S, deep: 0.0795 * S,
  });
  if (MED) {
    addNumber(rb, def.number, place(0, 0.112 * S, torsoD * 0.5), {
      bone: B.chest, color: num, outline: numOut, cell: 0.0172 * S, proud: 0.0126 * S, deep: 0.0711 * S,
    });
    for (const side of [-1, 1]) {
      const ry = side * Math.PI * 0.5;
      const m = place(side * (epX + 0.021 * S), 0.170 * S, -0.008 * S)
        .multiply(new THREE.Matrix4().makeRotationY(ry))
        .multiply(new THREE.Matrix4().makeRotationX(-0.85));
      addNumber(rb, def.number, m, {
        bone: B.chest, color: num, cell: 0.0109 * S, proud: 0.0117 * S, deep: 0.0837 * S,
      });
    }
  }

  // ── neck + helmet ──
  // There is a neck now. The old rig put the pad shell above the chin, so the helmet sat straight
  // on the shoulders and the head read as bolted on rather than carried.
  rb.add(chunk(0.070 * S * neckT * mass, 0.070 * S, 0.070 * S * neckT * mass, seg), place(0, -0.005 * S, 0),
    { color: skin, bone: B.neck, surf: SURF.SKIN, joint: { to: B.chest, y0: -0.012 * S, y1: -0.040 * S } });

  // Every helmet part below is authored in one block the numbers in this file were tuned with:
  // the painted shell runs from y = -0.1835 at the jaw to y = +0.3335 at the crown, 0.5170 of
  // block. `hm` scales that whole space to the six-heads unit and re-anchors it on the head bone,
  // so the jaw, the occipital flare, the stripes, the earholes and every facemask bar keep the
  // proportion they were tuned in and only the size changes.
  //
  // The head unit is the SHELL — crown to jaw. The raised centre stripe rides an inch above it
  // and the mask cage hangs below, exactly as they do on a real helmet, and neither counts
  // toward how tall the man is.
  const headH = (PROP.crown - PROP.chin) * S;
  const hs = headH / 0.5170;
  const hAnchor = (PROP.crown - PROP.head) * S - 0.3335 * hs;
  const hm = (x: number, y: number, z: number): THREE.Matrix4 => {
    M.makeScale(hs, hs, hs);
    M.setPosition(x * hs, y * hs + hAnchor, z * hs);
    return M;
  };

  const domeW = HI ? 22 : MED ? 14 : 9;
  const domeH = HI ? 15 : MED ? 10 : 7;
  const headGeo = new THREE.SphereGeometry(0.275, domeW, domeH);
  headGeo.scale(1.09, 0.94, 1.20);
  rb.add(headGeo, hm(0, 0.075, 0.005), { color: helmet, bone: B.head, surf: SURF.HELMET });
  // Jaw mass. Without it the helmet is a ball; with it there is a chin, and the mask has
  // something to hang off.
  rb.add(chunk(0.31, 0.20, 0.30, seg), hm(0, -0.075, 0.10), { color: helmet, bone: B.head, surf: SURF.HELMET });
  // Occipital shell — the flare at the back that covers the base of the skull. A pure ellipsoid
  // reads as an egg from behind, which is the view the game gives most.
  rb.add(chunk(0.29, 0.20, 0.17, seg), hm(0, -0.035, -0.27), { color: helmet, bone: B.head, surf: SURF.HELMET });
  // Crown stripes follow the shell instead of being a box buried inside it. Three of them,
  // because one thin line on a pale dome disappears into the specular.
  const stripe = crownArc(0.275, 0.042, HI ? 12 : 7);
  stripe.scale(1.11, 0.97, 1.22);
  rb.add(stripe, hm(0, 0.075, 0.005), { color: stripeC, bone: B.head, surf: SURF.TRIM });
  if (MED) {
    for (const side of [-1, 1]) {
      const flank = crownArc(0.275, 0.017, HI ? 10 : 6);
      flank.scale(1.11 * 0.955, 0.97 * 0.955, 1.22 * 0.955);
      rb.add(flank, hm(side * 0.085, 0.075, 0.005), { color: readable(stripeC, ink, 0.14), bone: B.head, surf: SURF.TRIM });
    }
    for (const side of [-1, 1]) {
      const ear = new THREE.CylinderGeometry(0.078, 0.078, 0.05, 6, 1);
      ear.rotateZ(Math.PI / 2);
      rb.add(ear, hm(side * 0.285, -0.04, 0.01), { color: dark, bone: B.head, surf: SURF.MATTE });
    }
  }

  // Facemask. Wrapped bars plus uprights: the silhouette of a cage is the single strongest cue
  // that a rounded box is a football helmet, and it is the one detail a defender shows the
  // camera all play. Arc length is kept short — a mask that wraps past the ears reads as a cage
  // over the whole head.
  const tube = 0.027;
  const arcSeg = HI ? 7 : MED ? 6 : 5;
  const maskOpts = { color: maskC, bone: B.head, surf: SURF.METAL };
  rb.add(frontArc(0.315, tube, 1.48, arcSeg), hm(0, -0.06, 0.035), maskOpts);
  if (MED) {
    rb.add(frontArc(0.305, tube, 1.34, arcSeg), hm(0, 0.055, 0.035), maskOpts);
    rb.add(bar(0.31, tube, 4), hm(0, -0.055, 0.342), maskOpts);
    for (const side of [-1, 1]) {
      rb.add(slab(0.042, 0.042, 0.20), hm(side * 0.225, -0.005, 0.185), maskOpts);
    }
  } else {
    rb.add(bar(0.25, tube, 4), hm(0, -0.055, 0.342), maskOpts);
  }
  if (HI) {
    rb.add(frontArc(0.295, tube, 1.36, arcSeg), hm(0, -0.165, 0.035), maskOpts);
    for (const side of [-1, 1]) {
      rb.add(bar(0.27, tube, 4), hm(side * 0.135, -0.06, 0.318), maskOpts);
      rb.add(slab(0.030, 0.11, 0.030), hm(side * 0.255, -0.15, 0.075), { color: bone, bone: B.head, surf: SURF.TRIM });
    }
  }
  if (def.flair === 3) {
    const visor = new THREE.SphereGeometry(0.275, MED ? 12 : 8, MED ? 7 : 5, 0, Math.PI, 0.62, 0.62);
    visor.scale(1.06, 1.0, 1.12);
    rb.add(visor, hm(0, 0.07, 0.01), { color: dark, bone: B.head, surf: SURF.VISOR });
  }

  // ── arms ──
  for (const side of [-1, 1]) {
    const bS = side < 0 ? B.shoulderL : B.shoulderR;
    const bE = side < 0 ? B.elbowL : B.elbowR;
    const bH = side < 0 ? B.handL : B.handR;

    // The bare arm, lofted: deltoid swell high, tricep behind it, taper into the elbow. Its
    // bottom fifth is skinned into the elbow bone so the joint bends as one surface.
    rb.add(limb(upperArm, ARM, sides), place(0, 0, 0), {
      color: skin, bone: bS, surf: SURF.SKIN,
      joint: { to: bE, y0: -upperArm + blend, y1: -upperArm - blend },
    });
    rb.add(limb(upperArm, SLEEVE, sides), place(0, 0, 0), {
      color: deltoidC, bone: bS, surf: SURF.JERSEY,
      joint: { to: bE, y0: -upperArm + blend, y1: -upperArm - blend },
    });
    if (MED) {
      rb.add(band(upperArm, SLEEVE, slT - 0.035, 0.07, 1.06, sides), place(0, 0, 0),
        { color: accent, bone: bS, surf: SURF.TRIM });
      if (armBand) {
        rb.add(band(upperArm, ARM, 0.87, 0.11, 1.10, sides), place(0, 0, 0),
          { color: accent, bone: bS, surf: SURF.TRIM });
      }
    }

    // Forearm: brachioradialis swell just below the elbow, then a real taper to a wrist.
    rb.add(limb(foreArm, FORE, sides), place(0, 0, 0), {
      color: sleeved ? jersey : skin, bone: bE, surf: sleeved ? SURF.JERSEY : SURF.SKIN,
      joint: { to: bS, y0: -blend, y1: blend },
    });
    if (MED && wristTape) {
      rb.add(band(foreArm, FORE, 0.88, 0.17, 1.13, sides), place(0, 0, 0),
        { color: bone, bone: bE, surf: SURF.MATTE });
    }

    // Oversized hands read as gloves at arcade scale.
    rb.add(chunk(0.072 * S, 0.078 * S, 0.055 * S, seg), place(0, -0.036 * S, 0.007 * S),
      { color: gloveC, bone: bH, surf: gloveS });
    if (MED) {
      rb.add(slab(0.077 * S, 0.019 * S, 0.060 * S), place(0, 0.005 * S, 0.007 * S),
        { color: accent, bone: bH, surf: SURF.TRIM });
    }
  }

  // ── legs ──
  for (const side of [-1, 1]) {
    const bT = side < 0 ? B.thighL : B.thighR;
    const bK = side < 0 ? B.kneeL : B.kneeR;
    const bF = side < 0 ? B.footL : B.footR;

    // The quad sweeps wide and high and the leg narrows into the knee — the single most
    // recognisable line on a sprinter, and one a constant-width box cannot draw at any
    // segment count.
    rb.add(limb(thighLen, THIGH, sides), place(0, 0, 0), {
      color: pants, bone: bT, surf: SURF.PANTS,
      joint: { to: bK, y0: -thighLen + blend, y1: -thighLen - blend },
    });
    if (MED) {
      // Thigh pads sit under the pant, so they are the pant colour lifted a stop, not a new one.
      rb.add(chunk(tw * 0.62, thighLen * 0.56, 0.042 * S, 1), place(0, -thighLen * 0.42, tw * 0.44),
        { color: pantsLit, bone: bT, surf: SURF.PANTS });
      rb.add(slab(0.015 * S, thighLen * 0.62, 0.030 * S), place(side * tr * 1.02, -thighLen * 0.36, 0),
        { color: accent, bone: bT, surf: SURF.TRIM });
      if (kneePads) {
        rb.add(chunk(tw * 0.56, 0.055 * S, 0.042 * S, 1), place(0, -thighLen - 0.004 * S, tw * 0.30),
          { color: pantsLit, bone: bT, surf: SURF.PANTS });
      }
    }

    // Calf belly: fat, high, and sitting BEHIND the shin's axis, which is the whole reason the
    // ring carries a centre offset. Then a hard taper into an actual ankle.
    rb.add(limb(shinLen, SHIN, sides), place(0, 0, 0), {
      color: skin, bone: bK, surf: SURF.SKIN,
      joint: { to: bT, y0: -blend, y1: blend },
    });
    // The sock is the same leg with a tube pulled over it, so its radii are sampled off the
    // shin's taper rather than authored separately — a cut-off sock and a knee-high one then
    // hug the same calf instead of needing two different ring orders to stay in sequence.
    const sockTop = clamp(1.02 - sockHi, -0.04, 0.72);
    const sockRing = (t: number, k: number): Ring => {
      const r = ringAt(SHIN, t);
      return [t, r[0] * k, r[1] * k, r[2]];
    };
    rb.add(limb(shinLen, [
      sockRing(sockTop, 1.09), sockRing((sockTop + 1.02) * 0.5, 1.07), sockRing(1.02, 1.10),
    ], sides), place(0, 0, 0), { color: sockC, bone: bK, surf: SURF.JERSEY });
    if (MED) {
      rb.add(band(shinLen, SHIN, sockTop + 0.03, 0.06, 1.16, sides), place(0, 0, 0),
        { color: accent, bone: bK, surf: SURF.TRIM });
    }

    // Cleats: a dark upper on a proud sole. The sole is what separates a foot from the turf at
    // distance, and the toe cap is what stops it reading as a brick.
    //
    // Only the WIDTH moved with the rest of this pass. Length and sole height are `SHOE`, and
    // `athletePose` measures its contact reference off the toe — the fixed point that took foot
    // slip from 6.86 yd/s to 1.16 — so those two numbers are load-bearing and stay put. The
    // width never was: at 0.245 the shoe was eight and a half inches across, twice a real cleat,
    // and once the athlete stopped being seven feet tall it was the loudest thing on him.
    rb.add(chunk(0.128, 0.105, 0.35, seg), place(0, -0.018, 0.055), { color: shoeC, bone: bF, surf: SURF.CLEAT });
    rb.add(slab(0.142, 0.05, 0.385), place(0, -0.083, 0.06), { color: bone, bone: bF, surf: SURF.CLEAT });
    if (MED) {
      rb.add(slab(0.108, 0.070, 0.055), place(0, -0.015, 0.222), { color: accent, bone: bF, surf: SURF.TRIM });
    }
  }

  const geo = rb.merge();

  // Contact shadows, baked. Proxies sized a little under the limbs they stand for — see bakeAO —
  // laid along the rest skeleton, which is the same frame the merged buffer is already in.
  const cap = (a: BoneName, b: BoneName, r: number): Capsule => {
    const p = rest[B[a]].elements, q = rest[B[b]].elements;
    return [p[12], p[13], p[14], q[12], q[13], q[14], r];
  };
  const headE = rest[B.head].elements;
  bakeAO(geo, [
    cap('hips', 'chest', hipW * 0.40),
    cap('chest', 'neck', torsoW * 0.38),
    // The pad yoke, spanning shoulder to shoulder: this is what puts a shadow under the
    // epaulettes and along the top of both arms.
    cap('shoulderL', 'shoulderR', 0.052 * S),
    cap('neck', 'head', headH * 0.30),
    [headE[12], headE[13], headE[14],
      headE[12], headE[13] + (PROP.crown - PROP.head) * S, headE[14], headH * 0.34],
    cap('shoulderL', 'elbowL', ar * 0.88), cap('shoulderR', 'elbowR', ar * 0.88),
    cap('elbowL', 'handL', fr * 0.88), cap('elbowR', 'handR', fr * 0.88),
    cap('thighL', 'kneeL', tr * 0.88), cap('thighR', 'kneeR', tr * 0.88),
    cap('kneeL', 'footL', sr * 0.88), cap('kneeR', 'footR', sr * 0.88),
  ], 0.95, 0.56);

  reg.track(geo);

  // One physically-shaded material for the whole body; the per-vertex `aSurf` attribute is what
  // lets a helmet and a sleeve behave differently inside a single draw call.
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.8, metalness: 0.0, envMapIntensity: 0.9,
  });
  applySurfaceShader(mat, rimUniforms, true);
  reg.track(mat);

  const mesh = new THREE.SkinnedMesh(geo, mat);
  mesh.castShadow = quality.shadows;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;

  const root = new THREE.Group();
  root.add(bb.root);
  root.add(mesh);
  mesh.bind(skeleton, new THREE.Matrix4());

  // Overdrive aura shell.
  const auraGeo = buildAura(height, MED ? 9 : 6);
  const auraMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(colors.accent), transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide,
  });
  reg.trackAll(auraGeo, auraMat);
  const aura = new THREE.Mesh(auraGeo, auraMat);
  aura.position.y = height * 0.50;
  aura.visible = false;
  root.add(aura);

  return {
    root, mesh, bones: bb, aura, height,
    dispose(): void {
      geo.dispose(); mat.dispose(); auraGeo.dispose(); auraMat.dispose();
      root.removeFromParent();
    },
  };
}

export { clamp01, lerp };
