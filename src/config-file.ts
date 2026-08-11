/**
 * YAML configuration file support shared by the `report` and `compile`
 * commands: `resolveConfigPath` locates the file (the `--config`
 * value, else `<cwd>/config.yaml` when it exists), and
 * `loadDevPerfConfig` reads it, expands `${ENV_VAR}` references,
 * parses and validates it against `configFileSchema`. The
 * `DEV_PERF_*` variables are no longer option sources; `.env` remains
 * only as the source for `${ENV_VAR}` expansion inside the config (so
 * secrets stay out of version control). A substituted value must not
 * contain `#` or a newline — either would change the YAML structure —
 * and such values are rejected loudly instead of silently corrupting
 * the parsed config.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { repoEntryFields } from './repo/repo-spec.js';
import type { RepoConfigEntry } from './repo/repo-spec.js';
import { errorDetail } from './util/error.js';

/** Config file auto-loaded from the working directory when it exists. */
const AUTO_CONFIG_FILE = 'config.yaml';

/** Matches every `${ENV_VAR}` reference expanded before YAML parsing. */
const ENV_REFERENCE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/**
 * A structured `repos` config entry: the bare clone target plus an
 * optional branch to analyze, an optional `base-branch` the analysis is
 * scoped against (branch-delta), gitignore-style paths to exclude, and
 * the commits to exclude (`ignore-commits`, by hash and/or message
 * pattern) for that repository alone. Unknown keys are rejected. The
 * field validations come from `repoEntryFields` — the same constraints
 * the spec schema uses, so the config-file validation and spec
 * normalization can never drift — with the kebab `base-branch` /
 * `ignore-commits` keys renamed to the schema's camelCase `base` /
 * `ignoreCommits` before validation. The rename happens in a
 * `preprocess` (not a `transform`), so the schema stays a plain object
 * and a field-level rejection keeps its precise error path
 * (`repos.0.repo: …`) inside the union; an unknown-key rejection still
 * collapses to `repos.0: Invalid input` in the union.
 */
const repoConfigEntrySchema: z.ZodType<RepoConfigEntry, unknown> = z.preprocess((value) => {
  // Rename the kebab `base-branch` / `ignore-commits` keys to the
  // schema's camelCase `base` / `ignoreCommits`; everything else passes
  // through. A non-object value (the union's string arm) is returned
  // unchanged.
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  const {
    'base-branch': base,
    base: camelBase,
    'ignore-commits': ignoreCommits,
    ignoreCommits: camelIgnoreCommits,
    ...rest
  } = value as Record<string, unknown>;
  // Only the kebab forms are config keys. The camelCase `base` /
  // `ignoreCommits` are the shared spec fields' names: they would
  // otherwise slip past `.strict()` and be silently discarded when both
  // keys are set. Reroute them to names the strict schema does not know
  // so the entry is rejected loudly instead of accepted as the kebab
  // form.
  return {
    ...rest,
    ...(base === undefined ? {} : { base }),
    ...(camelBase === undefined ? {} : { baseCamel: camelBase }),
    ...(ignoreCommits === undefined ? {} : { ignoreCommits }),
    ...(camelIgnoreCommits === undefined ? {} : { ignoreCommitsCamel: camelIgnoreCommits }),
  };
}, z.object(repoEntryFields).strict());

/**
 * The `compile`-only keys under the nested `compile` section of the
 * config file; the shared top-level keys (`repos`, `users-map`,
 * `verbose`) also apply to `compile`, but the input report, output and
 * the user and repository selection are `compile` alone. Keys are
 * kebab-case; unknown keys are rejected.
 */
const compileConfigSchema = z
  .object({
    /** Input JSON report file (schema v2, as written by `report`). */
    report: z.string().optional(),
    /** Markdown report output directory. */
    output: z.string().optional(),
    /** Keep only these users. */
    'include-users': z.array(z.string()).optional(),
    /** Drop these users. */
    'exclude-users': z.array(z.string()).optional(),
    /** Drop these repositories. */
    'exclude-repos': z.array(z.string()).optional(),
  })
  .strict();

/**
 * The config file schema: shared top-level keys read by both `report`
 * and `compile` (`repos`, `users-map`, `verbose`), report-only keys
 * (`since`, `until`, `unit`, `output`, `cache-dir`, `refresh`, `llm`,
 * `model`, `provider-url`, `api-key`, the `limit-*` keys,
 * `llm-retries`, the `llm-max-*` keys, `parallel`), and the nested
 * `compile` section with `compile`-only keys (`report`, `output`,
 * `include-users`, `exclude-users`, `exclude-repos`). Keys are
 * kebab-case; numeric keys hold YAML numbers and boolean keys hold
 * YAML booleans, so the values flow straight into the option schemas.
 * Unknown keys are rejected.
 *
 * @internal Exported for tests only (`src/config-file.test.ts`);
 * production code validates through `loadDevPerfConfig` and types
 * through `DevPerfConfig`. Not part of the public module API.
 */
