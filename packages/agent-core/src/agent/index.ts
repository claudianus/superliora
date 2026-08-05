import { join } from 'pathe';

import { normalizeAdditionalDirs } from '../config';
import { ErrorCodes, makeErrorPayload } from '#/errors/index';
import { log } from '#/logging/logger';
import type { Logger } from '#/logging/types';
import type {
  AgentAPI,
  AgentEvent,
  CircuitBreakerStatus,
  LioraConfig,
  ProviderRouteStatus,
  SDKAgentRPC,
  UsageStatus,
} from '#/rpc';
import type { ProviderExtrasStatus } from '@superliora/protocol';
import { buildProviderExtrasStatus } from '#/tools/providers/extras/index';
import { resolveProviderMcpServers } from '#/mcp/provider-servers';
import { generate } from '@superliora/kosong';

import type { EnabledPluginSessionStart, PluginAgentDef, PluginCommandDef } from '#/plugin/index';
import type { AgentMemoryRuntime } from '#/memory';
import { estimateTokens } from '../utils/tokens';

import type { McpConnectionManager } from '../mcp';
import { FlagResolver, type ExperimentalFlagResolver } from '../flags';
import type { PreparedSystemPromptContext, ResolvedAgentProfile } from '../profile';
import { SOVEREIGN_CONDUCTOR_PROFILE_NAME } from '../profile/main-profile';
import { ConductorDirectWorkGuard } from './conductor-guard';
import type { FileSnapshotStore } from '../session/file-snapshot';
import type { ModelProvider } from '../session/provider/provider-manager';
import type { SessionSubagentHost } from '../session/subagent/subagent-host';
import { noopTelemetryClient, type TelemetryClient } from '../telemetry';
import type { SandboxProfile } from '../tools/policies/path-access';
import type { PromisableMethods } from '../utils/types';
import { BackgroundManager, BackgroundTaskPersistence } from './background';
import { CacheFreezeGuard } from './cache';
import { ToolParallelStatus } from '../loop/tool-parallel-status';
import {
  FullCompaction,
  MicroCompaction,
  type CompactionStrategy,
  type MicroCompactionConfig,
} from './compaction';
import { ContextOSManager } from './context-os';
import { CronManager } from './cron';
import { ConfigState } from './config';
import { ContextMemory } from './context';
import { GoalMode } from './goal';
import {
  reconcileUltraworkFromMirror,
  UltraworkMode,
  UltraworkObjectiveProfileCache,
} from '#/mission';
import { AutoDreamService } from './dream/auto-dream';
import { PromptIntelligenceService } from './intelligence/prompt-intelligence';
import { AutopilotMode } from '../autopilot';
import { LioraRecallStore } from '../memory/store';
import { PremiumQualityMode } from '../premium-quality';
import { HookEngine } from '../session/hooks';
import { InjectionManager } from './injection/manager';
import { PermissionManager, type PermissionManagerOptions } from './permission';
import { PlanMode } from './plan';
import {
  AgentRecords,
  BlobStore,
  FileSystemAgentRecordPersistence,
  type AgentRecord,
  type AgentRecordPersistence,
  type AgentRecordsReplayOptions,
  type SerializableAgentEvent,
} from './records';
import { ReplayBuilder, type ReplayBuilderOptions } from './replay';
import { SkillManager } from './skill';
import type { SkillRegistry } from './skill/types';
import { SwarmMode } from './swarm';
import { ToolManager } from './tool/index';
import { TurnFlow } from './turn';
import {
  InMemoryProviderRouteState,
  KosongLLM,
  type KosongLLMRoute,
} from './turn/kosong-llm';
import { UsageRecorder } from './usage';
import { LlmRequestLogger } from './llm-request-logger';
import { resolveCompletionBudget } from '../utils/completion-budget';
import type { Kaos } from '@superliora/kaos';
import type { ToolServices } from '../tools/support/services';
import type { ResponseLanguagePreference } from '../session/response-language';

