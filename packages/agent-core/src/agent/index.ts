import { randomUUID } from 'node:crypto';
import { requestUltraSwarmSteer } from './ultra-swarm-run';
import { join } from 'pathe';

import { normalizeAdditionalDirs } from '../config';
import type { PersonaConfig } from '../config';
import { ErrorCodes, LioraError, makeErrorPayload } from '#/errors';
import { log } from '#/logging/logger';
import type { Logger } from '#/logging/types';
import type {
  AgentAPI,
  AgentEvent,
  LioraConfig,
  ProviderRouteStatus,
  SDKAgentRPC,
  UsageStatus,
} from '#/rpc';
import { generate } from '@superliora/kosong';

import { expandCommandArguments } from '../plugin/commands';
import type { EnabledPluginSessionStart, PluginCommandDef } from '#/plugin';
import type { AgentMemoryRuntime } from '#/memory';
import type { PluginCommandOrigin } from './context';
import { estimateTokens } from '../utils/tokens';

import type { McpConnectionManager } from '../mcp';
import { FlagResolver, type ExperimentalFlagResolver } from '../flags';
import type { PreparedSystemPromptContext, ResolvedAgentProfile } from '../profile';
import type { ModelProvider } from '../session/provider-manager';
import type { SessionSubagentHost } from '../session/subagent-host';
import { noopTelemetryClient, type TelemetryClient } from '../telemetry';
import type { PromisableMethods } from '../utils/types';
import { BackgroundManager, BackgroundTaskPersistence } from './background';
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
import { UltraworkMode } from '../ultrawork';
import {
  detectUltraworkAutoActivationWithLlm,
  shouldActOnUltraworkAutoActivation,
} from '../ultrawork/auto-activate-llm';
import { UltraworkObjectiveProfileCache } from '../ultrawork/objective-profile-cache';
import {
  detectUltraworkObjectiveProfileWithLlm,
  fallbackUltraworkObjectiveProfile,
  resolveUltraworkObjectiveProfile,
} from '../ultrawork/objective-profile-llm';
import { AutoDreamService } from './dream/auto-dream';
import { PromptIntelligenceService } from './intelligence/prompt-intelligence';
import { AutopilotMode } from '../autopilot';
import { LioraRecallStore } from '../memory/store';
import { PremiumQualityMode } from '../premium-quality';
import { reconcileUltraworkFromMirror } from '../ultrawork/mirror-reconcile';
import { HookEngine } from '../session/hooks';
import { InjectionManager } from './injection/manager';
import { PermissionManager, type PermissionManagerOptions } from './permission';
import { PlanMode } from './plan';
import { UltraSwarmEngageGate } from './plan/ultra-swarm-engage-gate';
import type { UltraSwarmRunContext } from './ultra-swarm-run';
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
  type KosongLLMRouteCandidate,
} from './turn/kosong-llm';
import { UsageRecorder } from './usage';
import { LlmRequestLogger, splitGenerateOptions } from './llm-request-logger';
import { resolveCompletionBudget } from '../utils/completion-budget';
import type { Kaos } from '@superliora/kaos';
import type { ToolServices } from '../tools/support/services';
import type { ResponseLanguagePreference } from '../session/response-language';

export type { AgentRecord, AgentRecordPersistence } from './records';
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
  readonly experimentalFlags?: ExperimentalFlagResolver;
  readonly replay?: ReplayBuilderOptions;
  readonly additionalDirs?: readonly string[];
  readonly memory?: AgentMemoryRuntime;
  readonly responseLanguagePreference?: (() => ResponseLanguagePreference | undefined) | undefined;
  readonly dreamStore?: LioraRecallStore;
}

