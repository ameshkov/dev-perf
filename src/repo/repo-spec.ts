/**
 * Repository spec normalization: a `repos` config entry is either a
 * repository URL or local path as a plain string, or a structured map
 * (`{ repo, branch?, base?, ignore?, ignoreCommits? }`) carrying the
 * branch, the base branch the analysis is scoped against (branch-delta),
 * the gitignore-style paths to exclude, and the specific commits to
 * exclude for that repository alone.
 * `parseRepoConfigItem` normalizes both forms into one `RepoSpec`; the
 * `repo` is always the bare clone target as given — the `#` character is
 * never treated specially, so branch/base/ignore customization lives
 * only in the structured form.
 */
import { z } from 'zod';

/**
 * The commits excluded from a repository's analysis: whole commits
 * dropped by hash and/or by a case-insensitive regex matched against
 * the commit subject, before the deterministic metrics and the LLM
 * layer count anything. `undefined` and an effectively-empty spec
 * (no hashes, no patterns) both mean "no exclusions".
 */
export interface IgnoreCommitsSpec {
  /** Full or abbreviated commit hashes to exclude; one hash matches as
   * a case-insensitive prefix of the commit's sha (so a pasted short
   * hash works), and the match is against the full 40-char sha. */
  hashes?: string[];
  /** Regular expressions matched case-insensitively against the commit
   * subject (the first line of the commit message); each must compile
   * as a JS regular expression. */
  messages?: string[];
}

/**
 * A resolved repository entry: the bare clone target plus the branch to
 * analyze, the base the analysis is scoped against, the paths excluded
 * from the analysis, and the commits excluded from the analysis.
 */
export interface RepoSpec {
  /** The clone target (URL or local path), as given. */
  repo: string;
  /** The branch to analyze, when one is in effect. */
  branch?: string;
  /** The base branch the analysis is scoped against (branch-delta):
   * commits not reachable from it are the analyzed work. `undefined`
   * selects the default (the repo's own default, then `main` →
   * `master`), `''` the full-history opt-out. */
  base?: string;
  /** Gitignore-style paths excluded from the analysis, when any. */
  ignore?: string[];
  /** Commits excluded from the analysis — by hash and/or by message
   * pattern — when any. */
  ignoreCommits?: IgnoreCommitsSpec;
}

/**
 * True when a commit-ignore spec excludes anything: at least one hash
 * or one message pattern is configured. `undefined` and an effectively
 * empty spec both mean "no exclusions" — the semantic shared by the
 * filtering step, the logging, the report entry, and the LLM phase, so
 * it lives in one place. The type predicate narrows the argument to the
 * non-empty spec where `true`, so callers can use its fields directly.
 *
 * @param spec - The repository's configured commit exclusions, if any.
 * @returns True when at least one exclusion is in effect.
 */
export function hasIgnoreCommits(spec: IgnoreCommitsSpec | undefined): spec is IgnoreCommitsSpec {
  return (
    spec !== undefined &&
    ((spec.hashes !== undefined && spec.hashes.length > 0) ||
      (spec.messages !== undefined && spec.messages.length > 0))
  );
}

/**
 * A structured `repos` config entry: the clone target plus an optional
 * branch to analyze, base to scope the analysis against, and
 * gitignore-style paths to exclude for that repository alone. It is the
 * input form of one `RepoSpec` — structurally identical, so the field
 * set lives in exactly one place and the two can never drift.
 */
export interface RepoConfigEntry extends RepoSpec {}
/** One `repos` config entry: a plain string or a structured map. */
export type RepoConfigItem = string | RepoConfigEntry;

/**
 * Shared validation of one repository entry's base branch (branch-delta
 * scoping): any string is accepted — `''` is the full-history opt-out,
 * any other value is a branch or ref name (`master`, `origin/main`)
 * that resolution tries in order. Used by the `base` field of
 * `repoEntryFields`, so the repo spec schema and the config-file schema
 * can never drift on what a base means.
 */
