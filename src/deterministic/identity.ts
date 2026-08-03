/**
 * Author identity resolution (docs/design.md §5.3): commits are
 * grouped by lowercased author email; the display name is the most
 * frequent author name for that email. v1 does no email merging —
 * every distinct email is its own identity. Bots are flagged by a
 * heuristic but never filtered (§5.4): they are counted like everyone
 * else.
 */
import type { Commit } from './commits.js';

/**
 * One author identity: the commits grouped by a lowercased email
 * (design §5.3). Consumed by the deterministic metrics layer.
 */
export interface AuthorGroup {
  /** Lowercased email the commits are grouped by. */
  email: string;
  /** Display name: the most frequent author name for the email. */
  name: string;
  /** The author's commits, newest first as parsed. */
  commits: Commit[];
  /** Heuristic bot flag; bots are counted like everyone else (§5.4). */
  isBot: boolean;
}

/**
 * Accumulation state for one email while grouping commits.
 */
interface AuthorAccumulator {
  /** Author names seen for the email, and how often. */
  nameCounts: Map<string, number>;
  /** Names in first-seen order, for deterministic tie-breaking. */
  nameOrder: string[];
  /** The grouped commits, in input order. */
  commits: Commit[];
  /** Whether any commit matched the bot heuristic. */
  isBot: boolean;
}

/**
 * Groups commits by lowercased author email (design §5.3). The display
 * name is the most frequent author name; ties break by first-seen
 * order in the commit list. Groups appear in first-encounter order
 * (newest author first for the usual newest-first input). Bots are
 * flagged but never removed (§5.4).
 *
 * @param commits - Commits to group, typically newest first.
 * @returns One group per distinct lowercased email.
 */
export function groupByAuthor(commits: Commit[]): AuthorGroup[] {
  const byEmail = new Map<string, AuthorAccumulator>();
  for (const commit of commits) {
    const email = commit.authorEmail.toLowerCase();
    let group = byEmail.get(email);
    if (group === undefined) {
      group = { nameCounts: new Map(), nameOrder: [], commits: [], isBot: false };
      byEmail.set(email, group);
    }
    group.commits.push(commit);
    group.isBot = group.isBot || isBotAuthor(commit.authorName, commit.authorEmail);
    const seen = group.nameCounts.get(commit.authorName);
    if (seen === undefined) {
      group.nameCounts.set(commit.authorName, 1);
      group.nameOrder.push(commit.authorName);
    } else {
      group.nameCounts.set(commit.authorName, seen + 1);
    }
  }
  return [...byEmail.entries()].map(([email, group]) => ({
    email,
    name: mostFrequentName(group),
    commits: group.commits,
    isBot: group.isBot,
  }));
}

/**
 * The most frequent author name of a group; ties break by first-seen
 * order (§5.3). The group always has at least one commit.
 *
 * @param group - The accumulated group.
 * @returns The display name.
 */
function mostFrequentName(group: AuthorAccumulator): string {
  let best = group.nameOrder[0];
  let bestCount = -1;
  for (const name of group.nameOrder) {
    const count = group.nameCounts.get(name) ?? 0;
    if (count > bestCount) {
      best = name;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Heuristic bot detection (design §5.4): `[bot]` in the name or email,
 * or the known bot names `dependabot` / `renovate` in the email. This
 * is a flag only — bots are counted like everyone else.
 *
 * @param name - Author name as written in the commit.
 * @param email - Author email as written in the commit.
 * @returns Whether the author looks like a bot.
 *
 * @internal Exported for tests only; used by `groupByAuthor` within
 * the module. Not part of the public module API.
 */
export function isBotAuthor(name: string, email: string): boolean {
  const lowerName = name.toLowerCase();
  const lowerEmail = email.toLowerCase();
  return (
    lowerName.includes('[bot]') ||
    lowerEmail.includes('[bot]') ||
    lowerEmail.includes('dependabot') ||
    lowerEmail.includes('renovate')
  );
}
