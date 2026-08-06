import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  buildOrientationPrompt,
  buildOrientationSystemPrompt,
  buildToolCallReminder,
  buildUserPrompt,
  buildUserSystemPrompt,
} from './prompts.js';
import type { UserPromptInput } from './prompts.js';

/** The tool-call instruction every analysis prompt must carry. */
const TOOL_CALL_FRAGMENT = 'call the devperf_report tool';

const RANGE = { since: '2026-01-01T00:00:00.000Z', until: '2026-01-31T00:00:00.000Z' };

describe('buildOrientationSystemPrompt', () => {
  it('defines the read-only analyst agent and its tool surface', async () => {
    const prompt = await buildOrientationSystemPrompt();
    expect(prompt).toContain('repository analyst');
    expect(prompt).toContain('read-only');
    expect(prompt).toContain('delete files');
    for (const tool of ['read', 'grep', 'find', 'ls', 'bash', 'devperf_report']) {
      expect(prompt).toContain(tool);
    }
    expect(prompt).toContain('Work only from what you can observe');
  });

  it('is static: who the agent is, not the per-run task details', async () => {
    const prompt = await buildOrientationSystemPrompt();
    expect(prompt).not.toContain('{{');
    expect(prompt).not.toContain('Tech stack');
    expect(prompt).not.toContain('repository context covering');
  });
});

describe('buildUserSystemPrompt', () => {
  it('defines the read-only contributor analyst agent and its tool surface', async () => {
    const prompt = await buildUserSystemPrompt();
    expect(prompt).toContain('contributor analyst');
    expect(prompt).toContain('read-only');
    expect(prompt).toContain('delete files');
    expect(prompt).toContain('never inferred');
    for (const tool of ['read', 'grep', 'find', 'ls', 'bash', 'devperf_report']) {
      expect(prompt).toContain(tool);
    }
  });

  it('is static: identity, repository, and range live in the user prompt', async () => {
    const prompt = await buildUserSystemPrompt();
    expect(prompt).not.toContain('{{');
    expect(prompt).not.toContain('Alice');
    expect(prompt).not.toContain('alice@example.com');
    expect(prompt).not.toContain('2026-');
  });
});

describe('buildOrientationPrompt', () => {
  it('asks for tech stack, main modules, and conventions', async () => {
    const prompt = await buildOrientationPrompt('https://example.com/repo.git');
    expect(prompt).toContain('https://example.com/repo.git');
    expect(prompt).toContain('Tech stack: languages, frameworks, and key');
    expect(prompt).toContain('Main modules or directories and what each does');
    expect(prompt).toContain('Conventions: code style, testing, commit message style');
    expect(prompt).toContain('under 500 words');
    expect(prompt).toContain('read-only git commands');
  });

  it('ends with the required tool-call instruction', async () => {
    expect(await buildOrientationPrompt('repo')).toContain(TOOL_CALL_FRAGMENT);
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

  it('carries the task details: identity, repository, range, context, and commits', async () => {
    const prompt = await buildUserPrompt(userInput());
    expect(prompt).toContain('Alice (alice@example.com)');
    expect(prompt).toContain('https://example.com/repo.git');
    expect(prompt).toContain('2026-01-01T00:00:00.000Z to 2026-01-31T00:00:00.000Z (UTC)');
    expect(prompt).toContain('TypeScript CLI; modules: src/, docs/; tests with Vitest.');
    expect(prompt).toContain('## Commits by Alice in the analyzed range (1)');
  });

  it('renders an unbounded range side as plain language', async () => {
    const prompt = await buildUserPrompt(userInput({ range: { since: '', until: '' } }));
    expect(prompt).toContain('the beginning to now (UTC)');
  });

  it('leaves no placeholder unrendered', async () => {
    expect(await buildUserPrompt(userInput())).not.toMatch(/\{\{/u);
  });

  it('renders each commit with sha, date, subject, numstat totals, and files', async () => {
    const prompt = await buildUserPrompt(userInput());
    expect(prompt).toContain(
      '- abc1234d 2026-01-15 Add the pipeline (+130 -30) src/pipeline.ts, src/cli.ts',
    );
  });

  it('renders merge commits without a file list', async () => {
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
    const prompt = await buildUserPrompt(input);
    expect(prompt).toContain('- feedbeef 2026-01-16 Merge branch main (merge commit)');
  });

  it('renders binary files with zero line counts', async () => {
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
    const prompt = await buildUserPrompt(input);
    expect(prompt).toContain('- b1n4ryca 2026-01-17 Add a binary asset (+0 -0) assets/logo.png');
  });

  it('truncates very long file lists with a count of the omitted files', async () => {
    const files = Array.from({ length: 25 }, (_, index) => ({
      path: `src/mod${index}.ts`,
      added: 1,
      deleted: 0,
    }));
    const prompt = await buildUserPrompt(
      userInput({ commits: [{ ...userInput().commits[0], files }] }),
    );
    expect(prompt).toContain('src/mod0.ts, src/mod1.ts, src/mod2.ts, src/mod3.ts, src/mod4.ts');
    expect(prompt).toContain(', and 5 more');
    expect(prompt).not.toContain('src/mod24.ts');
  });

  it('ends with the required tool-call instruction', async () => {
    expect(await buildUserPrompt(userInput())).toContain(TOOL_CALL_FRAGMENT);
  });
});

describe('buildToolCallReminder', () => {
  it('renders the reminder template file verbatim', async () => {
    const template = await readFile(new URL('./prompts/reminder.md', import.meta.url), 'utf8');
    await expect(buildToolCallReminder()).resolves.toBe(template);
  });

  it('reminds the agent to call devperf_report', async () => {
    const reminder = await buildToolCallReminder();
    expect(reminder).toContain('devperf_report');
    expect(reminder).toContain('no other output format is accepted');
  });
});
