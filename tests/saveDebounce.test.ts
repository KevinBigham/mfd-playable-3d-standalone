import { describe, it, expect, vi, afterEach } from 'vitest';
import { getSave, writeSave, writeSaveDebounced, flushSave, loadSave } from '../src/persistence/save.ts';

/**
 * Settings write discipline: memory immediately, storage once after settling, and a flush that
 * makes a pending write durable before a lifecycle death. (Node has no localStorage, so the
 * memory backend is what these run against — the debounce logic is identical.)
 */
describe('debounced save writes', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('applies to memory immediately but coalesces storage writes', () => {
    vi.useFakeTimers();
    const s = getSave();
    const original = s.settings.cameraShake;
    writeSaveDebounced({ settings: { ...s.settings, cameraShake: 0.11 } });
    writeSaveDebounced({ settings: { ...s.settings, cameraShake: 0.22 } });
    writeSaveDebounced({ settings: { ...s.settings, cameraShake: 0.33 } });
    // Memory sees the latest value at once.
    expect(getSave().settings.cameraShake).toBe(0.33);
    // Storage settles to exactly the last value after the debounce window.
    vi.advanceTimersByTime(400);
    expect(loadSave().settings.cameraShake).toBe(0.33);
    writeSave({ settings: { ...getSave().settings, cameraShake: original } });
  });

  it('flushSave makes a pending write durable immediately', () => {
    vi.useFakeTimers();
    const s = getSave();
    writeSaveDebounced({ settings: { ...s.settings, screenFlash: 0.17 } });
    flushSave();                       // lifecycle interruption path
    expect(loadSave().settings.screenFlash).toBe(0.17);
    // No timer left behind to double-write.
    vi.advanceTimersByTime(1000);
    expect(loadSave().settings.screenFlash).toBe(0.17);
  });
});
