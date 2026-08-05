import { log } from '#/logging/logger';
import { PluginHost, PluginManager } from '#/plugin/index';
import type { OAuthRefreshOutcome } from '@superliora/oauth';
import type { RuntimeDegradedEvent } from '@superliora/protocol';

import type { PromisableMethods } from '#/utils/types';
import { getCoreVersion } from '#/version';

import {
  ensureLioraHome,
  loadRuntimeConfigSafe,
  resolveConfigPath,
  resolveLioraHome,
  type LioraConfig,
} from '../config';
import {
  FLAG_DEFINITIONS,
  FlagResolver,
  type ExperimentalFeatureState,
} from '../flags';
import { LioraRecallStore } from '../memory';
import { Session } from '../session';
import type { OAuthTokenProviderResolver } from '../session/provider/provider-manager';
import { SessionStore } from '../session/store/index';
import {
  noopTelemetryClient,
  type TelemetryClient,
} from '../telemetry';
import type { CoreRPCClient } from './client';
import type { CoreAPI, CoreInfo } from './core-api';
import type { SDKRPC } from './sdk-api';
import type { Kaos } from '@superliora/kaos';
import type { SessionMcpConfig } from '../mcp';
import type { ToolServices } from '../tools/support/services';
import * as configMethods from './core-config-methods';
import { delegateContextMethod, delegateContextMethodWithOptions } from './core-delegate';
import type { LioraCoreOptions } from './core-impl-types';
import * as memoryMethods from './core-memory-methods';
import * as runtimeSupport from './core-runtime-support';
import * as pluginMethods from './plugin-methods';
import * as pluginWiring from './core-plugin-wiring';
import * as sessionLifecycle from './session-lifecycle';
import * as sessionAgentMethods from './session-agent-methods';
import { buildOAuthRefreshDegradedEventFromOutcome } from '../runtime/oauth-refresh-degraded';

export type { LioraCoreOptions, SessionAgentPayload } from './core-impl-types';

export class LioraCore implements PromisableMethods<CoreAPI> {
  readonly sdk: Promise<SDKRPC>;
  readonly homeDir: string;
  readonly configPath: string;
  readonly sessions = new Map<string, Session>();
  readonly telemetry: TelemetryClient;

  kaos: Promise<Kaos> | undefined;
  runtime: ToolServices | undefined;
  config: LioraConfig;
  configWarnings: readonly string[] = [];
  private readonly runtimeOverride: ToolServices | undefined;
  readonly userHomeDir: string;
  private readonly kimiRequestHeaders: Record<string, string> | undefined;
  private readonly resolveOAuthTokenProvider: OAuthTokenProviderResolver | undefined;
  readonly skillDirs: readonly string[];
  readonly sessionStore: SessionStore;
  readonly plugins: PluginManager;
  readonly pluginHost: PluginHost;
  pluginsReady: Promise<void>;
  pluginsLoadError: Error | undefined;
  private readonly pluginDirs: readonly string[];
  readonly channelServers: readonly string[];
  readonly projectDir: string;
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
    const runtimeDefaults = runtimeSupport.createCoreRuntimeSupportDefaults();
    this.homeDir = resolveLioraHome(options.homeDir);
    this.userHomeDir = runtimeDefaults.userHomeDir;
    this.configPath = resolveConfigPath({
      homeDir: this.homeDir,
      configPath: options.configPath,
    });
    this.runtimeOverride = options.runtime;
    this.runtime = options.runtime;
    this.kaos = runtimeDefaults.kaos;
    this.kimiRequestHeaders = options.kimiRequestHeaders;
    this.resolveOAuthTokenProvider = options.resolveOAuthTokenProvider;
    this.skillDirs = options.skillDirs ?? [];
    this.pluginDirs = options.pluginDirs ?? [];
    this.channelServers = options.channelServers ?? [];
    this.projectDir = options.projectDir ?? process.cwd();
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
    this.plugins = new PluginManager({
      kimiHomeDir: this.homeDir,
      projectDir: this.projectDir,
      sessionPluginDirs: this.pluginDirs,
      resolveMarketplaceSource: options.resolveMarketplaceSource,
    });
    this.pluginHost = new PluginHost(this.plugins);
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

