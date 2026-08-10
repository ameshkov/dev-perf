/**
 * Tests for the repository chips of the meta bar: one chip per spec
 * with the extras visible, and the collapsed "N repositories" toggle
 * of long lists.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RepoChips } from './repo-chips.js';

describe('RepoChips', () => {
  it('renders one chip per spec with the extras visible', () => {
    const { container } = render(
      <RepoChips
        repos={[
          { repo: 'https://github.com/acme/api.git', branch: 'master' },
          { repo: 'https://github.com/acme/api.git', branch: 'release/v2', base: 'master' },
        ]}
      />,
    );
    const chips = [...container.querySelectorAll('.meta-chip')];
    expect(chips).toHaveLength(2);
    expect(chips[0]?.textContent).toBe('github.com/acme/api · branch: master');
    expect(chips[1]?.textContent).toBe('github.com/acme/api · branch: release/v2, base: master');
    expect(container.querySelector('.meta-chip-toggle')).toBeNull();
  });

  it('collapses long lists behind a "N repositories" toggle', () => {
    const repos = Array.from({ length: 7 }, (_, index) => ({
      repo: `https://github.com/acme/repo-${index}.git`,
    }));
    const { container } = render(<RepoChips repos={repos} />);
    // Collapsed by default: only the toggle chip.
    expect(screen.getByRole('button', { name: '7 repositories' })).toBeDefined();
    expect(container.querySelectorAll('.meta-chip')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: '7 repositories' }));
    expect(screen.getByRole('button', { name: 'hide repositories' })).toBeDefined();
    expect(container.querySelectorAll('.meta-chip')).toHaveLength(8);

    fireEvent.click(screen.getByRole('button', { name: 'hide repositories' }));
    expect(container.querySelectorAll('.meta-chip')).toHaveLength(1);
  });
});
