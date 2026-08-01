import * as THREE from 'three';
import type { Conditions, StadiumDef, TeamDef, SurfaceKind, WeatherKind } from '../../core/types.ts';
import type { SceneRegistry, QualitySettings } from '../registry.ts';
import { fieldMarkingsTexture, turfTexture, turfMicroTexture, fieldWearTexture, SURFACE_LOOK } from './textures.ts';
import { GeoBatch, chamferBox } from './geo.ts';
import { SURF, applySurfaceShader, makeRimUniforms, type RimUniforms } from '../surfaces.ts';
import { rimUniforms } from '../athleteRig.ts';

/**
 * The playing surface and everything painted, planted or parked on it.
 *
 * The 120 × 53.33 yd surface is ONE mesh with ONE material: a tiling turf detail map, a tiling
 * micro-relief map, a field-scale wear mask and the single field-markings colour map are combined
 * inside one physically-shaded pass, so every yard line, number, hash, mow band, scuff and
 * end-zone wordmark costs zero extra draw calls.
 *
 * The mow bands are the reason this is a `MeshStandardMaterial` and not a painted texture. Real
 * mown turf does not change colour band to band — it changes *direction*. Grass laid over toward
 * the mower shows you its flat leaf faces and goes bright and glossy; grass laid away shows you
 * its edges and goes dark and matte, and the two swap the moment you walk to the other end. That
 * only happens if the normal and the roughness alternate, which needs a real BRDF and the venue's
 * environment map behind it. Everything else here — wear, weather, the paint sitting slightly
 * proud of the grass — rides on the same shader for free.
 */

const HALF_W = 26.665;
const LENGTH = 120;          // z ∈ [-10, 110]
const CENTER_Z = 50;
const TURF_TILE = 10;        // yards per turf detail (albedo) tile
const MICRO_TILE = 7;        // yards per micro-relief tile — deliberately not a factor of 5 or 10,
                             // so the relief never lines up with the mow bands or the yard lines
const MOW_PERIOD = 10;       // yards for a light+dark pair, i.e. 5-yard bands on the 5-yard lines
/** Apron reaches the largest rectangle that fits inside the stadium bowl's inner wall. */
const APRON_OUT_X = 37;
const APRON_OUT_Z = 16;      // beyond each end line

export const GOAL_HALF_WIDTH = 9.25;
export const CROSSBAR_Y = 10 / 3;          // 10 feet
export const UPRIGHT_TOP_Y = CROSSBAR_Y + 10;

export interface GoalInfo {
  /** Crossbar centre of the goal defended at z = 0. */
  home: THREE.Vector3;
  /** Crossbar centre of the goal defended at z = 100. */
  away: THREE.Vector3;
  halfWidth: number;
  crossbarY: number;
  uprightTopY: number;
  /** Tops of all four uprights, for effects and camera framing. */
  uprightTops: THREE.Vector3[];
}

export interface FieldOptions {
  home: TeamDef;
  away: TeamDef;
  stadium: StadiumDef;
  conditions: Conditions;
  quality: QualitySettings;
}

export interface FieldHandle {
  group: THREE.Group;
  turf: THREE.Mesh;
  goal: GoalInfo;
  setLos(z: number): void;
  setFirstDown(z: number): void;
  setMarkersVisible(v: boolean): void;
  setGoalOcclusion(camZ: number, focusZ: number, dt: number): void;
  update(dt: number): void;
  dispose(): void;
}

// ───────────────────────────────────────────────────────────── turf shading

interface TurfTuning {
  /** Roughness of pristine surface, and how far the micro-relief pushes it either way. */
  roughBase: number; roughVar: number;
  /** Mow band response: albedo, roughness and normal-tilt deltas between neighbouring bands. */
  mowTone: number; mowRough: number; mowTilt: number;
  wearDark: number; wearRough: number;
  paintRough: number; paintGain: number; paintProud: number;
  /** Weather/surface switches consumed by the shader, all 0..1. */
  wet: number; snow: number; mud: number; frost: number;
  normalScale: number; envGain: number; macroBump: number;
}

/**
 * How the surface answers the sky.
 *
 * Wet grass is not darker *and* shinier by coincidence — water fills the gaps between the blades,
 * which removes the diffuse scattering that made it bright and replaces it with a specular sheet,
 * so albedo drops and roughness drops together. Snow does the opposite on both counts. Getting
 * that pairing right is most of why weather reads at all.
 */
