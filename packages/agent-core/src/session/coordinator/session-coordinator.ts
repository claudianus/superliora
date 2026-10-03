import { randomUUID } from 'node:crypto';
import { isAbsolute, relative, resolve } from 'node:path';
import { boundedUtf8 } from './preview';
import type { WorkerAncestry } from '@superliora/protocol';
import { runTrustedPipeline, type TrustedPipelinePlan } from '../execution/pipeline';
import { runArtifactVerification } from '../execution/verification';
import type { TrustedVerificationPlan } from './verification-plan';
import { canonicalPath, containsPath } from './authorized-path';
import { coordinatorProjectionSchema } from './projection-schema';
import { IndependentSessionUnsettledError } from './contracts';
import type {
  ConductorPolicy, CoordinationFact, CoordinationRecord, CoordinatorProjection, CoordinatorStore,
  IndependentSessionHandle, IndependentSessionRequest, IndependentSessionRuntime,
} from './contracts';

const holdsOwnership = (record: CoordinationRecord): boolean =>
  record.lease !== undefined || record.status === 'interrupted';
const overlaps = (a: string, b: string): boolean => {
  const path = relative(a, b);
  return path === '' || (!path.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && path !== '..' && !isAbsolute(path));
};

export class SessionCoordinator {
  private projection: CoordinatorProjection = { version: 1, records: [] };
  private serial: Promise<unknown> = Promise.resolve();
  private readonly active = new Map<string, { controller: AbortController; handle?: IndependentSessionHandle; done: Promise<void> }>();
  private readonly changeListeners = new Set<(facts: ReturnType<SessionCoordinator['facts']>) => void>();
  private readonly owner = randomUUID();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;
  private closePromise: Promise<void> | undefined;
  private failure: unknown;
  private readonly verificationControllers = new Map<string, AbortController>();
  private readonly verifications = new Set<Promise<void>>();
  private ticking: Promise<void> | undefined;

  private constructor(
    private readonly store: CoordinatorStore,
    private readonly runtime: IndependentSessionRuntime,
    readonly policy: ConductorPolicy,
    private readonly now: () => number,
    private readonly verificationPlans: readonly TrustedVerificationPlan[],
    private readonly trustedPipelinePlans: readonly TrustedPipelinePlan[],
  ) {
    if (policy.role !== 'conductor' || !Number.isInteger(policy.maxConcurrent) || policy.maxConcurrent < 1) {
      throw new Error('Independent sessions require an explicit conductor policy with positive maxConcurrent');
    }
    if (policy.authorizedRoots.length === 0 || policy.authorizedRoots.some((root) => !isAbsolute(root))) throw new Error('Conductor requires explicit absolute authorized roots');
    if (!Number.isFinite(policy.leaseMs ?? 30_000) || (policy.leaseMs ?? 30_000) < 1) throw new Error('Invalid lease duration');
  }

  static async open(options: {
    store: CoordinatorStore; runtime: IndependentSessionRuntime; policy: ConductorPolicy; now?: () => number; verificationPlans?: readonly TrustedVerificationPlan[]; trustedPipelinePlans?: readonly TrustedPipelinePlan[];
  }): Promise<SessionCoordinator> {
    try {
      const coordinator = new SessionCoordinator(options.store, options.runtime, options.policy, options.now ?? Date.now, options.verificationPlans ?? [], options.trustedPipelinePlans ?? []);
      const projection = await options.store.load();
      if (projection !== undefined) {
        if (projection.version !== 1 || !Array.isArray(projection.records)) throw new Error('Unsupported coordinator projection');
        coordinator.projection = coordinatorProjectionSchema.parse(projection);
        await coordinator.mutate((draft) => {
          for (const record of draft.records) {
            if (record.pipeline?.status === 'running') record.pipeline.status = 'interrupted';
            if (record.verification?.status === 'accepted' || record.verification?.status === 'running') { record.verification.status = 'interrupted'; record.revision++; }
            if (record.status === 'admitting' || record.status === 'running' || record.lease !== undefined) {
              record.status = 'interrupted';
              if (record.pipeline !== undefined) record.pipeline.status = 'interrupted';
              record.error = 'Execution interrupted; reconcile physical resources before releasing ownership. No automatic continuation.';
              record.revision++;
            }
          }
        });
      }
      coordinator.schedule(true);
      return coordinator;
    } catch (error) {
      await options.store.close();
      throw error;
    }
  }

