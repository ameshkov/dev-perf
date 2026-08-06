#!/usr/bin/env node
/**
 * Copies the markdown assets the LLM layer reads at runtime into
 * build/: the prompt templates (src/llm/prompts/*.md) — the
 * orientation/user system prompts and the prompt templates — resolving
 * next to the compiled `build/llm/*.js` modules. prompts.ts resolves
 * the templates relative to the module file, so the compiled output
 * needs them next to the compiled modules. Destinations are cleared
 * first so removed sources never linger in a stale build.
 */
import { cp, rm } from 'node:fs/promises';

await rm('build/llm/prompts', { recursive: true, force: true });
await cp('src/llm/prompts', 'build/llm/prompts', { recursive: true });
// The agent definitions were removed with the migration; drop any stale
// copy from an earlier build.
await rm('build/llm/agents', { recursive: true, force: true });
