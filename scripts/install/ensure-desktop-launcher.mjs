/**
 * Best-effort SuperLiora desktop launcher.
 * Windows: .lnk that opens Windows Terminal on the SuperLiora profile (runs liora).
 * macOS: .app that opens Terminal.app (Kitty/Ghostty if present) and runs liora.
 * Linux: helper script opens a real terminal, then a .desktop + applications entry.
 * Never throws for missing Desktop / gio / wt — callers treat this as a sidecar.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { materializeBrandShortcutIcon } from './brand-icon.mjs';
import {
  findWindowsTerminal,
  isWindowsAppsLaunchPath,
  materializeWindowsTerminalLauncher,
  skipTerminalRequested,
  windowsTerminalLaunchArgs,
  windowsTerminalShortcutLaunch,
  writeWindowsShortcut,
} from './ensure-terminal.mjs';
import { hostJoin } from './host-path.mjs';
import { defaultBinDir, defaultHome } from './platform.mjs';

export const DESKTOP_LAUNCHER_NAME = 'SuperLiora';
export const LINUX_APPLICATIONS_ENTRY = 'superliora.desktop';
/** Sibling of Windows `superliora-wt.ps1` — Linux desktop must not rely on Terminal=true. */
export const LINUX_TERM_LAUNCHER_NAME = 'superliora-term';

export function defaultDesktopDir(env = process.env, platform = process.platform) {
  const home = env.HOME ?? env.USERPROFILE ?? defaultHome();
  const xdg = typeof env.XDG_DESKTOP_DIR === 'string' ? env.XDG_DESKTOP_DIR.trim() : '';
  if (platform === 'linux' && xdg) {
    return xdg.replace(/^\$HOME(?=\/|$)/, home);
  }
  return hostJoin(platform, home, 'Desktop');
}

export function desktopLauncherPath(options = {}) {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const desktop = options.desktopDir ?? defaultDesktopDir(env, platform);
  if (platform === 'win32') return hostJoin(platform, desktop, `${DESKTOP_LAUNCHER_NAME}.lnk`);
  if (platform === 'darwin') return hostJoin(platform, desktop, `${DESKTOP_LAUNCHER_NAME}.app`);
  return hostJoin(platform, desktop, `${DESKTOP_LAUNCHER_NAME}.desktop`);
}

export function linuxApplicationsDesktopPath(env = process.env, platform = 'linux') {
  const home = env.HOME ?? env.USERPROFILE ?? defaultHome();
  const xdg = typeof env.XDG_DATA_HOME === 'string' ? env.XDG_DATA_HOME.trim() : '';
  const dataHome = xdg || hostJoin(platform, home, '.local', 'share');
  return hostJoin(platform, dataHome, 'applications', LINUX_APPLICATIONS_ENTRY);
}

export function linuxTermLauncherPath(options = {}) {
  const platform = options.platform ?? 'linux';
  const binDir = options.binDir || defaultBinDir(platform);
  return hostJoin(platform, binDir, LINUX_TERM_LAUNCHER_NAME);
}

export function resolveLauncherCommand(options = {}) {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const commandName = options.commandName ?? 'liora';
  const isFile = options.isFile ?? ((p) => existsSync(p));
  const home = env.HOME ?? env.USERPROFILE ?? defaultHome();
  const candidates = [];
  const binDir = options.binDir || defaultBinDir(platform);
  if (platform === 'win32') {
    candidates.push(hostJoin(platform, binDir, `${commandName}.exe`));
    candidates.push(hostJoin(platform, binDir, `${commandName}.cmd`));
  } else {
    candidates.push(hostJoin(platform, binDir, commandName));
  }
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA || hostJoin(platform, home, 'AppData', 'Local');
    const fallback = hostJoin(platform, local, 'SuperLiora', 'bin');
    if (fallback !== binDir) {
      candidates.push(hostJoin(platform, fallback, `${commandName}.exe`));
      candidates.push(hostJoin(platform, fallback, `${commandName}.cmd`));
    }
  } else {
    const fallback = hostJoin(platform, home, '.local', 'bin', commandName);
    if (fallback !== candidates[0]) candidates.push(fallback);
  }
  for (const candidate of candidates) {
    if (candidate && isFile(candidate)) return candidate;
  }
  return candidates[0];
}

