/**
 * Tool-call detection and report settling for the LLM analysis: sending
 * the analysis prompt and resolving as soon as the session's
 * `devperf_report` tool call starts — the parsed, validated arguments
 * are written to the report file and the still-running session aborted,
 * so the orchestration never waits for an agent that keeps working
 * after reporting — otherwise when the turn ends without a report,
 * `undefined` so the caller can send a reminder. The prompt runs under
 * the session's limits (`runPromptWithLimits`); a limit-hit aborts the
 * session and surfaces as a real failure instead of "did not call the
 * tool". Lives apart from `session.ts` so the session layer stays
 * focused on session creation and prompt orchestration.
 */
import type { AgentSession } from '@earendil-works/pi-coding-agent';
import { mkdir, writeFile } from 'node:fs/promises';
import type { LlmToolPayload } from '../report/index.js';
import { llmToolPayloadSchema } from '../report/index.js';
import type { ScopedLog } from '../util/log.js';
import { runPromptWithLimits } from './session-limits.js';
import type { SessionLimitsState } from './session-limits.js';
import { sessionReportPath } from './session.js';
import { REPORT_TOOL_NAME } from './tools.js';

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
 * @param log - The repository's scoped logger.
 * @param limits - The session's running limit state; the pending prompt
 * is aborted when the deadline or turn budget is exceeded.
 * @returns The validated analysis payload, or `undefined` when the turn
 * ended without calling the tool.
 */
export function promptForReport(
  session: AgentSession,
  reportId: string,
  text: string,
  llmDirPath: string,
  log: ScopedLog,
  limits: SessionLimitsState,
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
    // The prompt runs under the session's limits; a limit-hit aborts
    // the session and rejects with a descriptive error, surfacing as a
    // real failure instead of "did not call the tool".
    runPromptWithLimits(session, limits, log, reportId, REPORT_TOOL_NAME, () =>
      session.prompt(text),
    ).then(
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
