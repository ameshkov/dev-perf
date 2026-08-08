/**
 * In-process pi runtime for the LLM analysis: `createLlmRuntime`
 * creates an isolated `ModelRuntime` for one clone — the provider and
 * model are registered entirely in code (`modelsPath: null`, so no
 * `models.json` is ever written), and the provider API key is injected
 * through `setRuntimeApiKey`, which keeps the key in memory only. The
 * runtime resolves the `devperf/<model>` entry the session layer hands
 * to `createAgentSession`.
 *
 * Everything is configured in code — nothing is written to disk: the
 * credential store passed to `ModelRuntime.create` is in-memory (pi
 * only writes an `auth.json` when given a file-backed store), so the
 * runtime creates no `pi/` directory in the cache entry at all. The
 * `agentDir` the session layer receives is a pure logical path pointed
 * away from any real `~/.pi` — it is never created and never read, so
 * a failed runtime attempt leaves no orphaned cache state behind.
 */
import path from 'node:path';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { CreateAgentSessionOptions } from '@earendil-works/pi-coding-agent';
import { piHomeDir } from '../repo/cache.js';
import { errorDetail } from '../util/error.js';
import { createScopedLog } from '../util/log.js';
import type { ScopedLog } from '../util/log.js';

/** Provider id under which the `--provider-url`/`--model` pair is registered. */
const PROVIDER_ID = 'devperf';

/** The streaming API used by every OpenAI-compatible provider. */
const PROVIDER_API = 'openai-completions';

/** The model type `createAgentSession` accepts (avoids a pi-ai import path). */
type SessionModel = NonNullable<CreateAgentSessionOptions['model']>;

/** The credential store type `ModelRuntime.create` accepts (avoids a pi-ai import path). */
type CredentialStoreOption = NonNullable<
  NonNullable<Parameters<typeof ModelRuntime.create>[0]>['credentials']
>;

/** pi's stored credential shape, derived from the store's `read` signature. */
type StoredCredential = NonNullable<Awaited<ReturnType<CredentialStoreOption['read']>>>;

/** pi's credential metadata shape, derived from the store's `list` signature. */
type StoredCredentialInfo = Awaited<ReturnType<CredentialStoreOption['list']>>[number];

/** Everything the pi runtime needs, derived from the validated CLI options. */
export interface LlmRuntimeConfig {
  /** OpenAI-compatible provider base URL (`--provider-url`). */
  providerUrl: string;
  /** Model id (`--model`), the model key inside the `devperf` provider. */
  model: string;
  /** Provider API key (`--api-key` or the config `api-key` key). */
  apiKey: string;
  /** Max context tokens (`--limit-context`), the model's `contextWindow`. */
  limitContext: number;
  /** Max output tokens (`--limit-output`), the model's `maxTokens`. */
  limitOutput: number;
}

/** A running in-process pi runtime for one clone. */
export interface LlmRuntime {
  /** The `devperf` model resolved for `createAgentSession`. */
  model: SessionModel;
  /** The underlying pi `ModelRuntime` (provider and auth resolution). */
  modelRuntime: ModelRuntime;
  /**
   * The logical pi agent home (`<entry>/pi/home`). It is never created
   * or read — it only isolates the session layer from the user's real
   * `~/.pi` when `agentDir` is passed to pi.
   */
  agentDir: string;
  /**
   * Releases the runtime: removes the in-memory runtime API key. Sessions
   * created from this runtime must be disposed by their caller before
   * this is called.
   */
  dispose(): Promise<void>;
}

/**
 * A minimal in-memory credential store for `ModelRuntime.create`. pi
 * defaults to a file-backed auth store (`auth.json`); passing a store
 * of our own keeps every credential operation in memory, so
 * `ModelRuntime.create` never touches the disk. dev-perf only injects
 * the API key through `setRuntimeApiKey` (an overlay on top of this
 * store), so the store itself stays empty — it exists purely to prevent
 * pi from persisting anything. The method signatures mirror pi's
 * `CredentialStore` so the object is structurally accepted.
 *
 * @returns An empty in-memory credential store shaped like pi's.
 */
