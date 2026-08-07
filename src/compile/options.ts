/**
 * Resolution and validation of the `compile` command options from the
 * YAML config file. `resolveCompileOptions` maps the config keys —
 * top-level `repos`, `users-map`, `verbose` and the nested `compile`
 * section (`compile.report`, `compile.output`, `compile.include-users`,
 * `compile.exclude-users`, `compile.exclude-repos`) — to the camelCase
 * validated shape, and `parseCompileOptions` validates them against
 * `compileOptionsSchema`. The config file is the single source of
 * options — the CLI carries no flags beyond `--config`. The cross-field
 * rules: `include-users` and `exclude-users` are mutually exclusive, as
 * are `repos` and `exclude-repos`; each email may map to only one
 * display name. Error labels always name the config key the value came
 * from (`compile.report`, `compile.include-users`, `users-map`, ...).
 */
import { z } from 'zod';
import type { DevPerfConfig } from '../config-file.js';
import { parseRepoSpec } from '../repo/repo-spec.js';
import { emailMapEntrySchema, usersMapToEntries } from '../util/email-map.js';
import type { EmailMapEntry } from '../util/email-map.js';

/**
 * The compile options as resolved from the config file before
 * validation: optional config keys mapped to the camelCase fields of
 * the validated shape. The config file is the only source of options,
 * so this is the input to `parseCompileOptions`.
 */
interface RawCompileOptions {
  /** Input JSON report file (`compile.report`). */
  report?: string;
  /** Output directory for `report.md` and the `assets/` charts (`compile.output`). */
  output?: string;
  /** Email-to-name mappings parsed from the `users-map` config key. */
  maps?: EmailMapEntry[];
  /** Keep only these users (`compile.include-users`). */
  includeUsers?: string[];
  /** Drop these users (`compile.exclude-users`). */
  excludeUsers?: string[];
  /** Keep only these repositories (the top-level `repos` key). */
  repos?: string[];
  /** Drop these repositories (`compile.exclude-repos`). */
  excludeRepos?: string[];
  /** Verbose logging (the top-level `verbose` key). */
  verbose?: boolean;
}

/**
 * Config key path backing each compile option, for error labels: the
 * schema fields are camelCase, while the values always come from the
 * config file, so a validation error names the config key
 * (`compile.include-users`, `users-map`, ...) — never a flag.
 */
const CONFIG_KEY: Readonly<Record<string, string>> = {
  report: 'compile.report',
  output: 'compile.output',
  maps: 'users-map',
  includeUsers: 'compile.include-users',
  excludeUsers: 'compile.exclude-users',
  repos: 'repos',
  excludeRepos: 'compile.exclude-repos',
  verbose: 'verbose',
};

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
    /** Email-to-name mappings parsed from the `users-map` config key. */
    maps: z.array(emailMapEntrySchema),
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
    // Inverting a selection is ambiguous: `include-users` and
    // `exclude-users` cannot be combined, and neither can `repos` and
    // `exclude-repos`.
    if (options.includeUsers.length > 0 && options.excludeUsers.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['excludeUsers'],
        message: 'cannot be combined with compile.include-users; choose one selection direction',
      });
    }
    if (options.repos.length > 0 && options.excludeRepos.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['excludeRepos'],
        message: 'cannot be combined with repos; choose one selection direction',
      });
    }
    // Each email may map to only one identity; report every duplicated
    // email in one pass instead of stopping at the first.
    const seen = new Set<string>();
    for (const entry of options.maps) {
      if (seen.has(entry.email)) {
        ctx.addIssue({
          code: 'custom',
          path: ['maps'],
          message: `email '${entry.email}' is mapped more than once`,
        });
        continue;
      }
      seen.add(entry.email);
    }
  });

/** Parsed and validated compile options: defaults applied, lists normalized. */
export type CompileOptions = z.infer<typeof compileOptionsSchema>;

