import { join } from 'pathe';
import { generate } from '@superliora/kosong';
import { forkKaosExecutionPolicy, type Kaos } from '@superliora/kaos';
import type { RuntimeDegradedEvent } from '@superliora/protocol';

import { normalizeAdditionalDirs } from '../config';
import { log } from '#/logging/logger';
import type { Logger } from '#/logging/types';
import type { AgentAPI, AgentEvent, CircuitBreakerStatus, LioraConfig, ProviderRouteStatus, SDKAgentRPC } from '#/rpc';
import type { PreparedSystemPromptContext, ResolvedAgentProfile } from '../profile';
import type { FileSnapshotStore } from '../session/file-snapshot';
import type { FileProvenanceRecorder } from '../session/file-provenance';
import type { ModelProvider } from '../session/provider/provider-manager';
import type { SessionControlHost } from '../tools/builtin/session-control';
import { noopTelemetryClient, type TelemetryClient } from '../telemetry';
import type { SandboxEnforcement } from '../config/sandbox-enforcement';
import { isNoProcessSandbox } from '../config/sandbox-enforcement';
import type { SandboxProfile } from '../tools/policies/path-access';
import { applyProcessSandboxToKaos, resolveProcessSandboxRuntime, type ProcessSandboxStatus } from '../tools/policies/process-sandbox-apply';
import type { PromisableMethods } from '../utils/types';
import { bindJobLedgerCrashMirror } from '../tools/builtin/job/job-crash-mirror';
import { bindWorkspaceSessionCatalog } from '../tools/builtin/job/job-workspace-bind';
import { recoverJobsAfterResume } from '../tools/builtin/job/job-recovery';
import { BackgroundManager, BackgroundTaskPersistence } from './background';
import { CacheFreezeGuard } from './cache';
import { ToolParallelStatus } from '../loop/tool-parallel-status';
import type { ExecutableTool } from '../loop';
import { SessionControlInputSchema, SessionControlTool } from '../tools/builtin/session-control';
import { FullCompaction } from './compaction';
import { ConfigState } from './config';
import { ContextMemory } from './context';
import { PermissionManager, type PermissionManagerOptions } from './permission';
import { AgentRecords, BlobStore, FileSystemAgentRecordPersistence, type AgentRecord, type AgentRecordPersistence, type AgentRecordsReplayOptions, type SerializableAgentEvent } from './records';
import { ReplayBuilder, type ReplayBuilderOptions } from './replay';
import { ToolManager } from './tool/index';
import { TurnFlow } from './turn';
import { InMemoryProviderRouteState, KosongLLM, type KosongLLMRoute } from './turn/kosong-llm';
import { UsageRecorder } from './usage';
import { LlmRequestLogger } from './llm-request-logger';
import { resolveCompletionBudget } from '../utils/completion-budget';
import { estimateTokens } from '../utils/tokens';
import { createRpcMethods } from './rpc-methods';
import { createGenerateProxy, buildLLMRoute as buildLLMRouteImpl } from './generate-facade';
import { CircuitBreakerRegistry } from '../runtime/circuit-breaker';
import { buildCircuitBreakerDegradedEvent } from '../runtime/circuit-breaker-degraded';
import { buildOAuthRefreshDegradedEvent } from '../runtime/oauth-refresh-degraded';
import { configureDiskPressure, isDiskFullError, reportDiskPressure } from '../runtime/disk-pressure';
import { attachLlmProviderCircuitBreakers } from './llm-provider-circuit-breaker';
import { mapCircuitBreakerRegistrySnapshot } from '../runtime/circuit-breaker-status';
import { buildAgentStatusUpdatedEvent, durableTraceRecordType } from './agent-status-updated';
import { buildRecordsWriteErrorEvent } from './agent-records-write-error';

export type { AgentRecord } from './records';
export type { BuiltinTool } from './tool';

// Unwrap only facade-created proxies when installing a host into another Agent.
const sandboxKaosTargets = new WeakMap<Kaos, Kaos>();
function sandboxKaosTarget(kaos: Kaos): Kaos {
  return sandboxKaosTargets.get(kaos) ?? kaos;
}

