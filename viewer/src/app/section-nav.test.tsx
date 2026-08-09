/**
 * Tests for the section navigation: link rendering, smooth scrolling
 * below the sticky top bar, the navigate callback, and the
 * active-section tracking via the intersection observer (stubbed)
 * with a graceful fallback.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SectionNav, useActiveSection } from './section-nav.js';
import type { SectionNavItem } from './section-nav.js';
import { renderHook } from '@testing-library/react';

const SECTIONS: SectionNavItem[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'team', label: 'Team dynamics' },
  { id: 'individuals', label: 'Individual dynamics' },
];

/** A minimal IntersectionObserver double capturing callback and targets. */
class MockIntersectionObserver {
  /** Every instance created, oldest first. */
  static instances: MockIntersectionObserver[] = [];
  /** The observer callback. */
  readonly callback: IntersectionObserverCallback;
  /** The observed elements, in observation order. */
  readonly observed: Element[] = [];

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    MockIntersectionObserver.instances.push(this);
  }

  observe(element: Element): void {
    this.observed.push(element);
  }

  unobserve(): void {}

  disconnect(): void {}
}

describe('SectionNav', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('renders one link per section, the first active by default', () => {
    render(<SectionNav sections={SECTIONS} />);
    const links = screen.getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual([
      'Overview',
      'Team dynamics',
      'Individual dynamics',
    ]);
    expect(links[0].getAttribute('href')).toBe('#overview');
    expect(links[0].classList.contains('section-nav-link-active')).toBe(true);
    expect(links[0].getAttribute('aria-current')).toBe('location');
    expect(links[1].classList.contains('section-nav-link-active')).toBe(false);
  });

  it('smooth-scrolls below the sticky top bar on click', () => {
    render(
      <div>
        <section id="overview" />
        <section id="team" />
        <SectionNav sections={SECTIONS} />
      </div>,
    );
    const team = document.getElementById('team');
    // jsdom applies no stylesheets: the topbar-height token resolves
    // to zero, so only the gap offsets the section.
    vi.spyOn(team as HTMLElement, 'getBoundingClientRect').mockReturnValue({ top: 800 } as DOMRect);
    vi.stubGlobal('scrollY', 50);
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});

    fireEvent.click(screen.getByRole('link', { name: 'Team dynamics' }));
    expect(scrollTo).toHaveBeenCalledWith({ top: 800 + 50 - 0 - 14, behavior: 'smooth' });
  });

  it('runs onNavigate after a link click', () => {
    const onNavigate = vi.fn();
    render(
      <div>
        <section id="overview" />
        <section id="team" />
        <SectionNav sections={SECTIONS} onNavigate={onNavigate} />
      </div>,
    );
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    fireEvent.click(screen.getByRole('link', { name: 'Team dynamics' }));
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it('marks the clicked section active right away', () => {
    render(
      <div>
        <section id="overview" />
        <section id="team" />
        <SectionNav sections={SECTIONS} />
      </div>,
    );
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    fireEvent.click(screen.getByRole('link', { name: 'Team dynamics' }));
    const teamLink = screen.getByRole('link', { name: 'Team dynamics' });
    expect(teamLink.classList.contains('section-nav-link-active')).toBe(true);
    expect(teamLink.getAttribute('aria-current')).toBe('location');
  });

  it('tracks the on-screen section via the intersection observer', () => {
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
    MockIntersectionObserver.instances = [];
    const { container } = render(
      <div>
        <section id="overview" />
        <section id="team" />
        <SectionNav sections={SECTIONS} />
      </div>,
    );
    const instance = MockIntersectionObserver.instances[0];
    expect(instance.observed.map((element) => element.id)).toEqual(['overview', 'team']);

    act(() => {
      instance.callback(
        [
          { isIntersecting: false, target: container.querySelector('#overview') },
          { isIntersecting: true, target: container.querySelector('#team') },
        ] as unknown as IntersectionObserverEntry[],
        instance as unknown as IntersectionObserver,
      );
    });

    const teamLink = screen.getByRole('link', { name: 'Team dynamics' });
    expect(teamLink.classList.contains('section-nav-link-active')).toBe(true);
    expect(
      screen.getByRole('link', { name: 'Overview' }).classList.contains('section-nav-link-active'),
    ).toBe(false);
  });
});

describe('useActiveSection', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('falls back to the first section without IntersectionObserver', () => {
    const { result } = renderHook(() => useActiveSection(['team', 'individuals']));
    expect(result.current.active).toBe('team');
  });

  it('resets to the first section when the active one disappears', () => {
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
    MockIntersectionObserver.instances = [];
    const { result, rerender } = renderHook(({ ids }: { ids: string[] }) => useActiveSection(ids), {
      initialProps: { ids: ['overview', 'team'] },
    });
    act(() => {
      result.current.markActive('team');
    });
    expect(result.current.active).toBe('team');

    rerender({ ids: ['overview'] });
    expect(result.current.active).toBe('overview');
  });
});
