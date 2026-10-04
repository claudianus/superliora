import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { FileCoordinatorStore, SessionCoordinator, type TrustedVerificationPlan } from '../../../src/session/coordinator';
import { sealVerificationArtifact } from '../../../src/session/execution/verification';

async function fixture(script: string | ((directory: string) => string)) {
  const directory = await mkdtemp(join(tmpdir(), 'conductor-verification-'));
  const repoPath = join(directory, 'producer');
  const git = (...args: string[]) => execFileSync('git', ['-C', repoPath, ...args], { encoding: 'utf8' }).trim();
  execFileSync('git', ['init', '--initial-branch=main', repoPath], { stdio: 'ignore' });
  git('config', 'user.name', 'Test User'); git('config', 'user.email', 'test@example.test');
  await writeFile(join(repoPath, 'source.txt'), 'source'); git('add', '.'); git('commit', '-m', 'test: seal source');
  const revision = git('rev-parse', 'HEAD');
  const requirementsHash = createHash('sha256').update('requirements').digest('hex');
  const stages = [{ id: 'check', command: [process.execPath, '-e', typeof script === 'string' ? script : script(directory)], scope: '.', timeoutMs: 10000 }];
  const hostPolicy = { authorize: vi.fn(() => {}) };
  const artifact = await sealVerificationArtifact({ repoPath, sourceRevision: revision, requirementsHash, stages, hostPolicy });
  const plan: TrustedVerificationPlan = { id: 'trusted-check', hostPolicy, repoPath, artifact, evidenceRoot: join(directory, 'evidence'), currentRequirementsHash: () => requirementsHash };
  const coordinator = await SessionCoordinator.open({ store: await FileCoordinatorStore.open(join(directory, 'coordinator.json')), policy: { role: 'conductor', maxConcurrent: 1, authorizedRoots: [directory] }, verificationPlans: [plan], runtime: { admit: async (id) => ({ sessionId: id, completion: Promise.resolve('Observed turn only'), message: async () => {} }) } });
  const accepted = await coordinator.dispatch({ prompt: 'Implement source', description: 'Source', cwd: repoPath, sourceRevision: revision }, 'produce');
  await vi.waitFor(() => expect(coordinator.get(accepted.id)?.status).toBe('idle'));
  return { directory, coordinator, id: accepted.id, plan };
}

describe('trusted verification registry is a real coordinator consumer', () => {
  it('accepts by host plan ID before execution and publishes actual revision-bound evidence', async () => {
    const f = await fixture("console.log('verified source')");
    try {
      await expect(f.coordinator.verify(f.id, 'model-command', f.coordinator.get(f.id)!.revision)).rejects.toThrow('not registered');
      const accepted = await f.coordinator.verify(f.id, f.plan.id, f.coordinator.get(f.id)!.revision);
      expect(accepted.verification?.status).toBe('accepted');
      await vi.waitFor(() => expect(f.coordinator.get(f.id)?.verification?.status).toBe('passed'));
      const receipt = f.coordinator.get(f.id)!.verification!.receipt!;
      expect(receipt.sourceRevision).toBe(f.plan.artifact.sourceRevision);
      expect(receipt.artifactHash).toBe(f.plan.artifact.artifactHash);
      expect(receipt.stages[0]?.exitCode).toBe(0);
      expect(await readFile(receipt.stages[0]!.stdoutPath, 'utf8')).toContain('verified source');
      expect(f.coordinator.get(f.id)?.status).toBe('idle');
    } finally { await f.coordinator.close(); await rm(f.directory, { recursive: true, force: true }); }
  });

  it('acknowledges cancellation separately and stores cancelled only after physical verification settlement', async () => {
    const f = await fixture((directory) => `require('fs').writeFileSync(${JSON.stringify(join(directory, 'started'))}, 'ready'); setInterval(() => {}, 1000)`);
    try {
      await f.coordinator.verify(f.id, f.plan.id, f.coordinator.get(f.id)!.revision);
      // Synchronize to the verification command actually running, not coordinator bookkeeping.
      await vi.waitFor(() => readFile(join(f.directory, 'started')), { timeout: 10000, interval: 10 });
      const acknowledged = await f.coordinator.stop(f.id, f.coordinator.get(f.id)!.revision);
      expect(acknowledged.verification?.cancelRequested).toBe(true);
      await vi.waitFor(() => expect(f.coordinator.get(f.id)?.verification?.status).toBe('cancelled'));
      expect(f.coordinator.get(f.id)?.verification?.receipt?.status).toBe('cancelled');
      expect(f.coordinator.get(f.id)?.verification?.receipt?.stages[0]).toMatchObject({ stageId: 'check', cancelled: true, timedOut: false });
    } finally { await f.coordinator.close(); await rm(f.directory, { recursive: true, force: true }); }
  });
});
