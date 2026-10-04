import { mkdtemp, rm, readFile, writeFile, readdir, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FileCoordinatorStore, IndependentSessionUnsettledError, SessionCoordinator,
  type CoordinatorProjection, type CoordinatorStore, type IndependentSessionRuntime,
} from '../../../src/session/coordinator';

class MemoryStore implements CoordinatorStore {
  projection: CoordinatorProjection | undefined;
  fail = false;
  async load() { return structuredClone(this.projection); }
  async save(value: CoordinatorProjection) {
    if (this.fail) throw new Error('disk full');
    this.projection = structuredClone(value);
  }
  async close() {}
}

const request = { prompt: 'Implement feature', description: 'Feature', cwd: join(tmpdir(), 'coordinator-work'), ownership: ['src'] };
const flush = async () => { for (let index = 0; index < 20; index++) await Promise.resolve(); };
const coordinators: SessionCoordinator[] = [];
async function setup(store = new MemoryStore()) {
  const messages: string[] = [];
  const completions = new Map<string, ReturnType<typeof Promise.withResolvers<string>>>();
  const signals = new Map<string, AbortSignal>();
  const runtime: IndependentSessionRuntime = {
    admit: vi.fn(async (id, _request, signal) => {
      const completion = Promise.withResolvers<string>();
      completions.set(id, completion);
      signals.set(id, signal);
      signal.addEventListener('abort', () => completion.reject(signal.reason), { once: true });
      if (signal.aborted) completion.reject(signal.reason);
      return { sessionId: `session-${id}`, completion: completion.promise, message: async (text: string) => { messages.push(text); } };
    }),
  };
  const coordinator = await SessionCoordinator.open({ store, runtime, policy: { role: 'conductor', maxConcurrent: 2, authorizedRoots: [tmpdir()] }, now: () => 100 });
  coordinators.push(coordinator);
  return { coordinator, store, runtime, messages, completions, signals };
}

beforeEach(() => vi.useFakeTimers());
afterEach(async () => {
  await Promise.all(coordinators.splice(0).map((coordinator) => coordinator.close()));
  vi.useRealTimers();
});

