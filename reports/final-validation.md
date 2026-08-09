# Final senior validation

STATUS: YELLOW

The football, replay, photo-mode, lifecycle, browser, offline, and artifact implementations are
real runtime paths and their automated gates pass. The remaining release concern is visual:
hard-cut planted-foot slip still has a high tail despite the bounded render-only anchor. This is
not represented as GREEN.

## Senior repairs

- Activated screen-carrier convoy steering on the real completed-pass state and added stable
  blocker-to-defender reservation.
- Scoped designed-run commitment to authored handoffs, short-yardage bias to actual 0.5–3 yard
  situations, and red-zone compression to actual goal-to-go state.
- Made pursuit angle error deterministic without consuming simulation RNG each tick.
- Restored `footslip` as the renderer-level gate; retained `footslip:geometry` only as matrix
  sanity evidence and made the browser run fixed-tick repeatable.
- Corrected replay event priority/recovery routing, three-shot sequencing, semantic targets, exact
  photo-camera restore, stadium proxy population/disposal, and touch isolation.
- Strengthened acceptance so failures return nonzero; corrected its movement precondition.
- Repaired performance/GFX/Classic harness timing without removing assertions.

## Football measurements

See `reports/football-intelligence-measurements.md`. These are post-change censuses, not historical
A/B proof. Screen: 2.4500 yd/play on seeds 9100..9199 and 4.0588 on 19100..19199. Short-yardage:
2.8000 / 1.0000. Goal-to-go quick: 2.3611 / 1.5000. Holdout data was not used for tuning.

A subsequent receiver-radius pass widened only the intended receiver's normal-pass envelope from
1.782 to 2.025 yards at a 50 hands rating; defender reach is unchanged. The fixed pass census moved
from 43.7% to 49.5% completions and from 16.0% to 12.4% defender-possession events. Deep completion
moved from 31% to 36%; every throw outcome still reconciles.

## Foot-slip

Two consecutive renderer runs produced byte-equivalent reported categories and counts:

| Motion | Samples | Mean | p95 | Max |
|---|---:|---:|---:|---:|
| Straight | 2,178 | 0.681 yd/s | 1.374 yd/s | 11.681 yd/s |
| Moderate turn | 892 | 0.964 yd/s | 5.222 yd/s | 17.635 yd/s |
| Hard cut | 1,212 | 3.892 yd/s | 13.626 yd/s | 18.662 yd/s |

Overall: 5,546 eligible tick-pairs, 1.602 yd/s mean, 9.098 p95, 18.66 worst. Anchored hard-cut
samples average 1.706 yd/s, so the correction is active and useful; the unanchored/release tail
remains the reason for YELLOW.

## Replay and photo mode

Replay stores 195 frames at 30 Hz (6.5 seconds). Numeric payload is 76,050 bytes; animation-state
references keep the bounded capture near 0.1 MiB. Playback reads transforms only, never ticks the
match, consumes no simulation RNG, and cannot write score/clock/possession.

| Event | Package |
|---|---|
| touchdown | YES |
| interception | YES |
| fumble recovery | YES |
| sack | YES |
| explosive run | YES |
| explosive pass | YES |
| tackle for loss | YES |
| fourth-down stop | YES |
| field goal | YES |
| game-winning score/stop | YES |

The director traverses wide, field-level slow-motion, and end-zone shots deterministically. Photo
mode saves/restores position, quaternion, up, and FOV; pauses on the current replay frame; sources
collision from segmented bowl-perimeter and compact visible-mesh AABBs; rejects giant merged venue
boxes; and clears proxies on unload. Touch/photo gestures cannot produce football input.

## Authoritative commands

| Command | Result |
|---|---|
| `npm run typecheck` | PASS |
| `npm test` | PASS — 29 files, 324 tests |
| `npm run scenarios` | PASS — 25/25 |
| `npm run replay` | PASS — three seeds identical x3; persistence checks pass |
| `npm run human` | PASS — 19/19 |
| `npm run touch` | PASS — 32/32, clean console |
| `npm run sim:batch` | PASS — 200/200, 0 watchdogs, 0 violations |
| `npm run invariants` | PASS — 50/50, 0 watchdogs, 0 violations |
| `npm run driveprobe` | PASS — throw ledger reconciled |
| `npm run runprobe` | PASS — 62 runs, 5.66 yd mean |
| `npm run passprobe` | PASS — 501/501 throws reconciled |
| `npm run deepprobe` | PASS — 190 deep throws sampled |
| dedicated football probes | PASS — both 100-game seed ranges recorded |
| `npm run pursuitprobe -- --games 100 --seed-start 9100` | PASS — 1,991 plays |
| `npm run footslip` | PASS — 5,546 eligible samples; limitation above |
| `npm run footslip -- --browser` | PASS — identical category distribution/counts |
| `npm run footslip:geometry` | PASS — sanity only: 0 / 1.2 / null |
| `npm run fieldpos` | PASS — 60 games |
| `npm run smoothness` | PASS |
| `npm run pacing` | PASS |
| `npm run perf:sim` | PASS — p50 0.009 ms, p95 0.021 ms |
| `npm run perf` | PASS — HIGH p50 13.20 ms, p95 23.70 ms under SwiftShader |
| `npm run gfx` | PASS — 17/17 |
| `npm run lifecycle` | PASS — 20/20 |
| `npm run acceptance` | PASS — 42 applicable, 0 failed, 19 N/A |
| `npm run mobile:baseline` | PASS — all receipt stages green |
| `npm run a11y` | PASS — 11/11 |
| `npm run classic` | PASS — 18/18 |
| `npm run driverush` | PASS — 7/7 |
| stadium validate / roundtrip / budget | PASS — 1/1, 19/19, all tiers reported |
| `npm run build` | PASS — 110 modules |
| `npm run capture` | PASS — 30 captures, zero console errors |
| `npm run artifact` | PASS — 1,125 kB self-contained HTML |
| `npm run artifact:check` | PASS — 11/11, full match, zero network, clean console |

Artifact size is about 10 kB (+0.9%) above the earlier 1,115 kB receipt.

## Upstream decisions

Yuka, Theatre.js, camera-controls, and three-mesh-bvh are rejected for this landing because the
native bounded implementations satisfy the measured need. img2threejs remains deferred because
asset generation does not address a release deficiency. See `docs/THIRD_PARTY_RESEARCH.md`.

## Remaining limitation

Automated evidence is green, but hard-cut foot-slip p95 is still visually risky. The branch is
ready for a focused commit; unconditional merge/release should follow a visual acceptance decision
or a deeper hard-cut stance/pose correction.