async function resolveLauncherIcon(options, platform) {
  if (typeof options.icon === 'string' && options.icon.trim()) return options.icon.trim();
  return materializeBrandShortcutIcon({
    platform,
    binDir: options.binDir,
    writeFile: options.writeBrandIcon,
    pngPath: options.brandPngPath,
    iconPath: options.brandIconPath,
    writePng: options.writeBrandPng,
  });
}

export function shSingleQuote(value) {
  return `'${String(value ?? '').replaceAll("'", `'\\''`)}'`;
}

export function escapeDesktopExec(commandline) {
  const text = String(commandline ?? '');
  if (!/[\s"'\\><;&|`$]/.test(text)) return text;
  return `"${text.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

export function renderLinuxDesktopEntry(options = {}) {
  const commandline = options.commandline ?? '';
  const launcher = options.launcher ?? commandline;
  const exec = escapeDesktopExec(launcher);
  const tryExec = commandline || launcher;
  const icon = typeof options.icon === 'string' ? options.icon.trim() : '';
  return [
    '[Desktop Entry]',
    'Version=1.0',
    'Type=Application',
    `Name=${DESKTOP_LAUNCHER_NAME}`,
    'Comment=Open SuperLiora in a terminal',
    `Exec=${exec}`,
    `TryExec=${tryExec}`,
    ...(icon ? [`Icon=${icon}`] : []),
    // Helper opens the emulator. Terminal=true is ignored by several DEs,
    // so a double-click ran liora with no TTY and the window vanished.
    'Terminal=false',
    'Categories=Development;Utility;',
    'StartupNotify=true',
    '',
  ].join('\n');
}

/**
 * True when a Linux .desktop already points at the term helper (not a
 * Terminal=true / bare-liora leftover from older installs).
 */
export function isCurrentLinuxDesktopEntry(text) {
  if (typeof text !== 'string' || text.length === 0) return false;
  if (!text.includes(LINUX_TERM_LAUNCHER_NAME)) return false;
  if (!/^Terminal=false$/m.test(text)) return false;
  if (/^Terminal=true$/m.test(text)) return false;
  return true;
}

export function linuxDesktopShortcutStatus(path, isFile, readText) {
  if (!isFile(path)) return 'needed';
  try {
    return isCurrentLinuxDesktopEntry(readText(path)) ? 'refresh' : 'needed';
  } catch {
    return 'needed';
  }
}

export function renderLinuxTermLauncherScript(commandline) {
  const bin = shSingleQuote(commandline);
  return `#!/bin/bash
# SuperLiora desktop launcher — open a real terminal, then run liora.
# The .desktop terminal flag is not enough: several DEs execute Exec with no TTY.
set -euo pipefail
BIN=${bin}

if [ -t 0 ] && [ -t 1 ]; then
  exec "$BIN"
fi

have() { command -v "$1" >/dev/null 2>&1; }

run() {
  local term="$1"
  shift
  if have "$term"; then
    exec "$term" "$@"
  fi
}

if have xdg-terminal-exec; then
  exec xdg-terminal-exec "$BIN"
fi

run ghostty -e "$BIN"
run kitty "$BIN"
run wezterm start -- "$BIN"
run alacritty -e "$BIN"
run gnome-terminal -- "$BIN"
run ptyxis -- "$BIN"
run kgx -- "$BIN"
run konsole -e "$BIN"
run xfce4-terminal -e "$BIN"
run mate-terminal -e "$BIN"
run tilix -e "$BIN"
run terminator -e "$BIN"
run lxterminal -e "$BIN"
run x-terminal-emulator -e "$BIN"
run xterm -e "$BIN"

for candidate in \\
  /usr/bin/xdg-terminal-exec \\
  /usr/bin/gnome-terminal \\
  /usr/bin/ptyxis \\
  /usr/bin/kgx \\
  /usr/bin/konsole \\
  /usr/bin/x-terminal-emulator \\
  /usr/bin/xterm
do
  if [ -x "$candidate" ]; then
    case "$candidate" in
      *xdg-terminal-exec) exec "$candidate" "$BIN" ;;
      *gnome-terminal|*ptyxis|*kgx) exec "$candidate" -- "$BIN" ;;
      *) exec "$candidate" -e "$BIN" ;;
    esac
  fi
done

