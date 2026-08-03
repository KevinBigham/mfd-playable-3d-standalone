# GRIDIRON OVERDRIVE — MOBILE CONVERSION PLAN

Synthesis of three independent mobile audits (Aug 2, 2026), reconciled against fresh
measurements taken on this machine at commit `b76476f`.

Read `START-HERE.txt` first if you are cold. This document supersedes the three audit
reports where they disagree with each other or with the numbers below.

---

## 0. Fresh receipts — what is actually true today

All three auditors were blocked installing dependencies and had to reason from the
repository's own documentation. That install works here, so these are first-hand:

| Check | Command | Result |
|---|---|---|
| Dependency install | `npm install` | 62 packages, clean |
| Typecheck | `npm run typecheck` | clean |
| Unit tests | `npm test` | **222/222 pass** |
| Scripted human | `npm run human` | 19/19 checks pass |
| Drive census | `npm run driveprobe` | 20 games, 2:00 quarters, 30-yd chain |

Machine: Node 24.16.0, darwin. Date: 2026-08-02.

**The two numbers that decide the project:**

```
reading the play   187 yd / 10.7 pts per game
hammering one btn  206 yd /  9.3 pts per game     ← more yards, blind
```

```
3rd and 1-8 yd     16%          3rd and 17-24 yd   22%
3rd and 9-16 yd    20%          3rd and 25+ yd     24%     ← longer is easier
```

Concept yards/play: `SCREEN 1.00 · RUN 4.86 · QUICK 7.04 · PASS 8.97 · DEEP 20.96`

Every audit's central claim reproduced. The diagnosis is not in dispute.

---

## 1. Three findings the audits missed

These come from combining fresh probe output with the repo's own sweep records. They
change the plan, so they lead.

### 1.1 The playbook is 27 plays deep and two plays wide

Play mix per game, from `driveprobe`:

```
RUN    19.3      DEEP  16.5      PASS  6.8      QUICK  2.3      SCREEN  0.8
```

`DEEP` alone is called more often than `PASS`, `QUICK` and `SCREEN` combined (16.5 vs
9.9). Two families are 56% of all offensive snaps; quick game and screens together are
under 5%. The AI found the deep exploit and the other 20-odd concepts are decoration.

A mobile three-card play selector is worthless if two of the three cards are traps.
**Concept role repair is a prerequisite for the play-call UI, not a follow-up to it.**

### 1.2 Twenty-eight percent of all plays are special teams

`other` — kickoffs, punts, field goals, PATs — is 18.2 of 63.9 plays per game. That is
more snaps than every passing concept combined. Audit 3's field-position probe also
found the punt/kickoff geometry to be net-negative and possibly broken.

This is strong support for offense-first Drive Rush: deleting special teams removes a
quarter of the game's plays and a known-suspect subsystem in the same stroke.

### 1.3 Shortening the chain is already tested — it does not work

Audit 3 recommends prototyping a 20-yard chain for Drive Rush and testing 15/20/24.
**Do not spend time on this.** `PROJECT_STATE.md:296-298` records the sweep:

```
FIRST_DOWN_YARDS   30 → 24 → 20
first downs        3.6   3.6   3.4      (slightly worse at 20)
```

The reason is visible in the drive census: of 16.9 drives per game, 13.6 end in a
touchdown (8.3), a turnover (5.0) or a safety (0.3). **Eighty percent of drives never
reach a chain decision at all.** They end explosively.

You cannot lengthen a drive by moving a marker the drive never reaches. Drives get
longer only by cutting explosive-play frequency and turnover rate — which is the deep-ball
EV problem and the interception rate, again. The chain is innocent.

---

## 2. The keystone

One line of code is the root of three separate problems.

`src/sim/playRunner.ts:319`

```ts
throwTo(w, a, w.athletes[tgt], kind, 0, it.moveX, it.moveZ);
```

The stick that moves the quarterback is the stick that places the ball. `PlayerIntent`
(`src/core/types.ts:466`) has `moveX/moveZ` and nothing else. That single coupling causes:

1. **Touch is impossible.** One thumb cannot steer and aim on separate axes.
2. **Placement is unmeasurable.** The repo already concedes this — placement shipped
   *unverified* because no script can hold the QB still and vary the throw
   (`PROJECT_STATE.md:301-304`).
