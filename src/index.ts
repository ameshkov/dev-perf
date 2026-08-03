#!/usr/bin/env node
/// <reference types="node" />

import { createRequire } from 'node:module';
import dotenv from 'dotenv';
import { Command } from 'commander';
import { registerCommands } from './cli.js';
import { errorDetail } from './util/error.js';
import { logError } from './util/log.js';

const { version } = createRequire(import.meta.url)('../package.json') as {
  version: string;
};

async function main() {
  // Load .env from the current working directory so DEV_PERF_API_KEY (and
  // any other dev-perf environment variables) work without shell exports.
  dotenv.config({ quiet: true });

  const program = new Command();

  program
    .name('dev-perf')
    .description(
      'Measure developer contributions to git repositories and produce a JSON report of per-user metrics',
    )
    .version(version);

  registerCommands(program);

  await program.parseAsync();
}

main().catch((err) => {
  // errorDetail walks the cause chain, so network failures like
  // `TypeError: fetch failed` surface their real reason (e.g.
  // `connect ECONNREFUSED 127.0.0.1:50664`) instead of the bare text.
  logError(`dev-perf: ${errorDetail(err)}`);
  process.exitCode = 1;
  process.exit(1);
});
