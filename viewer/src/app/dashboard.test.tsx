/**
 * Tests for the dashboard: the meta bar (per-spec repository chips,
 * collapsed behind a toggle when many), the KPI grid values, the two
 * sections, the navigation panel (hidden by default, closed on
 * Escape, backdrop click and section navigation), and the
 * repository/contributor scope filters (chips, reset).
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrendReport } from '../report/index.js';
import { buildDemoReport, buildTrendReport } from '../../test/report-builder.js';

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

import { echarts } from '../charts/index.js';
import { Dashboard } from './dashboard.js';

const report = buildDemoReport();

/** Renders the dashboard; the navigation panel is open by default. */
function renderDashboard(options: { report?: TrendReport; navOpen?: boolean } = {}) {
  const onNavClose = vi.fn();
  const view = render(
    <Dashboard
      report={options.report ?? report}
      fileName="report.json"
      navOpen={options.navOpen ?? true}
      onNavClose={onNavClose}
    />,
  );
  return { onNavClose, ...view };
}

/** Reads the KPI value rendered under a given label. */
function kpiValue(container: HTMLElement, label: string): string | null {
  const card = [...container.querySelectorAll('.kpi-card')].find((node) =>
    node.textContent?.startsWith(label),
  );
  return card?.querySelector('.kpi-value')?.textContent ?? null;
}

describe('Dashboard', () => {
  beforeEach(() => {
    vi.mocked(echarts.init).mockClear();
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  });

  it('renders the meta bar: file, repos, range, unit, LLM mode, generation time', () => {
    renderDashboard({ navOpen: false });
    expect(screen.getByText('report.json')).toBeDefined();
    // The labels appear in the meta bar, the scope chips and the user detail.
    expect(screen.getAllByText('github.com/acme/api').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('github.com/acme/web').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Jan 1, 2026 → Feb 28, 2026')).toBeDefined();
    expect(screen.getByText('2 months')).toBeDefined();
    expect(screen.getByText('LLM: test-model')).toBeDefined();
    expect(screen.getByText('generated Mar 1, 2026, 12:00 AM UTC')).toBeDefined();
  });

  it('renders one meta chip per repository spec, with the extras visible', () => {
    const multiSpec = buildTrendReport({
      repos: [
        { repo: 'https://github.com/acme/api.git', branch: 'master' },
        { repo: 'https://github.com/acme/api.git', branch: 'release/v2', base: 'master' },
        { repo: 'https://github.com/acme/web.git' },
      ],
    });
    const { container } = renderDashboard({ report: multiSpec, navOpen: false });
    const bar = container.querySelector('.meta-bar');
    expect(bar).not.toBeNull();
    const chips = [...(bar as HTMLElement).querySelectorAll('.meta-chip')];
    const api = chips.filter((chip) => chip.textContent?.startsWith('github.com/acme/api'));
    expect(api).toHaveLength(2);
    expect(api[0]?.textContent).toBe('github.com/acme/api · branch: master');
    expect(api[0]?.getAttribute('title')).toBe('https://github.com/acme/api.git (branch: master)');
    expect(api[1]?.textContent).toBe('github.com/acme/api · branch: release/v2, base: master');
    const web = chips.filter((chip) => chip.textContent === 'github.com/acme/web');
    expect(web).toHaveLength(1);
    expect(web[0]?.getAttribute('title')).toBe('https://github.com/acme/web.git');
  });

  it('collapses a long repository list behind a toggle in the meta bar', () => {
    const repos = Array.from({ length: 7 }, (_, index) => ({
      repo: `https://github.com/acme/repo-${index}.git`,
    }));
    const many = buildTrendReport({ repos });
    const { container } = renderDashboard({ report: many, navOpen: false });
    const bar = container.querySelector('.meta-bar') as HTMLElement;
    const repoChipCount = (): number =>
      [...bar.querySelectorAll('.meta-chip')].filter((chip) =>
        chip.textContent?.startsWith('github.com/acme/repo-'),
      ).length;
    expect(screen.getByRole('button', { name: '7 repositories' })).toBeDefined();
    expect(repoChipCount()).toBe(0);

    fireEvent.click(screen.getByRole('button', { name: '7 repositories' }));
    expect(repoChipCount()).toBe(7);
  });

  it('renders the KPI grid with the exact totals and the bus factor', () => {
    const { container } = renderDashboard({ navOpen: false });
    const labels = [...container.querySelectorAll('.kpi-label')].map((node) => node.textContent);
    expect(labels).toEqual([
      'Commits',
      'Lines added',
      'Lines removed',
      'Net lines',
      'Files touched',
      'Active users',
      'Contributions',
      'Weighted points',
      'Bus factor',
    ]);
    const values = [...container.querySelectorAll('.kpi-value')].map((node) => node.textContent);
    expect(values).toEqual(['23', '+325', '−112', '+213', '11', '2', '3', '22.5', '1']);
    expect(screen.getByText('2 contributors')).toBeDefined();
    expect(screen.getByText('assessed by the LLM')).toBeDefined();
    expect(screen.getByText('Alice Nguyen cover 52.17% of commits')).toBeDefined();
  });

  it('omits the LLM KPIs for a deterministic-only report', () => {
    const { container } = renderDashboard({
      report: buildDemoReport({ llmEnabled: false }),
      navOpen: false,
    });
    const labels = [...container.querySelectorAll('.kpi-label')].map((node) => node.textContent);
    expect(labels).toEqual([
      'Commits',
      'Lines added',
      'Lines removed',
      'Net lines',
      'Files touched',
      'Active users',
      'Bus factor',
    ]);
    expect(screen.getByText('no LLM analysis')).toBeDefined();
    expect(screen.queryByText('single range')).toBeNull();
  });

  it('renders both sections and, while open, the section navigation', () => {
    renderDashboard();
    expect(screen.getByText('How the team moved')).toBeDefined();
    expect(screen.getByText('One report per person')).toBeDefined();
    const nav = screen.getByRole('navigation', { name: 'Dashboard sections' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '#overview',
      '#team',
      '#individuals',
    ]);
    expect(screen.queryByRole('button', { name: 'Reset filters' })).toBeNull();
  });
});

describe('Dashboard navigation panel', () => {
  beforeEach(() => {
    vi.mocked(echarts.init).mockClear();
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  });

  it('keeps the navigation panel hidden until the top bar opens it', () => {
    const { container } = renderDashboard({ navOpen: false });
    expect(container.querySelector('.control-bar')).toBeNull();
    expect(container.querySelector('.nav-backdrop')).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Dashboard sections' })).toBeNull();
  });

  it('renders the panel and the backdrop while open', () => {
    const { container } = renderDashboard();
    expect(container.querySelector('.control-bar')).not.toBeNull();
    expect(container.querySelector('.nav-backdrop')).not.toBeNull();
  });

  it('asks to close on Escape', () => {
    const { onNavClose } = renderDashboard();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onNavClose).toHaveBeenCalledTimes(1);
  });

  it('asks to close on a backdrop click', () => {
    const { container, onNavClose } = renderDashboard();
    fireEvent.click(container.querySelector('.nav-backdrop') as Element);
    expect(onNavClose).toHaveBeenCalledTimes(1);
  });

  it('asks to close after a section link navigates', () => {
    const { onNavClose } = renderDashboard();
    fireEvent.click(screen.getByRole('link', { name: 'Team dynamics' }));
    expect(onNavClose).toHaveBeenCalledTimes(1);
  });
});

