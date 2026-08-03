# MAKING THE ATHLETES LOOK LIKE ATHLETES

A plan for one render-only pass. Nothing in this document touches `src/sim`, `src/rules`,
`src/core` or `src/ai`, and that is a load-bearing constraint rather than a preference — see §7.

---

## 1. WHAT IS ACTUALLY WRONG

I regenerated both contact sheets (`npm run poses`, `npm run gait`) and measured the rig rather
than eyeballing it. The finding is narrower than "the athletes look bad":

> **The animation is in reasonable shape. The anatomy is not.**

The run cycle is solved, not swept: contact time is derived so a planted foot travels backwards at
exactly body speed, stride reach accounts for being up on the toes at push-off, and the pelvis is
dropped onto whichever ankle actually landed. Foot slip is 1.16 yd/s median against 2.72 yd/s of
travel. That machinery is good and this plan does not disturb it.

What it is driving is a toy. Here is the rig measured against anthropometric reality, computed
straight from the constants in `src/render/athleteRig.ts`:

| | WR | QB | LB | OL | **real athlete** |
|---|---|---|---|---|---|
| stature, crown of helmet | 2.39 yd | 2.40 | 2.43 | 2.47 | **2.02 – 2.14 yd** |
| in feet | **7 ft 2** | 7 ft 2 | 7 ft 3 | **7 ft 5** | 6 ft 1 – 6 ft 5 |
| head + helmet height | 0.509 yd (**18 in**) | 0.509 | 0.509 | 0.509 | **≈ 0.33 yd (12 in)** |
| **heads tall** | **4.69** | 4.72 | 4.78 | 4.85 | **6.4** (5.9 helmeted-arcade) |
| hip joint / stature | 0.385 | 0.385 | 0.386 | 0.386 | **0.52** |
| shoulder / stature | 0.759 | 0.759 | 0.759 | 0.759 | **0.815** |
| **leg, hip→ankle / stature** | **0.31** | 0.31 | 0.31 | 0.31 | **0.47** |

Four things fall out of that table:

1. **Every athlete is seven feet tall.** The `height` field says 2.01–2.10 yd, but the bone chain
   adds a 0.36 neck riser and a 0.29 head offset on top of a chest at 70 % of nominal height, so
   the figure that actually renders is 18 % taller than the number that configures it. Nothing
   consumes the discrepancy, so it has never surfaced.
2. **The head is 18 inches tall and identical on all sixteen rosters.** It is the one dimension
   `build` does not touch. At 21 % of stature it is the single loudest cue in the silhouette, and
   it is the reason a lineman and a receiver read as the same toy at different scales.
3. **The legs are 31 % of the body instead of 47 %.** This is the number behind "not athletic".
   Look at any frame of `gait.png`: hip to turf is barely a third of the figure. Long legs under a
   compact trunk is *the* visual signature of a sprinter, and this rig has the inverse.
4. **Nothing tapers.** `bulk` scales the torso's width and depth by the same factor, so build
   makes everyone bigger and nobody a different *shape*. The upper arm and the forearm are the
   same diameter; so are the thigh and the shin. There is no V-taper, no quad sweep, no calf
   belly, no wrist.

Three more defects the sheets show that are not proportions:

5. **Joints are hard steps.** Skinning is rigid — one bone per vertex, weight 1
   (`athleteRig.ts:280`). At the elbow, the sleeve box and the forearm box are two separate solids
   that interpenetrate; the seam is plainly visible in `poses.png` on THROW and CATCH, and at the
   knee on every gait frame. This is what makes them read as an articulated action figure rather
   than as a body.
6. **There is no ambient occlusion anywhere.** No shadow in the armpit, under the shoulder pads,
   under the chin, between the legs. Every form is lit identically, so the parts sit *near* each
   other instead of *joining*. QA_REPORT §7 already records this as not done.
7. **The ball is never in anyone's hands.** `src/sim/ball.ts:113` places a carried ball at
   `(a.x, 1.15, a.z)` — the athlete's centreline — and the renderer draws it exactly there. In
   every frame of `poses.png` the ball floats in front of the belly, touching nothing. It is a
   physics anchor being used as a render position.

---

## 2. THE TENSION, STATED OUTRIGHT

`DESIGN.md` §9 commits to "chunky athletes with broad shoulder pads" and a late-90s arcade look.
"A lot more athletic and realistic" pulls against that, and pretending otherwise would produce a
muddle.

The resolution I am proposing: **keep the arcade attitude, fix the anatomy.** Saturated kits, stage
lighting, oversized pads, big gloves, heavy contact and exaggerated poses all stay. What changes is
that the body underneath is built to real proportions instead of chibi ones.

Concretely, the target is **≈ 6.0 heads tall** — real athletic proportion is 6.4 helmeted, a
late-90s arcade cabinet is about 5, and this repo is currently at 4.7. Six is a deliberate point on
that axis: unmistakably athletic in silhouette, still stylized enough that the game does not start
writing cheques its 800-triangle LOW tier cannot cash.

