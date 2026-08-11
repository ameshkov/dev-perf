/**
 * LLM analysis orchestration: one orientation session per repository
 * produces the repo context,
 * per-user sessions run under the run's shared concurrency gate
 * (`AnalyzeRepoInput.limit`, capacity `parallel`) — so up to `parallel`
 * analyses run at once across all repositories — and their
 * `devperf_report` output
 * is enforced (each prompt resolves as soon as the tool call starts —
 * the running session is aborted at that point, so the analysis never
 * waits for an agent that keeps working after reporting — otherwise up
 * to 3 follow-up reminders, then a non-zero exit naming the user and
 * session). Results are cached in the cache
 * entry's `llm/` directory keyed by (cache version, repo, user, since,
 * until, model, context/output limits) and reused on reruns unless
 * `--refresh` invalidates the cache; per-session token usage comes
 * from the pi session and is logged when verbose. Every long waiting
 * phase logs its start and a periodic "still waiting" progress line
 * (verbose), so a stuck session is visible instead of an endless
 * silent wait.
 */
import { createHash } from 'node:crypto';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { hasIgnoreCommits } from '../deterministic/commit-ignore.js';
import type { AuthorGroup } from '../deterministic/identity.js';
import { hasIgnorePaths } from '../deterministic/path-ignore.js';
import { llmDir } from '../repo/cache.js';
import type { IgnoreCommitsSpec } from '../repo/repo-spec.js';
import type { AnalyzedRange, LlmAnalysis, LlmToolPayload } from '../report/index.js';
import { llmToolPayloadSchema, tokenUsageSchema } from '../report/index.js';
import { errorDetail } from '../util/error.js';
import { readJsonFile, writeJsonFile } from '../util/json.js';
import type { ScopedLog } from '../util/log.js';
import { mapLimit } from '../util/pool.js';
import type { Limit } from '../util/pool.js';
import type { LlmRuntimeConfig } from './runtime.js';
import type { SessionLimitHit } from './session-limits.js';
import {
  buildOrientationPrompt,
  buildOrientationSystemPrompt,
  buildToolCallReminder,
  buildUserPrompt,
  buildUserSystemPrompt,
} from './prompts.js';
import { sessionReportPath } from './session.js';
import type { SessionHandle, SessionService } from './session.js';
import { ORIENTATION_TITLE } from './session.js';

/** Follow-up reminders after the initial prompt ("up to 3 attempts"). */
const MAX_REMINDERS = 3;

/** Length of the LLM result cache key hash. */
const CACHE_KEY_LENGTH = 16;

/**
 * Version of the on-disk LLM result cache. Bump it whenever the
 * analysis *behavior* changes — prompt templates, the tool schema, or
 * the cached-result layout — so stale entries written by an older
 * version are never silently reused after an upgrade.
 */
const LLM_CACHE_VERSION = 7 as const;

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
  /** LLM result cache version (bumped when analysis behavior changes). */
  cacheVersion: z.literal(LLM_CACHE_VERSION),
  /** Repository URL or local path the analysis ran on. */
  repo: z.string(),
  /** The effective analyzed branch of the clone. */
  branch: z.string(),
  /** Head commit sha of the analyzed clone. */
  head: z.string(),
  /** The resolved base branch the analysis was scoped against
   * (branch-delta), when one was in effect. */
  base: z.string().optional(),
  /** The resolved base commit sha of the branch-delta exclusion, when
   * one was in effect. */
  exclude: z.string().optional(),
  /** Gitignore-style paths excluded from the analysis, if any. */
  ignore: z.array(z.string()).optional(),
  /** The commits excluded for the analysis — by hash and/or message
   * pattern — when any. */
  ignoreCommits: z
    .object({
      hashes: z.array(z.string()).optional(),
      messages: z.array(z.string()).optional(),
    })
    .optional(),
  /** Lowercased author email the analysis belongs to (the identity's primary email). */
  email: z.string(),
  /** Every lowercased email of the identity, sorted. */
  emails: z.array(z.string()).min(1),
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
  /** The effective checked-out branch of the clone being analyzed. */
  branch: string;
  /** Head commit sha of the analyzed clone. */
  head: string;
  /** The resolved base branch the analysis was scoped against
   * (branch-delta), when one was in effect. */
  base?: string;
  /** The resolved base commit sha that the branch-delta exclusion
   * scans against, when one was in effect (the commit set of the
   * analysis is `head --not exclude`). */
  exclude?: string;
  /** Gitignore-style paths excluded for this repository, if any. */
  ignore?: string[];
  /** The commits excluded for this repository — by hash and/or message
   * pattern — if any. */
  ignoreCommits?: IgnoreCommitsSpec;
  /** The clone's working tree (session and runtime directory). */
  cloneDir: string;
  /** The cache entry directory (holds the `llm/` results dir). */
  entryDir: string;
  /** Provider/model/limit configuration. */
  config: LlmRuntimeConfig;
  /** Analyzed author-date range (UTC instants). */
  range: AnalyzedRange;
  /** Author groups of the range, one per user. */
  groups: AuthorGroup[];
  /** Session operations; the pipeline binds the real service. */
  service: SessionService;
  /** The run's shared concurrency gate for LLM sessions (capacity
   * `parallel`): bounded across all repositories, so the slow part of
   * the analysis is parallelized instead of running one session at a
   * time. */
  limit: Limit;
  /** The repository's scoped logger for progress lines. */
  log: ScopedLog;
  /** True to ignore cached results and re-run everything. */
  refresh: boolean;
  /** The session limit the previous attempt exceeded, when this run is
   * a retry after such a failure — rendered into the prompts so the
   * model works less thoroughly but faster. */
  limitHit?: SessionLimitHit;
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
}

