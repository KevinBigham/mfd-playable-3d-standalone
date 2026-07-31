import * as THREE from 'three';
import type { StadiumDef, TeamDef } from '../../core/types.ts';
import type { SceneRegistry, QualitySettings } from '../registry.ts';
import { crowdSpriteAtlas } from './textures.ts';
import { VisualRng } from './geo.ts';
import { bowlLayout, type BowlLayout } from './stadium.ts';

/**
 * The crowd: ONE InstancedMesh of a two-quad person, up to ~24 000 of them.
 *
 * Placement happens once on a seat lattice that follows the bowl's rake, and every frame after
 * that the only work is two uniform writes. The bob, sway and touchdown jump all live in the
 * vertex shader driven by a per-instance phase — there is never a per-frame CPU matrix update.
 */

const SEAT_W = 0.80;     // yards of loop per seat
const ROW_DEPTH = 0.88;  // yards of rake per row
const MAX_CROWD = 24000;

const CROWD_VS = `
attribute float aTorso;
attribute float aPhase;
attribute vec3 aColor;
attribute vec2 aTile;
attribute float aSkin;
uniform float uTime;
uniform float uExcitement;
uniform float uPop;
varying vec2 vUv;
varying vec3 vColor;
varying float vShade;
#include <fog_pars_vertex>

void main() {
  vUv = uv + aTile * aTorso;
  vec3 skin = mix(vec3(0.94, 0.77, 0.58), vec3(0.30, 0.18, 0.11), aSkin);
  vColor = mix(skin, aColor, aTorso);
  vShade = 0.70 + 0.34 * position.y + (fract(aPhase * 7.31) - 0.5) * 0.16;

  vec3 p = position;
  float t = uTime * (2.3 + uExcitement * 3.6) + aPhase * 6.2831853;
  float bob = sin(t) * (0.018 + uExcitement * 0.105);
  float jump = uPop * max(0.0, sin(uTime * 7.4 + aPhase * 6.2831853)) * 0.44;
  float lift = 0.30 + position.y;
  p.y += (bob + jump) * lift;
  p.x += sin(t * 0.63) * (0.012 + uExcitement * 0.055) * lift;

  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const CROWD_FS = `
precision mediump float;
uniform sampler2D uAtlas;
uniform float uExcitement;
varying vec2 vUv;
varying vec3 vColor;
varying float vShade;
#include <fog_pars_fragment>

void main() {
  vec4 tex = texture2D(uAtlas, vUv);
  if (tex.a < 0.42) discard;
  vec3 col = vColor * vShade * (0.80 + 0.30 * tex.r);
  col += vColor * uExcitement * 0.10;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export interface CrowdOptions {
  home: TeamDef;
  away: TeamDef;
  stadium: StadiumDef;
  quality: QualitySettings;
  /** Bowl geometry from the stadium build; recomputed from the tier if omitted. */
  layout?: BowlLayout;
  /** Presentation-only seed so captures reproduce. */
  seed?: number;
}

export interface CrowdHandle {
  mesh: THREE.InstancedMesh;
  count: number;
  /** 0 = bored, 1 = bedlam. Smoothed internally. */
  setExcitement(v: number): void;
  /** One-shot surge — touchdowns, big hits, Overdrive. */
  pop(power: number): void;
  update(dt: number): void;
  dispose(): void;
}

/** Two quads: torso (uv tile 1,0 by default) and head (uv tile 0,0). */
function personGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const tw = 0.36, th = 0.74, hw = 0.185, hh = 0.36, hy = 0.60;
  const pos = new Float32Array([
    // torso quad
    -tw, 0, 0, tw, 0, 0, tw, th, 0, -tw, th, 0,
    // head quad
    -hw, hy, 0.012, hw, hy, 0.012, hw, hy + hh, 0.012, -hw, hy + hh, 0.012,
  ]);
  // Atlas tiles are 0.5 × 0.5. Torso base = tile (1,0) → u ∈ [0.5,1], v ∈ [0.5,1].
  // Head = tile (0,0) → u ∈ [0,0.5], v ∈ [0.5,1].
  const uv = new Float32Array([
    0.5, 0.5, 1.0, 0.5, 1.0, 1.0, 0.5, 1.0,
    0.0, 0.5, 0.5, 0.5, 0.5, 1.0, 0.0, 1.0,
  ]);
  const torso = new Float32Array([1, 1, 1, 1, 0, 0, 0, 0]);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('aTorso', new THREE.BufferAttribute(torso, 1));
  g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  g.computeBoundingSphere();
  return g;
}

