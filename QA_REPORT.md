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
| Core controls work on a gamepad | **UNVERIFIED HERE** | no controller can be attached in this container — see §10 |
| Pause and resume work | **PASS** | smoke checks `pause opens` / `resume returns to the match` |
| No permanent stuck-ball state | **PASS** | ball invariant asserted every 7th tick over 200 games: 0 violations |
| No permanent stuck-athlete state | **PASS** | scenario `no athlete leaves the world bounds`; 0 watchdog trips in 200 games |
| No duplicate score | **PASS** | scenarios for TD / FG / safety / conversion assert score **deltas** |
| No impossible down progression | **PASS** | `validateMatchState` run continuously: 0 `DOWN_RANGE` violations |
| No possession deadlock | **PASS** | 200/200 games completed; phase watchdog never fired |
| CPU completes games against itself | **PASS** | 200/200, 143 ms per game |
| Save and load work | **PASS** | `npm run replay` save round-trip + corrupt-JSON quarantine |
| Settings persist | **PASS** | smoke writes `cameraShake=0.42` and reads it back from local storage |
| Low graphics preset remains playable | **PASS** | LOW: 35 draw calls, 47 k triangles, post off (see §5) |
| Important console errors resolved | **PASS** | smoke: `no console errors — clean` |
| Plays as one self-contained file | **PASS** | 10/10 artifact checks in a sandboxed iframe, §8 |
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
| combined points | **54.2** (range 27–92) | 44–60 | pass |
| home / away | **27.4 / 26.8** | within 4 | pass |
| plays per game | **55.6** | 55–70 | pass — thin |
| touchdowns | **7.8** | 5–8 | pass |
| interceptions | **2.9** | 1.5–4 | pass |
| sacks | **4.1** | 4–9 | pass — on the floor, see §12.8 |
| forced fumbles | 3.2 | — | — |
| **safeties** | **0.17** | ≤ 1 | **pass — was 2.96; see §10** |
| Overdrive activations | 1.1 | ≥1 | pass |
| field goals / punts | 0.9 / 1.9 | — | — |
| first downs / team | **4.4** | 8–12 wanted | **fail — see §12** |
| ties | 0 | 0 | pass |
| overtimes | 11 / 200 | — | — |
| wall clock | **262 ms per game** | — | — |

Two rows are inside their bands with no margin and are called out rather than left to look
comfortable. Sacks at 4.1 sit on a floor of 4; that is roughly 2.05 per team per game, which is
close to real football and a long way from the 3.5 this build used to produce, and the change is
deliberate (§12.8) rather than drift. Plays per game at 55.6 against a floor of 55 is a consequence
of drives that score faster.

Re-measured after §12. The only target this table misses is one it did not used to state at all:
first downs. It is written in now, with the number it actually produces, because a balance table
that only lists the rows it passes is a marketing document.

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
| HIGH | **40** | 209 508 | 32 | 43 | 18.1 ms | 204.0 ms |
| MEDIUM | **42** | 108 700 | 45 | 43 | 18.2 ms | 149.5 ms |
| LOW | **35** | 46 710 | 51 | 42 | 17.0 ms | 32.9 ms |

Post-processing adds 6 further passes at HIGH and MEDIUM (4 of them at reduced resolution) and 0
at LOW, where the chain is off. Draw-call and triangle figures are read from the SCENE pass, not
from the final composite — see §7.

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
  Frame timing on real hardware is untested — see §10.
- Boot to interactive measured **19.4 s** here against a 2.5 s budget. Most of that is procedural
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
see §10). Pacing is a pure function of the delta sequence, so it can be measured exactly here.

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

## 7. GRAPHICS PASS

Added after the motion pass, in response to "evolve the graphics". Same rule as everything else in
this document: measured where measurable, and honest about the large part of it that is not.

### What the scene costs now

`npm run perf`, 1600×900, moving CPU-vs-CPU gameplay. Budgets are ≤180 draw calls (hard fail >320)
and ≤420 k triangles (hard fail >900 k).

| tier | draw calls | triangles | post passes | before this pass |
|---|---|---|---|---|
| HIGH | **40** | **209 508** | 6 | 39 calls / 145 012 tris |
| MEDIUM | **42** | 108 700 | 6 | 39 / 103 072 |
| LOW | **35** | 46 710 | 0 | 32 / 41 292 |

**One extra draw call** bought all of it. That is the payoff from the constraint the renderer has
had since the first build — one skinned mesh per athlete, merged geometry everywhere else — and it
is why the surface description had to move into the vertices rather than into more materials. The
triangles went where they were supposed to: athletes are 7 450 tris each at HIGH (835 at LOW),
up from about 1 600, and they are 104 k of the 209 k total.

The effects rewrite made the scene *cheaper* whenever something is happening: the old shock-ring
pool was 24 individual meshes, and the whole effects system is now 4 instanced draw calls.

### What was measured, and what was only looked at

Measured and hardware-independent: draw calls, triangles, texture and geometry counts, GPU
resource stability across repeated matches (smoke: geometries 25→25→25→25→25, textures 25→25 over
five match loads), and the 200-game balance batch.

**Not measured: whether any of it runs fast enough.** This container has no GPU, so every frame
figure below is SwiftShader software rasterisation and is not evidence of anything:

| tier | frame p50 | frame p95 |
|---|---|---|
| HIGH | 18.1 ms | 204.0 ms |
| MEDIUM | 18.2 ms | 149.5 ms |
| LOW | 17.0 ms | 32.9 ms |

Boot to interactive went from 9.9 s to **19.4 s under software rendering**. Some of that is real —
the environment map is a genuine one-off render at match load, and there is more procedural texture
generation — and some is the rasteriser. Which share is which cannot be determined here. A player
on real hardware should be asked whether HIGH is comfortable; the adaptive-resolution governor
added in the motion pass exists for exactly this and is on by default.

The look itself — bloom weight, grade, rim strength, mow-band visibility, whether the athletes read
at distance — was judged by eye on the capture set across about twenty iterations. There is no
number for that and it would be dishonest to invent one.

### Two real bugs the graphics work exposed

Both were found because rendering work changed conditions elsewhere, and both are fixed:

1. **`StadiumDef.surface` never reached the game.** `Match` hardcoded `'GRASS'` when building the
   conditions, so twelve of the eighteen grounds — mud, sand, frozen, artificial turf, asphalt —
   rendered as grass *and* played with grass traction. The venue now owns its surface. The
   200-game batch is unchanged (48.0 combined, 0 violations, 0 watchdogs), because the batch had
   been running on an implicit grass field too; it now plays at the home team's actual ground, so
   non-grass traction is exercised for the first time.
