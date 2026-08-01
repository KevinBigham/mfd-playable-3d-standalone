import * as THREE from 'three';
import type { QualitySettings } from './registry.ts';
import { clamp, clamp01 } from '../core/math.ts';

/**
 * The post chain.
 *
 * `QualitySettings.postProcessing` existed as a flag from the first build and did nothing — the
 * scene went straight to the canvas. This is the pass that flag was always describing.
 *
 * It is deliberately small and hand-rolled rather than an `EffectComposer` stack, because the
 * whole point is control over a specific look: hot lights that bleed, deep corners, saturated
 * primaries that stay saturated after tone mapping, and a lens that flinches when somebody gets
 * hit. Six passes, four of them at reduced resolution.
 *
 *   scene → HDR target (with MSAA, which a render target does not inherit from the canvas)
 *         → bright pass at half res, soft knee
 *         → separable blur, half res
 *         → downsample + blur again at quarter res, for the wide falloff
 *         → composite: ACES, bloom, grade, vignette, chromatic aberration, grain
 *
 * Tone mapping moves here when the chain is on. Tone mapping in the renderer would clamp the
 * scene to display range before the bright pass ever saw it, and there would be nothing left to
 * bloom — highlights are the entire point of rendering to a half-float target.
 */

export interface Grade {
  /** Linear exposure multiplier applied before tone mapping. */
  exposure: number;
  /** How much of the blurred highlight buffer is added back. */
  bloom: number;
  /** Luminance above which a pixel starts to bleed. */
  threshold: number;
  contrast: number;
  saturation: number;
  /** 0 = flat corners, 1 = heavy. */
  vignette: number;
  /** Additive black lift, for a slightly milky shadow. */
  lift: THREE.Color;
  /** Multiplicative colour gain, the main tint control. */
  gain: THREE.Color;
  /** Static luminance noise. Hides banding in the sky gradient. */
  grain: number;
}

export function defaultGrade(): Grade {
  return {
    exposure: 1.06,
    bloom: 0.55,
    threshold: 0.78,
    contrast: 1.09,
    saturation: 1.14,
    vignette: 0.42,
    lift: new THREE.Color(0.008, 0.010, 0.018),
    gain: new THREE.Color(1.02, 1.0, 0.985),
    grain: 0.012,
  };
}

const VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const BRIGHT = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uThreshold;
uniform float uKnee;

vec3 tap(vec2 o) { return texture2D(tSrc, vUv + o * uTexel).rgb; }

void main() {
  // Four bilinear taps at half resolution give a clean 4x4 box without the fireflies a single
  // point sample leaves behind on specular highlights.
  vec3 c = (tap(vec2(-1.0, -1.0)) + tap(vec2(1.0, -1.0))
          + tap(vec2(-1.0, 1.0)) + tap(vec2(1.0, 1.0))) * 0.25;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  // Soft knee: a hard threshold makes bloom pop in and out as a highlight crosses it, which
  // reads as flicker on a moving helmet.
  float soft = clamp(l - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 0.0001);
  float w = max(soft, l - uThreshold) / max(l, 0.0001);
  gl_FragColor = vec4(c * w, 1.0);
}`;

const BLUR = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uDir;

void main() {
  // Nine-tap Gaussian collapsed to five bilinear fetches.
  vec3 c = texture2D(tSrc, vUv).rgb * 0.227027;
  c += (texture2D(tSrc, vUv + uDir * 1.3846).rgb
      + texture2D(tSrc, vUv - uDir * 1.3846).rgb) * 0.316216;
  c += (texture2D(tSrc, vUv + uDir * 3.2308).rgb
      + texture2D(tSrc, vUv - uDir * 3.2308).rgb) * 0.070270;
  gl_FragColor = vec4(c, 1.0);
}`;

const COMPOSITE = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tScene;
uniform sampler2D tBloomA;
uniform sampler2D tBloomB;
uniform float uBloom;
uniform float uWide;
uniform float uExposure;
uniform float uContrast;
uniform float uSaturation;
uniform float uVignette;
uniform float uAberration;
uniform float uGrain;
uniform float uFlash;
uniform float uTime;
uniform vec3 uLift;
uniform vec3 uGain;
uniform vec3 uFlashColor;

