/**
 * Tests for the concurrency helpers: `mapLimit` (input-order results,
 * the concurrency cap, edge-case limits, and first-error propagation
 * after every task settled) and `createLimit`, the shared gate that
 * keeps a fixed concurrency cap across independent callers.
 */
import { describe, expect, it } from 'vitest';
import { createLimit, mapLimit } from './pool.js';

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

describe('createLimit', () => {
  it('resolves with the operation result and runs one op at a time with capacity 1', async () => {
    const gate = createLimit(1);
    let inFlight = 0;
    let maxInFlight = 0;
    const run = (value: number): Promise<number> =>
      gate.run(async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await delay(value, 10);
        inFlight -= 1;
        return value;
      });

    expect(await Promise.all([run(1), run(2), run(3)])).toEqual([1, 2, 3]);
    expect(maxInFlight).toBe(1);
  });

  it('never runs more than `capacity` ops in flight', async () => {
    const gate = createLimit(2);
    let inFlight = 0;
    let maxInFlight = 0;
    const run = (value: number): Promise<void> =>
      gate.run(async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await delay(value, 5);
        inFlight -= 1;
      });

    await Promise.all([run(1), run(2), run(3), run(4), run(5)]);
    expect(maxInFlight).toBe(2);
  });

  it('keeps the cap across independent callers sharing one gate', async () => {
    // The point of a shared gate: two concurrent batches (e.g. the LLM
    // sessions of two repositories) stay within the single global cap
    // instead of each running at full speed.
    const gate = createLimit(2);
    let inFlight = 0;
    let maxInFlight = 0;
    const run = (value: number): Promise<number> =>
      gate.run(async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await delay(value, 5);
        inFlight -= 1;
        return value;
      });

    await Promise.all([mapLimit([1, 2], 2, run), mapLimit([3, 4], 2, run)]);
    expect(maxInFlight).toBe(2);
  });

  it('rejects with the operation error and releases the slot', async () => {
    const gate = createLimit(1);
    await expect(gate.run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    // The failed operation released its slot, so a later one still runs.
    await expect(gate.run(() => Promise.resolve(7))).resolves.toBe(7);
  });
});
