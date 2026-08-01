# GRIDIRON OVERDRIVE

**An original 7-on-7 arcade football game that runs in your browser.**

Seven a side. Thirty yards for a first down. Two-minute quarters. No penalties, no referees, no
huddle. Turbo you have to manage, hurdles and spins and stiff arms, hits that shake the camera, and
a momentum state called **OVERDRIVE** that turns a hot streak into a genuine threat. Up to four
people on one screen.

Sixteen invented clubs in the **United Gridiron Circuit**. Every athlete, venue, logo, sound and
line of code was made for this project.

---

## LEGAL ORIGINALITY

This game is **not affiliated with, endorsed by, or derived from** any real football league,
players' association, team, athlete, broadcaster, arcade operator or console manufacturer. It
contains no real-world names, marks, uniforms, likenesses or data, and reuses no code, art, audio
or text from any existing game.

It was built clean-room. What it takes from the arcade football games of the late 1990s is the
*design language* of the genre — short quarters, small squads, long chains, fast play selection,
exaggerated contact — the way any sports game takes from the sport it depicts. All expression here
is original: the league, the teams, the colours, the interface, the sound, the art and the code.

Full detail, including the residual risks worth a human's eyes, is in **[IP_SAFETY.md](IP_SAFETY.md)**.

---

## INSTALL AND RUN

Requires Node 18 or newer. Nothing else — no API keys, no accounts, no downloads at runtime, no
paid assets. After `npm install` the game runs fully offline.

```bash
npm install       # one command, one lockfile
npm run dev       # development server, then open the printed URL (usually http://localhost:5173)
```

Production build and local preview:

```bash
npm run build     # typechecks, then emits dist/
npm run preview   # serves dist/ on http://localhost:4173
```

`dist/` is a static folder. Copy it anywhere that serves files.

## TEST COMMANDS

```bash
npm run typecheck    # strict TypeScript across src, tools and tests
npm test             # unit tests (rules, league data, playbook, audio, layer purity)
npm run scenarios    # 24 deterministic gameplay scenarios with assertions
npm run sim          # CPU-vs-CPU batch simulation with a balance report
npm run sim:batch    # 200 games
npm run invariants   # 50 games with per-tick rules-invariant checking
npm run smoke        # boots the real build in Chromium and plays a match to a final score
npm run capture      # writes the visual review set to docs/captures/
npm run perf         # frame-time profile of moving gameplay at every quality preset
npm run smoothness   # motion quality: animation churn, heading and position jerk, foot-slide
npm run pacing       # frame pacing: apparent-speed jitter across eight display models
npm run qa           # typecheck + tests + scenarios + 200-game batch + motion quality
```

Measured results, including the failures and compromises, are in **[QA_REPORT.md](QA_REPORT.md)**.

---

## CONTROLS

Three verbs do everything. What they do depends on what you are holding.

| | Gamepad | Keyboard P1 |
|---|---|---|
| Move | left stick | **W A S D** |
| Turbo | **RB / RT** | **Left Shift** |
| Pass · snap · switch defender · lateral | **A** | **Space** |
| Jump · tackle · hurdle · contest a throw | **B** | **J** |
| Dive | **X** | **K** |
| Spin · power tackle | **Y** | **L** |
| Throw left / middle / right | **D-pad ◀ ▲ ▶** | **U I O** |
| Touch (lob) pass | **LB** | **N** |
| Audible · motion | **LT** · **L3** | **Q** · **E** |
| Pause | **Start** | **Esc** |

Combinations worth knowing: **turbo + pass** is a bullet throw from the pocket and a stiff arm past
the line; **turbo + jump** is a high hurdle for the runner and a power tackle for the defender;
**pass** past the line of scrimmage pitches the ball backwards, and laterals chain.

Full reference, including player 2 on the same keyboard and the play-select controls, is in
**[CONTROLS.md](CONTROLS.md)**. Keyboard bindings are remappable in Settings → Controls.

---

## GAME MODES

- **QUICK PLAY** — one match. Pick seats, teams, stadium, weather, difficulty and quarter length.
  One to four humans, CPU fills the rest.
