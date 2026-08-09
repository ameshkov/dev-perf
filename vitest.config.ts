import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // The `.dev-perf` clone cache contains full copies of analyzed
    // repositories, including their own test suites; exclude it so
    // those tests are never discovered or run. The `viewer` directory
    // is an independent web app with its own vitest setup and test
    // environment; its tests run from inside `viewer/` only.
    exclude: [...configDefaults.exclude, '**/.dev-perf/**', 'viewer/**'],
  },
});
