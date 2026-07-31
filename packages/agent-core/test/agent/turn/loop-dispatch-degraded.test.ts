import { describe, expect, it, vi } from 'vitest';

import { createTurnLoopDispatch } from '#/agent/turn/loop-dispatch';
import type { AgentEvent } from '#/rpc/events';
import {
  NEVER_HALT_SEARCH_429_TOOL_OUTPUT,
  runNeverHaltDegradedLoopDispatchChaos,
} from '#/runtime/never-halt-chaos';
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

  it('uses the never-halt search 429 fixture and keeps the goal tick alive', async () => {
    const result = await runNeverHaltDegradedLoopDispatchChaos(44_000);

    expect(result.goalTickCompleted).toBe(true);
    expect(result.degradedEvents).toContainEqual(
      expect.objectContaining({
        type: 'runtime.degraded',
        scope: 'search',
        reason: 'tool_result_degraded',
      }),
    );
  });

  it('emits search-scoped runtime.degraded for the shared never-halt 429 fixture output', async () => {
    const emitted: AgentEvent[] = [];
    const dispatch = createTurnLoopDispatch(
      {
        agent: {
          context: { appendLoopEvent: vi.fn() },
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
      toolCallId: 'fixture-429',
      result: {
        isError: false,
        output: NEVER_HALT_SEARCH_429_TOOL_OUTPUT,
      },
    });

    expect(emitted).toContainEqual(
      expect.objectContaining({
        type: 'runtime.degraded',
        scope: 'search',
        reason: 'tool_result_degraded',
        toolCallId: 'fixture-429',
      }),
    );
  });
});
