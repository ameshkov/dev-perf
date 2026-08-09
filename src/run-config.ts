/**
 * Run configuration dump: the full resolved configuration of a
 * `report` run, rendered as one indented line per config field —
 * named by its config-file key, so the dump reads like the YAML
 * config it was resolved from — and logged to stderr through the
 * logger before the analysis starts. Always printed, even in quiet
 * mode: the dump shows the effective settings — resolved cache
 * directory, provider, limits, retries — immediately, and even when
 * the run fails before the report is written. The API key is masked;
 * a secret must never be written out in full.
 */
import type { ReportOptions } from './config.js';
import { resolveCacheDir } from './repo/cache.js';
import { repoSpecLabel } from './repo/repo-spec.js';
import type { RepoSpec } from './repo/repo-spec.js';

/** Replacement for a short secret that must not be shown at all. */
const FULLY_MASKED = '***';

/** Number of leading/trailing characters shown for a long secret. */
const SECRET_EDGE_LENGTH = 4;

/**
 * Renders a run-config field name as its config-file key for the
 * startup dump: kebab-case (`providerUrl` → `provider-url`), so each
 * line reads like the YAML config key that set it. Every run-config
 * field is named so the conversion is mechanical — no exception map
 * needed.
 *
 * @param field - The camelCase run-config field name.
 * @returns The config-file key name.
 */
function configKeyName(field: string): string {
  return field.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
}

/**
 * Full resolved configuration of a run, one entry per effective
 * option. Optional keys are absent (not `undefined`) when unset,
 * matching the report JSON style. Field names are camelCase (they
 * mirror the parsed option fields); `runConfigLines` renders them
 * under their config-file key names.
 */
interface RunConfig {
  /** Repositories to analyze, deduplicated, in input order, as full specs. */
  repos: RepoSpec[];
  /** Start bound as given, if any. */
  since?: string;
  /** End bound as given, if any. */
  until?: string;
  /** Period unit, when `unit` is set. */
  unit?: string;
  /** Report output file, when `output` is set. */
  output?: string;
  /** Resolved cache root (the `cache-dir` config key, or the default). */
  cacheDir: string;
  /** Whether a fresh clone and re-analysis are forced. */
  refresh: boolean;
  /** Whether LLM analysis is enabled. */
  llm: boolean;
  /** Model id, when LLM analysis is enabled. */
  model?: string;
  /** Provider base URL, when LLM analysis is enabled. */
  providerUrl?: string;
  /** Provider API key, masked (only its edges shown). */
  apiKey?: string;
  /** Max context tokens for LLM analysis. */
  limitContext: number;
  /** Max output tokens for LLM analysis. */
  limitOutput: number;
  /** Retries for a failed LLM analysis. */
  llmRetries: number;
  /** Max wall-clock time per LLM session, in seconds, when set. */
  llmMaxTime?: number;
  /** Max agent turns per LLM session, when set. */
  llmMaxTurns?: number;
  /** Email-to-name mappings (`email=name`), when any were given. */
  usersMap?: string[];
  /** Config file the options were resolved from, when one was in effect. */
  configFile?: string;
  /** Repositories analyzed in parallel. */
  parallel: number;
  /** Verbose logging. */
  verbose: boolean;
}

/**
 * Masks a secret for display: `***` for short secrets, otherwise the
 * first and last four characters with the middle elided — enough to
 * tell keys apart without revealing them.
 *
 * @param secret - The secret to mask.
 * @returns The masked representation.
 *
 * @internal Exported for tests only (`run-config.test.ts`); used by
 * `runConfig` within the module. Not part of the public module API.
 */
export function maskSecret(secret: string): string {
  if (secret.length <= SECRET_EDGE_LENGTH * 2) {
    return FULLY_MASKED;
  }
  return `${secret.slice(0, SECRET_EDGE_LENGTH)}…${secret.slice(-SECRET_EDGE_LENGTH)}`;
}

/**
 * Builds the full run configuration for display: every effective
 * option of the run, with the cache directory resolved and the API
 * key masked. Unset optional options stay absent, matching the report
 * JSON style.
 *
 * @param options - Validated CLI options of the run.
 * @param repos - The deduplicated repository specs, in input order.
 * @returns The configuration object.
 *
 * @internal Exported for tests only (`run-config.test.ts`); used by
 * `runConfigLines` within the module. Not part of the public module
 * API.
 */
export function runConfig(options: ReportOptions, repos: readonly RepoSpec[]): RunConfig {
  return {
    repos: [...repos],
    // Optional keys stay absent (not `undefined`) when unset,
    // matching the JSON output.
    ...(options.since === undefined ? {} : { since: options.since }),
    ...(options.until === undefined ? {} : { until: options.until }),
    ...(options.unit === undefined ? {} : { unit: options.unit }),
    ...(options.output === undefined ? {} : { output: options.output }),
    cacheDir: resolveCacheDir(options.cacheDir),
    refresh: options.refresh ?? false,
    llm: options.llm,
    ...(options.model === undefined ? {} : { model: options.model }),
    ...(options.providerUrl === undefined ? {} : { providerUrl: options.providerUrl }),
    ...(options.apiKey === undefined ? {} : { apiKey: maskSecret(options.apiKey) }),
    limitContext: options.limitContext,
    limitOutput: options.limitOutput,
    llmRetries: options.llmRetries,
    // Optional keys stay absent (not `undefined`) when unset, matching
    // the JSON output: an unlimited session shows no limit line.
    ...(options.llmMaxTime === undefined ? {} : { llmMaxTime: options.llmMaxTime }),
    ...(options.llmMaxTurns === undefined ? {} : { llmMaxTurns: options.llmMaxTurns }),
    ...(options.maps === undefined || options.maps.length === 0
      ? {}
      : { usersMap: options.maps.map((entry) => `${entry.email}=${entry.name}`) }),
    ...(options.configFile === undefined ? {} : { configFile: options.configFile }),
    parallel: options.parallel,
    verbose: options.verbose ?? false,
  };
}

/**
 * Renders the run configuration as one line per config field, ready
 * for the logger: a `configuration:` header, nested structures
 * indented by two spaces per level (the `repos` array as dash items
 * under its key). Lines are keyed by the config-file key names
 * (`cache-dir`, `provider-url`, `users-map`, ...), so the dump reads
 * like the YAML config it was resolved from; the resolved defaults
 * (cache directory, limits, retries) show the effective settings.
 * Unset optional options stay absent, matching the report JSON style.
 *
 * @param options - Validated CLI options of the run.
 * @param repos - The deduplicated repository specs, in input order.
 * @returns The config lines, without the logger's timestamp/level
 * prefix.
 */
export function runConfigLines(options: ReportOptions, repos: readonly RepoSpec[]): string[] {
  const lines = ['configuration:'];
  for (const [key, value] of Object.entries(runConfig(options, repos))) {
    const name = configKeyName(key);
    if (Array.isArray(value)) {
      lines.push(`  ${name}:`);
      for (const item of value) {
        // The `repos` items are specs and render with their branch,
        // base, and ignored paths; the other array fields (`usersMap`)
        // are plain strings.
        lines.push(`    - ${typeof item === 'string' ? item : repoSpecLabel(item)}`);
      }
    } else {
      lines.push(`  ${name}: ${String(value)}`);
    }
  }
  return lines;
}
