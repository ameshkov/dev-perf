/**
 * LLM integration tests against a mocked custom provider server: a
 * local HTTP server (OpenAI-compatible `/v1/chat/completions` with SSE
 * streaming) stands in for the user's provider, and the REAL pi
 * runtime and session layer talk to it — nothing in
 * `@earendil-works/pi-coding-agent` is mocked. This proves the whole
 * LLM flow works end-to-end with the actual provider protocol: the
 * provider URL and API key plumbing, the streamed chat-completions
 * round-trips carrying the system prompts and the `devperf_report`
 * tool, the tool-call → report-file path, and per-session token
 * usage. The server reports the same fixed usage for every request,
 * so the aggregated usage is a whole number of described requests
 * (the analysis turn may or may not get a follow-up request for the
 * tool result, depending on how quickly the early abort lands).
 */
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthorGroup } from '../deterministic/identity.js';
import { llmDir } from '../repo/cache.js';
import type { AnalyzedRange, LlmToolPayload } from '../report/index.js';
import type { ScopedLog } from '../util/log.js';
import { analyzeRepositoryLLM } from './analyze.js';
import type { AnalyzeRepoInput } from './analyze.js';
import { buildOrientationPrompt, buildOrientationSystemPrompt } from './prompts.js';
import { createLlmRuntime } from './runtime.js';
import type { LlmRuntimeConfig } from './runtime.js';
import { createSessionService } from './session.js';

/** Fixed token usage the mock provider reports for every request. */
const USAGE = {
  prompt_tokens: 100,
  completion_tokens: 20,
  prompt_tokens_details: { cached_tokens: 40 },
};

/** The repository context the mock provider returns for orientation. */
const REPO_CONTEXT = 'TypeScript CLI; modules src/ and docs/; tested with Vitest.';

/** The analysis the mock provider reports through `devperf_report`. */
const PAYLOAD: LlmToolPayload = {
  overview: 'Shipped the mock pipeline.',
  contributions: [
    {
      title: 'Add pipeline',
      summary: 'Wired the analysis loop.',
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

const RANGE: AnalyzedRange = {
  since: '2026-01-01T00:00:00.000Z',
  until: '2026-01-31T00:00:00.000Z',
};

/** One chat-completion request the mock provider received. */
interface RecordedRequest {
  method: string;
  path: string;
  authorization: string | undefined;
  body: {
    messages: Array<{ role: string; content?: unknown }>;
    tools?: Array<{ function?: { name?: string } }>;
  };
}

/**
 * A local OpenAI-compatible provider: `POST /v1/chat/completions` with
 * SSE streaming. It classifies each request from its latest message —
 * the orientation prompt gets the repo context back, the contribution
 * analysis gets a `devperf_report` tool call, and any tool-result
 * follow-up gets a plain text completion — so the agent loop behaves
 * like a cooperative model without any pi mocking.
 */
class MockProvider {
  /** Requests received, in order. */
  readonly requests: RecordedRequest[] = [];
  private server: Server | undefined;
  /** The base URL, e.g. `http://127.0.0.1:<port>/v1`. */
  baseUrl = '';

  async start(): Promise<string> {
    this.server = createServer((req, res) => {
      void this.handle(req, res);
    });
    await new Promise<void>((resolve, reject) => {
      const fail = (error: Error): void => reject(error);
      this.server!.on('error', fail);
      this.server!.listen(0, '127.0.0.1', () => {
        this.server!.off('error', fail);
        resolve();
      });
    });
    const { port } = this.server!.address() as AddressInfo;
    this.baseUrl = `http://127.0.0.1:${port}/v1`;
    return this.baseUrl;
  }

  async close(): Promise<void> {
    if (this.server === undefined) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      this.server!.close((error) => (error === undefined ? resolve() : reject(error)));
    });
  }

  /** The recorded requests whose latest user message is a contribution analysis. */
  analysisRequests(): RecordedRequest[] {
    return this.requests.filter((request) =>
      this.userText(request.body).includes('# Contribution analysis'),
    );
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
      res.writeHead(404).end();
      return;
    }
    const raw = await readBody(req);
    let body: RecordedRequest['body'];
    try {
      body = JSON.parse(raw) as RecordedRequest['body'];
    } catch {
      res.writeHead(400).end();
      return;
    }
    this.requests.push({
      method: req.method,
      path: req.url,
      authorization: req.headers.authorization,
      body,
    });

    const lastRole = body.messages.at(-1)?.role;
    const content = this.userText(body);
    if (lastRole === 'tool') {
      this.writeSse(res, textChunks('The analysis has been recorded.'));
    } else if (content.includes('# Contribution analysis')) {
      this.writeSse(res, toolCallChunks());
    } else if (content.includes('# Repository orientation')) {
      this.writeSse(res, textChunks(REPO_CONTEXT));
    } else {
      this.writeSse(res, textChunks('Understood.'));
    }
  }

  /** The text of the latest user message, or `''` when there is none. */
  private userText(body: RecordedRequest['body']): string {
    for (const message of [...body.messages].reverse()) {
      const content = message.content;
      if (content === null || content === undefined) {
        continue;
      }
      if (typeof content === 'string') {
        return content;
      }
      if (Array.isArray(content)) {
        const text = content
          .filter((part) => part?.type === 'text' && typeof part.text === 'string')
          .map((part) => part.text as string)
          .join('\n');
        if (text.length > 0) {
          return text;
        }
      }
    }
    return '';
  }

  private writeSse(res: ServerResponse, chunks: Record<string, unknown>[]): void {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    for (const chunk of chunks) {
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    }
    res.write('data: [DONE]\n\n');
    res.end();
  }
}

