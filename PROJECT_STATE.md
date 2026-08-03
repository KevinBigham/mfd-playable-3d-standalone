# PROJECT STATE

**Game:** GRIDIRON OVERDRIVE · **League:** United Gridiron Circuit (16 clubs, 2 conferences)

---

## CURRENT MILESTONE

**M17 — the athletes were seven feet tall.** The brief was "make the players look a lot more
athletic and realistic". Measuring instead of eyeballing inverted the expected answer: the
animation was in reasonable shape and the **anatomy** was not. Every athlete rendered between
7ft 2 and 7ft 5, carried an eighteen-inch head byte-identical on all sixteen rosters, and stood
**4.7 heads tall** with legs at 31 % of him against a real 47 %. None of it was a style decision —
`height` said 2.01 yd and the bone chain quietly added 18 % nothing accounted for.

Rebuilt in six stages, all inside `src/render` and `src/ui`: every vertical landmark is now a
fraction of stature (**6.00 heads**, hip 0.52, shoulder 0.80, leg 0.47, soles actually on the
turf); limbs and torso are lofted tubes with real profiles instead of rounded boxes, which is
**1 900 triangles cheaper per athlete at HIGH**; joints are smooth-skinned; ambient occlusion is
baked into the vertex colours at build time at zero runtime cost; the ball is drawn in the
carrier's hands instead of floating at his navel; and `build` drives five physique axes instead of
one uniform scale, so a receiver is a long-limbed V (pads 1.8× his waist) and a tackle is deep and
low-slung (1.0×).

Two latent bugs fell out: `mergeGeometries` copied only the first of four skin influences, and the
skeleton was built after the geometry so three.js captured identity bind inverses — together the
reason smooth skinning could not simply be switched on. Two *probes* were also wrong, both from
hardcoding a constant the implementation owned: `footslip` classified planted feet against the old
rig's sole height, and `touchprobe` compared the receiver badge against the height the UI drew it
at. Both now measure the outcome instead of restating the code.

Foot slip improved rather than regressing: median 1.16 → **0.672 yd/s**, 29 % → **16 %** of ground
speed. Determinism, 222 unit tests, 24 scenarios, 24 touch checks, 42/0 acceptance and simulation
smoothness are all unchanged — the last verified by running the tool in a clean worktree at the
pre-pass commit and diffing every row. New instruments: `npm run anthro` and `npm run roster`.
Full write-up in QA_REPORT §13.

**M16 — it plays on a phone.** A full touch control layer: a floating left-thumb stick with a
turbo ring, a snap button, tappable receiver badges, and **drag off a badge to place the ball** —
the one control with real depth, and why the phone version is not a lesser one. Menus and
play-call reworked for thumbs, a portrait rotate gate that stops the clock, and `npm run touch` as
the regression harness. Published to GitHub Pages from the artifact build so the playable link can
never serve last week's game.

**M15 — the move economy, the bobble, and the deep zone.** Added the juke, ball protection and the
bobble (a juggled or batted pass that stays live in the air but is still legally a forward pass, so
the ground ends it as incomplete and never as a fumble). Five mechanism-level bugs found by building
four new instruments: only three of seven players could block, the quarterback's drop depth was a
string match on the formation name, man coverage never spent turbo, `down.change` was declared and
handled but emitted by nobody — and, the big one, **a deep zone defender was tied to his landmark
for the whole play**, so a forty-yard route ran past him and kept going. A deep receiver had 7.9
yards of separation at the release while his nearest defender jogged at 9.5 yd/s with 70 % of his
meter unspent. A deep zone now defends a ceiling, not a post.

Then two more instances of the same pattern — authored intent the simulation never read. The play
caller's model of what each concept gains said a run was worth 9 yards and a quick concept 10,
against measured 3.3 and 3.6, so it spent first down on runs and faced second and twenty-seven. And
`blockDir` — the blocking scheme on every run play, mirrored by the loader and editable in the play
editor — was read by nothing, so the playbook contained no designed hole anywhere. Both fixed:
third-and-short conversion went 7 % → 16 % while third-and-long went 36 % → 26 %, closing an
inversion that had short yardage 5× harder than long.

And one more gate: `readyTick` forbade the quarterback from *considering* a throw before the play's
timing landmark, which on quick concepts lands around 0.9–1.3 s — while the median sack on those
concepts landed at **0.68 s**. On a third of quick snaps he was on the ground before the code let
him look at a receiver. There is a hot read now: immediate pressure overrides the landmark.