// ACES filmic approximation. Standard published curve fit, not taken from any game.
vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  vec2 uv = vUv;
  vec2 fromCentre = uv - 0.5;

  vec3 col;
  if (uAberration > 0.0001) {
    // Split the channels radially. Strength grows toward the edges, which is how a real lens
    // fails, and it is driven by impacts so it reads as the camera being struck.
    vec2 d = fromCentre * uAberration;
    col.r = texture2D(tScene, uv + d).r;
    col.g = texture2D(tScene, uv).g;
    col.b = texture2D(tScene, uv - d).b;
  } else {
    col = texture2D(tScene, uv).rgb;
  }

  vec3 bloom = texture2D(tBloomA, uv).rgb + texture2D(tBloomB, uv).rgb * uWide;
  col += bloom * uBloom;
  col += uFlashColor * uFlash;

  col = aces(col * uExposure);

  col = (col - 0.5) * uContrast + 0.5;
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(l), col, uSaturation);
  col = col * uGain + uLift;

  float r = length(fromCentre * vec2(1.0, 0.94));
  float vig = smoothstep(0.92, 0.28, r);
  col *= mix(1.0, vig, uVignette);

  if (uGrain > 0.0001) {
    col += (hash(uv * 1024.0 + uTime) - 0.5) * uGrain;
  }

  gl_FragColor = vec4(max(col, 0.0), 1.0);
  #include <colorspace_fragment>
}`;

/** A single triangle that covers clip space; cheaper than a quad and has no diagonal seam. */
function fullscreenTriangle(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    -1, -1, 0, 3, -1, 0, -1, 3, 0,
  ]), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
  return g;
}

export class PostFX {
  private renderer: THREE.WebGLRenderer;
  private quality: QualitySettings;
  private grade: Grade = defaultGrade();

  private sceneRT!: THREE.WebGLRenderTarget;
  private halfA!: THREE.WebGLRenderTarget;
  private halfB!: THREE.WebGLRenderTarget;
  private quarterA!: THREE.WebGLRenderTarget;
  private quarterB!: THREE.WebGLRenderTarget;

  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private tri = fullscreenTriangle();
  private quad: THREE.Mesh;
  private matBright: THREE.ShaderMaterial;
  private matBlur: THREE.ShaderMaterial;
  private matComposite: THREE.ShaderMaterial;

  private width = 2;
  private height = 2;
  private t = 0;
  private aberration = 0;
  private flash = 0;
  private disposed = false;

  constructor(renderer: THREE.WebGLRenderer, quality: QualitySettings) {
    this.renderer = renderer;
    this.quality = quality;

    this.matBright = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: BRIGHT, depthTest: false, depthWrite: false,
      uniforms: {
        tSrc: { value: null }, uTexel: { value: new THREE.Vector2() },
        uThreshold: { value: this.grade.threshold }, uKnee: { value: 0.28 },
      },
    });
    this.matBlur = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: BLUR, depthTest: false, depthWrite: false,
      uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } },
    });
    this.matComposite = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: COMPOSITE, depthTest: false, depthWrite: false,
      uniforms: {
        tScene: { value: null }, tBloomA: { value: null }, tBloomB: { value: null },
        uBloom: { value: this.grade.bloom }, uWide: { value: 0.75 },
        uExposure: { value: this.grade.exposure }, uContrast: { value: this.grade.contrast },
        uSaturation: { value: this.grade.saturation }, uVignette: { value: this.grade.vignette },
        uAberration: { value: 0 }, uGrain: { value: this.grade.grain },
        uFlash: { value: 0 }, uTime: { value: 0 },
        uLift: { value: this.grade.lift.clone() }, uGain: { value: this.grade.gain.clone() },
        uFlashColor: { value: new THREE.Color(1, 0.96, 0.86) },
      },
    });

    this.quad = new THREE.Mesh(this.tri, this.matBright);
    this.quad.frustumCulled = false;

    this.allocate();
  }

  private makeTarget(w: number, h: number, hdr: boolean, samples: number): THREE.WebGLRenderTarget {
    const rt = new THREE.WebGLRenderTarget(Math.max(2, w), Math.max(2, h), {
      type: hdr ? THREE.HalfFloatType : THREE.UnsignedByteType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: hdr,
      stencilBuffer: false,
      generateMipmaps: false,
      samples,
    });
    return rt;
  }

  private allocate(): void {
    const size = new THREE.Vector2();
    this.renderer.getDrawingBufferSize(size);
    const w = Math.max(2, Math.floor(size.x));
    const h = Math.max(2, Math.floor(size.y));
    if (w === this.width && h === this.height && this.sceneRT) return;
    this.width = w; this.height = h;
    this.free();

    // A render target does not inherit the canvas's multisampling, so it has to be asked for.
    // Losing it is the one way post-processing can make a game look worse rather than better.
    const samples = this.quality.tier === 'HIGH' ? 4 : this.quality.tier === 'MEDIUM' ? 2 : 0;
    this.sceneRT = this.makeTarget(w, h, true, samples);
    const hw = Math.max(2, w >> 1), hh = Math.max(2, h >> 1);
    const qw = Math.max(2, w >> 2), qh = Math.max(2, h >> 2);
    this.halfA = this.makeTarget(hw, hh, true, 0);
    this.halfB = this.makeTarget(hw, hh, true, 0);
    this.quarterA = this.makeTarget(qw, qh, true, 0);
    this.quarterB = this.makeTarget(qw, qh, true, 0);
  }

  private free(): void {
    for (const rt of [this.sceneRT, this.halfA, this.halfB, this.quarterA, this.quarterB]) {
      rt?.dispose();
    }
  }

  resize(): void { this.allocate(); }

  setQuality(q: QualitySettings): void {
    const tierChanged = q.tier !== this.quality.tier;
    this.quality = q;
    if (tierChanged) { this.width = -1; this.allocate(); }
  }

  setGrade(g: Partial<Grade>): void {
    Object.assign(this.grade, g);
    const u = this.matComposite.uniforms;
    u.uBloom.value = this.grade.bloom;
    u.uExposure.value = this.grade.exposure;
    u.uContrast.value = this.grade.contrast;
    u.uSaturation.value = this.grade.saturation;
    u.uVignette.value = this.grade.vignette;
    u.uGrain.value = this.quality.tier === 'HIGH' ? this.grade.grain : 0;
    (u.uLift.value as THREE.Color).copy(this.grade.lift);
    (u.uGain.value as THREE.Color).copy(this.grade.gain);
    this.matBright.uniforms.uThreshold.value = this.grade.threshold;
  }

  /** Kick the lens. Called from the same impacts that shake the camera. */
  impulse(power: number): void {
    this.aberration = Math.min(0.006, this.aberration + power * 0.0032);
    this.flash = Math.min(0.5, this.flash + power * 0.10);
  }

  private blit(target: THREE.WebGLRenderTarget | null, mat: THREE.ShaderMaterial): void {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quad, this.cam);
  }

  render(scene: THREE.Scene, camera: THREE.Camera, dt: number): void {
    if (this.disposed) return;
    this.allocate();
    this.t += dt;
    this.aberration = Math.max(0, this.aberration - dt * 0.020);
    this.flash = Math.max(0, this.flash - dt * 2.2);

    // 1. Scene into the HDR target, with tone mapping deferred to the composite.
    const prevTone = this.renderer.toneMapping;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.setRenderTarget(this.sceneRT);
    this.renderer.clear();
    this.renderer.render(scene, camera);
    this.renderer.toneMapping = prevTone;

    // 2. Bright pass at half resolution.
    this.matBright.uniforms.tSrc.value = this.sceneRT.texture;
    (this.matBright.uniforms.uTexel.value as THREE.Vector2)
      .set(1 / this.width, 1 / this.height);
    this.blit(this.halfA, this.matBright);

    // 3. Separable blur at half resolution.
    const hw = this.halfA.width, hh = this.halfA.height;
    this.matBlur.uniforms.tSrc.value = this.halfA.texture;
    (this.matBlur.uniforms.uDir.value as THREE.Vector2).set(1 / hw, 0);
    this.blit(this.halfB, this.matBlur);
    this.matBlur.uniforms.tSrc.value = this.halfB.texture;
    (this.matBlur.uniforms.uDir.value as THREE.Vector2).set(0, 1 / hh);
    this.blit(this.halfA, this.matBlur);

    // 4. Wider, softer second level at quarter resolution.
    const wide = this.quality.tier !== 'LOW';
    if (wide) {
      const qw = this.quarterA.width, qh = this.quarterA.height;
      this.matBlur.uniforms.tSrc.value = this.halfA.texture;
      (this.matBlur.uniforms.uDir.value as THREE.Vector2).set(1.6 / qw, 0);
      this.blit(this.quarterB, this.matBlur);
      this.matBlur.uniforms.tSrc.value = this.quarterB.texture;
      (this.matBlur.uniforms.uDir.value as THREE.Vector2).set(0, 1.6 / qh);
      this.blit(this.quarterA, this.matBlur);
    }

    // 5. Composite to the canvas.
    const u = this.matComposite.uniforms;
    u.tScene.value = this.sceneRT.texture;
    u.tBloomA.value = this.halfA.texture;
    u.tBloomB.value = wide ? this.quarterA.texture : this.halfA.texture;
    u.uWide.value = wide ? 0.75 : 0;
    u.uAberration.value = this.aberration;
    u.uFlash.value = this.flash;
    u.uTime.value = this.t;
    this.blit(null, this.matComposite);
    this.renderer.setRenderTarget(null);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.free();
    this.tri.dispose();
    this.matBright.dispose();
    this.matBlur.dispose();
    this.matComposite.dispose();
  }
}

export { clamp, clamp01 };
