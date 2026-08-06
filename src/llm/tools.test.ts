import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Check } from 'typebox/value';
import type { LlmToolPayload } from '../report/index.js';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { buildReportTool, REPORT_TOOL_NAME } from './tools.js';

/** A valid payload the tool must accept and persist. */
const PAYLOAD: LlmToolPayload = {
  overview: 'Shipped the analysis pipeline.',
  contributions: [
    {
      title: 'Add pipeline',
      summary: 'Wired clone to report assembly.',
      types: ['feature'],
      complexity: 'medium',
      complexityReasoning: 'Several modules touched.',
      size: 'm',
      sizeReasoning: 'A few modules touched.',
      areas: ['src'],
      commits: ['abc123'],
      qualitySignals: ['tests-added'],
      riskFlags: ['large-diff'],
    },
  ],
};

/** LLM results directory baked into the schema-level tests. */
const LLM_DIR = '/cache/entry/llm';

/** The `devperf_report` tool for one report id and LLM dir. */
function tool(): ToolDefinition {
  return buildReportTool('ses_123', LLM_DIR);
}

let llmDir: string;

beforeEach(async () => {
  llmDir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-tools-llm-'));
});

afterEach(async () => {
  await rm(llmDir, { recursive: true, force: true });
});

describe('buildReportTool', () => {
  it('returns the devperf_report tool with the model-facing description', () => {
    const built = tool();
    expect(built.name).toBe(REPORT_TOOL_NAME);
    expect(built.label).toBe('dev-perf analysis report');
    expect(built.description).toContain('dev-perf');
    expect(built.description).toContain('contributions');
  });

  it('derives a parameter schema that mirrors the payload schema', () => {
    const built = tool();
    // The full payload — optional overview + required contributions.
    expect(Check(built.parameters, PAYLOAD)).toBe(true);
    expect(Check(built.parameters, { contributions: PAYLOAD.contributions })).toBe(true);
    // Missing required fields and wrong types are rejected.
    expect(Check(built.parameters, { overview: 'x' })).toBe(false);
    expect(Check(built.parameters, { overview: 'x', contributions: [{ title: 42 }] })).toBe(false);
  });

  it('requires every contribution field with its fixed enum lists', () => {
    const built = tool();
    // A contribution with a size outside the fixed list fails.
    const badSize = {
      ...PAYLOAD,
      contributions: [{ ...PAYLOAD.contributions[0]!, size: 'xxl' }],
    };
    expect(Check(built.parameters, badSize)).toBe(false);
    // An unknown work type fails.
    const badType = {
      ...PAYLOAD,
      contributions: [{ ...PAYLOAD.contributions[0]!, types: ['rewrite'] }],
    };
    expect(Check(built.parameters, badType)).toBe(false);
  });
});

describe('report tool execution', () => {
  it('writes the validated payload to <llmDir>/<reportId>.json and returns ok', async () => {
    const built = buildReportTool('ses_123', llmDir);

    const result = await built.execute('tool1', PAYLOAD, undefined, undefined, {} as never);

    expect(result.content).toEqual([{ type: 'text', text: 'ok' }]);
    const written = JSON.parse(
      await readFile(path.join(llmDir, 'ses_123.json'), 'utf8'),
    ) as typeof PAYLOAD;
    expect(written).toEqual(PAYLOAD);
  });

  it('rejects an invalid payload with a readable error and writes nothing', async () => {
    const built = buildReportTool('ses_bad', llmDir);

    const result = await built.execute(
      'tool1',
      { overview: 'x', contributions: [{ title: 42 }] },
      undefined,
      undefined,
      {} as never,
    );

    const text = result.content[0];
    expect(text?.type).toBe('text');
    if (text?.type === 'text') {
      expect(text.text).toContain('devperf_report: invalid analysis payload:');
    }
    await expect(readFile(path.join(llmDir, 'ses_bad.json'), 'utf8')).rejects.toThrow();
  });

  it('degrades a failed report write to a model-visible error instead of throwing', async () => {
    // Point the llm dir at a path whose parent is a file, so mkdir
    // fails; the tool must not throw through pi (which would abort the
    // session) but return a readable error the model can react to.
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-tools-blocked-'));
    try {
      const blockedParent = path.join(tmp, 'blocker');
      await import('node:fs/promises').then((fs) => fs.writeFile(blockedParent, 'file', 'utf8'));
      const built = buildReportTool('ses_blocked', path.join(blockedParent, 'llm'));

      const result = await built.execute('tool1', PAYLOAD, undefined, undefined, {} as never);

      const text = result.content[0];
      expect(text?.type).toBe('text');
      if (text?.type === 'text') {
        expect(text.text).toContain('devperf_report: failed to write report:');
      }
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
