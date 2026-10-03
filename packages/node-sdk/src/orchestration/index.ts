import { canonicalPath, containsPath } from '@superliora/agent-core/session/coordinator/authorized-path';
import {
  FileCoordinatorStore,
  IndependentSessionUnsettledError,
  SessionCoordinator,
  type ConductorPolicy,
  type Event,
  type IndependentSessionRequest,
  type IndependentSessionRuntime,
  type TrustedVerificationPlan,
  type TrustedPipelinePlan,
} from '@superliora/agent-core';
import type { LioraHarness } from '#/harness/liora-harness';
import type { Session } from '#/session/session';

export function createIndependentSessionRuntime(
  harness: Pick<LioraHarness, 'createSession' | 'resumeSession'>,
  onActivity?: (sessionId: string, event: Event) => void,
  prepareSession?: (session: Session) => Promise<void>,
): IndependentSessionRuntime {
  async function run(session: Session, request: IndependentSessionRequest, signal: AbortSignal) {
    const ended = Promise.withResolvers<void>();
    let turnId: number | undefined;
    let cancellation: Promise<void> | undefined;
    const unsubscribe = session.onEvent((event) => {
      try { onActivity?.(session.id, event); } catch { /* Observers cannot affect execution. */ }
      if (event.type === 'turn.started' && event.agentId === 'main') turnId ??= event.turnId;
      if (event.type !== 'turn.ended' || event.agentId !== 'main' || event.turnId !== turnId) return;
      if (event.reason === 'completed') ended.resolve();
      else ended.reject(new Error(`Independent turn ${event.reason}`));
    });
    void ended.promise.catch(() => undefined);
    const abort = (): void => {
      cancellation ??= (async () => {
        try { await session.cancel(); } finally { await session.close(); }
      })();
      void cancellation.then(() => ended.reject(signal.reason), (error: unknown) => ended.reject(new IndependentSessionUnsettledError('Cancellation cleanup failed', { cause: error })));
    };
    signal.addEventListener('abort', abort, { once: true });
    const completion = (async (): Promise<undefined> => {
      let failure: { error: unknown } | undefined;
      try {
        signal.throwIfAborted();
        await session.prompt(request.prompt);
        // prompt is an admission ACK, not turn completion.
        await ended.promise;
        signal.throwIfAborted();
      } catch (error) { failure = { error }; }
      signal.removeEventListener('abort', abort);
      unsubscribe();
      const cleanup = await Promise.allSettled([cancellation ?? Promise.resolve(), session.close()]);
      const failures = cleanup.filter((entry) => entry.status === 'rejected').map((entry) => entry.reason);
      if (failures.length > 0) throw new IndependentSessionUnsettledError('Independent session cleanup failed; ownership retained', { cause: new AggregateError(failures, 'Independent cleanup did not settle') });
      if (failure !== undefined) throw failure.error;
      return undefined;
    })();
    if (signal.aborted) abort();
    return { sessionId: session.id, completion, message: async (text: string) => { await session.steer(text); } };
  }
  async function prepare(session: Session): Promise<Session> {
    try { await prepareSession?.(session); return session; }
    catch (error) {
      try { await session.close(); }
      catch (error) { throw new IndependentSessionUnsettledError('Sandbox preparation cleanup failed', { cause: new AggregateError([error, error]) }); }
      throw error;
    }
  }
  return {
    async admit(id, request, signal) {
      signal.throwIfAborted();
      const options = { id, workDir: request.cwd, model: request.model, workerAncestry: request.workerAncestry };
      return run(await prepare(await harness.createSession(options)), request, signal);
    },
    async resume(sessionId, request, signal) {
      signal.throwIfAborted();
      const options = { id: sessionId, workerAncestry: request.workerAncestry };
      return run(await prepare(await harness.resumeSession(options)), request, signal);
    },
  };
}

export async function createSessionCoordinator(harness: Pick<LioraHarness, 'createSession' | 'resumeSession' | 'homeDir'>, options: {
  path: string;
  policy: ConductorPolicy;
  onActivity?: (sessionId: string, event: Event) => void;
  prepareSession?: (session: Session) => Promise<void>;
  verificationPlans?: readonly TrustedVerificationPlan[];
  trustedPipelinePlans?: readonly TrustedPipelinePlan[];
}): Promise<SessionCoordinator> {
  const home = await canonicalPath(harness.homeDir);
  const path = await canonicalPath(options.path);
  if (!containsPath(home, path) || home === path) throw new Error('Coordinator projection must be scoped to the harness account home');
  const store = await FileCoordinatorStore.open(path);
  return SessionCoordinator.open({ store, policy: options.policy, verificationPlans: options.verificationPlans, trustedPipelinePlans: options.trustedPipelinePlans, runtime: createIndependentSessionRuntime(harness, options.onActivity, options.prepareSession) });
}

export {
  FileCoordinatorStore,
  IndependentSessionUnsettledError,
  SessionCoordinator,
} from '@superliora/agent-core';
export type {
  ConductorPolicy,
  CoordinationFact,
  CoordinationFacts,
  CoordinationRecord,
  CoordinationStatus,
  CoordinatorProjection,
  CoordinatorStore,
  IndependentSessionHandle,
  IndependentSessionRequest,
  IndependentSessionRuntime,
  TrustedVerificationPlan,
  TrustedPipelinePlan,
} from '@superliora/agent-core';
