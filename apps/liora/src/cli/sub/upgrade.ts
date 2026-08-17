import { log, type Logger } from '@superliora/sdk';
import { track as trackTelemetry, type TelemetryProperties } from '@superliora/telemetry';

import { tln } from '#/cli/i18n';
import { PRODUCT_NAME } from '#/constant/app';
import {
  installUpdate as installUpdateForeground,
  renderInstallSuccessMessage,
  renderManualUpdateMessage,
  startObservedUpgradeInstall,
} from '#/cli/update/preflight';
import { CliUpgradeProgressWriter } from '#/cli/update/cli-progress';
import { refreshGuiUseAfterUpgrade } from '#/cli/update/gui-use-refresh';
import {
  resolveUpgradePlan,
  type UpgradePlan,
} from '#/cli/update/plan';
import {
  promptForInstallChoice,
  type InstallPromptChoiceValue,
  type InstallPromptOptions,
} from '#/cli/update/prompt';
import {
  NPM_PACKAGE_NAME,
  type InstallSource,
} from '#/cli/update/types';

interface WritableLike {
  write(chunk: string): boolean;
  isTTY?: boolean;
}

type UpgradeTrack = (event: string, properties?: TelemetryProperties) => void;
type UpgradeLogger = Pick<Logger, 'info' | 'warn'>;

export interface UpgradeDeps {
  readonly resolveUpgradePlan: (
    currentVersion: string,
    options?: { readonly fromMain?: boolean },
  ) => Promise<UpgradePlan>;
  readonly installUpdate: (
    source: InstallSource,
    version: string,
    platform: NodeJS.Platform,
    options?: { readonly fromMain?: boolean; readonly checkoutRoot?: string },
  ) => Promise<void>;
  readonly promptForInstallChoice: (
    options: InstallPromptOptions,
  ) => Promise<InstallPromptChoiceValue>;
  readonly platform: NodeJS.Platform;
  readonly stdout: WritableLike;
  readonly stderr: WritableLike;
  readonly isInteractive: boolean;
  readonly track: UpgradeTrack;
  readonly logger: UpgradeLogger;
  readonly updateGuiUseAfterUpgrade: () => Promise<void>;
  readonly fromMain: boolean;
}

