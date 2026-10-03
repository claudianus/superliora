import { mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execPath } from 'node:process';
import { join } from 'pathe';
import { LocalKaos, type Kaos, type KaosProcess } from '@superliora/kaos';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runGit } from '../../src/session/job/git';
import { closeJobRuntime, enqueueJobWorkerSpawn, getJobWorkerSpawner } from '../../src/session/job/job-offload';
import { createSessionWorktree, gcSessionWorktrees, isSessionWorktreeOwned, listSessionWorktrees, removeSessionWorktree, worktreeRegistryPath } from '../../src/session/worktree';
import { __resetJobWorkerHandlesForTests, clearJobWorkerHandle, getJobWorkerHandle, registerJobWorkerHandle } from '../../src/tools/builtin/job/job-handles';
import { runMergeLandJob, type LandJobToMainResult } from '../../src/tools/builtin/job/job-land';
import { resolveMergePushCwd, sameRepoPath } from '../../src/tools/builtin/job/job-git-root';
import { createJob, getJob, patchJob } from '../../src/tools/builtin/job/job-ledger';
import { getJobNativeFailure, hasJobNativeResources, settleJobNativeResources } from '../../src/tools/builtin/job/job-native-resources';
import { gcConductorJobWorktrees, scheduleQueuedJobs, waitForJobScheduling } from '../../src/tools/builtin/job/job-runtime';
import { cancelJobWorker } from '../../src/tools/builtin/job/job-worker';
import type { ToolStore } from '../../src/tools/store';
import type { Agent } from '../../src/agent';

const roots: string[] = [];
const cleanupFixtures: (() => Promise<unknown>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanupFixtures.splice(0)) await cleanup();
  __resetJobWorkerHandlesForTests();
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

function memoryStore(): ToolStore {
  const data = new Map<string, unknown>();
  return { get: (key: string) => data.get(key), set: (key: string, value: unknown) => data.set(key, value) } as ToolStore;
}

async function nativeFixture() {
  const root = await mkdtemp(join(tmpdir(), 'liora-job-native-'));
  roots.push(root);
  const home = join(root, 'home');
  const kaos = await LocalKaos.create();
  vi.stubEnv('SUPERLIORA_HOME', home);
  const command = async (args: readonly string[]) => {
    const result = await runGit(kaos, root, args);
    if (!result.ok) throw new Error(result.stderr || result.stdout);
  };
  await command(['init', '--initial-branch=main']);
  await command(['config', 'user.name', 'Test']);
  await command(['config', 'user.email', 'test@example.com']);
  await writeFile(join(root, 'source.txt'), 'baseline\n');
  await command(['add', 'source.txt']);
  await command(['commit', '-m', 'test: initialize native fixture']);
  return { root, home, kaos };
}

async function ageRegistry(home: string): Promise<void> {
  const path = worktreeRegistryPath(home);
  const registry = JSON.parse(await readFile(path, 'utf8')) as { entries: { lastAccessedAt: string }[] };
  for (const entry of registry.entries) entry.lastAccessedAt = '2000-01-01T00:00:00.000Z';
  await writeFile(path, JSON.stringify(registry));
}

function gatedDisposalKaos(kaos: Kaos) {
  let allowDispose = false;
  let released = false;
  let executions = 0;
  let originalProcess: KaosProcess | undefined;
  const failingKaos = Object.create(kaos) as Kaos;
  failingKaos.exec = async (...args: string[]) => {
    executions += 1;
    originalProcess = await kaos.exec(...args);
    const process = originalProcess;
    return {
      pid: process.pid, stdin: process.stdin, stdout: process.stdout, stderr: process.stderr,
      get exitCode() { return process.exitCode; },
      get resourcesSettled() { return released; },
      wait: () => process.wait(), kill: (signal) => process.kill(signal),
      async dispose() {
        if (!allowDispose) throw new Error('native disposal blocked');
        await process.dispose();
        released = process.resourcesSettled === true;
      },
    };
  };
  return {
    kaos: failingKaos,
    allowDispose: () => { allowDispose = true; },
    get released() { return released; },
    get executions() { return executions; },
    get process() { return originalProcess; },
  };
}

