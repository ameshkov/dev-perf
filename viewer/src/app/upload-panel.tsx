/**
 * The upload panel: the drag-and-drop zone and file picker for
 * `reports.json` files, the sample-report shortcut, and the error
 * box for files that do not parse. Client-side only — files are read
 * through the File API.
 */
import { useRef, useState } from 'react';
import type { DragEvent, ReactElement, RefObject } from 'react';

/** The props of the {@link UploadPanel} component. */
export interface UploadPanelProps {
  /** Receives the raw text and name of a parsed report file. */
  onText: (text: string, fileName: string) => void;
  /** Receives a human-readable error that happened before parsing. */
  onError: (message: string) => void;
  /** Loads the bundled sample report. */
  onLoadSample: () => void;
  /** The parsing error of the last file, when one failed. */
  error?: string;
  /** Whether the sample report is currently loading. */
  busy?: boolean;
}

/** The callbacks a file read needs. */
interface ReadCallbacks {
  /** Receives the raw text and name of the file. */
  onText: (text: string, fileName: string) => void;
  /** Receives a human-readable read error. */
  onError: (message: string) => void;
}

/**
 * Reads one report file and hands its text to the parser; read
 * failures are reported through the error callback.
 *
 * @param file - The report file.
 * @param callbacks - The text and error callbacks.
 */
async function readFile(file: File, callbacks: ReadCallbacks): Promise<void> {
  try {
    callbacks.onText(await file.text(), file.name);
  } catch (readError) {
    callbacks.onError(`Could not read "${file.name}": ${String(readError)}`);
  }
}

/**
 * The parse-error box under the dropzone.
 *
 * @param error - The error message.
 * @returns The error element.
 */
function ErrorBox({ error }: { error: string }): ReactElement {
  return (
    <div className="upload-error" role="alert">
      <strong>Could not open the report.</strong>
      <pre className="upload-error-detail">{error}</pre>
    </div>
  );
}

/**
 * The action buttons of the dropzone: the file picker trigger and the
 * sample-report shortcut.
 *
 * @param props - The browse and sample callbacks, and the busy flag.
 * @returns The actions element.
 */
function UploadActions({
  onBrowse,
  onLoadSample,
  busy,
}: {
  onBrowse: () => void;
  onLoadSample: () => void;
  busy: boolean;
}): ReactElement {
  return (
    <div className="upload-actions">
      <button type="button" className="button button-primary" onClick={onBrowse}>
        Browse files
      </button>
      <button type="button" className="button button-ghost" onClick={onLoadSample} disabled={busy}>
        {busy ? 'Loading sample…' : 'Load sample report'}
      </button>
    </div>
  );
}

/**
 * The upload icon of the dropzone.
 *
 * @returns The icon element.
 */
function UploadIcon(): ReactElement {
  return (
    <svg className="upload-icon" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="rgba(109, 139, 255, 0.12)" />
      <path
        d="M16 7.5v11m0-11 4 4m-4-4-4 4"
        stroke="#8fa8ff"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M9 17v4.5A2.5 2.5 0 0 0 11.5 24h9a2.5 2.5 0 0 0 2.5-2.5V17"
        stroke="#46c8f5"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

/**
 * The hidden file input behind the browse button.
 *
 * @param props - The input ref and the read callbacks.
 * @returns The input element.
 */
function HiddenFileInput({
  inputRef,
  callbacks,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  callbacks: ReadCallbacks;
}): ReactElement {
  return (
    <input
      ref={inputRef}
      type="file"
      accept=".json,application/json"
      className="upload-input"
      onChange={(event) => {
        const file = event.target.files?.[0];
        if (file !== undefined) {
          void readFile(file, callbacks);
        }
      }}
    />
  );
}

/**
 * Renders the upload zone of the idle state.
 *
 * @param props - The load callbacks and the last error.
 * @returns The upload panel element.
 */
export function UploadPanel({
  onText,
  onError,
  onLoadSample,
  error,
  busy,
}: UploadPanelProps): ReactElement {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const callbacks: ReadCallbacks = { onText, onError };

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file !== undefined) {
      void readFile(file, callbacks);
    }
  };

  return (
    <div className="upload">
      <div
        className={dragging ? 'upload-dropzone upload-dropzone-dragging' : 'upload-dropzone'}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <UploadIcon />
        <h2 className="upload-title">Drop your report here</h2>
        <p className="upload-hint">
          The JSON report written by <code>dev-perf report</code> (schema v3, or the legacy v1).
          Everything is parsed locally — nothing is uploaded anywhere.
        </p>
        <UploadActions
          onBrowse={() => inputRef.current?.click()}
          onLoadSample={onLoadSample}
          busy={busy === true}
        />
        <HiddenFileInput inputRef={inputRef} callbacks={callbacks} />
      </div>
      {error !== undefined ? <ErrorBox error={error} /> : null}
    </div>
  );
}
