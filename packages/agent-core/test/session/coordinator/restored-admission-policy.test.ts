import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canonicalPath } from '../../../src/session/coordinator/authorized-path';
import { FileCoordinatorStore, SessionCoordinator, type CoordinatorProjection, type CoordinatorStore } from '../../../src/session/coordinator';
import type { TrustedPipelinePlan, TrustedPipelineStage } from '../../../src/session/execution/pipeline';

const roots: string[] = [];
const coordinators: SessionCoordinator[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(async () => {
  await Promise.all(coordinators.splice(0).map((coordinator) => coordinator.close()));
  vi.useRealTimers();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'queued-admission-policy-'));
  roots.push(root);
  const a = join(root, 'allowed-a'); const b = join(root, 'allowed-b');
  await mkdir(a); await mkdir(b);
  const path = join(root, 'projection.json');
  const runtime = { admit: vi.fn(async () => { throw new Error('Runtime must not be called'); }) };
  const open = async (authorizedRoots: string[], plans: TrustedPipelinePlan[] = []) => {
    const store = await FileCoordinatorStore.open(path);
    const saves = vi.spyOn(store, 'save');
    const coordinator = await SessionCoordinator.open({ store, runtime, policy: { role: 'conductor', maxConcurrent: 4, authorizedRoots }, trustedPipelinePlans: plans });
    coordinators.push(coordinator);
    return { coordinator, saves };
  };
  const produce = vi.fn(async () => 'a'.repeat(40));
  const currentRevision = vi.fn(() => 'a'.repeat(40));
  const currentRequirementsHash = vi.fn(() => 'b'.repeat(64));
  const authorize = vi.fn(() => {});
  const stage: TrustedPipelineStage = {
    id: 'build', repoPath: a, evidenceRoot: join(root, 'evidence'), dependencies: [], maxRepairAttempts: 0,
    verificationStages: [{ id: 'test', command: [process.execPath, '-e', "console.log('trusted check')"], scope: '.', timeoutMs: 1000 }],
    hostPolicy: { authorize }, currentRevision, currentRequirementsHash, produce,
  };
  return { root, a, b, path, runtime, open, stage, produce, currentRevision, currentRequirementsHash, authorize };
}

async function persistAcceptedPipeline(f: Awaited<ReturnType<typeof fixture>>) {
  const source = await f.open([f.a, f.b], [{ id: 'host-plan', stages: [f.stage] }]);
  const record = await source.coordinator.startPipeline('host-plan', 'queued-operation');
  expect(record.pipeline?.binding).toMatchObject({ version: 1, fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) });
  expect(f.produce).not.toHaveBeenCalled();
  expect(f.currentRequirementsHash).not.toHaveBeenCalled();
  expect(f.currentRevision).not.toHaveBeenCalled();
  expect(f.authorize).not.toHaveBeenCalled();
  await source.coordinator.close();
  return record;
}

