/**
 * Tests for the per-session LLM limits (`session-limits.ts`): the
 * max wall-clock time and max agent-turn budget bound each session, and
 * an exceeded limit aborts the session and fails the pending prompt
 * with a descriptive error. The fake pi session is driven like in
 * `session.test.ts`: `createSessionService` binds the real wrappers to a
 * controllable fake session, `turn_start` events consume the turn
 * budget, and fake timers advance the deadline.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { llmDir } from '../repo/cache.js';
import type { LlmRuntime } from './runtime.js';
import { SessionLimitError, sessionLimitFrom } from './session-limits.js';
import type { SessionLimitHit } from './session-limits.js';
import type { SessionService } from './session.js';
import { createSessionService } from './session.js';

// The pi package is mocked so the tests drive sessions in-process:
// `createAgentSession` returns a controllable fake session per call,
// and the resource/settings/session managers are inert stand-ins.
const piMock = vi.hoisted(() => ({
  /** Fake sessions returned by `createAgentSession`, in order. */
  sessions: [] as Array<ReturnType<typeof makeFakeSession>>,
}));

// Function declarations referenced by the mocked module are hoisted, so
// `makeFakeSession` below is safe to use inside the mock factory.
vi.mock('@earendil-works/pi-coding-agent', () => ({
  DefaultResourceLoader: class {
    reload(): Promise<void> {
      return Promise.resolve();
    }
  },
  SettingsManager: {
    inMemory: vi.fn(() => ({ reload: vi.fn(async () => {}) })),
  },
  SessionManager: {
    inMemory: vi.fn(() => ({})),
  },
  createAgentSession: vi.fn(async () => {
    const fake = makeFakeSession();
    piMock.sessions.push(fake);
    return { session: fake.session };
  }),
  defineTool: <T>(tool: T): T => tool,
}));

// Log levels are stubbed so nothing reaches stderr in tests.
vi.mock('../util/log.js', () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
  logInfo: vi.fn(),
  logDebug: vi.fn(),
  setVerbose: vi.fn(),
  createScopedLog: vi.fn(() => ({
    error: vi.fn(),
    warn: vi.fn(),
    progress: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  })),
}));

const DIRECTORY = '/clone/repo';

/** A fake pi session with test controls. */
function makeFakeSession(): {
  session: {
    prompt: ReturnType<typeof vi.fn>;
    abort: ReturnType<typeof vi.fn>;
    getLastAssistantText: ReturnType<typeof vi.fn>;
    getSessionStats: ReturnType<typeof vi.fn>;
    setSessionName: ReturnType<typeof vi.fn>;
    subscribe: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  };
  control: {
    setPromptImpl(fn: () => Promise<void>): void;
    listeners: Set<(event: unknown) => void>;
  };
} {
  const listeners = new Set<(event: unknown) => void>();
  let promptImpl: () => Promise<void> = async () => {};
  const tokens = { input: 10, cacheRead: 7, output: 5, cacheWrite: 0, total: 22 };
  return {
    session: {
      prompt: vi.fn(() => promptImpl()),
      abort: vi.fn(async () => {}),
      getLastAssistantText: vi.fn(() => 'assistant reply'),
      getSessionStats: vi.fn(() => ({
        sessionFile: undefined,
        sessionId: 'pi-session',
        userMessages: 1,
        assistantMessages: 1,
        toolCalls: 0,
        toolResults: 0,
        totalMessages: 2,
        tokens,
        cost: 0,
      })),
      setSessionName: vi.fn(),
      subscribe: vi.fn((listener: (event: unknown) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      }),
      dispose: vi.fn(),
    },
    control: {
      setPromptImpl(fn) {
        promptImpl = fn;
      },
      listeners,
    },
  };
}

/** A fake runtime handle bound to nothing real. */
function runtimeFor(entryDir: string): LlmRuntime {
  return {
    model: { id: 'gpt-4.1', provider: 'devperf' } as never,
    modelRuntime: {} as never,
    agentDir: path.join(entryDir, 'pi', 'home'),
    dispose: vi.fn(async () => {}),
  };
}

