/**
 * Tests for the color system: non-empty palettes of CSS colors and
 * semantic tone maps covering every key of their category.
 */
import { describe, expect, it } from 'vitest';
import {
  ADDED_COLOR,
  CATEGORY_PALETTE,
  COMMITS_COLOR,
  COMPLEXITY_COLORS,
  CUMULATIVE_COLOR,
  POINTS_GRADIENT,
  QUALITY_PALETTE,
  REMOVED_COLOR,
  RISK_PALETTE,
  SIZE_COLORS,
  WORK_TYPE_COLORS,
} from './index.js';
import { devperfTheme } from './theme.js';

/** A CSS hex color as used by the palettes. */
const HEX_COLOR = /^#[0-9a-f]{6}$/;

/**
 * Asserts that a value is a non-empty array of hex color strings.
 *
 * @param palette - The palette to check.
 */
function expectPalette(palette: string[]): void {
  expect(palette.length).toBeGreaterThan(0);
  for (const color of palette) {
    expect(color).toMatch(HEX_COLOR);
  }
}

describe('palettes', () => {
  it('are non-empty arrays of color strings', () => {
    expectPalette(CATEGORY_PALETTE);
    expectPalette(QUALITY_PALETTE);
    expectPalette(RISK_PALETTE);
    expect(POINTS_GRADIENT).toHaveLength(2);
    expectPalette([...POINTS_GRADIENT]);
  });

  it('expose single colors for the line charts', () => {
    for (const color of [ADDED_COLOR, REMOVED_COLOR, COMMITS_COLOR, CUMULATIVE_COLOR]) {
      expect(color).toMatch(HEX_COLOR);
    }
  });
});

describe('tone maps', () => {
  it('cover every contribution size', () => {
    expect(Object.keys(SIZE_COLORS).sort()).toEqual(['l', 'm', 's', 'xl', 'xs']);
  });

  it('cover every complexity level', () => {
    expect(Object.keys(COMPLEXITY_COLORS).sort()).toEqual(['high', 'low', 'medium']);
  });

  it('cover every work type', () => {
    expect(Object.keys(WORK_TYPE_COLORS).sort()).toEqual([
      'bugfix',
      'chore',
      'docs',
      'feature',
      'refactor',
      'security',
      'test',
      'tooling',
    ]);
  });
});

describe('devperfTheme', () => {
  it('uses the category palette on a transparent background', () => {
    expect(devperfTheme.color).toBe(CATEGORY_PALETTE);
    expect(devperfTheme.backgroundColor).toBe('transparent');
  });
});
