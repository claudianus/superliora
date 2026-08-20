/**
 * Automatic updates settings glance — tui.toml + env posture (SSOT §9.2).
 */

import { getTuiConfigPath } from '#/tui/config';
import { isRolloutBypassedByExperimentalEnv } from '#/cli/update/rollout';
import { ttui } from '#/tui/utils/tui-i18n';

export const AUTO_UPDATE_DISABLE_ENV = 'SUPERLIORA_NO_AUTO_UPDATE';
export const AUTO_UPDATE_DISABLE_ENV_LEGACY = 'KIMI_CLI_NO_AUTO_UPDATE';
export const ROLLOUT_BYPASS_ENV = 'SUPERLIORA_EXPERIMENTAL_FLAG';

export const UPGRADE_AUTO_INSTALL_TIP =
  'tui.toml [upgrade] auto_install = true|false · /reload tui after a manual edit.';

export const UPGRADE_MANUAL_TIP =
  'Manual update: /update or /upgrade opens Upgrade Studio (published releases; --main for tip of origin/main).';

export const UPGRADE_ENV_TIP =
  `${AUTO_UPDATE_DISABLE_ENV}=1 fully disables preflight (check + auto-install + prompt). Unset it so tui.toml [upgrade].auto_install can work.`;

export interface UpgradeNoticeLike {
  readonly currentVersion: string;
  readonly targetVersion: string;
  readonly installCommand: string;
}

export interface UpgradeGlanceInput {
  readonly autoInstall: boolean;
  readonly envDisabled: boolean;
  readonly envDisableValue?: string;
  readonly effectiveAutoInstall: boolean;
  readonly version: string;
  readonly updateNotice?: UpgradeNoticeLike | null;
  readonly rolloutBypass: boolean;
  readonly configPath: string;
}

function envTruthy(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes((value ?? '').trim().toLowerCase());
}

function firstTruthyEnv(env: NodeJS.ProcessEnv, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value !== undefined && value.length > 0 && envTruthy(value)) return `${key}=${value}`;
  }
  return undefined;
}

export function isAutoUpdateDisabledByEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    envTruthy(env[AUTO_UPDATE_DISABLE_ENV]) || envTruthy(env[AUTO_UPDATE_DISABLE_ENV_LEGACY])
  );
}

export function loadUpgradeGlance(input: {
  readonly autoInstall: boolean;
  readonly version: string;
  readonly updateNotice?: UpgradeNoticeLike | null;
  readonly env?: NodeJS.ProcessEnv;
  readonly configPath?: string;
}): UpgradeGlanceInput {
  const env = input.env ?? process.env;
  const envDisabled = isAutoUpdateDisabledByEnv(env);
  const envDisableValue = firstTruthyEnv(env, [
    AUTO_UPDATE_DISABLE_ENV,
    AUTO_UPDATE_DISABLE_ENV_LEGACY,
  ]);
  return {
    autoInstall: input.autoInstall,
    envDisabled,
    envDisableValue,
    effectiveAutoInstall: !envDisabled && input.autoInstall,
    version: input.version,
    updateNotice: input.updateNotice ?? null,
    rolloutBypass: isRolloutBypassedByExperimentalEnv(env),
    configPath: input.configPath ?? getTuiConfigPath(),
  };
}

export function formatAutoInstallConfigLine(glance: UpgradeGlanceInput): string {
  return glance.autoInstall
    ? ttui('tui.upgrade.settings.autoOn')
    : ttui('tui.upgrade.settings.autoOff');
}

export function formatEffectiveAutoUpdateLine(glance: UpgradeGlanceInput): string {
  if (glance.envDisabled) {
    return ttui('tui.upgrade.settings.effectiveEnvOff');
  }
  if (glance.effectiveAutoInstall) {
    return ttui('tui.upgrade.settings.effectiveOn');
  }
  return ttui('tui.upgrade.settings.effectiveOff');
}

export function formatUpdateNoticeLine(notice: UpgradeNoticeLike | null | undefined): string | undefined {
  if (notice === null || notice === undefined) return undefined;
  return ttui('tui.upgrade.settings.pending', {
    current: notice.currentVersion,
    target: notice.targetVersion,
  });
}

export function buildUpgradeSettingsLines(glance: UpgradeGlanceInput): readonly string[] {
  const noticeLine = formatUpdateNoticeLine(glance.updateNotice);
  const envLine = glance.envDisabled
    ? ttui('tui.upgrade.settings.envDisabled', {
      value: glance.envDisableValue ?? `${AUTO_UPDATE_DISABLE_ENV}=1`,
    })
    : ttui('tui.upgrade.settings.envUnset', { name: AUTO_UPDATE_DISABLE_ENV });

  const rolloutLine = glance.rolloutBypass
    ? ttui('tui.upgrade.settings.rolloutBypass', { name: ROLLOUT_BYPASS_ENV })
    : ttui('tui.upgrade.settings.rolloutNormal', { name: ROLLOUT_BYPASS_ENV });

  return [
    ttui('tui.upgrade.settings.headerAuto'),
    ttui('tui.upgrade.settings.posture'),
    '',
    ttui('tui.upgrade.settings.headerStatus'),
    ttui('tui.upgrade.settings.runningVersion', { version: glance.version }),
    formatAutoInstallConfigLine(glance),
    formatEffectiveAutoUpdateLine(glance),
    ttui('tui.upgrade.settings.config', { path: glance.configPath }),
    envLine,
    rolloutLine,
    ...(noticeLine !== undefined ? [noticeLine] : []),
    ...(glance.updateNotice !== null && glance.updateNotice !== undefined
      ? [ttui('tui.upgrade.settings.install', { command: glance.updateNotice.installCommand })]
      : []),
    '',
    ttui('tui.upgrade.settings.headerChange'),
    ttui('tui.upgrade.settings.editToml'),
    ttui('tui.upgrade.settings.reload'),
    '',
    ttui('tui.upgrade.settings.headerManual'),
    ttui('tui.upgrade.settings.slash'),
    ttui('tui.upgrade.settings.cli'),
    ttui('tui.upgrade.settings.settings'),
    ttui('tui.upgrade.settings.badge'),
    '',
    ttui('tui.upgrade.settings.headerTips'),
    ttui('tui.upgrade.settings.tipEnv', { name: AUTO_UPDATE_DISABLE_ENV }),
    ttui('tui.upgrade.settings.tipManaged'),
    ttui('tui.upgrade.settings.tipSources'),
    ttui('tui.upgrade.settings.tipSuccess'),
    ttui('tui.upgrade.settings.tipStart'),
    ttui('tui.upgrade.settings.tipDev'),
  ];
}