  get lastError(): unknown { return this.failure; }

  list(): CoordinationRecord[] { return structuredClone(this.projection.records); }

  get(id: string): CoordinationRecord | undefined {
    const record = this.projection.records.find((entry) => entry.id === id);
    return record === undefined ? undefined : structuredClone(record);
  }

  facts(limit = 32): { records: CoordinationFact[]; total: number } {
    const priority = (record: CoordinationRecord): number => this.active.has(record.id) ? 0 : record.status === 'accepted' ? 1 : record.status === 'interrupted' ? 2 : record.status === 'idle' || record.status === 'yielded' ? 3 : 4;
    const records = this.projection.records.toReversed().toSorted((a, b) => priority(a) - priority(b)).slice(0, Math.min(Math.max(1, limit), 100));
    const cards: CoordinationFact[] = [];
    for (const record of records) {
      const { result: _result, error: _error, ...card } = this.fact(record.id)!;
      if (Buffer.byteLength(JSON.stringify([...cards, card])) > 12 * 1024) break;
      cards.push(card);
    }
    return { total: this.projection.records.length, records: cards };
  }

  fact(id: string): CoordinationFact | undefined {
    const record = this.get(id);
    if (record === undefined) return undefined;
    return {
      id: record.id, kind: record.kind ?? 'session',
      reusable: record.kind !== 'pipeline' && (record.status === 'idle' || record.status === 'yielded') && record.sessionId !== undefined && this.runtime.resume !== undefined && record.lease === undefined,
      ownerStatus: record.status === 'idle' || record.status === 'yielded' ? record.status : record.status === 'cancel_requested' ? 'settling' : record.status === 'interrupted' ? 'interrupted' : ['accepted', 'admitting', 'running'].includes(record.status) ? 'active' : 'finished',
      workerAncestry: record.workerAncestry, pipeline: record.pipeline === undefined ? undefined : { planId: record.pipeline.planId, status: record.pipeline.status }, sessionId: record.sessionId, revision: record.revision, status: record.status,
      purpose: boundedUtf8(record.request.purpose ?? record.request.description, 256), cwd: record.request.cwd,
      sourceRevision: record.request.sourceRevision, verification: record.verification === undefined ? undefined : { planId: record.verification.planId, revision: record.verification.revision, status: record.verification.status, evidencePath: record.verification.receipt?.evidencePath, artifactHash: record.verification.receipt?.artifactHash }, lease: record.lease,
      mailbox: { pending: record.mailbox.filter((entry) => entry.status === 'pending').length, uncertain: record.mailbox.filter((entry) => entry.status === 'sending').length },
      result: record.result === undefined ? undefined : boundedUtf8(record.result, 4096, true), error: record.error === undefined ? undefined : boundedUtf8(record.error, 1024),
    };
  }

  onChange(listener: (facts: ReturnType<SessionCoordinator['facts']>) => void): () => void {
    this.changeListeners.add(listener);
    return () => { this.changeListeners.delete(listener); };
  }