2. **Quick key taps were silently dropped.** Held keys lived in a set that was sampled once per
   frame; a key pressed *and released* between two samples never appeared in it, so the press
   simply did not exist. The slower the frame, the more often it happened — which is why adding a
   post chain made the browser smoke fail on a menu keystroke. Presses are now latched on the
   keydown event, so a tap always produces exactly one press edge and one release edge regardless
   of frame rate. This was a live input defect, not a test artefact.

A third issue was tooling: every browser tool serves `dist/` and none of them built first, so a run
could silently measure or photograph the previous build. Three separate work streams lost an
iteration to it before it was fixed; `ensureBuild()` now runs first in smoke, perf, capture and
shot.

### What was NOT done

- The stadium bowl, crowd, sky and weather are unchanged. The crowd is still instanced billboards.
- Goalposts, pylons, benches and sideline props are still Phong; they do not pick up the
  environment map. They are small on screen, and it was the wrong place to spend the pass.
- No screen-space ambient occlusion and no contact shadows. Athletes still meet the turf with a
  hard shadow edge and nothing softer.
- Heat shimmer around an Overdrive athlete is a faked additive plume, not refraction.
- The additive carrier trail is at its weakest over bright end-zone paint, which is exactly where
  a long touchdown run finishes.

---

## 8. SINGLE-FILE ARTIFACT — 11 / 11

`npm run artifact` folds the whole game into one HTML document; `npm run artifact:check` proves it
works. The check exists because passing the normal browser smoke says nothing about this build —
it is a different bundle (one IIFE chunk instead of two ES modules) delivered a different way.

The file is loaded the way a player actually gets it: **inside a sandboxed iframe on a different
origin, with every path other than the document itself returning 404.** Anything still reaching for
a module, a font or an asset fails rather than silently succeeding.

```
PASS  one file, no external references                     980 kB
PASS  boots inside a sandboxed iframe
PASS  reaches a screen                                     screen=title
PASS  survives a host that forbids the gamepad API         getGamepads throws, poll ok, pads=0
PASS  settings survive a write and read back               cameraShake=0.37
PASS  a match starts                                       phase=PREGAME
PASS  the scene actually draws                             drawCalls=28
PASS  keyboard reaches the game inside the frame           {"moveZ":1,"held":8192}
PASS  plays through to a valid final                       2-9 in 11 007 ticks, watchdogs=0
PASS  made zero network requests
PASS  no console errors                                    clean
```

### The one that shipped broken, and why the harness missed it

The first artifact **did not boot in a real host.** `navigator.getGamepads()` does not merely return
nothing when a permissions policy forbids the gamepad feature — it throws a `SecurityError`, and it
throws on the CALL, not on the lookup, so the existing `navigator.getGamepads ? … : []` guard sailed
straight past it. The input manager is constructed before the first frame is drawn, so the throw
was uncaught and the game stopped on the loading bar.

The check above had passed. It was loading the file in a sandboxed iframe, which is right, but
Chromium did not apply the gamepad restriction to a same-origin `srcdoc` frame, so the harness was
testing a *more permissive* environment than the one players get. Adding `allow=""` did not change
that either — it still reported "gamepad permitted in this run".

So the harness now **injects the failure**: before the game script runs, `navigator.getGamepads` is
replaced with one that throws exactly the `SecurityError` a real embedded host produces. That is a
simulation and it is labelled as one, but it is deterministic and it fails loudly against the old
code. Every gamepad access is now non-throwing and gives up permanently after the first refusal,
because this runs every frame.

Two neighbours were hardened at the same time, for the same reason — an embedded page is denied
things, and the denial is not always a polite `undefined`:

- **Fullscreen.** Browsers disagree about whether a refusal is a rejected promise or a synchronous
  throw. Both are now non-events.
- **Audio.** Already guarded: the context is created lazily inside `unlock()` behind a try/catch.

The general lesson is written here because it is the second time this exact shape of bug has
appeared in this project: **a capability test that checks for existence does not test for
permission.** `localStorage` failed the same way, in the same build, for the same reason.

Three things the embedded build has to handle that the normal one does not:

1. **Focus.** A framed document receives no keystrokes until something in it has focus, and
   nothing claims focus on its own. A prelude takes it on load and on every pointer press, so the
   first click a player makes is also what makes the keyboard live. The check presses a key at the
   *page* level and reads the produced `PlayerIntent` inside the *frame*, which is the only way to
   prove that path end to end.
2. **Storage.** A sandboxed frame can throw on `localStorage` access — and the throw happens on
   access, not on lookup, so testing that the object exists is not enough. The save layer now
   probes with a real write and falls back to an in-memory backend. Previously it simply gave up,
   which meant a setting changed during a session was forgotten the moment you left the settings
   screen. This also fixes private browsing and a full quota.
3. **Defaults.** The artifact starts at MEDIUM rather than HIGH, because it runs inside a page
   that is already busy. Changeable in Settings like everything else.

**Honest limits of this artifact.** It has never been played by a human at a real frame rate —
this container has no GPU, so the same caveat in §7 applies. Gamepads are not expected to work
inside a sandboxed frame (the Gamepad API is gated by permissions policy); keyboard is the path
that is tested. Nothing survives a reload when the host frame blocks storage, and the hint line
says so on screen rather than letting a player lose a season to it.

---

## 9. FIVE BUGS FOUND BY PLAYING IT, AND THE ANIMATION REBUILD

Everything above this section was produced by harnesses that play the game CPU against CPU. Two
hundred clean games, twenty-four scenarios, nineteen browser checks — and every one of them missed
five faults that a person found in the first few minutes with a controller in his hands:

> on Offense the ball automatically starts in the wrong player's hands when it's snapped · you can
> run across the line before snapping the ball and you magically have the ball and a lot of yards ·
> kickoffs/returns seem to be broken · throwing doesn't seem to work for either team · running looks
> awkward for all characters in all animation

That is the honest headline of this section: **a test suite that never presses a button cannot find
a bug in what happens when you press a button.** All five were real and all five were reproducible;
none of them required a human to reproduce once the right harness existed.

### The harness that was missing — `npm run human`, 17 / 17

`tools/humanprobe.ts` drives a real `Match` with a scripted human in seat 0. It holds the buttons a
person holds, through the same `PlayerIntent` a keyboard produces, and the match computes press and
release edges itself exactly as it does for a real seat. It went from 6 / 12 to 17 / 17 as the
fixes landed.

