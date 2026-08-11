/**
 * Tests for identity merging: deterministic sums, email unions, LLM
 * status precedence, master-user building across repositories, and
 * per-period alignment.
 */
import { describe, expect, it } from 'vitest';
import {
  buildContribution,
  buildDeterministic,
  buildLlm,
  buildRepository,
  buildTokenUsage,
  buildUser,
} from '../../test/report-builder.js';
import { buildMasterUsers, combinePeriodUsers, mergeUsers } from './merge.js';

describe('mergeUsers', () => {
  it('sums deterministic metrics, unions and sorts activeDays, and recomputes the averages', () => {
    const merged = mergeUsers(
      [
        buildUser({
          deterministic: buildDeterministic({
            commits: 3,
            nonMergeCommits: 3,
            mergeCommits: 0,
            linesAdded: 100,
            linesRemoved: 20,
            netLines: 80,
            filesTouched: 3,
            uniqueFilesTouched: 2,
            activeDays: ['2026-01-06'],
            firstCommitAt: '2026-01-06T09:00:00.000Z',
            lastCommitAt: '2026-01-08T09:00:00.000Z',
            languages: { TypeScript: { linesAdded: 100, linesRemoved: 20, filesTouched: 3 } },
            generated: { linesAdded: 30, linesRemoved: 2, filesTouched: 1 },
          }),
        }),
        buildUser({
          deterministic: buildDeterministic({
            commits: 4,
            nonMergeCommits: 2,
            mergeCommits: 2,
            linesAdded: 50,
            linesRemoved: 10,
            netLines: 40,
            filesTouched: 2,
            uniqueFilesTouched: 1,
            activeDays: ['2026-01-05', '2026-01-06'],
            firstCommitAt: '2026-01-05T08:00:00.000Z',
            lastCommitAt: '2026-01-07T18:00:00.000Z',
            languages: {
              TypeScript: { linesAdded: 50, linesRemoved: 10, filesTouched: 2 },
              Go: { linesAdded: 12, linesRemoved: 4, filesTouched: 1 },
            },
            generated: { linesAdded: 6, linesRemoved: 1, filesTouched: 2 },
          }),
        }),
      ],
      'Alice Nguyen',
    );

    expect(merged.deterministic.commits).toBe(7);
    expect(merged.deterministic.nonMergeCommits).toBe(5);
    expect(merged.deterministic.mergeCommits).toBe(2);
    expect(merged.deterministic.linesAdded).toBe(150);
    expect(merged.deterministic.linesRemoved).toBe(30);
    expect(merged.deterministic.netLines).toBe(120);
    expect(merged.deterministic.filesTouched).toBe(5);
    expect(merged.deterministic.uniqueFilesTouched).toBe(3);
    expect(merged.deterministic.activeDays).toEqual(['2026-01-05', '2026-01-06']);
    expect(merged.deterministic.firstCommitAt).toBe('2026-01-05T08:00:00.000Z');
    expect(merged.deterministic.lastCommitAt).toBe('2026-01-08T09:00:00.000Z');
    expect(merged.deterministic.avgCommitSize).toBe(36);
    expect(merged.deterministic.languages).toEqual({
      TypeScript: { linesAdded: 150, linesRemoved: 30, filesTouched: 5 },
      Go: { linesAdded: 12, linesRemoved: 4, filesTouched: 1 },
    });
    // The generated stats are summed independently of the languages.
    expect(merged.deterministic.generated).toStrictEqual({
      linesAdded: 36,
      linesRemoved: 3,
      filesTouched: 3,
    });
  });

  it('unions, lowercases and sorts emails, and ORs the bot flag', () => {
    const merged = mergeUsers(
      [
        buildUser({ emails: ['Bob@Example.com'] }),
        buildUser({ emails: ['alice@example.com', 'bob@example.com'], isBot: true }),
      ],
      'Merged',
    );
    expect(merged.emails).toEqual(['alice@example.com', 'bob@example.com']);
    expect(merged.isBot).toBe(true);
    expect(merged.name).toBe('Merged');
  });

  it('concatenates contributions and sums token usage', () => {
    const first = buildContribution({ title: 'First' });
    const second = buildContribution({ title: 'Second' });
    const merged = mergeUsers(
      [
        buildUser({
          llm: buildLlm({
            status: 'completed',
            contributions: [first],
            tokenUsage: buildTokenUsage({ input: 10, cacheRead: 5, output: 2 }),
          }),
        }),
        buildUser({
          llm: buildLlm({
            status: 'skipped',
            contributions: [second],
            tokenUsage: buildTokenUsage({ input: 1, cacheRead: 0, output: 3 }),
          }),
        }),
      ],
      'Alice Nguyen',
    );
    expect(merged.llm.contributions).toEqual([first, second]);
    expect(merged.llm.tokenUsage).toEqual({ input: 11, cacheRead: 5, output: 5 });
  });

  it('keeps completed over failed over skipped and joins distinct overviews', () => {
    const merged = mergeUsers(
      [
        buildUser({ llm: buildLlm({ status: 'failed', overview: 'Failed part.' }) }),
        buildUser({ llm: buildLlm({ status: 'completed', overview: 'Done part.' }) }),
      ],
      'Alice Nguyen',
    );
    expect(merged.llm.status).toBe('completed');
    expect(merged.llm.overview).toBe('Failed part.\n\nDone part.');

    const failed = mergeUsers(
      [buildUser({ llm: buildLlm({ status: 'failed' }) }), buildUser()],
      'Bob',
    );
    expect(failed.llm.status).toBe('failed');

    const skipped = mergeUsers([buildUser(), buildUser()], 'Carol');
    expect(skipped.llm.status).toBe('skipped');
    expect(skipped.llm.overview).toBeUndefined();
    expect(skipped.llm.tokenUsage).toBeUndefined();
  });

  it('yields a zeroed entry for an empty input list', () => {
    const merged = mergeUsers([], 'Nobody');
    expect(merged.name).toBe('Nobody');
    expect(merged.emails).toEqual([]);
    expect(merged.isBot).toBe(false);
    expect(merged.deterministic.commits).toBe(0);
    expect(merged.deterministic.activeDays).toEqual([]);
    expect(merged.deterministic.firstCommitAt).toBe('');
    expect(merged.deterministic.lastCommitAt).toBe('');
    expect(merged.deterministic.avgCommitSize).toBe(0);
    expect(merged.deterministic.languages).toEqual({});
    expect(merged.llm).toEqual({ status: 'skipped', contributions: [] });
  });
});

