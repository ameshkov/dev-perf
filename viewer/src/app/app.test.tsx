/**
 * Tests for the root app: the idle state with hero and upload panel,
 * the sample-report load flow into the dashboard, and the error box.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDemoReport } from '../../test/report-builder.js';

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

import { App } from './app.js';

const reportText = JSON.stringify(buildDemoReport());

describe('App', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the hero and the upload panel in the idle state', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1 })).toBeDefined();
    expect(screen.getByText(/really built/)).toBeDefined();
    expect(screen.getByText('Drop your report here')).toBeDefined();
    expect(screen.queryByText('How the team moved')).toBeNull();
  });

  it('loads the sample report and swaps to the dashboard, then back', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, text: async () => reportText }));
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Load sample report' }));
    await waitFor(() => {
      expect(screen.getByText('How the team moved')).toBeDefined();
    });
    expect(fetchMock).toHaveBeenCalledWith('samples/sample-report.json');
    expect(screen.getByText('One report per person')).toBeDefined();
    expect(screen.getByText('sample-report.json')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Load another report' }));
    expect(await screen.findByText('Drop your report here')).toBeDefined();
    expect(screen.queryByText('How the team moved')).toBeNull();
  });

  it('toggles the navigation panel from the top bar', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, text: async () => reportText }));
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    expect(screen.queryByRole('button', { name: 'Navigation' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Load sample report' }));
    await waitFor(() => {
      expect(screen.getByText('How the team moved')).toBeDefined();
    });

    // The panel is hidden by default; the top bar button opens it.
    expect(screen.queryByRole('navigation', { name: 'Dashboard sections' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Navigation' }));
    expect(screen.getByRole('navigation', { name: 'Dashboard sections' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Navigation' }).getAttribute('aria-expanded')).toBe(
      'true',
    );

    // Returning to the idle state drops the button and the panel.
    fireEvent.click(screen.getByRole('button', { name: 'Load another report' }));
    expect(await screen.findByText('Drop your report here')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Navigation' })).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Dashboard sections' })).toBeNull();
  });

  it('shows the error box when the sample fails to load', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 500, text: async () => '' }));
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Load sample report' }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
    });
    expect(screen.getByText(/HTTP 500/)).toBeDefined();
    expect(screen.getByText('Drop your report here')).toBeDefined();
  });
});