/** Reads a request body as a string. */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk as Buffer));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** One SSE chunk with a stable id/model, overriding the given fields. */
function chunk(partial: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'chunk_1',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'mock-model',
    ...partial,
  };
}

/** SSE chunks for a plain text completion (with usage on the last one). */
function textChunks(text: string): Record<string, unknown>[] {
  return [
    chunk({ choices: [{ index: 0, delta: { role: 'assistant', content: text } }] }),
    chunk({ usage: USAGE, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }),
  ];
}

/**
 * SSE chunks for a `devperf_report` tool call. The usage is carried on
 * the same chunk as the tool call so it is recorded even though the
 * session aborts as soon as the call starts.
 */
function toolCallChunks(): Record<string, unknown>[] {
  const argumentsString = JSON.stringify(PAYLOAD);
  return [
    chunk({
      usage: USAGE,
      choices: [
        {
          index: 0,
          delta: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                index: 0,
                id: 'call_1',
                type: 'function',
                function: { name: 'devperf_report', arguments: argumentsString },
              },
            ],
          },
        },
      ],
    }),
    chunk({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }),
  ];
}

/** One author group with a single commit. */
function group(email: string, name: string, sha: string): AuthorGroup {
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
        subject: 'Add pipeline',
        files: [{ path: 'src/pipeline.ts', added: 10, deleted: 2 }],
        isMerge: false,
      },
    ],
  };
}

function stubLog(): ScopedLog {
  return { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
}

function config(): LlmRuntimeConfig {
  return {
    providerUrl: 'http://placeholder', // replaced with the mock base URL at runtime
    model: 'mock-model',
    apiKey: 'sk-mock-123',
    limitContext: 100_000,
    limitOutput: 1000,
  };
}

let tmpRoot: string;
let entryDir: string;
let cloneDir: string;
let mock: MockProvider;

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-provider-server-'));
  entryDir = path.join(tmpRoot, 'entry');
  cloneDir = path.join(entryDir, 'repo');
  await mkdir(cloneDir, { recursive: true });
  mock = new MockProvider();
  await mock.start();
});

afterEach(async () => {
  await mock.close();
  await rm(tmpRoot, { recursive: true, force: true });
});

/** Runs the real runtime + session service bound to the mock provider. */
async function withRuntime<T>(
  run: (service: ReturnType<typeof createSessionService>) => Promise<T>,
): Promise<T> {
  const cfg = { ...config(), providerUrl: mock.baseUrl };
  const runtime = await createLlmRuntime(cloneDir, cfg, stubLog());
  const service = createSessionService(runtime, entryDir, stubLog());
  try {
    return await run(service);
  } finally {
    await service.close();
    await runtime.dispose();
  }
}

