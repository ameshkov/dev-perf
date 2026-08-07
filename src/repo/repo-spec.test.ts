/**
 * Tests for the repository spec parser: an optional `#branch` suffix
 * selects the branch to analyze for that repository alone, separating
 * the clone target from the branch without disturbing URLs or paths.
 */
import { describe, expect, it } from 'vitest';
import { parseRepoSpec } from './repo-spec.js';

describe('parseRepoSpec', () => {
  it('returns the spec unchanged when it carries no branch suffix', () => {
    const spec = 'https://github.com/org/repo.git';
    expect(parseRepoSpec(spec)).toEqual({ spec, repo: spec });
  });

  it('splits a trailing #branch suffix off a remote URL', () => {
    expect(parseRepoSpec('https://github.com/org/repo.git#dev')).toEqual({
      spec: 'https://github.com/org/repo.git#dev',
      repo: 'https://github.com/org/repo.git',
      branch: 'dev',
    });
  });

  it('keeps slash-containing branch names intact', () => {
    expect(parseRepoSpec('https://github.com/org/repo.git#feature/foo').branch).toBe('feature/foo');
  });

  it('splits the suffix off an scp-like URL without touching the user part', () => {
    const spec = 'git@github.com:org/repo.git#dev';
    expect(parseRepoSpec(spec)).toEqual({
      spec,
      repo: 'git@github.com:org/repo.git',
      branch: 'dev',
    });
  });

  it('splits the suffix off a local path', () => {
    expect(parseRepoSpec('/path/to/repo#release-2')).toEqual({
      spec: '/path/to/repo#release-2',
      repo: '/path/to/repo',
      branch: 'release-2',
    });
  });

  it('treats a trailing # with no branch like no branch at all', () => {
    expect(parseRepoSpec('https://github.com/org/repo.git#')).toEqual({
      spec: 'https://github.com/org/repo.git#',
      repo: 'https://github.com/org/repo.git',
    });
  });
});
