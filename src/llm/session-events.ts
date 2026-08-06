/**
 * Debug logging for the pi agent session event stream. One listener is
 * attached to each in-process session (`subscribeSessionEventLog`); it
 * renders the events that are useful for progress and diagnostics into
 * debug-level log lines, so a `--verbose` run can follow the analysis
 * of a session: agent and message lifecycle, compaction, auto-retries,
 * and every tool execution (start/update/end with its success flag).
 *
 * Only the interesting events are logged — the per-token
 * `message_update` events and other ephemeral or noisy types
 * (`bash_execution_update`, `queue_update`, ...) are intentionally
 * skipped, and message/tool-argument content is truncated to keep each
 * line single-line and readable.
 *
 * Log lines follow the session layer's conventions: the session id is
 * wrapped in double quotes (`session "<id>"`, a string-variable value)
 * so concurrent sessions stay traceable, and other string-variable
 * values (roles, tool names, error text) are quoted the same way while
 * numbers stay bare.
 */
import type { AgentSession, AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import type { ScopedLog } from '../util/log.js';

/** The maximum number of characters of message/tool content per log line. */
const MAX_PREVIEW_LENGTH = 120;

/** The message type carried by `message_start` / `message_end`, derived
 * from the session events so no transitive `pi-agent-core` types are
 * needed. */
type SessionMessage = Extract<AgentSessionEvent, { type: 'message_end' }>['message'];

/**
 * Attaches the session-event debug listener to an in-process pi session.
 * The listener lives as long as the session does; calling the returned
 * unsubscribe removes it.
 *
 * @param session - The pi session to listen to.
 * @param sessionId - The dev-perf session id, quoted in every log line.
 * @param log - The repository's scoped logger for the debug lines.
 * @returns A function that unsubscribes the listener.
 */
export function subscribeSessionEventLog(
  session: AgentSession,
  sessionId: string,
  log: ScopedLog,
): () => void {
  return session.subscribe((event) => logAgentSessionEvent(event, sessionId, log));
}

/**
 * Renders one `AgentSessionEvent` as a debug line on the scoped logger,
 * dispatching to the per-group formatters. Events outside the logged
 * set (see module docs) are ignored.
 *
 * @param event - The pi session event.
 * @param sessionId - The dev-perf session id, quoted in every log line.
 * @param log - The scoped logger the debug line goes to.
 *
 * @internal Exported for tests only (`session-events.test.ts`); also
 * called by `subscribeSessionEventLog` within the module. Not part of
 * the public module API.
 */
export function logAgentSessionEvent(
  event: AgentSessionEvent,
  sessionId: string,
  log: ScopedLog,
): void {
  switch (event.type) {
    case 'agent_start':
    case 'agent_end':
      logAgentLifecycle(event, sessionId, log);
      return;
    case 'message_start':
    case 'message_end':
      logMessageLifecycle(event, sessionId, log);
      return;
    case 'compaction_start':
    case 'compaction_end':
    case 'auto_retry_start':
    case 'auto_retry_end':
      logMaintenance(event, sessionId, log);
      return;
    case 'tool_execution_start':
    case 'tool_execution_update':
    case 'tool_execution_end':
      logToolExecution(event, sessionId, log);
      return;
  }
}

/**
 * Logs the agent run lifecycle: run start, and run end with the
 * transcript size and the retry flag.
 *
 * @param event - An agent start/end event.
 * @param sessionId - The dev-perf session id, quoted in every log line.
 * @param log - The scoped logger the debug line goes to.
 */
function logAgentLifecycle(
  event: Extract<AgentSessionEvent, { type: 'agent_start' } | { type: 'agent_end' }>,
  sessionId: string,
  log: ScopedLog,
): void {
  if (event.type === 'agent_start') {
    log.debug(`LLM: session "${sessionId}": agent_start`);
    return;
  }
  log.debug(
    `LLM: session "${sessionId}": agent_end (${event.messages.length} messages, ` +
      `willRetry: ${event.willRetry})`,
  );
}

/**
 * Logs a message entering or leaving the transcript, with the message
 * role and a truncated content preview.
 *
 * @param event - A message start/end event.
 * @param sessionId - The dev-perf session id, quoted in every log line.
 * @param log - The scoped logger the debug line goes to.
 */
function logMessageLifecycle(
  event: Extract<AgentSessionEvent, { type: 'message_start' } | { type: 'message_end' }>,
  sessionId: string,
  log: ScopedLog,
): void {
  log.debug(
    `LLM: session "${sessionId}": ${event.type} (role "${event.message.role}"): ` +
      messagePreview(event.message),
  );
}

/**
 * Logs the maintenance events: compaction start/end and the auto-retry
 * attempt start/end with their counts, delay, and any error text.
 *
 * @param event - A compaction or auto-retry event.
 * @param sessionId - The dev-perf session id, quoted in every log line.
 * @param log - The scoped logger the debug line goes to.
 */
function logMaintenance(
  event: Extract<
    AgentSessionEvent,
    | { type: 'compaction_start' }
    | { type: 'compaction_end' }
    | { type: 'auto_retry_start' }
    | { type: 'auto_retry_end' }
  >,
  sessionId: string,
  log: ScopedLog,
): void {
  switch (event.type) {
    case 'compaction_start':
      log.debug(`LLM: session "${sessionId}": compaction_start (reason "${event.reason}")`);
      return;
    case 'compaction_end': {
      const error =
        event.errorMessage === undefined ? '' : `, error "${truncate(event.errorMessage)}"`;
      log.debug(
        `LLM: session "${sessionId}": compaction_end (reason "${event.reason}", ` +
          `aborted: ${event.aborted}, willRetry: ${event.willRetry}${error})`,
      );
      return;
    }
    case 'auto_retry_start':
      log.debug(
        `LLM: session "${sessionId}": auto_retry_start ` +
          `(attempt ${event.attempt}/${event.maxAttempts}, delayMs ${event.delayMs}): ` +
          `"${truncate(event.errorMessage)}"`,
      );
      return;
    case 'auto_retry_end': {
      const error =
        event.finalError === undefined ? '' : `, finalError "${truncate(event.finalError)}"`;
      log.debug(
        `LLM: session "${sessionId}": auto_retry_end ` +
          `(attempt ${event.attempt}, success: ${event.success}${error})`,
      );
      return;
    }
  }
}

/**
 * Logs the tool execution lifecycle: start with its arguments, update
 * with its partial result, and end with its success flag.
 *
 * @param event - A tool-execution start/update/end event.
 * @param sessionId - The dev-perf session id, quoted in every log line.
 * @param log - The scoped logger the debug line goes to.
 */
function logToolExecution(
  event: Extract<
    AgentSessionEvent,
    | { type: 'tool_execution_start' }
    | { type: 'tool_execution_update' }
    | { type: 'tool_execution_end' }
  >,
  sessionId: string,
  log: ScopedLog,
): void {
  switch (event.type) {
    case 'tool_execution_start':
      log.debug(
        `LLM: session "${sessionId}": tool "${event.toolName}" start ` +
          `(call "${event.toolCallId}"): ${valuePreview(event.args)}`,
      );
      return;
    case 'tool_execution_update':
      log.debug(
        `LLM: session "${sessionId}": tool "${event.toolName}" update ` +
          `(call "${event.toolCallId}"): ${valuePreview(event.partialResult)}`,
      );
      return;
    case 'tool_execution_end':
      log.debug(
        `LLM: session "${sessionId}": tool "${event.toolName}" end ` +
          `(call "${event.toolCallId}", isError: ${event.isError})`,
      );
      return;
  }
}

/**
 * Builds a single-line text preview of a session message for the log:
 * string content is used directly; array content (text, thinking,
 * tool-call, and image parts) is joined into one line. Messages without
 * `content` (pi's custom `bashExecution` message) preview their command,
 * and anything else previews empty. The preview is whitespace-normalized
 * and truncated.
 *
 * @param message - The message carried by a `message_start`/`message_end`
 * event.
 * @returns The truncated single-line preview.
 */
function messagePreview(message: SessionMessage): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === 'string') {
    return truncate(content);
  }
  if (Array.isArray(content)) {
    return truncate(contentPreview(content));
  }
  const command = (message as { command?: string }).command;
  return command === undefined ? '' : `[bash] ${truncate(command)}`;
}