**This is the one decision I want signed off before I start**, because it is expensive to
revisit — §9 of `DESIGN.md` gets amended either way, and every number in Stage A follows from it.

---

## 3. THE PLAN

Six stages. Each ends at a state that builds, passes, and can be shipped or abandoned on its own.

### Stage A — proportions

Rebuild the vertical skeleton off a single stature target with anthropometric fractions instead of
the current pile of independent multipliers, and shrink the head.

- One `PROPORTIONS` table: hip 0.50·S, shoulder 0.815·S, chin 0.86·S, crown 1.00·S, head 0.17·S.
- Bone offsets derived from that table, so the figure that renders is the height it claims.
- Stature per position from `build` — 2.02 yd for a corner to 2.14 for a tackle — with `bulk`
  moved off height entirely and onto width and depth.
- Head geometry rescaled ~20 % down; jaw, occipital flare, facemask and crown stripes scale with
  it (they are already all derived from one 0.275 radius, so this is one constant).
- The neck becomes visible. Right now the helmet sits directly on the pads.

**Ripples this breaks and must fix in the same stage** — every hardcoded height that assumed a
seven-foot athlete:

| file | line | what | why it breaks |
|---|---|---|---|
| `src/render/renderer.ts` | 482 | seat number sprite at `y = 3.05` | floats 1 yd above a shorter head |
| `src/render/renderer.ts` | 495 | carrier chevron at `y = 2.75` | same |
| `src/ui/touchControls.ts` | 487 | receiver badge at `y = 2.4` | **this is the touch control** — the badge must stay on the player |
| `src/render/athleteRig.ts` | 716 | aura at `height * 0.55` | derived, but `height` changes meaning |

**Gate:** new `npm run anthro` prints the table in §1 and asserts the targets. `npm run touch`
still 24/24 — the badge is a shipped control, not decoration.

### Stage B — limbs that taper, and joints that bend

Two changes that only make sense together.

**Lofted limbs.** Replace the constant-width `chunk()` boxes on the arms and legs with a `limb()`
primitive: a swept tube taking a list of `(t, radiusX, radiusZ)` rings. That buys the deltoid
swell, the tricep, the taper to the wrist, the quad sweep, the calf belly high on the shin, and the
ankle — none of which a rounded box can express at any segment count.

This is **cheaper than what it replaces.** A `chunk` at HIGH is `BoxGeometry(w,h,d,4,4,4)` = 192
triangles for a shape with no profile. An 8-sided, 6-ring loft is 160 triangles with a full one.

**Smooth skinning.** Weight the vertices in a band around each joint between the two bones instead
of assigning every vertex to one bone at weight 1. Elbows, knees, shoulders and hips become
continuous instead of stepped.

> This requires fixing a real bug first: `mergeGeometries` (`athleteRig.ts:324`) copies only
> component 0 of `skinIndex` and `skinWeight` —
> `si[(vo+i)*4] = s.getX(i); sw[(vo+i)*4] = wgt.getX(i);`
> — so the second bone's weight would be silently dropped and every blended vertex would collapse
> to the origin. Harmless today because nothing writes a second weight. It is the reason smooth
> skinning cannot simply be switched on.

**Gate:** `npm run perf` — triangles per athlete stay at or under today's 7 450 (HIGH) / 835 (LOW),
draw calls unchanged at 40 / 42 / 35. `npm run poses` shows no seam at any joint in any state.

### Stage C — ambient occlusion, for free

Bake per-vertex AO at rig build time from a set of capsule proxies along the bones, and **multiply
it into the `color` attribute that already exists.** No new attribute, no shader change, no extra
draw call, no runtime cost at all.

Roughly 4 000 vertices × 16 capsules × 14 athletes ≈ 900 k distance tests at match load, which is
milliseconds. It buys the armpit, the underside of the pads, the chin shadow, the crotch, the
inside of the knee — precisely the contact regions whose absence is what makes the current model
read as separate plastic pieces.

Floor the darkening around 0.55 so it grounds the forms without turning the kits muddy.

**Gate:** `npm run poses` before/after; artifact size and boot time unchanged.

### Stage D — motion that reads as alive

Small, cheap, and disproportionately effective. All of it in `athletePose.ts` and `renderer.ts`.

1. **Put the ball in his hands.** Draw a carried ball at the carrier's tucked hand bone rather than
   at the sim's centreline anchor. The sim keeps `y = 1.15` for catching and contact maths; only
   the drawn position moves. Highest value-per-line item in this document.
2. **Asymmetric carry.** A carrier tucks the ball with one arm and pumps the other. Today both arms
   pump identically while the ball floats, which is the clearest "these are dummies" tell on the
   sheet.
