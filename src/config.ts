/**
 * Resolution and validation of the report options from the YAML config
 * file. `resolveReportOptions` maps the kebab-case config keys to the
 * camelCase validated shape (repos from the `repos` key, each entry
 * normalized to a repository spec, numbers pass through typed,
 * `users-map` parsed into mapping entries), and
 * `parseReportOptions` validates them against `reportOptionsSchema`.
 * The config file is the single source of options — the CLI carries no
 * flags beyond `--config`. The cross-field rules: when LLM analysis is
 * enabled, `model`, `providerUrl` and `apiKey` are required; `since` is
 * required when `unit` is set (an unbounded range cannot be split into
 * periods); each email may map to only one display name. `limitContext`
 * / `limitOutput` are positive integers with the defaults 262144 /
 * 65536; `llmMaxTime` (seconds) and `llmMaxTurns` are optional positive
 * integers that bound each LLM session, unlimited when unset.
 */
import { z } from 'zod';
import type { DevPerfConfig } from './config-file.js';
import { parseRepoConfigItem, repoSpecSchema } from './repo/repo-spec.js';
import type { RepoSpec } from './repo/repo-spec.js';
import { emailMapEntrySchema, usersMapToEntries } from './util/email-map.js';
import type { EmailMapEntry } from './util/email-map.js';
import { periodUnitSchema } from './report/index.js';

/**
 * The report options as resolved from the config file before
 * validation: optional kebab-case config keys mapped to the camelCase
 * fields of the validated shape. The config file is the only source of
 * options, so this is the input to `parseReportOptions`.
 */
export interface ResolvedReportOptions {
  /** Repositories to analyze, normalized to specs (URLs or local paths
   * plus optional branch and ignored paths). */
  repos: RepoSpec[];
  /** Start date (author date, UTC; any git date format). */
  since?: string;
  /** End date (author date, UTC; any git date format; default: today). */
  until?: string;
  /** Split the range into periods of this unit (day/week/month/quarter/year). */
  unit?: string;
  /** Write the JSON report to this file instead of stdout. */
  output?: string;
  /** Cache directory for cloned repos and LLM results (default: <tmpdir>/.dev-cache). */
  cacheDir?: string;
  /** Force re-clone and re-analysis even if the cache is present. */
  refresh?: boolean;
  /** LLM analysis enabled (default: true; `llm: false` disables it). */
  llm?: boolean;
  /** Model id, e.g. gpt-4.1. Required when LLM analysis is enabled. */
  model?: string;
  /** OpenAI-compatible provider base URL. Required when LLM is enabled. */
  providerUrl?: string;
  /** Provider API key. Required for LLM analysis. */
  apiKey?: string;
  /** Max context tokens for LLM analysis (default: 262144). */
  limitContext?: number;
  /** Max output tokens for LLM analysis (default: 65536). */
  limitOutput?: number;
  /** Retries for a failed LLM analysis (default: 2). */
  llmRetries?: number;
  /** Max wall-clock time per LLM session, in seconds (default: no limit). */
  llmMaxTime?: number;
  /** Max agent turns per LLM session (default: no limit). */
  llmMaxTurns?: number;
  /** Email-to-name mappings parsed from the `users-map` config key. */
  maps?: EmailMapEntry[];
  /** Repositories analyzed in parallel, and the shared cap on concurrent
   * LLM sessions (default: 1). */
  parallel?: number;
  /** Verbose logging. */
  verbose?: boolean;
  /** Config file the options were resolved from, when one was used. */
  configFile?: string;
}

/**
 * zod schema for the report options. `llm` defaults to `true` (LLM
 * analysis is on unless the config sets `llm: false`), and the limit
 * options hold the numeric config values directly. `configFile` is
 * internal metadata — the config file the options were resolved from —
 * never an option itself.
 *
 * @internal Exported for tests only (`src/config.test.ts`); production
 * code validates through `parseReportOptions`. Remove the tag when a
 * production importer exists.
 */
