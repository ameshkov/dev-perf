/**
 * Shared constants of the viewer's data layer: the contribution size
 * weights of the weighted-points series, and the canonical chart order
 * of the size and complexity categories. Mirrors the constants of the
 * parent CLI's compile layer.
 */
import type { ContributionSize } from '../report/index.js';

/** Contribution size weights used for the weighted-points series. */
export const SIZE_WEIGHTS: Record<ContributionSize, number> = {
  xs: 1,
  s: 2,
  m: 3,
  l: 5,
  xl: 8,
};

/** All contribution sizes in chart order. */
export const SIZE_ORDER: ContributionSize[] = ['xs', 's', 'm', 'l', 'xl'];

/** All complexity levels in chart order. */
export const COMPLEXITY_ORDER: string[] = ['low', 'medium', 'high'];