import { createRpcMethods } from './rpc-methods';
import { buildPersonaRoleAdditional } from './persona';
import { createGenerateProxy, buildLLMRoute as buildLLMRouteImpl } from './generate-facade';
import { CircuitBreakerRegistry } from '../runtime/circuit-breaker';
import { buildCircuitBreakerDegradedEvent } from '../runtime/circuit-breaker-degraded';
import { buildOAuthRefreshDegradedEvent } from '../runtime/oauth-refresh-degraded';
import type { RuntimeDegradedEvent } from '@superliora/protocol';
import { attachResearchSearchCircuitBreakers } from '../tools/providers/research-search-circuit-breaker';
import { attachLlmProviderCircuitBreakers } from './llm-provider-circuit-breaker';
import { mapCircuitBreakerRegistrySnapshot } from '../runtime/circuit-breaker-status';
import { buildAgentStatusUpdatedEvent, durableTraceRecordType } from './agent-status-updated';
import { maybeEmitFleetUltraworkAliasLive } from '../fleet/event-alias';
import { maybeEmitMissionUltraworkAliasLive } from '../mission/event-alias';
import { buildRecordsWriteErrorEvent } from './agent-records-write-error';
import {
  createVerificationSensorLedger,
  type VerificationSensorLedger,
} from '../sensors/verification-sensor-ledger';
import {
  createMutationVerificationLedger,
  type MutationVerificationLedger,
} from '../sensors/mutation-verification-sensor';
import {
  createAutoCheckSpawnState,
  type AutoCheckSpawnState,
} from '../sensors/auto-check-sensor';

export type { AgentRecord } from './records';
export type { ModeActivationSource } from './mode-activation';
export type { SwarmModeTrigger } from './swarm';
export type { BuiltinTool, ToolInfo, ToolSource, UserToolRegistration } from './tool';
export * from './goal';

export type AgentType = 'main' | 'sub' | 'independent';

export interface AgentOptions {
  readonly kaos: Kaos;
  readonly config?: LioraConfig;
  readonly homedir?: string;
  readonly rpc?: Partial<SDKAgentRPC>;
  readonly persistence?: AgentRecordPersistence;
  readonly type?: AgentType;
  readonly generate?: typeof generate;
  readonly toolServices?: ToolServices;
  readonly compactionStrategy?: CompactionStrategy;
  readonly microCompaction?: Partial<MicroCompactionConfig>;
  readonly modelProvider?: ModelProvider | undefined;
  readonly subagentHost?: SessionSubagentHost | undefined;
  readonly skills?: SkillRegistry;
  readonly mcp?: McpConnectionManager;
  readonly hookEngine?: HookEngine;
  readonly permission?: PermissionManagerOptions | undefined;
  readonly log?: Logger;
  readonly telemetry?: TelemetryClient | undefined;
  readonly pluginSessionStarts?: readonly EnabledPluginSessionStart[];
  readonly pluginCommands?: readonly PluginCommandDef[];
  readonly pluginAgents?: readonly PluginAgentDef[];
  readonly pluginBinDirs?: readonly string[];
  readonly experimentalFlags?: ExperimentalFlagResolver;
  readonly replay?: ReplayBuilderOptions;
  readonly additionalDirs?: readonly string[];
  readonly memory?: AgentMemoryRuntime;
  readonly responseLanguagePreference?: (() => ResponseLanguagePreference | undefined) | undefined;
  readonly dreamStore?: LioraRecallStore;
  /** Shared session file-snapshot store for `/rewind` (optional; agent-standalone safe). */
  readonly fileSnapshots?: FileSnapshotStore | undefined;
  /** Path sandbox profile for file tools (`off` | `workspace` | `read-only`). */
  readonly sandboxProfile?: SandboxProfile | undefined;
}

export class Agent {
  readonly type: AgentType;
  /** Delegation-only runtime guard (lazy; only for main + conductor profile). */
  private _conductorGuard: ConductorDirectWorkGuard | undefined;

