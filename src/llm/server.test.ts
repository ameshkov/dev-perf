import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createOpencode } from '@opencode-ai/sdk';
import type { OpencodeClient } from '@opencode-ai/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildFixtureRepo, removeFixtureRepo } from '../../test/fixtures/repo-builder.js';
import { llmDir, opencodeDir } from '../repo/cache.js';
import { buildReportToolSource } from './tools.js';
import {
  ANALYST_AGENT_ID,
  generateOpencodeConfig,
  startServer,
  writeServerFiles,
} from './server.js';
import type { LlmServerConfig } from './server.js';

// `startServer`'s lifecycle tests stub the SDK's server launch while
// the smoke test below still gets the real implementation (the mock
// factory passes it through).
vi.mock('@opencode-ai/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@opencode-ai/sdk')>();
  return { ...actual, createOpencode: vi.fn(actual.createOpencode) };
});

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

/**
 * Returns a localhost TCP port nothing is listening on: a listener is
 * bound to an ephemeral port and immediately closed. Used to fake the
 * server URL in lifecycle tests, so `waitForServerExit` sees a dead
 * port without risking a real force-kill.
 *
 * @returns A currently-free port number.
 */
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (address === null || typeof address === 'string') {
    throw new Error('no port assigned');
  }
  return address.port;
}

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

  it('keeps the global read-only permission as defense in depth', () => {
    const config = generateOpencodeConfig(CONFIG);
    expect(config.permission).toEqual({
      edit: 'deny',
      bash: 'allow',
      webfetch: 'deny',
      external_directory: 'deny',
    });
  });

  it('does not declare the agent in the config (it lives in .opencode/agents)', () => {
    const config = generateOpencodeConfig(CONFIG);
    expect(config.agent).toBeUndefined();
  });
});