export async function handleUpgrade(
  currentVersion: string,
  overrides: Partial<UpgradeDeps> = {},
): Promise<number> {
  const deps = createDefaultUpgradeDeps(overrides);
  const plan = await deps.resolveUpgradePlan(currentVersion, { fromMain: deps.fromMain });

  if (plan.reason === 'check-failed') {
    trackUpgradeEvent(deps.track, 'upgrade_command_failed', {
      current_version: currentVersion,
      source: plan.source,
      stage: 'refresh',
      reason: plan.errorMessage ?? 'unknown',
    });
    logUpgradeWarn(deps.logger, 'manual upgrade check failed', {
      currentVersion,
      source: plan.source,
      error: plan.errorMessage ?? 'unknown',
    });
    deps.stderr.write(
      plan.source === 'github-checkout'
        ? tln('cli.runtime.upgrade.githubCheckFailed', {
            reason: plan.errorMessage ?? 'unknown',
          })
        : tln('cli.runtime.upgrade.checkFailed', { reason: plan.errorMessage ?? 'unknown' }),
    );
    return 1;
  }

  if (plan.reason === 'already-installing') {
    trackUpgradeEvent(deps.track, 'upgrade_command_already_installing', {
      current_version: currentVersion,
      target_version: plan.target?.version ?? currentVersion,
      source: plan.source,
    });
    logUpgradeInfo(deps.logger, 'manual upgrade already installing', {
      currentVersion,
      targetVersion: plan.target?.version ?? currentVersion,
      source: plan.source,
    });
    deps.stdout.write(
      tln('cli.runtime.upgrade.alreadyInstalling', {
        version: plan.target?.version ?? currentVersion,
      }),
    );
    return 0;
  }

  if (plan.reason === 'up-to-date') {
    trackUpgradeEvent(deps.track, 'upgrade_command_no_update', {
      current_version: currentVersion,
      source: plan.source,
    });
    logUpgradeInfo(deps.logger, 'manual upgrade no update', {
      currentVersion,
      source: plan.source,
    });
    deps.stdout.write(
      plan.source === 'github-checkout'
        ? tln('cli.runtime.upgrade.githubAlreadyUpToDate', { product: PRODUCT_NAME })
        : tln('cli.runtime.upgrade.alreadyUpToDate', {
            product: PRODUCT_NAME,
            version: formatDisplayVersion(currentVersion),
          }),
    );
    return 0;
  }

  if (plan.reason === 'diverged') {
    trackUpgradeEvent(deps.track, 'upgrade_command_failed', {
      current_version: currentVersion,
      source: plan.source,
      stage: 'refresh',
      reason: plan.errorMessage ?? 'diverged',
    });
    logUpgradeWarn(deps.logger, 'manual upgrade diverged', {
      currentVersion,
      source: plan.source,
      error: plan.errorMessage ?? 'diverged',
    });
    deps.stderr.write(`${plan.errorMessage ?? 'diverged'}\n`);
    deps.stdout.write(
      renderManualUpdateMessage(
        currentVersion,
        { version: currentVersion },
        plan.source,
        plan.installCommand,
      ),
    );
    return 1;
  }

  // update-available (and unsupported-with-target, if ever produced)
  if (!plan.target) return 1;

  if (!plan.canAutoInstall || !deps.isInteractive) {
    trackUpgradeEvent(deps.track, 'upgrade_command_manual_command', {
      current_version: currentVersion,
      target_version: plan.target.version,
      source: plan.source,
    });
    logUpgradeInfo(deps.logger, 'manual upgrade command shown', {
      currentVersion,
      targetVersion: plan.target.version,
      source: plan.source,
    });
    deps.stdout.write(
      renderManualUpdateMessage(
        currentVersion,
        plan.target,
        plan.source,
        plan.installCommand,
      ),
    );
    return 0;
  }

  trackUpgradeEvent(deps.track, 'upgrade_command_prompted', {
    current_version: currentVersion,
    target_version: plan.target.version,
    source: plan.source,
  });
  logUpgradeInfo(deps.logger, 'manual upgrade prompted', {
    currentVersion,
    targetVersion: plan.target.version,
    source: plan.source,
  });
  const choice = await deps.promptForInstallChoice({
    currentVersion,
    target: plan.target,
    installCommand: plan.installCommand,
    installSource: plan.source,
    dirty: plan.dirty,
  });
  if (choice === 'skip') {
    trackUpgradeEvent(deps.track, 'upgrade_command_skipped', {
      current_version: currentVersion,
      target_version: plan.target.version,
      source: plan.source,
    });
    logUpgradeInfo(deps.logger, 'manual upgrade skipped', {
      currentVersion,
      targetVersion: plan.target.version,
      source: plan.source,
    });
    return 0;
  }

  try {
    trackUpgradeEvent(deps.track, 'upgrade_command_install_selected', {
      current_version: currentVersion,
      target_version: plan.target.version,
      source: plan.source,
    });
    const useTheatre = deps.isInteractive && deps.stdout.isTTY === true;
    const installOptions = {
      fromMain: plan.fromMain,
      checkoutRoot: plan.checkoutRoot,
    };
    if (useTheatre) {
      await installWithCliTheatre(
        deps,
        currentVersion,
        plan.source,
        plan.target.version,
        installOptions,
      );
    } else {
      await deps.installUpdate(
        plan.source,
        plan.target.version,
        deps.platform,
        installOptions,
      );
    }
    try {
      await deps.updateGuiUseAfterUpgrade();
    } catch (error) {
      logUpgradeWarn(deps.logger, 'post-upgrade sidecar refresh failed', {
        currentVersion,
        targetVersion: plan.target.version,
        source: plan.source,
        error,
      });
      deps.stderr.write(`${formatErrorMessage(error)}\n`);
    }
    trackUpgradeEvent(deps.track, 'upgrade_command_succeeded', {
      current_version: currentVersion,
      target_version: plan.target.version,
      source: plan.source,
    });
    logUpgradeInfo(deps.logger, 'manual upgrade install succeeded', {
      currentVersion,
      targetVersion: plan.target.version,
      source: plan.source,
    });
    deps.stdout.write(
      plan.source === 'github-checkout'
        ? tln('cli.runtime.upgrade.githubUpdated', {
            product: PRODUCT_NAME,
            version: plan.target.version,
          })
        : renderInstallSuccessMessage(plan.target),
    );
    return 0;
  } catch (error) {
    trackUpgradeEvent(deps.track, 'upgrade_command_failed', {
      current_version: currentVersion,
      target_version: plan.target.version,
      source: plan.source,
      stage: 'install',
      reason: formatErrorMessage(error),
    });
    logUpgradeWarn(deps.logger, 'manual upgrade install failed', {
      currentVersion,
      targetVersion: plan.target.version,
      source: plan.source,
      error,
    });
    deps.stderr.write(
      plan.source === 'github-checkout'
        ? tln('cli.runtime.upgrade.githubInstallFailed', {
            product: PRODUCT_NAME,
            reason: formatErrorMessage(error),
          })
        : tln('cli.runtime.upgrade.installFailed', {
            package: NPM_PACKAGE_NAME,
            version: plan.target.version,
            reason: formatErrorMessage(error),
          }),
    );
    return 1;
  }
}

