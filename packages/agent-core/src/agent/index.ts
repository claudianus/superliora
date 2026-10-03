import { join } from 'pathe';
import { generate } from '@superliora/kosong';
import type { Kaos } from '@superliora/kaos';
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
export type AgentType = 'main' | 'sub' | 'independent';

export interface AgentOptions {
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
  private sandboxReady: Promise<void>;

  constructor(options: AgentOptions) {
    this.type = options.type ?? 'main';
    this._kaos = options.kaos;
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
    this.sandboxReady = this.refreshProcessSandbox();
    this.turn = new TurnFlow(this);
    this.permission = new PermissionManager(this, options.permission);
    this.usage = new UsageRecorder(this);
    this.background = new BackgroundManager(this, this.homedir === undefined ? undefined : new BackgroundTaskPersistence(this.homedir));
    this.tools = new ToolManager(this);
    if (this.type === 'main' && this.homedir !== undefined) {
      bindJobLedgerCrashMirror(this.tools.getStore(), this.homedir);
      bindWorkspaceSessionCatalog(this.tools.getStore(), { workDir: this.config.cwd, sourceAgentDir: this.homedir });
    }
    this.replayBuilder = new ReplayBuilder(this, options.replay);
    this.providerRouteState = new InMemoryProviderRouteState();
    this.circuitBreakerRegistry = new CircuitBreakerRegistry({ onScopeOpened: (scopeId, reason) => this.emitCircuitBreakerDegraded(scopeId, reason) });
  }

  get kaos(): Kaos {
    return this._kaos;
  }

  get runtimeConfig(): LioraConfig | undefined {
    return this.modelProvider?.currentConfig?.() ?? this.kimiConfig;
  }

  setKaos(kaos: Kaos): void {
    this._kaos = kaos;
    this.sandboxReady = this.refreshProcessSandbox();
  }

  getAdditionalDirs(): readonly string[] {
    return this.additionalDirs;
  }

  setAdditionalDirs(additionalDirs: readonly string[]): void {
    this.additionalDirs = normalizeAdditionalDirs(additionalDirs);
    this.tools.initializeBuiltinTools();
    this.sandboxReady = this.refreshProcessSandbox();
  }

  setSandboxProfile(profile: SandboxProfile): void {
    this.sandboxProfile = profile;
    this.tools.initializeBuiltinTools();
    this.sandboxReady = this.refreshProcessSandbox();
  }

  setSandboxEnforcement(enforcement: SandboxEnforcement): void {
    this.sandboxEnforcement = enforcement;
    if (enforcement === 'process' && (this.sandboxProfile === undefined || this.sandboxProfile === 'off')) this.sandboxProfile = 'workspace';
    this.tools.initializeBuiltinTools();
    this.sandboxReady = this.refreshProcessSandbox();
  }

  async ensureSandboxReady(): Promise<void> {
    await this.sandboxReady;
    if (this.sandboxEnforcement === 'process' && this.processSandboxStatus?.effective !== 'process') {
      throw new Error(this.processSandboxStatus?.warning ?? 'Requested process sandbox is unavailable.');
    }
  }

  private async refreshProcessSandbox(): Promise<void> {
    const desired = this.sandboxEnforcement ?? 'lexical';
    try {
      const resolved = await resolveProcessSandboxRuntime({
        desired,
        profile: this.sandboxProfile ?? 'off',
        noProcess: isNoProcessSandbox(),
        workspaceDir: this.config.cwd,
        additionalDirs: this.additionalDirs,
      });
      this.processSandboxStatus = resolved.status;
      if (resolved.coercedProfile !== undefined) this.sandboxProfile = resolved.coercedProfile;
      applyProcessSandboxToKaos(this._kaos, resolved.config);
    } catch (error) {
      this.processSandboxStatus = { desired, effective: 'lexical', warning: error instanceof Error ? error.message : String(error) };
      applyProcessSandboxToKaos(this._kaos, undefined);
    }
  }

  get generate(): typeof generate {
    return createGenerateProxy(this);
  }

  get llm(): KosongLLM {
    return new KosongLLM({
      provider: this.config.provider,
      systemPrompt: this.config.systemPrompt,
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
    const result = await this.records.replay(options);
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
