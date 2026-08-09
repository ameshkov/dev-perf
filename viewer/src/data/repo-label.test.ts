/**
 * Tests for repository display labels and names: remote URL
 * shortening, local-path pass-through, and the deduplicated meta bar
 * chips.
 */
import { describe, expect, it } from 'vitest';
import { repoChips, repoLabel, repoName } from './index.js';

describe('repoLabel', () => {
  it('shortens scp-like git URLs to host/org/repo', () => {
    expect(repoLabel('git@github.com:acme/app.git')).toBe('github.com/acme/app');
  });

  it('shortens https URLs, dropping the scheme and .git suffix', () => {
    expect(repoLabel('https://github.com/acme/app.git')).toBe('github.com/acme/app');
    expect(repoLabel('https://github.com/acme/app')).toBe('github.com/acme/app');
  });

  it('drops credentials and ports from scheme URLs', () => {
    expect(repoLabel('ssh://git@github.com:22/acme/app.git')).toBe('github.com/acme/app');
    expect(repoLabel('https://user@host.example/acme/app.git')).toBe('host.example/acme/app');
  });

  it('reduces a URL without a path to its host', () => {
    expect(repoLabel('https://github.com')).toBe('github.com');
  });

  it('passes local paths and bare names through unchanged', () => {
    expect(repoLabel('/Users/dev/projects/app')).toBe('/Users/dev/projects/app');
    expect(repoLabel('my-repo')).toBe('my-repo');
  });
});

describe('repoName', () => {
  it('returns the last path segment of the label', () => {
    expect(repoName('git@github.com:acme/app.git')).toBe('app');
    expect(repoName('https://github.com/acme/web.git')).toBe('web');
  });

  it('returns the input for bare names and the last segment for local paths', () => {
    expect(repoName('my-repo')).toBe('my-repo');
    expect(repoName('/tmp/checkouts/app')).toBe('app');
  });
});

describe('repoChips', () => {
  it('keeps one chip per distinct label, in first-seen order', () => {
    const chips = repoChips([
      { repo: 'https://github.com/acme/api.git', branch: 'master' },
      { repo: 'https://github.com/acme/web.git' },
      { repo: 'git@github.com:acme/api.git', branch: 'release/v2' },
    ]);
    expect(chips.map((chip) => chip.label)).toEqual(['github.com/acme/api', 'github.com/acme/web']);
  });

  it('collects the branches of every spec behind a label into the tooltip', () => {
    const [chip] = repoChips([
      { repo: 'https://github.com/acme/api.git', branch: 'master' },
      { repo: 'https://github.com/acme/api.git', branch: 'release/v2', base: 'master' },
    ]);
    expect(chip.title).toBe('https://github.com/acme/api.git (master, release/v2)');
  });

  it('uses the bare clone target as the tooltip without branches', () => {
    const [chip] = repoChips([{ repo: 'https://github.com/acme/web.git' }]);
    expect(chip.title).toBe('https://github.com/acme/web.git');
  });
});
