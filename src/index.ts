#!/usr/bin/env node
/// <reference types="node" />

import dotenv from 'dotenv';
import { Command } from 'commander';
import { registerCommands } from './cli.js';
import { errorDetail } from './util/error.js';
import { logError } from './util/log.js';
import { appVersion } from './version.js';

async function main() {
  // Load .env from the current working directory so environment
  // variables referenced as ${ENV_VAR} inside config.yaml (e.g.
  // ${DEV_PERF_API_KEY}) work without shell exports.
  dotenv.config({ quiet: true });

  const program = new Command();

  program
    .name('dev-perf')
    .description(
      'Measure developer contributions to git repositories and produce a JSON report of per-user metrics',
    )
    .version(appVersion);

  registerCommands(program);

  await program.parseAsync();
}

main().catch((err) => {
  // errorDetail walks the cause chain, so network failures like
  // `TypeError: fetch failed` surface their real reason (e.g.
  // `connect ECONNREFUSED 127.0.0.1:50664`) instead of the bare text.
  // The LLM layer runs fully in-process, so nothing keeps the event
  // loop alive once the pipeline settles — a non-zero exit code lets
  // the process terminate naturally.
  logError(`dev-perf: ${errorDetail(err)}`);
  process.exitCode = 1;
});