  createSession = delegateContextMethod(sessionLifecycle.createSession);
  createSessionWithOverrides = delegateContextMethod(sessionLifecycle.createSessionWithOverrides);
  closeSession = delegateContextMethod(sessionLifecycle.closeSession);
  archiveSession = delegateContextMethod(sessionLifecycle.archiveSession);
  resumeSession = delegateContextMethod(sessionLifecycle.resumeSession);
  resumeSessionWithOverrides = delegateContextMethod(sessionLifecycle.resumeSessionWithOverrides);
  reloadSession = delegateContextMethod(sessionLifecycle.reloadSession);
  forkSession = delegateContextMethod(sessionLifecycle.forkSession);
  listSessions = delegateContextMethod(sessionLifecycle.listSessions);
  renameSession = delegateContextMethod(sessionLifecycle.renameSession);
  exportSession = delegateContextMethod(sessionLifecycle.exportSession);

  getCoreInfo(): CoreInfo {
    return { version: getCoreVersion() };
  }

  getExperimentalFeatures(): readonly ExperimentalFeatureState[] {
    return this.experimentalFlags.explainAll();
  }

  memorySearch = delegateContextMethod(memoryMethods.memorySearch);
  memoryList = delegateContextMethod(memoryMethods.memoryList);
  memoryGet = delegateContextMethod(memoryMethods.memoryGet);
  memoryCreate = delegateContextMethod(memoryMethods.memoryCreate);
  memoryUpdate = delegateContextMethod(memoryMethods.memoryUpdate);
  memoryForget = delegateContextMethod(memoryMethods.memoryForget);
  memoryStats = delegateContextMethod(memoryMethods.memoryStats);
  memoryExport = delegateContextMethod(memoryMethods.memoryExport);
  memoryImport = delegateContextMethod(memoryMethods.memoryImport);
  memoryConsolidate = delegateContextMethod(memoryMethods.memoryConsolidate);

  emergencyFlushSync(): void {
    for (const session of this.sessions.values()) {
      try {
        session.emergencyFlushSync();
      } catch {
        // Best-effort — never let one session's failure skip the rest.
      }
    }
  }

  /** Broadcast volatile runtime.degraded to ready main agents (Never-Halt hosts). */
  broadcastRuntimeDegraded(event: RuntimeDegradedEvent): void {
    for (const session of this.sessions.values()) {
      const main = session.getReadyAgent('main');
      main?.emitOAuthRefreshDegraded(event);
    }
  }

  /** Broadcast oauth-scoped runtime.degraded to ready main agents (LLM-path refresh). */
  broadcastOAuthRefreshDegraded(
    outcome: Extract<OAuthRefreshOutcome, { success: false }>,
  ): void {
    this.broadcastRuntimeDegraded(buildOAuthRefreshDegradedEventFromOutcome(outcome));
  }

  getKimiConfig = delegateContextMethod(configMethods.getKimiConfig);
  getConfigDiagnostics = delegateContextMethod(configMethods.getConfigDiagnostics);
  setKimiConfig = delegateContextMethod(configMethods.setKimiConfig);
  deleteConfigFields = delegateContextMethod(configMethods.deleteConfigFields);
  removeKimiProvider = delegateContextMethod(configMethods.removeKimiProvider);

