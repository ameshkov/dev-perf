/**
 * Tests for the upload panel: the dropzone, the error box, the browse
 * trigger on the hidden input, the sample shortcut, and file drops.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UploadPanel } from './upload-panel.js';

/**
 * Renders the panel with spy callbacks.
 *
 * @param props - Extra props, e.g. `error` or `busy`.
 * @returns The spy callbacks.
 */
function renderPanel(props: { error?: string; busy?: boolean } = {}) {
  const onText = vi.fn();
  const onError = vi.fn();
  const onLoadSample = vi.fn();
  const rendered = render(
    <UploadPanel onText={onText} onError={onError} onLoadSample={onLoadSample} {...props} />,
  );
  return { onText, onError, onLoadSample, ...rendered };
}

describe('UploadPanel', () => {
  it('renders the dropzone, the hint, and both action buttons', () => {
    renderPanel();
    expect(screen.getByText('Drop your report here')).toBeDefined();
    expect(screen.getByText(/Everything is parsed locally/)).toBeDefined();
    expect(screen.getByRole('button', { name: 'Browse files' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Load sample report' })).toBeDefined();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the error box with the message when an error is set', () => {
    renderPanel({ error: '"bad.json" is not valid JSON' });
    const alert = screen.getByRole('alert');
    expect(alert).toBeDefined();
    expect(alert.textContent).toContain('Could not open the report.');
    expect(screen.getByText('"bad.json" is not valid JSON')).toBeDefined();
  });

  it('triggers the hidden file input when Browse files is clicked', () => {
    const { container } = renderPanel();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeDefined();
    const clickSpy = vi.spyOn(input, 'click');
    fireEvent.click(screen.getByRole('button', { name: 'Browse files' }));
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('calls the sample handler and shows the busy state', () => {
    const { onLoadSample, rerender } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Load sample report' }));
    expect(onLoadSample).toHaveBeenCalledTimes(1);

    rerender(<UploadPanel onText={vi.fn()} onError={vi.fn()} onLoadSample={vi.fn()} busy />);
    const button = screen.getByRole('button', { name: 'Loading sample…' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('reads a dropped file and hands its text to the parse callback', async () => {
    const { container, onText } = renderPanel();
    const zone = container.querySelector('.upload-dropzone') as HTMLDivElement;
    const file = new File(['{"schemaVersion":3}'], 'dropped.json', { type: 'application/json' });

    fireEvent.drop(zone, { dataTransfer: { files: [file] } });

    await waitFor(() => {
      expect(onText).toHaveBeenCalledWith('{"schemaVersion":3}', 'dropped.json');
    });
  });
});
