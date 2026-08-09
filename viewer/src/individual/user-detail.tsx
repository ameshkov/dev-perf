/**
 * The detail view of the selected user: identity header with the
 * summary statistics, the LLM overview, the chart groups with their
 * tag selections, the per-repository commit counts, and the
 * contribution cards. A fresh instance per user (keyed by name), so
 * tag selections start from the full set when the user changes.
 */
import { useMemo } from 'react';
import type { ReactElement } from 'react';
import type { ChartData, UserSeries } from '../data/index.js';
import { formatInt, repoLabel, weightedPointsOf } from '../data/index.js';
import {
  ChartGroup,
  DescriptorBlock,
  resolveSelection,
  useTagSelections,
} from '../components/index.js';
import { buildUserGroups } from './user-blocks.js';
import { ContributionList } from './contribution-list.js';

/** The props of the {@link UserDetail} component. */
export interface UserDetailProps {
  /** The selected user's series. */
  series: UserSeries;
  /** The chart data of the loaded report. */
  data: ChartData;
}

/**
 * The initials of a display name: the first letter of the first two
 * words, uppercased.
 *
 * @param name - The display name.
 * @returns The initials.
 */
export function userInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('');
}

/**
 * One summary statistic chip of the identity header.
 *
 * @param label - The metric label.
 * @param value - The formatted metric value.
 * @returns The chip element.
 */
function statChip(label: string, value: string): ReactElement {
  return (
    <div className="user-stat" key={label}>
      <span className="user-stat-value">{value}</span>
      <span className="user-stat-label">{label}</span>
    </div>
  );
}

/**
 * The summary statistic chips of the user: the deterministic git
 * metrics plus the LLM counts when the report has an LLM analysis.
 *
 * @param series - The user's series.
 * @param llmEnabled - Whether the report has an LLM analysis.
 * @returns The chip elements.
 */
function statChips(series: UserSeries, llmEnabled: boolean): ReactElement[] {
  const user = series.user;
  const chips = [
    statChip('Commits', formatInt(user.deterministic.commits)),
    statChip('Lines added', `+${formatInt(user.deterministic.linesAdded)}`),
    statChip('Lines removed', `−${formatInt(user.deterministic.linesRemoved)}`),
    statChip('Files touched', formatInt(user.deterministic.filesTouched)),
    statChip('Active days', formatInt(user.deterministic.activeDays.length)),
  ];
  if (llmEnabled) {
    chips.push(
      statChip('Contributions', formatInt(user.llm.contributions.length)),
      statChip('Weighted points', formatInt(weightedPointsOf(user.llm.contributions))),
    );
  }
  return chips;
}

/**
 * The per-repository commit counts of the user; hidden when the user
 * worked in a single repository.
 *
 * @param series - The user's series.
 * @returns The element, or `null` with one repository.
 */
function UserRepos({ series }: { series: UserSeries }): ReactElement | null {
  if (series.repos.length <= 1) {
    return null;
  }
  return (
    <div className="user-repos">
      <span className="contribution-row-caption">Repositories</span>
      <ul className="user-repo-list">
        {series.repos.map((repo) => (
          <li key={repo.repo}>
            <span className="user-repo-name">{repoLabel(repo.repo)}</span>
            <span className="user-repo-commits">
              {formatInt(repo.commits)} {repo.commits === 1 ? 'commit' : 'commits'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The LLM contribution cards of the user with their heading.
 *
 * @param series - The user's series.
 * @param data - The chart data, for the periods.
 * @returns The element.
 */
function UserContributions({
  series,
  data,
}: {
  series: UserSeries;
  data: ChartData;
}): ReactElement {
  return (
    <>
      <h4 className="user-contributions-title">
        Contributions
        <span className="contribution-group-count">
          {formatInt(series.user.llm.contributions.length)} assessed by the LLM
        </span>
      </h4>
      <ContributionList series={series} periods={data.periods} />
    </>
  );
}

/**
 * Renders the detail view of the selected user.
 *
 * @param props - The user's series and the chart data.
 * @returns The detail element.
 */
export function UserDetail({ series, data }: UserDetailProps): ReactElement {
  const { selections, setSelected } = useTagSelections();
  const groups = useMemo(() => buildUserGroups(series, data), [series, data]);
  const user = series.user;
  const llmEnabled = data.parameters.llmEnabled;
  return (
    <div className="user-detail">
      <header className="user-detail-head">
        <span className="user-avatar" aria-hidden="true">
          {userInitials(user.name)}
        </span>
        <div className="user-detail-title">
          <h3 className="user-detail-name">
            {user.name}
            {user.isBot ? <span className="user-bot-badge">bot</span> : null}
          </h3>
          <p className="user-detail-emails">{user.emails.join(', ')}</p>
        </div>
      </header>
      <div className="user-stats">{statChips(series, llmEnabled)}</div>
      {llmEnabled && user.llm.overview !== undefined ? (
        <p className="user-overview">{user.llm.overview}</p>
      ) : null}
      {groups.map((group) => (
        <ChartGroup key={group.id} title={group.title} lead={group.lead}>
          {group.blocks.map((descriptor) => (
            <DescriptorBlock
              key={descriptor.id}
              descriptor={descriptor}
              selected={resolveSelection(selections, descriptor)}
              onSelect={(selection) => setSelected(descriptor.id, selection)}
              height={280}
            />
          ))}
        </ChartGroup>
      ))}
      <UserRepos series={series} />
      {llmEnabled ? <UserContributions series={series} data={data} /> : null}
    </div>
  );
}
