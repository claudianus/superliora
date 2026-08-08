/**
 * Job completion → Conductor refine: friction in summary + gate outcome scoring.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Agent } from '../../src/agent/index';
import { buildSubagentResultContract } from '../../src/session/subagent/subagent-result-contract';
import { createJob, getJob, patchJob } from '../../src/tools/builtin/job/job-ledger';
import { __resetJobWorkerHandlesForTests } from '../../src/tools/builtin/job/job-handles';
import { launchJobWorker } from '../../src/tools/builtin/job/job-worker';
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

async function until(predicate: () => boolean, attempts = 40, gapMs = 5): Promise<void> {
  for (let i = 0; i < attempts; i += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, gapMs));
  }
  throw new Error('worker completion did not settle in time');
}

afterEach(() => {
  __resetJobWorkerHandlesForTests();
});

describe('Job completion harness feed', () => {
  it('appends friction to the inbox summary and scores parent refine on gateOutcome', async () => {
    const store = memoryStore();
    const recordGateOutcome = vi.fn(async () => {});
    const maybeAutoRefine = vi.fn();
    const ingestWorkerEvents = vi.fn();
    const agent = {
      refine: { recordGateOutcome, maybeAutoRefine },
      skillify: { ingestWorkerEvents },
      log: { warn: vi.fn(), info: vi.fn() },
      emitEvent: vi.fn(),
      kaos: {},
      config: { cwd: '/work', profileName: 'conductor' },
      subagentHost: { spawn: async () => ({}) },
      turn: { hasActiveTurn: true, prompt: () => null },
    } as unknown as Agent;

    const job = createJob(store, {
      title: 'Implement X',
      kind: 'implement',
      successCriteria: ['tests pass'],
      prompt: 'do the thing',
    });
    const running = patchJob(store, job.id, { status: 'running' });
    if (!running) throw new Error('failed to promote job');

    await launchJobWorker({
      store,
      agent,
      job: running,
      spawnOne: (async () => ({
        agentId: 'worker-1',
        profileName: 'coder',
        resumed: false,
        completion: Promise.resolve({
          result: 'shipped',
          friction: {
            turns: 4,
            toolCalls: 12,
            toolErrors: 3,
            topErrorTools: ['Bash×2', 'Edit×1'],
          },
          gateOutcome: 'passed' as const,
          skillifyEvents: [
            {
              toolName: 'Bash',
              success: false,
              retryCount: 0,
              error: 'exit 1',
            },
            {
              toolName: 'Bash',
              success: true,
              retryCount: 2,
              error: 'exit 1',
              outputSummary: 'ok',
            },
          ],
          contract: buildSubagentResultContract({
            agentId: 'worker-1',
            profile: 'coder',
            summary: 'shipped',
            filesChanged: ['a.ts'],
            verification: {
              tests: 'passed',
              typecheck: 'passed',
              lint: 'passed',
              visual: 'not_applicable',
            },
          }),
        }),
      })) as never,
    });

    await until(() => getJob(store, job.id)?.status === 'done');

    const summary = getJob(store, job.id)?.resultSummary ?? '';
    expect(summary).toContain('[friction]');
    expect(summary).toContain('tool_errors: 3');
    expect(recordGateOutcome).toHaveBeenCalledWith('passed');
    expect(maybeAutoRefine).toHaveBeenCalledWith('job');
    expect(ingestWorkerEvents).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ toolName: 'Bash', success: true, retryCount: 2 }),
      ]),
    );
  });
});
