/**
 * LLM analysis orchestration: one orientation session per repository
 * produces the repo context,
 * which is injected into every user session with `noReply: true`;
 * per-user sessions run sequentially and their `devperf_report` output
 * is enforced (each prompt resolves as soon as the tool output exists —
 * the running session is aborted at that point, so the analysis never
 * waits for an agent that keeps working after reporting — otherwise up
 * to 3 follow-up reminders, then a non-zero exit naming the user and
 * session). Results are cached in the cache
 * entry's `llm/` directory keyed by (repo, user, since, until, model,
 * context/output limits) and reused on reruns unless `--refresh`
 * invalidates the cache; per-session token usage and cost come
 * from the event stream and are logged when verbose.
 */
import { createHash } from 'node:crypto';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { AuthorGroup } from '../deterministic/identity.js';
import { llmDir } from '../repo/cache.js';
import type { AnalyzedRange, LlmAnalysis, LlmToolPayload } from '../report/index.js';
import { llmToolPayloadSchema, tokenUsageSchema } from '../report/index.js';
import { errorDetail } from '../util/error.js';
import { readJsonFile, writeJsonFile } from '../util/json.js';
import { logDebug, logInfo, logWarn } from '../util/log.js';
import { buildOrientationPrompt, buildToolCallReminder, buildUserPrompt } from './prompts.js';
import { sessionReportPath } from './session.js';
import type { SessionHandle, SessionService, SessionUsage, UsageCollector } from './session.js';
import type { LlmServerConfig } from './server.js';

/** Title of the per-repo orientation session. */
const ORIENTATION_TITLE = 'dev-perf: repository orientation';

/** Follow-up reminders after the initial prompt ("up to 3 attempts"). */
const MAX_REMINDERS = 3;

/** Length of the LLM result cache key hash. */
const CACHE_KEY_LENGTH = 16;

/** Usage reported when the event stream has no data for a session. */
const ZERO_USAGE: SessionUsage = { tokenUsage: { input: 0, output: 0 }, estimatedCostUsd: 0 };

/**
 * The persisted LLM result for one user: the
 * `devperf_report` payload plus the usage that produced it, so cache
 * hits reproduce the full report entry without new calls. The
 * cache-key components (`llmCacheKeyParts`) are persisted alongside
 * the payload so the file is self-describing; the filename hash
 * encodes the same components.
 */
const cachedResultSchema = z.object({
  /** The validated analysis payload. */
  payload: llmToolPayloadSchema,
  /** Token usage of the producing session. */
  tokenUsage: tokenUsageSchema,
  /** Estimated cost of the producing session in USD. */
  estimatedCostUsd: z.number().nonnegative(),
  /** Repository URL or local path the analysis ran on. */
  repo: z.string(),
  /** Lowercased author email the analysis belongs to. */
  email: z.string(),
  /** Analyzed author-date range start (ISO 8601, UTC; `''` unbounded). */
  since: z.string(),
  /** Analyzed author-date range end (ISO 8601, UTC; `''` unbounded). */
  until: z.string(),
  /** Model used for the analysis. */
  model: z.string(),
  /** Context limit in tokens used for the analysis. */
  limitContext: z.number().int().nonnegative(),
  /** Output limit in tokens used for the analysis. */
  limitOutput: z.number().int().nonnegative(),
});

/** Type of a cached LLM result. */
type CachedResult = z.infer<typeof cachedResultSchema>;

/** Everything `analyzeRepositoryLLM` needs for one repository. */
export interface AnalyzeRepoInput {
  /** Repository URL or local path as given on the command line. */
  repo: string;
  /** The clone's working tree (session and server directory). */
  cloneDir: string;
  /** The cache entry directory (holds the `llm/` results dir). */
  entryDir: string;
  /** Provider/model/limit configuration. */
  config: LlmServerConfig;
  /** Analyzed author-date range (UTC instants). */
  range: AnalyzedRange;
  /** Author groups of the range, one per user. */
  groups: AuthorGroup[];
  /** Session operations; the pipeline binds the real service. */
  service: SessionService;
  /** True to ignore cached results and re-run everything. */
  refresh: boolean;
}

/** The completed LLM analysis of one user, keyed for the assembler. */
export interface UserLlmResult {
  /** Lowercased author email the analysis belongs to. */
  email: string;
  /** The completed LLM analysis entry for the report. */
  llm: LlmAnalysis;
}

/** The orientation outcome shared by all user sessions of a repo. */
interface OrientationState {
  /** The repository context text. */
  context: string;
  /** Usage collector, open for the whole repo analysis. */
  collector: UsageCollector;
}

