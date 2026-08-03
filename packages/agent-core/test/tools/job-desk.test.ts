/**
 * V4 gate tests (contract §4, checklist V4-1/V4-2/V4-3):
 * desk worker routing, burst offloading decision, digest escalation,
 * and the job desk injection caps.
 */

import { describe, expect, it } from 'vitest';

import type { Agent } from '../../src/agent';
import {
  JOB_DESK_MAX_CHARS,
  JobDeskInjector,
  renderJobDeskInjection,
} from '../../src/agent/injection/job-desk';
import {
  buildDeskDigestPrompt,
  DESK_DIGEST_TRIGGER_COUNT,
  DESK_DIGEST_WINDOW_MS,
  digestInboxEvents,
  enqueueDeskDigestJob,
  findActiveDeskJob,
  runDeskDigestCycle,
  shouldOffloadInboxToDesk,
} from '../../src/tools/builtin/job/job-desk';
import {
  listUnreadJobInbox,
  pushJobInboxEvent,
  type JobInboxEvent,
} from '../../src/tools/builtin/job/job-inbox';
import { listJobs, patchJob } from '../../src/tools/builtin/job/job-ledger';
import { profileForJobKind, summarizeJobStrip } from '../../src/tools/builtin/job/job-runtime';
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

function pushCompletion(store: ToolStore, index: number, status: 'done' | 'failed' = 'done'): void {
  pushJobInboxEvent(store, {
    kind: status === 'done' ? 'job.completed' : 'job.failed',
    jobId: `job_${(index % 3).toString(36)}${index.toString(36)}`,
    status,
    title: `Worker batch ${index}`,
    summary: status === 'done' ? `completed step ${index}` : `failed step ${index}`,
  });
}

function fakeMainAgent(store: ToolStore): Agent {
  return {
    type: 'main',
    tools: { getStore: () => store },
  } as unknown as Agent;
}

describe('desk offloading decision (V4-2 판정)', () => {
  it('does not offload below the burst threshold', () => {
    const store = memoryStore();
    for (let i = 0; i < DESK_DIGEST_TRIGGER_COUNT - 1; i += 1) pushCompletion(store, i);
    const decision = shouldOffloadInboxToDesk(store);
    expect(decision.offload).toBe(false);
    expect(decision.reason).toBeUndefined();
  });

  it('offloads on a burst (≥5 notices within the window)', () => {
    const store = memoryStore();
    for (let i = 0; i < DESK_DIGEST_TRIGGER_COUNT; i += 1) pushCompletion(store, i);
    const decision = shouldOffloadInboxToDesk(store);
    expect(decision.offload).toBe(true);
    expect(decision.recentCount).toBe(DESK_DIGEST_TRIGGER_COUNT);
    expect(decision.reason).toBe('burst');
  });

  it('ignores notices outside the burst window', () => {
    const store = memoryStore();
    for (let i = 0; i < DESK_DIGEST_TRIGGER_COUNT + 1; i += 1) pushCompletion(store, i);
    // Simulate time passing beyond the window without touching createdAt.
    const future = Date.now() + DESK_DIGEST_WINDOW_MS + 60_000;
    const decision = shouldOffloadInboxToDesk(store, future);
    expect(decision.offload).toBe(false);
    expect(decision.recentCount).toBe(0);
  });
});

describe('desk digest cycle (V4-2 폭주 digest)', () => {
  it('10 simultaneous completions fold into exactly one escalation card', () => {
    const store = memoryStore();
    for (let i = 0; i < 10; i += 1) pushCompletion(store, i);

    const result = runDeskDigestCycle(store);
    expect(result.offloaded).toBe(true);
    expect(result.batched).toBe(10);
    expect(result.escalation).toBeDefined();
    expect(result.escalation?.digest).toBe(true);
    expect(result.escalation?.title).toContain('10 notices');

    // Main turn budget: after digestion exactly ONE unread item remains —
    // the escalation card — so the injector adds at most one turn item.
    const unread = listUnreadJobInbox(store);
    expect(unread).toHaveLength(1);
    expect(unread[0]?.id).toBe(result.escalation?.id);
  });

  it('dedupes and groups the batch deterministically', () => {
    const store = memoryStore();
    for (let i = 0; i < 7; i += 1) pushCompletion(store, i, 'done');
    for (let i = 0; i < 3; i += 1) pushCompletion(store, i + 7, 'failed');

    const events = listUnreadJobInbox(store);
    const digest = digestInboxEvents(events);
    expect(digest.groups).toHaveLength(2);
    expect(digest.groups[0]).toMatchObject({ kind: 'job.completed', count: 7 });
    expect(digest.groups[1]).toMatchObject({ kind: 'job.failed', count: 3 });
    expect(digest.summary).toContain('10 notices');
    expect(digest.summary).toContain('7× job.completed');
    expect(digest.summary).toContain('3× job.failed');
  });

  it('is a no-op without a burst', () => {
    const store = memoryStore();
    for (let i = 0; i < 3; i += 1) pushCompletion(store, i);
    const result = runDeskDigestCycle(store);
    expect(result.offloaded).toBe(false);
    expect(result.batched).toBe(0);
    expect(listUnreadJobInbox(store)).toHaveLength(3);
  });

  it('manual trigger (/job digest) digests even small backlogs', () => {
    const store = memoryStore();
    for (let i = 0; i < 2; i += 1) pushCompletion(store, i);
    const result = runDeskDigestCycle(store, { manual: true });
    expect(result.offloaded).toBe(true);
    expect(result.batched).toBe(2);
    expect(listUnreadJobInbox(store)).toHaveLength(1);
  });

  it('repeat cycle after digestion does not re-escalate', () => {
    const store = memoryStore();
    for (let i = 0; i < 6; i += 1) pushCompletion(store, i);
    runDeskDigestCycle(store);
    // Burst window still counts the folded notices, but nothing is unread.
    const second = runDeskDigestCycle(store);
    expect(second.offloaded).toBe(false);
    expect(listUnreadJobInbox(store)).toHaveLength(1);
  });
});