function turfTuning(surface: SurfaceKind, weather: WeatherKind): TurfTuning {
  const look = SURFACE_LOOK[surface];
  const living = surface === 'GRASS' || surface === 'TURF';
  const t: TurfTuning = {
    roughBase: look.rough,
    roughVar: living ? 0.26 : 0.16,
    mowTone: look.stripe * 0.34,
    mowRough: look.mow,
    mowTilt: living ? 0.34 : 0.10,
    // A mud ground is defined by how much of it has been churned away, so its wear runs to the
    // top of the range; sand and asphalt have no grass to lose.
    wearDark: surface === 'MUD' ? 1.0 : living ? 0.78 : 0.48,
    wearRough: 0.17,
    paintRough: 0.50,
    paintGain: surface === 'FROZEN' || surface === 'SAND' ? 0.55 : 1.0,
    paintProud: 0.45,
    wet: 0,
    snow: 0,
    mud: surface === 'MUD' ? 1 : 0,
    frost: surface === 'FROZEN' ? 1 : 0,
    normalScale: living ? 1.15 : 0.85,
    envGain: 0.58,
    macroBump: living ? 1.0 : 0.6,
  };
  switch (weather) {
    // A soaked field is the best-looking one: it stops being a colour and starts being a mirror
    // for the towers, and every hollow the groundskeeper never fixed shows up as a bright patch.
    case 'RAIN': t.wet = 1; t.envGain = 0.95; t.mowTilt *= 0.7; break;
    case 'FOG': t.wet = 0.32; break;
    case 'SNOW': t.snow = 1; t.envGain = 0.72; t.mowTilt *= 0.45; break;
    case 'HEAT': t.roughBase = Math.min(1, look.rough + 0.07); t.wearDark *= 1.15; break;
    default: break;
  }
  return t;
}

/**
 * World +Z and world +X in view space, so the shader can lean the nap along the mow direction
 * without needing to know where the camera is. Declared on both stages.
 */
const TURF_VARYINGS = /* glsl */`
varying vec3 vMowDir;
varying vec3 vFieldX;`;

const TURF_VERT_BODY = /* glsl */`
vMowDir = normalize( ( modelViewMatrix * vec4( 0.0, 0.0, 1.0, 0.0 ) ).xyz );
vFieldX = normalize( ( modelViewMatrix * vec4( 1.0, 0.0, 0.0, 0.0 ) ).xyz );`;

const TURF_FRAG_PARS = /* glsl */`
uniform sampler2D uMarks;
uniform sampler2D uWear;
uniform vec2  uTurfRepeat;
uniform float uDetailBias;
uniform float uDetailGain;
uniform float uMowPeriod;
uniform vec3  uMow;        // x albedo, y roughness, z normal tilt
uniform vec3  uWearTint;
uniform vec2  uWearAmt;    // x darkening, y roughening
uniform vec2  uRough;      // x base, y micro variation
uniform vec3  uPaint;      // x roughness, y gain, z proudness
uniform vec4  uWx;         // x wet, y snow, z mud, w frost
uniform float uMacro;
// Resolved once in the albedo pass and reused by the roughness and normal passes.
float goPaintM;
float goMowM;
float goWearM;
float goDampM;
float goRoughX;
float goFarM;`;

