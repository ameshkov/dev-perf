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
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Event, OpencodeClient } from '@opencode-ai/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildFixtureRepo, removeFixtureRepo } from '../test/fixtures/repo-builder.js';
import type { CliOptions } from './config.js';
import { startServer } from './llm/server.js';
import type { LlmServerConfig } from './llm/server.js';
import { runPipeline } from './pipeline.js';
import type { LlmToolPayload } from './report/index.js';
import { writeJsonFile } from './util/json.js';

vi.mock('./llm/server.js', () => ({
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
      areas: ['src'],
      commits: ['abc1234d'],
      qualitySignals: ['tests added'],
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
          body: { noReply?: boolean };
        }) => {
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
      const users = report.repositories[0].users;
      // First-encounter order of the newest-first commit list: Bob, Alice.
      expect(users.map((user) => user.name)).toEqual(['Bob', 'Alice']);
      for (const user of users) {
        expect(user.llm).toEqual({
          status: 'completed',
          overview: PAYLOAD.overview,
          contributions: PAYLOAD.contributions,
          // The stub event stream carries no usage events.
          tokenUsage: { input: 0, output: 0 },
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
      await expect(runPipeline(options({ repos: [repo.url], cacheDir }))).rejects.toThrow(
        /LLM analysis failed for .*: LLM analysis for Alice did not call devperf_report/,
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
      await expect(runPipeline(options({ repos: [repo.url], cacheDir }))).rejects.toThrow(
        /LLM analysis failed for .*: opencode binary missing/,
      );
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
      expect(report.repositories[0].users[0].llm.status).toBe('skipped');
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
      expect(report.repositories[0].users).toEqual([]);
    } finally {
      await removeFixtureRepo(repo);
    }
  });
});