3. **Reading the play does not pay.** Placement is the skill dimension with the most
   headroom, and it is currently indistinguishable from steering noise. The read gets
   diluted by an aim channel that is really a movement channel.

Splitting aim from movement is simultaneously the touch fix, the measurement fix, and
the largest single lever on skill expression. **Everything else in this plan is
downstream of it.** Do it first.

```ts
interface PlayerIntent {
  moveX: number; moveZ: number;
  aimX: number; aimZ: number; aimStrength: number;   // new
  held: number; pressed: number; released: number;
}
```

Keyboard, gamepad and AI map aim to the existing behaviour on day one, so desktop
replays stay byte-identical. Touch supplies aim independently. No pointer coordinates
ever enter `playRunner.ts`.

---

## 3. Where the audits agree — treat as settled

Three independent auditors reaching the same conclusion is the strongest signal in the
bundle. Do not relitigate these:

- **Do not port. Build a mobile product layer on the existing engine.** The deterministic
  core, `PlayerIntent` seam, event bus and seeded RNG are the reason this is worth doing.
- **Do not rewrite the simulation.** No `if (mobile)` inside `src/rules/match.ts`. No
  pointer handling inside `src/sim/`.
- **Landscape for live play, portrait for menus.** Rotate gate before the venue loads.
- **Three contextual play cards, not a 3×3 grid.** Full playbook behind an expansion.
- **Short session mode is the front door.** Full Match survives as Classic, not as the
  first thing a phone player sees.
- **No progression, ads, currencies or IAP until skill beats spam.** All three are
  emphatic. Meta layered on weak agency produces chores.
- **No energy timers, loot boxes, pay-to-win stats, or forced interstitials.** Ever.
- **PWA first, native wrapper second.** The one-file artifact already proves portability.

The touch grammar is also near-consensus and should be built as described:
floating left stick · receiver badges near actual receivers · tap to throw · hold-release
for touch/lob · drag from badge to place · right side becomes a contextual move surface
after the catch · swipe left/right juke, up hurdle, hold protect.

---

## 4. Where the audits conflict — my calls

**Sequencing: skill first or touch first?** Audit 3 contradicts itself — its prose puts
"make correct decisions beat blind input" at step 2, its own roadmap puts skill repair at
Phase 3. Audits 1 and 2 both build the touch slice before the deep balance work.

*Call: touch grammar first, then the fun gate.* The reason is stronger than any audit
gave: the skill harness has to model the **mobile** policy — tap a receiver, drag a
placement — and that policy cannot be written until the aim channel and touch layout
exist. Tuning skill against the keyboard grammar tunes the wrong game. The keystone
split (§2) lands in the first milestone, so the skill work is unblocked immediately after.

**Phase 0 scope.** Audits 1 and 2 want a large truth-establishing phase: CI, regenerated
docs, canonical state files, baseline screenshots.

*Call: minimal.* Half of it is done above — install, typecheck, tests and probes all have
fresh receipts as of today. Fix the two instrument bugs, add a config fingerprint, move on.
CI and doc regeneration are real work that does not make the game fun; defer them until
after the fun gate.

**Drive Rush shape.** Audit 2 wants "start at opponent's 40, four downs to score."
Audit 3 wants "fixed start, four downs to cross a chain marker."

*Call: audit 3's chain model, audit 2's fixed start, current 30-yard chain.* The chain
preserves the core football loop and scales to longer modes; a pure score-sprint dead-ends
at one distance. Keep 30 yards — §1.3 shows shortening it is a measured dead end.

---

## 5. The plan

Five milestones. Each has a gate that is a command or a measurement, not an opinion.

### M0 — Make the instruments honest
*Small. One session.*

1. `src/testing/simRunner.ts:141` — `avgFirstDowns: sum.fd / n` sums both teams while the
   line below it divides passing and rushing yards by two. Replace with explicit
   `avgFirstDownsBothTeams` and `avgFirstDownsPerTeam`. Delete the ambiguous field.
2. The error has already propagated into `PROJECT_STATE.md:296`, which reports "4.3 per
   team" for a combined figure. Real per-team is ~2.3. **The drive-rhythm problem is
   twice as bad as the docs say.** Fix every consumer.
