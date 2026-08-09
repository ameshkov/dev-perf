/**
 * Tests for the EChart wrapper: init with the theme, option pushes
 * with notMerge, re-render updates, and disposal on unmount.
 */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { formatInt } from '../data/index.js';

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

import { barOption } from '../charts/index.js';
import { echarts } from '../charts/index.js';
import { EChart } from './e-chart.js';

const optionA = barOption(['Jan'], { name: 'Points', data: [3] }, formatInt);
const optionB = barOption(['Feb'], { name: 'Points', data: [5] }, formatInt);

describe('EChart', () => {
  beforeEach(() => {
    vi.mocked(echarts.init).mockClear();
    mockChart.setOption.mockClear();
    mockChart.resize.mockClear();
    mockChart.dispose.mockClear();
  });

  it('renders an img role with the label and the default inline height', () => {
    render(<EChart option={optionA} label="Points per period" />);
    const chart = screen.getByRole('img', { name: 'Points per period' });
    expect(chart.style.height).toBe('300px');
  });

  it('applies a custom height', () => {
    render(<EChart option={optionA} height={220} />);
    expect(screen.getByRole('img').style.height).toBe('220px');
  });

  it('initializes once with the mocked theme and pushes the option without merging', () => {
    render(<EChart option={optionA} label="Chart" />);
    expect(echarts.init).toHaveBeenCalledTimes(1);
    expect(echarts.init).toHaveBeenCalledWith(expect.any(HTMLDivElement), 'devperf-test');
    expect(mockChart.setOption).toHaveBeenCalledTimes(1);
    expect(mockChart.setOption).toHaveBeenCalledWith(optionA, { notMerge: true });
  });

  it('pushes the option again when it changes', () => {
    const { rerender } = render(<EChart option={optionA} />);
    rerender(<EChart option={optionB} />);
    expect(echarts.init).toHaveBeenCalledTimes(1);
    expect(mockChart.setOption).toHaveBeenCalledTimes(2);
    expect(mockChart.setOption).toHaveBeenLastCalledWith(optionB, { notMerge: true });
  });

  it('disposes the chart on unmount', () => {
    const { unmount } = render(<EChart option={optionA} />);
    unmount();
    expect(mockChart.dispose).toHaveBeenCalledTimes(1);
  });
});