const TURF_FRAG_ALBEDO = /* glsl */`
vec2 goUv = vMapUv;
float goZ = 110.0 - goUv.y * 120.0;

vec3 goMarks = texture2D( uMarks, goUv ).rgb;
vec3 goNap   = texture2D( map, goUv * uTurfRepeat ).rgb;
vec3 goWear3 = texture2D( uWear, goUv ).rgb;

goWearM  = clamp( goWear3.r, 0.0, 1.0 );
goRoughX = goWear3.g;
goDampM  = clamp( goWear3.b, 0.0, 1.0 );

// Paint identifies itself: it is the only bright *neutral* thing painted on the field, so a
// brightness test crossed with a saturation test separates it from every team colour going.
float goMx = max( goMarks.r, max( goMarks.g, goMarks.b ) );
float goMn = min( goMarks.r, min( goMarks.g, goMarks.b ) );
goPaintM = smoothstep( 0.60, 0.80, goMx ) * ( 1.0 - smoothstep( 0.08, 0.24, goMx - goMn ) );
goPaintM *= uPaint.y * ( 1.0 - 0.5 * goWearM );

// Mown bands straight off world Z, 5 yards each so every seam lands on a 5-yard line. The edge
// softens to match the pixel footprint, so once a band is thinner than a pixel the whole term
// collapses to zero instead of turning the far end of the field into a moire fence.
float goFw = fwidth( goZ ) / uMowPeriod;
float goEdge = clamp( goFw * 1.7, 0.035, 0.5 );
float goT = fract( goZ / uMowPeriod );
goMowM = ( smoothstep( 0.0, goEdge, goT ) - smoothstep( 0.5, 0.5 + goEdge, goT ) ) * 2.0 - 1.0;

goFarM = smoothstep( 34.0, 150.0, length( vViewPosition ) );

vec3 goCol = goMarks * ( uDetailBias + uDetailGain * goNap );
goCol *= 1.0 + uMow.x * goMowM * ( 1.0 - goPaintM * 0.7 );
// Chlorophyll is never even across a hundred yards: the patches the sprinklers favour run
// bluer, the ones they miss run yellow.
goCol *= mix( vec3( 0.97, 1.01, 1.04 ), vec3( 1.07, 0.99, 0.88 ), clamp( goRoughX * 1.3, 0.0, 1.0 ) );

// Wear, in the order it actually happens: grass thins and goes pale and yellow long before it
// gives up, and only the very worst of it is bare soil. Modulating by the blade detail keeps the
// edge of a worn patch ragged instead of airbrushed.
float goWk = clamp( goWearM * uWearAmt.x * ( 0.45 + 1.15 * goNap.r ), 0.0, 0.88 );
// Thinning grass keeps its brightness and loses its colour — lifting red and blue against green
// yellows it without turning the middle of the field into a grey wash.
vec3 goPale = goCol * vec3( 2.60, 1.04, 1.20 );
vec3 goSoil = uWearTint * ( 0.60 + 0.85 * goNap.g );
goCol = mix( goCol, goPale, smoothstep( 0.0, 0.60, goWk ) );
goCol = mix( goCol, goSoil, smoothstep( 0.45, 1.0, goWk ) );

// Mud goes patchy rather than uniformly brown.
goCol = mix( goCol, goCol * ( 0.42 + 0.55 * goNap.r ), uWx.z * ( 0.45 + 0.55 * goDampM ) );

// Wet ground loses albedo; the gloss that replaces it is handled in the roughness pass.
goCol *= mix( 1.0, 0.66, uWx.x * ( 0.45 + 0.55 * goDampM ) );

// Snow settles in the low ground and the scuffed ground first and blows off the crown, so it
// lands patchy rather than as a bedsheet — and it gets swept off the paint, because a field
// nobody can find the yard lines on is not a field anybody wants to play on.
float goSnowK = uWx.y * ( 0.30 + 0.44 * goDampM + 0.26 * goWearM ) * ( 0.55 + 0.85 * goNap.b );
goSnowK = clamp( goSnowK * ( 1.0 - 0.55 * goPaintM ), 0.0, 0.88 );
goCol = mix( goCol, mix( vec3( dot( goCol, vec3( 0.3333 ) ) ), vec3( 0.74, 0.78, 0.86 ), 0.88 ), goSnowK );

// Frozen ground goes pale and gives up its colour without going white.
goCol = mix( goCol, mix( goCol, vec3( 0.60, 0.68, 0.71 ), 0.5 ), uWx.w );

diffuseColor.rgb *= goCol;`;

const TURF_FRAG_ROUGH = /* glsl */`
float goR = uRough.x;
goR += uRough.y * ( texture2D( normalMap, vNormalMapUv ).a - 0.5 ) * 2.0 * ( 1.0 - goFarM );
goR += uMow.y * goMowM;
goR += uWearAmt.y * goWearM;
goR += 0.15 * ( goRoughX - 0.22 );
goR = mix( goR, uPaint.x, goPaintM );
goR = mix( goR, 0.13, uWx.x * clamp( 0.5 + 0.5 * goDampM, 0.0, 1.0 ) );
goR = mix( goR, 0.17, uWx.w * 0.85 );
goR = mix( goR, 0.90, uWx.y * 0.75 );
// Dry grass is never glossier than this. A 0.05 floor let the mow bands go near-specular at
// grazing incidence, which blew the middle distance out to a white band across the field.
float goFloor = mix( 0.34, 0.12, clamp( max( uWx.x, uWx.w ), 0.0, 1.0 ) );
roughnessFactor = clamp( goR, goFloor, 1.0 );`;