3. Separate `defenderPossessionEvent` from `creditedInterception` from `turnoverDrive`.
   Roughly 20% of throws emit an interception event; ~2.8/game are credited. Those are
   different numbers and only one of them is the player's problem.
4. Print a config fingerprint on every probe: unit, quarter length, seed range, team
   policy, difficulty, ruleset, commit.

**Gate:** no report states a per-team number computed from a combined sum.

### M1 — The keystone and the way in
*The milestone that makes mobile possible.*

1. Add `aimX/aimZ/aimStrength` to `PlayerIntent`. `throwTo` reads aim, not move.
   Keyboard/gamepad/AI map aim to current behaviour.
2. Extract an `InputSource` interface; refactor keyboard and gamepad behind it.
   (Audit 1 is right that this beats bolting `TOUCH` onto `DeviceKind` as a fourth enum arm.)
3. Add `TouchSource`: multi-pointer ownership, pointer capture, `pointercancel` cleanup,
   held-state clearing on background.
4. **Make the title respond to a tap.** `src/ui/screens/menus.ts:50-57` checks only
   `menuPressed()`. A phone player currently reaches the title screen and is trapped there.
   This is ten minutes of work and it is the entire difference between "unplayable" and
   "playable" — do it first, on day one.

**Gate:** fixed-seed desktop replays are byte-identical to pre-M1, and a touch-only player
can snap and complete a pass.

### M2 — Drive Rush, headless then playable
*The mobile product shell.*

1. `Ruleset` interface. `CLASSIC` populated from today's constants; `DRIVE_RUSH` supplies
   fixed start, four downs, 30-yard chain, **no special teams, no quarter transitions,
   offense only**. No physics or athlete changes.
2. `tools/driveRushProbe.ts`, no UI dependency.
3. Mobile shell: lazy boot (title interactive before `renderer.loadMatch` — `src/main.ts:19-26`
   currently builds an attract-mode stadium and eagerly imports the 1,407-line play editor
   before the first tap works), `MOBILE_LOW`/`MOBILE_BALANCED` render tiers, landscape gate,
   safe-area insets, lifecycle pause/save/resume, haptics adapter.
4. Touch HUD, three-card play call, receiver badges, result card, **ONE MORE DRIVE**.

**Gate:** 200 Drive Rush sims with zero invariant violations. On a real phone: first snap
under 10 seconds, one drive in 45–120 seconds, no keyboard, no console errors.

### M3 — THE FUN GATE
*The milestone that decides whether this is a game or a toy. Do not skip it and do not
soften it.*

1. Policy harness across 100+ seeds: blind spam · random target · highest separation ·
   leverage read · read+timing · read+placement · deep-shot spam.
2. Concept role repair, targeting the §1.1 collapse:
   - **Run floor.** ~19% of runs lose yardage and ~40% land at zero-ish. This is why
     third-and-short fails at 16%.
   - **Screens.** 1.00 yd/play on 0.8 calls a game is a dead concept.
   - **Deep EV.** 20.96 yd/play at 73% completion with 2.5 yards of separation at arrival
     is the exploit. Reducing it is also how drives get longer (§1.3).
   - **Quick game.** 2.3 calls a game means it is not functioning as a pressure answer.
3. Throw grading surfaced to the player: READ / TIMING / PLACEMENT, under a second.
4. Cut illegible punishment. An interception should be a risk the player accepted or a
   mistake they can name — not the default outcome of an imprecise thumb.

**Gate:** read+placement beats blind spam by **≥20% expected points per drive across 100+
seeds**, holds across multiple teams and defensive families, and no single-target spam
policy is optimal. Audit 2 proposes 10–15%; audit 3 proposes 20–30%. Take 20% — the margin
has to be *felt* inside one session, not detected across a thousand sims.

If this gate fails, stop and keep tuning. Everything after it is worthless without it.

### M4 — Retention
*Only after M3 passes.*

Club mastery · skill missions · daily deterministic drive (the seeded core makes this
free and fair) · post-drive grade and one highlight · horizontal unlocks, never stat
inflation · streak mercy. Asynchronous "beat my drive" seed challenges are close to free
given determinism and are the single best social feature available without a backend.

