/**
 * Tests for the LLM phase of the pipeline: with LLM
 * analysis enabled, the pipeline creates one in-process pi runtime per
 * repository, drives the session service and orchestration, and merges
 * the completed per-user analyses into the report; LLM failures fail
 * fast with a clear message and no report is written.
 * `createLlmRuntime` and `createSessionService` are stubbed at the
 * module boundary — the real runtime and session layers are covered by
 * `runtime.test.ts` and `session.test.ts` — and the stub service
 * stands in for the model by returning the reported payload.
 */
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildFixtureRepo, removeFixtureRepo } from '../test/fixtures/repo-builder.js';
import type { CliOptions } from './config.js';
import { createLlmRuntime } from './llm/runtime.js';
import type { LlmRuntimeConfig } from './llm/runtime.js';
import { createSessionService } from './llm/session.js';
import type { SessionHandle, SessionService } from './llm/session.js';
import { runPipeline } from './pipeline.js';
import { entryHash } from './repo/cache.js';
import type { LlmToolPayload, TokenUsage } from './report/index.js';
import { writeJsonFile } from './util/json.js';

vi.mock('./llm/runtime.js', () => ({
  createLlmRuntime: vi.fn(),
}));

// The session layer is replaced by a stub service: the real one talks
// to pi, which the pipeline tests do not exercise. `sessionReportPath`
// is kept so `analyze.js` can remove the orientation report file.
vi.mock('./llm/session.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./llm/session.js')>();
  return {
    ...actual,
    createSessionService: vi.fn(),
  };
});

/** Behavior of the stubbed model/session service. */
interface StubState {
  /** Whether a prompt makes the model "call" `devperf_report`. */
  callTool: boolean;
  /** Payload the simulated tool call reports. */
  payload: LlmToolPayload;
  /** Assistant text returned for every prompt. */
  replyText: string;
  /** When set, the analysis prompt rejects with this error. */
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

/** A stub `SessionService` simulating the in-process pi layer. */
class StubSessions implements SessionService {
  private counter = 0;
  constructor(private readonly state: StubState) {}

  async createSession(directory: string, _title: string): Promise<SessionHandle> {
    return { id: `ses_${++this.counter}`, directory };
  }

  async promptSession(_handle: SessionHandle, _text: string, _label: string): Promise<string> {
    return this.state.replyText;
  }

  async promptSessionUntilReport(
    handle: SessionHandle,
    _text: string,
    llmDir: string,
    _label: string,
  ): Promise<LlmToolPayload | undefined> {
    if (this.state.promptError !== undefined) {
      const failures = this.state.promptFailures;
      if (failures === undefined || failures > 0) {
        if (failures !== undefined) {
          this.state.promptFailures = failures - 1;
        }
        throw this.state.promptError;
      }
    }
    if (this.state.callTool) {
      await writeJsonFile(path.join(llmDir, `${handle.id}.json`), this.state.payload);
      return this.state.payload;
    }
    return undefined;
  }

