/**
 * Tests for the individual section: the contributor picker lists every
 * user, the dashboard's selected contributor is the one shown, and a
 * period jump scrolls to the group of the selected contributor without
 * switching them.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDemoReport } from '../../test/report-builder.js';
import { buildChartData } from '../data/index.js';

const mockChart = vi.hoisted(() => ({
  setOption: vi.fn(),
  resize: vi.fn(),
  dispose: vi.fn(),
}));

vi.mock('../charts/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../charts/index.js')>();
  return {
    ...actual,
    CHART_THEME: 'devperf-test',
    echarts: { init: vi.fn(() => mockChart) },
  };
});

import { echarts } from '../charts/index.js';
import { IndividualSection } from './user-section.js';

const data = buildChartData(buildDemoReport());

/** Renders the section for a selected contributor. */
function renderSection(selectedUser: string, onSelectUser = vi.fn()) {
  return render(
    <IndividualSection data={data} selectedUser={selectedUser} onSelectUser={onSelectUser} />,
  );
}

describe('IndividualSection', () => {
  beforeEach(() => {
    vi.mocked(echarts.init).mockClear();
    mockChart.setOption.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('lists every user in the picker with their totals and marks the selected one', () => {
    renderSection('Alice Nguyen');
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(2);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(tabs[1].getAttribute('aria-selected')).toBe('false');
    expect(screen.getAllByText('Alice Nguyen')[0]).toBeDefined();
    expect(screen.getAllByText('Bob Fisher')[0]).toBeDefined();
    expect(screen.getByText('12 commits · 2 contributions')).toBeDefined();
    expect(screen.getByText('11 commits · 1 contributions')).toBeDefined();

    // The selected user's detail is visible; the LLM overview opens the
    // unit's contribution section, not a clamped block at the top.
    expect(screen.getByText('alice@example.com')).toBeDefined();
    const overview = screen.getByText('Shipped the payments API.');
    expect(overview.className).toBe('contribution-overview');
    expect(overview.closest('.contribution-group')).not.toBeNull();
  });

  it('asks to switch when another user is picked and shows the new one', () => {
    const onSelectUser = vi.fn();
    const view = renderSection('Alice Nguyen', onSelectUser);

    fireEvent.click(screen.getAllByRole('tab')[1]);

    expect(onSelectUser).toHaveBeenCalledTimes(1);
    expect(onSelectUser).toHaveBeenCalledWith('Bob Fisher');

    // The dashboard updates the selected contributor; the section
    // re-renders with the new value.
    view.rerender(
      <IndividualSection data={data} selectedUser="Bob Fisher" onSelectUser={onSelectUser} />,
    );
    expect(screen.getByText('bob@example.com')).toBeDefined();
    expect(screen.queryByText('alice@example.com')).toBeNull();
  });

  it('scrolls to the group of the jumped-to period without switching the contributor', () => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
      callback(0);
      return 1;
    });
    // Alice is the selected contributor; the February group scrolls
    // even though Bob did most of the work there.
    const { container } = render(
      <IndividualSection
        data={data}
        selectedUser="Alice Nguyen"
        onSelectUser={vi.fn()}
        jump={{ index: 1, salt: 1 }}
      />,
    );

    expect(screen.getByText('alice@example.com')).toBeDefined();
    expect(window.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }));
    const group = container.querySelector('#period-1');
    expect(group?.querySelector('.contribution-empty')).not.toBeNull();
    vi.unstubAllGlobals();
  });

  it('does not scroll when a person is picked manually', () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    const onSelectUser = vi.fn();
    renderSection('Alice Nguyen', onSelectUser);

    fireEvent.click(screen.getAllByRole('tab')[1]);

    expect(onSelectUser).toHaveBeenCalledWith('Bob Fisher');
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('renders nothing for a report without users', () => {
    const empty = { ...data, users: [] };
    const { container } = render(
      <IndividualSection data={empty} selectedUser="" onSelectUser={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows the generated lines chip when an identity touched generated files', () => {
    const report = buildDemoReport();
    report.periods[0].repositories[0].users[0].deterministic.generated = {
      linesAdded: 30,
      linesRemoved: 4,
      filesTouched: 2,
    };
    render(
      <IndividualSection
        data={buildChartData(report)}
        selectedUser="Alice Nguyen"
        onSelectUser={vi.fn()}
      />,
    );
    expect(screen.getByText('Generated lines')).toBeDefined();
    expect(screen.getByText('+30 / −4')).toBeDefined();
  });
});
