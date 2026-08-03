/**
 * Headless-safety suite for src/audio.
 *
 * These tests run in Node, where `AudioContext` does not exist. That is exactly the
 * environment `tools/smoke.ts` and the batch simulator run in, so the contract is:
 * construct, call anything, dispose twice — never throw, never touch the DOM.
 */

import { describe, it, expect } from 'vitest';
import { createAudio, AudioEngine, BUS_NAMES, MAX_VOICES, type BusName } from './index.ts';
import { Sfx } from './sfx.ts';
import { CrowdBed } from './crowd.ts';
import { AudioDirector, MusicDirector } from './director.ts';
import { getNoiseBuffer } from './synth.ts';
import { EventBus } from '../core/events.ts';
import type { GameEvent } from '../core/types.ts';

/** Every named one-shot, called with its default arguments. */
function callEverySfx(sfx: Sfx): void {
  sfx.snap();
  sfx.throw();
  sfx.catchGood();
  sfx.catchContested();
  sfx.drop();
  sfx.swat();
  sfx.intercept();
  sfx.footstepL();
  sfx.footstepR();
  sfx.footstep2();
  sfx.sprint();
  sfx.slide();
  sfx.bodyContact(0.5);
  sfx.bodyContact(1.4, -0.8);
  sfx.tackleStd();
  sfx.tackleBig();
  sfx.tacklePower();
  sfx.brokenTackle();
  sfx.hurdle();
  sfx.spin();
  sfx.stiffArm();
  sfx.dive();
  sfx.lateral();
  sfx.fumble();
  sfx.recover();
  sfx.kick();
  sfx.punt();
  sfx.goalpostHit();
  sfx.whistle();
  sfx.firstDown();
  sfx.downMarker();
  sfx.turnoverSting();
  sfx.touchdownSting();
  sfx.fieldGoalGood();
  sfx.fieldGoalMiss();
  sfx.safety();
  sfx.overdriveStart();
  sfx.overdriveEnd();
  sfx.quarterEnd();
  sfx.gameEnd();
  sfx.menuMove();
  sfx.menuSelect();
  sfx.menuBack();
  sfx.menuError();
  sfx.countdownTick();
}

const SAMPLE_EVENTS: GameEvent[] = [
  { type: 'play.start', tick: 1, play: 'x', side: 0 },
  { type: 'snap', tick: 2, side: 0 },
  { type: 'handoff', tick: 3, to: 4 },
  { type: 'throw', tick: 4, from: 0, to: 3, passKind: 'BULLET' },
  { type: 'pass.arrive', tick: 5, at: { x: 4, y: 2, z: 40 } },
  { type: 'catch', tick: 6, by: 3, contested: true, diving: true, yards: 22 },
  { type: 'drop', tick: 7, by: 3 },
  { type: 'swat', tick: 8, by: 9 },
  { type: 'interception', tick: 9, by: 9 },
  { type: 'lateral', tick: 10, from: 3, to: 4 },
  { type: 'fumble', tick: 11, by: 4, forcedBy: 9 },
  { type: 'recover', tick: 12, by: 9, side: 1 },
  { type: 'tackle', tick: 13, by: 9, on: 4, power: 0.4 },
  { type: 'tackle', tick: 14, by: 9, on: 4, power: 1.2 },
  { type: 'bigHit', tick: 15, by: 9, on: 4, power: 1.4 },
  { type: 'brokenTackle', tick: 16, by: 4, on: 9 },
  { type: 'sack', tick: 17, by: 9, on: 0, yards: -6 },
  { type: 'move', tick: 18, by: 4, move: 'SPIN' },
  { type: 'move', tick: 19, by: 4, move: 'HIGH_HURDLE' },
  { type: 'move', tick: 20, by: 4, move: 'DIVE' },
  { type: 'move', tick: 21, by: 4, move: 'STIFFARM' },
  { type: 'block.win', tick: 22, by: 5, on: 10, pancake: true },
  { type: 'firstDown', tick: 23, side: 0 },
  { type: 'down.change', tick: 24, down: 2, distance: 12 },
  { type: 'turnover', tick: 25, to: 1, kind: 'INT' },
  { type: 'turnover', tick: 26, to: 0, kind: 'PUNT' },
  { type: 'touchdown', tick: 27, side: 0, by: 3, yards: 40 },
  { type: 'fieldGoal.attempt', tick: 28, side: 0, distance: 38 },
  { type: 'fieldGoal.result', tick: 29, side: 0, good: true, distance: 38 },
  { type: 'fieldGoal.result', tick: 30, side: 1, good: false, distance: 49 },
  { type: 'punt', tick: 31, side: 0, distance: 41 },
  { type: 'kickoff', tick: 32, side: 0, onside: true },
  { type: 'safety', tick: 33, against: 1 },
  { type: 'touchback', tick: 34 },
  { type: 'extraPoint', tick: 35, side: 0, good: true },
  { type: 'twoPoint', tick: 36, side: 1, good: false },
  { type: 'outOfBounds', tick: 37, at: { x: -26, y: 0, z: 55 } },
  { type: 'overdrive.charge', tick: 38, side: 0, progress: 0.66 },
  { type: 'overdrive.start', tick: 39, side: 0, cause: 'CATCH' },
  { type: 'overdrive.end', tick: 40, side: 0, cause: 'TIME' },
  { type: 'play.end', tick: 41, reason: 'TACKLE', spotZ: 96, yards: 12 },
  { type: 'play.end', tick: 42, reason: 'TOUCHDOWN', spotZ: 100, yards: 12 },
  { type: 'quarter.end', tick: 43, quarter: 3 },
  { type: 'half', tick: 44 },
  { type: 'overtime', tick: 45, period: 1 },
  { type: 'match.end', tick: 46, winner: 0 },
  { type: 'match.end', tick: 47, winner: 'TIE' },
  { type: 'camera.impulse', tick: 48, power: 1, at: { x: 0, y: 1, z: 50 } },
  { type: 'crowd.swell', tick: 49, power: 0.8, side: 1 },
  { type: 'rules.watchdog', tick: 50, phase: 'LIVE' },
  { type: 'ui.tick', tick: 51 },
  { type: 'ui.confirm', tick: 52 },
  { type: 'ui.back', tick: 53 },
];