**Gate:** testers voluntarily start a second drive, and return the next day for the seeded
challenge, with no coercive reward attached.

### M5 — Ship
PWA manifest and service worker · 15-minute thermal soak on real hardware · device matrix
· accessibility pass (left-handed layout, control size/opacity, reduced motion, 48px
minimum targets) · then Capacitor wrapper and store packaging.

Monetization decision waits until here. Premium unlock or cosmetic-only. Nothing that
changes a competitive outcome.

---

## 6. Standing rules

1. Do not rewrite the deterministic engine.
2. No pointer events in `src/sim/`, `src/rules/`, `src/ai/`, `src/plays/`, `src/core/`, `src/data/`.
3. No `if (mobile)` in `src/rules/match.ts`. Add a `Ruleset`, not a conditional.
4. Never ship 21 buttons on glass.
5. No progression, currency, ads or IAP before the M3 gate passes.
6. Do not tune against a metric whose denominator you have not read.
7. Do not claim device performance without naming the device and the run.
8. Classic Match, Season, Tournament, Practice and the Play Editor all survive. They just
   stop being the first thing a phone sees.

---

## 7. First three actions — done 2026-08-02

**1. Tap-to-start.** `TitleScreen` now takes a `click`, and the prompt reads TAP TO START on a
coarse pointer. The listener only raises a flag that `update()` consumes on the next frame:
advancing on `pointerdown` would unmount the title under a finger that has not lifted, and the
release would land on whatever main-menu button had moved into that spot. Verified by tapping the
built artifact at 844×390 — reaches the menu, and QUICK PLAY is left focused rather than
activated, so there is no ghost click. Space still works.

The artifact's own hint banner said "click once, then W A S D move" to every device; on a coarse
pointer it now says gameplay still needs a keyboard or controller, because it does.

**2. First-down denominator.** `avgFirstDowns` is gone, replaced by `avgFirstDownsBothTeams` and
`avgFirstDownsPerTeam`, and `tools/sim.ts` prints the unit beside every number in the block.
Over 200 games: **2.3 per team, 4.6 both teams.** `PROJECT_STATE.md` and `QA_REPORT.md` are
corrected, with a unit-correction note left in the QA report rather than a silent rewrite of the
historical rows — the drive-rhythm failure was twice as severe as both documents said for all of
M15, and the gap to the 8–12 band is a factor of four, not two.

**3. The aim channel.** `PlayerIntent` carries `aimX/aimZ`; `throwTo` reads them instead of
`moveX/moveZ`. Keyboard and gamepad copy movement into aim inside `InputManager`, and the AI
zeroes it exactly where it already zeroed movement — every AI throw returns before it sets
movement, so the CPU was already throwing with no placement.

*Deviation from audit 3:* no `aimStrength`. Gesture magnitude is already the length of the aim
vector, and a tap with no drag and a drag that returns to origin are the same throw. Add it when
something needs it.

Receipts, all after the change: typecheck clean · **222/222** unit tests · **24/24** scenarios ·
**19/19** human · **42 passed / 0 failed** acceptance · **11/11** artifact · **21/21** browser
smoke · determinism **byte-identical** to the pre-change baseline on all three seeds
(`79e45f34 · 18-27`, `ec37fe8a · 8-36`, `c4bca483 · 7-30`).

The seam was then proved to do something, which is the part that matters: with the passer pinned
at `moveX = moveZ = 0` for a whole snap and only `aimX` varying, the ball's target moved 1.5–2.2
yards across aim-left / aim-none / aim-right on every seed that produced a throw. **Placement is
now separable from steering and measurable from a script** — the thing `QA_REPORT.md` §12.12 says
no script could do. That unblocks the M3 policy harness.

---

## 8. M1 — the touch grammar — done 2026-08-02

`npm run touch` is the gate: **24/24**, in Chromium with touch emulation at 844×390, no keyboard
touched at any point.

**The seam.** `InputManager` gained one `IntentSource` hook that merges a contribution into seat 0.
Deliberately *not* the full `InputSource` refactor of §5/M1.2: rewriting the keyboard and gamepad
paths is real regression risk against a determinism guarantee, and it buys nothing a touch source
needs. Keyboard and gamepad still poll inline. With no source attached the file behaves exactly as
before, which is what keeps replays byte-identical.