describe('reopened queued admission honors current authority', () => {
  it('fails a real persisted accepted session when its workspace authority was revoked', async () => {
    const f = await fixture();
    const source = await f.open([f.a]);
    const record = await source.coordinator.dispatch({ prompt: 'Task', description: 'Task', cwd: f.a, ownership: ['src'] }, 'queued-session');
    await source.coordinator.close();
    const restored = await f.open([f.b]);
    await restored.coordinator.tick();
    expect(restored.coordinator.get(record.id)).toMatchObject({ status: 'failed', error: expect.stringContaining('current authorized roots') });
    expect(restored.coordinator.get(record.id)?.lease).toBeUndefined();
    expect(f.runtime.admit).not.toHaveBeenCalled();
    expect(restored.saves.mock.calls.every(([projection]) => projection.records[0]?.lease === undefined)).toBe(true);
    const persisted = JSON.parse(await readFile(f.path, 'utf8')) as CoordinatorProjection;
    expect(persisted.records[0]?.status).toBe('failed');
  });

  it('recanonicalizes restored claims and rejects a new symlink escape before leasing', async () => {
    const f = await fixture();
    const claim = join(f.a, 'mutable'); await mkdir(claim);
    const source = await f.open([f.a]);
    const record = await source.coordinator.dispatch({ prompt: 'Task', description: 'Task', cwd: f.a, ownership: ['mutable/new-file.ts'] }, 'queued-session');
    await source.coordinator.close();
    await rm(claim, { recursive: true });
    await symlink(f.b, claim, process.platform === 'win32' ? 'junction' : 'dir');
    const restored = await f.open([f.a]);
    await restored.coordinator.tick();
    expect(restored.coordinator.get(record.id)?.status).toBe('failed');
    expect(restored.coordinator.get(record.id)?.lease).toBeUndefined();
    expect(f.runtime.admit).not.toHaveBeenCalled();
  });

  it('rechecks current roots after lease persistence and before the runtime callback', async () => {
    const f = await fixture();
    const allowed = [f.a];
    const source = await f.open(allowed);
    const record = await source.coordinator.dispatch({ prompt: 'Task', description: 'Task', cwd: f.a }, 'queued-session');
    source.coordinator.onChange((snapshot) => { if (snapshot.records.some((card) => card.status === 'admitting')) allowed[0] = f.b; });
    await source.coordinator.tick();
    await vi.waitFor(() => expect(source.coordinator.get(record.id)?.status).toBe('failed'));
    expect(f.runtime.admit).not.toHaveBeenCalled();
    expect(source.coordinator.get(record.id)?.lease).toBeUndefined();
  });
});

