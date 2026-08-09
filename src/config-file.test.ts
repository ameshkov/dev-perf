/**
 * Tests for the shared YAML config file support: `resolveConfigPath`
 * locates the file (the `--config` value, else `<cwd>/config.yaml`),
 * and `loadDevPerfConfig` reads, expands `${ENV_VAR}` references,
 * parses and validates it. Expansion happens before YAML parsing, so a
 * `${VAR}` expansion into `true`/`false` or a number yields the typed
 * value in the config object.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseCompileOptions, resolveCompileOptions } from './compile/options.js';
import { parseReportOptions, resolveReportOptions } from './config.js';
import { loadDevPerfConfig, resolveConfigPath, resolveDevPerfConfig } from './config-file.js';

/** A temp directory shared across the tests of this file. */
let dir: string | undefined;

afterEach(async () => {
  if (dir !== undefined) {
    await rm(dir, { recursive: true, force: true });
  }
  dir = undefined;
});

describe('resolveConfigPath', () => {
  it('returns the --config value as given', () => {
    expect(resolveConfigPath('path/to/config.yaml', '/tmp')).toBe('path/to/config.yaml');
  });

  it('auto-loads config.yaml from the working directory when it exists', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-config-file-'));
    await writeFile(path.join(dir, 'config.yaml'), 'llm: false\n');

    expect(resolveConfigPath(undefined, dir)).toBe(path.join(dir, 'config.yaml'));
  });

  it('returns undefined when neither --config nor config.yaml are present', () => {
    expect(resolveConfigPath(undefined, '/tmp')).toBeUndefined();
  });

  it('prefers --config over the auto-loaded config.yaml', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-config-file-'));
    await writeFile(path.join(dir, 'config.yaml'), 'llm: false\n');

    expect(resolveConfigPath('explicit.yaml', dir)).toBe('explicit.yaml');
  });

  it('treats an empty or whitespace-only --config value like no config', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-config-file-'));
    await writeFile(path.join(dir, 'config.yaml'), 'llm: false\n');

    expect(resolveConfigPath('', dir)).toBe(path.join(dir, 'config.yaml'));
    expect(resolveConfigPath('   ', dir)).toBe(path.join(dir, 'config.yaml'));
  });

  it('returns undefined for an empty --config value without config.yaml', () => {
    expect(resolveConfigPath('', '/tmp')).toBeUndefined();
  });
});

describe('resolveDevPerfConfig', () => {
  it('resolves and loads an explicit --config file, returning the path', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-config-file-'));
    const file = path.join(dir, 'config.yaml');
    await writeFile(file, 'repos:\n  - repo-a\n');

    await expect(resolveDevPerfConfig(file)).resolves.toEqual({
      config: { repos: ['repo-a'] },
      configPath: file,
    });
  });

  it('returns an empty config and no path when no file is in effect', async () => {
    // Point cwd at a directory without a config.yaml, so the developer's
    // own config.yaml (gitignored, at the repo root) is never autoloaded.
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-config-file-'));
    const spy = vi.spyOn(process, 'cwd').mockReturnValue(cwd);
    try {
      await expect(resolveDevPerfConfig(undefined)).resolves.toEqual({
        config: {},
        configPath: undefined,
      });
    } finally {
      spy.mockRestore();
    }
  });
});

