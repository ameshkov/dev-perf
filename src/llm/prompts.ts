/**
 * LLM prompt rendering: the prompt text itself lives in markdown
 * template files under `src/llm/prompts/`. The system prompts
 * (`orientation-system.md` and `user-system.md`) define who the agent
 * is and the environment it runs in — the read-only tool surface and
 * the shared-clone invariant (never check out a branch or change the
 * repository, since several sessions inspect the same cache entry) —
 * and carry no per-run task details; the task details (repository,
 * identity, date range, the context and the commit list) live in the
 * user prompts (`orientation.md` — the orientation session that
 * produces the repository context; `user.md` — the per-user analysis
 * prompt; `reminder.md` — the tool-call reminder used by the
 * enforcement loop). When an attempt fails because a session hit its
 * max-time or max-turns limit, the retried prompt carries the retry
 * advice rendered from `limit-retry.md` (`{{retryAdvice}}`, empty
 * otherwise). This module loads the templates (relative to the module
 * file, so the same paths work from `src/` and `build/`), caches them,
 * and substitutes the `{{placeholder}}` values; it renders no prompt
 * prose itself.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Commit, CommitFile } from '../deterministic/commits.js';
import type { AnalyzedRange } from '../report/index.js';
import type { IgnoreCommitsSpec } from '../repo/repo-spec.js';
import type { SessionLimitHit } from './session-limits.js';

/** How many file paths a commit line lists before they are truncated. */
const MAX_FILES_PER_COMMIT = 20;

/** Loaded templates, cached after the first read. */
const templateCache = new Map<string, Promise<string>>();

/** Everything the per-user analysis prompt needs. */
export interface UserPromptInput {
  /** Repository URL or local path as given on the command line. */
  repo: string;
  /** The effective checked-out branch of the analyzed clone. */
  branch: string;
  /** The resolved base branch the analysis is scoped against
   * (branch-delta), when one was in effect. */
  base?: string;
  /** Gitignore-style paths excluded for this repository, if any. */
  ignore?: string[];
  /** The commits excluded for this repository — by hash and/or message
   * pattern — if any. */
  ignoreCommits?: IgnoreCommitsSpec;
  /** Display name of the analyzed user. */
  name: string;
  /** Lowercased primary author email of the analyzed user. */
  email: string;
  /** Every lowercased email of the analyzed identity, sorted; one
   * email when the identity was not merged. */
  emails: string[];
  /** Analyzed author-date range (UTC instants; `''` means unbounded). */
  range: AnalyzedRange;
  /** Repository context from the orientation session. */
  repoContext: string;
  /** The user's commits in the range, newest first. */
  commits: Commit[];
  /** The session limit a previous attempt exceeded, when this prompt is
   * a retry after such a failure — renders the "be less thorough but
   * faster" advice into the prompt. */
  limitHit?: SessionLimitHit;
}

/**
 * Builds the orientation system prompt: defines the dev-perf
 * repository analyst agent and its tool surface (read,
 * grep, find, ls; bash; `devperf_report`) for the
 * orientation session. It is static — who the agent is and how it may
 * work — and carries no task details; the repository being analyzed
 * and the requested context live in the orientation user prompt.
 *
 * @returns The orientation system prompt text.
 */
export function buildOrientationSystemPrompt(): Promise<string> {
  return loadTemplate('orientation-system');
}

/**
 * Builds the per-user system prompt: defines the dev-perf contributor
 * analyst agent and its tool surface. It is static — who the
 * agent is and how it may work — and carries no task details; the
 * identity, repository, and analyzed range live in the per-user
 * analysis prompt.
 *
 * @returns The per-user system prompt text.
 */
export function buildUserSystemPrompt(): Promise<string> {
  return loadTemplate('user-system');
}

