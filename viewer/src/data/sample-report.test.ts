/**
 * Integration anchor: the bundled sample artifact under `public/`
 * parses through the real loader and extracts into real chart data —
 * six periods, two repositories, five identities.
 */
import { readFileSync } from 'node:fs';
// Node's own URL class: jsdom's global URL resolves `file://` bases
// against the window URL and breaks the relative sample path.
import { URL as NodeURL, fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseReportText } from '../report/index.js';
import { buildChartData } from './index.js';

const samplePath = fileURLToPath(
  new NodeURL('../../public/samples/sample-report.json', import.meta.url),
);
const sampleText = readFileSync(samplePath, 'utf8');

describe('the bundled sample report', () => {
  const report = parseReportText(sampleText, 'sample-report.json');
  const data = buildChartData(report);

  it('spans six monthly periods across two repositories', () => {
    expect(report.schemaVersion).toBe(3);
    expect(report.parameters.unit).toBe('month');
    expect(data.periods).toHaveLength(6);
    expect(data.periods.map((period) => period.label)).toEqual([
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
    ]);
    expect(data.repos).toHaveLength(2);
    expect(data.parameters.repos).toHaveLength(2);
  });

  it('assesses five identities with the LLM', () => {
    expect(data.parameters.llmEnabled).toBe(true);
    expect(data.users).toHaveLength(5);
    expect(data.totals.contributions).toBeGreaterThan(0);
    expect(data.totals.weightedPoints).toBeGreaterThan(0);
  });

  it('carries positive totals and a defined bus factor', () => {
    expect(data.totals.commits).toBeGreaterThan(0);
    expect(data.totals.linesAdded).toBeGreaterThan(0);
    expect(data.totals.filesTouched).toBeGreaterThan(0);
    expect(data.busFactor).toBeDefined();
    expect(data.busFactor?.users.length ?? 0).toBeGreaterThan(0);
    expect(data.busFactor?.commitShare ?? 0).toBeGreaterThanOrEqual(0.5);
  });
});