  async startPipeline(planId: string, idempotencyKey: string, origin?: WorkerAncestry): Promise<CoordinationRecord> {
    this.assertOpen();
    const plan = this.trustedPipelinePlans.find((entry) => entry.id === planId);
    if (plan === undefined) throw new Error('Pipeline plan is not registered by the trusted host');
    if (!idempotencyKey.trim() || Buffer.byteLength(idempotencyKey) > 256 || plan.stages.length === 0) throw new Error('Invalid pipeline identity or stages');
    const ownership = [...new Set(await Promise.all(plan.stages.map((stage) => canonicalPath(stage.repoPath))))].toSorted();
    const roots = await Promise.all(this.policy.authorizedRoots.map(canonicalPath));
    if (!ownership.every((path) => roots.some((root) => containsPath(root, path)))) throw new Error('Pipeline workspace is outside authorized roots');
    const accepted = await this.mutate((draft) => {
      const previous = draft.records.find((entry) => entry.idempotencyKey === idempotencyKey);
      if (previous !== undefined) {
        if (previous.kind !== 'pipeline' || previous.pipeline?.planId !== planId) throw new Error('Pipeline idempotency key conflict');
        return previous;
      }
      if (draft.records.length >= 128) throw new Error('Coordinator record quota reached; host retention is required');
      const record: CoordinationRecord = {
        id: `coord_${randomUUID()}`, kind: 'pipeline', idempotencyKey, revision: 1, status: 'accepted',
        request: { prompt: 'Trusted host pipeline', description: planId, purpose: planId, cwd: ownership[0]!, ownership },
        workerAncestry: origin, pipeline: { planId, status: 'accepted' }, mailbox: [],
      };
      draft.records.push(record);
      return record;
    });
    this.schedule(true);
    return accepted;
  }

  async verify(id: string, planId: string, expectedRevision: number): Promise<CoordinationRecord> {
    this.assertOpen();
    const plan = this.verificationPlans.find((entry) => entry.id === planId);
    if (plan === undefined) throw new Error('Verification plan is not registered by the trusted host');
    const record = this.get(id);
    if (record === undefined) throw new Error('Independent session not found');
    if (await canonicalPath(plan.repoPath) !== record.request.cwd || record.request.sourceRevision !== plan.artifact.sourceRevision) throw new Error('Verification plan does not match canonical workspace and revision');
    const accepted = await this.mutate((draft) => {
      const record = this.require(draft, id);
      this.checkRevision(record, expectedRevision);
      if (!['idle', 'yielded', 'finished'].includes(record.status)) throw new Error('Verification requires a settled turn');
      if (record.verification?.status === 'accepted' || record.verification?.status === 'running') throw new Error('Verification already active');
      record.revision++;
      record.verification = { planId, revision: record.revision, status: 'accepted' };
      return record;
    });
    const controller = new AbortController();
    this.verificationControllers.set(id, controller);
    const work = new Promise<void>((resolve) => { setTimeout(resolve, 0); }).then(async () => {
      try {
        await this.mutate((draft) => { this.require(draft, id).verification!.status = 'running'; });
        const receipt = await runArtifactVerification({ ...plan, signal: controller.signal });
        await this.mutate((draft) => {
          const record = this.require(draft, id);
          record.verification = { planId, revision: accepted.revision, receipt, status: receipt.status === 'cancelled' ? 'cancelled' : record.revision === accepted.revision ? receipt.status : 'stale' };
          record.revision++;
        });
      } catch (error) {
        await this.mutate((draft) => {
          const record = this.require(draft, id);
          record.verification = { planId, revision: accepted.revision, status: 'failed', error: String(error) };
          record.revision++;
        });
      }
    }).catch((error) => { this.failure = error; }).finally(() => { this.verifications.delete(work); this.verificationControllers.delete(id); });
    this.verifications.add(work);
    return accepted;
  }

  async park(id: string, status: 'yielded' | 'finished', expectedRevision: number): Promise<CoordinationRecord> {
    this.assertOpen();
    return this.mutate((draft) => {
      const record = this.require(draft, id);
      this.checkRevision(record, expectedRevision);
      if (record.status !== 'idle' && record.status !== 'yielded') throw new Error('Only an idle session can yield or finish');
      record.status = status;
      record.revision++;
      return record;
    });
  }

