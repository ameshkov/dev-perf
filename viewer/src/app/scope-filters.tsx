/**
 * The scope filter groups of the dashboard control bar: one chip row
 * per filterable side — repositories of a multi-repository report and
 * contributors when at least two are in scope. Chips reuse the tag
 * selector look; the selections drive the report scope state.
 */
import type { ReactElement } from 'react';
import type { CountRow } from '../data/index.js';
import { formatInt, repoName } from '../data/index.js';
import type { ScopeHandlers } from './report-scope.js';

/** The props of one scope filter group. */
interface ScopeGroupProps {
  /** The group caption, e.g. `Repositories`. */
  caption: string;
  /** The selectable options with their commit counts. */
  options: CountRow[];
  /** The current selection; `undefined` while nothing is filtered. */
  selected: ReadonlySet<string> | undefined;
  /** Renders the chip label of a key; defaults to the key itself. */
  labelOf?: (key: string) => string;
  /** The change handlers of the group. */
  handlers: ScopeHandlers;
}

/**
 * The count of selected options of a group, resolving the unset
 * selection as "everything selected".
 *
 * @param options - The options of the group.
 * @param selected - The current selection.
 * @returns The selected count.
 */
function selectedCount(options: CountRow[], selected: ReadonlySet<string> | undefined): number {
  if (selected === undefined) {
    return options.length;
  }
  return options.filter((option) => selected.has(option.key)).length;
}

/** The props of the group head row. */
interface ScopeGroupHeadProps {
  /** The group caption. */
  caption: string;
  /** The selected count. */
  count: number;
  /** The total option count. */
  total: number;
  /** Whether everything is selected (All is a no-op). */
  allSelected: boolean;
  /** Whether nothing is selected (None is a no-op). */
  noneSelected: boolean;
  /** The change handlers of the group. */
  handlers: ScopeHandlers;
}

/**
 * Renders the head row of one group: the caption with the selected
 * count and the All/None quick actions.
 *
 * @param props - Caption, counts, selection state and handlers.
 * @returns The head row element.
 */
function ScopeGroupHead({
  caption,
  count,
  total,
  allSelected,
  noneSelected,
  handlers,
}: ScopeGroupHeadProps): ReactElement {
  return (
    <div className="scope-group-head">
      <span className="scope-group-caption">{caption}</span>
      <span className="scope-group-count">
        {formatInt(count)} of {formatInt(total)}
      </span>
      <span className="scope-group-actions">
        <button
          type="button"
          className="tag-selector-button"
          onClick={handlers.onSelectAll}
          disabled={allSelected}
        >
          All
        </button>
        <button
          type="button"
          className="tag-selector-button"
          onClick={handlers.onClearAll}
          disabled={noneSelected}
        >
          None
        </button>
      </span>
    </div>
  );
}

/** The props of the chip row of one group. */
interface ScopeChipRowProps {
  /** The selectable options with their commit counts. */
  options: CountRow[];
  /** Whether every option is selected. */
  allSelected: boolean;
  /** The current selection; ignored while everything is selected. */
  selected: ReadonlySet<string> | undefined;
  /** Renders the chip label of a key; defaults to the key itself. */
  labelOf?: (key: string) => string;
  /** Toggles one option. */
  onToggle: (key: string) => void;
}

/**
 * Renders one chip per option of a group.
 *
 * @param props - Options, selection state and the toggle handler.
 * @returns The chip row element.
 */
function ScopeChipRow({
  options,
  allSelected,
  selected,
  labelOf,
  onToggle,
}: ScopeChipRowProps): ReactElement {
  return (
    <div className="tag-chips">
      {options.map((option) => {
        const active = allSelected || (selected !== undefined && selected.has(option.key));
        return (
          <button
            key={option.key}
            type="button"
            className={active ? 'tag-chip tag-chip-active' : 'tag-chip'}
            aria-pressed={active}
            title={option.key}
            onClick={() => onToggle(option.key)}
          >
            <span className="tag-chip-name">
              {labelOf !== undefined ? labelOf(option.key) : option.key}
            </span>
            <span className="tag-chip-count">{formatInt(option.value)}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Renders one scope filter group: caption with the selected count,
 * All/None quick actions, and one chip per option.
 *
 * @param props - Caption, options, selection state and handlers.
 * @returns The group element.
 *
 * @internal Exported for tests only; the dashboard consumes the
 * module through {@link ScopeFilters}. Not part of the public module
 * API.
 */
export function ScopeGroup({
  caption,
  options,
  selected,
  labelOf,
  handlers,
}: ScopeGroupProps): ReactElement {
  const count = selectedCount(options, selected);
  const allSelected = selected === undefined;
  const noneSelected = selected !== undefined && count === 0;
  return (
    <div className="scope-group" role="group" aria-label={caption}>
      <ScopeGroupHead
        caption={caption}
        count={count}
        total={options.length}
        allSelected={allSelected}
        noneSelected={noneSelected}
        handlers={handlers}
      />
      <ScopeChipRow
        options={options}
        allSelected={allSelected}
        selected={selected}
        labelOf={labelOf}
        onToggle={handlers.onToggle}
      />
    </div>
  );
}

/** The props of the {@link ScopeFilters} component. */
export interface ScopeFiltersProps {
  /** Repository options of the full report. */
  repoOptions: CountRow[];
  /** The repository selection; `undefined` while unfiltered. */
  selectedRepos: ReadonlySet<string> | undefined;
  /** The change handlers of the repository group. */
  repoHandlers: ScopeHandlers;
  /** User options of the repository-scoped report. */
  userOptions: CountRow[];
  /** The user selection; `undefined` while unfiltered. */
  selectedUsers: ReadonlySet<string> | undefined;
  /** The change handlers of the user group. */
  userHandlers: ScopeHandlers;
}

/**
 * Renders the scope filter groups: the repository group only for
 * multi-repository reports, the contributor group only when at least
 * two contributors are in scope; `null` when neither applies.
 *
 * @param props - The options, selections and handlers of both groups.
 * @returns The filters element, or `null` without filterable groups.
 */
export function ScopeFilters({
  repoOptions,
  selectedRepos,
  repoHandlers,
  userOptions,
  selectedUsers,
  userHandlers,
}: ScopeFiltersProps): ReactElement | null {
  const showRepos = repoOptions.length >= 2;
  const showUsers = userOptions.length >= 2;
  if (!showRepos && !showUsers) {
    return null;
  }
  return (
    <div className="scope-filters">
      {showRepos ? (
        <ScopeGroup
          caption="Repositories"
          options={repoOptions}
          selected={selectedRepos}
          labelOf={repoName}
          handlers={repoHandlers}
        />
      ) : null}
      {showUsers ? (
        <ScopeGroup
          caption="Contributors"
          options={userOptions}
          selected={selectedUsers}
          handlers={userHandlers}
        />
      ) : null}
    </div>
  );
}
