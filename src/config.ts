/**
 * Resolution and validation of the parsed CLI options. `resolveRawOptions`
 * fills options that were not passed as flags from their `DEV_PERF_*`
 * environment variables (the flag always wins), and `parseCliOptions`
 * validates the merged options against `cliOptionsSchema`. The
 * cross-field rules: when LLM analysis is enabled, `model`,
 * `providerUrl` and `apiKey` are required; `--since` is required when
 * `--unit` is set (an unbounded range cannot be split into periods).
 * `limitContext` / `limitOutput` are positive integers with the
 * defaults 262144 / 65536.
 */
import { z } from 'zod';
import { periodUnitSchema } from './report/index.js';

/**
 * Raw options as parsed by commander before validation: limit options
 * are strings, and unset options are `undefined`. The validated,
 * defaulted shape is `CliOptions` from this module.
 */
export interface RawCliOptions {
  /** Start date (author date, UTC; any git date format). */
  since?: string;
  /** End date (author date, UTC; any git date format; default: today). */
  until?: string;
  /** Split the range into periods of this unit (day/week/month/quarter/year). */
  unit?: string;
  /** Write the JSON report to this file instead of stdout. */
  output?: string;
  /** Cache directory for cloned repos and LLM results (default: .dev-perf/cache). */
  cacheDir?: string;
  /** Force re-clone and re-analysis even if the cache is present. */
  refresh?: boolean;
  /** LLM analysis enabled (default: true; `--no-llm` disables it). */
  llm?: boolean;
  /** Model id, e.g. gpt-4.1. Required when LLM analysis is enabled. */
  model?: string;
  /** OpenAI-compatible provider base URL. Required when LLM is enabled. */
  providerUrl?: string;
  /** Provider API key; `DEV_PERF_API_KEY` is an alternative. Required for LLM. */
  apiKey?: string;
  /** Max context tokens for LLM analysis (default: 262144). */
  limitContext?: string;
  /** Max output tokens for LLM analysis (default: 65536). */
  limitOutput?: string;
  /** Retries for a failed LLM analysis (default: 2). */
  llmRetries?: string;
  /** Analyze up to this many repositories in parallel (default: 1). */
  parallel?: string;
  /** Verbose logging. */
  verbose?: boolean;
}

/**
 * Environment variable backing each raw option. `DEV_PERF_NO_LLM`
 * backs `llm` with inverted meaning: `true` disables LLM analysis,
 * like `--no-llm`.
 */
const OPTION_ENV: Readonly<Record<keyof RawCliOptions, string>> = {
  since: 'DEV_PERF_SINCE',
  until: 'DEV_PERF_UNTIL',
  unit: 'DEV_PERF_UNIT',
  output: 'DEV_PERF_OUTPUT',
  cacheDir: 'DEV_PERF_CACHE_DIR',
  refresh: 'DEV_PERF_REFRESH',
  llm: 'DEV_PERF_NO_LLM',
  model: 'DEV_PERF_MODEL',
  providerUrl: 'DEV_PERF_PROVIDER_URL',
  apiKey: 'DEV_PERF_API_KEY',
  limitContext: 'DEV_PERF_LIMIT_CONTEXT',
  limitOutput: 'DEV_PERF_LIMIT_OUTPUT',
  llmRetries: 'DEV_PERF_LLM_RETRIES',
  parallel: 'DEV_PERF_PARALLEL',
  verbose: 'DEV_PERF_VERBOSE',
};

/** Environment variable accepted as an alternative to `--api-key`. */
const API_KEY_ENV_VAR = OPTION_ENV.apiKey;

/** Environment variable backing the positional `<repo...>` argument. */
const REPOS_ENV_VAR = 'DEV_PERF_REPOS';

/** True spellings accepted for boolean environment variables. */
const TRUE_ENV_VALUES = new Set(['1', 'true', 'yes', 'on']);

/** False spellings accepted for boolean environment variables. */
const FALSE_ENV_VALUES = new Set(['0', 'false', 'no', 'off']);