export const reportOptionsSchema = z
  .object({
    /** Repositories to analyze (normalized specs); at least one. */
    repos: z.array(repoSpecSchema).min(1, 'at least one repository is required'),
    /** Start date (author date, UTC; any git date format). */
    since: z.string().optional(),
    /** End date (author date, UTC; any git date format; default: today). */
    until: z.string().optional(),
    /** Split the range into periods of this unit (day/week/month/quarter/year). */
    unit: periodUnitSchema.optional(),
    /** Write the JSON report to this file instead of stdout. */
    output: z.string().optional(),
    /** Cache directory for cloned repos and LLM results (default: .dev-perf/cache). */
    cacheDir: z.string().optional(),
    /** Force re-clone and re-analysis even if the cache is present. */
    refresh: z.boolean().optional(),
    /** LLM analysis enabled (default: true; `llm: false` disables it). */
    llm: z.boolean().default(true),
    /** Model id, e.g. gpt-4.1. Required when LLM analysis is enabled. */
    model: z.string().optional(),
    /** OpenAI-compatible provider base URL. Required when LLM is enabled. */
    providerUrl: z.string().optional(),
    /** Provider API key. Required for LLM analysis. */
    apiKey: z.string().optional(),
    /** Max context tokens for LLM analysis (default: 262144). */
    limitContext: z.number().int().positive().default(262144),
    /** Max output tokens for LLM analysis (default: 65536). */
    limitOutput: z.number().int().positive().default(65536),
    /** Retries for a failed LLM analysis (default: 2). */
    llmRetries: z.number().int().min(0).default(2),
    /** Max wall-clock time per LLM session, in seconds (default: no
     * limit; unlimited while running — set to bound a stuck session). */
    llmMaxTime: z.number().int().positive().optional(),
    /** Max agent turns per LLM session (default: no limit; bound how
     * many agent-loop turns one session may use, across its prompts
     * and reminders). */
    llmMaxTurns: z.number().int().positive().optional(),
    /** Email-to-name mappings parsed from the `users-map` config key. */
    maps: z.array(emailMapEntrySchema).optional(),
    /** Repositories analyzed in parallel, and the shared cap on
     * concurrent LLM sessions (default: 1). */
    parallel: z.number().int().min(1).default(1),
    /** Verbose logging. */
    verbose: z.boolean().optional(),
    /** Config file the options were resolved from, when one was used. */
    configFile: z.string().optional(),
  })
  .superRefine((options, ctx) => {
    // An unbounded range cannot be split into periods: `since` must be
    // given whenever `unit` is set.
    if (options.unit !== undefined && options.since === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['since'],
        message: 'required when unit is set (an unbounded range cannot be split)',
      });
    }
    // Each email may map to only one identity; report every duplicated
    // email in one pass instead of stopping at the first.
    const seen = new Set<string>();
    for (const entry of options.maps ?? []) {
      if (seen.has(entry.email)) {
        ctx.addIssue({
          code: 'custom',
          path: ['users-map'],
          message: `email '${entry.email}' is mapped more than once`,
        });
        continue;
      }
      seen.add(entry.email);
    }
    if (!options.llm) {
      return;
    }
    if (options.model === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['model'],
        message: 'required when LLM analysis is enabled (or set llm: false)',
      });
    }
    if (options.providerUrl === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['providerUrl'],
        message: 'required when LLM analysis is enabled (or set llm: false)',
      });
    }
    if (options.apiKey === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['apiKey'],
        message: 'required when LLM analysis is enabled (or set llm: false)',
      });
    }
  });

/** Parsed and validated report options: defaults applied, limits
 * typed, LLM and period-split requirements enforced. */
export type ReportOptions = z.infer<typeof reportOptionsSchema>;

