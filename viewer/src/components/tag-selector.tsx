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
  /** Renders the chip label of a key; defaults to the key itself. */
  labelOf?: (key: string) => string;
  /** Toggle one tag in or out of the selection. */
  onToggle: (key: string) => void;
  /** Select every tag. */
  onSelectAll: () => void;
  /** Clear the selection. */
  onClearAll: () => void;
}

/** The props of one {@link TagChip}. */
interface TagChipProps {
  /** The tag the chip represents. */
  tag: CountRow;
  /** Whether the tag is part of the selection. */
  active: boolean;
  /** Renders the chip label of a key; defaults to the key itself. */
  labelOf?: (key: string) => string;
  /** Toggles the tag. */
  onToggle: (key: string) => void;
}

/**
 * Renders one tag chip: the label (or the key itself) and the
 * formatted total, with the full key as the hover tooltip.
 *
 * @param props - Tag, selection state and the toggle handler.
 * @returns The chip element.
 */
function TagChip({ tag, active, labelOf, onToggle }: TagChipProps): ReactElement {
  return (
    <button
      type="button"
      className={active ? 'tag-chip tag-chip-active' : 'tag-chip'}
      aria-pressed={active}
      title={tag.key}
      onClick={() => onToggle(tag.key)}
    >
      <span className="tag-chip-name">{labelOf !== undefined ? labelOf(tag.key) : tag.key}</span>
      <span className="tag-chip-count">{formatInt(tag.value)}</span>
    </button>
  );
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
  labelOf,
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
          <TagChip
            key={tag.key}
            tag={tag}
            active={selected.has(tag.key)}
            labelOf={labelOf}
            onToggle={onToggle}
          />
        ))}
      </div>
    </div>
  );
}
