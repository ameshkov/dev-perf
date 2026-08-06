/**
 * Session layer for the LLM analysis: the `SessionService` interface
 * the orchestration layer drives — session creation and prompting
 * scoped to the clone directory, with abort-on-error support plus
 * tool-call detection (the `devperf_report` tool call / output file
 * exists and zod-validates) and per-session token usage read from the
 * pi session. Sessions run fully in-process via `createAgentSession`:
 * each session gets its own `DefaultResourceLoader` with the provided
 * system prompt, an in-memory settings and session manager, the tool
 * allowlist (including pi's unshielded `bash`, see `SESSION_TOOLS`)
 * plus the `devperf_report` custom tool, and thinking disabled.
 * Analysis prompts run through
 * `promptSessionUntilReport`, which resolves as soon as the
 * `devperf_report` tool call starts (the session is aborted so the
 * orchestration never waits for an agent that keeps working after
 * reporting), falling back to reading the report file once the turn
 * ends. Long-running operations log a periodic "still waiting"
 * progress line (heartbeat), so a stuck model call is visible in
 * verbose output instead of an endless silent wait.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import {
  DefaultResourceLoader,
  createAgentSession,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';
import type { AgentSession } from '@earendil-works/pi-coding-agent';
import { llmDir } from '../repo/cache.js';
import { llmToolPayloadSchema } from '../report/index.js';
import type { LlmToolPayload, TokenUsage } from '../report/index.js';
import { readJsonFile } from '../util/json.js';
import { createScopedLog } from '../util/log.js';
import type { ScopedLog } from '../util/log.js';
import type { LlmRuntime } from './runtime.js';
import { REPORT_TOOL_NAME, buildReportTool } from './tools.js';

/** One in-process session, scoped to the clone directory. */
export interface SessionHandle {
  /** dev-perf-generated report/session id (also names the report file). */
  id: string;
  /** The clone directory the session was created in. */
  directory: string;
}

/**
 * How often a pending LLM operation logs its "still waiting" progress
 * line — the heartbeat that makes a stuck model call visible.
 */
const STILL_WAITING_INTERVAL_MS = 30_000;

/**
 * The tool allowlist every session runs with. It relies on pi's
 * built-in tools — including an **unshielded** `bash` that can run
 * arbitrary shell commands in the clone. It is NOT hardened against a
 * hostile repository: it is only told to stay read-only through the
 * system prompt text. Because `bash` cannot be reliably protected
 * against everything a repository can do (hooks, aliases, config-driven
 * execution, exfiltration), the analysis should run in the published
 * Docker container, which sandboxes the process away from the host.
 */
const SESSION_TOOLS = ['read', 'bash', 'grep', 'find', 'ls', REPORT_TOOL_NAME];

/**
 * The session operations the orchestration layer needs.
 * `createSessionService` provides the real implementation bound to a pi
 * runtime; `analyze.ts` accepts any implementation, which lets the
 * enforcement and caching tests stub the model's behavior.
 */
export interface SessionService {
  /**
   * Creates a session in the given directory with the given system
   * prompt (the rendered orientation or user system template).
   */
  createSession(directory: string, title: string, systemPrompt: string): Promise<SessionHandle>;
  /**
   * Sends a text prompt and returns the final assistant text. The
   * label names the operation for the "still waiting" progress lines.
   */
  promptSession(handle: SessionHandle, text: string, label: string): Promise<string>;
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
    llmDirPath: string,
    label: string,
  ): Promise<LlmToolPayload | undefined>;
  /** Returns the token usage accumulated by one session. */
  getUsage(session: SessionHandle): TokenUsage;
  /** Disposes every session created through this service. */
  close(): Promise<void>;
}

/**
 * Binds the session wrappers to a pi runtime.
 *
 * @param runtime - The in-process pi runtime with the resolved model.
 * @param entryDir - The cache entry directory (`<entry>/llm` holds the
 * report files the `devperf_report` tool writes).
 * @param log - The repository's scoped logger for the heartbeat
 * progress lines and usage warnings (defaults to the global logger).
 * @returns The session service for that runtime.
 */
export function createSessionService(
  runtime: LlmRuntime,
  entryDir: string,
  log: ScopedLog = createScopedLog(),
): SessionService {
  const sessions = new Map<string, AgentSession>();
  return {
    createSession: (directory, title, systemPrompt) =>
      createSessionWith(runtime, entryDir, directory, title, systemPrompt, log, sessions),
    promptSession: (handle, text, label) => promptSessionWith(handle, text, label, log, sessions),
    promptSessionUntilReport: (handle, text, llmDirPath, label) =>
      promptSessionUntilReportWith(handle, text, llmDirPath, label, log, sessions),
    getUsage: (handle) => getUsageWith(handle, sessions),
    close: async () => {
      const count = sessions.size;
      for (const session of sessions.values()) {
        session.dispose();
      }
      sessions.clear();
      log.info(`LLM: disposed ${count} session(s)`);
    },
  };
}

