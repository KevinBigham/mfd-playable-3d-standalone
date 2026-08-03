# Receiver Target Surface — Physical A/B Protocol

**Status: WAITING_FOR_PHYSICAL_EVIDENCE.** No default change ships until this protocol has been
run on real hardware. Both surfaces remain implemented and switchable; `DIRECT_FIELD` (the
shipped on-field badges) stays the default; `THUMB_FAN` is the candidate.

## How to switch

- Settings → `TOUCH · PASS TARGETS` → ON THE FIELD / THUMB FAN, or
- URL: `?ff=targetFan:on` forces the fan without touching the saved profile.

## Built-in telemetry (local only, never uploaded)

`GO.touch.telemetry` in the console exposes, per session:

- `surface` — active surface id
- `targetSelections`, `fanSelections`, `badgeSelections`
- `selectMsSamples` — ms from QB-mode start to first target press (decision+acquisition time)
- `actionZoneWhiffs` — QB-mode touches in the action zone that hit no target (miss proxy)

Record these per participant per arm, plus observation notes.

## Devices

Minimum matrix: older/small iPhone, current large iPhone, low-end Android, midrange Android,
high-refresh Android, one tablet. Record device, OS, browser/PWA mode, refresh rate.

## Participants

Right- and left-handed; small and large hands; football-literate and not; frequent and
infrequent mobile-action players. Each participant plays BOTH arms, order counterbalanced.

## Tasks (per arm)

1. Select each of the three receivers while actively steering with the left thumb.
2. Select the far-side target specifically.
3. Drag placement left / right / upfield on command.
4. Throw under pressure (defender closing).
5. Repeat selections after routes cross.
6. Play five consecutive drives without a break.

## Record per task

decision-to-selection time (telemetry), miss/cancel rate, thumb travel and grip changes
(observation/video), steering abandonment (left thumb lifting during selection), target-choice
accuracy vs stated intent, placement accuracy, fatigue trend across drives, stated preference,
read accuracy (could they say why they chose that receiver).

## Predeclared decision rule

Ship `THUMB_FAN` as the phone default only if it beats or matches `DIRECT_FIELD` on ALL of:

- unintended action rate < 5%
- target miss rate < 5% after first-session practice
- target selection p95 ≤ 350 ms after decision
- steering abandonment < 10%
- no critical target outside measured comfortable reach
- left-handed users show no material disadvantage (mirrored layout is implemented)
- ≥ 80% correctly explain the fan↔receiver mapping after three attempts
- no reduction in read accuracy vs the on-field surface

Otherwise `DIRECT_FIELD` stays default; the fan remains an option. Tablets may prefer
`DIRECT_FIELD` regardless — record tablet results separately.

## What desktop emulation has already established (and what it cannot)

Chromium touch emulation proves: fan targets are ≥48 px, inside safe bounds, non-overlapping,
zone-separated from the stick, mirrored correctly, and semantically identical to badge taps
(`tools/touchprobe.ts`, "surface parity" checks). It cannot prove thumb reach, acquisition speed,
occlusion, grip, fatigue, or preference. Those claims must come from this protocol only.
