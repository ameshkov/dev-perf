/**
 * Tests for the chart block card shell and its empty placeholder.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChartBlock, ChartEmpty } from './chart-block.js';

describe('ChartBlock', () => {
  it('renders the title, the description and the body', () => {
    render(
      <ChartBlock title="Commits per period" description="Bars over time.">
        <div>chart body</div>
      </ChartBlock>,
    );
    expect(screen.getByRole('heading', { level: 4, name: 'Commits per period' })).toBeDefined();
    expect(screen.getByText('Bars over time.')).toBeDefined();
    expect(screen.getByText('chart body')).toBeDefined();
  });

  it('renders controls when provided and the wide class when requested', () => {
    const { container } = render(
      <ChartBlock
        title="Title"
        description="Description"
        controls={<button type="button">Pick</button>}
        wide
      >
        <div>body</div>
      </ChartBlock>,
    );
    expect(screen.getByRole('button', { name: 'Pick' })).toBeDefined();
    expect(container.querySelector('.chart-block')?.className).toBe('chart-block chart-block-wide');
  });

  it('omits the controls slot and the wide class by default', () => {
    const { container } = render(
      <ChartBlock title="Title" description="Description">
        <div>body</div>
      </ChartBlock>,
    );
    expect(container.querySelector('.chart-block-controls')).toBeNull();
    expect(container.querySelector('.chart-block')?.className).toBe('chart-block');
  });
});

describe('ChartEmpty', () => {
  it('renders the placeholder message instead of a chart', () => {
    render(<ChartEmpty message="Nothing to show." />);
    expect(screen.getByText('Nothing to show.')).toBeDefined();
  });
});
