import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthorGroup } from '../deterministic/identity.js';
import type { LlmToolPayload, TokenUsage } from '../report/index.js';
import { readJsonFile, writeJsonFile } from '../util/json.js';
import type { ScopedLog } from '../util/log.js';
import { createLimit } from '../util/pool.js';
import type { Limit } from '../util/pool.js';
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

/** The token usage every stub session reports. */
const USAGE: TokenUsage = { input: 10, cacheRead: 7, output: 5 };

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
 * A stub `SessionService` that simulates the in-process pi layer
 * without touching it: sessions get sequential ids, prompts and
 * created sessions are recorded, and — when `callTool` is set — every
 * analysis prompt makes the model "call" `devperf_report` by writing
 * the session's report file.
 */
class StubSessions implements SessionService {
  /** Session creations, in order. */
  created: Array<{ directory: string; title: string; systemPrompt: string }> = [];
  /** Prompt calls, in order. */
  prompts: Array<{ sessionID: string; text: string; label: string }> = [];
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

  async createSession(
    directory: string,
    title: string,
    systemPrompt: string,
  ): Promise<SessionHandle> {
    this.created.push({ directory, title, systemPrompt });
    return { id: `ses_${++this.counter}`, directory };
  }

  async promptSession(handle: SessionHandle, text: string, label: string): Promise<string> {
    this.prompts.push({ sessionID: handle.id, text, label });
    return this.state.replyText;
  }

  async promptSessionUntilReport(
    handle: SessionHandle,
    text: string,
    llmDir: string,
    label: string,
  ): Promise<LlmToolPayload | undefined> {
    this.prompts.push({ sessionID: handle.id, text, label });
    if (this.state.failWith !== undefined) {
      throw this.state.failWith;
    }
    if (this.state.callTool) {
      await writeJsonFile(path.join(llmDir, `${handle.id}.json`), this.state.payload);
      return this.state.payload;
    }
    return undefined;
  }