echo "error: no terminal emulator found; install gnome-terminal, kitty, or xterm" >&2
echo "then double-click SuperLiora again, or run: $BIN" >&2
exit 1
`;
}

export function renderMacosInfoPlist(options = {}) {
  const iconFile = typeof options.iconFile === 'string' ? options.iconFile.trim() : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>${DESKTOP_LAUNCHER_NAME}</string>
  <key>CFBundleDisplayName</key>
  <string>${DESKTOP_LAUNCHER_NAME}</string>
  <key>CFBundleIdentifier</key>
  <string>dev.superliora.launcher</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>CFBundleExecutable</key>
  <string>${DESKTOP_LAUNCHER_NAME}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>LSMinimumSystemVersion</key>
  <string>12.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>${iconFile ? `
  <key>CFBundleIconFile</key>
  <string>${iconFile}</string>` : ''}
</dict>
</plist>
`;
}

export function renderMacosLauncherScript(commandline) {
  const bin = shSingleQuote(commandline);
  return `#!/bin/bash
# SuperLiora desktop launcher
BIN=${bin}
open_in_app() {
  local app="$1"
  shift
  if [ -d "$app" ]; then
    open -na "$app" --args "$@"
    return 0
  fi
  return 1
}
if open_in_app /Applications/kitty.app "$BIN"; then exit 0; fi
if open_in_app "$HOME/Applications/kitty.app" "$BIN"; then exit 0; fi
if command -v kitty >/dev/null 2>&1; then
  kitty "$BIN" &
  exit 0
fi
if open_in_app /Applications/Ghostty.app -e "$BIN"; then exit 0; fi
if open_in_app "$HOME/Applications/Ghostty.app" -e "$BIN"; then exit 0; fi
if command -v ghostty >/dev/null 2>&1; then
  ghostty -e "$BIN" &
  exit 0
fi
osascript - "$BIN" <<'APPLESCRIPT'
on run argv
  set lioraBin to item 1 of argv
  tell application "Terminal"
    do script "exec " & quoted form of lioraBin
    activate
  end tell
end run
APPLESCRIPT
`;
}

export { windowsTerminalLaunchArgs };

/**
 * @returns {Promise<{
 *   skipped?: boolean,
 *   written?: boolean,
 *   applicationWritten?: boolean,
 *   ok?: boolean,
 *   path?: string,
 *   reason?: string,
 * }>}
 */