export class Agent {
  readonly type: AgentType;
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
  readonly contextOS: ContextOSManager;
  readonly context: ContextMemory;
  readonly config: ConfigState;
  readonly turn: TurnFlow;
  readonly injection: InjectionManager;
  readonly permission: PermissionManager;
  readonly planMode: PlanMode;
  readonly ultraSwarmEngageGate: UltraSwarmEngageGate;
  ultraSwarmRun: UltraSwarmRunContext | undefined;
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
    this.contextOS = new ContextOSManager(this);
    this.context = new ContextMemory(this);
    this.config = new ConfigState(this);
    this.turn = new TurnFlow(this);
    this.injection = new InjectionManager(this);
    this.permission = new PermissionManager(this, options.permission);
    this.planMode = new PlanMode(this);
    this.ultraSwarmEngageGate = new UltraSwarmEngageGate(this);
    this.ultraSwarmRun = undefined;
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
    return async (provider, systemPrompt, tools, history, callbacks, options) => {
      const { requestLogFields, runtimeModelAlias, runtimeCredentialLabel, generateOptions } =
        splitGenerateOptions(options);
      const modelAlias = runtimeModelAlias ?? this.config.modelAlias;
      const run = (requestOptions: Parameters<typeof generate>[5]) => {
        this.llmRequestLogger.logRequest({
          provider,
          modelAlias,
          systemPrompt,
          tools,
          messages: history,
          fields: requestLogFields,
        });
        return this.rawGenerate(provider, systemPrompt, tools, history, callbacks, requestOptions);
      };
      if (generateOptions?.auth !== undefined) {
        return run(generateOptions);
      }
      const withAuth =
        modelAlias === undefined
          ? undefined
          : this.modelProvider?.resolveAuth?.(modelAlias, {
              log: this.log,
              credentialLabel: runtimeCredentialLabel,
            });
      if (withAuth === undefined) {
        return run(generateOptions);
      }
      return withAuth((auth) => {
        return run({ ...generateOptions, auth });
      });
    };
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
      capability: this.config.modelCapabilities,
      generate: this.generate,
      completionBudgetConfig,
      usedContextTokens: () => this.context.tokenCount,
      route: this.buildLLMRoute(loopControl?.reservedContextSize),
      routeState: this.providerRouteState,
      onRouteStatusChanged: () => this.emitStatusUpdated(),
      log: this.log,
    });
  }

  private buildLLMRoute(reservedContextSize: number | undefined): KosongLLMRoute | undefined {
    const route = this.config.providerRoute;
    if (route === undefined || route.candidates.length === 0) return undefined;
    return {
      key: route.modelAlias,
      strategy: route.strategy,
      cooldownMs: route.cooldownMs,
      sessionAffinity: route.sessionAffinity,
      preferredCredential: route.preferredCredential,
      candidates: route.candidates.map((candidate): KosongLLMRouteCandidate => {
        return {
          modelAlias: candidate.modelAlias,
          providerName: candidate.providerName,
          credentialLabel: candidate.credentialLabel,
          weight: candidate.weight,
          localLimits: candidate.localLimits,
          provider: this.config.createRuntimeProvider(candidate),
          capability: candidate.modelCapabilities,
          completionBudgetConfig: resolveCompletionBudget({
            maxOutputSize: candidate.maxOutputSize,
            reservedContextSize,
          }),
        };
      }),
    };
  }

  useProfile(profile: ResolvedAgentProfile, context?: PreparedSystemPromptContext): void {
    const skillsListing =
      profile.tools.includes('Skill')
        ? (this.skills?.registry?.getModelSkillListing?.() ?? '')
        : '';
    const systemPrompt = profile.systemPrompt({
      osEnv: this.kaos.osEnv,
      cwd: this.config.cwd,
      skills: this.skills?.registry,
      skillPromptMode: this.kimiConfig?.skillPromptMode,
      cwdListing: context?.cwdListing,
      agentsMd: context?.agentsMd,
      additionalDirsInfo: context?.additionalDirsInfo,
      roleAdditional: this.type === 'main' ? buildPersonaRoleAdditional(this.kimiConfig?.persona) : undefined,
    });
    this.config.update({ profileName: profile.name, systemPrompt });
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
   * Mid-run UltraSwarm steering. Queues a redirect at the next phase/wave
   * checkpoint instead of buffering until the entire tool returns.
   */
  swarmSteer(input: string): boolean {
    const accepted = requestUltraSwarmSteer(this.ultraSwarmRun, input);
    if (accepted) {
      this.records.logRecord({ type: 'swarm.steer', input });
      void this.ultrawork.pause({ reason: 'User steering requested during UltraSwarm' });
    }
    return accepted;
  }

  get rpcMethods(): PromisableMethods<AgentAPI> {
    return {
      prompt: (payload) => {
        this.turn.prompt(payload.input);
      },
      runShellCommand: (payload) => this.tools.runShellCommand(payload.command, payload.commandId),
      cancelShellCommand: (payload) => this.tools.cancelShellCommand(payload.commandId),
      steer: (payload) => {
        this.telemetry.track('input_steer', { parts: payload.input.length });
        // During UltraSwarm, route steers into the swarm checkpoint queue.
        if (this.ultraSwarmRun !== undefined) {
          const text = payload.input
            .map((part) => ('text' in part ? String(part.text ?? '') : ''))
            .join('\n')
            .trim();
          if (requestUltraSwarmSteer(this.ultraSwarmRun, text)) {
            this.records.logRecord({ type: 'swarm.steer', input: text });
            void this.ultrawork.pause({ reason: 'User steering requested during UltraSwarm' });
            this.emitEvent({
              type: 'ultrawork.swarm.paused',
              runId: this.ultraSwarmRun.runId,
              reason: 'User steering requested',
              input: text,
            } as any);
            return;
          }
        }
        this.turn.steer(payload.input);
      },
      cancel: (payload) => {
        if (this.turn.hasActiveTurn) {
          this.telemetry.track('cancel', { from: payload.source ?? 'streaming' });
        }
        this.turn.cancel(payload.turnId, undefined, payload.source);
      },
      undoHistory: (payload) => {
        this.context.undo(payload.count);
      },
      setThinking: (payload) => {
        const wasEnabled = this.config.thinkingLevel !== 'off';
        this.config.update({ thinkingLevel: payload.level });
        const enabled = this.config.thinkingLevel !== 'off';
        if (enabled !== wasEnabled) {
          this.telemetry.track('thinking_toggle', { enabled });
        }
      },
      setPermission: (payload) => {
        const wasYolo = this.permission.mode === 'yolo';
        const wasAuto = this.permission.mode === 'auto';
        this.permission.setMode(payload.mode);
        const enabled = this.permission.mode === 'yolo';
        if (enabled !== wasYolo) {
          this.telemetry.track('yolo_toggle', { enabled });
        }
        const afkEnabled = this.permission.mode === 'auto';
        if (afkEnabled !== wasAuto) {
          this.telemetry.track('afk_toggle', { enabled: afkEnabled });
        }
      },
      setModel: (payload) => {
        // Validate the alias resolves before recording it so resume / runtime
        // callers fail fast on missing aliases instead of deferring to the
        // next prompt.
        const resolved = this.modelProvider?.resolveProviderConfig(payload.model);
        if (this.config.modelAlias !== payload.model) {
          this.config.update({ modelAlias: payload.model });
          this.telemetry.track('model_switch', { model: payload.model });
        }
        return {
          model: payload.model,
          providerName: resolved?.providerName,
        };
      },
      getModel: () => {
        return this.config.modelAlias ?? '';
      },
      enterPlan: async (payload) => {
        await this.planMode.enter(
          undefined,
          false,
          true,
          payload.ultra ?? false,
          payload.initialContext ?? '',
          payload.source ?? 'standalone',
        );
      },
      cancelPlan: (payload) => {
        this.planMode.cancel(payload.id);
      },
      clearPlan: () => this.planMode.clear(),
      enterSwarm: (payload) => {
        this.swarmMode.enter(payload.trigger);
      },
      exitSwarm: () => {
        this.swarmMode.exit();
      },
      getSwarmMode: () => {
        return this.swarmMode.isActive;
      },
      setPremiumQuality: (payload) => {
        this.premiumQuality.setEnabled(payload.enabled);
      },
      getPremiumQuality: () => {
        return this.premiumQuality.isEnabled();
      },
      beginCompaction: (payload) => {
        this.fullCompaction.begin({ source: 'manual', instruction: payload.instruction });
      },
      cancelCompaction: () => {
        if (this.fullCompaction.isCompacting) {
          this.telemetry.track('cancel', { from: 'compacting' });
        }
        this.fullCompaction.cancel();
      },
      registerTool: (payload) => {
        this.tools.registerUserTool(payload);
      },
      unregisterTool: (payload) => {
        this.tools.unregisterUserTool(payload.name);
      },
      setActiveTools: (payload) => {
        this.tools.setActiveTools(payload.names);
      },
      stopBackground: (payload) => {
        void this.background.stop(payload.taskId, payload.reason);
      },
      detachBackground: (payload) => this.background.detach(payload.taskId),
      clearContext: () => {
        this.context.clear();
      },
      activateSkill: async (payload) => {
        if (this.skills === null) {
          throw new LioraError(ErrorCodes.SKILL_NOT_FOUND, `Skill "${payload.name}" was not found`);
        }
        await this.skills.activate(payload);
      },
      activatePluginCommand: (payload) => {
        const def = this.pluginCommands.find(
          (command) =>
            command.pluginId === payload.pluginId && command.name === payload.commandName,
        );
        if (def === undefined) {
          throw new LioraError(
            ErrorCodes.REQUEST_INVALID,
            `Plugin command "${payload.pluginId}:${payload.commandName}" was not found`,
          );
        }
        const commandArgs = payload.args ?? '';
        const origin: PluginCommandOrigin = {
          kind: 'plugin_command',
          activationId: randomUUID(),
          pluginId: payload.pluginId,
          commandName: payload.commandName,
          commandArgs: payload.args,
          trigger: 'user-slash',
        };
        this.emitEvent({
          type: 'plugin_command.activated',
          activationId: origin.activationId,
          pluginId: origin.pluginId,
          commandName: origin.commandName,
          commandArgs: origin.commandArgs,
          trigger: origin.trigger,
        });
        this.turn.prompt(
          [{ type: 'text', text: expandCommandArguments(def.body, commandArgs) }],
          origin,
        );
      },
      startBtw: () => this.subagentHost!.startBtw(),
      createGoal: (payload) => this.goal.createGoal(payload),
      getGoal: () => this.goal.getGoal(),
      pauseGoal: () => this.goal.pauseGoal(),
      resumeGoal: () => this.goal.resumeGoal(),
      cancelGoal: () => this.goal.cancelGoal(),
      createUltraworkRun: (payload) =>
        this.ultrawork.create({
          id: payload.id,
          objective: payload.objective,
          activation: {
            source: payload.source,
            replaceGoal: payload.replaceGoal,
            evidenceRoot: payload.evidenceRoot,
            workDir: payload.workDir,
          },
        }),
      getUltraworkRun: () => this.ultrawork.getRun(),
      pauseUltrawork: (payload) => this.ultrawork.pause(payload),
      resumeUltrawork: () => this.ultrawork.resume(),
      cancelUltrawork: (payload) => this.ultrawork.cancel(payload.reason),
      classifyUltraworkAutoActivation: async (payload) => {
        const text = payload.text.trim();
        if (text.length === 0) {
          return { activate: false, confidence: 1, reason: 'Empty prompt' };
        }
        const provider = this.config.provider;
        if (provider === undefined || typeof this.generate !== 'function') {
          return {
            activate: false,
            confidence: 0,
            reason: 'LLM provider unavailable for Ultrawork auto-activation',
          };
        }
        const intent = await detectUltraworkAutoActivationWithLlm(
          { generate: this.generate, provider },
          { text, signal: AbortSignal.timeout(8_000) },
        );
        const activate = shouldActOnUltraworkAutoActivation(intent);
        return {
          activate,
          confidence: intent?.confidence ?? 0,
          reason: intent?.reason ?? 'Ultrawork auto-activation declined or unavailable',
        };
      },
      classifyUltraworkObjectiveProfile: async (payload) => {
        const text = payload.text.trim();
        if (text.length === 0) {
          return fallbackUltraworkObjectiveProfile('');
        }
        const provider = this.config.provider;
        if (provider === undefined || typeof this.generate !== 'function') {
          const fallback = fallbackUltraworkObjectiveProfile(
            text,
            'LLM provider unavailable for Ultrawork objective profile',
          );
          this.ultraworkObjectiveProfile.set(text, fallback);
          return fallback;
        }
        const detected = await detectUltraworkObjectiveProfileWithLlm(
          { generate: this.generate, provider },
          { text, signal: AbortSignal.timeout(8_000) },
        );
        const profile = resolveUltraworkObjectiveProfile(detected, text);
        this.ultraworkObjectiveProfile.set(text, profile);
        return profile;
      },
      getBackgroundOutput: (payload) => this.background.readOutput(payload.taskId, payload.tail),
      getContext: () => this.context.data(),
      getContextComposition: () => this.context.composition(),
      diagnoseContextOS: (payload) =>
        this.contextOS.diagnose(payload.query ?? '', payload.limit),
      getConfig: () => this.config.data(),
      getPermission: () => this.permission.data(),
      getPlan: () => this.planMode.data(),
      getUsage: () => this.usage.data(),
      getProviderRouteStatus: () => this.providerRouteStatus(),
      resetProviderRouteStatus: () => this.resetProviderRouteStatus(),
      getTools: () => this.tools.data(),
      getBackground: (payload) => this.background.list(payload.activeOnly ?? false, payload.limit),
      inlineComplete: (payload, options) =>
        this.intelligence.inlineComplete({ ...payload, signal: options?.signal }),
      suggestPrompts: (_payload, options) =>
        this.intelligence.suggestPrompts({ signal: options?.signal }),
    };
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
  }

  providerRouteStatus(): ProviderRouteStatus | null {
    const route = this.buildLLMRoute(this.kimiConfig?.loopControl?.reservedContextSize);
    return route === undefined ? null : this.providerRouteState.snapshot(route);
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

    const contextTokens = this.context.tokenCount;
    const maxContextTokens = this.config.modelCapabilities.max_context_tokens;
    const contextUsage =
      maxContextTokens !== undefined && maxContextTokens > 0
        ? contextTokens / maxContextTokens
        : undefined;
    const usage: UsageStatus | undefined = this.usage.status();
    const model = this.config.model;
    const providerRoute = this.providerRouteStatus();

    const contextOSHealth = this.contextOS.health();
    const microSnap = this.microCompaction.triggers.snapshot();
    this.emitEvent({
      type: 'agent.status.updated',
      model,
      contextTokens,
      maxContextTokens,
      contextUsage,
      planMode: this.planMode.isActive,
      swarmMode: this.swarmMode.isActive,
      premiumQualityMode: this.premiumQuality.isEnabled(),
      permission: this.permission.mode,
      usage,
      providerRoute,
      contextOS:
        contextOSHealth.pageCount === 0
          ? null
          : {
              pageCount: contextOSHealth.pageCount,
              readyPageCount: contextOSHealth.readyPageCount,
              needsRehydrationPageCount: contextOSHealth.needsRehydrationPageCount,
              atRiskPageCount: contextOSHealth.atRiskPageCount,
              missingEvidencePageCount: contextOSHealth.missingEvidencePageCount,
              evidenceIdRecallScore: contextOSHealth.evidenceIdRecallScore,
              latestContinuityStatus: contextOSHealth.latestContinuityStatus,
            },
      microCompaction:
        microSnap.total === 0
          ? null
          : {
              total: microSnap.total,
              lastTrigger: microSnap.lastTrigger,
              lastContextUsageRatio: microSnap.lastContextUsageRatio,
              byTrigger: microSnap.byTrigger,
            },
      autoDream: this.dream === null ? null : this.dream.snapshot(),
    });
  }

  private emitRecordsWriteError(error: unknown, record?: AgentRecord | undefined): void {
    const message = error instanceof Error ? error.message : String(error);
    this.log.error('wire record persist failed', {
      agentHomedir: this.homedir,
      recordType: record?.type,
      error,
    });
    this.emitEvent({
      type: 'error',
      ...makeErrorPayload(
        ErrorCodes.RECORDS_WRITE_FAILED,
        `Failed to write agent records: ${message}`,
        {
          details: { recordType: record?.type },
        },
      ),
    });
  }
}

