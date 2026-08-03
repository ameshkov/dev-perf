import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AuthorGroup } from '../deterministic/identity.js';
import type { LlmToolPayload } from '../report/index.js';
import { readJsonFile, writeJsonFile } from '../util/json.js';
import { analyzeRepositoryLLM } from './analyze.js';
import type { AnalyzeRepoInput } from './analyze.js';
import type { PromptOptions, SessionHandle, SessionService, UsageCollector } from './session.js';

const CONFIG = {
  providerUrl: 'https://llm.example.com/v1',
  model: 'gpt-4.1',
  apiKey: 'sk-test-123',
  limitContext: 262144,
  limitOutput: 65536,
};

const RANGE = { since: '2026-01-01T00:00:00.000Z', until: '2026-02-01T00:00:00.000Z' };

/** The payload the stub model reports through `devperf_report`. */
const PAYLOAD_A: LlmToolPayload = {
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

/** A different payload, used to detect refresh/cache behavior. */
const PAYLOAD_B: LlmToolPayload = {
  overview: 'Fixed the scheduler.',
  contributions: [
    {
      title: 'Fix scheduler',
      summary: 'Stopped the double-run.',
      types: ['bugfix'],
      complexity: 'low',
      complexityReasoning: 'One-line fix.',
      size: 'xs',
      sizeReasoning: 'Single-line change.',
      areas: ['src/scheduler.ts'],
      commits: ['def5678a'],
      qualitySignals: ['tests-added'],
      riskFlags: ['no-tests'],
    },
  ],
};

/**
 * A stub `SessionService` that simulates the opencode server without
 * touching it: sessions get sequential ids, prompts are recorded, and
 * — when `callTool` is set — every non-`noReply` analysis prompt makes
 * the model "call" `devperf_report` by writing the session's report
 * file.
 */
class StubSessions implements SessionService {
  /** Session creations, in order. */
  created: Array<{ directory: string; title: string }> = [];
  /** Prompt calls, in order. */
  prompts: Array<{ sessionID: string; text: string; noReply: boolean }> = [];
  private counter = 0;

  constructor(
    private readonly state: {
      /** True when the model calls `devperf_report` on prompts. */
      callTool: boolean;
      /** Payload the simulated tool call reports. */
      payload: LlmToolPayload;
      /** Assistant text returned for every prompt. */
      replyText: string;
      /** When set, `promptSessionUntilReport` rejects with this error. */
      failWith?: Error;
    },
  ) {}

  async createSession(directory: string, title: string): Promise<SessionHandle> {
    this.created.push({ directory, title });
    return { id: `ses_${++this.counter}`, directory };
  }

  async promptSession(
    handle: SessionHandle,
    text: string,
    options?: PromptOptions,
  ): Promise<string> {
    this.prompts.push({ sessionID: handle.id, text, noReply: options?.noReply === true });
    return this.state.replyText;
  }

  async promptSessionUntilReport(
    handle: SessionHandle,
    text: string,
    llmDir: string,
  ): Promise<LlmToolPayload | undefined> {
    this.prompts.push({ sessionID: handle.id, text, noReply: false });
    if (this.state.failWith !== undefined) {
      throw this.state.failWith;
    }
    if (this.state.callTool) {
      await writeJsonFile(path.join(llmDir, `${handle.id}.json`), this.state.payload);
      return this.state.payload;
    }
    return undefined;
  }

  async collectUsage(_directory: string): Promise<UsageCollector> {
    return {
      get: () => ({ tokenUsage: { input: 10, output: 5 }, estimatedCostUsd: 0.01 }),
      close: () => {},
    };
  }
}

/** Builds one author group with a single commit. */
function group(email: string, name: string, sha: string, subject: string): AuthorGroup {
  return {
    email,
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

let tmpRoot: string;
let llmDir: string;
let cloneDir: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-analyze-test-'));
  llmDir = path.join(tmpRoot, 'entry', 'llm');
  cloneDir = path.join(tmpRoot, 'clone');
  await mkdir(llmDir, { recursive: true });
  await mkdir(cloneDir, { recursive: true });
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

/** Builds the analysis input for the given groups and service. */
function inputFor(
  service: SessionService,
  groups: AuthorGroup[],
  refresh = false,
): AnalyzeRepoInput {
  return {
    repo: 'https://example.com/repo.git',
    cloneDir,
    entryDir: path.dirname(llmDir),
    config: CONFIG,
    range: RANGE,
    groups,
    service,
    refresh,
  };
}

function stub(callTool: boolean, payload = PAYLOAD_A, failWith?: Error): StubSessions {
  return new StubSessions({
    callTool,
    payload,
    replyText: 'repo context: TypeScript CLI; modules src/, docs/; tests with Vitest.',
    failWith,
  });
}

describe('analyzeRepositoryLLM', () => {
  it('runs orientation once and one session per user, returning completed analyses', async () => {
    const service = stub(true);
    const groups = [
      group('alice@example.com', 'Alice', 'abc1234d', 'Add pipeline'),
      group('bob@example.com', 'Bob', 'def5678a', 'Fix scheduler'),
    ];

    const results = await analyzeRepositoryLLM(inputFor(service, groups));

    expect(results.map((result) => result.email)).toEqual(['alice@example.com', 'bob@example.com']);
    for (const result of results) {
      expect(result.llm.status).toBe('completed');
      expect(result.llm.overview).toBe(PAYLOAD_A.overview);
      expect(result.llm.contributions).toEqual(PAYLOAD_A.contributions);
      expect(result.llm.tokenUsage).toEqual({ input: 10, output: 5 });
      expect(result.llm.estimatedCostUsd).toBe(0.01);
    }
    // Orientation + (context injection + analysis) per user.
    expect(service.prompts.map((prompt) => prompt.sessionID)).toEqual([
      'ses_1',
      'ses_2',
      'ses_2',
      'ses_3',
      'ses_3',
    ]);
  });

  it('injects the orientation context into every user session with noReply', async () => {
    const service = stub(true);
    const groups = [
      group('alice@example.com', 'Alice', 'abc1234d', 'Add pipeline'),
      group('bob@example.com', 'Bob', 'def5678a', 'Fix scheduler'),
    ];

    await analyzeRepositoryLLM(inputFor(service, groups));

    const [orientation, aliceInject, aliceAnalysis, bobInject, bobAnalysis] = service.prompts;
    expect(orientation?.text).toContain('orientation');
    expect(aliceInject?.noReply).toBe(true);
    expect(aliceInject?.text).toContain('repo context: TypeScript CLI');
    expect(aliceAnalysis?.noReply).toBe(false);
    expect(aliceAnalysis?.text).toContain('Alice');
    expect(aliceAnalysis?.text).toContain('repo context: TypeScript CLI');
    expect(bobInject?.noReply).toBe(true);
    expect(bobAnalysis?.text).toContain('Bob');
    expect(bobAnalysis?.text).toContain('repo context: TypeScript CLI');
  });

  it('scopes every session to the clone directory', async () => {
    const service = stub(true);
    const groups = [group('alice@example.com', 'Alice', 'abc1234d', 'Add pipeline')];

    await analyzeRepositoryLLM(inputFor(service, groups));

    expect(service.created).toHaveLength(2);
    for (const created of service.created) {
      expect(created.directory).toBe(cloneDir);
    }
  });

  it('caches the result per user and removes the orientation report file', async () => {
    const service = stub(true);
    await analyzeRepositoryLLM(
      inputFor(service, [group('alice@example.com', 'Alice', 'abc1234d', 'Add pipeline')]),
    );

    const files = await readdir(llmDir);
    // Orientation session report removed; user session report + cache entry kept.
    expect(files).not.toContain('ses_1.json');
    expect(files).toContain('ses_2.json');
    expect(files.filter((file) => file.endsWith('.json'))).toHaveLength(2);
  });

  it('stores the cache-key components in the cached result file', async () => {
    const service = stub(true);
    await analyzeRepositoryLLM(
      inputFor(service, [group('alice@example.com', 'Alice', 'abc1234d', 'Add pipeline')]),
    );

    // The cache entry is the 16-hex keyed file (session files are ses_*).
    const files = await readdir(llmDir);
    const cacheFile = files.find((file) => /^[0-9a-f]{16}\.json$/.test(file));
    expect(cacheFile).toBeDefined();

    const cached = (await readJsonFile(path.join(llmDir, cacheFile!))) as {
      payload: LlmToolPayload;
      repo: string;
      email: string;
      since: string;
      until: string;
      model: string;
      limitContext: number;
      limitOutput: number;
    };
    // The key parts the filename hash is derived from, self-described.
    expect(cached.payload.overview).toBe(PAYLOAD_A.overview);
    expect(cached.repo).toBe('https://example.com/repo.git');
    expect(cached.email).toBe('alice@example.com');
    expect(cached.since).toBe(RANGE.since);
    expect(cached.until).toBe(RANGE.until);
    expect(cached.model).toBe(CONFIG.model);
    expect(cached.limitContext).toBe(CONFIG.limitContext);
    expect(cached.limitOutput).toBe(CONFIG.limitOutput);
  });

  it('reruns with the same parameters without making a second call', async () => {
    const first = stub(true);
    const groups = [group('alice@example.com', 'Alice', 'abc1234d', 'Add pipeline')];
    await analyzeRepositoryLLM(inputFor(first, groups));
    expect(first.prompts.length).toBeGreaterThan(0);

    // The second run must not touch the server at all — the model would
    // not even call the tool this time, and it must not matter.
    const second = stub(false, PAYLOAD_B);
    const results = await analyzeRepositoryLLM(inputFor(second, groups));

    expect(second.prompts).toHaveLength(0);
    expect(second.created).toHaveLength(0);
    expect(results[0]?.llm.overview).toBe(PAYLOAD_A.overview);
    expect(results[0]?.llm.tokenUsage).toEqual({ input: 10, output: 5 });
  });

  it('--refresh invalidates the cache and re-runs the analysis', async () => {
    const first = stub(true, PAYLOAD_A);
    const groups = [group('alice@example.com', 'Alice', 'abc1234d', 'Add pipeline')];
    await analyzeRepositoryLLM(inputFor(first, groups));

    const refreshed = stub(true, PAYLOAD_B);
    const results = await analyzeRepositoryLLM(inputFor(refreshed, groups, true));

    expect(refreshed.prompts.length).toBeGreaterThan(0);
    expect(results[0]?.llm.overview).toBe(PAYLOAD_B.overview);
  });

  it('reuses cached results for users with hits while analyzing the rest', async () => {
    const first = stub(true);
    const alice = group('alice@example.com', 'Alice', 'abc1234d', 'Add pipeline');
    await analyzeRepositoryLLM(inputFor(first, [alice]));
    expect(first.created).toHaveLength(2);

    // Alice's result is cached; Carol was never analyzed, so she gets
    // a fresh session while Alice is served from the cache.
    const second = stub(true, PAYLOAD_B);
    const carol = group('carol@example.com', 'Carol', 'cafebabe', 'Rework scheduler');
    const results = await analyzeRepositoryLLM(inputFor(second, [alice, carol]));

    expect(results[0]?.llm.overview).toBe(PAYLOAD_A.overview);
    expect(results[1]?.llm.overview).toBe(PAYLOAD_B.overview);
    // Orientation runs once; only Carol gets a session.
    expect(second.created).toHaveLength(2);
    expect(second.prompts.map((prompt) => prompt.sessionID)).toEqual(['ses_1', 'ses_2', 'ses_2']);
  });

  it('enforces the report tool: 3 reminders, then an error naming user and session', async () => {
    const service = stub(false);
    const groups = [group('alice@example.com', 'Alice', 'abc1234d', 'Add pipeline')];

    await expect(analyzeRepositoryLLM(inputFor(service, groups))).rejects.toThrow(
      /LLM analysis for Alice did not call devperf_report in session ses_2 after 4 prompts; the report is not written\./,
    );

    // Orientation + context injection + analysis + 3 reminders.
    expect(service.prompts).toHaveLength(6);
    const reminders = service.prompts.slice(3);
    expect(reminders.map((prompt) => prompt.noReply)).toEqual([false, false, false]);
    for (const reminder of reminders) {
      expect(reminder.text).toContain('devperf_report');
    }
  });

  it('names the user and session and keeps the cause chain when a session prompt fails', async () => {
    // Node's fetch rejects with TypeError('fetch failed'); the real
    // reason lives in the AggregateError cause (undici's shape).
    const fetchError = new TypeError('fetch failed', {
      cause: new AggregateError([new TypeError('connect ECONNREFUSED 127.0.0.1:50664')]),
    });
    const service = stub(true, PAYLOAD_A, fetchError);
    const groups = [group('alice@example.com', 'Alice', 'abc1234d', 'Add pipeline')];

    await expect(analyzeRepositoryLLM(inputFor(service, groups))).rejects.toThrow(
      /analysis of Alice <alice@example.com> \(session ses_2\) failed: fetch failed: connect ECONNREFUSED 127\.0\.0\.1:50664/,
    );
  });
});