```
PASS  at pre-snap the player controls the quarterback        controlling=0 (QB) qb=0
PASS  at pre-snap the quarterback has the ball               ball=0 (QB)
PASS  the quarterback starts behind the line of scrimmage    qb is -1.6 yd relative to the line
PASS  pre-snap movement cannot cross the line of scrimmage   moved 1.3 yd, ended -0.3 yd past
PASS  a held button left over from play select does not snap the ball
PASS  a fresh press snaps the ball                           phase=LIVE
PASS  pressing a receiver button throws the ball             passThrown=true
PASS  a human-offence game reaches a final                   53 418 ticks, 80 snaps
PASS  a human offence throws repeatedly across a game        53 throws in 80 snaps
PASS  those throws are actually caught                       34 catches, 1 picked, from 53 throws
PASS  a human offence scores                                 final 16-35, 2 human touchdowns
PASS  a kickoff phase is reached                             phase=KICKOFF_SETUP
PASS  the kickoff leaves the setup phase                     after 352 ticks
PASS  the kickoff resolves to a live scrimmage down          possession=1 (kicked by 0) los=91.4
PASS  the kick changes possession to the receiving team
PASS  the receiving player is given an athlete during the return
PASS  the receiving player ends up controlling the returner
```

### What each one actually was

1. **The wrong player has the ball at the snap.** Not a ball bug — a *camera-on-the-wrong-man* bug.
   `updateControlAssignment` decided which athlete a seat drives by comparing the seat's side to
   `world.possession`, which during a kickoff names the **kicking** team for the entire play. A
   human on the receiving team was therefore handed a coverage defender and never the returner, and
   at a scrimmage snap the fallback could hand him a blocker rather than the quarterback. Now the
   assignment keys off whoever actually holds the ball, with the quarterback as the explicit
   offensive fallback.

2. **The ball snapped the instant the play was called.** The snap read `held` on ACTION — the same
   button that selects a play. The player's thumb was still down from the menu, so the ball left
   the centre's hands before he could look up. Fixed with an arm-on-release edge: the snap now
   requires ACTION to be *released* after the play call and pressed again. A second fault surfaced
   immediately behind it — the fresh press was being eaten by the 0.3 s pre-snap settle window, so
   an eager player's press vanished. The request is now latched and fires the moment the window
   opens.

3. **Running downfield before the snap.** Pre-snap locomotion had no constraint at all: a player
   could jog 18.4 yards downfield, snap, and bank the yards. `holdTheLine()` in the play runner now
   holds every athlete on his own side of a 0.35 yd neutral zone until the ball is live.

4. **Throwing "didn't work".** It worked; bug 3 was disabling it. A quarterback past the line of
   scrimmage correctly loses the ability to pass, so walking over the line pre-snap silently turned
   the pass game off. Fixing the line constraint fixed the throw. The probe now throws 53 times in
   80 snaps and completes 34.

5. **The animation.** Its own subsection, below — it was the largest of the five.

### The animation: a whole-file sign error

The poses are procedural, written directly as bone rotations. Every rotation in the file is about
X, and a bone's child hangs at local −Y for a limb and +Y for the spine — so **the same positive
number means opposite things on a leg and on a back**. That was never written down, and the file
had it inverted almost everywhere:

- **Knees hyperextended.** Every state bent the knees with a negative angle, which swings the shin
  *forward*. Fourteen athletes stood, ran, blocked and got tackled with their knees bending the
  wrong way.
- **The lean leaned backwards.** `bodyLean` was applied as a negative X rotation on the hips, so a
  positive lean tipped the torso *away* from the direction of travel. A dive — 1.45 rad of it —
  was a man falling on his back with his legs shot out in front.
- **Both arms crossed inward.** The abduction sign was flipped on both shoulders, so both arms
  angled in toward the chest instead of hanging clear of it.
- **The forward lean was on the pelvis**, which carries the legs, so leaning rotated the whole
  lower body and the feet never reached the turf.

None of these reads as one obvious fault in a 40-pixel-tall athlete. It reads as "awkward", which
is exactly what was reported.

### The tools built to see it

Two contact sheets, because a pose cannot be judged from a wide gameplay shot:

- **`npm run poses`** parks a camera on one athlete, forces each of the nineteen animation states
  in turn and writes one frame each → `docs/captures/poses.png`. This is what found the sign
  errors in states nobody looks at directly.
- **`npm run gait`** steps a sprinting athlete tick by tick and writes a strip across a full stride
  → `docs/captures/gait-side.png`, `gait-front.png`. `--view side|front|threequarter`.

### The run cycle is now solved, not swept

The old cycle drove each joint with a sine wave. The new one gives each foot a **target path** —
flat on the turf through stance, an arc through swing — and a two-link solve turns that into thigh
and knee angles. Three properties fall out of it:

- **Contact time is derived, not chosen.** The duty factor is set so a planted foot travels
  backwards at exactly the speed the body travels forwards, using the same ground-covered figure
  the stride cadence already reads.
- **Stride length is bounded by the leg, and the toe counts.** The reach behind the athlete is much
  longer than the reach in front, because at push-off he is up on his toes. The first version of
  this pass ignored that and lost about a third of the stride to it — small mincing steps under a
  body sliding forward.
- **What is held still is the sole, not the ankle.** A version that rolled the contact reference
  from heel to toe through the stance looked correct in stills and measured 4.7 yd/s of slip: a
  flat sole cannot roll, and migrating the reference along it scrubs the shoe against the turf at
  exactly the migration rate. One fixed contact point at the ball of the foot is stationary by
  construction. The price is the heel sinking about 3 cm at the strike and the toe about 5 cm at
  push-off, which on a cleat reads as digging in.

A second, separate pass **plants the feet in every standing pose** — set, block, throw, catch, get
up. It measures where the lower ankle actually landed and drops the pelvis onto it, bounded so a
pose that is deliberately airborne cannot be dragged down. Hand-tuning a hip height into each of
nineteen cases would have gone stale the first time a knee angle changed.

### A cross-fade that was freezing the legs

RUN and SPRINT are one continuous solved cycle that differs only by amplitude, and athletes flip
between them **0.569 times per second each**. Every flip started a 130 ms pose cross-fade that
blended back toward the pose being "left" — which froze the legs for nearly half a stride at speed
and then snapped them forward to catch up. States that are the same pose at different amplitudes no
longer fade between each other.

### Measured: `npm run footslip`

The question "do the feet grip the turf" is not answerable from a still frame, so it is measured.
`tools/footslip.ts` drives a real match, and each tick takes the lowest point of each running
athlete's shoe; when a foot is on the ground on two consecutive ticks, the distance **that same
piece of sole** travelled between them is slip. Same tool, same seed, same 2 400 ticks, run against
the build before this pass and after it:

| | before | after |
|---|---|---|
| ticks with a foot actually on the turf | **6.4 %** | **39.1 %** |
| slip, median | 6.86 yd/s | **1.16 yd/s** |
| slip, mean | 8.68 yd/s | **2.90 yd/s** |
| slip as a share of ground speed | **116 %** | **29 %** |
| slip while running straight, mean | 6.23 yd/s | **1.19 yd/s** |

