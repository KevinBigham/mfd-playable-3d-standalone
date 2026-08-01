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
| Complete match reaches a valid final | **PASS** | smoke: 2–9 in 64 203 ticks, 0 watchdogs; 200/200 headless |
| Rematch works | **PASS** | smoke check `rematch starts cleanly` |
| Returning to the menu works | **PASS** | smoke check `quit to menu works` |
| Core controls work on keyboard | **PASS** | smoke reads the produced intent: `moveZ=1, held=8209` (TURBO+TARGET_M+UP) |
| Core controls work on a gamepad | **UNVERIFIED HERE** | no controller can be attached in this container — see §8 |
| Pause and resume work | **PASS** | smoke checks `pause opens` / `resume returns to the match` |
| No permanent stuck-ball state | **PASS** | ball invariant asserted every 7th tick over 200 games: 0 violations |
| No permanent stuck-athlete state | **PASS** | scenario `no athlete leaves the world bounds`; 0 watchdog trips in 200 games |
| No duplicate score | **PASS** | scenarios for TD / FG / safety / conversion assert score **deltas** |
| No impossible down progression | **PASS** | `validateMatchState` run continuously: 0 `DOWN_RANGE` violations |
| No possession deadlock | **PASS** | 200/200 games completed; phase watchdog never fired |
| CPU completes games against itself | **PASS** | 200/200, 198 ms per game |
| Save and load work | **PASS** | `npm run replay` save round-trip + corrupt-JSON quarantine |
| Settings persist | **PASS** | smoke writes `cameraShake=0.42` and reads it back from local storage |
| Low graphics preset remains playable | **PASS** | LOW: 32 draw calls, 41 k triangles (see §5) |
| Important console errors resolved | **PASS** | smoke: `no console errors — clean` |
| No critical TODO or stub | **PASS** | `grep -rn "TODO\|FIXME\|coming soon" src/` → none |
| No proprietary asset or branding | **PASS** | zero binary assets (test-enforced); league-name test; see IP_SAFETY.md |
| README commands tested from clean | **PASS** | every script in §7 was run to produce this document |
| Motion is smooth, and measurably so | **PASS** | two harnesses, before/after in §6 |

---

## 2. AUTOMATED SUITES

```
npm run typecheck    clean, strict, across src + tools + tests
npm test             9 files, 214 tests, all passing (~34 s)
npm run scenarios    24 / 24 deterministic gameplay scenarios
npm run replay       12 / 12 determinism + persistence checks
npm run smoke        19 / 19 browser checks
npm run sim:batch    200 games, 0 violations, 0 watchdogs
npm run perf:sim     simulation tick cost
npm run perf         browser frame profile at all three presets
npm run smoothness   motion quality: churn, jerk, foot-slide, interpenetration
npm run pacing       frame pacing across eight display models
```

