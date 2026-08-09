/**
 * The KPI grid: the headline numbers of the team overview — big
 * values, small labels, optional hints, in evenly weighted cards.
 */
import type { ReactElement } from 'react';

/** One KPI card of the grid. */
export interface KpiItem {
  /** The metric label. */
  label: string;
  /** The metric value, already formatted. */
  value: string;
  /** An optional one-line hint under the value. */
  hint?: string;
  /** Emphasis tone: `good` green, `warn` amber; neutral by default. */
  tone?: 'default' | 'good' | 'warn';
}

/** The props of the {@link KpiGrid} component. */
export interface KpiGridProps {
  /** The KPI cards, in display order. */
  items: KpiItem[];
}

/**
 * Renders the KPI card grid.
 *
 * @param props - The KPI cards.
 * @returns The grid element.
 */
export function KpiGrid({ items }: KpiGridProps): ReactElement {
  return (
    <div className="kpi-grid">
      {items.map((item) => {
        const tone = item.tone === undefined ? 'default' : item.tone;
        return (
          <div key={item.label} className={`kpi-card kpi-${tone}`}>
            <span className="kpi-label">{item.label}</span>
            <span className="kpi-value">{item.value}</span>
            {item.hint !== undefined ? <span className="kpi-hint">{item.hint}</span> : null}
          </div>
        );
      })}
    </div>
  );
}
