/**
 * The individual dynamics section: the user picker (one card per
 * contributor, master order) and the detail view of the selected
 * user — summary statistics, charts, and the LLM contribution cards.
 * The selected contributor is owned by the dashboard, which also
 * drives the section from the navigation panel; a pending period jump
 * from the panel scrolls to the period's contribution group once the
 * detail is mounted. A manual pick here just switches the user and
 * clears the jump.
 */
import { useEffect } from 'react';
import type { ReactElement } from 'react';
import type { ChartData, UserSeries } from '../data/index.js';
import { formatInt } from '../data/index.js';
import { scrollToId } from '../components/index.js';
import { UserDetail, userInitials } from './user-detail.js';
import type { PeriodJump } from './period-jump.js';

/** The props of the {@link IndividualSection} component. */
export interface IndividualSectionProps {
  /** The chart data of the loaded report. */
  data: ChartData;
  /** The name of the selected contributor. */
  selectedUser: string;
  /** Selects a contributor; the dashboard updates its own selection. */
  onSelectUser: (name: string) => void;
  /** A pending jump to one period's contribution group; the section
   * scrolls to the group once its detail is mounted. */
  jump?: PeriodJump;
  /** Clears a pending jump; called after the jump is acted upon and
   * on a manual user pick, so no later user switch re-scrolls. */
  onClearJump?: () => void;
}

/** The props of the {@link UserPicker} component. */
interface UserPickerProps {
  /** The users in scope, in master order. */
  users: UserSeries[];
  /** The name of the selected user. */
  selectedName: string;
  /** Selects a user. */
  onSelect: (name: string) => void;
}

/**
 * Renders the contributor picker: one tab card per user with their
 * totals, the selected one highlighted.
 *
 * @param props - The users, the selected name, and the select handler.
 * @returns The picker element.
 */
function UserPicker({ users, selectedName, onSelect }: UserPickerProps): ReactElement {
  return (
    <div className="user-picker" role="tablist" aria-label="Contributors">
      {users.map((series) => {
        const active = series.user.name === selectedName;
        return (
          <button
            key={series.user.name}
            type="button"
            role="tab"
            aria-selected={active}
            className={active ? 'user-tab user-tab-active' : 'user-tab'}
            onClick={() => onSelect(series.user.name)}
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
  );
}

/**
 * Renders the individual dynamics section of the dashboard.
 *
 * @param props - The chart data, the selected contributor and the
 *   jump callbacks.
 * @returns The section element, or `null` when the report has no
 * users.
 */
export function IndividualSection({
  data,
  selectedUser,
  onSelectUser,
  jump,
  onClearJump,
}: IndividualSectionProps): ReactElement | null {
  useEffect(() => {
    if (jump === undefined || data.users.length === 0) {
      return;
    }
    // The selected user's contribution list may have just re-mounted;
    // wait one frame, then scroll to the period's group. The jump is
    // cleared once acted upon.
    const frame = requestAnimationFrame(() => {
      if (!scrollToId(`period-${jump.index}`)) {
        scrollToId('individuals');
      }
      onClearJump?.();
    });
    return () => cancelAnimationFrame(frame);
  }, [jump, data, onClearJump]);
  if (data.users.length === 0) {
    return null;
  }
  const selected = data.users.find((series) => series.user.name === selectedUser) ?? data.users[0];
  const handleSelect = (name: string): void => {
    onSelectUser(name);
    // A manual pick must never scroll: drop a pending jump so a later
    // state change cannot re-trigger the contribution scroll.
    onClearJump?.();
  };
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
      <UserPicker users={data.users} selectedName={selected.user.name} onSelect={handleSelect} />
      <UserDetail key={selected.user.name} series={selected} data={data} />
    </section>
  );
}