export class SandboxExecutionError extends Error {
  constructor(
    readonly code: 'sandbox.pending' | 'sandbox.unavailable' | 'sandbox.stale',
    message: string,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = 'SandboxExecutionError';
  }
}

// Keep the execution gates at the facade boundary, including standalone callers.
class SandboxTurnFlow extends TurnFlow {
  override prompt(...args: Parameters<TurnFlow['prompt']>) {
    this.agent.assertSandboxReady();
    return super.prompt(...args);
  }

  override steer(...args: Parameters<TurnFlow['steer']>) {
    this.agent.assertSandboxReady();
    return super.steer(...args);
  }
}

class SandboxToolManager extends ToolManager {
  override async runShellCommand(...args: Parameters<ToolManager['runShellCommand']>) {
    this.agent.assertSandboxReady();
    return super.runShellCommand(...args);
  }

  override initializeBuiltinTools(): void {
    super.initializeBuiltinTools();
    for (const [name, tool] of this.builtinTools) {
      this.builtinTools.set(name, this.guardTool(tool));
    }
  }

  override get loopTools() {
    return super.loopTools.map((tool) => this.guardTool(tool));
  }

  private guardTool(tool: ExecutableTool): ExecutableTool {
    // Preserve prototype-backed tool descriptors and receiver binding.
    const revision = this.agent.sandboxGeneration;
    return new Proxy(tool, {
      get: (target, property) => {
        if (property !== 'resolveExecution') {
          const value: unknown = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        }
        return async (input: unknown) => {
          // Only the concrete native lifecycle tool can recover existing work.
          // Validate and snapshot its input so list cannot mutate into spawn
          // after approval. Name matching would exempt arbitrary custom tools.
          const nativeInput = Object.getPrototypeOf(target) === SessionControlTool.prototype
            ? SessionControlInputSchema.safeParse(input) : undefined;
          const recovery = nativeInput?.success === true &&
            (nativeInput.data.operation === 'list' || nativeInput.data.operation === 'wait' || nativeInput.data.operation === 'stop');
          const resolvedInput = recovery ? Object.freeze(nativeInput.data) : input;
          if (!recovery) this.agent.assertSandboxReady(revision);
          const execution = await target.resolveExecution(resolvedInput);
          if (!recovery) this.agent.assertSandboxReady(revision);
          if (!('execute' in execution)) return execution;
          return {
            ...execution,
            execute: async (...args: Parameters<typeof execution.execute>) => {
              // Recheck after approval / resolution: live updates can arrive there.
              if (!recovery) this.agent.assertSandboxReady(revision);
              return execution.execute(...args);
            },
          };
        };
      },
    });
  }
}

export type AgentType = 'main' | 'sub' | 'independent';

export interface AgentOptions {
  readonly role?: 'worker' | 'interactive-conductor';
  readonly kaos: Kaos;
  readonly config?: LioraConfig;
  readonly homedir?: string;
  readonly rpc?: Partial<SDKAgentRPC>;
  readonly persistence?: AgentRecordPersistence;
  readonly type?: AgentType;
  readonly generate?: typeof generate;
  readonly modelProvider?: ModelProvider;
  readonly sessionControl?: SessionControlHost;
  readonly permission?: PermissionManagerOptions;
  readonly log?: Logger;
  readonly telemetry?: TelemetryClient;
  readonly replay?: ReplayBuilderOptions;
  readonly additionalDirs?: readonly string[];
  readonly fileSnapshots?: FileSnapshotStore;
  readonly fileProvenance?: FileProvenanceRecorder;
  readonly sandboxProfile?: SandboxProfile;
  readonly sandboxEnforcement?: SandboxEnforcement;
}