/** The last fake session created, with its controls. */
function lastFake() {
  const fake = piMock.sessions.at(-1);
  if (fake === undefined) {
    throw new Error('no fake session created');
  }
  return fake;
}

/** Emits a `turn_start` event on a fake session (an agent turn begins). */
function emitTurnStart(fake: ReturnType<typeof makeFakeSession>): void {
  for (const listener of [...fake.control.listeners]) {
    listener({ type: 'turn_start' });
  }
}

function pendingPrompt(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

let entryDir: string;
let llmDirPath: string;
let limited: SessionService | undefined;

beforeEach(async () => {
  entryDir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-limits-entry-'));
  llmDirPath = llmDir(entryDir);
  piMock.sessions.length = 0;
});

afterEach(async () => {
  await limited?.close().catch(() => {});
  await rm(entryDir, { recursive: true, force: true });
});

describe('per-session max-time limit', () => {
  it('aborts the session and rejects when the max time expires', async () => {
    vi.useFakeTimers();
    try {
      limited = createSessionService(runtimeFor(entryDir), entryDir, undefined, {
        maxTimeMs: 5000,
        maxTurns: 0,
      });
      const handle = await limited.createSession(DIRECTORY, 'title', 'sys');
      const fake = lastFake();
      const pending = pendingPrompt();
      fake.control.setPromptImpl(() => pending.promise);

      const resultPromise = limited.promptSession(handle, 'analyze', 'Alice');
      // Attach the rejection handler before the timers advance, so the
      // rejection is not flagged as unhandled mid-advance.
      const assertion = expect(resultPromise).rejects.toThrow('exceeded the 5s max time limit');
      await vi.advanceTimersByTimeAsync(5001);

      await assertion;
      expect(fake.session.abort).toHaveBeenCalled();
      pending.resolve();
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects without prompting when the time budget is already exhausted', async () => {
    vi.useFakeTimers();
    try {
      limited = createSessionService(runtimeFor(entryDir), entryDir, undefined, {
        maxTimeMs: 1000,
        maxTurns: 0,
      });
      const handle = await limited.createSession(DIRECTORY, 'title', 'sys');
      const fake = lastFake();
      // The deadline passes while the session idles.
      await vi.advanceTimersByTimeAsync(1500);

      await expect(limited.promptSession(handle, 'analyze', 'Alice')).rejects.toThrow(
        'exceeded the 1s max time limit',
      );
      expect(fake.session.prompt).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails with a SessionLimitError carrying the exceeded limit', async () => {
    vi.useFakeTimers();
    try {
      limited = createSessionService(runtimeFor(entryDir), entryDir, undefined, {
        maxTimeMs: 7000,
        maxTurns: 0,
      });
      const handle = await limited.createSession(DIRECTORY, 'title', 'sys');
      const fake = lastFake();
      const pending = pendingPrompt();
      fake.control.setPromptImpl(() => pending.promise);
      // The rejection is captured so the metadata can be inspected and
      // no unhandled rejection flags the run.
      const captured: unknown[] = [];
      const result = limited.promptSession(handle, 'analyze', 'Alice').catch((error) => {
        captured.push(error);
        return undefined;
      });
      await vi.advanceTimersByTimeAsync(7001);
      await result;

      expect(captured[0]).toBeInstanceOf(SessionLimitError);
      expect((captured[0] as SessionLimitError).limit).toEqual({
        kind: 'time',
        cap: 7,
        sessionId: handle.id,
      });
      pending.resolve();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('per-session max-turns limit', () => {
  it('aborts the session and rejects when the turn budget is exceeded', async () => {
    limited = createSessionService(runtimeFor(entryDir), entryDir, undefined, {
      maxTimeMs: 0,
      maxTurns: 2,
    });
    const handle = await limited.createSession(DIRECTORY, 'title', 'sys');
    const fake = lastFake();
    const pending = pendingPrompt();
    fake.control.setPromptImpl(() => pending.promise);

    const resultPromise = limited.promptSession(handle, 'analyze', 'Alice');
    // Attach the rejection handler before the budget is consumed, so
    // the rejection is not flagged as unhandled.
    const assertion = expect(resultPromise).rejects.toThrow('exceeded the 2-turn max limit');
    // Two turns fit within the budget.
    emitTurnStart(fake);
    emitTurnStart(fake);
    expect(fake.session.abort).not.toHaveBeenCalled();
    // A third turn start exceeds the budget.
    emitTurnStart(fake);

    await assertion;
    expect(fake.session.abort).toHaveBeenCalled();
    pending.resolve();
  });

  it('rejects the analysis prompt when the turn budget is exhausted without a report', async () => {
    limited = createSessionService(runtimeFor(entryDir), entryDir, undefined, {
      maxTimeMs: 0,
      maxTurns: 1,
    });
    const handle = await limited.createSession(DIRECTORY, 'title', 'sys');
    const fake = lastFake();
    const pending = pendingPrompt();
    fake.control.setPromptImpl(() => pending.promise);

    const resultPromise = limited.promptSessionUntilReport(handle, 'analyze', llmDirPath, 'Alice');
    const assertion = expect(resultPromise).rejects.toThrow('exceeded the 1-turn max limit');
    emitTurnStart(fake);
    emitTurnStart(fake);

    await assertion;
    expect(fake.session.abort).toHaveBeenCalled();
    pending.resolve();
  });

  it('leaves a session unlimited when no limits are configured', async () => {
    limited = createSessionService(runtimeFor(entryDir), entryDir);
    const handle = await limited.createSession(DIRECTORY, 'title', 'sys');
    const fake = lastFake();
    fake.control.setPromptImpl(async () => {});

    await expect(limited.promptSession(handle, 'analyze', 'Alice')).resolves.toBe(
      'assistant reply',
    );
    // The unlimited session never subscribes for turns or aborts.
    expect(fake.session.abort).not.toHaveBeenCalled();
  });

  it('carries the turn-limit hit on the SessionLimitError', async () => {
    limited = createSessionService(runtimeFor(entryDir), entryDir, undefined, {
      maxTimeMs: 0,
      maxTurns: 2,
    });
    const handle = await limited.createSession(DIRECTORY, 'title', 'sys');
    const fake = lastFake();
    const pending = pendingPrompt();
    fake.control.setPromptImpl(() => pending.promise);

    const captured: unknown[] = [];
    const result = limited.promptSession(handle, 'analyze', 'Alice').catch((error) => {
      captured.push(error);
      return undefined;
    });
    emitTurnStart(fake);
    emitTurnStart(fake);
    emitTurnStart(fake);
    await result;

    expect(captured[0]).toBeInstanceOf(SessionLimitError);
    expect((captured[0] as SessionLimitError).limit).toEqual({
      kind: 'turns',
      cap: 2,
      sessionId: handle.id,
    });
    pending.resolve();
  });
});

describe('sessionLimitFrom', () => {
  it('recovers the exceeded limit from a wrapped cause chain', () => {
    const hit: SessionLimitHit = { kind: 'turns', cap: 5, sessionId: 'ses_1' };
    const limit = new SessionLimitError(
      hit,
      'LLM session "ses_1" exceeded the 5-turn max limit at devperf_report',
    );
    const analysis = new Error('analysis of Alice <alice@example.com> (session ses_1) failed', {
      cause: limit,
    });
    const phase = new Error('LLM analysis failed for repo.git: ...', { cause: analysis });

    expect(sessionLimitFrom(phase)).toEqual(hit);
  });

  it('returns undefined when the failure was not caused by a session limit', () => {
    expect(sessionLimitFrom(new Error('fetch failed'))).toBeUndefined();
    expect(
      sessionLimitFrom(new TypeError('socket hang up', { cause: new Error('connect refused') })),
    ).toBeUndefined();
    expect(sessionLimitFrom(undefined)).toBeUndefined();
    expect(sessionLimitFrom('not an error')).toBeUndefined();
  });
});
