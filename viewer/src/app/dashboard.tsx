/**
 * The dashboard of a loaded report: the navigation panel (section
 * navigation, the repository and contributor scope filters, reset) —
 * hidden until the top bar opens it — the overview with the meta bar
 * and the KPI grid of team totals, and the team and individual
 * sections, all recomputed for the chosen scope.
 */
import { useEffect, useMemo } from 'react';
import type { ReactElement } from 'react';
import type { ChartData } from '../data/index.js';
import type { TrendReport } from '../report/index.js';
import {
  formatCompact,
  formatDateTime,
  formatInt,
  formatNumber,
  formatRange,
} from '../data/index.js';
import type { KpiItem } from '../components/index.js';
import { KpiGrid } from '../components/index.js';
import { TeamSection } from '../team/index.js';
import { IndividualSection } from '../individual/index.js';
import { RepoChips } from './repo-chips.js';
import { useReportScope } from './report-scope.js';
import { SectionNav } from './section-nav.js';
import type { SectionNavItem } from './section-nav.js';
import { ScopeFilters } from './scope-filters.js';

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

  useEffect(() => {
    if (!navOpen) {
      return;
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onNavClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navOpen, onNavClose]);

  return (
    <div className="dashboard">
      {navOpen ? (
        <>
          <div className="nav-backdrop" aria-hidden="true" onClick={onNavClose} />
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
          </div>
        </>
      ) : null}
      <div id="overview">
        {metaBar(data, fileName)}
        <KpiGrid items={kpiItems(data)} />
      </div>
      <TeamSection data={data} />
      <IndividualSection data={data} />
    </div>
  );
}
