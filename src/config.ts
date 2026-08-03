/**
 * Validation of the parsed CLI options (docs/design.md §3). The
 * cross-field rule: when LLM analysis is enabled, `model`,
 * `providerUrl` and `apiKey` are required — the API key may come from
 * the `DEV_PERF_API_KEY` environment variable instead of `--api-key`.
 * `limitContext` / `limitOutput` are positive integers with the design
 * defaults (262144 / 65536).
 */
import { z } from 'zod';

/** Environment variable accepted as an alternative to `--api-key`. */
const API_KEY_ENV_VAR = 'DEV_PERF_API_KEY';

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
    /** Verbose logging. */
    verbose: z.boolean().optional(),
  })
  .superRefine((options, ctx) => {
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
    if (!options.apiKey && process.env[API_KEY_ENV_VAR] === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['apiKey'],
        message: `required when LLM analysis is enabled (or set ${API_KEY_ENV_VAR})`,
      });
    }
  });

/**
 * Parsed and validated CLI options: defaults applied, limits coerced
 * to numbers, LLM requirements enforced.
 */
export type CliOptions = z.infer<typeof cliOptionsSchema>;

/**
 * Renders an issue path as the CLI flag the user would pass, e.g.
 * `limitContext` → `--limit-context`; an empty path renders as
 * `options`.
 *
 * @param path - Issue path from a zod validation error.
 * @returns The flag name for error messages.
 */
function flagName(path: PropertyKey[]): string {
  if (path.length === 0) {
    return 'options';
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
