/**
 * Tests for the per-repository path exclusion: the matcher semantics
 * (directories, basenames, root anchoring, `*`/`?` within a segment,
 * `**` across segments) and the filtering behavior (ignored-only
 * commits dropped, mixed commits keeping only their non-ignored files,
 * merge commits always kept).
 */
import { describe, expect, it } from 'vitest';
import type { Commit } from './commits.js';
import { filterCommitsIgnoring } from './path-ignore.js';

/** A non-merge commit touching the given paths, one line each. */
function commitWithFiles(paths: string[], overrides: Partial<Commit> = {}): Commit {
  return {
    sha: 'abc',
    parents: [],
    authorName: 'Alice',
    authorEmail: 'alice@example.com',
    authorDate: '2026-01-01T10:00:00Z',
    subject: 'work',
    files: paths.map((path) => ({ path, added: 1, deleted: 0 })),
    isMerge: false,
    ...overrides,
  };
}

describe('filterCommitsIgnoring', () => {
  it('returns the commits unchanged when no patterns are given', () => {
    const commits = [commitWithFiles(['a.ts']), commitWithFiles(['b.md'])];
    expect(filterCommitsIgnoring(commits, undefined)).toEqual(commits);
    expect(filterCommitsIgnoring(commits, [])).toEqual(commits);
  });

  it('keeps only the non-ignored files of a mixed commit', () => {
    const [kept] = filterCommitsIgnoring(
      [commitWithFiles(['src/a.ts', 'docs/guide.md'])],
      ['docs/'],
    );

    expect(kept?.files.map((file) => file.path)).toEqual(['src/a.ts']);
  });

  it('drops an ignored-only commit entirely', () => {
    expect(filterCommitsIgnoring([commitWithFiles(['docs/guide.md'])], ['docs/'])).toEqual([]);
  });

  it('keeps a file that merely shares the excluded directory name', () => {
    // `docs/` excludes the directory and what is under it, never a file
    // literally named `docs`, at any depth.
    const commits = [
      commitWithFiles(['docs/a.ts']),
      commitWithFiles(['src/docs/b.ts']),
      commitWithFiles(['lib/docs']),
    ];
    const kept = filterCommitsIgnoring(commits, ['docs/']);

    expect(kept.map((commit) => commit.files[0]?.path)).toEqual(['lib/docs']);
  });

  it('keeps a file that shares a trailing-** pattern name', () => {
    // `abc/**` matches the whole `abc/` subtree, not a file `abc`.
    const kept = filterCommitsIgnoring(
      [commitWithFiles(['abc']), commitWithFiles(['abc/x.ts'])],
      ['abc/**'],
    );

    expect(kept.map((commit) => commit.files[0]?.path)).toEqual(['abc']);
  });

  it('keeps a non-merge commit that started without files', () => {
    // An `--allow-empty` commit has an empty file list before filtering;
    // with ignore patterns it must keep it, like the no-pattern path does.
    const empty = commitWithFiles([]);
    const kept = filterCommitsIgnoring([empty], ['docs/']);

    expect(kept).toEqual([{ ...empty, files: [] }]);
  });

  it('matches a bare basename pattern at any depth, subtree included', () => {
    const commits = [
      commitWithFiles(['node_modules/pkg/a.js']),
      commitWithFiles(['a/b/node_modules/x.js']),
      commitWithFiles(['src/app.ts']),
    ];
    const kept = filterCommitsIgnoring(commits, ['node_modules']);

    expect(kept.map((commit) => commit.files[0]?.path)).toEqual(['src/app.ts']);
  });

  it('matches basename globs like *.log at any depth', () => {
    const commits = [
      commitWithFiles(['a/debug.log']),
      commitWithFiles(['deep/nested/error.log']),
      commitWithFiles(['src/app.ts']),
    ];
    const kept = filterCommitsIgnoring(commits, ['*.log']);

    expect(kept.map((commit) => commit.files[0]?.path)).toEqual(['src/app.ts']);
  });

  it('anchors slash-carrying patterns to the repository root', () => {
    const commits = [
      commitWithFiles(['build/gen/a.js']),
      commitWithFiles(['build/gen/sub/b.js']),
      commitWithFiles(['src/gen/a.js']),
    ];
    const kept = filterCommitsIgnoring(commits, ['build/gen/*.js']);

    expect(kept.map((commit) => commit.files[0]?.path)).toEqual([
      'build/gen/sub/b.js',
      'src/gen/a.js',
    ]);
  });

  it('treats a leading slash as root anchoring for a single segment', () => {
    const commits = [
      commitWithFiles(['vendor/index.js']),
      commitWithFiles(['src/vendor/index.js']),
    ];
    const kept = filterCommitsIgnoring(commits, ['/vendor']);

    expect(kept.map((commit) => commit.files[0]?.path)).toEqual(['src/vendor/index.js']);
  });

  it('matches ** across segments and a trailing ** subtree', () => {
    const commits = [
      commitWithFiles(['src/a/fixtures/data.json']),
      commitWithFiles(['src/fixtures/data.json']),
      commitWithFiles(['vendor/fixtures/x.json']),
      commitWithFiles(['src/app.ts']),
    ];
    const kept = filterCommitsIgnoring(commits, ['src/**/fixtures', '**/vendor']);

    expect(kept.map((commit) => commit.files[0]?.path)).toEqual(['src/app.ts']);

    const under = filterCommitsIgnoring(
      [commitWithFiles(['src/a/b.ts']), commitWithFiles(['src.ts']), commitWithFiles(['lib/a.ts'])],
      ['src/**'],
    );
    expect(under.map((commit) => commit.files[0]?.path)).toEqual(['src.ts', 'lib/a.ts']);
  });

  it('collapses consecutive ** segments like git does', () => {
    // `a/**/**/b` must match like `a/**/b`: git collapses consecutive
    // `**` runs, so `a/b` and `a/x/b` are excluded, never `ab`.
    const kept = filterCommitsIgnoring(
      [commitWithFiles(['ab']), commitWithFiles(['a/b']), commitWithFiles(['a/x/b'])],
      ['a/**/**/b'],
    );

    expect(kept.map((commit) => commit.files[0]?.path)).toEqual(['ab']);
  });

  it('trims whitespace around patterns before matching', () => {
    // Surrounding whitespace is stripped, so an accidentally indented
    // pattern still applies, and a whitespace-only pattern is dropped.
    const kept = filterCommitsIgnoring(
      [commitWithFiles(['node_modules/pkg/a.js']), commitWithFiles(['src/app.ts'])],
      ['  node_modules  ', '   '],
    );

    expect(kept.map((commit) => commit.files[0]?.path)).toEqual(['src/app.ts']);
  });

  it('keeps a `/` between a literal and a middle **', () => {
    // `a/**/b` must not match `ab`: the middle `**` consumes whole
    // segments (zero or more) and keeps the separating slash.
    const kept = filterCommitsIgnoring(
      [commitWithFiles(['ab']), commitWithFiles(['a/b']), commitWithFiles(['a/x/b'])],
      ['a/**/b'],
    );

    expect(kept.map((commit) => commit.files[0]?.path)).toEqual(['ab']);
  });

  it('always keeps merge commits regardless of ignored paths', () => {
    const merge = commitWithFiles([], { parents: ['x', 'y'], isMerge: true });
    const kept = filterCommitsIgnoring([merge], ['docs/']);

    expect(kept).toHaveLength(1);
    expect(kept[0]).toBe(merge);
  });
});
