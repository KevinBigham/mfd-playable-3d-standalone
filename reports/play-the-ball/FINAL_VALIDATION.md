# PLAY THE BALL — final validation

STATUS: YELLOW

Runtime ball skills, controls, presentation and replay integration are implemented and deterministic.
The release is not GREEN because physically valid defender-possession events remain below the
declared 9–15% balance envelope. The holdout was not used as a tuning target. It was run after
constants froze, then rerun once only because the senior audit found and repaired an out-of-bounds
tipped-ball terminal-state bug; no constants changed between those holdout runs.

## Football receipts

| Metric | Development 9100–9199 | Holdout 19100–19199 | Result |
|---|---:|---:|---|
| Completion | 51.8% (3331/6430) | 50.7% (3283/6480) | PASS, 47–53% |
| Drops | 13.5% | 14.4% | PASS, 7–15% |
| Physical swat events | 14.4% | 14.3% | PASS, 14–28% |
| Defender possession | 0.8% | 0.9% | **FAIL**, target 9–15% |
| Deep completion | 35% (728/2101) | 38% (797/2119) | PASS, 30–42% |
| Screen yd/play | 6.5172 (29 plays) | 4.0926 (54 plays) | PASS, no >10% baseline regression |
| Goal-to-go quick yd/play | 2.3881 (67 plays) | 3.6032 (63 plays) | PASS, no >10% baseline regression |
| Pursuit yd/play | 4.4734 (1768 plays) | 4.2185 (1776 plays) | PASS |

The development completion delta from the 49.0% pre-change baseline is +2.8 percentage points.
The old 13.4% defender-possession figure came from magnetic eligibility and is not preserved by
granting unreachable defenders the ball.

## Presentation evidence

- Catch Lab: every chest/high/low/behind/in-stride/sideline drill improves hand error by at least
  63.7%; deterministic at 30, 60 and 120 Hz.
- Ball Lab: all 15 receiver/defender drills repeat event and presentation hashes at all three rates;
  defender swat/interception mean hand error is at most 0.148 yd.
- Foot-slip release scenarios: straight n=175 mean 0.943/p95 1.195; moderate n=177 mean
  0.443/p95 0.862/max 11.449; hard cut n=166 mean 0.827/p95 5.296/max 11.510; root error zero.
- The broad live foot-slip census still reports hard-cut p95 14.042 yd/s; this is a remaining
  presentation tail, not hidden by the release-scenario result.
- `docs/captures/ball-lab.png`, `catch-lab.png`, and `24-clear-live-swat.png` were visually
  inspected. The authoritative ball does not follow failed hands.

## Regression gates

- `npm run typecheck` — PASS.
- `npm test` — PASS, 35 files / 366 tests.
- `npm run replay` — PASS, 12/12.
- `npm run scenarios` — PASS, 25/25.
- `npm run human` — PASS, 19/19.
- `npm run touch` — PASS, 36/36 including RECEIVE gestures.
- `npm run sim:batch` — PASS, 200/200, zero watchdogs/violations.
- `npm run invariants` — PASS, zero violations.
- `npm run perf:sim` — PASS, p50 0.005 ms / p95 0.012 ms.
- `npm run perf` — PASS on the strengthened 60-frame live sample: HIGH p50 12.20 ms / p95
  19.80 ms, 189,194 triangles. The previous baseline HIGH p95 was 19.00 ms (+4.2%).
- `npm run lifecycle` — PASS, 20/20.
- `npm run acceptance` — PASS after replacing stale catch N/A claims with runtime checks.
- `npm run capture` — PASS, 31 captures, zero console errors.
- `npm run build` — PASS.
- `npm run artifact && npm run artifact:check` — PASS, 1,144 kB (+1.1% from 1,132 kB),
  11/11 checks, zero network requests and zero console errors.

## Calibration and architecture

The gitignored nflverse cache contains 2022–2025 regular-season PBP inputs. The committed aggregate
report covers 76,664 classified pass attempts and records source URLs, SHA-256 checksums, filters
and sample counts. Builds, tests and the game perform no calibration network requests.

`catching.ts` remains the sole outcome owner; `ball.ts` owns ball-state/attempt-mask mutation;
`PlayerIntent`, fixed-step simulation, replay frames/hashes and the procedural athlete rig remain
in place. The replay cue sidecar is bounded to 32 cues inside the existing 6.5-second window.