/**
 * Builds the orientation prompt: the agent explores the
 * repository with the read tools and read-only git commands and
 * returns a compact repository context — tech stack, main modules,
 * conventions — that every user session then receives. The prompt names
 * the analyzed branch and the excluded paths so the context is scoped to
 * them. The prompt ends with the standard tool-call instruction.
 *
 * @param repo - Repository URL or local path as given on the command
 * line.
 * @param branch - The effective checked-out branch being analyzed.
 * @param ignore - Gitignore-style paths excluded for the repository, if any.
 * @param ignoreCommits - The commits excluded for the repository, if any.
 * @param limitHit - The session limit a previous attempt exceeded, when
 * this is a retry after such a failure.
 * @returns The orientation prompt text.
 */
export async function buildOrientationPrompt(
  repo: string,
  branch: string,
  ignore?: string[],
  ignoreCommits?: IgnoreCommitsSpec,
  limitHit?: SessionLimitHit,
): Promise<string> {
  return renderTemplate(await loadTemplate('orientation'), {
    repo,
    branch: branchNote(branch),
    ignoredPaths: ignoredPathsValue(ignore),
    ignoredCommits: ignoredCommitsValue(ignoreCommits),
    retryAdvice: await buildLimitRetryNote(limitHit),
  });
}

/**
 * Builds the per-user analysis prompt: the analyzed identity,
 * repository, branch, excluded paths, and date range, the repository
 * context from the orientation session, and the user's commit list with
 * sha, author
 * date, subject, numstat totals, and files per commit. The agent
 * inspects the commits with read tools and read-only git commands and
 * reports what cannot be counted — work types, complexity, impacted
 * areas, quality signals, risk flags — split into distinct
 * contributions. The prompt ends with the standard tool-call
 * instruction.
 *
 * @param input - Repo context, user name, commits, and analyzed range.
 * @returns The per-user prompt text.
 */
export async function buildUserPrompt(input: UserPromptInput): Promise<string> {
  const lines = input.commits.map((commit) => `- ${commitLine(commit)}`).join('\n');
  const since = input.range.since === '' ? 'the beginning' : input.range.since;
  const until = input.range.until === '' ? 'now' : input.range.until;
  const identityNote =
    input.emails.length <= 1
      ? ''
      : `; treat commits from all of the email addresses ${input.emails.join(
          ', ',
        )} as this contributor's work`;
  return renderTemplate(await loadTemplate('user'), {
    name: input.name,
    email: input.email,
    identityNote,
    repo: input.repo,
    branch: branchNote(input.branch),
    ignoredPaths: ignoredPathsValue(input.ignore),
    ignoredCommits: ignoredCommitsValue(input.ignoreCommits),
    scopeNote: scopeNoteValue(input.base),
    since,
    until,
    repoContext: input.repoContext,
    retryAdvice: await buildLimitRetryNote(input.limitHit),
    count: String(input.commits.length),
    commits: lines,
  });
}

/**
 * Renders the retry-advice block for a prompt that re-runs after a
 * session limit was exceeded: it tells the model what happened and to
 * be less thorough but faster, so the retried session actually finishes
 * within its fresh budget. Empty (no block) for a first attempt or a
 * retry that was not caused by a session limit.
 *
 * @param hit - The session limit a previous attempt exceeded, or
 * `undefined`.
 * @returns The rendered advice block, or `''`.
 */
async function buildLimitRetryNote(hit: SessionLimitHit | undefined): Promise<string> {
  if (hit === undefined) {
    return '';
  }
  const limit =
    hit.kind === 'time'
      ? `the ${hit.cap}-second max-time cap`
      : `the ${hit.cap}-turn max-turns cap`;
  return renderTemplate(await loadTemplate('limit-retry'), { limit });
}

/**
 * The branch phrase for the prompts: quoted for a concrete branch, or a
 * neutral phrase when the clone resolved to no branch at all — a
 * none-existent branch, an empty repository, or a detached HEAD, where
 * "the default branch" would be factually wrong.
 *
 * @param branch - The effective checked-out branch.
 * @returns The phrase naming the branch.
 */
