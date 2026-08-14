import { spawn } from 'node:child_process';

import { loadTuiConfig } from '#/tui/config';

import { tryAcquireUpdateInstallLock } from './install-lock';
import {
  formatUpdateLifecycleTitle,
  renderBackgroundInstallFailedNotice,
  renderBackgroundInstallStartedNotice,
  renderBackgroundInstallSuccessNotice,
} from './install-messages';
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
import { canAutoInstall, spawnForSource, spawnOptionsForSource } from './install-spawn';
import { readUpdateInstallState, writeUpdateInstallState } from './install-state';
import type {
  InstallSource,
  UpdateInstallState,
  UpdateLifecycleNotice,
  UpdateTarget,
} from './types';

export interface ConsumeInstallNoticesResult {
  readonly state: UpdateInstallState;
  readonly lifecycle: UpdateLifecycleNotice | null;
}

/**
 * Consume one-shot success/failure notices for the next interactive launch.
 * Writes a plain-stdout line for terminal visibility and returns a structured
 * lifecycle payload for the TUI (toast + header + transcript).
 */
export async function consumeBackgroundInstallNotices(
  state: UpdateInstallState,
  currentVersion: string,
  stdout: { write(chunk: string): boolean },
  track: UpdateTrackFn | undefined,
  logger: UpdateLogger,
): Promise<ConsumeInstallNoticesResult> {
  const success = state.lastSuccess;
  const shouldShowSuccessNotice = success !== null
    && success.notifiedAt === null
    && (success.version === currentVersion || success.source === 'github-checkout');
  if (shouldShowSuccessNotice && success !== null) {
    const text = renderBackgroundInstallSuccessNotice(success.version, success.source);
    stdout.write(text.endsWith('\n') ? text : `${text}\n`);
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
    return {
      state: nextState,
      lifecycle: {
        kind: 'completed',
        version: success.version,
        title: formatUpdateLifecycleTitle('completed', success.version),
        detail: text.trim(),
        source: success.source,
      },
    };
  }

  const active = state.active;
  if (active !== null && active.version === currentVersion) {
    const alreadyNotified =
      success !== null && success.version === currentVersion && success.notifiedAt !== null;
    if (!alreadyNotified) {
      const text = renderBackgroundInstallSuccessNotice(active.version, active.source);
      stdout.write(text.endsWith('\n') ? text : `${text}\n`);
      trackUpdateEvent(track, 'update_success_notice_shown', {
        version: active.version,
        source: active.source,
        inferred_from_active: true,
      });
      logUpdateInfo(logger, 'background update success notice shown', {
        version: active.version,
        inferredFromActive: true,
      });
      const notifiedAt = nowIso();
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
      return {
        state: nextState,
        lifecycle: {
          kind: 'completed',
          version: active.version,
          title: formatUpdateLifecycleTitle('completed', active.version),
          detail: text.trim(),
          source: active.source,
        },
      };
    }
  }

  const failure = state.lastFailure;
  if (
    failure !== null
    && (failure.notifiedAt === null || failure.notifiedAt === undefined)
    && failure.attempts >= AUTO_INSTALL_FAILURE_PROMPT_THRESHOLD
  ) {
    const text = renderBackgroundInstallFailedNotice(failure.version, failure.attempts);
    stdout.write(text.endsWith('\n') ? text : `${text}\n`);
    trackUpdateEvent(track, 'update_failure_notice_shown', {
      version: failure.version,
      attempts: failure.attempts,
    });
    logUpdateWarn(logger, 'background update failure notice shown', {
      version: failure.version,
      attempts: failure.attempts,
    });
    const nextState: UpdateInstallState = {
      ...state,
      lastFailure: {
        ...failure,
        notifiedAt: nowIso(),
      },
    };
    await writeUpdateInstallState(nextState).catch(() => {});
    return {
      state: nextState,
      lifecycle: {
        kind: 'failed',
        version: failure.version,
        title: formatUpdateLifecycleTitle('failed', failure.version),
        detail: text.trim(),
      },
    };
  }

  return { state, lifecycle: null };
}

export function buildInstallingLifecycleNotice(version: string): UpdateLifecycleNotice {
  const detail = renderBackgroundInstallStartedNotice(version).trim();
  return {
    kind: 'installing',
    version,
    title: formatUpdateLifecycleTitle('installing', version),
    detail,
  };
}