describe('durable independent coordination', () => {
  it('persists acceptance before admission and deduplicates identical requests', async () => {
    const { coordinator, store, runtime } = await setup();
    const accepted = await coordinator.dispatch(request, 'request-1');
    expect(accepted).toMatchObject({ status: 'accepted', revision: 1 });
    expect(store.projection?.records[0]).toEqual(accepted);
    expect(runtime.admit).not.toHaveBeenCalled();
    expect(await coordinator.dispatch(request, 'request-1')).toEqual(accepted);
    await expect(coordinator.dispatch({ ...request, prompt: 'Different' }, 'request-1')).rejects.toThrow('conflicts');
    const snapshot = coordinator.get(accepted.id)!;
    snapshot.request.prompt = 'Tampered';
    expect(coordinator.get(accepted.id)?.request.prompt).toBe(request.prompt);
    await coordinator.tick();
    await flush();
    expect(runtime.admit).toHaveBeenCalledTimes(1);
    expect(coordinator.get(accepted.id)?.status).toBe('running');
  });

  it('does not admit failed durable writes or publish an uncommitted projection', async () => {
    const { coordinator, store, runtime } = await setup();
    store.fail = true;
    await expect(coordinator.dispatch(request, 'request')).rejects.toThrow('disk full');
    expect(coordinator.list()).toEqual([]);
    expect(runtime.admit).not.toHaveBeenCalled();
  });

  it('queues overlapping ownership until settled and permits independent ownership', async () => {
    const { coordinator, runtime, completions } = await setup();
    const first = await coordinator.dispatch(request, 'first');
    const blocked = await coordinator.dispatch({ ...request, ownership: ['src/nested/file.ts'] }, 'blocked');
    const parallel = await coordinator.dispatch({ ...request, ownership: ['other'] }, 'parallel');
    await Promise.all([coordinator.tick(), coordinator.tick()]);
    await flush();
    expect(runtime.admit).toHaveBeenCalledTimes(2);
    expect(coordinator.get(blocked.id)?.status).toBe('accepted');
    expect(coordinator.get(parallel.id)?.status).toBe('running');
    completions.get(first.id)!.resolve('Observed result, not verification');
    await flush();
    await coordinator.tick();
    await flush();
    expect(coordinator.get(first.id)).toMatchObject({ status: 'idle', result: 'Observed result, not verification' });
    expect(coordinator.get(first.id)?.lease).toBeUndefined();
    expect(coordinator.get(blocked.id)?.status).toBe('running');
  });

  it('enforces revisions and persists idempotent mailbox delivery without implicit continuation', async () => {
    const { coordinator, messages, completions } = await setup();
    const accepted = await coordinator.dispatch(request, 'request');
    await expect(coordinator.message(accepted.id, 'New input', 'message', 7)).rejects.toThrow('Revision conflict');
    const queued = await coordinator.message(accepted.id, 'New input', 'message', 1);
    expect(queued.mailbox).toEqual([{ id: 'message', text: 'New input', status: 'pending' }]);
    await coordinator.tick();
    await flush();
    await coordinator.message(accepted.id, 'New input', 'message', 1);
    await coordinator.tick();
    expect(messages).toEqual(['New input']);
    expect(coordinator.get(accepted.id)?.mailbox[0]?.status).toBe('delivered');
    completions.get(accepted.id)!.resolve('Done');
    await flush();
    await expect(coordinator.message(accepted.id, 'Continue', 'next')).rejects.toThrow('expectedRevision');
  });

  it('isolates waiting cancellation and stops only the selected independent execution', async () => {
    const { coordinator, signals } = await setup();
    const first = await coordinator.dispatch(request, 'first');
    const second = await coordinator.dispatch({ ...request, ownership: ['other'] }, 'second');
    await coordinator.tick();
    await flush();
    const caller = new AbortController();
    caller.abort();
    await expect(coordinator.wait(first.id, 100, caller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(signals.get(first.id)?.aborted).toBe(false);
    expect((await coordinator.stop(first.id, coordinator.get(first.id)!.revision)).status).toBe('cancel_requested');
    await flush();
    expect(coordinator.get(first.id)?.status).toBe('cancelled');
    expect(signals.get(second.id)?.aborted).toBe(false);
  });

  it('retains ownership on unsettled cleanup and on restart without replaying active work', async () => {
    const { coordinator, store, completions } = await setup();
    const first = await coordinator.dispatch(request, 'first');
    await coordinator.tick();
    await flush();
    completions.get(first.id)!.reject(new IndependentSessionUnsettledError('process did not exit'));
    await flush();
    expect(coordinator.get(first.id)).toMatchObject({ status: 'interrupted', lease: expect.any(Object) });
    const recovered = await setup(store);
    expect(recovered.coordinator.get(first.id)?.status).toBe('interrupted');
    await recovered.coordinator.dispatch(request, 'second');
    await recovered.coordinator.tick();
    expect(recovered.runtime.admit).not.toHaveBeenCalled();
    await expect(recovered.coordinator.stop(first.id, recovered.coordinator.get(first.id)!.revision)).rejects.toThrow('reconciliation');
  });

  it('recovers running projections as interrupted and queued requests remain admissible', async () => {
    const store = new MemoryStore();
    store.projection = { version: 1, records: [{ id: 'coord_old', idempotencyKey: 'old', request: { ...request, ownership: [join(request.cwd, 'src')] }, revision: 4, status: 'running', sessionId: 'existing-session', mailbox: [{ id: 'm', text: 'Input', status: 'sending' }], lease: { owner: 'old-owner', token: 'token', expiresAt: 0 } }] };
    const { coordinator, runtime } = await setup(store);
    expect(coordinator.get('coord_old')).toMatchObject({ status: 'interrupted', revision: 5, mailbox: [{ status: 'sending' }] });
    await coordinator.dispatch({ ...request, ownership: ['other'] }, 'new');
    await coordinator.tick();
    await flush();
    expect(runtime.admit).toHaveBeenCalledTimes(1);
    expect(runtime.admit).not.toHaveBeenCalledWith('coord_old', expect.anything(), expect.anything());
  });
});

describe('exclusive file projection', () => {
  it('reopens the durable projection and refuses a second owner without stale-lock takeover', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'conductor-store-'));
    const path = join(directory, 'coordination.json');
    try {
      const store = await FileCoordinatorStore.open(path);
      await expect(FileCoordinatorStore.open(path)).rejects.toMatchObject({ code: 'EEXIST' });
      const projection: CoordinatorProjection = { version: 1, records: [] };
      await store.save(projection);
      expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(projection);
      await store.close();
      const reopened = await FileCoordinatorStore.open(path);
      expect(await reopened.load()).toEqual(projection);
      await reopened.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('conductor acceptance capability bounds', () => {
  it('reuses an explicitly selected idle session, yields it, and distinguishes finished', async () => {
    const { coordinator, runtime, completions } = await setup();
    runtime.resume = vi.fn(async (sessionId, resumed, signal) => runtime.admit(sessionId, resumed, signal));
    const accepted = await coordinator.dispatch({ ...request, purpose: 'Compiler', sourceRevision: 'revision-a' }, 'work');
    await coordinator.tick();
    await flush();
    completions.get(accepted.id)!.resolve('Observed turn result');
    await flush();
    expect(coordinator.get(accepted.id)?.status).toBe('idle');
    expect(coordinator.fact(accepted.id)).toMatchObject({ reusable: true, ownerStatus: 'idle', kind: 'session' });
    await coordinator.park(accepted.id, 'yielded', coordinator.get(accepted.id)!.revision);
    await coordinator.message(accepted.id, 'Repair the failing assertion', 'repair-1', coordinator.get(accepted.id)!.revision);
    await coordinator.tick();
    await flush();
    expect(runtime.resume).toHaveBeenCalledWith(`session-${accepted.id}`, expect.objectContaining({ prompt: 'Repair the failing assertion', purpose: 'Compiler', sourceRevision: 'revision-a' }), expect.any(AbortSignal));
    completions.get(`session-${accepted.id}`)!.resolve('Repair turn ended');
    await flush();
    await coordinator.park(accepted.id, 'finished', coordinator.get(accepted.id)!.revision);
    expect(coordinator.fact(accepted.id)).toMatchObject({ reusable: false, ownerStatus: 'finished' });
    await expect(coordinator.message(accepted.id, 'Implicit extra turn', 'extra', coordinator.get(accepted.id)!.revision)).rejects.toThrow('no implicit continuation');
  });

  it('acknowledges stop while runtime admission never settles and retains the lease', async () => {
    const store = new MemoryStore();
    const admission = Promise.withResolvers<Awaited<ReturnType<IndependentSessionRuntime['admit']>>>();
    let signal: AbortSignal | undefined;
    const coordinator = await SessionCoordinator.open({ store, policy: { role: 'conductor', maxConcurrent: 1, authorizedRoots: [tmpdir()] }, runtime: { admit: async (_id, _request, owned) => { signal = owned; return admission.promise; } } });
    const accepted = await coordinator.dispatch(request, 'blocked-admission');
    await coordinator.tick();
    const stopped = await coordinator.stop(accepted.id, coordinator.get(accepted.id)!.revision);
    expect(stopped.status).toBe('cancel_requested');
    expect(stopped.lease).toBeDefined();
    expect(signal?.aborted).toBe(true);
    admission.reject(signal?.reason);
    await flush();
    expect(coordinator.get(accepted.id)?.status).toBe('cancelled');
    await coordinator.close();
  });

  it('rejects paths outside host roots and symlink escapes while allowing deliberate roots', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'coordinator-paths-'));
    const root = join(directory, 'allowed');
    const outside = join(directory, 'outside');
    await mkdir(root);
    await mkdir(outside);
    await symlink(outside, join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    const coordinator = await SessionCoordinator.open({ store: new MemoryStore(), policy: { role: 'conductor', maxConcurrent: 1, authorizedRoots: [root] }, runtime: { admit: async () => { throw new Error('not admitted'); } } });
    try {
      await expect(coordinator.dispatch({ ...request, cwd: outside }, 'outside')).rejects.toThrow('authorized roots');
      await expect(coordinator.dispatch({ ...request, cwd: root, ownership: ['escape/new-file.ts'] }, 'escape')).rejects.toThrow('authorized roots');
      await symlink(join(outside, 'missing'), join(root, 'dangling'), process.platform === 'win32' ? 'junction' : 'dir');
      await expect(coordinator.dispatch({ ...request, cwd: root, ownership: ['dangling/new-file.ts'] }, 'dangling')).rejects.toThrow('Unresolvable path component');
      expect((await coordinator.dispatch({ ...request, cwd: root, ownership: ['src/new-file.ts'] }, 'inside')).status).toBe('accepted');
    } finally { await coordinator.close(); await rm(directory, { recursive: true, force: true }); }
  });

  it('keeps the scheduler usable when a mailbox delivery throws and reports the entry as uncertain', async () => {
    const { coordinator, runtime } = await setup();
    vi.mocked(runtime.admit).mockImplementationOnce(async (id, _request, signal) => {
      const completion = Promise.withResolvers<string>();
      signal.addEventListener('abort', () => completion.reject(signal.reason), { once: true });
      return { sessionId: `session-${id}`, completion: completion.promise, message: async () => { throw new Error('steer refused'); } };
    });
    const accepted = await coordinator.dispatch(request, 'request');
    await coordinator.tick();
    await flush();
    await coordinator.message(accepted.id, 'New input', 'message', coordinator.get(accepted.id)!.revision);
    await expect(coordinator.tick()).resolves.toBeUndefined();
    expect(coordinator.lastError).toBeUndefined();
    expect(coordinator.get(accepted.id)?.mailbox[0]?.status).toBe('sending');
    expect(coordinator.fact(accepted.id)?.mailbox).toEqual({ pending: 0, uncertain: 1 });
    expect((await coordinator.dispatch({ ...request, ownership: ['other'] }, 'after-failure')).status).toBe('accepted');
  });

  it('returns UTF-8 bounded fact cards without prompts or mailbox text', async () => {
    const { coordinator } = await setup();
    for (let index = 0; index < 50; index++) await coordinator.dispatch({ ...request, purpose: '界'.repeat(80), prompt: 'private prompt', ownership: [] }, `request-${index}`);
    const projection = coordinator.facts();
    expect(projection.total).toBe(50);
    expect(projection.records.length).toBeLessThanOrEqual(32);
    expect(Buffer.byteLength(JSON.stringify(projection.records))).toBeLessThanOrEqual(12 * 1024);
    expect(JSON.stringify(projection)).not.toContain('private prompt');
  });
});

describe('coordinator stale-owner recovery', () => {
  it('requires a matching dead owner and explicit physical reconciliation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'conductor-recovery-'));
    const path = join(directory, 'projection.json');
    try {
      const owner = { pid: 2147483647, token: 'dead-token', createdAt: 1 };
      await writeFile(`${path}.lock`, JSON.stringify(owner));
      const liveness = vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error('dead'), { code: 'ESRCH' }); });
      try {
        await expect(FileCoordinatorStore.recover(path, { expectedToken: 'other', confirmResourcesReconciled: () => true })).rejects.toThrow('token changed');
        await expect(FileCoordinatorStore.recover(path, { expectedToken: owner.token, confirmResourcesReconciled: () => false })).rejects.toThrow('not been reconciled');
        const store = await FileCoordinatorStore.recover(path, { expectedToken: owner.token, confirmResourcesReconciled: () => true });
        expect((await FileCoordinatorStore.inspectOwner(path)).token).not.toBe(owner.token);
        await store.close();
      } finally { liveness.mockRestore(); }
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('reclaims a recovery marker left by a dead process but refuses a live recovery holder', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'conductor-recovery-marker-'));
    const path = join(directory, 'projection.json');
    try {
      const owner = { pid: 2147483646, token: 'dead-token', createdAt: 1 };
      await writeFile(`${path}.lock`, JSON.stringify(owner));
      await writeFile(`${path}.recovery`, JSON.stringify({ pid: process.pid, token: 'in-progress' }));
      await expect(FileCoordinatorStore.recover(path, { expectedToken: owner.token, confirmResourcesReconciled: () => true })).rejects.toThrow('already in progress');
      expect(JSON.parse(await readFile(`${path}.recovery`, 'utf8')).token).toBe('in-progress');
      await writeFile(`${path}.recovery`, JSON.stringify({ pid: 2147483647, token: 'crashed' }));
      const liveness = vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error('dead'), { code: 'ESRCH' }); });
      try {
        const store = await FileCoordinatorStore.recover(path, { expectedToken: owner.token, confirmResourcesReconciled: () => true });
        expect((await FileCoordinatorStore.inspectOwner(path)).token).not.toBe(owner.token);
        await store.close();
      } finally { liveness.mockRestore(); }
      expect((await readdir(directory)).filter((entry) => entry.includes('.recovery'))).toEqual([]);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('does not recover a live PID or delete a replaced owner token', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'conductor-owner-'));
    const path = join(directory, 'projection.json');
    try {
      const store = await FileCoordinatorStore.open(path);
      const owner = await FileCoordinatorStore.inspectOwner(path);
      await expect(FileCoordinatorStore.recover(path, { expectedToken: owner.token, confirmResourcesReconciled: () => true })).rejects.toThrow('still be live');
      await writeFile(`${path}.lock`, JSON.stringify({ ...owner, token: 'replacement' }));
      await expect(store.close()).rejects.toThrow('ownership changed');
      expect((await FileCoordinatorStore.inspectOwner(path)).token).toBe('replacement');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('rejects corrupt durable projection and leaves prior bytes intact after failed saves', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'conductor-corrupt-'));
    const path = join(directory, 'projection.json');
    try {
      await writeFile(path, '{broken-json');
      const store = await FileCoordinatorStore.open(path);
      await expect(SessionCoordinator.open({ store, runtime: { admit: async () => { throw new Error('not called'); } }, policy: { role: 'conductor', maxConcurrent: 1, authorizedRoots: [directory] } })).rejects.toThrow();
      const reopened = await FileCoordinatorStore.open(path);
      const circular = { version: 1, records: [] } as CoordinatorProjection;
      (circular.records as unknown[]).push(circular);
      await expect(reopened.save(circular)).rejects.toThrow();
      expect(await readFile(path, 'utf8')).toBe('{broken-json');
      expect((await readdir(directory)).filter((entry) => entry.endsWith('.tmp'))).toEqual([]);
      await reopened.close();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});

