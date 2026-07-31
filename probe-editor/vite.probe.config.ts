import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    outDir: '/tmp/probe-dist',
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: { input: 'probe-editor/index.html' },
  },
});