3. **Gaze.** Head yaws and pitches toward what matters — the ball in flight, the target receiver,
   the carrier. Real athletes' heads are remarkably still while the body works; ours bobs with the
   spine. The renderer already knows every position this needs.
4. **Drag and follow-through.** One-to-two-frame lag on the head and hands behind the chest.
   The oldest trick in animation and the reason things read as having mass.
5. **Deeper counter-rotation** through the trunk at sprint, and pelvic list phased to the swing
   leg rather than to a bare sine.

**Gate:** `npm run smoothness` — animation churn and jerk must not regress. `npm run footslip` —
median slip must stay at or under 1.16 yd/s.

### Stage E — position physiques

`BUILD_RANGE` in `src/data/names.ts` already gives a corner 0.14–0.32 and a tackle 0.82–1.00, but
`build` only drives one uniform `bulk`. Split it into three independent axes — **mass, taper and
limb length** — so a receiver is a long-limbed V and a tackle is deep through the chest with a
lower centre of mass, rather than the same figure at two scales.

No data change; the input is the `build` number that already exists.

**Gate:** a roster contact sheet — seven positions side by side, recognisable by silhouette alone.

### Stage F — verify and ship

Full gauntlet, the artifact rebuilt, `docs/index.html` republished, `DESIGN.md` §9 amended to say
what the athletes now are, `QA_REPORT.md` given a section with the before/after numbers, and the
live link re-probed.

---

## 4. WHAT I AM DELIBERATELY NOT DOING

- **No imported character models, no mocap.** The repository ships zero binary assets and
  `artifact.ts` folds everything into one HTML file with no network access. A rigged glTF athlete
  would end both properties. Every shape here stays procedural.
- **No toe bone.** It would let the sole actually roll through push-off, which is tempting. But
  the fixed contact reference at the ball of the foot is *why* slip fell from 6.86 to 1.16 yd/s,
  and a rolling sole is exactly the thing that measured 4.7 yd/s and looked fine in stills. Not
  worth risking on the same pass as everything else. Revisit alone, against `footslip`.
- **No facial detail.** They wear helmets and facemasks and are 130 px tall.
- **No cloth or jersey simulation.** Cost is real; payoff at this size is not.
- **No new textures.** `src/render/env/textures.ts` has procedural machinery if it is ever wanted,
  but at the distance the camera actually sits (§5) silhouette buys everything and surface
  micro-detail buys nothing.

---

## 5. HOW BIG IS AN ATHLETE ON SCREEN, REALLY

This governs where the effort goes, so it is worth one line of arithmetic. The gameplay camera
sits 13.5–23 yd out at 46–58° FOV (`camera.ts:145`). A 2.1 yd athlete at 18 yd and 50° covers about
**14 % of frame height**:

- desktop, 900 p → **≈ 128 px tall**
- phone, landscape 390 p → **≈ 56 px tall**

At 128 px, proportion, silhouette, taper and joint quality all read clearly. Pore detail does not,
at any distance. At 56 px only the silhouette survives — which is another argument for spending the
pass on Stages A, B and E rather than on surface.

---

## 6. COST AND ORDER

| stage | what | risk | value |
|---|---|---|---|
| **A** proportions | rewrite of the dimension block + 4 ripple fixes | medium — touches the touch badge | **highest** |
| **B** limbs + skinning | new `limb()`, weight painting, merge fix | medium — merge bug is subtle | **highest** |
| **C** vertex AO | additive, one function | low | high |
| **D** motion + ball in hands | `athletePose.ts`, `renderer.ts` | low | high |
| **E** physiques | one function, no new data | low | medium |
| **F** verify + ship | gauntlet, docs, artifact, live | low | — |

A and B are where the money is and they interact — A changes the lengths B lofts along — so they
want to land together. C, D and E are independent of each other and could be dropped without
harming the rest.

---

## 7. THE GUARANTEE

**Every change in this document is inside `src/render` and `src/ui`.** Nothing enters `src/sim`,
`src/rules`, `src/core`, `src/data` or `src/ai`.

That is not tidiness. It means the determinism gate, all 222 unit tests, 24 scenarios, the 42/0
acceptance run and the 200-game balance batch are untouched *by construction* rather than by
inspection — the entire regression surface of this pass is visual, and the visual surface has
contact sheets and probes pointed at it.

The one exception worth flagging: Stage A changes the leg length that `athletePose.ts` reads off
the rig to solve the run cycle. Longer legs mean a longer natural stride at the same ground
covered, so the duty factor moves. The solver adapts on its own, but it must be **measured, not
assumed** — that is what the `footslip` gate on Stage D is for, and if the gait sheet shows
moon-walking after Stage A, the stature target is what gets revisited.

---

## 8. WHAT I NEED FROM YOU

1. **Approve 6.0 heads** as the proportion target (§2), or push me toward the arcade (5.5) or
   toward real (6.5).
2. **Approve the scope** — all six stages, or A + B + D only, which is most of the improvement for
   about half the work.
