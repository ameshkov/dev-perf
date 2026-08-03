/**
 * opencode-as-a-library server lifecycle: `startServer` prepares the
 * generated `opencode.json`
 * and the `devperf_report` tool inside the analyzed clone, launches an
 * opencode server scoped to that clone with `createOpencode()`, and
 * injects the provider API key programmatically via `client.auth.set()`
 * — the key is never written to a file.
 *
 * Isolation (verified against opencode 1.18.x): the SDK spawns
 * `opencode serve` inheriting this process's environment, and opencode
 * *merges* config sources (global `~/.config/opencode/`, project
 * `opencode.json`, `OPENCODE_CONFIG_CONTENT` — the highest priority).
 * To guarantee the user's global opencode configuration never reaches
 * the analysis, the spawn runs with `HOME`/`XDG_CONFIG_HOME` pointed at
 * an empty temp directory (so no global config, plugins, or stored
 * auth can be found) and with `OPENCODE_CONFIG*` / server-auth vars
 * cleared; `enabled_providers` additionally pins the provider set.
 * Both the environment and the process cwd (the server's project
 * directory is fixed at spawn time) are restored immediately after the
 * server is up.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createOpencode } from '@opencode-ai/sdk';
import type { Config as OpencodeConfig } from '@opencode-ai/sdk';
import type { OpencodeClient } from '@opencode-ai/sdk';
import { llmDir, opencodeDir } from '../repo/cache.js';
import { buildReportToolSource } from './tools.js';
import { logInfo } from '../util/log.js';

/** Provider id under which the `--provider-url`/`--model` pair is registered. */
const PROVIDER_ID = 'devperf';

/** npm package opencode uses for OpenAI-compatible providers. */
const PROVIDER_NPM = '@ai-sdk/openai-compatible';

/** How long to wait for the spawned server to report its URL. */
const SERVER_START_TIMEOUT_MS = 30_000;

/**
 * Environment variables that must not reach the spawned server: config
 * file overrides and server-auth settings (the SDK sets its own
 * `OPENCODE_CONFIG_CONTENT`; the rest would load user config or lock
 * the server behind a password the SDK client cannot present).
 */
const BLOCKED_ENV_VARS = [
  'OPENCODE_CONFIG',
  'OPENCODE_CONFIG_DIR',
  'OPENCODE_SERVER_PASSWORD',
  'OPENCODE_SERVER_TOKEN',
];

/**
 * Read-only analysis rules injected into the server's `build` agent
 * prompt: the agent inspects history with read tools and
 * read-only git commands and never modifies anything.
 */
const ANALYSIS_RULES =
  'You are analyzing git history for dev-perf, a developer-contribution analyzer. ' +
  'The analysis is read-only: never create, modify, or delete files, and never stage, ' +
  'commit, or push changes. Inspect commits and diffs with the read tools (read, grep, ' +
  'glob, ls) and read-only git commands through bash (git show, git log, git diff, git ' +
  'blame, git status). When the analysis is complete, call the devperf_report tool with ' +
  'the final analysis before finishing.';

/**
 * Everything the LLM server needs to run one analysis, derived from
 * the validated CLI options.
 */
export interface LlmServerConfig {
  /** OpenAI-compatible provider base URL (`--provider-url`). */
  providerUrl: string;
  /** Model id (`--model`), the model key inside the `devperf` provider. */
  model: string;
  /** Provider API key (`--api-key` or `DEV_PERF_API_KEY`). */
  apiKey: string;
  /** Max context tokens (`--limit-context`), the model's `limit.context`. */
  limitContext: number;
  /** Max output tokens (`--limit-output`), the model's `limit.output`. */
  limitOutput: number;
}

/**
 * A running LLM server; `close` shuts it down and removes its isolated
 * state directory.
 */
export interface LlmServerHandle {
  /** Type-safe client for the running server. */
  client: OpencodeClient;
  /** Server base URL, e.g. `http://127.0.0.1:4096`. */
  url: string;
  /** Stops the server and cleans up its isolated state directory. */
  close(): Promise<void>;
}

/**
 * Builds the isolated opencode config: the provider with
 * the given base URL, the model with the `limit` block from
 * `--limit-context`/`--limit-output`, read-only permissions that deny
 * the write tools, the analysis rules, and an `enabled_providers`
 * pin so no other provider can leak in through config merging.
 *
 * @param config - LLM server configuration.
 * @returns The opencode config document.
 *
 * @internal Exported for tests only (`server.test.ts` golden checks);
 * also used by `writeServerFiles` and `startServer` within the module.
 * Not part of the public module API.
 */
export function generateOpencodeConfig(config: LlmServerConfig): OpencodeConfig {
  return {
    model: `${PROVIDER_ID}/${config.model}`,
    provider: {
      [PROVIDER_ID]: {
        npm: PROVIDER_NPM,
        options: { baseURL: config.providerUrl },
        models: {
          [config.model]: {
            name: config.model,
            limit: { context: config.limitContext, output: config.limitOutput },
          },
        },
      },
    },
    enabled_providers: [PROVIDER_ID],
    permission: {
      edit: 'deny',
      bash: 'allow',
      webfetch: 'deny',
      external_directory: 'deny',
    },
    tools: { write: false, edit: false, patch: false },
    agent: { build: { prompt: ANALYSIS_RULES } },
  };
}

