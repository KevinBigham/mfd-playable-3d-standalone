# WAVE 0 RECEIPT — Evidence integrity

**Objective:** Make every later tuning claim trustworthy. Tasks W0-001..W0-005.
**Branch/commit:** `mobile-transformation` on top of baseline `f37230e`.
**Environment:** Node v24.14.1 / npm 11.11.0 / macOS arm64 (see `receipts/environment.txt`).

## Files added

- `tools/lib/throwLedger.ts` — single definition of throw outcomes (CAUGHT / DROPPED / SWATTED /
  DEFENDER_POSSESSION / FELL_INCOMPLETE, bobble as intermediate), reconciliation guarantee.
- `tools/lib/fingerprint.ts` — build/rules/seed/team/difficulty/assist fingerprint on every probe.
- `tools/policyprobe.ts` — matched-seed 9-policy decision-quality harness (`npm run policyprobe`).
- `tools/mobilebaseline.ts` — one-command receipt bundle (`npm run mobile:baseline`).
- `tests/throwLedger.test.ts` — metric fixture: catch, incompletion, drop, swat, bobble both ways,
  sack (not a throw), throwaway, clean pick; asserts exhaustive mutually exclusive reconciliation.

## Files edited

- `src/core/constants.ts` — `RULES_VERSION = 1` (pins received behavior; no behavioral change).
- `tools/driveprobe.ts` — comp% now caught / actual throws; per-family outcome table with
  reconciliation column; three separate interception measures with explicit denominators.
- `tools/passprobe.ts` — rewritten around the ledger; defender-possession EVENT vs credited STAT
  vs turnover DRIVE vs pick-six, each with numerator/denominator; exits nonzero on reconciliation
  failure.
- `package.json` — `policyprobe`, `mobile:baseline` scripts.
- `tests/purity.test.ts` unblocked by restoring the empty `public/` dir (zip extraction dropped it).

## Behavior before → after

- Before: `comp% = catches/(catches+incompletes)` — DEEP printed 75%. After: DEEP = 176/302 =
  58.3% of actual throws (and 38% for 18+ air yards per deepprobe, unchanged tool).
- Before: one ambiguous "interception" figure. After: 20.2%/throw event rate, 11.0%/attempt
  credited rate, 17.2%/drive turnover rate, 61.9% bobble→defense, printed as separate measures.
- No simulation, rules, or tuning change of any kind in this wave. Deterministic receipts
  (scenarios 25/25, determinism 12/12, human 19/19) identical before and after.

## Commands run and gates

| Gate | Result |
|---|---|
| `npm run mobile:baseline` | ALL GREEN — 12/12 steps pass, receipts archived |
| Outcome reconciliation | every family row and ALL row reconcile (`driveprobe`, `passprobe`) |
| Fixture test | 3/3 pass (`tests/throwLedger.test.ts`) |
| Repeat-run stability | driveprobe/passprobe re-run identical (fixed seeds, deterministic sim) |
| Policy harness | 9 policies × 10 matched seeds; JSON receipt with fingerprint |

## Policy matrix baseline (rules v1 — pre-tuning)

READ_PLACEMENT 1.35 EP/drive vs REPEATED_PRIMARY 0.97 (+40.1%, fewer turnovers) — but
READ_TIMING 1.74, DEEP_SPAM 1.64, REPEATED_DEEPEST 1.54 confirm blind-deep economy remains
inverted. This is the Wave 3 instrument and starting measurement, not a pass of the fun gate.

## Remaining risks

- Policy arms are heuristic scripts; Wave 3 may refine them but must not tune the sim TO them.
- `acceptance.ts`/`touchprobe.ts` (Playwright/browser) not yet in the bundle; joined in Wave 1.

## Next-wave eligibility

All Wave 0 exit criteria met: outcomes reconcile to actual throws, repeated runs stable,
fingerprints on every receipt, no tuning performed. **Wave 1 unblocked.**
