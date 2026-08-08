import { describe, expect, it } from 'vitest';
import { parseCompileOptions, resolveCompileOptions } from './options.js';

describe('resolveCompileOptions', () => {
  it('maps the config keys to the compile option shape', () => {
    const resolved = resolveCompileOptions({
      repos: ['repo-a', 'repo-b'],
      'users-map': { 'alice@example.com': 'Alice Smith', 'bob@example.com': 'Bob' },
      verbose: true,
      compile: {
        report: 'report.json',
        output: 'out/',
        'include-users': ['Alice', 'bob@example.com'],
        'exclude-users': ['Carol'],
        'exclude-repos': ['legacy'],
      },
    });

    expect(resolved).toEqual({
      report: 'report.json',
      output: 'out/',
      maps: [
        { email: 'alice@example.com', name: 'Alice Smith' },
        { email: 'bob@example.com', name: 'Bob' },
      ],
      includeUsers: ['Alice', 'bob@example.com'],
      excludeUsers: ['Carol'],
      repos: ['repo-a', 'repo-b'],
      excludeRepos: ['legacy'],
      verbose: true,
    });
  });

  it('keeps a comma inside a config users-map display name', () => {
    const resolved = resolveCompileOptions({ 'users-map': { 'alice@example.com': 'Doe, John' } });

    expect(resolved.maps).toEqual([{ email: 'alice@example.com', name: 'Doe, John' }]);
  });

  it('keeps maps absent when the users-map key is missing or empty', () => {
    expect(resolveCompileOptions({}).maps).toBeUndefined();
    expect(resolveCompileOptions({ 'users-map': {} }).maps).toBeUndefined();
  });

  it('applies the config verbose boolean', () => {
    expect(resolveCompileOptions({ verbose: true }).verbose).toBe(true);
  });

  it('keeps repo entries as given, since the # character is no longer a branch selector', () => {
    const resolved = resolveCompileOptions({
      repos: ['https://github.com/org/repo.git#dev', 'repo-a'],
      compile: { 'exclude-repos': ['https://github.com/org/legacy.git#release-2'] },
    });

    // Repo values are the clone targets as given — nothing is stripped,
    // because a `#` suffix no longer selects a branch.
    expect(resolved.repos).toEqual(['https://github.com/org/repo.git#dev', 'repo-a']);
    expect(resolved.excludeRepos).toEqual(['https://github.com/org/legacy.git#release-2']);
  });

  it('extracts the bare target from structured repos entries too', () => {
    const resolved = resolveCompileOptions({
      repos: ['plain-repo', { repo: 'https://github.com/org/other.git', branch: 'dev' }],
    });

    expect(resolved.repos).toEqual(['plain-repo', 'https://github.com/org/other.git']);
  });

  it('keeps report, output and the selections absent in an empty config', () => {
    const resolved = resolveCompileOptions({});
    expect(resolved.report).toBeUndefined();
    expect(resolved.output).toBeUndefined();
    expect(resolved.includeUsers).toBeUndefined();
    expect(resolved.excludeUsers).toBeUndefined();
    expect(resolved.repos).toBeUndefined();
    expect(resolved.excludeRepos).toBeUndefined();
  });
});

describe('parseCompileOptions', () => {
  it('applies defaults and keeps the parsed maps entries', () => {
    const parsed = parseCompileOptions({
      report: 'report.json',
      maps: [{ email: 'alice@example.com', name: 'Alice Smith' }],
    });

    expect(parsed.output).toBe('dev-perf-report');
    expect(parsed.maps).toEqual([{ email: 'alice@example.com', name: 'Alice Smith' }]);
    expect(parsed.includeUsers).toEqual([]);
    expect(parsed.excludeUsers).toEqual([]);
    expect(parsed.repos).toEqual([]);
    expect(parsed.excludeRepos).toEqual([]);
  });

  it('requires the report file, naming the compile.report config key', () => {
    expect(() => parseCompileOptions({})).toThrow(/compile\.report: the report file is required/);
  });

  it('ignores empty and whitespace-only list items', () => {
    const parsed = parseCompileOptions({
      report: 'r.json',
      includeUsers: ['Alice', '  '],
      excludeUsers: [' '],
      repos: [''],
      excludeRepos: ['rep'],
    });

    expect(parsed.includeUsers).toEqual(['Alice']);
    expect(parsed.excludeUsers).toEqual([]);
    expect(parsed.repos).toEqual([]);
    expect(parsed.excludeRepos).toEqual(['rep']);
  });

  it('falls back to the default output when compile.output is empty', () => {
    expect(parseCompileOptions({ report: 'r.json', output: '' }).output).toBe('dev-perf-report');
    expect(parseCompileOptions({ report: 'r.json', output: '  ' }).output).toBe('dev-perf-report');
  });

  it('rejects a malformed maps entry with the config key in the error', () => {
    expect(() =>
      parseCompileOptions({ report: 'r.json', maps: [{ email: '', name: 'Alice' }] }),
    ).toThrow(/users-map\.0\.email/);
  });

  it('rejects duplicate mapped emails', () => {
    expect(() =>
      parseCompileOptions({
        report: 'r.json',
        maps: [
          { email: 'a@example.com', name: 'One' },
          { email: 'a@example.com', name: 'Two' },
        ],
      }),
    ).toThrow(/users-map: email 'a@example\.com' is mapped more than once/);
  });

  it('reports every duplicated email in one pass', () => {
    expect(() =>
      parseCompileOptions({
        report: 'r.json',
        maps: [
          { email: 'a@example.com', name: 'One' },
          { email: 'a@example.com', name: 'Two' },
          { email: 'b@example.com', name: 'One' },
          { email: 'b@example.com', name: 'Two' },
        ],
      }),
    ).toThrow(/email 'a@example\.com' is mapped more than once[\s\S]*email 'b@example\.com'/);
  });

  it('rejects combining include-users with exclude-users, naming the config keys', () => {
    expect(() =>
      parseCompileOptions({
        report: 'r.json',
        includeUsers: ['Alice'],
        excludeUsers: ['Bob'],
      }),
    ).toThrow(/compile\.exclude-users: cannot be combined with compile\.include-users/);
  });

  it('rejects combining repos with exclude-repos, naming the config keys', () => {
    expect(() =>
      parseCompileOptions({ report: 'r.json', repos: ['a'], excludeRepos: ['b'] }),
    ).toThrow(/compile\.exclude-repos: cannot be combined with repos/);
  });

  it('parses config maps entries when a users-map is given', () => {
    const parsed = parseCompileOptions(
      resolveCompileOptions({
        compile: { report: 'r.json' },
        'users-map': { 'alice@example.com': 'Doe, John' },
      }),
    );

    expect(parsed.maps).toEqual([{ email: 'alice@example.com', name: 'Doe, John' }]);
  });

  it('accepts lists of users and repos', () => {
    const parsed = parseCompileOptions({
      report: 'r.json',
      includeUsers: ['Alice', 'bob@example.com'],
      repos: ['repo-a'],
    });
    expect(parsed.includeUsers).toEqual(['Alice', 'bob@example.com']);
    expect(parsed.repos).toEqual(['repo-a']);
  });

  it('keeps repo entries verbatim after parsing', () => {
    const parsed = parseCompileOptions(
      resolveCompileOptions({
        compile: { report: 'r.json' },
        repos: ['https://github.com/org/repo.git#dev'],
      }),
    );

    expect(parsed.repos).toEqual(['https://github.com/org/repo.git#dev']);
  });
});
