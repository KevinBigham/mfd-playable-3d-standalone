# GRIDIRON OVERDRIVE — ARCHITECTURE

This document is the **shared contract**. Every agent reads it before touching code. Where this
document and code disagree, this document wins and the code gets fixed.

---

## 0. THE ONE RULE

**`src/sim`, `src/rules`, `src/plays`, `src/ai`, `src/core`, `src/data` MUST NOT import `three`,
touch `window`, `document`, `performance`, `localStorage`, `Math.random`, or `Date.now`.**

They are pure, deterministic TypeScript that runs identically in Node and the browser. This is what
makes headless CPU-vs-CPU batch simulation, scenario tests, and fixed-seed replay possible. The
renderer *reads* simulation state; it never writes it.

Enforcement: `npm run test` includes `tests/purity.test.ts`, which greps those directories for
banned identifiers. Breaking the rule fails CI.

---

## 1. LAYERS

```
                       ┌──────────────────────────────────────┐
   deterministic       │  core   data   rules   plays   sim    │   pure TS, no DOM, no three
   (Node + browser)    │                 ai                   │   fixed 60 Hz timestep
                       └───────────────┬──────────────────────┘
                                       │  reads state, receives events
                       ┌───────────────┴──────────────────────┐
   presentation        │  render (three)   audio (WebAudio)   │   variable framerate
   (browser only)      │  ui (DOM/CSS)     input (KB/Gamepad) │   writes only via IntentBuffer
                       └───────────────┬──────────────────────┘
                       ┌───────────────┴──────────────────────┐
   shell               │  modes   persistence   app/Game.ts   │
                       └──────────────────────────────────────┘
```

Data flow per frame:

```
Input devices ──▶ InputManager ──▶ PlayerIntent[4]  (pure data struct)
                                        │
   render loop (rAF, variable dt) ──────┼──▶ Match.step(dt)  ──▶ accumulator
                                        │        └─ while(acc >= 1/60) tick(FIXED_DT)
                                        │              ├─ sim.update()
                                        │              ├─ rules.evaluate()
                                        │              └─ events.emit(...)
                                        ▼
                              Renderer.sync(world, alpha)   ← interpolates prev/next transforms
                              AudioEngine.consume(events)
                              Hud.sync(matchState)
```

---

## 2. FIXED TIMESTEP

- `FIXED_DT = 1/60` s. Simulation only ever advances in whole ticks.
- Max 5 catch-up ticks per frame (`MAX_SUBSTEPS`), then time is dropped — never spiral.
- Rendering interpolates between `prevTransform` and `transform` using `alpha`.
- The frame delta reaching the accumulator comes from `FramePacer` (`src/app/framePacer.ts`),
  which averages it, snaps it to a whole number of steps when it is close to one, and banks the
  difference so the match clock stays true to the wall clock. It has no dependencies beyond
  `FIXED_DT`, which is what makes it directly testable (`tests/framePacer.test.ts`,
  `npm run pacing`).
- **Every match phase advances the world.** Phases whose handler does not call `stepPlay` call
  `idleStep` instead. A phase that leaves the world untouched leaves `prev*` stale while `alpha`
  keeps sweeping, and the whole field sawtooths at any refresh above 60 Hz.
- `world.tick` is a monotonically increasing integer. All timers are expressed in **ticks**, not
  seconds, inside sim code. Seconds only appear at authoring boundaries (`s(0.4)` helper).

## 3. DETERMINISTIC RANDOMNESS

- `src/core/rng.ts` exports `Rng` (xoshiro128\*\*). Never `Math.random()` in deterministic layers.
- One `Rng` lives on the match (`match.rng`), seeded from `MatchConfig.seed`.
- Presentation may use its own `Rng` instance for cosmetics (`visualRng`), seeded from the match seed
  so captures reproduce, but its consumption must never feed back into sim.
- Any new random draw goes through `match.rng` so replays stay bit-identical.

## 4. DIRECTORY OWNERSHIP

One owner per directory. Agents write only inside directories they own; everything else is read-only
to them. Cross-directory needs are expressed as a request to the lead.

