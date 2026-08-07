/**
 * Logging-behavior tests for the pipeline: the always-visible startup
 * block and command start/end markers, the verbose progress lines, and
 * the marker-pair bracketing of failed runs.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { buildFixtureRepo, removeFixtureRepo } from '../test/fixtures/repo-builder.js';
import type { ReportOptions } from './config.js';
import { runPipeline } from './pipeline.js';
import { prettyJson } from './util/json.js';
import { appVersion } from './version.js';

/** Defaults for a deterministic-only pipeline run. */
function options(overrides: Partial<ReportOptions> = {}): ReportOptions {
  return {
    repos: [],
    llm: false,
    limitContext: 262144,
    limitOutput: 65536,
    llmRetries: 2,
    parallel: 1,
    ...overrides,
  };
}

describe('runPipeline logging', () => {
  it('with --verbose logs the startup block and progress to stderr while stdout carries the report JSON only', async () => {
    const repo = await buildFixtureRepo([
      {
        author: { name: 'Alice', email: 'alice@example.com' },
        date: '2026-01-01T10:00:00Z',
        message: 'init',
        files: [{ path: 'a.txt', content: 'a\n' }],
      },
    ]);
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-pipeline-cache-'));
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const runOptions = options({
        repos: [repo.url],
        cacheDir,
        verbose: true,
        since: '2026-01-01T00:00:00Z',
      });
      const report = await runPipeline(runOptions);

      const stderr = stderrWrite.mock.calls.map((call) => String(call[0])).join('');
      // The startup block: application version, then the configuration
      // as one indented line per field.
      expect(stderr).toContain(`dev-perf ${appVersion}`);
      expect(stderr).toContain('configuration:');
      expect(stderr).toContain('    - ' + repo.url);
      expect(stderr).toContain(`  cacheDir: ${cacheDir}`);
      expect(stderr).toContain('  verbose: true');
      // The command start/end pair brackets the whole run: the start
      // line comes first, the outcome (with duration) last.
      expect(stderr).toContain('starting report');
      expect(stderr).toMatch(/finished report in \d+ ms/);
      // Then the verbose progress lines: the clone start is logged
      // before the clone runs, the outcome with its duration after;
      // both name the cache entry directory (its hash).
      expect(stderr).toMatch(/cloning ".+" \(cache ".+"\)/);
      expect(stderr).toMatch(/cloned .* in \d+ ms \(cache ".+"\)/);
      expect(stderr).toContain('(cache "');
      expect(stderr).toContain('range: 2026-01-01T00:00:00.000Z to');
      expect(stderr).toContain('reading commits');
      expect(stderr).toContain('1 commit from 1 author');

      // Stdout carries the report JSON alone — the configuration never
      // reaches stdout.
      const stdout = stdoutWrite.mock.calls.map((call) => String(call[0])).join('');
      expect(stdout).toBe(prettyJson(report));
    } finally {
      vi.restoreAllMocks();
      await rm(cacheDir, { recursive: true, force: true });
      await removeFixtureRepo(repo);
    }
  });

  it('logs the finish marker even when the run fails', async () => {
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-pipeline-cache-'));
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      // A clone failure throws before the report is assembled; a
      // nonexistent local path fails fast (no network); the start/end
      // marker pair still brackets the failed run.
      await expect(
        runPipeline(options({ repos: ['/nonexistent/repo/path'], cacheDir })),
      ).rejects.toThrow();

      const stderr = stderrWrite.mock.calls.map((call) => String(call[0])).join('');
      expect(stderr).toContain('starting report');
      expect(stderr).toMatch(/finished report in \d+ ms/);
    } finally {
      vi.restoreAllMocks();
      await rm(cacheDir, { recursive: true, force: true });
    }
  });

  it('a default run prints the startup block and command markers on stderr, with no progress lines', async () => {
    const repo = await buildFixtureRepo([
      {
        author: { name: 'Alice', email: 'alice@example.com' },
        date: '2026-01-01T10:00:00Z',
        message: 'init',
        files: [{ path: 'a.txt', content: 'a\n' }],
      },
    ]);
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-pipeline-cache-'));
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      await runPipeline(options({ repos: [repo.url], cacheDir }));

      const stderr = stderrWrite.mock.calls.map((call) => String(call[0])).join('');
      // The startup block and the command start/end markers are always
      // logged, even in quiet mode…
      expect(stderr).toContain(`dev-perf ${appVersion}`);
      expect(stderr).toContain('configuration:');
      expect(stderr).toContain('  verbose: false');
      expect(stderr).toContain('starting report');
      expect(stderr).toMatch(/finished report in \d+ ms/);
      // …but nothing else: progress lines stay hidden without
      // `--verbose`.
      expect(stderr).not.toMatch(/cloned|cloning|reading|range:|commit/);
    } finally {
      vi.restoreAllMocks();
      await rm(cacheDir, { recursive: true, force: true });
      await removeFixtureRepo(repo);
    }
  });
});
