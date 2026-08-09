/**
 * The descriptor of one chart group: a named cluster of chart blocks
 * that read together — activity, the nature of the work, or the LLM's
 * risk and quality signals. Shared by the team and individual
 * sections.
 */
import type { ChartBlockDescriptor } from './chart-block-descriptor.js';

/**
 * The descriptor of one chart group: identity, heading text, and the
 * group's chart blocks in document order.
 */
export interface ChartGroupDescriptor {
  /** Stable identity of the group inside its section. */
  id: string;
  /** Name of the group, shown as the group heading. */
  title: string;
  /** What the group's charts read together. */
  lead: string;
  /** The group's chart blocks, in document order. */
  blocks: ChartBlockDescriptor[];
}
