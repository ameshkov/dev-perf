/**
 * Session layer for the LLM analysis (docs/design.md §6.3, plan step
 * 8): the `SessionService` interface the orchestration layer drives —
 * session creation and prompting scoped to the clone directory, with
 * `noReply` support and abort-on-error — plus tool-call detection
 * (the `devperf_report` output file exists and zod-validates) and
 * per-session token usage collected from the server's event stream
 * (§6.6). The real implementation talks to the opencode server via the
 * `@opencode-ai/sdk` client (the v1 client the server handle exposes:
 * `{ query, body, path }` option style); tests stub the interface.
 */
import type { Event, OpencodeClient, StepFinishPart, TextPart } from '@opencode-ai/sdk';
import { llmToolPayloadSchema } from '../report/index.js';
import type { LlmToolPayload, TokenUsage } from '../report/index.js';
import { readJsonFile } from '../util/json.js';
import { logWarn } from '../util/log.js';

/** One session on the server, scoped to the clone directory. */
export interface SessionHandle {
  /** Server-side session id (also names the tool's output file). */
  id: string;
  /** The clone directory the session was created in. */
  directory: string;
}

/** Options for a single prompt. */
export interface PromptOptions {
  /**
   * True to record the message without triggering a reply (context
   * injection, design §6.3).
   */
  noReply?: boolean;
}

/** Token usage and cost accumulated for one session (§6.6). */
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
 * The session operations the orchestration layer needs (plan step 8).
 * `createSessionService` provides the real implementation bound to an
 * opencode client; `analyze.ts` accepts any implementation, which lets
 * the enforcement and caching tests stub the model's behavior.
 */
export interface SessionService {
  /** Creates a session in the given directory. */
  createSession(directory: string, title: string): Promise<SessionHandle>;
  /** Sends a text prompt and returns the final assistant text. */
  promptSession(handle: SessionHandle, text: string, options?: PromptOptions): Promise<string>;
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
    collectUsage: (directory) => collectSessionUsage(client, directory),
  };
}

/**
 * Creates a session scoped to the clone directory (risk mitigation:
 * sessions are pinned to the server's project directory, design §10).
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
 * is recorded without triggering a reply (context injection, §6.3).
 * On any failure the session is aborted and the error rethrown.
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
 * Returns the path of a session's report file inside the entry's
 * `llm/` directory — where the generated `devperf_report` tool writes
 * its validated payload (plan step 7).
 *
 * @param llmDir - The cache entry's `llm/` directory.
 * @param sessionID - The session id.
 * @returns The report file path.
 */
export function sessionReportPath(llmDir: string, sessionID: string): string {
  return `${llmDir}/${sessionID}.json`;
}

/**
 * Tool-call detection (design §6.5): reads the session's report file
 * and returns the validated analysis payload, or `undefined` when the
 * file is missing, malformed, or fails validation — meaning the model
 * did not call `devperf_report` (or produced an unusable payload).
 *
 * @param llmDir - The cache entry's `llm/` directory.
 * @param sessionID - The session id.
 * @returns The validated payload, or `undefined`.
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
 * event stream (design §6.6): `message.part.updated` events carry the
 * provider-reported tokens and cost of each completed step in their
 * `step-finish` part. The collection is best-effort — when the
 * subscription fails, a no-op collector is returned and the analysis
 * continues with zero usage.
 *
 * @param client - The opencode client.
 * @param directory - The clone directory to scope the subscription to.
 * @returns The usage collector; call `close()` when analysis is done.
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

/**
 * Renders a server error value as a readable message.
 *
 * @param error - The raw error value.
 * @returns The message text.
 */
function errorDetail(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}
