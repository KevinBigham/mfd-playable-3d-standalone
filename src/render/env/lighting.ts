import * as THREE from 'three';
import type { SceneRegistry, QualitySettings } from '../registry.ts';
import type { SkyPalette } from './sky.ts';
import { clamp } from '../../core/math.ts';

/**
 * Stage lighting, not photography.
 *
 * One hard key with a tight shadow frustum that only ever covers the ~60 × 60 yards around the
 * ball, a hemispheric fill that keeps shadowed jerseys saturated rather than muddy, a cold rim to
 * separate athletes from the turf, and tower spots after dark. Late-90s arcade contrast with
 * modern shadow clarity.
 */

export interface LightingOptions {
  palette: SkyPalette;
  quality: QualitySettings;
  roof: 0 | 1 | 2;
  /** Venue accent — tints the tower spots so each ground has its own glow. */
  accent: string;
  /** Lamp-head world positions from the stadium build. Up to 4 become real spot lights. */
  towers?: Array<{ x: number; y: number; z: number }>;
}

export interface LightingHandle {
  key: THREE.DirectionalLight;
  /** Re-centre the shadow frustum on the action. Cheap; safe to call every frame. */
  focusOn(x: number, z: number): void;
  update(dt: number): void;
  dispose(): void;
}

/** Half-extent of the shadow frustum, in yards. 32 → a 64 × 64 yd window around the play. */
const SHADOW_HALF = 32;
const KEY_DISTANCE = 130;

export function buildLighting(reg: SceneRegistry, o: LightingOptions): LightingHandle {
  const group = reg.group('env.light');
  const p = o.palette;
  const roofed = o.roof === 2;

  // ── key ────────────────────────────────────────────────────────────────
  const keyColor = p.sunColor.clone();
  if (roofed) keyColor.lerp(new THREE.Color('#e8f0ff'), 0.4);
  const key = new THREE.DirectionalLight(keyColor, roofed ? Math.max(2.0, p.keyIntensity) : p.keyIntensity);
  key.castShadow = o.quality.shadows;
  key.shadow.mapSize.set(o.quality.shadowMapSize, o.quality.shadowMapSize);
  const cam = key.shadow.camera;
  cam.left = -SHADOW_HALF; cam.right = SHADOW_HALF;
  cam.top = SHADOW_HALF; cam.bottom = -SHADOW_HALF;
  cam.near = KEY_DISTANCE - 70;
  cam.far = KEY_DISTANCE + 90;
  cam.updateProjectionMatrix();
  key.shadow.bias = -0.00042;
  key.shadow.normalBias = 0.055;
  key.shadow.radius = o.quality.tier === 'HIGH' ? 1.6 : 1;
  group.add(key);
  group.add(key.target);

  // ── fill ───────────────────────────────────────────────────────────────
  const hemi = new THREE.HemisphereLight(p.hemiSky, p.hemiGround, p.hemiIntensity);
  hemi.position.set(0, 60, 50);
  group.add(hemi);

  const ambient = new THREE.AmbientLight(p.fog, p.ambient);
  group.add(ambient);

  // ── rim ────────────────────────────────────────────────────────────────
  const rim = new THREE.DirectionalLight(p.rimColor, p.rimIntensity);
  rim.position.set(-p.sun.x * 90, 34, 50 - p.sun.z * 90);
  rim.target.position.set(0, 0, 50);
  rim.castShadow = false;
  group.add(rim);
  group.add(rim.target);

  // A second warm bounce from the near sideline keeps the fronts of jerseys from going flat.
  const bounce = new THREE.DirectionalLight(new THREE.Color(o.accent), 0.28);
  bounce.position.set(0, 12, -60);
  bounce.target.position.set(0, 0, 50);
  bounce.castShadow = false;
  group.add(bounce);
  group.add(bounce.target);

  // ── tower spots ────────────────────────────────────────────────────────
  const spots: THREE.SpotLight[] = [];
  const wantSpots = (p.towerLights || roofed) && o.quality.tier !== 'LOW';
  if (wantSpots && o.towers && o.towers.length > 0) {
    const aim: Array<[number, number]> = [[-13, 24], [13, 24], [-13, 76], [13, 76]];
    const picks = pickSpread(o.towers.length, 4);
    for (let i = 0; i < picks.length; i++) {
      const t = o.towers[picks[i]];
      const col = new THREE.Color(o.accent).lerp(new THREE.Color('#ffffff'), 0.72);
      const s = new THREE.SpotLight(col, 1.05, 0, 0.62, 0.75, 0);
      s.position.set(t.x, t.y, t.z);
      s.target.position.set(aim[i % aim.length][0], 0, aim[i % aim.length][1]);
      s.castShadow = false;
      group.add(s);
      group.add(s.target);
      spots.push(s);
    }
  }

  // ── focus tracking ─────────────────────────────────────────────────────
  let fx = 0, fz = 50;
  const place = (x: number, z: number): void => {
    key.position.set(x + p.sun.x * KEY_DISTANCE, p.sun.y * KEY_DISTANCE, z + p.sun.z * KEY_DISTANCE);
    key.target.position.set(x, 0, z);
    key.target.updateMatrixWorld();
  };
  place(fx, fz);

  let disposed = false;
  return {
    key,
    focusOn(x: number, z: number): void {
      // Snap to a quarter yard: the shadow map only re-rasterises when the play actually moves,
      // which kills the crawling-edge artefact you get from a continuously sliding frustum.
      const nx = Math.round(clamp(x, -34, 34) * 4) / 4;
      const nz = Math.round(clamp(z, -18, 118) * 4) / 4;
      if (nx === fx && nz === fz) return;
      fx = nx; fz = nz;
      place(fx, fz);
    },
    update(_dt: number): void { /* lights are static between focus changes */ },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      key.dispose(); hemi.dispose(); ambient.dispose(); rim.dispose(); bounce.dispose();
      for (const s of spots) s.dispose();
      key.shadow.map?.dispose();
      reg.clearGroup('env.light');
    },
  };
}

/** Evenly spaced indices out of `total`, at most `want` of them. */
function pickSpread(total: number, want: number): number[] {
  const n = Math.min(total, want);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(Math.round((i * total) / n) % total);
  return out;
}
