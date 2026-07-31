import * as THREE from 'three';
import type { PlayerDef, TeamColors } from '../core/types.ts';
import type { SceneRegistry, QualitySettings } from './registry.ts';
import { clamp, clamp01, lerp } from '../core/math.ts';

/**
 * Procedural chunky arcade athletes.
 *
 * Each athlete is ONE SkinnedMesh with rigid (single-bone, weight 1) skinning and vertex colours,
 * so a full 7-on-7 costs ~14 draw calls. Geometry is authored per athlete so build, skin tone and
 * flair actually vary. Built once per match, disposed with the match.
 */

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

interface PartOpts { color: THREE.Color; bone: number; bevel?: number }

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

class RigBuilder {
  private geos: THREE.BufferGeometry[] = [];

  add(geo: THREE.BufferGeometry, m: THREE.Matrix4, o: PartOpts): void {
    geo.applyMatrix4(m);
    const n = geo.attributes.position.count;
    const colors = new Float32Array(n * 3);
    const si = new Uint16Array(n * 4);
    const sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      colors[i * 3] = o.color.r; colors[i * 3 + 1] = o.color.g; colors[i * 3 + 2] = o.color.b;
      si[i * 4] = o.bone; sw[i * 4] = 1;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
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
  const si = new Uint16Array(vCount * 4);
  const sw = new Float32Array(vCount * 4);
  const idx = vCount > 65535 ? new Uint32Array(iCount) : new Uint16Array(iCount);
  let vo = 0, io = 0;
  for (const g of list) {
    const p = g.attributes.position as THREE.BufferAttribute;
    const nAttr = g.attributes.normal as THREE.BufferAttribute;
    const c = g.attributes.color as THREE.BufferAttribute;
    const s = g.attributes.skinIndex as THREE.BufferAttribute;
    const wgt = g.attributes.skinWeight as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      pos[(vo + i) * 3] = p.getX(i); pos[(vo + i) * 3 + 1] = p.getY(i); pos[(vo + i) * 3 + 2] = p.getZ(i);
      nor[(vo + i) * 3] = nAttr.getX(i); nor[(vo + i) * 3 + 1] = nAttr.getY(i); nor[(vo + i) * 3 + 2] = nAttr.getZ(i);
      col[(vo + i) * 3] = c.getX(i); col[(vo + i) * 3 + 1] = c.getY(i); col[(vo + i) * 3 + 2] = c.getZ(i);
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
  out.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  out.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

const B = Object.fromEntries(BONE_NAMES.map((n, i) => [n, i])) as Record<BoneName, number>;

export function buildAthleteRig(
  reg: SceneRegistry, def: PlayerDef, colors: TeamColors, quality: QualitySettings, away: boolean,
): AthleteRig {
  const seg = quality.athleteDetail > 0.6 ? 3 : quality.athleteDetail > 0.35 ? 2 : 1;
  const build = clamp01(def.build);
  const bulk = lerp(0.86, 1.32, build);
  const height = lerp(1.95, 2.14, build * 0.6 + (def.ratings.power / 300));

  const jersey = new THREE.Color(away ? colors.secondary : colors.primary);
  const pants = new THREE.Color(away ? colors.primary : colors.secondary).multiplyScalar(0.92);
  const accent = new THREE.Color(colors.accent);
  // Away helmets pick up the strip colour so the two teams differ from the shoulders up too.
  const helmet = new THREE.Color(away ? colors.secondary : colors.primary).multiplyScalar(away ? 0.92 : 1.05);
  const skin = skinColor(def.tone);
  const dark = new THREE.Color('#171a20');
  const ink = new THREE.Color(colors.ink);

  const rb = new RigBuilder();
  const M = new THREE.Matrix4();
  const place = (x: number, y: number, z: number) => M.makeTranslation(x, y, z);

  // proportions (yards)
  const hipY = height * 0.50;
  const chestY = height * 0.70;
  const headY = height * 0.90;
  const shoulderW = lerp(0.52, 0.72, build) * bulk;

  // hips / pants
  rb.add(chunk(0.62 * bulk, 0.34, 0.42 * bulk, seg), place(0, 0, 0), { color: pants, bone: B.hips });
  // torso + jersey
  rb.add(chunk(0.66 * bulk, 0.62, 0.44 * bulk, seg), place(0, 0.18, 0), { color: jersey, bone: B.chest });
  // shoulder pads — the silhouette maker
  rb.add(chunk(shoulderW * 2.32, 0.30, 0.52 * bulk, seg), place(0, 0.46, 0), { color: jersey, bone: B.chest });
  rb.add(chunk(shoulderW * 2.32 * 0.92, 0.10, 0.54 * bulk, seg), place(0, 0.60, 0), { color: accent, bone: B.chest });
  // chest stripe
  rb.add(chunk(0.30, 0.30, 0.10, 1), place(0, 0.24, 0.22 * bulk), { color: ink, bone: B.chest });

  // neck + helmet
  rb.add(chunk(0.22, 0.14, 0.22, seg), place(0, 0.02, 0), { color: skin, bone: B.neck });
  const headGeo = new THREE.SphereGeometry(0.30, seg * 5 + 5, seg * 4 + 4);
  headGeo.scale(1.06, 1.0, 1.12);
  rb.add(headGeo, place(0, 0.06, 0), { color: helmet, bone: B.head });
  // helmet stripe
  const stripe = new THREE.BoxGeometry(0.085, 0.30, 0.62);
  rb.add(stripe, place(0, 0.22, 0.0), { color: accent, bone: B.head });
  // facemask
  const mask = new THREE.TorusGeometry(0.19, 0.032, 4, 10, Math.PI);
  mask.rotateY(Math.PI / 2); mask.rotateZ(Math.PI / 2);
  rb.add(mask, place(0, -0.02, 0.24), { color: dark, bone: B.head });
  const bar = new THREE.CylinderGeometry(0.028, 0.028, 0.34, 5);
  bar.rotateZ(Math.PI / 2);
  rb.add(bar, place(0, 0.02, 0.30), { color: dark, bone: B.head });
  if (def.flair === 3) {
    const visor = new THREE.SphereGeometry(0.28, 10, 6, 0, Math.PI, 0.6, 0.7);
    rb.add(visor, place(0, 0.08, 0.02), { color: dark, bone: B.head });
  }

  // arms
  for (const side of [-1, 1]) {
    const bS = side < 0 ? B.shoulderL : B.shoulderR;
    const bE = side < 0 ? B.elbowL : B.elbowR;
    const bH = side < 0 ? B.handL : B.handR;
    const sleeve = def.flair === 4 ? jersey : skin;
    rb.add(chunk(0.24 * bulk, 0.44, 0.24 * bulk, seg), place(0, -0.20, 0), { color: sleeve, bone: bS });
    rb.add(chunk(0.21 * bulk, 0.40, 0.21 * bulk, seg), place(0, -0.19, 0), { color: skin, bone: bE });
    // oversized hands
    rb.add(chunk(0.24, 0.24, 0.16, seg), place(0, -0.10, 0.02), { color: def.flair === 2 ? accent : skin, bone: bH });
    if (def.flair === 2) rb.add(chunk(0.24 * bulk, 0.09, 0.24 * bulk, 1), place(0, -0.40, 0), { color: accent, bone: bE });
  }

  // legs
  for (const side of [-1, 1]) {
    const bT = side < 0 ? B.thighL : B.thighR;
    const bK = side < 0 ? B.kneeL : B.kneeR;
    const bF = side < 0 ? B.footL : B.footR;
    rb.add(chunk(0.30 * bulk, 0.48, 0.30 * bulk, seg), place(0, -0.22, 0), { color: pants, bone: bT });
    rb.add(chunk(0.25 * bulk, 0.46, 0.25 * bulk, seg), place(0, -0.21, 0), { color: def.flair === 5 ? ink : skin, bone: bK });
    rb.add(chunk(0.26, 0.13, 0.42, seg), place(0, -0.06, 0.06), { color: dark, bone: bF });
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
  bb.neck.add(bb.head); bb.head.position.set(0, headY - chestY - 0.30, 0);
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
    T.add(K); K.position.set(0, -0.46, 0);
    K.add(F); F.position.set(0, -0.44, 0);
  }

  const boneList = BONE_NAMES.map((n) => bb[n]);
  const skeleton = new THREE.Skeleton(boneList);

  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
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
  const auraGeo = new THREE.SphereGeometry(1.05, 12, 8);
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