  prompt = delegateContextMethod(sessionAgentMethods.prompt);
  runShellCommand = delegateContextMethod(sessionAgentMethods.runShellCommand);
  cancelShellCommand = delegateContextMethod(sessionAgentMethods.cancelShellCommand);
  steer = delegateContextMethod(sessionAgentMethods.steer);
  cancel = delegateContextMethod(sessionAgentMethods.cancel);
  undoHistory = delegateContextMethod(sessionAgentMethods.undoHistory);
  setModel = delegateContextMethod(sessionAgentMethods.setModel);
  setThinking = delegateContextMethod(sessionAgentMethods.setThinking);
  setPermission = delegateContextMethod(sessionAgentMethods.setPermission);
  getModel = delegateContextMethod(sessionAgentMethods.getModel);
  enterPlan = delegateContextMethod(sessionAgentMethods.enterPlan);
  cancelPlan = delegateContextMethod(sessionAgentMethods.cancelPlan);
  clearPlan = delegateContextMethod(sessionAgentMethods.clearPlan);
  enterSwarm = delegateContextMethod(sessionAgentMethods.enterSwarm);
  exitSwarm = delegateContextMethod(sessionAgentMethods.exitSwarm);
  getSwarmMode = delegateContextMethod(sessionAgentMethods.getSwarmMode);
  setPremiumQuality = delegateContextMethod(sessionAgentMethods.setPremiumQuality);
  getPremiumQuality = delegateContextMethod(sessionAgentMethods.getPremiumQuality);
  beginCompaction = delegateContextMethod(sessionAgentMethods.beginCompaction);
  cancelCompaction = delegateContextMethod(sessionAgentMethods.cancelCompaction);
  registerTool = delegateContextMethod(sessionAgentMethods.registerTool);
  unregisterTool = delegateContextMethod(sessionAgentMethods.unregisterTool);
  setActiveTools = delegateContextMethod(sessionAgentMethods.setActiveTools);
  stopBackground = delegateContextMethod(sessionAgentMethods.stopBackground);
  detachBackground = delegateContextMethod(sessionAgentMethods.detachBackground);
  clearContext = delegateContextMethod(sessionAgentMethods.clearContext);
  activateSkill = delegateContextMethod(sessionAgentMethods.activateSkill);
  activatePluginCommand = delegateContextMethod(sessionAgentMethods.activatePluginCommand);
  getBackgroundOutput = delegateContextMethod(sessionAgentMethods.getBackgroundOutput);
  getContext = delegateContextMethod(sessionAgentMethods.getContext);
  getContextComposition = delegateContextMethod(sessionAgentMethods.getContextComposition);
  diagnoseContextOS = delegateContextMethod(sessionAgentMethods.diagnoseContextOS);
  getSessionTrace = delegateContextMethod(sessionAgentMethods.getSessionTrace);
  getConfig = delegateContextMethod(sessionAgentMethods.getConfig);
  getPermission = delegateContextMethod(sessionAgentMethods.getPermission);
  getCircuitBreakers = delegateContextMethod(sessionAgentMethods.getCircuitBreakers);
  getCacheFrozen = delegateContextMethod(sessionAgentMethods.getCacheFrozen);
  getCacheFreezeViolations = delegateContextMethod(sessionAgentMethods.getCacheFreezeViolations);
  getParallelToolsStatus = delegateContextMethod(sessionAgentMethods.getParallelToolsStatus);
  getOAuthStatus = delegateContextMethod(sessionAgentMethods.getOAuthStatus);
  getPlan = delegateContextMethod(sessionAgentMethods.getPlan);
  getUsage = delegateContextMethod(sessionAgentMethods.getUsage);
  getProviderRouteStatus = delegateContextMethod(sessionAgentMethods.getProviderRouteStatus);
  getProviderExtrasStatus = delegateContextMethod(sessionAgentMethods.getProviderExtrasStatus);
  resetProviderRouteStatus = delegateContextMethod(sessionAgentMethods.resetProviderRouteStatus);
  getTools = delegateContextMethod(sessionAgentMethods.getTools);
  getBackground = delegateContextMethod(sessionAgentMethods.getBackground);
  inlineComplete = delegateContextMethodWithOptions(sessionAgentMethods.inlineComplete);
  suggestPrompts = delegateContextMethodWithOptions(sessionAgentMethods.suggestPrompts);
  updateSessionMetadata = delegateContextMethod(sessionAgentMethods.updateSessionMetadata);
  getSessionMetadata = delegateContextMethod(sessionAgentMethods.getSessionMetadata);
  listSkills = delegateContextMethod(sessionAgentMethods.listSkills);
  getHookRegistry = delegateContextMethod(sessionAgentMethods.getHookRegistry);
  listPluginCommands = delegateContextMethod(sessionAgentMethods.listPluginCommands);
  searchSkills = delegateContextMethod(sessionAgentMethods.searchSkills);
  listMcpServers = delegateContextMethod(sessionAgentMethods.listMcpServers);
  getMcpStartupMetrics = delegateContextMethod(sessionAgentMethods.getMcpStartupMetrics);
  reconnectMcpServer = delegateContextMethod(sessionAgentMethods.reconnectMcpServer);
  generateAgentsMd = delegateContextMethod(sessionAgentMethods.generateAgentsMd);
  getSessionWarnings = delegateContextMethod(sessionAgentMethods.getSessionWarnings);
  addAdditionalDir = delegateContextMethod(sessionAgentMethods.addAdditionalDir);
  rewindFiles = delegateContextMethod(sessionAgentMethods.rewindFiles);
  startConversationLoop = delegateContextMethod(sessionAgentMethods.startConversationLoop);
  stopConversationLoop = delegateContextMethod(sessionAgentMethods.stopConversationLoop);
  listConversationLoops = delegateContextMethod(sessionAgentMethods.listConversationLoops);
  startBtw = delegateContextMethod(sessionAgentMethods.startBtw);
  createGoal = delegateContextMethod(sessionAgentMethods.createGoal);
  getGoal = delegateContextMethod(sessionAgentMethods.getGoal);
  pauseGoal = delegateContextMethod(sessionAgentMethods.pauseGoal);
  resumeGoal = delegateContextMethod(sessionAgentMethods.resumeGoal);
  cancelGoal = delegateContextMethod(sessionAgentMethods.cancelGoal);
  createUltraworkRun = delegateContextMethod(sessionAgentMethods.createUltraworkRun);
  getUltraworkRun = delegateContextMethod(sessionAgentMethods.getUltraworkRun);
  pauseUltrawork = delegateContextMethod(sessionAgentMethods.pauseUltrawork);
  swarmRestaff = delegateContextMethod(sessionAgentMethods.swarmRestaff);
  resumeUltrawork = delegateContextMethod(sessionAgentMethods.resumeUltrawork);
  cancelUltrawork = delegateContextMethod(sessionAgentMethods.cancelUltrawork);
  classifyUltraworkAutoActivation = delegateContextMethod(
    sessionAgentMethods.classifyUltraworkAutoActivation,
  );
  classifyUltraworkObjectiveProfile = delegateContextMethod(
    sessionAgentMethods.classifyUltraworkObjectiveProfile,
  );

