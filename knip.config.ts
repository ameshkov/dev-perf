import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  entry: ['src/index.ts!'],
  project: ['src/**/*.ts!', '!src/**/*.test.ts'],
  tags: ['-internal'],
  // Plan step 7 introduces the LLM layer (src/llm/) with no production
  // importer yet; the pipeline wires it in step 9. `ignoreFiles` keeps
  // the modules out of the "Unused files" report only — their exports
  // stay analyzed via the `@internal` pattern — and
  // `ignoreDependencies` covers the opencode SDK packages, imported by
  // src/llm/server.ts. Remove both entries when the pipeline lands.
  ignoreFiles: ['src/llm/**'],
  ignoreDependencies: ['@opencode-ai/sdk', '@opencode-ai/plugin'],
};

export default config;