function durableTraceRecordType(
  eventType: AgentEvent['type'],
): 'subagent.lifecycle' | 'ultrawork.event' | undefined {
  if (eventType.startsWith('subagent.')) return 'subagent.lifecycle';
  if (eventType.startsWith('ultrawork.')) return 'ultrawork.event';
  return undefined;
}

/* ------------------------------------------------------------------ */
/*  Persona → ROLE_ADDITIONAL                                          */
/* ------------------------------------------------------------------ */

const PERSONA_PRESETS: Record<string, { personality: string; tone: string }> = {
  friendly: {
    personality: 'Warm, approachable, and encouraging. Uses gentle humor and celebrates progress.',
    tone: 'Casual and supportive, like a helpful friend who happens to be an expert.',
  },
  professional: {
    personality: 'Precise, thorough, and dependable. Prioritizes clarity and correctness.',
    tone: 'Formal but not stiff; direct and business-like with structured responses.',
  },
  concise: {
    personality: 'Efficient and to-the-point. Values the user\'s time above all.',
    tone: 'Terse and minimal; answers in the fewest words that preserve accuracy.',
  },
  creative: {
    personality: 'Imaginative and curious. Suggests unconventional angles and novel approaches.',
    tone: 'Expressive and vivid; uses analogies, metaphors, and occasional wit.',
  },
  mentor: {
    personality: 'Patient and Socratic. Guides understanding rather than giving answers outright.',
    tone: 'Encouraging and educational; explains the "why" behind recommendations.',
  },
  playful: {
    personality: 'Witty and energetic. Makes interactions fun while staying helpful.',
    tone: 'Light-hearted with puns and playful remarks; never at the expense of correctness.',
  },
};

function buildPersonaRoleAdditional(persona: PersonaConfig | undefined): string | undefined {
  if (persona === undefined) return undefined;

  const parts: string[] = [];

  // Resolve preset first as a base layer.
  if (persona.preset !== undefined && persona.preset !== 'none') {
    const preset = PERSONA_PRESETS[persona.preset];
    if (preset !== undefined) {
      parts.push(`Personality: ${preset.personality}`);
      parts.push(`Tone: ${preset.tone}`);
    }
  }

  // User overrides layer on top of the preset.
  if (persona.personality !== undefined && persona.personality.trim().length > 0) {
    parts.push(`Personality: ${persona.personality.trim()}`);
  }
  if (persona.tone !== undefined && persona.tone.trim().length > 0) {
    parts.push(`Tone: ${persona.tone.trim()}`);
  }
  if (persona.instructions !== undefined && persona.instructions.trim().length > 0) {
    parts.push(persona.instructions.trim());
  }

  if (parts.length === 0) return undefined;

  const header = persona.name !== undefined && persona.name.trim().length > 0
    ? `# Persona: ${persona.name.trim()}`
    : '# Persona';

  return `${header}\n\n${parts.join('\n')}`;
}
