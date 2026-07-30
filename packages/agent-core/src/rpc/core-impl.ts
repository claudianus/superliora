import { homedir } from 'node:os';

import { ErrorCodes, LioraError } from '#/errors';
import { log } from '#/logging/logger';
import { PluginManager } from '#/plugin';

import {
  createContext7Provider,
  isContext7Enabled,
  readContext7ApiKeyFromConfig,
} from '#/tools/providers/context7-session';
import type { PromisableMethods } from '#/utils/types';
import { getCoreVersion } from '#/version';

import {
  ensureLioraHome,
  loadRuntimeConfigSafe,
  mergeConfigPatch,
  readConfigFileForUpdate,
  resolveConfigPath,
  resolveLioraHome,
  writeConfigFile,
  type LioraConfig,
} from '../config';
import {
  FLAG_DEFINITIONS,
  FlagResolver,
  type ExperimentalFeatureState,
} from '../flags';
import type { Logger } from '../logging/types';
import { resolveSessionMcpConfig, mergeCallerMcpServers, type SessionMcpConfig } from '../mcp';
import { LioraRecallStore } from '../memory';
import { Session, type SessionMeta, type SessionSkillConfig } from '../session';
import {
  ProviderManager,
  type OAuthTokenProviderResolver
} from '../session/provider-manager';
import { SessionAPIImpl } from '../session/rpc';
import { SessionStore } from '../session/store/index';
import {
  noopTelemetryClient,
  withTelemetryContext,
  withTelemetryProperties,
  type TelemetryClient,
} from '../telemetry';
import type { CoreRPCClient } from './client';
import type {
  ActivateSkillPayload,
  ActivatePluginCommandPayload,
  AddAdditionalDirPayload,
  AddAdditionalDirResult,
  ArchiveSessionPayload,
  BeginCompactionPayload,
  CancelPayload,
  CancelPlanPayload,
  CancelShellCommandPayload,
  CloseSessionPayload,
  ConfigDiagnostics,
  CoreAPI,
  CoreInfo,
  CreateGoalPayload,
  CreateUltraworkRunPayload,
  ClassifyUltraworkAutoActivationPayload,
  UltraworkAutoActivationDecision,
  ClassifyUltraworkObjectiveProfilePayload,
  UltraworkObjectiveProfileDecision,
  CancelUltraworkPayload,
  PauseUltraworkPayload,
  SwarmRestaffPayload,
  ResumeUltraworkPayloadResult,
  UltraworkRunSnapshot,
  CreateSessionPayload,
  DetachBackgroundPayload,
  ClientTelemetryInfo,
  DeleteConfigFieldsPayload,
  EmptyPayload,
  DiagnoseContextOSPayload,
  EnterPlanPayload,
  EnterSwarmPayload,
  GoalSnapshot,
  GoalToolResult,
  ExportSessionPayload,
  ExportSessionResult,
  ForkSessionPayload,
  JsonObject,
  GetBackgroundOutputPayload,
  GetBackgroundPayload,
  InlineCompletePayload,
  PromptIntelligenceCallOptions,
  GetKimiConfigPayload,
  GetPluginInfoPayload,
  InstallPluginPayload,
  ListSessionsPayload,
  MemoryConsolidateResult,
  MemoryCreatePayload,
  MemoryExportResult,
  MemoryForgetPayload,
  MemoryGetPayload,
  MemoryImportResult,
  MemoryImportPayload,
  MemoryListPayload,
  MemoryRecord,
  MemorySearchPayload,
  MemorySearchResult,
  MemoryStats,
  MemoryUpdatePayload,
  McpServerInfo,
  McpStartupMetrics,
  PluginInfo,
  PluginCommandDef,
  PluginSummary,
  PromptPayload,
  RunShellCommandPayload,
  SearchSkillsPayload,
  ReconnectMcpServerPayload,
  RegisterToolPayload,
  ReloadSessionPayload,
  ReloadPluginsResult,
  RemoveKimiProviderPayload,
  RemovePluginPayload,
  RenameSessionPayload,
  ResumeSessionPayload,
  SessionSummary,
  SetActiveToolsPayload,
  SetKimiConfigPayload,
  SetModelPayload,
  SetModelResult,
  SetPermissionPayload,
  SetPluginEnabledPayload,
  SetPluginMcpServerEnabledPayload,
  SetPremiumQualityPayload,
  SetOrchestratorModePayload,
  SetThinkingPayload,
  SkillSearchResult,
  SkillSummary,
  SteerPayload,
  StopBackgroundPayload,
  StartConversationLoopPayload,
  StopConversationLoopPayload,
  ConversationLoopStateData,
  RewindFilesPayload,
  RewindFilesResult,
  UndoHistoryPayload,
  UnregisterToolPayload,
  UpdateSessionMetadataPayload,
} from './core-api';
import type { ResumeSessionResult } from './resumed';
import type { SDKRPC } from './sdk-api';
import type { SessionWarning } from '@superliora/protocol';
import { proxyWithExtraPayload } from './types';
import { KaosShellNotFoundError, LocalKaos, type Kaos } from '@superliora/kaos';
import type { ToolServices } from '../tools/support/services';
import { createRuntimeConfig, hasStatefulGuiRuntime } from './runtime-factory';
import { applyDeleteConfigFields, removeProviderFromConfig, validateDeleteConfigFields } from './config-ops';
import * as pluginMethods from './plugin-methods';
import {
  combinePluginMcpConfig,
  managedKimiCodeEnvForPlugins,
  withManagedKimiPluginEnv,
} from './plugin-mcp-env';
import * as sessionLifecycle from './session-lifecycle';
import * as sessionAgentMethods from './session-agent-methods';

