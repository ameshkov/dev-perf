import { describe, expect, it } from 'vitest';
import type { DevPerfConfig } from './config-file.js';
import { parseReportOptions, reportOptionsSchema, resolveReportOptions } from './config.js';

/** Full, valid LLM-enabled config; individual tests mutate it. */
function validConfig(): DevPerfConfig {
  return {
    repos: ['https://github.com/org/repo.git'],
    since: '2026-01-01',
    llm: true,
    model: 'gpt-4.1',
    'provider-url': 'https://api.example.com/v1',
    'api-key': 'secret',
  };
}

describe('reportOptionsSchema', () => {
  it('validates LLM-enabled options and applies the defaults', () => {
    const result = reportOptionsSchema.safeParse(resolveReportOptions(validConfig()));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.llm).toBe(true);
      expect(result.data.limitContext).toBe(262144);
      expect(result.data.limitOutput).toBe(65536);
      expect(result.data.llmRetries).toBe(2);
      expect(result.data.parallel).toBe(1);
      expect(result.data.refresh).toBeUndefined();
      // The session limits stay absent (unlimited) unless configured.
      expect(result.data.llmMaxTime).toBeUndefined();
      expect(result.data.llmMaxTurns).toBeUndefined();
    }
  });

  it('validates LLM-disabled options without provider configuration', () => {
    const config = validConfig();
    delete config.model;
    delete config['provider-url'];
    delete config['api-key'];
    config.llm = false;

    const result = reportOptionsSchema.safeParse(resolveReportOptions(config));

    expect(result.success).toBe(true);
  });

  it('accepts an omitted llm key as enabled', () => {
    const config = validConfig();
    delete config.llm;

    const result = reportOptionsSchema.safeParse(resolveReportOptions(config));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.llm).toBe(true);
    }
  });

  it('requires model when LLM analysis is enabled', () => {
    const config = validConfig();
    delete config.model;

    const result = reportOptionsSchema.safeParse(resolveReportOptions(config));

    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path.join('.'));
      expect(paths).toContain('model');
    }
  });

  it('requires providerUrl when LLM analysis is enabled', () => {
    const config = validConfig();
    delete config['provider-url'];

    const result = reportOptionsSchema.safeParse(resolveReportOptions(config));

    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path.join('.'));
      expect(paths).toContain('providerUrl');
    }
  });

  it('requires apiKey when LLM analysis is enabled', () => {
    const config = validConfig();
    delete config['api-key'];

    const result = reportOptionsSchema.safeParse(resolveReportOptions(config));

    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path.join('.'));
      expect(paths).toContain('apiKey');
    }
  });

  it('rejects an empty repo list', () => {
    const result = reportOptionsSchema.safeParse(
      resolveReportOptions({ ...validConfig(), repos: [] }),
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path.join('.'));
      expect(paths).toContain('repos');
    }
  });

  it('rejects a missing repo list', () => {
    const config = validConfig();
    delete config.repos;

    const result = reportOptionsSchema.safeParse(resolveReportOptions(config));

    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path.join('.'));
      expect(paths).toContain('repos');
    }
  });

  it('rejects invalid limit-context values', () => {
    for (const value of [0, -5, 1.5, 'abc']) {
      const result = reportOptionsSchema.safeParse(
        resolveReportOptions({ ...validConfig(), 'limit-context': value as never }),
      );

      expect(result.success, `expected limit-context ${String(value)} to be rejected`).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((issue) => issue.path.join('.'));
        expect(paths).toContain('limitContext');
      }
    }
  });

  it('passes numeric limit values through and rejects invalid limit-output', () => {
    const ok = reportOptionsSchema.safeParse(
      resolveReportOptions({ ...validConfig(), 'limit-context': 128 }),
    );
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect(ok.data.limitContext).toBe(128);
    }

    const result = reportOptionsSchema.safeParse(
      resolveReportOptions({ ...validConfig(), 'limit-output': 'nope' as never }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path.join('.'));
      expect(paths).toContain('limitOutput');
    }
  });

  it('accepts llm-retries zero and rejects invalid values', () => {
    const zero = reportOptionsSchema.safeParse(
      resolveReportOptions({ ...validConfig(), 'llm-retries': 0 }),
    );
    expect(zero.success).toBe(true);
    if (zero.success) {
      expect(zero.data.llmRetries).toBe(0);
    }

    for (const value of [-1, 1.5, 'abc']) {
      const result = reportOptionsSchema.safeParse(
        resolveReportOptions({ ...validConfig(), 'llm-retries': value as never }),
      );

      expect(result.success, `expected llm-retries ${String(value)} to be rejected`).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((issue) => issue.path.join('.'));
        expect(paths).toContain('llmRetries');
      }
    }
  });

  it('passes llm-max-time and llm-max-turns through and rejects invalid values', () => {
    const ok = reportOptionsSchema.safeParse(
      resolveReportOptions({ ...validConfig(), 'llm-max-time': 120, 'llm-max-turns': 10 }),
    );
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect(ok.data.llmMaxTime).toBe(120);
      expect(ok.data.llmMaxTurns).toBe(10);
    }

    for (const value of [0, -1, 1.5, 'abc']) {
      const time = reportOptionsSchema.safeParse(
        resolveReportOptions({ ...validConfig(), 'llm-max-time': value as never }),
      );
      expect(time.success, `expected llm-max-time ${String(value)} to be rejected`).toBe(false);
      if (!time.success) {
        const paths = time.error.issues.map((issue) => issue.path.join('.'));
        expect(paths).toContain('llmMaxTime');
      }

      const turns = reportOptionsSchema.safeParse(
        resolveReportOptions({ ...validConfig(), 'llm-max-turns': value as never }),
      );
      expect(turns.success, `expected llm-max-turns ${String(value)} to be rejected`).toBe(false);
      if (!turns.success) {
        const paths = turns.error.issues.map((issue) => issue.path.join('.'));
        expect(paths).toContain('llmMaxTurns');
      }
    }
  });

  it('accepts parallel one and rejects invalid values', () => {
    const one = reportOptionsSchema.safeParse(
      resolveReportOptions({ ...validConfig(), parallel: 1 }),
    );
    expect(one.success).toBe(true);
    if (one.success) {
      expect(one.data.parallel).toBe(1);
    }

    for (const value of [0, -1, 1.5, 'abc']) {
      const result = reportOptionsSchema.safeParse(
        resolveReportOptions({ ...validConfig(), parallel: value as never }),
      );

      expect(result.success, `expected parallel ${String(value)} to be rejected`).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((issue) => issue.path.join('.'));
        expect(paths).toContain('parallel');
      }
    }
  });

  it('accepts every period unit and rejects unknown units', () => {
    for (const unit of ['day', 'week', 'month', 'quarter', 'year']) {
      const result = reportOptionsSchema.safeParse(
        resolveReportOptions({ ...validConfig(), unit }),
      );

      expect(result.success, `expected unit ${unit} to be accepted`).toBe(true);
      if (result.success) {
        expect(result.data.unit).toBe(unit);
      }
    }

    const invalid = reportOptionsSchema.safeParse(
      resolveReportOptions({ ...validConfig(), unit: 'fortnight' }),
    );
    expect(invalid.success).toBe(false);
    if (!invalid.success) {
      const paths = invalid.error.issues.map((issue) => issue.path.join('.'));
      expect(paths).toContain('unit');
    }
  });

  it('requires since when unit is set', () => {
    const config = { ...validConfig(), unit: 'month' };
    delete config.since;

    const result = reportOptionsSchema.safeParse(resolveReportOptions(config));

    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path.join('.'));
      expect(paths).toContain('since');
    }
  });

  it('accepts a unit with since present', () => {
    const result = reportOptionsSchema.safeParse(
      resolveReportOptions({ ...validConfig(), unit: 'week' }),
    );

    expect(result.success).toBe(true);
  });

  it('rejects duplicate mapped emails under the users-map key', () => {
    const result = reportOptionsSchema.safeParse({
      repos: [{ spec: 'https://github.com/org/repo.git', repo: 'https://github.com/org/repo.git' }],
      llm: false,
      maps: [
        { email: 'a@example.com', name: 'One' },
        { email: 'a@example.com', name: 'Two' },
      ],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path.join('.'));
      expect(paths).toContain('users-map');
    }
  });
});

