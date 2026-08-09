import { describe, expect, it } from 'vitest';
import { rendererSceneKey } from '../src/render/renderer.ts';
import { QUALITY_PRESETS } from '../src/render/registry.ts';

const home = { id: 'home' };
const away = { id: 'away' };
const stadium = { id: 'the-saltpan' };
const baseConditions = {
  weather: 'CLEAR' as const,
  surface: 'SAND' as const,
  windX: 0,
  windZ: 0,
};

describe('native stadium renderer seams', () => {
  it('keeps equivalent scene requests on the same cache key', () => {
    expect(rendererSceneKey(home, away, stadium, baseConditions, QUALITY_PRESETS.HIGH, 'visual-a'))
      .toBe(rendererSceneKey(home, away, stadium, { ...baseConditions },
        { ...QUALITY_PRESETS.HIGH }, 'visual-a'));
  });

  it('rebuilds when the promoted revision or any built environment input changes', () => {
    const key = rendererSceneKey(home, away, stadium, baseConditions, QUALITY_PRESETS.HIGH, 'visual-a');
    const variants = [
      rendererSceneKey(home, away, stadium, baseConditions, QUALITY_PRESETS.HIGH, 'visual-b'),
      rendererSceneKey(home, away, stadium, { ...baseConditions, surface: 'TURF' },
        QUALITY_PRESETS.HIGH, 'visual-a'),
      rendererSceneKey(home, away, stadium, { ...baseConditions, windX: 1 },
        QUALITY_PRESETS.HIGH, 'visual-a'),
      rendererSceneKey(home, away, stadium, { ...baseConditions, windZ: -1 },
        QUALITY_PRESETS.HIGH, 'visual-a'),
      rendererSceneKey(home, away, stadium, { ...baseConditions, weather: 'RAIN' },
        QUALITY_PRESETS.HIGH, 'visual-a'),
      rendererSceneKey(home, away, stadium, baseConditions, QUALITY_PRESETS.LOW, 'visual-a'),
    ];
    expect(new Set(variants).size).toBe(variants.length);
    for (const variant of variants) expect(variant).not.toBe(key);
  });
});
