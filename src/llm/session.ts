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
 * keeps working after reporting. Long-running operations log a
 * periodic "still waiting" progress line (heartbeat), so a stuck model
 * call is visible in verbose output instead of an endless silent
 * wait. The real implementation talks to the
 * opencode server via the `@opencode-ai/sdk` client (the v1 client the
 * server handle exposes: `{ query, body, path }` option style); tests
 * stub the interface.
 */
import type { Event, OpencodeClient, StepFinishPart, TextPart } from '@opencode-ai/sdk';
import { llmToolPayloadSchema } from '../report/index.js';
import type { LlmToolPayload, TokenUsage } from '../report/index.js';
import { errorDetail } from '../util/error.js';
import { readJsonFile } from '../util/json.js';
import { createScopedLog } from '../util/log.js';
import type { ScopedLog } from '../util/log.js';
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

/**
 * How often a pending LLM operation logs its "still waiting" progress
 * line — the heartbeat that makes a stuck model call visible.
 */
const STILL_WAITING_INTERVAL_MS = 30_000;

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
  /** Input (non-cached), cached-read and output token counts. */
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
  /**
   * Sends a text prompt and returns the final assistant text. The
   * label names the operation for the "still waiting" progress lines.
   */
  promptSession(
    handle: SessionHandle,
    text: string,
    label: string,
    options?: PromptOptions,
  ): Promise<string>;
  /**
   * Sends a text prompt and resolves as soon as the session's
   * `devperf_report` output exists — aborting the running session so
   * the orchestration does not wait for the agent to finish its turn —
   * or when the turn ends without calling the tool. The label names
   * the operation for the "still waiting" progress lines.
   */
  promptSessionUntilReport(
    handle: SessionHandle,
    text: string,
    llmDir: string,
    label: string,
  ): Promise<LlmToolPayload | undefined>;
  /** Starts collecting per-session usage from the event stream. */
  collectUsage(directory: string): Promise<UsageCollector>;
}

/**
 * Binds the session wrappers to an opencode client.
 *
 * @param client - Type-safe client of a running opencode server.
 * @param log - The repository's scoped logger for the heartbeat
 * progress lines and usage warnings (defaults to the global logger).
 * @returns The session service for that server.
 */
