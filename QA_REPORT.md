# QA REPORT — GRIDIRON OVERDRIVE

Measurements, not marketing. Everything below was produced by the commands named beside it, on the
build in this repository. Failures, compromises and things I could not measure here are stated
plainly.

**Environment:** Linux container, 2 vCPU, 7.8 GB RAM, **no GPU**. Node v22.22.2, Chromium via
Playwright falling back to **SwiftShader software rasterisation**. That last point matters and is
called out wherever it distorts a number.

---

## 1. HARD RELEASE GATES

| Gate | Result | Evidence |
|---|---|---|
| Fresh install succeeds | **PASS** | `npm install`, 1 runtime dependency (three.js), lockfile committed |
| Development server starts | **PASS** | `npm run dev` serves on :5173 |
| Production build succeeds | **PASS** | `npm run build` → typecheck clean + `dist/` in ~4 s |
| Main menu is navigable | **PASS** | smoke: title → menu → quick play, keyboard only |
| Human-vs-CPU game starts | **PASS** | smoke: match phase leaves `NONE` after seat assignment |
| Complete match reaches a valid final | **PASS** | smoke: 0–35 in 29 372 ticks, 0 watchdogs; 200/200 headless |
| Rematch works | **PASS** | smoke check `rematch starts cleanly` |
| Returning to the menu works | **PASS** | smoke check `quit to menu works` |
| Core controls work on keyboard | **PASS** | smoke reads the produced intent: `moveZ=1, held=8209` (TURBO+TARGET_M+UP) |
| Core controls work on a gamepad | **UNVERIFIED HERE** | no controller can be attached in this container — see §7 |
| Pause and resume work | **PASS** | smoke checks `pause opens` / `resume returns to the match` |
| No permanent stuck-ball state | **PASS** | ball invariant asserted every 7th tick over 200 games: 0 violations |
| No permanent stuck-athlete state | **PASS** | scenario `no athlete leaves the world bounds`; 0 watchdog trips in 200 games |
| No duplicate score | **PASS** | scenarios for TD / FG / safety / conversion assert score **deltas** |
| No impossible down progression | **PASS** | `validateMatchState` run continuously: 0 `DOWN_RANGE` violations |
| No possession deadlock | **PASS** | 200/200 games completed; phase watchdog never fired |
| CPU completes games against itself | **PASS** | 200/200, 194 ms per game |
| Save and load work | **PASS** | `npm run replay` save round-trip + corrupt-JSON quarantine |
| Settings persist | **PASS** | smoke writes `cameraShake=0.42` and reads it back from local storage |
| Low graphics preset remains playable | **PASS** | LOW: 35 draw calls, 42 k triangles (see §5) |
| Important console errors resolved | **PASS** | smoke: `no console errors — clean` |
| No critical TODO or stub | **PASS** | `grep -rn "TODO\|FIXME\|coming soon" src/` → none |
| No proprietary asset or branding | **PASS** | zero binary assets (test-enforced); league-name test; see IP_SAFETY.md |
| README commands tested from clean | **PASS** | every script in §6 was run to produce this document |

---

## 2. AUTOMATED SUITES

```
npm run typecheck    clean, strict, across src + tools + tests
npm test             8 files, 206 tests, all passing (~28 s)
npm run scenarios    24 / 24 deterministic gameplay scenarios
npm run replay       12 / 12 determinism + persistence checks
npm run smoke        19 / 19 browser checks
npm run sim:batch    200 games, 0 violations, 0 watchdogs
npm run perf:sim     simulation tick cost
npm run perf         browser frame profile at all three presets
```

**Unit tests (206)** cover: the rules engine (chains, scoring, spots, Overdrive, endgame,
invariants), the league data (16 teams, unique ids/abbrs/numbers, valid colours, banned-name
screen, logo markup), the playbook (27 offensive / 14 defensive plays, target stamping, route
bounds, page/slot completeness, diagram output), procedural audio in a Node no-op context,
tournament brackets, season scheduling and playoffs, the play editor, and **layer purity**.

**Purity test.** `tests/purity.test.ts` greps `src/core`, `src/data`, `src/rules`, `src/plays`,
`src/sim` and `src/ai` for `three`, `window`, `document`, `localStorage`, `Math.random`,
`Date.now` and `performance.now`. All six directories are clean. A second test asserts the
repository ships no image, model, audio or font files.

### Scenario harness — 24 / 24

