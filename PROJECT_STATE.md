# PROJECT STATE

**Game:** GRIDIRON OVERDRIVE · **League:** United Gridiron Circuit (16 clubs, 2 conferences)

---

## CURRENT MILESTONE

**M8 — hardening.** M0–M7 are complete: the deterministic core, a full match, the playbook, AI,
local multiplayer, presentation and every mode are in and integrated.

## COMPLETED SYSTEMS

| Area | State |
|---|---|
| Fixed-timestep loop, seeded RNG, typed event bus | done |
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

## MEASUREMENTS (latest)

Full detail in QA_REPORT.md. Headline numbers:

- 200-game CPU-vs-CPU batch: 100 % completion, **0 rules violations**, **0 watchdog trips**.
- 47.8 combined points, 63.7 plays, 5.8 touchdowns, 2.1 interceptions per game.
- Home/away split 24.6 / 23.2 across the batch — no directional bias.
- 216 ms to simulate a full game headless; 0.009 ms per simulation tick (147× real-time headroom).
- Browser smoke: **19/19**. Unit tests **206/206**. Scenarios **24/24**. Determinism **12/12**.
- Deterministic: identical seed ⇒ identical event log, verified three ways.
- One balance target missed: **2.56 safeties a game** against a ≤1 target. Documented in
  QA_REPORT.md §7 rather than hidden.

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
11. **The kick meter is edge-triggered and arms on release.** The snap and the kick share a button;
    accepting the held button made every human field goal fire instantly at 22 % power.

## ACTIVE BLOCKERS

None.

## KNOWN LIMITATIONS

- No touch controls; desktop plus keyboard or controller only.
- No online multiplayer, by design.
- Frame-time figures produced in this repository's container are software-rendered (no GPU
  available), so they are a worst case; draw calls, triangles and memory are hardware-independent.
- Score variance is genuinely high: a mirror match (identical teams) still averages a ~15-point
  margin, and roughly a quarter of matches finish 28+ apart. That is the nature of ~10 scoring
  drives a game; comeback assist bounds it rather than removing it.
- The crowd is instanced billboards; it reads as a crowd, not as individuals.
- Instant replay covers scores and turnovers only, not arbitrary rewind.

## COMMANDS

```
npm install        npm run dev        npm run build      npm run preview
npm run typecheck  npm test           npm run scenarios  npm run replay
npm run sim        npm run sim:batch  npm run invariants
npm run smoke      npm run capture    npm run perf       npm run qa
```
