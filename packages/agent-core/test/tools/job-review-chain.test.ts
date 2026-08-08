import { describe, expect, it } from 'vitest';

import {
  enqueueDebugJobForReview,
  enqueueReviewJobForParent,
  evaluateReviewChainForMerge,
  makerCheckerCollision,
  onJobTerminalForReviewChain,
  parseReviewVerdict,
  shouldEnqueueReviewAfterDone,
} from '../../src/tools/builtin/job/job-review-chain';
import { createJob, listJobs, patchJob } from '../../src/tools/builtin/job/job-ledger';
import type { JobRecord } from '../../src/tools/builtin/job/job-store-key';
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

function job(partial: Partial<JobRecord> & Pick<JobRecord, 'id' | 'title' | 'kind'>): JobRecord {
  const now = new Date().toISOString();
  return {
    status: 'done',
    priority: 0,
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

describe('job-review-chain', () => {
  it('parses JSON and line verdicts', () => {
    expect(parseReviewVerdict('{"verdict":"pass","findings":[]}')).toBe('passed');
    expect(parseReviewVerdict('notes\nverdict: fail\n')).toBe('failed');
    expect(parseReviewVerdict('no verdict here')).toBeUndefined();
  });

  it('detects maker=checker collision', () => {
    expect(makerCheckerCollision('eng-a', 'eng-a')).toBe(true);
    expect(makerCheckerCollision('eng-a', 'eng-b')).toBe(false);
    expect(makerCheckerCollision(undefined, 'eng-b')).toBe(false);
  });

  it('enqueues review only for implement/task done roles', () => {
    expect(
      shouldEnqueueReviewAfterDone(job({ id: 'job_1', title: 't', kind: 'implement' })),
    ).toBe(true);
    expect(
      shouldEnqueueReviewAfterDone(
        job({ id: 'job_2', title: 't', kind: 'implement', expertRole: 'review' }),
      ),
    ).toBe(false);
    expect(shouldEnqueueReviewAfterDone(job({ id: 'job_3', title: 't', kind: 'explore' }))).toBe(
      false,
    );
  });

  it('blocks merge until independent review passes', () => {
    const implement = job({
      id: 'job_impl',
      title: 'Feature',
      kind: 'implement',
      expertId: 'maker-1',
      expertRole: 'implement',
    });
    expect(evaluateReviewChainForMerge({ job: implement, jobs: [implement] }).ok).toBe(false);

    const reviewRunning = job({
      id: 'job_rev',
      title: 'Review',
      kind: 'task',
      parentJobId: 'job_impl',
      expertId: 'checker-1',
      expertRole: 'review',
      status: 'running',
    });
    expect(
      evaluateReviewChainForMerge({ job: implement, jobs: [implement, reviewRunning] }).ok,
    ).toBe(false);

    const reviewPass = job({
      id: 'job_rev2',
      title: 'Review',
      kind: 'task',
      parentJobId: 'job_impl',
      expertId: 'checker-1',
      expertRole: 'review',
      status: 'done',
      resultSummary: '{"verdict":"pass","findings":[],"required_fixes":[]}',
    });
    expect(evaluateReviewChainForMerge({ job: implement, jobs: [implement, reviewPass] })).toEqual({
      ok: true,
    });

    const reviewSameExpert = {
      ...reviewPass,
      id: 'job_rev3',
      expertId: 'maker-1',
    };
    const collision = evaluateReviewChainForMerge({
      job: implement,
      jobs: [implement, reviewSameExpert],
    });
    expect(collision.ok).toBe(false);
    if (!collision.ok) expect(collision.reason).toMatch(/Maker≠Checker|expertId/i);
  });

  it('enqueues a review child on implement done (fake store)', async () => {
    const store = memoryStore();
    const parent = createJob(store, {
      title: 'Ship footer',
      kind: 'implement',
      prompt: 'Implement the footer component',
      ownershipPaths: ['apps/site/src/components/Footer.tsx'],
      expertId: 'frontend-engineer',
      expertRole: 'implement',
    });
    patchJob(store, parent.id, { status: 'done', resultSummary: 'footer shipped' });
    const done = { ...parent, status: 'done' as const, resultSummary: 'footer shipped' };
    const review = await enqueueReviewJobForParent(store, done);
    expect(review).toBeDefined();
    expect(review?.parentJobId).toBe(parent.id);
    expect(review?.expertRole === 'review' || review?.expertRole === 'visual-qa').toBe(true);
    expect(review?.expertId).not.toBe('frontend-engineer');
    // Idempotent — second enqueue is a no-op.
    expect(await enqueueReviewJobForParent(store, done)).toBeUndefined();
    expect(listJobs(store).filter((j) => j.parentJobId === parent.id)).toHaveLength(1);
  });

  it('onJobTerminal enqueues debug after failing review verdict', async () => {
    const store = memoryStore();
    const parent = createJob(store, {
      title: 'Broken button',
      kind: 'implement',
      expertId: 'maker-x',
      expertRole: 'implement',
    });
    patchJob(store, parent.id, { status: 'done' });
    await onJobTerminalForReviewChain(store, {
      ...parent,
      status: 'done',
    });
    const review = listJobs(store).find(
      (j) => j.expertRole === 'review' || j.expertRole === 'visual-qa',
    );
    expect(review).toBeDefined();
    patchJob(store, review!.id, {
      status: 'done',
      resultSummary: '{"verdict":"fail","findings":["click noop"],"required_fixes":["wire handler"]}',
      expertId: 'checker-y',
      expertRole: review!.expertRole,
    });
    const reviewDone = listJobs(store).find((j) => j.id === review!.id)!;
    await onJobTerminalForReviewChain(store, reviewDone);
    expect(listJobs(store).some((j) => j.expertRole === 'debug')).toBe(true);
    // Idempotent debug enqueue.
    expect(await enqueueDebugJobForReview(store, parent, reviewDone)).toBeUndefined();
  });
});
