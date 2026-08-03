# GRIDIRON OVERDRIVE

**An original 7-on-7 arcade football game that runs in your browser.**

### ▶ [**PLAY IT**](https://kevinbigham.github.io/mfd-playable-3d-standalone/)

No install, no download, no account. It is one HTML file that contains the whole game — engine, 3D
renderer, audio, sixteen teams, every mode — and it makes no network requests once it loads.

**New — the mobile transformation is live.** On a phone the game now opens on a one-tap home
screen: **PLAY DRIVE** drops you into Drive Rush (start at the opponent's 40, one drive, instant
"one more" retry), the **Daily Drive** gives everyone the same deterministic problem each day,
**Mastery Drills** teach one read at a time, and **Beat My Drive** codes let a friend replay your
exact drive and try to beat your score. Reworked pass coverage (rules v2) makes reading the field
beat button-mashing — receipts for every claim live in
[`MOBILE_TRANSFORMATION_STATUS.md`](MOBILE_TRANSFORMATION_STATUS.md).

**It plays on a phone.** Open [the link above](https://kevinbigham.github.io/mfd-playable-3d-standalone/)
on your handset and hold it sideways. Your left thumb is a floating stick that appears wherever you
put it; push past the ring for turbo. Everything else is your right thumb: tap **SNAP** to hike, tap
the badge over a receiver to throw to him — and **drag off that badge to place the ball**, away from
the defender or back to the sideline. Swipe to juke, hurdle and dive.

Use your browser's **Add to Home Screen** and it runs without browser chrome, which on a landscape
phone is the scarce axis. A phone also gets its own graphics tier, its own camera framing and a
title screen that answers a tap in under half a second — decided from the pointer, with nothing to
configure. A desktop with a mouse never sees any of it.

Placement is the one control with real depth, and it is why the phone version is not a lesser
version. [`CONTROLS.md`](CONTROLS.md) has the full grammar. [`MOBILE_PLAN.md`](MOBILE_PLAN.md) has
the measurement round and what is still missing — including the honest ceiling on how big the
players can be made before the receivers stop fitting on the screen.

> ### Picking this up on a new machine
>
> ```bash
> git clone https://github.com/KevinBigham/mfd-playable-3d-standalone.git
> cd mfd-playable-3d-standalone
> npm install
> npm run dev          # then open the printed URL
> ```
>
> **Want to just play it, no toolchain?** Open
> [`dist-artifact/gridiron-overdrive.html`](dist-artifact/gridiron-overdrive.html) in any browser.
> That one file is the entire game — engine, 3D renderer, audio, sixteen teams, every mode — with
> no network access of any kind. Download it and double-click it.
>
> **Where things are:** [`DESIGN.md`](DESIGN.md) is what the game is trying to be.
> [`ARCHITECTURE.md`](ARCHITECTURE.md) is the code's contracts and the rules it must not break.
> [`QA_REPORT.md`](QA_REPORT.md) is every measurement, including the failures.
> [`PROJECT_STATE.md`](PROJECT_STATE.md) is where the work stopped and what is still open —
> **read that one first if you have been away.**

Athletes are built to real proportions — six heads tall, legs at 47 % of stature, a receiver
long-limbed and V-shaped where a tackle is deep through the chest — with arcade attitude on top:
saturated kits, oversized pads and gloves, stage lighting and heavy contact. Every shape is
procedural. `npm run anthro` asserts the anatomy so it cannot drift.

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
npm run scenarios    # 25 deterministic gameplay scenarios with assertions
npm run replay       # determinism: same seed, byte-identical event log, three ways
npm run sim          # CPU-vs-CPU batch simulation with a balance report
npm run sim:batch    # 200 games
npm run invariants   # 50 games with per-tick rules-invariant checking
npm run acceptance   # the 61-test release matrix
npm run smoke        # boots the real build in Chromium and plays a match to a final score
npm run capture      # regenerates the 30-image visual review set in docs/captures/
npm run perf         # frame-time profile of moving gameplay at every quality preset
npm run smoothness   # motion quality: animation churn, heading and position jerk, stride cadence
npm run pacing       # frame pacing: apparent-speed jitter across eight display models
npm run human        # scripts a PLAYER onto the sticks and checks what the game does about it
npm run touch        # plays a down on a phone-sized screen with two thumbs and no keyboard
npm run footslip     # do planted feet actually grip the turf, measured at the shoe
npm run fieldpos     # where drives start, how kick returns go, and every safety explained
npm run driveprobe   # yards and conversions by concept, down and distance
npm run runprobe     # run-game autopsy: blockers, first contact, gain shape
npm run passprobe    # what happens to every forward pass
npm run poses        # contact sheet: one frame of every animation state
npm run gait         # contact sheet: one sprint stride, frame by frame
npm run anthro       # athlete proportions, asserted rather than eyeballed
npm run roster       # contact sheet: eight positions, recognisable by silhouette
npm run artifact     # folds the whole game into ONE self-contained HTML file
npm run artifact:check  # boots that file in a sandboxed iframe and plays a match in it
npm run qa           # typecheck + tests + scenarios + batch + motion + the artifact build
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

## ONE-FILE BUILD

`npm run artifact` writes `dist-artifact/gridiron-overdrive.html` — the entire game, about 1 027 kB,
in a single document. No module imports, no stylesheet link, no fonts, no images, no network of any
kind. Open it from a disk, email it to somebody, or drop it in an iframe and it plays. The same
bytes are written to `docs/index.html`, which is what the play link at the top of this file serves,
so the link can never quietly serve last week's game.

Even the web-app manifest is inlined as a `data:` URI rather than shipped as a second file, which is
what lets the game install to a home screen without giving up the one-file property.

`npm run artifact:check` proves that rather than assuming it: it loads the file inside a
**sandboxed iframe** on a different origin with every other path returning 404, then checks that it
boots, draws, takes keyboard input through the frame, plays a full match to a legal final score,
and makes zero network requests.

Two accommodations the embedded build makes: it starts at MEDIUM graphics rather than HIGH, because
it usually runs inside a page that is already busy; and when a frame refuses `localStorage`, saves
fall back to memory, so a session stays coherent even though nothing survives a reload.

## BROWSER EXPECTATIONS

Needs **WebGL2** and a reasonably modern browser: Chrome/Edge 100+, Firefox 100+, Safari 16+.
Desktop, laptop, phone or tablet — keyboard, controller or thumbs. On a phone, hold it sideways;
portrait raises a rotate prompt and stops the clock. Audio starts on your first click, tap or key
press, as browsers require. Everything runs locally — no network traffic after the page loads.

**Add to Home Screen** works on iOS and Android and is worth doing: it drops the browser chrome,
which is vertical space a landscape phone cannot spare, and the game declares itself fullscreen and
landscape. On a notched phone the interface keeps clear of the notch and the home indicator.

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

- **No online play.** Local multiplayer only, by design.
- **Nothing has ever been run on a real phone.** Every mobile number in this repository is Chromium
  with touch emulation at 844×390. That is honest about layout, geometry, draw calls, input plumbing
  and boot structure, and says nothing about thermals, sustained frame rate or touch latency. It is
  the largest unknown here.
- **Ball placement on touch is unverified against a human.** The grammar works and is measured by
  `npm run touch`, but nobody has played a full game with a thumb and reported back.
- **The notch-avoidance is unverified.** `viewport-fit=cover` is in place and the touch gate proves
  the engine parses `env(safe-area-inset-*)`, but an emulator has no notch, so the insets read 0 and
  no probe can tell "supported and zero" from "unsupported".
- **Play cards are not reachable by a thumb.** Held sideways they sit in the middle 48 % of the
  screen. The panel cannot simply be widened — three rows of that card shape do not fit in a 390 px
  screen — so the fix is fewer cards per page, which is a playbook change. Measured in
  [`MOBILE_PLAN.md`](MOBILE_PLAN.md) §10.4 and left undone.
- **Frame times depend heavily on which GPU ran them.** Draw calls, triangle counts and memory in
  QA_REPORT.md are hardware-independent and meaningful. Wall-clock frame and boot times are given
  for both a real GPU (Apple M4 via ANGLE Metal) and a software rasteriser, and the gap between them
  is roughly ten to one — treat either as a bound, not as a device figure.
- **Teams switch which end they attack only at halftime**, not every quarter. This keeps the camera
  and local-multiplayer orientation stable, which matters more here than the convention.
- **Instant replay is limited** to short deterministic clips of scores and turnovers rather than a
  general rewind system.
- The **crowd is instanced billboards**, not individuals; up close it reads as a crowd, not people.
