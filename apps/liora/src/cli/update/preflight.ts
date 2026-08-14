import { spawn } from 'node:child_process';

import { log } from '@superliora/sdk';
import type { TelemetryProperties } from '@superliora/telemetry';

import { PRODUCT_NAME } from '#/constant/app';
import { tln } from '#/cli/i18n';

import { readUpdateCache } from './cache';
import {
  detectSuperLioraGithubCheckout,
  gitCheckoutVersionLabel,
  refreshGitCheckoutUpdateTarget,
} from './git-checkout';
import {
  buildAvailableLifecycleNotice,
  buildInstallingLifecycleNotice,
  consumeBackgroundInstallNotices,
  tryStartAutomaticBackgroundInstall,
} from './background-install';
import {
  renderGithubCheckoutInstallSuccessMessage,
  renderInstallSuccessMessage,
} from './install-messages';
import { rolloutTelemetryFor, trackUpdateEvent, type RolloutTelemetry, type UpdateLogger } from './install-runtime';
import { canAutoInstall, installCommandFor, spawnForSource, spawnOptionsForSource } from './install-spawn';
import { emptyUpdateInstallState, readUpdateInstallState } from './install-state';
import {
  startObservedUpgradeInstall,
  type StartObservedUpgradeInstallDeps,
  type StartObservedUpgradeInstallOptions,
} from './observed-install';
import {
  promptForInstallChoice,
  type InstallPromptChoiceValue,
  type InstallPromptOptions,
} from './prompt';
import {
  logRolloutDecision,
  refreshAndMaybeInstallInBackground,
  refreshInBackground,
  refreshUserVisibleUpdateTarget,
} from './preflight-rollout';
import {
  decidePassiveUpdateTarget,
  isRolloutBypassedByExperimentalEnv,
  resolveUpdateDeviceId,
} from './rollout';
import { detectInstallSource } from './source';
import {
  NPM_PACKAGE_NAME,
  type InstallSource,
  type UpdateDecision,
  type UpdateLifecycleNotice,
  type UpdateNoticeInfo,
  type UpdatePreflightResult,
  type UpdateTarget,
} from './types';

export type { UpdatePreflightResult, UpdateNoticeInfo, UpdateLifecycleNotice } from './types';
export { parseUpgradeStageLine, type UpgradeInstallStage } from './install-stages';
export {
  installCommandFor,
  canAutoInstall,
  spawnForSource,
} from './install-spawn';
export {
  renderManualUpdateMessage,
  renderInstallSuccessMessage,
} from './install-messages';
export {
  startObservedUpgradeInstall,
  type StartObservedUpgradeInstallOptions,
  type StartObservedUpgradeInstallDeps,
} from './observed-install';

export interface RunUpdatePreflightOptions {
  readonly stdout?: { write(chunk: string): boolean };
  readonly stderr?: { write(chunk: string): boolean };
  readonly isTTY?: boolean;
  readonly track?: (event: string, properties?: TelemetryProperties) => void;
  readonly logger?: UpdateLogger;
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * `SUPERLIORA_NO_AUTO_UPDATE` (or the legacy `KIMI_CLI_NO_AUTO_UPDATE` alias)
 * fully disables the update preflight — no check, no background install, no
 * prompt. Migrated from kimi-cli, where the variable gated all auto-update
 * behavior. Accepts the usual truthy values (`1`/`true`/`yes`/`on`).
 */
function isAutoUpdateDisabledByEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  const truthy = (value?: string): boolean =>
    ['1', 'true', 'yes', 'on'].includes((value ?? '').trim().toLowerCase());
  return truthy(env['SUPERLIORA_NO_AUTO_UPDATE']) || truthy(env['KIMI_CLI_NO_AUTO_UPDATE']);
}

function trackUpdatePrompted(
  track: RunUpdatePreflightOptions['track'],
  currentVersion: string,
  target: UpdateTarget,
  source: InstallSource,
  decision: UpdateDecision,
  rolloutTelemetry: RolloutTelemetry,
): void {
  trackUpdateEvent(track, 'update_prompted', {
    current_version: currentVersion,
    target_version: target.version,
    source,
    decision,
    ...rolloutTelemetry,
  });
}

async function promptInstall(
  currentVersion: string,
  target: UpdateTarget,
  source: InstallSource,
  installCommand: string,
): Promise<InstallPromptChoiceValue> {
  const options: InstallPromptOptions = {
    currentVersion,
    target,
    installSource: source,
    installCommand,
  };
  return promptForInstallChoice(options);
}

