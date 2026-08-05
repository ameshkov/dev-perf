/**
 * Tests for the run configuration dump: the full resolved
 * configuration of a run, rendered as one indented line per config
 * field for the stderr log, with the cache directory resolved,
 * defaults applied, unset options omitted, and the API key masked.
 */
import { describe, expect, it } from 'vitest';
import type { CliOptions } from './config.js';
import { resolveCacheDir } from './repo/cache.js';
import { maskSecret, runConfig, runConfigLines } from './run-config.js';

/** Defaults for a deterministic-only run. */
function options(overrides: Partial<CliOptions> = {}): CliOptions {
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
        repos,
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
      repos,
    );

    expect(config).toStrictEqual({
      repos,
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
    const config = runConfig(options({ repos: ['r'] }), ['r']);

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
    const config = runConfig(options({ repos: ['r'] }), ['r']);

    expect('since' in config).toBe(false);
    expect('until' in config).toBe(false);
    expect('unit' in config).toBe(false);
    expect('output' in config).toBe(false);
    expect('model' in config).toBe(false);
    expect('providerUrl' in config).toBe(false);
    expect('apiKey' in config).toBe(false);
  });

  it('reports the deduplicated repository list', () => {
    const config = runConfig(options({ repos: ['a', 'b'] }), ['a']);

    expect(config.repos).toEqual(['a']);
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
        repos,
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
      repos,
    );

    expect(lines).toEqual([
      'configuration:',
      '  repos:',
      '    - https://github.com/org/repo.git',
      '  since: 2026-01-01',
      '  until: 2026-06-30',
      '  unit: month',
      '  output: report.json',
      '  cacheDir: /tmp/cache',
      '  refresh: true',
      '  llm: true',
      '  model: gpt-4.1',
      '  providerUrl: https://api.openai.com/v1',
      '  apiKey: sk-0…cdef',
      '  limitContext: 1000',
      '  limitOutput: 2000',
      '  llmRetries: 0',
      '  parallel: 3',
      '  verbose: true',
    ]);
  });

  it('lists every repository as a nested dash item', () => {
    const lines = runConfigLines(options({ repos: ['a', 'b'] }), ['a', 'b']);

    expect(lines.slice(0, 4)).toEqual(['configuration:', '  repos:', '    - a', '    - b']);
  });

  it('shows the resolved defaults and omits unset optional fields', () => {
    const lines = runConfigLines(options({ repos: ['r'] }), ['r']);

    expect(lines).toEqual([
      'configuration:',
      '  repos:',
      '    - r',
      `  cacheDir: ${resolveCacheDir()}`,
      '  refresh: false',
      '  llm: false',
      '  limitContext: 262144',
      '  limitOutput: 65536',
      '  llmRetries: 2',
      '  parallel: 1',
      '  verbose: false',
    ]);
  });

  it('renders the deduplicated repository list', () => {
    const lines = runConfigLines(options({ repos: ['a', 'b'] }), ['a']);

    expect(lines).toContain('    - a');
    expect(lines).not.toContain('    - b');
  });
});
