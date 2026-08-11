import { describe, expect, it } from 'vitest';

import {
  enqueueDebugJobForVerify,
  enqueueVerifyJobForParent,
  evaluateVerifyChainForMerge,
  healVerifyVerdictFromSummary,
  makerCheckerCollision,
  onJobTerminalForVerifyChain,
  parseVerifyVerdict,
  resolveVerifyChildVerdict,
  shouldEnqueueVerifyAfterDone,
} from '../../src/tools/builtin/job/job-verify-chain';
import { createJob, getJob, listJobs, patchJob } from '../../src/tools/builtin/job/job-ledger';
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

  it('parses fenced and truncated dual-axis JSON (summary budget cuts mid-findings)', () => {
    const fenced = [
      '## Summary\noverall pass',
      '```json',
      '{"verdict":"pass","standards":{"verdict":"pass","findings":[]},"spec":{"verdict":"pass","findings":[]}}',
      '```',
    ].join('\n');
    expect(parseVerifyVerdict(fenced)).toBe('passed');

    // Real failure mode: 4k slice cuts the JSON object open.
    const truncated = `
## Summary
${'x'.repeat(200)}
\`\`\`json
{
  "verdict": "pass",
  "standards": {
    "verdict": "pass",
    "findings": [{"id":"build","status":"pass"}]
  },
  "spec": {
    "verdict": "pass",
    "findings": [
      {
        "id": "title_deploy_to_playing",
        "status": "pass",
        "evidence": "VerifySurface click DEPLOY @e2 → Playing HU`;
    expect(parseVerifyVerdict(truncated)).toBe('passed');
    expect(parseVerifyVerdict('overall pass in prose only')).toBeUndefined();
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

    const verifyProseOnly = job({
      id: 'job_ver_prose',
      title: 'Verify',
      kind: 'verify',
      parentJobId: 'job_impl',
      expertId: 'checker-1',
      status: 'done',
      // Prose PASS alone is not enough — need dual-axis / verdict JSON.
      resultSummary: 'Delete-pass verify PASS. All criteria look good.',
    });
    const proseGate = evaluateVerifyChainForMerge({
      job: implement,
      jobs: [implement, verifyProseOnly],
    });
    expect(proseGate.ok).toBe(false);
    if (!proseGate.ok) {
      expect(proseGate.reason).toMatch(/verdict=missing.*dual-axis JSON/i);
      expect(proseGate.reason).not.toMatch(/debug\/implement/i);
    }

    // Summary JSON without a stamped field still counts (resume heal / parse path).
    const verifyJsonUnstamped = job({
      id: 'job_ver_json',
      title: 'Verify',
      kind: 'verify',
      parentJobId: 'job_impl',
      expertId: 'checker-1',
      status: 'done',
      resultSummary: '{"verdict":"pass","findings":[],"required_fixes":[]}',
    });
    expect(
      evaluateVerifyChainForMerge({
        job: implement,
        jobs: [implement, verifyJsonUnstamped],
      }),
    ).toEqual({ ok: true });

    const verifyPass = job({
      id: 'job_ver2',
      title: 'Verify',
      kind: 'verify',
      parentJobId: 'job_impl',
      expertId: 'checker-1',
      status: 'done',
      resultSummary: '{"verdict":"pass","findings":[],"required_fixes":[]}',
      verifyVerdict: 'passed',
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

  it('enqueues a verify child on web surfaceKind implement done', async () => {
    const store = memoryStore();
    const parent = createJob(store, {
      title: 'Ship footer',
      kind: 'implement',
      prompt: 'Implement the footer component',
      ownershipPaths: ['apps/site/src/components/Footer.tsx'],
      expertId: 'frontend-engineer',
      surfaceKind: 'web',
    });
    patchJob(store, parent.id, { status: 'done', resultSummary: 'footer shipped' });
    const done = {
      ...parent,
      status: 'done' as const,
      resultSummary: 'footer shipped',
      surfaceKind: 'web' as const,
    };
    const verify = await enqueueVerifyJobForParent(store, done);
    expect(verify).toBeDefined();
    expect(verify?.parentJobId).toBe(parent.id);
    expect(verify?.kind).toBe('verify');
    expect(verify?.expertId).not.toBe('frontend-engineer');
    expect(verify?.surfaceKind).toBe('web');
    // Soft reader: no exclusive write lease — paths stay on context only.
    expect(verify?.ownershipPaths).toBeUndefined();
    expect(verify?.contextPaths).toContain('apps/site/src/components/Footer.tsx');
    // Idempotent — second enqueue is a no-op.
    expect(await enqueueVerifyJobForParent(store, done)).toBeUndefined();
    expect(listJobs(store).filter((j) => j.parentJobId === parent.id)).toHaveLength(1);
  });

  it('enqueues TUI verify (not VerifySurface) when surfaceKind=tui', async () => {
    const store = memoryStore();
    const parent = createJob(store, {
      title: 'Idle stage',
      kind: 'implement',
      prompt: 'Polish TUI idle stage',
      ownershipPaths: ['apps/liora/src/tui/components/idle-stage.ts'],
      expertId: 'frontend-engineer',
      surfaceKind: 'tui',
    });
    const done = { ...parent, status: 'done' as const, surfaceKind: 'tui' as const };
    const verify = await enqueueVerifyJobForParent(store, done);
    expect(verify).toBeDefined();
    expect(verify?.prompt).toMatch(/TUI visual smoke|smoke:visual/i);
    expect(verify?.prompt).not.toMatch(/VerifySurface load\+interaction/);
    expect(listJobs(store).filter((j) => j.parentJobId === parent.id)).toHaveLength(1);
  });

  it('enqueues parallel Standards∥Spec when surfaceKind is none/absent (not path regex)', async () => {
    const store = memoryStore();
    const parent = createJob(store, {
      title: 'Fix scheduler',
      kind: 'implement',
      prompt: 'Fix job scheduler ordering',
      ownershipPaths: ['packages/agent-core/src/tools/builtin/job/job-runtime.ts'],
      successCriteria: ['nextQueuedJobs respects blocked_by'],
      testSeams: ['nextQueuedJobs'],
      expertId: 'maker-x',
      surfaceKind: 'none',
    });
    const done = { ...parent, status: 'done' as const, resultSummary: 'fixed' };
    await enqueueVerifyJobForParent(store, done);
    const verifies = listJobs(store).filter((j) => j.parentJobId === parent.id);
    expect(verifies).toHaveLength(2);
    expect(verifies.map((r) => r.reviewAxis).sort()).toEqual(['spec', 'standards']);
    expect(verifies[0]?.prompt).toMatch(/success criteria|Agreed test seams/i);
  });

  it('prefers stamped verifyVerdict; heals parseable summary JSON for merge', () => {
    const implement = job({
      id: 'job_impl',
      title: 'Feature',
      kind: 'implement',
      expertId: 'maker-1',
    });
    const verifyStamped = job({
      id: 'job_ver',
      title: 'Verify',
      kind: 'verify',
      parentJobId: 'job_impl',
      expertId: 'checker-1',
      status: 'done',
      // Free-text has no JSON — stamped field is what counts.
      resultSummary: 'All good — PASS visually and by criteria.',
      verifyVerdict: 'passed',
    });
    expect(resolveVerifyChildVerdict(verifyStamped)).toBe('passed');
    expect(
      evaluateVerifyChainForMerge({ job: implement, jobs: [implement, verifyStamped] }),
    ).toEqual({ ok: true });

    const store = memoryStore();
    const failedFormat = createJob(store, {
      title: 'Verify heal',
      kind: 'verify',
      parentJobId: 'job_impl',
    });
    patchJob(store, failedFormat.id, {
      status: 'failed',
      notes: 'worker: verify finished without structured verifyVerdict',
      resultSummary:
        'structured verifyVerdict missing — {"verdict":"pass","findings":[],"required_fixes":[]}',
    });
    const healed = healVerifyVerdictFromSummary(store, getJob(store, failedFormat.id)!);
    expect(healed?.verifyVerdict).toBe('passed');
    expect(healed?.status).toBe('done');
    expect(resolveVerifyChildVerdict(getJob(store, failedFormat.id)!)).toBe('passed');
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

  it('onJobTerminal fails free-text verify, retries once, and skips Debug', async () => {
    const store = memoryStore();
    const parent = createJob(store, {
      title: 'Delete-pass',
      kind: 'implement',
      expertId: 'maker-x',
      ownershipPaths: ['src/App.js'],
      surfaceKind: 'none',
    });
    patchJob(store, parent.id, { status: 'done' });
    await onJobTerminalForVerifyChain(store, { ...parent, status: 'done' });
    const firstWave = listJobs(store).filter((j) => j.kind === 'verify');
    expect(firstWave).toHaveLength(2);

    for (const verify of firstWave) {
      patchJob(store, verify.id, {
        status: 'done',
        // Human-readable PASS with no dual-axis JSON — MergeJob must not trust this.
        resultSummary: 'Delete-pass verify PASS. All criteria look good.',
        expertId: `checker-${verify.reviewAxis ?? 'ui'}`,
      });
      await onJobTerminalForVerifyChain(store, listJobs(store).find((j) => j.id === verify.id)!);
    }

    const afterRetry = listJobs(store).filter((j) => j.kind === 'verify');
    expect(afterRetry.length).toBe(4);
    expect(afterRetry.filter((j) => j.notes?.includes('structured_verdict_retry'))).toHaveLength(2);
    expect(
      listJobs(store).find((j) => j.kind === 'implement' && j.title.startsWith('Debug:')),
    ).toBeUndefined();

    const failedOriginals = firstWave.map((v) => listJobs(store).find((j) => j.id === v.id)!);
    for (const v of failedOriginals) {
      expect(v.status).toBe('failed');
      expect(v.verifyVerdict).toBeUndefined();
    }

    // Retry also missing → still no Debug; merge points at requeue-verify, not debug.
    const retries = afterRetry.filter((j) => j.notes?.includes('structured_verdict_retry'));
    for (const verify of retries) {
      patchJob(store, verify.id, {
        status: 'done',
        resultSummary: 'still just PASS in prose',
        expertId: verify.expertId,
      });
      await onJobTerminalForVerifyChain(store, listJobs(store).find((j) => j.id === verify.id)!);
    }
    expect(
      listJobs(store).find((j) => j.kind === 'implement' && j.title.startsWith('Debug:')),
    ).toBeUndefined();
    // No third wave.
    expect(listJobs(store).filter((j) => j.kind === 'verify')).toHaveLength(4);

    const parentLatest = listJobs(store).find((j) => j.id === parent.id)!;
    const gate = evaluateVerifyChainForMerge({
      job: parentLatest,
      jobs: listJobs(store),
    });
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.reason).toMatch(/verdict=missing.*dual-axis JSON/i);
    }
  });

  it('merge prefers latest verify per axis after structured retry passes', async () => {
    const implement = job({
      id: 'job_impl',
      title: 'Feature',
      kind: 'implement',
      expertId: 'maker-1',
    });
    const oldMissing = job({
      id: 'job_ver_old',
      title: 'Verify',
      kind: 'verify',
      parentJobId: 'job_impl',
      expertId: 'checker-1',
      status: 'failed',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:01.000Z',
      resultSummary: 'PASS in prose',
    });
    const retryPass = job({
      id: 'job_ver_new',
      title: 'Re-verify',
      kind: 'verify',
      parentJobId: 'job_impl',
      expertId: 'checker-1',
      status: 'done',
      createdAt: '2026-01-01T00:00:02.000Z',
      updatedAt: '2026-01-01T00:00:03.000Z',
      notes: 'structured_verdict_retry',
      verifyVerdict: 'passed',
      resultSummary: '{"verdict":"pass","findings":[],"required_fixes":[]}',
    });
    expect(
      evaluateVerifyChainForMerge({
        job: implement,
        jobs: [implement, oldMissing, retryPass],
      }),
    ).toEqual({ ok: true });
  });
});
