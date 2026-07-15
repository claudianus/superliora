import { createKimiDeviceId, SUPERLIORA_PROVIDER_NAME } from '@superliora/oauth';
import {
  LioraAuthFacade,
  loadRuntimeConfigSafe,
  resolveConfigPath,
  resolveLioraHome,
  type LioraConfig,
  type LioraHarness,
  type TelemetryClient,
} from '@superliora/sdk';
import {
  initializeTelemetry,
  setTelemetryContext,
  track,
  withTelemetryContext,
} from '@superliora/telemetry';

import { CLI_USER_AGENT_PRODUCT, SERVER_UI_MODE } from '#/constant/app';

import { createLioraHostIdentity } from './version';

export interface CliTelemetryBootstrap {
  readonly homeDir: string;
  readonly deviceId: string;
  readonly firstLaunch: boolean;
}

export interface InitializeCliTelemetryOptions {
  readonly harness: LioraHarness;
  readonly bootstrap: CliTelemetryBootstrap;
  readonly config: Pick<LioraConfig, 'defaultModel' | 'telemetry'>;
  readonly version: string;
  readonly uiMode: string;
  readonly model?: string;
}

export function createCliTelemetryBootstrap(): CliTelemetryBootstrap {
  let firstLaunch = false;
  const homeDir = resolveLioraHome();
  const deviceId = createKimiDeviceId(homeDir, {
    onFirstLaunch: () => {
      firstLaunch = true;
    },
  });
  return { homeDir, deviceId, firstLaunch };
}

export function initializeCliTelemetry(options: InitializeCliTelemetryOptions): void {
  initializeTelemetry({
    homeDir: options.harness.homeDir,
    deviceId: options.bootstrap.deviceId,
    enabled: options.config.telemetry === true,
    appName: CLI_USER_AGENT_PRODUCT,
    version: options.version,
    uiMode: options.uiMode,
    model: options.model ?? options.config.defaultModel,
    getAccessToken: async () =>
      (await options.harness.auth.getCachedAccessToken(SUPERLIORA_PROVIDER_NAME)) ?? null,
  });
  if (options.bootstrap.firstLaunch) {
    options.harness.track('first_launch');
  }
}

export interface InitializeServerTelemetryOptions {
  readonly version: string;
}

/**
 * Bootstrap telemetry for the `liora server run` host.
 *
 * Mirrors {@link initializeCliTelemetry}: mints the device id, reads config to
 * honor the `telemetry` toggle and pick up the default model, attaches the
 * sink with `ui_mode = "server"`, and returns a {@link TelemetryClient} the
 * caller hands to `startServer` via `coreProcessOptions.telemetry`. That wires
 * the same real client into `LioraCore`, so agent-core events emitted inside the
 * server process (`mcp_connected`, `session_load_failed`, plan-mode / cron
 * events, …) actually leave the process carrying the enriched context
 * (`app_name` / `version` / `ui_mode` / `model` / platform fields).
 *
 * The returned client wraps the `@superliora/telemetry` module
 * functions, so the module-level `track` / `withTelemetryContext` (used to
 * fire the startup event) share the same underlying client + sink.
 */
export function initializeServerTelemetry(
  options: InitializeServerTelemetryOptions,
): TelemetryClient {
  const bootstrap = createCliTelemetryBootstrap();
  const configPath = resolveConfigPath({ homeDir: bootstrap.homeDir });
  const config = readServerTelemetryConfig(configPath);
  const auth = new LioraAuthFacade({
    homeDir: bootstrap.homeDir,
    configPath,
    identity: createLioraHostIdentity(options.version),
  });

  initializeTelemetry({
    homeDir: bootstrap.homeDir,
    deviceId: bootstrap.deviceId,
    enabled: config.telemetry === true,
    appName: CLI_USER_AGENT_PRODUCT,
    version: options.version,
    uiMode: SERVER_UI_MODE,
    model: config.defaultModel,
    getAccessToken: async () => (await auth.getCachedAccessToken(SUPERLIORA_PROVIDER_NAME)) ?? null,
  });

  return {
    track,
    withContext: withTelemetryContext,
    setContext: setTelemetryContext,
  };
}

function readServerTelemetryConfig(
  configPath: string,
): Pick<LioraConfig, 'telemetry' | 'defaultModel'> {
  try {
    const { config, fileError } = loadRuntimeConfigSafe(configPath);
    // A broken config fails the server on its own inside LioraCore; for
    // telemetry degrade to OFF so we never enable product analytics by default.
    if (fileError !== undefined) return { telemetry: false };
    return config;
  } catch {
    return {};
  }
}
