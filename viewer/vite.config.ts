import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The built app is a plain static site (no server side), emitted to
// `build/` like the parent dev-perf CLI. `base: './'` keeps asset
// references relative so the build can be served from any path.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'build',
    emptyOutDir: true,
    // The app ships ECharts plus React as a single static bundle; the
    // default 500 kB warning is expected and not actionable here.
    chunkSizeWarningLimit: 1000,
  },
});
