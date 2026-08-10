# PLAY THE BALL — pre-change baseline

Captured before gameplay edits on 2026-08-09 from commit `e3a82dc` on
`agent/pascal-stadium-visual-studio`.

## Core gates

- `npm run typecheck` — PASS.
- `npm run test` — PASS, 32 files and 339 tests.
- `npm run replay` — PASS, all three fixed seeds repeat identically three times.

The first sandboxed test attempt was invalid because `tsx` could not create its local IPC socket.
The same untouched suite passed outside that restriction; no source files changed between runs.

## Development census — seeds 9100..9199

- Passes: 6,477 actual throws; 49.0% caught, 11.9% dropped, 19.6% swatted,
  13.4% defender-possession events, 8.4% credited interceptions, 6.1% fell incomplete.
- Deep: 2,145 throws of 18+ air yards; 34% complete and 323 intercepted.
- Screen: 49 selected plays, 6.4082 yd/play, 42.86% conversion, 12.24% negative.
- Red zone: 86 selected plays, 2.6163 yd/play, 27.91% conversion, 34.88% negative,
  27.91% sack rate.
- Pursuit: 2,011 selected plays, 4.7021 yd/play, 40.33% conversion, 20.74% negative.

## Untouched holdout census — seeds 19100..19199

- Screen: 50 selected plays, 1.2000 yd/play, 26.00% conversion, 10.00% negative.
- Red zone: 97 selected plays, 1.5155 yd/play, 16.49% conversion, 40.21% negative,
  34.02% sack rate.
- `passprobe` and `deepprobe` accepted but ignored `--seed-start`, reproducing the development
  census. PLAY THE BALL must add real seed-start support before the post-change holdout is run.

## Performance and artifact

- Simulation: p50 0.006 ms, p95 0.022 ms, p99 0.045 ms over 24,000 ticks.
- SwiftShader HIGH: p50 13.20 ms, p95 19.00 ms, 35 calls, 182,984 triangles.
- SwiftShader MEDIUM: p50 16.50 ms, p95 24.30 ms, 35 calls, 107,168 triangles.
- SwiftShader LOW: p50 12.70 ms, p95 21.80 ms, 39 calls, 49,994 triangles.
- Offline artifact: 1,132 kB total (1,109 kB JavaScript + 17 kB CSS), self-contained.