type AgentScopedPayload<T> = T & { readonly agentId: string };
type SessionScopedPayload<T> = T & { readonly sessionId: string };
type SessionAgentPayload<T> = SessionScopedPayload<AgentScopedPayload<T>>;
type RenameSessionRequest = SessionScopedPayload<RenameSessionPayload>;
type UpdateSessionMetadataRequest = SessionScopedPayload<UpdateSessionMetadataPayload>;

export interface LioraCoreOptions {
  readonly homeDir?: string | undefined;
  readonly configPath?: string | undefined;
  readonly runtime?: ToolServices | undefined;
  readonly kimiRequestHeaders?: Record<string, string> | undefined;
  readonly resolveOAuthTokenProvider?: OAuthTokenProviderResolver | undefined;
  readonly skillDirs?: readonly string[];
  readonly telemetry?: TelemetryClient | undefined;
  readonly appVersion?: string;
}

export class LioraCore implements PromisableMethods<CoreAPI> {
  readonly sdk: Promise<SDKRPC>;
  readonly homeDir: string;
  readonly configPath: string;
  readonly sessions = new Map<string, Session>();
  readonly telemetry: TelemetryClient;

  private kaos: Promise<Kaos> | undefined;
  private runtime: ToolServices | undefined;
  private config: LioraConfig;
  private configWarnings: readonly string[] = [];
  private readonly runtimeOverride: ToolServices | undefined;
  private readonly userHomeDir: string;
  private readonly kimiRequestHeaders: Record<string, string> | undefined;
  private readonly resolveOAuthTokenProvider: OAuthTokenProviderResolver | undefined;
  private readonly skillDirs: readonly string[];
  readonly sessionStore: SessionStore;
  readonly plugins: PluginManager;
  pluginsReady: Promise<void>;
  pluginsLoadError: Error | undefined;
  readonly appVersion: string | undefined;
  readonly experimentalFlags: FlagResolver;
  readonly memory: LioraRecallStore;
  private readonly uncaughtListener:
    | ((error: Error, origin: NodeJS.UncaughtExceptionOrigin) => void)
    | undefined;

