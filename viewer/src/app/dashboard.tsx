/**
 * The dashboard of a loaded report: the navigation panel (section
 * navigation, the contributor and period selectors, the repository and
 * contributor scope filters, reset) — hidden until the top bar opens
 * it — the overview with the meta bar and the KPI grid of team totals,
 * and the team and individual sections, all recomputed for the chosen
 * scope. The selected contributor and period are owned here so both
 * the panel and the individual section share them.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import type { ChartData, PeriodInfo, UserSeries } from '../data/index.js';
import {
  formatCompact,
  formatDateTime,
  formatInt,
  formatNumber,
  formatRange,
} from '../data/index.js';
import type { TrendReport } from '../report/index.js';
import type { KpiItem } from '../components/index.js';
import { KpiGrid, scrollToId } from '../components/index.js';
import { TeamSection } from '../team/index.js';
import { IndividualSection } from '../individual/index.js';
import type { PeriodJump } from '../individual/index.js';
import { RepoChips } from './repo-chips.js';
import { useReportScope } from './report-scope.js';
import type { ReportScope } from './report-scope.js';
import { SectionNav } from './section-nav.js';
import type { SectionNavItem } from './section-nav.js';
import { ScopeFilters } from './scope-filters.js';
import { ContributorNav } from './contributor-nav.js';

/** The props of the {@link Dashboard} component. */
export interface DashboardProps {
  /** The loaded trend report. */
  report: TrendReport;
  /** The name of the loaded report file. */
  fileName: string;
  /** Whether the navigation panel is open. */
  navOpen: boolean;
  /** Closes the navigation panel. */
  onNavClose: () => void;
}

/**
 * The KPI cards of the team overview: git totals first, the LLM
 * counts and the bus factor when the report has an LLM analysis.
 *
 * @param data - The chart data.
 * @returns The KPI cards.
 */
function kpiItems(data: ChartData): KpiItem[] {
  const totals = data.totals;
  const items: KpiItem[] = [
    {
      label: 'Commits',
      value: formatInt(totals.commits),
      hint: `${formatInt(data.users.length)} contributors`,
    },
    { label: 'Lines added', value: `+${formatCompact(totals.linesAdded)}`, tone: 'good' },
    { label: 'Lines removed', value: `−${formatCompact(totals.linesRemoved)}` },
    {
      label: 'Net lines',
      value: `${totals.netLines >= 0 ? '+' : '−'}${formatCompact(Math.abs(totals.netLines))}`,
      tone: totals.netLines >= 0 ? 'good' : 'warn',
    },
    { label: 'Files touched', value: formatCompact(totals.filesTouched) },
    { label: 'Active users', value: formatInt(totals.activeUsers) },
  ];
  if (data.parameters.llmEnabled) {
    items.push(
      {
        label: 'Contributions',
        value: formatInt(totals.contributions),
        hint: 'assessed by the LLM',
      },
      {
        label: 'Weighted points',
        value: formatInt(totals.weightedPoints),
        hint: 'size × complexity (low · med · high)',
      },
    );
  }
  if (data.busFactor !== undefined) {
    items.push({
      label: 'Bus factor',
      value: formatInt(data.busFactor.users.length),
      hint: `${data.busFactor.users.join(', ')} cover ${formatNumber(data.busFactor.commitShare * 100)}% of commits`,
      tone: 'warn',
    });
  }
  return items;
}

/**
 * The meta bar: the loaded file and the parameters of the analysis
 * run that produced it, narrowed to the repositories in scope.
 *
 * @param data - The chart data.
 * @param fileName - The loaded file name.
 * @returns The meta bar element.
 */
