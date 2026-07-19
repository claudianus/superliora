import { log, type Logger } from '@superliora/sdk';
import { track as trackTelemetry, type TelemetryProperties } from '@superliora/telemetry';
import { updateBrowserUseRuntimes, updateCuaDriver } from '@superliora/gui-use';

import { getHostPackageRoot } from '#/cli/version';
import { tln } from '#/cli/i18n';
import { PRODUCT_NAME } from '#/constant/app';
import {
  installUpdate as installUpdateForeground,
  renderInstallSuccessMessage,
  renderManualUpdateMessage,
} from '#/cli/update/preflight';
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
}

type UpgradeTrack = (event: string, properties?: TelemetryProperties) => void;
type UpgradeLogger = Pick<Logger, 'info' | 'warn'>;

export interface UpgradeDeps {
  readonly resolveUpgradePlan: (currentVersion: string) => Promise<UpgradePlan>;
  readonly installUpdate: (
    source: InstallSource,
    version: string,
    platform: NodeJS.Platform,
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
}

export async function handleUpgrade(
  currentVersion: string,
  overrides: Partial<UpgradeDeps> = {},
): Promise<number> {
  const deps = createDefaultUpgradeDeps(overrides);
  const plan = await deps.resolveUpgradePlan(currentVersion);

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
      tln('cli.runtime.upgrade.checkFailed', { reason: plan.errorMessage ?? 'unknown' }),
    );
    return 1;
  }

  if (plan.reason === 'already-installing') {
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
    deps.stderr.write(`${plan.errorMessage ?? 'diverged'}\n`);
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
    await deps.installUpdate(plan.source, plan.target.version, deps.platform);
    await deps.updateGuiUseAfterUpgrade();
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

function createDefaultUpgradeDeps(overrides: Partial<UpgradeDeps>): UpgradeDeps {
  const stdout = overrides.stdout ?? process.stdout;
  const stderr = overrides.stderr ?? process.stderr;
  const platform = overrides.platform ?? process.platform;
  return {
    resolveUpgradePlan:
      overrides.resolveUpgradePlan ??
      ((currentVersion) => resolveUpgradePlan(currentVersion, { platform })),
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
  };
}

async function updateGuiUseAfterUpgrade(deps: {
  readonly stdout: WritableLike;
  readonly stderr: WritableLike;
}): Promise<void> {
  await Promise.all([
    updateBrowserUseAfterUpgrade(deps),
    updateComputerUseAfterUpgrade(deps),
  ]);
}

async function updateBrowserUseAfterUpgrade(deps: {
  readonly stdout: WritableLike;
  readonly stderr: WritableLike;
}): Promise<void> {
  try {
    const result = await updateBrowserUseRuntimes({ packageRoot: getHostPackageRoot(), quiet: true });
    if (result.ok) {
      deps.stdout.write(tln('cli.runtime.upgrade.browserUseUpToDate'));
      return;
    }
    const detail = result.error ?? firstNonEmpty(result.stderr, result.stdout);
    deps.stderr.write(tln('cli.runtime.upgrade.browserUseUpdateFailed'));
    if (detail.length > 0) deps.stderr.write(`${detail}\n`);
  } catch (error) {
    deps.stderr.write(
      tln('cli.runtime.upgrade.browserUseUpdateFailedDetail', {
        reason: formatErrorMessage(error),
      }),
    );
  }
}

async function updateComputerUseAfterUpgrade(deps: {
  readonly stdout: WritableLike;
  readonly stderr: WritableLike;
}): Promise<void> {
  try {
    const result = await updateCuaDriver({ cwd: getHostPackageRoot(), quiet: true });
    if (result.ok) {
      deps.stdout.write(tln('cli.runtime.upgrade.cuaUpToDate'));
      return;
    }
    const detail = result.error ?? firstNonEmpty(result.stderr, result.stdout);
    deps.stderr.write(tln('cli.runtime.upgrade.cuaUpdateFailed'));
    if (detail.length > 0) deps.stderr.write(`${detail}\n`);
  } catch (error) {
    deps.stderr.write(
      tln('cli.runtime.upgrade.cuaUpdateFailedDetail', {
        reason: formatErrorMessage(error),
      }),
    );
  }
}

function formatDisplayVersion(version: string): string {
  return version.startsWith('v') ? version : `v${version}`;
}

function firstNonEmpty(...values: readonly string[]): string {
  return values.map((value) => value.trim()).find((value) => value.length > 0) ?? '';
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
