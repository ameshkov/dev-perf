/**
 * Resolution and validation of the `compile` command options.
 * `resolveCompileOptions` fills options that were not passed as flags
 * from their `DEV_PERF_COMPILE_*` environment variables (the flag
 * always wins), and `parseCompileOptions` validates the merged options
 * against `compileOptionsSchema`. The cross-field rules: `--include-user`
 * and `--exclude-user` are mutually exclusive, as are `--repo` and
 * `--exclude-repo`; `--map` entries must be `email=name` pairs with a
 * unique email on the left side.
 */
import { z } from 'zod';

/**
 * Raw options as parsed by commander before validation: repeatable
 * options are arrays (commander collects them), and unset options are
 * `undefined`. The validated, defaulted shape is `CompileOptions` from
 * this module.
 */
export interface RawCompileOptions {
  /** Output directory for `report.md` and the `assets/` charts. */
  output?: string;
  /** Email-to-name mappings, one `email=name` per entry. */
  map?: string[];
  /** JSON file with email-to-name mappings (`{ "email": "Name" }`). */
  mapsFile?: string;
  /** Keep only users matching one of these names or emails. */
  includeUser?: string[];
  /** Drop users matching one of these names or emails. */
  excludeUser?: string[];
  /** Keep only these repositories (as given on the command line). */
  repo?: string[];
  /** Drop these repositories (as given on the command line). */
  excludeRepo?: string[];
  /** Verbose logging. */
  verbose?: boolean;
}

/** Environment variable backing each raw compile option. */
const OPTION_ENV: Readonly<Record<keyof RawCompileOptions, string>> = {
  output: 'DEV_PERF_COMPILE_OUTPUT',
  map: 'DEV_PERF_COMPILE_MAP',
  mapsFile: 'DEV_PERF_COMPILE_MAPS_FILE',
  includeUser: 'DEV_PERF_COMPILE_INCLUDE_USER',
  excludeUser: 'DEV_PERF_COMPILE_EXCLUDE_USER',
  repo: 'DEV_PERF_COMPILE_REPO',
  excludeRepo: 'DEV_PERF_COMPILE_EXCLUDE_REPO',
  verbose: 'DEV_PERF_VERBOSE',
};

/** Environment variable backing the positional `<report>` argument. */
const REPORT_ENV_VAR = 'DEV_PERF_COMPILE_REPORT';

/** True spellings accepted for boolean environment variables. */
const TRUE_ENV_VALUES = new Set(['1', 'true', 'yes', 'on']);

/** False spellings accepted for boolean environment variables. */
const FALSE_ENV_VALUES = new Set(['0', 'false', 'no', 'off']);

/** Raw-option keys whose environment values are booleans. */
const BOOLEAN_OPTIONS: ReadonlySet<keyof RawCompileOptions> = new Set(['verbose']);

/** Raw-option keys whose environment values are comma-separated lists. */
const LIST_OPTIONS: ReadonlySet<keyof RawCompileOptions> = new Set([
  'map',
  'includeUser',
  'excludeUser',
  'repo',
  'excludeRepo',
]);

/**
 * One email-to-name mapping entry as parsed from `--map` or the
 * environment: the lowercased email and the display name it maps to.
 */
interface EmailMapEntry {
  /** Lowercased author email. */
  email: string;
  /** Display name the email is mapped to. */
  name: string;
}

/**
 * zod schema for the parsed compile options. List options default to
 * empty arrays; `output` defaults to `dev-perf-report`.
 *
 * @internal Exported for tests only (`src/compile/options.test.ts`);
 * production code validates through `parseCompileOptions`.
 */
export const compileOptionsSchema = z
  .object({
    /** Input report file (JSON, schema v2). */
    report: z.string().min(1, 'the report file is required'),
    /** Output directory for `report.md` and the `assets/` charts. */
    output: z.string().default('dev-perf-report'),
    /** Email-to-name mappings parsed from `--map` / the environment. */
    maps: z.array(
      z.object({
        email: z.string().min(1),
        name: z.string().min(1),
      }),
    ),
    /** JSON file with email-to-name mappings. */
    mapsFile: z.string().optional(),
    /** Keep only users matching one of these names or emails. */
    includeUsers: z.array(z.string()),
    /** Drop users matching one of these names or emails. */
    excludeUsers: z.array(z.string()),
    /** Keep only these repositories. */
    repos: z.array(z.string()),
    /** Drop these repositories. */
    excludeRepos: z.array(z.string()),
    /** Verbose logging. */
    verbose: z.boolean().optional(),
  })
  .superRefine((options, ctx) => {
    // Inverting a selection is ambiguous: --include-user and
    // --exclude-user cannot be combined, and neither can --repo and
    // --exclude-repo.
    if (options.includeUsers.length > 0 && options.excludeUsers.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['excludeUser'],
        message: 'cannot be combined with --include-user; choose one selection direction',
      });
    }
    if (options.repos.length > 0 && options.excludeRepos.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['excludeRepo'],
        message: 'cannot be combined with --repo; choose one selection direction',
      });
    }
    const seen = new Set<string>();
    for (const entry of options.maps) {
      if (seen.has(entry.email)) {
        ctx.addIssue({
          code: 'custom',
          path: ['map'],
          message: `email '${entry.email}' is mapped more than once`,
        });
        break;
      }
      seen.add(entry.email);
    }
  });

/** Parsed and validated compile options: defaults applied, lists normalized. */
export type CompileOptions = z.infer<typeof compileOptionsSchema>;

