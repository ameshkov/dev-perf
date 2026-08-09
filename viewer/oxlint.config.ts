import { defineConfig } from 'oxlint';

// Oxlint config for dev-perf-viewer, mirroring the parent dev-perf
// rules: oxlint groups rules into categories rather than a single
// `recommended` preset. Only `correctness` (error) is enabled, plus
// the same explicit project rules as the parent (`no-unused-vars`,
// `max-lines`, `max-lines-per-function`, `preserve-caught-error`).
// The `react` plugin is enabled on top for the JSX sources; the
// stricter/stylistic categories stay off for the same reasons as in
// the parent project (they forbid idiomatic modern TypeScript).
export default defineConfig({
  env: {
    browser: true,
    es2022: true,
  },
  categories: {
    correctness: 'error',
  },
  plugins: ['typescript', 'react'],
  rules: {
    'no-unused-vars': [
      'error',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      },
    ],
    'max-lines': [
      'error',
      {
        max: 300,
        skipBlankLines: true,
        skipComments: true,
      },
    ],
    'max-lines-per-function': [
      'error',
      {
        max: 50,
        skipBlankLines: true,
        skipComments: true,
      },
    ],
    'preserve-caught-error': 'error',
  },
  overrides: [
    {
      files: ['**/*.test.ts', '**/*.test.tsx', 'test/**'],
      rules: {
        'max-lines-per-function': 'off',
        'max-lines': [
          'error',
          {
            max: 500,
            skipBlankLines: true,
            skipComments: true,
          },
        ],
      },
    },
  ],
});