describe('loadDevPerfConfig', () => {
  it('returns an empty config when no file is in effect', async () => {
    await expect(loadDevPerfConfig(undefined)).resolves.toEqual({});
  });

  it('parses a valid YAML config with typed values', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-config-file-'));
    const file = path.join(dir, 'config.yaml');
    await writeFile(
      file,
      [
        'repos:',
        '  - https://github.com/org/repo.git',
        'since: 2026-01-01',
        'until: 2026-06-30',
        'llm: false',
        'parallel: 4',
        'limit-context: 128',
        'llm-max-time: 120',
        'llm-max-turns: 10',
        'users-map:',
        "  'alice@example.com': 'Alice Smith'",
        'verbose: true',
        'compile:',
        '  report: output/report.json',
        '  output: dev-perf-report',
        "  'include-users': [Alice]",
        '',
      ].join('\n'),
    );

    await expect(loadDevPerfConfig(file)).resolves.toEqual({
      repos: ['https://github.com/org/repo.git'],
      since: '2026-01-01',
      until: '2026-06-30',
      llm: false,
      parallel: 4,
      'limit-context': 128,
      'llm-max-time': 120,
      'llm-max-turns': 10,
      'users-map': { 'alice@example.com': 'Alice Smith' },
      verbose: true,
      compile: {
        report: 'output/report.json',
        output: 'dev-perf-report',
        'include-users': ['Alice'],
      },
    });
  });

  it('accepts structured repos entries with a branch and ignored paths', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-config-file-'));
    const file = path.join(dir, 'config.yaml');
    await writeFile(
      file,
      [
        'repos:',
        '  - https://github.com/org/repo.git',
        '  - repo: https://github.com/org/other.git',
        '    branch: dev',
        '    ignore:',
        '      - docs/',
        '      - vendor/locked',
        '',
      ].join('\n'),
    );

    await expect(loadDevPerfConfig(file)).resolves.toEqual({
      repos: [
        'https://github.com/org/repo.git',
        {
          repo: 'https://github.com/org/other.git',
          branch: 'dev',
          ignore: ['docs/', 'vendor/locked'],
        },
      ],
    });
  });

  it('accepts a kebab base-branch key on a structured repos entry', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-config-file-'));
    const file = path.join(dir, 'config.yaml');
    await writeFile(
      file,
      [
        'repos:',
        '  - repo: https://github.com/org/other.git',
        '    branch: release/v5',
        '    base-branch: master',
        '  - repo: https://github.com/org/full.git',
        "    base-branch: ''",
        '',
      ].join('\n'),
    );

    await expect(loadDevPerfConfig(file)).resolves.toEqual({
      repos: [
        { repo: 'https://github.com/org/other.git', branch: 'release/v5', base: 'master' },
        // The empty-string base-branch is the full-history opt-out.
        { repo: 'https://github.com/org/full.git', base: '' },
      ],
    });
  });

  it('rejects a camelCase base key on a structured repos entry', async () => {
    // Only the kebab `base-branch` is a config key; the camelCase `base`
    // reuses the shared spec field name and would otherwise slip past
    // `.strict()` and be silently discarded when both keys are set.
    dir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-config-file-'));
    const camel = path.join(dir, 'camel.yaml');
    await writeFile(camel, 'repos:\n  - repo: r\n    base: master\n');
    // The rejected entry collapses to `repos.0: Invalid input` in the
    // union — the entry is rejected loudly, never accepted.
    await expect(loadDevPerfConfig(camel)).rejects.toThrow(/repos\.0/);

    const both = path.join(dir, 'both.yaml');
    await writeFile(both, 'repos:\n  - repo: r\n    base: master\n    base-branch: dev\n');
    await expect(loadDevPerfConfig(both)).rejects.toThrow(/repos\.0/);
  });

  it('rejects malformed structured repos entries, naming the item', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-config-file-'));
    // Each malformed entry must be rejected loudly instead of parsed.
    const unknown = path.join(dir, 'unknown.yaml');
    await writeFile(unknown, 'repos:\n  - repo: r\n    branch: dev\n    extra: true\n');
    await expect(loadDevPerfConfig(unknown)).rejects.toThrow(/repos\.0: Invalid input/);

    const empty = path.join(dir, 'empty.yaml');
    await writeFile(empty, 'repos:\n  - repo: ""\n');
    await expect(loadDevPerfConfig(empty)).rejects.toThrow(
      /repos\.0\.repo: a repository URL or local path is required/,
    );

    const emptyPattern = path.join(dir, 'empty-pattern.yaml');
    await writeFile(emptyPattern, 'repos:\n  - repo: r\n    ignore: [""]\n');
    await expect(loadDevPerfConfig(emptyPattern)).rejects.toThrow(
      /repos\.0\.ignore\.0: an ignore pattern must be non-empty/,
    );
  });

  it('accepts the compile.report key and rejects unknown compile keys', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-config-file-'));
    const file = path.join(dir, 'config.yaml');
    await writeFile(file, 'compile:\n  report: output/report.json\n');

    await expect(loadDevPerfConfig(file)).resolves.toEqual({
      compile: { report: 'output/report.json' },
    });

    const unknown = path.join(dir, 'unknown.yaml');
    await writeFile(unknown, 'compile:\n  unknown-key: true\n');
    await expect(loadDevPerfConfig(unknown)).rejects.toThrow(/unknown-key/);
  });

  it('expands ${ENV_VAR} references before YAML parsing, yielding typed values', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-config-file-'));
    const file = path.join(dir, 'config.yaml');
    await writeFile(
      file,
      [
        'refresh: ${DEV_PERF_REFRESH}',
        'model: ${DEV_PERF_MODEL}',
        'parallel: ${DEV_PERF_PARALLEL}',
        '',
      ].join('\n'),
    );

    await expect(
      loadDevPerfConfig(file, {
        DEV_PERF_REFRESH: 'true',
        DEV_PERF_MODEL: 'gpt-4.1',
        DEV_PERF_PARALLEL: '4',
      }),
    ).resolves.toEqual({
      refresh: true,
      model: 'gpt-4.1',
      parallel: 4,
    });
  });

  it('errors on an unset ${ENV_VAR} reference, naming the variable and the file', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-config-file-'));
    const file = path.join(dir, 'config.yaml');
    await writeFile(file, 'model: ${DEV_PERF_MODEL}\n');

    await expect(loadDevPerfConfig(file, {})).rejects.toThrow(new RegExp(`${file}`));
    await expect(loadDevPerfConfig(file, {})).rejects.toThrow(
      /DEV_PERF_MODEL: \$\{DEV_PERF_MODEL\} is unset or empty/,
    );
  });

  it('errors on an empty ${ENV_VAR} reference value', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-config-file-'));
    const file = path.join(dir, 'config.yaml');
    await writeFile(file, 'api-key: ${DEV_PERF_API_KEY}\n');

    await expect(loadDevPerfConfig(file, { DEV_PERF_API_KEY: '   ' })).rejects.toThrow(
      /DEV_PERF_API_KEY: \$\{DEV_PERF_API_KEY\} is unset or empty/,
    );
  });

  it('rejects a substituted value containing a YAML comment character', async () => {
    // A `#` after expansion would start a YAML comment and silently
    // truncate the value; the substitution must fail loudly instead.
    dir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-config-file-'));
    const file = path.join(dir, 'config.yaml');
    await writeFile(file, 'api-key: ${DEV_PERF_API_KEY}\n');

    await expect(loadDevPerfConfig(file, { DEV_PERF_API_KEY: 'sk-123#frag' })).rejects.toThrow(
      /DEV_PERF_API_KEY: \$\{DEV_PERF_API_KEY\} must not contain '#' or a newline/,
    );
  });

  it('rejects a substituted value containing a newline', async () => {
    // A newline after expansion could inject extra YAML keys; it must
    // be rejected loudly.
    dir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-config-file-'));
    const file = path.join(dir, 'config.yaml');
    await writeFile(file, 'model: ${DEV_PERF_MODEL}\n');

    await expect(
      loadDevPerfConfig(file, { DEV_PERF_MODEL: 'gpt-4.1\ninjected: true' }),
    ).rejects.toThrow(/DEV_PERF_MODEL: \$\{DEV_PERF_MODEL\} must not contain '#' or a newline/);
  });

  it('rejects unknown keys, naming the file in the error', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-config-file-'));
    const file = path.join(dir, 'config.yaml');
    await writeFile(file, 'unknown-key: true\n');

    await expect(loadDevPerfConfig(file)).rejects.toThrow(
      new RegExp(`Invalid config file \\(${file}\\)`),
    );
    await expect(loadDevPerfConfig(file)).rejects.toThrow(/unknown-key/);
  });

  it('rejects an empty users-map email or name', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-config-file-'));
    const file = path.join(dir, 'config.yaml');
    await writeFile(file, "users-map:\n  '': 'Alice'\n");

    await expect(loadDevPerfConfig(file)).rejects.toThrow(
      /non-empty email and name are required, got '' -> 'Alice'/,
    );
  });

  it('rejects unknown keys under the compile section', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-config-file-'));
    const file = path.join(dir, 'config.yaml');
    await writeFile(file, 'compile:\n  unknown-key: true\n');

    await expect(loadDevPerfConfig(file)).rejects.toThrow(
      new RegExp(`Invalid config file \\(${file}\\)`),
    );
    await expect(loadDevPerfConfig(file)).rejects.toThrow(/compile/);
  });

  it('rejects a quoted boolean where a YAML boolean is expected', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-config-file-'));
    const file = path.join(dir, 'config.yaml');
    await writeFile(file, 'refresh: "true"\n');

    await expect(loadDevPerfConfig(file)).rejects.toThrow(/refresh/);
  });

  it('rejects invalid YAML, naming the file', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-config-file-'));
    const file = path.join(dir, 'config.yaml');
    await writeFile(file, 'repos: [unclosed\n');

    await expect(loadDevPerfConfig(file)).rejects.toThrow(
      new RegExp(`Invalid config file \\(${file}\\)`),
    );
  });

  it('errors on a missing explicit config file', async () => {
    await expect(loadDevPerfConfig('/nonexistent/config.yaml')).rejects.toThrow(
      /config file not found or unreadable: "\/nonexistent\/config.yaml"/,
    );
  });

  it('keeps the committed config.example.yaml valid for report and compile', async () => {
    // The example config is the starting point users copy; it must load
    // and stay valid for both commands to resolve their options.
    const example = new URL('../config.example.yaml', import.meta.url);
    const config = await loadDevPerfConfig(example.pathname, {
      DEV_PERF_MODEL: 'gpt-4.1',
      DEV_PERF_PROVIDER_URL: 'https://api.openai.com/v1',
      DEV_PERF_API_KEY: 'token',
    });
    expect(config['llm']).toBe(false);

    const report = parseReportOptions(resolveReportOptions(config));
    expect(report.repos.length).toBeGreaterThan(0);
    expect(report.since).toBeDefined();

    const compile = parseCompileOptions(resolveCompileOptions(config));
    expect(compile.report).toBe('output/report.json');
    expect(compile.output).toBe('output/report');
  });
});
