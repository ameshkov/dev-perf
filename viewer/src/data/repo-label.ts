/**
 * Human-readable repository labels for the viewer: the full remote URL
 * as given on the command line is shortened to `host/org/repo` — no
 * scheme, no user part, no port, no `.git` suffix. Local paths and
 * bare names pass through unchanged. Mirrors `src/compile/
 * repo-label.ts` of the parent CLI. Also deduplicates the repository
 * chips of the report meta bar, where the same repository may appear
 * once per analyzed branch.
 */
import type { RepoSpec } from '../report/index.js';

/** Matches scp-like remote URLs, e.g. `git@github.com:org/repo.git`. */
const SCP_LIKE_URL_RE = /^[A-Za-z0-9._-]+@([A-Za-z0-9._-]+):(.*)$/;

/** Matches URLs with a scheme, e.g. `https://`, `ssh://`, `file://`. */
const SCHEME_URL_RE = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/([^/]*)(\/.*)?$/;

/**
 * Joins the host and path of a remote URL into the display label:
 * the path is stripped of surrounding slashes and a trailing `.git`.
 *
 * @param host - The host part, e.g. `github.com`.
 * @param path - The path part, e.g. `/org/repo.git`.
 * @returns The joined label.
 */
function joinHostPath(host: string, path: string): string {
  const clean = path.replace(/^\/+|\/+$/g, '').replace(/\.git$/, '');
  return clean === '' ? host : `${host}/${clean}`;
}

/**
 * The short display label of a repository: for remote URLs the
 * `host/org/repo` form without the scheme, credentials, port, or
 * `.git` suffix; for local paths and bare names the input unchanged.
 *
 * @param repo - Repository URL or local path as given on the command line.
 * @returns The display label.
 */
export function repoLabel(repo: string): string {
  const scp = SCP_LIKE_URL_RE.exec(repo);
  if (scp !== null) {
    return joinHostPath(scp[1], scp[2]);
  }
  const url = SCHEME_URL_RE.exec(repo);
  if (url !== null) {
    const host = url[1].includes('@') ? (url[1].split('@').pop() ?? '') : url[1];
    return joinHostPath(host.split(':')[0], url[2] ?? '');
  }
  return repo;
}

/**
 * The short display name of a repository: the last path segment of
 * the `host/org/repo` label — `github.com/acme/app` becomes `app`.
 * Used for chart legends, where the full label does not fit.
 *
 * @param repo - Repository URL or local path as given on the command line.
 * @returns The display name.
 */
export function repoName(repo: string): string {
  const label = repoLabel(repo);
  const index = label.lastIndexOf('/');
  return index === -1 ? label : label.slice(index + 1);
}

/** One deduplicated repository chip of the report meta bar. */
export interface RepoChip {
  /** The short label shown on the chip. */
  label: string;
  /** The tooltip: the clone target and the analyzed branches. */
  title: string;
}

/** One repository label plus the specs recorded under it. */
interface RepoLabelGroup {
  /** The first spec of the group; its clone target starts the tooltip. */
  first: RepoSpec;
  /** The analyzed branches of the group's specs, in report order. */
  branches: string[];
}

/**
 * The tooltip of one repository chip: the clone target as given on the
 * command line, with the analyzed branches in parentheses when any
 * spec names one.
 *
 * @param group - The specs behind one label, in report order.
 * @returns The tooltip text.
 */
function chipTitle(group: RepoLabelGroup): string {
  if (group.branches.length === 0) {
    return group.first.repo;
  }
  return `${group.first.repo} (${group.branches.join(', ')})`;
}

/**
 * The deduplicated repository chips of the meta bar: one chip per
 * repository label, in first-seen order, even when the same repository
 * was analyzed more than once (one spec per branch). The tooltip keeps
 * the full clone target and the analyzed branches.
 *
 * @param repos - Repository specs as recorded in the report.
 * @returns One chip per distinct repository label.
 */
export function repoChips(repos: readonly RepoSpec[]): RepoChip[] {
  const chips: RepoChip[] = [];
  const groups = new Map<string, RepoLabelGroup>();
  for (const spec of repos) {
    const label = repoLabel(spec.repo);
    const group = groups.get(label);
    if (group === undefined) {
      groups.set(label, {
        first: spec,
        branches: spec.branch === undefined ? [] : [spec.branch],
      });
    } else if (spec.branch !== undefined) {
      group.branches.push(spec.branch);
    }
  }
  for (const [label, group] of groups) {
    chips.push({ label, title: chipTitle(group) });
  }
  return chips;
}
