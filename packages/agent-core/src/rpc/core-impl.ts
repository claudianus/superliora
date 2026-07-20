import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { createBrowserUseRuntime, CuaComputerRuntime } from '@superliora/gui-use';
import { join } from 'pathe';

import { ErrorCodes, LioraError } from '#/errors';
import { getRootLogger, log } from '#/logging/logger';
import { PluginManager } from '#/plugin';
import { LocalFetchURLProvider } from '#/tools/providers/local-fetch-url';
import { LocalWebSearchProvider } from '#/tools/providers/local-web-search';
import { MoonshotFetchURLProvider } from '#/tools/providers/moonshot-fetch-url';
import { ResearchSearchEngine } from '#/tools/providers/research-search';
import {
  createContext7Provider,
  isContext7Enabled,
  readContext7ApiKeyFromConfig,
} from '#/tools/providers/context7-session';
import type { PromisableMethods } from '#/utils/types';
import { getCoreVersion } from '#/version';
import { resolveThinkingLevel } from '../agent/config/thinking';
import { Agent } from '../agent';
import {
  ensureLioraHome,
  loadRuntimeConfigSafe,
  mergeConfigPatch,
  readConfigFileForUpdate,
  normalizeAdditionalDirs,
  readWorkspaceAdditionalDirs,
  resolveWorkspaceAdditionalDirs,
  resolveConfigPath,
  resolveLioraHome,
  writeConfigFile,
  type LioraConfig,
  type McpServerConfig,
  type MoonshotServiceConfig,
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
  responseLanguagePreferenceFromHostLocale,
  responseLanguagePreferenceFromUnknown,
} from '../session/response-language';
import { exportSessionDirectory } from '../session/export';
import {
  ProviderManager, type BearerTokenProvider,
  type OAuthTokenProviderResolver
} from '../session/provider-manager';
import { SessionAPIImpl } from '../session/rpc';
import { normalizeWorkDir, SessionStore } from '../session/store/index';
import {
  noopTelemetryClient,
  withTelemetryContext,
  withTelemetryProperties,
  type TelemetryClient,
  type TelemetryProperties,
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
  ResumeUltraworkPayloadResult,
  UltraworkRunSnapshot,
  CreateSessionPayload,
  DetachBackgroundPayload,
  ClientTelemetryInfo,
  EmptyPayload,
  DiagnoseContextOSPayload,
  EnterPlanPayload,
  EnterSwarmPayload,
  GoalSnapshot,
  GoalToolResult,
  ExportSessionPayload,
  ExportSessionResult,
  ForkSessionPayload,
  GetBackgroundOutputPayload,
  GetBackgroundPayload,
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
  SetThinkingPayload,
  SkillSearchResult,
  SkillSummary,
  SteerPayload,
  StopBackgroundPayload,
  UndoHistoryPayload,
  UnregisterToolPayload,
  UpdateSessionMetadataPayload,
} from './core-api';
import type { ResumedAgentState, ResumeSessionResult } from './resumed';
import type { SDKRPC } from './sdk-api';
import { SUPERLIORA_PROVIDER_NAME } from '@superliora/oauth';
import type { SessionWarning } from '@superliora/protocol';
import { proxyWithExtraPayload } from './types';
import { KaosShellNotFoundError, LocalKaos, type Kaos } from '@superliora/kaos';
import type { ToolServices } from '../tools/support/services';

