import {
  createRPC,
  ensureConfigFile,
  getRootLogger,
  LioraCore,
  log,
  noopTelemetryClient,
  resolveConfigPath,
  resolveLioraHome,
  resolveLoggingConfig,
  setUnexpectedErrorHandler,
  type CoreAPI,
  type OAuthTokenProviderResolver,
  type RPCMethods,
  type RuntimeDegradedEvent,
  type SDKAPI,
  type TelemetryClient,
} from '@superliora/agent-core';
import type { Kaos } from '@superliora/kaos';
import { assertKimiHostIdentity, createKimiDefaultHeaders } from '@superliora/oauth';

import { LioraAuthFacade } from '#/auth';
import { LioraHarness } from '#/harness/liora-harness';
import { ClientAPI, SDKRpcClientBase, type ReloadSessionRpcInput } from '#/rpc/rpc';
import type {
  CreateSessionOptions,
  LioraHarnessOptions,
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
  readonly skillDirs?: readonly string[];
  readonly projectDir?: string;
  readonly pluginDirs?: readonly string[];
  readonly channelServers?: readonly string[];
  readonly resolveMarketplaceSource?: (
    pluginId: string,
  ) => Promise<string | undefined> | string | undefined;
  readonly telemetry?: TelemetryClient;
  readonly onOAuthRefresh?: (outcome: OAuthRefreshOutcome) => void;
}

export class SDKRpcClient extends SDKRpcClientBase {
  readonly homeDir: string;
  readonly configPath: string;
  readonly identity: KimiHostIdentity | undefined;
  readonly telemetry: TelemetryClient;
  readonly auth: LioraAuthFacade;
  readonly core: LioraCore;

  private readonly ready: Promise<RPCMethods<CoreAPI>>;

  constructor(options: SDKRpcClientOptions = {}) {
    super();
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
      skillDirs: options.skillDirs,
      projectDir: options.projectDir,
      pluginDirs: options.pluginDirs,
      channelServers: options.channelServers,
      resolveMarketplaceSource: options.resolveMarketplaceSource,
      telemetry: this.telemetry,
      appVersion: this.identity?.version,
    });
    coreRef = this.core;
    this.ready = sdkRpc(new ClientAPI(this));
  }

  async ensureConfigFile(): Promise<void> {
    await ensureConfigFile(this.configPath);
  }

  async close(): Promise<void> {
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
    const { planMode, ...coreInput } = input;
    void planMode;
    return this.core.createSessionWithOverrides(coreInput, { kaos, persistenceKaos });
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
  override async reloadSession(input: ReloadSessionRpcInput): Promise<ResumedSessionSummary> {
    return this.core.reloadSession({
      sessionId: input.sessionId,
      forcePluginSessionStartReminder: input.forcePluginSessionStartReminder,
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
  const rpc = new SDKRpcClient(options);
  return new LioraHarness(rpc, {
    identity: rpc.identity,
    uiMode: options.uiMode,
    homeDir: rpc.homeDir,
    configPath: rpc.configPath,
    auth: rpc.auth,
    telemetry: rpc.telemetry,
    ensureConfigFile: () => rpc.ensureConfigFile(),
    onClose: () => rpc.close(),
    sessionStartedProperties: options.sessionStartedProperties,
  });
}
