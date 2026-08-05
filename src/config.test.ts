import { describe, expect, it } from 'vitest';
import { cliOptionsSchema, parseCliOptions, resolveRawOptions } from './config.js';

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

describe('cliOptionsSchema', () => {
  it('validates LLM-enabled options and applies the defaults', () => {
    const result = cliOptionsSchema.safeParse(validOptions());

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.llm).toBe(true);
      expect(result.data.limitContext).toBe(262144);
      expect(result.data.limitOutput).toBe(65536);
      expect(result.data.llmRetries).toBe(2);
      expect(result.data.parallel).toBe(1);
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

  it('requires apiKey when LLM analysis is enabled', () => {
    const options = validOptions();
    delete options.apiKey;

    const result = cliOptionsSchema.safeParse(options);

    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path.join('.'));
      expect(paths).toContain('apiKey');
    }
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

  it('coerces llm-retries strings, accepts zero, and rejects invalid values', () => {
    const coerced = cliOptionsSchema.safeParse({ ...validOptions(), llmRetries: '4' });
    expect(coerced.success).toBe(true);
    if (coerced.success) {
      expect(coerced.data.llmRetries).toBe(4);
    }

    const zero = cliOptionsSchema.safeParse({ ...validOptions(), llmRetries: 0 });
    expect(zero.success).toBe(true);
    if (zero.success) {
      expect(zero.data.llmRetries).toBe(0);
    }

    for (const value of [-1, 1.5, 'abc']) {
      const options = validOptions();
      options.llmRetries = value;

      const result = cliOptionsSchema.safeParse(options);

      expect(result.success, `expected llmRetries ${String(value)} to be rejected`).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((issue) => issue.path.join('.'));
        expect(paths).toContain('llmRetries');
      }
    }
  });

  it('coerces parallel strings, accepts one, and rejects invalid values', () => {
    const coerced = cliOptionsSchema.safeParse({ ...validOptions(), parallel: '4' });
    expect(coerced.success).toBe(true);
    if (coerced.success) {
      expect(coerced.data.parallel).toBe(4);
    }

    const one = cliOptionsSchema.safeParse({ ...validOptions(), parallel: 1 });
    expect(one.success).toBe(true);
    if (one.success) {
      expect(one.data.parallel).toBe(1);
    }

    for (const value of [0, -1, 1.5, 'abc']) {
      const options = validOptions();
      options.parallel = value;

      const result = cliOptionsSchema.safeParse(options);

      expect(result.success, `expected parallel ${String(value)} to be rejected`).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((issue) => issue.path.join('.'));
        expect(paths).toContain('parallel');
      }
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

  it('accepts every period unit and rejects unknown units', () => {
    for (const unit of ['day', 'week', 'month', 'quarter', 'year']) {
      const result = cliOptionsSchema.safeParse({ ...validOptions(), unit });

      expect(result.success, `expected unit ${unit} to be accepted`).toBe(true);
      if (result.success) {
        expect(result.data.unit).toBe(unit);
      }
    }

    const invalid = cliOptionsSchema.safeParse({ ...validOptions(), unit: 'fortnight' });
    expect(invalid.success).toBe(false);
    if (!invalid.success) {
      const paths = invalid.error.issues.map((issue) => issue.path.join('.'));
      expect(paths).toContain('unit');
    }
  });

  it('requires since when unit is set', () => {
    const options = validOptions();
    options.unit = 'month';
    delete options.since;

    const result = cliOptionsSchema.safeParse(options);

    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path.join('.'));
      expect(paths).toContain('since');
    }
  });

  it('accepts a unit with since present', () => {
    const options = validOptions();
    options.unit = 'week';

    const result = cliOptionsSchema.safeParse(options);

    expect(result.success).toBe(true);
  });
});