And finally forward progress, which the game did not have: the ball was spotted wherever the
carrier's body came to rest, and a tackle blends the tackler's momentum into the carrier, so a
runner met head-on was driven backwards and then charged for it. Progress is armed at first contact
— arming it at the snap spotted every sack at the line and took sacks out of the game entirely, 0.0
a game in a 200-game batch.

Over 200 games: first downs 3.8 → 4.4, combined points 52.4 → 54.2, plays 59.6 → 55.6, sacks
6.9 → 4.1, interceptions 2.4 → 2.9, rules violations 0 → 0. Third-down conversion by distance went
from a 5× inversion (7 % short, 36 % long) to roughly flat, and goal-to-go from 8 % to 19-24 %.
Every balance target in range, two of them on their floor and flagged as such. The milestone's
headline goal — a chain with a pulse — is **improved, not met**: drives still average about 3
plays. Three other hypotheses were tested and rejected along the way (QA_REPORT.md §12).

The human probe caught a cost, and then caught me over-reading it. After the coverage work a
scripted human gained 113 yards and scored nothing on one seed, down from 214 and 14; switching him
to throw at each play's named primary read produced 271 and 21 on that same seed, which I wrote up
as "harder only for players who ignore the game". Over ten seeds per arm it is not true — reading
the read gains 205 yards and 10.2 points a game against 223 and 11.1 for hammering the middle
button. The human offence really is weaker than it was, and there is no evidence that skill recovers
it. The false assertion is gone; the comparison is kept as a printed measurement.

**M14 — one button, two actions.** Reported from play as "the ball starts with the WR on Ripcord
Mesh". ACTION snaps the ball and ACTION throws it, and both were resolving in the same tick, so the
pass left the quarterback's hand at playTicks=0 — before the play had run a frame. Eleven of the
twenty-seven offensive plays were affected; the run formations pitched instead of threw.

**M13 — special teams, and the safety that was never a safety.** The 2.96 safeties a game that had
sat in the limitations list for two milestones were not a balance problem at all: 94% of them were
kick returners, and four stacked faults in the kick-return code were producing them. Now 0.12 a
game, with kickoff and punt returns that gain yards instead of losing them.

**M12 — the first bug round from real play.** A player picked the game up and found five faults in
minutes that two hundred CPU-vs-CPU games never touched: control assignment at the snap and on
kickoffs, a leftover button snapping the ball, unrestricted pre-snap movement (which also silently
disabled passing), and the animation. All five are fixed and all five now have a regression check.
The animation was rebuilt — the pose file had its rotation signs inverted almost everywhere.

**M11 — playable artifact.** The whole game folded into one self-contained HTML file.

**M10 — graphics.** M9 was motion polish; M10 rebuilt how the game is lit and shaded.

**M9 — motion polish.** M0–M8 are complete: the deterministic core, a full match, the playbook,
AI, local multiplayer, presentation, every mode, and the hardening pass. M9 was a dedicated pass on
how the game *moves*, measured by two new harnesses rather than asserted.

## COMPLETED SYSTEMS

