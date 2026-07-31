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

  const sky = buildSky(reg, {
    skyKind: o.stadium.skyKind,
    quality: o.quality,
    windX: o.conditions.windX,
    windZ: o.conditions.windZ,
    roof: o.stadium.roof,
  });

  const stadium = buildStadium(reg, {
    home: o.home,
    away: o.away,
    stadium: o.stadium,
    quality: o.quality,
    palette: sky.palette,
  });

  const crowd = buildCrowd(reg, {
    home: o.home,
    away: o.away,
    stadium: o.stadium,
    quality: o.quality,
    layout: stadium.layout,
    seed,
  });

  const field = buildField(reg, {
    home: o.home,
    away: o.away,
    stadium: o.stadium,
    conditions: o.conditions,
    quality: o.quality,
  });

  const lighting = buildLighting(reg, {
    palette: sky.palette,
    quality: o.quality,
    roof: o.stadium.roof,
    accent: o.stadium.accent,
    towers: stadium.towers,
  });

  const weather = buildWeather(reg, {
    conditions: o.conditions,
    quality: o.quality,
    sky,
    seed,
  });

  let disposed = false;

  return {
    field, stadium, crowd, sky, lighting, weather,
    palette: sky.palette,
    update(dt: number, cameraPos: THREE.Vector3): void {
      sky.update(dt);
      crowd.update(dt);
      field.update(dt);
      stadium.update(dt);
      lighting.update(dt);
      weather.update(dt, cameraPos);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      weather.dispose();
      lighting.dispose();
      field.dispose();
      crowd.dispose();
      stadium.dispose();
      sky.dispose();
      disposeTextureCache();
    },
  };
}

export { skyPalette, disposeTextureCache };
export type { SkyHandle, SkyPalette, LightingHandle, FieldHandle, StadiumHandle, CrowdHandle, WeatherHandle };
export type { BowlLayout, SeatBand } from './stadium.ts';
export type { GoalInfo } from './field.ts';
