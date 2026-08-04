import { describe, expect, it } from 'vitest';
import { repoLabel, repoName } from './repo-label.js';

describe('repoLabel', () => {
  it('shortens scp-like ssh URLs to host/org/repo', () => {
    expect(repoLabel('git@github.com:org/repo.git')).toBe('github.com/org/repo');
    expect(repoLabel('git@gitlab.com:group/subgroup/repo.git')).toBe(
      'gitlab.com/group/subgroup/repo',
    );
  });

  it('shortens scheme URLs to host/org/repo, dropping the user part', () => {
    expect(repoLabel('https://github.com/org/repo.git')).toBe('github.com/org/repo');
    expect(repoLabel('https://github.com/org/repo')).toBe('github.com/org/repo');
    expect(repoLabel('ssh://git@github.com/org/repo.git')).toBe('github.com/org/repo');
    expect(repoLabel('https://user@bitbucket.org/project/repo.git')).toBe(
      'bitbucket.org/project/repo',
    );
  });

  it('drops the port from scheme URLs', () => {
    expect(repoLabel('ssh://git@gitlab.com:2222/group/repo.git')).toBe('gitlab.com/group/repo');
    expect(repoLabel('https://github.com:8443/org/repo.git')).toBe('github.com/org/repo');
  });

  it('handles a trailing slash and a missing .git suffix', () => {
    expect(repoLabel('https://github.com/org/repo.git/')).toBe('github.com/org/repo');
    expect(repoLabel('git@github.com:org/repo/')).toBe('github.com/org/repo');
  });

  it('passes local paths and bare names through unchanged', () => {
    expect(repoLabel('/path/to/repo')).toBe('/path/to/repo');
    expect(repoLabel('repo-a')).toBe('repo-a');
    expect(repoLabel('./local/repo')).toBe('./local/repo');
  });
});

describe('repoName', () => {
  it('returns only the last path segment of the label', () => {
    expect(repoName('git@github.com:acme/app.git')).toBe('app');
    expect(repoName('https://gitlab.com/team/tools.git')).toBe('tools');
    expect(repoName('ssh://git@gitlab.com:2222/group/sub/repo.git')).toBe('repo');
  });

  it('returns bare names and local paths unchanged', () => {
    expect(repoName('repo-a')).toBe('repo-a');
    expect(repoName('/path/to/repo')).toBe('repo');
  });
});