| Area | State |
|---|---|
| Fixed-timestep loop, seeded RNG, typed event bus | done |
| Mid-match snapshot: pause → save & quit → continue, verified by event-stream equality | done |
| Canonical rules engine + match state machine + watchdogs | done |
| Simulation: movement, turbo, special moves, blocking, tackling, catching, kicking, laterals | done |
| Ball authority (single mutator, per-tick invariant) | done |
| Playbook: 27 offensive plays / 3 pages, 14 defensive calls, SVG diagrams | done |
| AI: play caller, quarterback reads, coverage, rush, pursuit, 4 difficulties | done |
| Input abstraction: keyboard ×2, gamepads, remapping, 4 seats | done |
| League data: 16 teams, rosters, procedural SVG logos, 18 venues | done |
| Procedural audio: engine, synth voices, crowd bed, 40+ cues, director, stingers | done |
| Rendering: skinned procedural athletes, procedural poses, broadcast camera, effects, props | done |
| Environment: field, stadium, crowd, sky, lighting, weather | done |
| Interface: title, menu, players, team select, setup, HUD, play select, pause, settings, controls, final, credits | done |
| Modes: Quick Play, Tournament, Season, Practice, Play Editor | done |
| Persistence: settings, season, tournament, custom plays, records | done |
| Harness: unit tests, purity tests, scenarios, batch sim, determinism, smoke, capture, perf | done |
| Motion: ground-locked stride, state hysteresis, pose cross-fade, lean/bank, eased camera | done |
| Frame pacing, adaptive resolution, shader prewarm, goalpost occlusion fade | done |
| Harness: motion-quality metrics (`smoothness`), frame-pacing metrics (`pacing`) | done |
| Harness: scripted human on the sticks (`human`), planted-foot slip (`footslip`) | done |
| Harness: per-state pose contact sheet (`poses`), stride contact sheet (`gait`) | done |
| Harness: field-position economy and safety forensics (`fieldpos`) | done |
| Special teams: kick-duty AI dispatch, gunners, coverage lanes, hang/coverage pairing | done |
| Animation: solved run cycle with contact-point foot planting, pose families, ground pass | done |
| Single-file artifact build + sandboxed-iframe verification | done |
| Per-vertex surface shading, venue environment map, rim light | done |
| Post chain: HDR + MSAA target, two-level bloom, ACES, per-venue grade, vignette, aberration | done |
| Turf: analytic mow bands, procedural micro-normal, wear, weather response, paint sheen | done |
| Athletes: jersey numbers, facemasks, pads, cleats, per-athlete variation | done |
| Effects: carrier trails, ballistic spray, shock rings, ball trail, Overdrive embers | done |

## MEASUREMENTS (latest)

Full detail in QA_REPORT.md. Headline numbers:

- 200-game CPU-vs-CPU batch: 100 % completion, **0 rules violations**, **0 watchdog trips**.
- 53.3 combined points, 54.7 plays, 7.7 touchdowns, 2.8 interceptions, 4.6 first downs per team.
- Home/away split 26.9 / 26.5 across the batch — no directional bias. 7 of 200 needed overtime.
- 256 ms to simulate a full game headless.
- Two targets missed and stated as misses: first downs (4.6 against 8-12 wanted) and plays per game
  (54.7 against a 55 floor). Both are the same unsolved problem — drives end too soon.
- Scripted human on the sticks: 19/19 checks, 271 yards and 21 points reading the play.
- Every balance target in range except first downs, which is stated as a miss rather than omitted.
- Browser smoke: **19/19**. Unit tests **214/214**. Scene at HIGH: **40 draw calls, 210 k
  triangles** against a 180 / 420 k budget — the whole graphics pass cost one draw call.
  Scenarios **24/24**. Determinism **12/12**.
- Motion: animation churn **−44 %**, run/sprint flips **−52 %**, heading jerk **−20 %**, worst
  single-tick positional correction **−22 %**, foot-slide structurally eliminated.
- Frame pacing: apparent-speed jitter cut **3–7×** across eight display models, clock drift ≤30 ms
  in 30 s.
- Deterministic: identical seed ⇒ identical event log, verified three ways.
- One balance target missed: **2.73 safeties a game** against a ≤1 target. Documented in
  QA_REPORT.md §8 rather than hidden.

## IMPORTANT DECISIONS

1. **The simulation never imports three.js or touches the DOM.** Enforced by a test. This is what
   makes headless batch simulation, scenario tests and fixed-seed replay possible at all.
2. **AI produces the same `PlayerIntent` struct as a human.** No private AI physics, no hidden stat
   inflation; difficulty is only reaction time, error, discipline and decision quality.
3. **One module mutates ball state.** Everything else calls `giveBall` / `releasePass` /
   `dropLoose` / `killBall`, and an invariant runs every tick under test.
4. **Playbook slots are bound to roster people by role, not by index.** The two files order their
   seven slots differently on purpose; `bindRoster` is the seam.
5. **Teams keep their attacking direction except at halftime.** Camera and local-multiplayer
   orientation stability is worth more here than the real-football convention.
6. **Overtime always resolves.** Up to three timed periods, then sudden death.
7. **Comeback assist is bounded to ±6 % on pursuit and pressure only**, documented, and switchable.
8. **Extra points are resolved by the conversion path, never by the field-goal path.** They used to
   share it, which quietly scored 3 points for every PAT.
9. **A safety requires the carrier to be DOWN and his team to have had the ball.** Possession gained
   inside your own end zone — a kick returner, an interception on a goal-line throw — is a
   touchback. Getting this wrong paid two points to the team that threw the pick.
