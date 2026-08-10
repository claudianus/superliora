import { describe, expect, it } from 'vitest';

import {
  enqueueDebugJobForVerify,
  enqueueVerifyJobForParent,
  evaluateVerifyChainForMerge,
  makerCheckerCollision,
  onJobTerminalForVerifyChain,
  parseVerifyVerdict,
  shouldEnqueueVerifyAfterDone,
} from '../../src/tools/builtin/job/job-verify-chain';
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

describe('job-verify-chain', () => {
  it('parses JSON and line verdicts', () => {
    expect(parseVerifyVerdict('{"verdict":"pass","findings":[]}')).toBe('passed');
    expect(parseVerifyVerdict('notes\nverdict: fail\n')).toBe('failed');
    expect(parseVerifyVerdict('no verdict here')).toBeUndefined();
    expect(
      parseVerifyVerdict(
        '{"verdict":"pass","standards":{"verdict":"pass","findings":[]},"spec":{"verdict":"fail","findings":["missing AC"]}}',
      ),
    ).toBe('failed');
    expect(parseVerifyVerdict('{"standards":{"verdict":"pass","findings":[]}}')).toBe('passed');
  });

  it('detects maker=checker collision', () => {
    expect(makerCheckerCollision('eng-a', 'eng-a')).toBe(true);
    expect(makerCheckerCollision('eng-a', 'eng-b')).toBe(false);
    expect(makerCheckerCollision(undefined, 'eng-b')).toBe(false);
  });

  it('enqueues verify only for implement/task done kinds', () => {
    expect(
      shouldEnqueueVerifyAfterDone(job({ id: 'job_1', title: 't', kind: 'implement' })),
    ).toBe(true);
    expect(
      shouldEnqueueVerifyAfterDone(job({ id: 'job_2', title: 't', kind: 'verify' })),
    ).toBe(false);
    expect(shouldEnqueueVerifyAfterDone(job({ id: 'job_3', title: 't', kind: 'explore' }))).toBe(
      false,
    );
    expect(shouldEnqueueVerifyAfterDone(job({ id: 'job_4', title: 't', kind: 'research' }))).toBe(
      false,
    );
    expect(
      shouldEnqueueVerifyAfterDone(
        job({ id: 'job_5', title: 'Debug: t', kind: 'implement', parentJobId: 'job_1' }),
      ),
    ).toBe(false);
  });

  it('blocks merge until independent verify passes', () => {
    const implement = job({
      id: 'job_impl',
      title: 'Feature',
      kind: 'implement',
      expertId: 'maker-1',
    });
    expect(evaluateVerifyChainForMerge({ job: implement, jobs: [implement] }).ok).toBe(false);

    const verifyRunning = job({
      id: 'job_ver',
      title: 'Verify',
      kind: 'verify',
      parentJobId: 'job_impl',
      expertId: 'checker-1',
      status: 'running',
    });
    expect(
      evaluateVerifyChainForMerge({ job: implement, jobs: [implement, verifyRunning] }).ok,
    ).toBe(false);

    const verifyPass = job({
      id: 'job_ver2',
      title: 'Verify',
      kind: 'verify',
      parentJobId: 'job_impl',
      expertId: 'checker-1',
      status: 'done',
      resultSummary: '{"verdict":"pass","findings":[],"required_fixes":[]}',
    });
    expect(evaluateVerifyChainForMerge({ job: implement, jobs: [implement, verifyPass] })).toEqual({
      ok: true,
    });

    const verifySameExpert = {
      ...verifyPass,
      id: 'job_ver3',
      expertId: 'maker-1',
    };
    const collision = evaluateVerifyChainForMerge({
      job: implement,
      jobs: [implement, verifySameExpert],
    });
    expect(collision.ok).toBe(false);
    if (!collision.ok) expect(collision.reason).toMatch(/Maker≠Checker|expertId/i);
  });

  it('enqueues a verify child on UI implement done', async () => {
    const store = memoryStore();
    const parent = createJob(store, {
      title: 'Ship footer',
      kind: 'implement',
      prompt: 'Implement the footer component',
      ownershipPaths: ['apps/site/src/components/Footer.tsx'],
      expertId: 'frontend-engineer',
    });
    patchJob(store, parent.id, { status: 'done', resultSummary: 'footer shipped' });
    const done = { ...parent, status: 'done' as const, resultSummary: 'footer shipped' };
    const verify = await enqueueVerifyJobForParent(store, done);
    expect(verify).toBeDefined();
    expect(verify?.parentJobId).toBe(parent.id);
    expect(verify?.kind).toBe('verify');
    expect(verify?.expertId).not.toBe('frontend-engineer');
    // Soft reader: no exclusive write lease — paths stay on context only.
    expect(verify?.ownershipPaths).toBeUndefined();
    expect(verify?.contextPaths).toContain('apps/site/src/components/Footer.tsx');
    // Idempotent — second enqueue is a no-op.
    expect(await enqueueVerifyJobForParent(store, done)).toBeUndefined();
    expect(listJobs(store).filter((j) => j.parentJobId === parent.id)).toHaveLength(1);
  });

  it('enqueues parallel Standards∥Spec verify children for non-UI implement', async () => {
    const store = memoryStore();
    const parent = createJob(store, {
      title: 'Fix scheduler',
      kind: 'implement',
      prompt: 'Fix job scheduler ordering',
      ownershipPaths: ['packages/agent-core/src/tools/builtin/job/job-runtime.ts'],
      successCriteria: ['nextQueuedJobs respects blocked_by'],
      testSeams: ['nextQueuedJobs'],
      expertId: 'maker-x',
    });
    const done = { ...parent, status: 'done' as const, resultSummary: 'fixed' };
    await enqueueVerifyJobForParent(store, done);
    const verifies = listJobs(store).filter((j) => j.parentJobId === parent.id);
    expect(verifies).toHaveLength(2);
    expect(verifies.map((r) => r.reviewAxis).sort()).toEqual(['spec', 'standards']);
    expect(verifies[0]?.prompt).toMatch(/success criteria|Agreed test seams/i);
  });

  it('onJobTerminal enqueues debug after both axis verifies fail aggregate', async () => {
    const store = memoryStore();
    const parent = createJob(store, {
      title: 'Broken button',
      kind: 'implement',
      expertId: 'maker-x',
      ownershipPaths: ['src/Button.js'],
    });
    patchJob(store, parent.id, { status: 'done' });
    await onJobTerminalForVerifyChain(store, {
      ...parent,
      status: 'done',
    });
    const verifies = listJobs(store).filter((j) => j.kind === 'verify');
    expect(verifies.length).toBeGreaterThanOrEqual(1);
    for (const verify of verifies) {
      expect(verify.ownershipPaths).toBeUndefined();
      patchJob(store, verify.id, {
        status: 'done',
        resultSummary:
          verify.reviewAxis === 'standards'
            ? '{"standards":{"verdict":"pass","findings":[]},"verdict":"pass"}'
            : '{"verdict":"fail","findings":["click noop"],"required_fixes":["wire handler"]}',
        expertId: `checker-${verify.reviewAxis ?? 'ui'}`,
      });
      await onJobTerminalForVerifyChain(store, listJobs(store).find((j) => j.id === verify.id)!);
    }
    const debug = listJobs(store).find(
      (j) => j.kind === 'implement' && j.title.startsWith('Debug:'),
    );
    expect(debug).toBeDefined();
    // Debug fixer still claims write ownership on the parent paths.
    expect(debug?.ownershipPaths).toEqual(['src/Button.js']);
    // Idempotent debug enqueue.
    const failedVerify = verifies.find((r) => r.reviewAxis === 'spec') ?? verifies[0]!;
    expect(await enqueueDebugJobForVerify(store, parent, failedVerify)).toBeUndefined();
  });
});
