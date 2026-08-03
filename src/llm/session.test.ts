import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Event, OpencodeClient } from '@opencode-ai/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LlmToolPayload } from '../report/index.js';
import { logInfo } from '../util/log.js';
import { ANALYST_AGENT_ID } from './server.js';
import {
  collectSessionUsage,
  createSessionService,
  readSessionReport,
  sessionReportPath,
} from './session.js';

// The heartbeat progress lines are asserted via the mocked logger; the
// other log levels are stubbed so nothing reaches stderr in tests.
vi.mock('../util/log.js', () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
  logInfo: vi.fn(),
  logDebug: vi.fn(),
  setVerbose: vi.fn(),
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

/** Builds a `message.part.updated` event carrying a `step-finish` part. */
function stepEvent(sessionID: string, input: number, output: number, cost: number): Event {
  return {
    type: 'message.part.updated',
    properties: {
      part: {
        id: `step-${sessionID}-${input}`,
        sessionID,
        messageID: 'msg_1',
        type: 'step-finish',
        reason: 'done',
        cost,
        tokens: { input, output, reasoning: 0, cache: { read: 0, write: 0 } },
      },
    },
  } as Event;
}

/** Builds a `message.part.updated` event carrying a plain text part. */
function textEvent(sessionID: string, text: string): Event {
  return {
    type: 'message.part.updated',
    properties: {
      part: { id: `text-${sessionID}`, sessionID, messageID: 'msg_1', type: 'text', text },
    },
  } as Event;
}

interface StubOptions {
  /** Error the server returns from `session.create`. */
  createError?: unknown;
  /** Error the server returns from `session.prompt`. */
  promptError?: unknown;
  /** Make `session.prompt` reject instead of returning an error. */
  promptThrows?: boolean;
  /** Custom `session.prompt` implementation (overrides the default). */
  prompt?: () => Promise<{ data: unknown; error: unknown }>;
  /** Event stream the `event.subscribe` stub yields. */
  stream?: AsyncGenerator<Event>;
  /** Make `event.subscribe` reject. */
  subscribeThrows?: boolean;
}

/**
 * Builds a minimal opencode client stub around the v1 API surface the
 * session layer uses: `session.create`/`prompt`/`abort` and
 * `event.subscribe`, with the option style `{ query, body, path }`.
 *
 * @param options - Behavior overrides.
 * @returns The stubbed client with vi.fn methods.
 */
function stubClient(options: StubOptions = {}): OpencodeClient & {
  session: {
    create: ReturnType<typeof vi.fn>;
    prompt: ReturnType<typeof vi.fn>;
    abort: ReturnType<typeof vi.fn>;
  };
  event: { subscribe: ReturnType<typeof vi.fn> };
} {
  const emptyStream = async function* (): AsyncGenerator<Event> {};
  return {
    session: {
      create: vi.fn(async () => {
        if (options.createError !== undefined) {
          return { data: undefined, error: options.createError };
        }
        return {
          data: { id: 'ses_1', directory: DIRECTORY, title: 't', version: '1' },
          error: undefined,
        };
      }),
      prompt: vi.fn(async () => {
        if (options.prompt !== undefined) {
          return options.prompt();
        }
        if (options.promptThrows) {
          throw new Error('prompt rejected');
        }
        if (options.promptError !== undefined) {
          return { data: undefined, error: options.promptError };
        }
        return {
          data: {
            info: { id: 'msg_1', sessionID: 'ses_1', role: 'assistant' },
            parts: [{ type: 'text', text: 'assistant reply' }],
          },
          error: undefined,
        };
      }),
      abort: vi.fn(async () => ({ data: undefined, error: undefined })),
    },
    event: {
      subscribe: vi.fn(async () => {
        if (options.subscribeThrows) {
          throw new Error('no events');
        }
        return { stream: options.stream ?? emptyStream() };
      }),
    },
  } as unknown as OpencodeClient & {
    session: {
      create: ReturnType<typeof vi.fn>;
      prompt: ReturnType<typeof vi.fn>;
      abort: ReturnType<typeof vi.fn>;
    };
    event: { subscribe: ReturnType<typeof vi.fn> };
  };
}

describe('createSessionService', () => {
  it('creates a session scoped to the clone directory with the title', async () => {
    const client = stubClient();
    const service = createSessionService(client);

    const handle = await service.createSession(DIRECTORY, 'dev-perf: Alice');

    expect(client.session.create).toHaveBeenCalledWith({
      query: { directory: DIRECTORY },
      body: { title: 'dev-perf: Alice' },
    });
    expect(handle).toEqual({ id: 'ses_1', directory: DIRECTORY });
  });

  it('throws a readable error when the server rejects creation', async () => {
    const client = stubClient({ createError: { message: 'nope' } });
    const service = createSessionService(client);

    await expect(service.createSession(DIRECTORY, 't')).rejects.toThrow(
      /Failed to create an LLM session in \/clone\/repo: nope/,
    );
  });

  it('sends a text part with the analyst agent and returns the final assistant text', async () => {
    const client = stubClient();
    const service = createSessionService(client);

    const text = await service.promptSession(
      { id: 'ses_1', directory: DIRECTORY },
      'analyze',
      'Alice',
    );

    expect(text).toBe('assistant reply');
    expect(client.session.prompt).toHaveBeenCalledWith({
      path: { id: 'ses_1' },
      query: { directory: DIRECTORY },
      body: {
        agent: ANALYST_AGENT_ID,
        noReply: false,
        parts: [{ type: 'text', text: 'analyze' }],
      },
    });
  });

  it('passes noReply through for context injection, still with the analyst agent', async () => {
    const client = stubClient();
    const service = createSessionService(client);

    await service.promptSession({ id: 'ses_1', directory: DIRECTORY }, 'context', 'Alice', {
      noReply: true,
    });

    const call = client.session.prompt.mock.calls[0]?.[0] as {
      body: { noReply: boolean; agent: string };
    };
    expect(call.body.noReply).toBe(true);
    expect(call.body.agent).toBe(ANALYST_AGENT_ID);
  });

  it('aborts the session and rethrows when the server returns an error', async () => {
    const client = stubClient({ promptError: { message: 'rate limited' } });
    const service = createSessionService(client);

    await expect(
      service.promptSession({ id: 'ses_1', directory: DIRECTORY }, 'analyze', 'Alice'),
    ).rejects.toThrow(/LLM session prompt failed in \/clone\/repo: rate limited/);
    expect(client.session.abort).toHaveBeenCalledWith({
      path: { id: 'ses_1' },
      query: { directory: DIRECTORY },
    });
  });

  it('aborts the session and rethrows when the request rejects', async () => {
    const client = stubClient({ promptThrows: true });
    const service = createSessionService(client);

    await expect(
      service.promptSession({ id: 'ses_1', directory: DIRECTORY }, 'analyze', 'Alice'),
    ).rejects.toThrow('prompt rejected');
    expect(client.session.abort).toHaveBeenCalledTimes(1);
  });

  it('logs a still-waiting progress line while the reply is pending', async () => {
    vi.useFakeTimers();
    try {
      // The model never answers; the heartbeat must make the wait
      // visible instead of an endless silent prompt.
      let settlePrompt: (value: { data: unknown; error: unknown }) => void = () => {};
      const pendingPrompt = new Promise<{ data: unknown; error: unknown }>((resolve) => {
        settlePrompt = resolve;
      });
      const client = stubClient({ prompt: () => pendingPrompt });
      const service = createSessionService(client);

      const resultPromise = service.promptSession(
        { id: 'ses_1', directory: DIRECTORY },
        'analyze',
        'Alice',
      );
      await vi.advanceTimersByTimeAsync(31_000);

      expect(logInfo).toHaveBeenCalledWith(
        expect.stringContaining('LLM: Alice: still waiting for the LLM reply'),
      );
      expect(logInfo).toHaveBeenCalledWith(expect.stringContaining('30s elapsed'));

      settlePrompt({
        data: {
          info: { id: 'msg_1', sessionID: 'ses_1', role: 'assistant' },
          parts: [{ type: 'text', text: 'assistant reply' }],
        },
        error: undefined,
      });
      await expect(resultPromise).resolves.toBe('assistant reply');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('promptSessionUntilReport', () => {
  let llmDir: string;

  beforeEach(async () => {
    llmDir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-session-poll-'));
  });

  afterEach(async () => {
    await rm(llmDir, { recursive: true, force: true });
  });

  it('aborts the running session and returns the payload when the report appears mid-turn', async () => {
    // The turn never finishes on its own; the report file is the only
    // thing that can end the prompt.
    let settlePrompt: (value: { data: unknown; error: unknown }) => void = () => {};
    const pendingPrompt = new Promise<{ data: unknown; error: unknown }>((resolve) => {
      settlePrompt = resolve;
    });
    const client = stubClient({ prompt: () => pendingPrompt });
    const service = createSessionService(client);

    const resultPromise = service.promptSessionUntilReport(
      { id: 'ses_1', directory: DIRECTORY },
      'analyze',
      llmDir,
      'Alice',
    );
    // The simulated tool writes its output while the turn is running.
    await writeFile(path.join(llmDir, 'ses_1.json'), JSON.stringify(PAYLOAD), 'utf8');

    await expect(resultPromise).resolves.toEqual(PAYLOAD);
    expect(client.session.abort).toHaveBeenCalledWith({
      path: { id: 'ses_1' },
      query: { directory: DIRECTORY },
    });
    // Settle the abandoned prompt so the test ends cleanly.
    settlePrompt({
      data: {
        info: { id: 'msg_1', sessionID: 'ses_1', role: 'assistant' },
        parts: [{ type: 'text', text: 'assistant reply' }],
      },
      error: undefined,
    });
  });

  it('logs a still-waiting progress line every 30 s while the turn runs', async () => {
    vi.useFakeTimers();
    try {
      // The model never finishes; the heartbeat must make the wait
      // visible instead of an endless silent prompt.
      let settlePrompt: (value: { data: unknown; error: unknown }) => void = () => {};
      const pendingPrompt = new Promise<{ data: unknown; error: unknown }>((resolve) => {
        settlePrompt = resolve;
      });
      const client = stubClient({ prompt: () => pendingPrompt });
      const service = createSessionService(client);

      const resultPromise = service.promptSessionUntilReport(
        { id: 'ses_1', directory: DIRECTORY },
        'analyze',
        llmDir,
        'Alice',
      );
      await vi.advanceTimersByTimeAsync(31_000);

      expect(logInfo).toHaveBeenCalledWith(
        expect.stringContaining('LLM: Alice: still waiting for devperf_report'),
      );
      expect(logInfo).toHaveBeenCalledWith(expect.stringContaining('30s elapsed'));

      // The simulated tool writes its output while the turn is running.
      await writeFile(path.join(llmDir, 'ses_1.json'), JSON.stringify(PAYLOAD), 'utf8');
      await vi.advanceTimersByTimeAsync(1_000);

      await expect(resultPromise).resolves.toEqual(PAYLOAD);
      expect(client.session.abort).toHaveBeenCalled();
      // Settle the abandoned prompt so the test ends cleanly.
      settlePrompt({
        data: {
          info: { id: 'msg_1', sessionID: 'ses_1', role: 'assistant' },
          parts: [{ type: 'text', text: 'assistant reply' }],
        },
        error: undefined,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns the payload written before the turn ended, without aborting', async () => {
    const client = stubClient({
      prompt: async () => {
        await writeFile(path.join(llmDir, 'ses_1.json'), JSON.stringify(PAYLOAD), 'utf8');
        return {
          data: {
            info: { id: 'msg_1', sessionID: 'ses_1', role: 'assistant' },
            parts: [{ type: 'text', text: 'assistant reply' }],
          },
          error: undefined,
        };
      },
    });
    const service = createSessionService(client);

    await expect(
      service.promptSessionUntilReport(
        { id: 'ses_1', directory: DIRECTORY },
        'analyze',
        llmDir,
        'Alice',
      ),
    ).resolves.toEqual(PAYLOAD);
    expect(client.session.abort).not.toHaveBeenCalled();
  });

  it('returns undefined when the turn ends without calling the tool', async () => {
    const client = stubClient();
    const service = createSessionService(client);

    await expect(
      service.promptSessionUntilReport(
        { id: 'ses_1', directory: DIRECTORY },
        'analyze',
        llmDir,
        'Alice',
      ),
    ).resolves.toBeUndefined();
    expect(client.session.abort).not.toHaveBeenCalled();
  });

  it('aborts the session and rethrows when the prompt fails', async () => {
    const client = stubClient({ promptError: { message: 'rate limited' } });
    const service = createSessionService(client);

    await expect(
      service.promptSessionUntilReport(
        { id: 'ses_1', directory: DIRECTORY },
        'analyze',
        llmDir,
        'Alice',
      ),
    ).rejects.toThrow(/LLM session prompt failed in \/clone\/repo: rate limited/);
    expect(client.session.abort).toHaveBeenCalledWith({
      path: { id: 'ses_1' },
      query: { directory: DIRECTORY },
    });
  });
});

describe('session report files', () => {
  let llmDir: string;

  beforeEach(async () => {
    llmDir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-session-llm-'));
  });

  afterEach(async () => {
    await rm(llmDir, { recursive: true, force: true });
  });

  it('names the report file after the session', () => {
    expect(sessionReportPath('/cache/entry/llm', 'ses_123')).toBe('/cache/entry/llm/ses_123.json');
  });

  it('returns the validated payload when the report file exists', async () => {
    await writeFile(path.join(llmDir, 'ses_1.json'), JSON.stringify(PAYLOAD), 'utf8');
    await expect(readSessionReport(llmDir, 'ses_1')).resolves.toEqual(PAYLOAD);
  });

  it('returns undefined when the report file is missing', async () => {
    await expect(readSessionReport(llmDir, 'ses_missing')).resolves.toBeUndefined();
  });

  it('returns undefined for a malformed or invalid report file', async () => {
    await writeFile(path.join(llmDir, 'ses_bad.json'), 'not json', 'utf8');
    await writeFile(path.join(llmDir, 'ses_wrong.json'), JSON.stringify({ overview: 42 }), 'utf8');
    await expect(readSessionReport(llmDir, 'ses_bad')).resolves.toBeUndefined();
    await expect(readSessionReport(llmDir, 'ses_wrong')).resolves.toBeUndefined();
  });
});

describe('collectSessionUsage', () => {
  it('accumulates step-finish tokens and cost per session', async () => {
    const stream = (async function* () {
      yield stepEvent('ses_1', 10, 5, 0.01);
      yield textEvent('ses_1', 'ignored text part');
      yield stepEvent('ses_1', 20, 15, 0.02);
      yield stepEvent('ses_2', 100, 50, 0.1);
    })();
    const client = stubClient({ stream });

    const collector = await collectSessionUsage(client, DIRECTORY);

    await vi.waitFor(() => {
      expect(collector.get('ses_1')).toEqual({
        tokenUsage: { input: 30, output: 20 },
        estimatedCostUsd: 0.03,
      });
    });
    expect(collector.get('ses_2')).toEqual({
      tokenUsage: { input: 100, output: 50 },
      estimatedCostUsd: 0.1,
    });
    expect(collector.get('ses_unknown')).toBeUndefined();
    collector.close();
  });

  it('returns a no-op collector when the subscription fails', async () => {
    const client = stubClient({ subscribeThrows: true });

    const collector = await collectSessionUsage(client, DIRECTORY);

    expect(collector.get('ses_1')).toBeUndefined();
    expect(() => collector.close()).not.toThrow();
  });
});
