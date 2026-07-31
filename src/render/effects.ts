import * as THREE from 'three';
import type { SceneRegistry, QualitySettings } from './registry.ts';
import { clamp01, lerp } from '../core/math.ts';

/**
 * Pooled arcade impact effects: turf debris, sparks, smoke puffs, shock rings, speed trails.
 * All particles live in a handful of buffer geometries — no per-hit allocation.
 */

const MAX_PARTICLES = 900;
const MAX_RINGS = 24;

const PARTICLE_VS = `
attribute vec3 aVel;
attribute float aBirth;
attribute float aLife;
attribute float aSize;
attribute vec3 aColor;
uniform float uTime;
uniform float uPixelScale;
varying float vAlpha;
varying vec3 vColor;
void main() {
  float age = uTime - aBirth;
  float t = age / aLife;
  if (t < 0.0 || t > 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vAlpha = 0.0; return; }
  vec3 p = position + aVel * age;
  p.y -= 9.0 * age * age;
  if (p.y < 0.02) p.y = 0.02;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uPixelScale / max(1.0, -mv.z) * 34.0;
  vAlpha = (1.0 - t) * (1.0 - t);
  vColor = aColor;
}`;

const PARTICLE_FS = `
precision mediump float;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec2 d = gl_PointCoord - vec2(0.5);
  float r = dot(d, d);
  if (r > 0.25) discard;
  float edge = smoothstep(0.25, 0.05, r);
  gl_FragColor = vec4(vColor, vAlpha * edge);
}`;

const RING_VS = `
attribute float aBirth;
attribute float aLife;
attribute float aMax;
attribute vec3 aColor;
uniform float uTime;
varying float vAlpha;
varying vec3 vColor;
void main() {
  float t = (uTime - aBirth) / aLife;
  if (t < 0.0 || t > 1.0) { gl_Position = vec4(2.0,2.0,2.0,1.0); vAlpha = 0.0; return; }
  vec3 p = position;
  p.xz *= aMax * (0.15 + t * 0.95);
  vec4 world = modelMatrix * vec4(p + instanceOffset, 1.0);
  gl_Position = projectionMatrix * viewMatrix * world;
  vAlpha = (1.0 - t);
  vColor = aColor;
}`;

export class Effects {
  private group: THREE.Group;
  private geo: THREE.BufferGeometry;
  private points: THREE.Points;
  private mat: THREE.ShaderMaterial;
  private head = 0;
  private time = 0;
  private quality: QualitySettings;

  private pos: Float32Array;
  private vel: Float32Array;
  private birth: Float32Array;
  private life: Float32Array;
  private size: Float32Array;
  private col: Float32Array;

  private ringGroup: THREE.Group;
  private rings: THREE.Mesh[] = [];
  private ringData: Array<{ t: number; life: number; max: number }> = [];
  private ringHead = 0;

  constructor(reg: SceneRegistry, quality: QualitySettings) {
    this.quality = quality;
    this.group = reg.group('effects');
    const n = Math.max(120, Math.round(MAX_PARTICLES * quality.particleScale));
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.birth = new Float32Array(n).fill(-1000);
    this.life = new Float32Array(n).fill(1);
    this.size = new Float32Array(n);
    this.col = new Float32Array(n * 3);

    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('aVel', new THREE.BufferAttribute(this.vel, 3));
    this.geo.setAttribute('aBirth', new THREE.BufferAttribute(this.birth, 1));
    this.geo.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 50), 400);

    this.mat = new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VS, fragmentShader: PARTICLE_FS,
      uniforms: { uTime: { value: 0 }, uPixelScale: { value: 1 } },
      transparent: true, depthWrite: false, blending: THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.group.add(this.points);
    reg.trackAll(this.geo, this.mat);

    // Shock rings — a small pool of flat expanding tori.
    this.ringGroup = new THREE.Group();
    this.group.add(this.ringGroup);
    const rg = new THREE.RingGeometry(0.82, 1.0, 22);
    rg.rotateX(-Math.PI / 2);
    reg.track(rg);
    for (let i = 0; i < MAX_RINGS; i++) {
      const rm = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0, depthWrite: false,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      });
      reg.track(rm);
      const mesh = new THREE.Mesh(rg, rm);
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.ringGroup.add(mesh);
      this.rings.push(mesh);
      this.ringData.push({ t: 0, life: 1, max: 1 });
    }
    void RING_VS;
  }

  setPixelScale(v: number): void { this.mat.uniforms.uPixelScale.value = v; }

  private spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, c: THREE.Color): void {
    const i = this.head;
    this.head = (this.head + 1) % this.life.length;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.birth[i] = this.time; this.life[i] = life; this.size[i] = size;
    this.col[i * 3] = c.r; this.col[i * 3 + 1] = c.g; this.col[i * 3 + 2] = c.b;
  }

  private dirty = false;

  burst(x: number, y: number, z: number, power: number, kind: 'TURF' | 'SPARK' | 'SMOKE' | 'WATER'): void {
    const n = Math.round(lerp(6, 26, clamp01(power)) * this.quality.particleScale);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = lerp(2.2, 10, Math.random()) * (0.5 + power);
      switch (kind) {
        case 'TURF': c.setHSL(0.28 + Math.random() * 0.06, 0.5, 0.22 + Math.random() * 0.18); break;
        case 'SPARK': c.setHSL(0.10 + Math.random() * 0.05, 1, 0.62 + Math.random() * 0.25); break;
        case 'WATER': c.setHSL(0.55, 0.25, 0.72 + Math.random() * 0.2); break;
        default: c.setHSL(0, 0, 0.62 + Math.random() * 0.25); break;
      }
      this.spawn(x, y + 0.15, z,
        Math.cos(a) * sp, lerp(2.5, 8, Math.random()) * (0.6 + power), Math.sin(a) * sp,
        lerp(0.45, 1.05, Math.random()), kind === 'SMOKE' ? 5.5 : 2.6, c);
    }
    this.dirty = true;
  }

  ring(x: number, y: number, z: number, radius: number, color: number): void {
    const i = this.ringHead;
    this.ringHead = (this.ringHead + 1) % this.rings.length;
    const m = this.rings[i];
    m.visible = true;
    m.position.set(x, y + 0.06, z);
    (m.material as THREE.MeshBasicMaterial).color.setHex(color);
    this.ringData[i] = { t: 0, life: 0.45, max: radius };
  }

  update(dt: number): void {
    this.time += dt;
    this.mat.uniforms.uTime.value = this.time;
    if (this.dirty) {
      for (const name of ['position', 'aVel', 'aBirth', 'aLife', 'aSize', 'aColor']) {
        (this.geo.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
      }
      this.dirty = false;
    }
    for (let i = 0; i < this.rings.length; i++) {
      const d = this.ringData[i];
      const m = this.rings[i];
      if (!m.visible) continue;
      d.t += dt;
      const u = d.t / d.life;
      if (u >= 1) { m.visible = false; continue; }
      const sc = d.max * (0.2 + u * 1.1);
      m.scale.set(sc, 1, sc);
      (m.material as THREE.MeshBasicMaterial).opacity = (1 - u) * 0.85;
    }
  }

  dispose(): void {
    this.geo.dispose(); this.mat.dispose();
    for (const r of this.rings) (r.material as THREE.Material).dispose();
  }
}
