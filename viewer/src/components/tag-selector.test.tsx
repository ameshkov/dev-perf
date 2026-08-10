/**
 * Tests for the tag selector: chip rendering and counts, selection
 * styling, toggle callbacks, and the all/none controls.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CountRow } from '../data/index.js';
import { TagSelector } from './tag-selector.js';

const tags: CountRow[] = [
  { key: 'tests-added', value: 1234 },
  { key: 'no-tests', value: 5 },
];

/**
 * Renders the selector under test with spy handlers.
 *
 * @param selected - The currently selected tag keys.
 * @returns The spy handlers.
 */
function renderSelector(selected: ReadonlySet<string>): {
  onToggle: ReturnType<typeof vi.fn>;
  onSelectAll: ReturnType<typeof vi.fn>;
  onClearAll: ReturnType<typeof vi.fn>;
} {
  const onToggle = vi.fn();
  const onSelectAll = vi.fn();
  const onClearAll = vi.fn();
  render(
    <TagSelector
      tags={tags}
      selected={selected}
      onToggle={onToggle}
      onSelectAll={onSelectAll}
      onClearAll={onClearAll}
    />,
  );
  return { onToggle, onSelectAll, onClearAll };
}

describe('TagSelector', () => {
  it('renders one chip per tag with the formatted total', () => {
    renderSelector(new Set());
    expect(screen.getByText('tests-added')).toBeDefined();
    expect(screen.getByText('1,234')).toBeDefined();
    expect(screen.getByText('no-tests')).toBeDefined();
    expect(screen.getByText('5')).toBeDefined();
  });

  it('renders the labelOf label and keeps the full key as the tooltip', () => {
    render(
      <TagSelector
        tags={[{ key: 'git@github.com:acme/api.git', value: 17 }]}
        selected={new Set(['git@github.com:acme/api.git'])}
        labelOf={(key) => key.replace(/^git@github\.com:acme\//, '').replace(/\.git$/, '')}
        onToggle={vi.fn()}
        onSelectAll={vi.fn()}
        onClearAll={vi.fn()}
      />,
    );
    expect(screen.getByText('api')).toBeDefined();
    const chip = screen.getByRole('button', { name: /api/ });
    expect(chip.getAttribute('title')).toBe('git@github.com:acme/api.git');
  });

  it('marks the selected chips active and toggles by click', () => {
    const { onToggle } = renderSelector(new Set(['tests-added']));

    const active = screen.getByRole('button', { name: /tests-added/ });
    const inactive = screen.getByRole('button', { name: /no-tests/ });
    expect(active.className).toBe('tag-chip tag-chip-active');
    expect(active.getAttribute('aria-pressed')).toBe('true');
    expect(inactive.className).toBe('tag-chip');
    expect(inactive.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(inactive);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith('no-tests');
  });

  it('calls the all/none handlers and disables None on an empty selection', () => {
    const { onSelectAll, onClearAll } = renderSelector(new Set());

    const allButton = screen.getByRole('button', { name: 'All' });
    const noneButton = screen.getByRole('button', { name: 'None' });
    expect((noneButton as HTMLButtonElement).disabled).toBe(true);
    expect((allButton as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(allButton);
    expect(onSelectAll).toHaveBeenCalledTimes(1);
    expect(onClearAll).not.toHaveBeenCalled();
  });

  it('disables All when every tag is selected', () => {
    renderSelector(new Set(['tests-added', 'no-tests']));
    expect((screen.getByRole('button', { name: 'All' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'None' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });
});
