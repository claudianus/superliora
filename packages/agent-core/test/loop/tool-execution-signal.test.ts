/**
 * Loop-level contract for the per-call executionSignal (checklist V1-4).
 *
 * The prepare hook can hand the loop an extra abort signal for one tool
 * call; the loop combines it with the turn signal so aborting it force-stops
 * that call only — the turn keeps running and the abort reason stays visible
 * in the tool result. This is the mechanism the conductor wall-clock hard
 * budget uses to stop an overrunning call instead of merely observing it.
 */

import { describe, expect, it } from 'vitest';

import type { LoopHooks } from '../../src/loop';
import { userCancellationReason } from '../../src/utils/abort';
import { makeEndTurnResponse, makeToolCall, makeToolUseResponse } from './fixtures/fake-llm';
import { runTurn } from './fixtures/helpers';
import { SlowTool } from './fixtures/tools';

describe('loop per-call executionSignal (V1-4)', () => {
  it('force-stops one running call without ending the turn', async () => {
    const slow = new SlowTool();
    const controller = new AbortController();
    const hooks: LoopHooks = {
      prepareToolExecution: async () => ({ executionSignal: controller.signal }),
    };
    const turn = runTurn({
      tools: [slow],
      hooks,
      responses: [
        makeToolUseResponse([makeToolCall('slow', {}, 'tc-1')]),
        makeEndTurnResponse('done'),
      ],
    });
    // Let the call start running before force-stopping it.
    await slow.started.promise;
    controller.abort('test force-stop reason');
    const { result, llm, context } = await turn;

    // The call actually executed and was cut short mid-flight.
    expect(slow.calls).toHaveLength(1);
    const toolResults = context.toolResults();
    expect(toolResults).toHaveLength(1);
    const aborted = toolResults[0]?.result;
    expect(aborted?.isError).toBe(true);
    expect(String(aborted?.output)).toContain('test force-stop reason');
    // The turn survived the per-call abort and ran to its scripted end.
    expect(result.stopReason).toBe('end_turn');
    expect(llm.callCount).toBe(2);
  });

  it('lets the host stop the turn right after a force-stopped call', async () => {
    const slow = new SlowTool();
    const controller = new AbortController();
    const hooks: LoopHooks = {
      prepareToolExecution: async () => ({ executionSignal: controller.signal }),
      finalizeToolResult: async (ctx) => ({ ...ctx.result, stopTurn: true }),
    };
    const turn = runTurn({
      tools: [slow],
      hooks,
      responses: [
        makeToolUseResponse([makeToolCall('slow', {}, 'tc-1')]),
        makeEndTurnResponse('never reached'),
      ],
    });
    await slow.started.promise;
    controller.abort('budget exceeded');
    const { result, llm } = await turn;

    // The stopTurn hint from the finalize hook ends the turn immediately;
    // the scripted follow-up response is never consumed.
    expect(result.stopReason).toBe('end_turn');
    expect(llm.callCount).toBe(1);
  });

  it('keeps user cancellations worded as user interruptions', async () => {
    const slow = new SlowTool();
    const controller = new AbortController();
    const hooks: LoopHooks = {
      prepareToolExecution: async () => ({ executionSignal: controller.signal }),
    };
    const turn = runTurn({
      tools: [slow],
      hooks,
      responses: [
        makeToolUseResponse([makeToolCall('slow', {}, 'tc-1')]),
        makeEndTurnResponse('done'),
      ],
    });
    await slow.started.promise;
    controller.abort(userCancellationReason());
    const { context } = await turn;

    const output = String(context.toolResults()[0]?.result.output);
    expect(output).toContain('user manually interrupted');
  });
});
