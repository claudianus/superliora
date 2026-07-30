import {
  appendRolloutDecisionLog,
  decidePassiveUpdateTarget,
  type PassiveUpdateDecision,
} from './rollout';
import { refreshUpdateCache } from './refresh';
import { detectInstallSource } from './source';
import { tryStartAutomaticBackgroundInstall } from './background-install';
import {
  nowIso,
  rolloutTelemetryFor,
  type UpdateLogger,
  type UpdateTrackFn,
} from './install-runtime';
import type { UpdateInstallState, UpdateManifest, UpdateTarget } from './types';

export const USER_VISIBLE_UPDATE_REFRESH_TIMEOUT_MS = 1_000;

type RolloutCheckPhase = 'startup-cache' | 'background-refresh' | 'prompt-refresh';

export function refreshInBackground(): void {
  void refreshUpdateCache().catch(() => {});
}

/** Record which case a passive version check hit in `updates/rollout.log`. */
export function logRolloutDecision(
  phase: RolloutCheckPhase,
  currentVersion: string,
  latest: string | null,
  manifest: UpdateManifest | null,
  decision: PassiveUpdateDecision,
): void {
  void appendRolloutDecisionLog({
    ts: nowIso(),
    phase,
    reason: decision.reason,
    current: currentVersion,
    latest,
    target: decision.target?.version ?? null,
    manifestPresent: manifest !== null,
    publishedAt: manifest?.publishedAt ?? null,
    bucket: decision.bucket,
    delaySeconds: decision.delaySeconds,
    eligibleAt: decision.eligibleAt,
  });
}

export function refreshAndMaybeInstallInBackground(
  currentVersion: string,
  deviceId: string,
  bypassRollout: boolean,
  isInteractive: boolean,
  installState: UpdateInstallState,
  platform: NodeJS.Platform,
  track: UpdateTrackFn | undefined,
  logger: UpdateLogger,
): void {
  void (async () => {
    const refreshed = await refreshUpdateCache();
    if (!isInteractive) return;
    const decision = decidePassiveUpdateTarget(
      currentVersion,
      refreshed.latest,
      refreshed.manifest,
      deviceId,
      new Date(),
      bypassRollout,
    );
    logRolloutDecision('background-refresh', currentVersion, refreshed.latest, refreshed.manifest, decision);
    const target = decision.target;
    if (target === null) return;
    const source = await detectInstallSource().catch(() => 'unsupported' as const);
    await tryStartAutomaticBackgroundInstall(
      installState,
      currentVersion,
      target,
      source,
      platform,
      track,
      logger,
      rolloutTelemetryFor(deviceId, target.version, refreshed.manifest, bypassRollout),
    );
  })().catch(() => {});
}

export interface UserVisibleUpdateTarget {
  readonly target: UpdateTarget | null;
  readonly manifest: UpdateManifest | null;
}

export async function refreshUserVisibleUpdateTarget(
  currentVersion: string,
  deviceId: string,
  bypassRollout: boolean,
  fallbackTarget: UpdateTarget,
  fallbackManifest: UpdateManifest | null,
): Promise<UserVisibleUpdateTarget> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const fallback: UserVisibleUpdateTarget = {
    target: fallbackTarget,
    manifest: fallbackManifest,
  };
  try {
    const refresh = refreshUpdateCache()
      .then((refreshed) => {
        const decision = decidePassiveUpdateTarget(
          currentVersion,
          refreshed.latest,
          refreshed.manifest,
          deviceId,
          new Date(),
          bypassRollout,
        );
        logRolloutDecision('prompt-refresh', currentVersion, refreshed.latest, refreshed.manifest, decision);
        return {
          target: decision.target,
          manifest: refreshed.manifest,
        };
      })
      .catch(() => fallback);
    const timeoutFallback = new Promise<UserVisibleUpdateTarget>((resolve) => {
      timeout = setTimeout(() => {
        resolve(fallback);
      }, USER_VISIBLE_UPDATE_REFRESH_TIMEOUT_MS);
    });
    return await Promise.race([refresh, timeoutFallback]);
  } catch {
    return fallback;
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}
