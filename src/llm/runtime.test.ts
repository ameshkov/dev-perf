import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { createLlmRuntime } from './runtime.js';
import type { LlmRuntimeConfig } from './runtime.js';

const CONFIG: LlmRuntimeConfig = {
  providerUrl: 'https://llm.example.com/v1',
  model: 'gpt-4.1',
  apiKey: 'sk-test-123',
  limitContext: 262144,
  limitOutput: 65536,
};

let tmpRoot: string;
let cloneDir: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-runtime-test-'));
  cloneDir = path.join(tmpRoot, 'entry', 'repo');
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

describe('createLlmRuntime', () => {
  it('registers the devperf provider and model in code and resolves it', async () => {
    const runtime = await createLlmRuntime(cloneDir, CONFIG);
    try {
      expect(runtime.model.id).toBe(CONFIG.model);
      expect(runtime.model.provider).toBe('devperf');
      expect(runtime.model.baseUrl).toBe(CONFIG.providerUrl);
      expect(runtime.model.contextWindow).toBe(CONFIG.limitContext);
      expect(runtime.model.maxTokens).toBe(CONFIG.limitOutput);
      expect(runtime.agentDir).toBe(path.join(tmpRoot, 'entry', 'pi', 'home'));
      // The runtime auth is configured via the in-memory API key.
      expect(runtime.modelRuntime.getProviderAuthStatus('devperf').configured).toBe(true);
    } finally {
      await runtime.dispose();
    }
  });

  it('runs fully in memory: never creates the agent home or writes any file', async () => {
    const runtime = await createLlmRuntime(cloneDir, CONFIG);
    try {
      // The agentDir is a pure logical path (isolation from the user's
      // real ~/.pi); it is never created, and neither is anything else
      // in the cache entry — the store, provider, and model are all set
      // up in code.
      expect(existsSync(runtime.agentDir)).toBe(false);
      const entryDir = path.dirname(cloneDir);
      expect(existsSync(entryDir)).toBe(false);
      expect(runtime.modelRuntime.getProviderAuthStatus('devperf').source).toBe('runtime');
    } finally {
      await runtime.dispose();
    }
  });

  it('dispose removes the in-memory runtime API key', async () => {
    const runtime = await createLlmRuntime(cloneDir, CONFIG);
    expect(runtime.modelRuntime.getProviderAuthStatus('devperf').configured).toBe(true);

    await runtime.dispose();

    expect(runtime.modelRuntime.getProviderAuthStatus('devperf').configured).toBe(false);
  });

  it('throws a readable error when the model cannot be resolved', async () => {
    // A provider registration that silently registers a different
    // model id leaves `getModel('devperf', config.model)` undefined —
    // the defensive guard must surface a readable error.
    const register = ModelRuntime.prototype.registerProvider;
    const spy = vi.spyOn(ModelRuntime.prototype, 'registerProvider').mockImplementation(function (
      this: ModelRuntime,
      id: string,
      config: Parameters<typeof ModelRuntime.prototype.registerProvider>[1],
    ) {
      const shifted = {
        ...config,
        models: (config.models ?? []).map((model) => ({
          ...model,
          id: `other-${model.id}`,
        })),
      };
      return register.call(this, id, shifted);
    });
    try {
      await expect(createLlmRuntime(cloneDir, CONFIG)).rejects.toThrow(
        /model "gpt-4\.1" is not available in the "devperf" provider/,
      );
    } finally {
      spy.mockRestore();
    }
  });

  it('cleans up the partially-created runtime when creation fails partway', async () => {
    // The model check throws after the runtime and the in-memory API
    // key were created; createLlmRuntime must still remove the key so a
    // failed attempt leaves no credential behind.
    const register = ModelRuntime.prototype.registerProvider;
    const shifted = vi
      .spyOn(ModelRuntime.prototype, 'registerProvider')
      .mockImplementation(function (
        this: ModelRuntime,
        id: string,
        config: Parameters<typeof ModelRuntime.prototype.registerProvider>[1],
      ) {
        const other = {
          ...config,
          models: (config.models ?? []).map((model) => ({ ...model, id: `other-${model.id}` })),
        };
        return register.call(this, id, other);
      });
    const remove = vi.spyOn(ModelRuntime.prototype, 'removeRuntimeApiKey');
    try {
      await expect(createLlmRuntime(cloneDir, CONFIG)).rejects.toThrow(/not available/);
    } finally {
      shifted.mockRestore();
    }
    expect(remove).toHaveBeenCalledWith('devperf');
    remove.mockRestore();
  });
});