  async dispatch(request: IndependentSessionRequest, idempotencyKey: string, origin?: WorkerAncestry): Promise<CoordinationRecord> {
    this.assertOpen();
    if (!idempotencyKey.trim() || !request.prompt.trim() || !request.description.trim() || !isAbsolute(request.cwd)) {
      throw new Error('Dispatch requires idempotencyKey, prompt, description and absolute cwd');
    }
    if (request.timeoutMs !== undefined && (!Number.isFinite(request.timeoutMs) || request.timeoutMs < 0)) throw new Error('Invalid timeout');
    if (Buffer.byteLength(request.prompt) > 64 * 1024 || Buffer.byteLength(request.description) > 256 || Buffer.byteLength(request.purpose ?? '') > 256 || Buffer.byteLength(request.sourceRevision ?? '') > 128 || Buffer.byteLength(request.model ?? '') > 128 || Buffer.byteLength(idempotencyKey) > 256 || (request.ownership?.length ?? 0) > 64 || request.ownership?.some((path) => Buffer.byteLength(path) > 4096)) throw new Error('Independent request exceeds input quotas');
    const roots = await Promise.all(this.policy.authorizedRoots.map(canonicalPath));
    const cwd = await canonicalPath(request.cwd);
    const ownership = [...new Set(await Promise.all((request.ownership ?? []).map((path) => canonicalPath(resolve(request.cwd, path)))))].toSorted();
    if (![cwd, ...ownership].every((path) => roots.some((root) => containsPath(root, path)))) throw new Error('Independent dispatch path is outside authorized roots');
    const normalized: IndependentSessionRequest = {
      prompt: request.prompt, description: request.description, cwd,
      purpose: request.purpose ?? request.description, sourceRevision: request.sourceRevision,
      ...(request.model === undefined ? {} : { model: request.model }),
      ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
      ownership,
    };
    const record = await this.mutate((draft) => {
      const previous = draft.records.find((entry) => entry.idempotencyKey === idempotencyKey);
      if (previous !== undefined) {
        if (previous.kind === 'pipeline' || JSON.stringify({ ...previous.request, workerAncestry: undefined }) !== JSON.stringify(normalized)) throw new Error('Idempotency key conflicts with prior request');
        return previous;
      }
      if (draft.records.length >= 128) throw new Error('Coordinator record quota reached; host retention is required');
      const accepted: CoordinationRecord = {
        id: `coord_${randomUUID()}`, kind: 'session', idempotencyKey, request: normalized, revision: 1, status: 'accepted', mailbox: [],
      };
      accepted.workerAncestry = {
        agentId: 'main', sessionId: accepted.id, parentAgentId: origin?.agentId ?? null, parentSessionId: origin?.sessionId || null,
        rootAgentId: origin === undefined ? 'main' : origin.rootAgentId, rootSessionId: origin === undefined ? accepted.id : origin.rootSessionId,
        conductorAgentId: origin?.conductorAgentId, conductorSessionId: origin?.conductorSessionId, coordinationId: accepted.id,
        status: origin === undefined ? 'root' : origin.status === 'orphan' || !origin.sessionId ? 'orphan' : 'linked',
      };
      accepted.request.workerAncestry = accepted.workerAncestry;
      draft.records.push(accepted);
      return accepted;
    });
    this.schedule(true);
    return record;
  }