  constructor(
    protected readonly rpcClient: CoreRPCClient,
    options: LioraCoreOptions = {},
  ) {
    this.homeDir = resolveLioraHome(options.homeDir);
    this.userHomeDir = homedir();
    this.configPath = resolveConfigPath({
      homeDir: this.homeDir,
      configPath: options.configPath,
    });
    this.runtimeOverride = options.runtime;
    this.runtime = options.runtime;
    this.kimiRequestHeaders = options.kimiRequestHeaders;
    this.resolveOAuthTokenProvider = options.resolveOAuthTokenProvider;
    this.skillDirs = options.skillDirs ?? [];
    this.telemetry = options.telemetry ?? noopTelemetryClient;
    this.appVersion = options.appVersion;
    ensureLioraHome(this.homeDir);
    // Schema errors degrade (invalid sections are dropped with warnings) so a
    // typo cannot prevent startup, but a file that cannot be used at all —
    // TOML syntax error, unreadable — fails fast: defaults-only would start
    // the app looking logged out, which is worse than the parse error.
    const loaded = loadRuntimeConfigSafe(this.configPath);
    if (loaded.fileError !== undefined) {
      throw loaded.fileError;
    }
    this.config = loaded.config;
    this.configWarnings = [...loaded.fileWarnings, ...loaded.envWarnings];
    if (this.configWarnings.length > 0) {
      log.warn('config load degraded', { warnings: this.configWarnings });
    }
    this.experimentalFlags = new FlagResolver(
      process.env,
      FLAG_DEFINITIONS,
      this.config.experimental,
    );
    this.sessionStore = new SessionStore(this.homeDir);
    this.memory = new LioraRecallStore({
      homeDir: this.homeDir,
      config: () => this.config.memory,
    });
    this.plugins = new PluginManager({ kimiHomeDir: this.homeDir });
    // Capture the error rather than swallow it: mutators and explicit /plugins
    // reads rethrow so the user sees what's wrong; createSession/resumeSession
    // degrade silently (no plugin skills, no sessionStart injections) so the harness still
    // starts. Reload clears the error on success.
    this.pluginsReady = this.plugins.load().catch((error: unknown) => {
      this.pluginsLoadError = error instanceof Error ? error : new Error(String(error));
    });
    log.info('experimental flags enabled', { flags: this.experimentalFlags.enabledIds() });

    this.sdk = rpcClient(this);

    // Register a one-shot uncaught-exception monitor that drains pending
    // session state to disk before the process dies on an unexpected throw.
    // `uncaughtExceptionMonitor` runs synchronously before termination but
    // cannot await async work, so this is the synchronous best-effort path;
    // the graceful signal handlers (SIGINT/SIGTERM/SIGHUP) take the async
    // path. Idempotent across multiple core constructions in one process.
    this.uncaughtListener = () => {
      try {
        this.emergencyFlushSync();
      } catch {
        // Never mask the original exception.
      }
    };
    process.on('uncaughtExceptionMonitor', this.uncaughtListener);
  }

  async createSession(input: CreateSessionPayload): Promise<SessionSummary> {
    return sessionLifecycle.createSession(this, input);
  }

  async createSessionWithOverrides(
    input: CreateSessionPayload,
    overrides: { kaos?: Kaos; persistenceKaos?: Kaos },
  ): Promise<SessionSummary> {
    return sessionLifecycle.createSessionWithOverrides(this, input, overrides);
  }

  getCoreInfo(): CoreInfo {
    return { version: getCoreVersion() };
  }

  getExperimentalFeatures(): readonly ExperimentalFeatureState[] {
    return this.experimentalFlags.explainAll();
  }

  async memorySearch(payload: MemorySearchPayload): Promise<readonly MemorySearchResult[]> {
    return this.memory.search(payload);
  }

  async memoryList(payload: MemoryListPayload): Promise<readonly MemoryRecord[]> {
    return this.memory.list(payload);
  }

  async memoryGet(payload: MemoryGetPayload): Promise<MemoryRecord | undefined> {
    return this.memory.get(payload.id);
  }

  async memoryCreate(payload: MemoryCreatePayload): Promise<MemoryRecord> {
    return this.memory.remember(payload);
  }

  async memoryUpdate(payload: MemoryUpdatePayload): Promise<MemoryRecord> {
    return this.memory.update(payload.id, payload.patch);
  }

  async memoryForget(payload: MemoryForgetPayload): Promise<boolean> {
    return this.memory.forget(payload.id);
  }

  async memoryStats(_payload: EmptyPayload): Promise<MemoryStats> {
    return this.memory.stats();
  }

  async memoryExport(payload: MemoryListPayload): Promise<MemoryExportResult> {
    return this.memory.exportRecords(payload);
  }

  async memoryImport(payload: MemoryImportPayload): Promise<MemoryImportResult> {
    return this.memory.importRecords(payload.records);
  }

  async memoryConsolidate(_payload: EmptyPayload): Promise<MemoryConsolidateResult> {
    return this.memory.consolidate();
  }

  async closeSession(payload: CloseSessionPayload): Promise<void> {
    return sessionLifecycle.closeSession(this, payload);
  }

  emergencyFlushSync(): void {
    for (const session of this.sessions.values()) {
      try {
        session.emergencyFlushSync();
      } catch {
        // Best-effort — never let one session's failure skip the rest.
      }
    }
  }

  async archiveSession(payload: ArchiveSessionPayload): Promise<void> {
    return sessionLifecycle.archiveSession(this, payload);
  }

  async resumeSession(input: ResumeSessionPayload): Promise<ResumeSessionResult> {
    return sessionLifecycle.resumeSession(this, input);
  }

