/**
 * Worker progress → job ledger bridge.
 *
 * The subagent progress reporter tick mirrors live worker state (phase +
 * heartbeat) onto the bound job's ledger record and re-emits `job.updated`,
 * so JobList/JobInspect, the desk injection, and live clients see real-time
 * worker state instead of a static "running". Stall signals mark the phase
 * and leave a ledger note. Progress never wakes the conductor turn.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Agent } from '../../src/agent';
import { renderJobDeskInjection } from '../../src/agent/injection/job-desk';
import {
  createJob,
  getJob,
  patchJob,
  renderJobLine,
} from '../../src/tools/builtin/job/job-ledger';
import { listUnreadJobInbox } from '../../src/tools/builtin/job/job-inbox';
import { summarizeJobStrip } from '../../src/tools/builtin/job/job-runtime';
import {
  __resetJobWorkerLedgerBridgeForTests,
  armJobWorkerProgressStall,
  bindJobWorkerLedger,
  raiseJobNeedsUserForWorker,
  reportJobWorkerProgress,
  reportJobWorkerStalled,
} from '../../src/tools/builtin/job/job-worker-ledger-bridge';
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

interface EmittedJobUpdated {
  readonly type: string;
  readonly job?: { readonly id: string; readonly progress?: { readonly phase?: string } };
  readonly change?: { readonly reason?: string };
}

function fakeAgent() {
  const events: EmittedJobUpdated[] = [];
  const agent = {
    emitAgentEvent(event: EmittedJobUpdated) {
      events.push(event);
    },
  } as unknown as Agent;
  return { agent, events };
}

function runningJob(store: ToolStore, title: string) {
  const job = createJob(store, { title, kind: 'implement' });
  const running = patchJob(store, job.id, {
    status: 'running',
    worktreePath: `/tmp/progress/${job.id}`,
  });
  if (!running) throw new Error('failed to promote job to running');
  return running;
}

afterEach(() => {
  __resetJobWorkerLedgerBridgeForTests();
});

describe('reportJobWorkerProgress', () => {
  it('mirrors phase + heartbeat onto a bound running job and emits job.updated', () => {
    const store = memoryStore();
    const job = runningJob(store, 'live progress');
    const { agent, events } = fakeAgent();
    bindJobWorkerLedger('agent_p1', store, job.id, agent);

    const at = new Date().toISOString();
    reportJobWorkerProgress('agent_p1', { phase: 'Bash: pnpm test', lastHeartbeatAt: at });

    const updated = getJob(store, job.id);
    expect(updated?.progress?.phase).toBe('Bash: pnpm test');
    expect(updated?.progress?.lastHeartbeatAt).toBe(at);

    const jobUpdated = events.filter((e) => e.type === 'job.updated');
    expect(jobUpdated).toHaveLength(1);
    expect(jobUpdated[0]?.change?.reason).toBe('progress');
    expect(jobUpdated[0]?.job?.progress?.phase).toBe('Bash: pnpm test');
  });

  it('is a no-op for unbound subagents and jobs that already left running', () => {
    const store = memoryStore();
    const job = runningJob(store, 'done already');
    const { agent, events } = fakeAgent();
    bindJobWorkerLedger('agent_p2', store, job.id, agent);
    patchJob(store, job.id, { status: 'done' });

    reportJobWorkerProgress('agent_p2', { phase: 'Edit: x.ts' });
    expect(getJob(store, job.id)?.progress).toBeUndefined();

    reportJobWorkerProgress('agent_unbound', { phase: 'Edit: y.ts' });
    expect(events).toHaveLength(0);
  });

  it('marks a stall on the ledger with phase and note', () => {
    const store = memoryStore();
    const job = runningJob(store, 'stalling worker');
    const { agent, events } = fakeAgent();
    bindJobWorkerLedger('agent_p3', store, job.id, agent);
    reportJobWorkerProgress('agent_p3', { phase: 'Bash: make build' });

    reportJobWorkerStalled('agent_p3', 320_000);

    const updated = getJob(store, job.id);
    expect(updated?.progress?.phase).toContain('stalled');
    expect(updated?.progress?.phase).toContain('5m');
    expect(updated?.notes).toContain('stall: no tool activity for 5m');
    expect(events.some((e) => e.change?.reason === 'stalled')).toBe(true);
  });
});

describe('armJobWorkerProgressStall', () => {
  afterEach(() => {
    vi.useRealTimers();
    __resetJobWorkerLedgerBridgeForTests();
  });

  it('blocks the job and writes inbox when no progress lands within the stall window', () => {
    vi.useFakeTimers();
    const store = memoryStore();
    const job = runningJob(store, 'no first tool');
    const { agent } = fakeAgent();
    bindJobWorkerLedger('agent_stall', store, job.id, agent);

    armJobWorkerProgressStall('agent_stall', { stallMs: 120 });
    expect(getJob(store, job.id)?.status).toBe('running');

    vi.advanceTimersByTime(119);
    expect(getJob(store, job.id)?.status).toBe('running');

    vi.advanceTimersByTime(2);
    const blocked = getJob(store, job.id);
    expect(blocked?.status).toBe('blocked');
    expect(blocked?.notes).toContain('spawn.progress_stall');
    const inbox = listUnreadJobInbox(store);
    expect(inbox.some((e) => e.kind === 'job.blocked' && e.summary?.includes('spawn.progress_stall'))).toBe(
      true,
    );
  });

  it('clears the stall watchdog on first meaningful progress', () => {
    vi.useFakeTimers();
    const store = memoryStore();
    const job = runningJob(store, 'early progress');
    const { agent } = fakeAgent();
    bindJobWorkerLedger('agent_ok', store, job.id, agent);

    armJobWorkerProgressStall('agent_ok', { stallMs: 120 });
    reportJobWorkerProgress('agent_ok', { phase: 'Read: plan.md' });
    vi.advanceTimersByTime(500);
    expect(getJob(store, job.id)?.status).toBe('running');
    expect(getJob(store, job.id)?.notes ?? '').not.toContain('spawn.progress_stall');
  });

  it('clears the stall watchdog when needs_user is raised (interview)', () => {
    vi.useFakeTimers();
    const store = memoryStore();
    const job = runningJob(store, 'interview stall');
    const { agent } = fakeAgent();
    bindJobWorkerLedger('agent_ask', store, job.id, agent);

    armJobWorkerProgressStall('agent_ask', { stallMs: 120 });
    raiseJobNeedsUserForWorker('agent_ask', { question: 'Ship now or later?' });
    vi.advanceTimersByTime(500);
    // Shared-RPC path keeps status running; must not flip to blocked via stall.
    expect(getJob(store, job.id)?.status).toBe('running');
    expect(getJob(store, job.id)?.notes ?? '').toContain('interview:');
    expect(getJob(store, job.id)?.notes ?? '').not.toContain('spawn.progress_stall');
  });
});

describe('live progress rendering', () => {
  it('renderJobLine appends phase + heartbeat age for running jobs only', () => {
    const store = memoryStore();
    const job = runningJob(store, 'visible progress');
    patchJob(store, job.id, {
      progress: {
        phase: 'Bash: pnpm test',
        lastHeartbeatAt: new Date(Date.now() - 12_000).toISOString(),
      },
    });

    const line = renderJobLine(getJob(store, job.id)!);
    expect(line).toMatch(/— Bash: pnpm test · 1\ds ago/);

    const done = patchJob(store, job.id, { status: 'done' });
    expect(renderJobLine(done!)).not.toContain('Bash: pnpm test');
  });

  it('desk injection renders live worker lines under the strip', () => {
    const store = memoryStore();
    runningJob(store, 'live desk');
    const strip = summarizeJobStrip(store);

    const text = renderJobDeskInjection([], strip, {
      live: ['- job_a — Bash: pnpm test · 3s ago'],
    });

    expect(text).toContain('Live workers:');
    expect(text).toContain('- job_a — Bash: pnpm test · 3s ago');
  });
});