function metaBar(data: ChartData, fileName: string): ReactElement {
  const { parameters } = data;
  const unit =
    parameters.unit === undefined ? 'single range' : `${data.periods.length} ${parameters.unit}s`;
  const llm = parameters.llmEnabled
    ? `LLM: ${parameters.model ?? 'model unknown'}`
    : 'no LLM analysis';
  return (
    <div className="meta-bar">
      <span className="meta-chip meta-chip-file" title={`Loaded from ${fileName}`}>
        {fileName}
      </span>
      <RepoChips repos={parameters.repos} />
      <span className="meta-chip">{formatRange(parameters.since, parameters.until)}</span>
      <span className="meta-chip">{unit}</span>
      <span className="meta-chip">{llm}</span>
      <span className="meta-chip">generated {formatDateTime(parameters.generatedAt)}</span>
    </div>
  );
}

/**
 * The section links of the control bar: the overview and the team
 * dynamics always, the individuals only while contributors are in
 * scope.
 *
 * @param data - The chart data.
 * @returns The section items.
 */
function sectionItems(data: ChartData): SectionNavItem[] {
  const items: SectionNavItem[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'team', label: 'Team dynamics' },
  ];
  if (data.users.length > 0) {
    items.push({ id: 'individuals', label: 'Individual dynamics' });
  }
  return items;
}

/** The props of the {@link ControlBar} component. */
interface ControlBarProps {
  /** The report scope state, for the reset button and the filters. */
  scope: ReportScope;
  /** The section links. */
  sections: SectionNavItem[];
  /** The contributors in scope, for the contributor picker. */
  users: UserSeries[];
  /** The periods, for the period chips. */
  periods: PeriodInfo[];
  /** Whether the period chips are shown (multi-period LLM reports). */
  periodsNavigable: boolean;
  /** The name of the selected contributor. */
  selectedUser: string;
  /** The index of the currently viewed period. */
  selectedPeriod: number;
  /** Selects a contributor; the dashboard navigates to that user. */
  onSelectUser: (name: string) => void;
  /** Selects a period; the dashboard jumps to its contribution group. */
  onSelectPeriod: (periodIndex: number) => void;
  /** Runs after any link navigates; closes the panel. */
  onNavClose: () => void;
}

/**
 * The navigation panel content: the section links, the reset button,
 * the scope filters, and the contributor statistics group.
 *
 * @param props - The scope state, the section links, the contributor
 *   and period selections, and the navigation callbacks.
 * @returns The control bar element.
 */
function ControlBar({
  scope,
  sections,
  users,
  periods,
  periodsNavigable,
  selectedUser,
  selectedPeriod,
  onSelectUser,
  onSelectPeriod,
  onNavClose,
}: ControlBarProps): ReactElement {
  return (
    <div className="control-bar" id="control-bar">
      <div className="control-bar-head">
        <SectionNav sections={sections} onNavigate={onNavClose} />
        {scope.isFiltered ? (
          <button type="button" className="scope-reset" onClick={scope.reset}>
            Reset filters
          </button>
        ) : null}
      </div>
      <ScopeFilters
        repoOptions={scope.repoOptions}
        selectedRepos={scope.selectedRepos}
        repoHandlers={scope.repoHandlers}
        userOptions={scope.userOptions}
        selectedUsers={scope.selectedUsers}
        userHandlers={scope.userHandlers}
      />
      {users.length > 0 ? (
        <ContributorNav
          users={users}
          selectedUser={selectedUser}
          onSelectUser={onSelectUser}
          periods={periods}
          periodsNavigable={periodsNavigable}
          selectedPeriod={selectedPeriod}
          onSelectPeriod={onSelectPeriod}
        />
      ) : null}
    </div>
  );
}

/**
 * Closes the navigation panel on Escape while it is open.
 *
 * @param open - Whether the panel is open.
 * @param onClose - Closes the panel.
 */
function useCloseOnEscape(open: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
}

/** The contributor and period selection shared by the panel and the
 * individual section. */