  async message(id: string, text: string, messageId: string, expectedRevision?: number): Promise<CoordinationRecord> {
    this.assertOpen();
    if (Buffer.byteLength(text) > 4096 || Buffer.byteLength(messageId) > 256) throw new Error('Mailbox input exceeds quota');
    if (!text.trim() || !messageId.trim()) throw new Error('Message requires text and idempotency key');
    const record = await this.mutate((draft) => {
      const record = this.require(draft, id);
      if (record.kind === 'pipeline') throw new Error('Pipeline inputs belong to the trusted host plan');
      const previous = record.mailbox.find((entry) => entry.id === messageId);
      if (previous !== undefined) {
        if (previous.text !== text) throw new Error('Message idempotency key conflict');
        return record;
      }
      this.checkRevision(record, expectedRevision);
      if (record.mailbox.length >= 32) throw new Error('Mailbox quota reached');
      if (record.status === 'idle' || record.status === 'yielded') {
        if (this.runtime.resume === undefined || record.sessionId === undefined) throw new Error('Runtime does not support explicit idle session resume');
        record.resumePrompt = text;
        record.status = 'accepted';
        record.mailbox.push({ id: messageId, text, status: 'delivered' });
        record.revision++;
        return record;
      }
      if (record.status !== 'accepted' && record.status !== 'admitting' && record.status !== 'running') throw new Error('Session does not accept messages; no implicit continuation');
      record.mailbox.push({ id: messageId, text, status: 'pending' });
      record.revision++;
      return record;
    });
    this.schedule(true);
    return record;
  }

  async stop(id: string, expectedRevision?: number): Promise<CoordinationRecord> {
    this.assertOpen();
    await this.mutate((draft) => {
      const record = this.require(draft, id);
      this.checkRevision(record, expectedRevision);
      if (record.verification?.status === 'accepted' || record.verification?.status === 'running') {
        record.verification.cancelRequested = true;
        record.revision++;
      }
      if (record.status === 'interrupted') throw new Error('Interrupted execution requires external resource reconciliation');
      if (record.status === 'accepted' || record.status === 'admitting' || record.status === 'running') {
        record.status = record.status === 'accepted' ? 'cancelled' : 'cancel_requested';
        record.revision++;
      }
    });
    this.verificationControllers.get(id)?.abort(new Error('Verification stopped'));
    const active = this.active.get(id);
    active?.controller.abort(new Error('Independent session stopped'));
    return this.get(id)!;
  }

