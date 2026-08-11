/**
 * Per-repository commit exclusion: a repository's configured
 * `ignoreCommits` spec drops whole commits — by full or abbreviated
 * hash, or by a case-insensitive regex matched against the commit
 * subject — from the analysis, so neither the deterministic metrics nor
 * the LLM layer count them. `filterIgnoredCommits` is applied once,
 * right after the commits are read and before they are grouped by
 * author — the single point that makes both layers exclusion-free.
 *
 * A hash matches as a case-insensitive prefix of the commit's full
 * 40-char sha, so a pasted abbreviated hash works and casing never
 * matters. A message pattern is matched case-insensitively against the
 * commit subject (the first line of the message), the same text the
 * report and the LLM commit lists show. Patterns are trimmed before
 * compiling (an accidental config indent never becomes part of the
 * pattern), the `i` flag is applied, and every pattern must already
 * have been validated as a compilable regular expression by the spec
 * schema (`src/repo/repo-spec.ts`) — an invalid pattern is a config
 * error, never a quiet "matches nothing".
 */
import type { Commit } from './commits.js';
import { hasIgnoreCommits } from '../repo/repo-spec.js';
import type { IgnoreCommitsSpec } from '../repo/repo-spec.js';

/**
 * Re-exported so the commit-ignore API is complete from one module:
 * the "is anything configured" guard plus the filter. The guard is
 * defined next to the spec it describes (`src/repo/repo-spec.ts`), and
 * re-exported here to mirror `path-ignore.ts` (`hasIgnorePaths` +
 * `filterCommitsIgnoring`).
 */
export { hasIgnoreCommits };

/**
 * Filters a commit list against the repository's commit exclusions: a
 * commit whose full sha starts with one of the configured hashes
 * (case-insensitively), or whose subject matches one of the configured
 * message patterns (case-insensitively), is dropped entirely — merges
 * included; an explicit exclusion by hash always wins. Commits keep
 * their order and object identity.
 *
 * @param commits - The commits to filter, typically newest first.
 * @param spec - The commit exclusions to apply.
 * @returns The kept commits, newest first; unmodified when nothing is
 * excluded.
 */
export function filterIgnoredCommits(
  commits: readonly Commit[],
  spec: IgnoreCommitsSpec,
): Commit[] {
  const matcher = compileIgnoreMatcher(spec);
  return commits.filter((commit) => !matcher(commit));
}

/**
 * A compiled commit matcher: tests one commit against the configured
 * hash prefixes and message patterns.
 */
type CommitMatcher = (commit: Commit) => boolean;

/**
 * Compiles a commit-ignore spec into one matcher: the hash prefixes
 * are normalized (trimmed, lowercased) and each message pattern is
 * compiled to a case-insensitive regular expression once, so matching
 * many commits does not recompile anything.
 *
 * @param spec - The commit exclusions.
 * @returns The matcher.
 */
function compileIgnoreMatcher(spec: IgnoreCommitsSpec): CommitMatcher {
  const hashes = (spec.hashes ?? [])
    .map((hash) => hash.trim().toLowerCase())
    .filter((hash) => hash !== '');
  const regexes = (spec.messages ?? [])
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern !== '')
    .map((pattern) => new RegExp(pattern, 'i'));
  return (commit) => {
    const sha = commit.sha.toLowerCase();
    return (
      hashes.some((hash) => sha.startsWith(hash)) ||
      regexes.some((regex) => regex.test(commit.subject))
    );
  };
}
