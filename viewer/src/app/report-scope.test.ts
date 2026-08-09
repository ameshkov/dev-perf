/**
 * Tests for the report scope hook: initial chart data, repository and
 * user selections recomputing the scope, the option collectors, and
 * the reset and select-all normalization.
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { buildDemoReport } from '../../test/report-builder.js';
import { useReportScope } from './report-scope.js';

const API = 'git@github.com:acme/api.git';
const WEB = 'https://github.com/acme/web.git';

describe('useReportScope', () => {
  it('starts unfiltered with the full chart data and options', () => {
    const { result } = renderHook(() => useReportScope(buildDemoReport()));
    const scope = result.current;
    expect(scope.isFiltered).toBe(false);
    expect(scope.selectedRepos).toBeUndefined();
    expect(scope.selectedUsers).toBeUndefined();
    expect(scope.data.totals.commits).toBe(23);
    expect(scope.data.users).toHaveLength(2);
    expect(scope.repoOptions).toEqual([
      { key: API, value: 17 },
      { key: WEB, value: 6 },
    ]);
    expect(scope.userOptions).toEqual([
      { key: 'Alice Nguyen', value: 12 },
      { key: 'Bob Fisher', value: 11 },
    ]);
  });

  it('recomputes the chart data when a repository is deselected', () => {
    const { result } = renderHook(() => useReportScope(buildDemoReport()));
    act(() => result.current.repoHandlers.onToggle(API));

    const scope = result.current;
    expect(scope.isFiltered).toBe(true);
    expect(scope.selectedRepos).toEqual(new Set([WEB]));
    expect(scope.data.totals.commits).toBe(6);
    expect(scope.data.parameters.repos.map((spec) => spec.repo)).toEqual([WEB]);
    // User options reflect the repository scope, so counts drop.
    expect(scope.userOptions).toEqual([
      { key: 'Alice Nguyen', value: 4 },
      { key: 'Bob Fisher', value: 2 },
    ]);
    // Repo options stay the full list so the chip can be toggled back.
    expect(scope.repoOptions).toHaveLength(2);
  });

  it('recomputes the chart data when a user is deselected', () => {
    const { result } = renderHook(() => useReportScope(buildDemoReport()));
    act(() => result.current.userHandlers.onToggle('Alice Nguyen'));

    const scope = result.current;
    expect(scope.isFiltered).toBe(true);
    expect(scope.selectedUsers).toEqual(new Set(['Bob Fisher']));
    expect(scope.data.totals.commits).toBe(11);
    expect(scope.data.users.map((series) => series.user.name)).toEqual(['Bob Fisher']);
  });

  it('applies repository and user selections together', () => {
    const { result } = renderHook(() => useReportScope(buildDemoReport()));
    act(() => result.current.repoHandlers.onToggle(API));
    act(() => result.current.userHandlers.onToggle('Alice Nguyen'));

    const scope = result.current;
    expect(scope.isFiltered).toBe(true);
    expect(scope.selectedRepos).toEqual(new Set([WEB]));
    expect(scope.selectedUsers).toEqual(new Set(['Bob Fisher']));
    expect(scope.data.totals.commits).toBe(2);
    expect(scope.data.users.map((series) => series.user.name)).toEqual(['Bob Fisher']);
  });

  it('normalizes toggling the last repository back on to unfiltered', () => {
    const { result } = renderHook(() => useReportScope(buildDemoReport()));
    act(() => result.current.repoHandlers.onToggle(WEB));
    expect(result.current.selectedRepos).toEqual(new Set([API]));

    act(() => result.current.repoHandlers.onToggle(WEB));
    expect(result.current.selectedRepos).toBeUndefined();
    expect(result.current.isFiltered).toBe(false);
    expect(result.current.data.totals.commits).toBe(23);
  });

  it('select-all clears the filter for a group', () => {
    const { result } = renderHook(() => useReportScope(buildDemoReport()));
    act(() => result.current.userHandlers.onToggle('Alice Nguyen'));
    expect(result.current.selectedUsers).toEqual(new Set(['Bob Fisher']));

    act(() => result.current.userHandlers.onSelectAll());
    expect(result.current.selectedUsers).toBeUndefined();
    expect(result.current.data.users).toHaveLength(2);
  });

  it('clear-all empties a group and zeroes the chart data', () => {
    const { result } = renderHook(() => useReportScope(buildDemoReport()));
    act(() => result.current.userHandlers.onClearAll());

    const scope = result.current;
    expect(scope.selectedUsers).toEqual(new Set());
    expect(scope.isFiltered).toBe(true);
    expect(scope.data.totals.commits).toBe(0);
    expect(scope.data.users).toHaveLength(0);
  });

  it('reset restores the full report', () => {
    const { result } = renderHook(() => useReportScope(buildDemoReport()));
    act(() => result.current.repoHandlers.onToggle(API));
    act(() => result.current.userHandlers.onToggle('Bob Fisher'));
    expect(result.current.isFiltered).toBe(true);

    act(() => result.current.reset());
    const scope = result.current;
    expect(scope.isFiltered).toBe(false);
    expect(scope.selectedRepos).toBeUndefined();
    expect(scope.selectedUsers).toBeUndefined();
    expect(scope.data.totals.commits).toBe(23);
  });
});