describe('resolveReportOptions', () => {
  it('maps the kebab-case config keys to the camelCase option shape', () => {
    const resolved = resolveReportOptions({
      since: '2026-01-01',
      until: '2026-06-30',
      unit: 'month',
      output: 'report.json',
      'cache-dir': '/tmp/cache',
      llm: false,
      model: 'gpt-4.1',
      'provider-url': 'https://api.example.com/v1',
      'api-key': 'config-secret',
      'limit-context': 128,
      'limit-output': 64,
      'llm-retries': 3,
      'llm-max-time': 120,
      'llm-max-turns': 10,
      parallel: 4,
      verbose: true,
    });

    expect(resolved).toMatchObject({
      since: '2026-01-01',
      until: '2026-06-30',
      unit: 'month',
      output: 'report.json',
      cacheDir: '/tmp/cache',
      llm: false,
      model: 'gpt-4.1',
      providerUrl: 'https://api.example.com/v1',
      apiKey: 'config-secret',
      limitContext: 128,
      limitOutput: 64,
      llmRetries: 3,
      llmMaxTime: 120,
      llmMaxTurns: 10,
      parallel: 4,
      verbose: true,
    });
  });

  it('keeps a comma inside a config users-map display name', () => {
    const resolved = resolveReportOptions({ 'users-map': { 'alice@example.com': 'Doe, John' } });

    expect(resolved.maps).toEqual([{ email: 'alice@example.com', name: 'Doe, John' }]);
  });

  it('keeps maps absent when the users-map key is missing or empty', () => {
    expect(resolveReportOptions({}).maps).toBeUndefined();
    expect(resolveReportOptions({ 'users-map': {} }).maps).toBeUndefined();
  });

  it('defaults repositories to an empty list', () => {
    expect(resolveReportOptions({}).repos).toEqual([]);
    expect(resolveReportOptions({ repos: ['https://github.com/org/a.git'] }).repos).toEqual([
      { repo: 'https://github.com/org/a.git' },
    ]);
  });

  it('normalizes structured repos entries into specs with branch and ignored paths', () => {
    const resolved = resolveReportOptions({
      repos: [
        'https://github.com/org/a.git',
        { repo: 'https://github.com/org/b.git', branch: 'dev', ignore: ['docs/'] },
      ],
    });

    expect(resolved.repos).toEqual([
      { repo: 'https://github.com/org/a.git' },
      {
        repo: 'https://github.com/org/b.git',
        branch: 'dev',
        ignore: ['docs/'],
      },
    ]);
  });

  it('records the config file path when one was used', () => {
    expect(resolveReportOptions({}, 'config.yaml').configFile).toBe('config.yaml');
    expect(resolveReportOptions({}).configFile).toBeUndefined();
  });
});

