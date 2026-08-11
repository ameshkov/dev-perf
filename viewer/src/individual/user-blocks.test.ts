/**
 * Tests for the per-user chart group inventory and its gates: the LLM
 * flag, the presence of contributions, and multi-period reports.
 */
import { describe, expect, it } from 'vitest';
import {
  buildContribution,
  buildDemoReport,
  buildLlm,
  buildRepository,
  buildTrendReport,
  buildUser,
} from '../../test/report-builder.js';
import { buildChartData } from '../data/index.js';
import type { ChartBlockDescriptor, ChartGroupDescriptor } from '../components/index.js';
import { buildUserGroups } from './user-blocks.js';

const data = buildChartData(buildDemoReport());

/** The activity block ids of a multi-period LLM user, in order. */
const ACTIVITY_IDS = ['user-points', 'user-contributions-cumulative', 'user-commits', 'user-lines'];

/** The nature-of-work block ids of a multi-period LLM user, in order. */
const WORK_IDS = [
  'user-sizes-per-period',
  'user-complexity-per-period',
  'user-work-types-per-period',
  'user-sizes',
  'user-complexity',
  'user-work-types',
  'user-languages',
];

/** The signal block ids of a multi-period LLM user, in order. */
const SIGNAL_IDS = [
  'user-risk-per-period',
  'user-quality-per-period',
  'user-risk-rate',
  'user-quality-rate',
];

/** Period bounds for one- and two-period fixtures. */
const BOUNDS = [
  { since: '2026-01-01T00:00:00.000Z', until: '2026-01-31T23:59:59.999Z' },
  { since: '2026-02-01T00:00:00.000Z', until: '2026-02-28T23:59:59.999Z' },
];

/**
 * Builds chart data of one user with controlled contributions, in one
 * or two monthly periods.
 *
 * @param periods - How many periods the report spans.
 * @param contributions - The contributions of the user per period.
 * @param llmEnabled - The LLM flag of the report.
 * @returns The chart data of the fixture report.
 */
function fixtureData(periods: number, contributions: number, llmEnabled: boolean) {
  const user = buildUser({
    name: 'Casey',
    llm: buildLlm({
      contributions: Array.from({ length: contributions }, () => buildContribution()),
    }),
  });
  return buildChartData(
    buildTrendReport({
      llmEnabled,
      ...(periods > 1 ? { unit: 'month' as const } : {}),
      periods: BOUNDS.slice(0, periods).map((range) => ({
        ...range,
        repositories: [buildRepository({ range, users: [user] })],
      })),
    }),
  );
}

/**
 * The blocks of one group by id, failing loudly when it is missing.
 *
 * @param groups - The group list.
 * @param id - The group id.
 * @returns The group's block ids.
 */
function blockIdsOf(groups: ChartGroupDescriptor[], id: string): string[] {
  const group = groups.find((entry) => entry.id === id);
  if (group === undefined) {
    throw new Error(`group "${id}" is missing`);
  }
  return group.blocks.map((block) => block.id);
}

/**
 * Finds one block by id across every group.
 *
 * @param groups - The group list.
 * @param id - The block id.
 * @returns The descriptor.
 */
function blockById(groups: ChartGroupDescriptor[], id: string): ChartBlockDescriptor {
  const found = groups.flatMap((group) => group.blocks).find((block) => block.id === id);
  if (found === undefined) {
    throw new Error(`block "${id}" is missing`);
  }
  return found;
}

