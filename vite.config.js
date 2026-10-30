import { defineConfig } from 'vite';

// Relative base so the built game works from any folder / static host.
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1500,
  },
});
