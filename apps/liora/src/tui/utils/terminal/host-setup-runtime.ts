/**
 * Load installer helpers for /host-setup, install, upgrade, and startup confirm.
 * apps/liora must not import agent-core; scripts stay a dynamic import.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { tryGetHostPackageRoot } from '#/cli/version';
import { ttui } from '#/tui/utils/tui-i18n';
import type { HostSetupPlan } from '#/tui/components/dialogs/host-setup/host-setup-confirm';

export type EnsureHostSetupResult = {
  readonly ok?: boolean;
  readonly skipped?: boolean;
  readonly installed?: boolean;
  readonly fragmentWritten?: boolean;
  readonly shortcutWritten?: boolean;
  readonly promotedDefault?: boolean;
  readonly wingetBootstrapped?: boolean;
  readonly nerdFontInstalled?: boolean;
  readonly ohMyPoshInstalled?: boolean;
  readonly zoxideInstalled?: boolean;
  readonly fzfInstalled?: boolean;
  readonly profilePatched?: boolean;
  readonly themeWritten?: boolean;
  readonly settingsMerged?: boolean;
  readonly message?: string;
};

export type HostSetupModule = {
  planHostSetup: (opts?: Record<string, unknown>) => HostSetupPlan;
  formatHostSetupPlan: (plan: HostSetupPlan) => string;
  ensureHostSetup: (opts?: {
    skipPackages?: boolean;
    noShellRc?: boolean;
    skip?: boolean;
  }) => Promise<EnsureHostSetupResult>;
};

function resolveInstallScript(packageRoot: string, fileName: string): string | undefined {
  const candidates = [
    join(packageRoot, 'scripts/install', fileName),
    join(packageRoot, '..', 'scripts/install', fileName),
    join(packageRoot, '..', '..', 'scripts/install', fileName),
  ];
  return candidates.find((path) => existsSync(path));
}

export async function loadHostSetupModule(): Promise<HostSetupModule | undefined> {
  const root = tryGetHostPackageRoot();
  if (root === undefined) return undefined;
  const script = resolveInstallScript(root, 'host-setup.mjs');
  if (script === undefined) return undefined;
  return (await import(pathToFileURL(script).href)) as HostSetupModule;
}

export async function runHostSetupApply(opts?: {
  skipPackages?: boolean;
}): Promise<EnsureHostSetupResult | undefined> {
  const mod = await loadHostSetupModule();
  if (mod === undefined) return undefined;
  return mod.ensureHostSetup(opts);
}

export function formatHostSetupStatus(plan: HostSetupPlan): string {
  const lines = [
    `platform=${plan.platform}`,
    `needsApply=${plan.needsApply ? 'yes' : 'no'}`,
    ...plan.items.map((item) => `${item.kind}:${item.id}=${item.status}`),
  ];
  if (plan.needsApply) {
    lines.push(ttui('tui.hostSetup.applyHint'));
  }
  return lines.join('\n');
}

export function formatHostSetupApply(result: EnsureHostSetupResult): string {
  if (result.skipped) return ttui('tui.hostSetup.skipped');
  const bits = [
    result.installed ? 'terminal' : undefined,
    result.wingetBootstrapped ? 'winget' : undefined,
    result.nerdFontInstalled ? 'nerd-font' : undefined,
    result.ohMyPoshInstalled ? 'oh-my-posh' : undefined,
    result.zoxideInstalled ? 'zoxide' : undefined,
    result.fzfInstalled ? 'fzf' : undefined,
    result.profilePatched ? 'shell-profile' : undefined,
    result.themeWritten ? 'omp-theme' : undefined,
    result.fragmentWritten ? 'profile' : undefined,
    result.shortcutWritten ? 'shortcut' : undefined,
    result.promotedDefault ? 'default-terminal' : undefined,
    result.settingsMerged ? 'wt-defaults' : undefined,
  ].filter((bit): bit is string => bit !== undefined);
  const summary = bits.length > 0 ? bits.join(', ') : 'refreshed';
  const suffix = result.message ? `\n${result.message}` : '';
  if (result.ok === false) {
    return `${ttui('tui.hostSetup.applyFailed')}\n${summary}${suffix}`;
  }
  return `${ttui('tui.hostSetup.applyOk')}\n${summary}${suffix}`;
}