describe('audio — headless no-op path', () => {
  it('has no AudioContext in this environment', () => {
    expect((globalThis as { AudioContext?: unknown }).AudioContext).toBeUndefined();
  });

  it('createAudio() succeeds and reports unavailable', () => {
    const a = createAudio();
    expect(a.engine).toBeInstanceOf(AudioEngine);
    expect(a.sfx).toBeInstanceOf(Sfx);
    expect(a.crowd).toBeInstanceOf(CrowdBed);
    expect(a.director).toBeInstanceOf(AudioDirector);
    expect(a.music).toBeInstanceOf(MusicDirector);
    expect(a.engine.available).toBe(false);
    expect(a.engine.state).toBe('unavailable');
    expect(a.engine.now).toBe(0);
    a.dispose();
  });

  it('unlock() is a safe no-op without Web Audio', () => {
    const a = createAudio();
    expect(() => { a.engine.unlock(); a.engine.unlock(); }).not.toThrow();
    expect(a.engine.available).toBe(false);
    expect(a.engine.voice('sfx')).toBeNull();
    expect(a.engine.busInput('sfx')).toBeNull();
    expect(a.engine.noise('pink')).toBeNull();
    expect(a.engine.voiceCount).toBe(0);
    a.dispose();
  });

  it('every sfx one-shot can be called without throwing', () => {
    const a = createAudio();
    expect(() => callEverySfx(a.sfx)).not.toThrow();
    // Repeat runs exercise the variant + rate-limit bookkeeping.
    expect(() => { callEverySfx(a.sfx); callEverySfx(a.sfx); }).not.toThrow();
    a.dispose();
  });

  it('crowd and music controls are safe', () => {
    const a = createAudio();
    expect(() => {
      a.crowd.start();
      a.crowd.setEnergy(0.8);
      a.crowd.swell(1.2, 900);
      a.crowd.swellFor(0, 1);
      a.crowd.swellFor(1, 1);
      a.crowd.swellFor(-1, 0.5);
      a.crowd.boo();
      a.crowd.gasp();
      a.crowd.chant(104);
      a.crowd.chant(0);
      a.crowd.setHomeBias(0.9);
      a.crowd.setEnabled(false);
      a.crowd.setEnabled(true);
      a.crowd.stop();
      a.music.start();
      a.music.setIntensity(1);
      a.music.sting('touchdown');
      a.music.sting('turnover');
      a.music.sting('fieldGoal');
      a.music.sting('miss');
      a.music.sting('overdrive');
      a.music.sting('quarter');
      a.music.sting('win');
      a.music.sting('lose');
      a.music.stop();
    }).not.toThrow();
    expect(a.crowd.getHomeBias()).toBeCloseTo(0.9);
    expect(a.crowd.getEnergy()).toBeGreaterThanOrEqual(0);
    a.dispose();
  });

  it('the director maps every event type without throwing', () => {
    const a = createAudio();
    const bus = new EventBus();
    a.director.attach(bus);
    expect(a.director.attached).toBe(true);
    for (const e of SAMPLE_EVENTS) expect(() => bus.emit(e)).not.toThrow();
    // Unknown event types must be tolerated (ARCHITECTURE §7).
    expect(() => a.director.handle({ type: 'not.a.real.event', tick: 99 } as unknown as GameEvent)).not.toThrow();
    a.director.detach();
    expect(a.director.attached).toBe(false);
    a.dispose();
  });

  it('does not double-handle when the shell also forwards bus events', () => {
    const a = createAudio();
    const bus = new EventBus();
    a.director.attach(bus);
    const e: GameEvent = { type: 'touchdown', tick: 1, side: 0, by: 3, yards: 40 };
    bus.emit(e);
    expect(() => a.director.handle(e)).not.toThrow();
    a.dispose();
  });

  it('setVolume/getVolume round-trips and clamps on every bus', () => {
    const engine = new AudioEngine();
    for (const bus of BUS_NAMES) {
      engine.setVolume(bus, 0.42);
      expect(engine.getVolume(bus)).toBe(0.42);
      engine.setVolume(bus, 0);
      expect(engine.getVolume(bus)).toBe(0);
      engine.setVolume(bus, 1);
      expect(engine.getVolume(bus)).toBe(1);
      engine.setVolume(bus, 4);
      expect(engine.getVolume(bus)).toBe(1);
      engine.setVolume(bus, -3);
      expect(engine.getVolume(bus)).toBe(0);
      engine.setVolume(bus, Number.NaN);
      expect(engine.getVolume(bus)).toBe(0);
      engine.setVolume(bus, 0.75);
      expect(engine.getVolume(bus)).toBe(0.75);
    }
    // Volumes survive an unlock attempt that cannot create a context.
    engine.unlock();
    expect(engine.getVolume('music')).toBe(0.75);
    engine.dispose();
  });

  it('mute state round-trips independently of volume', () => {
    const engine = new AudioEngine();
    for (const bus of BUS_NAMES) {
      expect(engine.isMuted(bus)).toBe(false);
      engine.setVolume(bus, 0.6);
      engine.mute(bus);
      expect(engine.isMuted(bus)).toBe(true);
      expect(engine.getVolume(bus)).toBe(0.6);
      expect(engine.toggleMute(bus)).toBe(false);
      engine.setMute(bus, true);
      expect(engine.isMuted(bus)).toBe(true);
      engine.setMute(bus, false);
      expect(engine.isMuted(bus)).toBe(false);
    }
    engine.dispose();
  });

  it('ignores unknown bus names instead of throwing', () => {
    const engine = new AudioEngine();
    const bogus = 'nope' as BusName;
    expect(() => engine.setVolume(bogus, 0.5)).not.toThrow();
    expect(engine.getVolume(bogus)).toBe(0);
    expect(engine.isMuted(bogus)).toBe(false);
    expect(engine.toggleMute(bogus)).toBe(false);
    expect(() => engine.duck(bogus, 0.5)).not.toThrow();
    engine.dispose();
  });

  it('exposes a sane voice budget', () => {
    expect(MAX_VOICES).toBe(24);
  });

  it('suspend/resume/duck/stopAllVoices are safe while headless', () => {
    const a = createAudio();
    expect(() => {
      a.engine.suspend();
      a.engine.resume();
      a.engine.duck('crowd', 0.5, 20, 100, 200);
      a.engine.stopAllVoices();
      a.engine.onReady(() => { throw new Error('must not run without a context'); });
    }).not.toThrow();
    a.dispose();
  });

  it('getNoiseBuffer tolerates a context that cannot create buffers', () => {
    const fake = {
      sampleRate: 48000,
      createBuffer(): AudioBuffer { throw new Error('no buffers here'); },
    } as unknown as BaseAudioContext;
    expect(getNoiseBuffer(fake, 'white')).toBeNull();
    expect(getNoiseBuffer(fake, 'pink')).toBeNull();
  });

  it('dispose() is safe twice, at every level', () => {
    const a = createAudio();
    a.crowd.start();
    a.music.start();
    a.director.attach(new EventBus());
    expect(() => { a.dispose(); a.dispose(); }).not.toThrow();

    const engine = new AudioEngine();
    expect(() => { engine.dispose(); engine.dispose(); }).not.toThrow();
    // Post-dispose calls must stay silent rather than explode.
    expect(() => { engine.unlock(); engine.setVolume('sfx', 0.3); engine.suspend(); }).not.toThrow();
    expect(engine.voice('sfx')).toBeNull();

    const crowd = new CrowdBed(engine);
    expect(() => { crowd.dispose(); crowd.dispose(); crowd.start(); crowd.swell(1); }).not.toThrow();

    const music = new MusicDirector(engine);
    expect(() => { music.dispose(); music.dispose(); music.start(); music.sting('win'); }).not.toThrow();

    const director = new AudioDirector(engine, new Sfx(engine), crowd, music);
    expect(() => { director.dispose(); director.dispose(); director.detach(); }).not.toThrow();
  });
});