describe('buildUserGroups', () => {
  it('builds the activity, work and signal groups for a multi-period LLM report', () => {
    const alice = data.users[0];
    const groups = buildUserGroups(alice, data);
    expect(groups.map((group) => group.id)).toEqual(['user-activity', 'user-work', 'user-signals']);
    expect(blockIdsOf(groups, 'user-activity')).toEqual(ACTIVITY_IDS);
    expect(blockIdsOf(groups, 'user-work')).toEqual(WORK_IDS);
    expect(blockIdsOf(groups, 'user-signals')).toEqual(SIGNAL_IDS);
  });

  it('renders the per-period signal blocks full-width', () => {
    const alice = data.users[0];
    const groups = buildUserGroups(alice, data);
    expect(blockById(groups, 'user-risk-per-period').wide).toBe(true);
    expect(blockById(groups, 'user-quality-per-period').wide).toBe(true);
    expect(blockById(groups, 'user-risk-rate').wide).toBeUndefined();
  });

  it('renders the languages block full-width', () => {
    const alice = data.users[0];
    const groups = buildUserGroups(alice, data);
    expect(blockById(groups, 'user-languages').wide).toBe(true);
  });

  it('builds only the deterministic groups when the LLM is disabled', () => {
    const deterministicData = buildChartData(buildDemoReport({ llmEnabled: false }));
    const groups = buildUserGroups(deterministicData.users[0], deterministicData);
    expect(groups.map((group) => group.id)).toEqual(['user-activity', 'user-work']);
    expect(blockIdsOf(groups, 'user-activity')).toEqual(['user-commits', 'user-lines']);
    expect(blockIdsOf(groups, 'user-work')).toEqual(['user-languages']);
  });

  it('omits the LLM groups for a user without contributions', () => {
    const empty = fixtureData(2, 0, true);
    const groups = buildUserGroups(empty.users[0], empty);
    expect(groups.map((group) => group.id)).toEqual(['user-activity', 'user-work']);
    expect(blockIdsOf(groups, 'user-activity')).toEqual(['user-commits', 'user-lines']);
    expect(blockIdsOf(groups, 'user-work')).toEqual(['user-languages']);
  });

  it('builds only the work group for a single-period LLM report', () => {
    const single = fixtureData(1, 2, true);
    const groups = buildUserGroups(single.users[0], single);
    expect(groups.map((group) => group.id)).toEqual(['user-work']);
    expect(blockIdsOf(groups, 'user-work')).toEqual([
      'user-sizes',
      'user-complexity',
      'user-work-types',
    ]);
  });

  it('builds no groups for a single-period report without LLM blocks', () => {
    expect(buildUserGroups(fixtureData(1, 0, false).users[0], fixtureData(1, 0, false))).toEqual(
      [],
    );
  });

  it("counts the user's contributions in the overall size distribution donut", () => {
    const single = fixtureData(1, 2, true);
    const sizes = blockById(buildUserGroups(single.users[0], single), 'user-sizes');
    const series = sizes.optionOf(undefined).series as unknown as Array<Record<string, unknown>>;
    expect(series[0]).toMatchObject({ type: 'pie' });
    expect(series[0].data).toEqual([
      { name: 'xs', value: 0, itemStyle: { color: '#7dd3fc' } },
      { name: 's', value: 0, itemStyle: { color: '#60a5fa' } },
      { name: 'm', value: 2, itemStyle: { color: '#818cf8' } },
      { name: 'l', value: 0, itemStyle: { color: '#a78bfa' } },
      { name: 'xl', value: 0, itemStyle: { color: '#c084fc' } },
    ]);
  });

  it("counts the user's contributions in the overall complexity distribution donut", () => {
    // Two contributions, each defaulting to medium complexity.
    const single = fixtureData(1, 2, true);
    const complexity = blockById(buildUserGroups(single.users[0], single), 'user-complexity');
    const series = complexity.optionOf(undefined).series as unknown as Array<
      Record<string, unknown>
    >;
    expect(series[0]).toMatchObject({ type: 'pie' });
    expect(series[0].data).toEqual([
      { name: 'low', value: 0, itemStyle: { color: '#34d399' } },
      { name: 'medium', value: 2, itemStyle: { color: '#fbbf24' } },
      { name: 'high', value: 0, itemStyle: { color: '#f87171' } },
    ]);
  });

  it("builds deterministic series from the user's own points", () => {
    const alice = data.users[0];
    const commits = blockById(buildUserGroups(alice, data), 'user-commits');
    const series = commits.optionOf(undefined).series as unknown as Array<Record<string, unknown>>;
    expect(series[0]).toMatchObject({ type: 'bar', name: 'Commits', data: [9, 3] });
    expect(series[1]).toMatchObject({ type: 'line', name: 'Cumulative', data: [9, 12] });
  });
});