  async wait(id: string, timeoutMs = 0, signal?: AbortSignal): Promise<CoordinationRecord> {
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0) throw new Error('Invalid wait timeout');
    const deadline = this.now() + timeoutMs;
    while (true) {
      signal?.throwIfAborted();
      const record = this.get(id);
      if (record === undefined) throw new Error(`Independent session not found: ${id}`);
      if (timeoutMs === 0 || this.now() >= deadline || !['accepted', 'admitting', 'running', 'cancel_requested'].includes(record.status)) return record;
      await new Promise<void>((resolve) => { setTimeout(resolve, Math.min(25, Math.max(1, deadline - this.now()))); });
    }
  }

  /** Explicit scheduler boundary; dispatch never waits for runtime admission. */
  tick(): Promise<void> {
    this.assertOpen();
    this.ticking ??= this.tickOnce().finally(() => { this.ticking = undefined; });
    return this.ticking;
  }

  private async tickOnce(): Promise<void> {
    for (const [id, entry] of this.active) {
      if (entry.handle !== undefined) await this.deliver(id, entry.handle);
    }
    await this.mutate((draft) => {
      for (const record of draft.records) {
        if (this.active.has(record.id) && record.lease !== undefined && record.lease.expiresAt - this.now() <= (this.policy.leaseMs ?? 30_000) / 3) record.lease.expiresAt = this.now() + (this.policy.leaseMs ?? 30_000);
      }
    });
    for (const record of this.list()) {
      if (this.closed || this.active.size >= this.policy.maxConcurrent) break;
      if (record.status !== 'accepted') continue;
      const blocked = this.projection.records.some((other) => other.id !== record.id && holdsOwnership(other) &&
        (record.request.ownership ?? []).some((claim) => (other.request.ownership ?? []).some((held) => overlaps(claim, held) || overlaps(held, claim))));
      if (blocked) continue;
      const controller = new AbortController();
      const settled = Promise.withResolvers<void>();
      const entry = { controller, done: settled.promise };
      this.active.set(record.id, entry);
      try {
        await this.mutate((draft) => {
          const current = this.require(draft, record.id);
          if (current.status !== 'accepted') throw new Error('Dispatch state changed before admission');
          current.status = 'admitting';
          current.lease = { owner: this.owner, token: randomUUID(), expiresAt: this.now() + (this.policy.leaseMs ?? 30_000) };
          current.revision++;
        });
      } catch (error) {
        this.active.delete(record.id);
        settled.resolve();
        if (this.get(record.id)?.status === 'cancelled') continue;
        throw error;
      }
      void (record.kind === 'pipeline' ? this.runPipelineExecution(record.id, controller) : this.run(record.id, controller)).then(settled.resolve, (error) => {
        this.failure = error;
        settled.resolve();
      }).finally(() => { this.active.delete(record.id); this.schedule(true); });
    }
  }

  close(): Promise<void> {
    this.closePromise ??= this.settleClose();
    return this.closePromise;
  }

  private async settleClose(): Promise<void> {
    this.closed = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    await this.ticking?.catch(() => undefined);
    for (const entry of this.active.values()) entry.controller.abort(new Error('Coordinator closed'));
    await Promise.all([...this.active.values()].map((entry) => entry.done));
    for (const controller of this.verificationControllers.values()) controller.abort(new Error('Coordinator closed'));
    await Promise.all(this.verifications);
    await this.serial;
    await this.store.close();
  }

  private async runPipelineExecution(id: string, controller: AbortController): Promise<void> {
    try {
      const planId = this.get(id)!.pipeline!.planId;
      const plan = this.trustedPipelinePlans.find((entry) => entry.id === planId);
      if (plan === undefined) throw new Error('Accepted pipeline plan is no longer registered');
      await this.mutate((draft) => {
        const record = this.require(draft, id);
        if (record.status !== 'cancel_requested') record.status = 'running';
        record.pipeline!.status = 'running';
        record.revision++;
      });
      const result = await runTrustedPipeline(plan, { executionSignal: controller.signal });
      await this.mutate((draft) => {
        const record = this.require(draft, id);
        record.pipeline = { planId, status: result.status, result };
        record.status = result.status === 'success' ? 'finished' : result.status === 'cancelled' ? 'cancelled' : 'failed';
        delete record.lease;
        record.revision++;
      });
    } catch (error) {
      await this.finish(id, controller.signal.aborted ? 'cancelled' : 'failed', undefined, String(error));
      await this.mutate((draft) => { const record = this.require(draft, id); record.pipeline!.status = controller.signal.aborted ? 'cancelled' : 'failed'; });
    }
  }

  private async run(id: string, controller: AbortController): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const request = this.get(id)!.request;
      if ((request.timeoutMs ?? 0) > 0) timeout = setTimeout(() => controller.abort(new Error('Independent session deadline exceeded')), request.timeoutMs);
      const record = this.get(id)!;
      const handle = record.resumePrompt !== undefined && record.sessionId !== undefined
        ? await this.runtime.resume!(record.sessionId, { ...request, prompt: record.resumePrompt }, controller.signal)
        : await this.runtime.admit(id, request, controller.signal);
      // Observe completion immediately, even if persistence or mailbox delivery fails.
      const completion = handle.completion.then((result) => ({ result }), (error: unknown) => ({ error }));
      this.active.get(id)!.handle = handle;
      try {
        await this.mutate((draft) => {
          const record = this.require(draft, id);
          record.sessionId = handle.sessionId;
          if (record.workerAncestry !== undefined) {
            record.workerAncestry = { ...record.workerAncestry, sessionId: handle.sessionId };
            record.request.workerAncestry = record.workerAncestry;
          }
          if (record.status !== 'cancel_requested' && record.status !== 'cancelled') record.status = 'running';
          delete record.resumePrompt;
          record.revision++;
        });
        if (!controller.signal.aborted) await this.deliver(id, handle);
      } catch (error) {
        controller.abort(error);
        const outcome = await completion;
        if ('error' in outcome && outcome.error instanceof IndependentSessionUnsettledError) throw outcome.error;
        throw error;
      }
      const outcome = await completion;
      if ('error' in outcome) throw outcome.error;
      await this.finish(id, controller.signal.aborted ? 'cancelled' : 'completed', outcome.result);
    } catch (error) {
      if (error instanceof IndependentSessionUnsettledError) {
        await this.mutate((draft) => {
          const record = this.require(draft, id);
          record.status = 'interrupted';
          record.error = String(error);
          record.revision++;
        });
      } else {
        await this.finish(id, controller.signal.aborted ? 'cancelled' : 'failed', undefined, String(error));
      }
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }

  private async finish(id: string, status: 'completed' | 'failed' | 'cancelled', result?: string, error?: string): Promise<void> {
    await this.mutate((draft) => {
      const record = this.require(draft, id);
      record.status = record.status === 'cancelled' || record.status === 'cancel_requested' ? 'cancelled' : status === 'completed' ? 'idle' : status;
      record.result = result;
      record.error = error;
      delete record.lease;
      record.revision++;
    });
  }

  private async deliver(id: string, handle: IndependentSessionHandle): Promise<void> {
    for (const message of this.get(id)?.mailbox ?? []) {
      if (message.status !== 'pending' || this.get(id)?.status !== 'running') continue;
      const claimed = await this.mutate((draft) => {
        const record = this.require(draft, id);
        const entry = record.mailbox.find((entry) => entry.id === message.id)!;
        if (record.status !== 'running' || entry.status !== 'pending') return false;
        entry.status = 'sending';
        record.revision++;
        return true;
      });
      if (!claimed) continue;
      await handle.message(message.text);
      await this.mutate((draft) => {
        const record = this.require(draft, id);
        record.mailbox.find((entry) => entry.id === message.id)!.status = 'delivered';
        record.revision++;
      });
    }
  }

  private mutate<T>(update: (draft: CoordinatorProjection) => T): Promise<T> {
    const transaction = this.serial.then(async () => {
      const draft = structuredClone(this.projection);
      const result = update(draft);
      const changed = JSON.stringify(draft) !== JSON.stringify(this.projection);
      if (changed) await this.store.save(draft);
      this.projection = draft;
      if (changed) {
        for (const listener of this.changeListeners) {
          try { listener(this.facts()); } catch { /* Observers cannot change durable execution. */ }
        }
      }
      return structuredClone(result);
    });
    this.serial = transaction.catch(() => undefined);
    return transaction;
  }

  private require(draft: CoordinatorProjection, id: string): CoordinationRecord {
    const record = draft.records.find((entry) => entry.id === id);
    if (record === undefined) throw new Error(`Independent session not found: ${id}`);
    return record;
  }

  private checkRevision(record: CoordinationRecord, revision?: number): void {
    if (revision === undefined) throw new Error('Independent mutation requires expectedRevision');
    if (revision !== record.revision) throw new Error(`Revision conflict: expected ${revision}, current ${record.revision}`);
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('Coordinator closed');
    if (this.failure !== undefined) throw new Error('Coordinator scheduler failed', { cause: this.failure });
  }

  private schedule(immediate = false): void {
    if (this.closed || this.failure !== undefined) return;
    if (immediate && this.timer !== undefined) { clearTimeout(this.timer); this.timer = undefined; }
    if (this.timer !== undefined) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.tick().catch((error) => { this.failure = error; }).finally(() => {
        if (this.active.size > 0) this.schedule();
      });
    }, !immediate && this.active.size > 0 ? Math.max(1, Math.floor((this.policy.leaseMs ?? 30_000) / 3)) : 0);
  }
}
