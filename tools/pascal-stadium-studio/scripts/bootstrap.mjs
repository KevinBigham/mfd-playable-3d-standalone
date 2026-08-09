import { spawnSync } from 'node:child_process'
import { access, cp, mkdir, readFile, rm, statfs, writeFile } from 'node:fs/promises'
import { delimiter, dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const TOOL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const HOST_ROOT = resolve(TOOL_ROOT, '.pascal-host', 'editor')
const HOST_COMMIT = '99cc537e2538419536be86678a6139047a13af9d'
const HOST_REPOSITORY = 'https://github.com/pascalorg/editor.git'
const BUN_VERSION = '1.3.0'
const LOCAL_BUN = resolve(TOOL_ROOT, '.pascal-cache', 'bun', 'bin', 'bun')
const HOST_INSTALL_RECEIPT = resolve(HOST_ROOT, `.mfd-bun-install-${HOST_COMMIT}`)
// Measured pinned host dependency tree is expected to remain below ~1 GiB on
// APFS/Bun; require 1.25 GiB so bootstrap retains roughly 25% install headroom.
const MIN_HOST_INSTALL_BYTES = 1.25 * 1024 ** 3

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? TOOL_ROOT,
    env: options.env ?? process.env,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
  })
  if (result.status !== 0 && !options.allowFailure) {
    const detail = result.stderr?.trim() || result.stdout?.trim()
    throw new Error(`${command} ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`)
  }
  return result
}

async function exists(path) {
  try { await access(path); return true } catch { return false }
}

function pathCandidates(binary) {
  return (process.env.PATH ?? '').split(delimiter).filter(Boolean).map((entry) => resolve(entry, binary))
}

async function bunPath() {
  const candidates = [process.env.PASCAL_BUN, LOCAL_BUN, ...pathCandidates('bun')].filter(Boolean)
  for (const candidate of candidates) {
    if (!(await exists(candidate))) continue
    const result = run(candidate, ['--version'], { capture: true, allowFailure: true })
    const version = result.stdout.trim()
    if (result.status === 0 && version === BUN_VERSION) return candidate
    if (result.status === 0) {
      throw new Error([
        `Pascal Stadium Visual Studio requires Bun exactly ${BUN_VERSION}; ${candidate} is ${version}.`,
        'Install the pinned local runtime with: npm --prefix tools/pascal-stadium-studio run bootstrap:prereqs',
        `Or set PASCAL_BUN to an absolute Bun ${BUN_VERSION} executable.`,
      ].join('\n'))
    }
  }
  throw new Error([
    `Pascal Stadium Visual Studio requires Bun exactly ${BUN_VERSION}; no compatible executable was found.`,
    'Install without global mutation: npm --prefix tools/pascal-stadium-studio run bootstrap:prereqs',
    `Expected local path: ${LOCAL_BUN}`,
    `Or set PASCAL_BUN to an absolute Bun ${BUN_VERSION} executable.`,
    `Official pinned install command: BUN_INSTALL="${resolve(TOOL_ROOT, '.pascal-cache', 'bun')}" curl -fsSL https://bun.sh/install | bash -s "bun-v${BUN_VERSION}"`,
  ].join('\n'))
}

async function verifyNode() {
  const [major, minor] = process.versions.node.split('.').map(Number)
  if (major < 22 || (major === 22 && minor < 13)) {
    throw new Error(`Node >=22.13.0 is required by the deterministic Pascal host bootstrap; found ${process.version}.`)
  }
  run('git', ['--version'], { capture: true })
}

async function verifyHostInstallCapacity() {
  const disk = await statfs(HOST_ROOT)
  const available = Number(disk.bavail) * Number(disk.bsize)
  if (available < MIN_HOST_INSTALL_BYTES) {
    throw new Error([
      'Pascal host dependency install cannot start: insufficient free disk space.',
      `Required: at least ${(MIN_HOST_INSTALL_BYTES / 1024 ** 3).toFixed(1)} GiB free; available: ${(available / 1024 ** 3).toFixed(2)} GiB.`,
      `Free disk space, then rerun: npm --prefix tools/pascal-stadium-studio run bootstrap`,
      `The pinned source checkout is preserved at ${HOST_ROOT}.`,
    ].join('\n'))
  }
}

