import * as THREE from 'three';
import type { Conditions, StadiumDef, TeamDef } from '../../core/types.ts';
import type { SceneRegistry, QualitySettings } from '../registry.ts';
import { buildSky, skyPalette, type SkyHandle, type SkyPalette } from './sky.ts';
import { buildLighting, type LightingHandle } from './lighting.ts';
import { buildField, type FieldHandle } from './field.ts';
import { buildStadium, type StadiumHandle } from './stadium.ts';
import { buildCrowd, type CrowdHandle } from './crowd.ts';
import { buildWeather, type WeatherHandle } from './weather.ts';
import { disposeTextureCache } from './textures.ts';
import type { MfdStadiumVisualV1 } from '../stadiumVisual/index.ts';

/**
 * The whole venue in one call.
 *
 * Build order matters: the sky publishes the palette every other system reads, the stadium hands
 * its bowl layout to the crowd and its light-tower positions to the lighting rig, and weather
 * borrows the sky's fog to ramp. Tearing down frees every geometry, material and texture the
 * environment created, including the shared canvas texture cache.
 */

export interface EnvironmentOptions {
  home: TeamDef;
  away: TeamDef;
  stadium: StadiumDef;
  conditions: Conditions;
  quality: QualitySettings;
  /** Validated renderer-only semantic override selected by the existing stadium id. */
  visual?: MfdStadiumVisualV1;
  /** Stable promoted revision. Used by the renderer cache key and retained for diagnostics. */
  visualHash?: string;
  /** Presentation-only seed. Cosmetics stay reproducible across captures. */
  seed?: number;
}

export interface Environment {
  field: FieldHandle;
  stadium: StadiumHandle;
  crowd: CrowdHandle;
  sky: SkyHandle;
  lighting: LightingHandle;
  weather: WeatherHandle;
  palette: SkyPalette;
  update(dt: number, cameraPos: THREE.Vector3): void;
  dispose(): void;
}

export function buildEnvironment(reg: SceneRegistry, o: EnvironmentOptions): Environment {
  const seed = o.seed ?? 0x60d1;
  let sky: SkyHandle | null = null;
  let stadium: StadiumHandle | null = null;
  let crowd: CrowdHandle | null = null;
  let field: FieldHandle | null = null;
  let lighting: LightingHandle | null = null;
  let weather: WeatherHandle | null = null;

  try {
    sky = buildSky(reg, {
      skyKind: o.stadium.skyKind,
      quality: o.quality,
      windX: o.conditions.windX,
      windZ: o.conditions.windZ,
      roof: o.stadium.roof,
    });

    stadium = buildStadium(reg, {
      home: o.home,
      away: o.away,
      stadium: o.stadium,
      quality: o.quality,
      palette: sky.palette,
      visual: o.visual,
      visualHash: o.visualHash,
    });

    crowd = buildCrowd(reg, {
      home: o.home,
      away: o.away,
      stadium: o.stadium,
      quality: o.quality,
      layout: stadium.layout,
      seed,
    });

    field = buildField(reg, {
      home: o.home,
      away: o.away,
      stadium: o.stadium,
      conditions: o.conditions,
      quality: o.quality,
    });

    lighting = buildLighting(reg, {
      palette: sky.palette,
      quality: o.quality,
      roof: o.stadium.roof,
      accent: o.stadium.accent,
      towers: stadium.towers,
    });

    weather = buildWeather(reg, {
      conditions: o.conditions,
      quality: o.quality,
      sky,
      seed,
    });
  } catch (error) {
    // A semantic/compiler failure must not strand a partially-built named group. Dispose in the
    // same reverse order as a completed environment, then let the caller surface the failure.
    weather?.dispose();
    lighting?.dispose();
    field?.dispose();
    crowd?.dispose();
    stadium?.dispose();
    sky?.dispose();
    // Handles only exist after their builders return. These clears catch resources registered by a
    // builder that threw before publishing its handle; all calls are harmless when already empty.
    for (const name of ['env.weather', 'env.light', 'env.field', 'env.crowd', 'env.stadium', 'env.sky']) {
      reg.clearGroup(name);
    }
    reg.scene.fog = null;
    disposeTextureCache();
    throw error;
  }

  const builtSky = sky;
  const builtStadium = stadium;
  const builtCrowd = crowd;
  const builtField = field;
  const builtLighting = lighting;
  const builtWeather = weather;
  if (!builtSky || !builtStadium || !builtCrowd || !builtField || !builtLighting || !builtWeather) {
    throw new Error('Environment construction incomplete');
  }

  let disposed = false;

  return {
    field: builtField,
    stadium: builtStadium,
    crowd: builtCrowd,
    sky: builtSky,
    lighting: builtLighting,
    weather: builtWeather,
    palette: builtSky.palette,
    update(dt: number, cameraPos: THREE.Vector3): void {
      builtSky.update(dt);
      builtCrowd.update(dt);
      builtField.update(dt);
      builtStadium.update(dt);
      builtLighting.update(dt);
      builtWeather.update(dt, cameraPos);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      builtWeather.dispose();
      builtLighting.dispose();
      builtField.dispose();
      builtCrowd.dispose();
      builtStadium.dispose();
      builtSky.dispose();
      disposeTextureCache();
    },
  };
}

export { skyPalette, disposeTextureCache };
export type { SkyHandle, SkyPalette, LightingHandle, FieldHandle, StadiumHandle, CrowdHandle, WeatherHandle };
export type { BowlLayout, SeatBand } from './stadium.ts';
export type { GoalInfo } from './field.ts';