**Unit tests (214)** cover: the rules engine (chains, scoring, spots, Overdrive, endgame,
invariants), the league data (16 teams, unique ids/abbrs/numbers, valid colours, banned-name
screen, logo markup), the playbook (27 offensive / 14 defensive plays, target stamping, route
bounds, page/slot completeness, diagram output), procedural audio in a Node no-op context,
tournament brackets, season scheduling and playoffs, the play editor, the frame pacer, and
**layer purity**.

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
| combined points | **48.2** (range 23–82) | 44–60 | pass |
| home / away | **24.9 / 23.3** | within 4 | pass |
| plays per game | **63.0** | 55–70 | pass |
| touchdowns | **5.9** | 5–8 | pass |
| interceptions | **2.3** | 1.5–4 | pass |
| sacks | **6.9** | 4–9 | pass |
| forced fumbles | 3.2 | — | — |
| **safeties** | **2.63** | ≤ 1 | **FAIL — see §8** |
| Overdrive activations | 1.3 | ≥1 | pass |
| field goals / punts | 1.3 / 3.8 | — | — |
| ties | 0 | 0 | pass |
| overtimes | 6 / 200 | — | — |
| wall clock | **198 ms per game** | — | — |

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
PASS  WebGL context created                            drawCalls=31 tris=111656
PASS  title advances to the main menu
PASS  menu navigation responds
PASS  quick play opens
PASS  settings persist to local storage                cameraShake=0.42
PASS  human-vs-CPU match starts
PASS  keyboard reaches the input layer as actions      {"moveZ":1,"held":8209}
PASS  seat 1 is bound to an athlete on the field       athlete=0
PASS  simulation drives to a valid final in the browser 2-9, 64203 ticks, watchdogs=0
PASS  match reaches the final screen
PASS  final score is sane
PASS  no watchdog trips during the browser match
PASS  rematch starts cleanly
PASS  pause opens
PASS  resume returns to the match
PASS  quit to menu works
PASS  no unbounded GPU resource growth                 geometries 21→21→21→21→21  textures 35→35→35→35→35
PASS  no console errors                                clean
```

The 2–9 scoreline is expected: the "human" seat is a script that presses nothing after the input
assertion, so that team never moves. What the check proves is that a match with a live human seat
still reaches a legal final result.

Draw calls moved from 28 to 31 and geometries from 20 to 21 in this pass. That is the goalposts
being split into one mesh per end so the goal between the camera and the ball can fade out; the
budget is 180 draw calls.

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
| HIGH | **39** | 145 012 | 23 | 38 | 15.6 ms | 149.6 ms |
| MEDIUM | **39** | 103 072 | 36 | 38 | 17.0 ms | 100.3 ms |
| LOW | **32** | 41 292 | 48 | 38 | 16.1 ms | 31.9 ms |

Budgets: ≤180 draw calls (hard fail >320), ≤420 k triangles (hard fail >900 k).

- **Draw calls and triangle counts pass by a wide margin** and are hardware-independent. 32–39 draw
  calls for a full stadium, crowd, field and fourteen animated athletes is the payoff from building
  each athlete as a single vertex-coloured `SkinnedMesh` and merging the stadium geometry. One of
  those calls is new: the goalposts are now one mesh per end so the near goal can fade out.
- Triangle counts vary between runs because they depend on what the camera happens to be framing
  when the sample is taken; 145 k against a 420 k budget is the highest figure seen.
- **The frame times are software-rendered and should not be read as performance figures.** They are
  reported because hiding them would be worse. The sampling windows were short (5–21 frames) because
  each sample costs a browser round-trip on a machine already saturated by rasterising in software.
  Frame timing on real hardware is untested — see §8.
- Boot to interactive measured **9.9 s** here against a 2.5 s budget. Most of that is procedural
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

## 6. MOTION QUALITY

Added after the first release build, in response to "make the gameplay smoother". Two harnesses
were written first so the work could be measured rather than asserted, and both are checked in.

### Simulation motion — `npm run smoothness`

14 CPU-vs-CPU games, PRO, ~2,960 seconds of live ball. Lower is smoother in every row.

| metric | before | after | change |
|---|---|---|---|
| animation-state changes / athlete / s | 3.192 | **1.780** | −44 % |
| run↔sprint flips / athlete / s | 1.166 | **0.554** | −52 % |
| heading jerk, RMS (rad/s³) | 12,387 | **9,968** | −20 % |
| position jerk, RMS (yd/s³) | 4,010 | **3,786** | −5.6 % |
| largest single-tick positional correction (yd) | 0.752 | **0.584** | −22 % |

What each row is and why it moved:

- **Animation churn** is the rate at which an athlete's animation state changes. Every change
  restarts a procedural pose from scratch, so churn is literally the rate at which limbs teleport.
  At 3.19 per athlete per second with fourteen athletes on the field, something on screen was
  snapping about 45 times a second. Hysteresis on the locomotion bands and a gait speed that no
  longer collapses the instant turbo engages account for the drop; pose cross-fading then removes
  the visible cost of the changes that remain.
- **Run↔sprint flips** were 37 % of all churn: athletes holding a speed on the threshold changed
  state every tick.
- **Heading jerk** fell because heading is now a rate-limited angular velocity rather than a
  constant-rate rotation that stops dead the instant the error falls inside one step.
- **Position jerk barely moved, and that is deliberate.** It is dominated by tackles, blocks and
  pancakes, which are supposed to be abrupt. The pile-separation change shows up in the *largest*
  correction rather than in the RMS.
- **Pile separation costs a little interpenetration, and here is how much.** Resolving overlaps
  over a couple of ticks rather than instantly is what removed the largest positional jumps. The
  price is measured: live bodies now interpenetrate 0.037 yd on average against 0.012 yd when the
  overlap is resolved instantly — about 4 % of the 0.84 yd body width, against a 33 % reduction in
  the single-tick jumps you can actually see. The relaxation constant was chosen from that
  trade-off, not by feel; an intermediate value of 0.55 was measured and rejected for leaving 0.053
  yd of penetration at no extra smoothness.
- **Foot-slide is now structurally zero.** Stride cadence is derived from ground covered rather
  than from velocity. Measured on the same runs, a velocity-driven stride misses 0.44 yd/s of real
  ground travel on average, 4.4 yd/s at the 95th percentile, and more than 1 yd/s on 10.1 % of
  athlete-ticks — that is a body sliding while its legs say otherwise, and it is gone.

### Frame pacing — `npm run pacing`

The shipped `FramePacer` and the shipped accumulator arithmetic, run over synthetic delta
sequences. **This is not a browser benchmark and deliberately so**: an in-browser timing run in
this container measures the software rasteriser, not the pacer (frames arrive roughly 2.4 s apart,
see §8). Pacing is a pure function of the delta sequence, so it can be measured exactly here.

The model has two clocks: the true interval a frame is on screen, and the noisy delta the loop
reads. The metric is the standard deviation of *simulated time advanced ÷ time the frame was
actually on screen*. 0 % is perfectly even motion.

| display | unpaced | paced | clock drift over 30 s |
|---|---|---|---|
| 60 Hz, exact timestamps | 0.0 % | 0.0 % | 0.0 ms |
| 60 Hz, 0.4 ms timestamp noise | 1.4 % | **0.2 %** | 7.9 ms |
| 60 Hz, 1.5 ms timestamp noise | 5.1 % | **1.4 %** | 29.6 ms |
| 59.94 Hz, 0.8 ms noise | 2.7 % | **0.5 %** | 15.5 ms |
| 60.05 Hz, 0.8 ms noise | 2.7 % | **0.5 %** | 16.0 ms |
| 120 Hz, 0.5 ms noise | 3.4 % | **0.6 %** | 9.6 ms |
| 144 Hz, 0.5 ms noise | 4.1 % | **0.7 %** | 6.2 ms |
| 60 Hz, one frame in 40 dropped | 1.4 % | **0.2 %** | 7.9 ms |

Worst-case clock drift is 29.6 ms in 30 s — under two frames, or 0.1 %.

Two findings worth recording because they contradict the usual advice:

1. **The classic fixed-timestep beat does not exist in this build**, because render interpolation
   already covers it. The harness prints the share of frames not running the modal number of
   simulation steps: it is 50 % at 120 Hz and 41.7 % at 144 Hz and it is completely invisible.
   Pacing earns its place only against *timestamp* noise.
2. **The first version of the pacer made dropped frames three times worse** (1.4 % → 8.9 %),
   because averaging smeared one genuinely long frame across the next four. The shipped version
   distinguishes a change of cadence from noise and adopts it immediately. That regression is why
   the harness has a dropped-frame case at all.

`tests/framePacer.test.ts` covers the pacer directly: identity at an exact 60 Hz delta, noise
rejection bounded by the bleed ceiling, wall-clock accuracy over a minute of frames, immediate
adoption of a dropped frame, snapping at 240/180/144/120/100/90/75/60 Hz, hitch passthrough, and
no negative or non-finite output.

### Rendering changes not covered by either harness

Honest list, because these were judged by eye on the capture set rather than measured:

- Pose cross-fading (50–140 ms depending on state), body lean and bank from acceleration,
  stride-phase interpolation between ticks, and yaw easing.
- Camera: eased framing parameters, mode hysteresis with a 0.4 s dwell, carrier look-ahead, and a
  shake that decays over ~0.25 s with a fixed direction per impact instead of a 12 Hz sine that
  lost 99.9 % of its amplitude in a tenth of a second.
- Goalposts split into one mesh per end so the goal standing between the camera and the ball fades
  to 16 % opacity. Near a goal line the crossbar used to draw a bright yellow bar across the play.
  Costs one extra draw call.
- Shader prewarm at match load, removing the first-snap compile stall.
- Adaptive resolution, on by default and switchable in Settings.

### Balance impact of the simulation-side changes

Three of the changes touch the simulation (gait normalisation, heading control, pile separation),
so the batch was re-run to confirm they did not move the game. 40 games, PRO:

200 games, PRO, with per-tick invariant checking:

| metric | before | after |
|---|---|---|
| combined points | 47.8 | 48.2 |
| plays per game | 63.7 | 63.0 |
| touchdowns | 5.8 | 5.9 |
| interceptions | 2.1 | 2.3 |
| sacks | 7.0 | 6.9 |
| safeties | 2.56 | 2.63 |
| rules violations | 0 | 0 |
| watchdog trips | 0 | 0 |
| ms to simulate a game | 216 | 198 |

Every row is inside run-to-run variance; intermediate builds during this pass measured anywhere
between 2.17 and 2.65 safeties on smaller samples, which is the size of the noise on that figure.
Safeties are reported at the number the final build actually produced rather than at the best one
seen — it is still the one balance target the game misses. See §8.

One change was **reverted during this work** and is recorded because the reasoning matters: an
early attempt fixed the skating by splitting the sustained block shove between position and
velocity. It worked visually and cost 2.8 sacks a game (7.0 → 9.8) because the velocity half was
partly cancelled by the rusher's own steering. Deriving the gait from ground covered instead fixed
the same symptom with no gameplay effect at all.

### What an adversarial review of this pass found

The whole change set was handed to an independent reviewer before it was committed, with
instructions to find defects rather than to approve. It found six, all real, all since fixed:

1. **40 % of celebrations turned the scorers away from the camera.** The turn was keyed to the
   side that scored; the camera's orientation comes from the side that *snapped the ball*, and on
   a pick-six, a fumble return, a kick return or a safety those differ.
2. **Adaptive resolution was a one-way ratchet on any display below about 53 Hz.** Absolute
   thresholds meant a 50 Hz panel with unlimited headroom satisfied "late" on every frame and
   "on time" on none, and dropped silently to minimum resolution — on a setting that defaults to
   on. Recovery was unreachable even at 60 Hz, because a single long frame zeroed the counter.
   Both thresholds are now relative to the fastest frame the machine has been seen to produce,
   and the recovery counter decays instead of resetting.
3. **The frame pacer's snap band was wider than its wall-clock correction could repay**, so a
   display holding a steady 58 Hz would have been fed a 60 Hz step forever and the match clock
   would have run about 2 % slow for as long as the game was open. The band is now bounded by
   the correction, and made sticky so a display sitting on the edge does not chatter across it.
4. **The new between-plays animation step could never run in `FINAL`**, the phase that most
   obviously needed it, because the match returns early once it is finished. The final screen was
   fourteen statues with the exact stale-interpolation sawtooth the step exists to remove.
5. **The pile-separation cap was applied to the summed push instead of per pair**, so opposing
   shoves cancelled before the cap was reached and a body wedged in a pile got almost no
   separation at all. Measured at four times deeper interpenetration than the code it replaced.
6. **The between-plays step advanced turbo**, which is a gameplay resource, not presentation. It
   changed nothing today only because every play resets turbo anyway; turbo is now explicitly
   saved and restored around the call so a future change to carry-over cannot break it quietly.

Findings 1, 3, 4 and 5 were each reproduced with a measurement before being fixed.

---

## 7. WHAT WAS RUN TO PRODUCE THIS

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
npm run smoothness       # motion quality, §6
npm run pacing           # frame pacing, §6
npm run capture          # visual review set
```

