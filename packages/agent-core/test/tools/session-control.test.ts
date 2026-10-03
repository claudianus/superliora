import { execPath } from 'node:process';
import { PassThrough, type Writable } from 'node:stream';

import { LocalKaos, type KaosProcess } from '@superliora/kaos';
import { describe, expect, it, vi } from 'vitest';

import { SessionControlTool, type SessionControlHost, type SessionControlInput } from '../../src/tools/builtin/session-control';
import type { SubagentCompletion } from '../../src/session/subagent/subagent-host';
import { BashTool } from '../../src/tools/builtin/shell/bash';
import { createBackgroundManager } from '../agent/background/helpers';
import { executeTool } from './fixtures/execute-tool';
import { createFakeKaos } from './fixtures/fake-kaos';

function context(args: SessionControlInput, signal = new AbortController().signal) {
  return { args, turnId: 'turn', toolCallId: 'control', signal };
}

const result: SubagentCompletion = {
  status: 'completed', result: 'Child answer', filesChanged: [],
  context: { agentId: 'child', contextTokens: 12 },
};

function childHost(completion: Promise<SubagentCompletion>): SessionControlHost {
  return {
    spawn: vi.fn(async () => ({ agentId: 'child', profileName: 'agent', resumed: false, completion })),
    resume: vi.fn(async () => ({ agentId: 'child', profileName: 'agent', resumed: true, completion })),
    steerChild: vi.fn(() => false),
    listActive: vi.fn(() => []),
    stopAndJoin: vi.fn(async () => false),
    markActiveChildDetached: vi.fn(),
  };
}

function output(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') throw new Error('Expected JSON text');
  return JSON.parse(value) as Record<string, unknown>;
}