10. **Formations are clamped to the field.** Nobody lines up behind his own goal line, so a shotgun
    snap or a punt from your own 1 is not an automatic safety.
11. **Surface description lives in the geometry, not in the material.** One skinned mesh per
    athlete means one material for the whole body; per-vertex roughness/metalness/rim is what lets
    a helmet and a sleeve shade differently inside a single draw call.
12. **Tone mapping belongs to whoever writes the final pixel.** With the post chain on that is the
    composite; leaving it on the renderer as well clamps the scene before the bright pass sees it.
13. **The venue owns the playing surface.** It used to be hardcoded to grass in the match, so
    twelve of eighteen grounds neither looked nor played like themselves.
14. **Key presses are latched on the event, not sampled on the frame.** A tap that began and ended
    between two polls used to vanish entirely.
15. **Every browser tool builds before it serves.** They serve `dist/`; three work streams lost an
    iteration each to measuring the previous build.
16. **A capability that exists may still be forbidden.** `navigator.getGamepads()` throws a
    SecurityError under a restrictive permissions policy, and `localStorage` throws on access in
    a sandboxed frame. Both were guarded by existence checks, and both failed. Probe by USING the
    capability, inside a try/catch, and remember the answer.
17. **Saved data falls back to memory when storage is refused.** A sandboxed frame throws on
    `localStorage` ACCESS, not on lookup, so the probe has to be a real write. Giving up entirely
    — which is what it used to do — meant settings were forgotten within a single session.
18. **The kick meter is edge-triggered and arms on release.** The snap and the kick share a button;
    accepting the held button made every human field goal fire instantly at 22 % power.
12. **Gait is driven by ground covered, not by velocity.** Shoves, pile separation and sideline
    clamps move a body without touching its velocity, so a velocity-driven run cycle showed a
    defender strolling while he slid several yards a second. Reading the position delta fixes it
    with zero gameplay effect — an earlier attempt that pushed the block shove through velocity
    instead cost 2.8 sacks a game and was reverted.
13. **Phases that do not run a simulation step still run an animation step.** Otherwise `prevX`
    goes stale while the renderer keeps sweeping `alpha`, and the whole field sawtooths above
    60 Hz — and a touchdown is celebrated by fourteen statues.
14. **The frame pacer distinguishes cadence changes from timestamp noise.** Averaging a genuinely
    dropped frame smears it across the next four and is worse than the problem being solved.
15. **A test suite that never presses a button cannot test what pressing a button does.** Two
    hundred clean CPU-vs-CPU games coexisted with five faults a person hit in his first minutes.
    `npm run human` scripts a player onto the sticks; it is now the first thing to run after any
    change to control, phase or input handling.
16. **Which athlete a seat drives must key off who has the BALL, not `world.possession`.** During a
    kickoff `possession` names the kicking team for the whole play, so a human receiving the kick
    was handed a coverage defender and never the returner.
17. **A button that both selects and acts needs an arm-on-release edge, and the request must be
    latched.** ACTION picks the play and snaps the ball; reading it as held snapped instantly, and
    the first fix then had the fresh press eaten by the pre-snap settle window.
18. **Rotation sign conventions have to be written down.** A bone's child hangs at −Y for a limb and
    +Y for the spine, so positive X bends a knee one way and a back the other. Getting it backwards
    is invisible in review and shows up on screen only as "the animation looks awkward".
19. **What a run cycle must hold still is the sole, not the ankle.** And a flat sole cannot roll:
    migrating the contact reference from heel to toe scrubs the shoe against the turf at exactly
    the rate it migrates. One fixed contact point at the ball of the foot is stationary by
    construction.
20. **Do not cross-fade between two states that are the same pose at different amplitudes.** RUN and
    SPRINT flip about twice a second per athlete; fading froze the legs for half a stride each time.
21. **On a kick play, "offence" and "defence" mean nothing.** The kicking team has possession and
    is therefore the offence, so kick duties must be dispatched BEFORE that split — otherwise the
    cover team runs pass protection while the ball sails over its head.
22. **A dive is a committed move that ends with the diver on the ground.** Only dive on a loose
    ball somebody else can also reach. Diving on an uncontested one spends the whole rest of the
    play to gain nothing — it is how the kick returner spent two years tackling himself.