describe('Dashboard scope filters', () => {
  beforeEach(() => {
    vi.mocked(echarts.init).mockClear();
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  });

  it('renders the repository and contributor scope chips', () => {
    renderDashboard();
    // Role queries only: the user detail repeats the caption text.
    expect(screen.getByRole('group', { name: 'Repositories' })).toBeDefined();
    expect(screen.getByRole('group', { name: 'Contributors' })).toBeDefined();
  });

  it('recomputes the overview when a repository is toggled off', () => {
    const { container } = renderDashboard();
    const repoGroup = screen.getByRole('group', { name: 'Repositories' });
    // The nav panel labels repositories with their short name.
    fireEvent.click(within(repoGroup).getByRole('button', { name: /api/ }));

    expect(kpiValue(container, 'Commits')).toBe('6');
    expect(kpiValue(container, 'Lines added')).toBe('+65');
    expect(kpiValue(container, 'Contributions')).toBe('1');
    expect(screen.getByText('1 of 2')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Reset filters' })).toBeDefined();
  });

  it('recomputes the overview when a contributor is toggled off', () => {
    const { container } = renderDashboard();
    const userGroup = screen.getByRole('group', { name: 'Contributors' });
    fireEvent.click(within(userGroup).getByRole('button', { name: /Alice Nguyen/ }));

    expect(kpiValue(container, 'Commits')).toBe('11');
    expect(kpiValue(container, 'Lines added')).toBe('+145');
    expect(kpiValue(container, 'Active users')).toBe('1');
    expect(kpiValue(container, 'Contributions')).toBe('1');
    expect(kpiValue(container, 'Weighted points')).toBe('16');
    expect(screen.getByText('Bob Fisher cover 100% of commits')).toBeDefined();
  });

  it('narrows the contributors to the scoped repositories', () => {
    renderDashboard();
    const repoGroup = screen.getByRole('group', { name: 'Repositories' });
    fireEvent.click(within(repoGroup).getByRole('button', { name: /api/ }));

    // Web-only scope: Alice 4 commits, Bob 2.
    const userGroup = screen.getByRole('group', { name: 'Contributors' });
    expect(within(userGroup).getByText('4')).toBeDefined();
    expect(within(userGroup).getByText('2')).toBeDefined();
  });

  it('restores the full report on reset', () => {
    const { container } = renderDashboard();
    const userGroup = screen.getByRole('group', { name: 'Contributors' });
    fireEvent.click(within(userGroup).getByRole('button', { name: /Alice Nguyen/ }));
    expect(kpiValue(container, 'Commits')).toBe('11');

    fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
    expect(kpiValue(container, 'Commits')).toBe('23');
    expect(screen.queryByRole('button', { name: 'Reset filters' })).toBeNull();
  });

  it('labels the repository chips with the short repo name, not the full url', () => {
    renderDashboard();
    const repoGroup = screen.getByRole('group', { name: 'Repositories' });
    expect(within(repoGroup).getByRole('button', { name: /^api/ })).toBeDefined();
    expect(within(repoGroup).getByRole('button', { name: /^web/ })).toBeDefined();
    // The full url stays available as the chip title.
    const chip = within(repoGroup).getByRole('button', { name: /^api/ });
    expect(chip.getAttribute('title')).toBe('git@github.com:acme/api.git');
  });
});

describe('Dashboard contributor statistics and period navigation', () => {
  beforeEach(() => {
    vi.mocked(echarts.init).mockClear();
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
      callback(0);
      return 1;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the contributor statistics group with the contributor select and one period chip per period', () => {
    renderDashboard();
    const group = screen.getByRole('group', { name: 'Contributor statistics' });
    const options = within(group).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['Alice Nguyen', 'Bob Fisher']);
    const periods = within(group).getAllByRole('button');
    expect(periods.map((period) => period.textContent)).toEqual(['2026-01', '2026-02']);
    // The latest period is the currently viewed one by default.
    expect(periods[1]?.getAttribute('aria-pressed')).toBe('true');
  });

  it('omits the period chips for reports with a single period', () => {
    renderDashboard({ report: buildTrendReport() });
    const group = screen.getByRole('group', { name: 'Contributor statistics' });
    expect(within(group).getByRole('combobox')).toBeDefined();
    expect(within(group).queryByRole('button')).toBeNull();
  });

  it('omits the period chips for a deterministic-only report', () => {
    renderDashboard({ report: buildDemoReport({ llmEnabled: false }) });
    const group = screen.getByRole('group', { name: 'Contributor statistics' });
    expect(within(group).getByRole('combobox')).toBeDefined();
    expect(within(group).queryByRole('button')).toBeNull();
  });

  it('selects the period, closes the panel and scrolls to its contribution group', () => {
    const { onNavClose } = renderDashboard();
    // The default pick is Alice; selecting February keeps Alice (periods
    // no longer switch the contributor) and jumps to her February group.
    expect(screen.getByText('alice@example.com')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '2026-02' }));

    expect(screen.getByText('alice@example.com')).toBeDefined();
    expect(onNavClose).toHaveBeenCalledTimes(1);
    const group = document.getElementById('period-1');
    expect(group?.querySelector('.contribution-empty')).not.toBeNull();
    expect(window.scrollTo).toHaveBeenCalled();
  });

  it('selects an earlier period while keeping the same contributor', () => {
    renderDashboard();
    fireEvent.click(screen.getByRole('button', { name: '2026-01' }));
    expect(screen.getByText('alice@example.com')).toBeDefined();
    const group = document.getElementById('period-0');
    expect(group?.querySelector('.contribution-card')).not.toBeNull();
  });

  it('switches the contributor from the select and navigates to their detail', () => {
    const { container, onNavClose } = renderDashboard();
    const group = screen.getByRole('group', { name: 'Contributor statistics' });
    fireEvent.change(within(group).getByRole('combobox'), { target: { value: 'Bob Fisher' } });

    expect(screen.getByText('bob@example.com')).toBeDefined();
    expect(onNavClose).toHaveBeenCalledTimes(1);
    // The chosen contributor's detail is on screen.
    expect(container.querySelector('.user-detail')).not.toBeNull();
    expect(window.scrollTo).toHaveBeenCalled();
  });

  it('keeps the selected contributor after a manual pick following a period jump', () => {
    renderDashboard();
    fireEvent.click(screen.getByRole('button', { name: '2026-02' }));
    expect(window.scrollTo).toHaveBeenCalled();
    const scrollTo = vi.mocked(window.scrollTo);
    scrollTo.mockClear();

    fireEvent.click(screen.getAllByRole('tab')[1]);

    expect(screen.getByText('bob@example.com')).toBeDefined();
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