/**
 * Runs the LLM analysis for one repository: cached
 * results are reused per user (unless `--refresh`); otherwise one
 * orientation session establishes the repo context, then each user
 * gets a session whose `devperf_report` output is enforced and cached.
 * The user sessions run under the run's shared concurrency gate
 * (`input.limit`, capacity `parallel`), so up to that many analyses run
 * at once across all repositories; results keep the input group order.
 *
 * @param input - Repo, users, config, session service, and the run's
 * shared concurrency gate.
 * @returns One completed analysis per user.
 * @throws {Error} When a session's `devperf_report` output is still
 * missing after the enforcement loop, or any prompt fails; the message
 * names the user and session and the top-level error handler exits
 * non-zero.
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
  // uncached user — gated by the run's shared `parallel` limit, so the
  // user sessions of every repository run concurrently up to `parallel`
  // instead of one at a time. Cached users keep their place in the
  // group order; uncached analyses fill their slots as they complete.
  const results: UserLlmResult[] = new Array<UserLlmResult>(input.groups.length);
  const uncached: Array<{ group: AuthorGroup; index: number }> = [];
  input.groups.forEach((group, index) => {
    const result = cached.get(group.email);
    if (result !== undefined) {
      input.log.info(`LLM: reusing cached analysis for "${group.name}"`);
      results[index] = { email: group.email, llm: completedLlm(result) };
    } else {
      uncached.push({ group, index });
    }
  });
  if (uncached.length === 0) {
    return results;
  }
  // The orientation is itself an LLM session, so it takes a gate slot
  // too; every user session embeds the context it produces.
  const orientation = await input.limit.run(() => createOrientation(input));
  await mapLimit(uncached, uncached.length, async ({ group, index }) => {
    results[index] = await input.limit.run(() => analyzeUser(input, group, orientation));
  });
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
 * @returns The repo context.
 * @throws {Error} When the orientation session fails.
 */
async function createOrientation(input: AnalyzeRepoInput): Promise<OrientationState> {
  const session = await input.service.createSession(
    input.cloneDir,
    ORIENTATION_TITLE,
    await buildOrientationSystemPrompt(),
  );
  input.log.info(`LLM: orientation session "${session.id}" for "${input.repo}"`);
  input.log.info(
    `LLM: orientation prompt sent to session "${session.id}", waiting for the repo context`,
  );
  const context = await input.service.promptSession(
    session,
    await buildOrientationPrompt(
      input.repo,
      input.branch,
      input.ignore,
      input.ignoreCommits,
      input.limitHit,
    ),
    input.repo,
  );
  await rm(sessionReportPath(llmDir(input.entryDir), session.id), { force: true });
  input.log.info(`LLM: repo context established for "${input.repo}" (session "${session.id}")`);
  input.log.debug(`LLM: repo context: ${context}`);
  return { context };
}

