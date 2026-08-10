import { describe, expect, it } from 'vitest';

import { getJob, listJobs } from '../../src/tools/builtin/job/job-ledger';
import { JobCreateTool } from '../../src/tools/builtin/job/job-tools';
import type { ToolStore } from '../../src/tools/store';

function memoryStore(): ToolStore {
  const data: Record<string, unknown> = {};
  return {
    get(key) {
      return data[key] as never;
    },
    set(key, value) {
      data[key] = value;
    },
  };
}

describe('JobCreate.model_alias', () => {
  it('stores a healthy model_alias on the ledger and ACK', async () => {
    const store = memoryStore();
    const agent = {
      runtimeConfig: {
        providers: {
          'test-provider': { type: 'kimi' as const, apiKey: 'test-key' },
        },
        models: {
          'worker-a': {
            provider: 'test-provider',
            model: 'worker-a',
            maxContextSize: 128_000,
            capabilities: ['tool_use'],
            cost: { input: 1 },
          },
        },
      },
    };
    const tool = new JobCreateTool(store, agent as never);
    const exec = tool.resolveExecution({
      title: 'Explore auth',
      kind: 'explore',
      prompt: 'Find auth entrypoints',
      success_criteria: ['paths listed with line citations'],
      model_alias: 'worker-a',
      staff: false,
    });
    expect(exec.isError).toBeFalsy();
    if (exec.isError) return;
    const result = await exec.execute({
      turnId: 't',
      toolCallId: 'c',
      signal: new AbortController().signal,
    });
    expect(result.isError).toBeFalsy();
    expect(String(result.output)).toContain('model: worker-a');
    const job = listJobs(store)[0]!;
    expect(getJob(store, job.id)?.modelAlias).toBe('worker-a');
  });

  it('rejects unknown model_alias', async () => {
    const store = memoryStore();
    const agent = {
      runtimeConfig: {
        providers: {
          'test-provider': { type: 'kimi' as const, apiKey: 'test-key' },
        },
        models: {
          'worker-a': {
            provider: 'test-provider',
            model: 'worker-a',
            maxContextSize: 128_000,
            capabilities: ['tool_use'],
            cost: { input: 1 },
          },
        },
      },
    };
    const tool = new JobCreateTool(store, agent as never);
    const exec = tool.resolveExecution({
      title: 'Explore auth',
      kind: 'explore',
      prompt: 'Find auth entrypoints',
      success_criteria: ['paths listed'],
      model_alias: 'not-a-real-model',
      staff: false,
    });
    expect(exec.isError).toBeFalsy();
    if (exec.isError) return;
    const result = await exec.execute({
      turnId: 't',
      toolCallId: 'c',
      signal: new AbortController().signal,
    });
    expect(result.isError).toBe(true);
    expect(String(result.output)).toMatch(/unknown or unhealthy|fleet_model_catalog/);
    expect(listJobs(store)).toHaveLength(0);
  });
});