| Directory | Owner | Contents |
|---|---|---|
| `src/core` | lead | rng, event bus, math, pools, ids, fixed loop |
| `src/data` | league agent | teams, rosters, name banks, logo generators, stadium defs |
| `src/rules` | lead | canonical rules engine + match FSM + clock + scoring |
| `src/sim` | lead | world, athletes, ball, movement, contact, catch, blocking, kicking |
| `src/plays` | playbook agent | play types + 27 offensive + 12+ defensive + route DSL |
| `src/ai` | lead | play caller, offense AI, defense AI, difficulty |
| `src/input` | lead | actions, bindings, keyboard, gamepad, seat assignment |
| `src/render` | render agents (split by file, see §12) | three.js scene, meshes, camera, effects |
| `src/audio` | audio agent | Web Audio synthesis, mixer, event→sound mapping |
| `src/ui` | ui agent | DOM screens, HUD, play-select, settings |
| `src/modes` | modes agent | quickplay, tournament, season, practice, play editor |
| `src/persistence` | modes agent | localStorage schema + migration |
| `src/testing` | qa agent | invariants, scenario definitions, headless runner |
| `tools/` | qa agent | CLI entry points |

## 5. SHARED TYPES

All cross-subsystem types live in `src/core/types.ts`. They are **data only** — no methods, no
classes, no imports. Adding a field is fine; changing the meaning of one requires updating this doc.

Key identities:

```ts
type TeamSide = 0 | 1;          // 0 = HOME (drives toward +Z), 1 = AWAY (drives toward -Z)
type AthleteId = number;        // index into world.athletes, stable for the match
type SeatId = 0 | 1 | 2 | 3;    // local human seat
```

## 6. COORDINATE SYSTEM & UNITS

- Units are **yards** and **seconds**. Masses are abstract (1.0 = average athlete).
- `x` = across the field. Sidelines at `x = ±HALF_WIDTH` (`HALF_WIDTH = 26.665`).
- `z` = along the field. **Home goal line `z = 0`, away goal line `z = 100`.**
  Home end zone occupies `z ∈ [-10, 0]`, away end zone `z ∈ [100, 110]`.
- `y` = up. Ground is `y = 0`.
- HOME scores by carrying the ball to `z >= 100`. AWAY scores at `z <= 0`.
- `dirOf(side) = side === 0 ? +1 : -1` — the direction that side advances.
- Three.js maps this 1:1 (`x → x`, `y → y`, `z → z`). No conversion layer, no scaling.

Speeds (yards/sec) — arcade-compressed, ~1.4× real football:

| | base | turbo |
|---|---|---|
| skill athlete | 9.4 | 13.6 |
| lineman | 7.6 | 10.4 |

## 7. EVENT VOCABULARY

`src/core/events.ts` exports a typed emitter. Sim emits; presentation consumes. Events are
**facts about what happened**, never commands. Full union in `src/core/types.ts` (`GameEvent`).

```
snap  handoff  throw  pass.arrive  catch  drop  swat  interception  lateral  fumble
tackle  bigHit  powerTackle  brokenTackle  sack  hurdle  spin  stiffArm  dive  juke
block.win  block.shed  pancake
firstDown  down.change  turnover  touchdown  fieldGoal.attempt  fieldGoal.result
punt  kickoff  onside  safety  touchback  extraPoint  twoPoint  outOfBounds
overdrive.charge  overdrive.start  overdrive.end
play.start  play.end  quarter.end  half  overtime  match.end
camera.impulse  crowd.swell  ui.tick  ui.confirm  ui.back
```

Every event carries `{ type, tick, ...payload }`. Presentation must tolerate unknown event types.

## 8. MATCH STATE MACHINE (`src/rules/matchState.ts`)

