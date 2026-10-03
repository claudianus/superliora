import { describe, expect, it, vi } from 'vitest';

import { collectSubagentProgressStats } from '../../src/session/subagent/subagent-host';
import { Agent } from '../../src/agent';
import { attachToolStreamBridge, startProgressReporter } from '../../src/session/subagent/subagent-telemetry';
import { testKaos } from '../fixtures/test-kaos';

const emptyUsage = { inputOther: 0, output: 0, inputCacheRead: 0, inputCacheCreation: 0 };

function fakeChild(history: unknown[], usage = emptyUsage) {
  return {
    context: { history },
    usage: { data: () => ({ total: usage }) },
  } as never;
}

describe('collectSubagentProgressStats', () => {
  it('counts tool calls and captures the last tool and target', () => {
    const child = fakeChild([
      { role: 'user', toolCalls: [] },
      {
        role: 'assistant',
        toolCalls: [
          { name: 'SessionControl', arguments: JSON.stringify({ operation: 'spawn', description: 'child work' }) },
          { name: 'Bash', arguments: JSON.stringify({ command: 'pnpm test' }) },
        ],
      },
    ]);
    const stats = collectSubagentProgressStats(child);
    expect(stats.toolCount).toBe(2);
    expect(stats.lastTool).toBe('Bash');
    expect(stats.lastTarget).toBe('pnpm test');
  });

  it('sums token usage across all buckets', () => {
    const child = fakeChild([], {
      inputOther: 1,
      output: 2,
      inputCacheRead: 3,
      inputCacheCreation: 4,
    });
    expect(collectSubagentProgressStats(child).tokens).toBe(10);
  });

  it('truncates long targets to 80 chars with an ellipsis', () => {
    const longCommand = 'x'.repeat(120);
    const child = fakeChild([
      {
        role: 'assistant',
        toolCalls: [{ name: 'Bash', arguments: JSON.stringify({ command: longCommand }) }],
      },
    ]);
    expect(collectSubagentProgressStats(child).lastTarget).toBe(`${'x'.repeat(80)}…`);
  });

  it('falls back to the raw argument snippet for invalid JSON', () => {
    const child = fakeChild([
      { role: 'assistant', toolCalls: [{ name: 'Bash', arguments: 'not-json' }] },
    ]);
    expect(collectSubagentProgressStats(child).lastTarget).toBe('not-json');
  });
});

describe('worker emitter ownership', () => {
  it('supports detached emission and restores the exact callback after nested telemetry', async () => {
    const childEvents = vi.fn(async () => {});
    const parentEvents = vi.fn(async () => {});
    const child = new Agent({ kaos: testKaos, rpc: { emitEvent: childEvents } });
    const parent = new Agent({ kaos: testKaos, rpc: { emitEvent: parentEvents } });
    const emit = child.emitEvent;
    const event = { type: 'tool.call.started' as const, toolCallId: 'bash', name: 'Bash', args: { command: 'pwd' } };
    emit(event);
    expect(childEvents).toHaveBeenCalledWith(event);
    const stopProgress = startProgressReporter(parent, child, 'worker', 'agent');
    const progressEmit = child.emitEvent;
    const stopStream = attachToolStreamBridge(parent, child, 'worker', 'agent', {
      parentToolCallId: 'parent-tool', prompt: 'work', description: 'work',
      runInBackground: true, signal: new AbortController().signal,
    });
    try {
      child.emitEvent(event);
      expect(parentEvents).toHaveBeenCalledWith(expect.objectContaining({ type: 'subagent.tool_call', subagentId: 'worker' }));
      stopStream();
      expect(child.emitEvent).toBe(progressEmit);
      await stopProgress();
      expect(child.emitEvent).toBe(emit);
      emit(event);
      expect(childEvents).toHaveBeenCalledTimes(3);
    } finally {
      stopStream();
      await stopProgress();
      await Promise.all([child.records.close(), parent.records.close()]);
    }
  });
});