describe('LLM against a mocked provider server', () => {
  it('runs the full orientation → contribution-analysis flow and produces a completed report', async () => {
    const results = await withRuntime((service) =>
      analyzeRepositoryLLM({
        repo: 'https://example.com/repo.git',
        cloneDir,
        entryDir,
        config: { ...config(), providerUrl: mock.baseUrl },
        range: RANGE,
        groups: [group('alice@example.com', 'Alice', 'abc1234d')],
        service,
        refresh: false,
        log: stubLog(),
      }),
    );

    const result = results[0]!;
    expect(result.email).toBe('alice@example.com');
    expect(result.llm.status).toBe('completed');
    expect(result.llm.overview).toBe(PAYLOAD.overview);
    expect(result.llm.contributions).toEqual(PAYLOAD.contributions);

    // The session report and the cached result land in the entry's
    // `llm/` directory.
    const reports = await readdir(llmDir(entryDir));
    expect(reports.length).toBeGreaterThan(0);

    // At least the orientation and the analysis reached the provider.
    expect(mock.requests.length).toBeGreaterThanOrEqual(2);
    expect(mock.analysisRequests().length).toBeGreaterThanOrEqual(1);

    // The prompt may or may not get a follow-up request for the tool
    // result (the early abort usually wins), so the usage is a whole
    // number of described requests: each contributes 60 input, 40
    // cache-read, and 20 output tokens.
    const tokenUsage = result.llm.tokenUsage!;
    expect(tokenUsage.input % 60).toBe(0);
    expect(tokenUsage.input / 60).toBeGreaterThanOrEqual(1);
    expect(tokenUsage.cacheRead).toBe((tokenUsage.input * 2) / 3);
    expect(tokenUsage.output).toBe(tokenUsage.input / 3);
  });

  it('talks to the provider with the resolved base URL, the API key, and the report tool', async () => {
    const input = (service: ReturnType<typeof createSessionService>): AnalyzeRepoInput => ({
      repo: 'https://example.com/repo.git',
      cloneDir,
      entryDir,
      config: { ...config(), providerUrl: mock.baseUrl },
      range: RANGE,
      groups: [group('alice@example.com', 'Alice', 'abc1234d')],
      service,
      refresh: false,
      log: stubLog(),
    });
    await withRuntime((service) => analyzeRepositoryLLM(input(service)));

    for (const request of mock.requests) {
      expect(request.method).toBe('POST');
      expect(request.path).toBe('/v1/chat/completions');
      expect(request.authorization).toBe('Bearer sk-mock-123');
    }
    // The report tool is advertised to the provider for the analysis.
    const toolCallsRequest = mock.analysisRequests()[0];
    const toolNames = (toolCallsRequest?.body.tools ?? []).map((tool) => tool.function?.name);
    expect(toolNames).toContain('devperf_report');
  });

  it('sends the static system prompts to the provider', async () => {
    const input = (service: ReturnType<typeof createSessionService>): AnalyzeRepoInput => ({
      repo: 'https://example.com/repo.git',
      cloneDir,
      entryDir,
      config: { ...config(), providerUrl: mock.baseUrl },
      range: RANGE,
      groups: [group('alice@example.com', 'Alice', 'abc1234d')],
      service,
      refresh: false,
      log: stubLog(),
    });
    await withRuntime((service) => analyzeRepositoryLLM(input(service)));

    const allMessages = mock.requests.flatMap((request) => request.body.messages);
    const systemPrompts = allMessages
      .filter((message) => message.role === 'system' && typeof message.content === 'string')
      .map((message) => message.content as string)
      .join('\n');
    expect(systemPrompts).toContain('dev-perf repository analyst');
    expect(systemPrompts).toContain('dev-perf contributor analyst');
    // Task details live in the user messages, not the system prompt.
    expect(systemPrompts).not.toContain('alice@example.com');
    expect(systemPrompts).not.toContain('2026-01-01T00:00:00.000Z');
  });

  it('reports the provider usage for a completed turn (orientation)', async () => {
    await withRuntime(async (service) => {
      const handle = await service.createSession(
        cloneDir,
        'dev-perf: repository orientation',
        await buildOrientationSystemPrompt(),
      );
      const context = await service.promptSession(
        handle,
        await buildOrientationPrompt('https://example.com/repo.git'),
        'repo',
      );

      expect(context).toBe(REPO_CONTEXT);
      // pi reports cached reads separately: input = prompt_tokens −
      // cached_tokens, so the mocked 100/20/40 splits into 60/40/20.
      expect(service.getUsage(handle)).toEqual({ input: 60, cacheRead: 40, output: 20 });
    });
  });

  it('runs a rerun from the LLM result cache without touching the provider again', async () => {
    const input = (service: ReturnType<typeof createSessionService>): AnalyzeRepoInput => ({
      repo: 'https://example.com/repo.git',
      cloneDir,
      entryDir,
      config: { ...config(), providerUrl: mock.baseUrl },
      range: RANGE,
      groups: [group('alice@example.com', 'Alice', 'abc1234d')],
      service,
      refresh: false,
      log: stubLog(),
    });

    const first = await withRuntime((service) => analyzeRepositoryLLM(input(service)));
    expect(first[0]?.llm.status).toBe('completed');
    const analysesAfterFirstRun = mock.analysisRequests().length;
    expect(analysesAfterFirstRun).toBeGreaterThanOrEqual(1);

    // A fresh runtime and service against the same cache entry: the
    // result is served from the cache, no new provider call.
    const second = await withRuntime((service) => analyzeRepositoryLLM(input(service)));
    expect(second[0]?.llm.overview).toBe(PAYLOAD.overview);
    expect(mock.analysisRequests().length).toBe(analysesAfterFirstRun);
  });
});
