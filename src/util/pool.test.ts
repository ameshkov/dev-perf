/**
 * Tests for the `mapLimit` worker pool: input-order results, the
 * concurrency cap, edge-case limits, and first-error propagation after
 * every task settled.
 */
import { describe, expect, it } from 'vitest';
import { mapLimit } from './pool.js';

/** Resolves with `value` after `ms` milliseconds. */
function delay<T>(value: T, ms: number): Promise<T> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(value), ms);
  });
}

describe('mapLimit', () => {
  it('resolves with the results in input order', async () => {
    const results = await mapLimit([1, 2, 3, 4], 2, async (item) => {
      // Longest item first would scramble order without the pool.
      return delay(item * 10, (5 - item) * 5);
    });

    expect(results).toEqual([10, 20, 30, 40]);
  });

  it('never runs more than `limit` tasks in flight', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    await mapLimit([1, 2, 3, 4, 5, 6], 3, async (item) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await delay(item, 10);
      inFlight -= 1;
    });

    expect(maxInFlight).toBe(3);
  });

  it('runs everything in parallel when the limit is at least the item count', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const started: number[] = [];
    await mapLimit([1, 2, 3], 10, async (item) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      started.push(item);
      await delay(item, 10);
      inFlight -= 1;
    });

    expect(maxInFlight).toBe(3);
    expect(started.sort()).toEqual([1, 2, 3]);
  });

  it('runs one task at a time with limit 1', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    await mapLimit([1, 2, 3], 1, async (item) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await delay(item, 10);
      inFlight -= 1;
    });

    expect(maxInFlight).toBe(1);
  });

  it('resolves with an empty list for no items', async () => {
    await expect(mapLimit([], 2, async (item) => item)).resolves.toEqual([]);
  });

  it('rejects with the first error after every task settled', async () => {
    const settled: number[] = [];
    const first = new Error('first failure');

    await expect(
      mapLimit([1, 2, 3, 4], 2, async (item) => {
        try {
          if (item === 2) {
            throw first;
          }
          await delay(item, 10);
          return item;
        } finally {
          settled.push(item);
        }
      }),
    ).rejects.toThrow('first failure');

    // Every task ran to completion before the rejection surfaced, so
    // callers could release resources (e.g. close servers) in finally.
    expect(settled.sort()).toEqual([1, 2, 3, 4]);
  });

  it('still rejects when a later error is the first to settle', async () => {
    await expect(
      mapLimit([1, 2, 3], 3, async (item) => {
        if (item === 3) {
          throw new Error('third failure');
        }
        return delay(item, 5);
      }),
    ).rejects.toThrow('third failure');
  });
});