  installPlugin = delegateContextMethod(pluginMethods.installPlugin);
  listPlugins = delegateContextMethod(pluginMethods.listPlugins);
  setPluginEnabled = delegateContextMethod(pluginMethods.setPluginEnabled);
  setPluginMcpServerEnabled = delegateContextMethod(pluginMethods.setPluginMcpServerEnabled);
  removePlugin = delegateContextMethod(pluginMethods.removePlugin);
  reloadPlugins = delegateContextMethod(pluginMethods.reloadPlugins);
  getPluginInfo = delegateContextMethod(pluginMethods.getPluginInfo);
  listPluginThemes = delegateContextMethod(pluginMethods.listPluginThemes);

  buildSessionToolServices = delegateContextMethod(runtimeSupport.buildSessionToolServices);
  getKaos = delegateContextMethod(runtimeSupport.getKaos);
  resolveSessionSkillConfig = delegateContextMethod(runtimeSupport.resolveSessionSkillConfig);
  resolveProviderManager = delegateContextMethod(runtimeSupport.resolveProviderManager);
  mergePluginMcpConfig(base: SessionMcpConfig | undefined): SessionMcpConfig | undefined {
    return pluginWiring.mergePluginMcpConfigWithHost(this.pluginWiringContext(), base);
  }
  requireSession = delegateContextMethod(runtimeSupport.requireSession);
  sessionApi = delegateContextMethod(runtimeSupport.sessionApi);
  clearRuntimeCache = delegateContextMethod(runtimeSupport.clearRuntimeCache);
  refreshSessionRuntimeConfig = delegateContextMethod(runtimeSupport.refreshSessionRuntimeConfig);

  reloadProviderManager(): LioraConfig {
    return configMethods.reloadRuntimeConfig(this);
  }

  private pluginWiringContext(): pluginWiring.CorePluginWiringContext {
    return {
      homeDir: this.homeDir,
      projectDir: this.projectDir,
      channelServers: this.channelServers,
      config: this.config,
      plugins: this.plugins,
      pluginHost: this.pluginHost,
    };
  }
}