describe('SessionControl', () => {
  it('registers child runs and retrieves their completion by session ID', async () => {
    const { agent, manager } = createBackgroundManager();
    const host = childHost(Promise.resolve(result));
    const tool = new SessionControlTool(agent, manager, host);
    const spawned = output((await executeTool(tool, context({ operation: 'spawn', prompt: 'Solve task', description: 'Solve', model: 'chosen', timeout: 120, cwd: '/isolated', ownership: ['src/task.ts'] }))).output);
    expect(spawned).toMatchObject({ agentId: 'child', status: 'running' });
    expect(host.spawn).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'Solve task', modelAlias: 'chosen', timeoutMs: 120_000, profileName: 'agent', runInBackground: true, worktreeDir: '/isolated', ownership: ['src/task.ts'] }));
    const waited = await executeTool(tool, context({ operation: 'wait', id: 'child', timeout: 1 }));
    expect(waited).toMatchObject({ isError: false });
    expect(output(waited.output)).toMatchObject({ status: 'completed', output: { preview: expect.stringContaining('Child answer') } });
    expect(output((await executeTool(tool, context({ operation: 'list' }))).output)['tasks']).toEqual(expect.arrayContaining([expect.objectContaining({ agentId: 'child' })]));
  });

  it('steers a running child and resumes an idle child without respawning it', async () => {
    const { agent, manager } = createBackgroundManager();
    const host = childHost(Promise.resolve(result));
    vi.mocked(host.steerChild).mockReturnValueOnce(true);
    const tool = new SessionControlTool(agent, manager, host);
    const steered = await executeTool(tool, context({ operation: 'message', id: 'child', message: 'Use new input' }));
    expect(output(steered.output)).toEqual({ agentId: 'child', delivered: true });
    expect(host.resume).not.toHaveBeenCalled();
    await executeTool(tool, context({ operation: 'message', id: 'child', message: 'Continue' }));
    expect(host.resume).toHaveBeenCalledWith('child', expect.objectContaining({ prompt: 'Continue' }));
    expect(host.spawn).not.toHaveBeenCalled();
  });

  it('cancels only the waiting caller and keeps a stopped child live until host settlement', async () => {
    const { agent, manager } = createBackgroundManager();
    const completion = Promise.withResolvers<SubagentCompletion>();
    let childSignal: AbortSignal | undefined;
    const host = childHost(completion.promise);
    vi.mocked(host.spawn).mockImplementation(async (options) => {
      childSignal = options.signal;
      return { agentId: 'child', profileName: 'agent', resumed: false, completion: completion.promise };
    });
    const tool = new SessionControlTool(agent, manager, host);
    await executeTool(tool, context({ operation: 'spawn', prompt: 'Work', description: 'Work' }));
    const caller = new AbortController();
    const waiting = executeTool(tool, context({ operation: 'wait', id: 'child', timeout: 60 }, caller.signal));
    caller.abort();
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
    expect(childSignal?.aborted).toBe(false);

    let settled = false;
    const stopping = executeTool(tool, context({ operation: 'stop', id: 'child', reason: 'Operator request' }));
    void stopping.then(() => { settled = true; });
    try {
      await vi.waitFor(() => { expect(childSignal?.aborted).toBe(true); });
      expect(settled).toBe(false);
      expect(output((await executeTool(tool, context({ operation: 'wait', id: 'child', timeout: 0 }))).output)).toMatchObject({ status: 'running' });
      completion.reject(childSignal!.reason);
      const stopped = await stopping;
      expect(output(stopped.output)).toMatchObject({ status: 'killed', stopReason: 'Operator request' });
    } finally {
      completion.reject(childSignal?.reason);
      await stopping;
    }
  });

  it('reports missing hosts honestly and awaits explicit compaction', async () => {
    const { agent, manager } = createBackgroundManager();
    const begin = vi.spyOn(agent.fullCompaction, 'begin').mockImplementation(() => {});
    const waitUntilSettled = vi.spyOn(agent.fullCompaction, 'waitUntilSettled').mockResolvedValue(true);
    const tool = new SessionControlTool(agent, manager);
    expect(await executeTool(tool, context({ operation: 'spawn', prompt: 'Work', description: 'Work' }))).toMatchObject({ isError: true });
    await executeTool(tool, context({ operation: 'compact', instruction: 'Preserve input', summary: 'Input and current task state' }));
    expect(begin).toHaveBeenCalledWith({ source: 'agent', instruction: 'Preserve input', summary: 'Input and current task state' });
    expect(waitUntilSettled).toHaveBeenCalledOnce();
  });

  it('returns live output on a bounded wait without terminating the child', async () => {
    vi.useFakeTimers();
    const completion = Promise.withResolvers<SubagentCompletion>();
    const { agent, manager } = createBackgroundManager();
    const host = childHost(completion.promise);
    const tool = new SessionControlTool(agent, manager, host);
    try {
      await executeTool(tool, context({ operation: 'spawn', prompt: 'Work', description: 'Work' }));
      const waiting = executeTool(tool, context({ operation: 'wait', id: 'child', timeout: 0.1 }));
      await vi.advanceTimersByTimeAsync(100);
      expect(output((await waiting).output)).toMatchObject({ status: 'running' });
      expect(host.stopAndJoin).not.toHaveBeenCalled();
      completion.resolve(result);
      expect(output((await executeTool(tool, context({ operation: 'wait', id: 'child', timeout: 1 }))).output)).toMatchObject({ status: 'completed' });
    } finally {
      completion.resolve(result);
      await manager.wait(manager.list(false)[0]!.taskId);
      vi.useRealTimers();
    }
  });

  it('reports host and child execution failures without inventing completion', async () => {
    const { agent, manager } = createBackgroundManager();
    const completion = Promise.withResolvers<SubagentCompletion>();
    const host = childHost(completion.promise);
    const tool = new SessionControlTool(agent, manager, host);
    vi.mocked(host.spawn).mockRejectedValueOnce(new Error('Spawn failed'));
    await expect(executeTool(tool, context({ operation: 'spawn', prompt: 'Work', description: 'Work' }))).rejects.toThrow('Spawn failed');
    expect(manager.list(false)).toEqual([]);
    await executeTool(tool, context({ operation: 'spawn', prompt: 'Work', description: 'Work' }));
    completion.reject(new Error('Provider failed'));
    const waited = await executeTool(tool, context({ operation: 'wait', id: 'child', timeout: 1 }));
    expect(waited).toMatchObject({ isError: true });
    expect(output(waited.output)).toMatchObject({ status: 'failed', stopReason: 'Provider failed' });
  });

  it('keeps an unmanaged native child pending until stopAndJoin physically releases it', async () => {
    const { agent, manager } = createBackgroundManager();
    const kaos = await LocalKaos.create();
    const proc = await kaos.exec(execPath, '-e', 'process.stdin.resume()');
    const joining = Promise.withResolvers<void>();
    const allowCleanup = Promise.withResolvers<void>();
    const host = childHost(Promise.resolve(result));
    vi.mocked(host.stopAndJoin).mockImplementation(async () => {
      joining.resolve();
      await allowCleanup.promise;
      await proc.kill('SIGTERM');
      await proc.wait();
      await proc.dispose();
      return proc.resourcesSettled === true;
    });
    const tool = new SessionControlTool(agent, manager, host);
    let finished = false;
    const stopping = executeTool(tool, context({ operation: 'stop', id: 'unmanaged', reason: 'Stop' }));
    void stopping.then(() => { finished = true; });
    try {
      await joining.promise;
      expect(finished).toBe(false);
      expect(proc.resourcesSettled).not.toBe(true);
      expect(proc.exitCode).toBeNull();
      expect(proc.stdin.closed).toBe(false);
      expect(manager.list(false)).toEqual([]);
      allowCleanup.resolve();
      const stopped = await stopping;
      expect(stopped.isError).not.toBe(true);
      expect(output(stopped.output)).toEqual({ agentId: 'unmanaged', cancelRequested: true, resourcesSettled: true });
      expect(finished).toBe(true);
      expect(proc.resourcesSettled).toBe(true);
      expect(proc.stdin.closed).toBe(true);
      expect(proc.stdout.closed).toBe(true);
      expect(proc.stderr.closed).toBe(true);
      expect(await proc.wait()).toBeNull();
      expect(host.stopAndJoin).toHaveBeenCalledExactlyOnceWith('unmanaged', 'Stop');
    } finally {
      allowCleanup.resolve();
      await stopping;
    }
  });

  it.each([
    { operation: 'spawn' as const, prompt: 'Work' },
    { operation: 'message' as const, id: 'child' },
    { operation: 'message' as const, message: 'Input' },
    { operation: 'wait' as const },
    { operation: 'stop' as const },
  ])('rejects missing operational arguments before host work: %j', async (args) => {
    const { agent, manager } = createBackgroundManager();
    const host = childHost(Promise.resolve(result));
    const tool = new SessionControlTool(agent, manager, host);
    expect(await executeTool(tool, context(args))).toMatchObject({ isError: true });
    expect(host.spawn).not.toHaveBeenCalled();
    expect(host.resume).not.toHaveBeenCalled();
    expect(host.stopAndJoin).not.toHaveBeenCalled();
  });

  it('rejects unknown task IDs without fabricating output or a stop', async () => {
    const { agent, manager } = createBackgroundManager();
    const tool = new SessionControlTool(agent, manager);
    expect(await executeTool(tool, context({ operation: 'wait', id: 'missing', timeout: 0 }))).toMatchObject({ isError: true });
    expect(await executeTool(tool, context({ operation: 'stop', id: 'missing' }))).toMatchObject({ isError: true });
  });

  it('does not spawn for an already-aborted caller', async () => {
    const { agent, manager } = createBackgroundManager();
    const host = childHost(Promise.resolve(result));
    const tool = new SessionControlTool(agent, manager, host);
    const controller = new AbortController();
    controller.abort();
    await expect(executeTool(tool, context({ operation: 'spawn', prompt: 'Work', description: 'Work' }, controller.signal))).rejects.toMatchObject({ name: 'AbortError' });
    expect(host.spawn).not.toHaveBeenCalled();
  });

  it('lists and polls a Bash process by its returned task ID, then reports its real exit', async () => {
    const { agent, manager } = createBackgroundManager();
    const exited = Promise.withResolvers<number>();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const proc: KaosProcess = {
      stdin: { end: vi.fn(), write: vi.fn() } as unknown as Writable,
      stdout, stderr, pid: 321, exitCode: null,
      wait: vi.fn(() => exited.promise),
      kill: vi.fn(async () => {}),
      dispose: vi.fn(async () => { stdout.destroy(); stderr.destroy(); }),
    };
    const bash = new BashTool(createFakeKaos({ execWithEnv: vi.fn(async () => proc) }), '/workspace', manager);
    const control = new SessionControlTool(agent, manager);
    const launched = await executeTool(bash, { turnId: 'turn', toolCallId: 'bash', signal: new AbortController().signal, args: { command: 'build', run_in_background: true, description: 'Build' } });
    const taskId = /task_id: (bash-[0-9a-z]+)/.exec(String(launched.output))?.[1];
    expect(taskId).toBeDefined();
    try {
      await vi.waitFor(() => { expect(stdout.listenerCount('data')).toBeGreaterThan(0); });
      stdout.write('Build started\n');
      expect(output((await executeTool(control, context({ operation: 'list' }))).output)['tasks']).toEqual([
        expect.objectContaining({ taskId, kind: 'process', status: 'running', command: 'build', exitCode: null }),
      ]);
      const polled = await executeTool(control, context({ operation: 'wait', id: taskId!, timeout: 0 }));
      expect(output(polled.output)).toMatchObject({ status: 'running', output: { preview: expect.stringContaining('Build started') } });
      expect(proc.kill).not.toHaveBeenCalled();
      stderr.end('Build failed\n');
      stdout.end();
      exited.resolve(2);
      const waited = await executeTool(control, context({ operation: 'wait', id: taskId!, timeout: 1 }));
      expect(waited).toMatchObject({ isError: true });
      expect(output(waited.output)).toMatchObject({ status: 'failed', exitCode: 2, output: { preview: expect.stringContaining('Build failed') } });
      expect(proc.dispose).toHaveBeenCalled();
    } finally {
      stdout.end();
      stderr.end();
      exited.resolve(2);
      if (taskId !== undefined) await manager.wait(taskId);
    }
  });

  it('cancels explicit compaction but waits for actual summarization cleanup', async () => {
    const { agent, manager } = createBackgroundManager();
    const settled = Promise.withResolvers<boolean>();
    const begin = vi.spyOn(agent.fullCompaction, 'begin').mockImplementation(() => {});
    const cancel = vi.spyOn(agent.fullCompaction, 'cancel').mockImplementation(() => {});
    vi.spyOn(agent.fullCompaction, 'waitUntilSettled').mockImplementation(() => settled.promise);
    const tool = new SessionControlTool(agent, manager);
    const controller = new AbortController();
    const running = executeTool(tool, context({ operation: 'compact', instruction: 'Preserve state' }, controller.signal));
    const rejected = expect(running).rejects.toMatchObject({ name: 'AbortError' });
    let finished = false;
    void running.catch(() => { finished = true; });
    controller.abort();
    try {
      expect(begin).toHaveBeenCalledOnce();
      expect(cancel).toHaveBeenCalledOnce();
      await Promise.resolve();
      expect(finished).toBe(false);
      settled.resolve(false);
      await rejected;
    } finally {
      settled.resolve(false);
      await rejected;
    }
  });
});