describe('resolveRawOptions', () => {
  it('leaves flag-provided options untouched', () => {
    const merged = resolveRawOptions(
      ['https://github.com/org/repo.git'],
      { since: '2026-01-01' },
      { DEV_PERF_SINCE: '2026-06-30' },
    );

    expect(merged.since).toBe('2026-01-01');
    expect(merged.repos).toEqual(['https://github.com/org/repo.git']);
  });

  it('fills unset options from their environment variables', () => {
    const merged = resolveRawOptions(
      [],
      {},
      {
        DEV_PERF_SINCE: '2026-01-01',
        DEV_PERF_UNTIL: '2026-06-30',
        DEV_PERF_UNIT: 'month',
        DEV_PERF_OUTPUT: 'report.json',
        DEV_PERF_CACHE_DIR: '/tmp/cache',
        DEV_PERF_MODEL: 'gpt-4.1',
        DEV_PERF_PROVIDER_URL: 'https://api.example.com/v1',
        DEV_PERF_API_KEY: 'env-secret',
        DEV_PERF_LIMIT_CONTEXT: '128',
        DEV_PERF_LIMIT_OUTPUT: '64',
        DEV_PERF_LLM_RETRIES: '3',
        DEV_PERF_PARALLEL: '4',
      },
    );

    expect(merged).toMatchObject({
      since: '2026-01-01',
      until: '2026-06-30',
      unit: 'month',
      output: 'report.json',
      cacheDir: '/tmp/cache',
      model: 'gpt-4.1',
      providerUrl: 'https://api.example.com/v1',
      apiKey: 'env-secret',
      limitContext: '128',
      limitOutput: '64',
      llmRetries: '3',
      parallel: '4',
    });
  });

  it('lets the flag win over DEV_PERF_UNIT', () => {
    const merged = resolveRawOptions(
      [],
      { unit: 'week' },
      { DEV_PERF_UNIT: 'month', DEV_PERF_SINCE: '2026-01-01' },
    );

    expect(merged.unit).toBe('week');
  });

  it('lets the flag win over DEV_PERF_LLM_RETRIES', () => {
    const merged = resolveRawOptions([], { llmRetries: '1' }, { DEV_PERF_LLM_RETRIES: '3' });

    expect(merged.llmRetries).toBe('1');
  });

  it('lets the flag win over DEV_PERF_PARALLEL', () => {
    const merged = resolveRawOptions([], { parallel: '2' }, { DEV_PERF_PARALLEL: '4' });

    expect(merged.parallel).toBe('2');
  });

  it('parses boolean environment variables, inverting DEV_PERF_NO_LLM', () => {
    const merged = resolveRawOptions(
      [],
      {},
      { DEV_PERF_REFRESH: '1', DEV_PERF_NO_LLM: 'true', DEV_PERF_VERBOSE: 'yes' },
    );

    expect(merged.refresh).toBe(true);
    expect(merged.llm).toBe(false);
    expect(merged.verbose).toBe(true);
  });

  it('accepts false boolean spellings and treats empty values as unset', () => {
    const merged = resolveRawOptions(
      [],
      {},
      {
        DEV_PERF_REFRESH: '0',
        DEV_PERF_NO_LLM: 'off',
        DEV_PERF_VERBOSE: '',
        DEV_PERF_SINCE: '',
      },
    );

    expect(merged.refresh).toBe(false);
    expect(merged.llm).toBe(true);
    expect(merged.verbose).toBeUndefined();
    expect(merged.since).toBeUndefined();
  });

  it('takes repositories from DEV_PERF_REPOS when no positional arguments are given', () => {
    const merged = resolveRawOptions(
      [],
      {},
      { DEV_PERF_REPOS: ' https://github.com/org/a.git ,/path/to/b ' },
    );

    expect(merged.repos).toEqual(['https://github.com/org/a.git', '/path/to/b']);
  });

  it('prefers positional repositories over DEV_PERF_REPOS', () => {
    const merged = resolveRawOptions(['cli-repo'], {}, { DEV_PERF_REPOS: 'env-repo' });

    expect(merged.repos).toEqual(['cli-repo']);
  });

  it('rejects unrecognized boolean environment values', () => {
    expect(() => resolveRawOptions([], {}, { DEV_PERF_REFRESH: 'maybe' })).toThrow(
      'DEV_PERF_REFRESH: expected a boolean',
    );
  });
});

describe('parseCliOptions', () => {
  it('returns the validated options with defaults applied', () => {
    const options = parseCliOptions({ ...validOptions(), llm: false, limitOutput: '2048' });

    expect(options.llm).toBe(false);
    expect(options.limitContext).toBe(262144);
    expect(options.limitOutput).toBe(2048);
    expect(options.llmRetries).toBe(2);
    expect(options.repos).toEqual(['https://github.com/org/repo.git']);
  });

  it('accepts an LLM-enabled run configured entirely from the environment', () => {
    const merged = resolveRawOptions(
      ['https://github.com/org/repo.git'],
      {},
      {
        DEV_PERF_MODEL: 'gpt-4.1',
        DEV_PERF_PROVIDER_URL: 'https://api.example.com/v1',
        DEV_PERF_API_KEY: 'env-secret',
      },
    );

    const options = parseCliOptions(merged);

    expect(options.llm).toBe(true);
    expect(options.apiKey).toBe('env-secret');
  });

  it('throws a formatted error listing each invalid option', () => {
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
