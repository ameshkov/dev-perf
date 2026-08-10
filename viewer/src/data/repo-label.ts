/**
 * Human-readable repository labels for the viewer: the full remote URL
 * as given on the command line is shortened to `host/org/repo` — no
 * scheme, no user part, no port, no `.git` suffix. Local paths and
 * bare names pass through unchanged. Mirrors `src/compile/
 * repo-label.ts` of the parent CLI. Also builds the repository chips
 * of the report meta bar: one chip per analyzed spec, so the same
 * repository analyzed on several branches or with different base
 * scoping or ignore filters shows one distinguishable chip per spec.
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

/** One repository chip of the report meta bar, one per analyzed spec. */
export interface RepoChip {
  /** The short label shown on the chip. */
  label: string;
  /** The non-default spec fields shown after the label — branch,
   * base, ignored paths; absent when the spec carries none. */
  detail?: string;
  /** The tooltip: the clone target plus the non-default fields. */
  title: string;
}

/**
 * The non-default fields of one repository spec, mirroring the parent
 * CLI's `repoSpecLabel`: `branch: <name>`, `base: <name>` (an empty
 * base — the full-history opt-out — reads `base: full history`), and
 * `ignore: <paths>`.
 *
 * @param spec - The repository spec as recorded in the report.
 * @returns One entry per set field, in display order.
 */
function specExtras(spec: RepoSpec): string[] {
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
  return extras;
}

/**
 * The repository chips of the meta bar: one chip per analyzed spec, in
 * report order, so the same repository analyzed more than once (one
 * spec per branch, base scoping, or ignore filter) shows one chip per
 * spec. The chip carries the short label, the spec's non-default
 * fields as a visible detail, and the full spec as the tooltip.
 *
 * @param repos - Repository specs as recorded in the report.
 * @returns One chip per spec.
 */
export function repoChips(repos: readonly RepoSpec[]): RepoChip[] {
  return repos.map((spec) => {
    const detail = specExtras(spec).join(', ');
    return {
      label: repoLabel(spec.repo),
      ...(detail === '' ? {} : { detail }),
      title: detail === '' ? spec.repo : `${spec.repo} (${detail})`,
    };
  });
}
