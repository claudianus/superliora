import {
  createRPC,
  ensureConfigFile,
  getRootLogger,
  LioraCore,
  noopTelemetryClient,
  resolveConfigPath,
  resolveLioraHome,
  resolveLoggingConfig,
  type CoreAPI,
  type OAuthTokenProviderResolver,
  type RPCMethods,
  type SDKAPI,
  type TelemetryClient,
} from '@superliora/agent-core';
import type { Kaos } from '@superliora/kaos';
import { assertKimiHostIdentity, createKimiDefaultHeaders } from '@superliora/oauth';

import { LioraAuthFacade } from '#/auth';
import { LioraHarness } from '#/liora-harness';
import { ClientAPI, SDKRpcClientBase } from '#/rpc';
import type {
  CreateSessionOptions,
  LioraHarnessOptions,
  KimiHostIdentity,
  OAuthRefreshOutcome,
  ResumeSessionInput,
  ResumedSessionSummary,
  SessionSummary,
} from '#/types';

export interface SDKRpcClientOptions {
  readonly homeDir?: string;
  readonly configPath?: string;
  readonly identity?: KimiHostIdentity;
  readonly resolveOAuthTokenProvider?: OAuthTokenProviderResolver;
  readonly skillDirs?: readonly string[];
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
    this.auth = new LioraAuthFacade({
      homeDir: this.homeDir,
      configPath: this.configPath,
      identity: this.identity,
      onRefresh: options.onOAuthRefresh,
    });

    void getRootLogger().configure(resolveLoggingConfig({ homeDir: this.homeDir }));

    const [coreRpc, sdkRpc] = createRPC<CoreAPI, SDKAPI>();
    this.core = new LioraCore(coreRpc, {
      homeDir: options.homeDir,
      configPath: this.configPath,
      kimiRequestHeaders: this.createKimiRequestHeaders(),
      resolveOAuthTokenProvider:
        options.resolveOAuthTokenProvider ?? this.auth.resolveOAuthTokenProvider,
      skillDirs: options.skillDirs,
      telemetry: this.telemetry,
      appVersion: this.identity?.version,
    });
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

  override emergencyFlushSync(): void {
    this.core.emergencyFlushSync();
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