  getUsage(_handle: SessionHandle): TokenUsage {
    return { input: 10, cacheRead: 7, output: 5 };
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
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
    parallel: 1,
    ...overrides,
  };
}

/**
 * Installs the `createLlmRuntime` and `createSessionService` stubs:
 * every runtime resolves, and every service is a fresh stub bound to
 * the shared `state`, so retry attempts observe the same failure
 * counter.
 *
 * @param state - Behavior of the stubbed model/service.
 * @returns The runtime dispose spy.
 */
function stubRuntime(state: StubState): { dispose: ReturnType<typeof vi.fn> } {
  const dispose = vi.fn(async () => {});
  vi.mocked(createLlmRuntime).mockImplementation(async () => ({
    model: { id: 'gpt-4.1', provider: 'devperf' } as never,
    modelRuntime: {} as never,
    agentDir: '',
    dispose,
  }));
  vi.mocked(createSessionService).mockImplementation(() => new StubSessions(state));
  return { dispose };
}

let cacheDir: string;

beforeEach(async () => {
  vi.mocked(createLlmRuntime).mockReset();
  vi.mocked(createSessionService).mockReset();
  cacheDir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-pipeline-llm-cache-'));
});

afterEach(async () => {
  await rm(cacheDir, { recursive: true, force: true });
});

describe('runPipeline with LLM analysis', () => {
  it('creates one runtime, analyzes each user, and merges completed analyses into the report', async () => {
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
    const { dispose } = stubRuntime({ callTool: true, payload: PAYLOAD, replyText: 'ok' });
    try {
      const report = await runPipeline(
        options({
          repos: [repo.url],
          cacheDir,
          since: '2026-01-01T00:00:00Z',
          until: '2026-01-31T23:59:59Z',
        }),
      );

      // One runtime for the repo, created with the provider config, and
      // disposed before the report is written.
      expect(createLlmRuntime).toHaveBeenCalledTimes(1);
      const config = vi.mocked(createLlmRuntime).mock.calls[0]?.[1];
      expect(config).toMatchObject({
        providerUrl: 'https://llm.example.com/v1',
        model: 'gpt-4.1',
        apiKey: 'sk-test-123',
        limitContext: 262144,
        limitOutput: 65536,
      } satisfies Partial<LlmRuntimeConfig>);
      expect(dispose).toHaveBeenCalledTimes(1);

      expect(report.parameters).toMatchObject({ llmEnabled: true, model: 'gpt-4.1' });
      const users = report.periods[0].repositories[0].users;
      // First-encounter order of the newest-first commit list: Bob, Alice.
      expect(users.map((user) => user.name)).toEqual(['Bob', 'Alice']);
      for (const user of users) {
        expect(user.llm).toEqual({
          status: 'completed',
          overview: PAYLOAD.overview,
          contributions: PAYLOAD.contributions,
          tokenUsage: { input: 10, cacheRead: 7, output: 5 },
        });
      }
    } finally {
      await removeFixtureRepo(repo);
    }
  });

  it('fails fast when a session never calls the tool, disposing the runtime and writing no report', async () => {
    const repo = await buildFixtureRepo([
      {
        author: { name: 'Alice', email: 'alice@example.com' },
        date: '2026-01-01T10:00:00Z',
        message: 'init',
        files: [{ path: 'a.txt', content: 'a\n' }],
      },
    ]);
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const { dispose } = stubRuntime({ callTool: false, payload: PAYLOAD, replyText: 'ok' });
    try {
      const runOptions = options({ repos: [repo.url], cacheDir, llmRetries: 0 });
      await expect(runPipeline(runOptions)).rejects.toThrow(
        /LLM analysis failed for .*: LLM analysis for Alice did not call devperf_report/,
      );

      expect(dispose).toHaveBeenCalledTimes(1);
      // The startup block goes to stderr through the logger; a failed
      // run writes no report, so stdout stays untouched.
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
    const { dispose } = stubRuntime({
      callTool: true,
      payload: PAYLOAD,
      replyText: 'ok',
      promptError,
    });
    try {
      const runOptions = options({ repos: [repo.url], cacheDir, llmRetries: 0 });
      await expect(runPipeline(runOptions)).rejects.toThrow(
        /LLM analysis failed for .*: analysis of Alice <alice@example.com> \(session ses_\d+\) failed: fetch failed: connect ECONNREFUSED 127\.0\.0\.1:50664/,
      );

      expect(dispose).toHaveBeenCalledTimes(1);
      expect(stdout).not.toHaveBeenCalled();
    } finally {
      stdout.mockRestore();
      await removeFixtureRepo(repo);
    }
  });

  it('fails fast with a clear message when the runtime cannot be created', async () => {
    const repo = await buildFixtureRepo([
      {
        author: { name: 'Alice', email: 'alice@example.com' },
        date: '2026-01-01T10:00:00Z',
        message: 'init',
        files: [{ path: 'a.txt', content: 'a\n' }],
      },
    ]);
    vi.mocked(createLlmRuntime).mockRejectedValue(new Error('pi runtime unavailable'));
    try {
      await expect(
        runPipeline(options({ repos: [repo.url], cacheDir, llmRetries: 0 })),
      ).rejects.toThrow(/LLM analysis failed for .*: pi runtime unavailable/);
    } finally {
      await removeFixtureRepo(repo);
    }
  });

  it('creates no runtime when LLM analysis is disabled', async () => {
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

      expect(createLlmRuntime).not.toHaveBeenCalled();
      expect(report.parameters.llmEnabled).toBe(false);
      expect(report.periods[0].repositories[0].users[0].llm.status).toBe('skipped');
    } finally {
      await removeFixtureRepo(repo);
    }
  });

  it('creates no runtime for a repository without authors in the range', async () => {
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

      expect(createLlmRuntime).not.toHaveBeenCalled();
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
    const { dispose } = stubRuntime({ callTool: true, payload: PAYLOAD, replyText: 'ok' });
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

      // One runtime for the repo, shared by all of its periods.
      expect(createLlmRuntime).toHaveBeenCalledTimes(1);
      expect(dispose).toHaveBeenCalledTimes(1);

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

  it('retries a failed analysis with a fresh runtime and succeeds', async () => {
    const repo = await buildFixtureRepo([
      {
        author: { name: 'Alice', email: 'alice@example.com' },
        date: '2026-01-01T10:00:00Z',
        message: 'init',
        files: [{ path: 'a.txt', content: 'a\n' }],
      },
    ]);
    const { dispose } = stubRuntime({
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
      expect(createLlmRuntime).toHaveBeenCalledTimes(2);
      expect(dispose).toHaveBeenCalledTimes(2);
      // The runtime of the failed attempt is fully disposed before the
      // retry starts a fresh one.
      const startOrder = vi.mocked(createLlmRuntime).mock.invocationCallOrder;
      const disposeOrder = dispose.mock.invocationCallOrder;
      expect(disposeOrder[0]).toBeLessThan(startOrder[1]!);
      expect(report.periods[0].repositories[0].users[0].llm.status).toBe('completed');
    } finally {
      await removeFixtureRepo(repo);
    }
  });

  it('gives up after the configured retries, disposing each runtime', async () => {
    const repo = await buildFixtureRepo([
      {
        author: { name: 'Alice', email: 'alice@example.com' },
        date: '2026-01-01T10:00:00Z',
        message: 'init',
        files: [{ path: 'a.txt', content: 'a\n' }],
      },
    ]);
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const { dispose } = stubRuntime({
      callTool: true,
      payload: PAYLOAD,
      replyText: 'ok',
      promptError: new TypeError('fetch failed'),
      promptFailures: 99,
    });
    try {
      const runOptions = options({ repos: [repo.url], cacheDir, llmRetries: 1 });
      await expect(runPipeline(runOptions)).rejects.toThrow(
        /LLM analysis failed for .* after 2 attempts: .*analysis of Alice <alice@example.com>.*failed: fetch failed/,
      );

      expect(createLlmRuntime).toHaveBeenCalledTimes(2);
      expect(dispose).toHaveBeenCalledTimes(2);
      // The startup block goes to stderr through the logger; a failed
      // run writes no report, so stdout stays untouched.
      expect(stdout).not.toHaveBeenCalled();
    } finally {
      stdout.mockRestore();
      await removeFixtureRepo(repo);
    }
  });

  it('retries when the runtime cannot be created', async () => {
    const repo = await buildFixtureRepo([
      {
        author: { name: 'Alice', email: 'alice@example.com' },
        date: '2026-01-01T10:00:00Z',
        message: 'init',
        files: [{ path: 'a.txt', content: 'a\n' }],
      },
    ]);
    vi.mocked(createLlmRuntime).mockRejectedValueOnce(new Error('pi runtime unavailable'));
    const { dispose } = stubRuntime({ callTool: true, payload: PAYLOAD, replyText: 'ok' });
    try {
      const report = await runPipeline(options({ repos: [repo.url], cacheDir }));

      expect(createLlmRuntime).toHaveBeenCalledTimes(2);
      // Only the second (successful) runtime needs disposing.
      expect(dispose).toHaveBeenCalledTimes(1);
      expect(report.periods[0].repositories[0].users[0].llm.status).toBe('completed');
    } finally {
      await removeFixtureRepo(repo);
    }
  });
});
