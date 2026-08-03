/**
 * Test fixture helper: builds temporary git repositories with known
 * files, authors, and commits (design §9) so metrics can be asserted
 * exactly. Shared by every later plan step; not a test file itself.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runGit } from '../../src/repo/git.js';

/** Author of a fixture commit. */
export interface FixtureAuthor {
  name: string;
  email: string;
}

/** One file written by a fixture commit. */
export interface FixtureFile {
  /** Path relative to the repo root; parent dirs are created. */
  path: string;
  /** File content. */
  content: string;
}

/** One commit of a fixture repo. */
export interface FixtureCommit {
  author: FixtureAuthor;
  /** Author date, ISO 8601 (e.g. `2026-01-15T10:30:00Z`). */
  date: string;
  message: string;
  files: FixtureFile[];
}

/** A built fixture repo. */
export interface FixtureRepo {
  /** Absolute path of the fixture repo working tree. */
  dir: string;
  /** `file://` URL form of `dir`, for cloning. */
  url: string;
}

/**
 * Builds a temporary git repo with the given commits applied in order
 * (newest last). Commits are created with `--author` and `--date` so
 * author names, emails, and dates are exact; the default branch is
 * `main`. The caller removes the repo with `removeFixtureRepo`.
 *
 * @param commits - Commits to create, oldest first.
 * @returns The fixture repo's working tree and `file://` URL.
 */
export async function buildFixtureRepo(commits: FixtureCommit[]): Promise<FixtureRepo> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-fixture-'));
  await runGit(dir, ['init', '-b', 'main']);
  await runGit(dir, ['config', 'user.name', 'Fixture Builder']);
  await runGit(dir, ['config', 'user.email', 'fixture@example.com']);
  await runGit(dir, ['config', 'commit.gpgsign', 'false']);

  for (const commit of commits) {
    for (const file of commit.files) {
      const filePath = path.join(dir, file.path);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, file.content, 'utf8');
    }
    await runGit(dir, ['add', '-A']);
    await runGit(dir, [
      'commit',
      '--author',
      `${commit.author.name} <${commit.author.email}>`,
      '--date',
      commit.date,
      '-m',
      commit.message,
    ]);
  }

  return { dir, url: pathToFileURL(dir).href };
}

/**
 * Removes a fixture repo created by `buildFixtureRepo`.
 *
 * @param repo - Fixture repo to remove.
 */
export async function removeFixtureRepo(repo: FixtureRepo): Promise<void> {
  await rm(repo.dir, { recursive: true, force: true });
}
