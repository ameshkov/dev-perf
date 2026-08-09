/**
 * Tests for the tag-selection state: resolution of stored subsets
 * against a block's tag list, the section hook, and the handlers.
 */
import { act, renderHook } from '@testing-library/react';
import type { EChartsOption } from 'echarts';
import { describe, expect, it, vi } from 'vitest';
import type { CountRow } from '../data/index.js';
import type { ChartBlockDescriptor } from './index.js';
import { resolveSelection, useTagSelections } from './index.js';
import { tagHandlers } from './tag-selections.js';

const tags: CountRow[] = [
  { key: 'a', value: 2 },
  { key: 'b', value: 1 },
];

/**
 * Builds a block descriptor with or without tags.
 *
 * @param withTags - Whether the block carries the shared tag list.
 * @returns The descriptor.
 */
function descriptor(withTags: boolean): ChartBlockDescriptor {
  return {
    id: 'block',
    title: 'Block',
    description: 'A block.',
    ...(withTags ? { tags } : {}),
    optionOf: (): EChartsOption => ({}) as unknown as EChartsOption,
  };
}

describe('resolveSelection', () => {
  it('returns undefined for blocks without tags', () => {
    expect(resolveSelection({}, descriptor(false))).toBeUndefined();
  });

  it('defaults to every tag of the block when nothing was stored', () => {
    expect(resolveSelection({}, descriptor(true))).toEqual(new Set(['a', 'b']));
  });

  it('returns the stored subset as-is, even when empty', () => {
    const stored: ReadonlySet<string> = new Set(['b']);
    expect(resolveSelection({ block: stored }, descriptor(true))).toBe(stored);
    expect(resolveSelection({ block: new Set() }, descriptor(true))).toEqual(new Set());
  });
});

describe('useTagSelections', () => {
  it('starts without stored selections and stores per block id', () => {
    const { result } = renderHook(() => useTagSelections());
    expect(result.current.selections).toEqual({});

    act(() => result.current.setSelected('block', new Set(['a'])));
    expect(result.current.selections).toEqual({ block: new Set(['a']) });

    act(() => result.current.setSelected('other', new Set(['b'])));
    expect(result.current.selections).toEqual({ block: new Set(['a']), other: new Set(['b']) });
  });
});

describe('tagHandlers', () => {
  it('toggles keys in and out of the selection', () => {
    const setSelected = vi.fn();
    const handlers = tagHandlers(tags, new Set(['a']), setSelected);

    handlers.onToggle('b');
    expect(setSelected).toHaveBeenLastCalledWith(new Set(['a', 'b']));

    handlers.onToggle('a');
    expect(setSelected).toHaveBeenLastCalledWith(new Set());
  });

  it('selects all tags and clears the selection', () => {
    const setSelected = vi.fn();
    const handlers = tagHandlers(tags, new Set(), setSelected);

    handlers.onSelectAll();
    expect(setSelected).toHaveBeenLastCalledWith(new Set(['a', 'b']));

    handlers.onClearAll();
    expect(setSelected).toHaveBeenLastCalledWith(new Set());
  });
});
