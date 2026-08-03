/**
 * Error detail rendering: turns any thrown value into a readable
 * message. The case that matters is Node's `fetch`: a failed request
 * rejects with `TypeError: fetch failed`, whose real reason (e.g.
 * `connect ECONNREFUSED 127.0.0.1:50664` when the server died, or
 * `socket hang up` when the connection was dropped) lives in
 * `error.cause` — wrapped in an `AggregateError` by undici — not in
 * the message. `errorDetail` walks the cause chain so that reason
 * reaches the user instead of a bare "fetch failed".
 */

/** How many cause links are followed before rendering stops. */
const MAX_CAUSE_DEPTH = 4;

/** Longest rendered detail from a non-Error object (SDK error bodies). */
const MAX_OBJECT_DETAIL = 300;

/**
 * Renders a thrown value as a readable message: `Error` messages with
 * their `cause` chains appended (`fetch failed: connect ECONNREFUSED
 * 127.0.0.1:50664`), `AggregateError`s flattened into their
 * individual errors (undici wraps fetch causes in them), objects with
 * a `message` property reduced to it (SDK error bodies), and anything
 * else stringified. Repeated causes are collapsed, cycles and
 * arbitrarily deep chains are cut off.
 *
 * @param error - The thrown value.
 * @returns The readable detail.
 */
export function errorDetail(error: unknown): string {
  return render(error, new Set(), 0);
}

/**
 * Renders one link of the cause chain; `seen` guards against cycles.
 *
 * @param error - The value to render.
 * @param seen - Errors already rendered (cycle guard).
 * @param depth - How many cause links were already followed.
 * @returns The rendered detail.
 */
function render(error: unknown, seen: Set<object>, depth: number): string {
  if (typeof error !== 'object' || error === null) {
    return String(error);
  }
  if (depth >= MAX_CAUSE_DEPTH || seen.has(error)) {
    return shortMessage(error);
  }
  seen.add(error);
  if (error instanceof AggregateError) {
    const details = error.errors
      .map((cause) => render(cause, seen, depth + 1))
      .filter((detail, index, all) => detail !== '' && all.indexOf(detail) === index);
    return details.length === 0 ? shortMessage(error) : details.join('; ');
  }
  if (error instanceof Error) {
    const message = error.message;
    if (error.cause === undefined) {
      return message;
    }
    const cause = render(error.cause, seen, depth + 1);
    if (message === '' || cause === message || message.endsWith(cause)) {
      // The cause is already embedded: wrapper errors carry the fully
      // rendered detail in their message (e.g. `analysis of Alice
      // (session ses_1) failed: fetch failed: connect ECONNREFUSED
      // ...`), so appending it again would duplicate the text.
      return message === '' ? cause : message;
    }
    return `${message}: ${cause}`;
  }
  return shortMessage(error);
}

/**
 * Renders one error value without following its cause chain.
 *
 * @param error - The value to render.
 * @returns The rendered detail.
 */
function shortMessage(error: object): string {
  if ('message' in error && typeof error.message === 'string' && error.message !== '') {
    return error.message;
  }
  try {
    const text = JSON.stringify(error);
    if (text === undefined) {
      return String(error);
    }
    return text.length > MAX_OBJECT_DETAIL ? `${text.slice(0, MAX_OBJECT_DETAIL)}...` : text;
  } catch {
    return String(error);
  }
}