/**
 * Fills raw options that were not passed as flags from their
 * `DEV_PERF_COMPILE_*` environment variables; a CLI flag always wins
 * over the environment. List variables are comma-separated, booleans
 * accept `1`/`true`/`yes`/`on` and `0`/`false`/`no`/`off`, and empty
 * values are treated as unset. `DEV_PERF_COMPILE_REPORT` supplies the
 * report file when no positional argument was given.
 *
 * @param report - The report file from the command line, if any.
 * @param raw - Raw options as parsed by commander.
 * @param env - Environment source; defaults to `process.env`. Tests
 * pass a controlled object.
 * @returns The merged raw options, ready for `parseCompileOptions`.
 * @throws {Error} When a boolean environment variable holds an
 * unrecognized value.
 */
export function resolveCompileOptions(
  report: string | undefined,
  raw: RawCompileOptions,
  env: NodeJS.ProcessEnv = process.env,
): RawCompileOptions & { report: string | undefined } {
  const merged: Record<string, unknown> = { ...raw };
  for (const key of Object.keys(OPTION_ENV) as Array<keyof RawCompileOptions>) {
    // Repeatable options default to `[]` in commander, so an empty
    // array means the flag was not passed; only a non-empty list (or
    // any value for non-list options) counts as flag-provided.
    const providedByFlag = Array.isArray(merged[key])
      ? (merged[key] as unknown[]).length > 0
      : merged[key] !== undefined;
    if (providedByFlag) {
      continue;
    }
    const value = env[OPTION_ENV[key]];
    if (value === undefined || value === '') {
      continue;
    }
    if (BOOLEAN_OPTIONS.has(key)) {
      merged[key] = parseBoolean(value, OPTION_ENV[key]);
    } else if (LIST_OPTIONS.has(key)) {
      merged[key] = splitList(value);
    } else {
      merged[key] = value;
    }
  }
  const envReport = env[REPORT_ENV_VAR];
  return {
    ...(merged as RawCompileOptions),
    report: report ?? (envReport !== undefined && envReport !== '' ? envReport : undefined),
  };
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
 * Parses a comma-separated environment list, trimming each entry and
 * dropping empty ones.
 *
 * @param value - The raw environment value.
 * @returns The list entries.
 */
function splitList(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

/**
 * Parses one `email=name` mapping entry, lowercasing the email side.
 *
 * @param entry - The raw `email=name` text.
 * @param source - Where the entry came from, for error messages.
 * @returns The parsed mapping entry.
 * @throws {Error} When the entry is not a `email=name` pair with
 * non-empty sides.
 *
 * @internal Exported for tests only (`src/compile/options.test.ts`);
 * production code parses through `parseCompileOptions`. Not part of
 * the public module API.
 */
export function parseEmailMapEntry(entry: string, source: string): EmailMapEntry {
  const separator = entry.indexOf('=');
  const email = separator === -1 ? '' : entry.slice(0, separator).trim().toLowerCase();
  const name = separator === -1 ? '' : entry.slice(separator + 1).trim();
  if (email === '' || name === '') {
    throw new Error(`Invalid options:\n${source}: expected 'email=name', got '${entry}'`);
  }
  return { email, name };
}

/**
 * Renders an issue path as the CLI flag the user would pass, e.g.
 * `includeUsers` → `--include-user`; the `report` path renders as
 * `report` (a positional argument, not a flag), and an empty path
 * renders as `options`.
 *
 * @param path - Issue path from a zod validation error.
 * @returns The flag name for error messages.
 */
function flagName(path: PropertyKey[]): string {
  if (path.length === 0) {
    return 'options';
  }
  if (path.length === 1 && path[0] === 'report') {
    return 'report';
  }
  const flag = path
    .map((segment) => String(segment).replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`))
    .join('.');
  return `--${flag}`;
}

/**
 * Normalizes one raw list option into its entries: the option is
 * repeatable, and each occurrence may carry a comma-separated list
 * (mirroring the environment-variable form); entries are trimmed and
 * empty ones are dropped, so an empty or whitespace-only occurrence
 * contributes nothing.
 *
 * @param entries - The raw occurrences of the option.
 * @returns The non-empty list entries.
 */
function normalizeList(entries: string[] | undefined): string[] {
  return (entries ?? []).flatMap((entry) => splitList(entry));
}

/**
 * Validates raw compile options (as parsed by commander) against
 * `compileOptionsSchema` and returns the validated options with
 * defaults applied. The raw list options (`map`, `includeUser`,
 * `excludeUser`, `repo`, `excludeRepo`) are normalized to the schema's
 * plural field names — each occurrence is split on commas, trimmed,
 * and emptied entries are dropped, so `--exclude-user ""` or `--map
 * ""` select nothing — and `--map` entries are parsed into email-name
 * pairs, so the schema sees the parsed shape. An empty `--output`
 * falls back to the `dev-perf-report` default.
 *
 * @param input - Raw options, including the `report` file.
 * @returns The validated options.
 * @throws {Error} When the options are invalid; the message lists each
 * failing option and why.
 */
export function parseCompileOptions(input: unknown): CompileOptions {
  const raw = input as RawCompileOptions & { report: string | undefined };
  if (raw.report === undefined || raw.report === '') {
    throw new Error('Invalid options:\nreport: the report file is required');
  }
  const maps = normalizeList(raw.map).map((entry) => parseEmailMapEntry(entry, '--map'));
  const normalized = {
    ...raw,
    maps,
    output: raw.output === undefined || raw.output.trim() === '' ? undefined : raw.output,
    includeUsers: normalizeList(raw.includeUser),
    excludeUsers: normalizeList(raw.excludeUser),
    repos: normalizeList(raw.repo),
    excludeRepos: normalizeList(raw.excludeRepo),
  };
  const result = compileOptionsSchema.safeParse(normalized);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${flagName(issue.path)}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid options:\n${details}`);
  }
  return result.data;
}
