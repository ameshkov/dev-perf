/**
 * Tests for the team section render: the chart groups with one card
 * per block descriptor, gated by the LLM analysis flag.
 */
import { render, screen } from '@testing-library/react';
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
import { TeamSection } from './team-section.js';

describe('TeamSection', () => {
  beforeEach(() => {
    vi.mocked(echarts.init).mockClear();
    mockChart.setOption.mockClear();
  });

  it('renders the three chart groups with one block per descriptor', () => {
    render(<TeamSection data={buildChartData(buildDemoReport())} />);

    const groups = screen.getAllByRole('heading', { level: 3 });
    expect(groups.map((group) => group.textContent)).toEqual([
      'Activity',
      'Nature of work',
      'Risk & quality signals',
    ]);

    // 9 LLM blocks + 5 deterministic blocks + 3 distribution blocks.
    const titles = screen.getAllByRole('heading', { level: 4 });
    expect(titles).toHaveLength(17);
    expect(vi.mocked(echarts.init).mock.calls).toHaveLength(17);
    expect(screen.getByText('Points per period')).toBeDefined();
    expect(screen.getByText('Commits per period')).toBeDefined();
    expect(screen.getByText('Work-type share')).toBeDefined();
  });

  it('renders the wide class on the repo comparison and the per-period signal blocks', () => {
    const { container } = render(<TeamSection data={buildChartData(buildDemoReport())} />);

    const wide = [...container.querySelectorAll('.chart-block-wide')];
    expect(wide.map((block) => block.querySelector('.chart-block-title')?.textContent)).toEqual([
      'Commits per repository',
      'Risk flags per period',
      'Quality signals per period',
    ]);
  });

  it('renders only the deterministic groups when the LLM is disabled', () => {
    render(<TeamSection data={buildChartData(buildDemoReport({ llmEnabled: false }))} />);

    const groups = screen.getAllByRole('heading', { level: 3 });
    expect(groups.map((group) => group.textContent)).toEqual(['Activity', 'Nature of work']);

    const titles = screen.getAllByRole('heading', { level: 4 });
    expect(titles).toHaveLength(5);
    expect(screen.queryByText('Points per period')).toBeNull();
    expect(screen.getByText('Commits per period')).toBeDefined();
  });
});
