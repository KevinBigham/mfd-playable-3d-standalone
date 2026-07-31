import * as THREE from 'three';
import type { Conditions } from '../../core/types.ts';
import type { SceneRegistry, QualitySettings } from '../registry.ts';
import { noiseTexture } from './textures.ts';
import { VisualRng } from './geo.ts';
import type { SkyHandle } from './sky.ts';

/**
 * Weather. Everything animates on the GPU.
 *
 * Precipitation lives in a wrap-around box that rides the camera in X/Z but stays pinned to the
 * ground in Y, so the volume is always exactly where it is needed and never has to be re-seeded.
 * CLEAR builds nothing at all and `update` returns immediately.
 */

/** Device pixels per yard at 1 yard depth, for a 1080-tall buffer at a 52° vertical FOV. */
const DEFAULT_PIXEL_SCALE = 1100;

const PARTICLE_VS = `
attribute float aSeed;
uniform vec3 uCam;
uniform vec3 uBox;
uniform vec3 uVel;
uniform vec2 uSwirl;      // amplitude, rate
uniform float uTime;
uniform float uSize;
uniform float uPixel;
varying float vFade;
varying float vSeed;

void main() {
  vec3 rel = position + uVel * uTime * (0.7 + aSeed * 0.6);
  float ph = aSeed * 6.2831853;
  rel.x += sin(uTime * uSwirl.y + ph) * uSwirl.x;
  rel.z += cos(uTime * uSwirl.y * 0.83 + ph * 1.7) * uSwirl.x;
  rel = mod(rel, uBox);
  vec3 world = vec3(uCam.x + rel.x - uBox.x * 0.5, rel.y, uCam.z + rel.z - uBox.z * 0.5);

  vec4 mv = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mv;
  float d = -mv.z;
  // uSize is a WORLD size in yards; uPixel converts yards-at-1-yard into device pixels.
  gl_PointSize = clamp(uSize * (0.7 + aSeed * 0.6) * uPixel / max(1.0, d), 1.0, 64.0);
  vFade = smoothstep(uBox.x * 0.52, uBox.x * 0.18, d) * smoothstep(2.5, 9.0, d);
  vSeed = aSeed;
}`;

const PARTICLE_FS = `
precision mediump float;
uniform vec3 uColor;
uniform float uOpacity;
varying float vFade;
varying float vSeed;

void main() {
  vec2 c = gl_PointCoord - vec2(0.5);
  float a;
  #if defined(MODE_RAIN)
    a = (1.0 - smoothstep(0.055, 0.17, abs(c.x))) * (1.0 - smoothstep(0.26, 0.5, abs(c.y)));
  #elif defined(MODE_SNOW)
    float r = length(c);
    a = 1.0 - smoothstep(0.14, 0.48, r);
    a *= 0.75 + 0.25 * sin(vSeed * 41.0);
  #else
    vec2 q = abs(c) * vec2(1.0, 2.2);
    a = 1.0 - smoothstep(0.20, 0.46, max(q.x, q.y));
  #endif
  if (a <= 0.01) discard;
  gl_FragColor = vec4(uColor, a * vFade * uOpacity);
}`;

const HAZE_VS = `
varying vec2 vUv;
varying float vDist;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const HAZE_FS = `
precision mediump float;
uniform sampler2D uNoise;
uniform vec3 uColor;
uniform float uTime;
uniform float uStrength;
uniform float uScale;
uniform float uSpeed;
varying vec2 vUv;
varying float vDist;

