import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildReportToolSource } from './tools.js';

const LLM_DIR = '/cache/entry/llm';

let tempDir: string;

beforeEach(async () => {
  // The generated module must live inside the project tree so Node
  // resolves its `@opencode-ai/plugin` import from dev-perf's own
  // node_modules — the opencode runtime does the same when it loads
  // the file from the analyzed clone.
  await mkdir(path.join(process.cwd(), '.dev-perf'), { recursive: true });
  tempDir = await mkdtemp(path.join(process.cwd(), '.dev-perf', 'tools-test-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('buildReportToolSource', () => {
  it('returns a self-contained plugin module', () => {
    const source = buildReportToolSource(LLM_DIR);
    expect(source).toContain('import { tool } from "@opencode-ai/plugin";');
    expect(source).toContain('import path from "node:path";');
    expect(source).toContain('import { mkdir, writeFile } from "node:fs/promises";');
    expect(source).toContain('export default tool({');
    expect(source).not.toContain('../report/');
    expect(source).not.toContain('zod');
  });

  it('includes the full payload schema with every field description', () => {
    const source = buildReportToolSource(LLM_DIR);
    for (const field of [
      'overview',
      'contributions',
      'title',
      'summary',
      'types',
      'complexity',
      'complexityReasoning',
      'size',
      'sizeReasoning',
      'areas',
      'commits',
      'qualitySignals',
      'riskFlags',
    ]) {
      expect(source).toContain(`"${field}"`);
    }
    for (const description of [
      "1-2 sentences summarizing the user's work in the analyzed range.",
      'Short name of the contribution.',
      'Kinds of change this contribution mixes: feature, bugfix, refactor, test, docs, tooling, chore, security.',
      'Overall complexity of the contribution: low, medium, or high.',
      'Overall size of the contribution (t-shirt sizing): xs, s, m, l, or xl.',
      'Observable risk flags from the fixed list (no-tests, large-diff, breaking-change, ...)',
    ]) {
      expect(source).toContain(description);
    }
    // Enum-backed fields render the fixed value lists into the schema.
    expect(source).toContain('tool.schema.enum(["tests-added"');
    expect(source).toContain('tool.schema.enum(["no-tests"');
    expect(source).toContain('tool.schema.enum(["xs","s","m","l","xl"])');
  });

  it('keeps optional fields optional and required fields required', () => {
    const source = buildReportToolSource(LLM_DIR);
    expect(source).toContain('"overview": tool.schema.string().describe(');
    expect(source).toContain('.optional(),');
    expect(source).toContain('"contributions": tool.schema.array(');
    const titleLine = source
      .split('\n')
      .find((line) => line.includes('"title": tool.schema.string()'));
    expect(titleLine).toBeDefined();
    expect(titleLine).not.toContain('.optional()');
  });

  it('embeds the report directory and the session-scoped output file', () => {
    const source = buildReportToolSource(LLM_DIR);
    expect(source).toContain(`const REPORT_DIR = "/cache/entry/llm";`);
    expect(source).toContain('`${context.sessionID}.json`');
    expect(source).toContain('return "ok";');
  });

  it('validates the payload with zod before writing', () => {
    const source = buildReportToolSource(LLM_DIR);
    expect(source).toContain('const parsed = payloadSchema.safeParse(args);');
    expect(source).toContain('`devperf_report: invalid analysis payload: ${parsed.error.message}`');
    expect(source).toContain('JSON.stringify(parsed.data, null, 2)');
  });
});

describe('generated tool execution', () => {
  it('writes the validated payload to <llmDir>/<sessionID>.json and returns ok', async () => {
    const llmDir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-tools-llm-'));
    try {
      const module = await importGeneratedTool(llmDir);
      const payload = {
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

      const result = await module.default.execute(payload, { sessionID: 'ses_123' });

      expect(result).toBe('ok');
      const written = JSON.parse(
        await readFile(path.join(llmDir, 'ses_123.json'), 'utf8'),
      ) as typeof payload;
      expect(written).toEqual(payload);
    } finally {
      await rm(llmDir, { recursive: true, force: true });
    }
  });

  it('rejects an invalid payload with a readable error and writes nothing', async () => {
    const llmDir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-tools-llm-'));
    try {
      const module = await importGeneratedTool(llmDir);

      const result = await module.default.execute(
        { overview: 'x', contributions: [{ title: 42 }] },
        { sessionID: 'ses_bad' },
      );

      expect(result).toContain('devperf_report: invalid analysis payload:');
      await expect(readFile(path.join(llmDir, 'ses_bad.json'), 'utf8')).rejects.toThrow();
    } finally {
      await rm(llmDir, { recursive: true, force: true });
    }
  });
});

/**
 * Writes the generated tool source to a temp `.mjs` file inside the
 * project tree and imports it, so `@opencode-ai/plugin` resolves from
 * dev-perf's node_modules (the opencode runtime resolves it from its
 * own embedded copy in production).
 *
 * @param llmDir - LLM results directory to generate the tool for.
 * @returns The imported generated module.
 */
async function importGeneratedTool(llmDir: string): Promise<{
  default: {
    description: string;
    args: Record<string, unknown>;
    execute(args: unknown, context: { sessionID: string }): Promise<string>;
  };
}> {
  const source = buildReportToolSource(llmDir);
  const file = path.join(tempDir, 'devperf_report.mjs');
  await writeFile(file, source, 'utf8');
  const module = (await import(pathToFileURL(file).href)) as {
    default: {
      description: string;
      args: Record<string, unknown>;
      execute(args: unknown, context: { sessionID: string }): Promise<string>;
    };
  };
  expect(module.default.description).toContain('dev-perf');
  expect(Object.keys(module.default.args).sort()).toEqual(['contributions', 'overview']);
  return module;
}