const TURF_FRAG_NORMAL = /* glsl */`
{
  vec3 goFlat = normalize( vNormal );
  // Blade-scale relief has no business surviving to the far end of the field; it only aliases.
  normal = normalize( mix( goFlat, normal, 1.0 - 0.9 * goFarM ) );

  // Macro undulation. Three incommensurate swells, differentiated analytically, wavelengths in
  // the 25–40 yard range: a real field is crowned and settled, and a plane is exactly what the
  // old one looked like.
  float gX = ( vMapUv.x - 0.5 ) * 53.33;
  float gZ = 110.0 - vMapUv.y * 120.0;
  float w1 = cos( gX * 0.171 + gZ * 0.083 + 0.7 );
  float w2 = cos( gX * -0.094 + gZ * 0.211 + 2.3 );
  float w3 = cos( gX * 0.263 + gZ * 0.147 + 4.1 );
  float dhx = w1 * 0.0445 + w2 * -0.0188 + w3 * 0.0316;
  float dhz = w1 * 0.0216 + w2 *  0.0422 + w3 * 0.0176;
  normal = normalize( normal - ( vFieldX * dhx + vMowDir * dhz ) * uMacro );

  // The mow itself: grass laid toward the mower and grass laid away from it, which is the whole
  // reason the bands change places when you look from the other end.
  normal = normalize( normal - vMowDir * ( goMowM * uMow.z * ( 1.0 - goPaintM * 0.8 ) ) );

  // Paint fills the gaps between the blades, so it is flatter than the grass and stands very
  // slightly proud of it. The bevel comes from the gradient of the mask itself.
  normal = normalize( mix( normal, goFlat, goPaintM * 0.8 ) );
  vec2 goPg = clamp( vec2( dFdx( goPaintM ), dFdy( goPaintM ) ), -0.6, 0.6 );
  normal = normalize( normal - vec3( goPg * uPaint.z, 0.0 ) );
}`;

function markerTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 64;
  const g = c.getContext('2d');
  if (!g) throw new Error('2D canvas context unavailable');
  const grad = g.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0.00, 'rgba(255,255,255,0)');
  grad.addColorStop(0.34, 'rgba(255,255,255,0.28)');
  grad.addColorStop(0.46, 'rgba(255,255,255,1)');
  grad.addColorStop(0.54, 'rgba(255,255,255,1)');
  grad.addColorStop(0.66, 'rgba(255,255,255,0.28)');
  grad.addColorStop(1.00, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildField(reg: SceneRegistry, o: FieldOptions): FieldHandle {
  const group = reg.group('env.field');
  const q = o.quality;
  const surface = o.conditions.surface ?? o.stadium.surface;
  const look = SURFACE_LOOK[surface];

  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const texs: THREE.Texture[] = [];
  const keep = <T extends THREE.BufferGeometry>(g: T): T => { geos.push(g); return g; };
  const keepM = <T extends THREE.Material>(m: T): T => { mats.push(m); return m; };

  // ── turf + markings, one mesh ──────────────────────────────────────────
  /** LOW keeps the cheap forward-shaded field; everything else gets the full surface. */
  const rich = q.tier !== 'LOW';
  const tune = turfTuning(surface, o.conditions.weather);
  const detail = turfTexture(surface, q, false);
  const wearMap = fieldWearTexture(surface, q);
  const marks = fieldMarkingsTexture({
    home: o.home.colors,
    away: o.away.colors,
    homeLabel: o.home.name,
    awayLabel: o.away.name,
    surface,
    accent: o.stadium.accent,
    quality: q,
  });
  const micro = rich ? turfMicroTexture(surface, q) : null;
  if (micro) micro.repeat.set((HALF_W * 2) / MICRO_TILE, LENGTH / MICRO_TILE);

  const turfGeo = keep(new THREE.PlaneGeometry(HALF_W * 2, LENGTH, 1, 1));
  turfGeo.rotateX(-Math.PI / 2);
  turfGeo.translate(0, 0, CENTER_Z);

  const turfUniforms = {
    uMarks: { value: marks },
    uWear: { value: wearMap },
    uTurfRepeat: { value: new THREE.Vector2((HALF_W * 2) / TURF_TILE, LENGTH / TURF_TILE) },
    uDetailBias: { value: 0.30 },
    uDetailGain: { value: 1.42 },
    uMowPeriod: { value: MOW_PERIOD },
    uMow: { value: new THREE.Vector3(tune.mowTone, tune.mowRough, tune.mowTilt) },
    uWearTint: { value: new THREE.Color(look.dirt) },
    uWearAmt: { value: new THREE.Vector2(tune.wearDark, tune.wearRough) },
    uRough: { value: new THREE.Vector2(tune.roughBase, tune.roughVar) },
    uPaint: { value: new THREE.Vector3(tune.paintRough, tune.paintGain, tune.paintProud) },
    uWx: { value: new THREE.Vector4(tune.wet, tune.snow, tune.mud, tune.frost) },
    uMacro: { value: tune.macroBump },
  };

  let turfMat: THREE.Material;
  /** Non-null on the physically-shaded path; `update` keeps its gain in step with the venue. */
  let fieldRim: RimUniforms | null = null;

  if (rich) {
    const mat = keepM(new THREE.MeshStandardMaterial({
      map: detail,
      color: 0xffffff,
      roughness: tune.roughBase,
      metalness: 0,
      normalMap: micro,
      normalScale: new THREE.Vector2(tune.normalScale, tune.normalScale),
      envMapIntensity: tune.envGain,
      dithering: true,
    }));
    // The turf carries the rim too, at a fraction of the athletes' strength — enough that the far
    // end of the field picks up the venue's edge colour and reads as distance, not as a bald plane.
    // Sharing the Color instance means a venue re-tune reaches the turf without a second call.
    fieldRim = makeRimUniforms(new THREE.Color(), rimUniforms.uRimGain.value * SURF.TURF.rim, 3.4);
    fieldRim.uRimColor.value = rimUniforms.uRimColor.value;
    applySurfaceShader(mat, fieldRim, false);
    const baseCompile = mat.onBeforeCompile;
    mat.onBeforeCompile = (shader, renderer): void => {
      baseCompile.call(mat, shader, renderer);
      for (const [k, v] of Object.entries(turfUniforms)) shader.uniforms[k] = v;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${TURF_VARYINGS}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${TURF_VERT_BODY}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${TURF_FRAG_PARS}\n${TURF_VARYINGS}`)
        .replace('#include <map_fragment>', TURF_FRAG_ALBEDO)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${TURF_FRAG_ROUGH}`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${TURF_FRAG_NORMAL}`);
    };
    mat.customProgramCacheKey = () => 'go-env-turf-std';
    turfMat = mat;
  } else {
    const mat = keepM(new THREE.MeshPhongMaterial({
      map: detail,
      color: 0xffffff,
      specular: new THREE.Color(surface === 'FROZEN' ? 0x3a4650 : 0x161c14),
      shininess: surface === 'FROZEN' ? 46 : surface === 'MUD' ? 26 : 14,
    }));
    mat.onBeforeCompile = (shader): void => {
      for (const [k, v] of Object.entries(turfUniforms)) shader.uniforms[k] = v;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${TURF_FRAG_PARS}`)
        .replace('#include <map_fragment>', TURF_FRAG_ALBEDO);
    };
    mat.customProgramCacheKey = () => 'go-env-turf-lite';
    turfMat = mat;
  }

  const turf = new THREE.Mesh(turfGeo, turfMat);
  turf.name = 'turf';
  turf.receiveShadow = q.shadows;
  turf.matrixAutoUpdate = false;
  turf.updateMatrix();
  group.add(turf);

  // ── apron ──────────────────────────────────────────────────────────────
  {
    const apron = new GeoBatch();
    const col = new THREE.Color(look.blotch).multiplyScalar(1.55);
    const inset = 0.06;   // tuck under the field edge; polygonOffset keeps the field on top
    const quad = (x0: number, x1: number, z0: number, z1: number): void => {
      const u = (v: number): number => v / TURF_TILE;
      apron.addQuad(
        { x: x0, y: 0, z: z0 }, { x: x1, y: 0, z: z0 }, { x: x1, y: 0, z: z1 }, { x: x0, y: 0, z: z1 },
        col, { x: 0, y: 1, z: 0 },
        [u(x0), u(z0), u(x1), u(z0), u(x1), u(z1), u(x0), u(z1)],
      );
    };
    quad(-APRON_OUT_X, -HALF_W + inset, -10 - APRON_OUT_Z, 110 + APRON_OUT_Z);
    quad(HALF_W - inset, APRON_OUT_X, -10 - APRON_OUT_Z, 110 + APRON_OUT_Z);
    quad(-HALF_W + inset, HALF_W - inset, -10 - APRON_OUT_Z, -10 + inset);
    quad(-HALF_W + inset, HALF_W - inset, 110 - inset, 110 + APRON_OUT_Z);
    const g = keep(apron.build());
    // Matched to the field so the two do not read as different materials at the sideline.
    const m = keepM(rich
      ? new THREE.MeshStandardMaterial({
        map: detail, vertexColors: true, roughness: Math.min(1, tune.roughBase + 0.12), metalness: 0,
        envMapIntensity: tune.envGain * 0.8, dithering: true,
        polygonOffset: true, polygonOffsetFactor: 1.4, polygonOffsetUnits: 1.4,
      })
      : new THREE.MeshPhongMaterial({
        map: detail, vertexColors: true, shininess: 8, specular: new THREE.Color(0x0c0f0c),
        polygonOffset: true, polygonOffsetFactor: 1.4, polygonOffsetUnits: 1.4,
      }));
    const mesh = new THREE.Mesh(g, m);
    mesh.receiveShadow = q.shadows;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }

  // ── goalposts ──────────────────────────────────────────────────────────
  const goal: GoalInfo = {
    home: new THREE.Vector3(0, CROSSBAR_Y, 0),
    away: new THREE.Vector3(0, CROSSBAR_Y, 100),
    halfWidth: GOAL_HALF_WIDTH,
    crossbarY: CROSSBAR_Y,
    uprightTopY: UPRIGHT_TOP_Y,
    uprightTops: [
      new THREE.Vector3(-GOAL_HALF_WIDTH, UPRIGHT_TOP_Y, 0),
      new THREE.Vector3(GOAL_HALF_WIDTH, UPRIGHT_TOP_Y, 0),
      new THREE.Vector3(-GOAL_HALF_WIDTH, UPRIGHT_TOP_Y, 100),
      new THREE.Vector3(GOAL_HALF_WIDTH, UPRIGHT_TOP_Y, 100),
    ],
  };
  /** One mesh per end so the goal standing between the camera and the ball can fade out. */
  const goalMeshes: THREE.Mesh[] = [];
  {
    const metal = new THREE.Color('#ffd21e');
    const metalDark = new THREE.Color('#c99b10');
    const pad = new THREE.Color('#1b1f26');
    const seg = q.tier === 'LOW' ? 6 : 10;

    for (const gz of [0, 100]) {
      const batch = new GeoBatch();
      batch.uvScale = 0.5;
      const tube = (radius: number, from: THREE.Vector3, to: THREE.Vector3, color: THREE.Color): void => {
        const dir = new THREE.Vector3().subVectors(to, from);
        const len = dir.length();
        if (len < 1e-5) return;
        const g = new THREE.CylinderGeometry(radius, radius, len, seg, 1, false);
        const m = new THREE.Matrix4();
        const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
        m.compose(new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5), quat, new THREE.Vector3(1, 1, 1));
        batch.addGeometry(g, m, color);
      };
      const back = gz === 0 ? -1 : 1;           // away from the field of play
      const baseZ = gz + back * 1.35;
      // Padded base sleeve.
      const padGeo = new THREE.CylinderGeometry(0.34, 0.38, 1.9, seg, 1, false);
      const padM = new THREE.Matrix4().makeTranslation(0, 0.95, baseZ);
      batch.addGeometry(padGeo, padM, pad);
      // Main post.
      tube(0.17, new THREE.Vector3(0, 0.1, baseZ), new THREE.Vector3(0, CROSSBAR_Y - 0.55, baseZ), metalDark);
      // Gooseneck: quarter sweep from the post top forward to the crossbar centre.
      const pts: THREE.Vector3[] = [];
      const steps = q.tier === 'LOW' ? 5 : 9;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const a = (t * Math.PI) / 2;
        pts.push(new THREE.Vector3(
          0,
          CROSSBAR_Y - 0.55 + Math.sin(a) * 0.55,
          baseZ - back * (1 - Math.cos(a)) * 1.35,
        ));
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      batch.addGeometry(new THREE.TubeGeometry(curve, steps * 2, 0.15, seg, false), null, metalDark);
      // Crossbar + uprights.
      tube(0.14, new THREE.Vector3(-GOAL_HALF_WIDTH, CROSSBAR_Y, gz), new THREE.Vector3(GOAL_HALF_WIDTH, CROSSBAR_Y, gz), metal);
      for (const sx of [-1, 1]) {
        tube(0.115, new THREE.Vector3(sx * GOAL_HALF_WIDTH, CROSSBAR_Y - 0.12, gz), new THREE.Vector3(sx * GOAL_HALF_WIDTH, UPRIGHT_TOP_Y, gz), metal);
        // Wind ribbon at the top of each upright.
        const rib = new THREE.PlaneGeometry(0.12, 1.0);
        const rm = new THREE.Matrix4().makeRotationY(Math.PI / 2);
        rm.setPosition(sx * GOAL_HALF_WIDTH, UPRIGHT_TOP_Y - 0.55, gz + 0.16);
        batch.addGeometry(rib, rm, new THREE.Color('#ff5a2a'));
      }
      const g = keep(batch.build());
      const m = keepM(new THREE.MeshPhongMaterial({
        vertexColors: true, shininess: 88, specular: new THREE.Color(0x8f7a2a),
        side: THREE.DoubleSide, transparent: true, opacity: 1, depthWrite: true,
      }));
      const mesh = new THREE.Mesh(g, m);
      mesh.castShadow = q.shadows;
      mesh.matrixAutoUpdate = false;
      mesh.renderOrder = 2;
      group.add(mesh);
      goalMeshes.push(mesh);
    }
  }
  /** Current opacity per end, eased so the fade is never a pop. */
  const goalFade = [1, 1];

  // ── LOS + first-down markers ───────────────────────────────────────────
  const markerGroup = new THREE.Group();
  markerGroup.name = 'field.markers';
  group.add(markerGroup);
  const markTex = markerTexture();
  texs.push(markTex);
  const markGeo = keep(new THREE.PlaneGeometry(HALF_W * 2, 1.5, 1, 1));
  markGeo.rotateX(-Math.PI / 2);

  const makeMarker = (hex: number, y: number): { root: THREE.Group; mat: THREE.MeshBasicMaterial } => {
    const root = new THREE.Group();
    const mat = keepM(new THREE.MeshBasicMaterial({
      map: markTex, color: hex, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }));
    const plane = new THREE.Mesh(markGeo, mat);
    plane.position.y = y;
    plane.renderOrder = 2;
    root.add(plane);
    // Chain-gang pylons on both sidelines so the line reads even side-on.
    const postGeo = keep(new THREE.BoxGeometry(0.18, 1.7, 0.18));
    const postMat = keepM(new THREE.MeshBasicMaterial({ color: hex, toneMapped: false }));
    for (const sx of [-1, 1]) {
      const p = new THREE.Mesh(postGeo, postMat);
      p.position.set(sx * (HALF_W + 1.4), 0.85, 0);
      root.add(p);
    }
    markerGroup.add(root);
    return { root, mat };
  };
  const los = makeMarker(0x63d4ff, 0.035);
  const firstDown = makeMarker(0xffd23f, 0.05);

  // ── sideline dressing ──────────────────────────────────────────────────
  const propMat = keepM(new THREE.MeshPhongMaterial({
    vertexColors: true, shininess: 34, specular: new THREE.Color(0x2a2f36), flatShading: true,
  }));
  const instanced: THREE.InstancedMesh[] = [];

  const addInstanced = (geo: THREE.BufferGeometry, mat: THREE.Material, xforms: THREE.Matrix4[]): void => {
    if (xforms.length === 0) return;
    const im = new THREE.InstancedMesh(geo, mat, xforms.length);
    for (let i = 0; i < xforms.length; i++) im.setMatrixAt(i, xforms[i]);
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = q.shadows;
    im.receiveShadow = false;
    im.frustumCulled = false;
    group.add(im);
    instanced.push(im);
  };
  const xf = (x: number, y: number, z: number, yaw: number): THREE.Matrix4 => {
    const m = new THREE.Matrix4().makeRotationY(yaw);
    m.setPosition(x, y, z);
    return m;
  };

  const teamCol: [THREE.Color, THREE.Color] = [
    new THREE.Color(o.home.colors.primary),
    new THREE.Color(o.away.colors.primary),
  ];
  const frame = new THREE.Color('#2b3038');
  const frameLite = new THREE.Color('#454c56');

  // Bench (one geometry, tinted per side via two instanced meshes).
  for (const side of [0, 1] as const) {
    const b = new GeoBatch();
    b.uvScale = 0.3;
    chamferBox(b, 7.0, 0.22, 1.0, 0.06, teamCol[side], new THREE.Matrix4().makeTranslation(0, 1.02, 0));
    chamferBox(b, 7.0, 0.85, 0.16, 0.05, teamCol[side].clone().multiplyScalar(0.7), new THREE.Matrix4().makeTranslation(0, 1.52, -0.42));
    for (const lx of [-3.1, -1.0, 1.0, 3.1]) {
      chamferBox(b, 0.18, 1.0, 0.8, 0.04, frame, new THREE.Matrix4().makeTranslation(lx, 0.5, 0));
    }
    const g = keep(b.build());
    const z0 = side === 0 ? 34 : 66;
    addInstanced(g, propMat, [
      xf(-32.0, 0, z0 - 9, Math.PI / 2),
      xf(-32.0, 0, z0 + 1, Math.PI / 2),
      xf(32.0, 0, z0 - 9, -Math.PI / 2),
      xf(32.0, 0, z0 + 1, -Math.PI / 2),
    ]);
  }

  // Utility cart.
  {
    const b = new GeoBatch();
    b.uvScale = 0.35;
    chamferBox(b, 3.0, 0.9, 1.6, 0.12, frameLite, new THREE.Matrix4().makeTranslation(0, 0.95, 0));
    chamferBox(b, 2.6, 0.14, 1.5, 0.05, new THREE.Color(o.stadium.accent), new THREE.Matrix4().makeTranslation(0, 2.35, 0));
    for (const px of [-1.1, 1.1]) {
      for (const pz of [-0.62, 0.62]) {
        chamferBox(b, 0.12, 1.3, 0.12, 0.03, frame, new THREE.Matrix4().makeTranslation(px, 1.72, pz));
      }
    }
    for (const wx of [-1.05, 1.05]) {
      for (const wz of [-0.78, 0.78]) {
        const wheel = new THREE.CylinderGeometry(0.36, 0.36, 0.22, 10);
        const m = new THREE.Matrix4().makeRotationZ(Math.PI / 2);
        m.setPosition(wx, 0.36, wz);
        b.addGeometry(wheel, m, new THREE.Color('#14171c'));
      }
    }
    const g = keep(b.build());
    addInstanced(g, propMat, [
      xf(-35.5, 0, 18, Math.PI / 2),
      xf(35.5, 0, 82, -Math.PI / 2),
      xf(-35.5, 0, 88, Math.PI / 2),
    ]);
  }

  // Tripod broadcast camera.
  {
    const b = new GeoBatch();
    b.uvScale = 0.5;
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const m = new THREE.Matrix4().makeRotationZ(Math.cos(a) * 0.30);
      m.multiply(new THREE.Matrix4().makeRotationX(Math.sin(a) * 0.30));
      m.setPosition(Math.sin(a) * 0.42, 1.05, Math.cos(a) * 0.42);
      chamferBox(b, 0.11, 2.1, 0.11, 0.03, frame, m);
    }
    chamferBox(b, 0.9, 0.62, 1.25, 0.10, new THREE.Color('#20252c'), new THREE.Matrix4().makeTranslation(0, 2.35, 0));
    const lens = new THREE.CylinderGeometry(0.20, 0.24, 0.55, 10);
    const lm = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    lm.setPosition(0, 2.35, 0.82);
    b.addGeometry(lens, lm, new THREE.Color('#0c0e12'));
    chamferBox(b, 0.30, 0.16, 0.16, 0.03, new THREE.Color('#ff3b2f'), new THREE.Matrix4().makeTranslation(0, 2.72, 0.25));
    const g = keep(b.build());
    addInstanced(g, propMat, [
      xf(-34.0, 0, 50, Math.PI / 2),
      xf(34.0, 0, 50, -Math.PI / 2),
      xf(-34.0, 0, 6, Math.PI / 2.4),
      xf(34.0, 0, 94, -Math.PI / 2.4),
    ]);
  }

  // End-zone pylons: four per end zone, at the goal-line and end-line corners.
  {
    const b = new GeoBatch();
    b.uvScale = 1.0;
    chamferBox(b, 0.42, 1.5, 0.42, 0.10, new THREE.Color('#ff7a1a'), new THREE.Matrix4().makeTranslation(0, 0.75, 0));
    const g = keep(b.build());
    const m = keepM(new THREE.MeshPhongMaterial({
      vertexColors: true, emissive: new THREE.Color('#5a2200'),
      emissiveIntensity: 1, shininess: 60, specular: new THREE.Color(0x554433),
    }));
    const xs = [-HALF_W, HALF_W];
    const zs = [-10, 0, 100, 110];
    const list: THREE.Matrix4[] = [];
    for (const x of xs) for (const z of zs) list.push(xf(x, 0, z, 0));
    addInstanced(g, m, list);
  }

  let pulse = 0;
  let disposed = false;

  return {
    group,
    turf,
    goal,
    setLos(z: number): void { los.root.position.z = z; },
    setFirstDown(z: number): void { firstDown.root.position.z = z; },
    setMarkersVisible(v: boolean): void { markerGroup.visible = v; },
    /**
     * Fade out whichever goal is standing between the camera and the action.
     *
     * Near a goal line the camera sits behind the end zone and the crossbar draws a bright
     * yellow bar straight across the play. Hiding it outright would pop, so it eases.
     */
    setGoalOcclusion(camZ: number, focusZ: number, dt: number): void {
      for (let i = 0; i < goalMeshes.length; i++) {
        const gz = i === 0 ? 0 : 100;
        const between = (camZ - gz) * (focusZ - gz) < 0;
        const want = between ? 0.16 : 1;
        goalFade[i] += (want - goalFade[i]) * (1 - Math.exp(-7 * dt));
        const mat = goalMeshes[i].material as THREE.MeshPhongMaterial;
        mat.opacity = goalFade[i];
        mat.depthWrite = goalFade[i] > 0.92;
        goalMeshes[i].castShadow = goalFade[i] > 0.5;
      }
    },
    update(dt: number): void {
      pulse += dt;
      const a = 0.72 + Math.sin(pulse * 3.1) * 0.14;
      los.mat.opacity = a;
      firstDown.mat.opacity = 0.80 + Math.sin(pulse * 3.1 + 1.1) * 0.16;
      // The venue's rim gain is set after the environment is built, so track it rather than
      // sampling it once at build time and being permanently one match behind.
      if (fieldRim) fieldRim.uRimGain.value = rimUniforms.uRimGain.value * SURF.TURF.rim;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const im of instanced) im.dispose();
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      for (const t of texs) t.dispose();
      reg.clearGroup('env.field');
    },
  };
}
