/**
 * Tests for the "Contributor statistics" group of the control bar: the
 * contributor picker drives the selected contributor, and the period
 * chips — hidden when the periods are not navigable — mark the
 * currently viewed period active and select another on click.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { buildDemoReport } from '../../test/report-builder.js';
import { buildChartData } from '../data/index.js';
import type { PeriodInfo, UserSeries } from '../data/index.js';
import { ContributorNav } from './contributor-nav.js';

const DEMO = buildChartData(buildDemoReport());
const USERS: UserSeries[] = DEMO.users;
const PERIODS: PeriodInfo[] = DEMO.periods;

/** Renders the group with sane defaults. */
function renderNav(
  options: {
    users?: UserSeries[];
    selectedUser?: string;
    periods?: PeriodInfo[];
    periodsNavigable?: boolean;
    selectedPeriod?: number;
    onSelectUser?: (name: string) => void;
    onSelectPeriod?: (index: number) => void;
  } = {},
) {
  const onSelectUser = vi.fn();
  const onSelectPeriod = vi.fn();
  const view = render(
    <ContributorNav
      users={options.users ?? USERS}
      selectedUser={options.selectedUser ?? 'Alice Nguyen'}
      onSelectUser={options.onSelectUser ?? onSelectUser}
      periods={options.periods ?? PERIODS}
      periodsNavigable={options.periodsNavigable ?? true}
      selectedPeriod={options.selectedPeriod ?? 1}
      onSelectPeriod={options.onSelectPeriod ?? onSelectPeriod}
    />,
  );
  return { onSelectUser, onSelectPeriod, ...view };
}

describe('ContributorNav', () => {
  it('renders the caption, the contributor select and the period chips', () => {
    renderNav();
    const group = screen.getByRole('group', { name: 'Contributor statistics' });
    const options = within(group).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['Alice Nguyen', 'Bob Fisher']);
    // The currently viewed period chip is highlighted.
    const periods = within(group).getAllByRole('button');
    expect(periods.map((period) => period.textContent)).toEqual(['2026-01', '2026-02']);
    expect(periods[1]?.getAttribute('aria-pressed')).toBe('true');
    expect(periods[0]?.getAttribute('aria-pressed')).toBe('false');
  });

  it('preselects the selected contributor', () => {
    renderNav({ selectedUser: 'Bob Fisher' });
    const group = screen.getByRole('group', { name: 'Contributor statistics' });
    expect((within(group).getByRole('combobox') as HTMLSelectElement).value).toBe('Bob Fisher');
  });

  it('runs onSelectUser with the picked contributor', () => {
    const { onSelectUser } = renderNav();
    const group = screen.getByRole('group', { name: 'Contributor statistics' });
    fireEvent.change(within(group).getByRole('combobox'), { target: { value: 'Bob Fisher' } });
    expect(onSelectUser).toHaveBeenCalledTimes(1);
    expect(onSelectUser).toHaveBeenCalledWith('Bob Fisher');
  });

  it('runs onSelectPeriod with the index of the clicked period', () => {
    const { onSelectPeriod } = renderNav();
    const group = screen.getByRole('group', { name: 'Contributor statistics' });
    fireEvent.click(within(group).getByRole('button', { name: '2026-01' }));
    expect(onSelectPeriod).toHaveBeenCalledTimes(1);
    expect(onSelectPeriod).toHaveBeenCalledWith(0);
  });

  it('keeps the contributor select but hides the period chips when not navigable', () => {
    renderNav({ periodsNavigable: false });
    const group = screen.getByRole('group', { name: 'Contributor statistics' });
    expect(within(group).getByRole('combobox')).toBeDefined();
    expect(within(group).queryByRole('button')).toBeNull();
  });
});