```
PREGAME → COIN_TOSS → KICKOFF_SETUP → KICKOFF_LIVE ─┐
                                                     ├→ PLAY_CALL → PRE_SNAP → LIVE → DEAD_BALL
   ┌─────────────────────────────────────────────────┘        ▲                          │
   │                                                          └──────────────────────────┤
   ├← SCORE_RESOLVE ← (touchdown/FG/safety)                                              │
   │        ↓                                                                            │
   │   CONVERSION_CALL → CONVERSION_LIVE → CONVERSION_RESOLVE ─→ KICKOFF_SETUP           │
   │                                                                                      │
   ├← QUARTER_BREAK ←──────────────────────────────────────────────────────────────────--┤
   ├← HALFTIME (stats) → KICKOFF_SETUP (receiving side flips)                             │
   ├← OVERTIME_SETUP → KICKOFF_SETUP                                                      │
   └← FINAL → (rematch | exit)                                                            │
```

Invariant: **every state has at least one reachable exit under all inputs.** `matchState` has a
watchdog: if a state persists longer than `STATE_MAX_TICKS[state]`, it force-advances and emits
`rules.watchdog`. QA asserts this never fires in normal play.

## 9. PLAY STATE MACHINE (`src/sim/playRunner.ts`)

```
SETUP → PRESNAP (motion/audible allowed) → SNAP → LIVE
LIVE sub-states per athlete are animation states, not play states.
LIVE → DEAD(reason) where reason ∈
  TACKLE | OUT_OF_BOUNDS | INCOMPLETE | TOUCHDOWN | TOUCHBACK | SAFETY |
  INTERCEPTION_DEAD | FUMBLE_DEAD | KICK_RESULT | QB_SLIDE | TIME_EXPIRED
DEAD → POST_PLAY (slapstick window, 0.9 s, zero rules consequence) → SETUP
```

## 10. BALL AUTHORITY

`world.ball` has exactly one `state`:

```ts
type BallState =
  | { kind: 'held';    carrier: AthleteId }
  | { kind: 'inAir';   from: AthleteId; intended: AthleteId | null; passKind; t; ... }
  | { kind: 'loose';   lastTouch: AthleteId | null; ... }   // fumble / muff — live
  | { kind: 'kicked';  from: AthleteId; kickKind; ... }
  | { kind: 'dead' };
```

Rules:
1. At most one athlete has `athlete.hasBall === true`, and it must agree with `ball.state`.
2. `sim/ball.ts` is the **only** module that mutates `ball.state`. Everything else calls
   `giveBall()`, `releasePass()`, `dropLoose()`, `killBall()`.
3. `assertBallInvariant(world)` runs every tick in dev/test builds.
4. A dead ball can never score, be caught, or be fumbled.

## 11. INPUT ABSTRACTION

`src/input/actions.ts` defines the action enum. Devices produce `PlayerIntent`:

```ts
interface PlayerIntent {
  moveX: number; moveZ: number;        // -1..1, deadzoned, normalized
  held: number;    // bitmask of Action
  pressed: number; // edge-triggered this tick
  released: number;
}
```

Sim consumes only `PlayerIntent`. It never sees a key code or a gamepad button. Rebinding,
gamepad support, and AI are all just different producers of `PlayerIntent` — **AI-controlled
athletes produce intents through the same struct**, which is why difficulty tuning is honest.

Latency budget: device poll → intent → sim tick → render ≤ 2 rendered frames. Input is polled at
the top of the rAF callback, before the fixed-step accumulator drains.

## 12. RENDER OWNERSHIP SPLIT

`src/render` is the highest-conflict area, so files have single owners:

| File | Owner | Never touched by |
|---|---|---|
| `renderer.ts`, `quality.ts`, `postfx.ts` | lead | others |
| `camera.ts` | lead | others |
| `athleteRig.ts`, `athletePose.ts` | lead (character+anim) | stadium/effects agents |
| `field.ts`, `stadium.ts`, `crowd.ts`, `sky.ts`, `weather.ts` | environment agent | lead |
| `effects.ts`, `particles.ts`, `impact.ts` | effects agent | environment agent |
| `ballMesh.ts`, `markers.ts` | lead | others |
| `logo3d.ts` | league agent | others |

