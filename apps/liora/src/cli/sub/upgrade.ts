import { log, type Logger } from '@superliora/sdk';
import { track as trackTelemetry, type TelemetryProperties } from '@superliora/telemetry';
import { updateBrowserUseRuntimes, updateCuaDriver } from '@superliora/gui-use';

import { getHostPackageRoot } from '#/cli/version';
import { t, tln } from '#/cli/i18n';
import { refreshUpdateCache } from '#/cli/update/refresh';
import { selectUpdateTarget } from '#/cli/update/select';
import { detectInstallSource } from '#/cli/update/source';
import { PRODUCT_NAME } from '#/constant/app';
import {
  canAutoInstall,
  installCommandFor,
  installUpdate as installUpdateForeground,
  renderInstallSuccessMessage,
  renderManualUpdateMessage,
} from '#/cli/update/preflight';
import { refreshGitCheckoutUpdateTarget } from '#/cli/update/git-checkout';
import {
  promptForInstallChoice,
  type InstallPromptChoiceValue,
  type InstallPromptOptions,
} from '#/cli/update/prompt';
import {
  NPM_PACKAGE_NAME,
  type InstallSource,
  type UpdateCache,
} from '#/cli/update/types';

interface WritableLike {
  write(chunk: string): boolean;
}

type UpgradeTrack = (event: string, properties?: TelemetryProperties) => void;
type UpgradeLogger = Pick<Logger, 'info' | 'warn'>;

export interface UpgradeDeps {
  readonly refreshUpdateCache: () => Promise<UpdateCache>;
  readonly detectInstallSource: () => Promise<InstallSource>;
  readonly refreshGitCheckoutUpdateTarget: () => Promise<{ readonly version: string } | null>;
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
  const source = await deps.detectInstallSource().catch(() => 'unsupported' as const);
  if (source === 'github-checkout') {
    return handleGithubCheckoutUpgrade(currentVersion, deps, source);
  }

  let cache: UpdateCache;
  try {
    cache = await deps.refreshUpdateCache();
  } catch (error) {
    const reason = formatErrorMessage(error);
    trackUpgradeEvent(deps.track, 'upgrade_command_failed', {
      current_version: currentVersion,
      stage: 'refresh',
      reason,
    });
    logUpgradeWarn(deps.logger, 'manual upgrade check failed', {
      currentVersion,
      error,
    });
    deps.stderr.write(tln('cli.runtime.upgrade.checkFailed', { reason }));
    return 1;
  }

  const target = selectUpdateTarget(currentVersion, cache.latest);
  if (target === null) {
    trackUpgradeEvent(deps.track, 'upgrade_command_no_update', {
      current_version: currentVersion,
    });
    logUpgradeInfo(deps.logger, 'manual upgrade no update', {
      currentVersion,
    });
    deps.stdout.write(
      tln('cli.runtime.upgrade.alreadyUpToDate', {
        product: PRODUCT_NAME,
        version: formatDisplayVersion(currentVersion),
      }),
    );
    return 0;
  }

  const installCommand = installCommandFor(source, target.version, deps.platform);
  if (!canAutoInstall(source, deps.platform) || !deps.isInteractive) {
    trackUpgradeEvent(deps.track, 'upgrade_command_manual_command', {
      current_version: currentVersion,
      target_version: target.version,
      source,
    });
    logUpgradeInfo(deps.logger, 'manual upgrade command shown', {
      currentVersion,
      targetVersion: target.version,
      source,
    });
    deps.stdout.write(renderManualUpdateMessage(currentVersion, target, source, installCommand));
    return 0;
  }

  trackUpgradeEvent(deps.track, 'upgrade_command_prompted', {
    current_version: currentVersion,
    target_version: target.version,
    source,
  });
  logUpgradeInfo(deps.logger, 'manual upgrade prompted', {
    currentVersion,
    targetVersion: target.version,
    source,
  });
  const choice = await deps.promptForInstallChoice({
    currentVersion,
    target,
    installCommand,
    installSource: source,
  });
  if (choice === 'skip') {
    trackUpgradeEvent(deps.track, 'upgrade_command_skipped', {
      current_version: currentVersion,
      target_version: target.version,
      source,
    });
    logUpgradeInfo(deps.logger, 'manual upgrade skipped', {
      currentVersion,
      targetVersion: target.version,
      source,
    });
    return 0;
  }

  try {
    trackUpgradeEvent(deps.track, 'upgrade_command_install_selected', {
      current_version: currentVersion,
      target_version: target.version,
      source,
    });
    await deps.installUpdate(source, target.version, deps.platform);
    await deps.updateGuiUseAfterUpgrade();
    trackUpgradeEvent(deps.track, 'upgrade_command_succeeded', {
      current_version: currentVersion,
      target_version: target.version,
      source,
    });
    logUpgradeInfo(deps.logger, 'manual upgrade install succeeded', {
      currentVersion,
      targetVersion: target.version,
      source,
    });
    deps.stdout.write(renderInstallSuccessMessage(target));
    return 0;
  } catch (error) {
    trackUpgradeEvent(deps.track, 'upgrade_command_failed', {
      current_version: currentVersion,
      target_version: target.version,
      source,
      stage: 'install',
      reason: formatErrorMessage(error),
    });
    logUpgradeWarn(deps.logger, 'manual upgrade install failed', {
      currentVersion,
      targetVersion: target.version,
      source,
      error,
    });
    deps.stderr.write(
      tln('cli.runtime.upgrade.installFailed', {
        package: NPM_PACKAGE_NAME,
        version: target.version,
        reason: formatErrorMessage(error),
      }),
    );
    return 1;
  }
}