/**
 * Runs the LLM analysis for one repository: cached
 * results are reused per user (unless `--refresh`); otherwise one
 * orientation session establishes the repo context, then each user
 * gets a sequential session whose `devperf_report` output is enforced
 * and cached. Results keep the input group order.
 *
 * @param input - Repo, users, config, and session service.
 * @returns One completed analysis per user.
 * @throws {Error} When a session's `devperf_report` output is still
 * missing after the enforcement loop; the message names the user and
 * session and the top-level error handler exits non-zero.
 */
export async function analyzeRepositoryLLM(input: AnalyzeRepoInput): Promise<UserLlmResult[]> {
  // Phase 1: load cached results (reads are skipped entirely on
  // --refresh).
  const cached = new Map<string, CachedResult>();
  for (const group of input.groups) {
    const result = await loadCached(input, group);
    if (result !== undefined) {
      cached.set(group.email, result);
    }
  }
  // Phase 2: one orientation session per repo, then one session per
  // uncached user; sessions run one at a time.
  const results: UserLlmResult[] = [];
  let orientation: OrientationState | undefined;
  try {
    for (const group of input.groups) {
      const result = cached.get(group.email);
      if (result !== undefined) {
        logInfo(`LLM: reusing cached analysis for ${group.name}`);
        results.push({ email: group.email, llm: completedLlm(result) });
        continue;
      }
      orientation ??= await createOrientation(input);
      results.push(await analyzeUser(input, group, orientation));
    }
  } finally {
    orientation?.collector.close();
  }
  return results;
}

/**
 * Runs the orientation session: the agent explores the
 * repository and its final text becomes the repo context that every
 * user session receives. The orientation prompt ends with the standard
 * tool-call instruction, so a compliant agent may call `devperf_report`
 * — that payload is keyed to this session, not to any user, and is
 * removed here.
 *
 * @param input - Repo-level analysis input.
 * @returns The repo context and an open usage collector.
 * @throws {Error} When the orientation session fails; the collector is
 * closed first.
 */
async function createOrientation(input: AnalyzeRepoInput): Promise<OrientationState> {
  const collector = await input.service.collectUsage(input.cloneDir);
  try {
    const session = await input.service.createSession(input.cloneDir, ORIENTATION_TITLE);
    logInfo(`LLM: orientation session ${session.id} for ${input.repo}`);
    const context = await input.service.promptSession(
      session,
      await buildOrientationPrompt(input.repo),
    );
    await rm(sessionReportPath(llmDir(input.entryDir), session.id), { force: true });
    logDebug(`LLM: repo context: ${context}`);
    return { context, collector };
  } catch (error) {
    collector.close();
    throw error;
  }
}

/**
 * Analyzes one user in a sequential session: the
 * repo context is injected with `noReply: true`, the analysis prompt
 * follows, and the `devperf_report` output is enforced. The validated
 * payload plus its usage is cached, and the completed entry is
 * returned. Failures are rethrown with the user and session named —
 * `errorDetail` keeps the underlying cause chain (e.g. the
 * `connect ECONNREFUSED` behind a bare `fetch failed`), so the
 * top-level handler can report exactly what went wrong.
 *
 * @param input - Repo-level analysis input.
 * @param group - The user's author group.
 * @param orientation - Repo context and usage collector.
 * @returns The completed analysis for the user.
 * @throws {Error} When the tool was not called after the enforcement
 * loop, or any prompt of the user's session fails; the message names
 * the user and session.
 */
async function analyzeUser(
  input: AnalyzeRepoInput,
  group: AuthorGroup,
  orientation: OrientationState,
): Promise<UserLlmResult> {
  const session = await input.service.createSession(input.cloneDir, `dev-perf: ${group.name}`);
  logInfo(`LLM: analyzing ${group.name} <${group.email}> (session ${session.id})`);
  try {
    await input.service.promptSession(session, orientation.context, { noReply: true });
    const analysisPrompt = await buildUserPrompt({
      repo: input.repo,
      name: group.name,
      email: group.email,
      range: input.range,
      repoContext: orientation.context,
      commits: group.commits,
    });
    const payload = await enforceReport(input, group, session, analysisPrompt);
    const usage = orientation.collector.get(session.id) ?? ZERO_USAGE;
    logInfo(
      `LLM: ${group.name}: ${usage.tokenUsage.input} in / ${usage.tokenUsage.output} out tokens, $${usage.estimatedCostUsd.toFixed(4)}`,
    );
    const result: CachedResult = {
      payload,
      tokenUsage: usage.tokenUsage,
      estimatedCostUsd: usage.estimatedCostUsd,
      ...llmCacheKeyParts(input, group.email),
    };
    await writeJsonFile(cachedResultPath(input, group), result);
    return { email: group.email, llm: completedLlm(result) };
  } catch (error) {
    throw new Error(
      `analysis of ${group.name} <${group.email}> (session ${session.id}) failed: ${errorDetail(error)}`,
      { cause: error },
    );
  }
}

