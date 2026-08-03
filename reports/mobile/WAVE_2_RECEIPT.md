# WAVE 2 RECEIPT — Control ergonomics

**Objective:** Make phone control physically reachable, configurable, and A/B-testable.
Tasks W2-001..W2-011.

## Files added

- `src/input/touch/touchProfile.ts` — versioned `TouchProfile` (v1): handedness, stick mode/scale,
  action scale, opacity, deadzone, turbo mode, gesture preset, target surface, fan spread,
  explicit-LOB opt-in. Persisted in the save file, sanitized on load.
- `src/input/touch/controlLayout.ts` — pure safe-area geometry: 44%/12%/44% thumb zones with
  handedness mirroring, full-ring stick clamping, fixed-stick anchor, fan-target arc, all
  computed against the safe rect. Zero DOM.
- `src/input/touch/gestureRecognizer.ts` — configurable tap/hold/swipe classification with
  direction confirmation windows, reversal-cancel, one-action-per-contact, urgent early-commit
  (legal tackle context only), commit-on-release for fast flicks. Three presets.
- `tests/controlLayout.test.ts` — 8 tests: geometry across 7 reference viewports × 3 safe-area
  simulations × 3 scales × both hands (full ring reachable, fan ≥48 px inside safe bounds,
  no zone overlap, mirroring), recognizer behavior matrix.
- `reports/mobile/device-runs/AB_PROTOCOL.md` — the physical A/B protocol and predeclared
  decision rule. **W2-011 status: WAITING_FOR_PHYSICAL_EVIDENCE.**

## Behavior changes

| Task | Before → after |
|---|---|
| W2-002 clamped stick | Origin was the raw touch point (ring could hang off-glass at edges) → origin clamps so the FULL ring + travel stay in the safe area; fixed-stick mode added |
| W2-003 turbo | Engaged only beyond 1.34× the visible ring, could flicker → HOLD_EDGE default: full speed AT the ring, turbo after ~300 ms at ≥88% deflection, releases below 70% (hysteresis), evaluated every poll so a still thumb still arms it; EDGE_BOOST kept as the advanced legacy mode |
| W2-004/5/6 target surfaces | One hard-coded badge path → `THUMB_FAN` (three stable arc targets, same jersey number and per-slot shape as the field badge, press connector line to the receiver) and `DIRECT_FIELD` (shipped badges, still default) behind one seam; browser-proven: fan slot N and badge slot N produce the identical semantic throw |
| W2-007 adaptive pass | Permanent LOB toggle → hidden by default (tap = competent contextual throw, drag = placement); `TOUCH · LOB BUTTON: ON (ADVANCED)` restores it; BULLET via turbo-hold unchanged |
| W2-008 gestures | Swipes fired at 26 px instantly → recognizer with confirmation window, reversal cancel, one action per contact; fast flicks commit on release; urgent tackle may commit early only in FREE mode |
| W2-009 compact HUD | Wide bottom turbo bars on phones → removed under `compactHudV2` (the stick ring already carries turbo state); pause ≥46 px pre-existing |
| W2-010 customization | Nothing → 9 settings rows (handedness incl. full mirroring of stick zone/SNAP/LOB, stick float/fixed, sizes, opacity, turbo mode, gesture preset, target surface, LOB) — all option rows, no precision dragging needed |

## Gates

| Gate | Result |
|---|---|
| Geometry matrix (7 viewports × insets × scales × hands) | PASS (unit tests, 126 combinations) |
| Unit tests | 246/246 |
| Scenarios / determinism / human | 25/25 · 12/12 · 19/19 (unchanged — no sim edits this wave) |
| Touch probe (now incl. fan parity, hold-at-edge turbo, flick commit) | 32/32 (`receipts/wave2-touchprobe.txt`) |
| Lifecycle probe | 20/20 |
| Classic touch-only completeness | 18/18 |
| Artifact | 11/11, one file |
| W2-011 physical A/B | **WAITING_FOR_PHYSICAL_EVIDENCE** — protocol + local telemetry shipped, both surfaces retained, DIRECT_FIELD remains default per handoff rule |

## Flag defaults after this wave

targetFan=off (candidate, selectable), directFieldTargets=on (default surface),
compactHudV2=**on**. All Wave 3+ flags off.

## Remaining risks

- Fan arc geometry is desk-derived; the physical A/B may move anchors/spread (all profile-driven,
  no code change needed for tuning).
- Turbo dwell (300 ms) and hysteresis band (88/70%) are hypotheses within the handoff's
  250–350 ms range; device testing may adjust.

## Next-wave eligibility

Automated ergonomics gates green; physical evidence correctly marked waiting with both candidates
preserved and reversible. Per the handoff's if-a-gate-needs-hardware rule, **Wave 3 unblocked**.
