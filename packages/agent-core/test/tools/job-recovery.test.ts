import { describe, expect, it } from 'vitest';

import {
  classifyJobForAutoResume,
  recoverJobsAfterResume,
  SUPERLIORA_CONDUCTOR_AUTO_RESUME_FLEET_ENV,
} from '../../src/tools/builtin/job/job-recovery';
import { listUnreadJobInbox } from '../../src/tools/builtin/job/job-inbox';
import {
  createJob,
  getJob,
  patchJob,
} from '../../src/tools/builtin/job/job-ledger';
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

describe('job fleet recovery', () => {
  it('classifies safe kinds for resume and holds merge/push/needs_user', () => {
    const store = memoryStore();
    const impl = createJob(store, { title: 'impl', kind: 'implement' });
    patchJob(store, impl.id, { status: 'interrupted' });
    const merge = createJob(store, { title: 'land', kind: 'merge' });
    patchJob(store, merge.id, { status: 'interrupted' });
    const ask = createJob(store, { title: 'q', kind: 'task' });
    patchJob(store, ask.id, { status: 'needs_user' });

    expect(classifyJobForAutoResume(getJob(store, impl.id)!)).toBe('resume');
    expect(classifyJobForAutoResume(getJob(store, merge.id)!)).toBe('hold');
    expect(classifyJobForAutoResume(getJob(store, ask.id)!)).toBe('hold');
  });

  it('reconciles stale running and auto-resumes safe interrupted jobs', async () => {
    const prev = process.env[SUPERLIORA_CONDUCTOR_AUTO_RESUME_FLEET_ENV];
    process.env[SUPERLIORA_CONDUCTOR_AUTO_RESUME_FLEET_ENV] = '1';
    try {
      const store = memoryStore();
      const impl = createJob(store, { title: 'impl', kind: 'implement' });
      patchJob(store, impl.id, { status: 'running' });
      const merge = createJob(store, { title: 'land', kind: 'merge' });
      patchJob(store, merge.id, { status: 'running' });

      const result = await recoverJobsAfterResume({ store, autoResume: true });
      expect(result.reconciled.length).toBeGreaterThanOrEqual(2);
      expect(getJob(store, impl.id)?.status).toBe('queued');
      expect(getJob(store, merge.id)?.status).toBe('interrupted');
      expect(result.resumed.some((j) => j.id === impl.id)).toBe(true);
      expect(result.held.some((j) => j.id === merge.id)).toBe(true);

      const inbox = listUnreadJobInbox(store);
      expect(inbox.some((e) => e.kind === 'recovery.auto_resumed')).toBe(true);
      expect(inbox.some((e) => e.kind === 'recovery.held')).toBe(true);
    } finally {
      if (prev === undefined) delete process.env[SUPERLIORA_CONDUCTOR_AUTO_RESUME_FLEET_ENV];
      else process.env[SUPERLIORA_CONDUCTOR_AUTO_RESUME_FLEET_ENV] = prev;
    }
  });

  it('skips autopilot when autoResume is false', async () => {
    const store = memoryStore();
    const impl = createJob(store, { title: 'impl', kind: 'implement' });
    patchJob(store, impl.id, { status: 'running' });

    const result = await recoverJobsAfterResume({ store, autoResume: false });
    expect(getJob(store, impl.id)?.status).toBe('interrupted');
    expect(result.resumed).toHaveLength(0);
    expect(result.autoResumeEnabled).toBe(false);
  });
});
