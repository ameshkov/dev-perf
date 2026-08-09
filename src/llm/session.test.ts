import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LlmToolPayload } from '../report/index.js';
import { llmDir } from '../repo/cache.js';
import { createScopedLog } from '../util/log.js';
import type { LlmRuntime } from './runtime.js';
import type { SessionService } from './session.js';
import { createSessionService, readSessionReport, sessionReportPath } from './session.js';
import { REPORT_TOOL_NAME } from './tools.js';

// The pi package is mocked so the tests drive sessions in-process:
// `createAgentSession` returns a controllable fake session per call,
// and the resource/settings/session managers are inert stand-ins.
const piMock = vi.hoisted(() => ({
  /** Fake sessions returned by `createAgentSession`, in order. */
  sessions: [] as Array<ReturnType<typeof makeFakeSession>>,
  /** Options passed to each `createAgentSession` call. */
  createOptions: [] as unknown[],
  /** Options passed to each `DefaultResourceLoader` construction. */
  loaderOptions: [] as unknown[],
  /** Whether `SettingsManager.inMemory` was called with compaction/retry. */
  settingsArgs: [] as unknown[],
}));

// Function declarations referenced by the mocked module are hoisted, so
// `makeFakeSession` below is safe to use inside the mock factory.
vi.mock('@earendil-works/pi-coding-agent', () => ({
  DefaultResourceLoader: class {
    constructor(options: unknown) {
      piMock.loaderOptions.push(options);
    }
    reload(): Promise<void> {
      return Promise.resolve();
    }
  },
  SettingsManager: {
    inMemory: vi.fn((settings: unknown) => {
      piMock.settingsArgs.push(settings);
      return { reload: vi.fn(async () => {}) };
    }),
  },
  SessionManager: {
    inMemory: vi.fn(() => ({})),
  },
  createAgentSession: vi.fn(async (options: unknown) => {
    piMock.createOptions.push(options);
    const fake = makeFakeSession();
    piMock.sessions.push(fake);
    return { session: fake.session };
  }),
  // tools.ts imports `defineTool` to build the report tool; the real
  // wrapper only restores type inference, so identity is enough here.
  defineTool: <T>(tool: T): T => tool,
}));

// The heartbeat progress lines are asserted via the mocked logger; the
// other log levels are stubbed so nothing reaches stderr in tests.
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

/** A valid `devperf_report` payload for report-file tests. */
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

