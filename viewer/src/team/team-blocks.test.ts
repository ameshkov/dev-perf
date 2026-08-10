/**
 * Tests for the team block builders: group inventories and gating,
 * tag lists, and the exact series of selected blocks, against the
 * shared demo report and a deterministic-only variant.
 */
import { describe, expect, it } from 'vitest';
import { buildDemoReport, buildTrendReport } from '../../test/report-builder.js';
import { buildChartData } from '../data/index.js';
import type { ChartBlockDescriptor } from '../components/index.js';
import { buildTeamActivityBlocks, buildTeamWorkBlocks } from './team-blocks.js';
import {
  buildLlmActivityBlocks,
  buildLlmSignalBlocks,
  buildLlmWorkBlocks,
} from './team-blocks-llm.js';
import { buildDistributionBlocks } from './team-blocks-dist.js';

const data = buildChartData(buildDemoReport());
const deterministic = buildChartData(buildDemoReport({ llmEnabled: false }));
const labels = ['2026-01', '2026-02'];

/** A loosely typed view of one series entry for assertions. */
type AnySeries = Record<string, unknown>;

/**
 * Extracts the series of a descriptor's option.
 *
 * @param descriptor - The block under test.
 * @param selected - The tag selection to build with.
 * @returns The series entries.
 */
function seriesOf(descriptor: ChartBlockDescriptor, selected?: ReadonlySet<string>): AnySeries[] {
  const option = descriptor.optionOf(selected);
  return option.series as unknown as AnySeries[];
}

/**
 * Finds one descriptor by id, failing loudly when it is missing.
 *
 * @param descriptors - The block list.
 * @param id - The block id.
 * @returns The descriptor.
 */
function blockById(descriptors: ChartBlockDescriptor[], id: string): ChartBlockDescriptor {
  const found = descriptors.find((descriptor) => descriptor.id === id);
  if (found === undefined) {
    throw new Error(`block "${id}" is missing`);
  }
  return found;
}

describe('buildTeamActivityBlocks', () => {
  it('builds the deterministic activity blocks plus the repo comparison for multi-repo reports', () => {
    const blocks = buildTeamActivityBlocks(data, labels);
    expect(blocks.map((block) => block.id)).toEqual([
      'team-commits',
      'team-lines',
      'team-active-users',
      'team-repos',
    ]);
  });

  it('omits the repo comparison for single-repo reports', () => {
    const single = buildChartData(buildTrendReport());
    const blocks = buildTeamActivityBlocks(
      single,
      single.periods.map((period) => period.label),
    );
    expect(blocks.map((block) => block.id)).toEqual([
      'team-commits',
      'team-lines',
      'team-active-users',
    ]);
  });

  it('labels the repository chips with the short chart legend names', () => {
    const repos = blockById(buildTeamActivityBlocks(data, labels), 'team-repos');
    expect(repos.tags).toEqual([
      { key: 'git@github.com:acme/api.git', value: 17 },
      { key: 'https://github.com/acme/web.git', value: 6 },
    ]);
    expect(repos.labelOf?.('git@github.com:acme/api.git')).toBe('api');
    expect(repos.labelOf?.('https://github.com/acme/web.git')).toBe('web');
  });

  it('spans the repository comparison across the full chart grid', () => {
    const repos = blockById(buildTeamActivityBlocks(data, labels), 'team-repos');
    expect(repos.wide).toBe(true);
  });

  it('builds the exact commits series with its cumulative line', () => {
    const series = seriesOf(blockById(buildTeamActivityBlocks(data, labels), 'team-commits'));
    expect(series).toHaveLength(2);
    expect(series[0]).toMatchObject({ type: 'bar', name: 'Commits', data: [13, 10] });
    expect(series[1]).toMatchObject({ type: 'line', name: 'Cumulative', data: [13, 23] });
  });
});

describe('buildTeamWorkBlocks', () => {
  it('builds the languages block', () => {
    const blocks = buildTeamWorkBlocks(data, labels);
    expect(blocks.map((block) => block.id)).toEqual(['team-languages']);
  });

  it('lists all languages as tags and stacks only the selected ones', () => {
    const [languages] = buildTeamWorkBlocks(data, labels);
    expect(languages.tags).toEqual([
      { key: 'TypeScript', value: 140 },
      { key: 'Python', value: 120 },
      { key: 'CSS', value: 40 },
      { key: 'Go', value: 25 },
    ]);
    const series = seriesOf(languages, new Set(['CSS']));
    expect(series).toHaveLength(1);
    expect(series[0]).toMatchObject({ name: 'CSS', data: [30, 10] });
  });
});