async function prepareCheckout() {
  await mkdir(dirname(HOST_ROOT), { recursive: true })
  if (!(await exists(resolve(HOST_ROOT, '.git')))) {
    if (await exists(HOST_ROOT)) {
      throw new Error(`Refusing to replace non-checkout path ${HOST_ROOT}; remove it manually after inspection.`)
    }
    await mkdir(HOST_ROOT, { recursive: true })
    run('git', ['init'], { cwd: HOST_ROOT })
    run('git', ['remote', 'add', 'origin', HOST_REPOSITORY], { cwd: HOST_ROOT })
    run('git', ['fetch', '--depth=1', 'origin', HOST_COMMIT], { cwd: HOST_ROOT })
    run('git', ['checkout', '--detach', 'FETCH_HEAD'], { cwd: HOST_ROOT })
  }
  const head = run('git', ['rev-parse', 'HEAD'], { cwd: HOST_ROOT, capture: true }).stdout.trim()
  if (head !== HOST_COMMIT) {
    throw new Error(`Pascal checkout mismatch at ${HOST_ROOT}: expected ${HOST_COMMIT}, found ${head}.`)
  }
}

async function replaceOnce(path, needle, replacement) {
  const original = await readFile(path, 'utf8')
  if (original.includes(replacement)) return
  if (!original.includes(needle)) throw new Error(`Pinned host patch anchor not found in ${path}: ${needle}`)
  await writeFile(path, original.replace(needle, replacement), 'utf8')
}

async function removeLiteral(path, literal) {
  const original = await readFile(path, 'utf8')
  if (!original.includes(literal)) return
  await writeFile(path, original.replaceAll(`${literal}\n`, '').replaceAll(literal, ''), 'utf8')
}

async function writeCleanHostPluginCopy() {
  // A package-directory symlink makes tsgo realpath into this tool's dev
  // node_modules, producing duplicate React/Three type universes. Keep a clean
  // generated copy inside the app so all peers resolve from the pinned host.
  const obsoleteLink = resolve(HOST_ROOT, 'packages', 'mfd-stadium-studio')
  await rm(obsoleteLink, { recursive: true, force: true })
  const target = resolve(HOST_ROOT, 'apps', 'editor', 'mfd-stadium-studio')
  await rm(target, { recursive: true, force: true })
  await mkdir(target, { recursive: true })
  await cp(resolve(TOOL_ROOT, 'src'), resolve(target, 'src'), { recursive: true })

  // Keep client types inside the host TypeScript program instead of pulling
  // MFD's differently-configured source tree into tsgo.
  await cp(
    resolve(TOOL_ROOT, '..', '..', 'src', 'render', 'stadiumVisual', 'types.ts'),
    resolve(target, 'src', 'mfd-native-types.ts'),
  )
  const contract = resolve(target, 'src', 'contract.ts')
  const contractSource = await readFile(contract, 'utf8')
  await writeFile(
    contract,
    contractSource.replace("'../../../src/render/stadiumVisual/types.ts'", "'./mfd-native-types'"),
    'utf8',
  )

  // Native validation/compiler code remains authoritative and tool-local. The
  // Node route loads it at runtime through a non-literal URL, so host tsgo does
  // not absorb MFD's separate source program or its dependency universe.
  const toolServerUrl = pathToFileURL(resolve(TOOL_ROOT, 'src', 'server.ts')).href
  await writeFile(resolve(target, 'src', 'server.ts'), `
type ToolServer = {
  analyzeVisualCandidate(input: unknown): unknown
  listLegacyDefinitions(): unknown
  stageVisualCandidate(input: unknown): Promise<unknown>
}

const TOOL_SERVER_URL = ${JSON.stringify(toolServerUrl)}
let toolServerPromise: Promise<ToolServer> | undefined
function toolServer(): Promise<ToolServer> {
  toolServerPromise ??= import(TOOL_SERVER_URL) as Promise<ToolServer>
  return toolServerPromise
}

export async function analyzeVisualCandidate(input: unknown): Promise<unknown> {
  return (await toolServer()).analyzeVisualCandidate(input)
}

export async function listLegacyDefinitions(): Promise<unknown> {
  return (await toolServer()).listLegacyDefinitions()
}

export async function stageVisualCandidate(input: unknown): Promise<unknown> {
  return (await toolServer()).stageVisualCandidate(input)
}
`, 'utf8')
}

