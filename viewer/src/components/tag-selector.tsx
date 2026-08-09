/**
 * The tag selector of tag-based chart blocks: one chip per tag with
 * its total count, toggleable by click, with quick select-all and
 * clear-all controls. The selected subset drives which series the
 * chart shows.
 */
import type { ReactElement } from 'react';
import type { CountRow } from '../data/index.js';
import { formatInt } from '../data/index.js';

/** The props of the {@link TagSelector} component. */
export interface TagSelectorProps {
  /** All selectable tags, in display order, with their totals. */
  tags: CountRow[];
  /** The currently selected tag keys. */
  selected: ReadonlySet<string>;
  /** Toggle one tag in or out of the selection. */
  onToggle: (key: string) => void;
  /** Select every tag. */
  onSelectAll: () => void;
  /** Clear the selection. */
  onClearAll: () => void;
}

/**
 * Renders the chip row of one tag-based chart block.
 *
 * @param props - Tags, selection state and change handlers.
 * @returns The selector element.
 */
export function TagSelector({
  tags,
  selected,
  onToggle,
  onSelectAll,
  onClearAll,
}: TagSelectorProps): ReactElement {
  const allSelected = selected.size === tags.length;
  const noneSelected = selected.size === 0;
  return (
    <div className="tag-selector">
      <div className="tag-selector-actions">
        <span className="tag-selector-caption">Tags</span>
        <button
          type="button"
          className="tag-selector-button"
          onClick={onSelectAll}
          disabled={allSelected}
        >
          All
        </button>
        <button
          type="button"
          className="tag-selector-button"
          onClick={onClearAll}
          disabled={noneSelected}
        >
          None
        </button>
      </div>
      <div className="tag-chips">
        {tags.map((tag) => (
          <button
            key={tag.key}
            type="button"
            className={selected.has(tag.key) ? 'tag-chip tag-chip-active' : 'tag-chip'}
            aria-pressed={selected.has(tag.key)}
            onClick={() => onToggle(tag.key)}
          >
            <span className="tag-chip-name">{tag.key}</span>
            <span className="tag-chip-count">{formatInt(tag.value)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
