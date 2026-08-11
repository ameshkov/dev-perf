/**
 * Smooth-scrolling helper shared by the dashboard navigation: scrolls
 * an element into view just below the sticky top bar. Consumed by the
 * section navigation (sections) and the contribution groups (periods).
 */
/** The gap kept between the top bar and a scrolled-to element. */
const SCROLL_GAP = 14;

/**
 * The height of the sticky top bar, from the design token; zero where
 * stylesheets do not apply (tests).
 *
 * @returns The top bar height in viewport pixels.
 */
function topbarHeight(): number {
  const height = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--topbar-height'),
  );
  return Number.isFinite(height) ? height : 0;
}

/**
 * Smooth-scrolls the page so the element with the given id sits just
 * below the sticky top bar; no-op when the element does not exist.
 *
 * @param id - The id of the element.
 * @returns Whether an element was found and scrolled to.
 */
export function scrollToId(id: string): boolean {
  const target = document.getElementById(id);
  if (target === null) {
    return false;
  }
  const top = target.getBoundingClientRect().top + window.scrollY - topbarHeight() - SCROLL_GAP;
  window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  return true;
}
