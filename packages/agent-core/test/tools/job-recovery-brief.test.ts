import { describe, expect, it } from 'vitest';

import { createJob, getJob, patchJob } from '../../src/tools/builtin/job/job-ledger';
import { renderRecoveryBriefAppendix } from '../../src/tools/builtin/job/job-worker';
import type { ToolStore } from '../../src/tools/store';

function memoryStore(): ToolStore {
  const data: Record<string, unknown> = {};
  return {
    get: (key) => data[key] as never,
    set: (key, value) => {
      data[key] = value;
    },
  };
}

describe('recovery brief appendix', () => {
  it('omits appendix for fresh jobs', () => {
    const store = memoryStore();
    const job = createJob(store, { title: 'fresh', kind: 'implement' });
    expect(renderRecoveryBriefAppendix(job)).toBeUndefined();
  });

  it('includes continuity guard after interrupt', () => {
    const store = memoryStore();
    const job = createJob(store, { title: 'impl', kind: 'implement' });
    patchJob(store, job.id, {
      status: 'interrupted',
      notes: 'interrupt: process restarted',
      progress: { phase: 'editing', recentTools: ['Edit', 'Bash'] },
      workerResumeAgentId: 'worker-old',
      workerCheckpointAt: '2026-08-10T00:00:00.000Z',
    });
    const text = renderRecoveryBriefAppendix(getJob(store, job.id)!)!;
    expect(text).toContain('Crash / resume continuity');
    expect(text).toContain('Do not rewrite');
    expect(text).toContain('phase=editing');
    expect(text).toContain('worker-old');
  });
});
