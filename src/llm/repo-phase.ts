/**
 * A repository's LLM phase: one in-process pi runtime with its session
 * service, the automatic-retry orchestration around it, and the
 * shutdown that disposes both. `runLlmPhase` drives the analysis
 * (runtime creation plus per-period sessions) up to `1 + llmRetries`
 * times, recreating the runtime between failed attempts so the next try
 * starts from a clean slate; completed per-user analyses are cached and
 * reused across attempts, so a retry only re-runs the sessions that
 * failed. Per-period assembly lives in `repo-period.ts`.
 */
import path from 'node:path';
import type { ReportOptions } from '../config.js';
import type { AuthorGroup } from '../deterministic/identity.js';
import { createLlmRuntime } from './runtime.js';
import type { LlmRuntime } from './runtime.js';
import { createSessionService } from './session.js';
import type { SessionService } from './session.js';
import { assemblePeriods, llmRuntimeConfig } from './repo-period.js';
import type { AnalyzedRange, Repository } from '../report/index.js';
import type { CloneResult } from '../repo/clone.js';
import type { RepoSpec } from '../repo/repo-spec.js';
import { errorDetail } from '../util/error.js';
import type { ScopedLog } from '../util/log.js';

/** The repo's LLM phase: one pi runtime and its session service. */
interface LlmPhase {
  /** The in-process runtime, disposed by the caller. */
  runtime: LlmRuntime;
  /** The session service bound to the runtime. */
  service: SessionService;
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
): Promise<Repository[]> {
  const attempts = 1 + options.llmRetries;
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (attempt > 1) {
      log.warn(
        `LLM: attempt ${attempt - 1} of ${attempts} failed; ` +
          `recreating the LLM runtime and retrying: ${errorDetail(lastError)}`,
      );
    }
    let llm: LlmPhase | undefined;
    try {
      llm = await startLlmRuntime(repo, clone, groups, options, log);
      return await assemblePeriods(
        repo,
        clone,
        periods,
        groups,
        llm?.service,
        options,
        log,
        exclude,
        baseName,
      );
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(errorDetail(error));
    } finally {
      // Fully dispose the runtime and its sessions so the next attempt
      // starts from a clean slate.
      await closeLlmPhase(llm, log);
    }
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
    const runtime = await createLlmRuntime(clone.repoDir, llmRuntimeConfig(options), log);
    return {
      runtime,
      service: createSessionService(runtime, path.dirname(clone.repoDir), log),
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
