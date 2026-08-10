/**
 * The descriptor of one chart block: the block's identity and text,
 * the optional tag list the block can be narrowed down by, and the
 * option builder that renders the chart for the selected tags. Shared
 * by the team and individual sections.
 */
import type { EChartsOption } from 'echarts';
import type { CountRow } from '../data/index.js';

/**
 * The descriptor of one chart block: identity, name, description, and
 * the chart option for a tag selection.
 */
export interface ChartBlockDescriptor {
  /** Stable identity of the block inside its section. */
  id: string;
  /** Name of the block, shown as the card title. */
  title: string;
  /** What the chart shows and how to read it. */
  description: string;
  /** Tags the block can be narrowed down by; absent for fixed
   * blocks. The list is the full tag set in display order. */
  tags?: CountRow[];
  /** Renders the tag chip label of a key; defaults to the key
   * itself. Used when the keys are long identifiers, e.g. repository
   * URLs shortened to their last path segment. */
  labelOf?: (key: string) => string;
  /** Spans the full width of the chart grid instead of one column;
   * absent for single-column blocks. */
  wide?: boolean;
  /** Builds the chart option; `selected` is the tag subset — all
   * tags when absent (fixed blocks never receive one). */
  optionOf: (selected: ReadonlySet<string> | undefined) => EChartsOption;
}
