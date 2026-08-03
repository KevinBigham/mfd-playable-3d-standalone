# Third-down monotonicity + QUICK sample — higher-N investigation

**Question:** The Wave 3 receipt flagged two caveats: the third-down conversion curve was not
strictly monotone in distance (the 17–24 yd bucket converted at 31% in the 20-game census), and
QUICK's completion rate rested on a small sample. Are these sample noise or real?

**Method:** Re-run the standard censuses at 4–5× the receipt sample on the same build
(`1.0.0@8663b4a`, rules v2, chain 30 yd, PRO, fingerprints in the raw output):

- `driveprobe --games 80` (seeds 4400..4479) — 978 third downs
- `passprobe --games 40` (seeds 9100..9139) — 2,569 actual throws

## Finding 1 — the third-down inversion is REAL, not noise

| 3rd and… | conversions | rate |
|---|---|---|
| 1–8 yd | 19/92 | 21% |
| 9–16 yd | 30/217 | **14%** |
| 17–24 yd | 79/287 | **28%** |
| 25+ yd | 86/382 | 23% |

At 4× the sample the 9–16 bucket still converts *below* both longer buckets. With n=217 vs
n=287 this is far outside noise. The cause is visible in the play-type table, and it is a play
*menu* gap, not a catch-model defect: the CPU's tools average 4.8 yd (RUN), 5.9 yd (PASS),
2.9 yd (QUICK) — or 16.8 yd (DEEP). Needing 9–16 yards, every short tool falls short of the
sticks and DEEP overshoots into its 51%-completion risk profile; there is no intermediate
concept the caller reaches for. 17+ to go simply becomes a DEEP down, which converts at DEEP's
explosive rate (36% of its completions gain 20+).

**Disposition: DEFERRED, documented.** The fix is a versioned behavior change — either
intermediate route concepts in the CPU call policy or a balance pass on mid-depth passing —
and both alter match outcomes, so they belong to an intentional RULES/AI version bump with
fresh probes, not a quiet constant tweak. Nothing in the core-fun gate depends on this bucket:
informed play still beats blind play by +92.6% and placement still beats timing.

## Finding 2 — QUICK held up at 5× sample; the flight-scaling fix stands

The Wave 3 worry was QUICK completion collapsing under coverage pressure (27–31% before the
flight-time scaling fix). At 80 games QUICK completes **42%** (54/130) — stable versus the
20-game receipt, and consistent with its role (short, fast, low air-time = low coverage
pressure by design). Loss rate 23% and sack rate 16% reflect its behind-LOS risk, unchanged.
Overall pass census at 40 games reconciles exactly (2,569 = 1,162 + 278 + 525 + 397 + 207) and
every headline rate is within 2 points of the receipt run.

**Still open (honestly):** QUICK *human* validation — whether human-timed quick game feels
fair — is a human-participant measure and stays WAITING_FOR_PHYSICAL_EVIDENCE.

Raw outputs: `driveprobe80.txt` / `passprobe40.txt` were generated in the session scratchpad;
re-run with the commands above to reproduce (deterministic seeds, fingerprint printed).