describe('persisted evidence validation', () => {
  it.each([
    ['verification receipt', { verification: { planId: 'plan', revision: 1, status: 'passed', receipt: { evidencePath: 42 } } }],
    ['pipeline result', { pipeline: { planId: 'plan', status: 'success', result: { planId: 'plan', status: 'success', stages: [{ stageId: 'build' }] } } }],
  ])('rejects a malformed persisted %s at startup', async (_label, corruption) => {
    const store = new MemoryStore();
    const { coordinator } = await setup(store);
    await coordinator.dispatch(request, 'request');
    await coordinator.close();
    Object.assign(store.projection!.records[0]!, corruption);
    await expect(SessionCoordinator.open({ store, runtime: { admit: async () => { throw new Error('not called'); } }, policy: { role: 'conductor', maxConcurrent: 1, authorizedRoots: [tmpdir()] } })).rejects.toThrow();
  });
});

describe('bounded persistence work', () => {
  it('does not rewrite unchanged ticks or renew a healthy lease before its renewal window', async () => {
    const { coordinator, store } = await setup();
    const save = vi.spyOn(store, 'save');
    await coordinator.tick();
    await coordinator.tick();
    expect(save).not.toHaveBeenCalled();
    await coordinator.dispatch(request, 'work');
    await coordinator.tick();
    await flush();
    const writes = save.mock.calls.length;
    await coordinator.tick();
    await coordinator.tick();
    expect(save).toHaveBeenCalledTimes(writes);
  });

  it('rejects oversize durable input before any store write', async () => {
    const { coordinator, store } = await setup();
    const save = vi.spyOn(store, 'save');
    await expect(coordinator.dispatch({ ...request, prompt: '界'.repeat(23000) }, 'huge')).rejects.toThrow('quotas');
    expect(save).not.toHaveBeenCalled();
    const accepted = await coordinator.dispatch(request, 'work');
    await expect(coordinator.message(accepted.id, '界'.repeat(1500), 'huge', accepted.revision)).rejects.toThrow('quota');
    expect(coordinator.get(accepted.id)?.mailbox).toEqual([]);
  });
});

