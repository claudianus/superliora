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
    expect(
      parseReviewVerdict(
        '{"verdict":"pass","standards":{"verdict":"pass","findings":[]},"spec":{"verdict":"fail","findings":["missing AC"]}}',
      ),
    ).toBe('failed');
    expect(parseReviewVerdict('{"standards":{"verdict":"pass","findings":[]}}')).toBe('passed');
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

  it('enqueues a visual-qa review child on UI implement done', async () => {
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
    // Soft reader: no exclusive write lease — paths stay on context only.
    expect(review?.ownershipPaths).toBeUndefined();
    expect(review?.contextPaths).toContain('apps/site/src/components/Footer.tsx');
    // Idempotent — second enqueue is a no-op.
    expect(await enqueueReviewJobForParent(store, done)).toBeUndefined();
    expect(listJobs(store).filter((j) => j.parentJobId === parent.id)).toHaveLength(1);
  });

  it('enqueues parallel Standards∥Spec review children for non-UI implement', async () => {
    const store = memoryStore();
    const parent = createJob(store, {
      title: 'Fix scheduler',
      kind: 'implement',
      prompt: 'Fix job scheduler ordering',
      ownershipPaths: ['packages/agent-core/src/tools/builtin/job/job-runtime.ts'],
      successCriteria: ['nextQueuedJobs respects blocked_by'],
      testSeams: ['nextQueuedJobs'],
      expertId: 'maker-x',
      expertRole: 'implement',
    });
    const done = { ...parent, status: 'done' as const, resultSummary: 'fixed' };
    await enqueueReviewJobForParent(store, done);
    const reviews = listJobs(store).filter((j) => j.parentJobId === parent.id);
    expect(reviews).toHaveLength(2);
    expect(reviews.map((r) => r.reviewAxis).sort()).toEqual(['spec', 'standards']);
    expect(reviews[0]?.prompt).toMatch(/success criteria|Agreed test seams/i);
  });

  it('onJobTerminal enqueues debug after both axis reviews fail aggregate', async () => {
    const store = memoryStore();
    const parent = createJob(store, {
      title: 'Broken button',
      kind: 'implement',
      expertId: 'maker-x',
      expertRole: 'implement',
      ownershipPaths: ['src/Button.js'],
    });
    patchJob(store, parent.id, { status: 'done' });
    await onJobTerminalForReviewChain(store, {
      ...parent,
      status: 'done',
    });
    const reviews = listJobs(store).filter(
      (j) => j.expertRole === 'review' || j.expertRole === 'visual-qa',
    );
    expect(reviews.length).toBeGreaterThanOrEqual(1);
    for (const review of reviews) {
      expect(review.ownershipPaths).toBeUndefined();
      patchJob(store, review.id, {
        status: 'done',
        resultSummary:
          review.reviewAxis === 'standards'
            ? '{"standards":{"verdict":"pass","findings":[]},"verdict":"pass"}'
            : '{"verdict":"fail","findings":["click noop"],"required_fixes":["wire handler"]}',
        expertId: `checker-${review.reviewAxis ?? 'ui'}`,
        expertRole: review.expertRole,
      });
      await onJobTerminalForReviewChain(store, listJobs(store).find((j) => j.id === review.id)!);
    }
    const debug = listJobs(store).find((j) => j.expertRole === 'debug');
    expect(debug).toBeDefined();
    // Debug fixer still claims write ownership on the parent paths.
    expect(debug?.ownershipPaths).toEqual(['src/Button.js']);
    // Idempotent debug enqueue.
    const failedReview = reviews.find((r) => r.reviewAxis === 'spec') ?? reviews[0]!;
    expect(await enqueueDebugJobForReview(store, parent, failedReview)).toBeUndefined();
  });
});
