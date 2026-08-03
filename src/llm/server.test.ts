import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildFixtureRepo, removeFixtureRepo } from '../../test/fixtures/repo-builder.js';
import { llmDir, opencodeDir } from '../repo/cache.js';
import { buildReportToolSource } from './tools.js';
import { generateOpencodeConfig, startServer, writeServerFiles } from './server.js';
import type { LlmServerConfig } from './server.js';

const CONFIG: LlmServerConfig = {
  providerUrl: 'https://llm.example.com/v1',
  model: 'gpt-4.1',
  apiKey: 'sk-test-123',
  limitContext: 262144,
  limitOutput: 65536,
};

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-server-test-'));
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

describe('generateOpencodeConfig', () => {
  it('declares the provider, model, and limit block from the options', () => {
    const config = generateOpencodeConfig(CONFIG);
    expect(config.model).toBe('devperf/gpt-4.1');
    expect(config.provider).toEqual({
      devperf: {
        npm: '@ai-sdk/openai-compatible',
        options: { baseURL: 'https://llm.example.com/v1' },
        models: {
          'gpt-4.1': {
            name: 'gpt-4.1',
            limit: { context: 262144, output: 65536 },
          },
        },
      },
    });
    expect(config.enabled_providers).toEqual(['devperf']);
  });

  it('passes the custom limit options into the model limit block', () => {
    const config = generateOpencodeConfig({
      ...CONFIG,
      limitContext: 131072,
      limitOutput: 8192,
    });
    expect(config.provider?.devperf?.models?.['gpt-4.1']?.limit).toEqual({
      context: 131072,
      output: 8192,
    });
  });

  it('denies the write tools and keeps the analysis read-only', () => {
    const config = generateOpencodeConfig(CONFIG);
    expect(config.permission).toEqual({
      edit: 'deny',
      bash: 'allow',
      webfetch: 'deny',
      external_directory: 'deny',
    });
    expect(config.tools).toEqual({ write: false, edit: false, patch: false });
  });

  it('embeds the read-only analysis rules in the build agent prompt', () => {
    const config = generateOpencodeConfig(CONFIG);
    const prompt = config.agent?.build?.prompt ?? '';
    expect(prompt).toContain('read-only');
    expect(prompt).toContain('never create, modify, or delete files');
    expect(prompt).toContain('git show, git log, git diff, git blame, git status');
    expect(prompt).toContain('devperf_report');
  });
});

describe('writeServerFiles', () => {
  it('writes the generated files into the cache opencode/ dir and the clone', async () => {
    const cloneDir = path.join(tmpRoot, 'entry', 'repo');
    await mkdir(cloneDir, { recursive: true });

    await writeServerFiles(cloneDir, CONFIG);

    const entryDir = path.dirname(cloneDir);
    const expectedConfig = `${JSON.stringify(generateOpencodeConfig(CONFIG), null, 2)}\n`;
    const expectedTool = buildReportToolSource(llmDir(entryDir));

    // Cache entry layout (design §4): opencode/ holds the generated files.
    const cacheConfig = await readFile(path.join(opencodeDir(entryDir), 'opencode.json'), 'utf8');
    const cacheTool = await readFile(
      path.join(opencodeDir(entryDir), 'tools', 'devperf_report.ts'),
      'utf8',
    );
    expect(cacheConfig).toBe(expectedConfig);
    expect(cacheTool).toBe(expectedTool);

    // The clone gets copies the server discovers at startup (design §6.2).
    const cloneConfig = await readFile(path.join(cloneDir, 'opencode.json'), 'utf8');
    const cloneTool = await readFile(
      path.join(cloneDir, '.opencode', 'tools', 'devperf_report.ts'),
      'utf8',
    );
    expect(cloneConfig).toBe(cacheConfig);
    expect(cloneTool).toBe(cacheTool);
  });
});

// Lifecycle smoke test (plan step 7): starts and stops a real opencode
// server against a fixture clone and checks the generated tool loads.
// Requires the `opencode` binary on PATH; skipped in CI. Run manually
// with `DEV_PERF_SMOKE=1 pnpm test -- src/llm/server.test.ts`.
describe.skipIf(process.env.DEV_PERF_SMOKE !== '1')('startServer (manual smoke test)', () => {
  it('starts a server scoped to the clone, loads the tool, and stops cleanly', async () => {
    const repo = await buildFixtureRepo([
      {
        author: { name: 'Alice', email: 'alice@example.com' },
        date: '2026-01-15T10:00:00Z',
        message: 'init',
        files: [{ path: 'a.txt', content: 'hello\n' }],
      },
    ]);
    try {
      const handle = await startServer(repo.dir, CONFIG);
      try {
        expect(handle.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
        const ids = await handle.client.tool.ids({ query: { directory: repo.dir } });
        expect(ids.data).toContain('devperf_report');
        const effective = await handle.client.config.get({ query: { directory: repo.dir } });
        expect(effective.data?.model).toBe('devperf/gpt-4.1');
        expect(Object.keys(effective.data?.provider ?? {})).toEqual(['devperf']);
      } finally {
        await handle.close();
      }
    } finally {
      await removeFixtureRepo(repo);
    }
  }, 60_000);
});