  async resumeSessionWithOverrides(
    input: ResumeSessionPayload,
    overrides: {
      kaos?: Kaos;
      persistenceKaos?: Kaos;
      forcePluginSessionStartReminder?: boolean;
    },
  ): Promise<ResumeSessionResult> {
    return sessionLifecycle.resumeSessionWithOverrides(this, input, overrides);
  }

  async reloadSession(input: ReloadSessionPayload): Promise<ResumeSessionResult> {
    return sessionLifecycle.reloadSession(this, input);
  }

  async forkSession(input: ForkSessionPayload): Promise<ResumeSessionResult> {
    return sessionLifecycle.forkSession(this, input);
  }

  async listSessions(input: ListSessionsPayload = {}): Promise<readonly SessionSummary[]> {
    return sessionLifecycle.listSessions(this, input);
  }

  async renameSession(request: RenameSessionRequest): Promise<void> {
    return sessionLifecycle.renameSession(this, request);
  }

  async exportSession(input: ExportSessionPayload): Promise<ExportSessionResult> {
    return sessionLifecycle.exportSession(this, input);
  }

  async getKimiConfig(input?: GetKimiConfigPayload): Promise<LioraConfig> {
    if (input?.reload) {
      this.reloadRuntimeConfig();
    }
    return this.config;
  }

  async getConfigDiagnostics(_input?: EmptyPayload): Promise<ConfigDiagnostics> {
    return { warnings: this.configWarnings };
  }

  async setKimiConfig(input: SetKimiConfigPayload): Promise<LioraConfig> {
    const config = mergeConfigPatch(this.readConfigForWrite(), input);
    await writeConfigFile(this.configPath, config);
    return this.reloadRuntimeConfig();
  }

  async deleteConfigFields(input: DeleteConfigFieldsPayload): Promise<LioraConfig> {
    const paths = validateDeleteConfigFields(input);
    const config = this.readConfigForWrite();
    if (applyDeleteConfigFields(config, paths)) {
      await writeConfigFile(this.configPath, config);
    }
    return this.reloadRuntimeConfig();
  }

  async removeKimiProvider(input: RemoveKimiProviderPayload): Promise<LioraConfig> {
    const config = this.readConfigForWrite();
    removeProviderFromConfig(config, input.providerId);
    await writeConfigFile(this.configPath, config);
    return this.reloadRuntimeConfig();
  }

  prompt(request: Parameters<typeof sessionAgentMethods.prompt>[1]) {
    return sessionAgentMethods.prompt(this, request);
  }

  runShellCommand(request: Parameters<typeof sessionAgentMethods.runShellCommand>[1]) {
    return sessionAgentMethods.runShellCommand(this, request);
  }

  cancelShellCommand(request: Parameters<typeof sessionAgentMethods.cancelShellCommand>[1]) {
    return sessionAgentMethods.cancelShellCommand(this, request);
  }

  steer(request: Parameters<typeof sessionAgentMethods.steer>[1]) {
    return sessionAgentMethods.steer(this, request);
  }

  cancel(request: Parameters<typeof sessionAgentMethods.cancel>[1]) {
    return sessionAgentMethods.cancel(this, request);
  }

  undoHistory(request: Parameters<typeof sessionAgentMethods.undoHistory>[1]) {
    return sessionAgentMethods.undoHistory(this, request);
  }

  setModel(request: SessionAgentPayload<SetModelPayload>): Promise<SetModelResult> {
    return sessionAgentMethods.setModel(this, request);
  }

  setThinking(request: Parameters<typeof sessionAgentMethods.setThinking>[1]) {
    return sessionAgentMethods.setThinking(this, request);
  }

  setPermission(request: Parameters<typeof sessionAgentMethods.setPermission>[1]) {
    return sessionAgentMethods.setPermission(this, request);
  }

  getModel(request: Parameters<typeof sessionAgentMethods.getModel>[1]) {
    return sessionAgentMethods.getModel(this, request);
  }

  enterPlan(request: Parameters<typeof sessionAgentMethods.enterPlan>[1]) {
    return sessionAgentMethods.enterPlan(this, request);
  }

  cancelPlan(request: Parameters<typeof sessionAgentMethods.cancelPlan>[1]) {
    return sessionAgentMethods.cancelPlan(this, request);
  }

  clearPlan(request: Parameters<typeof sessionAgentMethods.clearPlan>[1]) {
    return sessionAgentMethods.clearPlan(this, request);
  }

  enterSwarm(request: Parameters<typeof sessionAgentMethods.enterSwarm>[1]) {
    return sessionAgentMethods.enterSwarm(this, request);
  }

