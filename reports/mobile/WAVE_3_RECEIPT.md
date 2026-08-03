# WAVE 3 RECEIPT — Core fun

**Objective:** Make good football decisions beat spam; add a headless Drive Rush.
Tasks W3-001..W3-012. **This wave contains the intentional versioned balance change: RULES_VERSION 1 → 2.**

## Files added

- `src/rules/rulesets.ts` — versioned `Ruleset` seam; `CLASSIC` (unchanged flow) and `DRIVE_RUSH`
  (offense-only from the opponent 40, 30-yard chain intact, goal-to-go reset, no special teams,
  no quarters; ends on TD/turnover/downs/safety/clock). Zero device conditionals.
- `src/gameplay/playGrade.ts` — deterministic `PlayGradeFacts` (openness, leverage, timing vs the
  play's own clock, placement direction, pressure, result) with confidence levels and evidence
  strings; conservative `chipFor` refuses to assert on low confidence.
- `src/gameplay/playRecommendation.ts` — Safe/Balanced/Shot cards from observable context only
  (down, distance, field zone, clock, score, player's own recent calls); no RNG, no future
  knowledge; structural diversity + rotation pressure.
- `tests/driveRush.test.ts`, `tests/playGrade.test.ts`.

## The balance change (rules v2) — what and why

Root cause found: catch resolution was **openness-blind** — a defender who did not physically
reach the ball did not exist, so deep completions were an accuracy lottery uncorrelated with
coverage (deepprobe v1: completions and failures had the SAME separation at release).

| Change | Mechanism |
|---|---|
| Coverage pressures the catch continuously | nearest-defender distance ≤4 yd reduces catch chance up to 0.36, scaled by **flight time** (a rhythm throw beats tight coverage; a hanging deep ball is accountable) |
| Honest pass breakups | defender ≤2.3 yd gets a flight-scaled play on the ball → legible SWAT, not a coin-flip take-away |
| Placement authority | PLACE_PER_YARD 0.055→0.07, PLACE_MAX 3.2→4.2; deep scatter reduced (PASS_ERROR_PER_YARD 0.0275→0.024) — the read and the placement decide it, not the dice |
| Softer takeaway conversion | INT_BASE 0.30→0.22, SWAT_TIP_UP 0.22→0.15, offense tracks its own tips (+0.22 claim) |
| The screen exists | completions behind the LOS set a 0.55 s defensive diagnose window (rush/contain exempt — the honest counter); defenders' post-catch pursuit respects it |
| Blocking picks up rushers | engage radius 2.6→3.3 × BLOCK_RADIUS (unblocked-at-0.4 s: 3.67→3.10 of 7) |

## Measured before → after (same seeds, same probes)

| Measure | rules v1 | rules v2 |
|---|---:|---:|
| **Fun gate: READ_PLACEMENT vs blind spam EP/drive** | +40% (1.35 vs 0.97) | **+92.6% (1.56 vs 0.81), fewer TO drives (16.1% vs 20.3%)** |
| Placement vs pure timing | 1.35 < 1.74 (placement HURT) | **1.56 > 1.16 (placement pays)** |
| DEEP_SPAM vs best informed | 1.64 > 1.35 (spam won) | 1.51 < 1.56 (informed wins) |
| Human probe: reading vs blind pts/game | 18.3 vs 34.7 (blind won) | **16.3 vs 9.3 (the read wins)** |
| SCREEN yards/play | −0.73 (a trap) | **+13.1**, 17% explosive, countered by edge contain |
| Deep (18+ air) completion | 38% | 31%, explosive ceiling kept (36% of DEEP ≥20 yd) |
| Defender-possession per throw | 20.2% | 17.6% |
| Bobble → defense | 61.9% | **24–33%** |
| 3rd-and-1-8 / 3rd-and-25+ | 8% / 28% (inverted) | 19% / 23% (inversion broken) |
| RUN mean yards / unblocked | 3.72 / 3.67 | 5.91 / 3.10 |

## Gates

| Gate | Result |
|---|---|
| Informed ≥ +20% EP/drive, fewer turnovers, matched seeds | **PASS (+92.6%)** — `receipts/policyprobe.json` |
| No unconditional dominant concept | PASS at the policy level (DEEP_SPAM < READ_PLACEMENT); DEEP retains highest per-play EV in CPU census — watched |
| Drive Rush: 60 seeds, all invariants, all end kinds, deterministic | PASS (`tests/driveRush.test.ts`) |
| Classic parity | CPU games remain deterministic (12/12); 25/25 scenarios pass under v2 (one scenario's search window widened + its onside-skip bug fixed — assertions untouched) |
| Grade facts stable/explainable | PASS (deterministic across runs, evidence strings, no low-confidence assertions) |
| Recommendations trap-free/diverse | PASS (three bands, reasons attached, rotation pressure) |
| Overdrive skill charge | Implemented behind `overdriveSkillCharge` (default off): quality-weighted charge, repeated-receiver discount; classic path byte-identical (weight=1) |

## Honestly open (carried to Wave 4/6 watch list)

- Third-down curve is no longer inverted but not strictly monotone (17–24 yd bucket peaks at 31%,
  DEEP-driven). Needs another pass alongside human feel.
- QUICK's census sample is tiny (CPU rarely calls it); its rhythm role vs pressure now exists via
  flight scaling, sack burden down (24%→~18%) via blocking — human validation pending.
- CPU-vs-CPU completion rates dropped overall (CPU throws blind by construction and v2 punishes
  that); human/informed play is the design target and measurably wins.

## Next-wave eligibility

Fun gate green with margin; Drive Rush proven headless; Classic deterministic. **Wave 4 unblocked.**