describe('buildMasterUsers', () => {
  it('merges identities across repositories and sorts by contributions, commits, name', () => {
    const entries = [
      buildRepository({
        users: [
          buildUser({
            name: 'Alice Nguyen',
            deterministic: buildDeterministic({ commits: 5 }),
            llm: buildLlm({ contributions: [buildContribution(), buildContribution()] }),
          }),
          buildUser({
            name: 'Carol Diaz',
            emails: ['carol@example.com'],
            deterministic: buildDeterministic({ commits: 7 }),
          }),
        ],
      }),
      buildRepository({
        repo: 'https://github.com/acme/other.git',
        users: [
          buildUser({
            name: 'Alice Nguyen',
            deterministic: buildDeterministic({ commits: 1 }),
            llm: buildLlm({ contributions: [buildContribution()] }),
          }),
          buildUser({
            name: 'Bob Fisher',
            emails: ['bob@example.com'],
            deterministic: buildDeterministic({ commits: 9 }),
          }),
          buildUser({
            name: 'Dan Malik',
            emails: ['dan@example.com'],
            deterministic: buildDeterministic({ commits: 9 }),
          }),
        ],
      }),
    ];

    const master = buildMasterUsers(entries);
    expect(master.map((user) => user.name)).toEqual([
      'Alice Nguyen',
      'Bob Fisher',
      'Dan Malik',
      'Carol Diaz',
    ]);
    const alice = master[0];
    expect(alice.deterministic.commits).toBe(6);
    expect(alice.llm.contributions).toHaveLength(3);
  });
});

describe('combinePeriodUsers', () => {
  it('merges each master user over the period and zeroes the missing ones, in master order', () => {
    const masterAlice = buildUser({
      name: 'Alice Nguyen',
      deterministic: buildDeterministic({ commits: 6 }),
    });
    const masterBob = buildUser({
      name: 'Bob Fisher',
      emails: ['bob@example.com'],
      deterministic: buildDeterministic({ commits: 9 }),
    });
    const period = {
      repositories: [
        buildRepository({
          users: [
            buildUser({ name: 'Alice Nguyen', deterministic: buildDeterministic({ commits: 2 }) }),
          ],
        }),
        buildRepository({
          repo: 'https://github.com/acme/other.git',
          users: [
            buildUser({ name: 'Alice Nguyen', deterministic: buildDeterministic({ commits: 3 }) }),
            buildUser({
              name: 'Eve Extra',
              emails: ['eve@example.com'],
              deterministic: buildDeterministic({ commits: 1 }),
            }),
          ],
        }),
      ],
    };

    const combined = combinePeriodUsers(period, [masterAlice, masterBob]);
    expect(combined.map((user) => user.name)).toEqual(['Alice Nguyen', 'Bob Fisher']);
    expect(combined[0].deterministic.commits).toBe(5);
    expect(combined[1]).toEqual({
      name: 'Bob Fisher',
      emails: ['bob@example.com'],
      isBot: false,
      deterministic: expect.objectContaining({ commits: 0, languages: {}, activeDays: [] }),
      llm: { status: 'skipped', contributions: [] },
    });
  });
});
