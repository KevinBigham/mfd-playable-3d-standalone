import { defineConfig } from 'vite';

/**
 * Build variant for the single-file artifact.
 *
 * Two differences from the normal build, both forced by "one HTML file, no network":
 *  - everything lands in ONE javascript chunk, because two inlined `<script type="module">`
 *    blocks cannot resolve an import specifier between them;
 *  - the css is not split, so there is exactly one stylesheet to inline.
 *
 * `tools/artifact.ts` then folds the js and css into the html.
 */
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist-artifact',
    sourcemap: false,
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 4000,
    modulePreload: { polyfill: false },
    rollupOptions: {
      output: {
        // A classic script, not a module. One file has no imports to resolve, and a plain
        // script embeds cleanly in contexts where module scripts are treated differently.
        format: 'iife',
        inlineDynamicImports: true,
        manualChunks: undefined,
        entryFileNames: 'game.js',
        assetFileNames: 'game.[ext]',
      },
    },
  },
});
