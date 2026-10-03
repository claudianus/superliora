/**
 * V5-3 — job desk board store single-source convergence.
 *
 * Job state flows through recorded job.updated/job.inbox events and RPC
 * snapshots; counters derive from the cards without model-tool backfill.
 */


import { describe, expect, it, vi } from 'vitest';

import type { JobInboxEvent, JobUpdatedEvent } from '@superliora/protocol';

import { ControlTowerJobDesk } from '#/tui/features/control-tower/job-desk-events';
import { JobBoardStore } from '#/tui/features/control-tower/job-board-store';
import { createTerminalState } from '#/tui/utils/terminal/terminal-state';
import type { AppState } from '#/tui/types';

function jobUpdated(
  id: string,
  status: JobUpdatedEvent['job']['status'],
  previousStatus?: JobUpdatedEvent['job']['status'],
): JobUpdatedEvent {
  return {
    type: 'job.updated',
    schemaVersion: 2,
    job: {
      id,
      title: `work ${id}`,
      status,
      kind: 'task',
      priority: 1,
    },
    ...(previousStatus === undefined ? {} : { change: { previousStatus } }),
  };
}

function jobInbox(eventId: string, jobId: string): JobInboxEvent {
  return {
    type: 'job.inbox',
    schemaVersion: 2,
    eventId,
    jobId,
    kind: 'job.completed',
    title: `completion ${eventId}`,
    summary: 'done',
  } as JobInboxEvent;
}

