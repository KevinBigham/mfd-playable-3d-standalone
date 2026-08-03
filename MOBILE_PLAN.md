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
