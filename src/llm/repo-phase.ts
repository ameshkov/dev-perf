/**
 * A repository's LLM phase: one in-process pi runtime with its session
 * service, the automatic-retry orchestration around it, and the
 * shutdown that disposes both. `runLlmPhase` drives the analysis
 * (runtime creation plus per-period sessions) up to `1 + llmRetries`
 * times, recreating the runtime between failed attempts so the next try
 * starts from a clean slate; completed per-user analyses are cached and
 * reused across attempts, so a retry only re-runs the sessions that
 * failed. The run's shared session gate (`sessionLimit`) bounds the
 * concurrency of this repository's LLM sessions together with every
 * other repository's, so `parallel` caps the slow work globally.
 * Per-period assembly lives in `repo-period.ts`.
 */
import path from 'node:path';
import type { ReportOptions } from '../config.js';
import type { AuthorGroup } from '../deterministic/identity.js';
import { createLlmRuntime } from './runtime.js';
import type { LlmRuntime } from './runtime.js';
import { sessionLimitFrom } from './session-limits.js';
import type { SessionLimitHit } from './session-limits.js';
import { createSessionService } from './session.js';
import type { SessionService } from './session.js';
import { assemblePeriods, llmRuntimeConfig } from './repo-period.js';
import type { AnalyzedRange, Repository } from '../report/index.js';
import type { CloneResult } from '../repo/clone.js';
import type { RepoSpec } from '../repo/repo-spec.js';
import { errorDetail } from '../util/error.js';
import type { ScopedLog } from '../util/log.js';
import type { Limit } from '../util/pool.js';

/** The repo's LLM phase: one pi runtime and its session service. */
interface LlmPhase {
  /** The in-process runtime, disposed by the caller. */
  runtime: LlmRuntime;
  /** The session service bound to the runtime. */
  service: SessionService;
}

/** The outcome of one LLM attempt: its results, or what failed. */
interface LlmAttemptOutcome {
  /** Completed repository entries, when the attempt succeeded. */
  repositories?: Repository[];
  /** The attempt's error, when it failed. */
  error?: Error;
  /** The session limit the failed attempt exceeded, when any. */
  limitHit?: SessionLimitHit;
}

/**
 * Runs a repository's LLM phase with automatic retries: the analysis
 * (runtime creation plus per-period sessions) is attempted up to
 * `1 + llmRetries` times, and every failed attempt is retried with a
 * fresh in-process runtime, so the next attempt starts from a clean
 * slate. Completed per-user analyses are cached and reused across
 * attempts, so a retry only re-runs the sessions that failed. The
 * analysis succeeds as soon as one attempt completes; when every
 * attempt fails, the error names the repository and the attempt count.
 * With `llmRetries: 0` the original error is rethrown unchanged (fail
 * fast).
 *
 * @param repo - The repository spec, as given with its optional branch.
 * @param clone - The clone the analysis runs in.
 * @param periods - The run's period bounds.
 * @param groups - The author groups of the whole range.
 * @param options - Validated CLI options.
 * @param log - The repository's scoped logger.
 * @param exclude - The resolved base commit sha of the branch-delta
 * exclusion, when one is in effect.
 * @param baseName - The resolved base branch name of the branch-delta,
 * when one is in effect.
 * @param sessionLimit - The run's shared gate bounding concurrent LLM
 * sessions, threaded into the per-period analysis.
 * @returns One assembled repository entry per period.
 * @throws {Error} When every LLM attempt fails; the message names the
 * repo — and the period when `unit` is set — plus the underlying
 * cause.
 */
export async function runLlmPhase(
  repo: RepoSpec,
  clone: CloneResult,
  periods: AnalyzedRange[],
  groups: AuthorGroup[],
  options: ReportOptions,
  log: ScopedLog,
  exclude: string | undefined,
  baseName: string | undefined,
  sessionLimit: Limit,
): Promise<Repository[]> {
  const attempts = 1 + options.llmRetries;
  let lastError: Error | undefined;
  // The session limit a failed attempt exceeded, so the next attempt's
  // prompts can tell the model to be less thorough but faster.
  let limitHit: SessionLimitHit | undefined;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (attempt > 1) {
      log.warn(
        `LLM: attempt ${attempt - 1} of ${attempts} failed; ` +
          `recreating the LLM runtime and retrying: ${errorDetail(lastError)}`,
      );
    }
    const outcome = await runLlmAttempt(
      repo,
      clone,
      periods,
      groups,
      options,
      log,
      exclude,
      baseName,
      limitHit,
      sessionLimit,
    );
    if (outcome.repositories !== undefined) {
      return outcome.repositories;
    }
    lastError = outcome.error;
    limitHit = outcome.limitHit;
  }
  if (attempts === 1) {
    // No retries configured: surface the original error unchanged.
    throw lastError ?? new Error(`LLM analysis failed for ${repo.repo}`);
  }
  throw new Error(
    `LLM analysis failed for ${repo.repo} after ${attempts} attempts: ${errorDetail(lastError)}`,
    { cause: lastError },
  );
}

