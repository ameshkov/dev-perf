import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  entry: ['src/main.tsx!', 'index.html'],
  project: ['src/**/*.{ts,tsx}!', '!src/**/*.test.{ts,tsx}'],
  tags: ['-internal'],
};

export default config;