/** Observed install with live stage frame on a TTY (Upgrade Studio language). */
async function installWithCliTheatre(
  deps: UpgradeDeps,
  currentVersion: string,
  source: InstallSource,
  targetVersion: string,
  installOptions: { readonly fromMain?: boolean; readonly checkoutRoot?: string } = {},
): Promise<void> {
  const progress = new CliUpgradeProgressWriter(deps.stdout);
  progress.start();
  progress.update({ source, stage: 'checking', targetVersion });

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const settleOk = (): void => {
      if (settled) return;
      settled = true;
      progress.finish();
      resolve();
    };
    const settleErr = (error: Error): void => {
      if (settled) return;
      settled = true;
      progress.finish();
      reject(error);
    };

    void startObservedUpgradeInstall({
      currentVersion,
      targetVersion,
      source,
      platform: deps.platform,
      fromMain: installOptions.fromMain,
      checkoutRoot: installOptions.checkoutRoot,
      onStage: (stage, detail) => {
        if (stage === 'done') {
          progress.update({ source, stage: 'done', targetVersion });
          settleOk();
          return;
        }
        if (stage === 'failed') {
          progress.update({
            source,
            stage: 'failed',
            targetVersion,
            detail: detail?.trim() || 'install failed',
          });
          settleErr(new Error(detail?.trim() || 'install failed'));
          return;
        }
        progress.update({
          source,
          stage,
          targetVersion,
          detail: detail?.trim() || undefined,
        });
      },
    }).then((started) => {
      if (!started.started) {
        settleErr(
          new Error(
            started.reason === 'lock-held' || started.reason === 'already-active'
              ? 'upgrade already in progress'
              : 'could not start upgrade',
          ),
        );
      }
    }).catch((error: unknown) => {
      settleErr(error instanceof Error ? error : new Error(String(error)));
    });
  });
}

function createDefaultUpgradeDeps(overrides: Partial<UpgradeDeps>): UpgradeDeps {
  const stdout = overrides.stdout ?? process.stdout;
  const stderr = overrides.stderr ?? process.stderr;
  const platform = overrides.platform ?? process.platform;
  const fromMain = overrides.fromMain === true;
  return {
    resolveUpgradePlan:
      overrides.resolveUpgradePlan ??
      ((currentVersion, options) =>
        resolveUpgradePlan(currentVersion, { platform }, { fromMain: options?.fromMain ?? fromMain })),
    installUpdate: overrides.installUpdate ?? installUpdateForeground,
    promptForInstallChoice: overrides.promptForInstallChoice ?? promptForInstallChoice,
    platform,
    stdout,
    stderr,
    isInteractive: overrides.isInteractive ?? (process.stdin.isTTY && process.stdout.isTTY),
    track: overrides.track ?? trackTelemetry,
    logger: overrides.logger ?? log,
    updateGuiUseAfterUpgrade:
      overrides.updateGuiUseAfterUpgrade ?? (() => updateGuiUseAfterUpgrade({ stdout, stderr })),
    fromMain,
  };
}

async function updateGuiUseAfterUpgrade(deps: {
  readonly stdout: WritableLike;
  readonly stderr: WritableLike;
}): Promise<void> {
  const result = await refreshGuiUseAfterUpgrade();
  if (result.browserOk) {
    deps.stdout.write(tln('cli.runtime.upgrade.browserUseUpToDate'));
  }
  if (result.computerOk) {
    deps.stdout.write(tln('cli.runtime.upgrade.cuaUpToDate'));
  }
  for (const warning of result.warnings) {
    if (warning.startsWith('browser-use')) {
      deps.stderr.write(tln('cli.runtime.upgrade.browserUseUpdateFailed'));
      deps.stderr.write(`${warning}\n`);
    } else if (warning.startsWith('CUA')) {
      deps.stderr.write(tln('cli.runtime.upgrade.cuaUpdateFailed'));
      deps.stderr.write(`${warning}\n`);
    } else {
      deps.stderr.write(`${warning}\n`);
    }
  }
}

function formatDisplayVersion(version: string): string {
  return version.startsWith('v') ? version : `v${version}`;
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function trackUpgradeEvent(
  track: UpgradeTrack,
  event: string,
  properties: TelemetryProperties,
): void {
  try {
    track(event, properties);
  } catch {
    // Telemetry must never affect upgrade flow.
  }
}

function logUpgradeInfo(logger: UpgradeLogger, message: string, payload: Record<string, unknown>): void {
  try {
    logger.info(message, payload);
  } catch {
    // Diagnostic logging must never affect upgrade flow.
  }
}

function logUpgradeWarn(logger: UpgradeLogger, message: string, payload: Record<string, unknown>): void {
  try {
    logger.warn(message, payload);
  } catch {
    // Diagnostic logging must never affect upgrade flow.
  }
}
