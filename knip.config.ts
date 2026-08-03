import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  entry: ['src/index.ts!'],
  project: ['src/**/*.ts!', '!src/**/*.test.ts'],
  tags: ['-internal'],
  // `pgrep` is a macOS/Linux system utility invoked by the LLM server
  // teardown (`src/llm/shutdown.ts`); it is not installable via npm
  // and is absent from knip's default binary allowlist (which already
  // covers `lsof`).
  ignoreBinaries: ['pgrep'],
};

export default config;