/**
 * Writes the generated opencode files: the
 * `opencode.json` and the `devperf_report` tool source land in the
 * cache entry's `opencode/` directory (the layout's generated-files
 * home) and are copied into the clone, where the server discovers
 * them — the project `opencode.json` and `.opencode/tools/`. A repo's
 * own `opencode.json` is overwritten; the clone is a disposable cache
 * artifact and the file is regenerated on every server start.
 *
 * @param cloneDir - The clone's working tree (`<cache>/<hash>/repo`).
 * @param config - LLM server configuration.
 *
 * @internal Exported for tests only (`server.test.ts` layout checks);
 * also called by `startServer` within the module. Not part of the
 * public module API.
 */
export async function writeServerFiles(cloneDir: string, config: LlmServerConfig): Promise<void> {
  const entryDir = path.dirname(cloneDir);
  const generatedDir = opencodeDir(entryDir);
  const configText = `${JSON.stringify(generateOpencodeConfig(config), null, 2)}\n`;
  const toolSource = buildReportToolSource(llmDir(entryDir));

  await writeText(generatedDir, 'opencode.json', configText);
  await writeText(path.join(generatedDir, 'tools'), 'devperf_report.ts', toolSource);
  await writeText(cloneDir, 'opencode.json', configText);
  await writeText(path.join(cloneDir, '.opencode', 'tools'), 'devperf_report.ts', toolSource);
}

/**
 * Starts the LLM server for one clone: writes the generated files,
 * spawns `opencode serve` with the isolated environment and cwd = the
 * clone, injects the API key, and returns a handle. The server is the
 * caller's to close (`handle.close()`); on startup failure the temp
 * isolation state is removed and the error is rethrown with a hint
 * about the `opencode` binary.
 *
 * @param cloneDir - The clone's working tree (`<cache>/<hash>/repo`).
 * @param config - LLM server configuration.
 * @returns The running server handle.
 * @throws {Error} When the server cannot be started (e.g. the `opencode`
 * binary is missing, or startup times out).
 */
export async function startServer(
  cloneDir: string,
  config: LlmServerConfig,
): Promise<LlmServerHandle> {
  await writeServerFiles(cloneDir, config);
  const tempHome = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-opencode-'));
  const restoreEnvironment = isolateEnvironment(tempHome);
  const cwd = process.cwd();
  let started = false;
  try {
    // The SDK spawns the server inheriting our cwd, and the server's
    // project directory is fixed at spawn time — so chdir into the
    // clone for the spawn and restore right after (verified against
    // opencode 1.18.11).
    process.chdir(cloneDir);
    const { client, server } = await createOpencode({
      hostname: '127.0.0.1',
      port: 0,
      timeout: SERVER_START_TIMEOUT_MS,
      config: generateOpencodeConfig(config),
    });
    started = true;
    await client.auth.set({
      path: { id: PROVIDER_ID },
      body: { type: 'api', key: config.apiKey },
    });
    logInfo(`LLM server: ${server.url} (model ${config.model})`);
    return {
      client,
      url: server.url,
      async close(): Promise<void> {
        server.close();
        await rm(tempHome, { recursive: true, force: true });
      },
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to start the opencode server for ${cloneDir}: ${detail}. ` +
        'Is the opencode CLI installed and on PATH?',
      { cause: error },
    );
  } finally {
    restoreEnvironment();
    process.chdir(cwd);
    if (!started) {
      await rm(tempHome, { recursive: true, force: true });
    }
  }
}

/**
 * Writes one text file, creating parent directories as needed.
 *
 * @param dir - Parent directory of the file.
 * @param name - File name.
 * @param content - File content.
 */
async function writeText(dir: string, name: string, content: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), content, 'utf8');
}

/**
 * Points `HOME`/`XDG_CONFIG_HOME` at an empty temp directory (so no
 * global opencode config can be found) and clears the blocked
 * opencode environment variables for the upcoming spawn. Returns a
 * restore function that puts every touched variable back.
 *
 * @param tempHome - The empty temp directory to use as `HOME`.
 * @returns A function restoring the previous environment.
 */
function isolateEnvironment(tempHome: string): () => void {
  const saved = new Map<string, string | undefined>();
  for (const name of [...BLOCKED_ENV_VARS, 'HOME', 'XDG_CONFIG_HOME']) {
    saved.set(name, process.env[name]);
  }
  for (const name of BLOCKED_ENV_VARS) {
    delete process.env[name];
  }
  process.env.HOME = tempHome;
  process.env.XDG_CONFIG_HOME = path.join(tempHome, '.config');
  return () => {
    for (const [name, value] of saved) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  };
}
