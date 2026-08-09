/**
 * The report loader state of the app: parses uploaded or sample
 * report text into a trend report document, tracks parse errors, and
 * resets back to the idle state. The dashboard derives the chart data
 * from the document (and its scope filters), so the loader keeps the
 * document itself. Extracted from the root component so the render
 * tree stays small.
 */
import { useCallback, useState } from 'react';
import type { TrendReport } from '../report/index.js';
import { parseReportText } from '../report/index.js';

/** The location of the bundled sample report, served from `public/`. */
const SAMPLE_URL = 'samples/sample-report.json';

/** The state of the loaded report: idle (none) or ready (document). */
type ReportState = { status: 'idle' } | { status: 'ready'; report: TrendReport; fileName: string };

/** The API of the {@link useReportLoader} hook. */
export interface ReportLoader {
  /** The current report state. */
  state: ReportState;
  /** The parsing error of the last failed load, when one failed. */
  error: string | undefined;
  /** Whether the sample report is currently loading. */
  loadingSample: boolean;
  /** Parses raw report text; parse errors go to `error`. */
  loadText: (text: string, fileName: string) => void;
  /** Records an error that happened before parsing. */
  reportError: (message: string) => void;
  /** Fetches and loads the bundled sample report. */
  loadSample: () => void;
  /** Returns to the idle state. */
  reset: () => void;
}

/**
 * The report loading state machine of the app.
 *
 * @returns The loader API.
 */
export function useReportLoader(): ReportLoader {
  const [state, setState] = useState<ReportState>({ status: 'idle' });
  const [error, setError] = useState<string | undefined>(undefined);
  const [loadingSample, setLoadingSample] = useState(false);

  const loadText = useCallback((text: string, fileName: string): void => {
    try {
      const report = parseReportText(text, fileName);
      setState({ status: 'ready', report, fileName });
      setError(undefined);
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : String(parseError));
    }
  }, []);

  const loadSample = useCallback((): void => {
    const load = async (): Promise<void> => {
      setLoadingSample(true);
      try {
        const response = await fetch(SAMPLE_URL);
        if (!response.ok) {
          setError(`Could not load the sample report (HTTP ${response.status}).`);
          return;
        }
        loadText(await response.text(), 'sample-report.json');
      } catch (fetchError) {
        setError(`Could not load the sample report: ${String(fetchError)}`);
      } finally {
        setLoadingSample(false);
      }
    };
    void load();
  }, [loadText]);

  const reset = useCallback((): void => {
    setState({ status: 'idle' });
    setError(undefined);
  }, []);

  return { state, error, loadingSample, loadText, reportError: setError, loadSample, reset };
}
