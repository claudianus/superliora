import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VerificationReceipt } from '../../../src/session/execution/verification';
import { runTrustedPipeline, type TrustedPipelineStage, type PipelineContext } from '../../../src/session/execution/pipeline';

const roots: string[] = [];
const requirementsHash = createHash('sha256').update('requirements').digest('hex');
const git = (repo: string, ...args: string[]): string => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
async function fixture(script = "console.log('verified')") {
  const root = await mkdtemp(join(tmpdir(), 'pipeline-test-'));
  roots.push(root);
  const repoPath = join(root, 'repo');
  git(root, 'init', '--initial-branch=main', repoPath);
  git(repoPath, 'config', 'user.name', 'Test User');
  git(repoPath, 'config', 'user.email', 'test@example.test');
  await writeFile(join(repoPath, 'source.txt'), 'initial');
  git(repoPath, 'add', '.');
  git(repoPath, 'commit', '-m', 'test: create fixture');
  const revision = git(repoPath, 'rev-parse', 'HEAD');
  const produce = vi.fn(async () => revision);
  const stage: TrustedPipelineStage = {
    id: 'build', dependencies: [], maxRepairAttempts: 0, repoPath, evidenceRoot: join(root, 'evidence'),
    verificationStages: [{ id: 'test', command: [process.execPath, '-e', script], scope: '.', timeoutMs: 10_000 }],
    hostPolicy: { authorize: () => {} }, currentRequirementsHash: () => requirementsHash,
    currentRevision: () => git(repoPath, 'rev-parse', 'HEAD'), produce,
  };
  return { root, repoPath, revision, produce, stage };
}
const run = (...stages: TrustedPipelineStage[]) => runTrustedPipeline({ id: 'host-plan', stages });
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

