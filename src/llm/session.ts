/**
 * Session layer for the LLM analysis: the `SessionService` interface
 * the orchestration layer drives —
 * session creation and prompting scoped to the clone directory, with
 * `noReply` support and abort-on-error — plus tool-call detection
 * (the `devperf_report` output file exists and zod-validates) and
 * per-session token usage collected from the server's event stream.
 * Analysis prompts run through `promptSessionUntilReport`, which polls
 * the report file mid-turn and aborts the session as soon as the tool
 * output exists, so the orchestration never waits for an agent that
 * keeps working after reporting. The real implementation talks to the
 * opencode server via the `@opencode-ai/sdk` client (the v1 client the
 * server handle exposes: `{ query, body, path }` option style); tests
 * stub the interface.
 */
import type { Event, OpencodeClient, StepFinishPart, TextPart } from '@opencode-ai/sdk';
import { llmToolPayloadSchema } from '../report/index.js';
import type { LlmToolPayload, TokenUsage } from '../report/index.js';
import { errorDetail } from '../util/error.js';
import { readJsonFile } from '../util/json.js';
import { logWarn } from '../util/log.js';
import { ANALYST_AGENT_ID } from './server.js';

/** One session on the server, scoped to the clone directory. */
export interface SessionHandle {
  /** Server-side session id (also names the tool's output file). */
  id: string;
  /** The clone directory the session was created in. */
  directory: string;
}

/** How often the `devperf_report` output file is polled mid-turn. */
const REPORT_POLL_INTERVAL_MS = 500;

/** Options for a single prompt.
 *
 * @internal Exported for tests only (`analyze.test.ts`); also used by
 * `promptSessionWith` within the module. Not part of the public module
 * API.
 */
export interface PromptOptions {
  /**
   * True to record the message without triggering a reply (context
   * injection).
   */
  noReply?: boolean;
}

/** Token usage and cost accumulated for one session. */
export interface SessionUsage {
  /** Input/output token counts. */
  tokenUsage: TokenUsage;
  /** Estimated cost in USD reported by the provider. */
  estimatedCostUsd: number;
}

/** Per-session usage collected from the server event stream. */
export interface UsageCollector {
  /** Usage accumulated for a session, if any. */
  get(sessionID: string): SessionUsage | undefined;
  /** Stops consuming the event stream. */
  close(): void;
}

/**
 * The session operations the orchestration layer needs.
 * `createSessionService` provides the real implementation bound to an
 * opencode client; `analyze.ts` accepts any implementation, which lets
 * the enforcement and caching tests stub the model's behavior.
 */
export interface SessionService {
  /** Creates a session in the given directory. */
  createSession(directory: string, title: string): Promise<SessionHandle>;
  /** Sends a text prompt and returns the final assistant text. */
  promptSession(handle: SessionHandle, text: string, options?: PromptOptions): Promise<string>;
  /**
   * Sends a text prompt and resolves as soon as the session's
   * `devperf_report` output exists — aborting the running session so
   * the orchestration does not wait for the agent to finish its turn —
   * or when the turn ends without calling the tool.
   */
  promptSessionUntilReport(
    handle: SessionHandle,
    text: string,
    llmDir: string,
  ): Promise<LlmToolPayload | undefined>;
  /** Starts collecting per-session usage from the event stream. */
  collectUsage(directory: string): Promise<UsageCollector>;
}

/**
 * Binds the session wrappers to an opencode client.
 *
 * @param client - Type-safe client of a running opencode server.
 * @returns The session service for that server.
 */
export function createSessionService(client: OpencodeClient): SessionService {
  return {
    createSession: (directory, title) => createSessionWith(client, directory, title),
    promptSession: (handle, text, options) => promptSessionWith(client, handle, text, options),
    promptSessionUntilReport: (handle, text, llmDir) =>
      promptSessionUntilReportWith(client, handle, text, llmDir),
    collectUsage: (directory) => collectSessionUsage(client, directory),
  };
}

/**
 * Creates a session scoped to the clone directory (risk mitigation:
 * sessions are pinned to the server's project directory).
 *
 * @param client - The opencode client.
 * @param directory - The clone directory to create the session in.
 * @param title - Human-readable session title.
 * @returns The session handle.
 * @throws {Error} When the server rejects the session creation.
 */
async function createSessionWith(
  client: OpencodeClient,
  directory: string,
  title: string,
): Promise<SessionHandle> {
  const result = await client.session.create({ query: { directory }, body: { title } });
  if (result.error !== undefined) {
    throw new Error(
      `Failed to create an LLM session in ${directory}: ${errorDetail(result.error)}`,
    );
  }
  return { id: result.data.id, directory };
}

