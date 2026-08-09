/**
 * The chart group: a heading and a lead line over one chart grid,
 * clustering the chart blocks of a section that read together.
 */
import type { ReactElement, ReactNode } from 'react';

/** The props of the {@link ChartGroup} component. */
export interface ChartGroupProps {
  /** Name of the group, shown as the group heading. */
  title: string;
  /** What the group's charts read together. */
  lead: string;
  /** The group's chart block cards. */
  children: ReactNode;
}

/**
 * Renders one chart group of a section.
 *
 * @param props - Heading text and the chart block cards.
 * @returns The group element.
 */
export function ChartGroup({ title, lead, children }: ChartGroupProps): ReactElement {
  return (
    <div className="chart-group">
      <header className="chart-group-head">
        <h3 className="chart-group-title">{title}</h3>
        <p className="chart-group-lead">{lead}</p>
      </header>
      <div className="chart-grid">{children}</div>
    </div>
  );
}