interface IndividualSelection {
  /** Sets the selected contributor without navigating (in-page pick). */
  setSelectedUser: (name: string) => void;
  /** The resolved contributor name in scope. */
  effectiveUser: string | undefined;
  /** The resolved period index, the latest while unselected. */
  effectivePeriod: number;
  /** Runs on a panel contributor pick; navigates to that user. */
  handleSelectUser: (name: string) => void;
  /** Runs on a panel period pick; jumps to the period's group. */
  handleSelectPeriod: (index: number) => void;
  /** A pending jump to one period's contribution group. */
  jump: PeriodJump | undefined;
  /** Clears a pending jump. */
  clearJump: () => void;
}

/**
 * The contributor and period selection of the dashboard: the raw
 * selection and its resolution against the current scope (the first
 * contributor / latest period while unselected or out of scope), plus
 * the navigation handlers of the panel.
 *
 * @param data - The chart data, for the contributors and periods.
 * @param onNavClose - Closes the panel after a pick.
 * @returns The selection API.
 */
function useIndividualSelection(data: ChartData, onNavClose: () => void): IndividualSelection {
  const [selectedUser, setSelectedUser] = useState<string | undefined>(undefined);
  const [selectedPeriod, setSelectedPeriod] = useState<number | undefined>(undefined);
  const [periodJump, setPeriodJump] = useState<PeriodJump | undefined>(undefined);
  const effectiveUser = useMemo(() => {
    if (
      selectedUser !== undefined &&
      data.users.some((series) => series.user.name === selectedUser)
    ) {
      return selectedUser;
    }
    return data.users.length > 0 ? data.users[0].user.name : undefined;
  }, [data.users, selectedUser]);
  const effectivePeriod = useMemo(() => {
    const last = data.periods.length - 1;
    return selectedPeriod === undefined || selectedPeriod > last
      ? Math.max(0, last)
      : selectedPeriod;
  }, [data.periods.length, selectedPeriod]);
  const clearJump = useCallback((): void => setPeriodJump(undefined), []);
  const handleSelectUser = (name: string): void => {
    setSelectedUser(name);
    clearJump();
    onNavClose();
    // Choosing a contributor navigates to their individual dynamics.
    scrollToId('individuals');
  };
  const handleSelectPeriod = (index: number): void => {
    setSelectedPeriod(index);
    setPeriodJump((previous) => ({ index, salt: (previous?.salt ?? 0) + 1 }));
    onNavClose();
  };
  return {
    setSelectedUser,
    effectiveUser,
    effectivePeriod,
    handleSelectUser,
    handleSelectPeriod,
    jump: periodJump,
    clearJump,
  };
}

/**
 * Renders the dashboard of a loaded report.
 *
 * @param props - The loaded report, the file name, and the navigation
 *   panel state.
 * @returns The dashboard element.
 */
export function Dashboard({ report, fileName, navOpen, onNavClose }: DashboardProps): ReactElement {
  const scope = useReportScope(report);
  const data = scope.data;
  const sections = useMemo(() => sectionItems(data), [data]);
  const selection = useIndividualSelection(data, onNavClose);
  const periodsNavigable = data.periods.length > 1 && data.parameters.llmEnabled;
  useCloseOnEscape(navOpen, onNavClose);
  return (
    <div className="dashboard">
      {navOpen ? (
        <>
          <div className="nav-backdrop" aria-hidden="true" onClick={onNavClose} />
          <ControlBar
            scope={scope}
            sections={sections}
            users={data.users}
            periods={data.periods}
            periodsNavigable={periodsNavigable}
            selectedUser={selection.effectiveUser ?? ''}
            selectedPeriod={selection.effectivePeriod}
            onSelectUser={selection.handleSelectUser}
            onSelectPeriod={selection.handleSelectPeriod}
            onNavClose={onNavClose}
          />
        </>
      ) : null}
      <div id="overview">
        {metaBar(data, fileName)}
        <KpiGrid items={kpiItems(data)} />
      </div>
      <TeamSection data={data} />
      <IndividualSection
        data={data}
        selectedUser={selection.effectiveUser ?? ''}
        onSelectUser={selection.setSelectedUser}
        jump={selection.jump}
        onClearJump={selection.clearJump}
      />
    </div>
  );
}
