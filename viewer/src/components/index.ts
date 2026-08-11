/**
 * Public API of the viewer's shared UI components: the chart block
 * descriptor and its rendering block, the tag-selection state, the
 * badges, and the KPI grid. External code imports from this barrel
 * only; the presentational pieces of one block (the EChart wrapper,
 * the TagSelector, the card shell) are internal to the module.
 */
export type { ChartBlockDescriptor } from './chart-block-descriptor.js';
export type { ChartGroupDescriptor } from './chart-group-descriptor.js';
export { ChartGroup } from './chart-group.js';
export { DescriptorBlock } from './descriptor-block.js';
export {
  Badge,
  toneForComplexity,
  toneForQualitySignal,
  toneForRiskFlag,
  toneForSize,
  toneForWorkType,
} from './badges.js';
export { KpiGrid } from './kpi-grid.js';
export type { KpiItem } from './kpi-grid.js';
export { scrollToId } from './scroll.js';
export { resolveSelection, useTagSelections } from './tag-selections.js';
