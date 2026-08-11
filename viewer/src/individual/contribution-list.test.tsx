/**
 * Tests for the contribution cards: titles, summaries, badges of every
 * kind, commit shas, the per-unit grouping, and the overview opening
 * each unit.
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

  it('opens the single unit with the overview, without a group label', () => {
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
                      overview: 'A single unit of work.',
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
    const list = container.querySelector('.contribution-list');
    const overview = list?.querySelector('.contribution-overview');
    expect(overview?.textContent).toBe('A single unit of work.');
    // The overview opens the unit, before the first card.
    expect([...(list?.children ?? [])].indexOf(overview as Element)).toBe(0);
  });

  it('groups the cards per period, newest first, and renders every field of a card', () => {
    const alice = data.users[0];
    const { container } = render(<ContributionList series={alice} periods={data.periods} />);

    // Periods are listed newest first; the empty February group stays
    // listed with a placeholder instead of being dropped.
    const groups = container.querySelectorAll('.contribution-group');
    expect(groups).toHaveLength(2);
    expect(groups[0].id).toBe('period-1');
    expect(groups[1].id).toBe('period-0');
    expect(screen.getByText('2026-02')).toBeDefined();
    expect(screen.getByText('2026-01')).toBeDefined();
    expect(screen.getByText('2 contributions · 6.5 points')).toBeDefined();
    expect(screen.getByText('0 contributions · 0 points')).toBeDefined();
    expect(screen.getByText('No contributions in this period.')).toBeDefined();

    // The unit's LLM overview opens the January group.
    const overview = groups[1].querySelector('.contribution-overview');
    expect(overview?.textContent).toBe('Shipped the payments API.');

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

  it('lists the contribution groups newest to oldest', () => {
    const twoUnits = buildChartData(
      buildTrendReport({
        unit: 'month',
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
                      contributions: [buildContribution({ title: 'January work' })],
                    },
                  }),
                ],
              }),
            ],
          },
          {
            since: '2026-02-01T00:00:00.000Z',
            until: '2026-02-28T23:59:59.999Z',
            repositories: [
              buildRepository({
                users: [
                  buildUser({
                    name: 'Casey',
                    llm: {
                      status: 'completed',
                      contributions: [buildContribution({ title: 'February work' })],
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
      <ContributionList series={twoUnits.users[0]} periods={twoUnits.periods} />,
    );
    const groups = container.querySelectorAll('.contribution-group');
    expect(groups[0].id).toBe('period-1');
    expect(groups[1].id).toBe('period-0');
    // The newest period's card opens the list.
    const titles = container.querySelectorAll('.contribution-title');
    expect(titles[0].textContent).toBe('February work');
    expect(titles[1].textContent).toBe('January work');
  });

  it('shows the size and complexity reasoning in a collapsible detail', () => {
    const alice = data.users[0];
    render(<ContributionList series={alice} periods={data.periods} />);
    expect(screen.getAllByText('Why this size and complexity')).toHaveLength(2);
    expect(screen.getAllByText('Touches several modules.')).toHaveLength(2);
    expect(screen.getAllByText('A few hundred lines.')).toHaveLength(2);
  });

  it('places the overview between the unit label and the contribution cards', () => {
    const bob = data.users[1];
    const { container } = render(<ContributionList series={bob} periods={data.periods} />);
    const group = container.querySelector('.contribution-group');
    const overview = group?.querySelector('.contribution-overview');
    expect(overview?.textContent).toBe('Hardened the auth layer.');
    const children = [...(group?.children ?? [])];
    expect(children.indexOf(overview as Element)).toBe(1);
    expect(children[0].className).toBe('contribution-group-label');
    expect(children[2].className).toBe('contribution-card');
  });

  it('renders one overview per unit instead of one joined overview', () => {
    const twoUnits = buildChartData(
      buildTrendReport({
        unit: 'month',
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
                      overview: 'January unit overview.',
                      contributions: [buildContribution({ title: 'January work' })],
                    },
                  }),
                ],
              }),
            ],
          },
          {
            since: '2026-02-01T00:00:00.000Z',
            until: '2026-02-28T23:59:59.999Z',
            repositories: [
              buildRepository({
                users: [
                  buildUser({
                    name: 'Casey',
                    llm: {
                      status: 'completed',
                      overview: 'February unit overview.',
                      contributions: [buildContribution({ title: 'February work' })],
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
      <ContributionList series={twoUnits.users[0]} periods={twoUnits.periods} />,
    );
    expect(container.querySelectorAll('.contribution-group')).toHaveLength(2);
    const overviews = container.querySelectorAll('.contribution-overview');
    expect(overviews).toHaveLength(2);
    // Newest first: the February unit opens the list.
    expect(overviews[0].textContent).toBe('February unit overview.');
    expect(overviews[1].textContent).toBe('January unit overview.');
  });

  it('places the period placeholder for a period without contributions', () => {
    const alice = data.users[0];
    const { container } = render(<ContributionList series={alice} periods={data.periods} />);
    const empty = container.querySelector('#period-1 .contribution-empty');
    expect(empty?.textContent).toBe('No contributions in this period.');
    // The empties carry no contribution cards.
    const february = container.querySelector('#period-1');
    expect(february?.querySelector('.contribution-card')).toBeNull();
  });
});
