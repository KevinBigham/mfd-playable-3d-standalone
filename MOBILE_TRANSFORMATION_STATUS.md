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
**Wave 4 — Mobile product: COMPLETE** (see `reports/mobile/WAVE_4_RECEIPT.md` — Mobile Home, three-card
play call, Drive Results + instant retry with full renderer reuse, persistence v2 live, staged
mobile startup, governor v2, hosted PWA path; W4-004 FTUE human gates WAITING_FOR_PHYSICAL_EVIDENCE).
**Wave 5 — Replayability: COMPLETE** (PBs/Daily/mastery/challenge codes; W5-004 mastery drills and
the challenge-code import UI shipped in the follow-up pass — six curated drills with persistent rep
counts behind MASTERY DRILLS on Mobile Home, and BEAT MY DRIVE code entry with honest decode errors
and bar-to-beat verdict on Drive Results; challenge retries replay the SAME seed).
**Wave 6 — Polish/release: PARTIAL** (see `reports/mobile/WAVE_5_6_RECEIPT.md`; device/human gates
WAITING_FOR_PHYSICAL_EVIDENCE; monetization disabled by absence). W6-001 formal single-priority
feedback arbiter shipped (`src/ui/feedback.ts`, 9 unit tests): one banner surface, priority
preemption, stale lower-priority feedback dropped, never queued. Accessibility: `npm run a11y`
automates the machine-checkable matrix slice — 11/11 (150% text, 130% controls, min opacity,
left/right mirror symmetry, fully muted + haptics-off playability); human/screen-reader/haptic
validation stays physical. Final battery ALL GREEN: 12/12 bundle · 18/18 classic · 20/20 lifecycle ·
32/32 touch · 7/7 driverush · 11/11 artifact · 11/11 a11y.
**Wave 3 — Core fun: COMPLETE** (see `reports/mobile/WAVE_3_RECEIPT.md` — Ruleset seam + Drive Rush,
RULES_VERSION 2 balance package: coverage-aware catches with flight scaling, pass breakups,
placement authority, screen diagnose window, wider block pickup. Fun gate: informed +92.6% EP/drive
over blind with fewer turnovers; the read now outscores the blind arm in the human probe too.
PlayGrade facts, three-card recommendations, flag-gated skill Overdrive. Open: third-down curve not
strictly monotone; QUICK human validation pending. Follow-up investigation at 4–5× sample
(`reports/mobile/receipts/thirddown_quick_investigation.md`): the 9–16 yd inversion is REAL — a
play-menu gap (no intermediate concept between ~6 yd tools and 16.8 yd DEEP), deferred to a
versioned AI/balance change; QUICK held at 42% completion over 80 games, flight-scaling fix stands).
W4-007 staged startup, W4-008 multi-axis governor, W4-009 persistence v2, W4-010 hosted PWA.

**Phone graphics pass (2026-08-03, post-publish):** first real-device feedback — "plays a little
rougher on the phone than expected, especially the graphics." Root cause: every phone starts on
LOW, whose `pixelRatio 1.0` drew an ~844×390 buffer stretched across a ~3×-density display, with
no MSAA and anisotropy 1, and the governor could only ever move quality DOWN. Fixes (presentation
layer only — no sim change, RULES_VERSION untouched): (1) pixel-ratio floor at near-native density
(≤1.75) on coarse-pointer displays — the adaptive governor's 0.6 floor lands back on the old fill
cost, so the worst case on a weak phone is the look every phone used to get; (2) MSAA on at LOW on
phones (per-tile resolve, near-free on mobile GPUs) plus anisotropy ≥4 and turf detail ≥0.5 floors
(`devicePreset` in `src/render/registry.ts`); (3) the governor ladder now runs UP as well: ~10 s of
sustained full-resolution headroom promotes the tier (applied between plays, never mid-play), the
result persists via the new `autoQuality` setting, one post-promotion demote burns the fuse for the
session, and touching GRAPHICS in Settings pins the tier and ends auto-management (`GRAPHICS · AUTO`
label). Verified: `npm run gfx` (new phone-context probe, 17/17 — floored buffer 1477px/844css,
MSAA+aniso floors, LOW→MEDIUM→HIGH synthetic ladder with persistence, fuse, pinning, desktop
untouched) plus the full regression battery re-run green.

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