describe('native Job ownership', () => {
  it('immediate and TTL GC in another session keep an aborted worker path until actual release', async () => {
    const { root, home, kaos } = await nativeFixture();
    const tree = await createSessionWorktree(kaos, { repoPath: root, name: 'owned', bootstrapRepo: false });
    await ageRegistry(home);
    const storeA = memoryStore();
    const storeB = memoryStore();
    const owner = createJob(storeA, { title: 'Native owner' });
    patchJob(storeA, owner.id, { status: 'running', worktreePath: tree.workDir, repoRoot: root });
    const alias = createJob(storeB, { title: 'Done alias to the same path' });
    patchJob(storeB, alias.id, { status: 'done', worktreePath: tree.workDir, repoRoot: root });
    const controller = new AbortController();
    const handle = registerJobWorkerHandle(storeA, owner.id, controller, [join(tree.workDir, 'nested')]);
    let released = false;
    handle.resourcesSettled = () => released;
    controller.abort();
    clearJobWorkerHandle(owner.id);
    expect(getJobWorkerHandle(owner.id)).toBe(handle);
    const gc = await gcConductorJobWorktrees({ store: storeB, kaos, failTtlDays: 1 });
    expect(gc).toEqual({ removedJobIds: [], gc: { removed: 0, kept: 1 } });
    expect(getJob(storeB, alias.id)?.worktreePath).toBe(tree.workDir);
    expect((await stat(tree.workDir)).isDirectory()).toBe(true);
    await expect(removeSessionWorktree(kaos, { nameOrPath: tree.workDir })).rejects.toThrow('still owned');
    released = true;
    clearJobWorkerHandle(owner.id);
    expect((await gcConductorJobWorktrees({ store: storeB, kaos, failTtlDays: 1 })).removedJobIds).toEqual([alias.id]);
    expect(await listSessionWorktrees()).toEqual([]);
  }, 60_000);

  it('protects the actual preparation target before a ledger path exists and close joins preparation', async () => {
    const { root, home, kaos } = await nativeFixture();
    const store = memoryStore();
    const job = createJob(store, { title: 'Preparing native tree' });
    const prepared = Promise.withResolvers<string>();
    const finish = Promise.withResolvers<void>();
    const launch = vi.fn(async () => {});
    const scheduling = scheduleQueuedJobs({
      store, kaos, repoPath: root, ensureGitRepo: false, launchWorker: launch,
      createWorktree: async (_kaos, input) => {
        const tree = await createSessionWorktree(kaos, { ...input, bootstrapRepo: false });
        prepared.resolve(tree.workDir);
        await finish.promise;
        return tree;
      },
    });
    cleanupFixtures.push(async () => {
      closeJobRuntime(store);
      finish.resolve();
      await scheduling;
      await waitForJobScheduling(store);
    });
    const path = await prepared.promise;
    expect(getJob(store, job.id)?.worktreePath).toBeUndefined();
    expect(hasJobNativeResources(store, job.id)).toBe(true);
    await ageRegistry(home);
    expect((await gcSessionWorktrees(kaos, { maxAgeDays: 1 })).kept).toBe(1);
    expect((await stat(path)).isDirectory()).toBe(true);
    closeJobRuntime(store);
    let joined = false;
    const closing = waitForJobScheduling(store).then(() => { joined = true; });
    await Promise.resolve();
    expect(joined).toBe(false);
    finish.resolve();
    await scheduling;
    await closing;
    expect(launch).not.toHaveBeenCalled();
    expect(getJob(store, job.id)).toMatchObject({ status: 'queued', worktreePath: path });
    expect(hasJobNativeResources(store, job.id)).toBe(false);
    expect((await gcSessionWorktrees(kaos, { maxAgeDays: 1 })).removed.map((entry) => entry.path)).toEqual([path]);
  }, 60_000);

  it('retains a real Git process disposal failure and explicitly settles that process without replay', async () => {
    const { root, home, kaos } = await nativeFixture();
    const tree = await createSessionWorktree(kaos, { repoPath: root, name: 'failed-native-git', bootstrapRepo: false });
    const repoAlias = join(root, 'repo-alias');
    await symlink(root, repoAlias, process.platform === 'win32' ? 'junction' : 'dir');
    expect(sameRepoPath(repoAlias, tree.meta.repoRoot)).toBe(true);
    expect(resolveMergePushCwd({
      persistedRepoRoot: repoAlias, worktreePath: tree.workDir, sessionRepoPath: repoAlias, mode: 'land',
    }).hold?.hold).toBe(false);
    await ageRegistry(home);
    const store = memoryStore();
    const source = createJob(store, { title: 'Source' });
    patchJob(store, source.id, { status: 'done', worktreePath: tree.workDir, worktreeBranch: tree.meta.branch, repoRoot: repoAlias });
    const merge = createJob(store, { title: 'Land', kind: 'merge', parentJobId: source.id });
    patchJob(store, merge.id, { status: 'running' });
    const native = gatedDisposalKaos(kaos);
    cleanupFixtures.push(async () => {
      native.allowDispose();
      await cancelJobWorker({ store, jobId: merge.id });
      await settleJobNativeResources(store);
    });
    let failure: unknown;
    let outcome: LandJobToMainResult | undefined;
    try { outcome = await runMergeLandJob({ store, mergeJob: getJob(store, merge.id)!, kaos: native.kaos, repoPath: repoAlias }); }
    catch (error) { failure = error; }
    expect(outcome).toBeUndefined();
    expect(native.executions).toBe(1);
    expect(failure).toHaveProperty('resourcesSettled', false);
    expect(getJob(store, merge.id)?.status).toBe('running');
    expect(getJobWorkerHandle(merge.id)?.failure).toBe(failure);
    expect(isSessionWorktreeOwned(tree.workDir, root)).toBe(true);
    expect((await gcConductorJobWorktrees({ store: memoryStore(), kaos, failTtlDays: 1 })).gc).toEqual({ removed: 0, kept: 1 });
    await expect(cancelJobWorker({ store, jobId: merge.id })).rejects.toHaveProperty('resourcesSettled', false);
    expect(native.executions).toBe(1);
    expect(native.released).toBe(false);
    expect((await listSessionWorktrees())[0]?.path).toBe(tree.workDir);
    native.allowDispose();
    const stopped = await cancelJobWorker({ store, jobId: merge.id });
    expect(stopped.job?.status).toBe('failed');
    expect(stopped.job?.resultSummary).toBe((failure as Error).message);
    expect(failure).toHaveProperty('resourcesSettled', true);
    expect(native.released).toBe(true);
    expect(native.process?.exitCode).not.toBeNull();
    expect(native.executions).toBe(1);
    expect(getJobWorkerHandle(merge.id)).toBeUndefined();
    await settleJobNativeResources(store);
    expect(isSessionWorktreeOwned(tree.workDir, root)).toBe(false);
    expect((await gcSessionWorktrees(kaos, { maxAgeDays: 1 })).removed).toHaveLength(1);
  }, 60_000);

  it('a preparation rejection joins every admitted worker before it throws and retains the failed native owner', async () => {
    const { root, kaos } = await nativeFixture();
    const tree = await createSessionWorktree(kaos, { repoPath: root, name: 'admitted-before-failure', bootstrapRepo: false });
    const store = memoryStore();
    const workerJob = createJob(store, { title: 'Admitted worker', priority: 10 });
    patchJob(store, workerJob.id, { worktreePath: tree.workDir, worktreeBranch: tree.meta.branch, repoRoot: root });
    const preparingJob = createJob(store, { title: 'Rejected preparation' });
    const native = gatedDisposalKaos(kaos);
    const stopping = Promise.withResolvers<void>();
    const finishWorkerCleanup = Promise.withResolvers<void>();
    let workerProcess: KaosProcess | undefined;
    let workerReleased = false;
    const scheduling = scheduleQueuedJobs({
      store, kaos, repoPath: root, ensureGitRepo: false, maxConcurrent: 2,
      createWorktree: (_kaos, input) => createSessionWorktree(native.kaos, input),
      launchWorker: async (job) => {
        expect(job.id).toBe(workerJob.id);
        workerProcess = await kaos.exec(execPath, '-e', 'process.stdin.resume()');
        const process = workerProcess;
        const handle = registerJobWorkerHandle(store, job.id, new AbortController(), [tree.workDir]);
        handle.workerAgentId = 'native_schedule_worker';
        handle.resourcesSettled = () => workerReleased ? true : undefined;
        handle.stopAndJoin = async () => {
          stopping.resolve();
          await finishWorkerCleanup.promise;
          await process.kill('SIGTERM');
          await process.wait();
          await process.dispose();
          workerReleased = process.resourcesSettled === true;
          clearJobWorkerHandle(job.id);
        };
      },
    });
    let finished = false;
    const outcome = scheduling.then(
      () => { finished = true; return undefined; },
      (error: unknown) => { finished = true; return error; },
    );
    cleanupFixtures.push(async () => {
      closeJobRuntime(store);
      native.allowDispose();
      finishWorkerCleanup.resolve();
      await cancelJobWorker({ store, jobId: workerJob.id });
      await outcome;
      await cancelJobWorker({ store, jobId: preparingJob.id });
      await settleJobNativeResources(store);
    });
    await stopping.promise;
    expect(finished).toBe(false);
    expect(getJobWorkerHandle(workerJob.id)).toBeDefined();
    expect(workerReleased).toBe(false);
    expect(hasJobNativeResources(store, preparingJob.id)).toBe(true);
    finishWorkerCleanup.resolve();
    const failure = await outcome;
    expect(failure).toHaveProperty('resourcesSettled', false);
    expect(workerReleased).toBe(true);
    expect(workerProcess?.resourcesSettled).toBe(true);
    expect(getJobWorkerHandle(workerJob.id)).toBeUndefined();
    const originalFailure = getJobNativeFailure(store, preparingJob.id) as Error;
    expect(originalFailure.cause).toHaveProperty('message', 'native disposal blocked');
    expect(getJob(store, preparingJob.id)?.resultSummary).toBe(originalFailure.message);
    closeJobRuntime(store);
    await expect(waitForJobScheduling(store)).rejects.toHaveProperty('resourcesSettled', false);
    native.allowDispose();
    await waitForJobScheduling(store);
    expect(native.executions).toBe(1);
    expect(native.released).toBe(true);
    expect(hasJobNativeResources(store, preparingJob.id)).toBe(false);
    expect(getJob(store, preparingJob.id)?.resultSummary).toBe(originalFailure.message);
  }, 60_000);

  it('closing one store synchronously rejects its queue without cancelling another store', async () => {
    const first = memoryStore();
    const second = memoryStore();
    const firstJob = createJob(first, { title: 'Closed admission' });
    const secondJob = createJob(second, { title: 'Independent admission' });
    patchJob(first, firstJob.id, { status: 'running' });
    patchJob(second, secondJob.id, { status: 'running' });
    const firstSpawner = getJobWorkerSpawner(first);
    const secondSpawner = getJobWorkerSpawner(second);
    const firstRun = vi.fn(async () => {});
    const secondRun = vi.fn(async () => {});
    firstSpawner.enqueue({ key: firstJob.id, run: firstRun });
    secondSpawner.enqueue({ key: secondJob.id, run: secondRun });
    closeJobRuntime(first);
    expect(enqueueJobWorkerSpawn({ store: first, agent: { config: { cwd: '/repo' } } as Agent, job: getJob(first, firstJob.id)! })).toEqual({ queued: false, duplicate: false });
    await Promise.all([firstSpawner.settle(), secondSpawner.settle()]);
    expect(firstRun).not.toHaveBeenCalled();
    expect(secondRun).toHaveBeenCalledTimes(1);
  });
});
