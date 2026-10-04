import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { FileCoordinatorStore, SessionCoordinator } from '../../../src/session/coordinator';
import type { TrustedPipelinePlan, TrustedPipelineStage } from '../../../src/session/execution/pipeline';

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'coordinator-pipeline-'));
  const repo = join(directory, 'repo');
  execFileSync('git', ['init', '--initial-branch=main', repo], { stdio: 'ignore' });
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
  git('config', 'user.name', 'Test User'); git('config', 'user.email', 'test@example.test');
  await writeFile(join(repo, 'source.txt'), 'initial'); git('add', '.'); git('commit', '-m', 'test: create source');
  const stage: TrustedPipelineStage = {
    id: 'build', dependencies: [], maxRepairAttempts: 1, repoPath: repo, evidenceRoot: join(directory, 'evidence'),
    verificationStages: [{ id: 'check', command: [process.execPath, '-e', "process.exit(require('fs').readFileSync('source.txt','utf8') === 'repaired' ? 0 : 1)"], scope: '.', timeoutMs: 10000 }],
    hostPolicy: { authorize: () => {} }, currentRequirementsHash: () => createHash('sha256').update('requirements').digest('hex'),
    currentRevision: () => git('rev-parse', 'HEAD'), produce: vi.fn(async () => git('rev-parse', 'HEAD')),
    repair: vi.fn(async () => { await writeFile(join(repo, 'source.txt'), 'repaired'); git('add', '.'); git('commit', '-m', 'fix: repair source'); return git('rev-parse', 'HEAD'); }),
  };
  const plan: TrustedPipelinePlan = { id: 'host-pipeline', stages: [{ ...stage, id: 'consumer', dependencies: ['build'], maxRepairAttempts: 0, repair: undefined }, stage] };
  const coordinator = await SessionCoordinator.open({ store: await FileCoordinatorStore.open(join(directory, 'projection.json')), policy: { role: 'conductor', maxConcurrent: 1, authorizedRoots: [directory] }, trustedPipelinePlans: [plan], runtime: { admit: async () => { throw new Error('Pipeline must not invoke session runtime'); } } });
  return { directory, coordinator, plan, stage };
}

