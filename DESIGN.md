# GRIDIRON OVERDRIVE — DESIGN

An original 7-on-7 arcade football game. Short quarters, thirty-yard first downs, no penalties,
huge hits, a momentum mechanic called **OVERDRIVE**, and a play-select screen you can clear in two
seconds. It is a spiritual successor to the late-1990s arcade football design language, built
clean-room: every team, athlete, venue, sound, logo and line of code is original.

---

## 1. THE FEEL WE ARE CHASING

A new player understands the controls inside one possession. A returning player feels the DNA
immediately. Every snap is one fast, readable decision. Contact is loud. Local multiplayer produces
shouting.

Three rules govern every tuning argument:

1. **Response beats realism.** If a move feels late, it is wrong, however accurate it is.
2. **Readability beats detail.** If you cannot tell who has the ball, nothing else matters.
3. **Decisions beat execution.** The interesting part is *which* receiver, not pixel-perfect timing.

## 2. RULES

| | |
|---|---|
| Athletes per side | 7 (1 QB, 3 skill, 3 line — defence 3 front, 4 coverage) |
| First down | **30 yards**, four downs |
| Field | 100 yards + two 10-yard end zones, 53⅓ wide (real proportions, compressed play) |
| Quarters | 1:00 / 2:00 / 3:00 / 4:00 / 6:00, default **2:00** |
| Clock | runs only while the ball is live, at 2.6× real time; stops on every whistle |
| Penalties | **none.** Pass interference is legal and useful |
| Timeouts | none |
| Scoring | TD 6, FG 3, PAT 1, two-point 2, safety 2 |
| Overtime | up to 3 timed periods, then sudden death — a winner always emerges |
| Play clock | optional, off by default |

Why 30 yards works: with four downs, a drive's budget is ~7.5 yards a play. That is exactly the
range where a run, a quick game concept and an intermediate route are all live options, which is
what makes play selection interesting instead of "throw deep every down".

## 3. THE MATCH LOOP

```
PLAY_CALL (≤12 s, both sides pick simultaneously and secretly)
  → PRE_SNAP (motion, audible, snap on your own timing)
    → LIVE (3–6 s of action)
      → DEAD_BALL → POST_PLAY (0.9 s of slapstick, zero rules consequence)
        → back to PLAY_CALL
```

No huddle. The whole cycle is under ten seconds. That compression *is* the genre.

## 4. CONTROL GRAMMAR

Three verbs, context-sensitive, exactly like the arcade games this descends from:

| | Offence (carrier) | Offence (QB, pocket) | Defence |
|---|---|---|---|
| **TURBO** | sprint | sprint | sprint |
| **PASS/A** | lateral backwards | throw to the highlighted receiver | switch defender |
| **JUMP/B** | hurdle | jump pass | dive tackle / contest the ball |
| **TURBO + A** | stiff arm | bullet pass | shove |
| **TURBO + B** | high hurdle | — | power tackle |
| **DIVE/X** | dive forward | — | dive tackle |
| **SPIN/Y** | spin | — | power tackle |
| **◀ ▲ ▶** | — | throw left / middle / right | — |

**Icon passing** binds the three throw buttons to the receivers' *pre-snap* alignment and keeps that
binding for the whole play, even when routes cross. That is deliberate: it makes crossing concepts a
memory test instead of a targeting test, which is the point of them. A **DIRECTIONAL** passing mode
in Settings instead selects by stick bearing for players who prefer it.

Every special move has anticipation, active frames, recovery and a counter:

| Move | Cost | Active | Beaten by |
|---|---|---|---|
| Spin | 20 turbo | 0.52 s, 62 % tackle evade | power tackle, gang pursuit, fumble risk ×2 |
| Hurdle | free | 0.58 s, clears low hits | standing tackles |
| High hurdle | 25 turbo | 0.86 s, clears everything | timing — you land helpless |
| Stiff arm | 15 turbo | 0.40 s cone knockdown | approaching from behind |
| Dive | 18 turbo | +1.5 yards, ends the play | anything, if you dive early |
| Dive tackle | 10 turbo | 1.5 yd reach | hurdle; 0.62 s recovery on a miss |
| Power tackle | 25 turbo | ×2 force, ×2.5 fumble force | it misses more; you are committed |

## 5. TURBO

100 units. Draining costs 38/s. Regeneration is 26/s but only after a delay that scales with how
deep you drained — 0.25 s if you feathered it, 1.05 s if you emptied it. That single curve is what
makes turbo a resource instead of a button you hold forever.

Special moves cost a lump sum and are simply refused when you cannot pay.

## 6. OVERDRIVE

The momentum mechanic. Original name, original presentation — heat shimmer, an additive aura, a
crowd surge and a HUD pulse. No copied flame art.

**Earned by:**
- **three consecutive completions** by the offence — and if all three went to the *same* receiver,
  that is a **perfect chain** and it burns for 52 s instead of 36 s; or
