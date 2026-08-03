import { afterEach, describe, expect, it, vi } from 'vitest';
import { cliOptionsSchema, parseCliOptions } from './config.js';

/** Full, valid LLM-enabled options; individual tests mutate it. */
function validOptions(): Record<string, unknown> {
  return {
    repos: ['https://github.com/org/repo.git'],
    since: '2026-01-01',
    llm: true,
    model: 'gpt-4.1',
    providerUrl: 'https://api.example.com/v1',
    apiKey: 'secret',
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('cliOptionsSchema', () => {
  it('validates LLM-enabled options and applies the defaults', () => {
    const result = cliOptionsSchema.safeParse(validOptions());

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.llm).toBe(true);
      expect(result.data.limitContext).toBe(262144);
      expect(result.data.limitOutput).toBe(65536);
      expect(result.data.refresh).toBeUndefined();
    }
  });

  it('validates LLM-disabled options without provider configuration', () => {
    const options = validOptions();
    delete options.model;
    delete options.providerUrl;
    delete options.apiKey;
    options.llm = false;

    const result = cliOptionsSchema.safeParse(options);

    expect(result.success).toBe(true);
  });

  it('accepts an omitted llm flag as enabled', () => {
    const options = validOptions();
    delete options.llm;

    const result = cliOptionsSchema.safeParse(options);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.llm).toBe(true);
    }
  });

  it('requires model when LLM analysis is enabled', () => {
    const options = validOptions();
    delete options.model;

    const result = cliOptionsSchema.safeParse(options);

    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path.join('.'));
      expect(paths).toContain('model');
    }
  });

  it('requires providerUrl when LLM analysis is enabled', () => {
    const options = validOptions();
    delete options.providerUrl;

    const result = cliOptionsSchema.safeParse(options);

    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path.join('.'));
      expect(paths).toContain('providerUrl');
    }
  });

  it('requires apiKey when LLM analysis is enabled and no env var is set', () => {
    vi.stubEnv('DEV_PERF_API_KEY', undefined);
    const options = validOptions();
    delete options.apiKey;

    const result = cliOptionsSchema.safeParse(options);

    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path.join('.'));
      expect(paths).toContain('apiKey');
    }
  });

  it('accepts the API key from DEV_PERF_API_KEY', () => {
    vi.stubEnv('DEV_PERF_API_KEY', 'env-secret');
    const options = validOptions();
    delete options.apiKey;

    const result = cliOptionsSchema.safeParse(options);

    expect(result.success).toBe(true);
  });

  it('rejects an empty repo list', () => {
    const options = validOptions();
    options.repos = [];

    const result = cliOptionsSchema.safeParse(options);

    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path.join('.'));
      expect(paths).toContain('repos');
    }
  });

  it('rejects a missing repo list', () => {
    const options = validOptions();
    delete options.repos;

    const result = cliOptionsSchema.safeParse(options);

    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path.join('.'));
      expect(paths).toContain('repos');
    }
  });

  it('rejects invalid limit-context values', () => {
    for (const value of [0, -5, 1.5, 'abc']) {
      const options = validOptions();
      options.limitContext = value;

      const result = cliOptionsSchema.safeParse(options);

      expect(result.success, `expected limitContext ${String(value)} to be rejected`).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((issue) => issue.path.join('.'));
        expect(paths).toContain('limitContext');
      }
    }
  });

  it('coerces numeric limit strings and rejects invalid limit-output values', () => {
    const options = validOptions();
    options.limitContext = '128';
    options.limitOutput = 'nope';

    const result = cliOptionsSchema.safeParse(options);

    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path.join('.'));
      expect(paths).toContain('limitOutput');
    }

    const coerced = cliOptionsSchema.safeParse({ ...validOptions(), limitContext: '128' });
    expect(coerced.success).toBe(true);
    if (coerced.success) {
      expect(coerced.data.limitContext).toBe(128);
    }
  });

  it('validates limit-output independently', () => {
    const options = validOptions();
    options.limitOutput = -1;

    const result = cliOptionsSchema.safeParse(options);

    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path.join('.'));
      expect(paths).toContain('limitOutput');
    }
  });
});

describe('parseCliOptions', () => {
  it('returns the validated options with defaults applied', () => {
    const options = parseCliOptions({ ...validOptions(), llm: false, limitOutput: '2048' });

    expect(options.llm).toBe(false);
    expect(options.limitContext).toBe(262144);
    expect(options.limitOutput).toBe(2048);
    expect(options.repos).toEqual(['https://github.com/org/repo.git']);
  });

  it('throws a formatted error listing each invalid option', () => {
    vi.stubEnv('DEV_PERF_API_KEY', undefined);
    const options = validOptions();
    delete options.model;
    delete options.providerUrl;
    delete options.apiKey;

    expect(() => parseCliOptions(options)).toThrow(
      'Invalid options:\n--model: required when LLM analysis is enabled (or pass --no-llm)\n' +
        '--provider-url: required when LLM analysis is enabled (or pass --no-llm)\n' +
        '--api-key: required when LLM analysis is enabled (or set DEV_PERF_API_KEY)',
    );
  });

  it('renders camelCase paths as dashed flags', () => {
    const options = validOptions();
    options.limitContext = 'abc';

    expect(() => parseCliOptions(options)).toThrow(/--limit-context: Invalid input/);
  });
});
