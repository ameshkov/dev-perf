/**
 * The tag-selection state shared by the tag-based chart blocks: the
 * stored subsets per block id, resolved against each block's full tag
 * list, plus the toggle/all/none handlers of one block.
 */
import { useCallback, useState } from 'react';
import type { CountRow } from '../data/index.js';
import type { ChartBlockDescriptor } from './chart-block-descriptor.js';

/** The mutable tag-selection state of a section. */
export interface TagSelectionsState {
  /** The stored selections by block id. */
  selections: Record<string, ReadonlySet<string>>;
  /** Replaces the selection of one block. */
  setSelected: (id: string, selection: ReadonlySet<string>) => void;
}

/**
 * The tag-selection state of one section: blocks keep their full tag
 * set until the user narrows them down.
 *
 * @returns The state and its setter.
 */
export function useTagSelections(): TagSelectionsState {
  const [selections, setSelections] = useState<Record<string, ReadonlySet<string>>>({});
  const setSelected = useCallback((id: string, selection: ReadonlySet<string>): void => {
    setSelections((previous) => ({ ...previous, [id]: selection }));
  }, []);
  return { selections, setSelected };
}

/**
 * The tag selection of one block: the stored subset, or all tags of
 * the block when nothing was toggled yet; `undefined` for blocks
 * without tags.
 *
 * @param selections - The stored selections by block id.
 * @param descriptor - The block.
 * @returns The selected tag keys.
 */
export function resolveSelection(
  selections: Record<string, ReadonlySet<string>>,
  descriptor: ChartBlockDescriptor,
): ReadonlySet<string> | undefined {
  if (descriptor.tags === undefined) {
    return undefined;
  }
  const stored = selections[descriptor.id];
  if (stored !== undefined) {
    return stored;
  }
  return new Set(descriptor.tags.map((tag) => tag.key));
}

/** The tag change handlers of one block. */
export interface TagHandlers {
  /** Toggle one tag in or out of the selection. */
  onToggle: (key: string) => void;
  /** Select every tag. */
  onSelectAll: () => void;
  /** Clear the selection. */
  onClearAll: () => void;
}

/**
 * The tag change handlers of one block against its current selection.
 *
 * @param tags - The full tag list of the block.
 * @param selected - The block's current selection.
 * @param setSelected - Replaces the block's selection.
 * @returns The handlers.
 */
export function tagHandlers(
  tags: CountRow[],
  selected: ReadonlySet<string>,
  setSelected: (selection: ReadonlySet<string>) => void,
): TagHandlers {
  return {
    onToggle: (key: string): void => {
      const next = new Set(selected);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      setSelected(next);
    },
    onSelectAll: (): void => setSelected(new Set(tags.map((tag) => tag.key))),
    onClearAll: (): void => setSelected(new Set()),
  };
}
