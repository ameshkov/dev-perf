/**
 * Tests for the run configuration dump: the full resolved
 * configuration of a run, rendered as one indented line per config
 * field — keyed by the config-file key names (`cache-dir`,
 * `provider-url`, `users-map`, ...), so the dump reads like the YAML
 * config it was resolved from — for the stderr log, with the cache
 * directory resolved, defaults applied, unset options omitted, and
 * the API key masked.
 */
import { describe, expect, it } from 'vitest';
import type { ReportOptions } from './config.js';
import { resolveCacheDir } from './repo/cache.js';
import type { RepoSpec } from './repo/repo-spec.js';
import { maskSecret, runConfig, runConfigLines } from './run-config.js';

/** Wraps plain spec strings into `RepoSpec` entries for the options. */
function repoSpecs(...specs: string[]): RepoSpec[] {
  return specs.map((spec) => ({ repo: spec }));
}

/** Defaults for a deterministic-only run. */
function options(overrides: Partial<ReportOptions> = {}): ReportOptions {
  return {
    repos: [],
    llm: false,
    limitContext: 262144,
    limitOutput: 65536,
    llmRetries: 2,
    parallel: 1,
    ...overrides,
  };
}

describe('runConfig', () => {
  it('describes the full resolved configuration of a run', () => {
    const repos = ['https://github.com/org/repo.git'];
    const config = runConfig(
      options({
        repos: repoSpecs(...repos),
        since: '2026-01-01',
        until: '2026-06-30',
        unit: 'month',
        output: 'report.json',
        cacheDir: '/tmp/cache',
        refresh: true,
        llm: true,
        model: 'gpt-4.1',
        providerUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-0123456789abcdef',
        limitContext: 1000,
        limitOutput: 2000,
        llmRetries: 0,
        parallel: 3,
        verbose: true,
      }),
      repoSpecs(...repos),
    );

    expect(config).toStrictEqual({
      repos: repoSpecs(...repos),
      since: '2026-01-01',
      until: '2026-06-30',
      unit: 'month',
      output: 'report.json',
      cacheDir: '/tmp/cache',
      refresh: true,
      llm: true,
      model: 'gpt-4.1',
      providerUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-0…cdef',
      limitContext: 1000,
      limitOutput: 2000,
      llmRetries: 0,
      parallel: 3,
      verbose: true,
    });
  });

  it('resolves the default cache directory and applies defaults', () => {
    const config = runConfig(options({ repos: repoSpecs('r') }), repoSpecs('r'));

    expect(config.cacheDir).toBe(resolveCacheDir());
    expect(config.refresh).toBe(false);
    expect(config.llm).toBe(false);
    expect(config.limitContext).toBe(262144);
    expect(config.limitOutput).toBe(65536);
    expect(config.llmRetries).toBe(2);
    expect(config.parallel).toBe(1);
    expect(config.verbose).toBe(false);
  });

  it('omits unset optional keys', () => {
    const config = runConfig(options({ repos: repoSpecs('r') }), repoSpecs('r'));

    expect('since' in config).toBe(false);
    expect('until' in config).toBe(false);
    expect('unit' in config).toBe(false);
    expect('output' in config).toBe(false);
    expect('model' in config).toBe(false);
    expect('providerUrl' in config).toBe(false);
    expect('apiKey' in config).toBe(false);
  });

  it('reports the deduplicated repository list', () => {
    const config = runConfig(options({ repos: repoSpecs('a', 'b') }), repoSpecs('a'));

    expect(config.repos).toEqual([{ repo: 'a' }]);
  });

  it('surfaces email mappings and the config file when set', () => {
    const config = runConfig(
      options({
        repos: repoSpecs('r'),
        maps: [
          { email: 'alice@example.com', name: 'Alice Smith' },
          { email: 'alice@work.com', name: 'Alice Smith' },
        ],
        configFile: 'config.yaml',
      }),
      repoSpecs('r'),
    );

    expect(config.usersMap).toEqual([
      'alice@example.com=Alice Smith',
      'alice@work.com=Alice Smith',
    ]);
    expect(config.configFile).toBe('config.yaml');
  });

  it('omits usersMap and the config file when they were not given', () => {
    const config = runConfig(options({ repos: repoSpecs('r') }), repoSpecs('r'));

    expect('usersMap' in config).toBe(false);
    expect('configFile' in config).toBe(false);
  });
});