export function createSessionService(
  client: OpencodeClient,
  log: ScopedLog = createScopedLog(),
): SessionService {
  return {
    createSession: (directory, title) => createSessionWith(client, directory, title),
    promptSession: (handle, text, label, options) =>
      promptSessionWith(client, handle, text, label, options, log),
    promptSessionUntilReport: (handle, text, llmDir, label) =>
      promptSessionUntilReportWith(client, handle, text, llmDir, label, log),
    collectUsage: (directory) => collectSessionUsage(client, directory, log),
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
 * server config. While the reply is pending, a progress line is
 * logged every `STILL_WAITING_INTERVAL_MS` so a stuck model call is
 * visible in verbose output. On any failure the session is aborted and
 * the error rethrown.
 *
 * @param client - The opencode client.
 * @param handle - The session to prompt.
 * @param text - The prompt text.
 * @param label - Name of the operation for the progress lines.
 * @param options - Prompt options.
 * @param log - The repository's scoped logger for progress lines.
 * @returns The final assistant text (empty for `noReply` prompts).
 * @throws {Error} When the prompt fails; the session is aborted first.
 */
async function promptSessionWith(
  client: OpencodeClient,
  handle: SessionHandle,
  text: string,
  label: string,
  options: PromptOptions = {},
  log: ScopedLog,
): Promise<string> {
  const stopHeartbeat = startHeartbeat(log, label, 'the LLM reply');
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
  } finally {
    stopHeartbeat();
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
 * While the turn is running, a progress line is logged every
 * `STILL_WAITING_INTERVAL_MS` so a stuck model call is visible in
 * verbose output.
 *
 * @param client - The opencode client.
 * @param handle - The session to prompt.
 * @param text - The prompt text.
 * @param llmDir - The entry's `llm/` directory holding the report files.
 * @param label - Name of the operation for the progress lines.
 * @param log - The repository's scoped logger for progress lines.
 * @returns The validated analysis payload, or `undefined` when the turn
 * ended without calling the tool.
 * @throws {Error} When the prompt fails; the session is aborted first.
 */
async function promptSessionUntilReportWith(
  client: OpencodeClient,
  handle: SessionHandle,
  text: string,
  llmDir: string,
  label: string,
  log: ScopedLog,
): Promise<LlmToolPayload | undefined> {
  let done = false;
  const report = pollForReport(handle, llmDir, () => done);
  const stopHeartbeat = startHeartbeat(log, label, 'devperf_report');
  let outcome: PromptOutcome;
  try {
    outcome = await settlePromptRace(client, handle, text, report);
  } finally {
    stopHeartbeat();
  }

  if (outcome.kind === 'report' && outcome.payload !== undefined) {
    // The tool wrote the report while the turn was still running: stop
    // the session and move on — the agent may never finish otherwise.
    done = true;
    await abortSession(client, handle);
    return outcome.payload;
  }
  done = true;
  // The report may have been written in the same tick the turn ended.
  const payload = await readSessionReport(llmDir, handle.id);
  if (payload !== undefined) {
    return payload;
  }
  if (outcome.kind === 'error') {
    await abortSession(client, handle);
    throw outcome.error;
  }
  return undefined;
}

/** The settled state of a prompt race: turn finished, failed, or report found. */
type PromptOutcome =
  | { kind: 'finished' }
  | { kind: 'error'; error: Error }
  | { kind: 'report'; payload: LlmToolPayload | undefined };

/**
 * Sends the analysis prompt and races it against the report poll:
 * whichever settles first wins, with prompt failures mapped to a
 * readable outcome (the opencode SDK rejects on transport errors, so
 * both shapes are handled). A rejection of an abandoned prompt is
 * swallowed so it cannot become an unhandled rejection.
 *
 * @param client - The opencode client.
 * @param handle - The session to prompt.
 * @param text - The prompt text.
 * @param report - The report poll promise (resolves on the first
 * valid payload, or `undefined` when the poll was stopped).
 * @returns The first settled outcome.
 */
async function settlePromptRace(
  client: OpencodeClient,
  handle: SessionHandle,
  text: string,
  report: Promise<LlmToolPayload | undefined>,
): Promise<PromptOutcome> {
  const prompt = client.session.prompt({
    path: { id: handle.id },
    query: { directory: handle.directory },
    body: { agent: ANALYST_AGENT_ID, parts: [{ type: 'text', text }] },
  });
  void prompt.catch(() => {});
  return Promise.race([
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
 * Starts the "still waiting" heartbeat for a long-running LLM
 * operation: every `STILL_WAITING_INTERVAL_MS` a progress line is
 * logged with the elapsed time, so a stuck model call shows up as
 * repeated progress lines instead of an endless silent wait. The
 * interval is unref'd so it cannot keep the process alive on its own.
 *
 * @param log - The scoped logger the progress lines go to.
 * @param label - Who or what is being waited on (e.g. the user name).
 * @param what - What is being waited for, e.g. `devperf_report`.
 * @returns A function that stops the heartbeat.
 */
function startHeartbeat(log: ScopedLog, label: string, what: string): () => void {
  const startedAt = Date.now();
  const timer = setInterval(() => {
    log.info(
      `LLM: ${label}: still waiting for ${what} (${Math.floor((Date.now() - startedAt) / 1000)}s elapsed)`,
    );
  }, STILL_WAITING_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
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
 * @param log - The repository's scoped logger for usage warnings.
 * @returns The usage collector; call `close()` when analysis is done.
 *
 * @internal Exported for tests only (`session.test.ts`); also used by
 * `createSessionService` within the module. Not part of the public
 * module API.
 */
export async function collectSessionUsage(
  client: OpencodeClient,
  directory: string,
  log: ScopedLog = createScopedLog(),
): Promise<UsageCollector> {
  const stream = await subscribeToEvents(client, directory, log);
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
      log.warn(`LLM usage tracking stopped: ${errorDetail(error)}`);
    }
  }

  /**
   * Adds one completed step's tokens and cost to its session. The
   * step's tokens are non-overlapping as opencode reports them:
   * `input` excludes the cached read tokens carried in
   * `tokens.cache.read`.
   *
   * @param part - The `step-finish` part carrying usage data.
   */
  function accumulate(part: StepFinishPart): void {
    const previous = usage.get(part.sessionID);
    usage.set(part.sessionID, {
      tokenUsage: {
        input: (previous?.tokenUsage.input ?? 0) + part.tokens.input,
        cacheRead: (previous?.tokenUsage.cacheRead ?? 0) + part.tokens.cache.read,
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
 * @param log - The repository's scoped logger for usage warnings.
 * @returns The event stream, or `undefined`.
 */
async function subscribeToEvents(
  client: OpencodeClient,
  directory: string,
  log: ScopedLog,
): Promise<AsyncGenerator<Event> | undefined> {
  try {
    const subscription = await client.event.subscribe({ query: { directory } });
    return subscription.stream;
  } catch (error) {
    log.warn(`LLM usage tracking unavailable (token usage will be zero): ${errorDetail(error)}`);
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
