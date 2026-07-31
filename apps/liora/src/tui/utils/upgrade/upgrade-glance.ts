/**
 * Automatic updates settings glance — tui.toml + env posture (SSOT §9.2).
 */

import { getTuiConfigPath } from '#/tui/config';
import { isRolloutBypassedByExperimentalEnv } from '#/cli/update/rollout';

export const AUTO_UPDATE_DISABLE_ENV = 'SUPERLIORA_NO_AUTO_UPDATE';
export const AUTO_UPDATE_DISABLE_ENV_LEGACY = 'KIMI_CLI_NO_AUTO_UPDATE';
export const ROLLOUT_BYPASS_ENV = 'SUPERLIORA_EXPERIMENTAL_FLAG';

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
    ? 'tui.toml auto_install: ON — background install when preflight finds update'
    : 'tui.toml auto_install: OFF — show install prompt instead';
}

export function formatEffectiveAutoUpdateLine(glance: UpgradeGlanceInput): string {
  if (glance.envDisabled) {
    return 'Effective: OFF — env disables all update preflight work';
  }
  if (glance.effectiveAutoInstall) {
    return 'Effective: ON — passive check + background install when eligible';
  }
  return 'Effective: OFF — checks may run; installs require prompt (/upgrade)';
}

export function formatUpdateNoticeLine(notice: UpgradeNoticeLike | null | undefined): string | undefined {
  if (notice === null || notice === undefined) return undefined;
  return `Pending update: ${notice.currentVersion} → ${notice.targetVersion}`;
}

export function buildUpgradeSettingsLines(glance: UpgradeGlanceInput): readonly string[] {
  const noticeLine = formatUpdateNoticeLine(glance.updateNotice);
  const envLine = glance.envDisabled
    ? `Env: ${glance.envDisableValue ?? `${AUTO_UPDATE_DISABLE_ENV}=1`} — no check, install, or prompt`
    : `Env: ${AUTO_UPDATE_DISABLE_ENV} unset — tui.toml controls auto-install`;

  const rolloutLine = glance.rolloutBypass
    ? `Env: ${ROLLOUT_BYPASS_ENV} set — staged rollout bypass (newest always visible)`
    : `Env: ${ROLLOUT_BYPASS_ENV} unset — normal staged rollout`;

  return [
    '── Automatic updates (read-only) ────────────',
    'CLI background upgrade posture — Sovereign Reform §9.2.',
    '',
    '── Status (live) ────────────────────────────',
    `Running version: ${glance.version}`,
    formatAutoInstallConfigLine(glance),
    formatEffectiveAutoUpdateLine(glance),
    `Config: ${glance.configPath}`,
    envLine,
    rolloutLine,
    ...(noticeLine !== undefined ? [noticeLine] : []),
    ...(glance.updateNotice !== null && glance.updateNotice !== undefined
      ? [`Install: ${glance.updateNotice.installCommand}`]
      : []),
    '',
    '── Change auto-install ──────────────────────',
    '  tui.toml [upgrade] auto_install = true | false',
    '  /reload tui                    apply after manual edit',
    '',
    '── Manual upgrade ───────────────────────────',
    '  /upgrade                       check + install dialog',
    '  Header badge                   pending update when preflight finds one',
    '',
    '── Tips ─────────────────────────────────────',
    `· ${AUTO_UPDATE_DISABLE_ENV} wins over auto_install and experimental flags`,
    '· GitHub checkout / npm / native installs differ in canAutoInstall',
    '· Background success notice may appear on next launch',
    '· Dev builds often set NO_AUTO_UPDATE in scripts/dev.mjs',
  ];
}