export class Agent {
  readonly role: 'worker' | 'interactive-conductor';
  readonly type: AgentType;
  private _kaos: Kaos;
  readonly kimiConfig: LioraConfig | undefined;
  readonly homedir: string | undefined;
  readonly rpc: Partial<SDKAgentRPC> | undefined;
  readonly rawGenerate: typeof generate;
  readonly modelProvider: ModelProvider | undefined;
  readonly sessionControl: SessionControlHost | undefined;
  readonly log: Logger;
  readonly telemetry: TelemetryClient;
  readonly llmRequestLogger: LlmRequestLogger;
  readonly blobStore: BlobStore | undefined;
  readonly records: AgentRecords;
  readonly fullCompaction: FullCompaction;
  readonly cacheFreezeGuard: CacheFreezeGuard;
  readonly toolParallelStatus: ToolParallelStatus;
  readonly context: ContextMemory;
  readonly config: ConfigState;
  readonly turn: TurnFlow;
  readonly permission: PermissionManager;
  readonly usage: UsageRecorder;
  readonly tools: ToolManager;
  readonly background: BackgroundManager;
  readonly replayBuilder: ReplayBuilder;
  readonly providerRouteState: InMemoryProviderRouteState;
  readonly circuitBreakerRegistry: CircuitBreakerRegistry;
  readonly fileSnapshots: FileSnapshotStore | undefined;
  readonly fileProvenance: FileProvenanceRecorder | undefined;
  sandboxProfile: SandboxProfile | undefined;
  sandboxEnforcement: SandboxEnforcement | undefined;
  processSandboxStatus: ProcessSandboxStatus | undefined;
  private additionalDirs: readonly string[];
  private activeProfile: ResolvedAgentProfile | undefined;
  private sandboxPending = false;
  private sandboxError: Error | undefined;
  private sandboxRevision = 0;
  private sandboxRefresh: Promise<void> = Promise.resolve();
  private kaosView: { readonly target: Kaos; readonly revision: number; readonly guarded: Kaos } | undefined;

  constructor(options: AgentOptions) {
    this.role = options.role ?? 'worker';
    this.type = options.type ?? 'main';
    this._kaos = forkKaosExecutionPolicy(sandboxKaosTarget(options.kaos));
    this.kimiConfig = options.config;
    this.homedir = options.homedir;
    this.rpc = options.rpc;
    this.rawGenerate = options.generate ?? generate;
    this.modelProvider = options.modelProvider;
    this.sessionControl = options.sessionControl;
    this.log = options.log ?? log;
    this.telemetry = options.telemetry ?? noopTelemetryClient;
    this.additionalDirs = normalizeAdditionalDirs(options.additionalDirs ?? []);
    this.fileSnapshots = options.fileSnapshots;
    this.fileProvenance = options.fileProvenance;
    this.sandboxProfile = options.sandboxProfile;
    this.sandboxEnforcement = options.sandboxEnforcement;
    this.llmRequestLogger = new LlmRequestLogger(this.log);
    this.blobStore = options.homedir ? new BlobStore({ blobsDir: join(options.homedir, 'blobs') }) : undefined;
    this.records = new AgentRecords(this, options.persistence ?? (options.homedir
      ? new FileSystemAgentRecordPersistence(join(options.homedir, 'wire.jsonl'), {
          onError: (error) => this.emitRecordsWriteError(error),
          blobStore: this.blobStore,
          compressOnClose: true,
        })
      : undefined));
    this.fullCompaction = new FullCompaction(this);
    this.cacheFreezeGuard = new CacheFreezeGuard();
    this.toolParallelStatus = new ToolParallelStatus();
    this.context = new ContextMemory(this);
    this.config = new ConfigState(this);
    configureDiskPressure({ homeDir: this.homedir, workDir: this.config.cwd });
    void this.refreshProcessSandbox();
    this.turn = new SandboxTurnFlow(this);
    this.permission = new PermissionManager(this, options.permission);
    this.usage = new UsageRecorder(this);
    this.background = new BackgroundManager(this, this.homedir === undefined ? undefined : new BackgroundTaskPersistence(this.homedir));
    this.tools = new SandboxToolManager(this);
    if (this.type === 'main' && this.homedir !== undefined) {
      bindJobLedgerCrashMirror(this.tools.getStore(), this.homedir);
      bindWorkspaceSessionCatalog(this.tools.getStore(), { workDir: this.config.cwd, sourceAgentDir: this.homedir });
    }
    this.replayBuilder = new ReplayBuilder(this, options.replay);
    this.providerRouteState = new InMemoryProviderRouteState();
    this.circuitBreakerRegistry = new CircuitBreakerRegistry({ onScopeOpened: (scopeId, reason) => this.emitCircuitBreakerDegraded(scopeId, reason) });
  }