  /**
   * Conductor delegation-only runtime guard (meta-orchestrator v2 contract,
   * invariant 1–2). Active only for a main agent running the `conductor`
   * profile; `undefined` for workers/subagents and non-conductor waists
   * (contract §2.3 — delegation-only defines the conductor profile itself).
   */
  get conductorGuard(): ConductorDirectWorkGuard | undefined {
    if (this.type !== 'main') return undefined;
    if (this.config.profileName !== SOVEREIGN_CONDUCTOR_PROFILE_NAME) return undefined;
    this._conductorGuard ??= new ConductorDirectWorkGuard({ log: this.log });
    return this._conductorGuard;
  }
  private _kaos: Kaos;

  get kaos(): Kaos {
    return this._kaos;
  }

  readonly kimiConfig?: LioraConfig;
  readonly homedir?: string;
  readonly rpc?: Partial<SDKAgentRPC>;
  readonly toolServices?: ToolServices;
  readonly pluginSessionStarts: readonly EnabledPluginSessionStart[];
  readonly pluginCommands: readonly PluginCommandDef[];
  readonly pluginAgents: readonly PluginAgentDef[];
  readonly pluginBinDirs: readonly string[];
  readonly rawGenerate: typeof generate;
  readonly modelProvider?: ModelProvider;
  readonly subagentHost?: SessionSubagentHost;
  readonly mcp?: McpConnectionManager;
  readonly hooks?: HookEngine;
  readonly log: Logger;
  readonly telemetry: TelemetryClient;
  readonly experimentalFlags: ExperimentalFlagResolver;
  readonly memory?: AgentMemoryRuntime;
  private readonly responseLanguagePreference:
    (() => ResponseLanguagePreference | undefined) | undefined;

  readonly llmRequestLogger: LlmRequestLogger;
  readonly blobStore: BlobStore | undefined;
  readonly records: AgentRecords;
  readonly fullCompaction: FullCompaction;
  readonly microCompaction: MicroCompaction;
  readonly cacheFreezeGuard: CacheFreezeGuard;
  readonly toolParallelStatus: ToolParallelStatus;
  readonly contextOS: ContextOSManager;
  readonly context: ContextMemory;
  readonly config: ConfigState;
  readonly turn: TurnFlow;
  readonly injection: InjectionManager;
  readonly permission: PermissionManager;
  readonly planMode: PlanMode;
  /**
   * Optional swarm file-lease identity for Edit/Write conflict checks.
   * Set on subagent workers when a swarm run is active; undefined otherwise.
   */
  swarmFileLease: { ownerId?: string; runId?: string } | undefined;
  /**
   * Optional plugin LSP bridge hook. Edit/Write call this after a successful
   * mutation; returned text is appended to the tool result.
   */
  fileMutationHook:
    | ((path: string, content: string) => Promise<string | undefined>)
    | undefined = undefined;
  readonly swarmMode: SwarmMode;
  readonly usage: UsageRecorder;
  readonly skills: SkillManager | null;
  readonly tools: ToolManager;
  readonly background: BackgroundManager;
  readonly cron: CronManager | null;
  readonly goal: GoalMode;
  readonly ultrawork: UltraworkMode;
  readonly dream: AutoDreamService | null;
  readonly intelligence: PromptIntelligenceService;
  readonly autopilot: AutopilotMode;
  readonly premiumQuality: PremiumQualityMode;
  readonly ultraworkObjectiveProfile: UltraworkObjectiveProfileCache;
  readonly replayBuilder: ReplayBuilder;
  readonly providerRouteState: InMemoryProviderRouteState;
  /** Never-Halt circuit breakers for search slots / LLM provider channels. */
  readonly circuitBreakerRegistry: CircuitBreakerRegistry;
  /** Session-shared file snapshots for write/edit capture + `/rewind`. */
  readonly fileSnapshots: FileSnapshotStore | undefined;
  /** Sandbox profile applied when constructing file-tool workspaces. */
  readonly sandboxProfile: SandboxProfile | undefined;
  /** W6 PostToolUse verification sensor — recent test/command failure evidence. */
  readonly verificationSensorLedger: VerificationSensorLedger;
  /** Phase B PostToolUse sensor — file mutations pending mechanical verification. */
  readonly mutationVerificationLedger: MutationVerificationLedger;
  /** Loop19a — rate-limited opt-in auto-spawn RunProjectChecks state. */
  readonly autoCheckSpawnState: AutoCheckSpawnState;