- a defence recording **two consecutive sacks**.

The split trigger is deliberate. Three straight completions is reachable on a normal scoring drive,
so players actually meet the mechanic; the perfect chain is the version worth chasing, and it is
the one the defence can see coming because the streak counter names the hot receiver in the HUD.

**While lit:** turbo pinned full, +11 % speed, +45 % tackle breaking, +16 % catching,
+18 % pressure, +12 % accuracy.

**Lost by:** the opponent converting a first down against you, the opponent sacking your passer, or
the timer expiring. The streak itself resets on any incompletion, interception, fumble or turnover.

It is deliberately *not* an auto-score: it lifts every number by a noticeable but recoverable
margin, and the counter-conditions are things the opponent controls.

## 7. PLAYBOOK

27 offensive plays across three pages of nine, plus a custom page; 14 defensive calls with nine on
the shown page. Every play carries formation, alignments, routes with per-node actions, timing
landmarks, primary/secondary reads and blocking assignments, and renders as an SVG diagram in the
selection grid.

Coverage across the 27: 5+ runs, 5+ quick game, 3+ crossing, 3+ flood, 4+ deep verticals,
2 misdirection, 2 rollouts, 2 screens, an option/lateral concept, a trick play, 2 goal-line.

Selection is fast on purpose: the grid is 3×3, one press picks, turbo flips pages, jump mirrors the
call, and moving the cursor to the top-left and pressing up twice hides your pick from the person
sitting next to you.

## 8. AI

AI athletes produce the **same `PlayerIntent` struct** a human controller does. There is no separate
"AI physics" and no hidden stat inflation — which is what makes difficulty honest.

Difficulty adjusts only: reaction ticks, aim error, decision noise, coverage discipline, risk
tolerance, special-move timing, play-call quality, pursuit-angle error, and catch focus.

| | ROOKIE | PRO | ALL-STAR | LEGEND |
|---|---|---|---|---|
| reaction | 0.28 s | 0.18 s | 0.12 s | 0.08 s |
| aim error | 2.4 yd | 1.5 yd | 0.9 yd | 0.55 yd |
| coverage discipline | 0.55 | 0.74 | 0.87 | 0.94 |
| play-call quality | 0.45 | 0.68 | 0.84 | 0.93 |

Deliberate AI behaviours worth calling out:
- Coverage defenders need ~0.30 s longer to diagnose a run than to react to a throw. That gap **is**
  the running lane.
- Man defenders *lag* the receiver by a discipline-scaled amount rather than anticipating him.
  Separation on a break comes from that lag, not from a random roll.
- Zone defenders stay anchored to their landmark until the ball is actually in the air.
- A quarterback still in the pocket is the rushers' problem; coverage does not abandon receivers to
  chase him until he breaks containment or holds it for 2.6 s.

### Comeback bias

Bounded, documented, disableable. When enabled it multiplies **pursuit speed and pressure only** by
at most **1.06** for a team trailing by more than a touchdown, scaling in over a 21-point deficit.
It never touches catch probability, fumble rolls or ratings. Default **on** in Quick Play and
Season, **off** for Tournament. Settings → Comeback Assist.

## 9. ART DIRECTION

A lost late-90s arcade cabinet rebuilt with modern clarity. Chunky athletes with broad shoulder
pads and oversized hands; saturated invented team colours; hard shadows and bright speculars; turf
debris, sparks, impact rings and camera impulses on contact. No photorealism, no gore, no blood.

Everything is generated from code at runtime: geometry, canvas textures, SVG logos, shaders. There
is not a single binary art asset in the repository.

Athletes are one `SkinnedMesh` each with rigid single-bone skinning and vertex colours, so a full
7-on-7 costs about fourteen draw calls. Poses are procedural — no imported animation clips.

## 10. CAMERA

One automatic broadcast camera, never player-controlled, never rolling, never flipping orientation
mid-play (which would be unplayable in local multiplayer). It starts behind the offence, frames the
line of scrimmage and the first-down marker before the snap, widens on deep throws, tightens on
breakaways, pulls back for kicks, and settles fast after the whistle. Impact shake is scaled by a
user setting and disabled entirely by Reduced Motion.

## 11. AUDIO

Fully synthesised in the browser: layered impacts (sub thump + mid crack + high transient), a
breathing crowd bed that reacts to field position and events, and short stingers for scores,
turnovers and Overdrive. Separate volume buses for master, effects, crowd, stingers and interface.

No speech, no announcer, no imitation of any real broadcaster.

## 12. BALANCE TARGETS

Measured every build by `npm run sim:batch`. Current values are recorded in QA_REPORT.md.

| metric | target |
|---|---|
| combined points | 65–90 |
| plays per game | 44–58 |
| touchdowns | 8–12 |
| interceptions | 1.5–4 |
| sacks | 6–12 |
| home/away score split | within 4 points across a batch |
| games completing | 100 % |
| rules violations | 0 |
