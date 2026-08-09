/**
 * Minimal concurrency helpers (vanilla, no dependencies): `mapLimit`
 * runs an async function over items with a concurrency cap and resolves
 * in input order after every task settled; `createLimit` builds a
 * shared concurrency gate that bounds how many gated operations run at
 * the same time, so independent pools (e.g. per-repository LLM
 * sessions) stay within one global cap.
 */

/**
 * A shared concurrency gate with a fixed capacity: gated operations
 * (`run`) start right away while fewer than the capacity are running
 * and queue up behind them otherwise. A gate can be shared by
 * independent callers, so the total concurrency across them stays
 * bounded.
 */
export interface Limit {
  /**
   * Runs `fn`, acquiring a gate slot: the promise resolves with `fn`'s
   * value once a slot is free, releasing the slot when `fn` settles —
   * success or failure.
   *
   * @param fn - The gated operation.
   * @returns The operation's result.
   */
  run<T>(fn: () => Promise<T>): Promise<T>;
}

/**
 * Creates a shared concurrency gate with the given capacity. `mapLimit`
 * caps the concurrency of one batch; the gate instead caps concurrency
 * across independent callers that share it (e.g. the LLM sessions of
 * every repository of a run), so `parallel` bounds the slow work
 * globally instead of per batch.
 *
 * @param capacity - Maximum number of concurrent gated operations; at
 * least 1.
 * @returns The gate.
 */
export function createLimit(capacity: number): Limit {
  let active = 0;
  const waiters: Array<() => void> = [];
  // Hands the slot a finished operation released to the longest-waiting
  // caller, if any.
  const resumeNext = (): void => {
    const next = waiters.shift();
    if (next !== undefined) {
      next();
    }
  };
  return {
    run<T>(fn: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const start = (): void => {
          active += 1;
          void fn().then(
            (value) => {
              active -= 1;
              resumeNext();
              resolve(value);
            },
            (error) => {
              active -= 1;
              resumeNext();
              reject(error);
            },
          );
        };
        if (active < Math.max(1, capacity)) {
          start();
        } else {
          waiters.push(start);
        }
      });
    },
  };
}

/**
 * Runs `fn` over every item with at most `limit` calls in flight,
 * resolving with the results in input order. When a task rejects, the
 * tasks still running (and the ones not started yet) keep running to
 * completion — so callers can release resources in `finally` blocks —
 * and the returned promise rejects with the first error.
 *
 * @param items - The items to process, in result order.
 * @param limit - Maximum number of concurrent calls; at least 1.
 * @param fn - The async per-item operation; the index identifies the
 * item's position in `items`.
 * @returns The results in input order.
 * @throws {unknown} The first error any call rejects with, after every
 * call has settled.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let nextIndex = 0;
  let firstError: unknown;
  const workerCount = Math.min(Math.max(limit, 1), items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = await fn(items[index], index);
      } catch (error) {
        firstError ??= error;
      }
    }
  });
  await Promise.all(workers);
  if (firstError !== undefined) {
    throw firstError;
  }
  return results;
}
