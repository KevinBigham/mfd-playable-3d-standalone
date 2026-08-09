# MFD Pascal Stadium Visual Studio

This is an isolated, development-only Pascal plugin and host adapter for authoring
MFD stadium presentation assets. It never joins the game runtime dependency graph.
The editable scene is football-semantic; the only handoff to MFD is strict,
canonical `mfd.stadium-visual` JSON in the ignored `.stadium-staging/` directory.
Promotion remains a separate root command.

## Reproducible pins

- Pascal source host: [`pascalorg/editor@99cc537e2538419536be86678a6139047a13af9d`](https://github.com/pascalorg/editor/tree/99cc537e2538419536be86678a6139047a13af9d)
- Published stable packages: `@pascal-app/core@0.9.2`,
  `@pascal-app/editor@0.9.2`, `@pascal-app/viewer@0.9.2`
- Other stable Pascal releases inspected at that host commit:
  `@pascal-app/nodes@0.1.1`, `@pascal-app/mcp@0.3.2`
- Official example pinned by the host lock:
  [`pascalorg/plugin-trees@56d978cd9b409b716207b3f3d269455d3cd6f067`](https://github.com/pascalorg/plugin-trees/tree/56d978cd9b409b716207b3f3d269455d3cd6f067)
- Bun: exactly `1.3.0`
- Node: `>=22.13.0`

The Pascal and React-family entries are exact `peerDependencies`, with exact
development copies for this package's own checks. This follows Pascal's public
[plugin authoring contract](https://github.com/pascalorg/editor/blob/99cc537e2538419536be86678a6139047a13af9d/wiki/architecture/plugin-authoring.md):
the host owns the live registries and React renderer.

The stable npm `latest` tags were checked on 2026-08-09. Pascal also publishes
`1.0.0-beta.*`; this integration deliberately does not float to the beta API.
The npm artifacts report git head `cdf026bb92426cb7bd2807ce447e029dadbdaa86`,
while the source host is pinned to the requested all-package release commit
above. Both pins are recorded rather than pretending they are the same commit.

## Install and launch

From the MFD repository root:

```bash
npm --prefix tools/pascal-stadium-studio ci --ignore-scripts
npm --prefix tools/pascal-stadium-studio run bootstrap:prereqs
npm run stadium:studio
```

`bootstrap:prereqs` installs Bun 1.3.0 only at
`tools/pascal-stadium-studio/.pascal-cache/bun/bin/bun`. It pre-seeds that
destination on the installer process's `PATH`, preventing the upstream installer
from editing `.zshrc`, `.bashrc`, or another shell profile. Bootstrap resolves Bun
in this order:

1. absolute `PASCAL_BUN`, if set;
2. the tool-local cache path above;
3. `bun` on `PATH`.

Any executable resolving to a version other than exactly 1.3.0 is rejected with
the corrective command. Bootstrap also requires Git, verifies the detached host
HEAD, uses `bun install --frozen-lockfile`, records a success receipt only after
the install completes, and refuses to begin that large install with less than
1.25 GiB free. On the verified macOS/APFS run the pinned `node_modules` measured
1.0 GiB, so the guard retains roughly 25% install headroom; the successful run
started with about 2.0 GiB free.

The deterministic host patch does three things:

1. copies a clean source snapshot under the ignored host app so Pascal, React,
   and Three peers resolve exclusively from the host (never this tool's dev tree);
2. composes `extendPluginDiscovery(async () => [mfdStadiumPlugin])` and registers
   `mfdStadiumHostPanel` through `registerEditorHostPanel`;
3. copies the local Node route that calls the native MFD validator/compiler and
   stages exports.

It then runs the pinned editor's own `check-types` command. `npm run studio`
performs the same verification and starts the official editor on port 3002 by
default. Set `PORT` to override the port.

## Authoring workflow

The MFD panel can import every one of the 18 locked native `StadiumDef` records
or load the committed `the-saltpan` showcase. It contributes these 11 versioned
node kinds through the public `Plugin` / `NodeDefinition` contract:

- `mfd:stadium-root`
- `mfd:field-reference`
- `mfd:bowl-plan`
- `mfd:deck-profile`
- `mfd:bowl-opening`
- `mfd:roof`
- `mfd:tunnel`
- `mfd:scoreboard`
- `mfd:light-tower`
- `mfd:banner`
- `mfd:skyline-prop`

The field and protected-volume references omit the selectable capability and are
never exported. Stadium identity, surface, sky, crowd/accent colors, and native
roof category remain inherited and locked. Editable lengths stay in MFD yards;
renderers and in-world handles apply the exact `1 yd = 0.9144 m` conversion only
at the Pascal boundary.

The locked preview mirrors the native field apron, both additional six-yard
end-camera lanes, and the native goal line/crossbar/upright/support coordinates.
Shared pure coordinate helpers also mirror the compiler's negated first deck
origin and ordered segment accumulation, `topR`/`topY`, feature inward yaw,
scoreboard/banner bottom-elevation centers, skyline base-elevation parts, and
light-tower bases at compiled `topY`. Roof preview uses `heightYd` as the exact
lowest shell surface, converts coverage to native radial depth, emits canopy
shells only along the selected sidelines, and derives the dome perimeter/panel
upward from the native elevations. Focused parity tests guard these mirrors.

Use Pascal's native right Inspector and declarative handles for constrained
edits. The panel exposes the public Zundo history behind `useScene.temporal` and
performs the same dirty/live-override refresh as Pascal's history helper. Scene
graphs, including `installedPlugins`, flow through Pascal's normal `Editor`
load/save contract; the official `EditorProps` defaults to localStorage when no
host `onLoad` / `onSave` callbacks are supplied.

The camera buttons use Pascal's public `CameraSchema`, `useViewer.setCameraMode`,
and `camera-controls:view` event. The four committed presets are:

- perspective;
- top, with a real `mode: 'orthographic'` saved camera;
- end zone;
- sideline.

The native MFD server adapter runs strict validation, protected-volume checks,
LOW/MEDIUM/HIGH compilation and budgets, stable hashing, and a semantic diff
against the promoted registry asset. Each quality receipt and every budget
violation is rendered in the panel. Any failed quality makes analysis invalid;
the export button is disabled while analysis is pending or any check fails.
Export writes staging only; it cannot promote or modify runtime assets.

### Native inspector bounds

The node schemas match the native validator. Notable bounds are bowl center Z
20–80 yd, half X `>37`–100 yd, half Z 70–160 yd, corner radius 4–60 yd, aisle
spacing 2–32, profile run 0–40 yd, and profile rise −80–60 yd. Feature bounds are:

| Feature | Native bounds |
|---|---|
| perimeter position | `0 <= t < 1` |
| tunnel | width 0.5–20 yd; height 1–12 yd |
| scoreboard | width 2–80; height 1–30; elevation 1–80; offset 0–50 yd |
| light tower | height 12–100; offset 0–50 yd |
| banner | width 0.5–30; height 0.5–12; elevation 0.5–80 yd |
| skyline position | X −200–200; Y 0–120; Z −150–250 yd |
| skyline size | X 0.5–80; Y 0.5–150; Z 0.5–80 yd |

A `none` roof derives zero coverage, height, and overhang. Canopy/dome presets
are available only when the locked native roof category is compatible. The
native validator is still authoritative for cross-node constraints such as
profile close-out, opening overlap, protected volumes, feature counts, and
budgets.

## The Saltpan proof export

This command is the deterministic proof seam requested by MFD:

```bash
npm --prefix tools/pascal-stadium-studio run export:showcase
```

It constructs the committed football-semantic showcase, converts it to a Pascal
scene, converts those nodes back to strict yard JSON, runs native validation and
all compiler budgets, adds only the volatile export timestamp after stable hash
calculation, and writes:

```text
.stadium-staging/the-saltpan.json
```

For a test-only destination inside this package:

```bash
npm --prefix tools/pascal-stadium-studio run export:showcase -- \
  --output-dir tools/pascal-stadium-studio/staging
```

The normal MFD handoff is:

```bash
npm run stadium:validate -- .stadium-staging/the-saltpan.json
npm run stadium:promote -- --file .stadium-staging/the-saltpan.json
npm run stadium:budget -- --stadium the-saltpan
```

If an override already exists, promotion intentionally requires `--replace`.
Rollback parks the asset recoverably in ignored staging and restores legacy
resolution:

```bash
npm run stadium:rollback -- --stadium the-saltpan
```

## Package gates

```bash
npm --prefix tools/pascal-stadium-studio run typecheck
npm --prefix tools/pascal-stadium-studio test
npm --prefix tools/pascal-stadium-studio run build
```

The focused suite covers all 11 kinds, exact yard/metre conversion, all four
cameras, all 18 legacy imports, scene↔visual roundtrip, exact native preview
coordinates and protected volumes, LOW/MEDIUM/HIGH budget failure UI/staging
policy, protected validation, volatile-free stable hash, semantic diff, every
safe preset, showcase staging, exact pins, shell-profile-safe prerequisite
install, deterministic host patch anchors, and root-package dependency isolation.

## Official MCP status and exact blocker

The official server is `@pascal-app/mcp@0.3.2` and its CLI is `pascal-mcp`.
It is useful for Pascal's built-in scene kinds. It cannot safely author these
custom MFD kinds today: `CreatePascalMcpServerOptions` has no plugin registry or
discovery option, create/validation paths parse the static core `AnyNode` schema,
and the MCP package never loads this plugin. Loading a saved graph can preserve
opaque custom nodes, but generic create/validate/edit is not a supported custom
node workflow. Therefore this tool does not build or ship a custom MCP server.

Official Codex configuration, pinned to the researched release, would be:

```bash
codex mcp add pascal \
  --env PASCAL_DATA_DIR="$HOME/.pascal/data" \
  -- bunx --package @pascal-app/mcp@0.3.2 pascal-mcp
```

Equivalent TOML:

```toml
[mcp_servers.pascal]
command = "bunx"
args = ["--package", "@pascal-app/mcp@0.3.2", "pascal-mcp"]

[mcp_servers.pascal.env]
PASCAL_DATA_DIR = "/absolute/path/to/.pascal/data"
```

Safe sample prompts are limited to built-in Pascal scenes, for example:

- “List the current Pascal scene and report invalid built-in nodes.”
- “Create a room with four walls, then undo the last mutation.”
- “Load the saved scene and describe its zones and dimensions.”

Do not prompt the stock MCP to create or patch `mfd:*` nodes. Use the MFD host
panel and staging seam until upstream exposes plugin loading to the MCP server.

## Upgrade and license policy

Upgrade Pascal only as a deliberate set: inspect the new official plugin guide
and example, update the detached host commit and exact peer/dev versions, refresh
the lockfile, verify every patch anchor, run the isolated gates, run the real host
typecheck, and re-export/validate The Saltpan. A missing patch anchor is a hard
failure, never a fuzzy patch.

Pascal Editor and the Nature example are MIT licensed. Keep the upstream checkout
license intact and retain the copyright and permission notice in substantial
copies or distributions. See [`LICENSE`](./LICENSE) and
[`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md).

Primary official references:

- [Pascal plugin guide at the host pin](https://github.com/pascalorg/editor/blob/99cc537e2538419536be86678a6139047a13af9d/wiki/architecture/plugin-authoring.md)
- [Core registry types (`Plugin`, `NodeDefinition`)](https://github.com/pascalorg/editor/blob/99cc537e2538419536be86678a6139047a13af9d/packages/core/src/registry/types.ts)
- [Discovery (`extendPluginDiscovery`)](https://github.com/pascalorg/editor/blob/99cc537e2538419536be86678a6139047a13af9d/packages/core/src/registry/registry.ts)
- [Editor host panel API](https://github.com/pascalorg/editor/blob/99cc537e2538419536be86678a6139047a13af9d/packages/editor/src/lib/plugin-panels.ts)
- [Editor persistence props](https://github.com/pascalorg/editor/blob/99cc537e2538419536be86678a6139047a13af9d/packages/editor/src/components/editor/index.tsx)
- [Undo/redo helper](https://github.com/pascalorg/editor/blob/99cc537e2538419536be86678a6139047a13af9d/packages/editor/src/lib/history.ts)
- [Official MCP README](https://github.com/pascalorg/editor/blob/99cc537e2538419536be86678a6139047a13af9d/packages/mcp/README.md)
- [MCP server options](https://github.com/pascalorg/editor/blob/99cc537e2538419536be86678a6139047a13af9d/packages/mcp/src/server.ts)