const baseBranchValue = z.string().optional();

/**
 * Shared validation of one commit-ignore spec: the hash list and the
 * message patterns to exclude. Each hash and pattern must be a
 * non-empty string, and each message pattern must compile as a JS
 * regular expression — an invalid regex is a config error named at the
 * failing pattern, never a quiet "matches nothing" at analysis time.
 * Both lists are optional; an empty spec is the "no exclusions" state.
 */
const ignoreCommitsSpecSchema = z
  .object({
    /** Full or abbreviated commit hashes to exclude; a hash matches as
     * a case-insensitive prefix of the commit's sha. */
    hashes: z.array(z.string().min(1, 'a commit hash must be non-empty')).optional(),
    /** Regular expressions matched case-insensitively against the
     * commit subject. */
    messages: z.array(z.string().min(1, 'a message pattern must be non-empty')).optional(),
  })
  .superRefine((spec, ctx) => {
    // The matcher builds every pattern with the `i` flag, so a pattern
    // must compile with it; the native message names the broken part.
    for (const [index, pattern] of (spec.messages ?? []).entries()) {
      try {
        new RegExp(pattern, 'i');
      } catch (error) {
        ctx.addIssue({
          code: 'custom',
          path: ['messages', index],
          message:
            `invalid message pattern '${pattern}': ` +
            (error instanceof Error ? error.message : String(error)),
        });
      }
    }
  });

/**
 * Shared field validations of one repository entry: the clone target,
 * the optional branch, the base the analysis is scoped against, the
 * gitignore-style ignored paths, and the commits to exclude by hash or
 * message pattern. Both the normalized spec schema (`repoSpecSchema`)
 * and the config-file entry schema build on these fields, so the two
 * can never drift — a change to one constraint applies everywhere.
 */
export const repoEntryFields = {
  /** The repository URL or local path. */
  repo: z.string().min(1, 'a repository URL or local path is required'),
  /** The branch to analyze, when one is in effect. */
  branch: z.string().min(1, 'a branch must be non-empty').optional(),
  /** The base branch the analysis is scoped against, if any. */
  base: baseBranchValue,
  /** Gitignore-style paths excluded from the analysis, when any. */
  ignore: z.array(z.string().min(1, 'an ignore pattern must be non-empty')).optional(),
  /** Commits excluded from the analysis — by hash and/or by message
   * pattern — when any. */
  ignoreCommits: ignoreCommitsSpecSchema.optional(),
};

/**
 * zod schema for one normalized `RepoSpec` in the validated report
 * options: the clone target is required and non-empty, and an empty
 * branch or ignore pattern is rejected so an entry can never carry a
 * meaningless value.
 */
export const repoSpecSchema = z.object({
  ...repoEntryFields,
});

/**
 * Builds the spec of a plain-string repository entry: the string is the
 * clone target verbatim — the `#` character is never treated specially,
 * so a branch can only be selected through the structured form.
 *
 * @param repo - Repository URL or local path as given in the config.
 * @returns The spec, with the string as the clone target.
 *
 * @internal Exported for tests only (`repo-spec.test.ts`); production
 * normalization goes through `parseRepoConfigItem`, which calls this
 * internally. Not re-exported from a barrel; not part of the public
 * module API.
 */
export function parseRepoSpec(repo: string): RepoSpec {
  return { repo };
}

/**
 * Normalizes one `repos` config entry — a plain string or a structured
 * map — into a `RepoSpec`. A plain string is the bare clone target,
 * analyzed on its default branch with the default base scoping; the
 * structured map carries the optional branch, the base the analysis is
 * scoped against (branch-delta), the ignored paths, and the commits to
 * exclude.
 *
 * The branch is passed through untouched: a non-empty branch is already
 * guaranteed by `repoEntryFields` (`branch` is `min(1)`), which both the
 * config-file schema and `repoSpecSchema` apply, so an empty branch is
 * rejected at validation and never reaches this normalizer. An empty
 * ignore list and an effectively-empty commit-ignore spec (no hashes,
 * no patterns) are both dropped to `undefined` — the "no exclusions"
 * state.
 *
 * @param item - The config entry as written: a URL/path string, or a
 * `{ repo, branch?, base?, ignore?, ignoreCommits? }` map.
 * @returns The normalized spec.
 */
