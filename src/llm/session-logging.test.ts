/**
 * Tests for the session lifecycle logging of `createSessionService`:
 * every session logs its start (creation) and its end (disposal) at
 * info, both naming the session kind — the orientation session or a
 * per-user analysis — so the analysis lifecycle is traceable from the
 * log, and the end line carries the running state (turns, tool calls,
 * tokens, and seconds alive). The session mechanics (prompting,
 * report capture, usage, limits) live in `session.test.ts`.
 */
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { llmDir } from '../repo/cache.js';
import { createScopedLog } from '../util/log.js';
import type { LlmRuntime } from './runtime.js';
import type { SessionService } from './session.js';
import { createSessionService, ORIENTATION_TITLE } from './session.js';

// The pi package is mocked so the tests drive sessions in-process:
// `createAgentSession` returns a controllable fake session per call.
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

// Every log level is stubbed so nothing reaches stderr in tests; the
// lifecycle lines are asserted via the `info` mock.
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
    getContextUsage: ReturnType<typeof vi.fn>;
    setSessionName: ReturnType<typeof vi.fn>;
    subscribe: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  };
  control: {
    listeners: Set<(event: unknown) => void>;
  };
} {
  const listeners = new Set<(event: unknown) => void>();
  const tokens = { input: 10, cacheRead: 7, output: 5, cacheWrite: 0, total: 22 };
  return {
    session: {
      prompt: vi.fn(() => Promise.resolve()),
      abort: vi.fn(async () => {}),
      getLastAssistantText: vi.fn(() => ''),
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
      getContextUsage: vi.fn(() => undefined),
      setSessionName: vi.fn(),
      subscribe: vi.fn((listener: (event: unknown) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      }),
      dispose: vi.fn(),
    },
    control: { listeners },
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

let entryDir: string;
let service: SessionService;

beforeEach(async () => {
  entryDir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-logging-entry-'));
  await mkdir(llmDir(entryDir), { recursive: true });
  piMock.sessions.length = 0;
  service = createSessionService(runtimeFor(entryDir), entryDir);
});

afterEach(async () => {
  await service.close();
  await rm(entryDir, { recursive: true, force: true });
});

describe('session lifecycle logging', () => {
  it('logs each session start and end with its kind and running state', async () => {
    const scoped = vi.mocked(createScopedLog).mock.results.at(-1)?.value;
    const orientation = await service.createSession(DIRECTORY, ORIENTATION_TITLE, 'sys');
    // A couple of agent turns start on the orientation session; the
    // turn counter feeds the end line.
    emitTurnStart();
    emitTurnStart();
    const user = await service.createSession(DIRECTORY, 'dev-perf: Alice', 'sys');

    await service.close();

    const infoLogger = scoped?.info as { mock: { calls: unknown[][] } } | undefined;
    const info = (infoLogger?.mock.calls ?? []).map((call) => String(call[0])).join('\n');
    // Both lifecycle lines name the kind: orientation vs user analysis.
    expect(info).toContain(
      `LLM: orientation session "${orientation.id}" created (${ORIENTATION_TITLE})`,
    );
    expect(info).toContain(`LLM: user analysis session "${user.id}" created (dev-perf: Alice)`);
    // The end line carries the turns, tool calls, tokens, and lifetime.
    expect(info).toContain(
      `LLM: orientation session "${orientation.id}" ended ` +
        `(${ORIENTATION_TITLE}, 2 turns, 0 tool calls, 22 tokens, `,
    );
    expect(info).toContain(
      `LLM: user analysis session "${user.id}" ended ` +
        `(dev-perf: Alice, 0 turns, 0 tool calls, 22 tokens, `,
    );
    expect(info).toContain('s alive)');
  });
});

/** Emits a `turn_start` event on the last created session. */
function emitTurnStart(): void {
  for (const listener of [...lastFake().control.listeners]) {
    listener({ type: 'turn_start' });
  }
}
