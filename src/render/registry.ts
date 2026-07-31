import * as THREE from 'three';

/**
 * Every renderable subsystem registers here. Nothing calls `scene.add` directly
 * and nothing disposes GPU resources on its own. See ARCHITECTURE.md §12/§20.
 */
export interface Disposable { dispose(): void }

export class SceneRegistry {
  readonly scene: THREE.Scene;
  private groups = new Map<string, THREE.Group>();
  private disposables: Disposable[] = [];
  private geoms = new Set<THREE.BufferGeometry>();
  private mats = new Set<THREE.Material>();
  private texes = new Set<THREE.Texture>();

  constructor(scene: THREE.Scene) { this.scene = scene; }

  /** Get (or create) the named layer group. Owners use one group each. */
  group(name: string): THREE.Group {
    let g = this.groups.get(name);
    if (!g) {
      g = new THREE.Group();
      g.name = name;
      this.scene.add(g);
      this.groups.set(name, g);
    }
    return g;
  }

  track<T extends THREE.BufferGeometry | THREE.Material | THREE.Texture>(res: T): T {
    if ((res as THREE.BufferGeometry).isBufferGeometry) this.geoms.add(res as THREE.BufferGeometry);
    else if ((res as THREE.Material).isMaterial) this.mats.add(res as THREE.Material);
    else if ((res as THREE.Texture).isTexture) this.texes.add(res as THREE.Texture);
    return res;
  }

  trackAll(...res: Array<THREE.BufferGeometry | THREE.Material | THREE.Texture>): void {
    for (const r of res) this.track(r);
  }

  onDispose(d: Disposable | (() => void)): void {
    this.disposables.push(typeof d === 'function' ? { dispose: d } : d);
  }

  /** Recursively collect and free everything under a group, then remove it. */
  clearGroup(name: string): void {
    const g = this.groups.get(name);
    if (!g) return;
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) this.geoms.add(m.geometry);
      const mat = (m as THREE.Mesh).material;
      if (Array.isArray(mat)) mat.forEach((x) => this.mats.add(x));
      else if (mat) this.mats.add(mat as THREE.Material);
    });
    this.scene.remove(g);
    this.groups.delete(name);
  }

  dispose(): void {
    for (const d of this.disposables) { try { d.dispose(); } catch { /* ignore */ } }
    this.disposables.length = 0;
    for (const name of [...this.groups.keys()]) this.clearGroup(name);
    for (const g of this.geoms) g.dispose();
    for (const m of this.mats) {
      const anyMat = m as unknown as Record<string, unknown>;
      for (const k of Object.keys(anyMat)) {
        const v = anyMat[k] as THREE.Texture | undefined;
        if (v && (v as THREE.Texture).isTexture) this.texes.add(v);
      }
      m.dispose();
    }
    for (const t of this.texes) t.dispose();
    this.geoms.clear(); this.mats.clear(); this.texes.clear();
  }
}

export type QualityTier = 'LOW' | 'MEDIUM' | 'HIGH';

export interface QualitySettings {
  tier: QualityTier;
  pixelRatio: number;
  shadows: boolean;
  shadowMapSize: number;
  crowdDensity: number;     // 0..1
  particleScale: number;    // 0..1
  turfDetail: number;       // 0..1
  postProcessing: boolean;
  weatherDensity: number;   // 0..1
  anisotropy: number;
  athleteDetail: number;    // 0..1 → segment counts
}

export const QUALITY_PRESETS: Record<QualityTier, QualitySettings> = {
  LOW: {
    tier: 'LOW', pixelRatio: 1.0, shadows: false, shadowMapSize: 512, crowdDensity: 0.22,
    particleScale: 0.35, turfDetail: 0.2, postProcessing: false, weatherDensity: 0.3,
    anisotropy: 1, athleteDetail: 0.35,
  },
  MEDIUM: {
    tier: 'MEDIUM', pixelRatio: 1.25, shadows: true, shadowMapSize: 1024, crowdDensity: 0.55,
    particleScale: 0.7, turfDetail: 0.6, postProcessing: true, weatherDensity: 0.7,
    anisotropy: 4, athleteDetail: 0.7,
  },
  HIGH: {
    tier: 'HIGH', pixelRatio: 1.75, shadows: true, shadowMapSize: 2048, crowdDensity: 1.0,
    particleScale: 1.0, turfDetail: 1.0, postProcessing: true, weatherDensity: 1.0,
    anisotropy: 8, athleteDetail: 1.0,
  },
};