/**
 * Runs one attempt of a repository's LLM phase: one in-process runtime
 * with its session service, then the per-period assembly. Every attempt
 * is self-contained — the runtime is disposed in `finally` — and
 * returns its outcome instead of throwing, so the retry loop can carry
 * the exact error and exceeded session limit into the next attempt.
 *
 * @param repo - The repository spec, as given with its optional branch.
 * @param clone - The clone the analysis runs in.
 * @param periods - The run's period bounds.
 * @param groups - The author groups of the whole range.
 * @param options - Validated CLI options.
 * @param log - The repository's scoped logger.
 * @param exclude - The resolved base commit sha of the branch-delta
 * exclusion, when one is in effect.
 * @param baseName - The resolved base branch name of the branch-delta,
 * when one is in effect.
 * @param limitHit - The session limit the previous attempt exceeded,
 * when this is a retry; the retried prompts tell the model to be less
 * thorough but faster.
 * @param sessionLimit - The run's shared gate bounding concurrent LLM
 * sessions.
 * @returns The completed entries, or the failure's error and (when the
 * failure was a session-limit hit) the exceeded limit.
 */
async function runLlmAttempt(
  repo: RepoSpec,
  clone: CloneResult,
  periods: AnalyzedRange[],
  groups: AuthorGroup[],
  options: ReportOptions,
  log: ScopedLog,
  exclude: string | undefined,
  baseName: string | undefined,
  limitHit: SessionLimitHit | undefined,
  sessionLimit: Limit,
): Promise<LlmAttemptOutcome> {
  let llm: LlmPhase | undefined;
  try {
    llm = await startLlmRuntime(repo, clone, groups, options, log);
    return {
      repositories: await assemblePeriods(
        repo,
        clone,
        periods,
        groups,
        llm?.service,
        options,
        log,
        exclude,
        baseName,
        limitHit,
        sessionLimit,
      ),
    };
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(errorDetail(error));
    // Only a session-limit failure carries this over: a retry that
    // failed for some other reason must not keep telling the model to
    // work faster.
    return { error: failure, limitHit: sessionLimitFrom(error) ?? undefined };
  } finally {
    // Fully dispose the runtime and its sessions so the next attempt
    // starts from a clean slate.
    await closeLlmPhase(llm, log);
  }
}

/**
 * Starts the repo's LLM phase when enabled and the range has authors:
 * one in-process pi runtime with its session service, shared by all of
 * the repo's periods. Returns `undefined` when LLM analysis is
 * disabled or the repo has no authors in the range.
 *
 * @param repo - The repository spec, as given with its optional branch.
 * @param clone - The clone the analysis runs in.
 * @param groups - The author groups of the whole range.
 * @param options - Validated CLI options.
 * @param log - The repository's scoped logger.
 * @returns The runtime and its session service, or `undefined`.
 * @throws {Error} When the runtime cannot be created; the message names
 * the repo and the underlying cause.
 */
async function startLlmRuntime(
  repo: RepoSpec,
  clone: CloneResult,
  groups: AuthorGroup[],
  options: ReportOptions,
  log: ScopedLog,
): Promise<LlmPhase | undefined> {
  if (!options.llm || groups.length === 0) {
    if (options.llm) {
      log.progress(`LLM: no authors in the range; skipping LLM analysis`);
    }
    return undefined;
  }
  try {
    const runtimeConfig = llmRuntimeConfig(options);
    // The same limits bound every session of this repo's analysis; `0`
    // means "no limit" (the default when the config leaves them unset).
    const sessionLimits = {
      maxTimeMs: (options.llmMaxTime ?? 0) * 1000,
      maxTurns: options.llmMaxTurns ?? 0,
    };
    const runtime = await createLlmRuntime(clone.repoDir, runtimeConfig, log);
    return {
      runtime,
      service: createSessionService(runtime, path.dirname(clone.repoDir), log, sessionLimits),
    };
  } catch (error) {
    // errorDetail walks the cause chain.
    throw new Error(`LLM analysis failed for ${repo.repo}: ${errorDetail(error)}`, {
      cause: error,
    });
  }
}

/**
 * Shuts the repo's LLM phase down. Both steps run independently, each
 * guarded by its own try/catch, so a session-shutdown failure never
 * skips runtime disposal (which removes the in-memory API key). A
 * shutdown failure is logged but does not mask an analysis error.
 *
 * @param llm - The repo's LLM phase, or `undefined` when none started.
 * @param log - The repository's scoped logger.
 */
async function closeLlmPhase(llm: LlmPhase | undefined, log: ScopedLog): Promise<void> {
  if (llm === undefined) {
    return;
  }
  try {
    await llm.service.close();
  } catch (error) {
    log.warn(`LLM session shutdown failed: ${errorDetail(error)}`);
  }
  try {
    await llm.runtime.dispose();
  } catch (error) {
    log.warn(`LLM runtime shutdown failed: ${errorDetail(error)}`);
  }
}