function branchNote(branch: string): string {
  if (branch === '') {
    return 'the current checkout';
  }
  // The branch name originates in the (potentially untrusted) remote
  // repository, so escape it before it is interpolated into the prompt:
  // git ref rules allow double quotes and backticks, which would
  // otherwise break out of the quoted phrase and inject tokens.
  return `the "${escapePromptText(branch)}" branch`;
}

/**
 * The excluded-paths value for the prompts: one dash item per pattern
 * (backtick-quoted), or a "none." sentence when nothing is excluded —
 * so the template always renders a defined value. Patterns are
 * normalized exactly like the deterministic matcher (`path-ignore.ts`
 * trims each pattern and drops the whitespace-only ones), so the prompt
 * only ever enumerates exclusions that the filters actually apply — a
 * whitespace-only list renders "none." instead of a useless bullet.
 *
 * @param ignore - The repository's ignored path patterns, if any.
 * @returns The renderable path list.
 */
function ignoredPathsValue(ignore: string[] | undefined): string {
  const patterns = (ignore ?? []).map((path) => path.trim()).filter((path) => path !== '');
  if (patterns.length === 0) {
    return 'none.';
  }
  return patterns.map((path) => `- ${codeSpan(path)}`).join('\n');
}

/**
 * The excluded-commits value for the prompts: one dash item per hash
 * and per message pattern (backtick-quoted, tagged by kind), or a
 * "none." sentence when nothing is excluded — so the template always
 * renders a defined value. Values are normalized exactly like the
 * deterministic matcher (`commit-ignore.ts` trims each hash and pattern
 * and drops the empty ones), so the prompt only ever enumerates
 * exclusions that the filters actually apply.
 *
 * @param spec - The repository's excluded commits, if any.
 * @returns The renderable exclusion list.
 */
function ignoredCommitsValue(spec: IgnoreCommitsSpec | undefined): string {
  const hashes = (spec?.hashes ?? []).map((hash) => hash.trim()).filter((hash) => hash !== '');
  const messages = (spec?.messages ?? [])
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern !== '');
  const lines = [
    ...hashes.map((hash) => `- ${codeSpan(hash)} (commit hash)`),
    ...messages.map((pattern) => `- ${codeSpan(pattern)} (message pattern)`),
  ];
  return lines.length === 0 ? 'none.' : lines.join('\n');
}

/**
 * Wraps one interpolated path in a Markdown code span, unable to break
 * out of it: a backtick inside the value would terminate the span
 * (CommonMark does not process backslash escapes inside code spans, so
 * backslash-escaping is useless there) and a line break would inject
 * text outside it. Backticks are stripped — a backtick in an ignored
 * path is pathological — and line breaks are collapsed to spaces, so
 * the code span always closes on the same line.
 *
 * @param value - The value to render in a code span.
 * @returns The code span.
 */