/**
 * Joins the parts of an array-content message into a single text line.
 *
 * @param content - The array content of a message.
 * @returns The joined preview text.
 */
function contentPreview(content: readonly unknown[]): string {
  return content
    .map(partPreview)
    .filter((text) => text.length > 0)
    .join(' ');
}

/**
 * Renders the preview of one message content part: text is shown inline,
 * thinking is collapsed to a marker (it can be a large reasoning blob),
 * images to a marker, and tool calls to their name.
 *
 * @param part - A content part (text, thinking, image, or tool call).
 * @returns The part's one-line preview.
 */
function partPreview(part: unknown): string {
  if (part === null || typeof part !== 'object') {
    return '';
  }
  const value = part as Record<string, unknown>;
  switch (value.type) {
    case 'text':
      return typeof value.text === 'string' ? value.text : '';
    case 'thinking':
      return '[thinking]';
    case 'image':
      return '[image]';
    case 'toolCall':
      return `[tool ${typeof value.name === 'string' ? value.name : '?'}]`;
    default:
      return '';
  }
}

/**
 * Renders an arbitrary tool value (arguments or a partial result) for
 * the log: strings inline, anything else JSON-serialized. The result is
 * always truncated.
 *
 * @param value - The tool value to render.
 * @returns The truncated single-line preview.
 */
function valuePreview(value: unknown): string {
  if (typeof value === 'string') {
    return truncate(value);
  }
  if (value === undefined) {
    return '';
  }
  try {
    return truncate(JSON.stringify(value));
  } catch {
    // Non-serializable values (e.g. cyclic) fall back to String().
    return truncate(String(value));
  }
}

/**
 * Normalizes a text to a single line and truncates it to at most `max`
 * characters (appending a `…` when cut), so log lines never span
 * multiple lines and never grow unbounded.
 *
 * @param text - The text to normalize.
 * @param max - The maximum preview length (defaults to
 * `MAX_PREVIEW_LENGTH`).
 * @returns The single-line, possibly truncated text.
 */
function truncate(text: string, max: number = MAX_PREVIEW_LENGTH): string {
  const singleLine = text.replace(/\s+/g, ' ').trim();
  return singleLine.length > max ? `${singleLine.slice(0, max)}…` : singleLine;
}
