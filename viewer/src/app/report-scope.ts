/**
 * The report scope of the dashboard: the selected repositories and
 * users, the narrowed report and its chart data recomputed for the
 * scope, the chip options of both filter groups, and the change
 * handlers. Selections stay `undefined` while nothing is filtered out,
 * so an unscoped dashboard renders the loaded report as-is.
 */
import { useCallback, useMemo, useState } from 'react';
import type { ChartData, CountRow, ReportSelection } from '../data/index.js';
import type { TrendReport } from '../report/index.js';
import {
  buildChartData,
  collectRepoOptions,
  collectUserOptions,
  filterReport,
  toggleScopedValue,
} from '../data/index.js';

/** The change handlers of one scope filter group. */
export interface ScopeHandlers {
  /** Toggles one option in or out of the selection. */
  onToggle: (key: string) => void;
  /** Selects every option (clears the filter). */
  onSelectAll: () => void;
  /** Deselects every option. */
  onClearAll: () => void;
}

/** The API of the {@link useReportScope} hook. */
export interface ReportScope {
  /** The chart data recomputed for the current scope. */
  data: ChartData;
  /** Repository chip options of the full report, most commits first. */
  repoOptions: CountRow[];
  /** User chip options of the repository-scoped report. */
  userOptions: CountRow[];
  /** The selected repositories; `undefined` while unfiltered. */
  selectedRepos: ReadonlySet<string> | undefined;
  /** The selected users; `undefined` while unfiltered. */
  selectedUsers: ReadonlySet<string> | undefined;
  /** Whether any scope filter is active. */
  isFiltered: boolean;
  /** The change handlers of the repository group. */
  repoHandlers: ScopeHandlers;
  /** The change handlers of the user group. */
  userHandlers: ScopeHandlers;
  /** Clears both selections. */
  reset: () => void;
}

/**
 * Builds the change handlers of one scope filter group against its
 * current selection.
 *
 * @param options - The options of the group.
 * @param selected - The current selection; `undefined` means all.
 * @param setSelected - Replaces the selection.
 * @returns The handlers.
 */
function scopeHandlers(
  options: CountRow[],
  selected: ReadonlySet<string> | undefined,
  setSelected: (selection: ReadonlySet<string> | undefined) => void,
): ScopeHandlers {
  return {
    onToggle: (key: string): void => setSelected(toggleScopedValue(options, selected, key)),
    onSelectAll: (): void => setSelected(undefined),
    onClearAll: (): void => setSelected(new Set()),
  };
}

/**
 * The report scope state of the dashboard: selections narrow the
 * loaded report before the chart data is extracted, so every section
 * (overview, team dynamics, distributions, individuals) reflects the
 * chosen repositories and users.
 *
 * @param report - The loaded trend report.
 * @returns The scope API.
 */
export function useReportScope(report: TrendReport): ReportScope {
  const [selectedRepos, setSelectedRepos] = useState<ReadonlySet<string> | undefined>(undefined);
  const [selectedUsers, setSelectedUsers] = useState<ReadonlySet<string> | undefined>(undefined);

  const repoOptions = useMemo(() => collectRepoOptions(report), [report]);
  const repoScoped = useMemo(() => {
    const selection: ReportSelection = { repos: selectedRepos };
    return filterReport(report, selection);
  }, [report, selectedRepos]);
  const userOptions = useMemo(() => collectUserOptions(repoScoped), [repoScoped]);
  const scoped = useMemo(() => {
    const selection: ReportSelection = { repos: selectedRepos, users: selectedUsers };
    return filterReport(report, selection);
  }, [report, selectedRepos, selectedUsers]);
  const data = useMemo(() => buildChartData(scoped), [scoped]);

  const repoHandlers = useMemo(
    () => scopeHandlers(repoOptions, selectedRepos, setSelectedRepos),
    [repoOptions, selectedRepos],
  );
  const userHandlers = useMemo(
    () => scopeHandlers(userOptions, selectedUsers, setSelectedUsers),
    [userOptions, selectedUsers],
  );

  const reset = useCallback((): void => {
    setSelectedRepos(undefined);
    setSelectedUsers(undefined);
  }, []);

  return {
    data,
    repoOptions,
    userOptions,
    selectedRepos,
    selectedUsers,
    isFiltered: selectedRepos !== undefined || selectedUsers !== undefined,
    repoHandlers,
    userHandlers,
    reset,
  };
}
