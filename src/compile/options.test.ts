import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseCompileOptions, resolveCompileOptions } from './options.js';
import type { RawCompileOptions } from './options.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('resolveCompileOptions', () => {
  it('fills options from DEV_PERF_COMPILE_* environment variables', () => {
    vi.stubEnv('DEV_PERF_COMPILE_OUTPUT', 'out/');
    vi.stubEnv('DEV_PERF_COMPILE_MAP', 'alice@example.com=Alice Smith, bob@example.com=Bob');
    vi.stubEnv('DEV_PERF_COMPILE_INCLUDE_USER', 'Alice, bob@example.com');
    vi.stubEnv('DEV_PERF_COMPILE_REPO', 'repo-a, repo-b');
    vi.stubEnv('DEV_PERF_COMPILE_REPORT', 'report.json');
    vi.stubEnv('DEV_PERF_VERBOSE', 'true');

    const resolved = resolveCompileOptions(undefined, {});

    expect(resolved).toEqual({
      output: 'out/',
      map: ['alice@example.com=Alice Smith', 'bob@example.com=Bob'],
      includeUser: ['Alice', 'bob@example.com'],
      repo: ['repo-a', 'repo-b'],
      verbose: true,
      report: 'report.json',
    });
  });

  it('gives the flag precedence over the environment', () => {
    vi.stubEnv('DEV_PERF_COMPILE_OUTPUT', 'env-out/');
    vi.stubEnv('DEV_PERF_COMPILE_MAP', 'alice@example.com=Alice');

    const resolved = resolveCompileOptions('flag-report.json', {
      output: 'flag-out/',
      map: ['bob@example.com=Bob'],
    });

    expect(resolved.output).toBe('flag-out/');
    expect(resolved.map).toEqual(['bob@example.com=Bob']);
    expect(resolved.report).toBe('flag-report.json');
  });

  it('fills list options from the environment when commander supplies empty-array defaults', () => {
    // Commander passes `[]` (its repeatable-option default) for list
    // options the user did not pass; the environment must still fill
    // them, and an empty array must not count as flag-provided.
    vi.stubEnv('DEV_PERF_COMPILE_MAP', 'alice@example.com=Alice');
    vi.stubEnv('DEV_PERF_COMPILE_INCLUDE_USER', 'Bob');
    vi.stubEnv('DEV_PERF_COMPILE_EXCLUDE_USER', 'Carol');
    vi.stubEnv('DEV_PERF_COMPILE_REPO', 'repo-a');
    vi.stubEnv('DEV_PERF_COMPILE_EXCLUDE_REPO', 'repo-b');

    const resolved = resolveCompileOptions(undefined, {
      map: [],
      includeUser: [],
      excludeUser: [],
      repo: [],
      excludeRepo: [],
    });

    expect(resolved.map).toEqual(['alice@example.com=Alice']);
    expect(resolved.includeUser).toEqual(['Bob']);
    expect(resolved.excludeUser).toEqual(['Carol']);
    expect(resolved.repo).toEqual(['repo-a']);
    expect(resolved.excludeRepo).toEqual(['repo-b']);
  });

  it('keeps the positional report over DEV_PERF_COMPILE_REPORT', () => {
    vi.stubEnv('DEV_PERF_COMPILE_REPORT', 'env.json');
    expect(resolveCompileOptions('flag.json', {}).report).toBe('flag.json');
  });

  it('rejects an unrecognized boolean environment value', () => {
    vi.stubEnv('DEV_PERF_VERBOSE', 'maybe');
    expect(() => resolveCompileOptions(undefined, {})).toThrow(/DEV_PERF_VERBOSE/);
  });

  it('rejects a malformed DEV_PERF_COMPILE_MAP entry under the variable name', () => {
    vi.stubEnv('DEV_PERF_COMPILE_MAP', 'not-an-email-name-pair');
    expect(() => resolveCompileOptions(undefined, {})).toThrow(
      /DEV_PERF_COMPILE_MAP: expected 'email=name'/,
    );
  });

  it('ignores empty environment values', () => {
    vi.stubEnv('DEV_PERF_COMPILE_OUTPUT', '');
    const resolved = resolveCompileOptions(undefined, {});
    expect(resolved.output).toBeUndefined();
  });
});

