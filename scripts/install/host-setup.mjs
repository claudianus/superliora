/**
 * Cross-platform host vibe planner + apply.
 * Windows: Terminal + font + Oh My Posh + shell.
 * macOS / Linux: font + Oh My Posh + zsh/bash profile.
 * Never throws — callers treat this as a sidecar.
 */

import { existsSync, readFileSync } from 'node:fs';

import { CASKAYDIA_FONT_FACE, ensureNerdFont, findNerdFont, userFontsDir } from './ensure-nerd-font.mjs';
import { findOhMyPosh, ohMyPoshThemePath } from './ensure-oh-my-posh.mjs';
import {
  VIBE_PROFILE_MARKER_START,
  defaultPowerShellProfilePaths,
  defaultUnixProfilePaths,
  ensureShellVibe,
  findToolExe,
} from './ensure-shell-vibe.mjs';
import {
  defaultDesktopDir,
  desktopLauncherPath,
  ensureDesktopLauncher,
  linuxDesktopShortcutStatus,
} from './ensure-desktop-launcher.mjs';
import {
  ensureTerminal,
  findWindowsTerminal,
  fragmentPath,
  skipTerminalRequested,
  startMenuShortcutPath,
  windowsShortcutLaunchIsCurrent,
  windowsTerminalSettingsPath,
} from './ensure-terminal.mjs';
import { findWinget } from './ensure-winget.mjs';
import { detectInstallLocale } from './locale.mjs';
import { hostPathExists } from './platform.mjs';
import { t } from './strings.mjs';

export function skipHostSetupRequested(env = process.env, options = {}) {
  if (options.skip === true) return true;
  return env.SUPERLIORA_NO_HOST_SETUP === '1';
}

export function planNeedsApply(plan) {
  return plan?.needsApply === true;
}

function item(id, kind, title, detail, status) {
  return { id, kind, title, detail, status };
}

function fileHasVibeBlock(dest, readText) {
  try {
    const text = readText(dest);
    return typeof text === 'string' && text.includes(VIBE_PROFILE_MARKER_START);
  } catch {
    return false;
  }
}

function defaultReadText(dest) {
  return readFileSync(dest, 'utf8');
}

function profileStatus(paths, readText) {
  const existing = paths.filter((dest) => {
    try {
      return existsSync(dest);
    } catch {
      return false;
    }
  });
  if (existing.some((dest) => fileHasVibeBlock(dest, readText))) return 'refresh';
  return 'needed';
}

function fileStatus(path, isFile) {
  return isFile(path) ? 'refresh' : 'needed';
}

function defaultReadBytes(dest) {
  try {
    return readFileSync(dest);
  } catch {
    return undefined;
  }
}

/**
 * Existing Desktop / Start Menu .lnk files are not necessarily current.
 * Older shortcuts target cmd.exe or the WindowsApps wt.exe stub and
 * open no window on a cold first click. Treat those as `needed` so
 * upgrade + `/host-setup` rewrite them.
 */
function windowsShortcutStatus(path, isFile, readBytes) {
  if (!isFile(path)) return 'needed';
  const payload = readBytes?.(path);
  if (payload == null) return 'refresh';
  return windowsShortcutLaunchIsCurrent(payload) ? 'refresh' : 'needed';
}

/**
 * @returns {{
 *   platform: string,
 *   applicable: boolean,
 *   needsApply: boolean,
 *   items: Array<{
 *     id: string,
 *     kind: 'install'|'write'|'change',
 *     title: string,
 *     detail: string,
 *     status: 'needed'|'present'|'refresh',
 *   }>,
 * }}
 */