export function buildCrowd(reg: SceneRegistry, o: CrowdOptions): CrowdHandle {
  const group = reg.group('env.crowd');
  const layout = o.layout ?? bowlLayout(o.stadium.tier, 96);
  const loop = layout.loop;
  const rng = new VisualRng((o.seed ?? 0x5eed) ^ (o.stadium.id.length * 2654435761));

  const target = Math.max(900, Math.round(MAX_CROWD * o.quality.crowdDensity));

  // Seat lattice capacity.
  const rowsPerBand = layout.bands.map((b) =>
    Math.max(1, Math.floor(Math.hypot(b.rEnd - b.rStart, b.yEnd - b.yStart) / ROW_DEPTH)));
  const seatsPerRow = Math.max(8, Math.floor(loop.perimeter / SEAT_W));
  let slots = 0;
  for (const r of rowsPerBand) slots += r * seatsPerRow;
  const fill = Math.min(1, target / Math.max(1, slots));

  const geo = personGeometry();
  const atlas = crowdSpriteAtlas(o.quality);

  const max = Math.max(1, Math.min(target, slots));
  const phase = new Float32Array(max);
  const color = new Float32Array(max * 3);
  const tile = new Float32Array(max * 2);
  const skin = new Float32Array(max);
  const matrices = new Float32Array(max * 16);

  const tintCol = new THREE.Color(o.stadium.crowdTint);
  const palettes: [THREE.Color[], THREE.Color[]] = [
    [new THREE.Color(o.home.colors.primary), new THREE.Color(o.home.colors.secondary), new THREE.Color(o.home.colors.accent)],
    [new THREE.Color(o.away.colors.primary), new THREE.Color(o.away.colors.secondary), new THREE.Color(o.away.colors.accent)],
  ];
  const neutrals = ['#e6e2d8', '#20242b', '#8b9099', '#c4a97c', '#3d4a5c'].map((h) => new THREE.Color(h));
  // Torso tile offsets relative to the baked tile (1,0).
  const TILES: Array<[number, number]> = [[0, 0], [-0.5, -0.5], [0, -0.5]];

  const m4 = new THREE.Matrix4();
  const qy = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const col = new THREE.Color();

  let placed = 0;
  outer:
  for (let b = 0; b < layout.bands.length; b++) {
    const band = layout.bands[b];
    const rows = rowsPerBand[b];
    // Upper decks sit further from the action and thin out first.
    const bandFill = fill * (b === 0 ? 1.08 : 0.86);
    for (let r = 0; r < rows; r++) {
      const rowT = rows === 1 ? 0.5 : r / (rows - 1);
      const rr = band.rStart + (band.rEnd - band.rStart) * rowT;
      const yy = band.yStart + (band.yEnd - band.yStart) * rowT + 0.10;
      for (let s = 0; s < seatsPerRow; s++) {
        if (placed >= max) break outer;
        const t = (s + 0.5) / seatsPerRow;
        const fi = t * loop.n;
        const i0 = Math.floor(fi) % loop.n;
        if (i0 % layout.aisleEvery === 0) continue;      // keep the radial aisles clear
        const i1 = (i0 + 1) % loop.n;
        const f = fi - Math.floor(fi);

        const lx = loop.x[i0] + (loop.x[i1] - loop.x[i0]) * f;
        const lz = loop.z[i0] + (loop.z[i1] - loop.z[i0]) * f;
        let nx = loop.nx[i0] + (loop.nx[i1] - loop.nx[i0]) * f;
        let nz = loop.nz[i0] + (loop.nz[i1] - loop.nz[i0]) * f;
        const nl = Math.hypot(nx, nz) || 1;
        nx /= nl; nz /= nl;

        const wz = lz + nz * rr;
        // Midfield fills first; corners and end zones thin out.
        const mid = 1 - Math.min(1, Math.abs(wz - layout.centerZ) / (Math.abs(loop.z[0] - layout.centerZ) + 40));
        if (rng.next() > bandFill * (0.66 + 0.52 * mid)) continue;

        const wx = lx + nx * rr;
        pos.set(wx - nx * 0.22, yy, wz - nz * 0.22);
        const yaw = Math.atan2(-nx, -nz) + rng.range(-0.28, 0.28);
        qy.setFromAxisAngle(up, yaw);
        const sc = rng.range(0.92, 1.16) * (o.quality.crowdDensity < 0.4 ? 1.16 : 1);
        scl.set(sc, sc * rng.range(0.94, 1.06), sc);
        m4.compose(pos, qy, scl);
        m4.toArray(matrices, placed * 16);

        phase[placed] = rng.next();
        const tl = TILES[rng.int(3)];
        tile[placed * 2] = tl[0];
        tile[placed * 2 + 1] = tl[1];
        skin[placed] = rng.next();

        // Side allegiance follows the half of the bowl you are sitting in.
        const homeSide = wz < layout.centerZ;
        const loyal = rng.next() < 0.86;
        const side = (homeSide === loyal) ? 0 : 1;
        const roll = rng.next();
        if (roll < 0.52) col.copy(palettes[side][rng.int(3)]);
        else if (roll < 0.80) col.copy(tintCol);
        else col.copy(neutrals[rng.int(neutrals.length)]);
        col.offsetHSL(rng.range(-0.02, 0.02), rng.range(-0.16, 0.08), rng.range(-0.14, 0.10));
        color[placed * 3] = col.r;
        color[placed * 3 + 1] = col.g;
        color[placed * 3 + 2] = col.b;
        placed++;
      }
    }
  }

  geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
  geo.setAttribute('aColor', new THREE.InstancedBufferAttribute(color, 3));
  geo.setAttribute('aTile', new THREE.InstancedBufferAttribute(tile, 2));
  geo.setAttribute('aSkin', new THREE.InstancedBufferAttribute(skin, 1));

  const uniforms: Record<string, THREE.IUniform> = {
    uAtlas: { value: atlas },
    uTime: { value: 0 },
    uExcitement: { value: 0.25 },
    uPop: { value: 0 },
    fogColor: { value: new THREE.Color(0xffffff) },
    fogDensity: { value: 0.00025 },
    fogNear: { value: 1 },
    fogFar: { value: 2000 },
  };

  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: CROWD_VS,
    fragmentShader: CROWD_FS,
    fog: true,
    side: THREE.DoubleSide,
    transparent: false,
    depthWrite: true,
  });

  const mesh = new THREE.InstancedMesh(geo, mat, max);
  mesh.instanceMatrix = new THREE.InstancedBufferAttribute(matrices, 16);
  mesh.instanceMatrix.needsUpdate = true;
  mesh.count = placed;
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.name = 'crowd';
  group.add(mesh);

  let excitement = 0.25;
  let wantExcitement = 0.25;
  let popPower = 0;
  let time = 0;
  let disposed = false;

  return {
    mesh,
    count: placed,
    setExcitement(v: number): void { wantExcitement = v < 0 ? 0 : v > 1 ? 1 : v; },
    pop(power: number): void { popPower = Math.min(1.4, popPower + power); },
    update(dt: number): void {
      time += dt;
      excitement += (wantExcitement - excitement) * Math.min(1, dt * 2.6);
      if (popPower > 0.0008) {
        popPower *= Math.pow(0.14, dt);
        if (popPower < 0.0008) popPower = 0;
      }
      uniforms.uTime.value = time;
      uniforms.uExcitement.value = excitement;
      uniforms.uPop.value = popPower;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      mesh.dispose();
      geo.dispose();
      mat.dispose();
      reg.clearGroup('env.crowd');
    },
  };
}
