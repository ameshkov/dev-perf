/**
 * Tests for language identification: the built-in
 * extension→language mapping and per-language contribution counting
 * from numstat paths (cloc-style, applied to contributions).
 */
import { describe, expect, it } from 'vitest';
import type { Commit } from './commits.js';
import { countLanguageContributions, languageForPath } from './languages.js';

/** A commit with the given files, for counting tests. */
function commit(files: Commit['files']): Commit {
  return {
    sha: 'abc',
    parents: [],
    authorName: 'Alice',
    authorEmail: 'alice@example.com',
    authorDate: '2026-01-01T10:00:00Z',
    subject: 'work',
    files,
    isMerge: false,
  };
}

describe('languageForPath', () => {
  it('maps common extensions to languages', () => {
    expect(languageForPath('src/app.ts')).toBe('TypeScript');
    expect(languageForPath('src/app.tsx')).toBe('TypeScript');
    expect(languageForPath('index.js')).toBe('JavaScript');
    expect(languageForPath('lib.py')).toBe('Python');
    expect(languageForPath('main.go')).toBe('Go');
    expect(languageForPath('mod.rs')).toBe('Rust');
    expect(languageForPath('Main.java')).toBe('Java');
    expect(languageForPath('util.c')).toBe('C');
    expect(languageForPath('util.h')).toBe('C/C++ Header');
    expect(languageForPath('util.cpp')).toBe('C++');
    expect(languageForPath('script.sh')).toBe('Shell');
    expect(languageForPath('index.html')).toBe('HTML');
    expect(languageForPath('style.css')).toBe('CSS');
    expect(languageForPath('README.md')).toBe('Markdown');
    expect(languageForPath('package.json')).toBe('JSON');
    expect(languageForPath('config.yaml')).toBe('YAML');
    expect(languageForPath('Cargo.toml')).toBe('TOML');
  });

  it('takes the extension after the last dot of the basename', () => {
    expect(languageForPath('src/deep/dir/app.test.ts')).toBe('TypeScript');
    expect(languageForPath('a.b.c.py')).toBe('Python');
  });

  it('is case-insensitive', () => {
    expect(languageForPath('README.MD')).toBe('Markdown');
    expect(languageForPath('SRC/App.TS')).toBe('TypeScript');
    expect(languageForPath('DOCKERFILE')).toBe('Dockerfile');
  });

  it('maps well-known filenames without a useful extension', () => {
    expect(languageForPath('Dockerfile')).toBe('Dockerfile');
    expect(languageForPath('build/Dockerfile')).toBe('Dockerfile');
    expect(languageForPath('Makefile')).toBe('Makefile');
    expect(languageForPath('cmake/CMakeLists.txt')).toBe('CMake');
  });

  it('falls back to Unknown for unrecognized paths', () => {
    expect(languageForPath('noextension')).toBe('Unknown');
    expect(languageForPath('.gitignore')).toBe('Unknown');
    expect(languageForPath('assets/logo.bin')).toBe('Unknown');
    expect(languageForPath('image.png')).toBe('Unknown');
  });
});

describe('countLanguageContributions', () => {
  it('sums lines and touched files per language across commits', () => {
    const commits = [
      commit([
        { path: 'src/app.ts', added: 2, deleted: 0 },
        { path: 'README.md', added: 1, deleted: 0 },
      ]),
      commit([
        { path: 'src/app.ts', added: 1, deleted: 1 },
        { path: 'src/util.py', added: 3, deleted: 0 },
      ]),
    ];
    expect(countLanguageContributions(commits)).toStrictEqual({
      TypeScript: { linesAdded: 3, linesRemoved: 1, filesTouched: 2 },
      Markdown: { linesAdded: 1, linesRemoved: 0, filesTouched: 1 },
      Python: { linesAdded: 3, linesRemoved: 0, filesTouched: 1 },
    });
  });

  it('counts binary files as touched with zero lines', () => {
    const commits = [commit([{ path: 'assets/logo.bin', added: undefined, deleted: undefined }])];
    expect(countLanguageContributions(commits)).toStrictEqual({
      Unknown: { linesAdded: 0, linesRemoved: 0, filesTouched: 1 },
    });
  });

  it('counts commit-file pairs, not distinct paths', () => {
    const commits = [
      commit([{ path: 'src/app.ts', added: 1, deleted: 0 }]),
      commit([{ path: 'src/app.ts', added: 2, deleted: 0 }]),
    ];
    expect(countLanguageContributions(commits)).toStrictEqual({
      TypeScript: { linesAdded: 3, linesRemoved: 0, filesTouched: 2 },
    });
  });

  it('returns an empty record when nothing changed', () => {
    expect(countLanguageContributions([])).toStrictEqual({});
    expect(countLanguageContributions([commit([])])).toStrictEqual({});
  });
});