The first row is the headline: before this pass the athletes' feet were **almost never touching the
ground** — they hovered, which is what the first gait contact sheet showed and what made the whole
thing read as floating. The 116 % figure means that on the rare tick a shoe did touch, it was
moving faster than the athlete was.

Two honest caveats on the "after" column:

- **1.19 yd/s is not zero**, even running straight. The residual is the stride being resized as the
  athlete's smoothed speed changes, plus the pelvis yaw and roll swinging the leg's solve plane.
- **The tail is cutting, and it is a real limitation.** The 11.0 yd/s p95 is athletes travelling in
  one direction while facing another — during a hard cut the median offset between heading and
  velocity reaches a radian. The stride is solved in the body's own frame, so those feet cannot
  both point where the athlete is looking and travel where he is going. Fixing it properly means
  solving foot placement in world space rather than body space, which is a larger change than this
  pass. It is measured and reported rather than hidden.

### What was not fixed here

The safeties figure moved from 2.73 to **2.96 a game** across the 200-game batch. That is within
run-to-run noise for this statistic and it is still far above the ≤ 1 target; the root cause
described in §11 is unchanged and no attempt was made at it in this pass.

---

## 10. THE SAFETY THAT WAS NEVER A SAFETY

Two hundred games said **2.96 safeties a game**. Real football sees about 0.05. That number sat in
the limitations list for two milestones, blamed on field compression — a 30-yard chain on a
100-yard field putting teams inside their own ten too often. That explanation was wrong, and no
amount of retuning field position would ever have fixed it, because none of it was a balance
problem.

`npm run fieldpos` prints the distribution underneath the aggregate: where every drive starts, how
the ball got there, and for each safety the geometry at the instant it fired. The first run said:

```
  conceded by      DEFENCE-turned-carrier 94%
  play was         KICKOFF 77%
  carrier got it at  median own 6.3      ball died at  median own -2.4
```

Ninety-four per cent of the safeties in this game were **kick returners**, fielding the ball around
their own six and being downed three yards deep in their own end zone. Not a defence pinning an
offence. Not field compression. One broken play, happening twice a match.

### Four faults stacked on top of each other

**1. The returner had no return behaviour at all.** `AiController.produce` dispatches on
possession — carrier, then offence, then defence — and a kick play makes those words meaningless,
because the KICKING team has possession and is therefore "offence". The coverage team was being
handed pass-protection and route-running logic while a kickoff sailed over their heads, and the
returner, who does hold the ball, went to the generic carrier brain. The one function written for
kick duties could only ever be reached by the return team's blockers.

**2. The returner tackled himself.** A trace of one return, tick by tick:

```
  t= 240 car z=83.7 v=19.8 move=DIVE_TACKLE anim=DIVE nearestDef=24.9yd  blockersEngaged=0/6
  t= 276 car z=91.8 v= 4.5 move=DOWN        anim=TACKLED nearestDef=35.7yd
  ENDED: deadReason=TACKLE
```

He dives to field the kick. A dive is a *committed* move that ends with the diver on the ground —
so the play ended, every time, with the nearest cover man twenty-five yards away and running the
other direction. The AI dove for any loose ball within 2.2 yards, contested or not. Diving on a
ball somebody else can reach is correct. Diving on one nobody else can reach spends the entire
rest of the play to gain nothing.

**3. Coverage jogged.** `pursue` only spends turbo inside twenty-two yards — right for a defender
shadowing a play, disastrous on a kickoff where the ball lands sixty yards away. The cover team
walked the first half of every kick.

**4. Hang time and coverage speed are one dial, not two.** Fixing 2 and 3 without touching hang
sent it the other way: *every* return became a touchdown, 76 yards mean, and the combined score
went from 48.9 to 125.1. A 2.75-second kick with sprinting coverage is as broken as a 4.15-second
one with jogging coverage. The pair has to be set together.

The momentum rule was widened as well, from five yards to ten — a player who takes possession of
somebody else's ball inside his own ten and is driven back over the line gets a touchback. Kicks
were being fielded around the six, so nearly every return fell a yard outside the old exception
and paid two points for it.

### What it cost and what it bought

| | before | after |
|---|---|---|
| safeties per game (200-game batch) | **2.96** | **0.12** |
| safeties conceded by a kick returner | 94% | 0% |
| kickoff return, net | −0.4 mean, 63% went backwards | **+6.2 mean, 15% went backwards** |
| punt return, net | −4.6 mean, 86% went backwards | **+3.0 mean, 60% went backwards** |
| first downs per team | 3.3 | 3.7 |
| combined score | 48.9 | 48.5 |
| average margin | 14.9 | 11.9 |
| violations / watchdogs over 200 games | 0 / 0 | 0 / 0 |

Two design additions came out of this rather than out of tuning. **Gunners**: the two widest men on
a punt team no longer block anybody, they release at the snap and race the ball — without them the
coverage starts a second and a half late and every punt return is a footrace the returner wins.
And **lane discipline**: cover men run a share of the field's width and only abandon it inside
fourteen yards, because six men converging on one point is precisely what a return wall is built
to beat.

### One test was wrong, and it is worth saying so

`dead ball never scores` failed during this pass. It did not find a bug. It killed the ball, ticked
a flat six seconds and compared the score — but six seconds from the 95 contains **two more
snaps**, so a perfectly legal touchdown on a later play was being read as a dead ball scoring. It
had been passing by luck; the AI changes perturbed the RNG stream enough to expose it. The
assertion now ends when the whistle does, and additionally asserts that no snap happened inside
the window. A test whose name does not match its assertion is worse than no test, because it
spends trust it has not earned.

---

## 11. ONE BUTTON, TWO ACTIONS, ONE TICK

Reported from play: *"on some plays the ball starts with the WR instead of allowing me to pass it —
specifically the offensive play Ripcord Mesh."*

It was not Ripcord Mesh, and it was not the receiver. Measured at the exact instant of the snap,
across twelve reps on both sides of the ball:

```
  side 0 g0: ball=NONE state=inAir passThrown=true handedOff=false playTicks=0 ctrl=QB
```

`passThrown=true` at **playTicks=0**. The ball was being thrown on the very first frame of the
play, before a single tick of it had run — so it simply materialised in a receiver's hands with no
throw the player ever made.

**ACTION snaps the ball and ACTION throws it, and both were resolving in the same tick.**
`applyActions` runs during PRE-SNAP as well as LIVE — it has to, because that is where pre-snap
movement comes from — so the press that flipped the phase to LIVE was still carrying a live ACTION
edge when the carrier logic ran immediately afterwards.