export async function installUpdate(
  source: InstallSource,
  version: string,
  platform: NodeJS.Platform,
  options: { readonly fromMain?: boolean; readonly checkoutRoot?: string } = {},
): Promise<void> {
  const { cmd, args } = spawnForSource(source, version, platform, options);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, [...args], spawnOptionsForSource(source, platform, {
      stdio: 'inherit',
    }));
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      const detail = signal !== null ? `signal ${signal}` : `code ${String(code)}`;
      reject(new Error(`${cmd} exited with ${detail}`));
    });
  });
}

export function decideUpdateAction(
  target: UpdateTarget | null,
  isInteractive: boolean,
  source: InstallSource,
  platform: NodeJS.Platform,
): UpdateDecision {
  if (target === null || !isInteractive) return 'none';
  return canAutoInstall(source, platform) ? 'prompt-install' : 'manual-command';
}

function continueWith(options: {
  readonly lifecycle?: UpdateLifecycleNotice | null;
  readonly updateNotice?: UpdateNoticeInfo;
}): UpdatePreflightResult {
  const lifecycle = options.lifecycle ?? null;
  const updateNotice = options.updateNotice;
  if (lifecycle === null && updateNotice === undefined) return 'continue';
  return {
    action: 'continue',
    ...(updateNotice !== undefined ? { updateNotice } : {}),
    ...(lifecycle !== null ? { lifecycle } : {}),
  };
}

