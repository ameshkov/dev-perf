/**
 * The individual dynamics section: the user picker (one card per
 * contributor, master order) and the detail view of the selected
 * user — summary statistics, charts, and the LLM contribution cards.
 */
import { useState } from 'react';
import type { ReactElement } from 'react';
import type { ChartData } from '../data/index.js';
import { formatInt } from '../data/index.js';
import { UserDetail, userInitials } from './user-detail.js';

/** The props of the {@link IndividualSection} component. */
export interface IndividualSectionProps {
  /** The chart data of the loaded report. */
  data: ChartData;
}

/**
 * Renders the individual dynamics section of the dashboard.
 *
 * @param props - The chart data.
 * @returns The section element, or `null` when the report has no
 * users.
 */
export function IndividualSection({ data }: IndividualSectionProps): ReactElement | null {
  const [selectedName, setSelectedName] = useState<string | undefined>(undefined);
  if (data.users.length === 0) {
    return null;
  }
  const selected = data.users.find((series) => series.user.name === selectedName) ?? data.users[0];
  return (
    <section id="individuals" className="section">
      <div className="section-head">
        <span className="section-overline">Individual dynamics</span>
        <h2 className="section-title">One report per person</h2>
        <p className="section-lead">
          Pick a contributor to see their own version of every chart, plus the LLM&apos;s
          contribution-by-contribution assessment when the report carries an LLM analysis.
        </p>
      </div>
      <div className="user-picker" role="tablist" aria-label="Contributors">
        {data.users.map((series) => {
          const active = series.user.name === selected.user.name;
          return (
            <button
              key={series.user.name}
              type="button"
              role="tab"
              aria-selected={active}
              className={active ? 'user-tab user-tab-active' : 'user-tab'}
              onClick={() => setSelectedName(series.user.name)}
            >
              <span className="user-tab-avatar" aria-hidden="true">
                {userInitials(series.user.name)}
              </span>
              <span className="user-tab-text">
                <span className="user-tab-name">
                  {series.user.name}
                  {series.user.isBot ? <span className="user-bot-badge">bot</span> : null}
                </span>
                <span className="user-tab-stats">
                  {formatInt(series.user.deterministic.commits)} commits ·{' '}
                  {formatInt(series.user.llm.contributions.length)} contributions
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <UserDetail key={selected.user.name} series={selected} data={data} />
    </section>
  );
}
