#!/usr/bin/env node
/**
 * Copies the markdown assets the LLM layer reads at runtime into
 * build/: the prompt templates (src/llm/prompts/*.md) and the
 * devperf-analyst agent definition (src/llm/agents/*.md). prompts.ts
 * resolves the templates relative to the module file and server.ts
 * resolves the agent file the same way, so the compiled output needs
 * both next to the compiled modules. Destinations are cleared first
 * so removed sources never linger in a stale build.
 */
import { cp, rm } from 'node:fs/promises';

for (const [src, dest] of [
  ['src/llm/prompts', 'build/llm/prompts'],
  ['src/llm/agents', 'build/llm/agents'],
]) {
  await rm(dest, { recursive: true, force: true });
  await cp(src, dest, { recursive: true });
}