/**
 * Analyzes one user in a sequential session: the
 * `devperf_report` output is enforced, and the validated payload plus
 * its usage is cached. The completed entry is returned. Failures are
 * rethrown with the user and session named — `errorDetail` keeps the
 * underlying cause chain, so the top-level handler can report exactly
 * what went wrong.
 *
 * @param input - Repo-level analysis input.
 * @param group - The user's author group.
 * @param orientation - Repo context.
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
  const session = await input.service.createSession(
    input.cloneDir,
    `dev-perf: ${group.name}`,
    await buildUserSystemPrompt(),
  );
  input.log.info(`LLM: analyzing "${group.name}" <"${group.email}"> (session "${session.id}")`);
  try {
    const analysisPrompt = await buildUserPrompt({
      repo: input.repo,
      branch: input.branch,
      ...(input.base === undefined ? {} : { base: input.base }),
      ...(hasIgnorePaths(input.ignore) ? { ignore: input.ignore } : {}),
      ...(hasIgnoreCommits(input.ignoreCommits) ? { ignoreCommits: input.ignoreCommits } : {}),
      name: group.name,
      email: group.email,
      emails: group.emails,
      range: input.range,
      repoContext: orientation.context,
      commits: group.commits,
      limitHit: input.limitHit,
    });
    const payload = await enforceReport(input, group, session, analysisPrompt);
    const usage = input.service.getUsage(session);
    input.log.info(
      `LLM: "${group.name}": ${usage.input} in / ${usage.cacheRead} cached in / ${usage.output} out tokens (session "${session.id}")`,
    );
    const result: CachedResult = {
      payload,
      tokenUsage: usage,
      ...llmCacheKeyParts(input, group),
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
      input.log.warn(
        `LLM: "${group.name}": devperf_report not called, reminding (${attempt}/${MAX_REMINDERS}) (session "${session.id}")`,
      );
    } else {
      input.log.info(
        `LLM: "${group.name}": analysis prompt sent, waiting for devperf_report (session "${session.id}")`,
      );
    }
    const payload = await input.service.promptSessionUntilReport(
      session,
      attempt === 0 ? analysisPrompt : reminder,
      llmDir(input.entryDir),
      group.name,
    );
    if (payload !== undefined) {
      input.log.info(`LLM: "${group.name}": devperf_report received (session "${session.id}")`);
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
  return path.join(llmDir(input.entryDir), `${llmCacheKey(input, group)}.json`);
}

/**
 * The cache-key components of one user's LLM result — the exact
 * parameters that change the analysis: cache version, repo, the user's
 * identity (primary email and the full lowercased email set), resolved
 * since/until, model, and context/output limits. They are hashed into
 * the cache filename (`llmCacheKey`) and persisted in the cache file
 * itself, so the two can never drift. Keying by the identity's email
 * set — not just the primary email — stops a newly merged identity from
 * reusing a stale result cached for one of its constituent emails. The
 * analyzed branch, its head sha, and the base the analysis was scoped
 *  against are part of the key too: the head and the resolved base sha
 *  (together with `since`/`until`/`ignore`/`ignoreCommits`) fully
 *  determine the commit set, so an advancing branch or base — which
 *  keeps the same *name* — still re-keys the cache instead of reusing a
 *  stale analysis. The cache version invalidates stale entries when
 *  prompt templates, the tool schema, or the result layout change.
 *
 * @param input - Repo-level analysis input.
 * @param group - The user's author group.
 * @returns The key components, ordered for the hash.
 */
function llmCacheKeyParts(input: AnalyzeRepoInput, group: AuthorGroup) {
  return {
    cacheVersion: LLM_CACHE_VERSION,
    repo: input.repo,
    branch: input.branch,
    head: input.head,
    ...(input.base === undefined ? {} : { base: input.base }),
    ...(input.exclude === undefined ? {} : { exclude: input.exclude }),
    ...(hasIgnorePaths(input.ignore) ? { ignore: [...input.ignore].sort() } : {}),
    ...(hasIgnoreCommits(input.ignoreCommits)
      ? {
          ignoreCommits: {
            ...(input.ignoreCommits.hashes === undefined
              ? {}
              : { hashes: [...input.ignoreCommits.hashes].sort() }),
            ...(input.ignoreCommits.messages === undefined
              ? {}
              : { messages: [...input.ignoreCommits.messages].sort() }),
          },
        }
      : {}),
    email: group.email,
    emails: group.emails,
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
 * @param group - The user's author group.
 * @returns The 16-character hex key.
 */
function llmCacheKey(input: AnalyzeRepoInput, group: AuthorGroup): string {
  return createHash('sha256')
    .update(JSON.stringify(llmCacheKeyParts(input, group)))
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
  };
}
