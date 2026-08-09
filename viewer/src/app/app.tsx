/**
 * The root component of the viewer: the top bar, the hero, and the
 * body switching between the idle state (the upload panel) and the
 * loaded state (the dashboard). The dashboard's navigation panel is
 * hidden by default and opens from a top bar button. Parsing errors
 * stay on screen until the next attempt.
 */
import { useState } from 'react';
import type { ReactElement } from 'react';
import { Dashboard } from './dashboard.js';
import { Hero } from './hero.js';
import type { ReportLoader } from './report-loader.js';
import { useReportLoader } from './report-loader.js';
import { UploadPanel } from './upload-panel.js';

/** The brand mark of the top bar. */
function LogoMark(): ReactElement {
  return (
    <svg className="topbar-logo" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="rgba(109, 139, 255, 0.14)" />
      <rect x="6" y="17" width="4.5" height="9" rx="1.5" fill="#6d8bff" />
      <rect x="13.75" y="12" width="4.5" height="14" rx="1.5" fill="#46c8f5" />
      <rect x="21.5" y="6" width="4.5" height="20" rx="1.5" fill="#2dd4bf" />
    </svg>
  );
}

/** The props of the {@link TopBar} component. */
interface TopBarProps {
  /** The report loader state. */
  loader: ReportLoader;
  /** Whether the navigation panel is open. */
  navOpen: boolean;
  /** Toggles the navigation panel. */
  onToggleNav: () => void;
  /** Returns to the idle state, closing the navigation panel. */
  onReset: () => void;
}

/**
 * The top bar of the app: the brand and, once a report is loaded, the
 * button that opens the navigation panel and the button that returns
 * to the idle state.
 *
 * @param props - The loader state and the navigation panel controls.
 * @returns The top bar element.
 */
function TopBar({ loader, navOpen, onToggleNav, onReset }: TopBarProps): ReactElement {
  const navClass = `button button-ghost button-small${navOpen ? ' topbar-nav-open' : ''}`;
  return (
    <header className="topbar">
      <div className="topbar-brand">
        <LogoMark />
        <span className="topbar-name">
          dev-perf <span className="topbar-name-accent">viewer</span>
        </span>
      </div>
      {loader.state.status === 'ready' ? (
        <div className="topbar-actions">
          <button
            type="button"
            className={navClass}
            aria-expanded={navOpen}
            aria-controls="control-bar"
            aria-haspopup="true"
            onClick={onToggleNav}
          >
            Navigation
          </button>
          <button type="button" className="button button-ghost button-small" onClick={onReset}>
            Load another report
          </button>
        </div>
      ) : null}
    </header>
  );
}

/** The props of the {@link Body} component. */
interface BodyProps {
  /** The report loader state. */
  loader: ReportLoader;
  /** Whether the navigation panel is open. */
  navOpen: boolean;
  /** Closes the navigation panel. */
  onNavClose: () => void;
}

/**
 * The main body: the hero plus either the upload panel or the
 * dashboard.
 *
 * @param props - The loader state and the navigation panel controls.
 * @returns The body element.
 */
function Body({ loader, navOpen, onNavClose }: BodyProps): ReactElement {
  const { state } = loader;
  return (
    <main className="content">
      <Hero loaded={state.status === 'ready'} />
      {state.status === 'idle' ? (
        <UploadPanel
          onText={loader.loadText}
          onError={loader.reportError}
          onLoadSample={loader.loadSample}
          error={loader.error}
          busy={loader.loadingSample}
        />
      ) : (
        <Dashboard
          report={state.report}
          fileName={state.fileName}
          navOpen={navOpen}
          onNavClose={onNavClose}
        />
      )}
    </main>
  );
}

/**
 * The root component of the viewer web app.
 *
 * @returns The app element.
 */
export function App(): ReactElement {
  const loader = useReportLoader();
  const [navOpen, setNavOpen] = useState(false);
  const toggleNav = (): void => {
    setNavOpen((open) => !open);
  };
  const closeNav = (): void => {
    setNavOpen(false);
  };
  const reset = (): void => {
    setNavOpen(false);
    loader.reset();
  };
  return (
    <div className="app">
      <TopBar loader={loader} navOpen={navOpen} onToggleNav={toggleNav} onReset={reset} />
      <Body loader={loader} navOpen={navOpen} onNavClose={closeNav} />
      <footer className="footer">
        dev-perf viewer · a client-side report explorer · your report never leaves this page
      </footer>
    </div>
  );
}