Everything registers through `SceneRegistry` (`render/registry.ts`) which owns add/remove/dispose.
No module calls `scene.add` directly.

## 12b. MATERIAL AND POST CONTRACT

Two rules, both consequences of the draw-call budget.

**Surface description lives in the geometry.** An athlete is one `SkinnedMesh` and therefore one
material. Roughness, metalness and rim gain travel as a per-vertex `aSurf` attribute; a patch in
`src/render/surfaces.ts` makes the standard shader read it. Anything adding geometry to an athlete
must tag it with a class from `SURF` — untagged geometry silently inherits the jersey.

**Tone mapping belongs to whoever writes the final pixel.** When `QualitySettings.postProcessing`
is on, the scene renders to a half-float target with `NoToneMapping` and the composite applies
ACES; when it is off, the renderer does it. Never both — the scene would be clamped to display
range before the bright pass could see a highlight, and bloom would have nothing to work with.

Corollaries that have already caught people:
- `renderer.info.render` describes the LAST thing drawn. With the post chain on, that is one
  fullscreen triangle. Scene complexity is snapshotted right after the scene pass; read it through
  `GameRenderer.info()`, never directly.
- A render target does not inherit the canvas's multisampling. It has to be asked for, or turning
  post-processing on makes the game look worse.
- `scene.environment` is rebuilt per match from the finished venue, BEFORE athletes exist. It must
  be disposed in `unloadMatch` or it leaks a render target per match.

## 13. ANIMATION CONTRACT

Athletes are procedurally posed — no imported clips. `athletePose.ts` exposes:

```ts
poseAthlete(rig: AthleteRig, s: AnimSample): void
interface AnimSample {
  state: AnimState;    // IDLE RUN SPRINT BACKPEDAL THROW CATCH DIVE HURDLE SPIN
                       // STIFFARM TACKLE TACKLED CELEBRATE BLOCK KICK GETUP STUMBLE
  phase: number;       // 0..1 within the state, interpolated between ticks
  speed01: number;     // smoothed gait, from GROUND COVERED not velocity
  lean: number;        // from the athlete's own forward acceleration
  stride: number;      // yards per stride cycle, from the sim's own cadence
  fire: number; t: number;
}
```

**Rotation signs.** Every pose rotation is about X. A bone's child hangs at local −Y for a limb and
+Y for the spine, so the same positive number means opposite things on the two:

| | positive X means |
|---|---|
| thigh, knee, foot, shoulder, elbow | limb swings **backward** |
| hips→chest, chest→neck→head | torso leans **forward** |
| shoulder/thigh Z | right limb swings **away** from the body (left is negative) |

The poses are therefore authored in **world angles** relative to the athlete's own upright facing,
and `poseLeg` / `poseArm` subtract the parent's pitch. That is what lets the lean be retuned without
re-tuning nineteen states — and it is a direct response to having had every one of those signs
inverted at once, which is invisible in code and reads on screen only as "awkward".

Sim owns `athlete.anim`: `{ state, phase, prevPhase, speed01, accelFwd, accelLat, ground, … }`.
Rendering must not infer state from positions.

Three rules the renderer must keep:

1. **Gait comes from ground covered, not velocity.** `updateGait` differences the athlete's
   position across a whole tick, so shoves, pile separation and sideline clamps are all in it.
   A velocity-driven stride slides.
2. **Locomotion state changes need hysteresis** (`syncAnim`). A pose change restarts the pose.
3. **Pose changes cross-fade** (`capturePose` / `blendPose`). Poses write bone rotations
   absolutely, so an un-faded change teleports every limb in one frame. The renderer owns the
   fade; the simulation never sees it. **Except within a pose family** (`samePoseFamily`): RUN and
   SPRINT are one continuous cycle differing only in amplitude, and athletes flip between them
   about twice a second, so fading between them froze the legs for half a stride and then snapped
   them forward.
4. **The run cycle is solved, not swept.** Each foot gets a target path — a fixed contact point
   held still on the turf through stance, an arc through swing — and a two-link solve produces the
   thigh and knee angles. Contact time is derived from `stride` so a planted foot travels backwards
   at exactly the speed the body travels forwards. `SHOE` in `athleteRig.ts` is the shared cleat
   geometry the solve needs; it has to agree with the geometry built there.
