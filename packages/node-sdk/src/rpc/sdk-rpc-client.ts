import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, parse } from 'node:path';

import {
  applySandboxPolicyToAgents,
  sandboxPolicyAtLeast,
  type SandboxPolicyUpdate,
  createRPC,
  ensureConfigFile,
  getRootLogger,
  LioraCore,
  log,
  noopTelemetryClient,
  projectIndependentSessionActivity,
  resolveConfigPath,
  resolveLioraHome,
  resolveLoggingConfig,
  setUnexpectedErrorHandler,
  type CoreAPI,
  type QuestionRequest,
  type QuestionResult,
  type RPCCallOptions,
  type OAuthTokenProviderResolver,
  type RPCMethods,
  type RuntimeDegradedEvent,
  type SDKAPI,
  type TelemetryClient,
} from '@superliora/agent-core';
import type { Kaos } from '@superliora/kaos';
import { canonicalPath } from '@superliora/agent-core/session/coordinator/authorized-path';
import { assertKimiHostIdentity, createKimiDefaultHeaders } from '@superliora/oauth';

import { createSessionCoordinator, type SessionCoordinator } from '#/orchestration/index';
import type { QuestionHandler } from '#/session/events';
import { LioraAuthFacade } from '#/auth';
import { LioraHarness } from '#/harness/liora-harness';
import { ClientAPI, SDKRpcClientBase, type SessionIdRpcInput } from '#/rpc/rpc';
import type {
  CreateSessionOptions,
  LioraHarnessOptions,
  IndependentSessionActivity,
  IndependentSessionFact,
  KimiHostIdentity,
  OAuthRefreshOutcome,
  ResumeSessionInput,
  ResumedSessionSummary,
  SessionSummary,
} from '#/session/types';

export interface SDKRpcClientOptions {
  readonly homeDir?: string;
  readonly configPath?: string;
  readonly identity?: KimiHostIdentity;
  readonly resolveOAuthTokenProvider?: OAuthTokenProviderResolver;
  readonly telemetry?: TelemetryClient;
  readonly onOAuthRefresh?: (outcome: OAuthRefreshOutcome) => void;
  readonly resolveIndependentQuestionHandler?: (conductorSessionId: string) => QuestionHandler | undefined;
  readonly resolveSessionCoordinator?: (sessionId: string, scope: { readonly workDir: string; readonly additionalDirs: readonly string[] }) => Promise<SessionCoordinator>;
}

export class SDKRpcClient extends SDKRpcClientBase {
  readonly homeDir: string;
  readonly configPath: string;
  readonly identity: KimiHostIdentity | undefined;
  readonly telemetry: TelemetryClient;
  readonly auth: LioraAuthFacade;
  readonly core: LioraCore;

  private readonly ready: Promise<RPCMethods<CoreAPI>>;
  private readonly resolveIndependentQuestionHandler: SDKRpcClientOptions['resolveIndependentQuestionHandler'];

  constructor(options: SDKRpcClientOptions = {}) {
    super();
    this.resolveIndependentQuestionHandler = options.resolveIndependentQuestionHandler;
    this.identity =
      options.identity === undefined ? undefined : assertKimiHostIdentity(options.identity);
    this.homeDir = resolveLioraHome(options.homeDir);
    this.configPath = resolveConfigPath({
      homeDir: this.homeDir,
      configPath: options.configPath,
    });
    this.telemetry = options.telemetry ?? noopTelemetryClient;

    let coreRef: LioraCore | undefined;
    this.auth = new LioraAuthFacade({
      homeDir: this.homeDir,
      configPath: this.configPath,
      identity: this.identity,
      onRefresh: (outcome) => {
        options.onOAuthRefresh?.(outcome);
        if (!outcome.success) {
          coreRef?.broadcastOAuthRefreshDegraded(outcome);
        }
      },
    });

    void getRootLogger().configure(resolveLoggingConfig({ homeDir: this.homeDir }));
    // Route Emitter/DI listener failures to the file logger — default
    // console.error paints onto the raw-mode TUI TTY.
    setUnexpectedErrorHandler((err) => {
      log.error('unexpected', err);
    });

    const [coreRpc, sdkRpc] = createRPC<CoreAPI, SDKAPI>();
    this.core = new LioraCore(coreRpc, {
      homeDir: options.homeDir,
      configPath: this.configPath,
      kimiRequestHeaders: this.createKimiRequestHeaders(),
      resolveOAuthTokenProvider:
        options.resolveOAuthTokenProvider ?? this.auth.resolveOAuthTokenProvider,
      telemetry: this.telemetry,
      appVersion: this.identity?.version,
      resolveSessionCoordinator: options.resolveSessionCoordinator,
    });
    coreRef = this.core;
    this.ready = sdkRpc(new ClientAPI(this));
  }

