import { describe, expect, it } from 'vitest';

import { runTurn } from '../../src/loop/run-turn';
import { ToolAccesses } from '../../src/loop/tool-access';
import type { ExecutableToolContext } from '../../src/loop/types';
import { userCancellationReason } from '../../src/utils/abort';
import { boundary, call, executionTool, nextTask, provider, response } from './fixtures/native-boundaries';

describe('native loop cancellation ownership', () => {
  it('does not contact the provider after a pre-entry user cancellation', async () => {
    const controller = new AbortController();
    controller.abort(userCancellationReason());
    const llm = provider(async () => { throw new Error('provider must not start'); });
    const { input, records, live } = boundary(llm, { signal: controller.signal });

    expect(await runTurn(input)).toMatchObject({ stopReason: 'aborted', steps: 0 });
    expect(llm.requests).toHaveLength(0);
    expect(records).toEqual([]);
    expect(live).toEqual([expect.objectContaining({
      type: 'turn.interrupted', reason: 'aborted', cancelledByUser: true,
    })]);
  });

  it('waits for an abort-ignoring provider to settle without inventing completion', async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const controller = new AbortController();
    const llm = provider(async () => {
      entered.resolve();
      await release.promise;
      return response([], { inputOther: 11, output: 7 });
    });
    const { input, records, live } = boundary(llm, { signal: controller.signal });
    let settled = false;
    const turn = runTurn(input).finally(() => { settled = true; });
    await entered.promise;
    controller.abort(userCancellationReason());
    await nextTask();
    expect(settled).toBe(false);
    expect(live.some((event) => event.type === 'turn.interrupted')).toBe(false);
    release.resolve();

    expect(await turn).toMatchObject({
      stopReason: 'aborted', usage: { inputOther: 11, output: 7 },
    });
    expect(records.some((event) => event.type === 'step.end')).toBe(false);
    expect(llm.requests).toHaveLength(1);
  });

  it('keeps conflicting resource ownership until actual tool settlement and drains queued results', async () => {
    const entered = Promise.withResolvers<ExecutableToolContext>();
    const release = Promise.withResolvers<void>();
    const controller = new AbortController();
    const started: string[] = [];
    const bash = executionTool('Bash', async (ctx) => {
      started.push(ctx.toolCallId);
      entered.resolve(ctx);
      await release.promise;
      return { output: 'process exited' };
    });
    const llm = provider(async () => response([
      call('Bash', 'running'), call('Bash', 'queued'),
    ], { inputOther: 13, output: 5 }));
    const { input, records, live } = boundary(llm, { tools: [bash], signal: controller.signal });
    let settled = false;
    const turn = runTurn(input).finally(() => { settled = true; });
    const ctx = await entered.promise;
    await nextTask();
    controller.abort(userCancellationReason());
    ctx.onUpdate?.({ kind: 'stdout', text: 'late output' });
    await nextTask();
    expect(settled).toBe(false);
    expect(started).toEqual(['running']);
    expect(records.some((event) => event.type === 'tool.ack')).toBe(false);
    expect(live.some((event) => event.type === 'tool.progress')).toBe(false);
    release.resolve();

    expect(await turn).toMatchObject({ stopReason: 'aborted', usage: { output: 5 } });
    expect(started).toEqual(['running']);
    const results = records.filter((event) => event.type === 'tool.result');
    expect(results.map((event) => event.toolCallId)).toEqual(['running', 'queued']);
    expect(results[0]?.result).toEqual({ output: 'process exited' });
    expect(results[1]?.result).toMatchObject({ isError: true });
    expect(records.filter((event) => event.type === 'tool.ack').map((event) => event.toolCallId))
      .toEqual(['running', 'queued']);
    expect(records.some((event) => event.type === 'step.end')).toBe(false);
    expect(live.filter((event) => event.type === 'turn.interrupted')).toHaveLength(1);
    expect(llm.requests).toHaveLength(1);
  });

  it('awaits pending approval settlement after cancellation without executing the approved call', async () => {
    const entered = Promise.withResolvers<void>();
    const approval = Promise.withResolvers<void>();
    const controller = new AbortController();
    let executed = false;
    const bash = executionTool('Bash', async () => {
      executed = true;
      return { output: 'must not run' };
    });
    const llm = provider(async () => response([call('Bash', 'approval')]));
    const { input, records } = boundary(llm, {
      tools: [bash], signal: controller.signal,
      hooks: { authorizeToolExecution: async () => {
        entered.resolve();
        await approval.promise;
        return undefined;
      } },
    });
    let settled = false;
    const turn = runTurn(input).finally(() => { settled = true; });
    await entered.promise;
    controller.abort(userCancellationReason());
    await nextTask();
    expect(settled).toBe(false);
    approval.resolve();

    expect(await turn).toMatchObject({ stopReason: 'aborted' });
    expect(executed).toBe(false);
    expect(records.filter((event) => event.type === 'tool.result')).toEqual([
      expect.objectContaining({ toolCallId: 'approval', result: expect.objectContaining({ isError: true }) }),
    ]);
    expect(records.some((event) => event.type === 'tool.intend')).toBe(false);
  });

  it('force-stops one worker while its independent sibling and provider continuation stay owned', async () => {
    const workerEntered = Promise.withResolvers<void>();
    const siblingEntered = Promise.withResolvers<void>();
    const siblingRelease = Promise.withResolvers<void>();
    const worker = new AbortController();
    const bash = executionTool('Bash', async (ctx) => {
      const stopped = Promise.withResolvers<never>();
      ctx.signal.addEventListener('abort', () => stopped.reject(ctx.signal.reason), { once: true });
      workerEntered.resolve();
      return stopped.promise;
    }, ToolAccesses.none());
    const session = executionTool('SessionControl', async () => {
      siblingEntered.resolve();
      await siblingRelease.promise;
      return { output: 'worker settled' };
    }, ToolAccesses.none());
    let request = 0;
    const llm = provider(async () => request++ === 0
      ? response([call('Bash', 'stopped'), call('SessionControl', 'sibling')])
      : response());
    const { input, records } = boundary(llm, {
      tools: [bash, session],
      hooks: { authorizeToolExecution: async (ctx) => ctx.toolCall.id === 'stopped'
        ? { executionSignal: worker.signal } : undefined },
    });
    let settled = false;
    const turn = runTurn(input).finally(() => { settled = true; });
    await Promise.all([workerEntered.promise, siblingEntered.promise]);
    worker.abort();
    await nextTask();
    expect(settled).toBe(false);
    expect(llm.requests).toHaveLength(1);
    siblingRelease.resolve();

    expect(await turn).toMatchObject({ stopReason: 'end_turn', steps: 2 });
    expect(records.filter((event) => event.type === 'tool.result')).toEqual([
      expect.objectContaining({ toolCallId: 'stopped', result: expect.objectContaining({ isError: true }) }),
      expect.objectContaining({ toolCallId: 'sibling', result: { output: 'worker settled' } }),
    ]);
    expect(llm.requests).toHaveLength(2);
  });
});
