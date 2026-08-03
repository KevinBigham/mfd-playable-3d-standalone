# WAVE 1 RECEIPT — Mobile correctness

**Objective:** Eliminate P0 pause, touch-state, lifecycle, and touch-completeness defects.
Tasks W1-001..W1-008.

## Files added

- `src/app/pauseController.ts` — reason-token pause (USER/MODAL/ORIENTATION/LIFECYCLE/LOADING/REPLAY/RECOVERY).
- `src/app/mobileLifecycle.ts` — single owner for visibilitychange/pagehide/freeze/blur/focus:
  pause token, hard input reset, audio suspend, checkpoint flush, explicit resume card.
- `src/app/featureFlags.ts` — centralized migration flags (`?ff=` override); defaults recorded there.
- `tools/lifecycleprobe.ts` (`npm run lifecycle`) — 20 browser checks: nested-screen freeze,
  interruption matrix, SNAP ownership, 100 cycles, checkpoint flush, context loss/restore.
- `tools/classicprobe.ts` (`npm run classic`) — 18 browser checks: full Classic match completed
  touch-only, incl. page/mirror/hide buttons, punt, FG, go-for-it, both kickoff arms, conversion.
- `tests/pauseController.test.ts`, `tests/kickoffChoice.test.ts`, `tests/saveDebounce.test.ts`.

## Defects fixed (with the shipped behavior they replace)

| Finding | Fix |
|---|---|
| F-001 Pause unmount resumed hidden match | PauseScreen holds a USER token; unmount never releases it; Settings/Controls hold MODAL while mounted. Proven: 10 s behind Settings advances 0 ticks (was: match ran) |
| F-002 `releaseAll()` incomplete | `resetAll(reason)` clears touches, captures, move, turbo, latch, aim, forceMove, LOB, SNAP/badge press classes, and neutralizes input-manager edge history (`neutralizeSeat`) |
| F-003 SNAP not pointer-owned | SNAP is a tracked pointer: press on down, commit on release-inside, slide-off cancels, 150 ms tap-through lock, cancel path never fires |
| F-004 Touch dead in play-call states | PlaySelect gained real PAGE/FLIP/HIDE buttons and a 4th-down special bar; conversion prompt was already tappable; kickoff choice prompt added |
| F-005 Displayed PUNT cell did nothing | Special calls are real buttons dispatching `submitOffense(null,'PUNT'/'FIELD_GOAL')`; fake label cell removed |
| F-006 Touch context synced after render | `sync()` split: `prepareContext()` before `input.poll()`, `projectVisuals()` after render. Harnesses updated to the same order |
| (new) Human onside kick impossible | `Match.submitKickoff('DEEP'|'ONSIDE')` + `kickoffAwaitingChoice`; launch waits for a human choice (4 s deep default); dead "UP+TURBO+JUMP" hint removed; on-screen prompt for all devices |
| F-013 partial / W1-008 | `writeSaveDebounced` (350 ms trailing) for settings; `flushSave()` on lifecycle/unmount; memory-only backend disclosed in Settings and on SAVE & QUIT label |
| W1-007 context loss | `webglcontextlost` → preventDefault, RECOVERY pause, input reset, checkpoint flush, honest overlay + reload option; render fully suppressed while lost; restore lands on pause card |
| (new) pointer cancel fired actions | `pointercancel`/`lostpointercapture` route to a cancel path that commits nothing (a cancelled badge drag used to throw the ball) |

## Deterministic safety

- CPU-vs-CPU behavior byte-identical (test: same seed twice → same score and tick count; 25/25
  scenarios, 12/12 determinism checks, 19/19 human checks unchanged).
- The kickoff-choice launch delay applies only to human kickers; CPU path and RNG untouched.

## Gates

| Gate | Result | Receipt |
|---|---|---|
| Unit tests | 238/238 | vitest |
| Scenarios / determinism / human | 25/25 · 12/12 · 19/19 | re-run post-change |
| Touch probe | 30/30 | `receipts/wave1-touchprobe.txt` |
| Lifecycle probe (incl. nested freeze, 100 cycles, context loss) | 20/20 | `receipts/wave1-lifecycleprobe.txt` |
| Classic touch-only completeness | 18/18 | `receipts/wave1-classicprobe.txt` |
| Standalone artifact | 11/11 checks, still one file | `npm run artifact:check` |

## Flag defaults after this wave

pauseControllerV2=on, mobileLifecycleV2=on, touchControlsV2=on (these replaced their predecessors
in place — the old paths were single-line writes, not parallel systems; the flags gate future
switchable work). All Wave 2+ flags off.

## Remaining risks

- Touch-only PlaySelect buttons are functional but not yet ergonomic (Wave 2's job).
- Checkpoint granularity is the last dead ball; mid-play progress is by design not preserved.
- Physical-device evidence still absent — all receipts are Chromium touch emulation.

## Next-wave eligibility

All Wave 1 exit criteria pass: no hidden simulation behind nested screens, touch-only Classic
completion, 100 interruption cycles clean, context loss recoverable. **Wave 2 unblocked.**
