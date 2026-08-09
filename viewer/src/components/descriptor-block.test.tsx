/**
 * Tests for the descriptor block: fixed blocks render their chart
 * directly, tag-based blocks render the selector and follow the
 * selection, and an empty selection shows the placeholder.
 */
import { render, screen } from '@testing-library/react';
import type { EChartsOption } from 'echarts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
import type { CountRow } from '../data/index.js';
import type { ChartBlockDescriptor } from './index.js';
import { DescriptorBlock } from './index.js';

const tags: CountRow[] = [
  { key: 'a', value: 2 },
  { key: 'b', value: 1 },
];

/** A sentinel option object for the full selection. */
const optionAll = { grid: {} } as unknown as EChartsOption;

/** A sentinel option object for a narrowed selection. */
const optionNarrow = { grid: { left: 1 } } as unknown as EChartsOption;

describe('DescriptorBlock', () => {
  beforeEach(() => {
    vi.mocked(echarts.init).mockClear();
    mockChart.setOption.mockClear();
    mockChart.dispose.mockClear();
  });

  it('renders a fixed block without a tag selector and builds the option with no selection', () => {
    const optionOf = vi.fn((_selected: ReadonlySet<string> | undefined) => optionAll);
    const descriptor: ChartBlockDescriptor = {
      id: 'fixed',
      title: 'Fixed block',
      description: 'No tags here.',
      optionOf,
    };

    render(<DescriptorBlock descriptor={descriptor} selected={undefined} onSelect={vi.fn()} />);

    expect(screen.getByText('Fixed block')).toBeDefined();
    expect(screen.getByText('No tags here.')).toBeDefined();
    expect(screen.queryByText('Tags')).toBeNull();
    expect(optionOf).toHaveBeenCalledWith(undefined);
    expect(echarts.init).toHaveBeenCalledTimes(1);
    expect(mockChart.setOption).toHaveBeenCalledWith(optionAll, { notMerge: true });
  });

  it('renders the tag selector of a tag-based block and follows the selection', () => {
    const optionOf = vi.fn((selected: ReadonlySet<string> | undefined) =>
      selected !== undefined && selected.size === 1 ? optionNarrow : optionAll,
    );
    const descriptor: ChartBlockDescriptor = {
      id: 'tagged',
      title: 'Tagged',
      description: 'Tags.',
      tags,
      optionOf,
    };

    const { rerender } = render(
      <DescriptorBlock descriptor={descriptor} selected={new Set(['a', 'b'])} onSelect={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: /a/ })).toBeDefined();
    expect(optionOf).toHaveBeenCalledWith(new Set(['a', 'b']));
    expect(mockChart.setOption).toHaveBeenLastCalledWith(optionAll, { notMerge: true });

    rerender(
      <DescriptorBlock descriptor={descriptor} selected={new Set(['a'])} onSelect={vi.fn()} />,
    );
    expect(optionOf).toHaveBeenCalledWith(new Set(['a']));
    expect(mockChart.setOption).toHaveBeenLastCalledWith(optionNarrow, { notMerge: true });
  });

  it('passes the wide flag of the descriptor to the card', () => {
    const descriptor: ChartBlockDescriptor = {
      id: 'wide',
      title: 'Wide block',
      description: 'Spans the grid.',
      wide: true,
      optionOf: () => optionAll,
    };

    const { container } = render(
      <DescriptorBlock descriptor={descriptor} selected={undefined} onSelect={vi.fn()} />,
    );

    expect(container.querySelector('.chart-block')?.className).toBe('chart-block chart-block-wide');
  });

  it('shows the empty placeholder when the tag selection is empty', () => {
    const optionOf = vi.fn(() => optionAll);
    const descriptor: ChartBlockDescriptor = {
      id: 'tagged',
      title: 'Tagged',
      description: 'Tags.',
      tags,
      optionOf,
    };

    render(<DescriptorBlock descriptor={descriptor} selected={new Set()} onSelect={vi.fn()} />);

    expect(screen.getByText('Select at least one tag above to draw this chart.')).toBeDefined();
    expect(screen.queryByRole('img')).toBeNull();
    expect(echarts.init).not.toHaveBeenCalled();
  });
});
