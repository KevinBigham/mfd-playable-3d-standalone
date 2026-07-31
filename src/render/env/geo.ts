import * as THREE from 'three';

/**
 * Internal geometry kit for the environment layer.
 *
 * Everything the stadium builds funnels through `GeoBatch`, which accumulates raw triangles
 * (position / normal / uv / vertex-colour) and bakes them into ONE BufferGeometry. That is how a
 * whole raked bowl, its concourses, tunnels and trim collapse into a handful of draw calls.
 *
 * Shape language: chunky chamfered boxes. `chamferBox` is the primitive every prop is cut from,
 * so benches, camera tripods, scoreboard housings and light masts all share the same silhouette
 * and catch the same specular edge highlight.
 */

const _n = new THREE.Vector3();
const _e1 = new THREE.Vector3();
const _e2 = new THREE.Vector3();
const _p = new THREE.Vector3();

export interface Vec3Like { x: number; y: number; z: number }

/** Accumulates triangles into a single mergeable geometry. */
export class GeoBatch {
  private pos: number[] = [];
  private nrm: number[] = [];
  private uvs: number[] = [];
  private col: number[] = [];
  /** World yards → uv units for auto-projected faces. */
  uvScale = 0.16;
  private tris = 0;

  get triangles(): number { return this.tris; }

  private autoUv(x: number, y: number, z: number, nx: number, ny: number, nz: number, out: [number, number]): void {
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    if (ay >= ax && ay >= az) { out[0] = x; out[1] = z; }
    else if (ax >= az) { out[0] = z; out[1] = y; }
    else { out[0] = x; out[1] = y; }
    out[0] *= this.uvScale; out[1] *= this.uvScale;
  }

  private vtx(
    x: number, y: number, z: number,
    nx: number, ny: number, nz: number,
    r: number, g: number, b: number,
    u: number, v: number,
  ): void {
    this.pos.push(x, y, z);
    this.nrm.push(nx, ny, nz);
    this.col.push(r, g, b);
    this.uvs.push(u, v);
  }

  /** Triangle with an optional outward hint used to fix winding. */
  addTri(a: Vec3Like, b: Vec3Like, c: Vec3Like, color: THREE.Color, outward?: Vec3Like): void {
    _e1.set(b.x - a.x, b.y - a.y, b.z - a.z);
    _e2.set(c.x - a.x, c.y - a.y, c.z - a.z);
    _n.copy(_e1).cross(_e2);
    if (_n.lengthSq() < 1e-12) return;
    _n.normalize();
    let p0 = a, p2 = c;
    if (outward && (_n.x * outward.x + _n.y * outward.y + _n.z * outward.z) < 0) {
      _n.negate(); p0 = c; p2 = a;
    }
    const uv: [number, number] = [0, 0];
    const pts = [p0, b, p2];
    for (const p of pts) {
      this.autoUv(p.x, p.y, p.z, _n.x, _n.y, _n.z, uv);
      this.vtx(p.x, p.y, p.z, _n.x, _n.y, _n.z, color.r, color.g, color.b, uv[0], uv[1]);
    }
    this.tris++;
  }

  /**
   * Quad p0→p1→p2→p3 (in loop order). `uv` supplies explicit texture coordinates when the
   * surface needs controlled tiling (seat rows, signage bands); otherwise UVs are planar-projected.
   */
  addQuad(
    p0: Vec3Like, p1: Vec3Like, p2: Vec3Like, p3: Vec3Like,
    color: THREE.Color,
    outward?: Vec3Like,
    uv?: [number, number, number, number, number, number, number, number],
  ): void {
    _e1.set(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z);
    _e2.set(p2.x - p0.x, p2.y - p0.y, p2.z - p0.z);
    _n.copy(_e1).cross(_e2);
    if (_n.lengthSq() < 1e-12) return;
    _n.normalize();
    let flip = false;
    if (outward && (_n.x * outward.x + _n.y * outward.y + _n.z * outward.z) < 0) { _n.negate(); flip = true; }

    const order = flip ? [3, 2, 1, 0] : [0, 1, 2, 3];
    const q = [p0, p1, p2, p3];
    const idx = [order[0], order[1], order[2], order[0], order[2], order[3]];
    const tmp: [number, number] = [0, 0];
    for (const i of idx) {
      const p = q[i];
      let u: number, v: number;
      if (uv) { u = uv[i * 2]; v = uv[i * 2 + 1]; }
      else { this.autoUv(p.x, p.y, p.z, _n.x, _n.y, _n.z, tmp); u = tmp[0]; v = tmp[1]; }
      this.vtx(p.x, p.y, p.z, _n.x, _n.y, _n.z, color.r, color.g, color.b, u, v);
    }
    this.tris += 2;
  }

