import { describe, expect, it } from 'vitest';

import { createLoopEventDispatcher } from '../../src/loop/events';
import { runTurn } from '../../src/loop/run-turn';
import { ToolAccesses } from '../../src/loop/tool-access';
import { resolvePathAccess } from '../../src/tools/policies/path-access';
import { boundary, call, executionTool, nextTask, provider, response } from './fixtures/native-boundaries';

describe('native loop tool safety and settlement', () => {
  it.each([
    ['unknown tool', { ...call('Bash', 'invalid'), name: 'retired-tool' }],
    ['malformed JSON', { ...call('Bash', 'invalid'), arguments: '{"command":"pwd",}' }],
    ['invalid arguments', { ...call('Bash', 'invalid'), arguments: '{"command":{}}' }],
  ] as const)('settles %s as a paired error without authorization or execution', async (_label, toolCall) => {
    let authorized = false;
    let executed = false;
    const bash = executionTool('Bash', async () => { executed = true; return { output: 'process exited' }; });
    let request = 0;
    const llm = provider(async () => request++ === 0 ? response([toolCall]) : response());
    const { input, records } = boundary(llm, {
      tools: [bash], hooks: { authorizeToolExecution: async () => { authorized = true; return undefined; } },
    });

    expect(await runTurn(input)).toMatchObject({ stopReason: 'end_turn', steps: 2 });
    expect(authorized).toBe(false);
    expect(executed).toBe(false);
    expect(records.filter((event) => event.type === 'tool.call')).toHaveLength(1);
    expect(records.filter((event) => event.type === 'tool.result')).toEqual([
      expect.objectContaining({ toolCallId: 'invalid', parentUuid: 'invalid', result: expect.objectContaining({ isError: true }) }),
    ]);
    expect(records.some((event) => event.type === 'tool.intend')).toBe(false);
  });

  it('revalidates prepared args before resolution and fails closed on authorization exceptions', async () => {
    let resolved = 0;
    let executed = 0;
    const bash = executionTool('Bash', async () => { executed += 1; return { output: 'process exited' }; });
    const resolve = bash.resolveExecution;
    const instrumented = { ...bash, resolveExecution: (args: unknown) => { resolved += 1; return resolve(args); } };
    let request = 0;
    const llm = provider(async () => request++ === 0
      ? response([call('Bash', 'rewrite'), call('Bash', 'authorize')]) : response());
    const { input, records } = boundary(llm, {
      tools: [instrumented], hooks: {
        prepareToolExecution: async (ctx) => ctx.toolCall.id === 'rewrite' ? { updatedArgs: { command: {} } } : undefined,
        authorizeToolExecution: async () => { throw new Error('permission service unavailable'); },
      },
    });

    await runTurn(input);
    expect(resolved).toBe(1);
    expect(executed).toBe(0);
    expect(records.filter((event) => event.type === 'tool.result').map((event) => event.result.isError)).toEqual([true, true]);
    expect(records.some((event) => event.type === 'tool.intend')).toBe(false);
  });

  it.each([
    ['/outside/secret', 'workspace', 'read', 'PATH_OUTSIDE_WORKSPACE'],
    ['/repo/.env', 'workspace', 'read', 'PATH_SENSITIVE'],
    ['/repo/output.txt', 'read-only', 'write', 'PATH_READ_ONLY'],
  ] as const)('preserves native path denial for %s without requesting approval', async (path, guardMode, operation, code) => {
    let authorized = false;
    let executed = false;
    const bash = executionTool('Bash', async () => { executed = true; return { output: 'process exited' }; });
    const protectedTool = {
      ...bash,
      resolveExecution: () => {
        resolvePathAccess(path, '/repo', { workspaceDir: '/repo', additionalDirs: [] }, {
          operation, pathClass: 'posix', policy: { guardMode, checkSensitive: true },
        });
        throw new Error('sandbox must deny the path');
      },
    };
    let request = 0;
    const llm = provider(async () => request++ === 0 ? response([call('Bash', 'sandbox')]) : response());
    const { input, records } = boundary(llm, {
      tools: [protectedTool], hooks: { authorizeToolExecution: async () => { authorized = true; return undefined; } },
    });

    await runTurn(input);
    expect(executed).toBe(false);
    expect(authorized).toBe(false);
    expect(records.filter((event) => event.type === 'tool.result')).toEqual([
      expect.objectContaining({ result: { isError: true, output: expect.stringContaining(`code=${code}`) } }),
    ]);
  });

  it('persists execution intent before side effects and emits ack only after settlement', async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let request = 0;
    const llm = provider(async () => request++ === 0 ? response([call('Bash', 'effect')]) : response());
    const { input, records } = boundary(llm);
    const bash = executionTool('Bash', async () => {
      expect(records.map((event) => event.type)).toEqual(['step.begin', 'tool.call', 'tool.intend']);
      entered.resolve();
      await release.promise;
      return { output: 'process exited' };
    });
    const turn = runTurn({ ...input, tools: [bash] });
    await entered.promise;
    expect(records.some((event) => event.type === 'tool.ack')).toBe(false);
    release.resolve();
    await turn;

    expect(records.map((event) => event.type)).toEqual([
      'step.begin', 'tool.call', 'tool.intend', 'tool.ack', 'tool.result', 'step.end', 'step.begin', 'step.end',
    ]);
    expect(records.find((event) => event.type === 'tool.result')).toMatchObject({ parentUuid: 'effect' });
  });

  it('holds ownership on transcript failure until already-started execution settles', async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const failure = new Error('disk full');
    let executed = 0;
    const bash = executionTool('Bash', async () => {
      executed += 1;
      entered.resolve();
      await release.promise;
      return { output: 'process exited' };
    });
    const llm = provider(async () => response([call('Bash', 'running'), call('Bash', 'unrecorded')]));
    const { input, live } = boundary(llm, { tools: [bash] });
    let settled = false;
    const turn = runTurn({ ...input, dispatchEvent: createLoopEventDispatcher({
      appendTranscriptRecord: async (event) => {
        if (event.type === 'tool.call' && event.toolCallId === 'unrecorded') throw failure;
      },
      emitLiveEvent: (event) => { live.push(event); },
    }) }).finally(() => { settled = true; });
    const rejected = expect(turn).rejects.toBe(failure);
    await entered.promise;
    await nextTask();
    expect(settled).toBe(false);
    expect(executed).toBe(1);
    release.resolve();
    await rejected;
    expect(executed).toBe(1);
    expect(llm.requests).toHaveLength(1);
    expect(live.filter((event) => event.type === 'turn.interrupted')).toHaveLength(1);
  });

  it('drains independent worker results in provider order even when completion is reversed', async () => {
    const firstEntered = Promise.withResolvers<void>();
    const secondEntered = Promise.withResolvers<void>();
    const firstRelease = Promise.withResolvers<void>();
    const secondRelease = Promise.withResolvers<void>();
    const completed: string[] = [];
    const session = executionTool('SessionControl', async (ctx) => {
      (ctx.toolCallId === 'first' ? firstEntered : secondEntered).resolve();
      await (ctx.toolCallId === 'first' ? firstRelease : secondRelease).promise;
      completed.push(ctx.toolCallId);
      return { output: 'worker settled' };
    }, ToolAccesses.none());
    let request = 0;
    const llm = provider(async () => request++ === 0
      ? response([call('SessionControl', 'first'), call('SessionControl', 'second')]) : response());
    const { input, records } = boundary(llm, { tools: [session] });
    const turn = runTurn(input);
    await Promise.all([firstEntered.promise, secondEntered.promise]);
    secondRelease.resolve();
    await nextTask();
    expect(completed).toEqual(['second']);
    expect(records.some((event) => event.type === 'tool.result')).toBe(false);
    firstRelease.resolve();
    await turn;

    expect(completed).toEqual(['second', 'first']);
    expect(records.filter((event) => event.type === 'tool.result').map((event) => event.toolCallId)).toEqual(['first', 'second']);
  });

  it('settles all pairs without leaking raw output when finalization fails, then fails the turn', async () => {
    const failure = new Error('redaction failed');
    const session = executionTool('SessionControl', async () => ({ output: 'credential=private-value' }), ToolAccesses.none());
    const llm = provider(async () => response([call('SessionControl', 'one'), call('SessionControl', 'two')]));
    const { input, records } = boundary(llm, {
      tools: [session], hooks: { finalizeToolResult: async () => { throw failure; } },
    });

    await expect(runTurn(input)).rejects.toBe(failure);
    expect(records.filter((event) => event.type === 'tool.result').map((event) => event.toolCallId)).toEqual(['one', 'two']);
    expect(JSON.stringify(records)).not.toContain('private-value');
    expect(records.some((event) => event.type === 'step.end')).toBe(false);
    expect(llm.requests).toHaveLength(1);
  });

  it('pairs a thrown execution failure and continues without repeating the side effect', async () => {
    let executions = 0;
    const bash = executionTool('Bash', async () => {
      executions += 1;
      throw new Error('process launch failed');
    });
    let request = 0;
    const llm = provider(async () => request++ === 0 ? response([call('Bash', 'failed')]) : response());
    const { input, records } = boundary(llm, { tools: [bash] });

    expect(await runTurn(input)).toMatchObject({ stopReason: 'end_turn', steps: 2 });
    expect(executions).toBe(1);
    expect(records.filter((event) => event.type === 'tool.result')).toEqual([
      expect.objectContaining({ toolCallId: 'failed', result: { isError: true, output: expect.stringContaining('process launch failed') } }),
    ]);
    expect(records.filter((event) => event.type === 'tool.ack')).toHaveLength(1);
  });

  it('settles skipped calls after an explicit lifecycle transition without executing them or continuing the provider', async () => {
    let mutations = 0;
    const session = executionTool('SessionControl', async () => ({ output: 'session closed', stopTurn: true }));
    const transition = {
      ...session,
      resolveExecution: () => ({
        approvalRule: 'SessionControl',
        stopBatchAfterThis: true,
        execute: async () => ({ output: 'session closed', stopTurn: true }),
      }),
    };
    const bash = executionTool('Bash', async () => { mutations += 1; return { output: 'process exited' }; });
    const llm = provider(async () => response([call('SessionControl', 'transition'), call('Bash', 'skipped')]));
    const { input, records } = boundary(llm, { tools: [transition, bash] });

    expect(await runTurn(input)).toMatchObject({ stopReason: 'end_turn', steps: 1 });
    expect(mutations).toBe(0);
    expect(llm.requests).toHaveLength(1);
    const results = records.filter((event) => event.type === 'tool.result');
    expect(results.map((event) => event.toolCallId)).toEqual(['transition', 'skipped']);
    expect(results[0]?.result).toEqual({ output: 'session closed' });
    expect(results[1]?.result).toMatchObject({ isError: true });
    expect(records.filter((event) => event.type === 'tool.intend').map((event) => event.toolCallId)).toEqual(['transition']);
  });
});