- **TOURNAMENT** — 4 or 8 teams, single elimination or best-of-three, humans and CPU mixed. The
  bracket persists for the session; CPU matchups are resolved by the real engine, not a dice roll.
- **SEASON** — a full single-player season: schedule, standings, statistics, playoffs, a
  championship, and a save you can continue.
- **PRACTICE** — routes against air or offence against a chosen defence, at a line of scrimmage you
  set, with instant reset and a development overlay.
- **PLAY EDITOR** — build your own offensive and defensive calls: move alignments, draw route
  nodes, set per-node actions, assign blocking and coverage, name it, preview it, practise it, and
  slot it into your playbook.

## LOCAL MULTIPLAYER

Plug in up to four controllers before you start, then assign each seat to HOME, AWAY or OFF on the
Players screen. Seat 1 falls back to the keyboard when no pad is present; seat 2 falls back to the
arrows-and-numpad layout, so two people can share one keyboard.

With two humans on the same team, one drives the ball carrier and the other drives a free receiver
who ignores the called route — throw it to him anywhere. On defence both players drive their own
defender and switch independently; two seats can never grab the same athlete. Everyone gets a
coloured ring, a numbered badge and their own turbo bar.

Unplugging a controller mid-play does not stall anything: that athlete reverts to AI and the seat
reclaims him when the pad comes back.

## GRAPHICS OPTIONS

Three presets — **LOW / MEDIUM / HIGH** — adjusting device pixel ratio, shadows and shadow map
size, crowd density, particle counts, turf detail, post-processing, weather density and athlete
detail. There is also a separate resolution scale (50–100 %), **adaptive resolution**, fullscreen, camera
shake, screen flash, reduced motion, large HUD and colour-safe markers.

**Adaptive resolution is on by default.** When frames start arriving late it quietly lowers the
render resolution in small steps, down to 60 % of whatever you have set, and gives it back once
frames are on time again. It moves slowly on purpose — resolution that flickers up and down is
worse to look at than resolution that is simply a bit low — and it resets to full at the start of
every match. Turn it off in Settings if you would rather the image never change.

If the game feels heavy, drop to MEDIUM first and then reduce resolution scale — that pair is worth
far more than any other setting.

## BROWSER EXPECTATIONS

Needs **WebGL2** and a reasonably modern browser: Chrome/Edge 100+, Firefox 100+, Safari 16+. It is
built for a desktop or laptop with a keyboard or a controller; there is no touch control scheme, so
phones and tablets are not supported. Audio starts on your first click or key press, as browsers
require. Everything runs locally — no network traffic after the page loads.

---

## ARCHITECTURE IN ONE PARAGRAPH

The simulation is pure, deterministic TypeScript that never imports three.js and never touches the
DOM, `Math.random` or the clock — a test fails the build if it does. That is what lets the same code
run a 60 Hz match in your browser and a 200-game batch in Node in about 170 ms per game, and it is
why difficulty tuning is honest: AI athletes and human players both produce the same `PlayerIntent`
struct, so the CPU has no private physics. Rendering, audio and interface read simulation state and
consume a typed event stream; they never write back. Full contract in
**[ARCHITECTURE.md](ARCHITECTURE.md)**; current status in **[PROJECT_STATE.md](PROJECT_STATE.md)**.

## KNOWN LIMITATIONS

Recorded honestly here and in QA_REPORT.md:

- **No touch controls.** Desktop and controller only.
- **No online play.** Local multiplayer only, by design.
- **Performance numbers from this repository's CI are software-rendered.** The container that built
  this has no GPU, so Chromium falls back to SwiftShader. Draw calls, triangle counts and memory
  figures in QA_REPORT.md are hardware-independent and meaningful; frame times from that environment
  are a worst case and are labelled as such.
- **Teams switch which end they attack only at halftime**, not every quarter. This keeps the camera
  and local-multiplayer orientation stable, which matters more here than the convention.
- **Instant replay is limited** to short deterministic clips of scores and turnovers rather than a
  general rewind system.
- The **crowd is instanced billboards**, not individuals; up close it reads as a crowd, not people.
