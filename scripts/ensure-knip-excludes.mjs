#!/usr/bin/env node
/**
 * Ensures `.dev-perf/` is listed in the repository's `.git/info/exclude`
 * file, then runs nothing itself: this script is invoked by the `knip`
 * npm script right before `knip --production`.
 *
 * Why this is needed: knip's file walker crawls the whole tree to
 * discover `.gitignore` files, and the repo's own `.gitignore` is only
 * applied while that crawl is already in progress. A directory that is
 * gitignored can therefore still be traversed in full. `.git/info/exclude`
 * is the exception: knip preloads it before the walk starts, so a cache
 * directory listed there is pruned from the very first step. Without this
 * entry, a large `.dev-perf` clone cache (which can grow to multiple
 * gigabytes) is walked on every knip run and the process dies with a
 * JavaScript heap out of memory error.
 *
 * The script is idempotent: it exits quietly when the entry is already
 * present, when the working directory is not inside a git repository, or
 * when git is not installed.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const EXCLUDE_PATTERN = '.dev-perf/';
const MARKER = '# dev-perf clone cache (added by ensure-knip-excludes.mjs)';

let gitDir;
try {
  gitDir = execFileSync('git', ['rev-parse', '--git-dir'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
} catch {
  process.exit(0);
}

const excludeFile = join(resolve(process.cwd(), gitDir), 'info', 'exclude');
if (existsSync(excludeFile)) {
  const lines = readFileSync(excludeFile, 'utf8').split('\n');
  if (lines.some((line) => line.trim() === EXCLUDE_PATTERN)) {
    process.exit(0);
  }
}

mkdirSync(join(resolve(process.cwd(), gitDir), 'info'), { recursive: true });
appendFileSync(excludeFile, `\n${MARKER}\n${EXCLUDE_PATTERN}\n`);
console.error(`Added ${EXCLUDE_PATTERN} to ${excludeFile} (knip file-walk fix)`);