const configFileSchema = z
  .object({
    /** Repositories to analyze when none are passed on the command line;
     * each entry is a URL/path string or a map with an optional branch
     * and ignored paths. */
    repos: z.array(z.union([z.string(), repoConfigEntrySchema])).optional(),
    /** Start date (author date, UTC; any git date format). */
    since: z.string().optional(),
    /** End date (author date, UTC; any git date format). */
    until: z.string().optional(),
    /** Period unit (day/week/month/quarter/year). */
    unit: z.string().optional(),
    /** Report JSON output file. */
    output: z.string().optional(),
    /** Cache directory for cloned repos and LLM results. */
    'cache-dir': z.string().optional(),
    /** Force re-clone and re-analysis. */
    refresh: z.boolean().optional(),
    /** LLM analysis enabled. */
    llm: z.boolean().optional(),
    /** Model id, required for LLM analysis. */
    model: z.string().optional(),
    /** OpenAI-compatible provider base URL. */
    'provider-url': z.string().optional(),
    /** Provider API key; usually a `${ENV_VAR}` reference. */
    'api-key': z.string().optional(),
    /** Max context tokens for LLM analysis. */
    'limit-context': z.number().optional(),
    /** Max output tokens for LLM analysis. */
    'limit-output': z.number().optional(),
    /** Retries for a failed LLM analysis. */
    'llm-retries': z.number().optional(),
    /** Max wall-clock time per LLM session, in seconds (0 or absent:
     * no limit). */
    'llm-max-time': z.number().optional(),
    /** Max agent turns per LLM session (0 or absent: no limit). */
    'llm-max-turns': z.number().optional(),
    /** Email-to-name mappings (email to display name), merging identities. */
    'users-map': z.record(z.string(), z.string()).optional(),
    /** Repositories analyzed in parallel, and the shared cap on
     * concurrent LLM sessions. */
    parallel: z.number().optional(),
    /** Verbose logging. */
    verbose: z.boolean().optional(),
    /** `compile`-only keys. */
    compile: compileConfigSchema.optional(),
  })
  .strict()
  .superRefine((config, ctx) => {
    // A mapping needs a non-empty email and display name; report each
    // empty side under the `users-map` key.
    for (const [email, name] of Object.entries(config['users-map'] ?? {})) {
      if (email.trim() === '' || name.trim() === '') {
        ctx.addIssue({
          code: 'custom',
          path: ['users-map', email === '' ? '<empty email>' : email],
          message: `non-empty email and name are required, got '${email}' -> '${name}'`,
        });
      }
    }
  });

/** The validated config file: kebab-case keys, all optional. */
export type DevPerfConfig = z.infer<typeof configFileSchema>;

/**
 * Locates the config file for a command invocation: the `--config`
 * value when given, else `<cwd>/config.yaml` when it exists, else
 * `undefined` (no config file). An explicit `--config` path is never
 * second-guessed here — `loadDevPerfConfig` reports a missing file as
 * a hard error. An empty or whitespace-only `--config` value counts as
 * "no config", so it cannot bypass the `config.yaml` autoload and end
 * in a confusing `readFile('')` error.
 *
 * @param cliValue - The `--config` value, if any.
 * @param cwd - The working directory to look for `config.yaml` in;
 * defaults to `process.cwd()`. Tests pass a controlled directory.
 * @returns The config file path, or `undefined` when there is none.
 *
 * @internal Exported for tests only (`src/config-file.test.ts`);
 * production code resolves through `resolveDevPerfConfig`. Not part of
 * the public module API.
 */
export function resolveConfigPath(
  cliValue: string | undefined,
  cwd: string = process.cwd(),
): string | undefined {
  if (cliValue !== undefined && cliValue.trim() !== '') {
    return cliValue;
  }
  const autoLoaded = path.join(cwd, AUTO_CONFIG_FILE);
  return existsSync(autoLoaded) ? autoLoaded : undefined;
}

/**
 * Loads and validates the config file: reads the file, expands every
 * `${ENV_VAR}` reference (erroring out on an unset or empty variable,
 * naming the variable and the file), parses the YAML, and validates it
 * against `configFileSchema`. Returns an empty object when no file is
 * given. Expansion happens on the raw text before parsing, so
 * `refresh: ${DEV_PERF_REFRESH}` with a `"true"` value parses as a
 * YAML boolean, and a substituted value containing `#` or a newline is
 * rejected loudly (either would change the YAML structure).
 *
 * @param file - The config file path, when one is resolved; `undefined`
 * when no config file is in effect.
 * @param env - Environment source; defaults to `process.env`. Tests
 * pass a controlled object.
 * @returns The validated config, keyed by kebab-case config keys.
 * @throws {Error} When the file is missing or unreadable, a
 * `${ENV_VAR}` reference is unset or empty or holds `#`/newline, the
 * YAML does not parse, or a key or value is rejected by the schema;
 * every message names the file.
 *
 * @internal Exported for tests only (`src/config-file.test.ts`);
 * production code loads through `resolveDevPerfConfig`. Not part of
 * the public module API.
 */
