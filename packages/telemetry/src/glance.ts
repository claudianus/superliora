import {
  isTelemetryDisabledByEnv,
  shouldEnableTelemetry,
  TELEMETRY_DISABLE_ENV,
} from './bootstrap';
import { getDefaultTelemetryClient } from './client';
import { AsyncTransport, TELEMETRY_ENDPOINT } from './transport';

/** Optional endpoint override (internal / advanced). */
export const TELEMETRY_ENDPOINT_ENV = 'SUPERLIORA_TELEMETRY_ENDPOINT';

/** Display-only opt-in marker used by footer/status contracts; config.toml remains SSOT. */
export const TELEMETRY_OPT_IN_ENV = 'SUPERLIORA_TELEMETRY';

const TRUE_ENV_VALUES = new Set(['1', 'true', 't', 'yes', 'y']);

export interface TelemetryRuntimeGlance {
  readonly liveEnabled: boolean;
  readonly endpoint?: string;
}

export function resolveTelemetryEndpoint(env: NodeJS.ProcessEnv = process.env): string {
  const override = env[TELEMETRY_ENDPOINT_ENV]?.trim();
  if (override !== undefined && override.length > 0) return override;
  return TELEMETRY_ENDPOINT;
}

export function isTelemetryOptInEnvSet(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env[TELEMETRY_OPT_IN_ENV]?.trim().toLowerCase();
  return value !== undefined && TRUE_ENV_VALUES.has(value);
}

/** Live sink attached in this process (post-initializeTelemetry). */
export function getTelemetryRuntimeGlance(): TelemetryRuntimeGlance {
  const sink = getDefaultTelemetryClient().getSink();
  if (sink === null) {
    return { liveEnabled: false };
  }
  const endpoint = sink.getUploadEndpoint();
  return endpoint !== undefined ? { liveEnabled: true, endpoint } : { liveEnabled: true };
}

export {
  isTelemetryDisabledByEnv,
  shouldEnableTelemetry,
  TELEMETRY_DISABLE_ENV,
  TELEMETRY_ENDPOINT,
};
