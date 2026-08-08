/**
 * Per-repository path exclusion: a repository's configured `ignore`
 * patterns (gitignore-style) drop ignored files and entire ignored-only
 * commits from the analysis, so neither the deterministic metrics nor
 * the LLM layer count that noise. `filterCommitsIgnoring` is applied
 * once, right after the commits are read and before they are grouped by
 * author — the single point that makes both layers exclusion-free.
 *
 * The matcher covers the common gitignore forms with no new
 * dependencies: a trailing `/` marks a directory (matching files under
 * it, never a file that happens to share the directory's name), a
 * pattern without `/` matches a basename at any depth, and any other
 * pattern is anchored to the repository root, with `*` and `?` within a
 * segment and `**` across segments. `!` negation, character classes
 * (`[a-z]`), and brace alternations (`{a,b}`) are not supported:
 * the latter two are matched literally, so a pattern using them
 * quietly matches nothing — keep them out of `ignore` lists. Consecutive
 * `**` segments collapse into one, mirroring git. Backslash is not an
 * escape character, and patterns are trimmed before matching, so
 * whitespace-only patterns are dropped.
 * Commit file paths are matched as reported by
 * `git log --numstat`, i.e. relative to the repository root.
 */
import type { Commit } from './commits.js';

/**
 * Keeps a commit whose files are filtered by a path matcher.
 */
type CommitFilter = (commit: Commit) => Commit | undefined;

/**
 * True when a non-empty ignore list is configured. `undefined` and an
 * empty list both mean "no exclusions" — the semantic shared by the
 * filtering step, the logging, the report entry, and the LLM phase, so
 * it lives in one place. The type predicate narrows the argument to a
 * non-empty list where `true`, so callers can use the patterns directly.
 *
 * @param ignore - The repository's configured ignore patterns, if any.
 * @returns True when at least one pattern is in effect.
 */
export function hasIgnorePaths(ignore: string[] | undefined): ignore is string[] {
  return ignore !== undefined && ignore.length > 0;
}

/**
 * Filters a commit list against the repository's ignore patterns: each
 * non-merge commit keeps only the files whose paths do not match, and a
 * non-merge commit left with no files is dropped entirely (all of its
 * changes fall under ignored paths). Merge commits have no numstat rows
 * of their own — an empty file list — and are always kept, never
 * pruned by ignored paths.
 *
 * @param commits - The commits to filter, typically newest first.
 * @param patterns - Gitignore-style patterns to exclude, if any.
 * @returns The kept commits, newest first; unmodified when no patterns
 * are given.
 */
export function filterCommitsIgnoring(
  commits: readonly Commit[],
  patterns: readonly string[] | undefined,
): Commit[] {
  if (patterns === undefined || patterns.length === 0) {
    return [...commits];
  }
  const matches = compileMatcher(patterns);
  const filter: CommitFilter = (commit) => {
    if (commit.isMerge) {
      return commit;
    }
    const files = commit.files.filter((file) => !matches(file.path));
    // A commit is pruned only when it originally had files and every one
    // of them fell under ignored paths; a commit that started empty (e.g.
    // `git commit --allow-empty`) has no changes under ignored paths and
    // stays, exactly as when no patterns are configured.
    if (commit.files.length > 0 && files.length === 0) {
      return undefined;
    }
    // Only copy when files were actually removed; otherwise return the
    // original commit so object identity stays uniform with merge commits.
    return files.length === commit.files.length ? commit : { ...commit, files };
  };
  const kept: Commit[] = [];
  for (const commit of commits) {
    const filtered = filter(commit);
    if (filtered !== undefined) {
      kept.push(filtered);
    }
  }
  return kept;
}

/**
 * A compiled path matcher: tests a numstat-relative path against the
 * configured ignore patterns.
 */
type PathMatcher = (path: string) => boolean;

/**
 * Compiles the ignore patterns into one matcher: each non-empty pattern
 * is translated to a regular expression, and a path matches when any of
 * them does.
 *
 * @param patterns - Gitignore-style patterns.
 * @returns The matcher.
 */
function compileMatcher(patterns: readonly string[]): PathMatcher {
  // Patterns are trimmed before compiling, so surrounding whitespace
  // (e.g. an accidental indent in the config) never becomes part of the
  // pattern, and whitespace-only patterns are dropped.
  const regexes = patterns
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern !== '')
    .map(patternToRegex);
  return (path) => regexes.some((regex) => regex.test(path));
}

