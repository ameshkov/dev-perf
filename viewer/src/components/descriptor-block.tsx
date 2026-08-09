/**
 * The descriptor block: renders one {@link ChartBlockDescriptor} as a
 * chart block card — name, description, the tag selector of tag-based
 * blocks, and the chart itself (or an empty placeholder when the tag
 * selection is empty). Shared by every section.
 */
import type { ReactElement } from 'react';
import type { ChartBlockDescriptor } from './chart-block-descriptor.js';
import { ChartBlock, ChartEmpty } from './chart-block.js';
import { EChart } from './e-chart.js';
import { TagSelector } from './tag-selector.js';
import { tagHandlers } from './tag-selections.js';

/** The props of the {@link DescriptorBlock} component. */
export interface DescriptorBlockProps {
  /** The block descriptor. */
  descriptor: ChartBlockDescriptor;
  /** The block's resolved tag selection; all tags when `undefined`. */
  selected: ReadonlySet<string> | undefined;
  /** Replaces the block's tag selection. */
  onSelect: (selection: ReadonlySet<string>) => void;
  /** Chart height override; defaults to 320. */
  height?: number;
}

/**
 * Renders one chart block card of a section.
 *
 * @param props - Descriptor, selection state and handlers.
 * @returns The card element.
 */
export function DescriptorBlock({
  descriptor,
  selected,
  onSelect,
  height = 320,
}: DescriptorBlockProps): ReactElement {
  const tags = descriptor.tags;
  const controls =
    tags === undefined ? undefined : (
      <TagSelector
        tags={tags}
        selected={selected ?? new Set()}
        {...tagHandlers(tags, selected ?? new Set(), onSelect)}
      />
    );
  const empty = tags !== undefined && selected !== undefined && selected.size === 0;
  return (
    <ChartBlock
      title={descriptor.title}
      description={descriptor.description}
      controls={controls}
      wide={descriptor.wide}
    >
      {empty ? (
        <ChartEmpty message="Select at least one tag above to draw this chart." />
      ) : (
        <EChart option={descriptor.optionOf(selected)} label={descriptor.title} height={height} />
      )}
    </ChartBlock>
  );
}