/**
 * Maps the validated config file to the report options shape: kebab-case
 * config keys become the camelCase fields of the validated shape, repos
 * come from the `repos` config key, numbers pass through typed, and the
 * `users-map` key is parsed straight into mapping entries (display names
 * pass through verbatim, so a comma in a name survives). The `maps`
 * field stays absent when no mapping was given, and the config file
 * path, when one was in effect, is recorded for the run-config dump.
 *
 * @param config - The validated config file (see `loadDevPerfConfig`);
 * empty when no file is in effect.
 * @param configFile - The config file path, when one was in effect.
 * @returns The resolved report options, ready for `parseReportOptions`.
 */
export function resolveReportOptions(
  config: DevPerfConfig = {},
  configFile?: string,
): ResolvedReportOptions {
  const maps = usersMapToEntries(config['users-map'] ?? {});
  return {
    repos: (config.repos ?? []).map(parseRepoConfigItem),
    since: config.since,
    until: config.until,
    unit: config.unit,
    output: config.output,
    cacheDir: config['cache-dir'],
    refresh: config.refresh,
    llm: config.llm,
    model: config.model,
    providerUrl: config['provider-url'],
    apiKey: config['api-key'],
    limitContext: config['limit-context'],
    limitOutput: config['limit-output'],
    llmRetries: config['llm-retries'],
    llmMaxTime: config['llm-max-time'],
    llmMaxTurns: config['llm-max-turns'],
    ...(maps.length > 0 ? { maps } : {}),
    parallel: config.parallel,
    verbose: config.verbose,
    ...(configFile === undefined ? {} : { configFile }),
  };
}

/**
 * Config key backing each report option, for error labels: the schema
 * fields are camelCase, while the values always come from the config
 * file, so a validation error names the config key
 * (`provider-url`, `users-map`, ...) — never a CLI flag.
 */
const CONFIG_KEY: Readonly<Record<string, string>> = {
  repos: 'repos',
  since: 'since',
  until: 'until',
  unit: 'unit',
  output: 'output',
  cacheDir: 'cache-dir',
  refresh: 'refresh',
  llm: 'llm',
  model: 'model',
  providerUrl: 'provider-url',
  apiKey: 'api-key',
  limitContext: 'limit-context',
  limitOutput: 'limit-output',
  llmRetries: 'llm-retries',
  llmMaxTime: 'llm-max-time',
  llmMaxTurns: 'llm-max-turns',
  maps: 'users-map',
  parallel: 'parallel',
  verbose: 'verbose',
};

/**
 * Renders an issue path as the config key the user set, e.g.
 * `providerUrl` → `provider-url`; the `repos` path renders as `repos`,
 * the `maps` field renders as `users-map` (its config key), and an
 * empty path renders as `options`. Unknown fields fall back to their
 * kebab-case name, so a config key is still named even for future
 * options.
 *
 * @param path - Issue path from a zod validation error.
 * @returns The config key for error messages.
 */
function optionKey(path: PropertyKey[]): string {
  if (path.length === 0) {
    return 'options';
  }
  const first = String(path[0]);
  const base = CONFIG_KEY[first] ?? first.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
  const rest = path
    .slice(1)
    .map((segment) => `.${String(segment)}`)
    .join('');
  return base + rest;
}

/**
 * Validates the report options (as resolved from the config file)
 * against `reportOptionsSchema` and returns the validated options with
 * defaults applied. The `maps` field is already parsed into email-name
 * pairs by `resolveReportOptions`, so the schema sees the parsed shape;
 * the parsed field stays absent when no mappings were given.
 *
 * @param input - The resolved report options.
 * @returns The validated options.
 * @throws {Error} When the options are invalid; the message lists each
 * failing option and why.
 */
export function parseReportOptions(input: unknown): ReportOptions {
  const result = reportOptionsSchema.safeParse(input ?? {});
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${optionKey(issue.path)}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid options:\n${details}`);
  }
  return result.data;
}