**The grammar as built.** Floating stick on the left, turbo past the ring — no button. Everything
else is the right thumb: SNAP, receiver badges, and a gesture surface that changes meaning with the
mode (`SNAP` · `QB` · `CARRY` · `FREE`). One button in the whole layout, LOB, and it only exists
while the quarterback is holding the ball.

**Badges are drawn on the receivers**, not in a row, via a new `GameRenderer.projectToScreen`.
Verified to within 2 px of the athletes' projected positions. This is the thing that makes the
phone version teach football rather than hide it: the read and the input are the same act.

**Screen-to-world is solved, not assumed.** A basis is measured off the live camera every frame
and inverted. Hardcoding "screen right is world +X" is correct for one drive and backwards after
the change of possession, and a placement control that inverts at halftime is worse than none.

**Placement, proved end to end.** Same seed, same play, same snap, same frame count — only the
drag direction differs:

```
drag left   ball target x = 1.4        spread 1.37 yd
tap         ball target x = 0.7        tap sits exactly between the two drags
drag right  ball target x = 0.0
```

That is a finger moving a football through `PlayerIntent.aimX` and out the other side of the
deterministic simulation, with nothing below `src/ui` aware a touch screen exists.

**Desktop is protected.** The pad requires a coarse primary pointer, or a real finger on the glass
— a mouse never triggers it, proved by a second browser context in the same probe. Determinism
byte-identical on all three seeds; 222 unit · 24 scenarios · 19 human · 42 acceptance · 11 artifact
· 21 smoke all still pass.

**Two bugs found on the way, neither in the touch code:**

1. `.ps-cell` had click handlers that could never fire — the match overlay is `pointer-events:none`
   and nothing re-enabled it. **Play calling was keyboard-only on a device with no keyboard.**
2. `tools/artifact.ts` and `tools/artifactcheck.ts` spliced the built bundle in with a *string*
   replacement, so `$&` inside minified three.js expanded to the matched text. The artifact shipped
   with `pt=</body>&$.mapping` spliced into the renderer — a blank page and `Unexpected token '<'`.
   Both now use function replacements, and the build asserts the payload survives byte for byte.

### Still missing before this is a mobile *product*

- **Landscape play-select still shows the desktop 3×3 at reduced size.** It fits now (a
  `max-height` breakpoint — the old one keyed off width, which a landscape phone never trips), but
  §3's three contextual cards are not built.
- **No PWA manifest or service worker.** M5.
- **No haptics beyond `navigator.vibrate`**, which iOS ignores.
- **Lazy boot not done.** `src/main.ts` still builds an attract-mode stadium and imports the
  1,407-line play editor before the first tap.
- **M0 item 3 still open**: separate `defenderPossessionEvent` from `creditedInterception` from
  `turnoverDrive` — 5.2 interception events a game against 2.8 credited.

### Next

**M3 is now the bar, and it is unblocked.** The policy harness can finally model the mobile policy
— tap a receiver, drag a placement — because both exist and both are scriptable. Nothing else on
this list matters if reading the play does not beat mashing one badge by 20% expected points per
drive, and that is the next thing to measure.

---

## 9. What a phone actually gets — measured 2026-08-03

§8 listed what was missing from memory. This section replaces guesses with numbers. Everything
below was measured at **844×390 CSS, devicePixelRatio 3, touch emulation** — an iPhone 14 held
sideways — in Chromium, against the shipped `dist/` build.

**Two GPUs were used deliberately.** `--use-angle=metal` gives this Mac's real GPU (Apple M4);
`--use-gl=swiftshader` gives a software rasteriser. Neither is a phone. The M4 row is the
strong-GPU end, swiftshader is a stand-in for the weak end, and *the gap between them is the
finding* — not either number on its own. **No claim here is a device measurement**, per standing
rule 7. Nothing has been run on real hardware, and that is the largest remaining hole.

### 9.1 What is NOT the problem — stop spending time here

Three things that a mobile plan would normally attack are already fine, and the plan above was
wrong to imply otherwise.

