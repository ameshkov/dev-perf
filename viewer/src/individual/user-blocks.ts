/**
 * The chart group inventory of one user — activity, the nature of the
 * work, and the risk and quality signals — composed of the
 * whole-range LLM distributions and the per-period LLM and
 * deterministic series (reports with more than one period), in the
 * same reading order as the team section.
 */
import type { ChartData, UserSeries } from '../data/index.js';
import type { ChartGroupDescriptor } from '../components/index.js';
import {
  buildDeterministicActivityBlocks,
  buildDeterministicWorkBlocks,
} from './user-blocks-deterministic.js';
import { buildOverallLlmBlocks } from './user-blocks-overall.js';
import {
  buildPeriodLlmActivityBlocks,
  buildPeriodLlmSignalBlocks,
  buildPeriodLlmWorkBlocks,
} from './user-blocks-period.js';

/**
 * The chart groups of one user, in document order. LLM-based blocks
 * require an LLM analysis with contributions of the user; per-period
 * blocks require more than one period. Empty groups are omitted.
 *
 * @param series - The user's series.
 * @param data - The chart data.
 * @returns The group descriptors.
 */
export function buildUserGroups(series: UserSeries, data: ChartData): ChartGroupDescriptor[] {
  const labels = data.periods.map((period) => period.label);
  const multiPeriod = data.periods.length > 1;
  const llmActive = data.parameters.llmEnabled && series.user.llm.contributions.length > 0;
  const groups: ChartGroupDescriptor[] = [];
  const activity = [
    ...(llmActive && multiPeriod ? buildPeriodLlmActivityBlocks(series, labels) : []),
    ...(multiPeriod ? buildDeterministicActivityBlocks(series, labels) : []),
  ];
  if (activity.length > 0) {
    groups.push({
      id: 'user-activity',
      title: 'Activity',
      lead: 'How much the person shipped per period — contributions and points from the LLM analysis, commits and lines from git history.',
      blocks: activity,
    });
  }
  const work = [
    ...(llmActive && multiPeriod ? buildPeriodLlmWorkBlocks(series, labels) : []),
    ...(llmActive ? buildOverallLlmBlocks(series) : []),
    ...(multiPeriod ? buildDeterministicWorkBlocks(series, labels) : []),
  ];
  if (work.length > 0) {
    groups.push({
      id: 'user-work',
      title: 'Nature of work',
      lead: 'What kind of work it was — work types, sizes and complexity assessed by the LLM, and the languages the added lines went to.',
      blocks: work,
    });
  }
  if (llmActive && multiPeriod) {
    groups.push({
      id: 'user-signals',
      title: 'Risk & quality signals',
      lead: "What the LLM flagged in the person's work — risk flags and quality signals as a share of each period's contributions, and as per-contribution averages.",
      blocks: buildPeriodLlmSignalBlocks(series, labels),
    });
  }
  return groups;
}