  exitSwarm(request: Parameters<typeof sessionAgentMethods.exitSwarm>[1]) {
    return sessionAgentMethods.exitSwarm(this, request);
  }

  getSwarmMode(request: Parameters<typeof sessionAgentMethods.getSwarmMode>[1]) {
    return sessionAgentMethods.getSwarmMode(this, request);
  }

  setPremiumQuality(request: Parameters<typeof sessionAgentMethods.setPremiumQuality>[1]) {
    return sessionAgentMethods.setPremiumQuality(this, request);
  }

  getPremiumQuality(request: Parameters<typeof sessionAgentMethods.getPremiumQuality>[1]) {
    return sessionAgentMethods.getPremiumQuality(this, request);
  }

  setOrchestratorMode(request: Parameters<typeof sessionAgentMethods.setOrchestratorMode>[1]) {
    return sessionAgentMethods.setOrchestratorMode(this, request);
  }

  getOrchestratorMode(request: Parameters<typeof sessionAgentMethods.getOrchestratorMode>[1]) {
    return sessionAgentMethods.getOrchestratorMode(this, request);
  }

  beginCompaction(request: Parameters<typeof sessionAgentMethods.beginCompaction>[1]) {
    return sessionAgentMethods.beginCompaction(this, request);
  }

  cancelCompaction(request: Parameters<typeof sessionAgentMethods.cancelCompaction>[1]) {
    return sessionAgentMethods.cancelCompaction(this, request);
  }

  registerTool(request: Parameters<typeof sessionAgentMethods.registerTool>[1]) {
    return sessionAgentMethods.registerTool(this, request);
  }

  unregisterTool(request: Parameters<typeof sessionAgentMethods.unregisterTool>[1]) {
    return sessionAgentMethods.unregisterTool(this, request);
  }

  setActiveTools(request: Parameters<typeof sessionAgentMethods.setActiveTools>[1]) {
    return sessionAgentMethods.setActiveTools(this, request);
  }

  stopBackground(request: Parameters<typeof sessionAgentMethods.stopBackground>[1]) {
    return sessionAgentMethods.stopBackground(this, request);
  }

  detachBackground(request: Parameters<typeof sessionAgentMethods.detachBackground>[1]) {
    return sessionAgentMethods.detachBackground(this, request);
  }

  clearContext(request: Parameters<typeof sessionAgentMethods.clearContext>[1]) {
    return sessionAgentMethods.clearContext(this, request);
  }

  activateSkill(request: SessionAgentPayload<ActivateSkillPayload>): Promise<void> {
    return sessionAgentMethods.activateSkill(this, request);
  }

  activatePluginCommand(request: SessionAgentPayload<ActivatePluginCommandPayload>): Promise<void> {
    return sessionAgentMethods.activatePluginCommand(this, request);
  }

  getBackgroundOutput(request: Parameters<typeof sessionAgentMethods.getBackgroundOutput>[1]) {
    return sessionAgentMethods.getBackgroundOutput(this, request);
  }

  getContext(request: Parameters<typeof sessionAgentMethods.getContext>[1]) {
    return sessionAgentMethods.getContext(this, request);
  }

  getContextComposition(request: Parameters<typeof sessionAgentMethods.getContextComposition>[1]) {
    return sessionAgentMethods.getContextComposition(this, request);
  }

  diagnoseContextOS(request: Parameters<typeof sessionAgentMethods.diagnoseContextOS>[1]) {
    return sessionAgentMethods.diagnoseContextOS(this, request);
  }

  getSessionTrace(request: Parameters<typeof sessionAgentMethods.getSessionTrace>[1]) {
    return sessionAgentMethods.getSessionTrace(this, request);
  }

  getConfig(request: Parameters<typeof sessionAgentMethods.getConfig>[1]) {
    return sessionAgentMethods.getConfig(this, request);
  }

  getPermission(request: Parameters<typeof sessionAgentMethods.getPermission>[1]) {
    return sessionAgentMethods.getPermission(this, request);
  }

  getPlan(request: Parameters<typeof sessionAgentMethods.getPlan>[1]) {
    return sessionAgentMethods.getPlan(this, request);
  }

  getUsage(request: Parameters<typeof sessionAgentMethods.getUsage>[1]) {
    return sessionAgentMethods.getUsage(this, request);
  }

  getProviderRouteStatus(request: Parameters<typeof sessionAgentMethods.getProviderRouteStatus>[1]) {
    return sessionAgentMethods.getProviderRouteStatus(this, request);
  }