describe('desk worker routing (kind=desk)', () => {
  it('routes desk jobs to the cheap explore profile', () => {
    expect(profileForJobKind('desk')).toBe('explore');
  });

  it('enqueues one desk job and stays idempotent while it is active', () => {
    const store = memoryStore();
    for (let i = 0; i < 6; i += 1) pushCompletion(store, i);
    const events = listUnreadJobInbox(store);

    const first = enqueueDeskDigestJob(store, events);
    expect(first.kind).toBe('desk');
    expect(first.status).toBe('queued');
    expect(first.title).toBe('Desk: inbox digest');
    expect(first.prompt).toContain('desk worker');

    const second = enqueueDeskDigestJob(store, events);
    expect(second.id).toBe(first.id);
    expect(listJobs(store).filter((j) => j.kind === 'desk')).toHaveLength(1);
    expect(findActiveDeskJob(store)?.id).toBe(first.id);
  });

  it('digest cycle can enqueue the worker and frees the slot once done', () => {
    const store = memoryStore();
    for (let i = 0; i < 5; i += 1) pushCompletion(store, i);
    const result = runDeskDigestCycle(store, { enqueueWorker: true });
    expect(result.deskJob?.kind).toBe('desk');
    expect(findActiveDeskJob(store)).toBeDefined();

    patchJob(store, result.deskJob!.id, { status: 'done' });
    expect(findActiveDeskJob(store)).toBeUndefined();
  });

  it('digest prompt carries the batch for the worker', () => {
    const store = memoryStore();
    pushCompletion(store, 0);
    pushCompletion(store, 1, 'failed');
    const prompt = buildDeskDigestPrompt(listUnreadJobInbox(store));
    expect(prompt).toContain('job.completed');
    expect(prompt).toContain('job.failed');
    expect(prompt).toContain('ONE escalation card');
  });
});

describe('job desk injection caps (V4-1)', () => {
  it('burst injection shows the batched marker and leaves one unread item', async () => {
    const store = memoryStore();
    for (let i = 0; i < 10; i += 1) pushCompletion(store, i);
    const injector = new JobDeskInjector(fakeMainAgent(store));

    const text = await injector.collectForBatch();
    expect(text).toBeDefined();
    expect(text).toContain('<conductor_job_desk>');
    expect(text).toContain('inbox 10 (batched)');
    expect(text!.length).toBeLessThanOrEqual(JOB_DESK_MAX_CHARS);
    expect(listUnreadJobInbox(store)).toHaveLength(1);
  });

  it('non-burst injection lists each notice (≤5 events cap)', async () => {
    const store = memoryStore();
    for (let i = 0; i < 3; i += 1) pushCompletion(store, i);
    const injector = new JobDeskInjector(fakeMainAgent(store));

    const text = await injector.collectForBatch();
    expect(text).toBeDefined();
    expect(text).not.toContain('(batched)');
    const noticeLines = text!.split('\n').filter((line) => line.startsWith('- job.completed'));
    expect(noticeLines).toHaveLength(3);
    expect(text!.length).toBeLessThanOrEqual(JOB_DESK_MAX_CHARS);
  });

  it('rendered injection never exceeds the char budget', () => {
    const store = memoryStore();
    const strip = summarizeJobStrip(store);
    // Summaries render capped at 100 chars each, so enough events are needed
    // to cross the 1.5KB budget and exercise the truncation path.
    const events: JobInboxEvent[] = [];
    for (let i = 0; i < 15; i += 1) {
      events.push({
        id: `e${i}`,
        kind: 'job.completed',
        jobId: `job_${i}`,
        status: 'done',
        title: `Burst worker ${i}`,
        summary: 'x'.repeat(400),
        createdAt: new Date().toISOString(),
        read: false,
      });
    }
    const text = renderJobDeskInjection(events, strip);
    expect(text.length).toBeLessThanOrEqual(JOB_DESK_MAX_CHARS);
    expect(text).toContain('[truncated]');
  });
});
