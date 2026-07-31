import * as THREE from 'three';
import type { SceneRegistry, QualitySettings } from '../registry.ts';
import { skyGradient, type SkyKind } from './textures.ts';

/**
 * Sky dome + scene fog.
 *
 * One inverted sphere with a gradient ramp, fbm clouds, a sun/moon disc and a star field. The
 * palette it publishes is the single source of truth for the whole environment's mood — lighting,
 * weather and the stadium trim all read from it so a venue reads as one coherent place.
 */

export interface SkyPalette {
  kind: SkyKind;
  /** Fog colour and base density; weather ramps on top of this. */
  fog: THREE.Color;
  fogDensity: number;
  /** Unit direction pointing TOWARD the key light. */
  sun: THREE.Vector3;
  sunColor: THREE.Color;
  keyIntensity: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiIntensity: number;
  rimColor: THREE.Color;
  rimIntensity: number;
  ambient: number;
  /** Stadium spot lights burn for night and storm venues. */
  towerLights: boolean;
  cloud: number;
  stars: number;
  cloudLit: THREE.Color;
  cloudDark: THREE.Color;
  /** Scoreboard / trim emissive gain — brighter after dark. */
  emissiveGain: number;
}

export function skyPalette(kind: SkyKind): SkyPalette {
  switch (kind) {
    case 'DAY':
      return {
        kind,
        fog: new THREE.Color('#a8cbe6'), fogDensity: 0.0016,
        sun: new THREE.Vector3(0.40, 0.82, -0.41).normalize(),
        sunColor: new THREE.Color('#fff3d6'), keyIntensity: 3.1,
        hemiSky: new THREE.Color('#9fd0ff'), hemiGround: new THREE.Color('#3d5a33'), hemiIntensity: 0.85,
        rimColor: new THREE.Color('#7fb6ff'), rimIntensity: 0.55,
        ambient: 0.18, towerLights: false, cloud: 0.32, stars: 0,
        cloudLit: new THREE.Color('#ffffff'), cloudDark: new THREE.Color('#9db4c8'),
        emissiveGain: 0.75,
      };
    case 'DUSK':
      return {
        kind,
        fog: new THREE.Color('#8a5a66'), fogDensity: 0.0026,
        sun: new THREE.Vector3(0.76, 0.33, -0.56).normalize(),
        sunColor: new THREE.Color('#ffb066'), keyIntensity: 2.7,
        hemiSky: new THREE.Color('#ff9e6b'), hemiGround: new THREE.Color('#2c2440'), hemiIntensity: 0.72,
        rimColor: new THREE.Color('#6a5cff'), rimIntensity: 0.95,
        ambient: 0.16, towerLights: true, cloud: 0.46, stars: 0.25,
        cloudLit: new THREE.Color('#ffc48a'), cloudDark: new THREE.Color('#6b3f5e'),
        emissiveGain: 1.0,
      };
    case 'NIGHT':
      return {
        kind,
        fog: new THREE.Color('#0a1424'), fogDensity: 0.0030,
        sun: new THREE.Vector3(-0.30, 0.88, 0.36).normalize(),
        sunColor: new THREE.Color('#cfe4ff'), keyIntensity: 1.5,
        hemiSky: new THREE.Color('#2b4a78'), hemiGround: new THREE.Color('#101820'), hemiIntensity: 0.55,
        rimColor: new THREE.Color('#5ad2ff'), rimIntensity: 0.85,
        ambient: 0.13, towerLights: true, cloud: 0.18, stars: 1,
        cloudLit: new THREE.Color('#4a5f80'), cloudDark: new THREE.Color('#111a2c'),
        emissiveGain: 1.35,
      };
    default:
      return {
        kind: 'STORM',
        fog: new THREE.Color('#5c6672'), fogDensity: 0.0052,
        sun: new THREE.Vector3(0.26, 0.90, -0.35).normalize(),
        sunColor: new THREE.Color('#cdd6e0'), keyIntensity: 1.6,
        hemiSky: new THREE.Color('#7b8794'), hemiGround: new THREE.Color('#2a2f2c'), hemiIntensity: 0.80,
        rimColor: new THREE.Color('#9fb4c8'), rimIntensity: 0.5,
        ambient: 0.22, towerLights: true, cloud: 0.92, stars: 0,
        cloudLit: new THREE.Color('#8b96a4'), cloudDark: new THREE.Color('#2b323c'),
        emissiveGain: 1.2,
      };
  }
}

const SKY_VS = `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SKY_FS = `
precision highp float;
uniform sampler2D uRamp;
uniform vec3 uSun;
uniform vec3 uSunColor;
uniform vec3 uFogColor;
uniform vec3 uCloudLit;
uniform vec3 uCloudDark;
uniform float uTime;
uniform float uCloud;
uniform float uStars;
uniform float uFlash;
uniform float uWindX;
uniform float uWindZ;
varying vec3 vDir;