function inMemoryCredentialStore(): CredentialStoreOption {
  const credentials = new Map<string, StoredCredential>();
  const chains = new Map<string, Promise<void>>();
  const enqueue = (providerId: string, fn: () => Promise<void>): Promise<void> => {
    const previous = chains.get(providerId) ?? Promise.resolve();
    const next = (async () => {
      await previous.catch(() => {});
      await fn();
    })();
    chains.set(
      providerId,
      next.catch(() => {}),
    );
    return next;
  };
  return {
    read: (providerId: string) => Promise.resolve(credentials.get(providerId)),
    list: () =>
      Promise.resolve(
        [...credentials.keys()].map((providerId): StoredCredentialInfo => ({
          providerId,
          type: 'api_key',
        })),
      ),
    modify: (
      providerId: string,
      fn: (current: StoredCredential | undefined) => Promise<StoredCredential | undefined>,
    ) =>
      enqueue(providerId, async () => {
        const current = credentials.get(providerId);
        const next = await fn(current);
        if (next !== undefined) {
          credentials.set(providerId, next);
        }
      }).then(() => credentials.get(providerId)),
    delete: (providerId: string) =>
      enqueue(providerId, async () => {
        credentials.delete(providerId);
      }),
  };
}

/**
 * Creates the in-process pi runtime for one clone: creates an in-memory
 * `ModelRuntime` with no `models.json` and an in-memory credential
 * store (so nothing is written to disk), registers the `devperf`
 * provider and model from `--provider-url`/`--model`/the token limits,
 * injects the API key (never written to disk), and resolves the model.
 * The agent home stays a logical path under the cache entry so the
 * session layer never reads the user's real `~/.pi`.
 *
 * @param cloneDir - The clone's working tree (`<cache>/<hash>/repo`).
 * @param config - LLM runtime configuration.
 * @param log - The repository's scoped logger (defaults to the global
 * logger).
 * @returns The ready runtime.
 * @throws {Error} When the runtime cannot be created or the model
 * cannot be resolved.
 */
export async function createLlmRuntime(
  cloneDir: string,
  config: LlmRuntimeConfig,
  log: ScopedLog = createScopedLog(),
): Promise<LlmRuntime> {
  const agentDir = piHomeDir(path.dirname(cloneDir));
  log.progress(`LLM runtime: creating the in-process pi runtime (model "${config.model}")`);
  let runtime: ModelRuntime | undefined;
  try {
    runtime = await ModelRuntime.create({
      // The provider and model are registered in code below; `null`
      // means no generated `models.json` is written or read.
      modelsPath: null,
      // Keeps every credential in memory so no `auth.json` is ever
      // written, and the isolated agent home is never created on disk.
      credentials: inMemoryCredentialStore(),
    });
    runtime.registerProvider(PROVIDER_ID, {
      name: 'dev-perf',
      baseUrl: config.providerUrl,
      api: PROVIDER_API,
      models: [
        {
          id: config.model,
          name: config.model,
          reasoning: false,
          input: ['text'],
          // dev-perf does not track cost; the model is registered with
          // zero rates so reported usage stays token-only.
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: config.limitContext,
          maxTokens: config.limitOutput,
        },
      ],
    });
    // `setRuntimeApiKey` keeps the key in a non-persistent in-memory
    // overlay; it is never written to disk.
    await runtime.setRuntimeApiKey(PROVIDER_ID, config.apiKey);
    const model = runtime.getModel(PROVIDER_ID, config.model);
    if (model === undefined) {
      throw new Error(`model "${config.model}" is not available in the "devperf" provider`);
    }
    log.progress(`LLM runtime: ready (model "${config.model}")`);
    return {
      model,
      modelRuntime: runtime,
      agentDir,
      async dispose(): Promise<void> {
        await runtime?.removeRuntimeApiKey(PROVIDER_ID).catch(() => {});
      },
    };
  } catch (error) {
    // Best-effort: release a partially-created runtime so a failed
    // attempt leaves no in-memory API key installed. Nothing was ever
    // written to disk, so there is no cache state to clean up.
    await runtime?.removeRuntimeApiKey(PROVIDER_ID).catch(() => {});
    throw new Error(`Failed to create the pi LLM runtime for ${cloneDir}: ${errorDetail(error)}`, {
      cause: error,
    });
  }
}
