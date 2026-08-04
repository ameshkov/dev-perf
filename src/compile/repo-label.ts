/**
 * Human-readable repository labels for the `compile` command: the
 * full remote URL as given on the command line is shortened to
 * `host/org/repo` — no scheme, no user part, no port, no `.git`
 * suffix — for the executive summary and the Repositories table.
 * Local paths and bare names pass through unchanged, since they have
 * no host to extract.
 */

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
