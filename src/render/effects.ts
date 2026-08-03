import * as THREE from 'three';
import type { SceneRegistry, QualitySettings } from './registry.ts';
import type { Athlete, SurfaceKind, WeatherKind } from '../core/types.ts';
import type { World } from '../sim/world.ts';
import { SURFACE_LOOK } from './env/textures.ts';
import { resolveKits } from './kits.ts';
import { clamp01, lerp, smoothstep } from '../core/math.ts';

/**
 * SPEED AND IMPACT.
 *
 * Four draw calls carry every transient in the game:
 *
 *   1. `debris`  — alpha-blended ballistic chunks. Turf, mud, snow, water. Spins, arcs, lands,
 *                  skids to a stop. Tinted from the surface the match is actually played on.
 *   2. `glow`    — additive motes. Sparks, embers, turbo streamers. Written *above* 1.0 so the
 *                  bloom threshold in `post.ts` picks them up and they bleed.
 *   3. `decals`  — one instanced quad, four looks selected per instance in the fragment shader:
 *                  shock ring, impact flare, overdrive scorch, rain splash. Drawing a ring as an
 *                  annulus in a shader instead of as ring geometry means it can thin as it grows,
 *                  which tessellated geometry cannot do without rebuilding.
 *   4. `ribbons` — one buffer geometry holding every motion trail. Rewritten in place each frame.
 *
 * Nothing here allocates after construction: every pool is a fixed typed array sized by
 * `QualitySettings.particleScale`, and the spawn counts are scaled by it as well, so LOW does
 * roughly a third of the work rather than the same work smaller.
 *
 * Nothing here can influence the simulation. `observe()` only ever reads world state.
 */

// ── pool ceilings at particleScale 1.0 ────────────────────────────────────────────────────────
const MAX_DEBRIS = 640;
const MAX_GLOW = 420;
const MAX_DECALS = 40;
const MAX_RIBBONS = 5;
const MAX_RIB_SAMPLES = 26;


/** Ribbon slots. 0 and 1 are reserved so the carrier and the ball can never be starved. */
const RIB_CARRIER = 0;
const RIB_BALL = 1;
const RIB_FIRE0 = 2;

const RIB_ATTRS = ['position', 'aDir', 'aWidth', 'aMode', 'aColor', 'aAlpha'];
const DEB_ATTRS = ['aOrigin', 'aVel', 'aBirth', 'aLife', 'aSize', 'aSpin', 'aColor'];
const GLO_ATTRS = ['aOrigin', 'aVel', 'aBirth', 'aLife', 'aSize', 'aRise', 'aColor'];
const DEC_ATTRS = ['aOrigin', 'aBirth', 'aLife', 'aSpec', 'aColor'];

/** Decal kinds, matched by the `if` ladder in the decal fragment shader. */
const D_SHOCK = 0;
const D_FLARE = 1;
const D_SCORCH = 2;
const D_SPLASH = 3;

// ── debris ────────────────────────────────────────────────────────────────────────────────────

const DEBRIS_VS = /* glsl */`
attribute vec3 aOrigin;
attribute vec3 aVel;
attribute float aBirth;
attribute float aLife;
attribute float aSize;
attribute float aSpin;
attribute vec3 aColor;
uniform float uTime;
uniform float uSize;
varying float vAlpha;
varying vec3 vColor;
varying vec2 vC;
varying float vSeed;

void main() {
  float age = uTime - aBirth;
  float t = age / aLife;
  if (t < 0.0 || t > 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vAlpha = 0.0; return; }

  // A real ballistic arc, solved rather than integrated: find when the chunk meets the ground,
  // fly the parabola up to that instant, then skid along the turf with exponential damping.
  // A clod that arcs, lands and stops is the whole difference between debris and confetti.
  const float G = 26.0;
  float y0 = aOrigin.y;
  float vy = aVel.y;
  float tHit = (vy + sqrt(max(vy * vy + 2.0 * G * max(y0 - 0.03, 0.0), 0.0))) / G;
  float tf = min(age, tHit);
  float ts = max(age - tHit, 0.0);
  float skid = (1.0 - exp(-7.0 * ts)) / 7.0;

  vec3 p;
  p.xz = aOrigin.xz + aVel.xz * (tf + skid * 0.5);
  p.y = max(y0 + vy * tf - 0.5 * G * tf * tf, 0.03);

  // Sized in YARDS, expanded in view space. Point sprites would have been a device-pixel size,
  // which silently changes with the resolution scale and the adaptive-resolution governor.
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float shrink = 1.0 - 0.4 * clamp(ts * 2.5, 0.0, 1.0);
  float rot = aSpin * (0.35 + age);
  float s = sin(rot), c = cos(rot);
  vec2 q = position.xy * (aSize * uSize * shrink);
  mv.xy += vec2(c * q.x - s * q.y, s * q.x + c * q.y);
  gl_Position = projectionMatrix * mv;

  // Hold opacity, then let go. Fading from the first frame reads as fog, not as thrown turf.
  vAlpha = 1.0 - smoothstep(0.45, 1.0, t);
  vC = position.xy * 2.0;
  vSeed = fract(aSpin * 0.1731 + aBirth * 0.379);
  vColor = aColor;
}`;

const DEBRIS_FS = /* glsl */`
precision mediump float;
varying float vAlpha;
varying vec3 vColor;
varying vec2 vC;
varying float vSeed;

void main() {
  // Blades are long and thin, clods are round; one seed slides between the two.
  vec2 d = vec2(vC.x, vC.y * mix(1.0, 2.9, vSeed));
  float a = 1.0 - smoothstep(0.52, 1.0, length(d));
  if (a <= 0.004) discard;
  gl_FragColor = vec4(vColor, vAlpha * a);
}`;

// ── glow ──────────────────────────────────────────────────────────────────────────────────────

const GLOW_VS = /* glsl */`
attribute vec3 aOrigin;
attribute vec3 aVel;
attribute float aBirth;
attribute float aLife;
attribute float aSize;
attribute float aRise;
attribute vec3 aColor;
uniform float uTime;
uniform float uSize;
varying float vAlpha;
varying vec3 vColor;
varying vec2 vUv;

void main() {
  float age = uTime - aBirth;
  float t = age / aLife;
  if (t < 0.0 || t > 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vAlpha = 0.0; return; }

  // Motes have no mass worth speaking of: they are thrown, dragged to a halt, then carried up.
  float drag = (1.0 - exp(-2.6 * age)) / 2.6;
  vec3 p = aOrigin + aVel * drag;
  p.y += aRise * age * age;
  float ph = aBirth * 11.0;
  p.x += sin(age * 6.1 + ph) * 0.10 * age;
  p.z += cos(age * 5.3 + ph * 1.7) * 0.10 * age;

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  mv.xy += position.xy * (aSize * uSize * (0.7 + 0.6 * t));
  gl_Position = projectionMatrix * mv;
  float f = 1.0 - t;
  vAlpha = f * f;
  vColor = aColor;
  vUv = position.xy + 0.5;
}`;

const GLOW_FS = /* glsl */`
precision mediump float;
uniform sampler2D uMap;
varying float vAlpha;
varying vec3 vColor;
varying vec2 vUv;

void main() {
  float m = texture2D(uMap, vUv).a;
  float a = m * vAlpha;
  if (a <= 0.003) discard;
  // Additive: the colour is already above display white so the bright pass takes it.
  gl_FragColor = vec4(vColor * a, 1.0);
}`;

// ── decals ────────────────────────────────────────────────────────────────────────────────────