export async function ensureDesktopLauncher(options = {}) {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  if (options.skip === true) {
    return { skipped: true, written: false, ok: true };
  }
  if (platform !== 'win32' && platform !== 'darwin' && platform !== 'linux') {
    return { skipped: true, written: false, ok: true, reason: 'unsupported' };
  }
  if (platform === 'win32' && skipTerminalRequested(env, {
    ...options,
    skip: options.skip === true || options.skipTerminal === true,
  })) {
    return { skipped: true, written: false, ok: true, reason: 'no-terminal' };
  }

  const desktopDir = resolveDesktopDir(options, env, platform);
  const dest = options.launcherPath ?? desktopLauncherPath({
    ...options,
    env,
    platform,
    desktopDir,
  });

  try {
    if (platform === 'win32') {
      return await writeWindowsDesktopShortcut(dest, options, env, platform);
    }
    const commandline = resolveLauncherCommand({ ...options, env, platform });
    if (!commandline) {
      return { skipped: true, written: false, ok: true, reason: 'no-command', path: dest };
    }
    const writeText = options.writeFile ?? defaultWriteUtf8;
    const chmodFn = options.chmod ?? defaultChmod;
    if (platform === 'darwin') {
      const scriptPath = hostJoin(platform, dest, 'Contents', 'MacOS', DESKTOP_LAUNCHER_NAME);
      const plistPath = hostJoin(platform, dest, 'Contents', 'Info.plist');
      const pngPath = hostJoin(platform, dest, 'Contents', 'Resources', 'AppIcon.png');
      await materializeBrandShortcutIcon({
        platform,
        pngPath,
        writeFile: options.writeBrandIcon,
      });
      await writeText(plistPath, renderMacosInfoPlist({ iconFile: 'AppIcon.png' }));
      await writeText(scriptPath, renderMacosLauncherScript(commandline));
      await chmodFn(scriptPath, 0o755);
      await chmodFn(dest, 0o755);
      return { skipped: false, written: true, ok: true, path: dest };
    }

    const icon = await resolveLauncherIcon(options, platform);
    const termPath = options.termLauncherPath ?? linuxTermLauncherPath({
      ...options,
      env,
      platform,
    });
    await writeText(termPath, renderLinuxTermLauncherScript(commandline));
    await chmodFn(termPath, 0o755);
    const entry = renderLinuxDesktopEntry({ commandline, launcher: termPath, icon });
    await writeText(dest, entry);
    await chmodFn(dest, 0o755);
    let applicationWritten = false;
    if (options.writeApplicationEntry !== false) {
      const appDest = options.applicationPath ?? linuxApplicationsDesktopPath(env, platform);
      await writeText(appDest, entry);
      await chmodFn(appDest, 0o755);
      applicationWritten = true;
    }
    const markTrusted = options.markDesktopTrusted ?? defaultMarkDesktopTrusted;
    await markTrusted(dest);
    return { skipped: false, written: true, applicationWritten, ok: true, path: dest };
  } catch (error) {
    return {
      skipped: false,
      written: false,
      ok: true,
      path: dest,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

async function writeWindowsDesktopShortcut(dest, options, env, platform) {
  const found = options.wtPath
    ? { wtPath: options.wtPath }
    : findWindowsTerminal(options);
  const wtPath = found?.wtPath;
  if (!wtPath) {
    return { skipped: true, written: false, ok: true, reason: 'no-wt', path: dest };
  }
  const commandline = resolveLauncherCommand({ ...options, env, platform });
  const args = windowsTerminalLaunchArgs(commandline).join(' ');
  let launcherPath;
  if (isWindowsAppsLaunchPath(wtPath)) {
    try {
      launcherPath = await materializeWindowsTerminalLauncher({
        binDir: options.binDir,
        commandline,
        writeFile: options.writeFile,
        launcherPath: options.launcherPath,
      });
    } catch {
      launcherPath = undefined;
    }
  }
  const writeShortcut = options.writeShortcut ?? writeWindowsShortcut;
  const icon = (await resolveLauncherIcon(options, platform)) || commandline || wtPath;
  const launch = windowsTerminalShortcutLaunch({
    wtPath,
    arguments: args,
    launcherPath,
    workingDirectory: env.USERPROFILE ?? defaultHomeFrom(env),
    description: DESKTOP_LAUNCHER_NAME,
    icon,
    env,
  });
  const written = await writeShortcut({
    dest,
    ...launch,
  });
  return {
    skipped: false,
    written: written === true,
    ok: true,
    path: dest,
  };
}

function resolveDesktopDir(options, env, platform) {
  if (options.desktopDir) return options.desktopDir;
  if (platform === 'win32') {
    const resolveWin = options.resolveWindowsDesktop ?? defaultWindowsKnownDesktop;
    const fromShell = resolveWin();
    if (fromShell) return fromShell;
  }
  if (platform === 'linux') {
    const resolveLinux = options.resolveLinuxDesktop ?? defaultXdgDesktop;
    const fromXdg = resolveLinux();
    if (fromXdg) return fromXdg;
  }
  return defaultDesktopDir(env, platform);
}

function defaultWindowsKnownDesktop() {
  if (process.platform !== 'win32') return undefined;
  const ps = spawnSync(
    'powershell',
    ['-NoProfile', '-Command', '[Environment]::GetFolderPath("Desktop")'],
    { encoding: 'utf8', windowsHide: true, timeout: 8_000 },
  );
  if (ps.status !== 0) return undefined;
  const dir = (ps.stdout ?? '').trim();
  return dir || undefined;
}

function defaultXdgDesktop() {
  if (process.platform !== 'linux') return undefined;
  const result = spawnSync('xdg-user-dir', ['DESKTOP'], {
    encoding: 'utf8',
  });
  if (result.status !== 0) return undefined;
  const dir = (result.stdout ?? '').trim();
  return dir || undefined;
}

async function defaultMarkDesktopTrusted(dest) {
  if (process.platform !== 'linux') return;
  spawnSync('gio', ['set', dest, 'metadata::trusted', 'true'], {
    encoding: 'utf8',
    stdio: 'ignore',
  });
}

async function defaultWriteUtf8(dest, text) {
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, text, 'utf8');
}

async function defaultChmod(dest, mode) {
  try {
    await chmod(dest, mode);
  } catch {
    // best-effort (FAT/CIFS, missing chmod)
  }
}

function defaultHomeFrom(env) {
  return env.HOME ?? env.USERPROFILE ?? defaultHome();
}
