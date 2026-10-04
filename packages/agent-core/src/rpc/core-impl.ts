import { log } from '#/logging/logger';
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
import { Session } from '../session';
import type { OAuthTokenProviderResolver } from '../session/provider/provider-manager';
import { SessionStore } from '../session/store/index';
import {
  noopTelemetryClient,
  type TelemetryClient,
} from '../telemetry';
import type { CoreRPCClient } from './client';
import type {
  CoreAPI,
  CoreInfo,
} from './core-api';
import type { SDKRPC } from './sdk-api';
import type { Kaos } from '@superliora/kaos';
import * as configMethods from './core-config-methods';
import { delegateContextMethod } from './core-delegate';
import type { LioraCoreOptions } from './core-impl-types';
import * as runtimeSupport from './core-runtime-support';
import * as sessionLifecycle from './session-lifecycle';
import * as sessionAgentMethods from './session-agent-methods';
import { buildOAuthRefreshDegradedEventFromOutcome } from '../runtime/oauth-refresh-degraded';

export type { LioraCoreOptions, SessionAgentPayload } from './core-impl-types';

export class LioraCore implements PromisableMethods<CoreAPI> {
  readonly sdk: Promise<SDKRPC>;
  readonly homeDir: string;
  readonly configPath: string;
  readonly sessions = new Map<string, Session>();
  readonly sessionStore: SessionStore;
  readonly telemetry: TelemetryClient;

  kaos: Promise<Kaos> | undefined;
  config: LioraConfig;
  configWarnings: readonly string[] = [];
  readonly kimiRequestHeaders: Record<string, string> | undefined;
  readonly resolveOAuthTokenProvider: OAuthTokenProviderResolver | undefined;
  readonly appVersion: string | undefined;
  readonly resolveSessionCoordinator: LioraCoreOptions['resolveSessionCoordinator'];
  private readonly uncaughtListener:
    | ((error: Error, origin: NodeJS.UncaughtExceptionOrigin) => void)
    | undefined;
  private readonly inFlight = new Set<Promise<unknown>>();
  private closePromise: Promise<void> | undefined;
  isClosing = false;

