import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const TOOL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BUN_INSTALL = resolve(TOOL_ROOT, '.pascal-cache', 'bun')
const VERSION = '1.3.0'

await mkdir(BUN_INSTALL, { recursive: true })
const command = `curl -fsSL https://bun.sh/install | bash -s "bun-v${VERSION}"`
const result = spawnSync('/bin/bash', ['-lc', command], {
  cwd: TOOL_ROOT,
  // The upstream installer skips shell-profile edits when `bun` resolves on
  // PATH after extraction. Prepending the destination makes this install
  // strictly tool-local even on a machine without a global Bun executable.
  env: {
    ...process.env,
    BUN_INSTALL,
    PATH: `${resolve(BUN_INSTALL, 'bin')}:${process.env.PATH ?? ''}`,
  },
  encoding: 'utf8',
  stdio: 'inherit',
})
if (result.status !== 0) process.exit(result.status ?? 1)

const bun = resolve(BUN_INSTALL, 'bin', 'bun')
const check = spawnSync(bun, ['--version'], { encoding: 'utf8' })
if (check.status !== 0 || check.stdout.trim() !== VERSION) {
  console.error(`Bun install verification failed: expected ${VERSION}, received ${check.stdout.trim() || '<no version>'}`)
  process.exit(1)
}
console.log(`Pinned Bun ${VERSION} installed locally at ${bun}`)
