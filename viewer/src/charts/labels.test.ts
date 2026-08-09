/**
 * Tests for the chart label helpers: palette cycling and the percent
 * formatter.
 */
import { describe, expect, it } from 'vitest';
import { cycleColor, percentFormat } from './index.js';

describe('cycleColor', () => {
  const palette = ['#a', '#b', '#c'];

  it('returns the palette color at the tag index', () => {
    expect(cycleColor(palette, 0)).toBe('#a');
    expect(cycleColor(palette, 1)).toBe('#b');
    expect(cycleColor(palette, 2)).toBe('#c');
  });

  it('wraps around when there are more tags than colors', () => {
    expect(cycleColor(palette, 3)).toBe('#a');
    expect(cycleColor(palette, 5)).toBe('#c');
    expect(cycleColor(palette, 7)).toBe('#b');
  });
});

describe('percentFormat', () => {
  it('appends a percent sign to the trimmed number', () => {
    expect(percentFormat(12.5)).toBe('12.5%');
    expect(percentFormat(0)).toBe('0%');
    expect(percentFormat(100)).toBe('100%');
    expect(percentFormat(8.333)).toBe('8.33%');
  });
});