export function planHostSetup(options = {}) {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const locale = options.locale ?? detectInstallLocale(env);
  const isFile = options.isFile ?? hostPathExists;
  const readText = options.readText ?? defaultReadText;
  const readBytes = options.readBytes ?? defaultReadBytes;
  const items = [];
  const tr = (key, params) => t(key, params, locale);

  if (platform !== 'win32' && platform !== 'darwin' && platform !== 'linux') {
    return { platform, applicable: false, needsApply: false, items, locale };
  }

  const skipTerminal = skipTerminalRequested(env, { ...options, skip: options.skipTerminal === true });
  const skipVibe = env.SUPERLIORA_NO_SHELL_VIBE === '1' || options.noShellRc === true;
  const skipFont = env.SUPERLIORA_NO_NERD_FONT === '1';
  const skipPosh = env.SUPERLIORA_NO_POSH === '1';
  const skipZoxide = env.SUPERLIORA_NO_ZOXIDE === '1';
  const skipFzf = env.SUPERLIORA_NO_FZF === '1';

  if (platform === 'win32' && !skipTerminal) {
    const winget = findWinget({ env, isFile, which: options.which });
    items.push(item(
      'winget',
      'install',
      'winget (App Installer)',
      'Needed to install Windows Terminal and fonts when Store is missing',
      winget ? 'present' : 'needed',
    ));
    const wt = findWindowsTerminal({ ...options, env, platform, isFile });
    items.push(item(
      'windows-terminal',
      'install',
      'Windows Terminal',
      'Microsoft.WindowsTerminal via winget, then GitHub MSIX',
      wt ? 'present' : 'needed',
    ));
  }

  if (!skipFont) {
    const font = findNerdFont({ ...options, env, platform, isFile });
    items.push(item(
      'nerd-font',
      'install',
      `${CASKAYDIA_FONT_FACE} (Nerd Font)`,
      `User fonts → ${userFontsDir(env, platform)}`,
      font ? 'present' : 'needed',
    ));
  }

  if (!skipPosh) {
    const omp = findOhMyPosh({ ...options, env, platform, isFile, which: options.which });
    items.push(item(
      'oh-my-posh',
      'install',
      'Oh My Posh',
      platform === 'win32'
        ? 'winget JanDeDobbeleer.OhMyPosh, then ~/.superliora/runtime/oh-my-posh'
        : 'GitHub binary → ~/.superliora/runtime/oh-my-posh (Homebrew used if already on PATH)',
      omp ? 'present' : 'needed',
    ));
  }

  if (!skipVibe && !skipZoxide) {
    const zoxide = findToolExe('zoxide', { ...options, env, platform, isFile, which: options.which });
    items.push(item(
      'zoxide',
      'install',
      'zoxide',
      'Directory jumper, user-local runtime if not on PATH',
      zoxide ? 'present' : 'needed',
    ));
  }

  if (!skipVibe && !skipFzf) {
    const fzf = findToolExe('fzf', { ...options, env, platform, isFile, which: options.which });
    items.push(item(
      'fzf',
      'install',
      'fzf',
      'Fuzzy finder, user-local runtime if not on PATH',
      fzf ? 'present' : 'needed',
    ));
  }

  if (platform === 'win32' && !skipVibe) {
    items.push(item(
      'terminal-icons',
      'install',
      'Terminal-Icons (PowerShell)',
      'PSGallery CurrentUser module when reachable',
      'refresh',
    ));
  }

  if (!skipPosh) {
    const themePath = ohMyPoshThemePath(env, platform);
    items.push(item(
      'omp-theme',
      'write',
      'Oh My Posh Neon Noir theme',
      themePath,
      fileStatus(themePath, isFile),
    ));
  }

  if (!skipVibe) {
    const profiles = platform === 'win32'
      ? defaultPowerShellProfilePaths(env)
      : defaultUnixProfilePaths(env);
    items.push(item(
      'shell-profile',
      'write',
      platform === 'win32'
        ? tr('install.host.item.shellProfileWin')
        : tr('install.host.item.shellProfileUnix'),
      profiles.join(', '),
      profileStatus(profiles, readText),
    ));
  }

  if (platform === 'win32' && !skipTerminal) {
    const fragment = fragmentPath(env);
    items.push(item(
      'wt-fragment',
      'write',
      tr('install.host.item.wtFragment'),
      fragment,
      fileStatus(fragment, isFile),
    ));
    const shortcut = startMenuShortcutPath(env);
    items.push(item(
      'start-menu',
      'write',
      tr('install.host.item.startMenu'),
      shortcut,
      windowsShortcutStatus(shortcut, isFile, readBytes),
    ));
    const settings = windowsTerminalSettingsPath(env);
    items.push(item(
      'wt-settings',
      'change',
      tr('install.host.item.wtSettings'),
      'Neon Noir scheme, CaskaydiaCove NF, acrylic, SuperLiora Shell default, Win+` quake if missing',
      isFile(settings) ? 'refresh' : 'needed',
    ));
    items.push(item(
      'default-terminal',
      'change',
      tr('install.host.item.defaultTerminal'),
      'Promote Windows Terminal only when empty or Console Host',
      'refresh',
    ));
  }

  if (platform !== 'win32' || !skipTerminal) {
    const launcher = desktopLauncherPath({ ...options, env, platform });
    const shortcutStatus = platform === 'linux'
      ? linuxDesktopShortcutStatus(launcher, isFile, readText)
      : platform === 'win32'
        ? windowsShortcutStatus(launcher, isFile, readBytes)
        : fileStatus(launcher, isFile);
    items.push(item(
      'desktop-shortcut',
      'write',
      tr('install.host.item.desktopShortcut'),
      platform === 'win32'
        ? tr('install.host.detail.desktopWt', { path: launcher })
        : tr('install.host.detail.desktopTerm', { path: launcher }),
      shortcutStatus,
    ));
  }

  if (platform === 'win32' && !skipVibe) {
    items.push(item(
      'execution-policy',
      'change',
      'PowerShell execution policy (CurrentUser)',
      options.allowExecutionPolicy === true
        ? 'Set RemoteSigned only when current policy is Restricted'
        : 'Opt-in only: pass --allow-execution-policy (or SUPERLIORA_ALLOW_EXECUTION_POLICY=1); Restricted is left untouched by default',
      options.allowExecutionPolicy === true ? 'refresh' : 'needed',
    ));
  }

  if (platform === 'linux' && !skipFont) {
    items.push(item(
      'font-cache',
      'change',
      'fontconfig cache',
      `fc-cache -f ${userFontsDir(env, platform)}`,
      findNerdFont({ ...options, env, platform, isFile }) ? 'refresh' : 'needed',
    ));
  }

  const needsApply = items.some((entry) => entry.status === 'needed');
  return { platform, applicable: true, needsApply, items, locale };
}