/**
 * The enforcement loop: the analysis prompt (and each follow-up
 * reminder) resolves as soon as the session's report file exists — the
 * running session is aborted at that point — or when the turn ends
 * without calling the tool. When the tool was not called, a reminder
 * is sent — up to `MAX_REMINDERS` times. If the tool is still not
 * called, an error naming the user and session is thrown, which the
 * top-level error handler turns into a non-zero exit without writing
 * the report.
 *
 * @param input - Repo-level analysis input.
 * @param group - The user's author group (for the error message).
 * @param session - The user's session.
 * @param analysisPrompt - The rendered per-user analysis prompt.
 * @returns The validated analysis payload.
 * @throws {Error} When the tool was never called.
 */
async function enforceReport(
  input: AnalyzeRepoInput,
  group: AuthorGroup,
  session: SessionHandle,
  analysisPrompt: string,
): Promise<LlmToolPayload> {
  const reminder = await buildToolCallReminder();
  for (let attempt = 0; attempt <= MAX_REMINDERS; attempt++) {
    if (attempt > 0) {
      logWarn(
        `LLM: ${group.name}: devperf_report not called, reminding (${attempt}/${MAX_REMINDERS})`,
      );
    }
    const payload = await input.service.promptSessionUntilReport(
      session,
      attempt === 0 ? analysisPrompt : reminder,
      llmDir(input.entryDir),
    );
    if (payload !== undefined) {
      return payload;
    }
  }
  throw new Error(
    `LLM analysis for ${group.name} did not call devperf_report in session ${session.id} ` +
      `after ${MAX_REMINDERS + 1} prompts; the report is not written.`,
  );
}

/**
 * Loads the cached LLM result for a user, or `undefined` when the
 * cache is invalidated (`--refresh`), the file is missing, or it does
 * not validate — all treated as a cache miss.
 *
 * @param input - Repo-level analysis input.
 * @param group - The user's author group.
 * @returns The cached result, or `undefined`.
 */
async function loadCached(
  input: AnalyzeRepoInput,
  group: AuthorGroup,
): Promise<CachedResult | undefined> {
  if (input.refresh) {
    return undefined;
  }
  try {
    const value = await readJsonFile(cachedResultPath(input, group));
    const result = cachedResultSchema.safeParse(value);
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The cache file path of a user's LLM result inside the entry's
 * `llm/` directory.
 *
 * @param input - Repo-level analysis input.
 * @param group - The user's author group.
 * @returns The cache file path.
 */
function cachedResultPath(input: AnalyzeRepoInput, group: AuthorGroup): string {
  return path.join(llmDir(input.entryDir), `${llmCacheKey(input, group.email)}.json`);
}

/**
 * The cache-key components of one user's LLM result — the exact
 * parameters that change the analysis: repo, user email, resolved
 * since/until, model, and context/output limits. They are hashed
 * into the cache filename (`llmCacheKey`) and persisted in the cache
 * file itself, so the two can never drift.
 *
 * @param input - Repo-level analysis input.
 * @param email - The user's lowercased author email.
 * @returns The key components, keyed for the cache file and ordered
 * for the hash.
 */
function llmCacheKeyParts(input: AnalyzeRepoInput, email: string) {
  return {
    repo: input.repo,
    email,
    since: input.range.since,
    until: input.range.until,
    model: input.config.model,
    limitContext: input.config.limitContext,
    limitOutput: input.config.limitOutput,
  };
}

/**
 * The deterministic cache key of one user's LLM result: SHA-256 of
 * the cache-key components (`llmCacheKeyParts`), the exact
 * parameters that change the analysis.
 *
 * @param input - Repo-level analysis input.
 * @param email - The user's lowercased author email.
 * @returns The 16-character hex key.
 */
function llmCacheKey(input: AnalyzeRepoInput, email: string): string {
  return createHash('sha256')
    .update(Object.values(llmCacheKeyParts(input, email)).join('\x00'))
    .digest('hex')
    .slice(0, CACHE_KEY_LENGTH);
}

/**
 * Builds the completed `LlmAnalysis` entry for the report from a
 * cached or fresh result: status `completed`, the payload, and the
 * usage that produced it.
 *
 * @param result - The payload and usage.
 * @returns The report entry.
 */
function completedLlm(result: CachedResult): LlmAnalysis {
  return {
    status: 'completed',
    ...(result.payload.overview === undefined ? {} : { overview: result.payload.overview }),
    contributions: result.payload.contributions,
    tokenUsage: result.tokenUsage,
    estimatedCostUsd: result.estimatedCostUsd,
  };
}
