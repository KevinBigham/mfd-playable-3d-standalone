# MFD Stadium Visual Studio

The Stadium Visual Studio is a development-only Pascal editor for constrained football-stadium
semantics. It does not replace the game renderer. Pascal edits semantic nodes; the game accepts
only a validated `MfdStadiumVisualV1` JSON file and rebuilds it with the existing native Three.js
environment pipeline.

```text
Pascal scene → ignored staged JSON → validate + protect + budget → explicit promotion
             → generated ID registry → native GeoBatch stadium → crowd / lights / score state
```

## Boundary and ownership

- `StadiumDef` remains authoritative for venue ID, name, city, surface, roof category, sky,
  crowd tint, tier, and accent. The studio shows these inherited fields as locked context.
- Visual JSON is renderer-only. It does not enter match configuration beyond the existing stadium
  ID, simulation state, replay logs, mode state, or saves.
- Runtime assets contain yards and football semantics, never Pascal scene state, arbitrary meshes,
  scripts, shaders, external URLs, or texture downloads.
- The protected field apron is `x = ±37`, `z = -26..126`, with a low-clearance volume through
  `y = 16`. Central end-camera lanes extend to `z = -32..132`. Touching a protected boundary is a
  validation failure; a roof must be strictly above `y = 24`.
- Authored geometry retains native batching. Crowd spectators remain one instanced system, live
  scoreboards share one canvas texture and instanced surface, and tower heads feed native lights.

The contract and native compiler live in `src/render/stadiumVisual/`. Promoted local assets live in
`src/render/stadiumVisual/assets/`; the generated registry is
`src/render/stadiumVisual/generatedRegistry.ts`. Working output under `.stadium-staging/` is ignored.

## Install and launch

The isolated tool requires Node 22.13 or newer, Git, and Bun exactly 1.3.0. It has its own package
and lockfile; none of its dependencies are installed into the game package.

```bash
npm --prefix tools/pascal-stadium-studio ci --ignore-scripts
npm --prefix tools/pascal-stadium-studio run bootstrap:prereqs
npm run stadium:studio
```

The prerequisite command installs Bun into the ignored tool cache without changing the global
runtime. The launch command verifies every pin, prepares an ignored Pascal checkout, typechecks the
pinned host, registers the MFD plugin through Pascal's public discovery APIs, and starts it on port
3002 by default. Set `PORT` to choose another port or `PASCAL_BUN` to point at an existing Bun 1.3.0
binary. A missing or mismatched prerequisite fails with the exact corrective command.

The host is pinned to `pascalorg/editor` commit
`99cc537e2538419536be86678a6139047a13af9d`, the stable 0.9.2 package line. The plugin uses exact
`@pascal-app/core`, `@pascal-app/viewer`, and `@pascal-app/editor` 0.9.2 packages. Attribution and
the upstream MIT notice are in `tools/pascal-stadium-studio/THIRD_PARTY_NOTICES.md` and `LICENSE`.

## Editing workflow

The studio imports any of the 18 native venues through the deterministic legacy adapter. Each scene
contains these explicit node kinds:

- `MfdStadiumRoot` and a locked, non-exported `MfdFieldReference`
- `MfdBowlPlan`, ordered `MfdDeckProfile`, and `MfdBowlOpening`
- `MfdRoof`, `MfdTunnel`, `MfdScoreboard`, `MfdLightTower`, `MfdBanner`, and `MfdSkylineProp`

Values are labelled in yards. Pascal's viewport and handles use metres internally, with conversion
only at the adapter edge. Top, perspective, end-zone, and side camera presets show the exact field
and protected envelope. Use Pascal selection, inspector controls, semantic handles, and undo/redo;
the MFD panel continuously shows validation paths, asset hash, native LOW/MEDIUM/HIGH estimates,
budget status, and the semantic diff from the promoted asset.

Safe presets include compact single deck, large double deck, open-end bowl, half canopy, dome,
giant end-zone scoreboard, and sparse low-quality exterior. A preset still must match the selected
venue's locked native roof category and pass validation before it can be staged.

## Validate, budget, promote, preview, and roll back

Studio **Stage** writes only to `.stadium-staging/<stadium-id>.json`. For the committed Saltpan proof
scene, the headless adapter export is reproducible:

```bash
npm --prefix tools/pascal-stadium-studio run export:showcase
npm run stadium:validate -- --staged
npm run stadium:promote -- --file .stadium-staging/the-saltpan.json
npm run stadium:budget -- --stadium the-saltpan
npm run stadium:probe
npm run dev
```

Promotion reruns strict parsing, protected-volume checks, and all three budget tiers. It writes a
canonical local asset and deterministic registry, publishing the registry last. A failure restores
both tracked surfaces byte-for-byte. Existing overrides require an explicit `--replace`:

```bash
npm run stadium:promote -- --file .stadium-staging/the-saltpan.json --replace
```

Rollback immediately restores the procedural fallback and parks the reviewed JSON in the ignored
staging directory so it is recoverable:

```bash
npm run stadium:rollback -- --stadium the-saltpan
```

Use `npm run stadium:roundtrip` to prove all 18 legacy adapters canonicalize, and run the isolated
tool gates with:

```bash
npm run stadium:studio:typecheck
npm run stadium:studio:test
npm run stadium:studio:build
```

## Budget policy

The pure native semantic compiler counts actual loop segments and native primitive formulas, not
Pascal viewport calls. Receipts report triangles, vertices, native material batches/draw calls,
semantic elements, crowd capacity, static resource estimates, and the ratio to the open legacy
tier-3 Forgeworks Yard at each quality tier. Promotion fails if an authored venue exceeds 1.25×
the corresponding legacy triangle count, adds more than eight native material batches, exceeds the
semantic cap, or violates any strict contract limit. LOW uses fewer bowl segments and drops optional
MEDIUM/HIGH banners and skyline props before native construction.

## Pascal upgrade procedure

1. Review an exact upstream commit and its lockfile, public plugin types, license, Node version, and
   Bun version. Never change the host and published package line independently.
2. Update the commit/version constants and exact package versions; regenerate only the isolated
   lockfile.
3. Re-run the studio typecheck, tests, build, headless showcase export, native validation/budgets,
   production build, and browser stadium probe.
4. Inspect the root lock and production bundle to confirm editor packages remain absent.

Do not use floating tags or ranges for the Pascal host.

## AI/MCP status

No MCP server is enabled. The official `@pascal-app/mcp@0.3.2` package in the pinned source line
cannot safely author this plugin's custom node kinds: `SceneBridge.applyPatch(create)` validates
against the static core `AnyNodeSchema`, while the MCP process neither loads registry plugins nor
consumes `NodeDefinition.mcp`. Enabling it would reject or strip the MFD semantic nodes and would
not provide the required safe editing seam. A custom MCP server is deliberately out of scope.

If a future exact Pascal release exposes plugin-aware MCP validation, the only acceptable flow is
local AI host → visible undoable Pascal scene → ignored staged JSON → native validation and budgets
→ manual promotion. It must have no game-source write access and no automatic promotion. Candidate
prompts for that future supported seam are:

- “Open the away end between perimeter 0.43 and 0.57; keep every protected volume clear.”
- “Add one 29×11 yard live scoreboard at perimeter 0.74 and report all quality budgets.”
- “Move four light towers to active bowl segments and preserve native tower-light plumbing.”
- “Add two HIGH-only salt-rock skyline props outside the field apron.”
- “Show the semantic diff and stage the scene; do not promote it.”

Removal is simply deletion of any future local host MCP entry; the current repository installs no
entry, opens no MCP port, and holds no login or browser session.
