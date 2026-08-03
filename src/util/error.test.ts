/**
 * Tests for `errorDetail`: plain errors, cause chains (the undici
 * `fetch failed` shape in particular), `AggregateError`s, SDK-style
 * error objects, and non-error values.
 */
import { describe, expect, it } from 'vitest';
import { errorDetail } from './error.js';

describe('errorDetail', () => {
  it('renders a plain error message', () => {
    expect(errorDetail(new Error('git clone failed'))).toBe('git clone failed');
  });

  it('walks the cause chain, appending each link', () => {
    const error = new Error('outer', { cause: new Error('inner', { cause: new Error('root') }) });
    expect(errorDetail(error)).toBe('outer: inner: root');
  });

  it('surfaces the real reason behind undici "fetch failed" errors', () => {
    // Node's fetch rejects with TypeError('fetch failed') whose cause is
    // an AggregateError carrying the actual network error.
    const error = new TypeError('fetch failed', {
      cause: new AggregateError([new TypeError('connect ECONNREFUSED 127.0.0.1:50664')]),
    });
    expect(errorDetail(error)).toBe('fetch failed: connect ECONNREFUSED 127.0.0.1:50664');
  });

  it('renders the socket-hang-up flavor of fetch failures too', () => {
    const error = new TypeError('fetch failed', {
      cause: new AggregateError([new Error('socket hang up')]),
    });
    expect(errorDetail(error)).toBe('fetch failed: socket hang up');
  });

  it('flattens an AggregateError into its individual errors', () => {
    const error = new AggregateError([new Error('a'), new Error('b')], 'joined');
    expect(errorDetail(error)).toBe('a; b');
  });

  it('falls back to the AggregateError message when it has no errors', () => {
    expect(errorDetail(new AggregateError([], 'nothing failed'))).toBe('nothing failed');
  });

  it('collapses a cause that repeats the message', () => {
    const cause = new Error('x');
    expect(errorDetail(new Error('x', { cause }))).toBe('x');
  });

  it('does not duplicate a cause already embedded in the message', () => {
    // Wrapper errors carry the fully rendered detail in their message
    // (e.g. the pipeline's `LLM analysis failed for <repo>: <detail>`);
    // rendering must not append the cause chain a second time.
    const fetchError = new TypeError('fetch failed', {
      cause: new AggregateError([new TypeError('connect ECONNREFUSED 127.0.0.1:50664')]),
    });
    const userWrap = new Error(
      `analysis of Alice <alice@example.com> (session ses_1) failed: ${errorDetail(fetchError)}`,
      { cause: fetchError },
    );
    const pipelineWrap = new Error(
      `LLM analysis failed for ssh://repo.git: ${errorDetail(userWrap)}`,
      {
        cause: userWrap,
      },
    );
    expect(errorDetail(pipelineWrap)).toBe(
      'LLM analysis failed for ssh://repo.git: ' +
        'analysis of Alice <alice@example.com> (session ses_1) failed: ' +
        'fetch failed: connect ECONNREFUSED 127.0.0.1:50664',
    );
  });

  it('cuts off arbitrarily deep cause chains', () => {
    let error: Error = new Error('level 6');
    for (let depth = 5; depth >= 1; depth--) {
      error = new Error(`level ${depth}`, { cause: error });
    }
    // Renders the top 5 links, stopping before the deepest one.
    expect(errorDetail(error)).toBe('level 1: level 2: level 3: level 4: level 5');
  });

  it('cuts off cause cycles without hanging', () => {
    const error = new Error('looping');
    error.cause = error;
    expect(errorDetail(error)).toBe('looping');
  });

  it('reduces SDK-style error objects to their message', () => {
    expect(errorDetail({ message: 'rate limited', status: 429 })).toBe('rate limited');
  });

  it('stringifies objects without a message', () => {
    expect(errorDetail({ status: 400 })).toBe('{"status":400}');
  });

  it('stringifies non-error values', () => {
    expect(errorDetail('boom')).toBe('boom');
    expect(errorDetail(42)).toBe('42');
    expect(errorDetail(undefined)).toBe('undefined');
  });
});
