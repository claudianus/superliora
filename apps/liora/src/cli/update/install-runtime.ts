import type { Logger } from '@superliora/sdk';
import type { TelemetryProperties } from '@superliora/telemetry';

import {
  rolloutBucket,
  rolloutDelayForBucket,
} from './rollout';
import type { UpdateInstallState, UpdateManifest, UpdateTarget } from './types';

export const AUTO_INSTALL_FAILURE_PROMPT_THRESHOLD = 2;
export const AUTO_INSTALL_ACTIVE_TTL_MS = 6 * 60 * 60 * 1000;

export type UpdateLogger = Pick<Logger, 'info' | 'warn'>;

export type UpdateTrackFn = (event: string, properties?: TelemetryProperties) => void;

/** Telemetry properties describing where this device sits in the rollout. */
export interface RolloutTelemetry {
  readonly rollout_bucket: number;
  readonly rollout_delay_seconds: number;
  readonly rollout_from_manifest: boolean;
  readonly rollout_bypassed: boolean;
}

export function rolloutTelemetryFor(
  deviceId: string,
  targetVersion: string,
  manifest: UpdateManifest | null,
  bypassRollout: boolean,
): RolloutTelemetry {
  const bucket = rolloutBucket(deviceId, targetVersion);
  return {
    rollout_bucket: bucket,
    rollout_delay_seconds:
      manifest === null || bypassRollout ? 0 : rolloutDelayForBucket(manifest.rollout, bucket),
    rollout_from_manifest: manifest !== null,
    rollout_bypassed: bypassRollout,
  };
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function failureAttemptsFor(state: UpdateInstallState, target: UpdateTarget): number {
  return state.lastFailure?.version === target.version ? state.lastFailure.attempts : 0;
}

export function hasFreshActiveInstall(state: UpdateInstallState, target: UpdateTarget): boolean {
  const active = state.active;
  if (active === null || active.version !== target.version) return false;
  const startedAt = Date.parse(active.startedAt);
  if (!Number.isFinite(startedAt)) return false;
  return Date.now() - startedAt < AUTO_INSTALL_ACTIVE_TTL_MS;
}

export function trackUpdateEvent(
  track: UpdateTrackFn | undefined,
  event: string,
  properties: TelemetryProperties,
): void {
  try {
    track?.(event, properties);
  } catch {
    // Telemetry must never affect update prompting.
  }
}

export function logUpdateInfo(logger: UpdateLogger, message: string, payload: Record<string, unknown>): void {
  try {
    logger.info(message, payload);
  } catch {
    // Diagnostic logging must never affect update prompting.
  }
}

export function logUpdateWarn(logger: UpdateLogger, message: string, payload: Record<string, unknown>): void {
  try {
    logger.warn(message, payload);
  } catch {
    // Diagnostic logging must never affect update prompting.
  }
}
