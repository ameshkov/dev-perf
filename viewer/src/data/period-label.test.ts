/**
 * Tests for the short period axis labels, one per unit plus the
 * single-period case.
 */
import { describe, expect, it } from 'vitest';
import { periodLabel } from './period-label.js';

describe('periodLabel', () => {
  it('formats day units as month and day', () => {
    expect(periodLabel('2026-01-05T00:00:00.000Z', 'day')).toBe('Jan 5');
  });

  it('formats week units as month and day', () => {
    expect(periodLabel('2026-01-05T00:00:00.000Z', 'week')).toBe('Jan 5');
  });

  it('formats month units as year and zero-padded month', () => {
    expect(periodLabel('2026-01-01T00:00:00.000Z', 'month')).toBe('2026-01');
    expect(periodLabel('2026-11-01T00:00:00.000Z', 'month')).toBe('2026-11');
  });

  it('formats quarter units as Qn and year', () => {
    expect(periodLabel('2026-01-01T00:00:00.000Z', 'quarter')).toBe('Q1 2026');
    expect(periodLabel('2026-04-01T00:00:00.000Z', 'quarter')).toBe('Q2 2026');
    expect(periodLabel('2026-12-01T00:00:00.000Z', 'quarter')).toBe('Q4 2026');
  });

  it('formats year units as the year', () => {
    expect(periodLabel('2026-06-15T00:00:00.000Z', 'year')).toBe('2026');
  });

  it('formats a single-period report (no unit) as month and day', () => {
    expect(periodLabel('2026-01-01T00:00:00.000Z', undefined)).toBe('Jan 1');
  });
});
