/**
 * Tests for the badge pill and the tone maps of every categorical
 * value kind.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Complexity, ContributionSize, ContributionType } from '../report/index.js';
import {
  Badge,
  toneForComplexity,
  toneForQualitySignal,
  toneForRiskFlag,
  toneForSize,
  toneForWorkType,
} from './index.js';

describe('Badge', () => {
  it('renders its content with the tone class and defaults to neutral', () => {
    render(<Badge tone="teal">tests</Badge>);
    expect(screen.getByText('tests').className).toBe('badge badge-teal');

    render(<Badge>plain</Badge>);
    expect(screen.getByText('plain').className).toBe('badge badge-neutral');
  });
});

describe('toneForWorkType', () => {
  const expected: Record<ContributionType, string> = {
    feature: 'blue',
    bugfix: 'red',
    refactor: 'violet',
    test: 'teal',
    docs: 'amber',
    tooling: 'sky',
    chore: 'gray',
    security: 'orange',
  };

  it('returns the documented tone for every work type', () => {
    for (const [type, tone] of Object.entries(expected)) {
      expect(toneForWorkType(type as ContributionType)).toBe(tone);
    }
  });
});

describe('toneForComplexity', () => {
  const expected: Record<Complexity, string> = { low: 'green', medium: 'amber', high: 'red' };

  it('returns green, amber and red for low, medium and high', () => {
    for (const [complexity, tone] of Object.entries(expected)) {
      expect(toneForComplexity(complexity as Complexity)).toBe(tone);
    }
  });
});

describe('toneForSize', () => {
  const expected: Record<ContributionSize, string> = {
    xs: 'sky',
    s: 'blue',
    m: 'violet',
    l: 'purple',
    xl: 'pink',
  };

  it('returns the cool-to-warm tone for every size', () => {
    for (const [size, tone] of Object.entries(expected)) {
      expect(toneForSize(size as ContributionSize)).toBe(tone);
    }
  });
});

describe('toneForQualitySignal and toneForRiskFlag', () => {
  it('are fixed to green and red', () => {
    expect(toneForQualitySignal()).toBe('green');
    expect(toneForRiskFlag()).toBe('red');
  });
});