/** Raw-option keys whose environment values are booleans. */
const BOOLEAN_OPTIONS: ReadonlySet<keyof RawCliOptions> = new Set(['refresh', 'llm', 'verbose']);

/**
 * zod schema for the parsed CLI options. `llm` defaults to `true`
 * (LLM analysis is on unless `--no-llm` is passed), and the limit
 * options are coerced from the string values commander produces.
 *
 * @internal Exported for tests only (`src/config.test.ts`); production
 * code validates through `parseCliOptions`. Remove the tag when a
 * production importer exists.
 */
export const cliOptionsSchema = z
  .object({
    /** Repositories to analyze (URLs or local paths); at least one. */
    repos: z.array(z.string()).min(1, 'at least one repository is required'),
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
    /** LLM analysis enabled (default: true; `--no-llm` disables it). */
    llm: z.boolean().default(true),
    /** Model id, e.g. gpt-4.1. Required when LLM analysis is enabled. */
    model: z.string().optional(),
    /** OpenAI-compatible provider base URL. Required when LLM is enabled. */
    providerUrl: z.string().optional(),
    /** Provider API key; DEV_PERF_API_KEY is an alternative. Required for LLM. */
    apiKey: z.string().optional(),
    /** Max context tokens for LLM analysis (default: 262144). */
    limitContext: z.coerce.number().int().positive().default(262144),
    /** Max output tokens for LLM analysis (default: 65536). */
    limitOutput: z.coerce.number().int().positive().default(65536),
    /** Retries for a failed LLM analysis (default: 2). */
    llmRetries: z.coerce.number().int().min(0).default(2),
    /** Analyze up to this many repositories in parallel (default: 1). */
    parallel: z.coerce.number().int().min(1).default(1),
    /** Verbose logging. */
    verbose: z.boolean().optional(),
  })
  .superRefine((options, ctx) => {
    // An unbounded range cannot be split into periods: --since must be
    // given whenever --unit is set.
    if (options.unit !== undefined && options.since === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['since'],
        message: 'required when --unit is set (an unbounded range cannot be split)',
      });
    }
    if (!options.llm) {
      return;
    }
    if (options.model === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['model'],
        message: 'required when LLM analysis is enabled (or pass --no-llm)',
      });
    }
    if (options.providerUrl === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['providerUrl'],
        message: 'required when LLM analysis is enabled (or pass --no-llm)',
      });
    }
    if (options.apiKey === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['apiKey'],
        message: `required when LLM analysis is enabled (or set ${API_KEY_ENV_VAR})`,
      });
    }
  });

/**
 * Parsed and validated CLI options: defaults applied, limits coerced
 * to numbers, LLM and period-split requirements enforced.
 */
export type CliOptions = z.infer<typeof cliOptionsSchema>;

/**
 * Fills raw options that were not passed as flags from their
 * `DEV_PERF_*` environment variables; a CLI flag always wins over the
 * environment. Boolean options (`refresh`, `llm`, `verbose`) accept
 * `1`/`true`/`yes`/`on` for on and `0`/`false`/`no`/`off` for off;
 * empty values are treated as unset.
 *
 * @param raw - Raw options as parsed by commander.
 * @param env - Environment source; defaults to `process.env`. Tests
 * pass a controlled object.
 * @returns The merged raw options.
 * @throws {Error} When a boolean environment variable holds an
 * unrecognized value.
 */
function applyEnvOptions(raw: RawCliOptions, env: NodeJS.ProcessEnv = process.env): RawCliOptions {
  const merged: Record<string, unknown> = { ...raw };
  for (const key of Object.keys(OPTION_ENV) as Array<keyof RawCliOptions>) {
    // `--no-llm` is a negated commander flag, so `llm` is `true` by
    // default even when the flag was not passed; only an explicit
    // `false` (the flag itself) counts as flag-provided.
    const providedByFlag = key === 'llm' ? merged.llm === false : merged[key] !== undefined;
    if (providedByFlag) {
      continue;
    }
    const value = env[OPTION_ENV[key]];
    if (value === undefined || value === '') {
      continue;
    }
    merged[key] = BOOLEAN_OPTIONS.has(key) ? booleanValue(key, value, OPTION_ENV[key]) : value;
  }
  return merged as RawCliOptions;
}

