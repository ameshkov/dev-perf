/**
 * Tests for the concurrent LLM session behavior of
 * `analyzeRepositoryLLM`: user sessions run under the run's shared
 * concurrency gate (`AnalyzeRepoInput.limit`, capacity `parallel`) — up
 * to that many analyses at once — instead of one at a time. The
 * `TrackingSessions` stub holds prompts open and counts how many are in
 * flight, so a test can observe the gate's concurrency directly. The
 * non-concurrency behaviors of the orchestration live in
 * `analyze.test.ts`.
 */
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthorGroup } from '../deterministic/identity.js';
import type { LlmToolPayload, TokenUsage } from '../report/index.js';
import { writeJsonFile } from '../util/json.js';
import type { ScopedLog } from '../util/log.js';
import { createLimit } from '../util/pool.js';
import { analyzeRepositoryLLM } from './analyze.js';
import type { AnalyzeRepoInput } from './analyze.js';
import type { SessionHandle, SessionService } from './session.js';

const CONFIG = {
  providerUrl: 'https://llm.example.com/v1',
  model: 'gpt-4.1',
  apiKey: 'sk-test-123',
  limitContext: 262144,
  limitOutput: 65536,
};

const RANGE = { since: '2026-01-01T00:00:00.000Z', until: '2026-02-01T00:00:00.000Z' };

/** The fixed usage every stub session reports. */
const USAGE: TokenUsage = { input: 10, cacheRead: 7, output: 5 };

/** The payload the stub model reports through `devperf_report`. */
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
 * A `SessionService` stub that holds every analysis prompt open for a
 * while and tracks how many are in flight, so the gate's concurrency
 * cap is directly observable.
 */
class TrackingSessions implements SessionService {
  private counter = 0;
  /** Prompts currently in flight. */
  inFlight = 0;
  /** The highest number of prompts in flight at once. */
  maxInFlight = 0;

  constructor(private readonly promptDelayMs: number) {}

  async createSession(directory: string): Promise<SessionHandle> {
    return { id: `ses_${++this.counter}`, directory };
  }

  async promptSession(_handle: SessionHandle, _text: string, _label: string): Promise<string> {
    return 'ok';
  }

  async promptSessionUntilReport(
    handle: SessionHandle,
    _text: string,
    llmDir: string,
    _label: string,
  ): Promise<LlmToolPayload | undefined> {
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      await delay(this.promptDelayMs);
      await writeJsonFile(path.join(llmDir, `${handle.id}.json`), PAYLOAD);
      return PAYLOAD;
    } finally {
      this.inFlight -= 1;
    }
  }

  getUsage(_handle: SessionHandle): TokenUsage {
    return USAGE;
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

/** Resolves after `ms` milliseconds, so concurrent prompts overlap. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Builds one author group with a single commit. */
function group(email: string, name: string, sha: string, subject: string): AuthorGroup {
  return {
    email,
    emails: [email],
    name,
    isBot: false,
    commits: [
      {
        sha,
        parents: [],
        authorName: name,
        authorEmail: email,
        authorDate: '2026-01-15T10:00:00+00:00',
        subject,
        files: [{ path: 'src/a.ts', added: 10, deleted: 2 }],
        isMerge: false,
      },
    ],
  };
}

/** A no-op scoped logger keeping test output quiet. */
function stubLog(): ScopedLog {
  return { error: vi.fn(), warn: vi.fn(), progress: vi.fn(), info: vi.fn(), debug: vi.fn() };
}

let llmDir: string;
let cloneDir: string;

beforeEach(async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-analyze-parallel-'));
  llmDir = path.join(tmpRoot, 'entry', 'llm');
  cloneDir = path.join(tmpRoot, 'clone');
  await mkdir(llmDir, { recursive: true });
  await mkdir(cloneDir, { recursive: true });
});

afterEach(async () => {
  await rm(path.dirname(cloneDir), { recursive: true, force: true });
});

/** Builds the analysis input with the given concurrency gate. */
function inputFor(
  service: SessionService,
  groups: AuthorGroup[],
  capacity: number,
): AnalyzeRepoInput {
  return {
    repo: 'https://example.com/repo.git',
    branch: 'main',
    head: 'cafebabe12345678',
    cloneDir,
    entryDir: path.dirname(llmDir),
    config: CONFIG,
    range: RANGE,
    groups,
    service,
    limit: createLimit(capacity),
    refresh: false,
    log: stubLog(),
  };
}

describe('analyzeRepositoryLLM concurrency', () => {
  it('runs user sessions concurrently up to the shared gate capacity', async () => {
    const service = new TrackingSessions(10);
    const groups = [
      group('alice@example.com', 'Alice', 'abc1234d', 'Add pipeline'),
      group('bob@example.com', 'Bob', 'def5678a', 'Fix scheduler'),
      group('carol@example.com', 'Carol', 'cafebabe', 'Rework tests'),
    ];

    const results = await analyzeRepositoryLLM(inputFor(service, groups, 2));

    // Results keep the input group order.
    expect(results.map((result) => result.email)).toEqual([
      'alice@example.com',
      'bob@example.com',
      'carol@example.com',
    ]);
    for (const result of results) {
      expect(result.llm.status).toBe('completed');
    }
    // The orientation runs alone, then the user sessions overlap up to
    // the gate's capacity of 2.
    expect(service.maxInFlight).toBe(2);
  });

  it('runs user sessions one at a time under a gate of capacity 1', async () => {
    const service = new TrackingSessions(10);
    const groups = [
      group('alice@example.com', 'Alice', 'abc1234d', 'Add pipeline'),
      group('bob@example.com', 'Bob', 'def5678a', 'Fix scheduler'),
    ];

    const results = await analyzeRepositoryLLM(inputFor(service, groups, 1));

    expect(results).toHaveLength(2);
    for (const result of results) {
      expect(result.llm.status).toBe('completed');
    }
    expect(service.maxInFlight).toBe(1);
  });
});