export function formatHostSetupPlan(plan) {
  const locale = plan.locale ?? detectInstallLocale();
  const lines = [
    t('install.host.heading', { platform: plan.platform }, locale),
    plan.needsApply
      ? t('install.host.needed', undefined, locale)
      : t('install.host.refresh', undefined, locale),
  ];
  const groups = [
    ['install', t('install.host.group.install', undefined, locale)],
    ['write', t('install.host.group.write', undefined, locale)],
    ['change', t('install.host.group.change', undefined, locale)],
  ];
  for (const [kind, label] of groups) {
    const rows = plan.items.filter((entry) => entry.kind === kind);
    if (rows.length === 0) continue;
    lines.push('');
    lines.push(label);
    for (const row of rows) {
      lines.push(`  [${row.status}] ${row.title}`);
      if (row.detail) lines.push(`           ${row.detail}`);
    }
  }
  return lines.join('\n');
}

/**
 * @returns {Promise<{
 *   skipped?: boolean,
 *   ok?: boolean,
 *   platform?: string,
 *   plan?: ReturnType<typeof planHostSetup>,
 *   installed?: boolean,
 *   nerdFontInstalled?: boolean,
 *   ohMyPoshInstalled?: boolean,
 *   zoxideInstalled?: boolean,
 *   fzfInstalled?: boolean,
 *   profilePatched?: boolean,
 *   themeWritten?: boolean,
 *   fragmentWritten?: boolean,
 *   shortcutWritten?: boolean,
 *   desktopShortcutWritten?: boolean,
 *   settingsMerged?: boolean,
 *   promotedDefault?: boolean,
 *   wingetBootstrapped?: boolean,
 *   message?: string,
 * }>}
 */
export async function ensureHostSetup(options = {}) {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const plan = options.plan ?? planHostSetup(options);
  if (skipHostSetupRequested(env, options) || !plan.applicable) {
    return { skipped: true, ok: true, platform, plan };
  }

  const skipPackages = options.skipPackages === true;
  const noShellRc = options.noShellRc === true;
  const skipTerminal = skipTerminalRequested(env, { ...options, skip: options.skipTerminal === true });

  if (platform === 'win32' && !skipTerminal) {
    const result = await ensureTerminal({
      ...options,
      skip: false,
      skipPackages,
      noShellRc,
    });
    // Upgrade refresh (skipPackages) must not call GetFolderPath — that
    // PowerShell COM probe can sit until the Windows runner times out.
    // Still rewrite Desktop using USERPROFILE\Desktop so existing installs
    // pick up conhost + superliora-wt.ps1 without a full reinstall.
    const desktopOpts = skipPackages && !options.desktopDir
      ? { ...options, desktopDir: defaultDesktopDir(env, platform) }
      : options;
    const desktop = await writeDesktopLauncher(desktopOpts, result.wtPath);
    return { ...result, platform, plan, desktopShortcutWritten: desktop.written === true };
  }

  let nerdFontInstalled = false;
  if (env.SUPERLIORA_NO_NERD_FONT !== '1') {
    try {
      const font = await ensureNerdFont({ ...options, skipPackages });
      nerdFontInstalled = font.installed === true;
    } catch {
      nerdFontInstalled = false;
    }
  }

  let vibe = {};
  if (!noShellRc && env.SUPERLIORA_NO_SHELL_VIBE !== '1') {
    try {
      vibe = await ensureShellVibe({ ...options, skipPackages });
    } catch (error) {
      vibe = { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  const desktop = await writeDesktopLauncher(options);
  return {
    skipped: false,
    ok: vibe.ok !== false,
    platform,
    plan,
    nerdFontInstalled,
    ohMyPoshInstalled: vibe.ohMyPoshInstalled === true,
    zoxideInstalled: vibe.zoxideInstalled === true,
    fzfInstalled: vibe.fzfInstalled === true,
    profilePatched: vibe.profilePatched === true,
    themeWritten: vibe.themeWritten === true,
    desktopShortcutWritten: desktop.written === true,
    message: vibe.message,
  };
}

async function writeDesktopLauncher(options, wtPath) {
  try {
    return await ensureDesktopLauncher({
      ...options,
      wtPath,
    });
  } catch (error) {
    return {
      skipped: false,
      written: false,
      ok: true,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