  getUsage(_session: SessionHandle): TokenUsage {
    return USAGE;
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

/** Builds one author group with a single commit. */
function group(
  email: string,
  name: string,
  sha: string,
  subject: string,
  emails: string[] = [email],
): AuthorGroup {
  return {
    email,
    emails,
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

/** A no-op scoped logger keeping test output quiet. */
function stubLog(): ScopedLog {
  return { error: vi.fn(), warn: vi.fn(), progress: vi.fn(), info: vi.fn(), debug: vi.fn() };
}

/** A generous concurrency gate: the default for tests that verify
 * behavior, not parallelism. */
const UNLIMITED = createLimit(8);

/** Builds the analysis input for the given groups and service. */
function inputFor(
  service: SessionService,
  groups: AuthorGroup[],
  refresh = false,
  log: ScopedLog = stubLog(),
  limit: Limit = UNLIMITED,
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
    limit,
    refresh,
    log,
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
      expect(result.llm.tokenUsage).toEqual(USAGE);
    }
    // One orientation session first, then one analysis session per
    // user. The user sessions run under the shared concurrency gate, so
    // their relative order is not fixed — only their set is.
    expect(service.prompts[0]?.sessionID).toBe('ses_1');
    // The progress-line label names the operation: the repo for the
    // orientation, the user for their analysis.
    expect(service.prompts[0]?.label).toBe('https://example.com/repo.git');
    const userPrompts = service.prompts.slice(1);
    expect(userPrompts.map((prompt) => prompt.sessionID).sort()).toEqual(['ses_2', 'ses_3']);
    expect(userPrompts.map((prompt) => prompt.label).sort()).toEqual(['Alice', 'Bob']);
  });

  it('keeps system prompts static and puts the task details in the analysis prompt', async () => {
    const service = stub(true);
    const groups = [
      group('alice@example.com', 'Alice', 'abc1234d', 'Add pipeline'),
      group('bob@example.com', 'Bob', 'def5678a', 'Fix scheduler'),
    ];

    await analyzeRepositoryLLM(inputFor(service, groups));

    // System prompts describe the agent and its environment only — no
    // per-run task details like the repository, identity, or range.
    expect(service.created[0]?.systemPrompt).toContain('read-only');
    expect(service.created[0]?.systemPrompt).not.toContain('https://example.com/repo.git');
    expect(service.created[1]?.systemPrompt).toContain('read-only');
    expect(service.created[1]?.systemPrompt).not.toContain('Alice');
    expect(service.created[1]?.systemPrompt).not.toContain('alice@example.com');
    expect(service.created[2]?.systemPrompt).not.toContain('Bob');
    // The task details — identity, repo, range — live in the analysis
    // prompt together with the context and the commit list.
    const aliceAnalysis = service.prompts[1];
    expect(aliceAnalysis?.text).toContain('Alice (alice@example.com)');
    expect(aliceAnalysis?.text).toContain('https://example.com/repo.git');
    expect(aliceAnalysis?.text).toContain('repo context: TypeScript CLI');
    expect(aliceAnalysis?.text).toContain('Commits by Alice');
  });

  it('logs every per-session event with the session id so the run can be traced', async () => {
    const log = stubLog();
    const service = stub(true);
    await analyzeRepositoryLLM(
      inputFor(
        service,
        [group('alice@example.com', 'Alice', 'abc1234d', 'Add pipeline')],
        false,
        log,
      ),
    );

    // Every LLM event line names its session; orientation and analysis
    // sessions are each traceable.
    const info = vi
      .mocked(log.info)
      .mock.calls.map((call) => call[0])
      .join('\n');
    expect(info).toContain('(session "ses_1")');
    expect(info).toContain('(session "ses_2")');
    // The orientation establishes the context, then the user is
    // analyzed, reports, and the usage is logged — all keyed by
    // session to follow the lifecycle.
    expect(info).toContain(
      'repo context established for "https://example.com/repo.git" (session "ses_1")',
    );
    expect(info).toContain('devperf_report received (session "ses_2")');
    expect(info).toContain('out tokens (session "ses_2")');
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
      cacheVersion: number;
      repo: string;
      branch: string;
      head: string;
      ignore: string[] | undefined;
      ignoreCommits: { hashes: string[]; messages: string[] } | undefined;
      email: string;
      emails: string[];
      since: string;
      until: string;
      model: string;
      limitContext: number;
      limitOutput: number;
    };
    // The key parts the filename hash is derived from, self-described.
    expect(cached.payload.overview).toBe(PAYLOAD_A.overview);
    expect(cached.cacheVersion).toBe(7);
    expect(cached.repo).toBe('https://example.com/repo.git');
    expect(cached.branch).toBe('main');
    expect(cached.head).toBe('cafebabe12345678');
    expect(cached.ignore).toBeUndefined();
    expect(cached.ignoreCommits).toBeUndefined();
    expect(cached.email).toBe('alice@example.com');
    expect(cached.emails).toEqual(['alice@example.com']);
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
    expect(results[0]?.llm.tokenUsage).toEqual(USAGE);
  });