  resetProviderRouteStatus(request: Parameters<typeof sessionAgentMethods.resetProviderRouteStatus>[1]) {
    return sessionAgentMethods.resetProviderRouteStatus(this, request);
  }

  getTools(request: Parameters<typeof sessionAgentMethods.getTools>[1]) {
    return sessionAgentMethods.getTools(this, request);
  }

  getBackground(request: Parameters<typeof sessionAgentMethods.getBackground>[1]) {
    return sessionAgentMethods.getBackground(this, request);
  }

  inlineComplete(
    request: SessionAgentPayload<InlineCompletePayload>,
    options?: PromptIntelligenceCallOptions,
  ) {
    return sessionAgentMethods.inlineComplete(this, request, options);
  }

  suggestPrompts(
    request: SessionAgentPayload<EmptyPayload>,
    options?: PromptIntelligenceCallOptions,
  ) {
    return sessionAgentMethods.suggestPrompts(this, request, options);
  }

  updateSessionMetadata(request: UpdateSessionMetadataRequest): Promise<void> {
    return sessionAgentMethods.updateSessionMetadata(this, request);
  }

  getSessionMetadata(request: SessionScopedPayload<EmptyPayload>): SessionMeta {
    return sessionAgentMethods.getSessionMetadata(this, request);
  }

  listSkills(request: Parameters<typeof sessionAgentMethods.listSkills>[1]) {
    return sessionAgentMethods.listSkills(this, request);
  }

  listPluginCommands(request: Parameters<typeof sessionAgentMethods.listPluginCommands>[1]) {
    return sessionAgentMethods.listPluginCommands(this, request);
  }

  searchSkills(request: Parameters<typeof sessionAgentMethods.searchSkills>[1]) {
    return sessionAgentMethods.searchSkills(this, request);
  }

  listMcpServers(request: Parameters<typeof sessionAgentMethods.listMcpServers>[1]) {
    return sessionAgentMethods.listMcpServers(this, request);
  }

  getMcpStartupMetrics(request: Parameters<typeof sessionAgentMethods.getMcpStartupMetrics>[1]) {
    return sessionAgentMethods.getMcpStartupMetrics(this, request);
  }

  reconnectMcpServer(request: Parameters<typeof sessionAgentMethods.reconnectMcpServer>[1]) {
    return sessionAgentMethods.reconnectMcpServer(this, request);
  }

  generateAgentsMd(request: Parameters<typeof sessionAgentMethods.generateAgentsMd>[1]) {
    return sessionAgentMethods.generateAgentsMd(this, request);
  }

  getSessionWarnings(request: Parameters<typeof sessionAgentMethods.getSessionWarnings>[1]) {
    return sessionAgentMethods.getSessionWarnings(this, request);
  }

  addAdditionalDir(request: Parameters<typeof sessionAgentMethods.addAdditionalDir>[1]) {
    return sessionAgentMethods.addAdditionalDir(this, request);
  }

  rewindFiles(request: Parameters<typeof sessionAgentMethods.rewindFiles>[1]) {
    return sessionAgentMethods.rewindFiles(this, request);
  }

  startConversationLoop(request: Parameters<typeof sessionAgentMethods.startConversationLoop>[1]) {
    return sessionAgentMethods.startConversationLoop(this, request);
  }

  stopConversationLoop(request: Parameters<typeof sessionAgentMethods.stopConversationLoop>[1]) {
    return sessionAgentMethods.stopConversationLoop(this, request);
  }

  listConversationLoops(request: Parameters<typeof sessionAgentMethods.listConversationLoops>[1]) {
    return sessionAgentMethods.listConversationLoops(this, request);
  }

  startBtw(request: Parameters<typeof sessionAgentMethods.startBtw>[1]) {
    return sessionAgentMethods.startBtw(this, request);
  }

  createGoal(request: Parameters<typeof sessionAgentMethods.createGoal>[1]) {
    return sessionAgentMethods.createGoal(this, request);
  }

  getGoal(request: Parameters<typeof sessionAgentMethods.getGoal>[1]) {
    return sessionAgentMethods.getGoal(this, request);
  }

  pauseGoal(request: Parameters<typeof sessionAgentMethods.pauseGoal>[1]) {
    return sessionAgentMethods.pauseGoal(this, request);
  }

  resumeGoal(request: Parameters<typeof sessionAgentMethods.resumeGoal>[1]) {
    return sessionAgentMethods.resumeGoal(this, request);
  }

