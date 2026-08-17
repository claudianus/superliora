/**
 * Load installer helpers for `/windows-setup` and conhost auto-apply.
 * apps/liora must not import agent-core; scripts stay a dynamic import.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { tryGetHostPackageRoot } from '#/cli/version';
import { ttui } from '#/tui/utils/tui-i18n';

export type TerminalProbe = {
  readonly applicable: boolean;
  readonly host: string;
  readonly status: string;
  readonly inWindowsTerminal: boolean;
  readonly hasWt: boolean;
  readonly hasNerdFont: boolean;
  readonly hasOhMyPosh?: boolean;
};

export type EnsureTerminalResult = {
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
  readonly settingsMerged?: boolean;
  readonly message?: string;
};

export type TerminalInstallModule = {
  probeWindowsTerminalEnv: (opts?: { platform?: NodeJS.Platform }) => TerminalProbe;
  ensureTerminal: (opts?: { skipPackages?: boolean }) => Promise<EnsureTerminalResult>;
};

function resolveInstallScript(packageRoot: string): string | undefined {
  const candidates = [
    join(packageRoot, 'scripts/install/ensure-terminal.mjs'),
    join(packageRoot, '..', 'scripts/install/ensure-terminal.mjs'),
    join(packageRoot, '..', '..', 'scripts/install/ensure-terminal.mjs'),
  ];
  return candidates.find((path) => existsSync(path));
}

export async function loadTerminalModule(): Promise<TerminalInstallModule | undefined> {
  const root = tryGetHostPackageRoot();
  if (root === undefined) return undefined;
  const script = resolveInstallScript(root);
  if (script === undefined) return undefined;
  return (await import(pathToFileURL(script).href)) as TerminalInstallModule;
}

export async function runWindowsSetupApply(): Promise<EnsureTerminalResult | undefined> {
  const mod = await loadTerminalModule();
  if (mod === undefined) return undefined;
  return mod.ensureTerminal();
}

export function formatWindowsSetupStatus(probe: TerminalProbe): string {
  const lines = [
    `host=${probe.host}`,
    `status=${probe.status}`,
    `windowsTerminal=${probe.inWindowsTerminal ? 'yes' : 'no'}`,
    `wt.exe=${probe.hasWt ? 'yes' : 'no'}`,
    `nerdFont=${probe.hasNerdFont ? 'yes' : 'no'}`,
    `ohMyPosh=${probe.hasOhMyPosh ? 'yes' : 'no'}`,
  ];
  if (probe.status === 'degraded') {
    lines.push(ttui('tui.windowsSetup.applyHint'));
  }
  return lines.join('\n');
}

export function formatWindowsSetupApply(result: EnsureTerminalResult): string {
  if (result.skipped) return ttui('tui.windowsSetup.skipped');
  const bits = [
    result.installed ? 'terminal' : undefined,
    result.wingetBootstrapped ? 'winget' : undefined,
    result.nerdFontInstalled ? 'nerd-font' : undefined,
    result.ohMyPoshInstalled ? 'oh-my-posh' : undefined,
    result.zoxideInstalled ? 'zoxide' : undefined,
    result.fzfInstalled ? 'fzf' : undefined,
    result.profilePatched ? 'shell-profile' : undefined,
    result.fragmentWritten ? 'profile' : undefined,
    result.shortcutWritten ? 'shortcut' : undefined,
    result.promotedDefault ? 'default-terminal' : undefined,
    result.settingsMerged ? 'wt-defaults' : undefined,
  ].filter((bit): bit is string => bit !== undefined);
  const summary = bits.length > 0 ? bits.join(', ') : 'refreshed';
  const suffix = result.message ? `\n${result.message}` : '';
  if (result.ok === false) {
    return `${ttui('tui.windowsSetup.applyFailed')}\n${summary}${suffix}`;
  }
  return `${ttui('tui.windowsSetup.applyOk')}\n${summary}${suffix}`;
}