**Geometry is phone-sized already.** Live gameplay, per tier:

| tier | draw calls | triangles | textures |
|---|---|---|---|
| LOW | 48 | 51,666 | 42 |
| MEDIUM | 49 | 112,326 | 76 |
| HIGH | 47 | 190,750 | 103 |

Forty-eight draw calls is not a mobile problem on any handset of the last decade. There is no
batching work to do, no LOD work to do, no instancing work to do.

**Receiver badges work.** §8 built them and never measured them. Over seven seeds and 896 frames
of genuine dropback (forced SHOTGUN, latest primary read — the same trick `tools/touchprobe.ts`
uses), all three badges are visible **86%** of the time, mean 2.57 of 3, and **0 of 767** frames
had two badges closer than 60 px. They never overlap and they are never ambiguous.

*This corrects a wrong reading taken earlier the same day.* A screenshot at the instant of the
snap showed three badges piled together, and a first probe "confirmed" it at 100%. That probe was
picking `offensePlays[0]` — usually a run — so it was measuring a four-frame QB window on a
handoff, not a progression. The repo's recurring bug is a probe that measures something other
than what it claims, and this was another one.

**JavaScript is not the boot cost.** A CPU profile of boot attributes **94.7% to `(program)`** —
native, i.e. GPU driver and shader compilation. Our own code is ~670 ms of it (three.js 545 ms,
game 126 ms). Minifying, tree-shaking or code-splitting the bundle would buy almost nothing.

### 9.2 Boot is one un-yielded block, and it is shader-bound

| GPU | DCL | first frame | longest single blocking task |
|---|---|---|---|
| M4 / Metal, cold shader cache | 2953 ms | **4029 ms** | 2931 ms |
| M4 / Metal, warm shader cache | 1027 ms | **1332 ms** | 999 ms |
| swiftshader (weak-GPU stand-in) | 564 ms | **12710 ms** | 17331 ms |

CPU throttling at 4× and 6× barely moves the M4 numbers, which is the tell: this is GPU work, not
script work. Network is irrelevant — 1022 kB transferred, fetched in 9 ms locally.

Two things are true regardless of hardware:

1. **It is a single synchronous task.** Nothing paints and no touch is answered for its whole
   duration. The `#boot` splash cannot animate through it.
2. **Most of it is work the title screen does not need.** `src/main.ts:24` builds a full
   attract-mode stadium, and line 11 imports the 1,407-line play editor, before the first tap
   is possible. This is M2.3's "lazy boot", still not done, and it is now the measured
   first-impression cost.

The spread between 1.3 s and 12.7 s across GPUs is also the argument for **detecting mobile and
defaulting to LOW**, which nothing currently does: `defaultQuality()` in `src/persistence/save.ts`
returns `HIGH`, or `MEDIUM` inside the artifact, with no device check at all. Under swiftshader,
HIGH costs 67.5 ms at p95 against LOW's 16.8 ms — a 4× difference that is invisible on an M4 and
decisive on a cheap Android.

### 9.3 The game is too small to read, and that is the main event

An athlete is projected foot-to-crown and measured in CSS pixels:

| | median athlete height | share of screen height |
|---|---|---|
| 1280×720 (designed at) | 60 px | 8.3% |
| 844×390 (phone) | 25–33 px | 6.3–8.5% |

The *fraction* is the same — the camera scales with the viewport, correctly. The problem is
physical: that fraction on a 6-inch screen is about **5 mm of actual football player**, roughly a
2.4× smaller visual angle than the same game on a desktop monitor. Distant receivers measure
17–19 px. You cannot see separation, you cannot see a defender closing, and the read the badges
are supposed to teach is not legible.

**Dollying the existing camera toward its own look point fixes it, and the amount is measurable.**
Same seed, same play, same frame:

| framing | athlete height (min / median / max) | athletes on screen |
|---|---|---|
| ships today | 17 / **25** / 35 px | 14 / 14 |
| dolly 35% | 23 / **38** / 68 px | 14 / 14 |
| dolly 55% | 28 / **54** / 141 px | **12 / 14** |

