# Football movement intelligence

## Boundary

Football AI produces `PlayerIntent`; the fixed-step simulation remains the only owner of athlete
movement and game state. MFD uses a small native deterministic intercept solve and does not ship
Yuka or another agent runtime. This landing audit found no gameplay deficiency that justified
adding one.

## Native pursuit primitive

`src/sim/movement.ts` exposes `interceptPoint`, a bounded three-iteration future-position solve.
It takes only current positions, target velocity, and a speed cap. It has no renderer, wall clock,
randomness, DOM access, or mutable agent object. The AI layer uses it to target a carrier's likely
future location and applies contain-specific shoulder limits before emitting a `PlayerIntent`.

The horizon is capped at 1.25 seconds. This prevents a sudden hard cut from sending a defender to
an unreachable future point and avoids the oscillation caused by chasing the carrier's current
position every tick.

## Measurement plan

The development and holdout seed sets must remain fixed. Movement probes report screen-pass
yards/play and sacks, short-yardage conversion and negative gains, red-zone conversion and
turnovers, pursuit overshoot and contain loss, deterministic event-log hashes, and simulation cost.
Subjective camera impressions are not accepted as gameplay evidence. The probes census real
football situations (actual screens, third/fourth-and-1-to-3, and goal-to-go quick concepts), not
playbook tags divorced from down, distance, and field position.

## Ball skills

`src/sim/catching.ts` owns every airborne contest. Intended receivers receive a bounded local reach
ellipse and four explicit techniques; defenders retain the smaller envelope and must satisfy
current-ball facing/leverage geometry for interceptions or physical hand reach for swats. A
14-athlete attempt bitset prevents per-tick rerolls. Human auto-switch and route assist still emit
ordinary `PlayerIntent`; presentation IK consumes event metadata and never writes back to rules.
