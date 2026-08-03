import { describe, expect, it } from 'vitest';
import { buildOrientationPrompt, buildToolCallReminder, buildUserPrompt } from './prompts.js';
import type { UserPromptInput } from './prompts.js';

/** The tool-call instruction every analysis prompt must carry. */
const TOOL_CALL_FRAGMENT = 'call the devperf_report tool with the final analysis';

const RANGE = { since: '2026-01-01T00:00:00.000Z', until: '2026-01-31T00:00:00.000Z' };

describe('buildOrientationPrompt', () => {
  it('asks for tech stack, main modules, and conventions', () => {
    const prompt = buildOrientationPrompt('https://example.com/repo.git');
    expect(prompt).toContain('https://example.com/repo.git');
    expect(prompt).toContain('Tech stack: languages, frameworks, and key dependencies');
    expect(prompt).toContain('Main modules or directories and what each does');
    expect(prompt).toContain('Conventions: code style, testing, commit message style');
    expect(prompt).toContain('under 150 words');
    expect(prompt).toContain('read-only git commands');
  });

  it('ends with the required tool-call instruction', () => {
    expect(buildOrientationPrompt('repo')).toContain(TOOL_CALL_FRAGMENT);
  });
});

describe('buildUserPrompt', () => {
  function userInput(overrides: Partial<UserPromptInput> = {}): UserPromptInput {
    return {
      repo: 'https://example.com/repo.git',
      name: 'Alice',
      email: 'alice@example.com',
      range: RANGE,
      repoContext: 'TypeScript CLI; modules: src/, docs/; tests with Vitest.',
      commits: [
        {
          sha: 'abc1234def5678',
          parents: [],
          authorName: 'Alice',
          authorEmail: 'alice@example.com',
          authorDate: '2026-01-15T10:00:00+00:00',
          subject: 'Add the pipeline',
          files: [
            { path: 'src/pipeline.ts', added: 120, deleted: 30 },
            { path: 'src/cli.ts', added: 10, deleted: 0 },
          ],
          isMerge: false,
        },
      ],
      ...overrides,
    };
  }

  it('includes identity, date range, repo context, and the commit list', () => {
    const prompt = buildUserPrompt(userInput());
    expect(prompt).toContain('Alice (alice@example.com)');
    expect(prompt).toContain('https://example.com/repo.git');
    expect(prompt).toContain('2026-01-01T00:00:00.000Z to 2026-01-31T00:00:00.000Z');
    expect(prompt).toContain('TypeScript CLI; modules: src/, docs/; tests with Vitest.');
    expect(prompt).toContain('## Commits by Alice in the analyzed range (1)');
  });

  it('renders each commit with sha, date, subject, numstat totals, and files', () => {
    const prompt = buildUserPrompt(userInput());
    expect(prompt).toContain(
      '- abc1234d 2026-01-15 Add the pipeline (+130 -30) src/pipeline.ts, src/cli.ts',
    );
  });

  it('renders merge commits without a file list', () => {
    const input = userInput({
      commits: [
        {
          sha: 'feedbeefcafe',
          parents: ['aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb'],
          authorName: 'Alice',
          authorEmail: 'alice@example.com',
          authorDate: '2026-01-16T09:00:00+00:00',
          subject: 'Merge branch main',
          files: [],
          isMerge: true,
        },
      ],
    });
    const prompt = buildUserPrompt(input);
    expect(prompt).toContain('- feedbeef 2026-01-16 Merge branch main (merge commit)');
  });

  it('renders binary files with zero line counts', () => {
    const input = userInput({
      commits: [
        {
          sha: 'b1n4rycafe',
          parents: [],
          authorName: 'Alice',
          authorEmail: 'alice@example.com',
          authorDate: '2026-01-17T10:00:00+00:00',
          subject: 'Add a binary asset',
          files: [{ path: 'assets/logo.png', added: undefined, deleted: undefined }],
          isMerge: false,
        },
      ],
    });
    const prompt = buildUserPrompt(input);
    expect(prompt).toContain('- b1n4ryca 2026-01-17 Add a binary asset (+0 -0) assets/logo.png');
  });

  it('truncates very long file lists with a count of the omitted files', () => {
    const files = Array.from({ length: 25 }, (_, index) => ({
      path: `src/mod${index}.ts`,
      added: 1,
      deleted: 0,
    }));
    const prompt = buildUserPrompt(userInput({ commits: [{ ...userInput().commits[0], files }] }));
    expect(prompt).toContain('src/mod0.ts, src/mod1.ts, src/mod2.ts, src/mod3.ts, src/mod4.ts');
    expect(prompt).toContain(', and 5 more');
    expect(prompt).not.toContain('src/mod24.ts');
  });

  it('renders an unbounded range side as plain language', () => {
    const prompt = buildUserPrompt(userInput({ range: { since: '', until: '' } }));
    expect(prompt).toContain('the beginning to now');
  });

  it('ends with the required tool-call instruction', () => {
    expect(buildUserPrompt(userInput())).toContain(TOOL_CALL_FRAGMENT);
  });
});

describe('buildToolCallReminder', () => {
  it('reminds the agent to call devperf_report', () => {
    const reminder = buildToolCallReminder();
    expect(reminder).toContain('devperf_report');
    expect(reminder).toContain('no other output format is accepted');
  });
});
