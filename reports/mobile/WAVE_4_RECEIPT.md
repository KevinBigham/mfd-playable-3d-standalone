# WAVE 4 RECEIPT — Mobile product, reliability, performance

**Objective:** Turn the corrected game into a native-feeling mobile product.

## Delivered

| Task | Delivery |
|---|---|
| W4-001 Mobile Home | `mobileHome` screen: dominant PLAY DRIVE / RESUME, Classic + More + gear secondary; phones route here from the title (`mobileHomeV2` on) |
| W4-002 Orientation | Global `"orientation":"landscape"` removed from the manifest — menus rotate freely; live play still guides landscape via the existing rotate gate at gameplay entry only |
| W4-003 Play cards | Three context-ranked cards (Safe/Balanced/Shot, diagram + reason) front the phone play call via `recommendCards`; MORE opens the full book; desktop grid untouched (`mobilePlayCardsV2` on) |
| W4-005 Drive Results | `driveResults` screen: outcome, points/yards, ONE cause line from the last high-confidence grade fact, ONE MORE DRIVE active immediately; Drive Rush endings route here with a `PlayGradeTracker` attached |
| W4-006 Renderer reuse | `loadMatch` keyed by matchup/venue/weather/quality — same key resets dynamic state and reuses environment/PMREM/rigs/ball/markers/effects; `endMatch` defers teardown so an instant retry cancels it (first menu frame pays it) |
| W4-007 Staged startup | Phones skip the attract-stadium build entirely (the measured ~1–12 s shader block); first real match compiles once behind an intentional tap |
| W4-008 Governor v2 | When resolution hits its 0.6 floor and frames stay late, one quality tier drops (shedding shadow/post/crowd cost) with long hysteresis and no mid-match oscillation; player's saved setting untouched (`performanceGovernorV2` on) |
| W4-009 Persistence v2 | `persistenceV2.ts`: IndexedDB revisions (keep 5) with FNV-1a checksums, schema/build/rules stamps, last-known-good fallback on corrupt newest, localStorage emergency copy, transparent v1 migration; boot restore + write-through live (`persistenceV2` on) |
| W4-010 Hosted PWA | `public/sw.js` (cache-first shell / network-first assets) registered only on http(s) non-artifact builds; standalone artifact keeps zero SW assumptions — 11/11 artifact checks |

## W4-004 First ten minutes — status

Structure shipped: one tap from title to PLAY DRIVE, per-mode coach lines teach each verb set at
the moment it becomes true, guided-failure feedback via grade chips, results card with retry.
The FTUE *gates* (first snap ≤15 s p90, ≥90% first-drive completion, ≥80% failure explanation,
≥65% second drive) are human-participant measurements: **WAITING_FOR_PHYSICAL_EVIDENCE** — no
scripted tutorial was faked in their place.

## Gates

| Gate | Result |
|---|---|
| Phone loop end-to-end by touch | 7/7 `npm run driverush` (home → cards → snap → results → instant retry) |
| Prior correctness/ergonomics probes | 18/18 classic · 32/32 touch · 20/20 lifecycle |
| Unit + deterministic suites | 255 tests · 25/25 scenarios · 12/12 determinism |
| Artifact remains one file | 11/11 |
| Same-match retry latency / 50-restart memory plateau | Reuse path proven functionally; timing/memory numbers need physical devices — WAITING_FOR_PHYSICAL_EVIDENCE |
| Frame-pacing device targets (60/30) | WAITING_FOR_PHYSICAL_EVIDENCE (Chromium/swiftshader cannot stand in) |

## Known caveats

- Renderer reuse keys on weather kind, not the full per-seed conditions roll — a retry can reuse
  a visually near-identical venue whose wind/intensity differs slightly; simulation always uses
  its own fresh conditions.
- Governor tier-drops are session-only and downward-only by design; recovery is a new match.

## Next-wave eligibility

Product loop, persistence, and reuse gates green in emulation; device-only gates correctly
marked waiting. **Wave 5 unblocked.**