23. **Hang time and whether coverage sprints are ONE dial.** Set either alone and the kickoff is
    broken: jogging coverage under a short kick means every return scores, sprinting coverage
    under a long one means none ever does.
24. **An aggregate cannot diagnose anything.** "2.96 safeties a game" was blamed on field
    compression for two milestones. One distribution — who conceded them, on what play, from
    where — answered it in a single run.
25. **A test whose name does not match its assertion is worse than no test.** `dead ball never
    scores` ticked six seconds and compared the score; six seconds contains two more snaps.
26. **When one button does two things, the first one must CONSUME the press.** ACTION snaps and
    ACTION throws; both resolved in the same tick and the ball left at playTicks=0.
27. **`applyActions` runs during PRE-SNAP too.** Anything that touches the ball has to check for a
    live one, not just assume it. Gating the throw alone simply moved the bug to the lateral.
28. **A harness that always releases a button has never tested a thumb.** Every snap check let go
    of ACTION before doing anything else, which is why 17/17 coexisted with this.
29. **When a check breaks after a fix, ask whether it was passing for the right reason.** "A human
    offence scores" had been passing because the scripted human was exploiting the bug.
30. **A test that cannot fail is decoration.** `RUN-004` compared 0.11 yd/s against 0.00 — both arms
    measured after the play had ended — and reported a pass before the feature it tested existed.
    Every A/B needs a floor on its control arm.
31. **Byte-identical output after a change means the branch is unreachable, not that the change is
    subtle.** Twice now. Delete the change rather than leaving a no-op in the tree.
32. **An instrument that lies is worse than none.** The drive census read down-and-distance from the
    event stream and reported third-and-goal as 0 for 52; scoring plays never emit a down change, so
    it carried stale distance across drives. The real number was 6 for 41. Read state, not events,
    for anything a score can interrupt.
33. **Tune against a sample big enough to hold still.** Three coverage thresholds looked decisively
    different over 20 games and were indistinguishable over 120.
34. **A capability gate written as a role check will silently delete a whole system.** `role !==
    'LINE'` meant that in a seven-man game exactly three players could block, so every lead blocker
    in the playbook ran to a patch of grass and stood on it. Ask what a player is DOING, not what he
    is called.
35. **Naming a play after its formation is not naming it after its job.** A three-step slant concept
    out of a formation called SPREAD got a five-and-a-half yard drop, and the quick game took a sack
    on 22 % of its snaps as a result.
36. **Grep every authored field for a consumer.** Three separate systems in this codebase were data
    with no reader: `blockDir` (every run play's blocking scheme), the `BLOCK` route action outside
    the offensive line, and the `down.change` event. All three were authored, mirrored, tested and
    exposed in the editor. None of them reached the field.
37. **An AI that believes false things about its own game cannot be tuned, only compensated for.**
    The play caller rated a run at 9 yards against a measured 3.3 and spent first down on it. Fix
    the belief, then tune.
38. **Screenshots do not belong in git.** PNGs do not delta-compress: 30 commits of a regenerable
    capture set cost 736 MB of history for a repo whose source is under 2 MB.
39. **A rule needs its precondition, not just its effect.** Forward progress spotted at the furthest
    advance is correct; forward progress armed at the SNAP spotted every sack at the line and took
    sacks from 4.3 a game to 0.0. It protects a runner being driven back, not a passer retreating.
40. **When a harness fails after a change, ask what the harness is a model OF.** The scripted human
    hammered one receiver button on every concept — not "a player", but the one player the change
    was supposed to stop rewarding.
41. **One seed is not a measurement.** The same scripted human gained between 107 and 353 yards
    across six seeds. A threshold set just under a single observed value is an over-fit that fails
    on the next commit, and a CONCLUSION drawn from a single seed is worse: "reading the play beats
    hammering one button" survived exactly as long as it took to run ten seeds per arm, and then
    turned out to point the other way.
42. **A design claim you want to be true is the one to measure hardest.** Ten minutes of measurement
    turned a headline result into a retraction, and the retraction is the more useful artefact.
43. **`array.map(fn)` passes the INDEX as the second argument.** `seeds.map(playAGame)` quietly ran
    games two and three of the control arm in the wrong mode. Only the typechecker caught it; the
    numbers just looked like variance.

## ACTIVE BLOCKERS

None.

## KNOWN LIMITATIONS

- Ball placement on touch is measured by `npm run touch` but **unverified against a human** — nobody
  has played a full game with a thumb and reported back.
- No online multiplayer, by design.
- Frame-time figures produced in this repository's container are software-rendered (no GPU
  available), so they are a worst case; draw calls, triangles and memory are hardware-independent.
  Frames arrive roughly 2.4 s apart here, so camera smoothness and adaptive resolution could not be
  measured in-browser; the frame pacer is measured directly instead (QA_REPORT.md §6).
