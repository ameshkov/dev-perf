/**
 * Tests for the report loader: v3 pass-through, legacy v1 wrapping,
 * invalid-JSON and schema-mismatch errors, and the File-based loader.
 */
import { describe, expect, it } from 'vitest';
import { buildDemoReport, buildLegacyV1Report } from '../../test/report-builder.js';
import { parseReportText } from './index.js';
import { loadReportFile } from './load.js';

describe('parseReportText', () => {
  it('passes a valid v3 trend report through unchanged', () => {
    const report = buildDemoReport();
    const parsed = parseReportText(JSON.stringify(report), 'report.json');
    expect(parsed).toEqual(report);
  });

  it('wraps a legacy v1 report into a single-period trend report', () => {
    const legacy = buildLegacyV1Report();
    const parsed = parseReportText(JSON.stringify(legacy), 'legacy.json');

    expect(parsed.schemaVersion).toBe(3);
    expect(parsed.periods).toHaveLength(1);
    expect(parsed.periods[0].since).toBe('2026-01-01T00:00:00.000Z');
    expect(parsed.periods[0].until).toBe('2026-03-31T23:59:59.999Z');
    expect(parsed.periods[0].repositories).toHaveLength(1);
    expect(parsed.periods[0].repositories[0].repo).toBe('git@github.com:acme/legacy.git');
    expect(parsed.parameters).toEqual({
      repos: [{ repo: 'git@github.com:acme/legacy.git' }],
      since: '2026-01-01T00:00:00.000Z',
      until: '2026-03-31T23:59:59.999Z',
      llmEnabled: false,
    });
    expect('unit' in parsed.parameters).toBe(false);
    expect(parsed.generatedAt).toBe('2026-03-01T00:00:00.000Z');
  });

  it('rejects invalid JSON with the file name in the error', () => {
    expect(() => parseReportText('{oops', 'broken.json')).toThrow(
      /"broken\.json" is not valid JSON/,
    );
  });

  it('rejects a wrong-shape document with the file name and the first schema issues', () => {
    expect(() => parseReportText(JSON.stringify({ schemaVersion: 9 }), 'odd.json')).toThrow(
      /"odd\.json" is not a dev-perf report/,
    );
    try {
      parseReportText(JSON.stringify({ schemaVersion: 9 }), 'odd.json');
      expect.unreachable('the parse should have thrown');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain('schemaVersion: Invalid input: expected 3');
    }
  });
});

describe('loadReportFile', () => {
  it('parses a report File into a trend report', async () => {
    const file = new File([JSON.stringify(buildDemoReport())], 'report.json', {
      type: 'application/json',
    });
    const parsed = await loadReportFile(file);
    expect(parsed.schemaVersion).toBe(3);
    expect(parsed.periods).toHaveLength(2);
  });

  it('surfaces parse errors with the file name', async () => {
    const file = new File(['not json at all'], 'bad.json');
    await expect(loadReportFile(file)).rejects.toThrow(/"bad\.json" is not valid JSON/);
  });
});