/**
 * Parses one boolean environment value for an option. `DEV_PERF_NO_LLM`
 * backs `llm` with inverted meaning: `true` disables LLM analysis,
 * like `--no-llm`.
 *
 * @param key - The option the value belongs to.
 * @param value - The raw environment value.
 * @param envVar - The variable name, for error messages.
 * @returns The parsed boolean.
 * @throws {Error} When the value is not a recognized boolean spelling.
 */
function booleanValue(key: keyof RawCliOptions, value: string, envVar: string): boolean {
  const parsed = parseBoolean(value, envVar);
  return key === 'llm' ? !parsed : parsed;
}

/**
 * Parses a boolean environment value: `1`/`true`/`yes`/`on` are true,
 * `0`/`false`/`no`/`off` are false.
 *
 * @param value - The raw environment value.
 * @param envVar - The variable name, for error messages.
 * @returns The parsed boolean.
 * @throws {Error} When the value is not a recognized boolean spelling.
 */
function parseBoolean(value: string, envVar: string): boolean {
  const normalized = value.toLowerCase();
  if (TRUE_ENV_VALUES.has(normalized)) {
    return true;
  }
  if (FALSE_ENV_VALUES.has(normalized)) {
    return false;
  }
  throw new Error(
    `Invalid options:\n${envVar}: expected a boolean ('true' or 'false'), got '${value}'`,
  );
}

/**
 * Parses `DEV_PERF_REPOS`: a comma-separated repository list with each
 * entry trimmed; `undefined` when the variable is unset or empty.
 *
 * @param env - Environment source.
 * @returns The repositories, or `undefined`.
 */
function envRepos(env: NodeJS.ProcessEnv): string[] | undefined {
  const value = env[REPOS_ENV_VAR];
  if (value === undefined || value.trim() === '') {
    return undefined;
  }
  return value
    .split(',')
    .map((repo) => repo.trim())
    .filter((repo) => repo !== '');
}

/**
 * Resolves the raw options for validation: environment variables fill
 * every option whose flag was not passed, and `DEV_PERF_REPOS`
 * supplies the repositories when no positional arguments were given.
 *
 * @param repos - Repositories passed on the command line.
 * @param options - Raw commander options for this invocation.
 * @param env - Environment source; defaults to `process.env`. Tests
 * pass a controlled object.
 * @returns The merged raw options, ready for `parseCliOptions`.
 * @throws {Error} When a boolean environment variable holds an
 * unrecognized value.
 */
export function resolveRawOptions(
  repos: string[],
  options: RawCliOptions,
  env: NodeJS.ProcessEnv = process.env,
): RawCliOptions & { repos: string[] } {
  return {
    ...applyEnvOptions(options, env),
    repos: repos.length > 0 ? repos : (envRepos(env) ?? []),
  };
}

/**
 * Renders an issue path as the CLI flag the user would pass, e.g.
 * `limitContext` → `--limit-context`; the `repos` path renders as
 * `repos` (a positional argument, not a flag), and an empty path
 * renders as `options`.
 *
 * @param path - Issue path from a zod validation error.
 * @returns The flag name for error messages.
 */
function flagName(path: PropertyKey[]): string {
  if (path.length === 0) {
    return 'options';
  }
  if (path.length === 1 && path[0] === 'repos') {
    return 'repos';
  }
  const flag = path
    .map((segment) => String(segment).replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`))
    .join('.');
  return `--${flag}`;
}

/**
 * Validates raw CLI options (as parsed by commander) against
 * `cliOptionsSchema` and returns the validated options with defaults
 * applied.
 *
 * @param input - Raw options, including the `repos` list.
 * @returns The validated options.
 * @throws {Error} When the options are invalid; the message lists each
 * failing option and why.
 */
export function parseCliOptions(input: unknown): CliOptions {
  const result = cliOptionsSchema.safeParse(input);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${flagName(issue.path)}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid options:\n${details}`);
  }
  return result.data;
}