export async function loadDevPerfConfig(
  file: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Promise<DevPerfConfig> {
  if (file === undefined) {
    return {};
  }
  const text = await readConfigText(file);
  const expanded = expandEnvReferences(text, file, env);
  let parsed: unknown;
  try {
    parsed = parseYaml(expanded);
  } catch (error) {
    throw new Error(`Invalid config file (${file}):\n${errorDetail(error)}`, { cause: error });
  }
  const result = configFileSchema.safeParse(parsed ?? {});
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${configKeyPath(issue.path) || '$'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid config file (${file}):\n${details}`);
  }
  return result.data;
}

/**
 * Renders a validation issue path as the config keys the user set: each
 * field segment is kebab-cased, so a nested repo field like
 * `ignoreCommits.messages` — the schema's camelCase name, after the
 * `repoConfigEntrySchema` preprocess renamed the kebab `ignore-commits`
 * key — renders as the config key `ignore-commits.messages`. Numeric
 * segments (list indexes) pass through unchanged.
 *
 * @param path - The zod issue path.
 * @returns The config key path.
 */
function configKeyPath(path: PropertyKey[]): string {
  return path
    .map((segment) => (typeof segment === 'number' ? String(segment) : kebabCase(String(segment))))
    .join('.');
}

/**
 * Renders a camelCase name as its kebab-case config key
 * (`ignoreCommits` → `ignore-commits`); a name with no capitals is
 * returned unchanged.
 *
 * @param name - The camelCase field name.
 * @returns The kebab-case config key.
 */
function kebabCase(name: string): string {
  return name.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
}

/**
 * Resolves and loads the config file for a command invocation: the
 * `--config` value, else `<cwd>/config.yaml` when it exists. Both
 * command actions (`report`, `compile`) share this one code path, so
 * path resolution, `${ENV_VAR}` expansion, and validation stay in sync
 * — and the resolved path is returned alongside the config, for the
 * run-config dump.
 *
 * @param cliValue - The `--config` value, if any.
 * @param env - Environment source for `${ENV_VAR}` expansion; defaults
 * to `process.env`. Tests pass a controlled object.
 * @returns The validated config (empty when no file is in effect) and
 * the resolved config file path, when one was in effect.
 */
export async function resolveDevPerfConfig(
  cliValue: string | undefined,
  env?: NodeJS.ProcessEnv,
): Promise<{ config: DevPerfConfig; configPath: string | undefined }> {
  const configPath = resolveConfigPath(cliValue);
  const config = await loadDevPerfConfig(configPath, env);
  return { config, configPath };
}

/**
 * Reads the config file, wrapping a missing or unreadable file in a
 * clear error naming the path.
 *
 * @param file - The config file path.
 * @returns The file contents.
 * @throws {Error} When the file cannot be read; names the file.
 */
async function readConfigText(file: string): Promise<string> {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    throw new Error(`config file not found or unreadable: "${file}"`, { cause: error });
  }
}

/**
 * Replaces every `${ENV_VAR}` reference in the config text with the
 * environment value, erroring out when the variable is unset or empty.
 * Substituted values must not contain characters that would change the
 * YAML structure: a `#` starts a YAML comment (truncating the value,
 * which for a secret would silently corrupt it) and a newline can
 * inject extra keys. Such values are rejected loudly instead of
 * producing a wrong or truncated config. Because expansion runs over
 * the raw text, references inside comments or already-quoted scalars
 * are still expanded — keep `${ENV_VAR}` references to value
 * positions.
 *
 * @param text - The raw config text.
 * @param file - The config file path, for error messages.
 * @param env - Environment source.
 * @returns The expanded text, ready for YAML parsing.
 * @throws {Error} When a referenced variable is unset or empty, or
 * holds a value containing `#` or a newline; names the variable and
 * the file.
 */
function expandEnvReferences(text: string, file: string, env: NodeJS.ProcessEnv): string {
  return text.replace(ENV_REFERENCE, (reference, name: string) => {
    const value = env[name];
    if (value === undefined || value.trim() === '') {
      throw new Error(`Invalid config file (${file}):\n${name}: ${reference} is unset or empty`);
    }
    assertSafeEnvValue(value, name, reference, file);
    return value;
  });
}

/**
 * Asserts that an environment value substituted into the config will
 * not change the YAML structure: it must not contain a `#` (which
 * starts a YAML comment and truncates the value) or a newline (which
 * can inject extra keys). These two characters would silently corrupt
 * the parsed config, so they are rejected loudly. The guard is a basic
 * check on purpose — environment values are under the user's control,
 * and any other value shape surfaces as a loud YAML parse or schema
 * validation error instead of silent data loss.
 *
 * @param value - The environment value being substituted.
 * @param name - The referenced variable name, for error messages.
 * @param reference - The `${ENV_VAR}` reference text, for error messages.
 * @param file - The config file path, for error messages.
 * @throws {Error} When the value contains `#` or a newline; names the
 * variable and the file.
 */
function assertSafeEnvValue(value: string, name: string, reference: string, file: string): void {
  if (value.includes('#') || /[\n\r]/.test(value)) {
    throw new Error(
      `Invalid config file (${file}):\n${name}: ${reference} must not contain '#' or a newline, ` +
        'either would change the YAML structure',
    );
  }
}