describe('SessionControl independent conductor lane', () => {
  it('rejects independent dispatch without policy while retaining default worker spawning', async () => {
    const { agent, manager } = createBackgroundManager();
    const host = childHost(Promise.resolve(result));
    const tool = new SessionControlTool(agent, manager, host);
    const rejected = await executeTool(tool, context({ operation: 'spawn', lane: 'independent', prompt: 'Task', description: 'Task', cwd: '/isolated', idempotencyKey: 'dispatch' }));
    expect(rejected).toMatchObject({ isError: true, output: expect.stringContaining('explicit conductor') });
    expect(host.spawn).not.toHaveBeenCalled();
    await executeTool(tool, context({ operation: 'spawn', prompt: 'Task', description: 'Task' }));
    expect(host.spawn).toHaveBeenCalledTimes(1);
    await manager.waitForActiveTasks(() => true, { timeoutMs: 1000 });
  });

  it('returns persisted independent acceptance without child admission or parent cancellation linkage', async () => {
    const { SessionCoordinator } = await import('../../src/session/coordinator');
    vi.useFakeTimers();
    const { agent, manager } = createBackgroundManager();
    const host = childHost(Promise.resolve(result));
    const done = Promise.withResolvers<string>();
    let independentSignal: AbortSignal | undefined;
    const saved: unknown[] = [];
    const coordinator = await SessionCoordinator.open({
      store: { load: async () => undefined, save: async (projection) => { saved.push(structuredClone(projection)); }, close: async () => {} },
      policy: { role: 'conductor', maxConcurrent: 1, authorizedRoots: ['/'] },
      runtime: { admit: async (_id, _request, signal) => {
        independentSignal = signal;
        signal.addEventListener('abort', () => done.reject(signal.reason), { once: true });
        return { sessionId: 'independent-session', completion: done.promise, message: async () => {} };
      } },
    });
    try {
      const tool = new SessionControlTool(agent, manager, { ...host, coordination: coordinator });
      const caller = new AbortController();
      const accepted = output((await executeTool(tool, context({ operation: 'spawn', lane: 'independent', prompt: 'Task', description: 'Task', cwd: '/isolated', idempotencyKey: 'dispatch' }, caller.signal))).output);
      expect(accepted).toMatchObject({ status: 'accepted', revision: 1 });
      expect(saved).toHaveLength(1);
      expect(host.spawn).not.toHaveBeenCalled();
      expect(independentSignal).toBeUndefined();
      caller.abort();
      await coordinator.tick();
      for (let index = 0; index < 20; index++) await Promise.resolve();
      expect(independentSignal?.aborted).toBe(false);
      const listed = output((await executeTool(tool, context({ operation: 'list' }))).output);
      expect(listed['independentSessions']).toMatchObject({ records: [expect.objectContaining({ id: accepted['id'], status: 'running' })] });
      const stopped = output((await executeTool(tool, context({ operation: 'stop', id: accepted['id'] as string, expectedRevision: coordinator.get(accepted['id'] as string)!.revision }))).output);
      expect(['cancel_requested', 'cancelled']).toContain(stopped['status']);
    } finally {
      await coordinator.close();
      vi.useRealTimers();
    }
  });
});

