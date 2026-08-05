/**
 * Minimal concurrency helpers (vanilla, no dependencies):
 * `mapLimit` runs an async function over items with a concurrency cap
 * and resolves in input order after every task settled.
 */

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