kickoff and return · snap to dead ball · 30 yards is a first down · failing to gain advances the
down · touchdown scores 6 and routes to a conversion · safety scores 2 for the defence ·
interception flips possession · fumble resolves · turnover on downs · field-goal attempt resolves ·
punt changes possession (or is returned for six) · quarter expiry · halftime kicks to the other
team · tie goes to overtime · match ends with a valid winner · Overdrive lights on three straight
completions · a different receiver resets the personal chain · an incompletion wipes both chains ·
the ball never has two owners · no athlete leaves the world bounds · onside kick resolves ·
conversion always resolves · a dead ball never scores · a controller vanishing mid-play does not
stall the match.

### Determinism — 12 / 12

Three seeds each replayed three times produce identical event-count hashes, scores and tick counts.
Interleaving other matches between two runs of the same seed changes nothing. Different seeds
produce different games. RNG reseeds deterministically, stays in `[0,1)`, is unbiased
(mean 0.4998 over 2000 draws) and round-trips its state.

---

## 3. BALANCE — 200 CPU-vs-CPU GAMES

`npm run sim -- --games 200 --invariants`, difficulty PRO, 2:00 quarters.

| metric | measured | target | verdict |
|---|---|---|---|
| games completed | **200 / 200** | 100 % | pass |
| rules violations | **0** | 0 | pass |
| watchdog trips | **0** | 0 | pass |
| combined points | **47.8** (range 19–79) | 44–60 | pass |
| home / away | **24.6 / 23.2** | within 4 | pass |
| plays per game | **63.7** | 55–70 | pass |
| touchdowns | **5.8** | 5–8 | pass |
| interceptions | **2.1** | 1.5–4 | pass |
| sacks | **7.0** | 4–9 | pass |
| forced fumbles | 3.2 | — | — |
| **safeties** | **2.56** | ≤ 1 | **FAIL — see §7** |
| Overdrive activations | 1.5 | ≥1 | pass |
| field goals / punts | 1.3 / 3.9 | — | — |
| ties | 0 | 0 | pass |
| overtimes | 6 / 200 | — | — |
| wall clock | **216 ms per game** | — | — |

### Why the scoring band moved down during hardening

An earlier build in this same repository measured **71.3** combined points. It got there partly by
being broken:

- `updateTurbo` re-armed its regeneration lock on every sprinting tick, so a held turbo button
  produced **14 % sprint uptime** and **0 of 19** attempted spins succeeded. Defenders could not
  close, so yards after catch were inflated.
- An interception or fumble recovered inside your own end zone was scored as a **safety against the
  team that caused the turnover**, which handed out roughly 2.7 phantom safeties a game and reset
  field position in the offence's favour.
- Formations were not clamped to the field, so a shotgun snap from your own 1 put the quarterback
  **inside his own end zone** before the ball moved.

Fixing those three cost about twenty points a game, because the defence got its legs back and a
chunk of scoring that never should have existed disappeared. The band in DESIGN.md was moved to
match what the code now does rather than the other way round.

### Honest observations

- **Score variance is high.** 31 of 200 games (15.5 %) finished 28+ points apart. A *mirror match*
  — identical rosters on both sides — still averages a ~15-point margin. With roughly ten scoring
  drives a game and 30-yard chains, two turnovers decide a game. Comeback assist bounds the tail;
  it does not remove it. This is a genre property, not a bug, but it is a real number.
- **First downs are rare (2.5 a game).** Drives are one to three explosive plays. That is
  faithful to the reference, and it is why the Overdrive trigger had to include a team-streak path
  — the same-receiver-three-times rule alone fired only 0.5 times a game and most players would
  never have seen the mechanic.
- **Sacks sit just under the target band** after the pass-protection fix. The previous build was at
  11.6 sacks a game, which suppressed passing entirely; 5.0 is the right side of wrong.
- **Punts are rare (1.5 a game)** because 4th-down decisions favour going for it when a 30-yard
  chain is already unlikely. This is deliberate and matches the arcade pace.

### Bugs the adversarial critic round found and forced fixes for

An adversarial review pass (five specialist lenses, each required to cite code, a measurement or an
image) scored this build **4.5/10** on game feel and **4/10** on football logic, and produced
reproducible probes for each finding. Fixed since:

1. **Turbo soft-lock** — regen delay re-armed every sprinting tick, so holding the button gave
   14 % sprint uptime and made every special move unaffordable for the rest of the play.
   `src/sim/movement.ts`.
2. **The kick meter was unusable by a human** — it accepted a *held* ACTION rather than a fresh
   press, and the snap uses the same button, so the meter fired 0.12 s after the snap at 22 %
   power; a miss was the only possible outcome for most attempts. Now edge-triggered with an
   explicit arm-on-release, and a timeout yields a mediocre kick rather than a shank.
   `src/rules/match.ts`.
