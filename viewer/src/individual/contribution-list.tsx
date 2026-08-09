/**
 * The contributions of one user rendered as cards: title, summary,
 * size and complexity, work types, areas, quality signals and risk
 * flags, and the grouped commits — with the reasoning behind the
 * size and complexity in a collapsible detail. Grouped per period
 * when the report has more than one period.
 */
import type { ReactElement } from 'react';
import type { Contribution } from '../report/index.js';
import type { PeriodInfo, UserSeries } from '../data/index.js';
import { formatInt } from '../data/index.js';
import {
  Badge,
  toneForComplexity,
  toneForQualitySignal,
  toneForRiskFlag,
  toneForSize,
  toneForWorkType,
} from '../components/index.js';

/** The props of the {@link ContributionList} component. */
export interface ContributionListProps {
  /** The user's series. */
  series: UserSeries;
  /** The period identities, for the period labels of multi-period
   * reports. */
  periods: PeriodInfo[];
}

/**
 * The period index of each contribution of the user, resolved by
 * object identity through the user's per-period analyses.
 *
 * @param series - The user's series.
 * @returns One entry per contribution.
 */
function periodIndexOf(series: UserSeries): Map<Contribution, number> {
  const indexes = new Map<Contribution, number>();
  series.periodLlm.forEach((analysis, index) => {
    for (const contribution of analysis.contributions) {
      if (!indexes.has(contribution)) {
        indexes.set(contribution, index);
      }
    }
  });
  return indexes;
}

/**
 * One badge row: a caption plus one badge per value; nothing when the
 * row is empty.
 *
 * @param caption - The row caption.
 * @param values - The badge values.
 * @param toneOf - The badge tone per value.
 * @returns The row element, or `null` when empty.
 */
function badgeRow(
  caption: string,
  values: string[],
  toneOf: (value: string) => Parameters<typeof Badge>[0]['tone'],
): ReactElement | null {
  if (values.length === 0) {
    return null;
  }
  return (
    <div className="contribution-row">
      <span className="contribution-row-caption">{caption}</span>
      <span className="contribution-row-badges">
        {values.map((value) => (
          <Badge key={value} tone={toneOf(value)}>
            {value}
          </Badge>
        ))}
      </span>
    </div>
  );
}

/**
 * One contribution card.
 *
 * @param contribution - The contribution.
 * @param index - The list position of the card, used as its key.
 * @returns The card element.
 */
function contributionCard(contribution: Contribution, index: number): ReactElement {
  return (
    <article key={index} className="contribution-card">
      <header className="contribution-head">
        <h4 className="contribution-title">{contribution.title}</h4>
        <span className="contribution-grade">
          <Badge tone={toneForSize(contribution.size)}>{contribution.size}</Badge>
          <Badge tone={toneForComplexity(contribution.complexity)}>{contribution.complexity}</Badge>
        </span>
      </header>
      <p className="contribution-summary">{contribution.summary}</p>
      <details className="contribution-reasoning">
        <summary>Why this size and complexity</summary>
        <p>
          <strong>Size {contribution.size}:</strong> {contribution.sizeReasoning}
        </p>
        <p>
          <strong>Complexity {contribution.complexity}:</strong> {contribution.complexityReasoning}
        </p>
      </details>
      {badgeRow('Types', contribution.types, (value) =>
        toneForWorkType(value as Parameters<typeof toneForWorkType>[0]),
      )}
      {badgeRow('Areas', contribution.areas, () => 'neutral')}
      {badgeRow('Quality signals', contribution.qualitySignals, () => toneForQualitySignal())}
      {badgeRow('Risk flags', contribution.riskFlags, () => toneForRiskFlag())}
      {contribution.commits.length > 0 ? (
        <footer className="contribution-commits">
          <span className="contribution-row-caption">Commits</span>
          <span className="contribution-shas">
            {contribution.commits.map((sha) => (
              <code key={sha} title={sha}>
                {sha.slice(0, 7)}
              </code>
            ))}
          </span>
        </footer>
      ) : null}
    </article>
  );
}

/**
 * Renders the contributions of one user, grouped per period when the
 * report has more than one period.
 *
 * @param props - The user's series and the periods.
 * @returns The list element, or `null` when the user has no
 * contributions.
 */
export function ContributionList({ series, periods }: ContributionListProps): ReactElement | null {
  const contributions = series.user.llm.contributions;
  if (contributions.length === 0) {
    return null;
  }
  if (periods.length <= 1) {
    return <div className="contribution-list">{contributions.map(contributionCard)}</div>;
  }
  const indexes = periodIndexOf(series);
  const groups = periods
    .map((period, index) => ({
      label: period.label,
      items: contributions.filter((contribution) => indexes.get(contribution) === index),
    }))
    .filter((group) => group.items.length > 0);
  return (
    <div className="contribution-list">
      {groups.map((group) => (
        <div key={group.label} className="contribution-group">
          <h4 className="contribution-group-label">
            {group.label}
            <span className="contribution-group-count">
              {formatInt(group.items.length)}{' '}
              {group.items.length === 1 ? 'contribution' : 'contributions'}
            </span>
          </h4>
          {group.items.map(contributionCard)}
        </div>
      ))}
    </div>
  );
}