describe('conductor legacy task control remains nonblocking', () => {
  it('snapshots without waiting, bounds output/list, and acknowledges a never-settling stop', async () => {
    const { agent, manager } = createBackgroundManager();
    const host = { ...childHost(Promise.resolve(result)), role: 'interactive-conductor' as const };
    const task = { taskId: 'bg_task', agentId: 'legacy-child', kind: 'agent' as const, subagentType: 'agent' as const, description: 'Long work', status: 'running' as const, startedAt: 1, endedAt: null };
    vi.spyOn(manager, 'getTask').mockReturnValue(task);
    vi.spyOn(manager, 'list').mockReturnValue(Array.from({ length: 100 }, (_, index) => ({ ...task, taskId: `bg_${index}` })));
    const wait = vi.spyOn(manager, 'waitForActiveTasks').mockImplementation(() => new Promise(() => {}));
    const snapshot = vi.spyOn(manager, 'getOutputSnapshot').mockResolvedValue({ outputSizeBytes: 0, previewBytes: 0, truncated: false, fullOutputAvailable: false, preview: '' });
    const stop = vi.spyOn(manager, 'stop').mockImplementation(() => new Promise(() => {}));
    const tool = new SessionControlTool(agent, manager, host);
    expect(output((await executeTool(tool, context({ operation: 'wait', id: task.taskId }))).output)['status']).toBe('running');
    expect(wait).not.toHaveBeenCalled();
    expect(snapshot).toHaveBeenCalledWith(task.taskId, 4096);
    expect((await executeTool(tool, context({ operation: 'wait', id: task.taskId, timeout: 1 }))).isError).toBe(true);
    const listed = output((await executeTool(tool, context({ operation: 'list' }))).output);
    expect(listed['taskCount']).toBe(100);
    expect((listed['tasks'] as unknown[])).toHaveLength(32);
    expect(output((await executeTool(tool, context({ operation: 'stop', id: task.taskId }))).output)).toMatchObject({ cancelRequested: true, resourcesSettled: false });
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('never awaits old child spawn/admission in conductor mode and acknowledges known live child stop', async () => {
    const { agent, manager } = createBackgroundManager();
    const host = { ...childHost(Promise.resolve(result)), role: 'interactive-conductor' as const };
    vi.mocked(host.spawn).mockImplementation(() => new Promise(() => {}));
    vi.mocked(host.listActive).mockReturnValue([{ agentId: 'live-child', runInBackground: true }]);
    vi.mocked(host.stopAndJoin).mockImplementation(() => new Promise(() => {}));
    const tool = new SessionControlTool(agent, manager, host);
    const rejected = await executeTool(tool, context({ operation: 'spawn', prompt: 'Task', description: 'Task' }));
    expect(rejected.isError).toBe(true);
    expect(host.spawn).not.toHaveBeenCalled();
    expect(output((await executeTool(tool, context({ operation: 'stop', id: 'live-child' }))).output)).toMatchObject({ cancelRequested: true, resourcesSettled: false });
  });
});