describe('durable tree snapshots', () => {
  it('notifies only committed changes, isolates observers, and keeps stable correlation through actual admission IDs', async () => {
    const { coordinator, store, runtime } = await setup();
    const observed: ReturnType<SessionCoordinator['facts']>[] = [];
    const unsubscribe = coordinator.onChange((facts) => { expect(store.projection?.records.length).toBe(facts.total); observed.push(facts); });
    coordinator.onChange(() => { throw new Error('UI observer failed'); });
    runtime.admit = vi.fn(async (id, _request, signal) => {
      const completion = Promise.withResolvers<string>();
      signal.addEventListener('abort', () => completion.reject(signal.reason), { once: true });
      return { sessionId: 'actual-worker-session', completion: completion.promise, message: async () => {} };
    });
    const origin = { agentId: 'worker-parent', sessionId: 'conductor-session', parentAgentId: 'main', parentSessionId: 'conductor-session', rootAgentId: 'main', rootSessionId: 'conductor-session', conductorAgentId: 'main', conductorSessionId: 'conductor-session', status: 'linked' as const };
    const accepted = await coordinator.dispatch(request, 'work', origin);
    expect(observed[0]?.records[0]?.workerAncestry).toMatchObject({ coordinationId: accepted.id, sessionId: accepted.id, parentAgentId: 'worker-parent', parentSessionId: 'conductor-session' });
    await coordinator.tick();
    await flush();
    expect(coordinator.fact(accepted.id)?.workerAncestry).toMatchObject({ coordinationId: accepted.id, sessionId: 'actual-worker-session', rootSessionId: 'conductor-session' });
    expect(coordinator.get(accepted.id)?.request.workerAncestry).toEqual(coordinator.fact(accepted.id)?.workerAncestry);
    const count = observed.length;
    await coordinator.tick();
    expect(observed).toHaveLength(count);
    store.fail = true;
    await expect(coordinator.message(accepted.id, 'Message', 'm', coordinator.get(accepted.id)!.revision)).rejects.toThrow('disk full');
    expect(observed).toHaveLength(count);
    store.fail = false;
    unsubscribe();
    await coordinator.stop(accepted.id, coordinator.get(accepted.id)!.revision);
    await flush();
    expect(observed).toHaveLength(count);
  });
});