describe('parseCompileOptions', () => {
  it('applies defaults and parses map entries', () => {
    const parsed = parseCompileOptions({
      report: 'report.json',
      map: ['Alice@Example.com=Alice Smith'],
    });

    expect(parsed.output).toBe('dev-perf-report');
    expect(parsed.maps).toEqual([{ email: 'alice@example.com', name: 'Alice Smith' }]);
    expect(parsed.includeUsers).toEqual([]);
    expect(parsed.excludeUsers).toEqual([]);
    expect(parsed.repos).toEqual([]);
    expect(parsed.excludeRepos).toEqual([]);
    expect(parsed.mapsFile).toBeUndefined();
  });

  it('requires the report file', () => {
    expect(() => parseCompileOptions({})).toThrow(/report: the report file is required/);
  });

  it('ignores empty and whitespace-only list occurrences', () => {
    const parsed = parseCompileOptions({
      report: 'r.json',
      map: ['', ' '],
      includeUser: [''],
      excludeUser: [' '],
      repo: [''],
      excludeRepo: [''],
    });

    expect(parsed.maps).toEqual([]);
    expect(parsed.includeUsers).toEqual([]);
    expect(parsed.excludeUsers).toEqual([]);
    expect(parsed.repos).toEqual([]);
    expect(parsed.excludeRepos).toEqual([]);
  });

  it('splits comma-separated occurrences like the environment lists', () => {
    const parsed = parseCompileOptions({
      report: 'r.json',
      excludeUser: ['Bamboo, ci-bot@example.com', ''],
      repo: ['repo-a, repo-b'],
    });

    expect(parsed.excludeUsers).toEqual(['Bamboo', 'ci-bot@example.com']);
    expect(parsed.repos).toEqual(['repo-a', 'repo-b']);
  });

  it('falls back to the default output when --output is empty', () => {
    expect(parseCompileOptions({ report: 'r.json', output: '' }).output).toBe('dev-perf-report');
    expect(parseCompileOptions({ report: 'r.json', output: '  ' }).output).toBe('dev-perf-report');
  });

  it('rejects a malformed map entry with the option name in the error', () => {
    expect(() => parseCompileOptions({ report: 'r.json', map: ['no-equals-sign'] })).toThrow(
      /--map: expected 'email=name'/,
    );
  });

  it('rejects duplicate mapped emails', () => {
    expect(() =>
      parseCompileOptions({
        report: 'r.json',
        map: ['a@example.com=One', 'a@example.com=Two'],
      }),
    ).toThrow(/a@example\.com' is mapped more than once/);
  });

  it('reports every duplicated email in one pass', () => {
    expect(() =>
      parseCompileOptions({
        report: 'r.json',
        map: ['a@example.com=One', 'a@example.com=Two', 'b@example.com=One', 'b@example.com=Two'],
      }),
    ).toThrow(/email 'a@example\.com' is mapped more than once[\s\S]*email 'b@example\.com'/);
  });

  it('rejects combining --include-user with --exclude-user', () => {
    expect(() =>
      parseCompileOptions({
        report: 'r.json',
        includeUser: ['Alice'],
        excludeUser: ['Bob'],
      }),
    ).toThrow(/--exclude-user: cannot be combined with --include-user/);
  });

  it('rejects combining --repo with --exclude-repo', () => {
    expect(() =>
      parseCompileOptions({ report: 'r.json', repo: ['a'], excludeRepo: ['b'] }),
    ).toThrow(/--exclude-repo: cannot be combined with --repo/);
  });

  it('accepts lists of users and repos', () => {
    const parsed = parseCompileOptions({
      report: 'r.json',
      includeUser: ['Alice', 'bob@example.com'],
      repo: ['repo-a'],
    });
    expect(parsed.includeUsers).toEqual(['Alice', 'bob@example.com']);
    expect(parsed.repos).toEqual(['repo-a']);
  });

  it('reports the raw shape as the validated shape without list options', () => {
    const raw: RawCompileOptions = { output: 'out/' };
    const parsed = parseCompileOptions({ report: 'r.json', ...raw });
    expect(parsed.output).toBe('out/');
  });
});