describe('coordinator consumes trusted dependency plans', () => {
  it('keeps a stop committed after the pipeline returned success instead of publishing finished', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'coordinator-pipeline-race-'));
    const repo = join(directory, 'repo');
    execFileSync('git', ['init', '--initial-branch=main', repo], { stdio: 'ignore' });
    const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
    git('config', 'user.name', 'Test User'); git('config', 'user.email', 'test@example.test');
    await writeFile(join(repo, 'source.txt'), 'initial'); git('add', '.'); git('commit', '-m', 'test: create source');
    let coordinator!: SessionCoordinator;
    let id = '';
    let revisionProbes = 0;
    const stopped = Promise.withResolvers<void>();
    const stage: TrustedPipelineStage = {
      id: 'build', dependencies: [], maxRepairAttempts: 0, repoPath: repo, evidenceRoot: join(directory, 'evidence'),
      verificationStages: [{ id: 'check', command: [process.execPath, '-e', 'process.exit(0)'], scope: '.', timeoutMs: 10000 }],
      hostPolicy: { authorize: () => {} }, currentRequirementsHash: () => createHash('sha256').update('requirements').digest('hex'),
      // Probes 1-4 gate the stage itself; probe 5 is the final publication refresh, after
      // which the pipeline returns without further I/O. The stop's durable write cannot
      // finish (and abort) before the pipeline result is queued for commit.
      currentRevision: () => {
        if (++revisionProbes === 5) void coordinator.stop(id, coordinator.get(id)!.revision).then(() => { stopped.resolve(); }, stopped.reject);
        return git('rev-parse', 'HEAD');
      },
      produce: async () => git('rev-parse', 'HEAD'),
    };
    coordinator = await SessionCoordinator.open({ store: await FileCoordinatorStore.open(join(directory, 'projection.json')), policy: { role: 'conductor', maxConcurrent: 1, authorizedRoots: [directory] }, trustedPipelinePlans: [{ id: 'host-pipeline', stages: [stage] }], runtime: { admit: async () => { throw new Error('Pipeline must not invoke session runtime'); } } });
    try {
      id = (await coordinator.startPipeline('host-pipeline', 'pipeline')).id;
      await stopped.promise;
      await vi.waitFor(() => { expect(coordinator.get(id)?.lease).toBeUndefined(); }, { timeout: 10000 });
      expect(revisionProbes).toBe(5);
      expect(coordinator.get(id)).toMatchObject({ status: 'cancelled', pipeline: { status: 'cancelled', result: { status: 'success' } } });
    } finally { await coordinator.close(); await rm(directory, { recursive: true, force: true }); }
  });

  it('persists acceptance by plan ID before callbacks, gates dependent stages on receipts, and bounds repair', async () => {
    const f = await fixture();
    try {
      await expect(f.coordinator.startPipeline('model-command', 'bad')).rejects.toThrow('not registered');
      const accepted = await f.coordinator.startPipeline(f.plan.id, 'pipeline');
      expect(accepted).toMatchObject({ kind: 'pipeline', status: 'accepted', pipeline: { status: 'accepted' } });
      expect(f.stage.produce).not.toHaveBeenCalled();
      expect((await f.coordinator.startPipeline(f.plan.id, 'pipeline')).id).toBe(accepted.id);
      await vi.waitFor(() => expect(f.coordinator.get(accepted.id)?.status).toBe('finished'), { timeout: 10000 });
      const result = f.coordinator.get(accepted.id)!.pipeline!.result!;
      expect(result.status).toBe('success');
      expect(result.stages.map((stage) => [stage.stageId, stage.attempts])).toEqual([['build', 2], ['consumer', 1]]);
      expect(f.stage.repair).toHaveBeenCalledTimes(1);
      const receipts = result.stages.flatMap((stage) => stage.receipts);
      expect(receipts.map((receipt) => receipt.status)).toEqual(['failed', 'passed', 'passed']);
      expect(JSON.parse(await readFile(receipts[1]!.evidencePath, 'utf8'))).toEqual(receipts[1]);
      expect(f.coordinator.fact(accepted.id)?.pipeline).toEqual({ planId: f.plan.id, status: 'success' });
    } finally { await f.coordinator.close(); await rm(f.directory, { recursive: true, force: true }); }
  });

  it('acknowledges cancellation before the producer joins and publishes terminal only after join', async () => {
    const f = await fixture();
    const entered = Promise.withResolvers<AbortSignal>();
    const physicallySettled = Promise.withResolvers<void>();
    const stage = f.stage as { produce: TrustedPipelineStage['produce'] };
    stage.produce = async (context) => { entered.resolve(context.executionSignal!); await physicallySettled.promise; context.executionSignal!.throwIfAborted(); return f.stage.currentRevision(); };
    try {
      const accepted = await f.coordinator.startPipeline(f.plan.id, 'pipeline');
      const owned = await entered.promise;
      const acknowledged = await f.coordinator.stop(accepted.id, f.coordinator.get(accepted.id)!.revision);
      expect(acknowledged.status).toBe('cancel_requested');
      expect(owned.aborted).toBe(true);
      expect(f.coordinator.get(accepted.id)?.lease).toBeDefined();
      expect(f.coordinator.get(accepted.id)?.pipeline?.status).toBe('running');
      physicallySettled.resolve();
      await vi.waitFor(() => expect(f.coordinator.get(accepted.id)?.status).toBe('cancelled'));
      expect(f.coordinator.get(accepted.id)?.pipeline?.result?.status).toBe('cancelled');
      expect(f.coordinator.get(accepted.id)?.lease).toBeUndefined();
    } finally { physicallySettled.resolve(); await f.coordinator.close(); await rm(f.directory, { recursive: true, force: true }); }
  });
});
