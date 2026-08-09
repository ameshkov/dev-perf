/**
 * The team dynamics section: the chart blocks of the whole team in
 * logical groups — activity, the nature of the work, and the LLM's
 * risk and quality signals — each block in its own card, the
 * tag-based ones with a tag selector.
 */
import { useMemo } from 'react';
import type { ReactElement } from 'react';
import type { ChartData } from '../data/index.js';
import type { ChartGroupDescriptor } from '../components/index.js';
import {
  ChartGroup,
  DescriptorBlock,
  resolveSelection,
  useTagSelections,
} from '../components/index.js';
import { buildDistributionBlocks } from './team-blocks-dist.js';
import {
  buildLlmActivityBlocks,
  buildLlmSignalBlocks,
  buildLlmWorkBlocks,
} from './team-blocks-llm.js';
import { buildTeamActivityBlocks, buildTeamWorkBlocks } from './team-blocks.js';

/** The props of the {@link TeamSection} component. */
export interface TeamSectionProps {
  /** The chart data of the loaded report. */
  data: ChartData;
}

/**
 * The chart group inventory of the team section, in document order:
 * activity, the nature of the work, and the risk and quality signals.
 * Empty groups are omitted, so a deterministic-only report reads as
 * activity plus languages.
 *
 * @param data - The chart data.
 * @param labels - The period labels.
 * @returns The group descriptors.
 */
function teamGroups(data: ChartData, labels: string[]): ChartGroupDescriptor[] {
  const llmEnabled = data.parameters.llmEnabled;
  const groups: ChartGroupDescriptor[] = [];
  const activity = [
    ...(llmEnabled ? buildLlmActivityBlocks(data, labels) : []),
    ...buildTeamActivityBlocks(data, labels),
  ];
  if (activity.length > 0) {
    groups.push({
      id: 'team-activity',
      title: 'Activity',
      lead: 'How much the team shipped per period — contributions and points from the LLM analysis, commits, lines and active contributors from git history.',
      blocks: activity,
    });
  }
  const work = [
    ...(llmEnabled ? [...buildLlmWorkBlocks(data, labels), ...buildDistributionBlocks(data)] : []),
    ...buildTeamWorkBlocks(data, labels),
  ];
  if (work.length > 0) {
    groups.push({
      id: 'team-work',
      title: 'Nature of work',
      lead: 'What kind of work it was — work types, sizes and complexity assessed by the LLM, and the languages the added lines went to.',
      blocks: work,
    });
  }
  if (llmEnabled) {
    groups.push({
      id: 'team-signals',
      title: 'Risk & quality signals',
      lead: "What the LLM flagged — risk flags and quality signals as a share of each period's contributions, and as per-contribution averages.",
      blocks: buildLlmSignalBlocks(data, labels),
    });
  }
  return groups;
}

/**
 * Renders the team dynamics section of the dashboard.
 *
 * @param props - The chart data.
 * @returns The section element.
 */
export function TeamSection({ data }: TeamSectionProps): ReactElement {
  const labels = useMemo(() => data.periods.map((period) => period.label), [data]);
  const groups = useMemo(() => teamGroups(data, labels), [data, labels]);
  const { selections, setSelected } = useTagSelections();

  return (
    <section id="team" className="section">
      <div className="section-head">
        <span className="section-overline">Team dynamics</span>
        <h2 className="section-title">How the team moved</h2>
        <p className="section-lead">
          The charts read in groups — the team&apos;s activity, the nature of its work, and the
          LLM&apos;s risk and quality signals. Charts with tags narrow down to the tags you select.
        </p>
      </div>
      {groups.map((group) => (
        <ChartGroup key={group.id} title={group.title} lead={group.lead}>
          {group.blocks.map((descriptor) => (
            <DescriptorBlock
              key={descriptor.id}
              descriptor={descriptor}
              selected={resolveSelection(selections, descriptor)}
              onSelect={(selection) => setSelected(descriptor.id, selection)}
            />
          ))}
        </ChartGroup>
      ))}
    </section>
  );
}
