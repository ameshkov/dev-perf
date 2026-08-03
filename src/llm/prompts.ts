/**
 * LLM prompts (docs/design.md §6.3, §6.5, plan step 8): the
 * orientation prompt that produces the repository context (tech stack,
 * main modules, conventions), the per-user prompt with identity, date
 * range, repo context, and the user's commit list (sha, date, subject,
 * numstat totals, files), and the tool-call reminder used by the
 * enforcement loop. Both analysis prompts end with the instruction to
 * call `devperf_report` with the final analysis before finishing — no
 * other output format is accepted. The orientation context is injected
 * into user sessions with `noReply: true` (design §6.3).
 */
import type { Commit, CommitFile } from '../deterministic/commits.js';
import type { AnalyzedRange } from '../report/index.js';

/**
 * The closing instruction shared by the orientation and per-user
 * prompts (design §6.5): the analysis is only accepted through the
 * `devperf_report` tool.
 */
const TOOL_CALL_INSTRUCTION =
  'When the analysis is complete, call the devperf_report tool with the final ' +
  'analysis before finishing the session; no other output format is accepted.';

/** How many file paths a commit line lists before they are truncated. */
const MAX_FILES_PER_COMMIT = 20;

/** Everything the per-user analysis prompt needs (design §6.3). */
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
 * Builds the orientation prompt (design §6.3): the agent explores the
 * repository with the read tools and read-only git commands and
 * returns a compact repository context — tech stack, main modules,
 * conventions — that every user session then receives. The prompt ends
 * with the standard tool-call instruction.
 *
 * @param repo - Repository URL or local path as given on the command
 * line.
 * @returns The orientation prompt text.
 */
export function buildOrientationPrompt(repo: string): string {
  return (
    [
      `You are analyzing the git repository at ${repo} for dev-perf, a ` +
        'developer-contribution analyzer. This orientation session establishes the ' +
        'repository context that later sessions use to analyze individual contributors.',
      'Explore the repository with the read tools (read, grep, glob, ls) and read-only ' +
        'git commands (git log, git show, git status) as needed. Produce a compact ' +
        'repository context covering:\n' +
        '- Tech stack: languages, frameworks, and key dependencies (README, manifests, config files).\n' +
        '- Main modules or directories and what each does.\n' +
        '- Conventions: code style, testing, commit message style.',
      'Keep the context under 150 words. Reply with ONLY the repository context as ' +
        'your final text.',
      TOOL_CALL_INSTRUCTION,
    ].join('\n\n') + '\n'
  );
}

/**
 * Builds the per-user analysis prompt (design §6.3): identity, date
 * range, the repository context from the orientation session, and the
 * user's commit list with sha, author date, subject, numstat totals,
 * and files per commit. The agent inspects the commits with read tools
 * and read-only git commands and reports what cannot be counted —
 * work types, complexity, impacted areas, quality signals, risk flags
 * — split into distinct contributions. The prompt ends with the
 * standard tool-call instruction.
 *
 * @param input - Identity, range, repo context, and commits.
 * @returns The per-user prompt text.
 */
export function buildUserPrompt(input: UserPromptInput): string {
  const since = input.range.since === '' ? 'the beginning' : input.range.since;
  const until = input.range.until === '' ? 'now' : input.range.until;
  const lines = input.commits.map((commit) => `- ${commitLine(commit)}`).join('\n');
  return (
    [
      `You are analyzing the git contributions of ${input.name} (${input.email}) in the ` +
        `repository at ${input.repo} for dev-perf, a developer-contribution analyzer. The ` +
        `analysis covers commits whose author date lies in the range ${since} to ${until} (UTC).`,
      `## Repository context\n${input.repoContext}`,
      `## Commits by ${input.name} in the analyzed range (${input.commits.length})\n` +
        'Newest first; each line lists the abbreviated sha, author date, subject, total ' +
        'added/removed lines, and the files changed (merge commits have no file list).\n\n' +
        lines,
      'Inspect the commits with the read tools and read-only git commands (git show, git ' +
        'log, git diff, git blame) as needed, and assess what cannot be counted from git ' +
        'history alone: work types, complexity, impacted areas, and observable quality ' +
        'signals or risk flags.',
      'Split the work into distinct contributions (one feature, one bug fix, one ' +
        'refactor, and so on); changes of different complexity are separate contributions ' +
        'rather than averaged into one.',
      TOOL_CALL_INSTRUCTION,
    ].join('\n\n') + '\n'
  );
}

/**
 * Builds the follow-up reminder the enforcement loop sends when a
 * session finished without calling `devperf_report` (design §6.5).
 *
 * @returns The reminder prompt text.
 */
export function buildToolCallReminder(): string {
  return (
    'The session finished without the devperf_report tool being called. Call ' +
    'devperf_report with the final analysis before finishing the session; no other ' +
    'output format is accepted.\n'
  );
}

/**
 * Renders one commit as a prompt line: abbreviated sha, author date,
 * subject, and — for non-merge commits — the numstat totals and file
 * list (design §6.3). Binary files count zero lines; a file list
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