/**
 * Maps the validated config file to the compile options shape: the
 * input report comes from `compile.report`, the output directory from
 * `compile.output`, the user and repository selections from the `compile`
 * section and the top-level `repos` key, and the `users-map` config key
 * is parsed straight into mapping entries (display names pass through
 * verbatim, so a comma in a name survives). The `maps` field stays
 * absent when no mapping was given.
 *
 * @param config - The validated config file (see `loadDevPerfConfig`);
 * empty when no file is in effect.
 * @returns The resolved compile options, ready for `parseCompileOptions`.
 */
export function resolveCompileOptions(config: DevPerfConfig = {}): RawCompileOptions {
  const maps = usersMapToEntries(config['users-map'] ?? {});
  return {
    report: config.compile?.report,
    output: config.compile?.output,
    ...(maps.length > 0 ? { maps } : {}),
    includeUsers: config.compile?.['include-users'],
    excludeUsers: config.compile?.['exclude-users'],
    repos: cleanRepos(config.repos),
    excludeRepos: cleanRepos(config.compile?.['exclude-repos']),
    verbose: config.verbose,
  };
}

/**
 * Renders an issue path as the config key the user set, e.g.
 * `includeUsers` → `compile.include-users`, `maps` → `users-map`; an
 * empty path renders as `options`.
 *
 * @param path - Issue path from a zod validation error.
 * @returns The config key for error messages.
 */
function configKeyName(path: PropertyKey[]): string {
  if (path.length === 0) {
    return 'options';
  }
  const first = String(path[0]);
  const base = CONFIG_KEY[first] ?? first;
  const rest = path
    .slice(1)
    .map((segment) => `.${String(segment)}`)
    .join('');
  return base + rest;
}

/**
 * Normalizes one config list option into its entries: entries are
 * trimmed and empty ones are dropped, so an empty or whitespace-only
 * list item selects nothing. (The config uses YAML lists, so there is
 * no comma-splitting.) The normalized schema lists are always arrays.
 *
 * @param entries - The raw config list, if any.
 * @returns The non-empty list entries.
 */
function cleanList(entries: string[] | undefined): string[] {
  return (entries ?? []).map((entry) => entry.trim()).filter((entry) => entry !== '');
}

/**
 * Strips the `#branch` suffix off each repository entry: the report
 * entries carry the bare clone target (a `#branch` suffix was already
 * split off by `parseRepoSpec` when the report was produced), so the
 * repo selection must match those bare targets. Without this, a
 * branch-qualified entry like `https://host/org/repo.git#dev` would
 * never match and silently drop every repository from the compiled
 * output.
 *
 * @param entries - The raw config repo list, if any.
 * @returns The bare clone targets, `#branch` suffixes removed; absent
 * when the config key was absent.
 */
function cleanRepos(entries: string[] | undefined): string[] | undefined {
  return entries?.map((spec) => parseRepoSpec(spec).repo);
}

/**
 * Validates compile options (as resolved from the config file) against
 * `compileOptionsSchema` and returns the validated options with
 * defaults applied. The config list options are normalized to
 * non-empty trimmed entries, an empty `output` falls back to the
 * `dev-perf-report` default, and the `maps` entries (already parsed by
 * `resolveCompileOptions`) are validated against the mapping schema.
 * The config file is the single source, so every error names the config
 * key the value came from.
 *
 * @param input - The resolved compile options.
 * @returns The validated options.
 * @throws {Error} When the options are invalid; the message lists each
 * failing option and why, naming the config key.
 */
export function parseCompileOptions(input: unknown): CompileOptions {
  const raw = (input ?? {}) as Partial<RawCompileOptions>;
  if (raw.report === undefined || raw.report === '') {
    throw new Error('Invalid options:\ncompile.report: the report file is required');
  }
  const normalized = {
    ...raw,
    maps: raw.maps ?? [],
    output: raw.output === undefined || raw.output.trim() === '' ? undefined : raw.output,
    includeUsers: cleanList(raw.includeUsers),
    excludeUsers: cleanList(raw.excludeUsers),
    repos: cleanList(raw.repos),
    excludeRepos: cleanList(raw.excludeRepos),
  };
  const result = compileOptionsSchema.safeParse(normalized);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${configKeyName(issue.path)}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid options:\n${details}`);
  }
  return result.data;
}