export function buildAvailableLifecycleNotice(
  currentVersion: string,
  targetVersion: string,
  installCommand: string,
): UpdateLifecycleNotice {
  return {
    kind: 'available',
    version: targetVersion,
    currentVersion,
    title: formatUpdateLifecycleTitle('available', targetVersion),
    detail: installCommand,
    installCommand,
  };
}

async function shouldAutoInstallUpdates(): Promise<boolean> {
  try {
    const config = await loadTuiConfig();
    return config.upgrade.autoInstall;
  } catch {
    return true;
  }
}

type BackgroundStartResult =
  | { readonly status: 'started' }
  | { readonly status: 'already-active' }
  | { readonly status: 'lock-held' }
  | { readonly status: 'failure-threshold' };

/**
 * Spawn a detached install. Status distinguishes "in flight" from hard skips
 * so the preflight can avoid double interactive prompts under concurrency.
 */
async function startBackgroundInstall(
  state: UpdateInstallState,
  currentVersion: string,
  target: UpdateTarget,
  source: InstallSource,
  platform: NodeJS.Platform,
  track: UpdateTrackFn | undefined,
  logger: UpdateLogger,
  rolloutTelemetry: RolloutTelemetry,
): Promise<BackgroundStartResult> {
  const lock = await tryAcquireUpdateInstallLock({ version: target.version });
  if (lock === null) {
    logUpdateInfo(logger, 'background update install skipped', {
      targetVersion: target.version,
      source,
      reason: 'lock-held',
    });
    return { status: 'lock-held' };
  }

  try {
    const freshState = await readUpdateInstallState().catch(() => state);
    if (hasFreshActiveInstall(freshState, target)) {
      return { status: 'already-active' };
    }
    if (failureAttemptsFor(freshState, target) >= AUTO_INSTALL_FAILURE_PROMPT_THRESHOLD) {
      logUpdateInfo(logger, 'background update install skipped', {
        targetVersion: target.version,
        source,
        reason: 'failure-threshold',
      });
      return { status: 'failure-threshold' };
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
            notifiedAt: null,
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

    const child = spawn(cmd, [...args], spawnOptionsForSource(source, platform, {
      detached: true,
      stdio: 'ignore',
    }));
    child.once('error', () => { finish(false); });
    child.once('exit', (code) => { finish(code === 0); });
    child.unref();
    return { status: 'started' };
  } finally {
    await lock.release().catch(() => {});
  }
}

/**
 * @returns true when an automatic install is in flight, freshly started, or
 *          another process holds the install lock (caller should skip the
 *          interactive prompt). false when auto install is off / unsupported /
 *          exhausted retries — caller may prompt.
 */
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
  if (!sourceCanAutoInstall) {
    logUpdateInfo(logger, 'background update install skipped', {
      targetVersion: target.version,
      source,
      reason: 'source-unsupported',
    });
    return false;
  }
  const autoInstallUpdates = await shouldAutoInstallUpdates();
  if (!autoInstallUpdates) {
    logUpdateInfo(logger, 'background update install skipped', {
      targetVersion: target.version,
      source,
      reason: 'auto-install-disabled',
    });
    return false;
  }
  if (failureAttemptsFor(installState, target) >= AUTO_INSTALL_FAILURE_PROMPT_THRESHOLD) {
    logUpdateInfo(logger, 'background update install skipped', {
      targetVersion: target.version,
      source,
      reason: 'failure-threshold',
    });
    return false;
  }
  if (hasFreshActiveInstall(installState, target)) {
    return true;
  }
  try {
    const result = await startBackgroundInstall(
      installState,
      currentVersion,
      target,
      source,
      platform,
      track,
      logger,
      rolloutTelemetry,
    );
    // lock-held / already-active: peer session owns the install — stay silent.
    // failure-threshold: surface a prompt so the user can recover manually.
    return result.status === 'started'
      || result.status === 'already-active'
      || result.status === 'lock-held';
  } catch (error) {
    logUpdateWarn(logger, 'background update install failed to start', {
      targetVersion: target.version,
      source,
      error,
    });
    return false;
  }
}