describe('parseReportOptions', () => {
  it('returns the validated options with defaults applied', () => {
    const options = parseReportOptions(
      resolveReportOptions({ ...validConfig(), llm: false, 'limit-output': 2048 }),
    );

    expect(options.llm).toBe(false);
    expect(options.limitContext).toBe(262144);
    expect(options.limitOutput).toBe(2048);
    expect(options.llmRetries).toBe(2);
    expect(options.llmMaxTime).toBeUndefined();
    expect(options.llmMaxTurns).toBeUndefined();
    expect(options.repos).toEqual([{ repo: 'https://github.com/org/repo.git' }]);
  });

  it('accepts an LLM-enabled run configured entirely from the config file', () => {
    const options = parseReportOptions(
      resolveReportOptions({
        repos: ['https://github.com/org/repo.git'],
        since: '2026-01-01',
        model: 'gpt-4.1',
        'provider-url': 'https://api.example.com/v1',
        'api-key': 'config-secret',
      }),
    );

    expect(options.llm).toBe(true);
    expect(options.apiKey).toBe('config-secret');
  });

  it('throws a formatted error naming the config keys', () => {
    expect(() => parseReportOptions(resolveReportOptions({ repos: ['r'] }))).toThrow(
      'Invalid options:\nmodel: required when LLM analysis is enabled (or set llm: false)\n' +
        'provider-url: required when LLM analysis is enabled (or set llm: false)\n' +
        'api-key: required when LLM analysis is enabled (or set llm: false)',
    );
  });

  it('renders camelCase paths as dashed config keys', () => {
    expect(() =>
      parseReportOptions(resolveReportOptions({ repos: ['r'], 'limit-context': 'abc' as never })),
    ).toThrow(/limit-context: Invalid input/);
  });

  it('requires since when unit is set, naming the since key', () => {
    expect(() =>
      parseReportOptions(resolveReportOptions({ repos: ['r'], llm: false, unit: 'month' })),
    ).toThrow(/since: required when unit is set \(an unbounded range cannot be split\)/);
  });

  it('parses the config users-map into maps', () => {
    const options = parseReportOptions(
      resolveReportOptions({
        repos: ['https://github.com/org/repo.git'],
        llm: false,
        'users-map': { 'alice@example.com': 'Doe, John' },
      }),
    );

    expect(options.maps).toEqual([{ email: 'alice@example.com', name: 'Doe, John' }]);
  });

  it('keeps maps absent when no mapping is given', () => {
    expect(
      parseReportOptions(resolveReportOptions({ repos: ['r'], llm: false })).maps,
    ).toBeUndefined();
  });

  it('rejects duplicate mapped emails, naming the users-map key', () => {
    expect(() =>
      parseReportOptions({
        repos: [{ repo: 'r' }],
        llm: false,
        maps: [
          { email: 'a@example.com', name: 'One' },
          { email: 'a@example.com', name: 'Two' },
        ],
      }),
    ).toThrow(/users-map: email 'a@example\.com' is mapped more than once/);
  });

  it('reports every duplicated email in one pass', () => {
    expect(() =>
      parseReportOptions({
        repos: [{ repo: 'r' }],
        llm: false,
        maps: [
          { email: 'a@example.com', name: 'One' },
          { email: 'a@example.com', name: 'Two' },
          { email: 'b@example.com', name: 'One' },
          { email: 'b@example.com', name: 'Two' },
        ],
      }),
    ).toThrow(/email 'a@example\.com' is mapped more than once[\s\S]*email 'b@example\.com'/);
  });

  it('rejects an invalid repository spec, naming its path', () => {
    expect(() => parseReportOptions({ repos: [{ repo: '' }], llm: false })).toThrow(
      /repos\.0\.repo: a repository URL or local path is required/,
    );
    expect(() => parseReportOptions({ repos: [{ repo: 'r', ignore: [''] }], llm: false })).toThrow(
      /repos\.0\.ignore\.0: an ignore pattern must be non-empty/,
    );
  });

  it('reports a clean validation error for a null or undefined input', () => {
    for (const input of [null, undefined]) {
      // A missing input must not raise a raw TypeError; the schema
      // reports the missing repository as a formatted option error.
      expect(() => parseReportOptions(input)).toThrow(/Invalid options:\nrepos: /);
    }
  });
});
