/**
 * GRIDIRON OVERDRIVE — audio barrel.
 *
 * The whole subsystem is procedural: no sample files, no fetches, no external assets.
 * `createAudio()` is safe to call in Node (tools/smoke.ts) — without an AudioContext
 * every object is constructed normally and every method is a no-op.
 */

export { AudioEngine, BUS_NAMES, MAX_VOICES } from './engine.ts';
export type { BusName, VoiceSlot, VoiceOptions } from './engine.ts';
export { Sfx } from './sfx.ts';
export { CrowdBed } from './crowd.ts';
export { AudioDirector, MusicDirector } from './director.ts';
export type { StingKind } from './director.ts';
export {
  noiseBurst, thump, crack, whoosh, tone, chime, stab, brass, metallic, grit,
  getNoiseBuffer, env, envArch, rnd, vary, pick,
} from './synth.ts';
export type { NoiseKind } from './synth.ts';

import { AudioEngine } from './engine.ts';
import { Sfx } from './sfx.ts';
import { CrowdBed } from './crowd.ts';
import { AudioDirector, MusicDirector } from './director.ts';

export interface AudioSuite {
  engine: AudioEngine;
  sfx: Sfx;
  crowd: CrowdBed;
  director: AudioDirector;
  music: MusicDirector;
  /** Tears down every part of the suite. Safe to call twice. */
  dispose(): void;
}

/** Build the full audio stack. Nothing is allocated on the audio thread until `unlock()`. */
export function createAudio(): AudioSuite {
  const engine = new AudioEngine();
  const sfx = new Sfx(engine);
  const crowd = new CrowdBed(engine);
  const music = new MusicDirector(engine);
  const director = new AudioDirector(engine, sfx, crowd, music);
  return {
    engine, sfx, crowd, director, music,
    dispose(): void {
      director.dispose();
      music.dispose();
      crowd.dispose();
      engine.dispose();
    },
  };
}