void main() {
  vec2 p = vUv * uScale;
  float n = texture2D(uNoise, p + vec2(uTime * uSpeed, uTime * uSpeed * 0.6)).r;
  n = n * 0.6 + texture2D(uNoise, p * 2.7 - vec2(uTime * uSpeed * 1.7, 0.0)).g * 0.4;
  float edge = smoothstep(0.0, 0.16, vUv.x) * smoothstep(1.0, 0.84, vUv.x)
             * smoothstep(0.0, 0.10, vUv.y) * smoothstep(1.0, 0.90, vUv.y);
  float near = smoothstep(4.0, 16.0, vDist) * smoothstep(190.0, 60.0, vDist);
  float a = uStrength * edge * near * (0.35 + 0.65 * n);
  if (a <= 0.004) discard;
  gl_FragColor = vec4(uColor, a);
}`;

export interface WeatherOptions {
  conditions: Conditions;
  quality: QualitySettings;
  /** Weather owns the fog ramp above the venue's base density. */
  sky: SkyHandle;
  seed?: number;
}

export interface WeatherHandle {
  update(dt: number, cameraPos: THREE.Vector3): void;
  /**
   * Device pixels per yard at one yard of depth: `drawingBufferHeight / (2 * tan(fovY / 2))`.
   * Call on resize / FOV change so precipitation keeps a constant apparent size.
   */
  setPixelScale(px: number): void;
  dispose(): void;
}

interface Field {
  points: THREE.Points;
  uniforms: Record<string, THREE.IUniform>;
}

export function buildWeather(reg: SceneRegistry, o: WeatherOptions): WeatherHandle {
  const kind = o.conditions.weather;
  if (kind === 'CLEAR') {
    return {
      update(): void { /* nothing to do */ },
      setPixelScale(): void { /* nothing built */ },
      dispose(): void { /* nothing built */ },
    };
  }

  const group = reg.group('env.weather');
  const q = o.quality;
  const density = Math.max(0.15, q.weatherDensity);
  const rng = new VisualRng((o.seed ?? 0x7a17) ^ kind.length * 104729);
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const fields: Field[] = [];

  const windX = o.conditions.windX;
  const windZ = o.conditions.windZ;

  const makeField = (
    count: number, box: THREE.Vector3, vel: THREE.Vector3, swirl: THREE.Vector2,
    color: string, size: number, opacity: number, mode: 'RAIN' | 'SNOW' | 'DEBRIS',
    blending: THREE.Blending,
  ): void => {
    const n = Math.max(64, Math.round(count * density));
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = rng.next() * box.x;
      pos[i * 3 + 1] = rng.next() * box.y;
      pos[i * 3 + 2] = rng.next() * box.z;
      seed[i] = rng.next();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    geos.push(geo);

    const uniforms: Record<string, THREE.IUniform> = {
      uCam: { value: new THREE.Vector3(0, 0, 50) },
      uBox: { value: box },
      uVel: { value: vel },
      uSwirl: { value: swirl },
      uTime: { value: 0 },
      uSize: { value: size },
      uPixel: { value: DEFAULT_PIXEL_SCALE },
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opacity },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: PARTICLE_VS,
      fragmentShader: PARTICLE_FS,
      defines: { [`MODE_${mode}`]: '' },
      transparent: true,
      depthWrite: false,
      blending,
    });
    mats.push(mat);
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    points.renderOrder = 8;
    points.matrixAutoUpdate = false;
    group.add(points);
    fields.push({ points, uniforms });
  };

  const makeHaze = (color: string, y: number, strength: number, scale: number, speed: number, w: number, d: number): Record<string, THREE.IUniform> => {
    const geo = new THREE.PlaneGeometry(w, d, 1, 1);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, y, 50);
    geos.push(geo);
    const uniforms: Record<string, THREE.IUniform> = {
      uNoise: { value: noiseTexture(128) },
      uColor: { value: new THREE.Color(color) },
      uTime: { value: 0 },
      uStrength: { value: strength },
      uScale: { value: scale },
      uSpeed: { value: speed },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: HAZE_VS,
      fragmentShader: HAZE_FS,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
    });
    mats.push(mat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 7;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    return uniforms;
  };

  const hazes: Record<string, THREE.IUniform>[] = [];
  let fogTarget = o.sky.palette.fogDensity;
  const fogFrom = o.sky.palette.fogDensity;
  const fogColorTarget = o.sky.fog.color.clone();

  switch (kind) {
    case 'RAIN': {
      makeField(
        5200, new THREE.Vector3(72, 42, 72),
        new THREE.Vector3(windX * 0.5, -34, windZ * 0.5), new THREE.Vector2(0.25, 1.1),
        '#bcd8f2', 0.50, 0.26, 'RAIN', THREE.AdditiveBlending,
      );
      hazes.push(makeHaze('#b9c9d8', 0.9, 0.16, 3.2, 0.05, 110, 170));
      fogTarget = fogFrom * 2.1 + 0.0008;
      fogColorTarget.lerp(new THREE.Color('#6d7d8c'), 0.45);
      break;
    }
    case 'SNOW': {
      makeField(
        5000, new THREE.Vector3(66, 40, 66),
        new THREE.Vector3(windX * 0.7, -4.6, windZ * 0.7), new THREE.Vector2(1.5, 0.8),
        '#ffffff', 0.19, 0.80, 'SNOW', THREE.NormalBlending,
      );
      hazes.push(makeHaze('#e8f0f6', 1.1, 0.20, 2.6, 0.03, 110, 170));
      fogTarget = fogFrom * 2.6 + 0.0012;
      fogColorTarget.lerp(new THREE.Color('#c8d6e0'), 0.6);
      break;
    }
    case 'WIND': {
      makeField(
        1600, new THREE.Vector3(70, 9, 70),
        new THREE.Vector3(windX * 3.4 - 9, -0.6, windZ * 3.4 - 3), new THREE.Vector2(1.1, 2.4),
        '#d8c48a', 0.19, 0.75, 'DEBRIS', THREE.NormalBlending,
      );
      makeField(
        600, new THREE.Vector3(70, 26, 70),
        new THREE.Vector3(windX * 2.2 - 6, 0.9, windZ * 2.2 - 2), new THREE.Vector2(2.2, 1.6),
        '#9aa88a', 0.14, 0.50, 'DEBRIS', THREE.NormalBlending,
      );
      hazes.push(makeHaze('#c7bb96', 0.7, 0.10, 4.0, 0.16, 110, 170));
      fogTarget = fogFrom * 1.5;
      break;
    }
    case 'FOG': {
      hazes.push(makeHaze('#d5dde4', 1.4, 0.42, 1.7, 0.012, 120, 180));
      hazes.push(makeHaze('#c3ced8', 4.2, 0.26, 1.1, 0.02, 120, 180));
      fogTarget = fogFrom * 4.2 + 0.0075;
      fogColorTarget.lerp(new THREE.Color('#c2ccd4'), 0.7);
      break;
    }
    case 'HEAT': {
      hazes.push(makeHaze('#ffd9a0', 0.55, 0.22, 5.5, 0.30, 110, 170));
      hazes.push(makeHaze('#ffc27a', 1.6, 0.12, 3.4, 0.44, 110, 170));
      fogTarget = fogFrom * 1.35;
      fogColorTarget.lerp(new THREE.Color('#e8c69a'), 0.35);
      break;
    }
    default: break;
  }

  const fogColorFrom = o.sky.fog.color.clone();
  const scratch = new THREE.Color();
  let ramp = 0;
  let t = 0;
  let disposed = false;

  return {
    update(dt: number, cameraPos: THREE.Vector3): void {
      t += dt;
      if (ramp < 1) {
        ramp = Math.min(1, ramp + dt * 0.4);
        o.sky.setFogDensity(fogFrom + (fogTarget - fogFrom) * ramp);
        scratch.copy(fogColorFrom).lerp(fogColorTarget, ramp);
        o.sky.setFogColor(scratch);
      }
      for (const f of fields) {
        f.uniforms.uTime.value = t;
        (f.uniforms.uCam.value as THREE.Vector3).set(cameraPos.x, 0, cameraPos.z);
      }
      for (const h of hazes) h.uTime.value = t;
    },
    setPixelScale(px: number): void {
      for (const f of fields) f.uniforms.uPixel.value = px;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      reg.clearGroup('env.weather');
    },
  };
}