export async function runUpdatePreflight(
  currentVersion: string,
  options: RunUpdatePreflightOptions = {},
): Promise<UpdatePreflightResult> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const logger = options.logger ?? log;
  const platform = process.platform;

  try {
    const isInteractive =
      options.isTTY ?? (process.stdin.isTTY && process.stdout.isTTY);
    const deviceId = resolveUpdateDeviceId();
    const bypassRollout = isRolloutBypassedByExperimentalEnv();
    let installState = await readUpdateInstallState().catch(() => emptyUpdateInstallState());
    let pendingLifecycle: UpdateLifecycleNotice | null = null;
    // Always surface completed/failed background install notices, even when
    // further auto-update work is disabled by env.
    if (isInteractive) {
      const consumed = await consumeBackgroundInstallNotices(
        installState,
        currentVersion,
        stdout,
        options.track,
        logger,
      );
      installState = consumed.state;
      pendingLifecycle = consumed.lifecycle;
    }

    if (isAutoUpdateDisabledByEnv()) {
      return continueWith({ lifecycle: pendingLifecycle });
    }

    const githubCheckoutRoot =
      isInteractive ? await detectSuperLioraGithubCheckout().catch(() => null) : null;
    if (githubCheckoutRoot !== null) {
      const source: InstallSource = 'github-checkout';
      const refreshResult = await refreshGitCheckoutUpdateTarget(githubCheckoutRoot).catch(
        () => null,
      );
      // temporary shim until Task 2/3 lands structured handling
      let target = refreshResult?.status === 'update' ? refreshResult.target : null;
      // Git may already match upstream while a prior background install failed on
      // build/install. Without this, auto-update and `liora upgrade` both report
      // "up to date" and the stale dist is never rebuilt.
      if (
        target === null
        && refreshResult?.status === 'up-to-date'
        && installState.lastFailure !== null
      ) {
        const headVersion = gitCheckoutVersionLabel(refreshResult.upstream, refreshResult.head);
        if (installState.lastFailure.version === headVersion) {
          target = {
            repoRoot: githubCheckoutRoot,
            upstream: refreshResult.upstream,
            version: headVersion,
          };
        }
      }
      if (target === null) return continueWith({ lifecycle: pendingLifecycle });
      const rolloutTelemetry = {
        rollout_bucket: 0,
        rollout_delay_seconds: 0,
        rollout_from_manifest: false,
        rollout_bypassed: true,
      };
      const decision = decideUpdateAction(target, isInteractive, source, platform);
      // Never silently background-install over a dirty checkout — that would
      // discard local work without consent. Explicit upgrade/prompt still may.
      // Rebuild-after-failed-install (up-to-date + lastFailure) reuses dirty from
      // the up-to-date refresh result.
      const checkoutDirty =
        (refreshResult?.status === 'update' || refreshResult?.status === 'up-to-date')
        && refreshResult.dirty === true;
      if (
        !checkoutDirty
        && await tryStartAutomaticBackgroundInstall(
          installState,
          currentVersion,
          target,
          source,
          platform,
          options.track,
          logger,
          rolloutTelemetry,
        )
      ) {
        const installing = buildInstallingLifecycleNotice(target.version);
        stdout.write(`${installing.detail ?? installing.title}\n`);
        return continueWith({ lifecycle: installing });
      }
      const installCommand = installCommandFor(source, target.version, platform);
      trackUpdatePrompted(options.track, currentVersion, target, source, decision, rolloutTelemetry);
      if (decision === 'manual-command') {
        return continueWith({
          lifecycle: pendingLifecycle ?? buildAvailableLifecycleNotice(
            currentVersion,
            target.version,
            installCommand,
          ),
          updateNotice: { currentVersion, targetVersion: target.version, installCommand },
        });
      }
      const choice = await promptInstall(currentVersion, target, source, installCommand);
      if (choice === 'skip') return continueWith({ lifecycle: pendingLifecycle });
      try {
        await installUpdate(source, target.version, platform);
        stdout.write(renderGithubCheckoutInstallSuccessMessage(target));
        return 'exit';
      } catch (error) {
        stderr.write(
          tln('cli.runtime.upgrade.githubInstallFailed', {
            product: PRODUCT_NAME,
            reason: formatErrorMessage(error),
          }),
        );
        return continueWith({ lifecycle: pendingLifecycle });
      }
    }

    const cache = await readUpdateCache().catch(() => null);
    const cachedManifest = cache?.manifest ?? null;
    const cachedDecision = decidePassiveUpdateTarget(
      currentVersion,
      cache?.latest ?? null,
      cachedManifest,
      deviceId,
      new Date(),
      bypassRollout,
    );
    logRolloutDecision('startup-cache', currentVersion, cache?.latest ?? null, cachedManifest, cachedDecision);
    const target = cachedDecision.target;
    if (target === null) {
      refreshAndMaybeInstallInBackground(
        currentVersion,
        deviceId,
        bypassRollout,
        isInteractive,
        installState,
        platform,
        options.track,
        logger,
      );
      return continueWith({ lifecycle: pendingLifecycle });
    }

    const source: InstallSource =
      isInteractive
        ? await detectInstallSource().catch(() => 'unsupported' as const)
        : 'unsupported';
    const decision = decideUpdateAction(target, isInteractive, source, platform);
    if (decision === 'none') {
      refreshInBackground();
      return continueWith({ lifecycle: pendingLifecycle });
    }

    if (
      await tryStartAutomaticBackgroundInstall(
        installState,
        currentVersion,
        target,
        source,
        platform,
        options.track,
        logger,
        rolloutTelemetryFor(deviceId, target.version, cachedManifest, bypassRollout),
      )
    ) {
      refreshInBackground();
      const installing = buildInstallingLifecycleNotice(target.version);
      stdout.write(`${installing.detail ?? installing.title}\n`);
      return continueWith({ lifecycle: installing });
    }

    const userVisibleUpdate = await refreshUserVisibleUpdateTarget(
      currentVersion,
      deviceId,
      bypassRollout,
      target,
      cachedManifest,
    );
    const userVisibleTarget = userVisibleUpdate.target;
    if (userVisibleTarget === null) return continueWith({ lifecycle: pendingLifecycle });
    const userVisibleRollout = rolloutTelemetryFor(
      deviceId,
      userVisibleTarget.version,
      userVisibleUpdate.manifest,
      bypassRollout,
    );
    if (
      await tryStartAutomaticBackgroundInstall(
        installState,
        currentVersion,
        userVisibleTarget,
        source,
        platform,
        options.track,
        logger,
        userVisibleRollout,
      )
    ) {
      const installing = buildInstallingLifecycleNotice(userVisibleTarget.version);
      stdout.write(`${installing.detail ?? installing.title}\n`);
      return continueWith({ lifecycle: installing });
    }

    const installCommand = installCommandFor(source, userVisibleTarget.version, platform);
    trackUpdatePrompted(options.track, currentVersion, userVisibleTarget, source, decision, userVisibleRollout);

    if (decision === 'manual-command') {
      return continueWith({
        lifecycle: pendingLifecycle ?? buildAvailableLifecycleNotice(
          currentVersion,
          userVisibleTarget.version,
          installCommand,
        ),
        updateNotice: {
          currentVersion,
          targetVersion: userVisibleTarget.version,
          installCommand,
        },
      });
    }

    const choice = await promptInstall(currentVersion, userVisibleTarget, source, installCommand);
    if (choice === 'skip') return continueWith({ lifecycle: pendingLifecycle });

    try {
      await installUpdate(source, userVisibleTarget.version, platform);
      stdout.write(renderInstallSuccessMessage(userVisibleTarget));
      return 'exit';
    } catch (error) {
      stderr.write(
        tln('cli.runtime.upgrade.installFailed', {
          package: NPM_PACKAGE_NAME,
          version: userVisibleTarget.version,
          reason: formatErrorMessage(error),
        }),
      );
      return continueWith({ lifecycle: pendingLifecycle });
    }
  } catch {
    return 'continue';
  }
}
