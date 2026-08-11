import { afterEach, describe, expect, it } from 'vitest';

import {
  classifyJobForAutoResume,
  recoverJobsAfterResume,
  SUPERLIORA_CONDUCTOR_AUTO_RESUME_FLEET_ENV,
} from '../../src/tools/builtin/job/job-recovery';
import { listUnreadJobInbox } from '../../src/tools/builtin/job/job-inbox';
import { __resetJobWorkerHandlesForTests } from '../../src/tools/builtin/job/job-handles';
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

afterEach(() => {
  __resetJobWorkerHandlesForTests();
});

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

  it('with agent, auto-resume promotes and spawns (not stuck queued)', async () => {
    const prev = process.env[SUPERLIORA_CONDUCTOR_AUTO_RESUME_FLEET_ENV];
    process.env[SUPERLIORA_CONDUCTOR_AUTO_RESUME_FLEET_ENV] = '1';
    try {
      const store = memoryStore();
      const impl = createJob(store, { title: 'impl', kind: 'implement' });
      // Existing worktree → schedule skips git I/O (sync promote path that
      // used to race settle() ahead of the pump and leave jobs queued).
      patchJob(store, impl.id, {
        status: 'running',
        worktreePath: `/tmp/recovery/${impl.id}`,
      });

      const host = {
        spawn: async (options: { profileName?: string }) =>
          ({
            agentId: 'agent_recovery',
            profileName: options.profileName ?? 'coder',
            resumed: false,
            completion: new Promise<never>(() => {}),
          }) as never,
      };
      const agent = {
        subagentHost: host,
        config: { cwd: '/tmp/recovery' },
        kaos: undefined,
      } as never;

      const result = await recoverJobsAfterResume({ store, agent, autoResume: true });
      expect(result.resumed.some((j) => j.id === impl.id)).toBe(true);
      expect(getJob(store, impl.id)?.status).toBe('running');
      expect(getJob(store, impl.id)?.workerAgentId).toBe('agent_recovery');
    } finally {
      if (prev === undefined) delete process.env[SUPERLIORA_CONDUCTOR_AUTO_RESUME_FLEET_ENV];
      else process.env[SUPERLIORA_CONDUCTOR_AUTO_RESUME_FLEET_ENV] = prev;
    }
  });

  it('heals unstamped verifyVerdict from summary JSON on resume', async () => {
    const store = memoryStore();
    const verify = createJob(store, { title: 'Verify heal', kind: 'verify' });
    patchJob(store, verify.id, {
      status: 'failed',
      notes: 'worker: verify finished without structured verifyVerdict',
      resultSummary:
        'structured verifyVerdict missing — {"verdict":"pass","standards":{"verdict":"pass","findings":[]},"spec":{"verdict":"pass","findings":[]}}',
    });

    await recoverJobsAfterResume({ store, autoResume: false });
    expect(getJob(store, verify.id)?.verifyVerdict).toBe('passed');
    expect(getJob(store, verify.id)?.status).toBe('done');
  });

  it('pumps already-queued work when resume has nothing to auto-resume', async () => {
    const prev = process.env[SUPERLIORA_CONDUCTOR_AUTO_RESUME_FLEET_ENV];
    process.env[SUPERLIORA_CONDUCTOR_AUTO_RESUME_FLEET_ENV] = '1';
    try {
      const store = memoryStore();
      const blocked = createJob(store, { title: 'Delete-pass', kind: 'implement' });
      patchJob(store, blocked.id, {
        status: 'blocked',
        notes: 'merge: reject — verdict=missing',
        worktreePath: `/tmp/recovery/${blocked.id}`,
      });
      const verify = createJob(store, {
        title: 'Verify: Delete-pass',
        kind: 'verify',
        priority: 201,
        parentJobId: blocked.id,
      });
      // Already queued (not interrupted) — old recovery skipped the pump entirely.
      patchJob(store, verify.id, {
        status: 'queued',
        worktreePath: `/tmp/recovery/${verify.id}`,
      });

      const host = {
        spawn: async (options: { profileName?: string }) =>
          ({
            agentId: 'agent_verify_recovery',
            profileName: options.profileName ?? 'coder',
            resumed: false,
            completion: new Promise<never>(() => {}),
          }) as never,
      };
      const agent = {
        subagentHost: host,
        config: { cwd: '/tmp/recovery' },
        kaos: undefined,
      } as never;

      const result = await recoverJobsAfterResume({ store, agent, autoResume: true });
      expect(result.resumed).toHaveLength(0);
      expect(result.held.some((j) => j.id === blocked.id)).toBe(true);
      expect(getJob(store, verify.id)?.status).toBe('running');
      expect(getJob(store, verify.id)?.workerAgentId).toBe('agent_verify_recovery');
    } finally {
      if (prev === undefined) delete process.env[SUPERLIORA_CONDUCTOR_AUTO_RESUME_FLEET_ENV];
      else process.env[SUPERLIORA_CONDUCTOR_AUTO_RESUME_FLEET_ENV] = prev;
    }
  });

});
