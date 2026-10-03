import { describe, expect, it } from 'vitest';

import type { FanoutHost, FanoutSpec, FanoutTask } from '#/fleet';
import { spawnAgents } from '#/fleet';

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
        profileName: 'agent',
        resumed: false,
        completion: Promise.resolve({
          status: 'completed' as const, result: 'done', filesChanged: [],
          context: { agentId: `agent-${String(seq)}`, contextTokens: 0 },
        }),
      };
    },
    resume: async (agentId, options) => {
      calls.push({
        kind: 'resume',
        agentId,
        options: options as unknown as Record<string, unknown>,
      });
      return {
        agentId,
        profileName: 'agent',
        resumed: true,
        completion: Promise.resolve({
          status: 'completed' as const, result: 'done', filesChanged: [],
          context: { agentId, contextTokens: 0 },
        }),
      };
    },
  };
}

function makeSpec(tasks: readonly FanoutTask[]): FanoutSpec {
  return {
    parentToolCallId: 'call-1',
    runInBackground: false,
    signal: new AbortController().signal,
    timeoutMs: 60_000,
    tasks,
  };
}

const sampleTask: FanoutTask = {
  prompt: 'Do the work',
  description: 'work',
  profileName: 'agent',
  ownership: ['src/a.ts'],
};

describe('fan-out primitive', () => {


  it('routes resume tasks by agent id and launches new workers otherwise', async () => {
    const host = fakeHost();
    const spec = makeSpec([sampleTask, { ...sampleTask, resumeAgentId: 'agent-9' }]);

    const handles = await spawnAgents(host, spec);

    expect(handles).toHaveLength(2);
    expect(host.calls[0]).toMatchObject({ kind: 'spawn' });
    expect(host.calls[1]).toMatchObject({ kind: 'resume', agentId: 'agent-9' });
    expect(handles[1]?.resumed).toBe(true);
  });

});
