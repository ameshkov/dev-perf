/**
 * Tests for the hero block: headline, explainer, feature pills, and
 * the call-to-action hint that disappears once a report is loaded.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Hero } from './hero.js';

describe('Hero', () => {
  it('renders the overline, headline, explainer and feature pills', () => {
    render(<Hero loaded={false} />);
    expect(screen.getByText('dev-perf report viewer')).toBeDefined();
    expect(screen.getByRole('heading', { level: 1 })).toBeDefined();
    expect(screen.getByText(/really built/)).toBeDefined();
    expect(screen.getByText(/deterministic metrics straight from git history/)).toBeDefined();
    expect(screen.getByText('Team dynamics')).toBeDefined();
    expect(screen.getByText('LLM-assessed insights')).toBeDefined();
    expect(screen.getByText('Individual reports')).toBeDefined();
    expect(screen.getByText('Runs entirely in your browser')).toBeDefined();
  });

  it('shows the call-to-action hint only while idle', () => {
    const hint = 'Drop a report below, or try the sample report.';
    const { rerender } = render(<Hero loaded={false} />);
    expect(screen.getByText(hint)).toBeDefined();

    rerender(<Hero loaded />);
    expect(screen.queryByText(hint)).toBeNull();
  });
});
