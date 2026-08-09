/**
 * Per-session enforcement of the LLM session limits: a max wall-clock
 * time and a max number of agent turns (`SessionLimits`). The running
 * state is derived from the configured limits when a session is created
 * (`limitsFrom`), and `runPromptWithLimits` wraps each prompt of the
 * session, racing the pending prompt against the deadline and counting
 * agent turns from the session event stream — aborting the session and
 * failing with a `SessionLimitError` when a limit is exceeded, so a
 * stuck or endlessly tool-calling session cannot consume the budget of
 * the whole run. The limits span every prompt of a session (the
 * analysis prompt plus its reminders): the deadline is absolute and the
 * turn budget carries over between calls. `sessionLimitFrom` walks an
 * error's cause chain to recover the exceeded limit, so the run's retry
 * layer can tell a retried session to work faster. Lives apart from
 * `session.ts` so the session layer stays focused on prompt
 * orchestration.
 */
import type { AgentSession } from '@earendil-works/pi-coding-agent';
import type { ScopedLog } from '../util/log.js';

/**
 * Per-session LLM limits bound one analysis session: the max wall-clock
 * time the session may run and the max number of agent turns it may
 * take. Either limit aborts the in-flight prompt and fails it with a
 * descriptive error. `0` disables a limit.
 */
export interface SessionLimits {
  /** Max wall-clock time per session in milliseconds; 0 = no time limit. */
  maxTimeMs: number;
  /** Max agent turns per session; 0 = no turn limit. */
  maxTurns: number;
}

/**
 * Per-session enforcement state derived from `SessionLimits` when a
 * session is created: the absolute deadline and the remaining turn
 * budget update as prompts run, so a limit spans every prompt of the
 * session, not just one call.
 */
export interface SessionLimitsState {
  /** The configured time cap in milliseconds (0 = no time limit), for
   * the failure message. */
  maxTimeMs: number;
  /** Absolute epoch-ms deadline; 0 when no time limit is set. */
  deadlineMs: number;
  /** The configured turn cap (0 = no turn limit), for the failure message. */
  maxTurns: number;
  /** Turns remaining; undefined when no turn limit is set. */
  turnsLeft: number | undefined;
}

/** Which session limit a session exceeded. */
type SessionLimitKind = 'time' | 'turns';

/**
 * The session limit a session exceeded, recovered from the thrown
 * `SessionLimitError` so a retried analysis can tell the model what
 * happened and to work faster.
 */
export interface SessionLimitHit {
  /** Which limit the session exceeded: `time` or `turns`. */
  kind: SessionLimitKind;
  /** The configured cap: seconds for `time`, a turn count for `turns`. */
  cap: number;
  /** The dev-perf session id that exceeded the limit. */
  sessionId: string;
}

/**
 * Thrown when a session exceeds its max-time or max-turns limit. The
 * `limit` field carries the exceeded limit, and `sessionLimitFrom`
 * recovers a hit buried anywhere in an error's cause chain — the limit
 * error is wrapped (`analysis of Alice … failed: …`) on its way up to
 * the run's retry layer.
 *
 * @internal Exported for tests only (`session-limits.test.ts`,
 * `pipeline-llm.test.ts`) — production code throws it (via the internal
 * limit-error builders) and detects it with `sessionLimitFrom`, never
 * importing the class by name. Not part of the public module API.
 */
export class SessionLimitError extends Error {
  /** The exceeded limit, for the retry prompt. */
  readonly limit: SessionLimitHit;

  /**
   * @param limit - The exceeded limit.
   * @param message - The descriptive message.
   */
  constructor(limit: SessionLimitHit, message: string) {
    super(message);
    this.name = 'SessionLimitError';
    this.limit = limit;
  }
}

/**
 * Recovers the session limit a failure exceeded by walking an error's
 * cause chain — the `SessionLimitError` is wrapped by the analysis
 * layers (`analysis of Alice … failed: …`, `LLM analysis failed for …
 * …`) on its way to the retry loop, so it is found through `cause`.
 * Returns `undefined` for a failure that was not caused by a session
 * limit, so a retry only tells the model to work faster when that was
 * actually why the previous attempt was cut off.
 *
 * @param error - The failure to inspect.
 * @returns The exceeded limit, or `undefined` when the failure was not
 * caused by a session limit.
 */
export function sessionLimitFrom(error: unknown): SessionLimitHit | undefined {
  let current: unknown = error;
  const seen = new Set<Error>();
  while (current instanceof Error && !seen.has(current)) {
    if (current instanceof SessionLimitError) {
      return current.limit;
    }
    seen.add(current);
    current = current.cause;
  }
  return undefined;
}

/**
 * Derives one session's enforcement state from the service limits: the
 * configured caps (kept for failure messages) plus the absolute
 * deadline and the initial turn budget, with `0`/unset meaning "no
 * limit".
 *
 * @param limits - The configured per-session limits.
 * @returns The running limit state for one session.
 */
export function limitsFrom(limits: SessionLimits): SessionLimitsState {
  return {
    maxTimeMs: limits.maxTimeMs,
    deadlineMs: limits.maxTimeMs > 0 ? Date.now() + limits.maxTimeMs : 0,
    maxTurns: limits.maxTurns,
    turnsLeft: limits.maxTurns > 0 ? limits.maxTurns : undefined,
  };
}

