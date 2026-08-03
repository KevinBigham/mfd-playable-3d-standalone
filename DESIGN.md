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

**At the line.** The snap is **edge-triggered and arms on release**: ACTION also picks the play, so
a thumb still down from the play-call screen must come off the button before the ball will move.
Once armed, the press is latched, so an eager snap fires the instant the pre-snap window opens
rather than being swallowed by it. And nobody crosses the line of scrimmage before the snap — a
0.35 yd neutral zone holds both sides — which is a rule, but it is also what stops a player walking
his quarterback twenty yards downfield and banking them.

**One press, one action.** ACTION picks the play, snaps the ball and throws it, depending on when
you press it — so each press is consumed by the first thing it does. Snapping with it does not also
throw, and holding it through the snap does nothing further until you let go. Nothing can be done
with the ball at all until it has actually been snapped.

**Icon passing** binds the three throw buttons to the receivers' *pre-snap* alignment and keeps that
binding for the whole play, even when routes cross. That is deliberate: it makes crossing concepts a
memory test instead of a targeting test, which is the point of them. A **DIRECTIONAL** passing mode
in Settings instead selects by stick bearing for players who prefer it.

Every special move has anticipation, active frames, recovery and a counter:

| Move | Cost | Active | Recovery | Beaten by |
|---|---|---|---|---|
| Spin | 20 turbo | 0.52 s, 62 % tackle evade | — | power tackle, gang pursuit, fumble risk ×2 |
| Hurdle | free | 0.58 s, peaks at 0.95 yd | — | standing (1.0 yd) and power (1.25 yd) tackles |
| High hurdle | 25 turbo | 0.86 s, peaks at 1.85 yd — clears everything | 0.18 s helpless landing | its cost and its landing |
| Stiff arm | 15 turbo | 0.40 s cone knockdown | — | being approached from behind |
| Dive | 18 turbo | +1.5 yards | goes to ground, ends the play | anything, if you dive early |
| Dive tackle | 10 turbo | 0.62 s, 1.5 yd reach, 0.55 yd high | goes to ground for 0.7 s | a hurdle — it goes clean over |
| Power tackle | 25 turbo | ×2 force, ×2.5 fumble force, 1.25 yd high | 0.20 s stagger | a high hurdle; it whiffs more |
| Juke | 10 turbo | 0.33 s, 2.3 yd of lateral displacement | — | a patient tackler who has not committed |
| Protect | free | held stance, ×0.55 fumble chance | ×0.88 speed, ×0.85 turn | anyone with an angle — you gave up the ability to change it |

**The juke and the protect are the two ends of the economy.** A juke is cheap, short and
*specifically* a counter to a defender who has already committed — 86 % against a dive that is
already in the air, 18 % against a balanced tackler standing his ground. That asymmetry is the whole
reason it exists alongside the spin, which costs twice as much and beats a close threat regardless
of what that threat is doing. Protecting the ball is the opposite kind of decision: unglamorous, no
animation payoff, and the correct button when you have already won the play and only need to finish
it. Nothing about either is a strictly-better option, which is the bar a move has to clear to be
worth a button.

The height numbers are the rock-paper-scissors. A hurdle clears a tackle whose reach is *below the
carrier's feet* and nothing else, so a normal hurdle beats a dive tackle and loses to a standing or
power tackle; a high hurdle clears all three and pays for it with the cost and the landing.

## 5. TURBO

100 units. Draining costs 31/s, so a full meter is about 3.2 seconds of sprint — most of a play.
Regeneration is 26/s (60 % of that while you are still holding the button, because holding an empty
button is the mistake) and only starts after a delay that scales with how deep you drained: 0.25 s
if you feathered it, 0.85 s if you emptied it. Re-engaging after a burn needs a quarter tank, so a
held button cannot stutter in and out of sprint one tick at a time.

The meter refills to full between plays. Within a single play the trade is real and measurable:

| over one 5-second play | distance | sprint uptime | meter left |
|---|---|---|---|
| hold turbo | 56.3 yd | 53 % | 24 |
| feather it | 51.8 yd | 32 % | 41 |
| never touch it | 46.1 yd | 0 % | 100 |

Holding wins the footrace; feathering banks the spin, stiff arm and high hurdle you need when
somebody finally gets in front of you. Special moves cost a lump sum and are simply refused when
you cannot pay — which is exactly why emptying the meter is a decision and not a default.

**The ball carrier also runs 6 % faster than everyone else.** That is an arcade convention, not
physics. Without it, seven pursuers erase every breakaway and the game has no explosive plays.

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

## 6b. THE BALL IN THE AIR

A pass has more than two outcomes. Caught and incomplete are the common ones; **bobbled** is the one
that makes an arcade football game worth watching.

