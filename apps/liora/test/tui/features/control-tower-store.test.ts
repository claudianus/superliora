/**
 * V5-3 — job desk board store single-source convergence.
 *
 * All Conductor job state flows through one store: `job.updated` /
 * `job.inbox` protocol events plus best-effort Job* tool output. Counters
 * derive from the per-job cards (no manual delta math), and a static guard
 * keeps `appState.conductorJobs` writes confined to the control-tower feature.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { JobInboxEvent, JobUpdatedEvent } from '@superliora/protocol';

import { setExperimentalFeatures } from '#/tui/commands/experimental-flags';
import { ControlTowerJobDesk } from '#/tui/features/control-tower/job-desk-events';
import { JobBoardStore } from '#/tui/features/control-tower/job-board-store';
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
        lastTool: 'Grep',
        lastTarget: 'src/parser.ts',
        toolCount: 4,
        atMs: Date.parse('2026-08-05T00:00:00.000Z'),
      }),
    ).toBe(true);

    const progress = store.snapshot().jobs.find((card) => card.id === 'job_a')?.progress;
    expect(progress?.phase).toBe('src/parser.ts');
    expect(progress?.recentTools).toEqual(['Grep']);
    expect(progress?.stepsCompleted).toBe(4);
    expect(progress?.lastHeartbeatAt).toBe('2026-08-05T00:00:00.000Z');
  });

  it('keeps a bounded tool trail and drops repeats', () => {
    const store = new JobBoardStore();
    store.applyJobUpdated(withWorker('job_a', 'agent_1'));
    for (const lastTool of ['Read', 'Read', 'Grep', 'Edit', 'Shell']) {
      store.applySubagentProgress({ subagentId: 'agent_1', lastTool });
    }
    expect(store.snapshot().jobs[0]?.progress?.recentTools).toEqual(['Grep', 'Edit', 'Shell']);
  });

  it('ignores heartbeats from subagents no job owns', () => {
    const store = new JobBoardStore();
    store.applyJobUpdated(withWorker('job_a', 'agent_1'));
    const listener = vi.fn();
    store.subscribe(listener);
    expect(store.applySubagentProgress({ subagentId: 'agent_other', lastTool: 'Read' })).toBe(
      false,
    );
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('JobBoardStore — tool output backfill converges on the same store', () => {
  it('applies strip-line counts and maxConcurrent', () => {
    const store = new JobBoardStore();
    const changed = store.applyToolOutput('Jobs: 2▸ 1… 1? inbox 3\npool: warm=2 maxConcurrent=4');
    expect(changed).toBe(true);
    const snap = store.snapshot();
    expect(snap.running).toBe(2);
    expect(snap.queued).toBe(1);
    expect(snap.needsUser).toBe(1);
    expect(snap.unreadInbox).toBe(3);
    expect(snap.maxConcurrent).toBe(4);
  });

  it('applies ledger cards and derives counters from them', () => {
    const store = new JobBoardStore();
    const changed = store.applyToolOutput(
      '- job_a1 [running] (task p1) build parser\n- job_a2 [needs_user] (task p2) review diff',
    );
    expect(changed).toBe(true);
    const snap = store.snapshot();
    expect(snap.jobs).toHaveLength(2);
    expect(snap.running).toBe(1);
    expect(snap.needsUser).toBe(1);
    expect(snap.total).toBe(2);
  });

  it('returns false for unparseable or unchanged output', () => {
    const store = new JobBoardStore();
    expect(store.applyToolOutput('no job data here')).toBe(false);
    store.applyToolOutput('Jobs: 1▸ inbox 0');
    expect(store.applyToolOutput('Jobs: 1▸ inbox 0')).toBe(false);
  });

  it('keeps event truth over stale tool output', () => {
    const store = new JobBoardStore();
    store.applyJobUpdated(jobUpdated('job_a', 'running'));
    store.applyJobUpdated(jobUpdated('job_b', 'running'));
    // Strip line without cards must not wipe event-sourced cards.
    store.applyToolOutput('Jobs: 2▸ inbox 0');
    expect(store.snapshot().jobs).toHaveLength(2);
    expect(store.snapshot().running).toBe(2);
  });
});

describe('ControlTowerJobDesk — single sink side effects', () => {
  function fakeDeskHost() {
    const appStatePatch: Partial<AppState>[] = [];
    const host = {
      state: { appState: {} as AppState, jobBoard: undefined as unknown },
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
    setExperimentalFeatures([{ id: 'conductor_ux_v2', enabled: true }]);
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
    setExperimentalFeatures([]);
  });

  it('notices stalled workers and clears unread via markInboxRead', () => {
    setExperimentalFeatures([{ id: 'conductor_ux_v2', enabled: true }]);
    const host = fakeDeskHost();
    const store = new JobBoardStore();
    const desk = new ControlTowerJobDesk(host, store);
    desk.handleUpdated({
      ...jobUpdated('job_stall', 'running'),
      change: { reason: 'stalled' },
      job: {
        ...jobUpdated('job_stall', 'running').job,
        progress: { phase: 'stalled — no tool activity for 3m' },
      },
    });
    expect(host.showNotice).toHaveBeenCalledWith(
      'Worker may be stuck — Steer or Cancel',
      expect.stringContaining('stall'),
      { coalesceKey: 'job-stall:job_stall' },
    );
    desk.handleInbox(jobInbox('evt_stall', 'job_stall'));
    expect(store.snapshot().unreadInbox).toBe(1);
    desk.markInboxRead();
    expect(store.snapshot().unreadInbox).toBe(0);
    setExperimentalFeatures([]);
  });

  it('publishes immediate worker tool activity without waiting for a heartbeat', () => {
    setExperimentalFeatures([{ id: 'conductor_ux_v2', enabled: false }]);
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
      name: 'Read',
      detail: { kind: 'read', path: 'src/parser.ts' },
    });

    let card = store.snapshot().jobs.find((entry) => entry.id === 'job_worker');
    expect(card?.liveActivity).toMatchObject({
      toolCallId: 'call_1',
      name: 'Read',
      target: 'src/parser.ts',
      status: 'running',
    });
    expect(card?.progress?.recentTools).toEqual(['Read']);

    desk.handleSubagentToolResult({
      type: 'subagent.tool_result',
      subagentId: 'agent_worker',
      toolCallId: 'call_1',
      name: 'Read',
    });

    card = store.snapshot().jobs.find((entry) => entry.id === 'job_worker');
    expect(card?.liveActivity?.status).toBe('ok');
    expect(host.setAppState).toHaveBeenCalledTimes(3);
    setExperimentalFeatures([]);
  });

  it('shows the board hint once while a job runs and the board is closed', () => {
    setExperimentalFeatures([{ id: 'conductor_ux_v2', enabled: true }]);
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
    setExperimentalFeatures([]);
  });

  it('shows legacy Job Desk status hint when conductor_ux_v2 is off', () => {
    setExperimentalFeatures([{ id: 'conductor_ux_v2', enabled: false }]);
    const host = fakeDeskHost();
    const desk = new ControlTowerJobDesk(host, new JobBoardStore());
    desk.handleUpdated(jobUpdated('job_a', 'running'));
    expect(host.showStatus).toHaveBeenCalledTimes(1);
    expect(host.showStatus.mock.calls[0]?.[0]).toContain('/jobs deck');
    setExperimentalFeatures([]);
  });

  it('tool-output backfill republishes only when the store changed', () => {
    const host = fakeDeskHost();
    const desk = new ControlTowerJobDesk(host, new JobBoardStore());
    expect(desk.applyToolOutput('Jobs: 1▸ inbox 0')).toBe(true);
    expect(host.setAppState).toHaveBeenCalledTimes(1);
    expect(desk.applyToolOutput('Jobs: 1▸ inbox 0')).toBe(false);
    expect(host.setAppState).toHaveBeenCalledTimes(1);
  });
});

describe('V5-3 single-source guard (static)', () => {
  const SRC_ROOT = join(__dirname, '../../../src');

  function walkTypeScriptFiles(dir: string): string[] {
    const found: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        found.push(...walkTypeScriptFiles(full));
        continue;
      }
      if (!entry.name.endsWith('.ts') || entry.name.endsWith('.d.ts')) continue;
      found.push(full);
    }
    return found;
  }

  it('appState.conductorJobs writes stay inside features/control-tower', () => {
    const offenders: string[] = [];
    for (const file of walkTypeScriptFiles(SRC_ROOT)) {
      const rel = relative(SRC_ROOT, file);
      if (rel.startsWith('tui/features/control-tower/')) continue;
      const source = readFileSync(file, 'utf8');
      if (/conductorJobs\s*:/.test(source)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no surviving references to the old delta path or direct strip parsers', () => {
    const offenders: string[] = [];
    for (const file of walkTypeScriptFiles(SRC_ROOT)) {
      const rel = relative(SRC_ROOT, file);
      if (rel.startsWith('tui/features/control-tower/')) continue;
      if (rel === 'tui/utils/job/job-strip.ts') continue;
      const source = readFileSync(file, 'utf8');
      if (/SessionEventJobDesk|parseJobStripFromToolOutput|mergeConductorJobsSnapshot/.test(source)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });
});
