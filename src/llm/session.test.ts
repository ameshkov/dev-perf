import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Event, OpencodeClient } from '@opencode-ai/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LlmToolPayload } from '../report/index.js';
import {
  collectSessionUsage,
  createSessionService,
  readSessionReport,
  sessionReportPath,
} from './session.js';

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
      areas: ['src'],
      commits: ['abc1234d'],
      qualitySignals: ['tests added'],
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

  it('sends a text part and returns the final assistant text', async () => {
    const client = stubClient();
    const service = createSessionService(client);

    const text = await service.promptSession({ id: 'ses_1', directory: DIRECTORY }, 'analyze');

    expect(text).toBe('assistant reply');
    expect(client.session.prompt).toHaveBeenCalledWith({
      path: { id: 'ses_1' },
      query: { directory: DIRECTORY },
      body: { noReply: false, parts: [{ type: 'text', text: 'analyze' }] },
    });
  });

  it('passes noReply through for context injection', async () => {
    const client = stubClient();
    const service = createSessionService(client);

    await service.promptSession({ id: 'ses_1', directory: DIRECTORY }, 'context', {
      noReply: true,
    });

    const call = client.session.prompt.mock.calls[0]?.[0] as { body: { noReply: boolean } };
    expect(call.body.noReply).toBe(true);
  });

  it('aborts the session and rethrows when the server returns an error', async () => {
    const client = stubClient({ promptError: { message: 'rate limited' } });
    const service = createSessionService(client);

    await expect(
      service.promptSession({ id: 'ses_1', directory: DIRECTORY }, 'analyze'),
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
      service.promptSession({ id: 'ses_1', directory: DIRECTORY }, 'analyze'),
    ).rejects.toThrow('prompt rejected');
    expect(client.session.abort).toHaveBeenCalledTimes(1);
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
