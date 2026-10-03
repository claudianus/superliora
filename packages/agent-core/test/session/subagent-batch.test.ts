import { APIProviderRateLimitError } from '@superliora/kosong';
import { describe, expect, it, vi } from 'vitest';

import { SubagentBatch, type QueuedSubagentTask } from '../../src/session/subagent/subagent-batch';
import type { SubagentCompletion, SubagentHandle } from '../../src/session/subagent/subagent-host';

function task(index: number): QueuedSubagentTask<number> {
  return {
    kind: 'spawn', data: index, parentToolCallId: 'shared-run', prompt: `Task ${index}`,
    description: String(index), runInBackground: true,
  };
}

function completion(index: number): SubagentCompletion {
  return { status: 'completed', result: `result-${index}`, filesChanged: [], context: { agentId: `child-${index}`, contextTokens: 0 } };
}

function handle(index: number, result: Promise<SubagentCompletion>, resumed = false): SubagentHandle {
  return { agentId: `child-${index}`, profileName: 'agent', resumed, completion: result };
}

describe('explicit worker batch launching', () => {
  it('preserves input order and selected concurrency without launch coaching or delays', async () => {
    const gates = Array.from({ length: 3 }, () => Promise.withResolvers<SubagentCompletion>());
    const started: number[] = [];
    const launcher = {
      spawn: vi.fn(async (options: { description: string }) => {
        const index = Number(options.description);
        started.push(index);
        return handle(index, gates[index]!.promise);
      }),
      resume: vi.fn(),
    };
    const running = new SubagentBatch(launcher, [task(0), task(1), task(2)], { maxConcurrency: 2 }).run();
    expect(started).toEqual([0, 1]);
    gates[1]!.resolve(completion(1));
    await vi.waitFor(() => expect(started).toEqual([0, 1, 2]));
    gates[2]!.resolve(completion(2));
    gates[0]!.resolve(completion(0));
    expect((await running).map((result) => result.result)).toEqual(['result-0', 'result-1', 'result-2']);
  });

  it('records a provider failure once rather than replaying a worker that produced effects', async () => {
    const effects: string[] = [];
    const launcher = {
      spawn: vi.fn(async () => {
        effects.push('file changed');
        return handle(0, Promise.reject(new APIProviderRateLimitError('provider rate limit', 'req-1')));
      }),
      resume: vi.fn(),
    };
    const batch = new SubagentBatch(launcher, [task(0)]);
    const results = await batch.run();
    expect(results[0]).toMatchObject({ status: 'failed', state: 'started', error: 'provider rate limit' });
    expect(effects).toEqual(['file changed']);
    expect(launcher.spawn).toHaveBeenCalledTimes(1);
    expect(launcher.resume).not.toHaveBeenCalled();
    await expect(batch.run()).rejects.toThrow('can only be called once');
    expect(effects).toEqual(['file changed']);
  });

  it('waits for actual cancelled execution settlement without cancelling its sibling', async () => {
    const a = Promise.withResolvers<SubagentCompletion>();
    const b = Promise.withResolvers<SubagentCompletion>();
    const first = new AbortController();
    const second = new AbortController();
    const launcher = {
      spawn: vi.fn(async (options: { description: string }) => handle(Number(options.description), options.description === '0' ? a.promise : b.promise)),
      resume: vi.fn(),
    };
    let settled = false;
    const running = new SubagentBatch(launcher, [
      { ...task(0), signal: first.signal }, { ...task(1), signal: second.signal },
    ]).run();
    void running.then(() => { settled = true; });
    const reason = new Error('operator stop');
    first.abort(reason);
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(second.signal.aborted).toBe(false);
    a.reject(reason);
    b.resolve(completion(1));
    expect((await running).map((result) => result.status)).toEqual(['aborted', 'completed']);
  });

  it('skips an already-cancelled task while launching an independent sibling', async () => {
    const cancelled = new AbortController();
    cancelled.abort(new Error('operator stop'));
    const launcher = { spawn: vi.fn(async () => handle(1, Promise.resolve(completion(1)))), resume: vi.fn() };
    const results = await new SubagentBatch(launcher, [{ ...task(0), signal: cancelled.signal }, task(1)]).run();
    expect(results[0]).toMatchObject({ status: 'aborted', state: 'not_started' });
    expect(results[1]).toMatchObject({ status: 'completed', agentId: 'child-1' });
    expect(launcher.spawn).toHaveBeenCalledTimes(1);
  });

  it('resumes only when explicitly requested and forwards selected execution boundaries', async () => {
    const controller = new AbortController();
    const launcher = {
      spawn: vi.fn(),
      resume: vi.fn(async () => handle(0, Promise.resolve(completion(0)), true)),
    };
    const selected: QueuedSubagentTask<number> = {
      ...task(0), kind: 'resume', resumeAgentId: 'child-0', signal: controller.signal,
      timeout: 9000, worktreeDir: '/isolated', ownership: ['src/a.ts'], modelAlias: 'selected-model', permissionMode: 'manual',
    };
    const results = await new SubagentBatch(launcher, [selected]).run();
    expect(launcher.resume).toHaveBeenCalledWith('child-0', expect.objectContaining({
      signal: controller.signal, timeoutMs: 9000, worktreeDir: '/isolated', ownership: ['src/a.ts'], modelAlias: 'selected-model', permissionMode: 'manual',
    }));
    expect(launcher.spawn).not.toHaveBeenCalled();
    expect(results[0]?.result).toBe('result-0');
  });
});
