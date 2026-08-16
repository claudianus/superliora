/**
 * Conductor wake (meta-loop kick): terminal inbox notices must start a
 * bounded routing turn on an idle main lane, and must never fire into a
 * busy lane, a sub lane, or an empty inbox.
 */

import { afterEach, describe, expect, it } from 'vitest';

import type { Agent } from '../../src/agent';
import {
  CONDUCTOR_WAKE_ORIGIN,
  CONDUCTOR_WAKE_PROMPT,
  requestConductorWake,
} from '../../src/session/job/conductor-wake';
import { __resetJobWorkerHandlesForTests } from '../../src/tools/builtin/job/job-handles';
import { pushJobInboxEvent } from '../../src/tools/builtin/job/job-inbox';
import { createJob, getJob, patchJob } from '../../src/tools/builtin/job/job-ledger';
import {
  __resetJobWorkerLedgerBridgeForTests,
  bindJobWorkerLedger,
  raiseJobNeedsUserForWorker,
} from '../../src/tools/builtin/job/job-worker-ledger-bridge';
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

interface RecordedPrompt {
  readonly input: readonly { type: string; text?: string }[];
  readonly origin: unknown;
}

function fakeAgent(type: 'main' | 'sub') {
  const prompts: RecordedPrompt[] = [];
  let busy = false;
  let throwOnPrompt: Error | undefined;
  const agent = {
    type,
    subagentHost: { spawn: async () => ({}) },
    turn: {
      get hasActiveTurn() {
        return busy;
      },
      prompt(input: RecordedPrompt['input'], origin: unknown): number | null {
        if (throwOnPrompt !== undefined) throw throwOnPrompt;
        prompts.push({ input, origin });
        // Real turn.prompt claims the active slot synchronously.
        busy = true;
        return 1;
      },
    },
  } as unknown as Agent;
  return {
    agent,
    prompts,
    setBusy(value: boolean) {
      busy = value;
    },
    failPrompt(error: Error) {
      throwOnPrompt = error;
    },
  };
}

function pushDoneNotice(store: ToolStore, jobId = 'job_x'): void {
  pushJobInboxEvent(store, {
    kind: 'job.completed',
    jobId,
    status: 'done',
    title: 'done job',
  });
}

async function drainMicrotasks(rounds = 4): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await Promise.resolve();
  }
}

afterEach(() => {
  __resetJobWorkerHandlesForTests();
  __resetJobWorkerLedgerBridgeForTests();
});

describe('requestConductorWake', () => {
  it('starts a routing turn on an idle main lane with unread notices', () => {
    const store = memoryStore();
    const { agent, prompts } = fakeAgent('main');
    pushDoneNotice(store);

    requestConductorWake({ agent, store });

    expect(prompts).toHaveLength(1);
    expect(prompts[0]?.origin).toEqual(CONDUCTOR_WAKE_ORIGIN);
    expect(prompts[0]?.input[0]?.text).toContain('routing pass');
    // Cap: digest 1 + highest-severity JobInspect 1 — no Inbox+Inspect marathon.
    expect(CONDUCTOR_WAKE_PROMPT).toMatch(/digest\s*1|one digest|1 digest/i);
    expect(CONDUCTOR_WAKE_PROMPT).toMatch(/JobInspect\s*1|1 JobInspect|highest[- ]severity/i);
    expect(CONDUCTOR_WAKE_PROMPT).not.toMatch(/JobInspect each unread/i);
    expect(prompts[0]?.input[0]?.text).toBe(CONDUCTOR_WAKE_PROMPT);
  });

  it('does not fire on an empty inbox, a busy lane, or a sub lane', () => {
    const store = memoryStore();

    const empty = fakeAgent('main');
    requestConductorWake({ agent: empty.agent, store });
    expect(empty.prompts).toHaveLength(0);

    pushDoneNotice(store);

    const busyLane = fakeAgent('main');
    busyLane.setBusy(true);
    requestConductorWake({ agent: busyLane.agent, store });
    expect(busyLane.prompts).toHaveLength(0);

    const subLane = fakeAgent('sub');
    requestConductorWake({ agent: subLane.agent, store });
    expect(subLane.prompts).toHaveLength(0);
  });

  it('swallows a throwing turn.prompt — wake never breaks completion paths', () => {
    const store = memoryStore();
    const { agent, failPrompt } = fakeAgent('main');
    pushDoneNotice(store);
    failPrompt(new Error('turn engine down'));

    expect(() => {
      requestConductorWake({ agent, store });
    }).not.toThrow();
  });

  it('arms one re-check on the active turn settle, closing the mid-turn notice gap', async () => {
    const store = memoryStore();
    const { agent, prompts, setBusy } = fakeAgent('main');
    let settle!: () => void;
    const turnSettled = new Promise<void>((resolve) => {
      settle = resolve;
    });
    (
      agent.turn as unknown as { waitForCurrentTurn: () => Promise<void> }
    ).waitForCurrentTurn = () => turnSettled;

    setBusy(true);
    pushDoneNotice(store);
    requestConductorWake({ agent, store });
    // Coalesced while the lane is busy — no immediate wake.
    expect(prompts).toHaveLength(0);

    // A second notice during the same turn does not arm another re-check.
    pushDoneNotice(store, 'job_y');
    requestConductorWake({ agent, store });

    // The turn ends with notices still unread (they landed after the final
    // inject): the wake must fire off the settle, not the next user prompt.
    setBusy(false);
    settle();
    await drainMicrotasks();
    expect(prompts).toHaveLength(1);
    expect(prompts[0]?.origin).toEqual(CONDUCTOR_WAKE_ORIGIN);
  });
});