describe('JobBoardStore — counters derive from cards', () => {
  it('upserts cards and derives counters without delta math', () => {
    const store = new JobBoardStore();
    store.applyJobUpdated(jobUpdated('job_a', 'queued'));
    store.applyJobUpdated(jobUpdated('job_b', 'queued'));
    expect(store.snapshot().queued).toBe(2);
    expect(store.snapshot().total).toBe(2);

    store.applyJobUpdated(jobUpdated('job_a', 'running', 'queued'));
    const snap = store.snapshot();
    expect(snap.queued).toBe(1);
    expect(snap.running).toBe(1);
    expect(snap.jobs.find((card) => card.id === 'job_a')?.status).toBe('running');
  });

  it('stays drift-free across the full status lifecycle', () => {
    const store = new JobBoardStore();
    const lifecycle: JobUpdatedEvent['job']['status'][] = [
      'queued',
      'running',
      'blocked',
      'needs_user',
      'running',
      'done',
    ];
    let previous: JobUpdatedEvent['job']['status'] | undefined;
    for (const status of lifecycle) {
      store.applyJobUpdated(jobUpdated('job_x', status, previous));
      previous = status;
    }
    const snap = store.snapshot();
    // done is terminal: no active counter, card stays for the board list.
    expect(snap.queued).toBe(0);
    expect(snap.running).toBe(0);
    expect(snap.total).toBe(1);
    expect(snap.jobs[0]?.status).toBe('done');
    expect(snap.jobs[0]?.previousStatus).toBe('running');
  });

  it('appends inbox notices with unread bump and cap', () => {
    const store = new JobBoardStore();
    store.applyJobInbox(jobInbox('evt_1', 'job_a'));
    store.applyJobInbox(jobInbox('evt_2', 'job_a'));
    expect(store.snapshot().unreadInbox).toBe(2);
    expect(store.snapshot().inbox).toHaveLength(2);
    for (let i = 0; i < 40; i++) {
      store.applyJobInbox(jobInbox(`evt_burst_${i}`, 'job_a'));
    }
    expect(store.snapshot().inbox.length).toBeLessThanOrEqual(24);
  });

  it('notifies subscribers once per applied event', () => {
    const store = new JobBoardStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.applyJobUpdated(jobUpdated('job_a', 'queued'));
    store.applyJobInbox(jobInbox('evt_1', 'job_a'));
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe('JobBoardStore — worker heartbeat joins onto the owning card', () => {
  function withWorker(id: string, workerAgentId: string): JobUpdatedEvent {
    const base = jobUpdated(id, 'running');
    return { ...base, job: { ...base.job, workerAgentId } };
  }

  it('fills the ticker from subagent.progress without a ledger write', () => {
    const store = new JobBoardStore();
    store.applyJobUpdated(withWorker('job_a', 'agent_1'));

    expect(
      store.applySubagentProgress({
        subagentId: 'agent_1',
        lastTool: 'Bash',
        lastTarget: 'src/parser.ts',
        toolCount: 4,
        atMs: Date.parse('2026-08-05T00:00:00.000Z'),
      }),
    ).toBe(true);

    const progress = store.snapshot().jobs.find((card) => card.id === 'job_a')?.progress;
    expect(progress?.phase).toBe('src/parser.ts');
    expect(progress?.recentTools).toEqual(['Bash']);
    expect(progress?.stepsCompleted).toBe(4);
    expect(progress?.lastHeartbeatAt).toBe('2026-08-05T00:00:00.000Z');
  });

  it('keeps a bounded tool trail and drops repeats', () => {
    const store = new JobBoardStore();
    store.applyJobUpdated(withWorker('job_a', 'agent_1'));
    for (const lastTool of ['Bash', 'Bash', 'Bash', 'Edit', 'Shell']) {
      store.applySubagentProgress({ subagentId: 'agent_1', lastTool });
    }
    expect(store.snapshot().jobs[0]?.progress?.recentTools).toEqual(['Bash', 'Edit', 'Shell']);
  });

  it('ignores heartbeats from subagents no job owns', () => {
    const store = new JobBoardStore();
    store.applyJobUpdated(withWorker('job_a', 'agent_1'));
    const listener = vi.fn();
    store.subscribe(listener);
    expect(store.applySubagentProgress({ subagentId: 'agent_other', lastTool: 'Bash' })).toBe(
      false,
    );
    expect(listener).not.toHaveBeenCalled();
  });
});


describe('ControlTowerJobDesk — single sink side effects', () => {
  function fakeDeskHost() {
    const appStatePatch: Partial<AppState>[] = [];
    const host = {
      state: {
        appState: {
          notifications: { enabled: false, condition: 'unfocused' as const },
        } as AppState,
        jobBoard: undefined as unknown,
        // Notification-gate surface: disabled so desktop-notify never fires.
        terminalState: createTerminalState(),
      },
      setAppState: vi.fn((patch: Partial<AppState>) => {
        appStatePatch.push(patch);
      }),
      showStatus: vi.fn(),
      showNotice: vi.fn(),
      appStatePatch,
    };
    return host;
  }

  it('publishes the store snapshot into appState on job events', () => {
    const host = fakeDeskHost();
    const store = new JobBoardStore();
    const desk = new ControlTowerJobDesk(host, store);

    desk.handleUpdated(jobUpdated('job_a', 'running'));
    // publish + persist job_deck_hint_seen onboarding patch
    expect(host.setAppState).toHaveBeenCalledTimes(2);
    const jobsPatch = host.appStatePatch.find((p) => p.conductorJobs !== undefined);
    expect(jobsPatch?.conductorJobs).toBe(store.snapshot());
    expect(jobsPatch?.conductorJobs?.running).toBe(1);

    desk.handleInbox(jobInbox('evt_1', 'job_a'));
    const inboxPatch = host.appStatePatch.find((p) => p.conductorJobs?.unreadInbox === 1);
    expect(inboxPatch?.conductorJobs?.unreadInbox).toBe(1);
    expect(host.showNotice).toHaveBeenCalledWith(
      'Job completed: completion evt_1',
      'done',
      { coalesceKey: 'job-inbox:evt_1' },
    );
  });

  it('clears the unread inbox count when the operator marks it read', () => {
    const host = fakeDeskHost();
    const store = new JobBoardStore();
    const desk = new ControlTowerJobDesk(host, store);
    desk.handleInbox(jobInbox('evt_read', 'job_read'));
    expect(store.snapshot().unreadInbox).toBe(1);
    desk.markInboxRead();
    expect(store.snapshot().unreadInbox).toBe(0);
  });

  it('publishes immediate worker tool activity without waiting for a heartbeat', () => {
    const host = fakeDeskHost();
    const store = new JobBoardStore();
    const desk = new ControlTowerJobDesk(host, store);
    const base = jobUpdated('job_worker', 'running');
    desk.handleUpdated({
      ...base,
      job: { ...base.job, workerAgentId: 'agent_worker' },
    });

    desk.handleSubagentToolCall({
      type: 'subagent.tool_call',
      subagentId: 'agent_worker',
      toolCallId: 'call_1',
      name: 'Bash',
      detail: { kind: 'bash', command: 'cat src/parser.ts' },
    });

    let card = store.snapshot().jobs.find((entry) => entry.id === 'job_worker');
    expect(card?.liveActivity).toMatchObject({
      toolCallId: 'call_1',
      name: 'Bash',
      target: 'cat src/parser.ts',
      status: 'running',
    });
    expect(card?.progress?.recentTools).toEqual(['Bash']);

    desk.handleSubagentToolResult({
      type: 'subagent.tool_result',
      subagentId: 'agent_worker',
      toolCallId: 'call_1',
      name: 'Bash',
    });

    card = store.snapshot().jobs.find((entry) => entry.id === 'job_worker');
    expect(card?.liveActivity?.status).toBe('ok');
    expect(host.appStatePatch.at(-1)?.conductorJobs).toBe(store.snapshot());
  });

  it('publishes live tool_progress stdout onto the owning job without waiting for tool_result', () => {
    const host = fakeDeskHost();
    const store = new JobBoardStore();
    const desk = new ControlTowerJobDesk(host, store);
    const base = jobUpdated('job_worker', 'running');
    desk.handleUpdated({
      ...base,
      job: { ...base.job, workerAgentId: 'agent_worker' },
    });

    desk.handleSubagentToolCall({
      type: 'subagent.tool_call',
      subagentId: 'agent_worker',
      toolCallId: 'call_1',
      name: 'Bash',
      detail: { kind: 'bash', command: 'pnpm test' },
    });
    desk.handleSubagentToolProgress({
      type: 'subagent.tool_progress',
      subagentId: 'agent_worker',
      toolCallId: 'call_1',
      name: 'Bash',
      kind: 'stdout',
      textPreview: 'ok\n12 passing',
    });

    let card = store.snapshot().jobs.find((entry) => entry.id === 'job_worker');
    expect(card?.liveActivity).toMatchObject({
      toolCallId: 'call_1',
      name: 'Bash',
      status: 'running',
      preview: '12 passing',
      previewKind: 'stdout',
    });

    desk.handleSubagentToolProgress({
      type: 'subagent.tool_progress',
      subagentId: 'agent_worker',
      toolCallId: 'call_1',
      kind: 'stdout',
    });
    card = store.snapshot().jobs.find((entry) => entry.id === 'job_worker');
    expect(card?.liveActivity?.preview).toBe('12 passing');

    desk.handleSubagentToolResult({
      type: 'subagent.tool_result',
      subagentId: 'agent_worker',
      toolCallId: 'call_1',
      name: 'Bash',
    });
    card = store.snapshot().jobs.find((entry) => entry.id === 'job_worker');
    expect(card?.liveActivity?.status).toBe('ok');
    expect(card?.liveActivity?.preview).toBeUndefined();
  });

  it('shows the board hint once while a job runs and the board is closed', () => {
    const host = fakeDeskHost();
    const desk = new ControlTowerJobDesk(host, new JobBoardStore());
    desk.handleUpdated(jobUpdated('job_a', 'running'));
    desk.handleUpdated(jobUpdated('job_b', 'running'));
    expect(host.showNotice).toHaveBeenCalledWith(
      'Job running — open the Deck',
      'Alt+J watches workers live · Hub → Job Deck',
      { coalesceKey: 'job-deck-hint' },
    );
    // One-shot: second running job does not re-issue the hint notice.
    const hintCalls = host.showNotice.mock.calls.filter(
      (c) => c[2]?.coalesceKey === 'job-deck-hint',
    );
    expect(hintCalls).toHaveLength(1);
  });

});