float hash21(vec2 p) {
  p = fract(p * vec2(127.31, 311.7));
  p += dot(p, p + 39.42);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < CLOUD_OCT; i++) { s += vnoise(p) * a; p = p * 2.07 + 13.7; a *= 0.5; }
  return s;
}
float stars(vec3 d) {
  vec3 p = d * 190.0;
  vec3 i = floor(p);
  vec3 f = fract(p) - 0.5;
  float h = fract(sin(dot(i, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  float on = step(0.9835, h);
  float tw = 0.55 + 0.45 * sin(uTime * 2.1 + h * 71.0);
  return on * tw * smoothstep(0.40, 0.0, length(f));
}

void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 col = texture2D(uRamp, vec2(0.5, h)).rgb;

  if (uStars > 0.001) {
    col += vec3(0.85, 0.92, 1.0) * stars(d) * uStars * smoothstep(-0.02, 0.30, d.y);
  }

  float sd = max(dot(d, uSun), 0.0);
  col += uSunColor * (pow(sd, 1400.0) * 4.5 + pow(sd, 9.0) * 0.22);

  if (uCloud > 0.001) {
    vec2 cp = d.xz / max(d.y, 0.10) * 0.42 + vec2(uWindX, uWindZ) * uTime * 0.010;
    float cov = fbm(cp);
    float wisp = fbm(cp * 2.9 + 4.0);
    cov = cov * 0.72 + wisp * 0.28;
    float cl = smoothstep(0.50 - uCloud * 0.30, 0.84 - uCloud * 0.22, cov);
    cl *= smoothstep(0.015, 0.24, d.y);
    vec3 cc = mix(uCloudDark, uCloudLit, smoothstep(0.34, 0.86, cov));
    cc += uSunColor * pow(max(dot(d, uSun), 0.0), 5.0) * 0.30;
    col = mix(col, cc, cl * uCloud);
    col += vec3(0.82, 0.88, 1.0) * uFlash * (0.25 + cl * 0.9);
  } else {
    col += vec3(0.82, 0.88, 1.0) * uFlash * 0.25;
  }

  float hz = 1.0 - smoothstep(-0.06, 0.26, d.y);
  col = mix(col, uFogColor, hz * 0.88);

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export interface SkyOptions {
  skyKind: SkyKind;
  quality: QualitySettings;
  /** Wind drift for the cloud layer, yards/sec. */
  windX?: number;
  windZ?: number;
  /** Domed venues wash out the sky and kill the star field. */
  roof?: 0 | 1 | 2;
}

export interface SkyHandle {
  palette: SkyPalette;
  mesh: THREE.Mesh;
  fog: THREE.FogExp2;
  /** Weather owns the ramp above the venue's base density. */
  setFogDensity(d: number): void;
  setFogColor(c: THREE.Color): void;
  flash(power: number): void;
  update(dt: number): void;
  dispose(): void;
}

export function buildSky(reg: SceneRegistry, o: SkyOptions): SkyHandle {
  const palette = skyPalette(o.skyKind);
  const domed = o.roof === 2;
  if (domed) { palette.stars = 0; palette.cloud *= 0.25; }

  const ramp = skyGradient(o.skyKind);
  const oct = o.quality.tier === 'HIGH' ? 5 : o.quality.tier === 'MEDIUM' ? 4 : 2;

  const uniforms: Record<string, THREE.IUniform> = {
    uRamp: { value: ramp },
    uSun: { value: palette.sun.clone() },
    uSunColor: { value: palette.sunColor.clone() },
    uFogColor: { value: palette.fog.clone() },
    uCloudLit: { value: palette.cloudLit.clone() },
    uCloudDark: { value: palette.cloudDark.clone() },
    uTime: { value: 0 },
    uCloud: { value: palette.cloud },
    uStars: { value: palette.stars },
    uFlash: { value: 0 },
    uWindX: { value: o.windX ?? 0.6 },
    uWindZ: { value: o.windZ ?? 0.25 },
  };

  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: SKY_VS,
    fragmentShader: SKY_FS,
    defines: { CLOUD_OCT: oct },
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const geo = new THREE.SphereGeometry(420, o.quality.tier === 'LOW' ? 24 : 40, o.quality.tier === 'LOW' ? 14 : 24);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'sky';
  mesh.position.set(0, 0, 50);
  mesh.renderOrder = -1000;
  mesh.frustumCulled = false;
  reg.group('env.sky').add(mesh);

  const fog = new THREE.FogExp2(palette.fog.getHex(), palette.fogDensity);
  fog.color.copy(palette.fog);
  reg.scene.fog = fog;

  let t = 0;
  let flashPower = 0;
  let nextBolt = 3 + (o.skyKind === 'STORM' ? 0 : 1e9);
  let disposed = false;

  return {
    palette,
    mesh,
    fog,
    setFogDensity(d: number): void { fog.density = d; },
    setFogColor(c: THREE.Color): void { fog.color.copy(c); (uniforms.uFogColor.value as THREE.Color).copy(c); },
    flash(power: number): void { flashPower = Math.min(1.6, flashPower + power); },
    update(dt: number): void {
      t += dt;
      uniforms.uTime.value = t;
      if (o.skyKind === 'STORM' && !domed) {
        nextBolt -= dt;
        if (nextBolt <= 0) {
          // Deterministic-enough stutter: two quick strikes then a long gap.
          flashPower = Math.min(1.6, flashPower + 0.9);
          nextBolt = 2.2 + ((t * 37.1) % 6.5);
        }
      }
      if (flashPower > 0.0005) {
        flashPower *= Math.pow(0.0009, dt);
        if (flashPower < 0.0005) flashPower = 0;
      }
      uniforms.uFlash.value = flashPower;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      reg.scene.fog = null;
      reg.clearGroup('env.sky');
      geo.dispose();
      mat.dispose();
    },
  };
}