5. **Standing poses are planted after the fact.** A bounded pass measures where the lower ankle
   landed and drops the pelvis onto it, so a bent knee does not leave an athlete hovering. States
   that are legitimately airborne opt out.

Everything in this section is presentation. None of it may change a rules outcome, and the
between-plays `idleStep` explicitly saves and restores turbo for that reason.

## 14. AI INTERFACE

```ts
interface Controller { produce(world: World, id: AthleteId, out: PlayerIntent): void }
```

`HumanController` reads a seat. `AiController` reads difficulty + assignment. Both fill the same
struct. `src/ai/difficulty.ts` exposes only these knobs (no hidden stat cheats):

`reactionTicks, aimErrorYd, decisionNoise, coverageDiscipline, riskTolerance, moveTiming,
playCallQuality, pursuitAngleError, catchFocus`.

`catchUpBias` (rubber-banding) is bounded to ±6 % on pursuit speed and pressure, defaults **on** in
Arcade / **off** in Tournament, and is documented in `DESIGN.md`.

## 15. COLLISION LAYERS

Capsule-vs-capsule in 2D (XZ) with a height term. Layers:

```
BODY      athlete torso, r=0.42yd  — blocks & tackles
TACKLE    expanding hit volume during a tackle attempt
CATCH     sphere around ball, r=1.35yd base, scaled by hands rating & pass kind
BLOCK     lineman engagement disc, r=0.9yd
GROUND    y<=0 plane for loose balls
```

Contact resolution order per tick: movement → blocking → tackling → ball → rules. Contact never
depends on visual physics.

## 16. SAVE SCHEMA (`src/persistence/save.ts`)

`localStorage` key `go.save.v1` holding:

```ts
interface SaveFile {
  version: 1;
  settings: Settings;              // audio, graphics, accessibility, bindings
  season: SeasonSave | null;
  tournament: TournamentSave | null;
  customPlays: CustomPlay[];       // up to 18
  records: { wins: number; losses: number; longestTd: number; ... };
}
```

Reads are defensive: unknown/older versions fall back to defaults rather than throwing. Corrupt JSON
is quarantined to `go.save.v1.corrupt` and defaults are used.

## 17. TESTING INTERFACES

- `simulateMatch(cfg): MatchResult` — headless, no rendering, returns box score + event log.
- `runScenario(name): ScenarioResult` — deterministic setup → assertions.
- `checkInvariants(world, match): Violation[]` — run every tick under test.
- Fixed-seed replay: same `seed` + same scripted intents ⇒ identical event log hash.

## 18. PERFORMANCE BUDGETS (1600×900, "High", moving gameplay)

| metric | target | hard fail |
|---|---|---|
| frame time p50 | ≤ 9 ms | > 16.6 ms |
| frame time p95 | ≤ 14 ms | > 22 ms |
| draw calls | ≤ 180 | > 320 |
| triangles | ≤ 420 k | > 900 k |
| sim tick cost | ≤ 1.1 ms | > 3 ms |
| per-frame allocation | ~0 in steady state | GC spike > 8 ms |
| boot to menu | ≤ 2.5 s | > 6 s |

No allocation in tick loops: reuse scratch vectors from `core/math.ts`, pool particles and events.

## 19. ASSET GENERATION RULES

100 % procedural. No binary art assets in the repo. Canvas-generated textures are built once at
boot into an atlas and cached. Logos are generated as SVG strings from `data/logoGen.ts` and
rasterized to canvas for 3D use. Everything that allocates GPU memory registers a `dispose()` with
`SceneRegistry`.

## 20. CLEANUP

Every subsystem exposes `dispose()`. Leaving a match must free all geometry, materials, textures,
render targets, audio nodes, and DOM listeners it created. `tools/smoke.ts` enters and leaves a
match 5 times and asserts `renderer.info.memory` does not grow monotonically.