  cancelGoal(request: Parameters<typeof sessionAgentMethods.cancelGoal>[1]) {
    return sessionAgentMethods.cancelGoal(this, request);
  }

  createUltraworkRun(request: Parameters<typeof sessionAgentMethods.createUltraworkRun>[1]) {
    return sessionAgentMethods.createUltraworkRun(this, request);
  }

  getUltraworkRun(request: Parameters<typeof sessionAgentMethods.getUltraworkRun>[1]) {
    return sessionAgentMethods.getUltraworkRun(this, request);
  }

  pauseUltrawork(request: Parameters<typeof sessionAgentMethods.pauseUltrawork>[1]) {
    return sessionAgentMethods.pauseUltrawork(this, request);
  }

  swarmRestaff(request: Parameters<typeof sessionAgentMethods.swarmRestaff>[1]) {
    return sessionAgentMethods.swarmRestaff(this, request);
  }

  resumeUltrawork(request: Parameters<typeof sessionAgentMethods.resumeUltrawork>[1]) {
    return sessionAgentMethods.resumeUltrawork(this, request);
  }

  cancelUltrawork(request: Parameters<typeof sessionAgentMethods.cancelUltrawork>[1]) {
    return sessionAgentMethods.cancelUltrawork(this, request);
  }

  classifyUltraworkAutoActivation(request: SessionAgentPayload<ClassifyUltraworkAutoActivationPayload>): Promise<UltraworkAutoActivationDecision> {
    return sessionAgentMethods.classifyUltraworkAutoActivation(this, request);
  }

  classifyUltraworkObjectiveProfile(request: SessionAgentPayload<ClassifyUltraworkObjectiveProfilePayload>): Promise<UltraworkObjectiveProfileDecision> {
    return sessionAgentMethods.classifyUltraworkObjectiveProfile(this, request);
  }

  async installPlugin(payload: InstallPluginPayload): Promise<PluginSummary> {
    return pluginMethods.installPlugin(this, payload);
  }

  async listPlugins(payload: EmptyPayload): Promise<readonly PluginSummary[]> {
    return pluginMethods.listPlugins(this, payload);
  }

  async setPluginEnabled(payload: SetPluginEnabledPayload): Promise<void> {
    return pluginMethods.setPluginEnabled(this, payload);
  }

  async setPluginMcpServerEnabled(payload: SetPluginMcpServerEnabledPayload): Promise<void> {
    return pluginMethods.setPluginMcpServerEnabled(this, payload);
  }

  async removePlugin(payload: RemovePluginPayload): Promise<void> {
    return pluginMethods.removePlugin(this, payload);
  }

  async reloadPlugins(payload: EmptyPayload): Promise<ReloadPluginsResult> {
    return pluginMethods.reloadPlugins(this, payload);
  }

  async getPluginInfo(payload: GetPluginInfoPayload): Promise<PluginInfo> {
    return pluginMethods.getPluginInfo(this, payload);
  }

  private async resolveRuntime(config: LioraConfig): Promise<ToolServices> {
    if (this.runtimeOverride !== undefined) return this.runtimeOverride;
    const statefulGui = hasStatefulGuiRuntime(config);
    if (!statefulGui && this.runtime !== undefined) return this.runtime;
    const runtime = await createRuntimeConfig({
      config,
      homeDir: this.homeDir,
      kimiRequestHeaders: this.kimiRequestHeaders,
      resolveOAuthTokenProvider: this.resolveOAuthTokenProvider,
    });
    if (!statefulGui) this.runtime = runtime;
    return runtime;
  }

  async buildSessionToolServices(
    config: LioraConfig,
    sessionId: string,
  ): Promise<ToolServices> {
    const runtime = await this.resolveRuntime(config);
    const context7 = createContext7Provider({
      isEnabled: () => isContext7Enabled(config),
      readApiKey: () => readContext7ApiKeyFromConfig(this.config),
      requestApiKey: async ({ toolCallId }) => {
        const sdk = await this.sdk;
        const response = await sdk.requestCredential({
          sessionId,
          agentId: 'main',
          id: 'context7',
          title: 'Context7',
          subtitleLines: [
            'Free API keys: https://context7.com/dashboard',
            'Saved to ~/.superliora/config.toml',
          ],
          toolCallId,
        });
        const value = response?.value;
        return value !== undefined && value.length > 0 ? value : undefined;
      },
      persistApiKey: async (apiKey) => {
        await this.setKimiConfig({ research: { context7: { apiKey } } });
      },
    });
    if (context7 === undefined) return runtime;
    return { ...runtime, context7 };
  }