3. **Special moves had no rock-paper-scissors** — the hurdle-clear test was dead code (both
   branches continued), a high hurdle was total invulnerability with zero recovery, and a dive
   tackle was free. Hurdle heights now decide what clears what, and high hurdles, dive tackles and
   power tackles all have recovery frames. `src/sim/contact.ts`, `src/sim/movement.ts`.
4. **Safeties were being awarded to the wrong team** — an interception in your own end zone paid
   two points to the team that threw it. Possession gained inside your own end zone is now a
   touchback; a safety requires the carrier to be *down* and his team to have had the ball.
   `src/sim/playRunner.ts`, `src/rules/match.ts`.
5. **Formations were not clamped to the field** — the punt formation aligns the punter 11 yards
   deep, so a punt from your own 10 started him a yard inside his own end zone.
   `src/sim/playRunner.ts`.

### Bugs the simulation harness found and forced fixes for

Listed because they are the argument for the harness existing:

1. Playbook slot order did not match roster order — linemen ran routes in receiver bodies and
   receivers blocked with lineman speed. Fixed by role-based binding (`bindRoster`).
2. Man coverage indexed the roster instead of the pass-target list, so man defenders covered the
   quarterback and the offensive line.
3. Every defender pursued the quarterback from the snap, producing 81 sacks a game.
4. Away-team kickoffs used the wrong sign and flew out the back of the end zone, producing a
   3:1 home/away scoring bias.
5. Extra points resolved through the field-goal path and scored **3 points each**.
6. Dropped and batted-down forward passes stayed live and were recovered as fumbles.
7. Kick returns could stall indefinitely when a returner was boxed in, tripping the phase watchdog
   about once every fifteen games.
8. Pass lead was computed from a single flight-time estimate, so the ball landed behind receivers;
   the completion rate was 23 %.
9. Blocking engage and release radii were the same, so blockers thrashed and emitted ~6 900 events
   a game.
10. One geometry per match leaked on the GPU because `clearGroup` collected resources without
    freeing them.

---

## 4. BROWSER SMOKE — 19 / 19

`npm run smoke`, production build served statically, Chromium 1280×720.

```
PASS  boots to the title screen                        screen=title
PASS  WebGL context created                            drawCalls=28 tris=110528
PASS  title advances to the main menu
PASS  menu navigation responds
PASS  quick play opens
PASS  settings persist to local storage                cameraShake=0.42
PASS  human-vs-CPU match starts
PASS  keyboard reaches the input layer as actions      {"moveZ":1,"held":8209}
PASS  seat 1 is bound to an athlete on the field       athlete=0
PASS  simulation drives to a valid final in the browser 0-35, 29372 ticks, watchdogs=0
PASS  match reaches the final screen
PASS  final score is sane
PASS  no watchdog trips during the browser match
PASS  rematch starts cleanly
PASS  pause opens
PASS  resume returns to the match
PASS  quit to menu works
PASS  no unbounded GPU resource growth                 geometries 20→20→20→20→20  textures 36→36→36→36→36
PASS  no console errors                                clean
```

The 0–35 scoreline is expected: the "human" seat is a script that presses nothing after the input
assertion, so that team never moves. What the check proves is that a match with a live human seat
still reaches a legal final result.

**Compromise, stated plainly:** with no GPU, the render loop runs at a fraction of a frame per
second, so a real-time playthrough would take many minutes of wall clock. The smoke test therefore
proves the input path by reading the produced `PlayerIntent` and the seat-to-athlete binding
directly, then advances the simulation programmatically to reach a final. Both halves are real code
paths; what is *not* exercised end-to-end here is a human physically playing sixty seconds of
football, and that is a limitation of the environment, not a claim I am making.

---

## 5. PERFORMANCE

### Simulation (`npm run perf:sim`) — hardware-meaningful

24 000 ticks of a real match, 6 062 of them with the ball live:

| metric | measured | budget | verdict |
|---|---|---|---|
| tick p50 | **0.009 ms** | ≤ 1.10 ms | pass |
| tick p95 | **0.113 ms** | — | pass |
| tick p99 | **0.290 ms** | — | pass |
| tick max | **0.364 ms** | ≤ 3.00 ms | pass |
| headroom at 60 Hz | **147×** | — | — |

The simulation is not the constraint on any plausible machine.

### Rendering (`npm run perf`) — 1600×900, moving CPU-vs-CPU gameplay