async function applyHostPatch() {
  await writeCleanHostPluginCopy()
  const bootstrap = resolve(HOST_ROOT, 'apps', 'editor', 'lib', 'bootstrap.ts')
  await removeLiteral(
    bootstrap,
    `import { mfdStadiumHostPanel, mfdStadiumPlugin } from '../../../packages/mfd-stadium-studio/src/index'`,
  )
  await removeLiteral(
    bootstrap,
    `import { mfdStadiumHostPanel, mfdStadiumPlugin } from '../mfd-stadium-studio/src/index'`,
  )
  await replaceOnce(
    bootstrap,
    `import { treesHostPanel, treesPlugin } from '@pascal-app/plugin-trees'`,
    `import { treesHostPanel, treesPlugin } from '@pascal-app/plugin-trees'\nimport { mfdStadiumHostPanel, mfdStadiumPlugin } from '../mfd-stadium-studio/src/index'`,
  )
  await replaceOnce(
    bootstrap,
    `registerEditorHostPanel(treesHostPanel)`,
    `registerEditorHostPanel(treesHostPanel)\nextendPluginDiscovery(async () => [mfdStadiumPlugin])\nregisterEditorHostPanel(mfdStadiumHostPanel)`,
  )
  const nextConfig = resolve(HOST_ROOT, 'apps', 'editor', 'next.config.ts')
  await removeLiteral(nextConfig, `    '@mfd/pascal-stadium-studio',`)
  const route = resolve(HOST_ROOT, 'apps', 'editor', 'app', 'api', 'mfd-stadium-studio', 'route.ts')
  await mkdir(dirname(route), { recursive: true })
  await cp(resolve(TOOL_ROOT, 'host-template', 'route.ts'), route)
}

async function main() {
  await verifyNode()
  if (process.argv.includes('--self-test')) {
    console.log(JSON.stringify({ hostCommit: HOST_COMMIT, bunVersion: BUN_VERSION, hostRoot: HOST_ROOT }))
    return
  }
  const bun = await bunPath()
  const hostEnv = {
    ...process.env,
    PATH: `${dirname(bun)}${delimiter}${process.env.PATH ?? ''}`,
  }
  await prepareCheckout()
  if (!(await exists(HOST_INSTALL_RECEIPT))) {
    await verifyHostInstallCapacity()
    run(bun, ['install', '--frozen-lockfile'], { cwd: HOST_ROOT, env: hostEnv })
    await writeFile(HOST_INSTALL_RECEIPT, `${HOST_COMMIT}\nbun ${BUN_VERSION}\n`, 'utf8')
  }
  await applyHostPatch()
  run(bun, ['run', 'check-types', '--filter=editor'], { cwd: HOST_ROOT, env: hostEnv })
  console.log(`Pascal host ready: ${HOST_ROOT}`)
  console.log(`Pinned commit: ${HOST_COMMIT}; Bun: ${BUN_VERSION}`)
  if (process.argv.includes('--run')) {
    run(bun, ['run', '--cwd', 'apps/editor', 'dev'], {
      cwd: HOST_ROOT,
      env: { ...hostEnv, PORT: process.env.PORT ?? '3002' },
    })
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