A failed catch that was contested, or thrown as a bullet, or reached for while diving, can juggle
instead of dying — and a defender who gets a hand to a ball can bat it **up** rather than down. In
either case the ball pops off the hands and stays live *in the air*, and for the second or so it
hangs there anybody on the field can take it: the receiver who dropped it, the safety arriving late,
the man who tipped it.

It is still legally a forward pass, and that is the rule that makes it fair rather than chaotic:

- **In the air it is live.** Either team may catch it. A defender who takes it has an interception.
- **On the ground it is over.** Touching the turf, or crossing a sideline, ends the down as
  incomplete. A tipped ball is never a fumble, never a safety and never a touchback, because those
  all belong to a ball somebody possessed.

The man who caused the tip is the *worst* placed to recover it — his hands are past the ball and his
momentum is going the wrong way — which matters because he is also the closest player to it. Without
that penalty the defence recovers two thirds of them and the mechanic becomes a turnover generator
instead of a moment.

Throw error is **angular**, not a fixed number of yards. The same release that puts a flat route on
the numbers puts a forty-yard post several yards off it, so accuracy ratings and pass distance
interact the way they should rather than a deep ball being as reliable as a screen.

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

A lost late-90s arcade cabinet rebuilt with modern clarity. Broad shoulder pads and oversized
gloves; saturated invented team colours; hard shadows and bright speculars; turf debris, sparks,
impact rings and camera impulses on contact. No photorealism, no gore, no blood.

Everything is generated from code at runtime: geometry, canvas textures, SVG logos, shaders. There
is not a single binary art asset in the repository.

### The athletes are arcade in attitude and anatomical in build

This section used to say "chunky athletes", and it was honest about what the game shipped: every
athlete rendered between 7ft 2 and 7ft 5, carried an eighteen-inch head that was byte-identical on
all sixteen rosters, and stood **4.7 heads tall** with his legs making up 31% of him. None of that
was a style decision anybody took. `height` said 2.01 yards and the bone chain quietly added 18%
on top of it that nothing accounted for.

The resolution, chosen deliberately rather than drifted into: **keep the arcade attitude, fix the
anatomy.** Saturated kits, stage lighting, oversized pads and gloves, heavy contact and exaggerated
poses all stay. The body underneath is built to real proportions.

The target is **six heads tall**. Real helmeted proportion is 6.4 and a late-90s cabinet is about
5, so six is a deliberate point on that axis: unmistakably athletic in silhouette, still stylised
enough that the game does not start writing cheques its 800-triangle LOW tier cannot cash. Every
vertical landmark is a fraction of stature — hip 0.519, shoulder 0.800, chin 0.833 — so an athlete
is one number with a shape attached rather than a pile of multipliers that happened to agree.
`npm run anthro` asserts all of it, including that a standing athlete's soles are on the turf.