/**
 * Creates one in-process pi session: a fresh `DefaultResourceLoader`
 * carrying the rendered system prompt, in-memory settings and session
 * managers, the tool allowlist plus the `devperf_report` custom tool
 * (whose report file is keyed to the generated session id), and
 * thinking disabled. The session is registered with the
 * service so `close()` can dispose it.
 *
 * @param runtime - The in-process pi runtime.
 * @param entryDir - The cache entry directory.
 * @param directory - The clone directory to create the session in.
 * @param title - Human-readable session title.
 * @param systemPrompt - The rendered orientation or user system prompt.
 * @param log - The repository's scoped logger.
 * @param sessions - The service's session registry (id → pi session).
 * @returns The session handle.
 * @throws {Error} When the pi session cannot be created.
 */
async function createSessionWith(
  runtime: LlmRuntime,
  entryDir: string,
  directory: string,
  title: string,
  systemPrompt: string,
  log: ScopedLog,
  sessions: Map<string, AgentSession>,
): Promise<SessionHandle> {
  const reportId = randomUUID();
  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: true },
    retry: { enabled: true },
  });
  const loader = new DefaultResourceLoader({
    cwd: directory,
    agentDir: runtime.agentDir,
    settingsManager,
    systemPrompt,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  await loader.reload();
  const reportTool = buildReportTool(reportId, llmDir(entryDir));
  const { session } = await createAgentSession({
    cwd: directory,
    agentDir: runtime.agentDir,
    model: runtime.model,
    modelRuntime: runtime.modelRuntime,
    settingsManager,
    sessionManager: SessionManager.inMemory(),
    tools: SESSION_TOOLS,
    // Only the report tool is custom; `bash` is pi's built-in,
    // unshielded tool — not a read-only replacement (see SESSION_TOOLS).
    customTools: [reportTool],
    resourceLoader: loader,
    thinkingLevel: 'off',
  });
  session.setSessionName(title);
  sessions.set(reportId, session);
  log.info(`LLM: session "${reportId}" created (${title})`);
  return { id: reportId, directory };
}

/**
 * Sends a text prompt to a session and returns the final assistant
 * text. While the reply is pending, a progress line is logged every
 * `STILL_WAITING_INTERVAL_MS` so a stuck model call is visible in
 * verbose output. On any failure the session is aborted and the error
 * rethrown.
 *
 * @param handle - The session to prompt.
 * @param text - The prompt text.
 * @param label - Name of the operation for the progress lines.
 * @param log - The repository's scoped logger for progress lines.
 * @param sessions - The service's session registry.
 * @returns The final assistant text.
 * @throws {Error} When the prompt fails; the session is aborted first.
 */
async function promptSessionWith(
  handle: SessionHandle,
  text: string,
  label: string,
  log: ScopedLog,
  sessions: Map<string, AgentSession>,
): Promise<string> {
  const session = requireSession(handle, sessions);
  const stopHeartbeat = startHeartbeat(log, label, 'the LLM reply', handle.id);
  try {
    await session.prompt(text);
    return session.getLastAssistantText() ?? '';
  } catch (error) {
    await abortSession(session);
    throw error;
  } finally {
    stopHeartbeat();
  }
}

/**
 * Best-effort session abort: used to stop a session whose prompt
 * failed. Abort errors are swallowed so the original failure surfaces.
 *
 * @param session - The pi session to abort.
 */
async function abortSession(session: AgentSession): Promise<void> {
  try {
    await session.abort();
  } catch {
    // Best effort; the original error is the one that matters.
  }
}

/**
 * Sends an analysis prompt and resolves as soon as the session's
 * `devperf_report` output exists, without waiting for the agent to
 * finish its turn: the tool-call start event carries the parsed
 * arguments, which are validated and written to the report file while
 * the running session is aborted; the first valid payload settles the
 * prompt. When the turn ends without a report, `undefined` is returned
 * so the caller can send a reminder. While the turn is running, a
 * progress line is logged every `STILL_WAITING_INTERVAL_MS` so a stuck
 * model call is visible in verbose output.
 *
 * @param handle - The session to prompt.
 * @param text - The prompt text.
 * @param llmDirPath - The entry's `llm/` directory holding the report
 * files.
 * @param label - Name of the operation for the progress lines.
 * @param log - The repository's scoped logger for progress lines.
 * @param sessions - The service's session registry.
 * @returns The validated analysis payload, or `undefined` when the turn
 * ended without calling the tool.
 */
async function promptSessionUntilReportWith(
  handle: SessionHandle,
  text: string,
  llmDirPath: string,
  label: string,
  log: ScopedLog,
  sessions: Map<string, AgentSession>,
): Promise<LlmToolPayload | undefined> {
  const session = requireSession(handle, sessions);
  const stopHeartbeat = startHeartbeat(log, label, REPORT_TOOL_NAME, handle.id);
  try {
    const found = await promptForReport(session, handle.id, text, llmDirPath);
    if (found !== undefined) {
      return found;
    }
    // The report may have been written in the same tick the turn ended.
    return await readSessionReport(llmDirPath, handle.id);
  } finally {
    stopHeartbeat();
  }
}

/**
 * Sends the analysis prompt and resolves as soon as the session's
 * `devperf_report` tool call starts. The tool-call start event carries
 * the parsed arguments; a valid payload is written to the report file
 * and the running session is aborted so the orchestration does not
 * wait for the agent to finish. The promise resolves only once the
 * report file is on disk, keeping the file-based convention
 * authoritative. When the turn ends cleanly without calling the tool,
 * `undefined` is returned; when a prompt or report-write fails, the
 * error is rejected so a real failure surfaces instead of being masked
 * as "did not call the tool". The abort-induced rejection of a detected
 * tool call is expected and swallowed — the write path settles with the
 * payload.
 *
 * @param session - The pi session to prompt.
 * @param reportId - The session/report id that names the report file.
 * @param text - The prompt text.
 * @param llmDirPath - The entry's `llm/` directory holding the report
 * files.
 * @returns The validated analysis payload, or `undefined` when the turn
 * ended without calling the tool.
 */
function promptForReport(
  session: AgentSession,
  reportId: string,
  text: string,
  llmDirPath: string,
): Promise<LlmToolPayload | undefined> {
  return new Promise((resolve, reject) => {
    const settler = createSettler(resolve, reject);
    let sawReport = false;
    settler.setUnsubscribe(
      session.subscribe((event) => {
        if (event.type !== 'tool_execution_start' || event.toolName !== REPORT_TOOL_NAME) {
          return;
        }
        const payload = readValidatedPayload(event.args);
        if (payload === undefined) {
          return;
        }
        sawReport = true;
        // Write the report from the parsed arguments so the orchestration
        // can settle even if the tool body did not run, then stop the
        // still-running turn. The prompt settles only once the file is on
        // disk, keeping the file-based convention authoritative.
        void (async () => {
          try {
            await writeReportFile(llmDirPath, reportId, payload);
            settler.settle(payload);
          } catch (error) {
            settler.fail(error);
          }
        })();
        void session.abort().catch(() => {});
      }),
    );
    void session.prompt(text).then(
      () => {
        // A clean turn-end without a tool call settles as undefined; if
        // a report was seen, the write path above settles with it.
        if (!sawReport) {
          settler.settle(undefined);
        }
      },
      (error) => {
        // The abort-induced rejection from a detected tool call is
        // expected; any other rejection is a real failure that must
        // surface instead of being masked as "did not call the tool".
        if (!sawReport) {
          settler.fail(error);
        }
      },
    );
  });
}

/**
 * A one-shot promise settler that settles exactly once, unsubscribing
 * the session event listener on first settlement so no late event or
 * prompt callback can double-settle (or settle after the promise was
 * already rejected by a report-write failure).
 *
 * @param resolve - Resolves the outer promise with a payload.
 * @param reject - Rejects the outer promise with an error.
 * @returns The settler.
 */
function createSettler(
  resolve: (payload: LlmToolPayload | undefined) => void,
  reject: (error: unknown) => void,
): {
  /** Resolves once, on first call. */
  settle(payload: LlmToolPayload | undefined): void;
  /** Rejects once, on first call. */
  fail(error: unknown): void;
  /** Registers the unsubscribe function called on first settlement. */
  setUnsubscribe(unsubscribe: () => void): void;
} {
  let settled = false;
  let unsubscribe: () => void = () => {};
  const settleOnce = (fn: () => void): void => {
    if (settled) {
      return;
    }
    settled = true;
    unsubscribe();
    fn();
  };
  return {
    settle: (payload) => settleOnce(() => resolve(payload)),
    fail: (error) => settleOnce(() => reject(error)),
    setUnsubscribe(fn) {
      unsubscribe = fn;
    },
  };
}

/**
 * Looks up the pi session behind a handle, throwing when it is not
 * registered (a session used after `close()`).
 *
 * @param handle - The session handle.
 * @param sessions - The service's session registry.
 * @returns The pi session.
 * @throws {Error} When the handle is unknown to the service.
 */
function requireSession(handle: SessionHandle, sessions: Map<string, AgentSession>): AgentSession {
  const session = sessions.get(handle.id);
  if (session === undefined) {
    throw new Error(`no LLM session registered for "${handle.id}"`);
  }
  return session;
}

/**
 * Validates a `devperf_report` tool-call argument object against the
 * shared report schema.
 *
 * @param args - The parsed tool-call arguments.
 * @returns The validated payload, or `undefined` when invalid.
 */
function readValidatedPayload(args: unknown): LlmToolPayload | undefined {
  const result = llmToolPayloadSchema.safeParse(args);
  return result.success ? result.data : undefined;
}

/**
 * Writes a session's validated report file inside the entry's `llm/`
 * directory.
 *
 * @param llmDirPath - The cache entry's `llm/` directory.
 * @param sessionID - The session id.
 * @param payload - The validated analysis payload.
 */
async function writeReportFile(
  llmDirPath: string,
  sessionID: string,
  payload: LlmToolPayload,
): Promise<void> {
  await mkdir(llmDirPath, { recursive: true });
  await writeFile(
    sessionReportPath(llmDirPath, sessionID),
    `${JSON.stringify(payload, null, 2)}\n`,
    'utf8',
  );
}

/**
 * Starts the "still waiting" heartbeat for a long-running LLM
 * operation: every `STILL_WAITING_INTERVAL_MS` a progress line is
 * logged with the session id and the elapsed time, so a stuck model
 * call shows up as repeated progress lines — each traceable to its
 * session — instead of an endless silent wait. The interval is unref'd
 * so it cannot keep the process alive on its own.
 *
 * @param log - The scoped logger the progress lines go to.
 * @param label - Who or what is being waited on (e.g. the user name).
 * @param what - What is being waited for, e.g. `devperf_report`.
 * @param sessionId - The session's id, so the line can be tied back to
 * its session.
 * @returns A function that stops the heartbeat.
 */
function startHeartbeat(
  log: ScopedLog,
  label: string,
  what: string,
  sessionId: string,
): () => void {
  const startedAt = Date.now();
  const timer = setInterval(() => {
    log.info(
      `LLM: "${label}" (session "${sessionId}"): still waiting for ${what} ` +
        `(${Math.floor((Date.now() - startedAt) / 1000)}s elapsed)`,
    );
  }, STILL_WAITING_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}

/**
 * Returns the path of a session's report file inside the entry's
 * `llm/` directory — where the `devperf_report` tool writes its
 * validated payload.
 *
 * @param llmDirPath - The cache entry's `llm/` directory.
 * @param sessionID - The session id.
 * @returns The report file path.
 */
export function sessionReportPath(llmDirPath: string, sessionID: string): string {
  return `${llmDirPath}/${sessionID}.json`;
}

/**
 * Tool-call detection: reads the session's report file
 * and returns the validated analysis payload, or `undefined` when the
 * file is missing, malformed, or fails validation — meaning the model
 * did not call `devperf_report` (or produced an unusable payload).
 * Production callers reach it through `promptSessionUntilReport`.
 *
 * @param llmDirPath - The cache entry's `llm/` directory.
 * @param sessionID - The session id.
 * @returns The validated payload, or `undefined`.
 *
 * @internal Exported for tests only (`session.test.ts`); also used by
 * `promptSessionUntilReportWith` within the module. Not part of the
 * public module API.
 */
export async function readSessionReport(
  llmDirPath: string,
  sessionID: string,
): Promise<LlmToolPayload | undefined> {
  try {
    const value = await readJsonFile(sessionReportPath(llmDirPath, sessionID));
    const result = llmToolPayloadSchema.safeParse(value);
    return result.success ? result.data : undefined;
  } catch {
    // Missing or unreadable report file: the tool was not called.
    return undefined;
  }
}

/**
 * Returns the token usage of one session from the pi session's
 * statistics (input, prompt-cache reads, and output).
 *
 * @param handle - The session whose usage is read.
 * @param sessions - The service's session registry.
 * @returns The token usage of the session.
 */
function getUsageWith(handle: SessionHandle, sessions: Map<string, AgentSession>): TokenUsage {
  const stats = requireSession(handle, sessions).getSessionStats();
  return {
    input: stats.tokens.input,
    cacheRead: stats.tokens.cacheRead,
    output: stats.tokens.output,
  };
}