describe('trusted dependency pipeline', () => {
  it('validates cycles, missing and duplicate dependencies before any production', async () => {
    const f = await fixture();
    await expect(run({ ...f.stage, dependencies: ['missing'] })).rejects.toThrow('Unknown dependency');
    await expect(run({ ...f.stage, dependencies: ['build'] })).rejects.toThrow('cycle');
    await expect(run(f.stage, f.stage)).rejects.toThrow('duplicate');
    await expect(run({ ...f.stage, dependencies: ['build', 'build'] })).rejects.toThrow('Duplicate dependency');
    expect(f.produce).not.toHaveBeenCalled();
  });

  it('validates the bounded repair budget before production', async () => {
    const f = await fixture();
    for (const maxRepairAttempts of [-1, 1.5, 9, Infinity]) {
      await expect(run({ ...f.stage, maxRepairAttempts })).rejects.toThrow('0–8');
    }
    await expect(run({ ...f.stage, maxRepairAttempts: 1 })).rejects.toThrow('callback required');
    expect(f.produce).not.toHaveBeenCalled();
  });

  it('executes readiness in stable topological order and gates success with real evidence', async () => {
    const f = await fixture();
    const result = await run({ ...f.stage, id: 'consumer', dependencies: ['build'] }, f.stage,
      { ...f.stage, id: 'independent' });
    expect(result.status).toBe('success');
    expect(result.stages.map(stage => stage.stageId)).toEqual(['build', 'consumer', 'independent']);
    for (const stage of result.stages) {
      expect(stage.attempts).toBe(1);
      const receipt = stage.receipts[0]!;
      expect(receipt.sourceRevision).toBe(f.revision);
      expect(receipt.requirementsHash).toBe(requirementsHash);
      expect(receipt.stages[0]?.exitCode).toBe(0);
      const stdout = await readFile(receipt.stages[0]!.stdoutPath);
      expect(createHash('sha256').update(stdout).digest('hex')).toBe(receipt.stages[0]?.stdoutHash);
      expect(stdout.toString()).toBe('verified\n');
    }
  });

  it('repairs a failed sealed revision once and reverifies a newly committed revision', async () => {
    const f = await fixture("process.exit(require('fs').readFileSync('source.txt','utf8') === 'fixed' ? 0 : 7)");
    const repair = vi.fn(async (context: PipelineContext & { receipt: VerificationReceipt }) => {
      expect(context.attempt).toBe(1);
      expect(context.receipt.stages[0]!.exitCode).toBe(7);
      await writeFile(join(f.repoPath, 'source.txt'), 'fixed');
      git(f.repoPath, 'add', '.');
      git(f.repoPath, 'commit', '-m', 'fix: repair fixture');
      return git(f.repoPath, 'rev-parse', 'HEAD');
    });
    const result = await run({ ...f.stage, maxRepairAttempts: 2, repair });
    expect(result.status).toBe('success');
    expect(result.stages[0]?.attempts).toBe(2);
    expect(result.stages[0]?.receipts.map(receipt => receipt.status)).toEqual(['failed', 'passed']);
    expect(result.stages[0]?.receipts[1]?.sourceRevision).not.toBe(f.revision);
    expect(repair).toHaveBeenCalledTimes(1);
  });

  it('exhausts the exact repair bound, blocks dependents, and continues independent stages', async () => {
    const f = await fixture('process.exit(3)');
    const repair = vi.fn(async () => f.revision);
    const consumer = vi.fn(async () => f.revision);
    const result = await run({ ...f.stage, maxRepairAttempts: 2, repair },
      { ...f.stage, id: 'consumer', dependencies: ['build'], produce: consumer },
      { ...f.stage, id: 'independent', verificationStages: [{ ...f.stage.verificationStages[0]!, command: [process.execPath, '-e', 'process.exit(0)'] }] });
    expect(result.status).toBe('failed');
    expect(result.stages.map(stage => stage.status)).toEqual(['failed', 'blocked', 'success']);
    expect(result.stages[0]?.attempts).toBe(3);
    expect(repair).toHaveBeenCalledTimes(2);
    expect(consumer).not.toHaveBeenCalled();
  });

  it('blocks changed requirements during production without sealing or repairing', async () => {
    const f = await fixture();
    let current = requirementsHash;
    const repair = vi.fn(async () => f.revision);
    const result = await run({ ...f.stage, maxRepairAttempts: 1, repair,
      currentRequirementsHash: () => current, produce: async () => { current = 'a'.repeat(64); return f.revision; } });
    expect(result.status).toBe('blocked');
    expect(result.stages[0]?.attempts).toBe(0);
    expect(repair).not.toHaveBeenCalled();
  });

  it('never marks a passed receipt verified when the live revision changes during verification', async () => {
    const f = await fixture();
    let live = f.revision;
    const result = await run({ ...f.stage, currentRevision: () => live,
      hostPolicy: { authorize: input => { if (input.operation === 'verify') live = 'b'.repeat(40); } } });
    expect(result.stages[0]?.receipts[0]?.status).toBe('passed');
    expect(result.status).toBe('blocked');
  });

  it('blocks requirements changed by verification authorization instead of attempting repair', async () => {
    const f = await fixture();
    let current = requirementsHash;
    const repair = vi.fn(async () => f.revision);
    const result = await run({ ...f.stage, maxRepairAttempts: 1, repair, currentRequirementsHash: () => current,
      hostPolicy: { authorize: input => { if (input.operation === 'verify') current = 'c'.repeat(64); } } });
    expect(result.status).toBe('blocked');
    expect(result.stages[0]?.receipts[0]?.status).toBe('stale');
    expect(repair).not.toHaveBeenCalled();
  });

  it('rejects tampered output bytes even when the executor receipt says passed', async () => {
    const f = await fixture();
    const result = await run({ ...f.stage, currentRequirementsHash: async () => {
      try {
        for (const dir of await readdir(f.stage.evidenceRoot)) {
          // The freshness hook after execution runs after the executor writes logs.
          const log = join(f.stage.evidenceRoot, dir, 'test.stdout.log');
          try { await readFile(log); await writeFile(log, 'tampered'); } catch { /* Not yet written. */ }
        }
      } catch { /* Evidence does not exist before execution. */ }
      return requirementsHash;
    } });
    expect(result.stages[0]?.receipts[0]?.status).toBe('passed');
    expect(result.status).toBe('failed');
    expect(result.stages[0]?.failure).toBe('Verification evidence mismatch');
  });

  it('honors execution-owned cancellation and waits for producer settlement', async () => {
    const f = await fixture();
    const controller = new AbortController();
    let settle!: () => void;
    let entered!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const barrier = new Promise<void>(resolve => { settle = resolve; });
    let finished = false;
    const pending = runTrustedPipeline({ id: 'host-plan', stages: [{ ...f.stage, produce: async context => {
      expect(context.executionSignal).toBe(controller.signal);
      entered(); await barrier; return f.revision;
    } }, { ...f.stage, id: 'later' }] }, { executionSignal: controller.signal }).then(result => { finished = true; return result; });
    await ready;
    controller.abort();
    await Promise.resolve();
    expect(finished).toBe(false);
    settle();
    const result = await pending;
    expect(result.status).toBe('cancelled');
    expect(result.stages.map(stage => stage.status)).toEqual(['cancelled', 'cancelled']);
    expect(result.stages[0]?.attempts).toBe(0);
    expect(f.produce).not.toHaveBeenCalled();
  });

  it('blocks a dependency that goes stale before its consumer becomes ready', async () => {
    const f = await fixture();
    let live = f.revision;
    const consumer = vi.fn(async () => f.revision);
    const result = await run({ ...f.stage, currentRevision: () => live },
      { ...f.stage, id: 'intervening', produce: async () => { live = 'd'.repeat(40); return f.revision; } },
      { ...f.stage, id: 'consumer', dependencies: ['build'], produce: consumer });
    expect(result.stages.map(stage => stage.status)).toEqual(['blocked', 'success', 'blocked']);
    expect(consumer).not.toHaveBeenCalled();
  });

  it('rechecks every successful receipt at final pipeline publication', async () => {
    const f = await fixture();
    let requirements = requirementsHash;
    const result = await run({ ...f.stage, currentRequirementsHash: () => requirements },
      { ...f.stage, id: 'consumer', dependencies: ['build'] },
      { ...f.stage, id: 'last', produce: async () => { requirements = 'e'.repeat(64); return f.revision; } });
    expect(result.status).toBe('blocked');
    expect(result.stages.map(stage => stage.status)).toEqual(['blocked', 'blocked', 'success']);
    expect(result.stages[0]?.receipts[0]?.status).toBe('passed');
  });

  it('cancels the real verifier process and publishes its settled cancellation receipt', async () => {
    const f = await fixture();
    const marker = join(f.root, 'started');
    const controller = new AbortController();
    const pending = runTrustedPipeline({ id: 'host-plan', stages: [{ ...f.stage,
      verificationStages: [{ ...f.stage.verificationStages[0]!, command: [process.execPath, '-e',
        "require('fs').writeFileSync(" + JSON.stringify(marker) + ", 'ready'); setInterval(() => {}, 1000)"] }],
    }] }, { executionSignal: controller.signal });
    // Synchronize with actual native command start, not a wall-clock delay.
    while (true) {
      try { await readFile(marker); break; } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        const finished = await Promise.race([pending.then(() => true), new Promise<false>(resolve => setTimeout(() => { resolve(false); }, 10))]);
        if (finished) throw new Error('Verifier settled before command readiness', { cause: error });
      }
    }
    controller.abort();
    const result = await pending;
    expect(result.status).toBe('cancelled');
    const receipt = result.stages[0]!.receipts[0]!;
    expect(receipt.status).toBe('cancelled');
    expect(receipt.stages[0]?.cancelled).toBe(true);
    expect(receipt.stages[0]?.exitCode).not.toBe(0);
    expect(JSON.parse(await readFile(receipt.evidencePath, 'utf8'))).toEqual(receipt);
  });

  it('returns explicit failure on denied trusted-host authorization', async () => {
    const f = await fixture();
    const result = await run({ ...f.stage, hostPolicy: { authorize: () => { throw new Error('denied'); } } });
    expect(result.status).toBe('failed');
    expect(result.stages[0]?.failure).toBe('denied');
    expect(result.stages[0]?.receipts).toEqual([]);
  });
});