  override async requestQuestion(
    request: QuestionRequest & { sessionId: string; agentId: string },
    options?: RPCCallOptions,
  ): Promise<QuestionResult> {
    const conductorSessionId = this.core.sessions.get(request.sessionId)?.options.workerAncestry?.conductorSessionId;
    const fallback = conductorSessionId === undefined ? undefined : this.resolveIndependentQuestionHandler?.(conductorSessionId);
    return super.requestQuestion(request, options, fallback);
  }

  async ensureConfigFile(): Promise<void> {
    await ensureConfigFile(this.configPath);
  }

  async close(): Promise<void> {
    await this.core.close();
    try {
      await getRootLogger().flush();
    } catch {
      // never let logger flush block process exit
    }
  }

  protected async getRpc(): Promise<RPCMethods<CoreAPI>> {
    return this.ready;
  }

  override async createSessionWithKaos(
    input: CreateSessionOptions,
    kaos: Kaos,
    persistenceKaos?: Kaos,
  ): Promise<SessionSummary> {
    return this.core.createSessionWithOverrides(input, { kaos, persistenceKaos });
  }

  /**
   * Bypass in-process RPC `simulateNetwork` (JSON.stringify/parse). Large
   * resume payloads can exceed V8's max string length and kill the process.
   */
  override async resumeSession(input: ResumeSessionInput): Promise<ResumedSessionSummary> {
    return this.core.resumeSessionWithOverrides({ ...input, sessionId: input.id }, {});
  }

  override async resumeSessionWithKaos(
    input: ResumeSessionInput,
    kaos: Kaos,
    persistenceKaos?: Kaos,
  ): Promise<ResumedSessionSummary> {
    return this.core.resumeSessionWithOverrides(
      { ...input, sessionId: input.id },
      { kaos, persistenceKaos },
    );
  }

  /** Same bypass as {@link resumeSession} — reload returns a full resume payload. */
  override async reloadSession(input: SessionIdRpcInput): Promise<ResumedSessionSummary> {
    return this.core.reloadSession({
      sessionId: input.sessionId,
    });
  }

  override emergencyFlushSync(): void {
    this.core.emergencyFlushSync();
  }

  override broadcastRuntimeDegraded(event: RuntimeDegradedEvent): void {
    this.core.broadcastRuntimeDegraded(event);
  }


  private createKimiRequestHeaders(): Record<string, string> | undefined {
    if (this.identity === undefined) return undefined;
    return createKimiDefaultHeaders({
      homeDir: this.homeDir,
      ...this.identity,
    });
  }
}

