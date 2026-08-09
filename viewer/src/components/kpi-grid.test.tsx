/**
 * Tests for the KPI grid: every card's label, value, hint and tone.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { KpiItem } from './index.js';
import { KpiGrid } from './index.js';

const items: KpiItem[] = [
  { label: 'Commits', value: '23', hint: '2 contributors' },
  { label: 'Lines added', value: '+325', tone: 'good' },
  { label: 'Bus factor', value: '1', hint: 'Alice Nguyen cover 52% of commits', tone: 'warn' },
];

describe('KpiGrid', () => {
  it('renders every item with its label and value', () => {
    render(<KpiGrid items={items} />);
    for (const item of items) {
      expect(screen.getByText(item.label)).toBeDefined();
      expect(screen.getByText(item.value)).toBeDefined();
    }
  });

  it('renders hints only when present and applies the tone classes', () => {
    const { container } = render(<KpiGrid items={items} />);
    expect(screen.getByText('2 contributors')).toBeDefined();
    const cards = container.querySelectorAll('.kpi-card');
    expect(cards).toHaveLength(3);
    expect(cards[0].className).toBe('kpi-card kpi-default');
    expect(cards[1].className).toBe('kpi-card kpi-good');
    expect(cards[2].className).toBe('kpi-card kpi-warn');
    expect(cards[1].querySelector('.kpi-hint')).toBeNull();
  });
});
