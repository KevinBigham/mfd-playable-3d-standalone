import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['.pascal-host/**', 'node_modules/**'],
    environment: 'node',
    server: {
      deps: {
        // Published core@0.9.2 uses extensionless internal ESM specifiers.
        // Inline it so Vite performs the same resolution as the official Next host.
        inline: ['@pascal-app/core'],
      },
    },
  },
})