function codeSpan(value: string): string {
  const cleaned = value.replace(/`/g, '').replace(/[\r\n]/g, ' ');
  return `\`${cleaned}\``;
}

/**
 * The branch-delta scope note for the per-user prompt: a paragraph
 * telling the agent the analysis covers only the commits not already on
 * the base branch, so merged history is never attributed. Renders an
 * empty string without a base (full-history runs), always passing a
 * defined value so the template carries no unrendered placeholder.
 *
 * @param base - The resolved base branch name, when a branch-delta is in
 * effect.
 * @returns The scope-note paragraph, or `''`.
 */
function scopeNoteValue(base: string | undefined): string {
  if (base === undefined) {
    return '';
  }
  // The base name originates in the (potentially untrusted) repository,
  // so escape it like the branch name before it is interpolated.
  return (
    `The analysis is scoped to the delta from the "${escapePromptText(base)}" branch: ` +
    `only the commits below that are not yet on it are this contributor's work. ` +
    `Changes also reachable from the base are outside the scope and must not be ` +
    `attributed. Judge complexity, size, and impact by exactly the commits ` +
    `listed, and keep the commit count as given.`
  );
}

/**
 * Escapes a value before it is interpolated into a prompt, so a
 * repository-derived string (branch name, ignore pattern) cannot break
 * out of the quoting or a code span: backslashes, double quotes, and
 * backticks are backslash-escaped, and line breaks are collapsed (they
 * would otherwise inject prompt text).
 *
 * @param value - The raw value to interpolate.
 * @returns The escaped value.
 */
function escapePromptText(value: string): string {
  return value.replace(/[\\"`\r\n]/g, (char) =>
    char === '\n' || char === '\r' ? ' ' : `\\${char}`,
  );
}

/**
 * Builds the follow-up reminder the enforcement loop sends when a
 * session finished without calling `devperf_report`.
 *
 * @returns The reminder prompt text.
 */
export async function buildToolCallReminder(): Promise<string> {
  return loadTemplate('reminder');
}

/**
 * Loads one prompt template from `src/llm/prompts/`, caching it after
 * the first read. The file is resolved relative to this module so the
 * same path works from the source tree (tests, `tsx`) and the
 * compiled `build/` output (the build copies the templates next to
 * the compiled module).
 *
 * @param name - Template file name without the `.md` extension.
 * @returns The template text.
 * @throws {Error} When the template file cannot be read.
 */
function loadTemplate(name: string): Promise<string> {
  let template = templateCache.get(name);
  if (template === undefined) {
    const file = path.join(fileURLToPath(new URL('./prompts', import.meta.url)), `${name}.md`);
    template = readFile(file, 'utf8');
    templateCache.set(name, template);
  }
  return template;
}

/**
 * Substitutes the `{{placeholder}}` occurrences in a template with
 * the given values; placeholders without a value are left as-is.
 * Values are never re-scanned, so rendered text cannot trigger
 * further substitutions.
 *
 * @param template - The template text.
 * @param values - Placeholder name to value map.
 * @returns The rendered prompt text.
 */
function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => values[key] ?? match);
}

/**
 * Renders one commit as a prompt line: abbreviated sha, author date,
 * subject, and — for non-merge commits — the numstat totals and file
 * list. Binary files count zero lines; a file list
 * longer than `MAX_FILES_PER_COMMIT` is truncated.
 *
 * @param commit - The commit to render.
 * @returns The single-line description.
 */
function commitLine(commit: Commit): string {
  const head = `${commit.sha.slice(0, 8)} ${commit.authorDate.slice(0, 10)} ${commit.subject}`;
  if (commit.isMerge) {
    return `${head} (merge commit)`;
  }
  return `${head} (+${lineTotal(commit.files, 'added')} -${lineTotal(commit.files, 'deleted')}) ${fileList(commit.files)}`;
}

/**
 * Sums one numstat column over a commit's files; binary files
 * (undefined counts) contribute zero.
 *
 * @param files - The commit's changed files.
 * @param column - The line-count column to sum.
 * @returns The total.
 */
function lineTotal(files: CommitFile[], column: 'added' | 'deleted'): number {
  return files.reduce((sum, file) => sum + (file[column] ?? 0), 0);
}

/**
 * Renders a commit's file paths, truncated to `MAX_FILES_PER_COMMIT`
 * with a count of the omitted files.
 *
 * @param files - The commit's changed files.
 * @returns The comma-separated path list.
 */
function fileList(files: CommitFile[]): string {
  const paths = files.map((file) => file.path);
  if (paths.length <= MAX_FILES_PER_COMMIT) {
    return paths.join(', ');
  }
  const shown = paths.slice(0, MAX_FILES_PER_COMMIT).join(', ');
  return `${shown}, and ${paths.length - MAX_FILES_PER_COMMIT} more`;
}