const SUPERLIORA_BASE_URL_ENV = 'SUPERLIORA_BASE_URL';
const SUPERLIORA_OAUTH_HOST_ENV = 'SUPERLIORA_OAUTH_HOST';
const KIMI_OAUTH_HOST_ENV = 'KIMI_OAUTH_HOST';
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
  private readonly sessionStore: SessionStore;
  readonly plugins: PluginManager;
  private pluginsReady: Promise<void>;
  private pluginsLoadError: Error | undefined;
  private readonly appVersion: string | undefined;
  private readonly experimentalFlags: FlagResolver;
  private readonly memory: LioraRecallStore;
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
    return this.createSessionWithOverrides(input, {});
  }

  async createSessionWithOverrides(
    input: CreateSessionPayload,
    overrides: { kaos?: Kaos; persistenceKaos?: Kaos },
  ): Promise<SessionSummary> {
    const options = input;
    const workDir = requiredWorkDir('createSession', options.workDir);
    const config = this.reloadProviderManager();
    const id = options.id ?? createSessionId();
    const modelAlias = options.model ?? config.defaultModel;
    const thinkingLevel = resolveThinkingLevel(options.thinking, {
      ...config,
      model: modelAlias === undefined ? undefined : config.models?.[modelAlias],
    });
    const permissionMode = options.permission ?? config.defaultPermissionMode;
    const baseMcpConfig = await resolveSessionMcpConfig({
      cwd: workDir,
      homeDir: this.homeDir,
    });
    const withCallerMcp = mergeCallerMcpServers(baseMcpConfig, options.mcpServers);
    const parentKaos = overrides.kaos ?? (await this.getKaos());
    const persistenceKaos = overrides.persistenceKaos ?? parentKaos;
    // Read the workspace local config (`.superliora/local.toml`) through the
    // persistence (local) kaos, not the tool kaos. In ACP mode the tool kaos is
    // the reverse-RPC bridge and the client does not know the session yet during
    // `session/new`, so reading through it fails with "unknown session"
    // (https://github.com/claudianus/superliora/issues/988). The local config is
    // a system file and must not depend on the tool bridge — same reason
    // `Session.systemContextKaos` is backed by the persistence sink.
    const localWorkspaceDirs = await readWorkspaceAdditionalDirs(persistenceKaos, workDir);
    const callerAdditionalDirs = await resolveWorkspaceAdditionalDirs(
      parentKaos,
      workDir,
      options.additionalDirs ?? [],
    );
    const additionalDirs = normalizeAdditionalDirs([
      ...localWorkspaceDirs.additionalDirs,
      ...callerAdditionalDirs,
    ]);
    const summary = await this.sessionStore.create({
      id,
      workDir,
    });
    const result: SessionSummary = {
      ...summary,
      metadata: options.metadata,
    };
    const clientTelemetry = clientTelemetryProperties(options.client);
    const sessionTelemetryBase = withTelemetryContext(this.telemetry, { sessionId: summary.id });
    const sessionTelemetry =
      Object.keys(clientTelemetry).length === 0
        ? sessionTelemetryBase
        : withTelemetryProperties(sessionTelemetryBase, clientTelemetry);

    await this.pluginsReady;
    const pluginSessionStarts = this.plugins.enabledSessionStarts();
    const pluginCommands = await this.plugins.enabledCommands();
    const mcpConfig = this.mergePluginMcpConfig(withCallerMcp);

    // Session ctor attaches its own log sink. If anything in the setup-after-
    // ctor block throws, `session.close()` releases the sink (and mcp).
    const runtime = await this.buildSessionToolServices(config, summary.id);
    const session = new Session({
      kaos: parentKaos.withCwd(workDir),
      persistenceKaos,
      toolServices: runtime,
      config,
      id,
      homedir: summary.sessionDir,
      kimiHomeDir: this.homeDir,
      rpc: proxyWithExtraPayload(await this.sdk, { sessionId: summary.id }),
      providerManager: this.resolveProviderManager(summary.id),
      background: config.background,
      hooks: [...(config.hooks ?? []), ...this.plugins.enabledHooks()],
      permissionRules: config.permission?.rules,
      skills: this.resolveSessionSkillConfig(config),
      mcpConfig,
      experimentalFlags: this.experimentalFlags,
      telemetry: sessionTelemetry,
      pluginSessionStarts,
      appVersion: this.appVersion,
      additionalDirs,
      memory: this.memory.runtimeForSession({ sessionId: summary.id, workDir }),
      dreamStore: this.memory,
      pluginCommands,
      drainAgentTasksOnStop: options.drainAgentTasksOnStop,
    });
    try {
      session.metadata = {
        ...session.metadata,
        createdAt: new Date(summary.createdAt).toISOString(),
        updatedAt: new Date(summary.updatedAt).toISOString(),
        workDir,
        ...(summary.title !== undefined
          ? {
              title: summary.title,
              isCustomTitle: true,
            }
          : {}),
        custom: options.metadata === undefined ? {} : { ...options.metadata },
      };
      if (responseLanguagePreferenceFromUnknown(session.metadata.custom['responseLanguage']) === undefined) {
        const seeded = responseLanguagePreferenceFromHostLocale();
        if (seeded !== undefined) {
          session.metadata = {
            ...session.metadata,
            custom: {
              ...session.metadata.custom,
              responseLanguage: seeded,
            },
          };
        }
      }
      const mainAgent = await session.createMain();
      mainAgent.config.update({
        modelAlias: options.model ?? config.defaultModel,
        thinkingLevel,
      });
      if (permissionMode !== undefined) {
        mainAgent.permission.setMode(permissionMode);
      }
      // Honor config.defaultPlanMode for fresh sessions. Resumed sessions
      // restore their own plan state from records and never re-apply this.
      if (config.defaultPlanMode === true) {
        await mainAgent.planMode.enter();
      }
      await session.writeMetadata();
      await session.flushMetadata();
    } catch (error) {
      await session.close().catch(() => {});
      throw error;
    }
    this.sessions.set(id, session);
    if (Object.keys(clientTelemetry).length > 0) {
      sessionTelemetry.track('session_started', { resumed: false });
    }
    return withAdditionalDirs(result, session);
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

  async closeSession({ sessionId }: CloseSessionPayload): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      await session.close();
      this.sessions.delete(sessionId);
    }
  }

  /**
   * Emergency synchronous flush of every active session's pending state to
   * disk (Ultrawork mirrors + wire-log records, with fsync). Intended only for
   * crash paths (signal handlers, `uncaughtExceptionMonitor`) where no async
   * work can complete before the process exits. Never throws.
   */
  emergencyFlushSync(): void {
    for (const session of this.sessions.values()) {
      try {
        session.emergencyFlushSync();
      } catch {
        // Best-effort — never let one session's failure skip the rest.
      }
    }
  }

  async archiveSession({ sessionId }: ArchiveSessionPayload): Promise<void> {
    await this.closeSession({ sessionId });
    await this.sessionStore.archive(sessionId);
  }

  async resumeSession(input: ResumeSessionPayload): Promise<ResumeSessionResult> {
    return this.resumeSessionWithOverrides(input, {});
  }

  async resumeSessionWithOverrides(
    input: ResumeSessionPayload,
    overrides: {
      kaos?: Kaos;
      persistenceKaos?: Kaos;
      forcePluginSessionStartReminder?: boolean;
    },
  ): Promise<ResumeSessionResult> {
    const summary = await this.sessionStore.get(input.sessionId);
    const parentKaosForRead = overrides.kaos ?? (await this.getKaos());
    // Read `.superliora/local.toml` through the persistence (local) kaos, not the
    // tool kaos — see createSessionWithOverrides and issue #988.
    const localWorkspaceDirs = await readWorkspaceAdditionalDirs(
      overrides.persistenceKaos ?? parentKaosForRead,
      summary.workDir,
    );
    const callerAdditionalDirs = await resolveWorkspaceAdditionalDirs(
      parentKaosForRead,
      summary.workDir,
      input.additionalDirs ?? [],
    );
    const additionalDirs = normalizeAdditionalDirs([
      ...localWorkspaceDirs.additionalDirs,
      ...callerAdditionalDirs,
    ]);
    const active = this.sessions.get(summary.id);
    if (active !== undefined) {
      if (overrides.kaos !== undefined) {
        active.setToolKaos(overrides.kaos.withCwd(summary.workDir));
      }
      await active.setAdditionalDirs(additionalDirs);
      return withAdditionalDirs(await resumeSessionResult(summary, active), active);
    }

    const config = this.reloadProviderManager();
    const baseMcpConfig = await resolveSessionMcpConfig({
      cwd: summary.workDir,
      homeDir: this.homeDir,
    });
    const withCallerMcp = mergeCallerMcpServers(baseMcpConfig, input.mcpServers);
    await this.pluginsReady;
    const pluginSessionStarts = this.plugins.enabledSessionStarts();
    const pluginCommands = await this.plugins.enabledCommands();
    const mcpConfig = this.mergePluginMcpConfig(withCallerMcp);
    const runtime = await this.buildSessionToolServices(config, summary.id);
    const parentKaos = parentKaosForRead;
    const persistenceKaos = overrides.persistenceKaos ?? parentKaos;
    const session = new Session({
      kaos: parentKaos.withCwd(summary.workDir),
      persistenceKaos,
      toolServices: runtime,
      config,
      id: summary.id,
      homedir: summary.sessionDir,
      kimiHomeDir: this.homeDir,
      rpc: proxyWithExtraPayload(await this.sdk, { sessionId: summary.id }),
      providerManager: this.resolveProviderManager(summary.id),
      background: config.background,
      hooks: [...(config.hooks ?? []), ...this.plugins.enabledHooks()],
      permissionRules: config.permission?.rules,
      skills: this.resolveSessionSkillConfig(config),
      mcpConfig,
      experimentalFlags: this.experimentalFlags,
      telemetry: withTelemetryContext(this.telemetry, { sessionId: summary.id }),
      initializeMainAgent: false,
      pluginSessionStarts,
      appVersion: this.appVersion,
      additionalDirs,
      memory: this.memory.runtimeForSession({ sessionId: summary.id, workDir: summary.workDir }),
      dreamStore: this.memory,
      pluginCommands,
    });
    let warning: string | undefined;
    try {
      const resumeResult = await session.resume();
      warning = resumeResult.warning;
      await this.refreshSessionRuntimeConfig(session, config);
    } catch (error) {
      await session.close().catch(() => {});
      withTelemetryContext(this.telemetry, { sessionId: summary.id }).track('session_load_failed', {
        reason: telemetryErrorReason(error),
      });
      throw error;
    }
    this.sessions.set(summary.id, session);
    if (overrides.forcePluginSessionStartReminder === true) {
      // Append before constructing the result so the returned ResumeSessionResult
      // (and any SDK caller's resumeState) reflects the refreshed plugin context.
      await session.appendPluginSessionStartReminder();
    }
    return resumeSessionResult(summary, session, warning);
  }

  async reloadSession(input: ReloadSessionPayload): Promise<ResumeSessionResult> {
    const summary = await this.sessionStore.get(input.sessionId);
    const active = this.sessions.get(summary.id);
    if (active?.hasActiveTurn === true) {
      throw new LioraError(
        ErrorCodes.TURN_AGENT_BUSY,
        `Session "${summary.id}" cannot be reloaded while a turn is running`,
        { details: { sessionId: summary.id } },
      );
    }

    this.reloadProviderManager();
    this.clearRuntimeCache();
    await this.reloadPlugins({});

    if (active !== undefined) {
      await active.closeForReload();
      this.sessions.delete(summary.id);
    }
    return this.resumeSessionWithOverrides(
      { sessionId: summary.id },
      { forcePluginSessionStartReminder: input.forcePluginSessionStartReminder },
    );
  }

  async forkSession(input: ForkSessionPayload): Promise<ResumeSessionResult> {
    const source = await this.sessionStore.get(input.sessionId);
    const active = this.sessions.get(source.id);
    if (active?.hasActiveTurn === true) {
      throw new LioraError(
        ErrorCodes.SESSION_FORK_ACTIVE_TURN,
        `Session "${source.id}" cannot be forked while a turn is running`,
        { details: { sessionId: source.id } },
      );
    }

    if (active !== undefined) {
      await active.flushMetadata();
    }

    const id = input.id ?? createSessionId();
    await this.sessionStore.fork({
      sourceId: source.id,
      targetId: id,
      title: input.title,
      metadata: input.metadata,
    });
    return this.resumeSession({ sessionId: id });
  }

  async listSessions(input: ListSessionsPayload = {}): Promise<readonly SessionSummary[]> {
    return this.sessionStore.list(input);
  }

  async renameSession({ sessionId, ...payload }: RenameSessionRequest): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session !== undefined) {
      await new SessionAPIImpl(session).renameSession(payload);
      return;
    }
    await this.sessionStore.rename(sessionId, payload.title);
  }

  async exportSession(input: ExportSessionPayload): Promise<ExportSessionResult> {
    const summary = await this.sessionStore.get(input.sessionId);
    const active = this.sessions.get(input.sessionId);
    // Closed sessions have no `Session.log`; create an ad-hoc child bound to
    // their id so the entries still route to the session log file.
    const exportLog =
      active?.log ?? log.createChild({ sessionId: input.sessionId });
    if (active !== undefined) {
      try {
        await active.flushMetadata();
      } catch (error) {
        exportLog.warn('flushMetadata failed before export', { error });
      }
    }
    await warnIfLogFlushFails(exportLog, 'export session log flush failed', () =>
      getRootLogger().flushSession(input.sessionId),
    );
    if (input.includeGlobalLog === true) {
      await warnIfLogFlushFails(exportLog, 'export global log flush failed', () =>
        getRootLogger().flushGlobal(),
      );
    }
    const result = await exportSessionDirectory({
      request: input,
      summary,
      homeDir: this.homeDir,
      globalLogPath: getRootLogger().getConfig()?.globalLogPath,
    });
    return result;
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

  async removeKimiProvider(input: RemoveKimiProviderPayload): Promise<LioraConfig> {
    const config = this.readConfigForWrite();
    delete config.providers[input.providerId];

    let removedDefault = false;
    const existingModels = config.models ?? {};
    for (const [key, model] of Object.entries(existingModels)) {
      if (
        typeof model === 'object' &&
        model !== null &&
        !Array.isArray(model) &&
        model['provider'] === input.providerId
      ) {
        delete existingModels[key];
        if (config.defaultModel === key) removedDefault = true;
      }
    }
    config.models = existingModels;

    if (removedDefault) {
      config.defaultModel = undefined;
    }

    if (config.defaultProvider === input.providerId) {
      config.defaultProvider = undefined;
    }

    await writeConfigFile(this.configPath, config);
    return this.reloadRuntimeConfig();
  }

  prompt({ sessionId, ...payload }: SessionAgentPayload<PromptPayload>) {
    return this.sessionApi(sessionId).prompt(payload);
  }

  runShellCommand({ sessionId, ...payload }: SessionAgentPayload<RunShellCommandPayload>) {
    return this.sessionApi(sessionId).runShellCommand(payload);
  }

  cancelShellCommand({ sessionId, ...payload }: SessionAgentPayload<CancelShellCommandPayload>) {
    return this.sessionApi(sessionId).cancelShellCommand(payload);
  }

  steer({ sessionId, ...payload }: SessionAgentPayload<SteerPayload>) {
    return this.sessionApi(sessionId).steer(payload);
  }

  cancel({ sessionId, ...payload }: SessionAgentPayload<CancelPayload>) {
    return this.sessionApi(sessionId).cancel(payload);
  }

  undoHistory({ sessionId, ...payload }: SessionAgentPayload<UndoHistoryPayload>) {
    return this.sessionApi(sessionId).undoHistory(payload);
  }

  async setModel({
    sessionId,
    ...payload
  }: SessionAgentPayload<SetModelPayload>): Promise<SetModelResult> {
    this.reloadProviderManager();
    return this.sessionApi(sessionId).setModel(payload);
  }

  setThinking({ sessionId, ...payload }: SessionAgentPayload<SetThinkingPayload>) {
    return this.sessionApi(sessionId).setThinking(payload);
  }

  setPermission({ sessionId, ...payload }: SessionAgentPayload<SetPermissionPayload>) {
    return this.sessionApi(sessionId).setPermission(payload);
  }

  getModel({ sessionId, ...payload }: SessionAgentPayload<EmptyPayload>) {
    return this.sessionApi(sessionId).getModel(payload);
  }

  enterPlan({ sessionId, ...payload }: SessionAgentPayload<EnterPlanPayload>) {
    return this.sessionApi(sessionId).enterPlan(payload);
  }

  cancelPlan({ sessionId, ...payload }: SessionAgentPayload<CancelPlanPayload>) {
    return this.sessionApi(sessionId).cancelPlan(payload);
  }

  clearPlan({ sessionId, ...payload }: SessionAgentPayload<EmptyPayload>) {
    return this.sessionApi(sessionId).clearPlan(payload);
  }

  enterSwarm({ sessionId, ...payload }: SessionAgentPayload<EnterSwarmPayload>) {
    return this.sessionApi(sessionId).enterSwarm(payload);
  }

  exitSwarm({ sessionId, ...payload }: SessionAgentPayload<EmptyPayload>) {
    return this.sessionApi(sessionId).exitSwarm(payload);
  }

  getSwarmMode({ sessionId, ...payload }: SessionAgentPayload<EmptyPayload>) {
    return this.sessionApi(sessionId).getSwarmMode(payload);
  }

  setPremiumQuality({ sessionId, ...payload }: SessionAgentPayload<SetPremiumQualityPayload>) {
    return this.sessionApi(sessionId).setPremiumQuality(payload);
  }

  getPremiumQuality({ sessionId, ...payload }: SessionAgentPayload<EmptyPayload>) {
    return this.sessionApi(sessionId).getPremiumQuality(payload);
  }

  beginCompaction({ sessionId, ...payload }: SessionAgentPayload<BeginCompactionPayload>) {
    return this.sessionApi(sessionId).beginCompaction(payload);
  }

  cancelCompaction({ sessionId, ...payload }: SessionAgentPayload<EmptyPayload>) {
    return this.sessionApi(sessionId).cancelCompaction(payload);
  }

  registerTool({ sessionId, ...payload }: SessionAgentPayload<RegisterToolPayload>) {
    return this.sessionApi(sessionId).registerTool(payload);
  }

  unregisterTool({ sessionId, ...payload }: SessionAgentPayload<UnregisterToolPayload>) {
    return this.sessionApi(sessionId).unregisterTool(payload);
  }

  setActiveTools({ sessionId, ...payload }: SessionAgentPayload<SetActiveToolsPayload>) {
    return this.sessionApi(sessionId).setActiveTools(payload);
  }

  stopBackground({ sessionId, ...payload }: SessionAgentPayload<StopBackgroundPayload>) {
    return this.sessionApi(sessionId).stopBackground(payload);
  }

  detachBackground({ sessionId, ...payload }: SessionAgentPayload<DetachBackgroundPayload>) {
    return this.sessionApi(sessionId).detachBackground(payload);
  }

  clearContext({ sessionId, ...payload }: SessionAgentPayload<EmptyPayload>) {
    return this.sessionApi(sessionId).clearContext(payload);
  }

  activateSkill({
    sessionId,
    ...payload
  }: SessionAgentPayload<ActivateSkillPayload>): Promise<void> {
    return this.sessionApi(sessionId).activateSkill(payload);
  }

  activatePluginCommand({
    sessionId,
    ...payload
  }: SessionAgentPayload<ActivatePluginCommandPayload>): Promise<void> {
    return this.sessionApi(sessionId).activatePluginCommand(payload);
  }

  getBackgroundOutput({ sessionId, ...payload }: SessionAgentPayload<GetBackgroundOutputPayload>) {
    return this.sessionApi(sessionId).getBackgroundOutput(payload);
  }

  getContext({ sessionId, ...payload }: SessionAgentPayload<EmptyPayload>) {
    return this.sessionApi(sessionId).getContext(payload);
  }

  getContextComposition({ sessionId, ...payload }: SessionAgentPayload<EmptyPayload>) {
    return this.sessionApi(sessionId).getContextComposition(payload);
  }

  diagnoseContextOS({
    sessionId,
    ...payload
  }: SessionAgentPayload<DiagnoseContextOSPayload>) {
    return this.sessionApi(sessionId).diagnoseContextOS(payload);
  }

  getSessionTrace({ sessionId, ...payload }: SessionAgentPayload<EmptyPayload>) {
    return this.sessionApi(sessionId).getSessionTrace(payload);
  }

  getConfig({ sessionId, ...payload }: SessionAgentPayload<EmptyPayload>) {
    return this.sessionApi(sessionId).getConfig(payload);
  }

  getPermission({ sessionId, ...payload }: SessionAgentPayload<EmptyPayload>) {
    return this.sessionApi(sessionId).getPermission(payload);
  }

  getPlan({ sessionId, ...payload }: SessionAgentPayload<EmptyPayload>) {
    return this.sessionApi(sessionId).getPlan(payload);
  }

  getUsage({ sessionId, ...payload }: SessionAgentPayload<EmptyPayload>) {
    return this.sessionApi(sessionId).getUsage(payload);
  }

  getProviderRouteStatus({ sessionId, ...payload }: SessionAgentPayload<EmptyPayload>) {
    return this.sessionApi(sessionId).getProviderRouteStatus(payload);
  }

  resetProviderRouteStatus({ sessionId, ...payload }: SessionAgentPayload<EmptyPayload>) {
    return this.sessionApi(sessionId).resetProviderRouteStatus(payload);
  }

  getTools({ sessionId, ...payload }: SessionAgentPayload<EmptyPayload>) {
    return this.sessionApi(sessionId).getTools(payload);
  }

  getBackground({ sessionId, ...payload }: SessionAgentPayload<GetBackgroundPayload>) {
    return this.sessionApi(sessionId).getBackground(payload);
  }

  updateSessionMetadata({ sessionId, ...payload }: UpdateSessionMetadataRequest): Promise<void> {
    return this.sessionApi(sessionId).updateSessionMetadata(payload);
  }

  getSessionMetadata({ sessionId, ...payload }: SessionScopedPayload<EmptyPayload>): SessionMeta {
    return this.sessionApi(sessionId).getSessionMetadata(payload);
  }

  listSkills({
    sessionId,
    ...payload
  }: SessionScopedPayload<EmptyPayload>): Promise<readonly SkillSummary[]> {
    return this.sessionApi(sessionId).listSkills(payload);
  }

  listPluginCommands({
    sessionId,
    ...payload
  }: SessionScopedPayload<EmptyPayload>): readonly PluginCommandDef[] {
    return this.sessionApi(sessionId).listPluginCommands(payload);
  }

  searchSkills({
    sessionId,
    ...payload
  }: SessionScopedPayload<SearchSkillsPayload>): Promise<readonly SkillSearchResult[]> {
    return this.sessionApi(sessionId).searchSkills(payload);
  }

  listMcpServers({
    sessionId,
    ...payload
  }: SessionScopedPayload<EmptyPayload>): readonly McpServerInfo[] {
    return this.sessionApi(sessionId).listMcpServers(payload);
  }

  getMcpStartupMetrics({
    sessionId,
    ...payload
  }: SessionScopedPayload<EmptyPayload>): Promise<McpStartupMetrics> {
    return this.sessionApi(sessionId).getMcpStartupMetrics(payload);
  }

  reconnectMcpServer({
    sessionId,
    ...payload
  }: SessionScopedPayload<ReconnectMcpServerPayload>): Promise<void> {
    return this.sessionApi(sessionId).reconnectMcpServer(payload);
  }

  generateAgentsMd({ sessionId, ...payload }: SessionScopedPayload<EmptyPayload>): Promise<void> {
    return this.sessionApi(sessionId).generateAgentsMd(payload);
  }

  getSessionWarnings({ sessionId, ...payload }: SessionScopedPayload<EmptyPayload>): Promise<readonly SessionWarning[]> {
    return this.sessionApi(sessionId).getSessionWarnings(payload);
  }

  addAdditionalDir({
    sessionId,
    ...payload
  }: SessionScopedPayload<AddAdditionalDirPayload>): Promise<AddAdditionalDirResult> {
    return this.requireSession(sessionId).addAdditionalDir(payload.path, payload.persist);
  }

  startBtw({ sessionId, ...payload }: SessionAgentPayload<EmptyPayload>): Promise<string> {
    return this.sessionApi(sessionId).startBtw(payload);
  }

  createGoal({
    sessionId,
    ...payload
  }: SessionAgentPayload<CreateGoalPayload>): Promise<GoalSnapshot> {
    return Promise.resolve(this.sessionApi(sessionId).createGoal(payload));
  }

  getGoal({ sessionId, ...payload }: SessionAgentPayload<EmptyPayload>): Promise<GoalToolResult> {
    return Promise.resolve(this.sessionApi(sessionId).getGoal(payload));
  }

  pauseGoal({
    sessionId,
    ...payload
  }: SessionAgentPayload<EmptyPayload>): Promise<GoalSnapshot> {
    return Promise.resolve(this.sessionApi(sessionId).pauseGoal(payload));
  }

  resumeGoal({
    sessionId,
    ...payload
  }: SessionAgentPayload<EmptyPayload>): Promise<GoalSnapshot> {
    return Promise.resolve(this.sessionApi(sessionId).resumeGoal(payload));
  }

  cancelGoal({
    sessionId,
    ...payload
  }: SessionAgentPayload<EmptyPayload>): Promise<GoalSnapshot> {
    return Promise.resolve(this.sessionApi(sessionId).cancelGoal(payload));
  }

  createUltraworkRun({
    sessionId,
    ...payload
  }: SessionAgentPayload<CreateUltraworkRunPayload>): Promise<UltraworkRunSnapshot> {
    return Promise.resolve(this.sessionApi(sessionId).createUltraworkRun(payload));
  }

  getUltraworkRun({
    sessionId,
    ...payload
  }: SessionAgentPayload<EmptyPayload>): Promise<UltraworkRunSnapshot | null> {
    return Promise.resolve(this.sessionApi(sessionId).getUltraworkRun(payload));
  }

  pauseUltrawork({
    sessionId,
    ...payload
  }: SessionAgentPayload<PauseUltraworkPayload>): Promise<UltraworkRunSnapshot | null> {
    return Promise.resolve(this.sessionApi(sessionId).pauseUltrawork(payload));
  }

  resumeUltrawork({
    sessionId,
    ...payload
  }: SessionAgentPayload<EmptyPayload>): Promise<ResumeUltraworkPayloadResult | null> {
    return Promise.resolve(this.sessionApi(sessionId).resumeUltrawork(payload));
  }

  cancelUltrawork({
    sessionId,
    ...payload
  }: SessionAgentPayload<CancelUltraworkPayload>): Promise<UltraworkRunSnapshot | null> {
    return Promise.resolve(this.sessionApi(sessionId).cancelUltrawork(payload));
  }
  async classifyUltraworkAutoActivation({
    sessionId,
    ...payload
  }: SessionAgentPayload<ClassifyUltraworkAutoActivationPayload>): Promise<UltraworkAutoActivationDecision> {
    return this.sessionApi(sessionId).classifyUltraworkAutoActivation(payload);
  }
  async classifyUltraworkObjectiveProfile({
    sessionId,
    ...payload
  }: SessionAgentPayload<ClassifyUltraworkObjectiveProfilePayload>): Promise<UltraworkObjectiveProfileDecision> {
    return this.sessionApi(sessionId).classifyUltraworkObjectiveProfile(payload);
  }

  async installPlugin(payload: InstallPluginPayload): Promise<PluginSummary> {
    await this.pluginsReady;
    this.assertPluginsLoaded();
    const record = await this.plugins.install(payload.source);
    return this.plugins.summaries().find((s) => s.id === record.id)!;
  }

  async listPlugins(_: EmptyPayload): Promise<readonly PluginSummary[]> {
    await this.pluginsReady;
    this.assertPluginsLoaded();
    return this.plugins.summaries();
  }

  async setPluginEnabled({ id, enabled }: SetPluginEnabledPayload): Promise<void> {
    await this.pluginsReady;
    this.assertPluginsLoaded();
    await this.plugins.setEnabled(id, enabled);
  }

  async setPluginMcpServerEnabled({
    id,
    server,
    enabled,
  }: SetPluginMcpServerEnabledPayload): Promise<void> {
    await this.pluginsReady;
    this.assertPluginsLoaded();
    await this.plugins.setMcpServerEnabled(id, server, enabled);
  }

  async removePlugin({ id }: RemovePluginPayload): Promise<void> {
    await this.pluginsReady;
    this.assertPluginsLoaded();
    await this.plugins.remove(id);
  }

  async reloadPlugins(_: EmptyPayload): Promise<ReloadPluginsResult> {
    try {
      const summary = await this.plugins.reload();
      this.pluginsLoadError = undefined;
      return summary;
    } catch (error) {
      this.pluginsLoadError = error instanceof Error ? error : new Error(String(error));
      throw new LioraError(
        ErrorCodes.PLUGIN_LOAD_FAILED,
        `Failed to reload plugins: ${this.pluginsLoadError.message}`,
        { cause: error, details: { kimiHomeDir: this.homeDir } },
      );
    }
  }

  async getPluginInfo({ id }: GetPluginInfoPayload): Promise<PluginInfo> {
    await this.pluginsReady;
    this.assertPluginsLoaded();
    const info = this.plugins.info(id);
    if (info === undefined) {
      throw new LioraError(
        ErrorCodes.PLUGIN_NOT_FOUND,
        `Plugin "${id}" is not installed`,
        { details: { id } },
      );
    }
    return info;
  }

  private assertPluginsLoaded(): void {
    if (this.pluginsLoadError === undefined) return;
    throw new LioraError(
      ErrorCodes.PLUGIN_LOAD_FAILED,
      `Plugin state failed to load: ${this.pluginsLoadError.message}. ` +
        `Fix the file at ${this.homeDir}/plugins/installed.json and run /plugins reload.`,
      { cause: this.pluginsLoadError, details: { kimiHomeDir: this.homeDir } },
    );
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

  private async buildSessionToolServices(
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

  private getKaos(): Promise<Kaos> {
    this.kaos ??= LocalKaos.create().catch((error: unknown) => {
      if (error instanceof KaosShellNotFoundError) {
        throw new LioraError(ErrorCodes.SHELL_GIT_BASH_NOT_FOUND, error.message);
      }
      throw error;
    });
    return this.kaos;
  }

  private resolveSessionSkillConfig(config: LioraConfig): SessionSkillConfig {
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

  private resolveProviderManager(sessionId: string): ProviderManager {
    return new ProviderManager({
      config: () => this.config,
      kimiRequestHeaders: this.kimiRequestHeaders,
      resolveOAuthTokenProvider: this.resolveOAuthTokenProvider,
      promptCacheKey: sessionId,
    });
  }

  private mergePluginMcpConfig(base: SessionMcpConfig | undefined): SessionMcpConfig | undefined {
    const pluginServers = this.withManagedKimiPluginEnv(this.plugins.enabledMcpServers());
    if (Object.keys(pluginServers).length === 0) return base;
    return {
      servers: {
        ...base?.servers,
        ...pluginServers,
      },
    };
  }

  private withManagedKimiPluginEnv(
    pluginServers: Record<string, McpServerConfig>,
  ): Record<string, McpServerConfig> {
    const managedEnv = this.managedKimiCodeEnvForPlugins();
    if (Object.keys(managedEnv).length === 0) return pluginServers;

    const out: Record<string, McpServerConfig> = {};
    for (const [name, server] of Object.entries(pluginServers)) {
      out[name] =
        server.transport === 'stdio'
          ? { ...server, env: { ...server.env, ...managedEnv } }
          : server;
    }
    return out;
  }

  private managedKimiCodeEnvForPlugins(): Record<string, string> {
    const provider = this.config.providers[SUPERLIORA_PROVIDER_NAME];
    const envBaseUrl = process.env[SUPERLIORA_BASE_URL_ENV];
    const envOAuthHost = process.env[SUPERLIORA_OAUTH_HOST_ENV] ?? process.env[KIMI_OAUTH_HOST_ENV];
    const hasEnvOverride = envBaseUrl !== undefined || envOAuthHost !== undefined;
    const baseUrl =
      envBaseUrl !== undefined ? envBaseUrl.replace(/\/+$/, '') : provider?.baseUrl;
    const oauthHost = hasEnvOverride ? envOAuthHost : provider?.oauth?.oauthHost;
    const env: Record<string, string> = {};
    if (baseUrl !== undefined) env[SUPERLIORA_BASE_URL_ENV] = baseUrl;
    if (oauthHost !== undefined) env[SUPERLIORA_OAUTH_HOST_ENV] = oauthHost;
    return env;
  }

  private requireSession(sessionId: string): Session {
    const session = this.sessions.get(sessionId);
    if (session === undefined) {
      throw new LioraError(ErrorCodes.SESSION_NOT_FOUND, `Session "${sessionId}" was not found`, {
        details: { sessionId },
      });
    }
    return session;
  }

  private sessionApi(sessionId: string): SessionAPIImpl {
    return new SessionAPIImpl(this.requireSession(sessionId));
  }

  private reloadProviderManager(): LioraConfig {
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

  private clearRuntimeCache(): void {
    if (this.runtimeOverride !== undefined) return;
    this.runtime = undefined;
  }

  private async refreshSessionRuntimeConfig(
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

async function createRuntimeConfig(input: {
  readonly config: LioraConfig;
  readonly homeDir?: string | undefined;
  readonly kimiRequestHeaders?: Record<string, string> | undefined;
  readonly resolveOAuthTokenProvider?: OAuthTokenProviderResolver | undefined;
}): Promise<ToolServices> {
  const localFetcher = new LocalFetchURLProvider();
  const localSearch = input.config.research?.localSearch;
  const localOptions = {
    urlFetcher: localFetcher,
    concurrency: localSearch?.concurrency,
    timeoutMs: localSearch?.timeoutMs,
    searxngUrl: localSearch?.searxngUrl,
    yacyUrl: localSearch?.yacyUrl,
    directSources: localSearch?.directSources,
    offlineMode: localSearch?.offlineMode,
    cachePath:
      input.homeDir === undefined
        ? undefined
        : join(input.homeDir, 'research', 'local-search.sqlite'),
  };
  const localSearcher =
    localSearch?.enabled === false ? undefined : new LocalWebSearchProvider(localOptions);
  const searchService = input.config.services?.moonshotSearch;
  const fetchService = input.config.services?.moonshotFetch;
  const moonshotCreds =
    searchService === undefined
      ? undefined
      : serviceCredentials(searchService, input.resolveOAuthTokenProvider);
  const researchSearcher =
    localSearch?.enabled === false
      ? undefined
      : new ResearchSearchEngine({
          search: input.config.research?.search,
          local: localOptions,
          urlFetcher: localFetcher,
          moonshot:
            searchService?.baseUrl === undefined
              ? undefined
              : {
                  baseUrl: searchService.baseUrl,
                  apiKey: moonshotCreds?.apiKey,
                  defaultHeaders: input.kimiRequestHeaders,
                  tokenProvider: moonshotCreds?.tokenProvider,
                },
        });

  return {
    urlFetcher:
      fetchService?.baseUrl === undefined
        ? localFetcher
        : new MoonshotFetchURLProvider({
            baseUrl: fetchService.baseUrl,
            localFallback: localFetcher,
            defaultHeaders: input.kimiRequestHeaders,
            ...serviceCredentials(fetchService, input.resolveOAuthTokenProvider),
          }),
    webSearcher: researchSearcher ?? localSearcher,
    browserUse:
      input.config.browserUse?.enabled === false
        ? undefined
        : createBrowserUseRuntime({
            provider: input.config.browserUse?.provider,
            fallbackProvider: input.config.browserUse?.fallbackProvider,
            fallbackEnabled: input.config.browserUse?.fallbackEnabled,
            autoInstall: input.config.browserUse?.autoInstall,
            autoUpdate: input.config.browserUse?.autoUpdate,
            cacheDir: input.config.browserUse?.cacheDir,
            binaryPath: input.config.browserUse?.binaryPath,
            version: input.config.browserUse?.version,
            licenseKeyEnv: input.config.browserUse?.licenseKeyEnv,
            host: input.config.browserUse?.host,
            port: input.config.browserUse?.port,
            obeyRobots: input.config.browserUse?.obeyRobots,
            disableHostVerification: input.config.browserUse?.disableHostVerification,
          }),
    computerUse:
      input.config.computerUse?.enabled === false
        ? undefined
        : new CuaComputerRuntime({
            autoInstall: input.config.computerUse?.autoInstall,
            driverCmd: input.config.computerUse?.driverCmd,
          }),
  };
}

function hasStatefulGuiRuntime(config: LioraConfig): boolean {
  return config.browserUse?.enabled !== false || config.computerUse?.enabled !== false;
}

function serviceCredentials(
  service: MoonshotServiceConfig,
  resolveOAuthTokenProvider: OAuthTokenProviderResolver | undefined,
): {
  readonly apiKey?: string | undefined;
  readonly tokenProvider?: BearerTokenProvider | undefined;
  readonly customHeaders?: Record<string, string> | undefined;
} {
  const apiKey = nonEmptyString(service.apiKey);
  return {
    apiKey,
    tokenProvider:
      service.oauth !== undefined
        ? resolveOAuthTokenProvider?.(SUPERLIORA_PROVIDER_NAME, service.oauth)
        : undefined,
    customHeaders: service.customHeaders,
  };
}

function nonEmptyString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

function requiredWorkDir(operation: string, value: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new LioraError(ErrorCodes.REQUEST_WORK_DIR_REQUIRED, `${operation} requires workDir`);
  }
  return normalizeWorkDir(value);
}

function createSessionId(): string {
  return `session_${randomUUID()}`;
}

function withAdditionalDirs<T>(
  result: T,
  session: Session,
): T & { readonly additionalDirs: readonly string[] } {
  return {
    ...result,
    additionalDirs: session.getAdditionalDirs(),
  };
}

function telemetryErrorReason(error: unknown): string {
  if (error instanceof LioraError) return error.code;
  if (error instanceof Error && error.name.length > 0) return error.name;
  return typeof error;
}

function clientTelemetryProperties(client: ClientTelemetryInfo | undefined): TelemetryProperties {
  if (client === undefined) return {};
  return {
    client_id: client.id ?? null,
    client_name: client.name ?? null,
    client_version: client.version ?? null,
    ui_mode: client.uiMode ?? null,
  };
}

async function resumeSessionResult(
  summary: SessionSummary,
  session: Session,
  warning?: string,
): Promise<ResumeSessionResult> {
  const api = new SessionAPIImpl(session);
  const agents: Record<string, ResumedAgentState> = {};
  for (const [agentId, entry] of session.agents) {
    if (!(entry instanceof Agent)) continue;
    const agent = entry;
    const config = await api.getConfig({ agentId });
    const context = await api.getContext({ agentId });
    const permission = await api.getPermission({ agentId });
    const plan = await api.getPlan({ agentId });
    const swarmMode = await api.getSwarmMode({ agentId });
    const usage = await api.getUsage({ agentId });
    agents[agentId] = {
      type: agent.type,
      config,
      context,
      replay: agent.replayBuilder.buildResult(),
      permission,
      plan,
      swarmMode,
      usage,
      tools: await api.getTools({ agentId }),
      toolStore: agent.tools.storeData(),
      background: agent.background.list(false),
      ultrawork: {
        modeEnabled: agent.ultrawork.isModeEnabled(),
        run: agent.ultrawork.getRun(),
      },
    };
  }
  return withAdditionalDirs(
    {
      ...summary,
      sessionMetadata: api.getSessionMetadata({}),
      agents,
      warning,
    },
    session,
  );
}

async function warnIfLogFlushFails(
  exportLog: Logger,
  message: string,
  flush: () => Promise<boolean>,
): Promise<void> {
  try {
    if (await flush()) return;
    exportLog.warn(message);
  } catch (error) {
    exportLog.warn(message, { error });
  }
  try {
    await flush();
  } catch {}
}