  constructor(
    protected readonly rpcClient: CoreRPCClient,
    options: LioraCoreOptions = {},
  ) {
    this.homeDir = resolveLioraHome(options.homeDir);
    this.configPath = resolveConfigPath({
      homeDir: this.homeDir,
      configPath: options.configPath,
    });
    this.kimiRequestHeaders = options.kimiRequestHeaders;
    this.resolveOAuthTokenProvider = options.resolveOAuthTokenProvider;
    this.telemetry = options.telemetry ?? noopTelemetryClient;
    this.appVersion = options.appVersion;
    this.resolveSessionCoordinator = options.resolveSessionCoordinator;
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
    this.sessionStore = new SessionStore(this.homeDir);

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

  assertOpen(): void {
    if (this.isClosing) throw new Error('Core is closing.');
  }

  trackOperation<T>(result: T): T {
    if (result instanceof Promise) {
      this.inFlight.add(result);
      void result.then(() => this.inFlight.delete(result), () => this.inFlight.delete(result));
    }
    return result;
  }

  close(): Promise<void> {
    if (this.closePromise !== undefined) return this.closePromise;
    const completion = Promise.withResolvers<void>();
    this.closePromise = completion.promise;
    this.isClosing = true;
    const stopping = new Set(Array.from(this.sessions.values(), (session) => session.close()));
    void this.settleClose(stopping).then(completion.resolve, completion.reject);
    return this.closePromise;
  }

  private async settleClose(stopping: Set<Promise<void>>): Promise<void> {
    await Promise.allSettled(this.inFlight);
    for (const session of this.sessions.values()) stopping.add(session.close());
    const results = await Promise.allSettled(stopping);
    const errors = results.filter((result) => result.status === 'rejected').map((result) => result.reason);
    if (errors.length > 0) throw new AggregateError(errors, 'Core shutdown failed.');
    this.sessions.clear();
    if (this.uncaughtListener !== undefined) process.removeListener('uncaughtExceptionMonitor', this.uncaughtListener);
  }

  getCoreInfo(): CoreInfo {
    return { version: getCoreVersion() };
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

  /** Broadcast observed credential/provider failures to attached clients. */
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
  beginCompaction = delegateContextMethod(sessionAgentMethods.beginCompaction);
  cancelCompaction = delegateContextMethod(sessionAgentMethods.cancelCompaction);
  stopBackground = delegateContextMethod(sessionAgentMethods.stopBackground);
  detachBackground = delegateContextMethod(sessionAgentMethods.detachBackground);
  clearContext = delegateContextMethod(sessionAgentMethods.clearContext);
  getBackgroundOutput = delegateContextMethod(sessionAgentMethods.getBackgroundOutput);
  getContext = delegateContextMethod(sessionAgentMethods.getContext);
  getContextComposition = delegateContextMethod(sessionAgentMethods.getContextComposition);
  getSessionTrace = delegateContextMethod(sessionAgentMethods.getSessionTrace);
  getConfig = delegateContextMethod(sessionAgentMethods.getConfig);
  getPermission = delegateContextMethod(sessionAgentMethods.getPermission);
  getCircuitBreakers = delegateContextMethod(sessionAgentMethods.getCircuitBreakers);
  getCacheFrozen = delegateContextMethod(sessionAgentMethods.getCacheFrozen);
  getCacheFreezeViolations = delegateContextMethod(sessionAgentMethods.getCacheFreezeViolations);
  getParallelToolsStatus = delegateContextMethod(sessionAgentMethods.getParallelToolsStatus);
  getOAuthStatus = delegateContextMethod(sessionAgentMethods.getOAuthStatus);
  getUsage = delegateContextMethod(sessionAgentMethods.getUsage);
  getProviderRouteStatus = delegateContextMethod(sessionAgentMethods.getProviderRouteStatus);
  resetProviderRouteStatus = delegateContextMethod(sessionAgentMethods.resetProviderRouteStatus);
  getBackground = delegateContextMethod(sessionAgentMethods.getBackground);
  updateSessionMetadata = delegateContextMethod(sessionAgentMethods.updateSessionMetadata);
  getSessionMetadata = delegateContextMethod(sessionAgentMethods.getSessionMetadata);
  getSessionWarnings = delegateContextMethod(sessionAgentMethods.getSessionWarnings);
  addAdditionalDir = delegateContextMethod(sessionAgentMethods.addAdditionalDir);
  rewindFiles = delegateContextMethod(sessionAgentMethods.rewindFiles);
  startConversationLoop = delegateContextMethod(sessionAgentMethods.startConversationLoop);
  stopConversationLoop = delegateContextMethod(sessionAgentMethods.stopConversationLoop);
  listConversationLoops = delegateContextMethod(sessionAgentMethods.listConversationLoops);
  startBtw = delegateContextMethod(sessionAgentMethods.startBtw);
  jobList = delegateContextMethod(sessionAgentMethods.jobList);
  jobInspect = delegateContextMethod(sessionAgentMethods.jobInspect);
  jobInbox = delegateContextMethod(sessionAgentMethods.jobInbox);
  jobSteer = delegateContextMethod(sessionAgentMethods.jobSteer);
  jobCancel = delegateContextMethod(sessionAgentMethods.jobCancel);
  jobPause = delegateContextMethod(sessionAgentMethods.jobPause);
  jobResume = delegateContextMethod(sessionAgentMethods.jobResume);
  jobCreate = delegateContextMethod(sessionAgentMethods.jobCreate);
  jobCreateBatch = delegateContextMethod(sessionAgentMethods.jobCreateBatch);
  jobMerge = delegateContextMethod(sessionAgentMethods.jobMerge);
  jobPush = delegateContextMethod(sessionAgentMethods.jobPush);
  jobPreviewSplit = delegateContextMethod(sessionAgentMethods.jobPreviewSplit);
  jobGcWorktrees = delegateContextMethod(sessionAgentMethods.jobGcWorktrees);
  jobSetProjectMode = delegateContextMethod(sessionAgentMethods.jobSetProjectMode);
  jobWorkspaceCatalog = delegateContextMethod(sessionAgentMethods.jobWorkspaceCatalog);
  jobAdoptWorkspace = delegateContextMethod(sessionAgentMethods.jobAdoptWorkspace);
  jobArchiveWorkspace = delegateContextMethod(sessionAgentMethods.jobArchiveWorkspace);
  jobRenameWorkspace = delegateContextMethod(sessionAgentMethods.jobRenameWorkspace);
  jobLandChoice = delegateContextMethod(sessionAgentMethods.jobLandChoice);

  getKaos = delegateContextMethod(runtimeSupport.getKaos);
  resolveProviderManager = delegateContextMethod(runtimeSupport.resolveProviderManager);
  requireSession = delegateContextMethod(runtimeSupport.requireSession);
  sessionApi = delegateContextMethod(runtimeSupport.sessionApi);
  refreshSessionRuntimeConfig = delegateContextMethod(runtimeSupport.refreshSessionRuntimeConfig);

  reloadProviderManager(): LioraConfig {
    return configMethods.reloadRuntimeConfig(this);
  }

}
