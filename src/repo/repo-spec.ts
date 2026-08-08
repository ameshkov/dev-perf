/**
 * Repository spec normalization: a `repos` config entry is either a
 * repository URL or local path as a plain string, or a structured map
 * (`{ repo, branch?, base?, ignore? }`) carrying the branch, the base
 * branch the analysis is scoped against (branch-delta), and the
 * gitignore-style paths to exclude for that repository alone.
 * `parseRepoConfigItem` normalizes both forms into one `RepoSpec`; the
 * `repo` is always the bare clone target as given — the `#` character is
 * never treated specially, so branch/base/ignore customization lives
 * only in the structured form.
 */
import { z } from 'zod';

/**
 * A resolved repository entry: the bare clone target plus the branch to
 * analyze, the base the analysis is scoped against, and the paths
 * excluded from the analysis.
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
 * Shared field validations of one repository entry: the clone target,
 * the optional branch, the base the analysis is scoped against, and
 * the gitignore-style ignored paths. Both the normalized spec schema
 * (`repoSpecSchema`) and the config-file entry schema build on these
 * fields, so the two can never drift — a change to one constraint
 * applies everywhere.
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
 * scoped against (branch-delta), and the ignored paths.
 *
 * The branch is passed through untouched: a non-empty branch is already
 * guaranteed by `repoEntryFields` (`branch` is `min(1)`), which both the
 * config-file schema and `repoSpecSchema` apply, so an empty branch is
 * rejected at validation and never reaches this normalizer.
 *
 * @param item - The config entry as written: a URL/path string, or a
 * `{ repo, branch?, base?, ignore? }` map.
 * @returns The normalized spec.
 */
export function parseRepoConfigItem(item: RepoConfigItem): RepoSpec {
  if (typeof item === 'string') {
    return parseRepoSpec(item);
  }
  const ignore =
    item.ignore === undefined || item.ignore.length === 0 ? undefined : [...item.ignore];
  return {
    repo: item.repo,
    ...(item.branch === undefined ? {} : { branch: item.branch }),
    ...(item.base === undefined ? {} : { base: item.base }),
    ...(ignore === undefined ? {} : { ignore }),
  };
}

/**
 * Renders one repository spec as a readable label: the clone target,
 * with the branch, the base the analysis is scoped against, and the
 * ignored paths appended when set. The label is the bare target when
 * the spec carries no extras; otherwise the target is followed by its
 * non-default fields in parentheses. An empty `base` — the full-history
 * opt-out — renders as `base: full history`.
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
  return extras.length === 0 ? spec.repo : `${spec.repo} (${extras.join(', ')})`;
}