  /** Bake an existing geometry (optionally transformed and tinted) into the batch. */
  addGeometry(geo: THREE.BufferGeometry, matrix: THREE.Matrix4 | null, color: THREE.Color, disposeSource = true): void {
    const src = geo.index ? geo.toNonIndexed() : geo;
    if (matrix) src.applyMatrix4(matrix);
    if (!src.getAttribute('normal')) src.computeVertexNormals();
    const pa = src.getAttribute('position');
    const na = src.getAttribute('normal');
    const ua = src.getAttribute('uv');
    const tmp: [number, number] = [0, 0];
    for (let i = 0; i < pa.count; i++) {
      const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
      const nx = na.getX(i), ny = na.getY(i), nz = na.getZ(i);
      let u: number, v: number;
      if (ua) { u = ua.getX(i); v = ua.getY(i); }
      else { this.autoUv(x, y, z, nx, ny, nz, tmp); u = tmp[0]; v = tmp[1]; }
      this.vtx(x, y, z, nx, ny, nz, color.r, color.g, color.b, u, v);
    }
    this.tris += pa.count / 3;
    if (src !== geo) src.dispose();
    if (disposeSource) geo.dispose();
  }

  get empty(): boolean { return this.pos.length === 0; }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    this.pos.length = 0; this.nrm.length = 0; this.uvs.length = 0; this.col.length = 0;
    return g;
  }
}

const HALF = new THREE.Vector3();
const A = new THREE.Vector3();
const B = new THREE.Vector3();
const C = new THREE.Vector3();
const D = new THREE.Vector3();
const OUT = new THREE.Vector3();

function axisPoint(i: number, j: number, k: number, si: number, sj: number, sk: number, b: number, out: THREE.Vector3, faceAxis: number): void {
  const c = [0, 0, 0];
  const h = [HALF.x, HALF.y, HALF.z];
  c[i] = si * (i === faceAxis ? h[i] : h[i] - b);
  c[j] = sj * (j === faceAxis ? h[j] : h[j] - b);
  c[k] = sk * (k === faceAxis ? h[k] : h[k] - b);
  out.set(c[0], c[1], c[2]);
}

/**
 * Chamfered box — the environment's core solid. 44 triangles, hard facets, and a bevel that
 * catches a specular rim so nothing reads as a bare grey primitive.
 */
export function chamferBox(batch: GeoBatch, w: number, h: number, d: number, bevel: number, color: THREE.Color, matrix?: THREE.Matrix4): void {
  const b = Math.min(bevel, w * 0.45, h * 0.45, d * 0.45);
  HALF.set(w / 2, h / 2, d / 2);
  const half = [HALF.x, HALF.y, HALF.z];

  const put = (v: THREE.Vector3): Vec3Like => {
    if (matrix) v.applyMatrix4(matrix);
    return { x: v.x, y: v.y, z: v.z };
  };
  const dir = (x: number, y: number, z: number): Vec3Like => {
    OUT.set(x, y, z).normalize();
    if (matrix) OUT.transformDirection(matrix);
    return { x: OUT.x, y: OUT.y, z: OUT.z };
  };

  // 6 inset faces
  for (let ax = 0; ax < 3; ax++) {
    const u = (ax + 1) % 3, v = (ax + 2) % 3;
    for (const s of [1, -1]) {
      const mk = (su: number, sv: number): Vec3Like => {
        const c = [0, 0, 0];
        c[ax] = s * half[ax];
        c[u] = su * (half[u] - b);
        c[v] = sv * (half[v] - b);
        A.set(c[0], c[1], c[2]);
        return put(A);
      };
      const n = [0, 0, 0]; n[ax] = s;
      const p0 = mk(-1, -1), p1 = mk(1, -1), p2 = mk(1, 1), p3 = mk(-1, 1);
      batch.addQuad(p0, p1, p2, p3, color, dir(n[0], n[1], n[2]));
    }
  }

  // 12 bevel edges
  for (let i = 0; i < 3; i++) {
    for (let j = i + 1; j < 3; j++) {
      const k = 3 - i - j;
      for (const si of [1, -1]) {
        for (const sj of [1, -1]) {
          const mk = (sk: number, faceAxis: number): Vec3Like => {
            axisPoint(i, j, k, si, sj, sk, b, A, faceAxis);
            return put(A);
          };
          const q0 = mk(-1, i), q1 = mk(1, i), q2 = mk(1, j), q3 = mk(-1, j);
          const n = [0, 0, 0]; n[i] = si; n[j] = sj;
          batch.addQuad(q0, q1, q2, q3, color, dir(n[0], n[1], n[2]));
        }
      }
    }
  }

  // 8 corner triangles
  for (const sx of [1, -1]) {
    for (const sy of [1, -1]) {
      for (const sz of [1, -1]) {
        A.set(sx * half[0], sy * (half[1] - b), sz * (half[2] - b));
        const t0 = put(A);
        B.set(sx * (half[0] - b), sy * half[1], sz * (half[2] - b));
        const t1 = put(B);
        C.set(sx * (half[0] - b), sy * (half[1] - b), sz * half[2]);
        const t2 = put(C);
        batch.addTri(t0, t1, t2, color, dir(sx, sy, sz));
      }
    }
  }
  void D;
}