describe('wake wiring on terminal job events', () => {
  function runningJob(store: ToolStore, title: string) {
    const job = createJob(store, { title, kind: 'implement' });
    const running = patchJob(store, job.id, {
      status: 'running',
      worktreePath: `/tmp/wake/${job.id}`,
    });
    if (!running) throw new Error('failed to promote job to running');
    return running;
  }

  function spawnWith(completion: Promise<{ result: string }>, agentId: string) {
    return (async () => ({
      agentId,
      profileName: 'coder',
      resumed: false,
      completion,
    })) as never;
  }

  it('worker completion wakes the idle conductor exactly once', async () => {
    const store = memoryStore();
    const job = runningJob(store, 'wake on done');
    const { agent, prompts } = fakeAgent('main');
    const completion = Promise.resolve({ result: 'worker finished' });

    const launched = await launchJobWorker({
      store,
      agent,
      job,
      spawnOne: spawnWith(completion, 'agent_wake_1'),
    });
    expect(launched.ok).toBe(true);

    await drainMicrotasks();
    await drainMicrotasks();
    expect(getJob(store, job.id)?.status).toBe('done');
    expect(prompts).toHaveLength(1);
    expect(prompts[0]?.origin).toEqual(CONDUCTOR_WAKE_ORIGIN);
  });

  it('a second completion during the wake turn coalesces into the same turn', async () => {
    const store = memoryStore();
    const first = runningJob(store, 'first');
    const second = runningJob(store, 'second');
    const { agent, prompts, setBusy } = fakeAgent('main');

    await launchJobWorker({
      store,
      agent,
      job: first,
      spawnOne: spawnWith(Promise.resolve({ result: 'one done' }), 'agent_wake_2a'),
    });
    await launchJobWorker({
      store,
      agent,
      job: second,
      spawnOne: spawnWith(Promise.resolve({ result: 'two done' }), 'agent_wake_2b'),
    });
    await drainMicrotasks();
    await drainMicrotasks();

    expect(getJob(store, first.id)?.status).toBe('done');
    expect(getJob(store, second.id)?.status).toBe('done');
    // First completion claimed the turn slot; the second found the lane busy.
    expect(prompts).toHaveLength(1);

    // After the wake turn ends, a new notice wakes again.
    setBusy(false);
    pushDoneNotice(store, first.id);
    requestConductorWake({ agent, store });
    expect(prompts).toHaveLength(2);
  });

  it('paused needs_user cards wake; shared-RPC interviews (still running) do not', () => {
    const store = memoryStore();
    const { agent, prompts } = fakeAgent('main');
    const pausedJob = createJob(store, { title: 'paused worker', kind: 'implement' });
    bindJobWorkerLedger('agent_wake_3', store, pausedJob.id, agent);

    raiseJobNeedsUserForWorker('agent_wake_3', { question: 'which branch?' });
    expect(prompts).toHaveLength(1);

    const running = patchJob(store, pausedJob.id, { status: 'running' });
    if (!running) throw new Error('failed to promote job to running');
    raiseJobNeedsUserForWorker('agent_wake_3', { question: 'inline question' });
    expect(prompts).toHaveLength(1);
  });
});