  /**
   * Print-mode (`liora -p`) only: when true and the agent ends a turn while
   * background subagents are still running, hold the turn open until they finish.
   */
  printDrainAgentTasksOnStop = false;
  /** Absolute deadline (ms epoch) bounding print-mode drain waits for this agent. */
  printDrainDeadlineMs = Number.POSITIVE_INFINITY;

  private additionalDirs: readonly string[];

  constructor(options: AgentOptions) {
    this.type = options.type ?? 'main';
    this._kaos = options.kaos;
    this.kimiConfig = options.config;
    this.homedir = options.homedir;
    this.rpc = options.rpc;
    this.toolServices = options.toolServices;
    this.pluginSessionStarts = options.pluginSessionStarts ?? [];
    this.pluginCommands = options.pluginCommands ?? [];
    this.pluginAgents = options.pluginAgents ?? [];
    this.pluginBinDirs = options.pluginBinDirs ?? [];
    this.rawGenerate = options.generate ?? generate;
    this.modelProvider = options.modelProvider;
    this.subagentHost = options.subagentHost;
    this.mcp = options.mcp;
    this.hooks = options.hookEngine;
    this.log = options.log ?? log;
    this.telemetry = options.telemetry ?? noopTelemetryClient;
    this.experimentalFlags = options.experimentalFlags ?? new FlagResolver();
    this.memory = options.memory;
    this.responseLanguagePreference = options.responseLanguagePreference;
    this.additionalDirs = normalizeAdditionalDirs(options.additionalDirs ?? []);
    this.fileSnapshots = options.fileSnapshots;
    this.sandboxProfile = options.sandboxProfile;
    this.verificationSensorLedger = createVerificationSensorLedger();
    this.mutationVerificationLedger = createMutationVerificationLedger();
    this.autoCheckSpawnState = createAutoCheckSpawnState();

    this.llmRequestLogger = new LlmRequestLogger(this.log);
    this.blobStore = options.homedir
      ? new BlobStore({ blobsDir: join(options.homedir, 'blobs') })
      : undefined;
    this.records = new AgentRecords(
      this,
      options.persistence ??
        (options.homedir
          ? new FileSystemAgentRecordPersistence(join(options.homedir, 'wire.jsonl'), {
              onError: (error) => {
                this.emitRecordsWriteError(error);
              },
              blobStore: this.blobStore,
            })
          : undefined),
    );
    this.fullCompaction = new FullCompaction(this, options.compactionStrategy);
    this.microCompaction = new MicroCompaction(this, options.microCompaction);
    this.cacheFreezeGuard = new CacheFreezeGuard();
    this.toolParallelStatus = new ToolParallelStatus();
    this.contextOS = new ContextOSManager(this);
    this.context = new ContextMemory(this);
    this.config = new ConfigState(this);
    this.turn = new TurnFlow(this);
    this.injection = new InjectionManager(this);
    this.permission = new PermissionManager(this, options.permission);
    this.planMode = new PlanMode(this);
    this.swarmFileLease = undefined;
    this.swarmMode = new SwarmMode(this);
    this.usage = new UsageRecorder(this);
    this.skills = options.skills ? new SkillManager(this, options.skills) : null;
    this.tools = new ToolManager(this);
    this.background = new BackgroundManager(
      this,
      this.homedir === undefined ? undefined : new BackgroundTaskPersistence(this.homedir),
    );
    this.cron = this.type === 'sub' ? null : new CronManager(this);
    this.goal = new GoalMode(this);
    this.ultrawork = new UltraworkMode(this);
    this.dream =
      options.dreamStore !== undefined ? new AutoDreamService(this, options.dreamStore) : null;
    this.intelligence = new PromptIntelligenceService(this);
    this.autopilot = new AutopilotMode(this);
    this.premiumQuality = new PremiumQualityMode(this);
    this.ultraworkObjectiveProfile = new UltraworkObjectiveProfileCache();
    this.replayBuilder = new ReplayBuilder(this, options.replay);
    this.providerRouteState = new InMemoryProviderRouteState();
    this.circuitBreakerRegistry = new CircuitBreakerRegistry({
      onScopeOpened: (scopeId, reason) =>{  this.emitCircuitBreakerDegraded(scopeId, reason); },
    });
    if (this.type === 'main') {
      attachResearchSearchCircuitBreakers(
        this.toolServices?.webSearcher,
        this.circuitBreakerRegistry,
        () =>{  this.emitStatusUpdated(); },
      );
    }
  }