/** A fake pi session with test controls; `vi.fn` works because the mock
 * factory above runs lazily, after the module context is ready. */
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
    setPromptImpl(fn: () => Promise<void>): void;
    setReply(text: string): void;
    setTokens(tokens: {
      input: number;
      cacheRead: number;
      output: number;
      cacheWrite: number;
      total: number;
    }): void;
    setContextUsage(usage: {
      tokens: number | null;
      contextWindow: number;
      percent: number | null;
    }): void;
    listeners: Set<(event: unknown) => void>;
  };
} {
  const listeners = new Set<(event: unknown) => void>();
  let promptImpl: () => Promise<void> = async () => {};
  let replyText = 'assistant reply';
  let tokens = { input: 10, cacheRead: 7, output: 5, cacheWrite: 0, total: 22 };
  let contextUsage:
    { tokens: number | null; contextWindow: number; percent: number | null } | undefined;
  return {
    session: {
      prompt: vi.fn(() => promptImpl()),
      abort: vi.fn(async () => {}),
      getLastAssistantText: vi.fn(() => replyText),
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
      getContextUsage: vi.fn(() => contextUsage),
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
      setReply(text) {
        replyText = text;
      },
      setTokens(next) {
        tokens = next;
      },
      setContextUsage(next) {
        contextUsage = next;
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

/** Emits a `devperf_report` tool-execution-start event on a fake session. */
function emitToolCall(fake: ReturnType<typeof makeFakeSession>, args: unknown): void {
  for (const listener of [...fake.control.listeners]) {
    listener({ type: 'tool_execution_start', toolCallId: 'tc1', toolName: REPORT_TOOL_NAME, args });
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
let service: SessionService;

beforeEach(async () => {
  entryDir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-session-entry-'));
  llmDirPath = llmDir(entryDir);
  await mkdir(llmDirPath, { recursive: true });
  piMock.sessions.length = 0;
  piMock.createOptions.length = 0;
  piMock.loaderOptions.length = 0;
  piMock.settingsArgs.length = 0;
  service = createSessionService(runtimeFor(entryDir), entryDir);
});

afterEach(async () => {
  await service.close();
  await rm(entryDir, { recursive: true, force: true });
});

describe('createSessionService', () => {
  it('creates a session scoped to the clone directory with the given system prompt', async () => {
    const handle = await service.createSession(DIRECTORY, 'dev-perf: Alice', 'system prompt text');

    expect(handle.directory).toBe(DIRECTORY);
    expect(handle.id).toMatch(/^[0-9a-f]{8}-/u);

    const options = piMock.createOptions[0] as Record<string, unknown>;
    expect(options.cwd).toBe(DIRECTORY);
    expect(options.model).toEqual({ id: 'gpt-4.1', provider: 'devperf' });
    expect(options.thinkingLevel).toBe('off');
    expect(options.tools).toEqual(['read', 'bash', 'grep', 'find', 'ls', REPORT_TOOL_NAME]);
    // Only the report tool is custom; `bash` is pi's built-in (regular)
    // and therefore not part of customTools.
    expect(options.customTools).toEqual([expect.objectContaining({ name: REPORT_TOOL_NAME })]);
    expect(options.sessionManager).toBeDefined();
    expect(options.resourceLoader).toBeDefined();
    // In-memory settings enable auto-compaction and auto-retry.
    expect(piMock.settingsArgs[0]).toEqual({
      compaction: { enabled: true },
      retry: { enabled: true },
    });
  });

  it('gives the loader the system prompt and disables every resource category', async () => {
    await service.createSession(DIRECTORY, 'title', 'orientation system prompt');

    const loader = piMock.loaderOptions[0] as Record<string, unknown>;
    expect(loader.cwd).toBe(DIRECTORY);
    expect(loader.systemPrompt).toBe('orientation system prompt');
    for (const flag of [
      'noExtensions',
      'noSkills',
      'noPromptTemplates',
      'noThemes',
      'noContextFiles',
    ]) {
      expect(loader[flag]).toBe(true);
    }
  });

  it('returns the final assistant text from promptSession', async () => {
    const handle = await service.createSession(DIRECTORY, 'title', 'sys');
    lastFake().control.setReply('the final context');

    await expect(service.promptSession(handle, 'analyze', 'Alice')).resolves.toBe(
      'the final context',
    );
    expect(lastFake().session.prompt).toHaveBeenCalledWith('analyze');
  });

  it('aborts the session and rethrows when the prompt fails', async () => {
    const handle = await service.createSession(DIRECTORY, 'title', 'sys');
    lastFake().control.setPromptImpl(async () => {
      throw new Error('rate limited');
    });
    const fake = lastFake();

    await expect(service.promptSession(handle, 'analyze', 'Alice')).rejects.toThrow('rate limited');
    expect(fake.session.abort).toHaveBeenCalledTimes(1);
  });

  it('logs a still-waiting progress line with the session state while the reply is pending', async () => {
    vi.useFakeTimers();
    try {
      const handle = await service.createSession(DIRECTORY, 'title', 'sys');
      const pending = pendingPrompt();
      lastFake().control.setPromptImpl(() => pending.promise);
      const scoped = vi.mocked(createScopedLog).mock.results.at(-1)?.value;

      const resultPromise = service.promptSession(handle, 'analyze', 'Alice');
      await vi.advanceTimersByTimeAsync(31_000);

      // The heartbeat names the kind, the turns run, the tool calls,
      // the context size, and the seconds the session has been alive.
      expect(scoped?.info).toHaveBeenCalledWith(
        expect.stringContaining(
          `LLM: "Alice" (session "${handle.id}", user analysis session, 0 turns, ` +
            `0 tool calls, context 22 tokens used, 30s alive): still waiting for the LLM reply`,
        ),
      );

      pending.resolve();
      await expect(resultPromise).resolves.toBe('assistant reply');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('promptSessionUntilReport', () => {
  it('settles from the tool-execution event, writes the report and aborts early', async () => {
    const handle = await service.createSession(DIRECTORY, 'title', 'sys');
    const fake = lastFake();
    const pending = pendingPrompt();
    fake.control.setPromptImpl(() => pending.promise);

    const resultPromise = service.promptSessionUntilReport(handle, 'analyze', llmDirPath, 'Alice');
    emitToolCall(fake, PAYLOAD);

    await expect(resultPromise).resolves.toEqual(PAYLOAD);
    // The report file was written from the event arguments.
    const written = JSON.parse(
      await readFile(sessionReportPath(llmDirPath, handle.id), 'utf8'),
    ) as LlmToolPayload;
    expect(written).toEqual(PAYLOAD);
    expect(fake.session.abort).toHaveBeenCalledTimes(1);
    pending.resolve();
  });

  it('ignores an invalid tool-call argument and waits for the turn to end', async () => {
    const handle = await service.createSession(DIRECTORY, 'title', 'sys');
    const fake = lastFake();
    fake.control.setPromptImpl(async () => {});

    emitToolCall(fake, { overview: 42 });
    const result = await service.promptSessionUntilReport(handle, 'analyze', llmDirPath, 'Alice');

    expect(result).toBeUndefined();
    expect(fake.session.abort).not.toHaveBeenCalled();
  });

  it('returns the payload written before the turn ended, without aborting', async () => {
    const handle = await service.createSession(DIRECTORY, 'title', 'sys');
    const fake = lastFake();
    fake.control.setPromptImpl(async () => {
      await writeFile(sessionReportPath(llmDirPath, handle.id), JSON.stringify(PAYLOAD), 'utf8');
    });

    await expect(
      service.promptSessionUntilReport(handle, 'analyze', llmDirPath, 'Alice'),
    ).resolves.toEqual(PAYLOAD);
    expect(fake.session.abort).not.toHaveBeenCalled();
  });

  it('returns undefined when the turn ends without calling the tool', async () => {
    const handle = await service.createSession(DIRECTORY, 'title', 'sys');
    const fake = lastFake();
    fake.control.setPromptImpl(async () => {});

    await expect(
      service.promptSessionUntilReport(handle, 'analyze', llmDirPath, 'Alice'),
    ).resolves.toBeUndefined();
    expect(fake.session.abort).not.toHaveBeenCalled();
  });

  it('rejects with the real error when the prompt fails without a tool call', async () => {
    const handle = await service.createSession(DIRECTORY, 'title', 'sys');
    const fake = lastFake();
    fake.control.setPromptImpl(async () => {
      throw new TypeError('fetch failed');
    });

    await expect(
      service.promptSessionUntilReport(handle, 'analyze', llmDirPath, 'Alice'),
    ).rejects.toThrow('fetch failed');
    expect(fake.session.abort).not.toHaveBeenCalled();
  });

  it('does not mask a valid tool call with the abort-induced prompt rejection', async () => {
    // The tool call is observed, the report file write is dispatched,
    // and the session is aborted; aborting rejects the in-flight prompt
    // as a microtask — but a report was seen, so that rejection must not
    // settle the result as "tool not called". The write path settles
    // with the payload. The tool event runs synchronously (as pi emits
    // it during the turn) before the microtask queue drains.
    const handle = await service.createSession(DIRECTORY, 'title', 'sys');
    const fake = lastFake();
    fake.control.setPromptImpl(async () => {
      throw new TypeError('aborted');
    });

    const resultPromise = service.promptSessionUntilReport(handle, 'analyze', llmDirPath, 'Alice');
    emitToolCall(fake, PAYLOAD);

    await expect(resultPromise).resolves.toEqual(PAYLOAD);
    expect(fake.session.abort).toHaveBeenCalledTimes(1);
  });

  it('rejects when the report file cannot be written', async () => {
    // Point the llm dir at a path whose parent is a file, so mkdir
    // fails and the write path rejects instead of silently losing the
    // report (or hanging).
    const handle = await service.createSession(DIRECTORY, 'title', 'sys');
    const fake = lastFake();
    const blockedParent = path.join(entryDir, 'blocker');
    await writeFile(blockedParent, 'not a directory', 'utf8');
    fake.control.setPromptImpl(async () => {});

    const resultPromise = service.promptSessionUntilReport(
      handle,
      'analyze',
      `${blockedParent}/llm`,
      'Alice',
    );
    emitToolCall(fake, PAYLOAD);

    await expect(resultPromise).rejects.toThrow();
  });

  it('logs a still-waiting progress line with the session state every 30 s while the turn runs', async () => {
    vi.useFakeTimers();
    try {
      const handle = await service.createSession(DIRECTORY, 'title', 'sys');
      const fake = lastFake();
      const pending = pendingPrompt();
      fake.control.setPromptImpl(() => pending.promise);
      const scoped = vi.mocked(createScopedLog).mock.results.at(-1)?.value;

      const resultPromise = service.promptSessionUntilReport(
        handle,
        'analyze',
        llmDirPath,
        'Alice',
      );
      await vi.advanceTimersByTimeAsync(31_000);

      expect(scoped?.info).toHaveBeenCalledWith(
        expect.stringContaining(
          `LLM: "Alice" (session "${handle.id}", user analysis session, 0 turns, ` +
            `0 tool calls, context 22 tokens used, 30s alive): still waiting for ${REPORT_TOOL_NAME}`,
        ),
      );

      emitToolCall(fake, PAYLOAD);
      await expect(resultPromise).resolves.toEqual(PAYLOAD);
      pending.resolve();
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders the provider context usage and the turns run into the heartbeat', async () => {
    vi.useFakeTimers();
    try {
      const handle = await service.createSession(DIRECTORY, 'title', 'sys');
      const fake = lastFake();
      fake.control.setContextUsage({ tokens: 1200, contextWindow: 262144, percent: 0.457 });
      // Two agent turns start before the wait.
      for (const listener of [...fake.control.listeners]) {
        listener({ type: 'turn_start' });
      }
      for (const listener of [...fake.control.listeners]) {
        listener({ type: 'turn_start' });
      }
      const pending = pendingPrompt();
      fake.control.setPromptImpl(() => pending.promise);
      const scoped = vi.mocked(createScopedLog).mock.results.at(-1)?.value;

      const resultPromise = service.promptSessionUntilReport(
        handle,
        'analyze',
        llmDirPath,
        'Alice',
      );
      await vi.advanceTimersByTimeAsync(31_000);

      expect(scoped?.info).toHaveBeenCalledWith(
        expect.stringContaining(
          `LLM: "Alice" (session "${handle.id}", user analysis session, 2 turns, ` +
            `0 tool calls, context 1200/262144 tokens (0.457%), 30s alive): ` +
            `still waiting for ${REPORT_TOOL_NAME}`,
        ),
      );

      emitToolCall(fake, PAYLOAD);
      await expect(resultPromise).resolves.toEqual(PAYLOAD);
      pending.resolve();
    } finally {
      vi.useRealTimers();
    }
  });

  it('the custom tool bound to the session writes its report file', async () => {
    const handle = await service.createSession(DIRECTORY, 'title', 'sys');
    const options = piMock.createOptions[0] as {
      customTools: Array<{ execute(...args: unknown[]): Promise<unknown> }>;
    };
    const reportTool = options.customTools[0];
    expect(reportTool).toBeDefined();

    await reportTool!.execute('tc1', PAYLOAD, undefined, undefined, {} as never);

    const written = JSON.parse(
      await readFile(sessionReportPath(llmDirPath, handle.id), 'utf8'),
    ) as LlmToolPayload;
    expect(written).toEqual(PAYLOAD);
  });
});

describe('getUsage', () => {
  it('maps the pi session statistics onto token usage', async () => {
    const handle = await service.createSession(DIRECTORY, 'title', 'sys');
    lastFake().control.setTokens({
      input: 120,
      cacheRead: 40,
      output: 30,
      cacheWrite: 0,
      total: 190,
    });

    expect(service.getUsage(handle)).toEqual({ input: 120, cacheRead: 40, output: 30 });
  });
});

describe('close', () => {
  it('disposes every created session', async () => {
    const handle = await service.createSession(DIRECTORY, 'title', 'sys');
    const fake = lastFake();
    await service.createSession(DIRECTORY, 'title2', 'sys2');
    const fake2 = piMock.sessions[1]!;

    await service.close();

    expect(fake.session.dispose).toHaveBeenCalledTimes(1);
    expect(fake2.session.dispose).toHaveBeenCalledTimes(1);
    // Handles are invalid after close.
    await expect(service.promptSession(handle, 'x', 'Alice')).rejects.toThrow(
      /no LLM session registered/,
    );
  });
});

describe('session report files', () => {
  it('names the report file after the session', () => {
    expect(sessionReportPath('/cache/entry/llm', 'ses_123')).toBe('/cache/entry/llm/ses_123.json');
  });

  it('returns the validated payload when the report file exists', async () => {
    await writeFile(path.join(llmDirPath, 'ses_1.json'), JSON.stringify(PAYLOAD), 'utf8');
    await expect(readSessionReport(llmDirPath, 'ses_1')).resolves.toEqual(PAYLOAD);
  });

  it('returns undefined when the report file is missing', async () => {
    await expect(readSessionReport(llmDirPath, 'ses_missing')).resolves.toBeUndefined();
  });

  it('returns undefined for a malformed or invalid report file', async () => {
    await writeFile(path.join(llmDirPath, 'ses_bad.json'), 'not json', 'utf8');
    await writeFile(
      path.join(llmDirPath, 'ses_wrong.json'),
      JSON.stringify({ overview: 42 }),
      'utf8',
    );
    await expect(readSessionReport(llmDirPath, 'ses_bad')).resolves.toBeUndefined();
    await expect(readSessionReport(llmDirPath, 'ses_wrong')).resolves.toBeUndefined();
  });
});
