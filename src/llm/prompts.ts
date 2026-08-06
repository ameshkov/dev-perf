/**
 * LLM prompt rendering: the prompt text itself lives in markdown
 * template files under `src/llm/prompts/`. The system prompts
 * (`orientation-system.md` and `user-system.md`) define who the agent
 * is and the environment it runs in — the read-only tool surface —
 * and carry no per-run task details; the task details (repository,
 * identity, date range, the context and the commit list) live in the
 * user prompts (`orientation.md` — the orientation session that
 * produces the repository context; `user.md` — the per-user analysis
 * prompt; `reminder.md` — the tool-call reminder used by the
 * enforcement loop). This module loads the templates (relative to the
 * module file, so the same paths work from `src/` and `build/`),
 * caches them, and substitutes the `{{placeholder}}` values; it
 * renders no prompt prose itself.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Commit, CommitFile } from '../deterministic/commits.js';
import type { AnalyzedRange } from '../report/index.js';

/** How many file paths a commit line lists before they are truncated. */
const MAX_FILES_PER_COMMIT = 20;

/** Loaded templates, cached after the first read. */
const templateCache = new Map<string, Promise<string>>();

/** Everything the per-user analysis prompt needs. */
export interface UserPromptInput {
  /** Repository URL or local path as given on the command line. */
  repo: string;
  /** Display name of the analyzed user. */
  name: string;
  /** Lowercased author email of the analyzed user. */
  email: string;
  /** Analyzed author-date range (UTC instants; `''` means unbounded). */
  range: AnalyzedRange;
  /** Repository context from the orientation session. */
  repoContext: string;
  /** The user's commits in the range, newest first. */
  commits: Commit[];
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
 * conventions — that every user session then receives. The prompt ends
 * with the standard tool-call instruction.
 *
 * @param repo - Repository URL or local path as given on the command
 * line.
 * @returns The orientation prompt text.
 */
export async function buildOrientationPrompt(repo: string): Promise<string> {
  return renderTemplate(await loadTemplate('orientation'), { repo });
}

/**
 * Builds the per-user analysis prompt: the analyzed identity,
 * repository, and date range, the repository context from the
 * orientation session, and the user's commit list with sha, author
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
  return renderTemplate(await loadTemplate('user'), {
    name: input.name,
    email: input.email,
    repo: input.repo,
    since,
    until,
    repoContext: input.repoContext,
    count: String(input.commits.length),
    commits: lines,
  });
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