  it('treats a cached result from an older cache version as a miss', async () => {
    // A pre-version cache entry validates nothing: strip the version
    // field from the on-disk result and the next run must re-analyze
    // instead of silently reusing the stale payload (whose prompt
    // templates and schema no longer match the current analysis).
    const first = stub(true, PAYLOAD_A);
    const groups = [group('alice@example.com', 'Alice', 'abc1234d', 'Add pipeline')];
    await analyzeRepositoryLLM(inputFor(first, groups));

    // Locate and rewrite the cache entry without its cacheVersion.
    const files = await readdir(llmDir);
    const cacheFile = files.find((file) => /^[0-9a-f]{16}\.json$/.test(file));
    expect(cacheFile).toBeDefined();
    const cached = await readJsonFile(path.join(llmDir, cacheFile!));
    const { cacheVersion: _dropped, ...stale } = cached as { cacheVersion: number } & Record<
      string,
      unknown
    >;
    await writeJsonFile(path.join(llmDir, cacheFile!), stale);
    expect(stale.cacheVersion).toBeUndefined();

    // The model would not call the tool this time; a cache hit would
    // reuse the stale payload silently, a miss re-runs the analysis.
    const second = stub(true, PAYLOAD_B);
    const results = await analyzeRepositoryLLM(inputFor(second, groups));

    expect(second.prompts.length).toBeGreaterThan(0);
    expect(results[0]?.llm.overview).toBe(PAYLOAD_B.overview);
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

  it('keys cached results by the identity email set, not the primary email alone', async () => {
    // Alice's result is cached as a single-email identity.
    const single = stub(true, PAYLOAD_A);
    const alice = group('alice@example.com', 'Alice', 'abc1234d', 'Add pipeline');
    await analyzeRepositoryLLM(inputFor(single, [alice]));
    expect(single.prompts.length).toBeGreaterThan(0);

    // A merged identity with the same primary email but a wider email
    // set must not reuse the single-email result — its analysis covers
    // a different commit pool.
    const merged = stub(true, PAYLOAD_B);
    const mergedGroup = group('alice@example.com', 'Alice', 'cafebabe', 'Rework pipeline', [
      'alice@example.com',
      'alice@work.com',
    ]);
    const results = await analyzeRepositoryLLM(inputFor(merged, [mergedGroup]));

    expect(merged.prompts.length).toBeGreaterThan(0);
    expect(results[0]?.llm.overview).toBe(PAYLOAD_B.overview);
  });

  it('keys cached results by the branch and the ignored paths', async () => {
    const first = stub(true, PAYLOAD_A);
    const alice = group('alice@example.com', 'Alice', 'abc1234d', 'Add pipeline');
    await analyzeRepositoryLLM({ ...inputFor(first, [alice]), ignore: ['docs/'] });
    expect(first.prompts.length).toBeGreaterThan(0);

    // A run on a different branch (same exclusions) must not reuse the
    // branch-specific result.
    const otherBranch = stub(true, PAYLOAD_B);
    const branchResults = await analyzeRepositoryLLM({
      ...inputFor(otherBranch, [alice]),
      branch: 'dev',
      ignore: ['docs/'],
    });
    expect(otherBranch.prompts.length).toBeGreaterThan(0);
    expect(branchResults[0]?.llm.overview).toBe(PAYLOAD_B.overview);

    // A run with different exclusions on the same branch must not reuse
    // the earlier result either.
    const otherIgnore = stub(true, PAYLOAD_A);
    await analyzeRepositoryLLM({ ...inputFor(otherIgnore, [alice]), ignore: ['vendor/'] });
    expect(otherIgnore.prompts.length).toBeGreaterThan(0);
  });

  it('keys cached results by the ignored commits', async () => {
    const first = stub(true, PAYLOAD_A);
    const alice = group('alice@example.com', 'Alice', 'abc1234d', 'Add pipeline');
    await analyzeRepositoryLLM({
      ...inputFor(first, [alice]),
      ignoreCommits: { hashes: ['abc1234'] },
    });
    expect(first.prompts.length).toBeGreaterThan(0);

    // A run with different commit exclusions on the same branch must not
    // reuse the earlier result — the analyzed commit pool differs.
    const otherExclusions = stub(true, PAYLOAD_B);
    const results = await analyzeRepositoryLLM({
      ...inputFor(otherExclusions, [alice]),
      ignoreCommits: { hashes: ['def5678'], messages: ['^chore'] },
    });
    expect(otherExclusions.prompts.length).toBeGreaterThan(0);
    expect(results[0]?.llm.overview).toBe(PAYLOAD_B.overview);
  });

  it('keys cached results by the base branch of the branch-delta', async () => {
    const first = stub(true, PAYLOAD_A);
    const alice = group('alice@example.com', 'Alice', 'abc1234d', 'Add pipeline');
    await analyzeRepositoryLLM({ ...inputFor(first, [alice]), base: 'main' });
    expect(first.prompts.length).toBeGreaterThan(0);

    // A run without the base (full history) must not reuse the delta
    // result — the analysis covers a different commit pool and a
    // different prompt.
    const fullHistory = stub(true, PAYLOAD_B);
    const fullResults = await analyzeRepositoryLLM(inputFor(fullHistory, [alice]));
    expect(fullHistory.prompts.length).toBeGreaterThan(0);
    expect(fullResults[0]?.llm.overview).toBe(PAYLOAD_B.overview);
  });

  it('keys cached results by the head sha, so an advancing branch tip re-runs', async () => {
    // A branch keeps its *name* as it advances; only the head sha moves.
    // The cached result must not be reused when the head changed — the
    // deterministic commit set the analysis describes is different.
    const first = stub(true, PAYLOAD_A);
    const alice = group('alice@example.com', 'Alice', 'abc1234d', 'Add pipeline');
    await analyzeRepositoryLLM(inputFor(first, [alice]));
    expect(first.prompts.length).toBeGreaterThan(0);

    const advanced = stub(true, PAYLOAD_B);
    const results = await analyzeRepositoryLLM({
      ...inputFor(advanced, [alice]),
      head: 'deadbeef98765432',
    });
    expect(advanced.prompts.length).toBeGreaterThan(0);
    expect(results[0]?.llm.overview).toBe(PAYLOAD_B.overview);
  });

  it('keys cached results by the base exclusion sha, so a base advance re-runs', async () => {
    // A base branch keeps its *name* as it advances; only the resolved
    // exclusion sha moves. A delta run with the same base name but a
    // different exclusion sha covers a different commit set and must
    // not reuse the earlier result.
    const first = stub(true, PAYLOAD_A);
    const alice = group('alice@example.com', 'Alice', 'abc1234d', 'Add pipeline');
    await analyzeRepositoryLLM({
      ...inputFor(first, [alice]),
      base: 'main',
      exclude: '1111111111111111',
    });
    expect(first.prompts.length).toBeGreaterThan(0);

    const advancedBase = stub(true, PAYLOAD_B);
    const results = await analyzeRepositoryLLM({
      ...inputFor(advancedBase, [alice]),
      base: 'main',
      exclude: '2222222222222222',
    });
    expect(advancedBase.prompts.length).toBeGreaterThan(0);
    expect(results[0]?.llm.overview).toBe(PAYLOAD_B.overview);
  });

  it('reuses a delta cache hit when head, base, and exclude match', async () => {
    const first = stub(true, PAYLOAD_A);
    const alice = group('alice@example.com', 'Alice', 'abc1234d', 'Add pipeline');
    const delta: Partial<AnalyzeRepoInput> = {
      base: 'main',
      exclude: '1111111111111111',
    };
    await analyzeRepositoryLLM({ ...inputFor(first, [alice]), ...delta });
    expect(first.prompts.length).toBeGreaterThan(0);

    // Identical key parts (same head, base, and exclusion sha) reuse the
    // cached analysis without prompting.
    const second = stub(false, PAYLOAD_B);
    const results = await analyzeRepositoryLLM({ ...inputFor(second, [alice]), ...delta });
    expect(second.prompts).toHaveLength(0);
    expect(results[0]?.llm.overview).toBe(PAYLOAD_A.overview);
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
    expect(second.prompts.map((prompt) => prompt.sessionID)).toEqual(['ses_1', 'ses_2']);
  });

  it('enforces the report tool: 3 reminders, then an error naming user and session', async () => {
    const service = stub(false);
    const groups = [group('alice@example.com', 'Alice', 'abc1234d', 'Add pipeline')];

    await expect(analyzeRepositoryLLM(inputFor(service, groups))).rejects.toThrow(
      /LLM analysis for Alice did not call devperf_report in session ses_2 after 4 prompts; the report is not written\./,
    );

    // Orientation + analysis + 3 reminders.
    expect(service.prompts).toHaveLength(5);
    const reminders = service.prompts.slice(2);
    for (const reminder of reminders) {
      expect(reminder.sessionID).toBe('ses_2');
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