async function handleGithubCheckoutUpgrade(
  currentVersion: string,
  deps: UpgradeDeps,
  source: InstallSource,
): Promise<number> {
  let target: { readonly version: string } | null;
  try {
    target = await deps.refreshGitCheckoutUpdateTarget();
  } catch (error) {
    const reason = formatErrorMessage(error);
    trackUpgradeEvent(deps.track, 'upgrade_command_failed', {
      current_version: currentVersion,
      source,
      stage: 'refresh',
      reason,
    });
    logUpgradeWarn(deps.logger, 'manual git checkout upgrade check failed', {
      currentVersion,
      error,
    });
    deps.stderr.write(tln('cli.runtime.upgrade.githubCheckFailed', { reason }));
    return 1;
  }

  if (target === null) {
    trackUpgradeEvent(deps.track, 'upgrade_command_no_update', {
      current_version: currentVersion,
      source,
    });
    logUpgradeInfo(deps.logger, 'manual git checkout upgrade no update', {
      currentVersion,
      source,
    });
    deps.stdout.write(tln('cli.runtime.upgrade.githubAlreadyUpToDate', { product: PRODUCT_NAME }));
    return 0;
  }

  const installCommand = installCommandFor(source, target.version, deps.platform);
  if (!canAutoInstall(source, deps.platform) || !deps.isInteractive) {
    trackUpgradeEvent(deps.track, 'upgrade_command_manual_command', {
      current_version: currentVersion,
      target_version: target.version,
      source,
    });
    logUpgradeInfo(deps.logger, 'manual git checkout upgrade command shown', {
      currentVersion,
      targetVersion: target.version,
      source,
    });
    deps.stdout.write(renderManualUpdateMessage(currentVersion, target, source, installCommand));
    return 0;
  }

  trackUpgradeEvent(deps.track, 'upgrade_command_prompted', {
    current_version: currentVersion,
    target_version: target.version,
    source,
  });
  const choice = await deps.promptForInstallChoice({
    currentVersion,
    target,
    installCommand,
    installSource: source,
  });
  if (choice === 'skip') {
    trackUpgradeEvent(deps.track, 'upgrade_command_skipped', {
      current_version: currentVersion,
      target_version: target.version,
      source,
    });
    return 0;
  }

  try {
    trackUpgradeEvent(deps.track, 'upgrade_command_install_selected', {
      current_version: currentVersion,
      target_version: target.version,
      source,
    });
    await deps.installUpdate(source, target.version, deps.platform);
    await deps.updateGuiUseAfterUpgrade();
    trackUpgradeEvent(deps.track, 'upgrade_command_succeeded', {
      current_version: currentVersion,
      target_version: target.version,
      source,
    });
    logUpgradeInfo(deps.logger, 'manual git checkout upgrade install succeeded', {
      currentVersion,
      targetVersion: target.version,
      source,
    });
    deps.stdout.write(
      tln('cli.runtime.upgrade.githubUpdated', {
        product: PRODUCT_NAME,
        version: target.version,
      }),
    );
    return 0;
  } catch (error) {
    trackUpgradeEvent(deps.track, 'upgrade_command_failed', {
      current_version: currentVersion,
      target_version: target.version,
      source,
      stage: 'install',
      reason: formatErrorMessage(error),
    });
    logUpgradeWarn(deps.logger, 'manual git checkout upgrade install failed', {
      currentVersion,
      targetVersion: target.version,
      source,
      error,
    });
    deps.stderr.write(
      tln('cli.runtime.upgrade.githubInstallFailed', {
        product: PRODUCT_NAME,
        reason: formatErrorMessage(error),
      }),
    );
    return 1;
  }
}

function createDefaultUpgradeDeps(overrides: Partial<UpgradeDeps>): UpgradeDeps {
  const stdout = overrides.stdout ?? process.stdout;
  const stderr = overrides.stderr ?? process.stderr;
  return {
    refreshUpdateCache: overrides.refreshUpdateCache ?? (() => refreshUpdateCache()),
    detectInstallSource: overrides.detectInstallSource ?? (() => detectInstallSource()),
    refreshGitCheckoutUpdateTarget:
      overrides.refreshGitCheckoutUpdateTarget ?? (() => refreshGitCheckoutUpdateTarget()),
    installUpdate: overrides.installUpdate ?? installUpdateForeground,
    promptForInstallChoice: overrides.promptForInstallChoice ?? promptForInstallChoice,
    platform: overrides.platform ?? process.platform,
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
