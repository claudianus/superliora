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

  it('enqueues a verify child on implement done (fake store)', async () => {
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

  it('onJobTerminal enqueues debug after failing verify verdict', async () => {
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
    const verify = listJobs(store).find((j) => j.kind === 'verify');
    expect(verify).toBeDefined();
    expect(verify?.ownershipPaths).toBeUndefined();
    patchJob(store, verify!.id, {
      status: 'done',
      resultSummary: '{"verdict":"fail","findings":["click noop"],"required_fixes":["wire handler"]}',
      expertId: 'checker-y',
    });
    const verifyDone = listJobs(store).find((j) => j.id === verify!.id)!;
    await onJobTerminalForVerifyChain(store, verifyDone);
    const debug = listJobs(store).find(
      (j) => j.kind === 'implement' && j.title.startsWith('Debug:'),
    );
    expect(debug).toBeDefined();
    // Debug fixer still claims write ownership on the parent paths.
    expect(debug?.ownershipPaths).toEqual(['src/Button.js']);
    // Idempotent debug enqueue.
    expect(await enqueueDebugJobForVerify(store, parent, verifyDone)).toBeUndefined();
  });
});