- Score variance is genuinely high: a mirror match (identical teams) still averages a ~15-point
  margin, and roughly a quarter of matches finish 28+ apart. That is the nature of ~10 scoring
  drives a game; comeback assist bounds it rather than removing it.
- The crowd is instanced billboards; it reads as a crowd, not as individuals.
- Instant replay covers scores and turnovers only, not arbitrary rewind.
- Mid-match save is a single slot with no manual slot management, and it is cleared the moment the
  game is resumed. That is deliberate — it is "put the controller down", not a save-state library —
  but it means there is no way to keep two games going at once.
- Planted feet still slip about a yard a second even running straight, and about 2.3 yd/s on
  average. The swing plane now follows the path rather than the chest, which took 15 % off the mean
  (QA_REPORT.md §12.11); the rest is structural — stride length is derived from smoothed ground
  speed, so a cadence mismatch scrubs the shoe. Removing it needs world-space foot placement and a
  leg solved to reach it, which is a different architecture for the pose layer.
- **First downs are rare at 2.3 per team per game** — 4.6 across both teams, over 200 games at
  PRO on 2:00 quarters. This entry used to read "4.3 per team". It was wrong: `simulateBatch`
  summed both teams into `avgFirstDowns` and divided by games only, one line above the passing
  and rushing yards that *do* divide by two, and the combined figure was quoted here as a
  per-team one. The field is now `avgFirstDownsBothTeams` / `avgFirstDownsPerTeam` and
  `tools/sim.ts` prints the unit next to every number. **The problem is twice as bad as this
  document claimed for the whole of M15.** The sweep numbers below are on the old scale and are
  believed to be combined too; re-measure before trusting them.
  Not the chain — `FIRST_DOWN_YARDS` was swept at 30 / 24 / 20 and first downs measured
  3.6 / 3.6 / 3.4, i.e. shortening it slightly *hurt*. Drives end before the chain is in
  question: 16.9 a game, 3.14 plays each, and 13.6 of them end in a touchdown, a turnover or a
  safety. Roughly 80 % of drives never reach a chain decision at all, which is why moving the
  marker does nothing. Improved twice in M15, not solved.
- Third and short still converts worst (15 % against 28 % on third and long). The 5× inversion is
  gone and the curve is monotonic, but in football third-and-1 should be the easiest down there is.
- Ball placement on a human throw is shipped **unverified**: the stick that places the ball is the
  stick that moves the quarterback, so no script can measure it honestly (QA_REPORT.md §12.12). It
  cannot affect CPU-versus-CPU play — the AI passes no placement — but whether it feels good needs
  a person with a controller.
- Nothing the player decides about a throw measurably changes the outcome: over 20 games per arm,
  reading the play, choosing the throw type and hammering one button all landed within noise of
  each other. That is a skill-expression gap, not a difficulty setting.
- Screens still measure about zero on half a call a game. The quick game recovered to 6.2 yd/play
  once BLOCK-node holds started expiring, but screens did not, and the sample is small enough
  (about 19 plays over 24 games) that the number is not yet trustworthy either way.
- Plays per game is 54.7 against a 55 floor — out of band. It fell from 59.6 over the course of M15:
  every fix that made the offence better made drives end sooner. Sacks at 4.1 sit on their floor of
  4 for a different and deliberate reason (the hot read).

## COMMANDS

```
npm install        npm run dev        npm run build      npm run preview
npm run typecheck  npm test           npm run scenarios  npm run replay
npm run sim        npm run sim:batch  npm run invariants
npm run smoke      npm run capture    npm run perf       npm run qa
npm run smoothness npm run pacing     npm run perf:sim
npm run artifact   npm run artifact:check
npm run acceptance npm run driveprobe npm run runprobe   npm run passprobe
npm run human      npm run fieldpos   npm run footslip   npm run poses
npm run gait       npm run touch      npm run anthro     npm run roster
```
