# MOBILE TRANSFORMATION STATUS

**Branch:** `mobile-transformation` (baseline tag: `baseline-untouched`, commit `f37230e`)
**Handoff:** FABLE 5 HIGH mobile optimization packet (extracted flat at `../mfd-mobile-handoff/`; the
packet's `00_INPUTS` source zip, `02_EXECUTION` templates, and `04_RECEIPTS` folders were not in the
archive — the live repository at this directory is the source of truth, and fresh receipts are
regenerated under `reports/mobile/receipts/`).
**Environment:** Node v24.14.1, npm 11.11.0, macOS arm64. Clean `npm install` succeeded (the audit
environment's `why-is-node-running` registry 404 did not reproduce here).

## Current wave

**Wave 0 — Evidence integrity: COMPLETE.**
**Wave 1 — Mobile correctness: COMPLETE** (see `reports/mobile/WAVE_1_RECEIPT.md` — pause tokens,
complete touch reset, SNAP ownership, pre-sim context split, touch-complete Classic incl. new
human onside-kick path, MobileLifecycle, context-loss recovery, debounced saves. 30/30 touch,
20/20 lifecycle, 18/18 classic browser checks).
**Wave 2 — Control ergonomics: COMPLETE** (see `reports/mobile/WAVE_2_RECEIPT.md` — TouchProfile v1,
safe-area ControlLayout with clamped stick + handedness mirroring, hold-at-edge turbo with
hysteresis, GestureRecognizer with reversal-cancel, THUMB_FAN + DIRECT_FIELD surfaces with proven
semantic parity, adaptive pass default, compact HUD, 9 customization rows. W2-011 physical A/B:
WAITING_FOR_PHYSICAL_EVIDENCE — protocol + telemetry shipped, both surfaces retained).
**Wave 3 — Core fun: in progress.**

## Wave 0 results

| Task | Status | Evidence |
|---|---|---|
| W0-001 throw denominators | DONE | `tools/lib/throwLedger.ts`, `tests/throwLedger.test.ts`, corrected `tools/driveprobe.ts` |
| W0-002 interception semantics | DONE | driveprobe/passprobe print defender-possession EVENT, credited STAT, turnover DRIVE, bobble→defense separately, each with numerator/denominator |
| W0-003 probe fingerprint | DONE | `tools/lib/fingerprint.ts`; `RULES_VERSION` added to `src/core/constants.ts` (v1 = received baseline) |
| W0-004 baseline bundle | DONE | `npm run mobile:baseline` → `reports/mobile/receipts/baseline.json` + per-tool receipts |
| W0-005 policy harness | DONE | `npm run policyprobe` → matched-seed 9-policy matrix + `policyprobe.json` |

### Corrected headline numbers (seeds 4400.., PRO, 120 s quarters, rules v1)

- DEEP true completion: **176/302 = 58.3% of actual throws** (the old 75% figure divided by
  `catches + incompletes` and is invalid; 18+ air-yard throws complete 38% per deepprobe).
- Defender-possession events: 101/501 = 20.2% of throws. Credited INTs: 55/501 = 11.0% of official
  attempts. INT-ended drives: 55/320 = 17.2%. Bobble→defense: 13/21 = 61.9%. These are three
  different measures and are now printed as such.
- Policy matrix (seeds 7700-7709): READ_PLACEMENT 1.35 EP/drive vs REPEATED_PRIMARY 0.97
  (+40.1%, fewer turnover drives) — but READ_TIMING 1.74, DEEP_SPAM 1.64, REPEATED_DEEPEST 1.54.
  **Blind-deep spam still out-scores placement-informed play; the Wave 3 tuning target is to make
  informed reads dominate all blind arms, not just the middle-button arm.**

## Feature flags

Centralized in `src/app/featureFlags.ts` (created in Wave 1). Defaults recorded there.

## Known failures / caveats

- `tests/purity.test.ts` required an empty `public/` dir that zip extraction dropped; restored.
- Physical-device, human-participant, thermal, and battery gates cannot run in this environment;
  they are tracked as `WAITING_FOR_PHYSICAL_EVIDENCE`, never claimed passed.
- `tools/touchprobe.ts` (Playwright) — available here; will be exercised from Wave 1 on.

## Receipts

- `reports/mobile/receipts/environment.txt` — env + commit
- `reports/mobile/receipts/baseline-*.txt` — pre-change receipts of the received build
- `reports/mobile/receipts/*.txt`, `baseline.json`, `policyprobe.json` — post-Wave-0 instruments
- `reports/mobile/WAVE_0_RECEIPT.md` — wave receipt

## Decisions

- D-001: The handoff zip lacked the nested folder structure its README describes; proceeded with
  flat files + live repo. No content conflict found.
- D-002: `RULES_VERSION = 1` pinned to received behavior; any intentional balance change bumps it.
- D-003: Policy-probe informed arms use only screen-visible facts (openness, depth, leverage
  geometry); verified no future-RNG or defensive-call access.
