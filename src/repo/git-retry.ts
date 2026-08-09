/**
 * Transient-failure classification and backoff for git commands:
 * which git failures are worth retrying (a refused or timed-out
 * connection, a dropped remote, a partial clone whose on-demand blob
 * fetch failed) and how long to wait between attempts. `runGit` in
 * `./git.ts` re-runs a failing command through these defaults — 1s,
 * 5s, 30s, each with jitter — so a short network hiccup does not fail
 * an analysis outright. The backoff is hard-coded here; no
 * configuration controls it.
 */
import type { GitError } from './git.js';

/**
 * The built-in backoff delays between retried attempts, in
 * milliseconds: after the first failure the command is re-run after
 * ~1s, then ~5s, then ~30s (each with jitter), giving up after that.
 * No configuration controls these — a transient failure is rare and
 * short (seconds), and the retries recover it, not the exact budget.
 */
export const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [1000, 5000, 30000];

/**
 * Matches a partial clone's on-demand blob fetch failing: git's
 * `fatal: could not fetch <sha> from promisor remote`, printed when a
 * `blob:none` clone must lazily fetch a missing blob and the promisor
 * remote cannot be reached. Shared by the transient classification
 * (retryable) and `isPromisorFetchFailure` (fall back to a full clone).
 */
const PROMISOR_FETCH_RE = /could not fetch \S+ from promisor remote/i;

/**
 * Error markers that mean a git failure is transient — a remote that is
 * temporarily unreachable, a timed-out or dropped connection, or a
 * partial clone whose on-demand blob fetch failed — so a retry makes
 * sense. Permanent failures (unknown repository, bad credentials, a
 * rejected partial-clone filter, an empty repository) are deliberately
 * absent: retrying them only wastes the backoff budget.
 */
const TRANSIENT_PATTERNS: readonly RegExp[] = [
  /connection refused/i,
  /connection reset/i,
  /connection closed/i,
  /timed out/i,
  /the remote end hung up unexpectedly/i,
  /early eof/i,
  PROMISOR_FETCH_RE,
  /network is unreachable/i,
  /failed to connect/i,
  /unable to connect/i,
  /broken pipe/i,
];

/**
 * Whether a failed git command looks transient and so should be
 * retried: the error message or stderr carries one of
 * `TRANSIENT_PATTERNS` (a dropped/timed-out connection, a refused
 * host, or a partial clone's failing on-demand blob fetch). Permanent
 * failures — unknown repository, auth failure, a rejected
 * partial-clone filter, an empty repository — return false and fail
 * immediately. `runGit` consults this for every failed attempt.
 *
 * @param error - The failed git invocation's error.
 * @returns True when retrying the command makes sense.
 */
export function shouldRetryGitError(error: GitError): boolean {
  const text = `${error.message}\n${error.stderr}`;
  return TRANSIENT_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Whether a failed git command means a partial clone's on-demand blob
 * fetch failed — the case a full re-clone fixes. dev-perf clones with
 * `--filter=blob:none`, so `git log --numstat` must lazily fetch each
 * missing blob from the promisor remote; a remote that is unreachable
 * at that point fails the whole analysis. Unlike the retryable
 * classification, `isPromisorFetchFailure` singles out the missing-blob
 * fetch so the caller can re-clone the entry as a full clone once —
 * after which every blob is local and nothing depends on the remote.
 * Matches git's `could not fetch <sha> from promisor remote`.
 *
 * @param error - The failed git invocation's error.
 * @returns True when the failure is an on-demand blob fetch on a
 * partial clone, so a full re-clone is worth trying.
 */
export function isPromisorFetchFailure(error: GitError): boolean {
  const text = `${error.message}\n${error.stderr}`;
  return PROMISOR_FETCH_RE.test(text);
}

/**
 * The transient cause of a failing git command, for the retry warning:
 * the first line that carries a transient marker — e.g. `Connection
 * refused` or `could not fetch <sha> from promisor remote` — so the
 * log names the actual fault, not git's generic wrapper text. Falls
 * back to the first stderr line when nothing matches.
 *
 * @param error - The failed git invocation's error.
 * @returns A short cause string for the log line.
 */
export function transientDetail(error: GitError): string {
  const text = `${error.stderr}\n${error.message}`;
  const matched = TRANSIENT_PATTERNS.find((pattern) => pattern.test(text));
  if (matched !== undefined) {
    const found = text.match(matched);
    if (found !== null && found[0] !== undefined && found[0].trim() !== '') {
      return found[0].trim();
    }
  }
  return error.stderr.trim().split('\n')[0] || error.message;
}

/**
 * Spreads the wait out with jitter, so concurrent repositories that
 * fail at once (e.g. parallel clones of the same unreachable host) do
 * not all retry in lockstep: the actual delay is the nominal one plus
 * or minus up to 20%, chosen at random. An injected random source keeps
 * the bounds testable.
 *
 * @param delayMs - The nominal backoff delay.
 * @param random - Random source in `[0, 1]`; defaults to `Math.random`.
 * @returns The jittered delay, in milliseconds.
 */
export function jitteredDelay(delayMs: number, random: () => number = Math.random): number {
  return Math.round(delayMs * (0.8 + random() * 0.4));
}