Fixing the throw exposed the same fault wearing a different hat: with `isQb` gated on a live ball,
the identical press fell through to the *carrier* branch, where ACTION means **lateral backwards**,
and eleven of the twenty-seven offensive plays began with the quarterback pitching the ball at
playTicks=0 instead of throwing it. The fix is the general statement rather than either special
case: **nothing may be done with the ball until it has been snapped.**

| | before | after |
|---|---|---|
| plays whose snap put the ball anywhere but the quarterback's hands | **11 of 27** | **0 of 27** |
| Ripcord Mesh, ball thrown at playTicks=0 | 36 of 36 reps | 0 of 36 |

The snap press is also now *consumed*: a seat that snapped with ACTION must release it before that
button means anything again, so holding the button through a snap — which is what a thumb does —
cannot produce a second action.

### The harness had this covered, and was wrong about it

`npm run human` reported 17/17 the whole time. It never held the snap button, because every check
that snapped politely released ACTION before doing anything else. A real thumb does not. There is
now a check that holds it, across **every** offensive play, because whether the bug was survivable
depended entirely on where that play's primary receiver happened to stand — which is exactly why it
looked like a bug in one specific play.

Two of that harness's existing checks then failed, and neither was a regression:

- **`pressing a receiver button throws the ball`** pressed at a fixed tick count, which sometimes
  aimed the press at a quarterback who was already on the floor. It now waits for a quarterback who
  is on his feet and still holding it.
- **`a human offence scores`** had been passing *because of the bug*. Every pass was leaving the
  quarterback's hand uncontested at playTicks=0, so the scripted human was moving the ball by
  exploiting it. With that gone, a script that always throws to the same receiver on a fixed timer
  took **eight to nineteen sacks a game** and scored nothing. That measures the script, not the
  game. It is replaced by `a human offence moves the ball` (211 yards, 19 catches), and the script
  now throws on the play's own primary-read timing or when a rusher is genuinely on top of the
  quarterback. CPU-vs-CPU balance was unmoved throughout, which is what said the offence was fine
  and the strawman was not.

---

## 12. THE MOVE ECONOMY, THE BOBBLE, AND A CHAIN THAT DID NOT MOVE

Three mechanics added, four mechanism-level bugs found and fixed, one design goal **not met**. The
last part is the important part and it is stated first.

### 12.1 What was added

**The juke.** A short plant and cut off a stick flick plus a modifier. 10 turbo against the spin's
20, 0.33 s against the spin's 0.52, and deliberately narrow: it beats a defender who has already
left his feet (86 %) and does almost nothing against a balanced tackler (18 %). A move that is good
against everything is a button you hold, not a decision.

**Ball protection.** Hold to trade 12 % of top speed, 15 % of turn rate and 45 % of fumble chance.
Measured 15.32 → 13.49 yd/s (`RUN-004`), which is the 0.88 the constant asks for.

**The bobble.** A failed catch no longer always kills the ball. A contested, bullet or diving drop
can juggle instead — and a swat can bat the ball *up* rather than down, which is where tipped
interceptions come from. The ball stays live **in the air**, either team can take it, and because it
is legally still a forward pass, touching the ground ends the down as incomplete and never as a
fumble. That distinction is carried by a `tipped` flag on the loose-ball state and honoured in
`stepBall`, `detectDead` and the AI, which goes **up** for a tipped ball instead of diving under it.

Measured with the new `npm run passprobe` over 8 full games: **2.5 bobbles a game, 85 % of which
resolve into somebody's hands** rather than falling dead. The man who caused the tip is penalised on
the recovery — he is simultaneously the closest player to the ball and the worst placed to catch it,
and without that penalty the defence was recovering two thirds of them.

### 12.2 A test that could not fail

`RUN-004` was green before the feature existed. It measured top speed, then held the protect button
and measured again — inside the same play. By the second measurement the play was over and the
carrier was standing still, so it compared **0.11 yd/s against 0.00** and reported a pass.

It now runs both arms as separate matches from the same seed, averages four seeds, and **rejects the
comparison outright if the control arm never got above 4 yd/s**. A test that cannot fail is not a
test, and this one had been decorating the matrix.

### 12.3 Four mechanism bugs, found by measuring instead of guessing

Two new instruments were built for this: `npm run driveprobe` (yards and conversions by play
concept, by down, by distance, with separation at the catch and yards after it) and `npm run
runprobe` (a run-game autopsy).

**Only three of seven players could block.** `updateBlocking` opened with `if (bl.role !== 'LINE')
continue`. Every run play in the book assigns a lead blocker and a stalk blocker on top of the three
linemen, and both of them ran to a patch of grass and stood on it. Measured: **4.6 of 7 defenders
unblocked**, first contact **0.8 yd past the line**, median designed run **1 yard**. Blocking is now
decided by the route — the line always blocks, anybody else blocks while his current route node says
`BLOCK` — and a blocker steers at the biggest **threat to the ball** within reach of his landmark
rather than at the landmark itself.

> median run **1 → 4 yd** · runs losing yardage **25 % → 1 %** (10-game window) · first contact
> **0.8 → 1.6 yd** past the line · unblocked defenders **4.6 → 3.5**

