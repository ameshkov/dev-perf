import { describe, expect, it, vi } from 'vitest';
import type { AgentSession, AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import type { ScopedLog } from '../util/log.js';
import { logAgentSessionEvent, subscribeSessionEventLog } from './session-events.js';

/** A capture scoped logger whose `debug` outcomes can be asserted. */
function testLog(): { log: ScopedLog; debug: ReturnType<typeof vi.fn> } {
  const debug = vi.fn();
  return {
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug },
    debug,
  };
}

describe('logAgentSessionEvent', () => {
  it('logs agent_start', () => {
    const { log, debug } = testLog();
    logAgentSessionEvent({ type: 'agent_start' }, 's1', log);
    expect(debug).toHaveBeenCalledWith('LLM: session "s1": agent_start');
  });

  it('logs agent_end with the message count and retry flag', () => {
    const { log, debug } = testLog();
    logAgentSessionEvent(
      {
        type: 'agent_end',
        messages: [{ role: 'user', content: 'hi', timestamp: 0 }],
        willRetry: true,
      },
      's1',
      log,
    );
    expect(debug).toHaveBeenCalledWith(
      'LLM: session "s1": agent_end (1 messages, willRetry: true)',
    );
  });

  it('logs message_start with the role and a preview', () => {
    const { log, debug } = testLog();
    logAgentSessionEvent(
      {
        type: 'message_start',
        message: { role: 'user', content: 'analyze the repo', timestamp: 0 },
      },
      's1',
      log,
    );
    expect(debug).toHaveBeenCalledWith(
      'LLM: session "s1": message_start (role "user"): analyze the repo',
    );
  });

  it('logs message_end with truncated content', () => {
    const { log, debug } = testLog();
    logAgentSessionEvent(
      {
        type: 'message_end',
        // 200 characters: trimmed to the 120-char preview with an ellipsis.
        message: { role: 'user', content: 'a'.repeat(200), timestamp: 0 },
      },
      's1',
      log,
    );
    expect(debug).toHaveBeenCalledWith(
      `LLM: session "s1": message_end (role "user"): ${'a'.repeat(120)}…`,
    );
  });

  it('joins array message content into a single preview line', () => {
    const { log, debug } = testLog();
    logAgentSessionEvent(
      {
        type: 'message_end',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'long reasoning blob' },
            { type: 'text', text: 'hello' },
            { type: 'toolCall', id: 'tc-1', name: 'bash', arguments: {} },
            { type: 'image', data: 'aW1hZ2U=', mimeType: 'image/png' },
          ],
        },
      } as AgentSessionEvent,
      's1',
      log,
    );
    expect(debug).toHaveBeenCalledWith(
      'LLM: session "s1": message_end (role "assistant"): [thinking] hello [tool bash] [image]',
    );
  });

  it('logs compaction_start with the reason', () => {
    const { log, debug } = testLog();
    logAgentSessionEvent({ type: 'compaction_start', reason: 'threshold' }, 's1', log);
    expect(debug).toHaveBeenCalledWith('LLM: session "s1": compaction_start (reason "threshold")');
  });

  it('logs compaction_end with its outcome and an optional error', () => {
    const { log, debug } = testLog();
    logAgentSessionEvent(
      {
        type: 'compaction_end',
        reason: 'overflow',
        result: undefined,
        aborted: false,
        willRetry: true,
      },
      's1',
      log,
    );
    expect(debug).toHaveBeenCalledWith(
      'LLM: session "s1": compaction_end (reason "overflow", aborted: false, willRetry: true)',
    );

    logAgentSessionEvent(
      {
        type: 'compaction_end',
        reason: 'manual',
        result: undefined,
        aborted: true,
        willRetry: false,
        errorMessage: 'summarization failed',
      },
      's1',
      log,
    );
    expect(debug).toHaveBeenCalledWith(
      'LLM: session "s1": compaction_end (reason "manual", aborted: true, willRetry: false, ' +
        'error "summarization failed")',
    );
  });

  it('logs auto_retry_start with attempt counts, delay and the error', () => {
    const { log, debug } = testLog();
    logAgentSessionEvent(
      {
        type: 'auto_retry_start',
        attempt: 1,
        maxAttempts: 3,
        delayMs: 1000,
        errorMessage: 'rate limited',
      },
      's1',
      log,
    );
    expect(debug).toHaveBeenCalledWith(
      'LLM: session "s1": auto_retry_start (attempt 1/3, delayMs 1000): "rate limited"',
    );
  });

  it('logs auto_retry_end with its outcome and an optional final error', () => {
    const { log, debug } = testLog();
    logAgentSessionEvent({ type: 'auto_retry_end', success: true, attempt: 1 }, 's1', log);
    expect(debug).toHaveBeenCalledWith(
      'LLM: session "s1": auto_retry_end (attempt 1, success: true)',
    );

    logAgentSessionEvent(
      { type: 'auto_retry_end', success: false, attempt: 3, finalError: 'provider timeout' },
      's1',
      log,
    );
    expect(debug).toHaveBeenCalledWith(
      'LLM: session "s1": auto_retry_end (attempt 3, success: false, finalError "provider timeout")',
    );
  });

  it('logs tool_execution_start with the truncated arguments', () => {
    const { log, debug } = testLog();
    logAgentSessionEvent(
      {
        type: 'tool_execution_start',
        toolCallId: 'tc-1',
        toolName: 'bash',
        args: { command: 'ls' },
      },
      's1',
      log,
    );
    expect(debug).toHaveBeenCalledWith(
      'LLM: session "s1": tool "bash" start (call "tc-1"): {"command":"ls"}',
    );
  });

  it('logs a long tool argument truncated', () => {
    const { log, debug } = testLog();
    logAgentSessionEvent(
      {
        type: 'tool_execution_start',
        toolCallId: 'tc-1',
        toolName: 'devperf_report',
        args: { content: 'x'.repeat(500) },
      },
      's1',
      log,
    );
    const called = debug.mock.calls[0]?.[0] as string;
    expect(called).toMatch(/^LLM: session "s1": tool "devperf_report" start/);
    expect(called).toContain('…');
    expect(called.length).toBeLessThan(200);
  });

  it('logs tool_execution_update with a truncated partial result', () => {
    const { log, debug } = testLog();
    logAgentSessionEvent(
      {
        type: 'tool_execution_update',
        toolCallId: 'tc-1',
        toolName: 'bash',
        args: {},
        partialResult: 'out',
      },
      's1',
      log,
    );
    expect(debug).toHaveBeenCalledWith('LLM: session "s1": tool "bash" update (call "tc-1"): out');
  });

  it('logs tool_execution_end with the success flag', () => {
    const { log, debug } = testLog();
    logAgentSessionEvent(
      {
        type: 'tool_execution_end',
        toolCallId: 'tc-1',
        toolName: 'bash',
        result: {},
        isError: false,
      },
      's1',
      log,
    );
    expect(debug).toHaveBeenCalledWith(
      'LLM: session "s1": tool "bash" end (call "tc-1", isError: false)',
    );
  });

  it('ignores events outside the logged set', () => {
    const { log, debug } = testLog();
    logAgentSessionEvent(
      {
        type: 'message_update',
        message: { role: 'assistant', content: [] },
      } as unknown as AgentSessionEvent,
      's1',
      log,
    );
    logAgentSessionEvent({ type: 'turn_start' }, 's1', log);
    expect(debug).not.toHaveBeenCalled();
  });
});

describe('subscribeSessionEventLog', () => {
  it('attaches a listener that forwards events to the log and can be removed', () => {
    const listeners = new Set<(event: AgentSessionEvent) => void>();
    const session = {
      subscribe: (listener: (event: AgentSessionEvent) => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    } as unknown as AgentSession;
    const { log, debug } = testLog();

    const unsubscribe = subscribeSessionEventLog(session, 's1', log);
    expect(listeners.size).toBe(1);

    for (const listener of listeners) {
      listener({ type: 'agent_start' });
    }
    expect(debug).toHaveBeenCalledWith('LLM: session "s1": agent_start');

    unsubscribe();
    expect(listeners.size).toBe(0);
  });
});
