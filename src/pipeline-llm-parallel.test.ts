/**
 * Tests for the parallel LLM phase of the pipeline: with `--parallel N`
 * and LLM analysis enabled, the pipeline creates one isolated in-process
 * pi runtime per repository and merges each repository's own completed
 * analyses into the report — without cross-repository contamination.
 * `createLlmRuntime` and `createSessionService` are stubbed at the module
 * boundary; the stub service stands in for the model by returning the
 * reported payload, and each repository's cache entry is served a
 * distinct payload so a cross-repo mix-up would fail the equality
 * checks. The single-repository LLM scenarios live in
 * `pipeline-llm.test.ts`.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildFixtureRepo, removeFixtureRepo } from '../test/fixtures/repo-builder.js';
import type { ReportOptions } from './config.js';
import { parseRepoSpec } from './repo/repo-spec.js';
import { createLlmRuntime } from './llm/runtime.js';
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
}

/** The first payload, distinctive so it can be told apart below. */
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

/**
 * A second payload, distinct from `PAYLOAD`, so a parallel run can
 * prove that each repository keeps its own analysis instead of picking
 * up a sibling's.
 */
const PAYLOAD_DOCS: LlmToolPayload = {
  overview: 'Wrote the documentation.',
  contributions: [
    {
      title: 'Add readme',
      summary: 'Documented the project.',
      types: ['docs'],
      complexity: 'low',
      complexityReasoning: 'Single file touched.',
      size: 's',
      sizeReasoning: 'One file only.',
      areas: ['README.md'],
      commits: ['abc1234d'],
      qualitySignals: ['docs-updated'],
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
function options(overrides: Partial<ReportOptions> = {}): ReportOptions {
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

let cacheDir: string;

beforeEach(async () => {
  vi.mocked(createLlmRuntime).mockReset();
  vi.mocked(createSessionService).mockReset();
  cacheDir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-pipeline-llm-cache-'));
});

afterEach(async () => {
  await rm(cacheDir, { recursive: true, force: true });
});

describe('runPipeline with parallel LLM analysis', () => {
  it('with --parallel 2 analyzes each repository with its own runtime and its own results', async () => {
    const alice = await buildFixtureRepo([
      {
        author: { name: 'Alice', email: 'alice@example.com' },
        date: '2026-01-01T10:00:00Z',
        message: 'feat: app',
        files: [{ path: 'src/alice.ts', content: 'line1\nline2\n' }],
      },
    ]);
    const bob = await buildFixtureRepo([
      {
        author: { name: 'Bob', email: 'bob@example.com' },
        date: '2026-01-02T11:00:00Z',
        message: 'docs: readme',
        files: [{ path: 'README.md', content: 'hello\n' }],
      },
    ]);
    // Each repository's cache entry is served a distinct payload, so a
    // cross-repo mix-up in the parallel pool would fail the equality
    // checks below.
    const payloads = new Map<string, LlmToolPayload>([
      [path.join(cacheDir, entryHash(alice.url)), PAYLOAD],
      [path.join(cacheDir, entryHash(bob.url)), PAYLOAD_DOCS],
    ]);
    const disposers: ReturnType<typeof vi.fn>[] = [];
    vi.mocked(createLlmRuntime).mockImplementation(async () => {
      const dispose = vi.fn(async () => {});
      disposers.push(dispose);
      return {
        model: { id: 'gpt-4.1', provider: 'devperf' } as never,
        modelRuntime: {} as never,
        agentDir: '',
        dispose,
      };
    });
    vi.mocked(createSessionService).mockImplementation(
      (_runtime, entryDir) =>
        new StubSessions({
          callTool: true,
          payload: payloads.get(entryDir) ?? PAYLOAD,
          replyText: 'ok',
        }),
    );
    try {
      const report = await runPipeline(
        options({
          repos: [parseRepoSpec(alice.url), parseRepoSpec(bob.url)],
          cacheDir,
          parallel: 2,
          since: '2026-01-01T00:00:00Z',
          until: '2026-01-31T23:59:59Z',
        }),
      );

      // One runtime per repository, each disposed before the report is
      // written.
      expect(disposers).toHaveLength(2);
      for (const dispose of disposers) {
        expect(dispose).toHaveBeenCalledTimes(1);
      }
      // Deterministic input order in the report.
      expect(report.periods).toHaveLength(1);
      expect(report.periods[0].repositories.map((entry) => entry.repo)).toEqual([
        alice.url,
        bob.url,
      ]);
      // Each repository analyzed its own author with its own result.
      const [first, second] = report.periods[0].repositories;
      expect(first?.users[0]?.name).toBe('Alice');
      expect(first?.users[0]?.llm).toMatchObject({
        status: 'completed',
        overview: PAYLOAD.overview,
      });
      expect(first?.users[0]?.llm?.contributions).toEqual(PAYLOAD.contributions);
      expect(second?.users[0]?.name).toBe('Bob');
      expect(second?.users[0]?.llm).toMatchObject({
        status: 'completed',
        overview: PAYLOAD_DOCS.overview,
      });
      expect(second?.users[0]?.llm?.contributions).toEqual(PAYLOAD_DOCS.contributions);
    } finally {
      await removeFixtureRepo(alice);
      await removeFixtureRepo(bob);
    }
  });
});
