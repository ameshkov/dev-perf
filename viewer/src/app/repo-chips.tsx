/**
 * The repository chips of the report meta bar: one chip per analyzed
 * repository spec, with the spec's non-default fields (branch, base
 * scoping, ignored paths) visible next to the repository label so
 * different specs of the same repository stay distinguishable. Lists
 * longer than a handful of chips collapse into a single
 * "N repositories" toggle chip, expanded on click.
 */
import { useState } from 'react';
import type { ReactElement } from 'react';
import type { RepoChip } from '../data/index.js';
import { repoChips } from '../data/index.js';
import type { RepoSpec } from '../report/index.js';

/** Chip count above which the list collapses by default. */
const COLLAPSE_THRESHOLD = 5;

/** The props of the {@link RepoChips} component. */
export interface RepoChipsProps {
  /** Repository specs as recorded in the report, in input order. */
  repos: readonly RepoSpec[];
}

/**
 * Renders one repository chip: the short label followed by the spec's
 * non-default fields when it carries any.
 *
 * @param chip - The chip of one analyzed spec.
 * @param index - The spec position; the key (labels may repeat).
 * @returns The chip element.
 */
function chipElement(chip: RepoChip, index: number): ReactElement {
  return (
    <span key={index} className="meta-chip" title={chip.title}>
      {chip.label}
      {chip.detail !== undefined ? (
        <span className="meta-chip-detail"> · {chip.detail}</span>
      ) : null}
    </span>
  );
}

/**
 * Renders the repository chips of the meta bar. Short lists render
 * every chip; longer lists collapse behind a "N repositories" button
 * that expands and collapses the full per-spec list.
 *
 * @param props - The repository specs of the report.
 * @returns The toggle button (when collapsible) and the chips.
 */
export function RepoChips({ repos }: RepoChipsProps): ReactElement {
  const [open, setOpen] = useState(false);
  const chips = repoChips(repos);
  const collapsible = chips.length > COLLAPSE_THRESHOLD;
  const expanded = !collapsible || open;
  return (
    <>
      {collapsible ? (
        <button
          type="button"
          className="meta-chip meta-chip-toggle"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? 'hide repositories' : `${repos.length} repositories`}
        </button>
      ) : null}
      {expanded ? chips.map(chipElement) : null}
    </>
  );
}
