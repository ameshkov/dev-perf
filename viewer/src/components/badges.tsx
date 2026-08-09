/**
 * Badges — small colored pills for categorical values: work types,
 * complexity levels, contribution sizes, quality signals and risk
 * flags. The same component renders every kind; the tone maps decide
 * the color of known values.
 */
import type { ReactElement, ReactNode } from 'react';
import type { Complexity, ContributionSize, ContributionType } from '../report/index.js';

/** The color tone of a badge. */
export type BadgeTone =
  | 'neutral'
  | 'blue'
  | 'sky'
  | 'violet'
  | 'purple'
  | 'teal'
  | 'amber'
  | 'pink'
  | 'green'
  | 'red'
  | 'orange'
  | 'gray';

/** The props of the {@link Badge} component. */
export interface BadgeProps {
  /** The color tone; neutral by default. */
  tone?: BadgeTone;
  /** The badge content. */
  children: ReactNode;
}

/**
 * Renders one badge pill.
 *
 * @param props - Tone and content.
 * @returns The badge element.
 */
export function Badge({ tone = 'neutral', children }: BadgeProps): ReactElement {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

/** Badge tones per work type. */
const WORK_TYPE_TONES: Record<ContributionType, BadgeTone> = {
  feature: 'blue',
  bugfix: 'red',
  refactor: 'violet',
  test: 'teal',
  docs: 'amber',
  tooling: 'sky',
  chore: 'gray',
  security: 'orange',
};

/**
 * The badge tone of a work type.
 *
 * @param type - The contribution type.
 * @returns The tone.
 */
export function toneForWorkType(type: ContributionType): BadgeTone {
  return WORK_TYPE_TONES[type];
}

/**
 * The badge tone of a complexity level (green, amber, red).
 *
 * @param complexity - The complexity level.
 * @returns The tone.
 */
export function toneForComplexity(complexity: Complexity): BadgeTone {
  if (complexity === 'low') {
    return 'green';
  }
  if (complexity === 'high') {
    return 'red';
  }
  return 'amber';
}

/**
 * The badge tone of a contribution size (cool to warm, xs to xl).
 *
 * @param size - The contribution size.
 * @returns The tone.
 */
export function toneForSize(size: ContributionSize): BadgeTone {
  const tones: Record<ContributionSize, BadgeTone> = {
    xs: 'sky',
    s: 'blue',
    m: 'violet',
    l: 'purple',
    xl: 'pink',
  };
  return tones[size];
}

/** All badge tones for quality signals. */
const QUALITY_TONE: BadgeTone = 'green';

/** All badge tones for risk flags. */
const RISK_TONE: BadgeTone = 'red';

/**
 * The badge tone of a quality signal.
 *
 * @returns The tone.
 */
export function toneForQualitySignal(): BadgeTone {
  return QUALITY_TONE;
}

/**
 * The badge tone of a risk flag.
 *
 * @returns The tone.
 */
export function toneForRiskFlag(): BadgeTone {
  return RISK_TONE;
}
