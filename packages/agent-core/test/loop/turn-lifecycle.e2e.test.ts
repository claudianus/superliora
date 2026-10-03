import { describe, expect, it } from 'vitest';

import { ErrorCodes } from '../../src/errors';
import { runTurn } from '../../src/loop/run-turn';
import { boundary, call, executionTool, provider, response } from './fixtures/native-boundaries';

describe('native turn transitions', () => {
  it.each([
    ['filtered', 'filtered'], ['truncated', 'max_tokens'], ['paused', 'paused'], ['other', 'unknown'],
  ] as const)('does not execute side effects alongside provider diagnostic %s', async (providerFinishReason, stopReason) => {
    let executed = false;
    const bash = executionTool('Bash', async () => { executed = true; return { output: 'process exited' }; });
    const llm = provider(async () => ({ ...response([call('Bash', 'unsafe')]), providerFinishReason, rawFinishReason: 'provider diagnostic' }));
    const { input, records } = boundary(llm, { tools: [bash] });

    expect(await runTurn(input)).toMatchObject({ stopReason, steps: 1 });
    expect(executed).toBe(false);
    expect(records.filter((event) => event.type === 'step.end')).toEqual([
      expect.objectContaining({ finishReason: stopReason, providerFinishReason, rawFinishReason: 'provider diagnostic' }),
    ]);
    expect(records.some((event) => event.type === 'tool.call')).toBe(false);
    expect(llm.requests).toHaveLength(1);
  });

  it('records spent usage before a host limit blocks side-effecting tool calls', async () => {
    let executed = false;
    const bash = executionTool('Bash', async () => { executed = true; return { output: 'process exited' }; });
    const llm = provider(async () => response([call('Bash', 'limited')], { inputOther: 29, output: 11 }));
    const usageRecords: unknown[] = [];
    const { input, records } = boundary(llm, {
      tools: [bash], recordStepUsage: async (usage) => { usageRecords.push(usage); return { stopTurn: true }; },
    });

    expect(await runTurn(input)).toMatchObject({ stopReason: 'end_turn', usage: { inputOther: 29, output: 11 } });
    expect(usageRecords).toEqual([expect.objectContaining({ inputOther: 29, output: 11 })]);
    expect(executed).toBe(false);
    expect(records.some((event) => event.type === 'tool.call')).toBe(false);
    expect(llm.requests).toHaveLength(1);
  });

  it('enforces explicit max steps after settled tool effects without replaying them', async () => {
    let executed = 0;
    const session = executionTool('SessionControl', async () => { executed += 1; return { output: 'worker settled' }; });
    const llm = provider(async () => response([call('SessionControl', 'worker')]));
    const { input, records, live } = boundary(llm, { tools: [session], maxSteps: 1 });

    await expect(runTurn(input)).rejects.toMatchObject({ code: ErrorCodes.LOOP_MAX_STEPS_EXCEEDED });
    expect(executed).toBe(1);
    expect(llm.requests).toHaveLength(1);
    expect(records.filter((event) => event.type === 'tool.result')).toHaveLength(1);
    expect(records.filter((event) => event.type === 'step.end')).toHaveLength(1);
    expect(live.filter((event) => event.type === 'turn.interrupted')).toEqual([
      expect.objectContaining({ reason: 'max_steps', attemptedSteps: 1 }),
    ]);
  });

  it('consumes real pending input at terminal boundaries without replaying previous steps', async () => {
    let pending = true;
    let consumed = 0;
    const llm = provider(async () => response([], { inputOther: 3, output: 2, inputCacheRead: 5, inputCacheCreation: 7 }));
    const { input, records } = boundary(llm, {
      hooks: { consumePendingInput: () => {
        if (!pending) return false;
        pending = false;
        consumed += 1;
        return true;
      } },
    });

    expect(await runTurn(input)).toMatchObject({
      stopReason: 'end_turn', steps: 2,
      usage: { inputOther: 6, output: 4, inputCacheRead: 10, inputCacheCreation: 14 },
    });
    expect(consumed).toBe(1);
    expect(llm.requests).toHaveLength(2);
    expect(records.filter((event) => event.type === 'step.end').map((event) => event.step)).toEqual([1, 2]);
  });

  it('fails a post-step observer rather than treating its exception as provider success', async () => {
    const failure = new Error('usage observer failed');
    const llm = provider(async () => response());
    const { input, records, live } = boundary(llm, { hooks: { afterStep: async () => { throw failure; } } });

    await expect(runTurn(input)).rejects.toBe(failure);
    expect(records.filter((event) => event.type === 'step.end')).toHaveLength(1);
    expect(live.filter((event) => event.type === 'turn.interrupted')).toEqual([
      expect.objectContaining({ reason: 'error', activeStep: 1 }),
    ]);
    expect(llm.requests).toHaveLength(1);
  });

  it('reports the settled provider route and usage model without substituting the requested alias', async () => {
    const route = { modelAlias: 'operator-model', providerName: 'route-b', providerModel: 'concrete-model' };
    const llm = provider(async () => ({
      ...response([], { inputOther: 7, output: 13 }),
      usageModel: 'billed-model',
      providerRouteSelection: route,
    }));
    const billed: unknown[] = [];
    const { input, records } = boundary(llm, {
      recordStepUsage: async (usage, info) => { billed.push({ usage, info }); },
    });

    await runTurn(input);
    expect(billed).toEqual([{
      usage: expect.objectContaining({ inputOther: 7, output: 13 }),
      info: { model: 'billed-model' },
    }]);
    expect(records.find((event) => event.type === 'step.end')).toMatchObject({ providerRouteSelection: route });
  });
});
