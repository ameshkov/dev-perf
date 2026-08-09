/**
 * Tests for the report loader state machine: parsing, error
 * reporting, reset, and the sample fetch paths.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDemoReport } from '../../test/report-builder.js';
import { useReportLoader } from './report-loader.js';

const reportText = JSON.stringify(buildDemoReport());

describe('useReportLoader', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts idle without an error', () => {
    const { result } = renderHook(() => useReportLoader());
    expect(result.current.state.status).toBe('idle');
    expect(result.current.error).toBeUndefined();
    expect(result.current.loadingSample).toBe(false);
  });

  it('parses valid text into the report document with the file name', () => {
    const { result } = renderHook(() => useReportLoader());
    act(() => result.current.loadText(reportText, 'report.json'));

    const { state } = result.current;
    expect(state.status).toBe('ready');
    if (state.status === 'ready') {
      expect(state.fileName).toBe('report.json');
      expect(state.report.periods).toHaveLength(2);
      expect(state.report.parameters.llmEnabled).toBe(true);
      expect(state.report.parameters.repos).toHaveLength(2);
    }
    expect(result.current.error).toBeUndefined();
  });

  it('keeps the idle state and records the error for invalid text', () => {
    const { result } = renderHook(() => useReportLoader());
    act(() => result.current.loadText('not json', 'bad.json'));
    expect(result.current.state.status).toBe('idle');
    expect(result.current.error).toMatch(/^"bad\.json" is not valid JSON: SyntaxError: /);
  });

  it('returns to idle and clears the error on reset', () => {
    const { result } = renderHook(() => useReportLoader());
    act(() => result.current.loadText(reportText, 'report.json'));
    expect(result.current.state.status).toBe('ready');

    act(() => result.current.reset());
    expect(result.current.state.status).toBe('idle');
    expect(result.current.error).toBeUndefined();
  });

  it('records errors that happened before parsing', () => {
    const { result } = renderHook(() => useReportLoader());
    act(() => result.current.reportError('could not read the file'));
    expect(result.current.error).toBe('could not read the file');
  });

  it('fetches and loads the bundled sample report', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, text: async () => reportText }));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useReportLoader());

    await act(async () => {
      result.current.loadSample();
    });

    expect(fetchMock).toHaveBeenCalledWith('samples/sample-report.json');
    expect(result.current.state.status).toBe('ready');
    if (result.current.state.status === 'ready') {
      expect(result.current.state.fileName).toBe('sample-report.json');
    }
    expect(result.current.loadingSample).toBe(false);
    expect(result.current.error).toBeUndefined();
  });

  it('reports an HTTP error of the sample fetch', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 404, text: async () => '' }));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useReportLoader());

    await act(async () => {
      result.current.loadSample();
    });

    expect(result.current.state.status).toBe('idle');
    expect(result.current.error).toBe('Could not load the sample report (HTTP 404).');
    expect(result.current.loadingSample).toBe(false);
  });

  it('reports a rejection of the sample fetch', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('network down');
    });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useReportLoader());

    await act(async () => {
      result.current.loadSample();
    });

    expect(result.current.state.status).toBe('idle');
    expect(result.current.error).toBe('Could not load the sample report: Error: network down');
  });

  it('tracks the loadingSample flag while the fetch is in flight', async () => {
    let resolveFetch: (value: unknown) => void = () => {};
    const pending = new Promise((resolve) => {
      resolveFetch = resolve;
    });
    const fetchMock = vi.fn(() => pending);
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useReportLoader());

    act(() => {
      result.current.loadSample();
    });
    expect(result.current.loadingSample).toBe(true);

    await act(async () => {
      resolveFetch({ ok: true, status: 200, text: async () => reportText });
    });
    expect(result.current.loadingSample).toBe(false);
    expect(result.current.state.status).toBe('ready');
  });
});
