import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The Pascal studio is an independent package with its own lockfile, TypeScript version,
    // dependencies and Vitest command. Root tests must never resolve or execute editor packages.
    exclude: [...configDefaults.exclude, 'tools/pascal-stadium-studio/**'],
  },
});
