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

interface PartOpts { color: THREE.Color; bone: number; surf?: Surface }

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

class RigBuilder {
  private geos: THREE.BufferGeometry[] = [];

  add(geo: THREE.BufferGeometry, m: THREE.Matrix4, o: PartOpts): void {
    geo.applyMatrix4(m);
    const n = geo.attributes.position.count;
    const colors = new Float32Array(n * 3);
    const surf = new Float32Array(n * 3);
    const si = new Uint16Array(n * 4);
    const sw = new Float32Array(n * 4);
    const sf = o.surf ?? SURF.JERSEY;
    for (let i = 0; i < n; i++) {
      colors[i * 3] = o.color.r; colors[i * 3 + 1] = o.color.g; colors[i * 3 + 2] = o.color.b;
      surf[i * 3] = sf.rough; surf[i * 3 + 1] = sf.metal; surf[i * 3 + 2] = sf.rim;
      si[i * 4] = o.bone; sw[i * 4] = 1;
    }
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
      si[(vo + i) * 4] = s.getX(i); sw[(vo + i) * 4] = wgt.getX(i);
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

  const build = clamp01(def.build);
  const bulk = lerp(0.86, 1.32, build);
  const height = lerp(1.95, 2.14, build * 0.6 + (def.ratings.power / 300));

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

  const rb = new RigBuilder();
  const M = new THREE.Matrix4();
  const place = (x: number, y: number, z: number): THREE.Matrix4 => M.makeTranslation(x, y, z);
  const rot = (x: number, y: number, z: number, rx: number, ry: number, rz: number): THREE.Matrix4 => {
    M.makeRotationFromEuler(new THREE.Euler(rx, ry, rz));
    M.setPosition(x, y, z);
    return M;
  };

  // ── proportions (yards) ──
  const hipY = height * 0.50;
  const chestY = height * 0.70;
  const headY = height * 0.90;
  const shoulderW = lerp(0.44, 0.60, build) * bulk;
  const torsoW = 0.64 * bulk;
  const torsoD = 0.42 * bulk;
  const padSpan = shoulderW * 1.40 * padW;
  // Legs are sized from the hip height so a tall athlete does not stand with his soles buried in
  // the turf and a short one does not hover. The ankle lands 0.18 above the ground.
  const legDrop = hipY - 0.18;
  const thighLen = legDrop * 0.515;
  const shinLen = legDrop * 0.485;

  // ── hips / pants ──
  rb.add(chunk(0.58 * bulk, 0.34, 0.42 * bulk, seg), place(0, 0, 0), { color: pants, bone: B.hips, surf: SURF.PANTS });
  rb.add(slab(0.60 * bulk, 0.085, 0.435 * bulk), place(0, 0.155, 0), { color: beltC, bone: B.hips, surf: SURF.TRIM });
  if (MED) {
    rb.add(slab(0.10, 0.062, 0.03), place(0, 0.155, 0.222 * bulk), { color: accent, bone: B.hips, surf: SURF.METAL });
    if (towel) {
      rb.add(slab(0.115, 0.27, 0.028), place(0.15 * bulk, -0.04, 0.215 * bulk), { color: bone, bone: B.hips, surf: SURF.MATTE });
      rb.add(slab(0.115, 0.05, 0.032), place(0.15 * bulk, 0.075, 0.215 * bulk), { color: accent, bone: B.hips, surf: SURF.TRIM });
    }
  }

  // ── torso ──
  // Gut and chest are separate masses so build actually changes the profile rather than just
  // scaling one box: a heavy athlete gets a belly that hangs over the belt.
  // The gut only bulges forward and sideways: its back face stays flush with the chest so the
  // back number has one continuous plane to sit on whatever the athlete's build.
  const gutD = torsoD * (0.94 + gut * 0.30);
  rb.add(chunk(torsoW * (0.95 + gut * 0.17), 0.34, gutD, seg),
    place(0, -0.10, (gutD - torsoD) * 0.5), { color: jersey, bone: B.chest, surf: SURF.JERSEY });
  rb.add(chunk(torsoW, 0.56, torsoD, seg), place(0, 0.26, 0), { color: jersey, bone: B.chest, surf: SURF.JERSEY });

  // Shoulder pads. One slab reads as a plank, so this is two arched halves with a neck gap
  // between them, a drooping epaulette on each end, and a shadow line along the pad's lower lip.
  // The gap matters twice over: it is what makes the pads read as armour worn over a shirt, and
  // it keeps every horizontal pad edge clear of the helmet, which a full-width slab is not.
  const yokeX = padSpan * 0.30;
  const yokeW = padSpan * 0.40;
  const padLip = jersey.clone().multiplyScalar(0.42);
  const padSegW = HI ? 12 : MED ? 9 : 6;
  const padSegH = HI ? 8 : MED ? 6 : 4;
  for (const side of [-1, 1]) {
    // Each half is a dome that slopes away from the neck. A pad that is level across is a plank;
    // the arch is most of what says "shoulder pad" from behind, which is the view the game
    // mostly gives.
    rb.add(blob(yokeW * 0.52, 0.175, torsoD * 0.56, padSegW, padSegH),
      rot(side * yokeX, 0.49, 0, 0, 0, -side * 0.20), { color: jerseyPad, bone: B.chest, surf: SURF.JERSEY });
    rb.add(slab(yokeW * 0.95, 0.05, torsoD * 1.02), rot(side * yokeX, 0.318, 0, 0, 0, -side * 0.20),
      { color: padLip, bone: B.chest, surf: SURF.MATTE });
    const ex = side * shoulderW * 0.88;
    const tilt = -side * 0.42;
    rb.add(blob(0.20 * bulk, 0.115, torsoD * 0.50, padSegW, padSegH), rot(ex, 0.475, 0, 0, 0, tilt),
      { color: jerseyPad, bone: B.chest, surf: SURF.JERSEY });
    // A narrow band over the shoulder, not a full-footprint plate: from a camera looking down
    // the top face of an epaulette is a big target and a bright one swallows the whole pad.
    rb.add(slab(0.32 * bulk, 0.045, 0.11), rot(ex, 0.565, torsoD * 0.30, 0, 0, tilt),
      { color: accent, bone: B.chest, surf: SURF.TRIM });
  }
  // Neck roll. Two teams whose helmet and shirt are the same colour otherwise merge into one
  // white mass from the shoulders up; a dark ring at the base of the shell cuts them apart.
  if (MED) {
    const collar = new THREE.TorusGeometry(0.245, 0.072, 3, 12);
    collar.rotateX(-Math.PI / 2);
    rb.add(collar, place(0, 0.605, -0.005), { color: dark, bone: B.chest, surf: SURF.MATTE });
  }

  // Numbers. Back is the big one — most of the game is played looking at somebody's back.
  addNumber(rb, def.number, place(0, 0.185, -torsoD * 0.5).multiply(new THREE.Matrix4().makeRotationY(Math.PI)), {
    bone: B.chest, color: num, outline: numOut, cell: 0.0535, proud: 0.036, deep: 0.19,
  });
  if (MED) {
    addNumber(rb, def.number, place(0, 0.225, torsoD * 0.5), {
      bone: B.chest, color: num, outline: numOut, cell: 0.041, proud: 0.030, deep: 0.17,
    });
    for (const side of [-1, 1]) {
      const ry = side * Math.PI * 0.5;
      const m = place(side * (shoulderW * 0.88 + 0.05), 0.565, -0.02)
        .multiply(new THREE.Matrix4().makeRotationY(ry))
        .multiply(new THREE.Matrix4().makeRotationX(-0.85));
      addNumber(rb, def.number, m, {
        bone: B.chest, color: num, cell: 0.026, proud: 0.028, deep: 0.20,
      });
    }
  }

  // ── neck + helmet ──
  rb.add(chunk(0.19 * neckT * bulk, 0.30, 0.19 * neckT * bulk, seg), place(0, 0.10, 0),
    { color: skin, bone: B.neck, surf: SURF.SKIN });

  const domeW = HI ? 22 : MED ? 14 : 9;
  const domeH = HI ? 15 : MED ? 10 : 7;
  const headGeo = new THREE.SphereGeometry(0.275, domeW, domeH);
  headGeo.scale(1.09, 0.94, 1.20);
  rb.add(headGeo, place(0, 0.075, 0.005), { color: helmet, bone: B.head, surf: SURF.HELMET });
  // Jaw mass. Without it the helmet is a ball; with it there is a chin, and the mask has
  // something to hang off.
  rb.add(chunk(0.31, 0.20, 0.30, seg), place(0, -0.075, 0.10), { color: helmet, bone: B.head, surf: SURF.HELMET });
  // Occipital shell — the flare at the back that covers the base of the skull. A pure ellipsoid
  // reads as an egg from behind, which is the view the game gives most.
  rb.add(chunk(0.29, 0.20, 0.17, seg), place(0, -0.035, -0.27), { color: helmet, bone: B.head, surf: SURF.HELMET });
  // Crown stripes follow the shell instead of being a box buried inside it. Three of them,
  // because one thin line on a pale dome disappears into the specular.
  const stripe = crownArc(0.275, 0.042, HI ? 12 : 7);
  stripe.scale(1.11, 0.97, 1.22);
  rb.add(stripe, place(0, 0.075, 0.005), { color: stripeC, bone: B.head, surf: SURF.TRIM });
  if (MED) {
    for (const side of [-1, 1]) {
      const flank = crownArc(0.275, 0.017, HI ? 10 : 6);
      flank.scale(1.11 * 0.955, 0.97 * 0.955, 1.22 * 0.955);
      rb.add(flank, place(side * 0.085, 0.075, 0.005), { color: readable(stripeC, ink, 0.14), bone: B.head, surf: SURF.TRIM });
    }
    for (const side of [-1, 1]) {
      const ear = new THREE.CylinderGeometry(0.078, 0.078, 0.05, 6, 1);
      ear.rotateZ(Math.PI / 2);
      rb.add(ear, place(side * 0.285, -0.04, 0.01), { color: dark, bone: B.head, surf: SURF.MATTE });
    }
  }

  // Facemask. Wrapped bars plus uprights: the silhouette of a cage is the single strongest cue
  // that a rounded box is a football helmet, and it is the one detail a defender shows the
  // camera all play. Arc length is kept short — a mask that wraps past the ears reads as a cage
  // over the whole head.
  const tube = 0.027;
  const arcSeg = HI ? 7 : MED ? 6 : 5;
  const maskOpts = { color: maskC, bone: B.head, surf: SURF.METAL };
  rb.add(frontArc(0.315, tube, 1.48, arcSeg), place(0, -0.06, 0.035), maskOpts);
  if (MED) {
    rb.add(frontArc(0.305, tube, 1.34, arcSeg), place(0, 0.055, 0.035), maskOpts);
    rb.add(bar(0.31, tube, 4), place(0, -0.055, 0.342), maskOpts);
    for (const side of [-1, 1]) {
      rb.add(slab(0.042, 0.042, 0.20), place(side * 0.225, -0.005, 0.185), maskOpts);
    }
  } else {
    rb.add(bar(0.25, tube, 4), place(0, -0.055, 0.342), maskOpts);
  }
  if (HI) {
    rb.add(frontArc(0.295, tube, 1.36, arcSeg), place(0, -0.165, 0.035), maskOpts);
    for (const side of [-1, 1]) {
      rb.add(bar(0.27, tube, 4), place(side * 0.135, -0.06, 0.318), maskOpts);
      rb.add(slab(0.030, 0.11, 0.030), place(side * 0.255, -0.15, 0.075), { color: bone, bone: B.head, surf: SURF.TRIM });
    }
  }
  if (def.flair === 3) {
    const visor = new THREE.SphereGeometry(0.275, MED ? 12 : 8, MED ? 7 : 5, 0, Math.PI, 0.62, 0.62);
    visor.scale(1.06, 1.0, 1.12);
    rb.add(visor, place(0, 0.07, 0.01), { color: dark, bone: B.head, surf: SURF.VISOR });
  }

  // ── arms ──
  for (const side of [-1, 1]) {
    const bS = side < 0 ? B.shoulderL : B.shoulderR;
    const bE = side < 0 ? B.elbowL : B.elbowR;
    const bH = side < 0 ? B.handL : B.handR;
    const aw = 0.235 * bulk * armT;

    // Deltoid cap: the bulge that makes an arm look padded rather than tubular. Held a shade
    // under the shoulder pad above it, or arm and pad merge into one shapeless mass.
    rb.add(chunk(aw * 1.28, 0.22, aw * 1.24, seg), place(0, -0.05, 0),
      { color: deltoidC, bone: bS, surf: SURF.JERSEY });
    rb.add(chunk(aw * 0.96, 0.42, aw * 0.96, seg), place(0, -0.24, 0), { color: skin, bone: bS, surf: SURF.SKIN });
    // Sleeve length is the cheapest per-athlete tell there is: cut-off to full compression.
    const slLen = 0.44 * sleeve;
    rb.add(chunk(aw * 1.03, slLen, aw * 1.03, seg), place(0, -0.05 - slLen * 0.5, 0),
      { color: jersey, bone: bS, surf: SURF.JERSEY });
    if (MED) {
      rb.add(slab(aw * 1.09, 0.045, aw * 1.09), place(0, -0.05 - slLen, 0), { color: accent, bone: bS, surf: SURF.TRIM });
      if (armBand) rb.add(slab(aw * 1.06, 0.07, aw * 1.06), place(0, -0.40, 0), { color: accent, bone: bS, surf: SURF.TRIM });
    }

    const fw = 0.21 * bulk * armT;
    rb.add(chunk(fw, 0.38, fw, seg), place(0, -0.19, 0), {
      color: sleeve > 0.93 ? jersey : skin, bone: bE, surf: sleeve > 0.93 ? SURF.JERSEY : SURF.SKIN,
    });
    if (MED && wristTape) {
      rb.add(slab(fw * 1.12, 0.075, fw * 1.12), place(0, -0.345, 0), { color: bone, bone: bE, surf: SURF.MATTE });
    }

    // Oversized hands read as gloves at arcade scale.
    rb.add(chunk(0.225, 0.23, 0.16, seg), place(0, -0.10, 0.02), { color: gloveC, bone: bH, surf: gloveS });
    if (MED) rb.add(slab(0.24, 0.055, 0.175), place(0, 0.015, 0.02), { color: accent, bone: bH, surf: SURF.TRIM });
  }

  // ── legs ──
  for (const side of [-1, 1]) {
    const bT = side < 0 ? B.thighL : B.thighR;
    const bK = side < 0 ? B.kneeL : B.kneeR;
    const bF = side < 0 ? B.footL : B.footR;
    const tw = 0.30 * bulk * legT;
    const sw = 0.225 * bulk * legT;

    rb.add(chunk(tw, thighLen + 0.08, tw, seg), place(0, -thighLen * 0.5 + 0.02, 0),
      { color: pants, bone: bT, surf: SURF.PANTS });
    if (MED) {
      // Thigh pads sit under the pant, so they are the pant colour lifted a stop, not a new one.
      rb.add(chunk(tw * 0.62, thighLen * 0.56, 0.10, 1), place(0, -thighLen * 0.42, tw * 0.44),
        { color: pantsLit, bone: bT, surf: SURF.PANTS });
      rb.add(slab(0.05, thighLen * 0.94, 0.062), place(side * tw * 0.5, -thighLen * 0.5, 0),
        { color: accent, bone: bT, surf: SURF.TRIM });
      if (kneePads) {
        rb.add(chunk(tw * 0.56, 0.13, 0.10, 1), place(0, -thighLen - 0.01, tw * 0.40),
          { color: pantsLit, bone: bT, surf: SURF.PANTS });
      }
    }

    rb.add(chunk(sw, shinLen + 0.02, sw, seg), place(0, -shinLen * 0.5, 0), { color: skin, bone: bK, surf: SURF.SKIN });
    const sockLen = shinLen * sockHi;
    rb.add(chunk(sw * 1.08, sockLen, sw * 1.08, seg), place(0, -shinLen + sockLen * 0.5, 0),
      { color: sockC, bone: bK, surf: SURF.JERSEY });
    if (MED) {
      rb.add(slab(sw * 1.14, 0.05, sw * 1.14), place(0, -shinLen + sockLen, 0), { color: accent, bone: bK, surf: SURF.TRIM });
    }

    // Cleats: a dark upper on a proud sole. The sole is what separates a foot from the turf at
    // distance, and the toe cap is what stops it reading as a brick.
    rb.add(chunk(0.225, 0.115, 0.35, seg), place(0, -0.015, 0.055), { color: shoeC, bone: bF, surf: SURF.CLEAT });
    rb.add(slab(0.245, 0.05, 0.385), place(0, -0.083, 0.06), { color: bone, bone: bF, surf: SURF.CLEAT });
    if (MED) {
      rb.add(slab(0.185, 0.075, 0.055), place(0, -0.012, 0.222), { color: accent, bone: bF, surf: SURF.TRIM });
    }
  }

  const geo = rb.merge();
  reg.track(geo);

  // ── skeleton ──
  const bones: Partial<Record<BoneName, THREE.Bone>> = {};
  for (const n of BONE_NAMES) { const b = new THREE.Bone(); b.name = n; bones[n] = b; }
  const bb = bones as Record<BoneName, THREE.Bone>;
  bb.root.add(bb.hips); bb.hips.position.set(0, hipY, 0);
  bb.hips.add(bb.chest); bb.chest.position.set(0, chestY - hipY, 0);
  bb.chest.add(bb.neck); bb.neck.position.set(0, 0.36, 0);
  bb.neck.add(bb.head); bb.head.position.set(0, headY - chestY - 0.12, 0);
  for (const side of [-1, 1]) {
    const S = side < 0 ? bb.shoulderL : bb.shoulderR;
    const E = side < 0 ? bb.elbowL : bb.elbowR;
    const H = side < 0 ? bb.handL : bb.handR;
    bb.chest.add(S); S.position.set(side * shoulderW, 0.40, 0);
    S.add(E); E.position.set(0, -0.42, 0);
    E.add(H); H.position.set(0, -0.40, 0);
    const T = side < 0 ? bb.thighL : bb.thighR;
    const K = side < 0 ? bb.kneeL : bb.kneeR;
    const F = side < 0 ? bb.footL : bb.footR;
    bb.hips.add(T); T.position.set(side * 0.19 * bulk, -0.10, 0);
    T.add(K); K.position.set(0, -thighLen, 0);
    K.add(F); F.position.set(0, -shinLen, 0);
  }

  const boneList = BONE_NAMES.map((n) => bb[n]);
  const skeleton = new THREE.Skeleton(boneList);

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
  aura.position.y = height * 0.55;
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