**The quarterback's drop depth was a string match on the formation name.** `formation.includes(
'SHOTGUN') ? 2.5 : 5.5`. Quick Nails is a three-step slant concept out of a formation called SPREAD,
so the quarterback took a five-and-a-half-yard drop on a play whose entire premise is that the ball
is gone before the rush arrives — walking backwards, away from his own protection. Quick concepts
were taking a sack on **22 %** of their snaps and gaining **3.23 yards** against a thirty-yard chain.
Drop depth now belongs to the concept.

> quick game **3.23 → 5.60 yd/play**, yards after catch **5.24 → 7.75**, completions **48 → 56 %**
> (20-game window)

**A screen wants the opposite.** Giving screens the same short drop measured **0.54 yd/play** against
2.60 before — the rush never came upfield, so there was nothing behind it. Screens now sell a deep
drop at 5.8 yd and measured **3.65**.

**Man coverage never sprinted.** `pursue` decides whether to spend turbo from the distance to the
point it was handed. In man coverage that point is a landmark a yard or two from the defender's own
feet, so `closing` was false on every snap of every play and a cornerback **jogged at 9.4 yd/s
alongside a receiver sprinting at 13.6**. Coverage now matches a receiver who is clearly running,
while keeping a reserve for the tackle.

**One event was declared, handled, and never emitted.** `down.change` existed in the event union and
had a case in the audio director since the day it was written. Nothing sent it, so the down-marker
cue never played and no instrument could see what down a play happened on. It is emitted now — and
the first thing it revealed was a flaw in the probe reading it, below.

### 12.4 The design goal that was not met

The task was "give the chain a rhythm": 3.3 first downs a game makes a thirty-yard chain a scoring
gate rather than a pulse. **It was not achieved.** Measured over 120 CPU games before and after the
entire pass:

| metric | before | after |
|---|---|---|
| first downs / team | 3.8 | **3.6** |
| combined points | 52.4 | 53.0 |
| touchdowns | 7.4 | 7.5 |
| sacks | 6.9 | 6.3 |
| shutouts / 120 | 6 | **2** |
| interceptions | 2.4 | 2.3 |
| rules violations | 0 | 0 |

Play-level quality improved and is worth having. The top-line number the task was named after did
not move, and the two-tenths it did move went the wrong way.

**Why, as far as the measurements go.** Drives do not die on the chain. They end before the chain is
ever in question: 16 drives a game, of which about 7 end in a touchdown and 5 in a turnover, at an
average of **3.2 plays each**. Forty-four percent of possessions score. There is no room in a
three-play drive for a first down.

That is downstream of one number: the deep shot completes **81 %** of the time for **23–25 yards a
play**, with roughly **half of all attempts going twenty-plus**. Every drive is two bombs and a
result. Three hypotheses were tested against that and are recorded here as failures:

1. **The chain is too long.** Rejected by direct measurement. `FIRST_DOWN_YARDS` was swept at 30, 24
   and 20 yards: first downs measured 3.6 / 3.6 / 3.4 and drive length 3.44 / 3.40 / 3.55 plays. The
   chain was never what was stopping anybody, and shortening it would have been a large design
   change bought with nothing.
2. **The quarterback holds the ball on timing concepts.** Rejected. Lowering the throw threshold on
   quick and screen concepts produced **byte-identical** output across 20 games — the old threshold
   was already being cleared. Measured directly: 80 % of quick snaps throw, at a median of 1.08 s.
   The change was reverted rather than left in as a no-op.
3. **Coverage plays too tight, so there is nowhere to throw underneath.** Rejected. Roughly doubling
   the man-coverage cushion raised completions (quick 56 → 61 %, goal-to-go conversions 8 → 18 %) and
   *lowered* quick-game yards from 5.60 to 2.58, because a deeper defender is a defender already
   standing in the running lane. Net effect on first downs: 3.6 → 3.4. Reverted.

**One change is kept on correctness grounds while being honest that it achieved nothing measurable.**
Throw error was a flat number of yards regardless of distance — the same ±1.5 yd scatter on a
four-yard flat and a forty-five-yard post. Error at release is angular, so it is now scaled by range
(×0.71 at 5 yd, ×1.0 at 14 yd, ×1.7 at 40 yd). Deep completion moved from 80 % to 81 %, which is
noise. It is in because it is right, not because it worked.

**One measurement bug of my own, worth recording.** The drive census first read down and distance
from the event stream and reported third-and-goal as **0 for 52**. A scoring play never emits a down
change — the match jumps straight to the score phase — so the reader carried the previous drive's
distance into the next one and mislabelled every play until something non-scoring happened. The real
number is **6 for 41**. The probe now reads match state at the snap. An instrument that lies is worse
than no instrument, and this one nearly sent the whole pass after a phantom.

### 12.6 Nobody gets behind a deep zone

The section above ended by calling the deep game the largest distortion left and saying the cause
looked like space rather than tuning. That was a guess, and a third instrument — `npm run deepprobe`,
plus a trace of separation against play time — replaced it with a cause.

On throws of 18 or more air yards, averaging 40.6 air yards and 2.1 seconds of flight, the receiver
had **7.9 yards of separation at the moment of release**. He was not getting open during the flight;
he was already gone before the ball left the hand. The trace says why:

| play time | receiver | nearest defender | that defender's turbo |
|---|---|---|---|
| 1.25 s | 13.7 yd/s | 9.7 yd/s | 78 |
| 2.00 s | 12.0 yd/s | 9.1 yd/s | 70 |
| 3.00 s | 9.9 yd/s | 10.6 yd/s | 60 |

A receiver sprinting at 13.5 yd/s, a defender running at 9.5, and **seventy percent of the
defender's meter unspent**. And the nearest defender to a deep receiver was a **zone** defender on
72 % of samples — which is why fixing man coverage in §12.3 was invisible at the batch level. It was
27 % of the problem.

A deep zone landmark in this playbook sits 22 to 34 yards past the line, and the defender was tied
to it for the whole play. A forty-yard route simply ran past him and kept going. **The landmark is
where he starts; the ceiling is what he defends.** A deep-zone defender now takes his depth from the
deepest route in his share of the width and stays on top of it, and — like man coverage — spends
turbo to get there rather than inferring from `pursue` that a point beside his own feet is not worth
sprinting to.

Measured over 120 games, against the same 120 games before this pass began:

| metric | before the pass | after §12.3 | after the deep-zone fix |
|---|---|---|---|
| first downs / team | 3.8 | 3.6 | **3.9** |
| pass yards / team | 194.9 | 197.0 | **181.0** |
| deep concept yd/play | 23.6 | 23.1 | **20.1** |
| separation at the catch, deep | 4.5 yd | 4.3 yd | **2.6 yd** |
| combined points | 52.4 | 53.0 | **49.1** |
| touchdowns | 7.4 | 7.5 | **6.8** |
| overtimes / 120 games | 6 | 6 | **12** |
| shutouts / 120 games | 6 | 2 | 4 |
| rules violations | 0 | 0 | **0** |

Every balance target holds: points 49.1 against a 44–60 band, sacks 6.6 against 4–9, interceptions
2.5 against 1.5–4, safeties 0.12 against ≤1, plays 60.6 against 55–70. Twelve of 120 games needed
overtime, against six before — the games got closer, which is the shape you want from taking the
easy explosive away rather than from clamping scoring directly.

### 12.7 Two more things the playbook said and the simulation never read

The pattern from §12.3 — authored intent that never reaches the simulation — turned out to have two
more instances, and between them they are the closest this pass got to its actual goal.

**The play caller believed things about its own game that were wrong by a factor of three.** Its
scoring function asks one question above all others: does this concept cover the distance? It
answered with a table that said a run was worth **9 yards** and a quick concept **10**, against
measured values of **3.3** and **3.6**. So it spent first down on runs, because nine yards is most
of your share of a thirty-yard chain, and then faced second and twenty-seven. First down gained 4.0
yards a play and converted 6 % while third down gained 11.8 and converted 25 % — exactly backwards.

The table now holds measured values, re-measurable with `npm run driveprobe`. The effect on
down-and-distance was immediate and is the single best result in this section:

| third down | before | after |
|---|---|---|
| and 1–8 | 7 % | **16 %** |
| and 9–16 | 3 % | 4 % |
| and 17–24 | 23 % | 28 % |
| and 25+ | 36 % | 26 % |

The inversion — short yardage being *harder* than long — was 5× at its worst and is now roughly
flat. First-down conversion went 6 % → 8 % on 6.03 yards a play.

**`blockDir` was authored on every run play, mirrored correctly by the loader, exposed in the play
editor — and read by nothing in the simulation.** Every run in the book specifies its scheme: down
block left, reach right, everybody wall to the strong side. None of it reached the field. Blockers
took the nearest man and shoved him straight backwards, which is a scrum, not a running play, and
the playbook contained no designed hole anywhere.

A blocker with a direction now works his man sideways as well as back. That lateral component *is*
the lane.

> designed runs **3.9 → 12.4 yd/play** in the run autopsy, runs losing yardage **24 % → 2 %**,
> 20-plus-yard runs **3 % → 15 %**

Both changes needed the caller's model re-tuned once the run actually worked — it is set at 7, which
sits between the run's median of 4 and its long tail. Left at 4 the caller stopped running
altogether and the game fell to 50.8 plays, under the 55 floor, with 23.5 rushing yards a team.

Final 200-game balance, every target in range:

| metric | before this pass | after |
|---|---|---|
| combined points | 52.4 | 51.4 |
| plays per game | 59.6 | 55.7 |
| first downs / team | 3.8 | **4.3** |
| rush yards / team | 43.1 | 38.1 |
| pass yards / team | 194.9 | 197.5 |
| touchdowns | 7.4 | 7.3 |
| interceptions | 2.4 | 2.6 |
| sacks | 6.9 | 5.8 |
| safeties | 0.17 | 0.20 |
| shutouts / 200 | — | 4 |
| rules violations | 0 | **0** |

Plays per game at 55.7 is inside the 55–70 band but close to its floor, and that is worth watching:
drives that score faster produce fewer snaps.

### 12.8 Sacked before the game let him look

Making the play caller honest (§12.7) had a side effect worth chasing: once it rated the quick game
accurately it almost stopped calling it — down to two snaps a game at 2.7 yards each with a **33 %
sack rate**. An honest caller declining a broken concept is correct behaviour and a bad outcome; a
third of the playbook was effectively out of the game.

The cause is a single line and it is not a tuning problem:

```
readyTick = max(0.35 s, primaryTick - reactionTicks)
```

The quarterback may not *consider* throwing before that landmark. On quick concepts the landmarks
sit at 1.05–1.45 s, so `readyTick` lands around 0.87–1.27 s. **The median sack on a quick concept
landed at 0.68 s.** On a third of those snaps he was on the ground before the code allowed him to
look at a receiver. Not beaten, not indecisive — gated.

Per play, the correlation is exact:

| play | primary read | sack rate |
|---|---|---|
| Pylon Dart | 1.05 s | 36 % |
| Quick Nails | 1.15 s | 50 % |
| Snap Hitch | 1.25 s | 8 % |
| Stick Trigger | 1.20 s | 0 % |
| Sprint Cannon | 1.45 s | 50 % |

A quarterback whose protection has already failed does not stand and wait for his primary to come
open. There is now a **hot read**: an unblocked rusher inside 3.6 yards overrides the timing
landmark entirely and he throws to the best man available, in a window he would never take with a
clean pocket.

> quick-concept sacks **33 % → 20 %** · earliest throw **0.88 s → 0.30 s**

The trade is real and shows in the batch: sacks fell from 5.8 a game to 4.3, which is inside the
4–9 band but near its floor, and combined points rose from 51.4 to 54.0. Roughly 2.2 sacks per team
per game is closer to real football than the 3.5 it replaced; whether it is right for *this* game is
a judgement, and it is recorded here as one rather than presented as a win.

The full-curve effect on down and distance, which is what this whole section was chasing:

| third down | at the start of §12 | now |
|---|---|---|
| and 1–8 | 7 % | **15 %** |
| and 9–16 | 3 % | **20 %** |
| and 17–24 | 23 % | 23 % |
| and 25+ | 36 % | 28 % |
| goal to go | 8 % | **18 %** |

The 5× inversion is gone and the curve is monotonic in the right direction for the first time,
though short yardage still converts worst rather than best.

### 12.9 Forward progress, and a probe that was measuring a strawman

**The ball was spotted wherever the carrier's body came to rest.** A tackle in this game blends the
tackler's momentum into the carrier — `car.vx = car.vx * 0.3 + d.vx * 0.35` — so a runner met
head-on is *actively driven backwards* before he goes down, and then spotted there. The offence was
being charged for being hit hard. Forward progress is a real rule and it was simply missing.

The rule now: the ball is spotted at the furthest point the carrier advanced it **since he was
first contacted**. That last clause is the whole rule, and getting it wrong is instructive — the
first version armed progress at the snap, which spotted every sack at the line of scrimmage and took
sacks out of the game entirely: **0.0 a game**, in a 200-game batch, from 4.3. Forward progress
protects a runner being *driven* back. It does not protect a passer who chose to retreat.

> third and 1–8 **15 % → 21 %** · goal to go **18 % → 24 %** · third down overall **23 % → 25 %**

**And the human probe was measuring a strawman.** After the coverage work, `a human offence moves
the ball` failed: 113 yards, 15 catches, **0 points** across a full game, down from 214 yards and 14
points. That looked like a serious regression in what the game feels like in a person's hands, and
it was worth being alarmed by.

It was the script. It pressed the *middle receiver button* on every snap of every concept, whatever
the play was — which worked when a deep zone was tied to a landmark and cover men never sprinted,
and stops working the moment coverage covers. Changing one thing about it — throw to the receiver
**the play itself names as its primary read**, which is the minimum a person with the diagram in
front of them does — in the same harness on the same seed:

| the same scripted human | yards | score | touchdowns |
|---|---|---|---|
| hammers the middle button | 113 | 0 | 0 |
| throws to the play's primary read | **271** | **21** | **3** |

That is the trade this whole pass was making, stated as a number for the first time: the game got
harder for a player who ignores it and no harder for one who uses it. It is now its own assertion —
`reading the play beats hammering one button` — so if coverage ever stops rewarding the read and
starts taxing everybody, a harness says so instead of a person noticing months later.

### 12.10 Saving the game you are actually in

`SIM-003` had sat as an N/A with the words "a real gap rather than an inapplicable test" written
next to it. Save covered settings, season and records — everything except the match you were in the
middle of — so quitting threw the game away.

It is now a feature and a PASS. **Pause → SAVE & QUIT**, and the main menu offers **CONTINUE MATCH**
with the score and the clock on the button, because "CONTINUE" on its own is a question. One slot,
cleared on resume, and never offered for a match that has already finished.

The interesting part is not the storage, it is what the determinism buys. A state snapshot can be
*verified*: snapshot, keep playing, and separately restore and play the same span — if the two event
streams are not identical, something is not being carried. They were not identical, twice:

1. **The previous tick's held-button mask, per athlete.** Press edges are derived as
   `held & ~prevHeld`, so an athlete restored with `prevHeld = 0` sees every button he is *already*
   holding as a brand-new press. It surfaced as a defender who was mid-dive-tackle at the save
   re-triggering the move on the first tick after the load.
2. **The special-teams formations.** They are built in `specialFormations.ts` and never offered to a
   player, so they are not in the playbook — and a snapshot taken during a field goal restored with
   every defender's assignment set to `null`. The players stood in the right places and did nothing.

Both were found by snapshotting at **four different points instead of one**. A snapshot between
plays carries almost nothing and round-trips trivially; the ones that find bugs land mid-play,
mid-flight and mid-kick. The first version of the unit test took one snapshot, landed between plays,
and passed — a green test proving nothing.

A restore into a different matchup is refused rather than attempted, because it would not throw: it
would write one team's positions and stats into another team's game and run perfectly, producing a
match that is quietly wrong.

**And a bug in the harness itself, which is the worse kind.** This line had been in the acceptance
matrix for as long as it has existed:

```js
rows.splice(rows.findIndex((r) => r.id === 'INP-002-note'), 1)
```

`findIndex` returns −1 when the row is absent — which is *every run with `--only`*, since the filter
drops that placeholder along with everything else — and `splice(-1, 1)` removes the **last** element.
Every filtered run had been silently deleting its own last result. It hid for as long as it did
precisely because the thing it deleted was never printed; it surfaced as SIM-003 appearing not to
exist while sitting in the file.

> Acceptance **42 pass / 0 fail / 19 N/A** · unit tests **222** · browser smoke **21/21**, including
> pause → save → menu → continue landing back in the same score, quarter and tick

### 12.11 What is still open

- **First downs are 4.3, not the 8–12 that would make the chain a pulse.** Up from 3.8, having gone
  the wrong way twice on the road there, but drives still average 3.1 plays and still score too
  often for a chain to come up. Better, not solved.
- **Third and 9–16 converts 4 %** — a hole in the middle of the distance curve that neither the
  quick game nor the deep shot covers. Short yardage and long yardage both work now; the middle
  does not.
- **Goal-to-go on third down converts 6 %.** The end zone is a hard ceiling behind the defence and
  nothing in the playbook is built for that specific problem.
- **Plays per game is 55.7 against a 55 floor.** In band, with no margin.
- **The quick game still only gains 2.2 yards a play on 2 calls a game.** The hot read took its sack
  rate from 33 % to 20 % but did not make the concept gain, and the caller still rarely picks it. A
  whole concept family effectively out of the game.
- **Third and short still converts worst**, at about 14–21 % against 31 % on third and long. The 5×
  inversion is gone and forward progress narrowed it further, but in football third-and-1 should be
  the easiest down there is, and here it is not.
- **Screens measure −0.18 yards a play** on half a call a game. The concept is broken and the play
  caller, now that it rates honestly, has stopped calling it — the same failure the quick game has.
- **Sacks are 4.3 a game against a 4–9 band.** The hot read bought the quick game's life with sack
  pressure and the margin is now thin.
- **Runs still lose yardage on roughly a quarter of carries** even with all seven blockers working,
  and designed-run yards fell to 3.26/play once zone defenders started sprinting — coverage that
  runs also arrives in run support faster.
- **`npm run driveprobe`'s completion percentage excludes interceptions**, so its per-concept comp%
  reads high; `deepprobe` counts them and is the number to trust for passing outcomes. Recorded
  rather than quietly fixed because the earlier figures in this section were read off it.

---

## 13. WHAT WAS RUN TO PRODUCE THIS

> **The capture set is not in the repository.** Screenshots referenced throughout this report live
> in `docs/captures/` and are regenerated by `npm run capture` (whole set) or `npm run shot`
> (single frame). They were tracked for a while and it cost **736 MB of history across 30
> commits** — PNGs do not delta-compress, so every re-capture of a 4 MB image is another 4 MB in
> the pack forever. Stripped from history, the same repository is **31 MB**. Anything in this
> report that says "visible in the captures" means run the command, not open a file you were
> handed.


```bash
npm install
npm run typecheck        # clean
npm test                 # 214 / 214
npm run scenarios        # 24 / 24
npm run replay           # 12 / 12
npm run human            # 17 / 17  scripted human on the sticks, §9
npm run sim -- --games 200 --invariants
npm run perf:sim
npm run build
npm run smoke            # 19 / 19
npm run perf
npm run smoothness       # motion quality, §6
npm run footslip         # do planted feet grip the turf, §9
npm run fieldpos         # drive starts, kick returns and every safety, §10
npm run acceptance       # the 61-test matrix, §12
npm run driveprobe       # yards and conversions by concept, down and distance, §12
npm run runprobe         # run-game autopsy: blockers, first contact, gain shape, §12
npm run passprobe        # what happens to every forward pass, §12
npm run pacing           # frame pacing, §6
npm run poses            # one frame per animation state, §9
npm run gait             # one stride, frame by frame, §9
npm run capture          # visual review set
npm run shot -- --phase LIVE --live 0.9   # single frame, with motion, §7
npm run artifact         # one self-contained HTML file, §8
npm run artifact:check   # boots and plays that file in a sandboxed iframe, §8
```

---

## 14. KNOWN LIMITATIONS AND UNVERIFIED CLAIMS

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
6. ~~**Safeties are still too common**~~ — **fixed in §10; now 0.12 a game.** The explanation that
   stood in this slot for two milestones was wrong. It blamed field compression; the real cause was
   four stacked faults in the kick-return code, and 94% of the safeties were kick returners rather
   than pinned offences. Left visible rather than deleted, because a confident wrong diagnosis
   surviving two rounds of review is the more useful thing to remember. What it used to say: the
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
15. **Foot slip during a cut is unsolved.** Planted feet grip the turf while an athlete runs
    straight (1.19 yd/s, §9) but skate during a hard change of direction (11.0 yd/s at the 95th
    percentile), because the stride is solved in the athlete's own frame and a cutting athlete is
    travelling somewhere other than where he is facing. Measured, reported, not fixed.
16. **The nineteen animation states were reviewed as still frames, not in motion.** `npm run poses`
    renders one instant of each. The one-shot poses — dive, tackle, get-up, kick — were checked at a
    single point in their timeline, so their *timing* is unverified even though their shapes are
    now right.