**35% is the answer.** It makes players 52% taller while keeping every athlete on screen. 55% is
visibly better looking and breaks the game: it pushes the outside receivers off the edges, so the
badges point at people you cannot see. That is a hard ceiling, not a taste call, and it is why
this is worth a number rather than an eyeball.

A related defect shows up in the same captures: `paintBadges` clamps badges to `±34 px` of the
screen edge, so at today's framing the outside badges sit pinned to the bezel, nowhere near the
receiver they name. Tightening the camera mostly dissolves this on its own.

### 9.4 The screen is still furnished for a desktop

- **Play select is the desktop 3×3, in the one place a thumb cannot reach.** Nine cells of 132×93
  occupying x=218..626 of an 844-wide screen — the middle 48%. Held in landscape, thumbs reach the
  left and right edges; the centre requires letting go of the phone. Plus paging: 18 plays over
  2 pages. §3's three contextual cards are still the fix and are still not built.
- **Keyboard copy leaks onto glass.** `src/ui/screens/matchScreen.ts:118` tells a touch player
  `Hold UP + TURBO + JUMP before the kick for an onside attempt`.
- **Banners collide.** `.tc-coach` sits at `bottom: 15%` — y≈299 on a 390 px screen — and shows for
  4.2 s on *every* mode change, on top of the field and over the help line, which is itself often
  still showing. Captures show `BIG HIT!` over `1ST & 30` and the coach line over the onside hint
  simultaneously.
- **`.tc-pause` is 42×42.** Under the 44 pt floor. Every other target is fine: badges 60, LOB 78,
  stick 108.

### 9.5 It is a web page, not an app

| | |
|---|---|
| `viewport-fit=cover` | **missing** |
| PWA manifest | missing |
| `apple-mobile-web-app-capable` | missing |
| service worker | none registered |
| `overscroll-behavior` | not set |
| `env(safe-area-inset-*)` | used in 5 rules |

The first line makes the last line dead. **Without `viewport-fit=cover`, iOS returns 0 for every
`env(safe-area-inset-*)`**, so all five rules that carefully avoid the notch and the home
indicator do nothing on the device they were written for. The pause button lands at 10,10 — under
the notch in landscape. This is a one-line fix and it is the highest value-per-character change
in the entire document.

Without a manifest and `apple-mobile-web-app-capable`, the game also cannot leave Safari's
chrome, which is eating vertical space on the axis that is already the scarce one.

### 9.6 What this changes about the plan

The ranking above is not the ranking in §5. Ordered by felt improvement per unit of work:

1. `viewport-fit=cover`, PWA manifest, service worker, `overscroll-behavior`, 44 pt pause. Hours.
2. Camera dolly to 35% on a coarse pointer. Hours, and it is the single biggest change to how the
   game feels in the hand.
3. Mobile-aware `defaultQuality()`, and lazy boot so the title answers a tap before the stadium
   exists.
4. Screen furniture: three contextual play cards reachable at the thumbs, one banner at a time,
   touch-appropriate copy.
5. **M3, the fun gate, unchanged.** None of this decides whether reading the play beats mashing,
   and that is still the thing that decides whether this is a game.

Items 1–4 are perhaps a week and are pure mobile playability. They do not require, and should not
wait for, the Drive Rush shell in M2.

### 9.7 The decision

Measurement answers the camera. It does not answer this:

**Does "mobile playability" mean making the existing full game excellent on a phone, or building
the Drive Rush product shell first?**

- **Polish the game that exists** (items 1–4, then M3). A phone player gets Quick Play, four
  quarters, the full playbook — the same game, properly framed and properly dressed for glass.
  Lower risk, ships continuously, and every fix also improves desktop.
- **Build Drive Rush first** (M2, then items 1–4 inside it). A phone player gets a 45–120 second
  fixed-start drive, no special teams, no quarters, three cards. A genuinely mobile-shaped
  product, and the thing that makes a stranger play twice — but it is a new mode to design,
  balance and test, and the polish above still has to happen afterwards.

These are not mutually exclusive and the order is the whole question. Items 1 and 2 are worth
doing under either answer, immediately.

*Answered 2026-08-03: both, with polish landing first.*

---

## 10. The polish pass — done 2026-08-03

### 10.1 The app shell

