/**
 * The chart block — the card every chart of the sections lives in:
 * a name, a description, optional controls (the tag selector of
 * tag-based charts), and the chart body.
 */
import type { ReactElement, ReactNode } from 'react';

/** The props of the {@link ChartBlock} component. */
export interface ChartBlockProps {
  /** The name of the chart block. */
  title: string;
  /** What the chart shows and how to read it. */
  description: string;
  /** Controls above the chart body, e.g. the tag selector. */
  controls?: ReactNode;
  /** Span two grid columns on wide screens. */
  wide?: boolean;
  /** The chart body. */
  children: ReactNode;
}

/**
 * Renders one chart block card.
 *
 * @param props - Name, description, optional controls and the body.
 * @returns The card element.
 */
export function ChartBlock({
  title,
  description,
  controls,
  wide,
  children,
}: ChartBlockProps): ReactElement {
  const className = wide === true ? 'chart-block chart-block-wide' : 'chart-block';
  return (
    <section className={className}>
      <header className="chart-block-header">
        <h4 className="chart-block-title">{title}</h4>
        <p className="chart-block-description">{description}</p>
      </header>
      {controls !== undefined ? <div className="chart-block-controls">{controls}</div> : null}
      <div className="chart-block-body">{children}</div>
    </section>
  );
}

/**
 * The placeholder body of a chart block with nothing to show — an
 * empty tag selection or a report without the required analysis.
 *
 * @param message - The hint shown instead of a chart.
 * @returns The placeholder element.
 */
export function ChartEmpty({ message }: { message: string }): ReactElement {
  return (
    <div className="chart-empty">
      <span className="chart-empty-icon" aria-hidden="true" />
      <p className="chart-empty-text">{message}</p>
    </div>
  );
}