/**
 * Sends a text prompt to a session; with `noReply: true` the message
 * is recorded without triggering a reply (context injection). Every
 * prompt runs with the `devperf-analyst` agent (`ANALYST_AGENT_ID`),
 * whose prompt and restricted tool surface come from the generated
 * server config. On any failure the session is aborted and the error
 * rethrown.
 *
 * @param client - The opencode client.
 * @param handle - The session to prompt.
 * @param text - The prompt text.
 * @param options - Prompt options.
 * @returns The final assistant text (empty for `noReply` prompts).
 * @throws {Error} When the prompt fails; the session is aborted first.
 */
async function promptSessionWith(
  client: OpencodeClient,
  handle: SessionHandle,
  text: string,
  options: PromptOptions = {},
): Promise<string> {
  try {
    const result = await client.session.prompt({
      path: { id: handle.id },
      query: { directory: handle.directory },
      body: {
        agent: ANALYST_AGENT_ID,
        noReply: options.noReply === true,
        parts: [{ type: 'text', text }],
      },
    });
    if (result.error !== undefined) {
      throw new Error(
        `LLM session prompt failed in ${handle.directory}: ${errorDetail(result.error)}`,
      );
    }
    return result.data.parts
      .filter((part): part is TextPart => part.type === 'text')
      .map((part) => part.text)
      .join('\n');
  } catch (error) {
    await abortSession(client, handle);
    throw error;
  }
}

/**
 * Best-effort session abort: used to stop a session whose prompt
 * failed. Abort errors are swallowed so the original failure surfaces.
 *
 * @param client - The opencode client.
 * @param handle - The session to abort.
 */
async function abortSession(client: OpencodeClient, handle: SessionHandle): Promise<void> {
  try {
    await client.session.abort({ path: { id: handle.id }, query: { directory: handle.directory } });
  } catch {
    // Best effort; the original error is the one that matters.
  }
}

/**
 * Sends an analysis prompt with the `devperf-analyst` agent and
 * resolves as soon as the session's `devperf_report` output exists,
 * without waiting for the agent to finish its turn: the report file is
 * polled while the prompt is still running, and the first valid payload
 * aborts the session and is returned. When the turn ends without a
 * report, `undefined` is returned so the caller can send a reminder.
 *
 * @param client - The opencode client.
 * @param handle - The session to prompt.
 * @param text - The prompt text.
 * @param llmDir - The entry's `llm/` directory holding the report files.
 * @returns The validated analysis payload, or `undefined` when the turn
 * ended without calling the tool.
 * @throws {Error} When the prompt fails; the session is aborted first.
 */
async function promptSessionUntilReportWith(
  client: OpencodeClient,
  handle: SessionHandle,
  text: string,
  llmDir: string,
): Promise<LlmToolPayload | undefined> {
  const prompt = client.session.prompt({
    path: { id: handle.id },
    query: { directory: handle.directory },
    body: { agent: ANALYST_AGENT_ID, parts: [{ type: 'text', text }] },
  });
  let done = false;
  const report = pollForReport(handle, llmDir, () => done);
  const outcome = await Promise.race([
    prompt.then(
      (result) =>
        result.error === undefined
          ? { kind: 'finished' as const }
          : {
              kind: 'error' as const,
              error: new Error(
                `LLM session prompt failed in ${handle.directory}: ${errorDetail(result.error)}`,
              ),
            },
      (error) => ({
        kind: 'error' as const,
        error: error instanceof Error ? error : new Error(errorDetail(error)),
      }),
    ),
    report.then((payload) => ({ kind: 'report' as const, payload })),
  ]);

  if (outcome.kind === 'report' && outcome.payload !== undefined) {
    // The tool wrote the report while the turn was still running: stop
    // the session and move on — the agent may never finish otherwise.
    done = true;
    await abortSession(client, handle);
    void prompt.catch(() => {});
    return outcome.payload;
  }
  done = true;
  // The report may have been written in the same tick the turn ended.
  const payload = await readSessionReport(llmDir, handle.id);
  if (payload !== undefined) {
    void prompt.catch(() => {});
    return payload;
  }
  if (outcome.kind === 'error') {
    await abortSession(client, handle);
    throw outcome.error;
  }
  return undefined;
}

/**
 * Polls the session's report file until a valid payload exists or the
 * caller stops the loop (`done` flips after the prompt settled).
 * `undefined` may be returned when the loop was stopped before any
 * payload appeared; the race in `promptSessionUntilReportWith` only
 * consumes non-undefined results.
 *
 * @param handle - The session whose report file is polled.
 * @param llmDir - The entry's `llm/` directory holding the report files.
 * @param isDone - True when the caller no longer needs the poll.
 * @returns The validated analysis payload, or `undefined`.
 */
async function pollForReport(
  handle: SessionHandle,
  llmDir: string,
  isDone: () => boolean,
): Promise<LlmToolPayload | undefined> {
  while (!isDone()) {
    await sleep(REPORT_POLL_INTERVAL_MS);
    const payload = await readSessionReport(llmDir, handle.id);
    if (payload !== undefined) {
      return payload;
    }
  }
  return undefined;
}