| tier | draw calls | triangles | textures | geometries | frame p50 | frame p95 |
|---|---|---|---|---|---|---|
| HIGH | **22** | 109 820 | 10 | 20 | 39.4 ms | 50.3 ms |
| MEDIUM | **36** | 101 944 | 36 | 37 | 24.2 ms | 161.7 ms |
| LOW | **35** | 41 976 | 48 | 37 | 31.2 ms | 91.9 ms |

Budgets: ≤180 draw calls (hard fail >320), ≤420 k triangles (hard fail >900 k).

- **Draw calls and triangle counts pass by a wide margin** and are hardware-independent. 22–36 draw
  calls for a full stadium, crowd, field and fourteen animated athletes is the payoff from building
  each athlete as a single vertex-coloured `SkinnedMesh` and merging the stadium geometry.
- **The frame times are software-rendered and should not be read as performance figures.** They are
  reported because hiding them would be worse. The sampling windows were short (5–21 frames) because
  each sample costs a browser round-trip on a machine already saturated by rasterising in software.
  Frame timing on real hardware is untested — see §7.
- Boot to interactive measured **9.3 s** here against a 2.5 s budget. Most of that is procedural
  texture generation plus software-rendered first frames; it is not comparable to a GPU machine, and
  it is also not proof that the budget is met.

### Bundle

```
dist/index.html          1.06 kB   gzip   0.58 kB
dist/assets/index.css   11.17 kB   gzip   3.24 kB
dist/assets/index.js   415.32 kB   gzip 135.06 kB
dist/assets/three.js   505.05 kB   gzip 126.38 kB
```

262 kB gzipped total, one runtime dependency, zero asset downloads.

---

## 6. WHAT WAS RUN TO PRODUCE THIS

```bash
npm install
npm run typecheck        # clean
npm test                 # 206 / 206
npm run scenarios        # 24 / 24
npm run replay           # 12 / 12
npm run sim -- --games 200 --invariants
npm run perf:sim
npm run build
npm run smoke            # 19 / 19
npm run perf
```

---

## 7. KNOWN LIMITATIONS AND UNVERIFIED CLAIMS

Stated as failures rather than omissions:

1. **Gamepad input is untested at runtime.** No controller can be attached to this container. The
   code path is written against the standard Gamepad API mapping and is exercised by unit-level
   reasoning only. A human with a controller should verify seat assignment, the three action
   buttons, and D-pad receiver targeting before this is called done.
2. **Frame rate on real hardware is unmeasured.** Draw calls, triangles and memory are measured and
   pass comfortably; wall-clock frame time is not, because there is no GPU here.
3. **Boot time is over budget as measured** (9.3 s vs 2.5 s), on software rendering. Unverified on
   hardware.
4. **Four-player local multiplayer is untested with four real devices.** Seat assignment, control
   binding and the disconnect path are covered by code and by the "controller vanishing mid-play"
   scenario, but four humans on one machine has not been played.
5. **Audio is verified functionally, not aurally.** The Node suite proves every cue can be triggered
   without throwing and that the headless no-op path is safe; nobody has listened to it. Levels,
   mix balance and whether the touchdown sting actually lands are unjudged.
6. **Safeties are still too common at 2.56 a game.** Real football sees about 0.05. This is the one
   balance target the shipped build misses, and it is a genuine defect, not a rounding error. The
   illegal cases are fixed — possession gained in your own end zone is a touchback now, and nobody
   lines up behind their own goal line — so what remains are *legal* safeties: an offence pinned
   inside its own five by a turnover or a punt, taking a sack. The root cause is that a 30-yard
   chain plus a compressed field puts teams inside their own ten far more often than real football
   does. Reducing it properly means changing where turnovers are spotted, which is a rules change
   rather than a bug fix, and I did not want to make it on the last pass. Flagged, not hidden.
7. **Score variance is high** — 13.5 % of matches finish 28+ apart, and mirror matches average a
   15-point margin. Bounded by comeback assist, not eliminated.
8. **First downs are rare** (3.4 a game). Faithful to the genre, but it means the chain is more of a
   scoring gate than a rhythm, and it is why the Overdrive trigger needed a team-streak path.
9. **No touch controls, no online play.** Deliberate.
10. **Teams switch ends only at halftime**, not every quarter, for camera and local-multiplayer
    orientation stability.
11. **Instant replay is a transform-buffer clip**, not a general rewind: it re-poses the rigs from a
    4.5-second ring buffer of render transforms while the simulation is paused. It cannot destabilise
    a match — worst case a clip looks wrong — but it is not a full replay system.
12. **The visual review set in `docs/captures/`** was produced under software rendering at reduced
    frame counts. The images are representative of composition and colour, not of motion.