const DECAL_VS = /* glsl */`
attribute vec3 aOrigin;
attribute float aBirth;
attribute float aLife;
attribute vec4 aSpec;   // x: max radius, y: kind, z: seed, w: thickness
attribute vec3 aColor;
uniform float uTime;
varying vec2 vC;
varying float vT;
varying vec3 vColor;
varying float vKind;
varying float vThick;
varying float vSeed;

void main() {
  float t = (uTime - aBirth) / aLife;
  if (t < 0.0 || t > 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vT = 2.0; return; }
  float kind = aSpec.y;

  float r;
  if (kind < 0.5)      r = aSpec.x * (0.16 + 1.02 * sqrt(t));   // shock: quick out, then eases
  else if (kind < 1.5) r = aSpec.x * (0.62 + 0.75 * t);         // flare
  else if (kind < 2.5) r = aSpec.x * (0.88 + 0.26 * t);         // scorch
  else                 r = aSpec.x * (0.22 + 1.05 * sqrt(t));   // splash

  vec4 mv;
  if (kind > 0.5 && kind < 1.5) {
    // The flare faces the lens; everything else lies on the turf.
    mv = modelViewMatrix * vec4(aOrigin, 1.0);
    mv.xy += position.xy * (r * 2.0);
  } else {
    mv = modelViewMatrix * vec4(aOrigin + vec3(position.x, 0.0, position.y) * (r * 2.0), 1.0);
  }
  gl_Position = projectionMatrix * mv;

  vC = position.xy * 2.0;
  vT = t; vColor = aColor; vKind = kind; vThick = aSpec.w; vSeed = aSpec.z;
}`;

const DECAL_FS = /* glsl */`
precision mediump float;
varying vec2 vC;
varying float vT;
varying vec3 vColor;
varying float vKind;
varying float vThick;
varying float vSeed;

void main() {
  if (vT > 1.0) discard;
  float r = length(vC);
  if (r > 1.0) discard;
  float a;

  if (vKind < 0.5) {
    // SHOCK — an annulus that thins as it grows, with the outside edge left hard. A ring that
    // keeps its width while expanding reads as a smoke puff; one that thins reads as pressure.
    float w = vThick * (1.0 - vT * 0.86) + 0.018;
    float d = r - 0.86;
    a = (1.0 - smoothstep(0.0, w, abs(d))) * (1.0 - vT);
    a *= a;
    a *= 1.0 + 0.9 * (1.0 - smoothstep(0.0, w * 0.45, max(d, 0.0)));
  } else if (vKind < 1.5) {
    // FLARE — hot core plus an anamorphic cross. Cheap, and the bloom does the rest.
    float core = pow(max(0.0, 1.0 - r), 3.0);
    vec2 s = abs(vC);
    float h = max(0.0, 1.0 - s.y * 9.0) * max(0.0, 1.0 - s.x);
    float v = max(0.0, 1.0 - s.x * 9.0) * max(0.0, 1.0 - s.y);
    a = (core * 1.15 + (h + v * 0.5) * 0.42) * pow(1.0 - vT, 2.4);
  } else if (vKind < 2.5) {
    // SCORCH — a dim disc with a live edge, guttering on its own seed.
    float fill = 1.0 - smoothstep(0.25, 1.0, r);
    float edge = smoothstep(0.30, 0.72, r) * (1.0 - smoothstep(0.72, 1.0, r));
    a = (fill * 0.30 + edge * 0.85) * (1.0 - vT)
      * (0.72 + 0.28 * sin(vSeed * 37.0 + vT * 24.0));
  } else {
    // SPLASH — thin, quick, gone.
    float w = 0.15 * (1.0 - vT) + 0.02;
    a = (1.0 - smoothstep(0.0, w, abs(r - 0.82))) * (1.0 - vT);
  }

  if (a <= 0.003) discard;
  gl_FragColor = vec4(vColor * a, 1.0);
}`;

// ── ribbons ───────────────────────────────────────────────────────────────────────────────────

const RIBBON_VS = /* glsl */`
attribute vec3 aDir;
attribute float aSide;
attribute float aWidth;
attribute float aMode;
attribute vec3 aColor;
attribute float aAlpha;
varying vec3 vColor;
varying float vA;
varying float vS;

void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  if (aMode > 0.5) {
    // Screen-facing ribbon: widen perpendicular to the travel direction *as projected*, so a
    // ball flying straight at the camera still has a visible trail. No camera uniform needed —
    // the model-view matrix already carries everything this requires.
    vec3 dv = (modelViewMatrix * vec4(aDir, 0.0)).xyz;
    float l = length(dv.xy);
    vec2 side = l > 1e-4 ? vec2(-dv.y, dv.x) / l : vec2(1.0, 0.0);
    mv.xy += side * (aSide * aWidth);
  }
  gl_Position = projectionMatrix * mv;
  vColor = aColor; vA = aAlpha; vS = aSide;
}`;

const RIBBON_FS = /* glsl */`
precision mediump float;
varying vec3 vColor;
varying float vA;
varying float vS;

void main() {
  // Feathered across the ribbon, hottest down its spine.
  float f = 1.0 - vS * vS;
  float a = vA * f * (0.55 + 0.45 * f);
  if (a <= 0.003) discard;
  gl_FragColor = vec4(vColor * a, 1.0);
}`;

// ── helpers ───────────────────────────────────────────────────────────────────────────────────

/** A unit quad centred on the origin, ready for per-instance attributes. */
function quadGeometry(): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
  ]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

