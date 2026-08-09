import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const TOOL_ROOT = resolve(import.meta.dirname, '..')

describe('deterministic source-host bootstrap', () => {
  it('pins the exact Pascal checkout and local Bun prerequisite', async () => {
    const source = await readFile(resolve(TOOL_ROOT, 'scripts/bootstrap.mjs'), 'utf8')
    expect(source).toContain('99cc537e2538419536be86678a6139047a13af9d')
    expect(source).toContain("const BUN_VERSION = '1.3.0'")
    expect(source).toContain('process.env.PASCAL_BUN')
    expect(source).toContain("'.pascal-cache', 'bun', 'bin', 'bun'")
    expect(source).toContain('npm --prefix tools/pascal-stadium-studio run bootstrap:prereqs')
    expect(source).toContain("['install', '--frozen-lockfile']")
    expect(source).toContain('MIN_HOST_INSTALL_BYTES = 1.25 * 1024 ** 3')
    expect(source).toContain('HOST_INSTALL_RECEIPT')
  })

  it('keeps the local Bun installer from rewriting shell profiles', async () => {
    const source = await readFile(resolve(TOOL_ROOT, 'scripts/install-bun.mjs'), 'utf8')
    expect(source).toContain("PATH: `${resolve(BUN_INSTALL, 'bin')}:${process.env.PATH ?? ''}`")
    expect(source).not.toContain('.zshrc')
    expect(source).not.toContain('.bashrc')
    expect(source).not.toContain('SHELL:')
  })

  it('patches only the public discovery and host-panel surfaces', async () => {
    const source = await readFile(resolve(TOOL_ROOT, 'scripts/bootstrap.mjs'), 'utf8')
    expect(source).toContain('extendPluginDiscovery(async () => [mfdStadiumPlugin])')
    expect(source).toContain('registerEditorHostPanel(mfdStadiumHostPanel)')
    expect(source).not.toContain('loadPlugin(mfdStadiumPlugin)')
    expect(source).toContain('writeCleanHostPluginCopy')
    expect(source).toContain("'apps', 'editor', 'mfd-stadium-studio'")
    expect(source).toContain('removeLiteral(nextConfig')
  })

  it('keeps Pascal/React tooling isolated with exact package and lock pins', async () => {
    const studioPackage = JSON.parse(await readFile(resolve(TOOL_ROOT, 'package.json'), 'utf8')) as {
      packageManager: string
      peerDependencies: Record<string, string>
      devDependencies: Record<string, string>
    }
    const rootPackage = JSON.parse(await readFile(resolve(TOOL_ROOT, '..', '..', 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
      devDependencies: Record<string, string>
    }
    const lock = JSON.parse(await readFile(resolve(TOOL_ROOT, 'package-lock.json'), 'utf8')) as { lockfileVersion: number }
    expect(studioPackage.packageManager).toBe('bun@1.3.0')
    expect(studioPackage.peerDependencies['@pascal-app/core']).toBe('0.9.2')
    expect(studioPackage.peerDependencies['@pascal-app/editor']).toBe('0.9.2')
    expect(studioPackage.peerDependencies['@pascal-app/viewer']).toBe('0.9.2')
    for (const version of [...Object.values(studioPackage.peerDependencies), ...Object.values(studioPackage.devDependencies)]) {
      expect(version).not.toMatch(/^[~^*>]|latest/)
    }
    expect({ ...rootPackage.dependencies, ...rootPackage.devDependencies }).not.toHaveProperty('@pascal-app/core')
    expect(lock.lockfileVersion).toBe(3)
  })
})
