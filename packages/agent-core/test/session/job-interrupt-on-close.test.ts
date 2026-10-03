import { execPath } from 'node:process';
import type { KaosProcess } from '@superliora/kaos';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Agent } from '../../src/agent';
import { SessionCloseLifecycle } from '../../src/session/lifecycle/session-close-lifecycle';
import type { SubagentCompletion } from '../../src/session/subagent/subagent-host';
import { __resetJobWorkerHandlesForTests, getJobWorkerHandle, type JobWorkerHost } from '../../src/tools/builtin/job/job-handles';
import { createJob, getJob, patchJob } from '../../src/tools/builtin/job/job-ledger';
import { launchJobWorker } from '../../src/tools/builtin/job/job-worker';
import type { ToolStore } from '../../src/tools/store';
import { testKaos } from '../fixtures/test-kaos';

afterEach(() => {
  __resetJobWorkerHandlesForTests();
});
function fixture(types: readonly ('main' | 'sub')[]) {
  const ready = types.map((type) => new Agent({ type, kaos: testKaos }));
  const lifecycle = new SessionCloseLifecycle({
    log: ready[0]!.log,
    agents: new Map(ready.map((agent, index) => [String(index), agent])),
    readyAgents: () => ready,
  });
  return { ready, lifecycle };
}

function runningJob(store: ToolStore, title: string) {
  const job = createJob(store, { title, kind: 'implement' });
  const running = patchJob(store, job.id, { status: 'running' });
  if (running === undefined) throw new Error('Failed to promote job to running');
  return running;
}

describe('Session Job interruption', () => {
  it('marks unowned running jobs interrupted while preserving queued jobs', async () => {
    const { ready: [main], lifecycle } = fixture(['main']);
    const store = main!.tools.getStore();
    const running = runningJob(store, 'in flight');
    const queued = createJob(store, { title: 'waiting', kind: 'implement' });
    await lifecycle.interruptJobsOnClose();
    expect(getJob(store, running.id)?.status).toBe('interrupted');
    expect(getJob(store, queued.id)?.status).toBe('queued');
  });

  it('interrupts only the main lane ledger', async () => {
    const { ready: [sub, main], lifecycle } = fixture(['sub', 'main']);
    const mainStore = main!.tools.getStore();
    const subStore = sub!.tools.getStore();
    const onMain = runningJob(mainStore, 'main lane job');
    const onSub = runningJob(subStore, 'sub lane job');
    await lifecycle.interruptJobsOnClose();
    expect(getJob(mainStore, onMain.id)?.status).toBe('interrupted');
    expect(getJob(subStore, onSub.id)?.status).toBe('running');
  });

  it('joins a native worker before publishing interrupted even if completion arrives after abort', async () => {
    const { ready: [main], lifecycle } = fixture(['main']);
    const store = main!.tools.getStore();
    const job = runningJob(store, 'cancelled mid-flight');
    const worker = Promise.withResolvers<SubagentCompletion>();
    const aborted = Promise.withResolvers<void>();
    const allowCleanup = Promise.withResolvers<void>();
    let proc: KaosProcess | undefined;
    const host: JobWorkerHost = {
      spawn: async (options) => {
        const owned = await main!.kaos.exec(execPath, '-e', 'process.stdin.resume()');
        proc = owned;
        options.signal.addEventListener('abort', () => aborted.resolve(), { once: true });
        return {
          agentId: 'worker-close', profileName: 'agent', resumed: false,
          completion: worker.promise,
          get resourcesSettled() { return owned.resourcesSettled; },
        };
      },
      resume: async () => { throw new Error('Unexpected resume'); },
      steerChild: () => false,
      stopAndJoin: vi.fn(async () => {
        await allowCleanup.promise;
        if (proc === undefined) throw new Error('Worker process was not spawned');
        await proc.kill('SIGTERM');
        await proc.wait();
        await proc.dispose();
        worker.resolve({
          status: 'completed', result: 'worker finished after close', filesChanged: [],
          context: { agentId: 'worker-close', contextTokens: 0 },
        });
        return true;
      }),
    };
    let closing: Promise<void> | undefined;
    try {
      const launched = await launchJobWorker({ store, agent: main!, workerHost: host, job });
      expect(launched.ok).toBe(true);
      let interrupted = false;
      closing = lifecycle.interruptJobsOnClose();
      void closing.then(() => { interrupted = true; }, () => { interrupted = true; });
      await aborted.promise;
      expect(interrupted).toBe(false);
      expect(getJob(store, job.id)?.status).toBe('running');
      expect(proc).toBeDefined();
      expect(proc!.resourcesSettled).not.toBe(true);
      expect(proc!.exitCode).toBeNull();
      expect(proc!.stdin.closed).toBe(false);
      expect(getJobWorkerHandle(job.id)?.executionFinished).toBe(false);
      expect(getJobWorkerHandle(job.id)?.resourcesSettled?.()).not.toBe(true);
      allowCleanup.resolve();
      await closing;
      expect(host.stopAndJoin).toHaveBeenCalledOnce();
      expect(proc?.resourcesSettled).toBe(true);
      expect(await proc!.wait()).toBeNull();
      expect(proc!.stdin.closed).toBe(true);
      expect(proc!.stdout.closed).toBe(true);
      expect(proc!.stderr.closed).toBe(true);
      expect(getJobWorkerHandle(job.id)).toBeUndefined();
      expect(getJob(store, job.id)?.status).toBe('interrupted');
    } finally {
      allowCleanup.resolve();
      await (closing ?? lifecycle.interruptJobsOnClose());
    }
  });
});