`viewport-fit=cover`, `apple-mobile-web-app-capable`, `mobile-web-app-capable`, a status-bar
style, a web-app manifest and `overscroll-behavior: none`. The pause button went 42 → 46 px.

The manifest is a **data URI**, not a file, because `tools/artifact.ts` folds this page into one
self-contained HTML file and an external `manifest.webmanifest` would be the first thing to break
that. Chromium parses that form with zero errors and resolves `start_url` and `scope` against the
document; a `blob:` manifest was tried first and fails both with *"URL is invalid"*.

`npm run touch` grew five checks and now runs **29**. The one thing it cannot check is the thing
that prompted the work: emulated devices have no notch, so `env(safe-area-inset-*)` is genuinely
0 and no probe can tell "supported and zero" from "unsupported". The gate proves the syntax parses
and the meta is present. **The inset values remain unverified until this runs on real hardware.**

### 10.2 The camera, and a number that came back down

Shipped at `PHONE_DOLLY = 0.15` after a first pass at 0.35 was measured properly and rejected.

The first pass looked at athlete size alone. The sweep that followed — 864 frames of dropback per
step, six seeds — added the column that mattered:

```
dolly   median athlete   athletes on screen   badges still on the man
0.00    24 px            100.0%               98.4%
0.15    28 px             99.6%               87.9%
0.22    31 px             99.1%               64.4%
0.35    38 px             92.7%               56.0%
0.45    46 px             88.6%               51.6%
```

On a screen this size you cannot magnify without cropping, and the first thing cropped is the
outside receiver. `paintBadges` then clamps his badge to the bezel, so the control still throws to
him but has stopped being a *read* — and the read is the whole argument for drawing badges on
players instead of in a row. 0.15 is the knee; past it fidelity falls off a cliff for very little
extra size.

**Getting meaningfully bigger needs fewer or tighter players, not a longer lens.** That is an
argument for Drive Rush, and it is the strongest one in this document.

A badge that *has* been clamped now says so — dashed ring, dimmed number — instead of quietly
pointing at grass. The touch gate was tightened to match: an `edge` badge is exempt from the
position test and must instead prove its receiver is genuinely outside the frame. That is a
closed hole, not a loosened gate; the old single-frame test passed or failed on luck.

### 10.3 Quality tier and boot

`defaultQuality()` had no device check at all and handed a phone `HIGH` (or `MEDIUM` inside the
artifact). A coarse pointer now takes `LOW`. The justification is the spread, not taste: on the
strong GPU every tier costs the same 2.7 ms at p50, so the choice is free; on the weak one HIGH
runs 67.5 ms at p95 against LOW's 16.8. Dynamic resolution does not cover this — it scales the
framebuffer, while the shadow map, post chain and crowd are fixed by the tier.

The attract-mode stadium moved to a `requestIdleCallback` **after** the title is registered and
listening. The block did not get shorter; it stopped happening in front of a screen that does not
exist yet. Measured title-interactive: **185–508 ms**, against a first frame at 1332–4029 ms.

### 10.4 Screen furniture — partly done, and why the rest is not

Done: the onside-kick hint no longer names three keyboard keys to a device with no keyboard, and
`.hud-help` is hidden outright on a coarse pointer. It sits at `bottom: 48px` and `.tc-coach` at
`bottom: 15%` — 58 px on a 390 px screen — so the two were drawing over each other in every
capture.

**Not done: play cards under the thumbs.** Widening the panel was tried and reverted. The 430 px
cap turns out to be forced by height, not by taste: `aspect-ratio: 168/118` makes a full-width
cell 266×187, three rows come to 561 px inside a 390 px screen, and the top row lands at y=-90.
Three rows only fit if a cell is ~95 px tall, which caps the width at ~135 px, which is the 430.

So reachability needs **fewer cards, not a wider panel**. At two rows a cell can be 239×168 and
the grid spans 729 px — under both thumbs, and nearly three times today's cell area. That is a
change to the playbook rather than to the stylesheet: plays carry a `slot` of 0..8, there is a
`SPECIAL_SLOT = 9`, and the cursor starts at 4 because 4 is the middle of a 3×3. It is the
remaining piece of §3's three contextual cards and it wants a design decision, not a CSS rule.
