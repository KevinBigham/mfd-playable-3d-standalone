import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const expected = {
  '@pascal-app/core': '0.9.2',
  '@pascal-app/editor': '0.9.2',
  '@pascal-app/viewer': '0.9.2',
  react: '19.2.4',
  three: '0.185.1',
}
for (const [name, version] of Object.entries(expected)) {
  if (pkg.peerDependencies[name] !== version) throw new Error(`${name} peer must be pinned to ${version}`)
  if (pkg.devDependencies[name] !== version) throw new Error(`${name} development copy must be pinned to ${version}`)
}
if (pkg.packageManager !== 'bun@1.3.0') throw new Error('packageManager must be bun@1.3.0')
for (const group of ['peerDependencies', 'devDependencies']) {
  for (const [name, version] of Object.entries(pkg[group])) {
    if (/^[~^*>]|latest/.test(version)) throw new Error(`${group}.${name} is not exact: ${version}`)
  }
}
const selfTest = spawnSync(process.execPath, [resolve(root, 'scripts', 'bootstrap.mjs'), '--self-test'], {
  cwd: root,
  encoding: 'utf8',
})
if (selfTest.status !== 0) throw new Error(selfTest.stderr || selfTest.stdout)
const receipt = JSON.parse(selfTest.stdout)
if (receipt.hostCommit !== '99cc537e2538419536be86678a6139047a13af9d') {
  throw new Error(`unexpected Pascal host pin ${receipt.hostCommit}`)
}
console.log('studio package pins, source-host patch, and bootstrap self-test: PASS')
