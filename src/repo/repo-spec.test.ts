/**
 * Tests for the repository spec normalization: a plain-string `repos`
 * entry is a bare clone target (the `#` character is never treated
 * specially), and the structured map carries the branch, the base the
 * analysis is scoped against, and the ignored paths.
 */
import { describe, expect, it } from 'vitest';
import { parseRepoConfigItem, parseRepoSpec, repoSpecLabel } from './repo-spec.js';

describe('parseRepoSpec', () => {
  it('builds the spec of a bare repository string', () => {
    const repo = 'https://github.com/org/repo.git';
    expect(parseRepoSpec(repo)).toEqual({ repo });
  });

  it('keeps a local path verbatim', () => {
    expect(parseRepoSpec('/path/to/repo')).toEqual({ repo: '/path/to/repo' });
  });

  it('does not treat a # character as a branch selector', () => {
    // The `#branch` spec form was removed: a `#` in the string is part
    // of the clone target, never parsed into a branch.
    expect(parseRepoSpec('https://github.com/org/repo.git#dev')).toEqual({
      repo: 'https://github.com/org/repo.git#dev',
    });
  });
});

describe('parseRepoConfigItem', () => {
  it('passes a plain string entry through as the bare clone target', () => {
    expect(parseRepoConfigItem('https://github.com/org/repo.git')).toEqual({
      repo: 'https://github.com/org/repo.git',
    });
  });

  it('normalizes a bare structured entry to a bare spec', () => {
    expect(parseRepoConfigItem({ repo: 'https://github.com/org/repo.git' })).toEqual({
      repo: 'https://github.com/org/repo.git',
    });
  });

  it('carries the branch from the structured branch key', () => {
    expect(parseRepoConfigItem({ repo: 'https://github.com/org/repo.git', branch: 'dev' })).toEqual(
      {
        repo: 'https://github.com/org/repo.git',
        branch: 'dev',
      },
    );
  });

  it('keeps the repo verbatim when it contains a # (no branch parsing)', () => {
    expect(parseRepoConfigItem({ repo: 'https://github.com/org/repo.git#dev' })).toEqual({
      repo: 'https://github.com/org/repo.git#dev',
    });
  });

  it('keeps the ignored paths in order and drops an empty list', () => {
    expect(
      parseRepoConfigItem({
        repo: 'https://github.com/org/repo.git',
        ignore: ['docs/', 'vendor/'],
      }),
    ).toEqual({
      repo: 'https://github.com/org/repo.git',
      ignore: ['docs/', 'vendor/'],
    });
    expect(parseRepoConfigItem({ repo: 'r', ignore: [] }).ignore).toBeUndefined();
  });

  it('passes an empty branch through for the schema to reject', () => {
    // The normalizer does not interpret the value: `repoEntryFields`
    // (`branch: z.string().min(1)`) already gates an empty branch, so it
    // is rejected at validation — the normalizer only shapes the value.
    expect(parseRepoConfigItem({ repo: 'https://github.com/org/repo.git', branch: '' })).toEqual({
      repo: 'https://github.com/org/repo.git',
      branch: '',
    });
  });

  it('carries the base against which the analysis is scoped', () => {
    expect(
      parseRepoConfigItem({
        repo: 'https://github.com/org/repo.git',
        branch: 'release/v5',
        base: 'master',
      }),
    ).toEqual({
      repo: 'https://github.com/org/repo.git',
      branch: 'release/v5',
      base: 'master',
    });
  });

  it('keeps the empty-string base as the full-history opt-out', () => {
    expect(parseRepoConfigItem({ repo: 'https://github.com/org/repo.git', base: '' })).toEqual({
      repo: 'https://github.com/org/repo.git',
      base: '',
    });
  });

  it('leaves the base absent on a plain string entry (default scoping)', () => {
    expect(parseRepoConfigItem('https://github.com/org/repo.git').base).toBeUndefined();
  });
});

describe('repoSpecLabel', () => {
  it('renders the bare clone target when the spec carries no extras', () => {
    expect(repoSpecLabel({ repo: 'https://github.com/org/repo.git' })).toBe(
      'https://github.com/org/repo.git',
    );
  });

  it('appends the branch when set', () => {
    expect(repoSpecLabel({ repo: 'r', branch: 'dev' })).toBe('r (branch: dev)');
  });

  it('appends the base as full history for the empty-string opt-out', () => {
    expect(repoSpecLabel({ repo: 'r', base: '' })).toBe('r (base: full history)');
  });

  it('appends the ignored paths when set', () => {
    expect(repoSpecLabel({ repo: 'r', ignore: ['docs/', 'vendor/'] })).toBe(
      'r (ignore: docs/, vendor/)',
    );
  });

  it('joins every non-default field in order', () => {
    expect(repoSpecLabel({ repo: 'r', branch: 'dev', base: 'main', ignore: ['docs/'] })).toBe(
      'r (branch: dev, base: main, ignore: docs/)',
    );
  });
});