export function createLioraHarness(options: LioraHarnessOptions): LioraHarness {
  const coordinators = new Map<string, Promise<SessionCoordinator>>();
  const readyCoordinators = new Map<string, SessionCoordinator>();
  const authorizedScopes = new Map<string, readonly string[]>();
  const fact = (value: object | undefined): IndependentSessionFact | undefined => {
    if (value === undefined) return undefined;
    // Whitelist card facts: never publish model prompts, mailbox payloads,
    // worker output bodies, ownership leases or durable secret-bearing inputs.
    const source = value as IndependentSessionFact;
    return { id: source.id, sessionId: source.sessionId, revision: source.revision,
      status: source.status, purpose: source.purpose, cwd: source.cwd, kind: source.kind,
      workerAncestry: source.workerAncestry, reusable: source.reusable, ownerStatus: source.ownerStatus,
      originAncestry: source.originAncestry, coordinationId: source.coordinationId,
      parentAgentId: source.parentAgentId, parentSessionId: source.parentSessionId,
      pipeline: source.pipeline === undefined ? undefined : { planId: source.pipeline.planId, status: source.pipeline.status } };
  };
  const snapshot = (sessionId: string): Extract<IndependentSessionActivity, { type: 'snapshot' }> => {
    const current = readyCoordinators.get(sessionId)?.facts();
    return { type: 'snapshot', conductorSessionId: sessionId, records: current?.records.map((value) => fact(value)!) ?? [],
      total: current?.total, truncated: current?.truncated, counts: current?.counts };
  };
  const listeners = new Map<string, Set<(activity: IndependentSessionActivity) => void>>();
  const projectionUnsubscribers = new Set<() => void>();
  const questionHandlers = new Map<string, QuestionHandler>();
  const notify = (sessionId: string, activity: IndependentSessionActivity): void => {
    for (const listener of listeners.get(sessionId) ?? []) {
      try { listener(activity); } catch (error) { log.warn('Independent session activity listener failed', { error }); }
    }
  };
  let harness: LioraHarness;
  const rpc = new SDKRpcClient({
    ...options,
    resolveIndependentQuestionHandler: (sessionId) => questionHandlers.get(sessionId),
    resolveSessionCoordinator: async (sessionId, scope) => {
      const roots = [...new Set(await Promise.all([scope.workDir, ...scope.additionalDirs].map((root) => canonicalPath(root))))].toSorted();
      if (roots.some((root) => parse(root).root === root)) throw new Error('Interactive coordination cannot authorize a filesystem root');
      const bound = authorizedScopes.get(sessionId);
      if (bound !== undefined && JSON.stringify(bound) !== JSON.stringify(roots)) {
        throw new Error('Independent-session authorization roots changed; start a new interactive session');
      }
      authorizedScopes.set(sessionId, roots);
      let pending = coordinators.get(sessionId);
      if (pending === undefined) {
        const key = createHash('sha256').update(sessionId).digest('hex');
        pending = createSessionCoordinator(harness, {
          path: join(harness.homeDir, 'coordination', `${key}.json`),
          policy: { role: 'conductor', maxConcurrent: 4, authorizedRoots: roots },
          prepareSession: async (worker) => {
            // Read authoritative host metadata at each admission AND resume.
            // Detached workers may outlive a closed conductor; use its durable
            // native state then, never the model's request or worker metadata.
            const parent = rpc.core.sessions.get(sessionId);
            const custom = parent?.metadata.custom ?? (JSON.parse(await readFile(
              join((await rpc.core.sessionStore.get(sessionId)).sessionDir, 'state.json'), 'utf8',
            )) as { custom: Record<string, unknown> }).custom;
            if ((custom['sandboxProfile'] !== undefined && custom['sandboxProfile'] !== 'off' && custom['sandboxProfile'] !== 'workspace' && custom['sandboxProfile'] !== 'read-only') ||
              (custom['sandboxEnforcement'] !== undefined && custom['sandboxEnforcement'] !== 'lexical' && custom['sandboxEnforcement'] !== 'process')) {
              throw new Error('Invalid authoritative conductor sandbox policy');
            }
            const minimum: SandboxPolicyUpdate = {
              profile: custom['sandboxProfile'] === 'read-only' ? 'read-only' : custom['sandboxProfile'] === 'workspace' ? 'workspace' : 'off',
              enforcement: custom['sandboxEnforcement'] === 'process' ? 'process' : 'lexical',
            };
            const session = rpc.core.sessions.get(worker.id);
            if (session === undefined) throw new Error('Independent worker is not active during sandbox preparation');
            const policy = sandboxPolicyAtLeast({
              profile: session.getReadyAgent('main')?.sandboxProfile,
              enforcement: session.getReadyAgent('main')?.sandboxEnforcement,
            }, minimum);
            Object.assign(session.options, { sandboxMinimum: minimum });
            const updates = [...session.readyAgents()].map((agent) => applySandboxPolicyToAgents([agent],
              sandboxPolicyAtLeast({ profile: agent.sandboxProfile, enforcement: agent.sandboxEnforcement }, minimum)));
            const results = await Promise.allSettled(updates);
            const failures = results.flatMap((result) => result.status === 'rejected' ? [result.reason as unknown] : []);
            if (failures.length > 0) throw new AggregateError(failures, 'Sandbox policy activation failed for one or more Agents.');
            Object.assign(session.metadata.custom, { sandboxProfile: policy.profile, sandboxEnforcement: policy.enforcement });
            await session.writeMetadata();
          },
          onActivity: (workerSessionId, event) => {
            if (event.sessionId !== workerSessionId ||
              (event.workerAncestry !== undefined && event.workerAncestry.sessionId !== workerSessionId)) return;
            const coordinationId = event.workerAncestry?.coordinationId ?? workerSessionId;
            const record = fact(readyCoordinators.get(sessionId)?.fact(coordinationId));
            if (record === undefined) return;
            const preview = projectIndependentSessionActivity(event);
            if (preview !== undefined) notify(sessionId, { type: 'event', conductorSessionId: sessionId, record, event: preview });
          },
        });
        coordinators.set(sessionId, pending);
        void pending.then((coordinator) => {
          readyCoordinators.set(sessionId, coordinator);
          projectionUnsubscribers.add(coordinator.onChange((snapshot) => {
            notify(sessionId, { type: 'snapshot', conductorSessionId: sessionId, records: snapshot.records.map((value) => fact(value)!), total: snapshot.total, truncated: snapshot.truncated, counts: snapshot.counts });
          }));
        }).catch(() => undefined);
        void pending.catch(() => {
          if (coordinators.get(sessionId) === pending) { coordinators.delete(sessionId); authorizedScopes.delete(sessionId); }
        });
      }
      return pending;
    },
  });
  const questionScopes = new Map<string, { conductorSessionId: string; coordinationId?: string }>();
  const stopQuestionAttention = rpc.onQuestionAttention((change) => {
    const key = JSON.stringify([change.sessionId, change.agentId]);
    let scope = questionScopes.get(key);
    if (scope === undefined || change.attention === 'question') {
      const ancestry = rpc.core.sessions.get(change.sessionId)?.options.workerAncestry;
      scope = { conductorSessionId: ancestry?.conductorSessionId ?? change.sessionId, coordinationId: ancestry?.coordinationId };
      questionScopes.set(key, scope);
    }
    const record = scope.coordinationId === undefined ? undefined : fact(readyCoordinators.get(scope.conductorSessionId)?.fact(scope.coordinationId));
    notify(scope.conductorSessionId, { type: 'attention', conductorSessionId: scope.conductorSessionId, record, ...change });
    if (change.attention === undefined) questionScopes.delete(key);
  });
  harness = new LioraHarness(rpc, {
    identity: rpc.identity,
    uiMode: options.uiMode,
    homeDir: rpc.homeDir,
    configPath: rpc.configPath,
    auth: rpc.auth,
    telemetry: rpc.telemetry,
    ensureConfigFile: () => rpc.ensureConfigFile(),
    subscribeIndependentSessionActivity: (sessionId, listener) => {
      let scoped = listeners.get(sessionId);
      if (scoped === undefined) { scoped = new Set(); listeners.set(sessionId, scoped); }
      scoped.add(listener);
      try {
        listener(snapshot(sessionId));
      } catch (error) {
        scoped.delete(listener);
        throw error;
      }
      return () => { scoped.delete(listener); if (scoped.size === 0) listeners.delete(sessionId); };
    },
    setIndependentSessionQuestionHandler: (sessionId, handler) => {
      if (handler === undefined) questionHandlers.delete(sessionId); else questionHandlers.set(sessionId, handler);
    },
    getIndependentSessionRecord: (sessionId, independentId) => fact(readyCoordinators.get(sessionId)?.fact(independentId)),
    beforeClose: async () => {
      const results = await Promise.allSettled([...coordinators.values()].map(async (pending) => (await pending).close()));
      const failure = results.find((result) => result.status === 'rejected');
      if (failure?.status === 'rejected') throw failure.reason;
      for (const unsubscribe of projectionUnsubscribers) unsubscribe();
      stopQuestionAttention();
      questionHandlers.clear();
      questionScopes.clear();
      listeners.clear();
    },
    onClose: () => rpc.close(),
    sessionStartedProperties: options.sessionStartedProperties,
  });
  return harness;
}