/** Convenience: chamfered box positioned by centre with optional Y rotation. */
export function boxAt(
  batch: GeoBatch, color: THREE.Color,
  cx: number, cy: number, cz: number,
  w: number, h: number, d: number,
  bevel = 0.08, yaw = 0,
): void {
  const m = new THREE.Matrix4().makeRotationY(yaw);
  m.setPosition(cx, cy, cz);
  chamferBox(batch, w, h, d, bevel, color, m);
}

/** Closed rounded-rectangle loop with outward normals and cumulative arc length. */
export interface Loop {
  n: number;
  x: Float32Array;
  z: Float32Array;
  nx: Float32Array;
  nz: Float32Array;
  /** Cumulative arc length at each sample; `s[n]` is the total perimeter. */
  s: Float32Array;
  perimeter: number;
}

export function roundedRectLoop(cx: number, cz: number, halfX: number, halfZ: number, radius: number, segments: number): Loop {
  const r = Math.min(radius, halfX * 0.95, halfZ * 0.95);
  const sx = halfX - r, sz = halfZ - r;
  const straightX = 2 * sx, straightZ = 2 * sz;
  const arc = (Math.PI / 2) * r;
  const perimeter = 2 * straightX + 2 * straightZ + 4 * arc;

  const n = Math.max(16, segments);
  const x = new Float32Array(n + 1), z = new Float32Array(n + 1);
  const nx = new Float32Array(n + 1), nz = new Float32Array(n + 1);
  const s = new Float32Array(n + 1);

  // Walk the perimeter by arc length starting at (+X, -Z corner exit) and going counter-clockwise.
  for (let i = 0; i <= n; i++) {
    const dist = (i / n) * perimeter;
    let d = dist;
    let px = 0, pz = 0, ux = 0, uz = 0;
    if (d < straightZ) {                       // +X side, z from -sz → +sz
      px = halfX; pz = -sz + d; ux = 1; uz = 0;
    } else if ((d -= straightZ) < arc) {       // corner (+X,+Z)
      const a = d / r;
      px = sx + Math.cos(a) * r; pz = sz + Math.sin(a) * r; ux = Math.cos(a); uz = Math.sin(a);
    } else if ((d -= arc) < straightX) {       // +Z side, x from +sx → -sx
      px = sx - d; pz = halfZ; ux = 0; uz = 1;
    } else if ((d -= straightX) < arc) {       // corner (-X,+Z)
      const a = d / r + Math.PI / 2;
      px = -sx + Math.cos(a) * r; pz = sz + Math.sin(a) * r; ux = Math.cos(a); uz = Math.sin(a);
    } else if ((d -= arc) < straightZ) {       // -X side, z from +sz → -sz
      px = -halfX; pz = sz - d; ux = -1; uz = 0;
    } else if ((d -= straightZ) < arc) {       // corner (-X,-Z)
      const a = d / r + Math.PI;
      px = -sx + Math.cos(a) * r; pz = -sz + Math.sin(a) * r; ux = Math.cos(a); uz = Math.sin(a);
    } else if ((d -= arc) < straightX) {       // -Z side, x from -sx → +sx
      px = -sx + d; pz = -halfZ; ux = 0; uz = -1;
    } else {                                   // corner (+X,-Z)
      const a = (d - straightX) / r + Math.PI * 1.5;
      px = sx + Math.cos(a) * r; pz = -sz + Math.sin(a) * r; ux = Math.cos(a); uz = Math.sin(a);
    }
    x[i] = cx + px; z[i] = cz + pz; nx[i] = ux; nz[i] = uz; s[i] = dist;
  }
  return { n, x, z, nx, nz, s, perimeter };
}

/** Darken/brighten a colour without leaving the working colour space. */
export function shade(base: THREE.Color, amount: number, out = new THREE.Color()): THREE.Color {
  out.copy(base);
  if (amount >= 0) out.lerp(WHITE, amount);
  else out.multiplyScalar(1 + amount);
  return out;
}
const WHITE = new THREE.Color(1, 1, 1);

/** Deterministic presentation-only PRNG. Never feeds simulation. See ARCHITECTURE.md §3. */
export class VisualRng {
  private s: number;
  constructor(seed: number) { this.s = (seed >>> 0) || 0x9e3779b9; }
  next(): number {
    let x = this.s;
    x ^= x << 13; x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5; x >>>= 0;
    this.s = x;
    return x / 4294967296;
  }
  range(a: number, b: number): number { return a + (b - a) * this.next(); }
  int(n: number): number { return Math.min(n - 1, Math.floor(this.next() * n)); }
  pick<T>(arr: readonly T[]): T { return arr[this.int(arr.length)]; }
}
