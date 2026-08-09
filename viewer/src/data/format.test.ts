/**
 * Tests for the number and date formatters: grouping, compact
 * notation, decimal trimming, and the UTC date labels.
 */
import { describe, expect, it } from 'vitest';
import { formatCompact, formatDateTime, formatInt, formatNumber, formatRange } from './index.js';
import { formatDate } from './format.js';

describe('formatInt', () => {
  it('groups digits and keeps signs', () => {
    expect(formatInt(0)).toBe('0');
    expect(formatInt(1234567)).toBe('1,234,567');
    expect(formatInt(-1234)).toBe('-1,234');
  });
});

describe('formatNumber', () => {
  it('trims trailing zeros after at most two decimals', () => {
    expect(formatNumber(2)).toBe('2');
    expect(formatNumber(1.5)).toBe('1.5');
    expect(formatNumber(1.256)).toBe('1.26');
    expect(formatNumber(1000)).toBe('1,000');
  });
});

describe('formatCompact', () => {
  it('formats small values as plain numbers', () => {
    expect(formatCompact(0)).toBe('0');
    expect(formatCompact(999)).toBe('999');
    expect(formatCompact(-999)).toBe('-999');
  });

  it('formats large values in compact notation', () => {
    expect(formatCompact(1234)).toBe('1.2K');
    expect(formatCompact(1500000)).toBe('1.5M');
    expect(formatCompact(-1234)).toBe('-1.2K');
  });
});

describe('formatDate', () => {
  it('formats a UTC instant as a short date', () => {
    expect(formatDate('2026-01-05T00:00:00.000Z')).toBe('Jan 5, 2026');
  });
});

describe('formatDateTime', () => {
  it('formats a UTC instant with time and time zone', () => {
    expect(formatDateTime('2026-03-01T00:00:00.000Z')).toBe('Mar 1, 2026, 12:00 AM UTC');
  });
});

describe('formatRange', () => {
  it('joins both bounds with an arrow', () => {
    expect(formatRange('2026-01-01T00:00:00.000Z', '2026-06-30T23:59:59.999Z')).toBe(
      'Jan 1, 2026 → Jun 30, 2026',
    );
  });
});