/**
 * Waits without keeping the event loop alive, so a leftover poll after
 * a finished prompt cannot delay the process exit.
 *
 * @param ms - Milliseconds to wait.
 * @returns A promise resolving after `ms` milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref();
  });
}

/**
 * Returns the path of a session's report file inside the entry's
 * `llm/` directory — where the generated `devperf_report` tool writes
 * its validated payload.
 *
 * @param llmDir - The cache entry's `llm/` directory.
 * @param sessionID - The session id.
 * @returns The report file path.
 */
export function sessionReportPath(llmDir: string, sessionID: string): string {
  return `${llmDir}/${sessionID}.json`;
}

/**
 * Tool-call detection: reads the session's report file
 * and returns the validated analysis payload, or `undefined` when the
 * file is missing, malformed, or fails validation — meaning the model
 * did not call `devperf_report` (or produced an unusable payload).
 * Production callers poll it via `promptSessionUntilReport`.
 *
 * @param llmDir - The cache entry's `llm/` directory.
 * @param sessionID - The session id.
 * @returns The validated payload, or `undefined`.
 *
 * @internal Exported for tests only (`session.test.ts`); also used by
 * `pollForReport` within the module. Not part of the public module API.
 */
export async function readSessionReport(
  llmDir: string,
  sessionID: string,
): Promise<LlmToolPayload | undefined> {
  try {
    const value = await readJsonFile(sessionReportPath(llmDir, sessionID));
    const result = llmToolPayloadSchema.safeParse(value);
    return result.success ? result.data : undefined;
  } catch {
    // Missing or unreadable report file: the tool was not called.
    return undefined;
  }
}

/**
 * Starts collecting per-session token usage and cost from the server's
 * event stream: `message.part.updated` events carry the
 * provider-reported tokens and cost of each completed step in their
 * `step-finish` part. The collection is best-effort — when the
 * subscription fails, a no-op collector is returned and the analysis
 * continues with zero usage.
 *
 * @param client - The opencode client.
 * @param directory - The clone directory to scope the subscription to.
 * @returns The usage collector; call `close()` when analysis is done.
 *
 * @internal Exported for tests only (`session.test.ts`); also used by
 * `createSessionService` within the module. Not part of the public
 * module API.
 */
export async function collectSessionUsage(
  client: OpencodeClient,
  directory: string,
): Promise<UsageCollector> {
  const stream = await subscribeToEvents(client, directory);
  if (stream === undefined) {
    return noopCollector();
  }
  const usage = new Map<string, SessionUsage>();
  let closed = false;
  void consumeEvents(stream);
  return {
    get: (sessionID) => usage.get(sessionID),
    close: () => {
      closed = true;
      void stream.return(undefined).catch(() => {});
    },
  };

  /**
   * Consumes the event stream until closed, accumulating per-session
   * step tokens and cost.
   *
   * @param events - The event stream (non-undefined by construction).
   */
  async function consumeEvents(events: AsyncGenerator<Event>): Promise<void> {
    try {
      for await (const event of events) {
        if (closed) {
          return;
        }
        if (event.type !== 'message.part.updated') {
          continue;
        }
        const part = event.properties.part;
        if (part.type !== 'step-finish') {
          continue;
        }
        accumulate(part);
      }
    } catch (error) {
      // Best effort: a broken usage stream does not fail the analysis.
      logWarn(`LLM usage tracking stopped: ${errorDetail(error)}`);
    }
  }

  /**
   * Adds one completed step's tokens and cost to its session.
   *
   * @param part - The `step-finish` part carrying usage data.
   */
  function accumulate(part: StepFinishPart): void {
    const previous = usage.get(part.sessionID);
    usage.set(part.sessionID, {
      tokenUsage: {
        input: (previous?.tokenUsage.input ?? 0) + part.tokens.input,
        output: (previous?.tokenUsage.output ?? 0) + part.tokens.output,
      },
      estimatedCostUsd: (previous?.estimatedCostUsd ?? 0) + part.cost,
    });
  }
}

/**
 * Subscribes to the server's event stream for a directory; `undefined`
 * when the subscription fails (usage tracking stays a best-effort
 * feature).
 *
 * @param client - The opencode client.
 * @param directory - The clone directory to scope the subscription to.
 * @returns The event stream, or `undefined`.
 */
async function subscribeToEvents(
  client: OpencodeClient,
  directory: string,
): Promise<AsyncGenerator<Event> | undefined> {
  try {
    const subscription = await client.event.subscribe({ query: { directory } });
    return subscription.stream;
  } catch (error) {
    logWarn(`LLM usage tracking unavailable (token usage will be zero): ${errorDetail(error)}`);
    return undefined;
  }
}

/**
 * A usage collector that reports nothing — used when the event
 * subscription failed.
 *
 * @returns The no-op collector.
 */
function noopCollector(): UsageCollector {
  return {
    get: () => undefined,
    close: () => {},
  };
}
