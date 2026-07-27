import { describe, expect, it } from 'vitest';

import type { FanoutHost } from '../../src/session/spawn-agents';
import type { FanoutSpec, FanoutTask } from '../../src/session/spawn-agents';
import {
  baseRunOptions,
  runOptionsForTask,
  spawnAgents,
  spawnOneAgent,
  spawnOptionsForTask,
} from '../../src/session/spawn-agents';

interface RecordedCall {
  readonly kind: 'spawn' | 'resume';
  readonly agentId?: string;
  readonly options: Record<string, unknown>;
}

function fakeHost(): { calls: RecordedCall[] } & FanoutHost {
  const calls: RecordedCall[] = [];
  let seq = 0;
  return {
    calls,
    spawn: async (options) => {
      seq += 1;
      calls.push({ kind: 'spawn', options: options as unknown as Record<string, unknown> });
      return {
        agentId: `agent-${String(seq)}`,
        profileName: options.profileName,
        resumed: false,
        completion: Promise.resolve('done'),
      } as never;
    },
    resume: async (agentId, options) => {
      calls.push({
        kind: 'resume',
        agentId,
        options: options as unknown as Record<string, unknown>,
      });
      return {
        agentId,
        profileName: 'coder',
        resumed: true,
        completion: Promise.resolve('done'),
      } as never;
    },
  };
}

function makeSpec(tasks: readonly FanoutTask[]): FanoutSpec {
  return {
    mode: 'manual',
    parentToolCallId: 'call-1',
    runInBackground: false,
    signal: new AbortController().signal,
    contractPath: 'src/contract.ts',
    timeoutMs: 60_000,
    tasks,
  };
}

const sampleTask: FanoutTask = {
  prompt: 'Do the work',
  description: 'work',
  profileName: 'coder',
  ownership: ['src/a.ts'],
};

describe('fan-out primitive', () => {
  it('derives shared run options from the spec', () => {
    const base = baseRunOptions(makeSpec([]));
    expect(base).toMatchObject({
      parentToolCallId: 'call-1',
      runInBackground: false,
      contractPath: 'src/contract.ts',
      timeoutMs: 60_000,
    });
    expect(base.signal).toBeInstanceOf(AbortSignal);
  });

  it('maps a task to run and spawn options', () => {
    const spec = makeSpec([sampleTask]);
    expect(runOptionsForTask(spec, sampleTask)).toMatchObject({
      prompt: 'Do the work',
      description: 'work',
      ownership: ['src/a.ts'],
    });
    expect(spawnOptionsForTask(spec, sampleTask)).toMatchObject({ profileName: 'coder' });
  });

  it('routes resume tasks by agent id and spawn tasks by profile', async () => {
    const host = fakeHost();
    const spec = makeSpec([sampleTask, { ...sampleTask, resumeAgentId: 'agent-9' }]);

    const handles = await spawnAgents(host, spec);

    expect(handles).toHaveLength(2);
    expect(host.calls[0]).toMatchObject({ kind: 'spawn' });
    expect(host.calls[1]).toMatchObject({ kind: 'resume', agentId: 'agent-9' });
    expect(handles[1]?.resumed).toBe(true);
  });

  it('spawnOneAgent launches a single task through the same wiring', async () => {
    const host = fakeHost();
    const handle = await spawnOneAgent(host, makeSpec([sampleTask]), sampleTask);
    expect(handle.agentId).toBe('agent-1');
    expect(host.calls).toHaveLength(1);
  });
});