describe('writeServerFiles', () => {
  it('writes the generated files into the cache opencode/ dir and the clone', async () => {
    const cloneDir = path.join(tmpRoot, 'entry', 'repo');
    await mkdir(cloneDir, { recursive: true });

    const generated = generateOpencodeConfig(CONFIG);
    await writeServerFiles(cloneDir, generated);

    const entryDir = path.dirname(cloneDir);
    const expectedConfig = `${JSON.stringify(generated, null, 2)}\n`;
    const expectedTool = buildReportToolSource(llmDir(entryDir));
    const expectedAgent = await readFile(
      new URL('./agents/devperf-analyst.md', import.meta.url),
      'utf8',
    );

    // Cache entry layout: opencode/ holds the generated files.
    const cacheConfig = await readFile(path.join(opencodeDir(entryDir), 'opencode.json'), 'utf8');
    const cacheTool = await readFile(
      path.join(opencodeDir(entryDir), 'tools', 'devperf_report.ts'),
      'utf8',
    );
    const cacheAgent = await readFile(
      path.join(opencodeDir(entryDir), 'agents', `${ANALYST_AGENT_ID}.md`),
      'utf8',
    );
    expect(cacheConfig).toBe(expectedConfig);
    expect(cacheTool).toBe(expectedTool);
    expect(cacheAgent).toBe(expectedAgent);

    // The clone gets copies the server discovers at startup.
    const cloneConfig = await readFile(path.join(cloneDir, 'opencode.json'), 'utf8');
    const cloneTool = await readFile(
      path.join(cloneDir, '.opencode', 'tools', 'devperf_report.ts'),
      'utf8',
    );
    const cloneAgent = await readFile(
      path.join(cloneDir, '.opencode', 'agents', `${ANALYST_AGENT_ID}.md`),
      'utf8',
    );
    expect(cloneConfig).toBe(cacheConfig);
    expect(cloneTool).toBe(cacheTool);
    expect(cloneAgent).toBe(cacheAgent);
  });

  it('writes the agent definition following the opencode agent-file spec', async () => {
    const cloneDir = path.join(tmpRoot, 'entry', 'repo');
    await mkdir(cloneDir, { recursive: true });

    await writeServerFiles(cloneDir, generateOpencodeConfig(CONFIG));

    const agentFile = await readFile(
      path.join(cloneDir, '.opencode', 'agents', `${ANALYST_AGENT_ID}.md`),
      'utf8',
    );
    // The file name is the agent name; frontmatter carries description,
    // mode, and the permission surface; the body is the prompt.
    expect(agentFile.startsWith('---\n')).toBe(true);
    expect(agentFile).toContain('description: Read-only dev-perf contributor analysis agent');
    expect(agentFile).toContain('mode: primary');
    // Permissions are deny-all with a short allow-list: the wildcard deny
    // comes first (opencode matches rules last-wins), then the read tools,
    // bash restricted to read-only commands, and devperf_report.
    expect(agentFile).toContain('"*": deny');
    expect(agentFile).toContain('read: allow');
    expect(agentFile).toContain('glob: allow');
    expect(agentFile).toContain('grep: allow');
    expect(agentFile).toContain('list: allow');
    expect(agentFile).toContain('"git show *": allow');
    expect(agentFile).toContain('"git log *": allow');
    expect(agentFile).toContain('"git diff *": allow');
    expect(agentFile).toContain('"git blame *": allow');
    expect(agentFile).toContain('"git status *": allow');
    expect(agentFile).toContain('"git branch *": allow');
    expect(agentFile).toContain('"git tag *": allow');
    expect(agentFile).toContain('"git rev-parse *": allow');
    expect(agentFile).toContain('"git rev-list *": allow');
    expect(agentFile).toContain('"git shortlog *": allow');
    expect(agentFile).toContain('"git ls-tree *": allow');
    expect(agentFile).toContain('"git ls-files *": allow');
    expect(agentFile).toContain('"git grep *": allow');
    expect(agentFile).toContain('"git describe *": allow');
    expect(agentFile).toContain('"git merge-base *": allow');
    expect(agentFile).toContain('"git cat-file *": allow');
    expect(agentFile).toContain('"cat *": allow');
    expect(agentFile).toContain('"tail *": allow');
    expect(agentFile).toContain('"head *": allow');
    expect(agentFile).toContain('"ls *": allow');
    expect(agentFile).toContain('"wc *": allow');
    expect(agentFile).toContain('"file *": allow');
    expect(agentFile).toContain('"grep *": allow');
    expect(agentFile).toContain('"rg *": allow');
    expect(agentFile).toContain('"sort *": allow');
    expect(agentFile).toContain('"uniq *": allow');
    expect(agentFile).toContain('"cut *": allow');
    expect(agentFile).toContain('"diff *": allow');
    expect(agentFile).toContain('"echo *": allow');
    expect(agentFile).toContain('devperf_report: allow');
    expect(agentFile).toContain('read-only');
    expect(agentFile).toContain('never create, modify, or delete');
    expect(agentFile).toContain('git show, git log, git diff, git blame');
  });
});

describe('startServer close', () => {
  afterEach(() => {
    vi.mocked(createOpencode).mockClear();
  });

  it('stops the SDK server and shuts down the child process', async () => {
    const closeServer = vi.fn();
    const port = await freePort();
    vi.mocked(createOpencode).mockResolvedValueOnce({
      client: {
        auth: { set: vi.fn(async () => undefined) },
      } as unknown as OpencodeClient,
      server: { url: `http://127.0.0.1:${port}`, close: closeServer },
    });

    const handle = await startServer(path.join(tmpRoot, 'entry', 'repo'), CONFIG);
    await handle.close();

    // The SDK SIGTERM path runs first; `waitForServerExit` finds the
    // port closed (nothing listens on the free port) and returns.
    expect(closeServer).toHaveBeenCalledTimes(1);
  });
});

// Lifecycle smoke test: starts and stops a real opencode
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
        // The devperf-analyst agent is defined by the markdown agent file
        // in the clone's .opencode/agents/; a noReply prompt naming it
        // proves the server loaded it.
        const created = await handle.client.session.create({
          query: { directory: repo.dir },
          body: { title: 'smoke' },
        });
        const prompted = await handle.client.session.prompt({
          path: { id: created.data?.id ?? '' },
          query: { directory: repo.dir },
          body: {
            agent: ANALYST_AGENT_ID,
            noReply: true,
            parts: [{ type: 'text', text: 'orientation context' }],
          },
        });
        expect(prompted.error).toBeUndefined();
      } finally {
        await handle.close();
      }
    } finally {
      await removeFixtureRepo(repo);
    }
  }, 60_000);
});