/**
 * Runs one prompt operation under a session's limits: checks the
 * remaining budget before prompting, then races the pending prompt
 * against the wall-clock deadline and counts agent turns from the
 * session event stream (`turn_start`), aborting the session and
 * rejecting with a descriptive error when either limit is exceeded.
 * An exhausted budget rejects before any prompt is sent.
 *
 * @param session - The pi session being prompted.
 * @param limits - The session's running limit state.
 * @param log - The repository's scoped logger for the limit-hit
 * progress line.
 * @param sessionId - The session's id, named in the failure message.
 * @param what - What the prompt waits for (`the LLM reply` or the
 * report tool), named in the failure message.
 * @param prompt - Runs the actual `session.prompt` call.
 * @returns A promise that resolves when the prompt settles without
 * hitting a limit.
 * @throws {Error} When a limit is exceeded; the session is aborted
 * first.
 */
export function runPromptWithLimits(
  session: AgentSession,
  limits: SessionLimitsState,
  log: ScopedLog,
  sessionId: string,
  what: string,
  prompt: () => Promise<void>,
): Promise<void> {
  if (timeExhausted(limits)) {
    return Promise.reject(timeLimitError(sessionId, what, limits.maxTimeMs));
  }
  if (turnsExhausted(limits)) {
    return Promise.reject(turnLimitError(sessionId, what, limits.maxTurns));
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    let cleanup: (() => void) | undefined;
    const settle = (fn: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup?.();
      fn();
    };
    // A limit-hit aborts the session and rejects with the descriptive
    // error; the abort's own prompt rejection is swallowed by `settle`.
    const onLimit = (error: Error): void => {
      log.progress(error.message);
      settle(() => {
        void session.abort().catch(() => {});
        reject(error);
      });
    };
    cleanup = createLimitWatchers(session, limits, sessionId, what, onLimit);
    void prompt().then(
      () => settle(resolve),
      (error) => settle(() => reject(error)),
    );
  });
}

/**
 * Arms the limit watchers for one prompt operation: a deadline timer
 * and a `turn_start` event listener that counts the session's turns,
 * both calling `onLimit` with the descriptive error when the session
 * runs past its budget. Returns a cleanup that clears both.
 *
 * @param session - The pi session being prompted.
 * @param limits - The session's running limit state.
 * @param sessionId - The session's id, for the failure message.
 * @param what - What the prompt waits for, for the failure message.
 * @param onLimit - Fires when a limit is exceeded; does not return.
 * @returns A cleanup unsubscribing the watchers, or `undefined` when
 * no limit is set.
 */
function createLimitWatchers(
  session: AgentSession,
  limits: SessionLimitsState,
  sessionId: string,
  what: string,
  onLimit: (error: Error) => void,
): (() => void) | undefined {
  const cleanup: Array<() => void> = [];
  if (limits.maxTimeMs > 0) {
    const remaining = limits.deadlineMs - Date.now();
    const timeout = setTimeout(
      () => onLimit(timeLimitError(sessionId, what, limits.maxTimeMs)),
      Math.max(0, remaining),
    );
    timeout.unref();
    cleanup.push(() => clearTimeout(timeout));
  }
  if (limits.turnsLeft !== undefined) {
    const unsubscribe = session.subscribe((event) => {
      if (event.type !== 'turn_start') {
        return;
      }
      limits.turnsLeft = limits.turnsLeft === undefined ? undefined : limits.turnsLeft - 1;
      if (limits.turnsLeft !== undefined && limits.turnsLeft < 0) {
        onLimit(turnLimitError(sessionId, what, limits.maxTurns));
      }
    });
    cleanup.push(unsubscribe);
  }
  return cleanup.length > 0 ? () => cleanup.forEach((fn) => fn()) : undefined;
}

/**
 * Whether a session's time budget is already exhausted (a deadline is
 * set and has passed).
 *
 * @param limits - The session's running limit state.
 * @returns `true` when the deadline has passed.
 */
function timeExhausted(limits: SessionLimitsState): boolean {
  return limits.deadlineMs > 0 && Date.now() >= limits.deadlineMs;
}

/**
 * Whether a session's turn budget is already exhausted (the last turn
 * start consumed the budget, leaving it negative).
 *
 * @param limits - The session's running limit state.
 * @returns `true` when no turns remain.
 */
function turnsExhausted(limits: SessionLimitsState): boolean {
  return limits.turnsLeft !== undefined && limits.turnsLeft < 0;
}

/**
 * Builds the descriptive error for an exceeded time limit: a
 * `SessionLimitError` carrying the exceeded limit (kind `time`, the cap
 * in seconds) plus the readable message.
 *
 * @param sessionId - The session's id.
 * @param what - What the prompt was waiting for.
 * @param maxTimeMs - The configured time cap in milliseconds.
 * @returns The error, readable after `errorDetail` walks the chain.
 */
function timeLimitError(sessionId: string, what: string, maxTimeMs: number): SessionLimitError {
  return new SessionLimitError(
    { kind: 'time', cap: maxTimeMs / 1000, sessionId },
    `LLM session "${sessionId}" exceeded the ${maxTimeMs / 1000}s max time limit at ${what}`,
  );
}

/**
 * Builds the descriptive error for an exceeded turn limit: a
 * `SessionLimitError` carrying the exceeded limit (kind `turns`, the
 * turn cap) plus the readable message.
 *
 * @param sessionId - The session's id.
 * @param what - What the prompt was waiting for.
 * @param maxTurns - The configured turn cap.
 * @returns The error, readable after `errorDetail` walks the chain.
 */
function turnLimitError(sessionId: string, what: string, maxTurns: number): SessionLimitError {
  return new SessionLimitError(
    { kind: 'turns', cap: maxTurns, sessionId },
    `LLM session "${sessionId}" exceeded the ${maxTurns}-turn max limit at ${what}`,
  );
}