export function parseRepoConfigItem(item: RepoConfigItem): RepoSpec {
  if (typeof item === 'string') {
    return parseRepoSpec(item);
  }
  const ignore =
    item.ignore === undefined || item.ignore.length === 0 ? undefined : [...item.ignore];
  const ignoreCommits = normalizeIgnoreCommits(item.ignoreCommits);
  return {
    repo: item.repo,
    ...(item.branch === undefined ? {} : { branch: item.branch }),
    ...(item.base === undefined ? {} : { base: item.base }),
    ...(ignore === undefined ? {} : { ignore }),
    ...(ignoreCommits === undefined ? {} : { ignoreCommits }),
  };
}

/**
 * Normalizes a commit-ignore spec for the spec: copies the configured
 * lists in order, drops empty lists, and drops the whole spec when
 * nothing is left — the "no exclusions" state.
 *
 * @param spec - The configured commit exclusions, if any.
 * @returns The normalized spec, or `undefined` when nothing is
 * excluded.
 */
function normalizeIgnoreCommits(
  spec: IgnoreCommitsSpec | undefined,
): IgnoreCommitsSpec | undefined {
  if (spec === undefined) {
    return undefined;
  }
  const hashes = spec.hashes !== undefined && spec.hashes.length > 0 ? [...spec.hashes] : undefined;
  const messages =
    spec.messages !== undefined && spec.messages.length > 0 ? [...spec.messages] : undefined;
  if (hashes === undefined && messages === undefined) {
    return undefined;
  }
  return {
    ...(hashes === undefined ? {} : { hashes }),
    ...(messages === undefined ? {} : { messages }),
  };
}

/**
 * Renders one repository spec as a readable label: the clone target,
 * with the branch, the base the analysis is scoped against, the ignored
 * paths, and the excluded commits appended when set. The label is the
 * bare target when the spec carries no extras; otherwise the target is
 * followed by its non-default fields in parentheses. An empty `base` —
 * the full-history opt-out — renders as `base: full history`.
 *
 * @param spec - The repository spec.
 * @returns The label.
 */
export function repoSpecLabel(spec: RepoSpec): string {
  const extras: string[] = [];
  if (spec.branch !== undefined) {
    extras.push(`branch: ${spec.branch}`);
  }
  if (spec.base !== undefined) {
    extras.push(`base: ${spec.base === '' ? 'full history' : spec.base}`);
  }
  if (spec.ignore !== undefined && spec.ignore.length > 0) {
    extras.push(`ignore: ${spec.ignore.join(', ')}`);
  }
  if (hasIgnoreCommits(spec.ignoreCommits)) {
    extras.push(ignoredCommitsLabel(spec.ignoreCommits));
  }
  return extras.length === 0 ? spec.repo : `${spec.repo} (${extras.join(', ')})`;
}

/**
 * Renders a commit-ignore spec for the spec label: the hashes and the
 * message patterns, as two comma-separated lists.
 *
 * @param spec - The commit exclusions.
 * @returns The renderable label fragment.
 */
function ignoredCommitsLabel(spec: IgnoreCommitsSpec): string {
  const parts: string[] = [];
  if (spec.hashes !== undefined && spec.hashes.length > 0) {
    parts.push(`hashes ${spec.hashes.join(', ')}`);
  }
  if (spec.messages !== undefined && spec.messages.length > 0) {
    parts.push(`messages ${spec.messages.join(', ')}`);
  }
  return `ignored commits: ${parts.join('; ')}`;
}