/** Soft radial mask for the additive motes. Generated, never loaded — no binary assets exist. */
function softSprite(): THREE.CanvasTexture {
  const s = 64;
  const cv = document.createElement('canvas');
  cv.width = s; cv.height = s;
  const g = cv.getContext('2d');
  if (g) {
    const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grd.addColorStop(0.00, 'rgba(255,255,255,1)');
    grd.addColorStop(0.22, 'rgba(255,255,255,0.72)');
    grd.addColorStop(0.55, 'rgba(255,255,255,0.20)');
    grd.addColorStop(0.82, 'rgba(255,255,255,0.045)');
    grd.addColorStop(1.00, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, s, s);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.NoColorSpace;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

/** One motion trail. History is a ring buffer of world points; nothing here is ever reallocated. */
interface Ribbon {
  /** Identity of whoever owns the trail; changing it wipes the history. -1 when free. */
  owner: number;
  x: Float32Array; y: Float32Array; z: Float32Array; born: Float32Array;
  /** Number of live samples, and the ring index of the newest. */
  count: number; head: number;
  color: THREE.Color;
  width: number;
  life: number;
  /** 0 = expanded flat on the turf, 1 = expanded in screen space. */
  mode: number;
  intensity: number;
  lastPush: number;
  fedAt: number;
}

/** Per-athlete presentation memory, so transitions can be detected without touching the sim. */
interface Watch {
  key: number;
  state: string;
  phase: number;
  y: number;
  x: number; z: number;
  vx: number; vz: number;
  seen: boolean;
  nextCut: number;
  nextEmber: number;
  nextScorch: number;
  nextStride: number;
}

function makeWatch(): Watch {
  return {
    key: -1, state: '', phase: 0, y: 0, x: 0, z: 0, vx: 0, vz: 0, seen: false,
    nextCut: 0, nextEmber: 0, nextScorch: 0, nextStride: 0,
  };
}

export type BurstKind = 'TURF' | 'SPARK' | 'SMOKE' | 'WATER';

export class Effects {
  private group: THREE.Group;
  private quality: QualitySettings;
  private time = 0;
  /** Global multiplier on every sprite's world size. */
  private pixelScale = 1;

  // debris
  private debGeo: THREE.InstancedBufferGeometry;
  private debMat: THREE.ShaderMaterial;
  private debPos: Float32Array; private debVel: Float32Array;
  private debBirth: Float32Array; private debLife: Float32Array;
  private debSize: Float32Array; private debSpin: Float32Array; private debCol: Float32Array;
  private debHead = 0; private debDirty = false;

  // glow
  private gloGeo: THREE.InstancedBufferGeometry;
  private gloMat: THREE.ShaderMaterial;
  private gloPos: Float32Array; private gloVel: Float32Array;
  private gloBirth: Float32Array; private gloLife: Float32Array;
  private gloSize: Float32Array; private gloRise: Float32Array; private gloCol: Float32Array;
  private gloHead = 0; private gloDirty = false;
  private sprite: THREE.CanvasTexture;

  // decals
  private decGeo: THREE.InstancedBufferGeometry;
  private decMat: THREE.ShaderMaterial;
  private decOrigin: Float32Array; private decBirth: Float32Array;
  private decLife: Float32Array; private decSpec: Float32Array; private decCol: Float32Array;
  private decHead = 0; private decHeadAmb = 0; private decSplit = 6; private decDirty = false;

  // ribbons
  private ribGeo: THREE.BufferGeometry;
  private ribMat: THREE.ShaderMaterial;
  private ribPos: Float32Array; private ribDir: Float32Array; private ribSide: Float32Array;
  private ribWidth: Float32Array; private ribMode: Float32Array;
  private ribCol: Float32Array; private ribAlpha: Float32Array;
  private ribbons: Ribbon[] = [];
  private ribSamples: number;

  // observed world
  private watch: Watch[] = [];
  private surface: SurfaceKind = 'GRASS';
  private weather: WeatherKind = 'CLEAR';
  private turfBase = new THREE.Color(0x2c7a37);
  private turfDirt = new THREE.Color(0x6b5333);
  private kitCol: [THREE.Color, THREE.Color] = [new THREE.Color(0x3fd0ff), new THREE.Color(0xff5a4a)];
  private teamsRef: unknown = null;
  private condRef: unknown = null;

  // scratch — reused every frame, never reallocated
  private tmpCol = new THREE.Color();
  private tmpCol2 = new THREE.Color();
  private tmpCol3 = new THREE.Color();
  private ribDirty = false;
  /** Four most recent impacts as (x, z, t), for de-duplicating event vs. observed hits. */
  private recent = new Float32Array(12).fill(-1000);
  private recentHead = 0;

  constructor(reg: SceneRegistry, quality: QualitySettings) {
    this.quality = quality;
    this.group = reg.group('effects');
    const s = clamp01(quality.particleScale);
    const nDeb = Math.max(96, Math.round(MAX_DEBRIS * s));
    const nGlo = Math.max(64, Math.round(MAX_GLOW * s));
    const nDec = Math.max(12, Math.round(MAX_DECALS * s));
    const nRib = quality.tier === 'LOW' ? 3 : MAX_RIBBONS;
    this.ribSamples = Math.max(8, Math.round(MAX_RIB_SAMPLES * s));

    for (let i = 0; i < 14; i++) this.watch.push(makeWatch());

    // ── debris
    this.debPos = new Float32Array(nDeb * 3);
    this.debVel = new Float32Array(nDeb * 3);
    this.debBirth = new Float32Array(nDeb).fill(-1000);
    this.debLife = new Float32Array(nDeb).fill(1);
    this.debSize = new Float32Array(nDeb);
    this.debSpin = new Float32Array(nDeb);
    this.debCol = new Float32Array(nDeb * 3);
    this.debGeo = quadGeometry();
    this.debGeo.setAttribute('aOrigin', new THREE.InstancedBufferAttribute(this.debPos, 3));
    this.debGeo.setAttribute('aVel', new THREE.InstancedBufferAttribute(this.debVel, 3));
    this.debGeo.setAttribute('aBirth', new THREE.InstancedBufferAttribute(this.debBirth, 1));
    this.debGeo.setAttribute('aLife', new THREE.InstancedBufferAttribute(this.debLife, 1));
    this.debGeo.setAttribute('aSize', new THREE.InstancedBufferAttribute(this.debSize, 1));
    this.debGeo.setAttribute('aSpin', new THREE.InstancedBufferAttribute(this.debSpin, 1));
    this.debGeo.setAttribute('aColor', new THREE.InstancedBufferAttribute(this.debCol, 3));
    this.debGeo.instanceCount = nDeb;
    this.debGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 50), 420);
    this.debMat = new THREE.ShaderMaterial({
      vertexShader: DEBRIS_VS, fragmentShader: DEBRIS_FS,
      uniforms: { uTime: { value: 0 }, uSize: { value: this.pixelScale } },
      transparent: true, depthWrite: false, blending: THREE.NormalBlending,
    });
    const debris = new THREE.Mesh(this.debGeo, this.debMat);
    debris.frustumCulled = false;
    debris.renderOrder = 4;
    this.group.add(debris);

    // ── glow
    this.gloPos = new Float32Array(nGlo * 3);
    this.gloVel = new Float32Array(nGlo * 3);
    this.gloBirth = new Float32Array(nGlo).fill(-1000);
    this.gloLife = new Float32Array(nGlo).fill(1);
    this.gloSize = new Float32Array(nGlo);
    this.gloRise = new Float32Array(nGlo);
    this.gloCol = new Float32Array(nGlo * 3);
    this.gloGeo = quadGeometry();
    this.gloGeo.setAttribute('aOrigin', new THREE.InstancedBufferAttribute(this.gloPos, 3));
    this.gloGeo.setAttribute('aVel', new THREE.InstancedBufferAttribute(this.gloVel, 3));
    this.gloGeo.setAttribute('aBirth', new THREE.InstancedBufferAttribute(this.gloBirth, 1));
    this.gloGeo.setAttribute('aLife', new THREE.InstancedBufferAttribute(this.gloLife, 1));
    this.gloGeo.setAttribute('aSize', new THREE.InstancedBufferAttribute(this.gloSize, 1));
    this.gloGeo.setAttribute('aRise', new THREE.InstancedBufferAttribute(this.gloRise, 1));
    this.gloGeo.setAttribute('aColor', new THREE.InstancedBufferAttribute(this.gloCol, 3));
    this.gloGeo.instanceCount = nGlo;
    this.gloGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 50), 420);
    this.sprite = softSprite();
    this.gloMat = new THREE.ShaderMaterial({
      vertexShader: GLOW_VS, fragmentShader: GLOW_FS,
      uniforms: {
        uTime: { value: 0 }, uSize: { value: this.pixelScale },
        uMap: { value: this.sprite },
      },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const glow = new THREE.Mesh(this.gloGeo, this.gloMat);
    glow.frustumCulled = false;
    glow.renderOrder = 6;
    this.group.add(glow);

    // ── decals: one quad, `nDec` instances, four looks
    this.decGeo = quadGeometry();
    this.decOrigin = new Float32Array(nDec * 3);
    this.decBirth = new Float32Array(nDec).fill(-1000);
    this.decLife = new Float32Array(nDec).fill(1);
    this.decSpec = new Float32Array(nDec * 4);
    this.decCol = new Float32Array(nDec * 3);
    this.decGeo.setAttribute('aOrigin', new THREE.InstancedBufferAttribute(this.decOrigin, 3));
    this.decGeo.setAttribute('aBirth', new THREE.InstancedBufferAttribute(this.decBirth, 1));
    this.decGeo.setAttribute('aLife', new THREE.InstancedBufferAttribute(this.decLife, 1));
    this.decGeo.setAttribute('aSpec', new THREE.InstancedBufferAttribute(this.decSpec, 4));
    this.decGeo.setAttribute('aColor', new THREE.InstancedBufferAttribute(this.decCol, 3));
    this.decGeo.instanceCount = nDec;
    // Impacts get the front 55% of the ring and cannot be evicted by the ambient effects.
    this.decSplit = Math.max(4, Math.round(nDec * 0.55));
    this.decGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 50), 420);
    this.decMat = new THREE.ShaderMaterial({
      vertexShader: DECAL_VS, fragmentShader: DECAL_FS,
      uniforms: { uTime: { value: 0 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const decals = new THREE.Mesh(this.decGeo, this.decMat);
    decals.frustumCulled = false;
    decals.renderOrder = 5;
    this.group.add(decals);

    // ── ribbons: every trail in one geometry, rewritten in place
    const verts = nRib * this.ribSamples * 2;
    this.ribPos = new Float32Array(verts * 3);
    this.ribDir = new Float32Array(verts * 3);
    this.ribSide = new Float32Array(verts);
    this.ribWidth = new Float32Array(verts);
    this.ribMode = new Float32Array(verts);
    this.ribCol = new Float32Array(verts * 3);
    this.ribAlpha = new Float32Array(verts);
    for (let v = 0; v < verts; v++) this.ribSide[v] = (v & 1) === 0 ? -1 : 1;
    const idx = new Uint16Array(nRib * (this.ribSamples - 1) * 6);
    let w = 0;
    for (let k = 0; k < nRib; k++) {
      const base = k * this.ribSamples * 2;
      for (let j = 0; j < this.ribSamples - 1; j++) {
        const a = base + j * 2;
        idx[w++] = a; idx[w++] = a + 1; idx[w++] = a + 3;
        idx[w++] = a; idx[w++] = a + 3; idx[w++] = a + 2;
      }
    }
    this.ribGeo = new THREE.BufferGeometry();
    this.ribGeo.setAttribute('position', new THREE.BufferAttribute(this.ribPos, 3));
    this.ribGeo.setAttribute('aDir', new THREE.BufferAttribute(this.ribDir, 3));
    this.ribGeo.setAttribute('aSide', new THREE.BufferAttribute(this.ribSide, 1));
    this.ribGeo.setAttribute('aWidth', new THREE.BufferAttribute(this.ribWidth, 1));
    this.ribGeo.setAttribute('aMode', new THREE.BufferAttribute(this.ribMode, 1));
    this.ribGeo.setAttribute('aColor', new THREE.BufferAttribute(this.ribCol, 3));
    this.ribGeo.setAttribute('aAlpha', new THREE.BufferAttribute(this.ribAlpha, 1));
    this.ribGeo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.ribGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 50), 420);
    this.ribMat = new THREE.ShaderMaterial({
      vertexShader: RIBBON_VS, fragmentShader: RIBBON_FS,
      uniforms: {},
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const ribbonMesh = new THREE.Mesh(this.ribGeo, this.ribMat);
    ribbonMesh.frustumCulled = false;
    ribbonMesh.renderOrder = 3;
    this.group.add(ribbonMesh);

    for (let k = 0; k < nRib; k++) {
      this.ribbons.push({
        owner: -1,
        x: new Float32Array(this.ribSamples), y: new Float32Array(this.ribSamples),
        z: new Float32Array(this.ribSamples), born: new Float32Array(this.ribSamples),
        count: 0, head: 0,
        color: new THREE.Color(1, 1, 1),
        width: 0.6, life: 0.34, mode: 0, intensity: 0, lastPush: -100, fedAt: -100,
      });
    }

    reg.trackAll(
      this.debGeo, this.debMat, this.gloGeo, this.gloMat, this.sprite,
      this.decGeo, this.decMat, this.ribGeo, this.ribMat,
    );
  }

  /**
   * Global size multiplier for the sprites, 1 = as authored.
   *
   * Sprites are sized in YARDS and expanded in view space, so resolution, pixel ratio and the
   * adaptive-resolution governor no longer change how big a divot looks — which is why this is
   * now a taste dial rather than a correction. A legacy pixels-per-yard figure (anything above 4,
   * which is what this used to take) normalises to 1 rather than exploding.
   */
  setPixelScale(v: number): void {
    this.pixelScale = v > 4 || !(v > 0) ? 1 : v;
    this.debMat.uniforms.uSize.value = this.pixelScale;
    this.gloMat.uniforms.uSize.value = this.pixelScale;
  }

  // ── spawn primitives ────────────────────────────────────────────────────────────────────────

  private debris(
    x: number, y: number, z: number, vx: number, vy: number, vz: number,
    life: number, size: number, c: THREE.Color,
  ): void {
    const i = this.debHead;
    this.debHead = (this.debHead + 1) % this.debLife.length;
    const i3 = i * 3;
    this.debPos[i3] = x; this.debPos[i3 + 1] = y; this.debPos[i3 + 2] = z;
    this.debVel[i3] = vx; this.debVel[i3 + 1] = vy; this.debVel[i3 + 2] = vz;
    this.debBirth[i] = this.time; this.debLife[i] = life;
    this.debSize[i] = size;
    this.debSpin[i] = (Math.random() - 0.5) * 26;
    this.debCol[i3] = c.r; this.debCol[i3 + 1] = c.g; this.debCol[i3 + 2] = c.b;
    this.debDirty = true;
  }

  private mote(
    x: number, y: number, z: number, vx: number, vy: number, vz: number,
    life: number, size: number, rise: number, c: THREE.Color,
  ): void {
    const i = this.gloHead;
    this.gloHead = (this.gloHead + 1) % this.gloLife.length;
    const i3 = i * 3;
    this.gloPos[i3] = x; this.gloPos[i3 + 1] = y; this.gloPos[i3 + 2] = z;
    this.gloVel[i3] = vx; this.gloVel[i3 + 1] = vy; this.gloVel[i3 + 2] = vz;
    this.gloBirth[i] = this.time; this.gloLife[i] = life;
    this.gloSize[i] = size; this.gloRise[i] = rise;
    this.gloCol[i3] = c.r; this.gloCol[i3 + 1] = c.g; this.gloCol[i3 + 2] = c.b;
    this.gloDirty = true;
  }

  /**
   * Decals live in two disjoint slices of one ring.
   *
   * Impacts are rare and must never be missed; overdrive scorch and rain splash are continuous and
   * would otherwise evict them — seven athletes in Overdrive were enough to consume the whole pool
   * and swallow the shock ring of every tackle underneath them.
   */
  private decal(
    kind: number, x: number, y: number, z: number,
    radius: number, life: number, thickness: number, c: THREE.Color,
  ): void {
    const ambient = kind === D_SCORCH || kind === D_SPLASH;
    let i: number;
    if (ambient) {
      i = this.decSplit + this.decHeadAmb;
      this.decHeadAmb = (this.decHeadAmb + 1) % (this.decLife.length - this.decSplit);
    } else {
      i = this.decHead;
      this.decHead = (this.decHead + 1) % this.decSplit;
    }
    const i3 = i * 3;
    this.decOrigin[i3] = x; this.decOrigin[i3 + 1] = y; this.decOrigin[i3 + 2] = z;
    this.decBirth[i] = this.time; this.decLife[i] = life;
    const i4 = i * 4;
    this.decSpec[i4] = radius; this.decSpec[i4 + 1] = kind;
    this.decSpec[i4 + 2] = Math.random(); this.decSpec[i4 + 3] = thickness;
    this.decCol[i3] = c.r; this.decCol[i3 + 1] = c.g; this.decCol[i3 + 2] = c.b;
    this.decDirty = true;
  }

  // ── public effect API (unchanged signatures) ────────────────────────────────────────────────

  /**
   * Throw material off the ground.
   *
   * Direction comes from whoever is standing closest: debris is flung *against* his motion, which
   * is what makes a cut read as a cut rather than as a firework. When no world has been observed
   * yet it falls back to a radial pattern.
   */
  burst(x: number, y: number, z: number, power: number, kind: BurstKind): void {
    const p = clamp01(power);
    let dx = 0, dz = 0;
    if (kind === 'TURF' || kind === 'WATER') {
      let best = 9e9;
      for (let i = 0; i < this.watch.length; i++) {
        const wv = this.watch[i];
        if (!wv.seen) continue;
        const d = (wv.x - x) * (wv.x - x) + (wv.z - z) * (wv.z - z);
        if (d < best) { best = d; dx = -wv.vx; dz = -wv.vz; }
      }
      if (best > 36) { dx = 0; dz = 0; }
      const l = Math.hypot(dx, dz);
      if (l > 0.5) { dx /= l; dz /= l; } else { dx = 0; dz = 0; }
    }
    this.spray(x, y, z, dx, dz, 0.35 + p * 0.85, kind);
  }

  /**
   * Impact. `radius` doubles as the strength dial — the renderer derives it from the impulse
   * power, so a routine wrap-up and a highlight-reel hit arrive here as different numbers and
   * must come out looking like different events, not like the same event at two scales.
   */
  ring(x: number, y: number, z: number, radius: number, color: number): void {
    const power = clamp01((radius - 2) / 2.4);
    this.impact(x, y, z, power, color);
  }

  /** Direct impact hook. `power` 0..1. Safe to call from the caller instead of `ring()`. */
  impact(x: number, y: number, z: number, power: number, color = 0xfff0b0): void {
    // One collision reaches this class twice — once as a `camera.impulse` event and once as an
    // athlete entering TACKLED — and the second copy is not a second hit. Whichever arrives first
    // wins; the other is swallowed here rather than being suppressed at each call site.
    for (let i = 0; i < 4; i++) {
      const b = i * 3;
      if (this.time - this.recent[b + 2] < 0.22
        && Math.abs(this.recent[b] - x) < 2.5 && Math.abs(this.recent[b + 1] - z) < 2.5) return;
    }
    const rb = this.recentHead * 3;
    this.recentHead = (this.recentHead + 1) % 4;
    this.recent[rb] = x; this.recent[rb + 1] = z; this.recent[rb + 2] = this.time;

    const p = clamp01(power);
    const big = p > 0.62;
    const c = this.tmpCol.setHex(color);

    // The shock ring. A big hit gets a second, slower, wider one behind the first so the impact
    // keeps expanding after the flash has gone — that is the read that separates the two.
    const r0 = lerp(2.2, 4.8, p);
    this.decal(D_SHOCK, x, y + 0.05, z, r0, lerp(0.28, 0.44, p), lerp(0.085, 0.155, p),
      this.tmpCol2.copy(c).multiplyScalar(lerp(0.75, 1.7, p)));
    if (big && this.quality.tier !== 'LOW') {
      this.decal(D_SHOCK, x, y + 0.04, z, r0 * 1.75, 0.60, 0.065,
        this.tmpCol2.copy(c).multiplyScalar(0.55));
    }

    // The flare. Routine hits stay in the kit colour of the light; a big one goes white-hot and
    // grows a cross, which is what the bloom turns into a star.
    const flareC = this.tmpCol2.copy(c);
    if (big) flareC.lerp(this.tmpCol3.setRGB(1, 1, 1), 0.55);
    this.decal(D_FLARE, x, y + lerp(0.95, 1.45, p), z,
      lerp(0.58, 1.5, p), lerp(0.12, 0.20, p), 0, flareC.multiplyScalar(lerp(1.2, 3.2, p)));

    // Turf goes everywhere, thrown up rather than out.
    const n = Math.round(lerp(5, 20, p) * this.quality.particleScale);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = lerp(2.0, 8.5, Math.random()) * (0.55 + p);
      this.pickTurf(this.tmpCol2);
      this.debris(x, y + 0.12, z, Math.cos(a) * sp, lerp(3.5, 10.5, Math.random()) * (0.7 + p),
        Math.sin(a) * sp, lerp(0.5, 1.15, Math.random()), lerp(0.22, 0.52, Math.random()),
        this.tmpCol2);
    }

    // Sparks only for the hits that earn them.
    if (big) {
      const m = Math.round(14 * this.quality.particleScale);
      for (let i = 0; i < m; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = lerp(3, 13, Math.random());
        this.tmpCol2.setRGB(2.6, 1.55 + Math.random() * 0.5, 0.62);
        this.mote(x, y + 0.9, z, Math.cos(a) * sp, lerp(1, 7, Math.random()), Math.sin(a) * sp,
          lerp(0.22, 0.5, Math.random()), lerp(0.16, 0.34, Math.random()), -1.2, this.tmpCol2);
      }
    }

    if (this.weather === 'RAIN') {
      this.tmpCol2.setRGB(0.85, 1.0, 1.25);
      this.decal(D_SPLASH, x, y + 0.03, z, r0 * 0.7, 0.34, 0, this.tmpCol2);
    }
  }

  // ── observation: everything below reads the world and never writes it ───────────────────────

  /**
   * Advance every pool. Pass `world` and the interpolation `alpha` and the trails, turf spray,
   * overdrive and weather reactions all come alive; omit them and this behaves exactly as the
   * old event-only version did.
   */
  update(dt: number, world?: World | null, alpha = 1): void {
    this.time += dt;
    this.debMat.uniforms.uTime.value = this.time;
    this.gloMat.uniforms.uTime.value = this.time;
    this.decMat.uniforms.uTime.value = this.time;

    if (world) this.observe(world, alpha);

    this.buildRibbons();

    if (this.debDirty) { this.markDirty(this.debGeo, DEB_ATTRS); this.debDirty = false; }
    if (this.gloDirty) { this.markDirty(this.gloGeo, GLO_ATTRS); this.gloDirty = false; }
    if (this.decDirty) { this.markDirty(this.decGeo, DEC_ATTRS); this.decDirty = false; }
  }

  private markDirty(geo: THREE.BufferGeometry, names: string[]): void {
    for (let i = 0; i < names.length; i++) {
      const a = geo.getAttribute(names[i]) as THREE.BufferAttribute | undefined;
      if (a) a.needsUpdate = true;
    }
  }

  private observe(w: World, alpha: number): void {
    this.syncConditions(w);
    this.syncKits(w);

    const scale = this.quality.particleScale;
    const low = this.quality.tier === 'LOW';
    const held = w.ball.state.kind === 'held' ? w.ball.state.carrier : -1;
    const live = w.playPhase === 'LIVE' || w.playPhase === 'DEAD';
    let fireSlot = RIB_FIRE0;

    for (let i = 0; i < w.athletes.length && i < this.watch.length; i++) {
      const a = w.athletes[i];
      const m = this.watch[i];
      const key = a.side * 1000 + a.def.number;
      const x = lerp(a.prevX, a.x, alpha);
      const y = lerp(a.prevY, a.y, alpha);
      const z = lerp(a.prevZ, a.z, alpha);
      if (m.key !== key) {
        // A different body in this slot: forget everything, or he lands the instant he appears.
        m.key = key; m.state = a.anim.state; m.y = y; m.phase = a.anim.phase; m.seen = false;
      }
      const first = !m.seen;
      const prevState = m.state;
      const prevY = m.y;
      const prevPhase = m.phase;
      m.state = a.anim.state; m.y = y; m.phase = a.anim.phase;
      m.x = x; m.z = z; m.vx = a.vx; m.vz = a.vz; m.seen = true;
      if (first || !live) continue;

      const sp = Math.hypot(a.vx, a.vz);
      let hx = 0, hz = 0;
      if (sp > 0.4) { hx = a.vx / sp; hz = a.vz / sp; }

      // 1. Foot plants. Grass comes off the back of the shoe at every stride, not just on hits.
      if (a.y < 0.06 && a.anim.speed01 > (low ? 0.72 : 0.5)
          && (a.anim.state === 'RUN' || a.anim.state === 'SPRINT')) {
        // Two plants per stride cycle, detected as phase crossings.
        const crossed = (prevPhase < 0.5 && a.anim.phase >= 0.5)
          || (a.anim.phase < prevPhase);
        if (crossed && this.time >= m.nextStride) {
          m.nextStride = this.time + 0.05;
          const n = Math.max(1, Math.round((low ? 1 : 2) * a.anim.speed01 * scale));
          for (let k = 0; k < n; k++) {
            const j = (Math.random() - 0.5) * 0.5;
            this.pickTurf(this.tmpCol2);
            this.debris(
              x - hx * 0.35 + hz * j, 0.06, z - hz * 0.35 - hx * j,
              -hx * lerp(1.2, 4.2, Math.random()) + (Math.random() - 0.5) * 1.8,
              lerp(1.4, 3.6, Math.random()),
              -hz * lerp(1.2, 4.2, Math.random()) + (Math.random() - 0.5) * 1.8,
              lerp(0.26, 0.48, Math.random()), lerp(0.10, 0.22, Math.random()), this.tmpCol2);
          }
          if (this.weather === 'RAIN' && !low) {
            this.tmpCol2.setRGB(0.7, 0.85, 1.05);
            this.decal(D_SPLASH, x, 0.03, z, 0.55, 0.26, 0, this.tmpCol2);
          }
        }
      }

      // 2. Hard cuts. Lateral acceleration is exactly the quantity a cut is made of.
      if (a.y < 0.08 && Math.abs(a.anim.accelLat) > 24 && a.anim.speed01 > 0.35
          && this.time >= m.nextCut) {
        m.nextCut = this.time + 0.16;
        // Perpendicular to travel, thrown the way the shoe is pushing.
        const s = a.anim.accelLat > 0 ? 1 : -1;
        this.spray(x, 0.05, z, hz * s, -hx * s, clamp01(Math.abs(a.anim.accelLat) / 90) * 0.9 + 0.25, 'TURF');
      }

      // 3. Landings — a dive, a hurdle coming down, a body being put on the floor.
      if (prevY > 0.28 && y <= 0.12) {
        const f = clamp01((prevY - 0.28) * 1.6 + sp * 0.04);
        this.spray(x, 0.05, z, -hx, -hz, 0.4 + f * 0.8, this.weather === 'SNOW' ? 'SMOKE' : 'TURF');
        if (this.weather === 'RAIN') {
          this.tmpCol2.setRGB(0.9, 1.1, 1.45);
          this.decal(D_SPLASH, x, 0.03, z, 1.5 + f * 1.4, 0.36, 0, this.tmpCol2);
        } else if (this.weather === 'SNOW') {
          this.tmpCol2.setRGB(1.15, 1.2, 1.35);
          this.decal(D_SPLASH, x, 0.03, z, 1.3 + f * 1.2, 0.44, 0, this.tmpCol2);
        }
      }

      // 4. Going to ground under contact, and diving. Both plough the turf.
      if (prevState !== a.anim.state) {
        const st = a.anim.state;
        if (st === 'DIVE' || st === 'TACKLED' || st === 'STUMBLE') {
          this.spray(x, 0.06, z, -hx, -hz, st === 'TACKLED' ? 1.0 : 0.75, 'TURF');
        } else if (st === 'TACKLE') {
          this.spray(x, 0.06, z, -hx, -hz, 0.6, 'TURF');
        }
        if (st === 'TACKLED') {
          // The renderer only rings impulses above 0.55, which is a minority of tackles. Every
          // collision deserves a flash; `lastHitPower` runs about 0.5 for a shove and past 2 for
          // a highlight, and `BIG_HIT_POWER` (1.35) lands right where `impact()` changes gear.
          this.impact(x, 0, z, clamp01((w.lastHitPower - 0.55) / 1.35));
        }
      }

      // 5. Overdrive. The rig owns the aura shell; this is everything around it.
      if (a.onFire) {
        if (this.time >= m.nextEmber) {
          m.nextEmber = this.time + (low ? 0.11 : 0.062) / Math.max(0.2, scale);
          const n = low ? 1 : 2;
          for (let k = 0; k < n; k++) {
            const ang = Math.random() * Math.PI * 2;
            const rr = Math.random() * 0.55;
            this.tmpCol2.setRGB(2.9, 1.15 + Math.random() * 0.55, 0.28);
            this.mote(
              x + Math.cos(ang) * rr, 0.15 + Math.random() * 1.5, z + Math.sin(ang) * rr,
              -a.vx * 0.25 + (Math.random() - 0.5) * 1.1, lerp(0.6, 2.2, Math.random()),
              -a.vz * 0.25 + (Math.random() - 0.5) * 1.1,
              lerp(0.5, 1.0, Math.random()), lerp(0.22, 0.44, Math.random()), 1.5, this.tmpCol2);
          }
          // A heat plume: very dim, very large, rising. The cheap stand-in for a refraction pass
          // — an additive smudge of the same colour as the air above a fire, moving upward.
          if (!low && Math.random() < 0.34) {
            this.tmpCol2.setRGB(0.13, 0.055, 0.02);
            this.mote(x, 1.1, z, (Math.random() - 0.5) * 0.5, 0.5, (Math.random() - 0.5) * 0.5,
              0.8, lerp(1.0, 1.7, Math.random()), 2.4, this.tmpCol2);
          }
        }
        if (this.time >= m.nextScorch) {
          m.nextScorch = this.time + 0.16;
          this.tmpCol2.setRGB(1.35, 0.42, 0.10);
          this.decal(D_SCORCH, x, 0.035, z, 0.82, 0.30, 0, this.tmpCol2);
        }
        if (i !== held && fireSlot < this.ribbons.length) {
          this.feedFire(fireSlot++, a, x, y, z);
        }
      }

      // 6. The carrier's speed trail.
      if (i === held) this.feedCarrier(a, x, y, z);
    }

    this.feedBall(w, alpha);
  }

  /** Ground-hugging motion ribbon behind the ball carrier, tinted by his kit. */
  private feedCarrier(a: Athlete, x: number, y: number, z: number): void {
    const rb = this.ribbons[RIB_CARRIER];
    // Below this he is jogging and a trail would be a lie.
    const base = smoothstep((a.anim.speed01 - 0.55) / 0.30);
    const turbo = a.turboHeld && a.turbo > 1 ? 1 : 0;
    const intensity = clamp01(base * (0.62 + turbo * 0.55) + (a.onFire ? base * 0.3 : 0));
    if (intensity <= 0.02) return;

    const kit = this.kitCol[a.side];
    rb.color.copy(kit);
    if (a.onFire) rb.color.lerp(this.tmpCol3.setRGB(1.6, 0.52, 0.12), 0.55);
    // Additive wants headroom: push the tint above display white so it blooms instead of greying.
    // Against a white end-zone this is the difference between a trail and nothing at all.
    rb.color.multiplyScalar(lerp(1.5, 3.0, intensity));
    rb.width = lerp(0.48, 0.86, intensity);
    rb.life = lerp(0.34, 0.58, intensity);
    rb.mode = 0;
    rb.intensity = intensity;
    // Ground-hugging: a hurdle lifts the trail a little, but it never leaves the turf, because a
    // trail drawn at chest height stops reading as ground speed and starts reading as a banner.
    this.pushRibbon(RIB_CARRIER, a.side * 1000 + a.def.number, x, y * 0.3 + 0.06, z);

    // Turbo also sheds sparks off the heels; this is the part the eye reads as *effort*.
    if (turbo && Math.random() < 0.55 * this.quality.particleScale) {
      this.tmpCol2.copy(kit).multiplyScalar(2.4).addScalar(0.35);
      this.mote(x, 0.35 + Math.random() * 0.7, z,
        -a.vx * 0.32 + (Math.random() - 0.5) * 1.6, lerp(0.4, 2.0, Math.random()),
        -a.vz * 0.32 + (Math.random() - 0.5) * 1.6,
        lerp(0.22, 0.42, Math.random()), lerp(0.10, 0.21, Math.random()), 0.4, this.tmpCol2);
    }
  }

  /** A shorter, hotter version for anyone burning without the ball. */
  private feedFire(slot: number, a: Athlete, x: number, y: number, z: number): void {
    const intensity = smoothstep((a.anim.speed01 - 0.42) / 0.4) * 0.8;
    if (intensity <= 0.02) return;
    const rb = this.ribbons[slot];
    rb.color.setRGB(3.2, 1.05, 0.26);
    rb.width = lerp(0.34, 0.60, intensity);
    rb.life = 0.40;
    rb.mode = 0;
    rb.intensity = intensity;
    this.pushRibbon(slot, a.side * 1000 + a.def.number, x, y * 0.3 + 0.055, z);
  }

  /** Screen-facing ribbon behind a ball in flight. Makes a deep throw readable. */
  private feedBall(w: World, alpha: number): void {
    const b = w.ball;
    const k = b.state.kind;
    const flying = k === 'inAir' || k === 'kicked';
    const loose = k === 'loose' && b.y > 0.4;
    if (!flying && !loose) return;
    const rb = this.ribbons[RIB_BALL];
    rb.color.setRGB(2.6, 2.2, 1.5);
    rb.width = flying ? 0.16 : 0.11;
    rb.life = 0.30;
    rb.mode = 1;
    rb.intensity = flying ? 1 : 0.6;
    this.pushRibbon(RIB_BALL, 999999,
      lerp(b.prevX, b.x, alpha), lerp(b.prevY, b.y, alpha), lerp(b.prevZ, b.z, alpha));
  }

  // ── ribbon plumbing ─────────────────────────────────────────────────────────────────────────

  private pushRibbon(slot: number, owner: number, x: number, y: number, z: number): void {
    const rb = this.ribbons[slot];
    if (rb.owner !== owner) { rb.owner = owner; rb.count = 0; rb.head = 0; rb.lastPush = -100; }
    rb.fedAt = this.time;
    const n = this.ribSamples;
    // Sample on a clock, not on distance travelled: spacing the history evenly over exactly one
    // lifetime is what makes the trail the same length at 60 Hz and at 144 Hz. Between samples the
    // head is dragged to the current position so the front of the ribbon never lags the body.
    if (rb.count > 0 && this.time - rb.lastPush < rb.life / (n - 1)) {
      const h = rb.head;
      rb.x[h] = x; rb.y[h] = y; rb.z[h] = z;
      return;
    }
    rb.head = rb.count === 0 ? 0 : (rb.head + 1) % n;
    rb.x[rb.head] = x; rb.y[rb.head] = y; rb.z[rb.head] = z;
    rb.born[rb.head] = this.time;
    rb.count = Math.min(rb.count + 1, n);
    rb.lastPush = this.time;
  }

  /**
   * Rewrite every ribbon vertex in place. One geometry, one draw call, no allocation: the whole
   * reason a trail is affordable at all.
   */
  private buildRibbons(): void {
    const n = this.ribSamples;
    for (let k = 0; k < this.ribbons.length; k++) {
      const rb = this.ribbons[k];
      const base = k * n * 2;
      if (rb.owner < 0) continue;

      // Stale: nothing fed it and the oldest sample has outlived the trail.
      if (this.time - rb.fedAt > rb.life) {
        rb.owner = -1; rb.count = 0;
        for (let j = 0; j < n * 2; j++) this.ribAlpha[base + j] = 0;
        this.ribDirty = true;
        continue;
      }
      this.ribDirty = true;

      let prevX = 0, prevY = 0, prevZ = 0;
      for (let j = 0; j < n; j++) {
        // j = 0 is the newest sample; walk backwards through the ring.
        const src = j < rb.count ? (rb.head - j + n * 2) % n : -1;
        const v0 = base + j * 2, v1 = v0 + 1;
        if (src < 0) {
          this.ribAlpha[v0] = 0; this.ribAlpha[v1] = 0;
          const p0 = v0 * 3, p1 = v1 * 3;
          this.ribPos[p0] = prevX; this.ribPos[p0 + 1] = prevY; this.ribPos[p0 + 2] = prevZ;
          this.ribPos[p1] = prevX; this.ribPos[p1 + 1] = prevY; this.ribPos[p1 + 2] = prevZ;
          continue;
        }
        const px = rb.x[src], py = rb.y[src], pz = rb.z[src];
        const u = clamp01((this.time - rb.born[src]) / rb.life);

        // Direction along the trail, from the neighbour that exists.
        const nx = j > 0 ? prevX - px : 0, ny = j > 0 ? prevY - py : 0, nz = j > 0 ? prevZ - pz : 0;
        let dx = nx, dy = ny, dz = nz;
        if (j === 0 && rb.count > 1) {
          const s2 = (rb.head - 1 + n) % n;
          dx = px - rb.x[s2]; dy = py - rb.y[s2]; dz = pz - rb.z[s2];
        }
        const dl = Math.hypot(dx, dy, dz);
        if (dl > 1e-4) { dx /= dl; dy /= dl; dz /= dl; } else { dx = 0; dy = 0; dz = 1; }

        // Open quickly behind the head, hold, then taper away. Tapering from the head — the
        // obvious choice — makes a cone; a speed streak has to keep its width to have a length.
        const width = rb.width * (0.30 + 0.70 * smoothstep(u / 0.10))
          * (1 - smoothstep((u - 0.42) / 0.58));
        const alpha = rb.intensity * Math.pow(1 - u, 1.4);

        const p0 = v0 * 3, p1 = v1 * 3;
        if (rb.mode === 0) {
          // Flat on the turf: widen along the horizontal normal of the path.
          let sx = dz, sz = -dx;
          const sl = Math.hypot(sx, sz);
          if (sl > 1e-4) { sx /= sl; sz /= sl; } else { sx = 1; sz = 0; }
          this.ribPos[p0] = px - sx * width; this.ribPos[p0 + 1] = py; this.ribPos[p0 + 2] = pz - sz * width;
          this.ribPos[p1] = px + sx * width; this.ribPos[p1 + 1] = py; this.ribPos[p1 + 2] = pz + sz * width;
        } else {
          this.ribPos[p0] = px; this.ribPos[p0 + 1] = py; this.ribPos[p0 + 2] = pz;
          this.ribPos[p1] = px; this.ribPos[p1 + 1] = py; this.ribPos[p1 + 2] = pz;
        }
        const d0 = v0 * 3, d1 = v1 * 3;
        this.ribDir[d0] = dx; this.ribDir[d0 + 1] = dy; this.ribDir[d0 + 2] = dz;
        this.ribDir[d1] = dx; this.ribDir[d1 + 1] = dy; this.ribDir[d1 + 2] = dz;
        this.ribWidth[v0] = width; this.ribWidth[v1] = width;
        this.ribMode[v0] = rb.mode; this.ribMode[v1] = rb.mode;
        this.ribAlpha[v0] = alpha; this.ribAlpha[v1] = alpha;
        const c0 = v0 * 3, c1 = v1 * 3;
        this.ribCol[c0] = rb.color.r; this.ribCol[c0 + 1] = rb.color.g; this.ribCol[c0 + 2] = rb.color.b;
        this.ribCol[c1] = rb.color.r; this.ribCol[c1 + 1] = rb.color.g; this.ribCol[c1 + 2] = rb.color.b;

        prevX = px; prevY = py; prevZ = pz;
      }
    }

    if (this.ribDirty) {
      // The flag is also set by the stale branch above, so the zeroed alphas of a trail that
      // has just expired reach the GPU on the frame it dies rather than the next one.
      this.markDirty(this.ribGeo, RIB_ATTRS);
      this.ribDirty = false;
    }
  }

  // ── surface / kit colour ────────────────────────────────────────────────────────────────────

  private syncConditions(w: World): void {
    if (this.condRef === w.conditions) return;
    this.condRef = w.conditions;
    this.surface = w.conditions.surface ?? 'GRASS';
    this.weather = w.conditions.weather ?? 'CLEAR';
    const look = SURFACE_LOOK[this.surface] ?? SURFACE_LOOK.GRASS;
    this.turfBase.set(look.base);
    this.turfDirt.set(look.dirt);
  }

  private syncKits(w: World): void {
    if (this.teamsRef === w.teams) return;
    this.teamsRef = w.teams;
    const kits = resolveKits(w.teams[0], w.teams[1]);
    // The renderer dresses HOME in `primary` and AWAY in `secondary`; the trail has to agree
    // with the shirt or it reads as a second team on the field.
    this.kitCol[0].set(kits.home.primary);
    this.kitCol[1].set(kits.away.secondary);
    for (let i = 0; i < 2; i++) {
      const c = this.kitCol[i];
      // A very dark kit has no trail at all unless it is lifted first.
      const l = c.r * 0.3 + c.g * 0.59 + c.b * 0.11;
      if (l < 0.34) c.lerp(this.tmpCol3.set(i === 0 ? kits.home.accent : kits.away.accent), 0.7);
      const l2 = c.r * 0.3 + c.g * 0.59 + c.b * 0.11;
      if (l2 < 0.30) c.multiplyScalar(0.30 / Math.max(0.04, l2));
      // Additive light clips channel by channel, and a clipped orange is white. Over-saturating
      // first is what keeps the hue legible once the trail is bright enough to bloom.
      c.offsetHSL(0, 0.30, 0);
    }
  }

  /**
   * A believable divot: mostly living surface, sometimes the soil under it.
   *
   * The gain is not decoration. `SURFACE_LOOK.base` is an albedo, and these sprites are unlit —
   * written raw it comes out looking like turf in deep shadow against turf in full key light,
   * which reads as dirt rather than as grass.
   */
  private pickTurf(out: THREE.Color): void {
    // A field with no grass on it throws up almost nothing but soil.
    const bare = this.surface === 'MUD' || this.surface === 'SAND' || this.surface === 'ASPHALT';
    if (Math.random() < (bare ? 0.62 : 0.24)) out.copy(this.turfDirt);
    else out.copy(this.turfBase);
    if (this.weather === 'SNOW') out.lerp(this.tmpCol3.setRGB(0.92, 0.95, 1.0), 0.55);
    out.multiplyScalar(1.5 + Math.random() * 1.1);
  }

  /**
   * Directional debris. `dx/dz` is the direction the material is thrown in (already the opposite
   * of the motion that made it); `power` 0..1 sets count, speed and size.
   */
  private spray(
    x: number, y: number, z: number, dx: number, dz: number, power: number, kind: BurstKind,
  ): void {
    const p = clamp01(power);
    const dir = Math.hypot(dx, dz) > 0.01;
    const n = Math.max(1, Math.round(lerp(5, 26, p) * this.quality.particleScale));
    for (let i = 0; i < n; i++) {
      // Around the throw direction when there is one, radial when there is not.
      const spread = dir ? (Math.random() - 0.5) * 1.7 : Math.random() * Math.PI * 2;
      const ca = dir ? Math.cos(spread) : 1;
      const sa = dir ? Math.sin(spread) : 1;
      let ex: number, ez: number;
      if (dir) { ex = dx * ca - dz * sa; ez = dx * sa + dz * ca; }
      else { ex = Math.cos(spread); ez = Math.sin(spread); }

      const sp = lerp(1.8, 9.5, Math.random()) * (0.45 + p);
      const up = lerp(2.2, 7.5, Math.random()) * (0.5 + p * 0.9);
      switch (kind) {
        case 'SPARK':
          this.tmpCol2.setRGB(2.8, 1.5 + Math.random() * 0.6, 0.5);
          this.mote(x, y + 0.1, z, ex * sp, up, ez * sp,
            lerp(0.2, 0.45, Math.random()), lerp(0.16, 0.32, Math.random()), -1.0, this.tmpCol2);
          continue;
        case 'WATER':
          this.tmpCol2.setRGB(0.62, 0.74, 0.9).multiplyScalar(0.8 + Math.random() * 0.5);
          break;
        case 'SMOKE':
          this.tmpCol2.setRGB(0.86, 0.9, 0.98).multiplyScalar(0.7 + Math.random() * 0.4);
          break;
        default:
          this.pickTurf(this.tmpCol2);
          break;
      }
      const big = kind === 'SMOKE';
      this.debris(
        x + (Math.random() - 0.5) * 0.4, y + Math.random() * 0.2, z + (Math.random() - 0.5) * 0.4,
        ex * sp, up, ez * sp,
        big ? lerp(0.6, 1.2, Math.random()) : lerp(0.4, 0.95, Math.random()),
        big ? lerp(0.7, 1.3, Math.random()) : lerp(0.14, 0.40, Math.random()),
        this.tmpCol2);
    }

    // A low puff of dust rides with any real spray. It is what sells the ground being disturbed.
    if (p > 0.5 && this.quality.tier !== 'LOW') {
      const puffs = Math.max(1, Math.round(3 * this.quality.particleScale));
      for (let i = 0; i < puffs; i++) {
        this.tmpCol2.copy(this.turfDirt).multiplyScalar(1.5).addScalar(0.10);
        this.mote(x + (Math.random() - 0.5) * 0.8, y + 0.2 + Math.random() * 0.3,
          z + (Math.random() - 0.5) * 0.8,
          (dx + (Math.random() - 0.5) * 0.8) * 1.4, 0.7, (dz + (Math.random() - 0.5) * 0.8) * 1.4,
          lerp(0.35, 0.6, Math.random()), lerp(0.9, 1.6, Math.random()), 0.5, this.tmpCol2);
      }
    }
  }

  dispose(): void {
    // Everything created here is released here. The registry also tracks these, and three's
    // dispose is idempotent, so the double release across `unloadMatch` is harmless.
    this.debGeo.dispose(); this.debMat.dispose();
    this.gloGeo.dispose(); this.gloMat.dispose();
    this.decGeo.dispose(); this.decMat.dispose();
    this.ribGeo.dispose(); this.ribMat.dispose();
    this.sprite.dispose();
  }
}
