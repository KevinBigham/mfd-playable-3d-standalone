# IP SAFETY

GRIDIRON OVERDRIVE is an original game. This document records exactly what was studied, what was
deliberately excluded, how the shipped material was created, and where a human should still look.

---

## 1. WHAT WAS STUDIED, AND HOW

The brief named a specific late-1990s console arcade football game as an *experiential* reference.
Research was limited to lawfully published, publicly available material:

- The console instruction manuals (as scanned and hosted publicly), for documented rules and control
  mappings.
- The arcade operator's manual, for the published rule deltas and menu structure.
- Contemporary published reviews and retrospectives.
- Community FAQs and control guides.
- The publisher's own printed "coaching tips" material.

Nothing was extracted from a ROM, an emulator, a decompilation, a disassembly, a texture rip, an
audio rip or any leaked material. No such artefact was downloaded, opened or referenced at any point.

What was taken from that reading is **functional design language**, which is not protectable
expression: how many players are on the field, how long a first down is, that the clock stops
between plays, that penalties are absent, that a momentum state exists, that play selection is a
3×3 grid, that three buttons carry context-sensitive verbs. Sports rules and game mechanics as such
are not copyrightable; the expression of them is, and none of that expression was reused.

## 2. WHAT WAS DELIBERATELY EXCLUDED

| Category | Status |
|---|---|
| ROM, decompilation, disassembly, extracted data | never obtained or used |
| Original source code, in whole or in part | none — every line here was written for this project |
| Models, textures, sprites, animations, fonts | none imported; everything is generated at runtime |
| Audio, music, commentary, announcer lines, voice | none; all sound is synthesised procedurally |
| UI layouts, menu art, icons, HUD graphics | original design, original CSS, original SVG |
| League, players' association, publisher, console-maker marks | none used anywhere |
| Real team names, cities-plus-nicknames, logos, colour schemes, uniforms | none used |
| Real athlete names, likenesses, numbers, ratings, rosters | none used |
| Real stadium, broadcaster or sponsor names | none used |
| The reference game's title, or the distinctive word from it, in any user-facing string | never used |
| Trademarked play names or playbook terminology | none used |

An automated test (`src/data/league.test.ts`) asserts that no shipped team name matches a list of
real professional nicknames, and that no generated logo markup contains league or reference-title
strings. It fails the build if either happens.

## 3. HOW THE SHIPPED MATERIAL WAS CREATED

**Names and identity.** The title, the league (United Gridiron Circuit), its two conferences, all
sixteen clubs, their cities, their venues, their perimeter advertisers and every athlete name were
invented for this project. Player names are generated deterministically from an ordinary
first-name/surname pool; none is a parody of, or a near-miss for, a real athlete. Cities are either
invented outright or generic geography deliberately not paired with any real franchise.

**Art.** 100 % procedural. Athletes are built from parametric geometry and posed by code. Field
markings, turf, crowd sprites, concrete, seating and sky are drawn into canvases at boot. Team
emblems are SVG paths authored as sixteen distinct geometric archetypes. There are no image, model,
font or audio files in this repository — check with `git ls-files | grep -Ei '\.(png|jpg|gltf|glb|fbx|wav|mp3|ogg|ttf|otf|woff2?)$'`, which returns nothing.

**Typography.** Menus request a common system font stack (Impact / Haettenschweiler / Arial Narrow
and generic fallbacks). No font file is bundled or redistributed.

**Audio.** Every sound is generated with the Web Audio API from oscillators and noise buffers at
runtime. There are no samples. There is no speech and no attempt to imitate any identifiable voice.

**Code.** Written for this project. The only third-party runtime dependency is three.js (MIT);
build and test tooling is Vite, TypeScript, Vitest and Playwright (all MIT/Apache-2.0). No game
engine, asset pack, or code from any commercial title is included.

**Playbook.** Concepts are described in the generic vocabulary of football coaching (flood, mesh,
four verticals, cover 2). Every play *name* in the game is invented.

## 4. DIVERGENCES THAT ARE ALSO ORIGINALITY

Several deliberate design choices move the game away from the reference and are worth recording:

- The momentum mechanic is called **OVERDRIVE**, uses a heat-shimmer/aura presentation rather than
  flame graphics, has a hard 48-second ceiling the reference does not have, and can be extinguished
  by counter-events we defined.
- Overtime always resolves to a winner (timed periods then sudden death) rather than permitting a
  tie.
- A modern **DIRECTIONAL** passing mode is offered alongside icon passing.
- The comeback-assist system is explicit, bounded, documented and switchable, rather than hidden.
- Kicking uses our own meter model with published make-probability maths.
- Post-whistle contact is a cosmetic, off-by-default option with zero rules consequence, and there
  is no piling-on, taunting or wrestling-move choreography.
- Sixteen teams in two conferences with an original season and playoff structure.

## 5. RESIDUAL RISK WORTH A HUMAN LOOK

Stated plainly rather than waved away:

1. **Genre proximity is intentional.** The game is meant to feel like arcade football of that era.
   Mechanics are not protectable, but a reviewer should confirm that nothing in the presentation
   reads as an attempt to pass this off as an official or licensed product. Our view: the title,
   league, teams, colours, HUD and audio are all visibly different, and the credits screen states
   the position explicitly in-product.
2. **Colour-and-name collisions are possible by accident.** Sixteen invented teams in a bold
   palette could land near a real club's identity by chance. The automated test catches nicknames,
   not colour pairs. A human should skim the team-select screen once.
3. **Player-name collisions are statistically inevitable.** Combining ordinary first names and
   surnames will eventually produce a real person's name. None is deliberate, none is attached to a
   likeness or a real biography, and the pool contains no athlete-specific names.
4. **Font stack.** We *name* fonts that exist on some systems. We do not ship them. If a future
   build wants a guaranteed look, it should generate letterforms rather than bundle a typeface.
5. **Fictional sponsor names** on stadium signage were invented; a quick trademark sanity check
   before any commercial release would be prudent.

## 6. IF YOU ARE RE-USING THIS REPOSITORY

Keep the fictional league. Do not add real names, marks, rosters or logos — the whole safety
argument rests on there being none. Do not rename the game to include the reference title's
distinctive word. Keep `src/data/league.test.ts` in CI.
