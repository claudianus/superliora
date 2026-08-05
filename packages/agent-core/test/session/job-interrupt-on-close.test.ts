/**
 * Session close must record in-flight Conductor Jobs as `interrupted` before
 * turns are cancelled, so the next session's `/job resume` has something to
 * restore. The ordering is the contract: a job marked here has to survive the
 * worker cancellation that follows instead of landing as `failed`/`done`.
 */

import { afterEach, describe, expect, it } from 'vitest';

import type { Agent } from '../../src/agent';
import { SessionCloseLifecycle } from '../../src/session/lifecycle/session-close-lifecycle';
import { __resetJobWorkerHandlesForTests } from '../../src/tools/builtin/job/job-handles';
import { createJob, getJob, patchJob } from '../../src/tools/builtin/job/job-ledger';
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

function fakeAgent(type: 'main' | 'sub', store: ToolStore): Agent {
  return {
    type,
    subagentHost: { spawn: async () => ({}) },
    turn: { hasActiveTurn: false, prompt: () => null },
    tools: { getStore: () => store },
  } as unknown as Agent;
}

function lifecycleFor(agents: readonly Agent[]): SessionCloseLifecycle {
  return new SessionCloseLifecycle({
    log: { debug() {}, info() {}, warn() {}, error() {} } as never,
    agents: new Map(),
    readyAgents: () => agents,
    background: undefined,
  });
}

function runningJob(store: ToolStore, title: string) {
  const job = createJob(store, { title, kind: 'implement' });
  const running = patchJob(store, job.id, {
    status: 'running',
    worktreePath: `/tmp/close/${job.id}`,
  });
  if (!running) throw new Error('failed to promote job to running');
  return running;
}

async function drainMicrotasks(rounds = 4): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await Promise.resolve();
  }
}

afterEach(() => {
  __resetJobWorkerHandlesForTests();
});

describe('interruptJobsOnClose', () => {
  it('marks running jobs interrupted and leaves queued jobs schedulable', () => {
    const store = memoryStore();
    const running = runningJob(store, 'in flight');
    const queued = createJob(store, { title: 'waiting', kind: 'implement' });

    lifecycleFor([fakeAgent('main', store)]).interruptJobsOnClose();

    expect(getJob(store, running.id)?.status).toBe('interrupted');
    expect(getJob(store, queued.id)?.status).toBe('queued');
  });

  it('reads the ledger from the main lane only', () => {
    const mainStore = memoryStore();
    const subStore = memoryStore();
    const onMain = runningJob(mainStore, 'main lane job');
    const onSub = runningJob(subStore, 'sub lane job');

    lifecycleFor([
      fakeAgent('sub', subStore),
      fakeAgent('main', mainStore),
    ]).interruptJobsOnClose();

    expect(getJob(mainStore, onMain.id)?.status).toBe('interrupted');
    expect(getJob(subStore, onSub.id)?.status).toBe('running');
  });

  it('survives the worker cancellation that follows it', async () => {
    // This is why the call sits before cancelActiveTurnsOnClose: the worker
    // completion callback keeps an already-terminal state, so the ledger must
    // say `interrupted` before the turn cancel resolves the worker.
    const store = memoryStore();
    const job = runningJob(store, 'cancelled mid-flight');
    const agent = fakeAgent('main', store);

    let settleWorker!: (value: { result: string }) => void;
    const completion = new Promise<{ result: string }>((resolve) => {
      settleWorker = resolve;
    });
    const launched = await launchJobWorker({
      store,
      agent,
      job,
      spawnOne: (async () => ({
        agentId: 'agent_close_1',
        profileName: 'coder',
        resumed: false,
        completion,
      })) as never,
    });
    expect(launched.ok).toBe(true);

    lifecycleFor([agent]).interruptJobsOnClose();
    expect(getJob(store, job.id)?.status).toBe('interrupted');

    settleWorker({ result: 'worker finished after close' });
    await drainMicrotasks();
    await drainMicrotasks();
    expect(getJob(store, job.id)?.status).toBe('interrupted');
  });
});
