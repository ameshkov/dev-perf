import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  entry: ['src/index.ts!'],
  project: ['src/**/*.ts!', '!src/**/*.test.ts'],
  tags: ['-internal'],
  // Plan steps 2-4 introduce modules with no production importer yet
  // (repo/, util/, deterministic/); the pipeline wires them in step 5.
  // `ignoreFiles` keeps them out of the "Unused files" report only —
  // their exports stay analyzed via the `@internal` pattern — and
  // `ignoreDependencies` covers execa, imported by src/repo/git.ts.
  // Remove both entries when the pipeline lands.
  ignoreFiles: ['src/repo/**', 'src/util/**', 'src/deterministic/**'],
  ignoreDependencies: ['execa'],
};

export default config;