describe('bounded facts retain physically owned work', () => {
  it('keeps an older running owner visible ahead of newer queued requests', async () => {
    const { coordinator } = await setup();
    const older = await coordinator.dispatch(request, 'long-running');
    await coordinator.tick();
    await flush();
    for (let index = 0; index < 40; index++) await coordinator.dispatch({ ...request, ownership: ['different'], description: `Queued ${index}` }, `new-${index}`);
    const snapshot = coordinator.facts(8);
    expect(snapshot.records[0]).toMatchObject({ id: older.id, status: 'running', ownerStatus: 'active' });
    expect(snapshot.records.length).toBeLessThanOrEqual(8);
    expect(Buffer.byteLength(JSON.stringify(snapshot.records))).toBeLessThanOrEqual(12 * 1024);
  });
});

describe('whole-graph counts with bounded attention-first cards', () => {
  it('keeps old running and failed owners ahead of more than 32 terminal rows and reports exact hidden totals', async () => {
    const { coordinator, completions } = await setup();
    const older = await coordinator.dispatch(request, 'long-owner');
    await coordinator.tick();
    await flush();
    const failure = await coordinator.dispatch({ ...request, ownership: ['failure'] }, 'attention');
    await coordinator.tick();
    await flush();
    completions.get(failure.id)!.reject(new Error('Provider failure needs attention'));
    await flush();
    for (let index = 0; index < 40; index++) {
      const recent = await coordinator.dispatch({ ...request, ownership: ['other'] }, `terminal-${index}`);
      await coordinator.tick();
      await flush();
      completions.get(recent.id)!.resolve('Turn ended');
      await flush();
      await coordinator.park(recent.id, 'finished', coordinator.get(recent.id)!.revision);
    }
    const snapshot = coordinator.facts();
    expect(snapshot.records.slice(0, 2).map((record) => record.id)).toEqual([older.id, failure.id]);
    expect(snapshot.total).toBe(42);
    expect(snapshot.truncated).toBe(true);
    expect(snapshot.counts.byStatus).toMatchObject({ running: 1, failed: 1, finished: 40 });
    expect(Object.values(snapshot.counts.byStatus).reduce((sum, count) => sum + count, 0)).toBe(snapshot.total);
    expect(snapshot.counts.attention).toBe(1);
    expect(snapshot.records.length).toBeLessThanOrEqual(32);
    expect(Buffer.byteLength(JSON.stringify(snapshot.records))).toBeLessThanOrEqual(12 * 1024);
  });
});
