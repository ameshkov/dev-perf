/**
 * The hero block: what this page is about — a client-side viewer for
 * dev-perf JSON reports, with the headline, the explainer paragraph,
 * and the feature pills. Always visible above the upload zone or the
 * loaded dashboard.
 */
import type { ReactElement } from 'react';

/** The props of the {@link Hero} component. */
export interface HeroProps {
  /** Whether a report is loaded; the call-to-action hint adapts. */
  loaded: boolean;
}

/** The feature pills of the hero. */
const FEATURES = [
  'Team dynamics',
  'LLM-assessed insights',
  'Individual reports',
  'Runs entirely in your browser',
];

/**
 * Renders the hero block.
 *
 * @param props - Whether a report is loaded.
 * @returns The hero element.
 */
export function Hero({ loaded }: HeroProps): ReactElement {
  return (
    <section className="hero">
      <span className="hero-overline">dev-perf report viewer</span>
      <h1 className="hero-title">
        See what your team&apos;s git history <span className="hero-gradient">really built</span>.
      </h1>
      <p className="hero-lead">
        Upload a <code>reports.json</code> produced by the{' '}
        <a href="https://github.com/ameshkov/dev-perf" target="_blank" rel="noopener noreferrer">
          <strong>dev-perf</strong>
        </a>{' '}
        CLI and explore it here: deterministic metrics straight from git history — commits, lines,
        files, languages — layered with the LLM&apos;s assessment of what cannot be counted: work
        types, complexity, impact, and quality and risk signals. Team first, then one report per
        person. The file never leaves your browser.
      </p>
      <ul className="hero-features">
        {FEATURES.map((feature) => (
          <li key={feature} className="hero-feature">
            {feature}
          </li>
        ))}
      </ul>
      {!loaded ? <p className="hero-hint">Drop a report below, or try the sample report.</p> : null}
    </section>
  );
}
