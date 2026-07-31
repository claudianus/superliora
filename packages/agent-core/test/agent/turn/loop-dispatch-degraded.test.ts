import { describe, expect, it, vi } from 'vitest';

import { createTurnLoopDispatch } from '#/agent/turn/loop-dispatch';
import type { AgentEvent } from '#/rpc/events';
import { StreamingThinkScrubber } from '#/utils/think-scrubber';

describe('loop-dispatch — runtime.degraded on degraded tool results', () => {
  it('emits search-scoped runtime.degraded when tool output marks degraded:true', async () => {
    const emitted: AgentEvent[] = [];
    const appendLoopEvent = vi.fn();
    const dispatch = createTurnLoopDispatch(
      {
        agent: {
          context: { appendLoopEvent },
          emitEvent: (event: AgentEvent) => {
            emitted.push(event);
          },
          records: { flush: vi.fn(async () => undefined) },
          log: { warn: vi.fn() },
          telemetry: { track: vi.fn() },
        } as never,
        turnTelemetry: { trackLoopTelemetry: vi.fn() },
        assistantThinkScrubber: new StreamingThinkScrubber(),
        getActiveTurn: () => null,
      },
      7,
    );

    await dispatch({
      type: 'tool.result',
      toolCallId: 'ws-1',
      result: {
        isError: false,
        output: 'degraded: true\nchannelsTried: ch1 | ch4\nnext: try browser (Ch4)',
      },
    });

    expect(emitted).toContainEqual(
      expect.objectContaining({
        type: 'runtime.degraded',
        scope: 'search',
        reason: 'tool_result_degraded',
        toolCallId: 'ws-1',
      }),
    );
  });
});
