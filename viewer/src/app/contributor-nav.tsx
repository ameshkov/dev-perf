/**
 * The "Contributor statistics" group of the dashboard control bar: a
 * contributor picker and, for a multi-period LLM report, the period
 * chips. The picked contributor decides whose individual dynamics the
 * dashboard shows, and the currently viewed period chip stays
 * highlighted.
 */
import type { ChangeEvent, ReactElement } from 'react';
import type { PeriodInfo, UserSeries } from '../data/index.js';

/** The props of the {@link ContributorNav} component. */
export interface ContributorNavProps {
  /** The contributors in scope, in master order. */
  users: UserSeries[];
  /** The name of the selected contributor. */
  selectedUser: string;
  /** Selects a contributor. */
  onSelectUser: (name: string) => void;
  /** The period identities, oldest first. */
  periods: PeriodInfo[];
  /** Whether the period chips are shown (multi-period LLM reports). */
  periodsNavigable: boolean;
  /** The index of the currently viewed period. */
  selectedPeriod: number;
  /** Selects one period. */
  onSelectPeriod: (index: number) => void;
}

/** The props of the period chip row. */
interface PeriodRowProps {
  /** The period identities, oldest first. */
  periods: PeriodInfo[];
  /** The index of the currently viewed period. */
  selectedPeriod: number;
  /** Selects one period. */
  onSelectPeriod: (index: number) => void;
}

/**
 * Renders the period row of the group: the label and one chip per
 * period, the currently viewed period marked active.
 *
 * @param props - The periods and the period selection.
 * @returns The period row element.
 */
function PeriodRow({ periods, selectedPeriod, onSelectPeriod }: PeriodRowProps): ReactElement {
  return (
    <div className="stats-nav-periods">
      <span className="stats-nav-label">Period</span>
      <span className="stats-nav-links">
        {periods.map((period, index) => {
          const active = index === selectedPeriod;
          return (
            <button
              key={period.label}
              type="button"
              aria-pressed={active}
              className={active ? 'stats-nav-link stats-nav-link-active' : 'stats-nav-link'}
              onClick={() => onSelectPeriod(index)}
            >
              {period.label}
            </button>
          );
        })}
      </span>
    </div>
  );
}

/**
 * Renders the "Contributor statistics" group of the control bar: the
 * contributor picker (a labeled select) drives which contributor's
 * individual dynamics are on screen, and the period chips — shown for
 * multi-period LLM reports — keep the currently viewed period
 * highlighted.
 *
 * @param props - The contributors, the selections and the change
 *   callbacks.
 * @returns The group element.
 */
export function ContributorNav({
  users,
  selectedUser,
  onSelectUser,
  periods,
  periodsNavigable,
  selectedPeriod,
  onSelectPeriod,
}: ContributorNavProps): ReactElement {
  const handleSelectUser = (event: ChangeEvent<HTMLSelectElement>): void => {
    onSelectUser(event.target.value);
  };
  return (
    <div className="stats-nav" role="group" aria-label="Contributor statistics">
      <span className="stats-nav-caption">Contributor statistics</span>
      <div className="stats-nav-field">
        <label className="stats-nav-label" htmlFor="stats-nav-contributor">
          Contributor
        </label>
        <select
          id="stats-nav-contributor"
          className="stats-nav-select"
          value={selectedUser}
          onChange={handleSelectUser}
        >
          {users.map((series) => (
            <option key={series.user.name} value={series.user.name}>
              {series.user.name}
            </option>
          ))}
        </select>
      </div>
      {periodsNavigable ? (
        <PeriodRow
          periods={periods}
          selectedPeriod={selectedPeriod}
          onSelectPeriod={onSelectPeriod}
        />
      ) : null}
    </div>
  );
}