describe('restored pipeline authority is bound to its accepted static configuration', () => {
  it('blocks same-ID repository drift even when both roots are authorized, without leasing or invoking the producer', async () => {
    const f = await fixture();
    const accepted = await persistAcceptedPipeline(f);
    const changedProduce = vi.fn(async () => 'c'.repeat(40));
    const restored = await f.open([f.a, f.b], [{ id: 'host-plan', stages: [{ ...f.stage, repoPath: f.b, produce: changedProduce }] }]);
    await restored.coordinator.tick();
    expect(restored.coordinator.get(accepted.id)).toMatchObject({ status: 'failed', pipeline: { status: 'blocked' }, error: expect.stringContaining('static binding changed') });
    expect(restored.coordinator.get(accepted.id)?.request.ownership).toEqual([await canonicalPath(f.a)]);
    expect(restored.coordinator.get(accepted.id)?.lease).toBeUndefined();
    expect(restored.saves.mock.calls.every(([projection]) => projection.records[0]?.lease === undefined)).toBe(true);
    expect(f.produce).not.toHaveBeenCalled(); expect(changedProduce).not.toHaveBeenCalled();
    expect(f.currentRevision).not.toHaveBeenCalled(); expect(f.currentRequirementsHash).not.toHaveBeenCalled(); expect(f.authorize).not.toHaveBeenCalled();
  });

  it.each(['argv', 'timeout', 'budget', 'evidence'] as const)('blocks same-ID static %s changes before producer execution', async (field) => {
    const f = await fixture();
    const accepted = await persistAcceptedPipeline(f);
    const changed: TrustedPipelineStage = {
      ...f.stage,
      verificationStages: f.stage.verificationStages.map((check) => ({ ...check, command: field === 'argv' ? [process.execPath, '-e', "console.log('changed')"] : check.command, timeoutMs: field === 'timeout' ? 2000 : check.timeoutMs })),
      maxRepairAttempts: field === 'budget' ? 1 : 0,
      repair: field === 'budget' ? async () => 'c'.repeat(40) : undefined,
      evidenceRoot: field === 'evidence' ? join(f.root, 'changed-evidence') : f.stage.evidenceRoot,
    };
    const restored = await f.open([f.a, f.b], [{ id: 'host-plan', stages: [changed] }]);
    await restored.coordinator.tick();
    expect(restored.coordinator.get(accepted.id)?.pipeline?.status).toBe('blocked');
    expect(restored.coordinator.get(accepted.id)?.lease).toBeUndefined();
    expect(f.produce).not.toHaveBeenCalled();
  });

  it('blocks a queued pipeline when the host bumps its callback version', async () => {
    const f = await fixture();
    const source = await f.open([f.a, f.b], [{ id: 'host-plan', callbackVersion: 'v1', stages: [f.stage] }]);
    const accepted = await source.coordinator.startPipeline('host-plan', 'queued-operation');
    await source.coordinator.close();
    const changedProduce = vi.fn(async () => 'c'.repeat(40));
    const restored = await f.open([f.a, f.b], [{ id: 'host-plan', callbackVersion: 'v2', stages: [{ ...f.stage, produce: changedProduce }] }]);
    await restored.coordinator.tick();
    expect(restored.coordinator.get(accepted.id)).toMatchObject({ status: 'failed', pipeline: { status: 'blocked' }, error: expect.stringContaining('static binding changed') });
    expect(restored.coordinator.get(accepted.id)?.lease).toBeUndefined();
    expect(f.produce).not.toHaveBeenCalled(); expect(changedProduce).not.toHaveBeenCalled();
  });

  it('binds dependency edges even when stage IDs and workspace claims are unchanged', async () => {
    const f = await fixture();
    const dependent = { ...f.stage, id: 'dependent', dependencies: ['build'] };
    const source = await f.open([f.a, f.b], [{ id: 'host-plan', stages: [f.stage, dependent] }]);
    const accepted = await source.coordinator.startPipeline('host-plan', 'queued-operation');
    await source.coordinator.close();
    const restored = await f.open([f.a, f.b], [{ id: 'host-plan', stages: [f.stage, { ...dependent, dependencies: [] }] }]);
    await restored.coordinator.tick();
    expect(restored.coordinator.get(accepted.id)?.pipeline?.status).toBe('blocked');
    expect(restored.coordinator.get(accepted.id)?.lease).toBeUndefined();
    expect(f.produce).not.toHaveBeenCalled();
  });

  it('retains the real caller without inventing a pipeline worker subject or aliasing the conductor', async () => {
    const f = await fixture();
    const plans = [{ id: 'host-plan', stages: [f.stage] }];
    const source = await f.open([f.a, f.b], plans);
    const origin = { agentId: 'main', sessionId: 'conductor-session', parentAgentId: null, parentSessionId: null, rootAgentId: 'main', rootSessionId: 'conductor-session', conductorAgentId: 'main', conductorSessionId: 'conductor-session', status: 'root' as const };
    const record = await source.coordinator.startPipeline('host-plan', 'operation', origin);
    expect(record.workerAncestry).toBeUndefined();
    expect(source.coordinator.fact(record.id)).toMatchObject({ kind: 'pipeline', coordinationId: record.id, originAncestry: origin, parentAgentId: 'main', parentSessionId: 'conductor-session' });
    expect(source.coordinator.fact(record.id)?.workerAncestry).toBeUndefined();
    await source.coordinator.close();
    const restored = await f.open([f.a, f.b], plans);
    expect(restored.coordinator.fact(record.id)?.workerAncestry).toBeUndefined();
    expect(restored.coordinator.fact(record.id)).toMatchObject({ coordinationId: record.id, originAncestry: origin, parentAgentId: 'main', parentSessionId: 'conductor-session' });
    await restored.coordinator.stop(record.id, restored.coordinator.get(record.id)!.revision);
    expect(restored.coordinator.fact(record.id)?.coordinationId).toBe(record.id);
    expect(restored.coordinator.fact(record.id)).toMatchObject({ status: 'cancelled', pipeline: { planId: 'host-plan', status: 'cancelled' } });
    expect(f.produce).not.toHaveBeenCalled();
  });

  it('normalizes legacy pipeline caller-as-subject metadata without inventing a worker alias', async () => {
    const f = await fixture();
    const accepted = await persistAcceptedPipeline(f);
    const projection = JSON.parse(await readFile(f.path, 'utf8')) as CoordinatorProjection;
    const origin = { agentId: 'main', sessionId: 'conductor-session', parentAgentId: null, parentSessionId: null, rootAgentId: 'main', rootSessionId: 'conductor-session', status: 'root' as const };
    projection.records[0]!.workerAncestry = origin;
    await writeFile(f.path, JSON.stringify(projection));
    const restored = await f.open([f.a, f.b], [{ id: 'host-plan', stages: [f.stage] }]);
    expect(restored.coordinator.get(accepted.id)?.workerAncestry).toBeUndefined();
    expect(restored.coordinator.fact(accepted.id)).toMatchObject({ originAncestry: origin, parentAgentId: 'main', parentSessionId: 'conductor-session', coordinationId: accepted.id });
    expect(restored.coordinator.fact(accepted.id)?.workerAncestry).toBeUndefined();
    expect(f.produce).not.toHaveBeenCalled();
  });

  it('fails closed on legacy queued pipeline records without static binding', async () => {
    const f = await fixture();
    const accepted = await persistAcceptedPipeline(f);
    const projection = JSON.parse(await readFile(f.path, 'utf8')) as CoordinatorProjection;
    delete projection.records[0]!.pipeline!.binding;
    await writeFile(f.path, JSON.stringify(projection));
    const restored = await f.open([f.a, f.b], [{ id: 'host-plan', stages: [f.stage] }]);
    await restored.coordinator.tick();
    expect(restored.coordinator.get(accepted.id)).toMatchObject({ status: 'failed', pipeline: { status: 'blocked' }, error: expect.stringContaining('no trusted static binding') });
    expect(f.produce).not.toHaveBeenCalled();
    expect(restored.coordinator.get(accepted.id)?.lease).toBeUndefined();
  });

  it('keeps a pipeline stopped during admission preflight cancelled rather than blocked', async () => {
    const f = await fixture();
    let projection: CoordinatorProjection | undefined;
    // In-memory commits settle in microtasks, so the stop lands before the
    // filesystem-backed preflight can observe the lease.
    const store: CoordinatorStore = { load: async () => structuredClone(projection), save: async (value) => { projection = structuredClone(value); }, close: async () => {} };
    const coordinator = await SessionCoordinator.open({ store, runtime: f.runtime, policy: { role: 'conductor', maxConcurrent: 1, authorizedRoots: [f.a] }, trustedPipelinePlans: [{ id: 'host-plan', stages: [f.stage] }] });
    coordinators.push(coordinator);
    const record = await coordinator.startPipeline('host-plan', 'operation');
    let stopping: Promise<unknown> | undefined;
    coordinator.onChange((snapshot) => {
      if (stopping === undefined && snapshot.records.some((card) => card.status === 'admitting')) stopping = coordinator.stop(record.id, coordinator.get(record.id)!.revision);
    });
    await coordinator.tick();
    await stopping;
    await vi.waitFor(() => { expect(coordinator.get(record.id)?.lease).toBeUndefined(); });
    expect(coordinator.get(record.id)).toMatchObject({ status: 'cancelled', pipeline: { status: 'cancelled' } });
    expect(f.produce).not.toHaveBeenCalled();
  });

  it('does not re-read a changed plan for callbacks after the accepted ownership lease is persisted', async () => {
    const f = await fixture();
    const plans: TrustedPipelinePlan[] = [{ id: 'host-plan', stages: [f.stage] }];
    const source = await f.open([f.a, f.b], plans);
    const record = await source.coordinator.startPipeline('host-plan', 'queued-operation');
    const changedProduce = vi.fn(async () => 'c'.repeat(40));
    source.coordinator.onChange((snapshot) => {
      if (snapshot.records.some((card) => card.status === 'admitting')) plans[0] = { id: 'host-plan', stages: [{ ...f.stage, repoPath: f.b, produce: changedProduce }] };
    });
    await source.coordinator.tick();
    await vi.waitFor(() => expect(source.coordinator.get(record.id)?.status).toBe('failed'));
    expect(f.produce).not.toHaveBeenCalled(); expect(changedProduce).not.toHaveBeenCalled();
    expect(source.saves.mock.calls.every(([projection]) => projection.records[0]?.request.ownership?.[0] === projection.records[0]?.request.cwd)).toBe(true);
    expect(source.coordinator.get(record.id)?.lease).toBeUndefined();
  });
});
