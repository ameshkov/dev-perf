/**
 * The section navigation of the dashboard: anchor links to the
 * dashboard sections that smooth-scroll below the sticky top bar and
 * stay highlighted while their section is on screen.
 */
import { useEffect, useMemo, useState } from 'react';
import type { MouseEvent, ReactElement } from 'react';
import { scrollToId } from '../components/index.js';

/** One navigable dashboard section. */
export interface SectionNavItem {
  /** The id of the section element. */
  id: string;
  /** The link label. */
  label: string;
}

/** The state of the {@link useActiveSection} hook. */
interface ActiveSectionState {
  /** The id of the section currently considered on screen. */
  active: string | undefined;
  /** Marks a section active right away (used on link clicks). */
  markActive: (id: string) => void;
}

/**
 * Tracks which section is on screen: an intersection observer fires
 * when a section enters the band between the sticky bars and 70% of
 * the viewport height. Without `IntersectionObserver` the first
 * section stays active.
 *
 * @param ids - The section ids to watch, in document order.
 * @returns The active section state.
 *
 * @internal Exported for tests only; the dashboard consumes the hook
 * through {@link SectionNav}. Not part of the public module API.
 */
export function useActiveSection(ids: readonly string[]): ActiveSectionState {
  const [active, setActive] = useState<string | undefined>(ids[0]);
  useEffect(() => {
    setActive((previous) => (previous !== undefined && ids.includes(previous) ? previous : ids[0]));
    if (typeof IntersectionObserver === 'undefined') {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActive(entry.target.id);
          }
        }
      },
      { rootMargin: '-20% 0px -70% 0px', threshold: 0 },
    );
    for (const id of ids) {
      const element = document.getElementById(id);
      if (element !== null) {
        observer.observe(element);
      }
    }
    return () => observer.disconnect();
  }, [ids]);
  return { active, markActive: setActive };
}

/** The props of the {@link SectionNav} component. */
export interface SectionNavProps {
  /** The sections, in document order. */
  sections: SectionNavItem[];
  /** Runs after a link navigates; the dashboard closes its panel. */
  onNavigate?: () => void;
}

/**
 * Renders the section links of the dashboard.
 *
 * @param props - The sections to link.
 * @returns The nav element.
 */
export function SectionNav({ sections, onNavigate }: SectionNavProps): ReactElement {
  const ids = useMemo(() => sections.map((section) => section.id), [sections]);
  const { active, markActive } = useActiveSection(ids);
  const handleClick = (event: MouseEvent<HTMLAnchorElement>, id: string): void => {
    event.preventDefault();
    markActive(id);
    scrollToId(id);
    onNavigate?.();
  };
  return (
    <nav className="section-nav" aria-label="Dashboard sections">
      {sections.map((section) => (
        <a
          key={section.id}
          href={`#${section.id}`}
          className={
            section.id === active ? 'section-nav-link section-nav-link-active' : 'section-nav-link'
          }
          aria-current={section.id === active ? 'location' : undefined}
          onClick={(event) => handleClick(event, section.id)}
        >
          {section.label}
        </a>
      ))}
    </nav>
  );
}