`build` used to drive one uniform scale, which made a lineman a receiver at 130% — bigger, never a
different shape. It is five axes now: mass, breadth, depth, waist and limb length. A receiver is a
long-limbed V (pads 1.8× his waist); a tackle is deep through the chest and low-slung (pads 1.0×
his waist, chest depth 0.27 of his height against a receiver's 0.17). `npm run roster` is the
eight-position silhouette sheet that check exists to protect.

Athletes are one `SkinnedMesh` each with vertex colours, so a full 7-on-7 still costs about
fourteen draw calls. Limbs are lofted tubes with real profiles — deltoid, tricep, wrist, quad
sweep, calf belly, ankle — which is both more shape and about 1 900 **fewer** triangles per
athlete than the rounded boxes they replaced. Joints are smooth-skinned across a band, so an elbow
bends as one surface instead of two solids interpenetrating. Contact shadows are baked into the
vertex colours at build time from capsule proxies along the bones: no new attribute, no shader
change, no draw call, nothing at runtime. Poses are procedural — no imported animation clips.

## 9b. RENDERING

The look is stage lighting, not photography: one hard key, saturated primaries, deep corners, and
detail spent on silhouette rather than on surface realism. What changed in the graphics pass was
not the style — it was that the renderer finally had the machinery to express it.

**Surfaces.** Every athlete is one skinned mesh so a full 7-on-7 costs fourteen draw calls, which
means one material for helmet, jersey, skin and cleats alike. That material used to be Lambert:
no specular at all, so a moulded helmet shaded exactly like a cotton sleeve. Surface description
now lives in the geometry — each vertex carries roughness, metalness and a rim gain, and a small
patch to the standard shader reads it. One draw call, one material, and a helmet that catches the
lights while the sleeve beside it does not.

**Rim light.** A dark athlete on dark turf under a single hard key loses his own outline. A
view-angle edge light puts him back on top of the field. It is not physical and is not trying to
be; it is the arcade equivalent of a backlight on a stage, and it is what stops fourteen bodies
in a pile from merging into one shape.

**Image-based light.** The finished venue — sky, stands, turf — is captured into a pre-filtered
environment map at match load, before any athlete exists. Everything glossy has something to
reflect. Intensity is held at just over half, because at full strength it flattens the key that
the whole look is built on.

**Post.** HDR render target with multisampling (a render target does not inherit the canvas's),
a soft-knee bright pass, two levels of bloom, ACES, a per-venue grade, vignette, grain, and
chromatic aberration driven by the same impacts that shake the camera. Tone mapping lives in the
composite: leaving it on the renderer would clamp the scene to display range before the bright
pass ever saw a highlight. A night ground grades deeper and hotter than an afternoon one; snow
lifts the blacks because a field full of it really does bounce light into the shadows.

**Turf.** Mown bands are not painted stripes. Real mown grass changes how it *catches light*, not
what colour it is, so the bands drive roughness and normal tilt and the effect appears and
disappears with the viewing angle. Wear runs through the hashes and the goal mouths, progressing
grass → thinned → bare soil. Weather is a real response: rain drops albedo and roughness together,
snow settles in the low ground and is swept off the paint, frozen goes pale and glossy.

**The venue owns its surface.** Twelve of the eighteen grounds are not grass, and until this pass
none of them knew it — the match hardcoded grass, so a mud ground played and rendered exactly like
a manicured one. Mud is a churned grass pitch, not a bare earth lot: green survives at the edges
and the middle is destroyed.

## 10. CAMERA

One automatic broadcast camera, never player-controlled, never rolling. It starts behind the
offence, frames the line of scrimmage and the first-down marker before the snap, widens on deep
throws, tightens on breakaways, pulls back for kicks, and settles fast after the whistle. Impact
shake is scaled by a user setting and disabled entirely by Reduced Motion.

It faces whichever way the man **carrying** the ball is going, which is not the same as whose down
it is. On a scrimmage play they agree; on every return they are opposites, and keying the shot to
possession filmed kick returns, pick-sixes and fumble returns from in front — the returner running
at the lens with his own end zone behind him. The turn happens once, on the change of possession,
and it is damped like every other framing parameter, so it pans rather than cuts.

The framing numbers — distance, height, look-ahead, field of view — are eased in their own right
before the camera is placed from them, so a change of shot is a second-order move rather than a
lurch toward a target that jumped. Shot changes need a clear reason and a minimum dwell: a runner
must be plainly clear to earn the tight breakaway shot and plainly caught to lose it, because a
single threshold made the camera flip several times a second whenever a carrier ran alongside a
defender. The camera also looks a little further ahead the faster the carrier is moving, so it
shows the space he is running into instead of reporting it afterwards.

## 10b. MOTION

Everything below is presentation only; none of it changes a rules outcome.

- **Stride is locked to ground covered.** Cadence comes from the distance an athlete actually
  travelled last tick divided by a fixed stride length, not from his velocity. Blocking shoves,
  pile separation and sideline clamps all move a body without touching its velocity, so a
  velocity-driven run cycle showed a defender strolling while he slid several yards a second.
- **Locomotion states carry hysteresis.** Fixed speed thresholds meant an athlete holding a speed
  near a boundary changed animation state every tick, and every change restarts a procedural pose.
- **The run cycle is solved, not swept.** Each foot is given a path — a contact point held still on
  the turf through stance, an arc through swing — and a two-link solve produces the joint angles.
  Contact time is derived so that a planted foot travels backwards at exactly the speed the body
  travels forwards. Stride length is bounded by how far the leg can actually reach, which is much
  further behind the athlete than in front of him because at push-off he is up on his toes.
- **The feet are planted, not posed.** Every standing pose bends the knees, and a bent knee shortens
  the leg; a bounded pass measures where the lower ankle landed and drops the pelvis onto it rather
  than a hip height being hand-tuned into each of nineteen cases.
- **Poses cross-fade.** Each pose writes bone rotations absolutely, so a state change used to
  teleport every limb on one frame. The renderer snapshots the pose being left and eases out of it
  over 50–140 ms depending on the state; impacts stay short so a tackle still lands like a tackle.
  Two states that are the same pose at different amplitudes — RUN and SPRINT — do **not** fade
  between each other: athletes flip between them about twice a second, and fading froze the legs
  for nearly half a stride every time.
- **Bodies lean and bank.** Forward and lateral acceleration in the athlete's own frame drive body
  lean and a roll into the turn.
- **Between plays the world still breathes.** Match phases that do not run a simulation step now run
  a narrow animation-only step, so the field does not freeze and the renderer is never interpolating
  against a stale previous frame.
- **Frame pacing.** The frame delta is averaged and snapped to a whole number of simulation steps
  when it is close to one, with the difference banked and bled back so the match clock stays true
  to the wall clock. What this fixes is *timestamp* noise: browser frame timestamps are not exact,
  and a world that advances by a noisy delta wobbles even when frames arrive on time. It is
  explicitly NOT fixing the classic fixed-timestep beat, where one frame runs two simulation steps
  and the next runs none — render interpolation already covers that, and the harness prints the
  step count to show it happening harmlessly on half of all frames at 120 Hz.
- **Adaptive resolution.** On by default, and switchable in Settings. Frames that arrive late
  relative to the fastest this machine has been seen to manage shrink the render buffer in 10 %
  steps down to 60 %; a sustained run of on-time frames gives it back in 5 % steps. Both thresholds
  are relative rather than absolute, so a 50 Hz display with headroom is not mistaken for a 60 Hz
  display in trouble. Reset to full at the start of every match.
- **The near goalpost fades out** when it stands between the camera and the ball, which near a goal
  line otherwise draws a bright yellow bar across the play.

## 10c. SPECIAL TEAMS

A kick is the only play where both teams are running at full speed in the same direction, and it is
the one place where "offence" and "defence" stop being useful words — the kicking team has the
ball, so it is nominally the offence while doing nothing but chasing.

- **The deep man catches it, and he catches it running.** He sets up seven yards deep in his own
  end zone, waits out the flight, and leaves when his own run time matches the ball's — so the
  catch happens twenty-five yards later, at a sprint, with the return already under way. There is
  no roll on it: he is alone under a ball with his hands out and a coin flip adds nothing. What he
  does next is the play. This is worth stating in numbers because it was the difference between a
  kick return and a formality — 3.9 yards a return and one in six going BACKWARDS, against 9.6
  yards and none.
- **Everyone else on the return team blocks, from the moment it is struck.** Not "once he catches
  it": the wall forms in front of where the return will START, which is not where the returner is
  standing — he is twenty-five yards behind it and about to run through. Six men converging on a
  ball in the air is a return team blocking nobody.
- **Nobody moves until the ball is.** The kicker holds the ball on the tee, which makes him a
  carrier, which had both teams setting off half a second early — one side charging a man standing
  on his own thirty, the other blocking for him.
- **Hang time and coverage speed are a single dial.** A kick that hangs too briefly for the cover
  team arrives with an open field in front of the returner and every return scores. One that hangs
  too long lands with the coverage already there and no return ever gets started. They are set
  together or not at all.
- **Where it lands is a run-up length, not a yard line.** Deeper is not kinder. Landing it on the
  goal line gives a glorious run-up and starts the drive on the 6, and a returner who is not
  steered perfectly out of there loses more to the field position than the momentum returns.
- **Coverage sprints the whole way and keeps a reserve.** Sixty yards is not a pursuit angle, it is
  a race — but a cover man who arrives empty watches the returner run away from him, because the
  ball carrier has a small speed advantage by design.
- **Gunners.** The two widest men on a punt team never block. They release on the snap and race the
  ball, which is the only reason punt coverage arrives at the same time as the punt.
- **Lane discipline.** Cover men run a share of the field's width and converge only inside fourteen
  yards. Six men converging early is what a return wall exists to beat.
- **You do not dive on a ball nobody else can reach.** A dive guarantees possession and costs the
  rest of the play. It is worth it in a crowd and never worth it alone.
- **The momentum rule.** Take possession of somebody else's ball inside your own ten, get driven
  back over the line, and it is a touchback rather than a safety. You did not choose to be there.

## 11. AUDIO

Fully synthesised in the browser: layered impacts (sub thump + mid crack + high transient), a
breathing crowd bed that reacts to field position and events, and short stingers for scores,
turnovers and Overdrive. Separate volume buses for master, effects, crowd, stingers and interface.

No speech, no announcer, no imitation of any real broadcaster.

## 12. BALANCE TARGETS

Measured every build by `npm run sim:batch`. Current values are recorded in QA_REPORT.md.

| metric | target | shipped |
|---|---|---|
| combined points | 44–60 | **48** |
| plays per game | 55–70 | **63** |
| touchdowns | 5–8 | **6.1** |
| interceptions | 1.5–4 | **2.2** |
| sacks | 4–9 | **6.9** |
| safeties | ≤ 1 | **2.3 — over, see QA_REPORT §7** |
| home/away score split | within 4 points | **1.0** |
| games completing | 100 % | **100 %** |
| rules violations | 0 | **0** |

The target band moved down during hardening, and that is worth being honest about. An earlier build
scored 71 combined — but it did so with a turbo meter that soft-locked (so nobody could sprint or
use a special move), and with interceptions in your own end zone paying two points to the team that
threw the pick. Fixing both cost roughly twenty points a game, because the defence got its legs
back and a chunk of phantom scoring disappeared. A correct 48 is worth more than an inflated 71,
and the band above is what the code actually does.