  setKaos(kaos: Kaos) {
    this._kaos = kaos;
  }

  getAdditionalDirs(): readonly string[] {
    return this.additionalDirs;
  }

  getResponseLanguagePreference(): ResponseLanguagePreference | undefined {
    return this.responseLanguagePreference?.();
  }

  setAdditionalDirs(additionalDirs: readonly string[]): void {
    this.additionalDirs = normalizeAdditionalDirs(additionalDirs);
    if (this.config.hasProvider) {
      this.tools.initializeBuiltinTools();
    }
  }

  get generate(): typeof generate {
    return createGenerateProxy(this);
  }

  get llm(): KosongLLM {
    // All provider-level request config (thinking, sampling params, thinking.keep)
    // is applied in ConfigState.provider so compaction shares it. See get provider().
    const provider = this.config.provider;
    const loopControl = this.kimiConfig?.loopControl;
    const completionBudgetConfig = resolveCompletionBudget({
      maxOutputSize: this.config.maxOutputSize,
      reservedContextSize: loopControl?.reservedContextSize,
    });
    return new KosongLLM({
      provider,
      systemPrompt: this.config.systemPrompt,
      layeredSystemPrompt: this.config.layeredSystemPrompt,
      capability: this.config.modelCapabilities,
      generate: this.generate,
      completionBudgetConfig,
      usedContextTokens: () => this.context.tokenCount,
      route: this.buildLLMRoute(loopControl?.reservedContextSize),
      routeState: this.providerRouteState,
      onRouteStatusChanged: () =>{  this.emitStatusUpdated(); },
      circuitObserver: attachLlmProviderCircuitBreakers(this, () =>{  this.emitStatusUpdated(); }),
      log: this.log,
    });
  }

  private buildLLMRoute(reservedContextSize: number | undefined): KosongLLMRoute | undefined {
    return buildLLMRouteImpl(this, reservedContextSize);
  }

  useProfile(profile: ResolvedAgentProfile, context?: PreparedSystemPromptContext): void {
    const skillsListing =
      profile.tools.includes('Skill')
        ? (this.skills?.registry?.getModelSkillListing?.() ?? '')
        : '';
    const promptContext = {
      osEnv: this.kaos.osEnv,
      cwd: this.config.cwd,
      skills: this.skills?.registry,
      skillPromptMode: this.kimiConfig?.skillPromptMode,
      cwdListing: context?.cwdListing,
      agentsMd: context?.agentsMd,
      additionalDirsInfo: context?.additionalDirsInfo,
      roleAdditional: this.type === 'main' ? buildPersonaRoleAdditional(this.kimiConfig?.persona) : undefined,
    };
    const systemPrompt = profile.systemPrompt(promptContext);

    // Render layered system prompt for cache-optimized providers (Anthropic)
    const layeredSystemPrompt = profile.layeredSystemPrompt?.(promptContext);

    this.config.update({
      profileName: profile.name,
      systemPrompt,
      layeredSystemPrompt,
    });
    this.config.setSystemPromptMeta({
      agentsMdTokens: estimateTokens(context?.agentsMd ?? ''),
      cwdListingTokens: estimateTokens(context?.cwdListing ?? ''),
      skillsTokens: estimateTokens(skillsListing),
      additionalDirsTokens: estimateTokens(context?.additionalDirsInfo ?? ''),
    });
    this.tools.setActiveTools(profile.tools);
  }