/**
 * Translates one gitignore-style pattern to a regular expression
 * matching the paths it excludes.
 *
 * The translation rules, mirroring gitignore without `!` negation:
 *
 * - A trailing `/` marks a directory-only pattern (`docs/`): it excludes
 *   files *under* that directory but never a file that merely shares the
 *   directory's name — same for a trailing `**` (`abc/**` excludes the
 *   whole `abc/` subtree, not a file `abc`).
 * - A pattern without a slash (a single bare segment) matches a path
 *   segment of that glob at any depth — the basename match — and also
 *   excludes its subtree (so `node_modules` drops `node_modules/*`).
 * - A pattern starting with a slash or carrying an internal slash is
 *   anchored to the repository root; `/` separators are literal,
 *   `*`/`?` match within one segment, and `**` matches zero or more
 *   whole segments.
 *
 * @param pattern - One non-empty gitignore-style pattern.
 * @returns The matching regular expression.
 */
function patternToRegex(pattern: string): RegExp {
  const withoutLeading = pattern.startsWith('/') ? pattern.slice(1) : pattern;
  // A trailing `/` marks a directory; the subtree suffix below covers
  // everything under it, so only the empty trailing segment is dropped.
  const directoryOnly = withoutLeading.endsWith('/');
  const trimmed = directoryOnly ? withoutLeading.slice(0, -1) : withoutLeading;
  const segments = trimmed.split('/');
  // A pattern is root-anchored when it starts with a slash or carries an
  // internal slash; a single bare segment matches at any depth.
  const anchored = pattern.startsWith('/') || segments.length > 1;
  const prefix = anchored ? '^' : '(?:^|/)';
  const body = buildBody(segments);
  // A trailing `/` or trailing `**` marks a directory: only files truly
  // under the directory match, so the subtree is mandatory. A file that
  // shares the directory's name must not match. The lone `**` pattern
  // (match any path) is already handled by `buildBody`, which returns a
  // full body, so it is exempt from the directory suffix.
  const loneDoubleJoker = segments.length === 1 && segments[0] === '**';
  const directoryScope =
    !loneDoubleJoker && (directoryOnly || segments[segments.length - 1] === '**');
  const suffix = directoryScope ? '(?:/.*)' : '(?:/.*)?';
  return new RegExp(`${prefix}${body}${suffix}$`);
}

/**
 * Builds the regex body for the pattern's segments: a literal segment is
 * a `/`-joined escaped fragment, and `**` spans zero or more whole
 * segments. A leading `**` spans segments in front, a middle `**` keeps
 * a mandatory `/` so neighboring literals never concatenate (e.g. a
 * pattern `a` + `**` + `b` matches `a/b` but not the single segment
 * `ab`), and a trailing `**` matches the whole rest of the path (the
 * pattern's directory scope adds the required subtree). Two or more
 * consecutive `**` segments behave as one, mirroring git.
 *
 * @param segments - The slash-delimited pattern segments.
 * @returns The regex body without the anchoring prefix or subtree suffix.
 */
function buildBody(segments: string[]): string {
  // Collapse consecutive `**` segments into one, so a repeated `**`
  // behaves like a single `**` instead of requiring extra separators.
  const collapsed: string[] = [];
  for (const segment of segments) {
    if (segment !== '**' || collapsed[collapsed.length - 1] !== '**') {
      collapsed.push(segment);
    }
  }
  // A lone `**` means "match any path" (files at any depth).
  if (collapsed.length === 1 && collapsed[0] === '**') {
    return '[^/]+(?:/[^/]+)*';
  }
  const parts: string[] = [];
  for (let index = 0; index < collapsed.length; index++) {
    const segment = collapsed[index];
    if (segment === '**') {
      if (index === collapsed.length - 1) {
        // Trailing `**` matches the whole rest of the path; the
        // pattern-level directory scope makes the subtree mandatory.
        parts.push('(?:/.*)?');
      } else if (index === 0) {
        // Leading `**` matches zero or more segments in front; the empty
        // match needs no separator because nothing precedes it.
        parts.push('(?:.*/)?');
      } else {
        // Middle `**` spans zero or more whole segments and must keep a
        // slash when it matches zero segments, so a neighbor is never
        // concatenated with the segment before it.
        parts.push('(?:/[^/]*)*/');
      }
      continue;
    }
    const previousIsJoker = index > 0 && collapsed[index - 1] === '**';
    const separator = index === 0 || previousIsJoker ? '' : '/';
    parts.push(`${separator}${translateSegment(segment)}`);
  }
  return parts.join('');
}

/**
 * Translates one path segment to its regex fragment: within an ordinary
 * segment `*`/`?` match within the segment and every other regex
 * metacharacter is escaped. The `**` handling lives entirely in
 * `buildBody`, so a plain segment is never a joker.
 *
 * @param segment - One slash-delimited pattern segment.
 * @returns The regex fragment for the segment.
 */
function translateSegment(segment: string): string {
  const escaped = segment.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  return escaped.replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]');
}
