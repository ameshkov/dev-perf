/**
 * Author identity resolution: commits are grouped by lowercased author
 * email; the display name is the most frequent author name for that
 * email. An optional email map (the config `users-map` key)
 * merges distinct emails that map to the same display name into one
 * identity, so a person's metrics are exact across their emails.
 * Without a map, v1 behavior holds — every distinct email is its own
 * identity. Bots are flagged by a heuristic but never filtered: they
 * are counted like
 * everyone else.
 */
import type { EmailMap } from '../util/email-map.js';
import type { Commit } from './commits.js';

/**
 * One author identity: commits grouped by a lowercased email, or by the
 * display name the emails map to when `--map` merges them. Consumed by
 * the deterministic metrics layer.
 */
export interface AuthorGroup {
  /** Stable primary key: the first-seen lowercased email of the identity. */
  email: string;
  /** Every lowercased email of the identity, sorted. */
  emails: string[];
  /** Display name: the mapped name, else the most frequent author name. */
  name: string;
  /** The identity's commits, newest first as parsed. */
  commits: Commit[];
  /** Heuristic bot flag; bots are counted like everyone else. */
  isBot: boolean;
}

/**
 * Prefix of identity keys derived from a mapped display name, so a name
 * key can never collide with an email key.
 */
const MAPPED_KEY_PREFIX = 'name:';

/**
 * Prefix of identity keys derived from a lowercased email, so an email
 * key can never collide with a mapped-name key.
 */
const EMAIL_KEY_PREFIX = 'mail:';

/**
 * Accumulation state for one identity while grouping commits.
 */
interface AuthorAccumulator {
  /** The first-seen lowercased email of the identity. */
  email: string;
  /** The mapped display name, when the identity was merged via the map. */
  mappedName: string | undefined;
  /** Author names seen for the identity, and how often. */
  nameCounts: Map<string, number>;
  /** Names in first-seen order, for deterministic tie-breaking. */
  nameOrder: string[];
  /** The identity's lowercased emails, in first-seen order. */
  emails: string[];
  /** The grouped commits, in input order. */
  commits: Commit[];
  /** Whether any commit matched the bot heuristic. */
  isBot: boolean;
}

/**
 * Groups commits by identity: a commit whose email is in the map joins
 * the mapped-name identity, otherwise its lowercased email. The two key
 * spaces are prefixed so they can never collide, and mapped identities
 * take the user-supplied name while unmapped ones keep the most
 * frequent author name (ties break by first-seen order). Identities
 * appear in first-encounter order (newest author first for the usual
 * newest-first input). Bots are flagged but never removed. An empty map
 * reproduces the v1 behavior exactly: one identity per email.
 *
 * @param commits - Commits to group, typically newest first.
 * @param emailMap - Lowercased-email-to-name mappings merging
 * identities; empty by default.
 * @returns One group per identity.
 */
export function groupByAuthor(commits: Commit[], emailMap: EmailMap = {}): AuthorGroup[] {
  const byKey = new Map<string, AuthorAccumulator>();
  for (const commit of commits) {
    const email = commit.authorEmail.toLowerCase();
    // Only an own property is a mapping: an inherited Object.prototype
    // member (e.g. an author email literally `toString`) must not be
    // read as a mapped name.
    const mapped = Object.hasOwn(emailMap, email) ? emailMap[email] : undefined;
    const key =
      mapped !== undefined ? `${MAPPED_KEY_PREFIX}${mapped}` : `${EMAIL_KEY_PREFIX}${email}`;
    let group = byKey.get(key);
    if (group === undefined) {
      group = {
        email,
        mappedName: mapped,
        nameCounts: new Map(),
        nameOrder: [],
        emails: [],
        commits: [],
        isBot: false,
      };
      byKey.set(key, group);
    }
    group.commits.push(commit);
    group.isBot = group.isBot || isBotAuthor(commit.authorName, commit.authorEmail);
    if (!group.emails.includes(email)) {
      group.emails.push(email);
    }
    const seen = group.nameCounts.get(commit.authorName);
    if (seen === undefined) {
      group.nameCounts.set(commit.authorName, 1);
      group.nameOrder.push(commit.authorName);
    } else {
      group.nameCounts.set(commit.authorName, seen + 1);
    }
  }
  return [...byKey.values()].map((group) => ({
    email: group.email,
    emails: [...group.emails].sort(),
    // `||` (not `??`) guards against a blank mapped name: mapped names
    // are validated non-empty on load, but a blank one must not reach
    // the report as the display name.
    name: group.mappedName || mostFrequentName(group),
    commits: group.commits,
    isBot: group.isBot,
  }));
}

/**
 * The most frequent author name of a group; ties break by first-seen
 * order. The group always has at least one commit.
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
 * Heuristic bot detection: `[bot]` in the name or email,
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
