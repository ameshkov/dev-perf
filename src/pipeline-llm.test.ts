/**
 * Tests for the LLM phase of the pipeline: with LLM
 * analysis enabled, the pipeline starts one opencode server per
 * repository, drives the real session service and orchestration, and
 * merges the completed per-user analyses into the report; LLM failures
 * fail fast with a clear message and no report is written.
 * `startServer` is stubbed at the module boundary — the real
 * server lifecycle is covered by `server.test.ts` and the
 * `DEV_PERF_SMOKE` test — and the stub client stands in for the
 * generated `devperf_report` tool by writing the session's report file.
 */
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Event, OpencodeClient } from '@opencode-ai/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildFixtureRepo, removeFixtureRepo } from '../test/fixtures/repo-builder.js';
import type { CliOptions } from './config.js';
import { startServer } from './llm/server.js';
import type { LlmServerConfig } from './llm/server.js';
import { runPipeline } from './pipeline.js';
import { entryHash } from './repo/cache.js';
import type { LlmToolPayload } from './report/index.js';
import { writeJsonFile } from './util/json.js';

vi.mock('./llm/server.js', () => ({
  ANALYST_AGENT_ID: 'devperf-analyst',
  startServer: vi.fn(),
}));

/** Behavior of the stubbed opencode client. */
interface StubState {
  /** Whether a prompt makes the model "call" `devperf_report`. */
  callTool: boolean;
  /** Payload the simulated tool call writes to the session's report file. */
  payload: LlmToolPayload;
  /** Assistant text returned for every prompt. */
  replyText: string;
  /** When set, the user's analysis prompt rejects with this error. */
  promptError?: Error;
  /**
   * How many analysis prompts reject before succeeding (tests the
   * pipeline's retry behavior); `undefined`/0 reject never.
   */
  promptFailures?: number;
}

/** The payload the stub reports through `devperf_report`. */
const PAYLOAD: LlmToolPayload = {
  overview: 'Shipped the pipeline.',
  contributions: [
    {
      title: 'Add pipeline',
      summary: 'Wired clone to report assembly.',
      types: ['feature'],
      complexity: 'medium',
      complexityReasoning: 'Several modules touched.',
      size: 'l',
      sizeReasoning: 'Spans the whole pipeline.',
      areas: ['src'],
      commits: ['abc1234d'],
      qualitySignals: ['tests-added'],
      riskFlags: [],
    },
  ],
};

/** An event stream with no usage events (zero usage for every session). */
async function* emptyStream(): AsyncGenerator<Event> {}

/**
 * Builds a minimal opencode client stub (the v1 API surface the
 * session layer uses) whose prompts write the session's report file —
 * the same effect the generated `devperf_report` tool has on a real
 * server. The report file lands in `<entry>/llm/<sessionID>.json`,
 * where the enforcement loop reads it.
 *
 * @param state - Whether and what the simulated model reports.
 * @returns The stubbed client.
 */
function stubClient(state: StubState): OpencodeClient {
  let counter = 0;
  return {
    auth: { set: vi.fn(async () => ({ data: undefined, error: undefined })) },
    session: {
      create: vi.fn(async (args: { query: { directory: string } }) => ({
        data: {
          id: `ses_${++counter}`,
          directory: args.query.directory,
          title: 't',
          version: '1',
        },
        error: undefined,
      })),
      prompt: vi.fn(
        async (args: {
          path: { id: string };
          query: { directory: string };
          body: {
            noReply?: boolean;
            parts?: Array<{ type: string; text: string }>;
          };
        }) => {
          // Reject only on the user's analysis prompt (it is the only
          // one that carries the user's email); orientation and the
          // noReply context injection keep working. With
          // `promptFailures` set, that many analysis prompts reject
          // before succeeding (retry tests); without it, every
          // analysis prompt with a `promptError` rejects.
          const analysisPrompt = args.body.parts?.some((part) =>
            part.text.includes('alice@example.com'),
          );
          if (analysisPrompt === true && state.promptError !== undefined) {
            const failures = state.promptFailures;
            if (failures === undefined || failures > 0) {
              if (failures !== undefined) {
                state.promptFailures = failures - 1;
              }
              throw state.promptError;
            }
          }
          if (args.body.noReply !== true && state.callTool) {
            const llmDir = path.join(path.dirname(args.query.directory), 'llm');
            await writeJsonFile(path.join(llmDir, `${args.path.id}.json`), state.payload);
          }
          return {
            data: {
              info: { id: `msg_${args.path.id}`, sessionID: args.path.id, role: 'assistant' },
              parts: [{ type: 'text', text: state.replyText }],
            },
            error: undefined,
          };
        },
      ),
      abort: vi.fn(async () => ({ data: undefined, error: undefined })),
    },
    event: {
      subscribe: vi.fn(async () => ({ stream: emptyStream() })),
    },
  } as unknown as OpencodeClient;
}