  get kaos(): Kaos {
    // Stable identity per host + revision so `agent.kaos === agent.kaos` holds.
    const cached = this.kaosView;
    if (cached?.target === this._kaos && cached.revision === this.sandboxRevision) return cached.guarded;
    const guarded = this.guardKaos(this._kaos, this.sandboxRevision);
    this.kaosView = { target: this._kaos, revision: this.sandboxRevision, guarded };
    return guarded;
  }

  private guardKaos(kaos: Kaos, revision: number): Kaos {
    const guarded = new Proxy(kaos, {
      get: (target, property) => {
        if (property === 'exec' || property === 'execWithEnv') {
          return (...args: unknown[]) => {
            try {
              this.assertSandboxReady(revision);
              return Reflect.apply(target[property], target, args);
            } catch (error) {
              return Promise.reject(error);
            }
          };
        }
        if (property === 'withCwd' || property === 'withEnv') {
          return (...args: unknown[]) => {
            // Never snapshot an unresolved host configuration into a child.
            this.assertSandboxReady(revision);
            const child = Reflect.apply(target[property], target, args) as Kaos;
            return this.guardKaos(child, revision);
          };
        }
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    sandboxKaosTargets.set(guarded, kaos);
    return guarded;
  }

  get runtimeConfig(): LioraConfig | undefined {
    return this.modelProvider?.currentConfig?.() ?? this.kimiConfig;
  }

  setKaos(kaos: Kaos): void {
    try {
      this._kaos = forkKaosExecutionPolicy(sandboxKaosTarget(kaos));
    } catch (error) {
      // A rejected host installation must not leave the old host executable.
      ++this.sandboxRevision;
      this.sandboxPending = false;
      this.processSandboxStatus = undefined;
      this.sandboxError = new SandboxExecutionError(
        'sandbox.unavailable', 'Execution host cannot isolate sandbox policy.', error,
      );
      this.sandboxRefresh = Promise.reject(this.sandboxError);
      void this.sandboxRefresh.catch(() => undefined);
      return;
    }
    void this.rebuildSandboxTools(this.refreshProcessSandbox());
  }

  setKaosCwd(cwd: string): Promise<void> {
    this.setKaos(this._kaos.withCwd(cwd));
    return this.sandboxRefresh;
  }

  getAdditionalDirs(): readonly string[] {
    return this.additionalDirs;
  }

  setAdditionalDirs(additionalDirs: readonly string[]): void {
    this.additionalDirs = normalizeAdditionalDirs(additionalDirs);
    void this.rebuildSandboxTools(this.refreshProcessSandbox());
  }

  /**
   * Update the path ceiling and rebuild native tools. Process enforcement,
   * when requested, is refreshed against the same policy generation.
   */
  setSandboxProfile(profile: SandboxProfile): void {
    void this.setSandboxPolicy({ profile });
  }

  setSandboxEnforcement(enforcement: SandboxEnforcement): void {
    void this.setSandboxPolicy({ enforcement });
  }

  /** Apply a combined RPC update without activating an intermediate policy. */
  setSandboxPolicy(policy: { profile?: SandboxProfile; enforcement?: SandboxEnforcement }): Promise<void> {
    if (policy.profile !== undefined) {
      this.sandboxProfile = policy.profile;
    }
    if (policy.enforcement !== undefined) {
      this.sandboxEnforcement = policy.enforcement;
    }
    if (this.sandboxEnforcement === 'process' && (this.sandboxProfile === undefined || this.sandboxProfile === 'off')) {
      this.sandboxProfile = 'workspace';
    }
    return this.rebuildSandboxTools(this.refreshProcessSandbox());
  }

  get sandboxState(): 'pending' | 'error' | 'ready' {
    return this.sandboxPending ? 'pending' : this.sandboxError !== undefined ? 'error' : 'ready';
  }

  get sandboxFailure(): unknown {
    return this.sandboxError;
  }

  /** Reject rather than run with stale, unresolved, or unavailable confinement. */
  get sandboxGeneration(): number {
    return this.sandboxRevision;
  }

  assertSandboxReady(revision?: number): void {
    if (this.sandboxPending) {
      throw new SandboxExecutionError('sandbox.pending', 'Sandbox configuration is pending; execution is blocked.');
    }
    if (this.sandboxError !== undefined) throw this.sandboxError;
    if (revision !== undefined && revision !== this.sandboxRevision) {
      throw new SandboxExecutionError('sandbox.stale', 'Sandbox policy changed; resolve a fresh tool execution.');
    }
  }

  /** Compatibility entry point for Bash and current hosts. */
  ensureSandboxReady(): Promise<void> {
    return this.waitForSandbox();
  }

  private rebuildSandboxTools(ready: Promise<void>): Promise<void> {
    this.tools.initializeBuiltinTools();
    return ready;
  }

  /** Startup and hosts may await this; ignored setter promises are also observed. */
  async waitForSandbox(): Promise<void> {
    let pending: Promise<void>;
    do {
      pending = this.sandboxRefresh;
      try {
        await pending;
      } catch (error) {
        if (pending === this.sandboxRefresh) throw error;
      }
    } while (pending !== this.sandboxRefresh);
    this.assertSandboxReady();
  }

  private refreshProcessSandbox(): Promise<void> {
    const revision = ++this.sandboxRevision;
    const desired = this.sandboxEnforcement ?? 'lexical';
    const profile = this.sandboxProfile ?? 'off';
    const kaos = this._kaos;
    this.sandboxPending = true;
    this.sandboxError = undefined;
    this.processSandboxStatus = undefined;

    const fail = (error: unknown): never => {
      if (revision === this.sandboxRevision) {
        this.sandboxError = new SandboxExecutionError(
          'sandbox.unavailable',
          `Sandbox activation failed: ${error instanceof Error ? error.message : String(error)}`,
          error,
        );
        this.sandboxPending = false;
      }
      throw revision === this.sandboxRevision ? this.sandboxError : error;
    };
    // Lexical needs no asynchronous probe. Preserve synchronous standalone startup.
    if (desired === 'lexical') {
      try {
        applyProcessSandboxToKaos(kaos, undefined);
        this.processSandboxStatus = { desired, effective: 'lexical' };
        this.sandboxPending = false;
        this.sandboxRefresh = Promise.resolve();
      } catch (error) {
        this.sandboxRefresh = Promise.resolve().then(() => fail(error));
      }
    } else {
      const options = {
        desired,
        profile,
        noProcess: isNoProcessSandbox(),
        workspaceDir: this.config.cwd,
        additionalDirs: this.additionalDirs,
      };
      this.sandboxRefresh = resolveProcessSandboxRuntime(options).then((resolved) => {
        // An old Docker probe must never overwrite a newer policy or host.
        if (revision !== this.sandboxRevision) return;
        if (resolved.status.effective !== 'process' || resolved.config === undefined) {
          throw new Error(resolved.status.warning ?? 'Requested process sandbox is unavailable.');
        }
        applyProcessSandboxToKaos(kaos, resolved.config);
        if (resolved.coercedProfile !== undefined && this.sandboxProfile !== resolved.coercedProfile) {
          this.sandboxProfile = resolved.coercedProfile;
        }
        this.tools.initializeBuiltinTools();
        this.processSandboxStatus = resolved.status;
        this.sandboxPending = false;
      }).catch(fail);
    }
    // Observe startup and legacy void call sites without converting failure to success.
    void this.sandboxRefresh.catch(() => undefined);
    return this.sandboxRefresh;
  }

  get generate(): typeof generate {
    return createGenerateProxy(this);
  }

  get llm(): KosongLLM {
    return new KosongLLM({
      provider: this.config.provider,
      systemPrompt: this.config.systemPrompt,
      requestContext: () => this.sessionControl?.contextProjection?.(),
      layeredSystemPrompt: this.config.layeredSystemPrompt,
      capability: this.config.modelCapabilities,
      generate: this.generate,
      completionBudgetConfig: resolveCompletionBudget({ maxOutputSize: this.config.maxOutputSize }),
      usedContextTokens: () => this.context.tokenCount,
      route: this.buildLLMRoute(),
      routeState: this.providerRouteState,
      onRouteStatusChanged: () => this.emitStatusUpdated(),
      circuitObserver: attachLlmProviderCircuitBreakers(this, () => this.emitStatusUpdated()),
      log: this.log,
    });
  }

  private buildLLMRoute(): KosongLLMRoute | undefined {
    return buildLLMRouteImpl(this);
  }

  useProfile(profile: ResolvedAgentProfile, context?: PreparedSystemPromptContext): void {
    this.activeProfile = profile;
    const promptContext = { osEnv: this.kaos.osEnv, cwd: this.config.cwd, cwdListing: context?.cwdListing, agentsMd: context?.agentsMd, additionalDirsInfo: context?.additionalDirsInfo };
    this.config.update({ profileName: profile.name, systemPrompt: profile.systemPrompt(promptContext), layeredSystemPrompt: profile.layeredSystemPrompt?.(promptContext) });
    this.config.setSystemPromptMeta({ agentsMdTokens: estimateTokens(context?.agentsMd ?? ''), cwdListingTokens: estimateTokens(context?.cwdListing ?? ''), additionalDirsTokens: estimateTokens(context?.additionalDirsInfo ?? '') });
  }

  refreshSystemPromptContext(context: PreparedSystemPromptContext): void {
    if (this.activeProfile !== undefined) this.useProfile(this.activeProfile, context);
  }

  async resume(options?: AgentRecordsReplayOptions): Promise<{ warning?: string }> {
    await this.ensureSandboxReady();
    const result = await this.records.replay(options);
    await this.ensureSandboxReady();
    this.replayBuilder.postRestoring = true;
    try {
      await this.background.loadFromDisk();
      await this.background.reconcile();
      if (this.type === 'main') await recoverJobsAfterResume({ store: this.tools.getStore(), agent: this });
      this.context.finishResume();
      this.turn.finishResume();
    } finally {
      this.replayBuilder.postRestoring = false;
    }
    return result;
  }

  get rpcMethods(): PromisableMethods<AgentAPI> {
    return createRpcMethods(this);
  }

  emitEvent = (event: AgentEvent): void => {
    if (this.records.restoring) return;
    const recordType = durableTraceRecordType(event.type);
    if (recordType !== undefined) this.records.logRecord({ type: recordType, event: event as SerializableAgentEvent });
    void this.rpc?.emitEvent?.(event);
  };

  providerRouteStatus(): ProviderRouteStatus | null {
    const route = this.buildLLMRoute();
    return route === undefined ? null : this.providerRouteState.snapshot(route);
  }

  circuitBreakerStatus(): CircuitBreakerStatus | undefined {
    return mapCircuitBreakerRegistrySnapshot(this.circuitBreakerRegistry.snapshot());
  }

  resetProviderRouteStatus(): ProviderRouteStatus | null {
    const route = this.buildLLMRoute();
    if (route === undefined) return null;
    const changed = this.providerRouteState.reset(route);
    if (changed) this.emitStatusUpdated();
    return this.providerRouteState.snapshot(route);
  }

  emitStatusUpdated(): void {
    if (!this.records.restoring && this.config.hasModel) this.emitEvent(buildAgentStatusUpdatedEvent(this));
  }

  emitCircuitBreakerDegraded(scopeId: string, lastTripReason?: string): void {
    if (this.records.restoring) return;
    this.emitEvent(buildCircuitBreakerDegradedEvent(scopeId, lastTripReason));
    this.emitStatusUpdated();
  }

  emitOAuthRefreshDegraded(event: RuntimeDegradedEvent): void {
    if (!this.records.restoring) this.emitEvent(event);
  }

  emitOAuthRefreshDegradedFromReason(reason: string, atMs: number = Date.now()): void {
    this.emitOAuthRefreshDegraded(buildOAuthRefreshDegradedEvent(reason, atMs));
  }

  private emitRecordsWriteError(error: unknown, record?: AgentRecord): void {
    this.log.error('wire record persist failed', { agentHomedir: this.homedir, recordType: record?.type, error });
    this.emitEvent(buildRecordsWriteErrorEvent(error, record));
    if (isDiskFullError(error)) void reportDiskPressure(error);
  }
}
