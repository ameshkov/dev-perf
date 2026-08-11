/**
 * Tests for the individual section: the contributor picker lists every
 * user, the first is selected by default, and clicking switches the
 * detail view.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('IndividualSection', () => {
  beforeEach(() => {
    vi.mocked(echarts.init).mockClear();
    mockChart.setOption.mockClear();
  });

  it('lists every user in the picker with their totals and selects the first by default', () => {
    render(<IndividualSection data={data} />);

    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(2);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(tabs[1].getAttribute('aria-selected')).toBe('false');
    expect(screen.getAllByText('Alice Nguyen')[0]).toBeDefined();
    expect(screen.getAllByText('Bob Fisher')[0]).toBeDefined();
    expect(screen.getByText('12 commits · 2 contributions')).toBeDefined();
    expect(screen.getByText('11 commits · 1 contributions')).toBeDefined();

    // The first user's detail is visible; the LLM overview opens the
    // unit's contribution section, not a clamped block at the top.
    expect(screen.getByText('alice@example.com')).toBeDefined();
    const overview = screen.getByText('Shipped the payments API.');
    expect(overview.className).toBe('contribution-overview');
    expect(overview.closest('.contribution-group')).not.toBeNull();
  });

  it('switches the detail view when another user is picked', () => {
    render(<IndividualSection data={data} />);

    fireEvent.click(screen.getAllByRole('tab')[1]);

    expect(screen.getByText('bob@example.com')).toBeDefined();
    const overview = screen.getByText('Hardened the auth layer.');
    expect(overview.className).toBe('contribution-overview');
    expect(screen.queryByText('alice@example.com')).toBeNull();
  });

  it('renders nothing for a report without users', () => {
    const empty = { ...data, users: [] };
    const { container } = render(<IndividualSection data={empty} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the generated lines chip when an identity touched generated files', () => {
    const report = buildDemoReport();
    report.periods[0].repositories[0].users[0].deterministic.generated = {
      linesAdded: 30,
      linesRemoved: 4,
      filesTouched: 2,
    };
    render(<IndividualSection data={buildChartData(report)} />);

    expect(screen.getByText('Generated lines')).toBeDefined();
    expect(screen.getByText('+30 / −4')).toBeDefined();
  });
});