  getKaos(): Promise<Kaos> {
    this.kaos ??= LocalKaos.create().catch((error: unknown) => {
      if (error instanceof KaosShellNotFoundError) {
        throw new LioraError(ErrorCodes.SHELL_GIT_BASH_NOT_FOUND, error.message);
      }
      throw error;
    });
    return this.kaos;
  }

  resolveSessionSkillConfig(config: LioraConfig): SessionSkillConfig {
    const explicitDirs = this.skillDirs.length > 0 ? this.skillDirs : undefined;
    return {
      userHomeDir: this.userHomeDir,
      brandHomeDir: this.homeDir,
      explicitDirs,
      extraDirs: config.extraSkillDirs,
      pluginSkillRoots: this.plugins.pluginSkillRoots(),
      mergeAllAvailableSkills: config.mergeAllAvailableSkills,
    };
  }

  resolveProviderManager(sessionId: string): ProviderManager {
    return new ProviderManager({
      config: () => this.config,
      kimiRequestHeaders: this.kimiRequestHeaders,
      resolveOAuthTokenProvider: this.resolveOAuthTokenProvider,
      promptCacheKey: sessionId,
    });
  }

  mergePluginMcpConfig(base: SessionMcpConfig | undefined): SessionMcpConfig | undefined {
    const managedEnv = managedKimiCodeEnvForPlugins(this.config);
    const pluginServers = withManagedKimiPluginEnv(this.plugins.enabledMcpServers(), managedEnv);
    return combinePluginMcpConfig(base, pluginServers);
  }

  requireSession(sessionId: string): Session {
    const session = this.sessions.get(sessionId);
    if (session === undefined) {
      throw new LioraError(ErrorCodes.SESSION_NOT_FOUND, `Session "${sessionId}" was not found`, {
        details: { sessionId },
      });
    }
    return session;
  }

  sessionApi(sessionId: string): SessionAPIImpl {
    return new SessionAPIImpl(this.requireSession(sessionId));
  }

  reloadProviderManager(): LioraConfig {
    return this.reloadRuntimeConfig();
  }

  private readConfigForWrite(): LioraConfig {
    return readConfigFileForUpdate(this.configPath);
  }

  private reloadRuntimeConfig(): LioraConfig {
    const loaded = loadRuntimeConfigSafe(this.configPath);
    if (loaded.fileWarnings.length > 0) {
      // Keep the last good config: adopting a salvaged config mid-run could
      // silently drop providers or models a live session depends on.
      this.configWarnings = [
        ...loaded.fileWarnings,
        ...loaded.envWarnings,
        'config.toml has errors; keeping the previously loaded configuration.',
      ];
      log.warn('config reload degraded; keeping previous config', {
        warnings: loaded.fileWarnings,
      });
      return this.config;
    }
    this.configWarnings = loaded.envWarnings;
    return this.setRuntimeConfig(loaded.config);
  }

  private setRuntimeConfig(config: LioraConfig): LioraConfig {
    this.config = config;
    this.experimentalFlags.setConfigOverrides(config.experimental);
    return this.config;
  }

  clearRuntimeCache(): void {
    if (this.runtimeOverride !== undefined) return;
    this.runtime = undefined;
  }

  async refreshSessionRuntimeConfig(
    session: Session,
    config: LioraConfig,
  ): Promise<void> {
    const api = new SessionAPIImpl(session);
    // A session migrated from an external tool carries no model, and any
    // session may reference a model alias that no longer exists in config.toml.
    // Try the session's own model first, then fall back to the configured
    // default, so resume degrades gracefully instead of hard-failing.
    const requested = (await api.getModel({ agentId: 'main' })).trim();
    const fallback = config.defaultModel?.trim() ?? '';
    const candidates = [...new Set([requested, fallback].filter((model) => model.length > 0))];
    for (const model of candidates) {
      try {
        await api.setModel({ agentId: 'main', model });
        await session.flushMetadata();
        return;
      } catch (error) {
        // Skip a candidate only when the alias is genuinely absent from
        // config (a stale or migrated model) — that is the graceful-degrade
        // case. A *configured* alias that fails to resolve (missing provider,
        // no credentials, bad max_context_size) is an actionable config error
        // the user must see; surface it instead of silently swapping models.
        const aliasMissing = config.models?.[model] === undefined;
        if (
          aliasMissing &&
          error instanceof LioraError &&
          error.code === ErrorCodes.CONFIG_INVALID
        ) {
          continue;
        }
        throw error;
      }
    }
  }
}
