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
 * Optional per-session limits (`createSessionService`'s `SessionLimits`)
 * bound every LLM session: a max wall-clock time and a max number of
 * agent turns — counted from the session's event stream — after which
 * the in-flight prompt is aborted and fails with a descriptive error,
 * so a stuck or endlessly tool-calling session cannot consume the
 * budget of the whole run.
 * Analysis prompts run through
 * `promptSessionUntilReport`, which resolves as soon as the
 * `devperf_report` tool call starts (the session is aborted so the
 * orchestration never waits for an agent that keeps working after
 * reporting), falling back to reading the report file once the turn
 * ends. Every session logs its start (creation) and its end
 * (disposal) at info, both naming the session kind — the orientation
 * session or a per-user analysis — so the lifecycle is clear from the
 * log; each session also tracks its running state (kind, turns, and
 * lifetime). While a prompt is pending, a "still waiting" progress
 * line is logged every `STILL_WAITING_INTERVAL_MS` (a heartbeat) with
 * the current session state — kind, turns, tool calls, context size,
 * and seconds alive — so a stuck model call is visible in verbose
 * output instead of an endless silent wait. Every session also
 * feeds its pi event stream (agent/message lifecycle, compaction,
 * auto-retries, and tool executions) to the debug log via
 * `subscribeSessionEventLog` (`src/llm/session-events.ts`).
 */
import { randomUUID } from 'node:crypto';
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
import { promptForReport } from './session-report.js';
import { subscribeSessionEventLog } from './session-events.js';
import { limitsFrom, runPromptWithLimits } from './session-limits.js';
import type { SessionLimits, SessionLimitsState } from './session-limits.js';
import { REPORT_TOOL_NAME, buildReportTool } from './tools.js';

/** One in-process session, scoped to the clone directory. */
export interface SessionHandle {
  /** dev-perf-generated report/session id (also names the report file). */
  id: string;
  /** The clone directory the session was created in. */
  directory: string;
}

/** One created session: the pi session plus its limit state. */
interface SessionEntry {
  /** The dev-perf session id (also names the report file). */
  id: string;
  /** The pi session prompts run on. */
  session: AgentSession;
  /** The session's running max-time / max-turns limit state. */
  limits: SessionLimitsState;
  /** The session's running state for the lifecycle logs and heartbeat. */
  state: SessionState;
}

/** The kind of an LLM session, named in every lifecycle log line. */
type SessionKind = 'orientation' | 'user';

/** The title of the per-repo orientation session, which also identifies
 * its kind (any other title is a per-user analysis session). */
export const ORIENTATION_TITLE = 'dev-perf: repository orientation';

/** Per-session running state for the lifecycle logs and the heartbeat. */
interface SessionState {
  /** The kind of session: the orientation, or a per-user analysis. */
  kind: SessionKind;
  /** The session title (names the repo for the orientation, the user
   * for an analysis). */
  title: string;
  /** Epoch-ms the session was created, for the seconds-alive counter. */
  startedAt: number;
  /** Agent turns started, counted from the session event stream. */
  turns: number;
}

/** The log phrase naming a session kind. */
function kindLabel(kind: SessionKind): string {
  return kind === 'orientation' ? 'orientation' : 'user analysis';
}

/**
 * How often a pending LLM operation logs its "still waiting" progress
 * line — the heartbeat that makes a stuck model call visible. Each
 * line carries the session's current state.
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
 * @param limits - Per-session max-time and max-turns bounds applied to
 * every session the service creates; `0` disables a limit (defaults to
 * no limits).
 * @returns The session service for that runtime.
 */
export function createSessionService(
  runtime: LlmRuntime,
  entryDir: string,
  log: ScopedLog = createScopedLog(),
  limits: SessionLimits = { maxTimeMs: 0, maxTurns: 0 },
): SessionService {
  const sessions = new Map<string, SessionEntry>();
  return {
    createSession: (directory, title, systemPrompt) =>
      createSessionWith(runtime, entryDir, directory, title, systemPrompt, log, sessions, limits),
    promptSession: (handle, text, label) => promptSessionWith(handle, text, label, log, sessions),
    promptSessionUntilReport: (handle, text, llmDirPath, label) =>
      promptSessionUntilReportWith(handle, text, llmDirPath, label, log, sessions),
    getUsage: (handle) => getUsageWith(handle, sessions),
    close: async () => {
      const count = sessions.size;
      for (const entry of sessions.values()) {
        const stats = entry.session.getSessionStats();
        log.info(
          `LLM: ${kindLabel(entry.state.kind)} session "${entry.id}" ended ` +
            `(${entry.state.title}, ${entry.state.turns} turns, ${stats.toolCalls} tool calls, ` +
            `${stats.tokens.total} tokens, ` +
            `${Math.floor((Date.now() - entry.state.startedAt) / 1000)}s alive)`,
        );
        entry.session.dispose();
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
 * @param sessions - The service's session registry (id → session entry).
 * @param limits - The per-session limits every session is created with;
 * each session holds its own running state (deadline and turn budget).
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
  sessions: Map<string, SessionEntry>,
  limits: SessionLimits,
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
  registerSession(session, title, reportId, log, sessions, limits);
  return { id: reportId, directory };
}

/**
 * Registers a created session with the service: derives its kind from
 * the title (the orientation session or a per-user analysis), starts
 * counting its agent turns so the heartbeat can report how far the
 * analysis has gotten, stores the entry for `close()` to dispose, and
 * logs the session start with its kind.
 *
 * @param session - The created pi session.
 * @param title - The session title (names the repo for the orientation,
 * the user for an analysis).
 * @param reportId - The dev-perf session id.
 * @param log - The repository's scoped logger.
 * @param sessions - The service's session registry (id → session entry).
 * @param limits - The per-session limits the session was created with.
 */
function registerSession(
  session: AgentSession,
  title: string,
  reportId: string,
  log: ScopedLog,
  sessions: Map<string, SessionEntry>,
  limits: SessionLimits,
): void {
  subscribeSessionEventLog(session, reportId, log);
  const state: SessionState = {
    kind: title === ORIENTATION_TITLE ? 'orientation' : 'user',
    title,
    startedAt: Date.now(),
    turns: 0,
  };
  session.subscribe((event) => {
    if (event.type === 'turn_start') {
      state.turns += 1;
    }
  });
  sessions.set(reportId, { id: reportId, session, limits: limitsFrom(limits), state });
  log.info(`LLM: ${kindLabel(state.kind)} session "${reportId}" created (${title})`);
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
 * @throws {Error} When the prompt fails (including when the session's
 * max-time or max-turns limit is exceeded); the session is aborted
 * first.
 */
async function promptSessionWith(
  handle: SessionHandle,
  text: string,
  label: string,
  log: ScopedLog,
  sessions: Map<string, SessionEntry>,
): Promise<string> {
  const entry = requireSession(handle, sessions);
  const stopHeartbeat = startHeartbeat(log, label, 'the LLM reply', entry);
  try {
    await runPromptWithLimits(entry.session, entry.limits, log, handle.id, 'the LLM reply', () =>
      entry.session.prompt(text),
    );
    return entry.session.getLastAssistantText() ?? '';
  } catch (error) {
    await abortSession(entry.session);
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
  sessions: Map<string, SessionEntry>,
): Promise<LlmToolPayload | undefined> {
  const entry = requireSession(handle, sessions);
  const stopHeartbeat = startHeartbeat(log, label, REPORT_TOOL_NAME, entry);
  try {
    const found = await promptForReport(
      entry.session,
      handle.id,
      text,
      llmDirPath,
      log,
      entry.limits,
    );
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
 * Looks up the pi session entry behind a handle, throwing when it is
 * not registered (a session used after `close()`).
 *
 * @param handle - The session handle.
 * @param sessions - The service's session registry.
 * @returns The session entry (pi session plus its limit state).
 * @throws {Error} When the handle is unknown to the service.
 */
function requireSession(handle: SessionHandle, sessions: Map<string, SessionEntry>): SessionEntry {
  const entry = sessions.get(handle.id);
  if (entry === undefined) {
    throw new Error(`no LLM session registered for "${handle.id}"`);
  }
  return entry;
}

/**
 * Starts the "still waiting" heartbeat for a long-running LLM
 * operation: every `STILL_WAITING_INTERVAL_MS` a progress line is
 * logged naming the session and its current state — kind (orientation
 * or user analysis), turns run, tool calls, context size, and how long
 * the session has been alive — plus what is being waited on, so a stuck
 * model call shows up as repeated lines tracking the session's progress
 * instead of an endless silent wait. The interval is unref'd so it
 * cannot keep the process alive on its own.
 *
 * @param log - The scoped logger the progress lines go to.
 * @param label - Who or what is being waited on (e.g. the user name).
 * @param what - What is being waited for, e.g. `devperf_report`.
 * @param entry - The pending session, whose running state and pi
 * statistics are rendered into each line.
 * @returns A function that stops the heartbeat.
 */
function startHeartbeat(
  log: ScopedLog,
  label: string,
  what: string,
  entry: SessionEntry,
): () => void {
  const timer = setInterval(() => {
    const stats = entry.session.getSessionStats();
    const context = entry.session.getContextUsage();
    // The context usage is pi's estimate of the tokens currently in the
    // window; when it is unknown (e.g. right after compaction), fall
    // back to the total tokens used so far.
    const contextText =
      context === undefined || context.tokens === null
        ? `${stats.tokens.total} tokens used`
        : `${context.tokens}/${context.contextWindow} tokens (${context.percent}%)`;
    log.info(
      `LLM: "${label}" (session "${entry.id}", ${kindLabel(entry.state.kind)} session, ` +
        `${entry.state.turns} turns, ${stats.toolCalls} tool calls, context ${contextText}, ` +
        `${Math.floor((Date.now() - entry.state.startedAt) / 1000)}s alive): still waiting for ${what}`,
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
function getUsageWith(handle: SessionHandle, sessions: Map<string, SessionEntry>): TokenUsage {
  const stats = requireSession(handle, sessions).session.getSessionStats();
  return {
    input: stats.tokens.input,
    cacheRead: stats.tokens.cacheRead,
    output: stats.tokens.output,
  };
}
