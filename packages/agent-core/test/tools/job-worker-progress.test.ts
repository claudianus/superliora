import { describe, expect, it, vi } from 'vitest';
import type { Agent } from '../../src/agent';
import { createJob, getJob, patchJob } from '../../src/tools/builtin/job/job-ledger';
import { bindJobWorkerLedger, reportJobWorkerProgress, unbindJobWorkerLedger } from '../../src/tools/builtin/job/job-worker-ledger-bridge';
import type { ToolStore } from '../../src/tools/store';

describe('Job worker streaming', () => {
  it('persists observed activity and emits it without enforcing a tool-count strategy', () => {
    const data = new Map<string, unknown>();
    const store = { get: (key: string) => data.get(key), set: (key: string, value: unknown) => data.set(key, value) } as ToolStore;
    const created = createJob(store, { title: 'Explore at own pace', verificationCommands: ['operator-check'] });
    patchJob(store, created.id, { status: 'running' });
    const emit = vi.fn();
    const agent = { emitAgentEvent: emit } as unknown as Agent;
    bindJobWorkerLedger('progress_worker', store, created.id, agent);
    reportJobWorkerProgress('progress_worker', { phase: 'Bash: inspect', recentTools: ['Bash'], stepsCompleted: 1000, lastHeartbeatAt: new Date().toISOString() });
    expect(getJob(store, created.id)).toMatchObject({ status: 'running', progress: { stepsCompleted: 1000 } });
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'job.updated', change: { reason: 'progress' } }));
    unbindJobWorkerLedger('progress_worker');
  });
});