/** Defaults for an LLM-enabled pipeline run. */
function options(overrides: Partial<CliOptions> = {}): CliOptions {
  return {
    repos: [],
    llm: true,
    model: 'gpt-4.1',
    providerUrl: 'https://llm.example.com/v1',
    apiKey: 'sk-test-123',
    limitContext: 262144,
    limitOutput: 65536,
    llmRetries: 2,
    ...overrides,
  };
}

/** Installs the `startServer` stub and returns its `close` spy. */
function stubServer(state: StubState): { close: ReturnType<typeof vi.fn> } {
  const close = vi.fn(async () => {});
  vi.mocked(startServer).mockImplementation(async () => ({
    client: stubClient(state),
    url: 'http://127.0.0.1:4096',
    close,
  }));
  return { close };
}

let cacheDir: string;

beforeEach(async () => {
  vi.mocked(startServer).mockReset();
  cacheDir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-pipeline-llm-cache-'));
});

afterEach(async () => {
  await rm(cacheDir, { recursive: true, force: true });
});

describe('runPipeline with LLM analysis', () => {
  it('starts one server, analyzes each user, and merges completed analyses into the report', async () => {
    const repo = await buildFixtureRepo([
      {
        author: { name: 'Alice', email: 'alice@example.com' },
        date: '2026-01-01T10:00:00Z',
        message: 'feat: add app',
        files: [{ path: 'src/app.ts', content: 'line1\nline2\n' }],
      },
      {
        author: { name: 'Bob', email: 'bob@example.com' },
        date: '2026-01-02T11:00:00Z',
        message: 'docs: extend readme',
        files: [{ path: 'README.md', content: 'hello\nworld\n' }],
      },
    ]);
    const { close } = stubServer({ callTool: true, payload: PAYLOAD, replyText: 'ok' });
    try {
      const report = await runPipeline(
        options({
          repos: [repo.url],
          cacheDir,
          since: '2026-01-01T00:00:00Z',
          until: '2026-01-31T23:59:59Z',
        }),
      );

      // One server for the repo, started with the provider config, and
      // shut down before the report is written.
      expect(startServer).toHaveBeenCalledTimes(1);
      const config = vi.mocked(startServer).mock.calls[0]?.[1];
      expect(config).toMatchObject({
        providerUrl: 'https://llm.example.com/v1',
        model: 'gpt-4.1',
        apiKey: 'sk-test-123',
        limitContext: 262144,
        limitOutput: 65536,
      } satisfies Partial<LlmServerConfig>);
      expect(close).toHaveBeenCalledTimes(1);

      expect(report.parameters).toMatchObject({ llmEnabled: true, model: 'gpt-4.1' });
      const users = report.periods[0].repositories[0].users;
      // First-encounter order of the newest-first commit list: Bob, Alice.
      expect(users.map((user) => user.name)).toEqual(['Bob', 'Alice']);
      for (const user of users) {
        expect(user.llm).toEqual({
          status: 'completed',
          overview: PAYLOAD.overview,
          contributions: PAYLOAD.contributions,
          // The stub event stream carries no usage events.
          tokenUsage: { input: 0, cacheRead: 0, output: 0 },
          estimatedCostUsd: 0,
        });
      }
    } finally {
      await removeFixtureRepo(repo);
    }
  });

  it('fails fast when a session never calls the tool, closing the server and writing no report', async () => {
    const repo = await buildFixtureRepo([
      {
        author: { name: 'Alice', email: 'alice@example.com' },
        date: '2026-01-01T10:00:00Z',
        message: 'init',
        files: [{ path: 'a.txt', content: 'a\n' }],
      },
    ]);
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const { close } = stubServer({ callTool: false, payload: PAYLOAD, replyText: 'ok' });
    try {
      await expect(
        runPipeline(options({ repos: [repo.url], cacheDir, llmRetries: 0 })),
      ).rejects.toThrow(
        /LLM analysis failed for .*: LLM analysis for Alice did not call devperf_report/,
      );

      expect(close).toHaveBeenCalledTimes(1);
      expect(stdout).not.toHaveBeenCalled();
    } finally {
      stdout.mockRestore();
      await removeFixtureRepo(repo);
    }
  });

  it('fails fast naming the user and the underlying cause when a prompt fetch fails', async () => {
    const repo = await buildFixtureRepo([
      {
        author: { name: 'Alice', email: 'alice@example.com' },
        date: '2026-01-01T10:00:00Z',
        message: 'init',
        files: [{ path: 'a.txt', content: 'a\n' }],
      },
    ]);
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    // Node's fetch rejects with TypeError('fetch failed'); the real
    // reason lives in the AggregateError cause (undici's shape).
    const promptError = new TypeError('fetch failed', {
      cause: new AggregateError([new TypeError('connect ECONNREFUSED 127.0.0.1:50664')]),
    });
    const { close } = stubServer({
      callTool: true,
      payload: PAYLOAD,
      replyText: 'ok',
      promptError,
    });
    try {
      await expect(
        runPipeline(options({ repos: [repo.url], cacheDir, llmRetries: 0 })),
      ).rejects.toThrow(
        /LLM analysis failed for .*: analysis of Alice <alice@example.com> \(session ses_\d+\) failed: fetch failed: connect ECONNREFUSED 127\.0\.0\.1:50664/,
      );

      expect(close).toHaveBeenCalledTimes(1);
      expect(stdout).not.toHaveBeenCalled();
    } finally {
      stdout.mockRestore();
      await removeFixtureRepo(repo);
    }
  });

  it('fails fast with a clear message when the server cannot start', async () => {
    const repo = await buildFixtureRepo([
      {
        author: { name: 'Alice', email: 'alice@example.com' },
        date: '2026-01-01T10:00:00Z',
        message: 'init',
        files: [{ path: 'a.txt', content: 'a\n' }],
      },
    ]);
    vi.mocked(startServer).mockRejectedValue(new Error('opencode binary missing'));
    try {
      await expect(
        runPipeline(options({ repos: [repo.url], cacheDir, llmRetries: 0 })),
      ).rejects.toThrow(/LLM analysis failed for .*: opencode binary missing/);
    } finally {
      await removeFixtureRepo(repo);
    }
  });

  it('starts no server when LLM analysis is disabled', async () => {
    const repo = await buildFixtureRepo([
      {
        author: { name: 'Alice', email: 'alice@example.com' },
        date: '2026-01-01T10:00:00Z',
        message: 'init',
        files: [{ path: 'a.txt', content: 'a\n' }],
      },
    ]);
    try {
      const report = await runPipeline(options({ repos: [repo.url], cacheDir, llm: false }));

      expect(startServer).not.toHaveBeenCalled();
      expect(report.parameters.llmEnabled).toBe(false);
      expect(report.periods[0].repositories[0].users[0].llm.status).toBe('skipped');
    } finally {
      await removeFixtureRepo(repo);
    }
  });

  it('starts no server for a repository without authors in the range', async () => {
    const repo = await buildFixtureRepo([
      {
        author: { name: 'Alice', email: 'alice@example.com' },
        date: '2025-01-01T10:00:00Z',
        message: 'init',
        files: [{ path: 'a.txt', content: 'a\n' }],
      },
    ]);
    try {
      const report = await runPipeline(
        options({ repos: [repo.url], cacheDir, since: '2026-01-01T00:00:00Z' }),
      );

      expect(startServer).not.toHaveBeenCalled();
      expect(report.periods[0].repositories[0].users).toEqual([]);
    } finally {
      await removeFixtureRepo(repo);
    }
  });

  it('with --unit month runs LLM per active period with period-scoped cache keys', async () => {
    const repo = await buildFixtureRepo([
      {
        author: { name: 'Alice', email: 'alice@example.com' },
        date: '2026-01-15T10:00:00Z',
        message: 'feat: january',
        files: [{ path: 'src/a.ts', content: 'a\n' }],
      },
      {
        author: { name: 'Alice', email: 'alice@example.com' },
        date: '2026-03-10T11:00:00Z',
        message: 'feat: march',
        files: [{ path: 'src/b.ts', content: 'b\n' }],
      },
    ]);
    const { close } = stubServer({ callTool: true, payload: PAYLOAD, replyText: 'ok' });
    try {
      const report = await runPipeline(
        options({
          repos: [repo.url],
          cacheDir,
          unit: 'month',
          since: '2026-01-01T00:00:00Z',
          until: '2026-03-31T23:59:59Z',
        }),
      );

      // One server for the repo, shared by all of its periods.
      expect(startServer).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalledTimes(1);

      const periods = report.periods;
      expect(periods).toHaveLength(3);
      // January and March: the active user's analysis completed.
      for (const index of [0, 2]) {
        expect(periods[index].repositories[0].users[0].llm.status).toBe('completed');
        expect(periods[index].repositories[0].users[0].llm.contributions).toEqual(
          PAYLOAD.contributions,
        );
      }
      // February: no commits, so no LLM session and a skipped analysis.
      expect(periods[1].repositories[0].users[0].llm.status).toBe('skipped');

      // The LLM result cache is keyed per period: one cache file per
      // active period, holding that period's bounds (session report
      // files start with `ses_` and are not cache entries).
      const llmDir = path.join(cacheDir, entryHash(repo.url), 'llm');
      const cacheFiles = (await readdir(llmDir)).filter((file) => !file.startsWith('ses_'));
      expect(cacheFiles).toHaveLength(2);
      const bounds = await Promise.all(
        cacheFiles.map(async (file) => {
          const cached = JSON.parse(await readFile(path.join(llmDir, file), 'utf8')) as {
            since: string;
            until: string;
          };
          return { since: cached.since, until: cached.until };
        }),
      );
      expect(bounds).toEqual(
        expect.arrayContaining([
          { since: '2026-01-01T00:00:00.000Z', until: '2026-01-31T23:59:59.999Z' },
          { since: '2026-03-01T00:00:00.000Z', until: '2026-03-31T23:59:59.000Z' },
        ]),
      );
    } finally {
      await removeFixtureRepo(repo);
    }
  });

  it('retries a failed analysis with a fully restarted server and succeeds', async () => {
    const repo = await buildFixtureRepo([
      {
        author: { name: 'Alice', email: 'alice@example.com' },
        date: '2026-01-01T10:00:00Z',
        message: 'init',
        files: [{ path: 'a.txt', content: 'a\n' }],
      },
    ]);
    const { close } = stubServer({
      callTool: true,
      payload: PAYLOAD,
      replyText: 'ok',
      promptError: new TypeError('fetch failed'),
      promptFailures: 1,
    });
    try {
      const report = await runPipeline(options({ repos: [repo.url], cacheDir }));

      // Two attempts: the first analysis prompt fails, the retry
      // succeeds and the report is written with the completed analysis.
      expect(startServer).toHaveBeenCalledTimes(2);
      expect(close).toHaveBeenCalledTimes(2);
      // The server of the failed attempt is fully stopped before the
      // retry starts a fresh one.
      const startOrder = vi.mocked(startServer).mock.invocationCallOrder;
      const closeOrder = close.mock.invocationCallOrder;
      expect(closeOrder[0]).toBeLessThan(startOrder[1]!);
      expect(report.periods[0].repositories[0].users[0].llm.status).toBe('completed');
    } finally {
      await removeFixtureRepo(repo);
    }
  });

  it('gives up after the configured retries, closing each server', async () => {
    const repo = await buildFixtureRepo([
      {
        author: { name: 'Alice', email: 'alice@example.com' },
        date: '2026-01-01T10:00:00Z',
        message: 'init',
        files: [{ path: 'a.txt', content: 'a\n' }],
      },
    ]);
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const { close } = stubServer({
      callTool: true,
      payload: PAYLOAD,
      replyText: 'ok',
      promptError: new TypeError('fetch failed'),
      promptFailures: 99,
    });
    try {
      await expect(
        runPipeline(options({ repos: [repo.url], cacheDir, llmRetries: 1 })),
      ).rejects.toThrow(
        /LLM analysis failed for .* after 2 attempts: .*analysis of Alice <alice@example.com>.*failed: fetch failed/,
      );

      expect(startServer).toHaveBeenCalledTimes(2);
      expect(close).toHaveBeenCalledTimes(2);
      expect(stdout).not.toHaveBeenCalled();
    } finally {
      stdout.mockRestore();
      await removeFixtureRepo(repo);
    }
  });

  it('retries when the server cannot start', async () => {
    const repo = await buildFixtureRepo([
      {
        author: { name: 'Alice', email: 'alice@example.com' },
        date: '2026-01-01T10:00:00Z',
        message: 'init',
        files: [{ path: 'a.txt', content: 'a\n' }],
      },
    ]);
    vi.mocked(startServer).mockRejectedValueOnce(new Error('opencode binary missing'));
    const { close } = stubServer({ callTool: true, payload: PAYLOAD, replyText: 'ok' });
    try {
      const report = await runPipeline(options({ repos: [repo.url], cacheDir }));

      expect(startServer).toHaveBeenCalledTimes(2);
      // Only the second (successful) server needs closing.
      expect(close).toHaveBeenCalledTimes(1);
      expect(report.periods[0].repositories[0].users[0].llm.status).toBe('completed');
    } finally {
      await removeFixtureRepo(repo);
    }
  });
});
