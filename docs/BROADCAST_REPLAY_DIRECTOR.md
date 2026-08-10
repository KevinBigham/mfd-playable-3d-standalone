# Broadcast Replay Director

MFD replay remains presentation-only. `ReplayBuffer` stores 6.5 seconds of compact render
transforms and `ReplayDirector` deterministically advances through wide, field-level slow-motion,
and end-zone shots; neither owns simulation state, RNG, score, clock, possession, or event-log
mutation.

A parallel presentation-only ring retains at most 32 ball-play cues inside that same window. Each
cue stores only tick, actor, technique/result and contact point. Terminal cues are force-flushed
onto the terminal transform frame, replay playback de-duplicates the cue by tick, and neither path
re-simulates or mutates live football.

`MfdReplayShotSetV1` is deliberately bounded: normalized shot times, a fixed target-role enum,
bounded offsets and FOV, an easing allowlist, optional slow motion/hold, and a fixed HUD enum.
Unknown fields—including URLs, executable scripts, and arbitrary object paths—fail validation.
Invalid assets fall back to `FALLBACK_REPLAY_SHOTS`.

The native package is sufficient for the current game. Theatre.js is not shipped or required for
this landing; a future authoring exporter should only be considered if camera iteration becomes a
measured production bottleneck.