describe('buildLlmActivityBlocks', () => {
  it('builds the points and contributions blocks', () => {
    const blocks = buildLlmActivityBlocks(data, labels);
    expect(blocks.map((block) => block.id)).toEqual(['team-points', 'team-contributions']);
  });

  it('builds the exact weighted-points series with the gradient fill', () => {
    const [series] = seriesOf(blockById(buildLlmActivityBlocks(data, labels), 'team-points'));
    expect(series).toMatchObject({ type: 'bar', name: 'Points', data: [6.5, 16] });
    const color = (series.itemStyle as Record<string, unknown>).color as Record<string, unknown>;
    expect(color.type).toBe('linear');
  });
});

describe('buildLlmWorkBlocks', () => {
  it('builds the work-type, size and complexity blocks', () => {
    const blocks = buildLlmWorkBlocks(data, labels);
    expect(blocks.map((block) => block.id)).toEqual([
      'team-work-types',
      'team-sizes',
      'team-complexity',
    ]);
  });
});

describe('buildLlmSignalBlocks', () => {
  it('builds the per-period shares full-width and the rates single-column', () => {
    const blocks = buildLlmSignalBlocks(data, labels);
    expect(blocks.map((block) => block.id)).toEqual([
      'team-risk-per-period',
      'team-quality-per-period',
      'team-risk-rate',
      'team-quality-rate',
    ]);
    expect(blocks.map((block) => block.wide)).toEqual([true, true, undefined, undefined]);
  });

  it('computes each selected quality signal share per period', () => {
    const quality = blockById(buildLlmSignalBlocks(data, labels), 'team-quality-per-period');
    expect(quality.tags).toEqual(data.tallies.quality);
    const series = seriesOf(quality, new Set(['tests-added']));
    expect(series).toHaveLength(1);
    expect(series[0]).toMatchObject({ name: 'tests-added' });
    expect(series[0].data).toEqual([100, 0]);
  });

  it('computes the flag density per contribution', () => {
    const blocks = buildLlmSignalBlocks(data, labels);
    const [riskRate] = seriesOf(blockById(blocks, 'team-risk-rate'));
    expect(riskRate.data).toEqual([0.5, 2]);
    const [qualityRate] = seriesOf(blockById(blocks, 'team-quality-rate'));
    expect(qualityRate.data).toEqual([1.5, 1]);
  });
});

describe('buildDistributionBlocks', () => {
  it('builds the three whole-range donuts with canonical category order', () => {
    const blocks = buildDistributionBlocks(data);
    expect(blocks.map((block) => block.id)).toEqual([
      'team-dist-work-types',
      'team-dist-sizes',
      'team-dist-complexity',
    ]);

    const sizes = blocks[1].optionOf(undefined).series as unknown as AnySeries[];
    expect(sizes[0].data).toEqual([
      { name: 'xs', value: 0, itemStyle: { color: '#7dd3fc' } },
      { name: 's', value: 1, itemStyle: { color: '#60a5fa' } },
      { name: 'm', value: 1, itemStyle: { color: '#818cf8' } },
      { name: 'l', value: 0, itemStyle: { color: '#a78bfa' } },
      { name: 'xl', value: 1, itemStyle: { color: '#c084fc' } },
    ]);

    const complexity = blocks[2].optionOf(undefined).series as unknown as AnySeries[];
    expect(complexity[0].data).toEqual([
      { name: 'low', value: 1, itemStyle: { color: '#34d399' } },
      { name: 'medium', value: 1, itemStyle: { color: '#fbbf24' } },
      { name: 'high', value: 1, itemStyle: { color: '#f87171' } },
    ]);
  });

  it('renders empty slices for a deterministic-only report', () => {
    const blocks = buildDistributionBlocks(deterministic);
    const donut = blocks[1].optionOf(undefined).series as unknown as AnySeries[];
    expect(donut[0].data).toEqual([
      { name: 'xs', value: 0, itemStyle: { color: '#7dd3fc' } },
      { name: 's', value: 0, itemStyle: { color: '#60a5fa' } },
      { name: 'm', value: 0, itemStyle: { color: '#818cf8' } },
      { name: 'l', value: 0, itemStyle: { color: '#a78bfa' } },
      { name: 'xl', value: 0, itemStyle: { color: '#c084fc' } },
    ]);
  });
});
