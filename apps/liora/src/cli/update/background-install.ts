import { spawn } from 'node:child_process';

import { loadTuiConfig } from '#/tui/config';

import { tryAcquireUpdateInstallLock } from './install-lock';
import { renderBackgroundInstallSuccessNotice } from './install-messages';
import {
  AUTO_INSTALL_FAILURE_PROMPT_THRESHOLD,
  failureAttemptsFor,
  hasFreshActiveInstall,
  logUpdateInfo,
  logUpdateWarn,
  nowIso,
  trackUpdateEvent,
  type RolloutTelemetry,
  type UpdateLogger,
  type UpdateTrackFn,
} from './install-runtime';
import { canAutoInstall, spawnForSource } from './install-spawn';
import { readUpdateInstallState, writeUpdateInstallState } from './install-state';
import type { InstallSource, UpdateInstallState, UpdateTarget } from './types';

export async function showPendingBackgroundInstallNotice(
  state: UpdateInstallState,
  currentVersion: string,
  stdout: { write(chunk: string): boolean },
  track: UpdateTrackFn | undefined,
  logger: UpdateLogger,
): Promise<UpdateInstallState> {
  const success = state.lastSuccess;
  const shouldShowSuccessNotice = success !== null
    && success.notifiedAt === null
    && (success.version === currentVersion || success.source === 'github-checkout');
  if (shouldShowSuccessNotice) {
    stdout.write(renderBackgroundInstallSuccessNotice(success.version, success.source));
    trackUpdateEvent(track, 'update_success_notice_shown', {
      version: success.version,
      source: success.source,
      inferred_from_active: false,
    });
    logUpdateInfo(logger, 'background update success notice shown', {
      version: success.version,
      inferredFromActive: false,
    });
    const nextState: UpdateInstallState = {
      ...state,
      active: null,
      lastFailure: null,
      lastSuccess: {
        ...success,
        notifiedAt: nowIso(),
      },
    };
    await writeUpdateInstallState(nextState).catch(() => {});
    return nextState;
  }

  const active = state.active;
  if (active === null || active.version !== currentVersion) return state;
  if (success !== null && success.version === currentVersion && success.notifiedAt !== null) {
    return state;
  }

  const notifiedAt = nowIso();
  stdout.write(renderBackgroundInstallSuccessNotice(active.version, active.source));
  trackUpdateEvent(track, 'update_success_notice_shown', {
    version: active.version,
    source: active.source,
    inferred_from_active: true,
  });
  logUpdateInfo(logger, 'background update success notice shown', {
    version: active.version,
    inferredFromActive: true,
  });
  const nextState: UpdateInstallState = {
    ...state,
    active: null,
    lastFailure: null,
    lastSuccess: {
      version: active.version,
      source: active.source,
      installedAt: notifiedAt,
      notifiedAt,
    },
  };
  await writeUpdateInstallState(nextState).catch(() => {});
  return nextState;
}

async function shouldAutoInstallUpdates(): Promise<boolean> {
  try {
    const config = await loadTuiConfig();
    return config.upgrade.autoInstall;
  } catch {
    return true;
  }
}

async function startBackgroundInstall(
  state: UpdateInstallState,
  currentVersion: string,
  target: UpdateTarget,
  source: InstallSource,
  platform: NodeJS.Platform,
  track: UpdateTrackFn | undefined,
  logger: UpdateLogger,
  rolloutTelemetry: RolloutTelemetry,
): Promise<void> {
  const lock = await tryAcquireUpdateInstallLock({ version: target.version });
  if (lock === null) return;

  try {
    const freshState = await readUpdateInstallState().catch(() => state);
    if (
      hasFreshActiveInstall(freshState, target) ||
      failureAttemptsFor(freshState, target) >= AUTO_INSTALL_FAILURE_PROMPT_THRESHOLD
    ) {
      return;
    }

    const startedState: UpdateInstallState = {
      ...freshState,
      active: {
        version: target.version,
        source,
        startedAt: nowIso(),
      },
    };
    await writeUpdateInstallState(startedState);
    trackUpdateEvent(track, 'update_background_install_started', {
      current_version: currentVersion,
      target_version: target.version,
      source,
      ...rolloutTelemetry,
    });
    logUpdateInfo(logger, 'background update install started', {
      currentVersion,
      targetVersion: target.version,
      source,
    });

    const { cmd, args } = spawnForSource(source, target.version, platform);
    let settled = false;

    const finish = (succeeded: boolean): void => {
      if (settled) return;
      settled = true;
      const attempts = failureAttemptsFor(startedState, target) + 1;

      const nextState: UpdateInstallState = succeeded
        ? {
          ...startedState,
          active: null,
          lastFailure: null,
          lastSuccess: {
            version: target.version,
            source,
            installedAt: nowIso(),
            notifiedAt: null,
          },
        }
        : {
          ...startedState,
          active: null,
          lastFailure: {
            version: target.version,
            failedAt: nowIso(),
            attempts,
          },
        };
      void writeUpdateInstallState(nextState).catch(() => {});
      if (succeeded) {
        trackUpdateEvent(track, 'update_background_install_succeeded', {
          target_version: target.version,
          source,
        });
        logUpdateInfo(logger, 'background update install succeeded', {
          targetVersion: target.version,
          source,
        });
        return;
      }
      trackUpdateEvent(track, 'update_background_install_failed', {
        target_version: target.version,
        source,
        attempts,
      });
      logUpdateWarn(logger, 'background update install failed', {
        targetVersion: target.version,
        source,
        attempts,
      });
    };

    const child = spawn(cmd, [...args], {
      detached: true,
      stdio: 'ignore',
      shell: platform === 'win32' ? true : undefined,
    });
    child.once('error', () => { finish(false); });
    child.once('exit', (code) => { finish(code === 0); });
    child.unref();
  } finally {
    await lock.release().catch(() => {});
  }
}

export async function tryStartAutomaticBackgroundInstall(
  installState: UpdateInstallState,
  currentVersion: string,
  target: UpdateTarget,
  source: InstallSource,
  platform: NodeJS.Platform,
  track: UpdateTrackFn | undefined,
  logger: UpdateLogger,
  rolloutTelemetry: RolloutTelemetry,
): Promise<boolean> {
  const sourceCanAutoInstall = canAutoInstall(source, platform);
  const autoInstallUpdates = sourceCanAutoInstall ? await shouldAutoInstallUpdates() : false;
  if (!autoInstallUpdates || !sourceCanAutoInstall) return false;
  if (failureAttemptsFor(installState, target) >= AUTO_INSTALL_FAILURE_PROMPT_THRESHOLD) {
    return false;
  }
  if (!hasFreshActiveInstall(installState, target)) {
    await startBackgroundInstall(
      installState,
      currentVersion,
      target,
      source,
      platform,
      track,
      logger,
      rolloutTelemetry,
    ).catch(() => {});
  }
  return true;
}