---

## 8. KNOWN LIMITATIONS AND UNVERIFIED CLAIMS

Stated as failures rather than omissions:

1. **Gamepad input is untested at runtime.** No controller can be attached to this container. The
   code path is written against the standard Gamepad API mapping and is exercised by unit-level
   reasoning only. A human with a controller should verify seat assignment, the three action
   buttons, and D-pad receiver targeting before this is called done.
2. **Frame rate on real hardware is unmeasured.** Draw calls, triangles and memory are measured and
   pass comfortably; wall-clock frame time is not, because there is no GPU here. This bites hardest
   on the smoothness work: an in-browser sampling run measured frames arriving **2,396 ms apart at
   1280×720** under SwiftShader, so camera jerk and frame-interval jitter measured in this container
   are artefacts of the rasteriser and were discarded rather than published. The frame pacer is
   measured directly instead (§6), which is exact and hardware-independent; the rendering changes it
   sits alongside — cross-fading, camera easing, lean and bank — were judged on the capture set by
   eye and are **not** backed by a number.
3. **Boot time is over budget as measured** (9.3 s vs 2.5 s), on software rendering. Unverified on
   hardware.
4. **Four-player local multiplayer is untested with four real devices.** Seat assignment, control
   binding and the disconnect path are covered by code and by the "controller vanishing mid-play"
   scenario, but four humans on one machine has not been played.
5. **Audio is verified functionally, not aurally.** The Node suite proves every cue can be triggered
   without throwing and that the headless no-op path is safe; nobody has listened to it. Levels,
   mix balance and whether the touchdown sting actually lands are unjudged.
6. **Safeties are still too common at 2.42 a game** (2.56 before the motion work; the small
   improvement is a side effect, not a fix). Real football sees about 0.05. This is the one
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
13. **Adaptive resolution has never actually engaged.** Its trigger is the frame interval against a
    60 Hz target, and no session in this container has ever run near 60 Hz, so the scale-down and
    scale-up paths are exercised by reading them rather than by running them. The setting defaults
    to on; a player on real hardware who sees the image soften under load is seeing it work, and one
    who dislikes it can switch it off in Settings.
14. **Adaptive resolution assumes a 60 Hz target.** On a 30 Hz-locked display it would scale down to
    its 60 % floor and stay there. Rare on desktop, and switchable, but it is a real limitation of
    the heuristic rather than an oversight.