describe('maskSecret', () => {
  it('masks long secrets to their edges', () => {
    expect(maskSecret('sk-0123456789abcdef')).toBe('sk-0…cdef');
  });

  it('fully masks short secrets', () => {
    expect(maskSecret('abc')).toBe('***');
    expect(maskSecret('abcdefgh')).toBe('***');
  });
});

describe('runConfigLines', () => {
  it('renders every config field as one indented line', () => {
    const repos = ['https://github.com/org/repo.git'];
    const lines = runConfigLines(
      options({
        repos: repoSpecs(...repos),
        since: '2026-01-01',
        until: '2026-06-30',
        unit: 'month',
        output: 'report.json',
        cacheDir: '/tmp/cache',
        refresh: true,
        llm: true,
        model: 'gpt-4.1',
        providerUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-0123456789abcdef',
        limitContext: 1000,
        limitOutput: 2000,
        llmRetries: 0,
        parallel: 3,
        verbose: true,
      }),
      repoSpecs(...repos),
    );

    expect(lines).toEqual([
      'configuration:',
      '  repos:',
      '    - https://github.com/org/repo.git',
      '  since: 2026-01-01',
      '  until: 2026-06-30',
      '  unit: month',
      '  output: report.json',
      '  cache-dir: /tmp/cache',
      '  refresh: true',
      '  llm: true',
      '  model: gpt-4.1',
      '  provider-url: https://api.openai.com/v1',
      '  api-key: sk-0…cdef',
      '  limit-context: 1000',
      '  limit-output: 2000',
      '  llm-retries: 0',
      '  parallel: 3',
      '  verbose: true',
    ]);
  });

  it('lists every repository as a nested dash item', () => {
    const lines = runConfigLines(options({ repos: repoSpecs('a', 'b') }), repoSpecs('a', 'b'));

    expect(lines.slice(0, 4)).toEqual(['configuration:', '  repos:', '    - a', '    - b']);
  });

  it('renders structured repo specs with branch, base, and ignored paths', () => {
    const lines = runConfigLines(
      options({
        repos: [{ repo: 'r', branch: 'dev', base: 'main', ignore: ['docs/'] }],
      }),
      [{ repo: 'r', branch: 'dev', base: 'main', ignore: ['docs/'] }],
    );

    expect(lines).toContain('    - r (branch: dev, base: main, ignore: docs/)');
  });

  it('lists the email mappings as nested dash items', () => {
    const lines = runConfigLines(
      options({
        repos: repoSpecs('r'),
        maps: [
          { email: 'alice@example.com', name: 'Alice Smith' },
          { email: 'alice@work.com', name: 'Alice Smith' },
        ],
        configFile: 'config.yaml',
      }),
      repoSpecs('r'),
    );

    expect(lines).toContain('  users-map:');
    expect(lines).toContain('    - alice@example.com=Alice Smith');
    expect(lines).toContain('    - alice@work.com=Alice Smith');
    expect(lines).toContain('  config-file: config.yaml');
  });

  it('shows the resolved defaults and omits unset optional fields', () => {
    const lines = runConfigLines(options({ repos: repoSpecs('r') }), repoSpecs('r'));

    expect(lines).toEqual([
      'configuration:',
      '  repos:',
      '    - r',
      `  cache-dir: ${resolveCacheDir()}`,
      '  refresh: false',
      '  llm: false',
      '  limit-context: 262144',
      '  limit-output: 65536',
      '  llm-retries: 2',
      '  parallel: 1',
      '  verbose: false',
    ]);
  });

  it('renders the deduplicated repository list', () => {
    const lines = runConfigLines(options({ repos: repoSpecs('a', 'b') }), repoSpecs('a'));

    expect(lines).toContain('    - a');
    expect(lines).not.toContain('    - b');
  });
});
