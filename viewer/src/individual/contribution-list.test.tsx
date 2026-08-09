/**
 * Tests for the contribution cards: titles, summaries, badges of every
 * kind, commit shas, and the per-period grouping.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  buildContribution,
  buildDemoReport,
  buildRepository,
  buildTrendReport,
  buildUser,
} from '../../test/report-builder.js';
import { buildChartData } from '../data/index.js';
import { ContributionList } from './contribution-list.js';

const data = buildChartData(buildDemoReport());

describe('ContributionList', () => {
  it('renders nothing for a user without contributions', () => {
    const single = buildChartData(
      buildTrendReport({
        periods: [
          {
            since: '2026-01-01T00:00:00.000Z',
            until: '2026-01-31T23:59:59.999Z',
            repositories: [buildRepository({ users: [buildUser({ name: 'Casey' })] })],
          },
        ],
      }),
    );
    const { container } = render(
      <ContributionList series={single.users[0]} periods={single.periods} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders ungrouped cards for a single-period report', () => {
    const single = buildChartData(
      buildTrendReport({
        periods: [
          {
            since: '2026-01-01T00:00:00.000Z',
            until: '2026-01-31T23:59:59.999Z',
            repositories: [
              buildRepository({
                users: [
                  buildUser({
                    name: 'Casey',
                    llm: {
                      status: 'completed',
                      contributions: [buildContribution({ title: 'Solo contribution' })],
                    },
                  }),
                ],
              }),
            ],
          },
        ],
      }),
    );
    const { container } = render(
      <ContributionList series={single.users[0]} periods={single.periods} />,
    );
    expect(screen.getByText('Solo contribution')).toBeDefined();
    expect(container.querySelector('.contribution-group')).toBeNull();
  });

  it('groups the cards per period and renders every field of a card', () => {
    const alice = data.users[0];
    const { container } = render(<ContributionList series={alice} periods={data.periods} />);

    // Only January carries contributions; the empty February group is dropped.
    const groups = container.querySelectorAll('.contribution-group');
    expect(groups).toHaveLength(1);
    expect(screen.getByText('2026-01')).toBeDefined();
    expect(screen.getByText('2 contributions')).toBeDefined();

    expect(screen.getByText('Ship the payments API')).toBeDefined();
    expect(screen.getByText('Built the payments endpoint.')).toBeDefined();
    expect(screen.getByText('Fix the checkout flow')).toBeDefined();

    // Size and complexity badges of the two cards.
    expect(screen.getByText('m').className).toBe('badge badge-violet');
    expect(screen.getByText('s').className).toBe('badge badge-blue');
    expect(screen.getByText('medium').className).toBe('badge badge-amber');
    expect(screen.getByText('low').className).toBe('badge badge-green');

    // Work-type badges.
    expect(screen.getByText('feature')).toBeDefined();
    expect(screen.getByText('bugfix').className).toBe('badge badge-red');
    expect(screen.getByText('test').className).toBe('badge badge-teal');

    // Quality signals and risk flags.
    expect(screen.getAllByText('tests-added')).toHaveLength(2);
    expect(screen.getAllByText('tests-added')[0].className).toBe('badge badge-green');
    expect(screen.getByText('docs-added')).toBeDefined();
    expect(screen.getByText('no-tests').className).toBe('badge badge-red');

    // Commit shas are shortened to seven characters.
    expect(screen.getByText('a1b2c3d')).toBeDefined();
    expect(screen.getByText('b2c3d4e')).toBeDefined();
  });

  it('shows the size and complexity reasoning in a collapsible detail', () => {
    const alice = data.users[0];
    render(<ContributionList series={alice} periods={data.periods} />);
    expect(screen.getAllByText('Why this size and complexity')).toHaveLength(2);
    expect(screen.getAllByText('Touches several modules.')).toHaveLength(2);
    expect(screen.getAllByText('A few hundred lines.')).toHaveLength(2);
  });
});
