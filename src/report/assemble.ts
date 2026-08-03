/**
 * Report assembly (docs/design.md §7): builds the report document from
 * the deterministic analysis results. The assembler is pure — all git
 * access happens in the pipeline; here the report is constructed and
 * validated against the shared schema, so nothing can drift (§3).
 */
import type { AuthorGroup } from '../deterministic/identity.js';
import { repoStats, userMetrics } from '../deterministic/metrics.js';
import { reportSchema } from './schema.js';
import type { Report, Repository, User } from './schema.js';

/**
 * Analyzed author-date range as resolved UTC instants; the empty
 * string marks an unbounded side.
 */
export interface AnalyzedRange {
  /** Inclusive start of the range; `''` when unbounded. */
  since: string;
  /** Inclusive end of the range; `''` when unbounded. */
  until: string;
}

/** Everything the assembler needs for one repository entry. */
export interface RepositoryEntryInput {
  /** Repository URL or local path as given on the command line. */
  repo: string;
  /** Absolute path of the cloned repository inside the cache. */
  clonePath: string;
  /** Branch the clone was checked out on. */
  branch: string;
  /** Head commit sha of the clone. */
  head: string;
  /** Analyzed author-date range (UTC instants). */
  range: AnalyzedRange;
  /** Author groups of the range, one per user. */
  groups: AuthorGroup[];
}

/** Everything the assembler needs for the report document. */
export interface ReportInput {
  /** Repositories analyzed, as given on the command line. */
  repos: string[];
  /** Analyzed author-date range (UTC instants). */
  range: AnalyzedRange;
  /** Model used for LLM analysis; absent when LLM was disabled. */
  model?: string;
  /** Whether LLM analysis was enabled for this run. */
  llmEnabled: boolean;
  /** When the report was generated (ISO 8601, UTC). */
  generatedAt: string;
  /** Assembled repository entries. */
  repositories: Repository[];
}

/**
 * Builds one repository entry (design §7): identity, analyzed range,
 * repository statistics, and one user entry per author group with
 * deterministic metrics and a skipped LLM analysis. User entries keep
 * the group order (first-encounter order of the parsed commits).
 *
 * @param input - Clone identity, range, and author groups.
 * @returns The repository entry.
 */
export function assembleRepository(input: RepositoryEntryInput): Repository {
  return {
    repo: input.repo,
    clonePath: input.clonePath,
    branch: input.branch,
    head: input.head,
    range: input.range,
    stats: repoStats(input.groups),
    users: input.groups.map(userEntry),
  };
}

/**
 * Builds the user entry for one author group (design §7): display
 * name, the grouped email, bot flag, deterministic metrics, and a
 * skipped LLM analysis — the LLM phase (plan steps 7-9) replaces it
 * once it runs.
 *
 * @param group - The author group.
 * @returns The user entry.
 */
function userEntry(group: AuthorGroup): User {
  return {
    name: group.name,
    emails: [group.email],
    isBot: group.isBot,
    deterministic: userMetrics(group.commits),
    llm: { status: 'skipped', contributions: [] },
  };
}

/**
 * Builds the full report document (design §7): parameters, the
 * generated-at timestamp, and one entry per repository. The result is
 * validated against `reportSchema`, which applies defaults (e.g.
 * `llm.contributions`) — an invalid assembly fails here rather than at
 * the consumer.
 *
 * @param input - Run parameters and assembled repository entries.
 * @returns The validated report document.
 * @throws {ZodError} When the assembled document does not validate.
 */
export function assembleReport(input: ReportInput): Report {
  return reportSchema.parse({
    schemaVersion: 1 as const,
    generatedAt: input.generatedAt,
    parameters: {
      repos: input.repos,
      since: input.range.since,
      until: input.range.until,
      // The model key stays absent (not `undefined`) when LLM analysis
      // was disabled, matching the JSON output.
      ...(input.model === undefined ? {} : { model: input.model }),
      llmEnabled: input.llmEnabled,
    },
    repositories: input.repositories,
  });
}
