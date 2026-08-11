/**
 * Tests for the shared scroll helper: it smooth-scrolls an element to
 * just below the sticky top bar and reports whether it found one.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { scrollToId } from './scroll.js';

describe('scrollToId', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('smooth-scrolls to just below the top bar and returns true', () => {
    const target = document.createElement('div');
    target.id = 'target';
    document.body.appendChild(target);
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({ top: 600 } as DOMRect);
    vi.stubGlobal('scrollY', 80);
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});

    expect(scrollToId('target')).toBe(true);
    // jsdom applies no stylesheets: the topbar-height token resolves
    // to zero, so only the gap offsets the target.
    expect(scrollTo).toHaveBeenCalledWith({ top: 600 + 80 - 14, behavior: 'smooth' });
  });

  it('clamps a target above the page to the top', () => {
    const target = document.createElement('div');
    target.id = 'target';
    document.body.appendChild(target);
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({ top: -100 } as DOMRect);
    vi.stubGlobal('scrollY', 0);
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});

    scrollToId('target');

    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
  });

  it('returns false without scrolling when the element does not exist', () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});

    expect(scrollToId('missing')).toBe(false);
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
