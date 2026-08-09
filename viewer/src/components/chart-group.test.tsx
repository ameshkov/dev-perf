/**
 * Tests for the chart group: the heading, the lead line and the grid
 * wrapper around the block cards.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChartGroup } from './chart-group.js';

describe('ChartGroup', () => {
  it('renders the heading, the lead and the children in a chart grid', () => {
    const { container } = render(
      <ChartGroup title="Activity" lead="How much shipped per period.">
        <div>card</div>
      </ChartGroup>,
    );
    expect(screen.getByRole('heading', { level: 3, name: 'Activity' })).toBeDefined();
    expect(screen.getByText('How much shipped per period.')).toBeDefined();
    const grid = container.querySelector('.chart-group > .chart-grid');
    expect(grid?.textContent).toBe('card');
  });
});