  async resume(options?: AgentRecordsReplayOptions): Promise<{ warning?: string }> {
    const result = await this.records.replay(options);
    try {
      this.replayBuilder.postRestoring = true;
      this.goal.normalizeAfterReplay();
      this.ultrawork.normalizeAfterReplay();
      await reconcileUltraworkFromMirror(this);
      await this.background.loadFromDisk();
      await this.background.reconcile();
      await this.cron?.loadFromDisk();
      this.context.finishResume();
      this.turn.finishResume();
    } finally {
      this.replayBuilder.postRestoring = false;
    }
    return result;
  }

  /**
   * War-room / /swarm restaff request. UltraSwarm was retired (S3-R4), so no
   * swarm run can be active and restaff always rejects. The method stays as a
   * graceful no-op until the war-room RPC/TUI surface is removed, keeping the
   * `session.swarmRestaff` chain compiling and the steer-fallback path live.
   */
  swarmRestaff(_reason = 'User requested restaff'): boolean {
    return false;
  }

  get rpcMethods(): PromisableMethods<AgentAPI> {
    return createRpcMethods(this);
  }

  emitEvent(event: AgentEvent): void {
    if (this.records.restoring) return;
    const recordType = durableTraceRecordType(event.type);
    if (recordType !== undefined) {
      this.records.logRecord({
        type: recordType,
        event: event as SerializableAgentEvent,
      });
    }
    void this.rpc?.emitEvent?.(event);
    maybeEmitMissionUltraworkAliasLive((alias) => {
      void this.rpc?.emitEvent?.(alias);
    }, event);
    maybeEmitFleetUltraworkAliasLive((alias) => {
      void this.rpc?.emitEvent?.(alias);
    }, event);
  }

  providerRouteStatus(): ProviderRouteStatus | null {
    const route = this.buildLLMRoute(this.kimiConfig?.loopControl?.reservedContextSize);
    return route === undefined ? null : this.providerRouteState.snapshot(route);
  }

  providerExtrasStatus(): ProviderExtrasStatus {
    return buildProviderExtrasStatus({
      config: this.kimiConfig,
      engine: this.toolServices?.researchSearch,
      autoMcpServers:
        this.kimiConfig === undefined
          ? []
          : Object.keys(resolveProviderMcpServers(this.kimiConfig)),
    });
  }

  circuitBreakerStatus(): CircuitBreakerStatus | undefined {
    return mapCircuitBreakerRegistrySnapshot(this.circuitBreakerRegistry.snapshot());
  }

  resetProviderRouteStatus(): ProviderRouteStatus | null {
    const route = this.buildLLMRoute(this.kimiConfig?.loopControl?.reservedContextSize);
    if (route === undefined) return null;
    const changed = this.providerRouteState.reset(route);
    const status = this.providerRouteState.snapshot(route);
    if (changed) this.emitStatusUpdated();
    return status;
  }

  emitStatusUpdated(): void {
    if (this.records.restoring) return;
    if (!this.config.hasModel) return;
    this.emitEvent(buildAgentStatusUpdatedEvent(this));
  }

  /** Never-Halt: surface breaker open as volatile runtime.degraded (Ops/footer). */
  emitCircuitBreakerDegraded(scopeId: string, lastTripReason?: string): void {
    if (this.records.restoring) return;
    this.emitEvent(buildCircuitBreakerDegradedEvent(scopeId, lastTripReason));
    this.emitStatusUpdated();
  }

  /** Never-Halt: OAuth refresh failure during LLM/token fetch (Ops/footer). */
  emitOAuthRefreshDegraded(event: RuntimeDegradedEvent): void {
    if (this.records.restoring) return;
    this.emitEvent(event);
  }

  emitOAuthRefreshDegradedFromReason(reason: string, atMs: number = Date.now()): void {
    this.emitOAuthRefreshDegraded(buildOAuthRefreshDegradedEvent(reason, atMs));
  }

  private emitRecordsWriteError(error: unknown, record?: AgentRecord | undefined): void {
    this.log.error('wire record persist failed', {
      agentHomedir: this.homedir,
      recordType: record?.type,
      error,
    });
    this.emitEvent(buildRecordsWriteErrorEvent(error, record));
  }
}
