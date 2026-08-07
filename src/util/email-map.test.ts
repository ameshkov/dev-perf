/**
 * Tests for the shared email mapping helpers used by both the `report`
 * and `compile` commands: `usersMapToEntries` parses the `users-map`
 * config key into mapping entries, and `loadEmailMap` compiles the
 * parsed entries into the email-to-name map identities merge under.
 */
import { describe, expect, it } from 'vitest';
import { loadEmailMap, usersMapToEntries } from './email-map.js';

describe('loadEmailMap', () => {
  it('returns an empty map without entries', () => {
    expect(loadEmailMap()).toEqual({});
    expect(loadEmailMap([])).toEqual({});
  });

  it('compiles the parsed entries into an email-to-name map', () => {
    expect(
      loadEmailMap([
        { email: 'alice@example.com', name: 'Alice Smith' },
        { email: 'bob@example.com', name: 'Bob' },
      ]),
    ).toEqual({
      'alice@example.com': 'Alice Smith',
      'bob@example.com': 'Bob',
    });
  });

  it('lets a later entry win on a conflicting email', () => {
    expect(
      loadEmailMap([
        { email: 'alice@example.com', name: 'Alice' },
        { email: 'alice@example.com', name: 'Alice Smith' },
      ]),
    ).toEqual({ 'alice@example.com': 'Alice Smith' });
  });
});

describe('usersMapToEntries', () => {
  it('parses a users-map record into entries with lowercased, trimmed emails', () => {
    expect(
      usersMapToEntries({
        '  Alice@Example.com ': ' Alice Smith ',
        'bob@example.com': 'Bob',
      }),
    ).toEqual([
      { email: 'alice@example.com', name: 'Alice Smith' },
      { email: 'bob@example.com', name: 'Bob' },
    ]);
  });

  it('keeps a comma inside a display name in the parsed entry', () => {
    expect(usersMapToEntries({ 'alice@example.com': 'Doe, John' })).toEqual([
      { email: 'alice@example.com', name: 'Doe, John' },
    ]);
  });

  it('returns no entries for an empty record', () => {
    expect(usersMapToEntries({})).toEqual([]);
  });

  it('rejects a non-string value with the friendly error, not a raw TypeError', () => {
    // A non-string value (e.g. a numeric YAML value that bypassed the
    // config-file schema) must be rejected with the friendly error
    // before `.trim()` is called on it.
    const usersMap = { 'alice@example.com': 42 } as unknown as Record<string, string>;

    expect(() => usersMapToEntries(usersMap)).toThrow(
      /users-map: expected a non-empty email and name, got 'alice@example.com' -> '42'/,
    );
  });
});
