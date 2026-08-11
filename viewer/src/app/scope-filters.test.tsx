/**
 * Tests for the scope filter groups: chip rendering with labels and
 * counts, selected state, the All/None quick actions, group
 * visibility, and handler wiring.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ScopeFilters, ScopeGroup } from './scope-filters.js';
import type { ScopeHandlers } from './report-scope.js';

const API = 'git@github.com:acme/api.git';
const WEB = 'https://github.com/acme/web.git';

/** Builds a handler triple of spies. */
function handlers(): ScopeHandlers {
  return {
    onToggle: vi.fn(),
    onSelectAll: vi.fn(),
    onClearAll: vi.fn(),
  };
}

describe('ScopeGroup', () => {
  it('renders a chip per option with the label and the count', () => {
    render(
      <ScopeGroup
        caption="Repositories"
        options={[
          { key: API, value: 17 },
          { key: WEB, value: 6 },
        ]}
        selected={undefined}
        labelOf={(key) => (key === API ? 'github.com/acme/api' : 'github.com/acme/web')}
        handlers={handlers()}
      />,
    );
    expect(screen.getByText('Repositories')).toBeDefined();
    expect(screen.getByText('2 of 2')).toBeDefined();
    // All/None quick actions plus one chip per option.
    expect(screen.getAllByRole('button')).toHaveLength(4);
    expect(screen.getByText('github.com/acme/api')).toBeDefined();
    expect(screen.getByText('17')).toBeDefined();
    expect(screen.getByText('github.com/acme/web')).toBeDefined();
    expect(screen.getByText('6')).toBeDefined();
  });

  it('treats an unset selection as fully selected', () => {
    render(
      <ScopeGroup
        caption="Contributors"
        options={[
          { key: 'Alice Nguyen', value: 12 },
          { key: 'Bob Fisher', value: 11 },
        ]}
        selected={undefined}
        handlers={handlers()}
      />,
    );
    const alice = screen.getByRole('button', { name: /Alice Nguyen/ });
    const bob = screen.getByRole('button', { name: /Bob Fisher/ });
    expect(alice.getAttribute('aria-pressed')).toBe('true');
    expect(bob.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('2 of 2')).toBeDefined();
    // All is a no-op while everything is selected.
    expect(screen.getByRole('button', { name: 'All' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'None' }).hasAttribute('disabled')).toBe(false);
  });

  it('reflects an explicit selection and wires the handlers', () => {
    const group = handlers();
    render(
      <ScopeGroup
        caption="Contributors"
        options={[
          { key: 'Alice Nguyen', value: 12 },
          { key: 'Bob Fisher', value: 11 },
        ]}
        selected={new Set(['Bob Fisher'])}
        handlers={group}
      />,
    );
    expect(screen.getByText('1 of 2')).toBeDefined();
    const alice = screen.getByRole('button', { name: /Alice Nguyen/ });
    const bob = screen.getByRole('button', { name: /Bob Fisher/ });
    expect(alice.getAttribute('aria-pressed')).toBe('false');
    expect(bob.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(alice);
    expect(vi.mocked(group.onToggle)).toHaveBeenCalledWith('Alice Nguyen');
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(vi.mocked(group.onSelectAll)).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'None' }));
    expect(vi.mocked(group.onClearAll)).toHaveBeenCalledTimes(1);
  });

  it('disables None when the selection is already empty', () => {
    render(
      <ScopeGroup
        caption="Contributors"
        options={[
          { key: 'Alice Nguyen', value: 12 },
          { key: 'Bob Fisher', value: 11 },
        ]}
        selected={new Set()}
        handlers={handlers()}
      />,
    );
    expect(screen.getByText('0 of 2')).toBeDefined();
    expect(screen.getByRole('button', { name: 'None' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'All' }).hasAttribute('disabled')).toBe(false);
  });
});

describe('ScopeFilters', () => {
  const repoOptions = [
    { key: API, value: 17 },
    { key: WEB, value: 6 },
  ];
  const userOptions = [
    { key: 'Alice Nguyen', value: 12 },
    { key: 'Bob Fisher', value: 11 },
  ];

  it('renders both groups for a multi-repo, multi-user scope', () => {
    render(
      <ScopeFilters
        repoOptions={repoOptions}
        selectedRepos={undefined}
        repoHandlers={handlers()}
        userOptions={userOptions}
        selectedUsers={undefined}
        userHandlers={handlers()}
      />,
    );
    expect(screen.getByText('Repositories')).toBeDefined();
    expect(screen.getByText('Contributors')).toBeDefined();
  });

  it('hides the repository group for a single-repository report', () => {
    render(
      <ScopeFilters
        repoOptions={[{ key: API, value: 17 }]}
        selectedRepos={undefined}
        repoHandlers={handlers()}
        userOptions={userOptions}
        selectedUsers={undefined}
        userHandlers={handlers()}
      />,
    );
    expect(screen.queryByText('Repositories')).toBeNull();
    expect(screen.getByText('Contributors')).toBeDefined();
  });

  it('hides the contributor group with fewer than two contributors', () => {
    render(
      <ScopeFilters
        repoOptions={repoOptions}
        selectedRepos={undefined}
        repoHandlers={handlers()}
        userOptions={[{ key: 'Alice Nguyen', value: 12 }]}
        selectedUsers={undefined}
        userHandlers={handlers()}
      />,
    );
    expect(screen.getByText('Repositories')).toBeDefined();
    expect(screen.queryByText('Contributors')).toBeNull();
  });

  it('renders nothing when neither group is filterable', () => {
    const { container } = render(
      <ScopeFilters
        repoOptions={[{ key: API, value: 17 }]}
        selectedRepos={undefined}
        repoHandlers={handlers()}
        userOptions={[{ key: 'Alice Nguyen', value: 12 }]}
        selectedUsers={undefined}
        userHandlers={handlers()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('labels repository chips with the short repo name, not the full url', () => {
    render(
      <ScopeFilters
        repoOptions={[
          { key: 'git@github.com:acme/super-service.git', value: 9 },
          { key: 'https://github.com/acme/client-portal.git', value: 3 },
        ]}
        selectedRepos={undefined}
        repoHandlers={handlers()}
        userOptions={[{ key: 'Alice Nguyen', value: 12 }]}
        selectedUsers={undefined}
        userHandlers={handlers()}
      />,
    );
    expect(screen.getByText('super-service')).toBeDefined();
    expect(screen.getByText('client-portal')).toBeDefined();
    expect(screen.queryByText('github.com/acme/super-service')).toBeNull();
  });
});
