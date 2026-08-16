/**
 * Best-effort Windows Terminal install + SuperLiora TUI profile.
 * Never throws for missing winget / Store / policy — callers treat this as a sidecar.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { downloadToFile } from './download.mjs';
import { defaultHome } from './platform.mjs';

export const SUPERLIORA_WT_PROFILE_NAME = 'SuperLiora';
export const SUPERLIORA_WT_SCHEME_NAME = 'SuperLiora Dark';
export const SUPERLIORA_WT_PROFILE_GUID = '{3f8c1d2a-7b64-5e91-9c04-2a6d8f1e5b70}';
export const SUPERLIORA_WT_FONT_FACE = 'Cascadia Mono';

export const WT_CONSOLE_HOST_GUID = '{B23D10C0-E52E-411E-9D5B-C09FDF709C7D}';
export const WT_DELEGATION_CONSOLE = '{2EACA947-7F5F-4CFA-BA87-8F7FBEEFBE69}';
export const WT_DELEGATION_TERMINAL = '{E12CFF52-A866-4C77-9A90-F570A7AA2C6B}';
export const WT_AUTO_DELEGATION_GUID = '{00000000-0000-0000-0000-000000000000}';

export const WINGET_TERMINAL_ID = 'Microsoft.WindowsTerminal';
export const TERMINAL_RELEASES_LATEST = 'https://github.com/microsoft/terminal/releases/latest';
export const TERMINAL_INSTALL_HINT =
  'Install Windows Terminal from https://aka.ms/terminal then re-run, or pass --no-terminal.';

/** Copied from apps/liora/src/tui/theme/colors.ts `darkColors` — do not import TUI from the installer. */
export const SUPERLIORA_DARK_SCHEME = {
  name: SUPERLIORA_WT_SCHEME_NAME,
  background: '#0B0F14',
  foreground: '#E0E0E0',
  cursorColor: '#E0E0E0',
  selectionBackground: '#1D4E89',
  black: '#080C10',
  red: '#E85454',
  green: '#4EC87E',
  yellow: '#E8A838',
  blue: '#3D9BFF',
  purple: '#C792EA',
  cyan: '#2DD4BF',
  white: '#E0E0E0',
  brightBlack: '#6B6B6B',
  brightRed: '#F08585',
  brightGreen: '#7AD99B',
  brightYellow: '#FFCB6B',
  brightBlue: '#82AAFF',
  brightPurple: '#A78BFA',
  brightCyan: '#67E8F9',
  brightWhite: '#F5F5F5',
};

export function skipTerminalRequested(env = process.env, options = {}) {
  if (options.skip === true) return true;
  const names = ['SUPERLIORA_NO_TERMINAL', 'SUPERLIORA_SKIP_TERMINAL'];
  return names.some((name) => env[name] === '1');
}

export function wellKnownWtCandidates(env = process.env) {
  const localAppData = (env.LOCALAPPDATA ?? '').trim();
  const home = defaultHomeFrom(env);
  const list = [];
  if (localAppData) {
    list.push(winJoin(localAppData, 'Microsoft', 'WindowsApps', 'wt.exe'));
    list.push(winJoin(localAppData, 'Microsoft', 'WindowsApps', 'Microsoft.WindowsTerminal.exe'));
    list.push(winJoin(localAppData, 'Microsoft', 'Windows Terminal', 'wt.exe'));
  }
  if (home) {
    list.push(winJoin(home, 'AppData', 'Local', 'Microsoft', 'WindowsApps', 'wt.exe'));
    list.push(winJoin(home, 'AppData', 'Local', 'Microsoft', 'Windows Terminal', 'wt.exe'));
  }
  list.push('C:\\Program Files\\WindowsApps\\wt.exe');
  return list;
}

export function fragmentPath(env = process.env) {
  const localAppData = (env.LOCALAPPDATA ?? '').trim()
    || winJoin(defaultHomeFrom(env), 'AppData', 'Local');
  return winJoin(localAppData, 'Microsoft', 'Windows Terminal', 'Fragments', 'SuperLiora', 'superliora.json');
}

export function startMenuShortcutPath(env = process.env) {
  const appData = (env.APPDATA ?? '').trim()
    || winJoin(defaultHomeFrom(env), 'AppData', 'Roaming');
  return winJoin(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'SuperLiora.lnk');
}

export function resolveCommandLine(binDir, commandName = 'liora', isFile = existsSync) {
  if (!binDir) return undefined;
  const exe = winJoin(binDir, `${commandName}.exe`);
  if (isFile(exe)) return exe;
  const cmd = winJoin(binDir, `${commandName}.cmd`);
  if (isFile(cmd)) return cmd;
  return exe;
}

export function renderSuperLioraFragment(options = {}) {
  const commandline = options.commandline
    ?? resolveCommandLine(options.binDir, options.commandName ?? 'liora', options.isFile);
  const profile = {
    guid: SUPERLIORA_WT_PROFILE_GUID,
    name: SUPERLIORA_WT_PROFILE_NAME,
    startingDirectory: '%USERPROFILE%',
    font: { face: SUPERLIORA_WT_FONT_FACE, size: 13 },
    antialiasingMode: 'grayscale',
    cursorShape: 'bar',
    intenseTextStyle: 'all',
    closeOnExit: 'graceful',
    suppressApplicationTitle: false,
    colorScheme: SUPERLIORA_WT_SCHEME_NAME,
    opacity: 100,
    useAcrylic: false,
    padding: '8,8,8,8',
    scrollbarState: 'hidden',
  };
  if (commandline) profile.commandline = commandline;
  return {
    profiles: [profile],
    schemes: [SUPERLIORA_DARK_SCHEME],
  };
}

export function shouldPromoteDefaultTerminal(current = {}) {
  const consoleGuid = normalizeGuid(current.DelegationConsole);
  const terminalGuid = normalizeGuid(current.DelegationTerminal);
  if (!consoleGuid && !terminalGuid) return true;
  const host = normalizeGuid(WT_CONSOLE_HOST_GUID);
  if (consoleGuid === host || terminalGuid === host) return true;
  return false;
}

export function findWindowsTerminal(options = {}) {
  const platform = options.platform ?? process.platform;
  if (platform !== 'win32') return null;
  const env = options.env ?? process.env;
  const isFile = options.isFile ?? ((p) => existsSync(p));
  const which = options.which ?? defaultWhich;

  const fromPath = which('wt', env) ?? which('wt.exe', env);
  if (fromPath && isFile(fromPath)) {
    return { wtPath: fromPath, source: 'path', alreadyPresent: true };
  }

  for (const candidate of wellKnownWtCandidates(env)) {
    if (isFile(candidate)) {
      return { wtPath: candidate, source: 'well-known', alreadyPresent: true };
    }
  }

  const fromAppx = options.listAppx ? options.listAppx() : defaultListAppx();
  if (fromAppx && isFile(fromAppx)) {
    return { wtPath: fromAppx, source: 'appx', alreadyPresent: true };
  }

  return null;
}

/**
 * @returns {Promise<{
 *   skipped?: boolean,
 *   platform?: string,
 *   alreadyPresent?: boolean,
 *   installed?: boolean,
 *   fragmentWritten?: boolean,
 *   shortcutWritten?: boolean,
 *   promotedDefault?: boolean,
 *   wtPath?: string,
 *   source?: string,
 *   ok?: boolean,
 *   message?: string,
 * }>}
 */
export async function ensureTerminal(options = {}) {
  const env = options.env ?? process.env;
  if (skipTerminalRequested(env, options)) {
    return { skipped: true, ok: true };
  }

  const platform = options.platform ?? process.platform;
  if (platform !== 'win32') {
    return { skipped: true, platform, ok: true };
  }

  let found = findWindowsTerminal(options);
  let installed = false;
  let message;

  if (!found) {
    const attempt = await installWindowsTerminal(options);
    installed = attempt.installed === true;
    message = attempt.message;
    if (attempt.ok !== false) {
      found = findWindowsTerminal(options);
    }
    if (!found) {
      return {
        skipped: false,
        installed: false,
        ok: false,
        fragmentWritten: false,
        shortcutWritten: false,
        promotedDefault: false,
        message: message ?? TERMINAL_INSTALL_HINT,
      };
    }
  }

  const isFile = options.isFile ?? ((p) => existsSync(p));
  const commandline = resolveCommandLine(
    options.binDir,
    options.commandName ?? 'liora',
    isFile,
  );
  const fragment = renderSuperLioraFragment({
    commandline,
    binDir: options.binDir,
    commandName: options.commandName,
    isFile,
  });
  const fragmentDest = options.fragmentPath ?? fragmentPath(env);
  const writeJson = options.writeFile ?? defaultWriteUtf8;
  await writeJson(fragmentDest, `${JSON.stringify(fragment, null, 2)}\n`);

  let shortcutWritten = false;
  if (found.wtPath) {
    const dest = options.shortcutPath ?? startMenuShortcutPath(env);
    const writeShortcut = options.writeShortcut ?? defaultWriteShortcut;
    shortcutWritten = await writeShortcut({
      dest,
      target: found.wtPath,
      arguments: `-w new -p ${SUPERLIORA_WT_PROFILE_NAME}`,
      workingDirectory: env.USERPROFILE ?? defaultHomeFrom(env),
      description: SUPERLIORA_WT_PROFILE_NAME,
    });
  }

  let promotedDefault = false;
  if (!options.noShellRc) {
    const readDelegation = options.readDelegation ?? defaultReadDelegation;
    const writeDelegation = options.writeDelegation ?? defaultWriteDelegation;
    const current = readDelegation() ?? {};
    if (shouldPromoteDefaultTerminal(current)) {
      writeDelegation({
        DelegationConsole: WT_DELEGATION_CONSOLE,
        DelegationTerminal: WT_DELEGATION_TERMINAL,
      });
      promotedDefault = true;
    }
  }

  return {
    skipped: false,
    alreadyPresent: found.alreadyPresent === true && !installed,
    installed,
    fragmentWritten: true,
    shortcutWritten,
    promotedDefault,
    wtPath: found.wtPath,
    source: found.source,
    ok: true,
    message,
  };
}

export async function installWindowsTerminal(options = {}) {
  const runWinget = options.runWinget ?? defaultRunWinget;
  const userAttempt = runWinget({ scopeUser: true });
  if (userAttempt.status === 0) {
    return { installed: true, ok: true, via: 'winget-user' };
  }
  const machineAttempt = runWinget({ scopeUser: false });
  if (machineAttempt.status === 0) {
    return { installed: true, ok: true, via: 'winget' };
  }

  try {
    const viaMsix = await installTerminalMsix(options);
    if (viaMsix.ok) return viaMsix;
    return {
      installed: false,
      ok: false,
      via: viaMsix.via ?? 'msix',
      message: viaMsix.message ?? TERMINAL_INSTALL_HINT,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { installed: false, ok: false, via: 'msix', message: `${detail}. ${TERMINAL_INSTALL_HINT}` };
  }
}

async function installTerminalMsix(options = {}) {
  const fetchLatest = options.fetchLatestRelease ?? defaultFetchLatestMsixUrl;
  const url = await fetchLatest();
  if (!url) {
    return { installed: false, ok: false, via: 'msix', message: TERMINAL_INSTALL_HINT };
  }
  const dest = options.msixPath ?? join(
    options.runtimeDir ?? join(defaultHomeFrom(options.env ?? process.env), '.superliora', 'runtime', 'terminal'),
    'WindowsTerminal.msixbundle',
  );
  const download = options.downloadToFile ?? downloadToFile;
  await download(url, dest);
  const addAppx = options.addAppxPackage ?? defaultAddAppxPackage;
  const added = addAppx(dest);
  if (added.status !== 0) {
    return {
      installed: false,
      ok: false,
      via: 'msix',
      message: added.message ?? TERMINAL_INSTALL_HINT,
    };
  }
  return { installed: true, ok: true, via: 'msix' };
}

function defaultHomeFrom(env) {
  return env.HOME ?? env.USERPROFILE ?? defaultHome();
}

/** Join Windows paths with backslashes so injected `isFile` fixtures match. */
function winJoin(...parts) {
  return parts
    .filter((part) => part !== undefined && part !== null && String(part).length > 0)
    .map((part, index) => {
      const text = String(part);
      if (index === 0) return text.replace(/[\\/]+$/, '');
      return text.replace(/^[\\/]+/, '').replace(/[\\/]+$/, '');
    })
    .join('\\');
}

function defaultWhich(name, env) {
  const result = spawnSync(process.platform === 'win32' ? 'where' : 'which', [name], {
    encoding: 'utf8',
    env,
    windowsHide: true,
  });
  if (result.status !== 0) return undefined;
  const line = (result.stdout ?? '').split(/\r?\n/).map((part) => part.trim()).find(Boolean);
  return line || undefined;
}

function defaultListAppx() {
  if (process.platform !== 'win32') return undefined;
  const ps = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      "(Get-AppxPackage -Name 'Microsoft.WindowsTerminal*' | Where-Object { $_.Name -notlike '*Preview*' } | Select-Object -First 1).InstallLocation",
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  if (ps.status !== 0) return undefined;
  const loc = (ps.stdout ?? '').trim();
  if (!loc) return undefined;
  const wt = join(loc, 'wt.exe');
  return existsSync(wt) ? wt : undefined;
}

function defaultRunWinget({ scopeUser }) {
  const args = [
    'install',
    '-e',
    '--id',
    WINGET_TERMINAL_ID,
    '--accept-package-agreements',
    '--accept-source-agreements',
    '--disable-interactivity',
    '--silent',
  ];
  if (scopeUser) args.push('--scope', 'user');
  const result = spawnSync('winget', args, { encoding: 'utf8', windowsHide: true });
  return {
    status: result.error ? 1 : (result.status ?? 1),
    message: result.stderr || result.stdout || result.error?.message,
  };
}

async function defaultFetchLatestMsixUrl() {
  const res = await fetch(TERMINAL_RELEASES_LATEST, { redirect: 'follow' });
  const finalUrl = res.url || TERMINAL_RELEASES_LATEST;
  const html = await res.text();
  const match = html.match(/href="([^"]+\.msixbundle)"/i)
    || html.match(/https:\/\/github\.com\/microsoft\/terminal\/releases\/download\/[^"']+\.msixbundle/i);
  if (match) {
    const href = match[1] ?? match[0];
    if (href.startsWith('http')) return href;
    return `https://github.com${href}`;
  }
  const tag = finalUrl.match(/\/releases\/tag\/([^/?#]+)/);
  if (tag) {
    return `https://github.com/microsoft/terminal/releases/download/${tag[1]}/Microsoft.WindowsTerminal_${decodeURIComponent(tag[1]).replace(/^v/, '')}_8wekyb3d8bbwe.msixbundle`;
  }
  return undefined;
}

function defaultAddAppxPackage(msixPath) {
  const ps = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `Add-AppxPackage -Path '${String(msixPath).replaceAll("'", "''")}'`,
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  return {
    status: ps.error ? 1 : (ps.status ?? 1),
    message: ps.stderr || ps.stdout || ps.error?.message,
  };
}

async function defaultWriteUtf8(dest, text) {
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, text, 'utf8');
}

async function defaultWriteShortcut({ dest, target, arguments: args, workingDirectory, description }) {
  if (process.platform !== 'win32') return false;
  const script = [
    `$ws = New-Object -ComObject WScript.Shell`,
    `$s = $ws.CreateShortcut('${escapePs(dest)}')`,
    `$s.TargetPath = '${escapePs(target)}'`,
    `$s.Arguments = '${escapePs(args)}'`,
    `$s.WorkingDirectory = '${escapePs(workingDirectory ?? '')}'`,
    `$s.Description = '${escapePs(description ?? '')}'`,
    `$s.Save()`,
  ].join('; ');
  const ps = spawnSync('powershell', ['-NoProfile', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
  });
  return ps.status === 0;
}

function defaultReadDelegation() {
  if (process.platform !== 'win32') return {};
  const ps = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      "$p = 'HKCU:\\Console\\%%Startup'; if (-not (Test-Path -LiteralPath $p)) { '{}' } else { $i = Get-ItemProperty -LiteralPath $p; @{ DelegationConsole = $i.DelegationConsole; DelegationTerminal = $i.DelegationTerminal } | ConvertTo-Json -Compress }",
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  if (ps.status !== 0) return {};
  try {
    return JSON.parse((ps.stdout ?? '').trim() || '{}');
  } catch {
    return {};
  }
}

function defaultWriteDelegation(values) {
  if (process.platform !== 'win32') return;
  const consoleGuid = values.DelegationConsole;
  const terminalGuid = values.DelegationTerminal;
  const script = [
    "$p = 'HKCU:\\Console\\%%Startup'",
    'New-Item -Path $p -Force | Out-Null',
    `New-ItemProperty -LiteralPath $p -Name DelegationConsole -Value '${escapePs(consoleGuid)}' -PropertyType String -Force | Out-Null`,
    `New-ItemProperty -LiteralPath $p -Name DelegationTerminal -Value '${escapePs(terminalGuid)}' -PropertyType String -Force | Out-Null`,
  ].join('; ');
  spawnSync('powershell', ['-NoProfile', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
  });
}

function normalizeGuid(value) {
  if (!value) return '';
  return String(value).trim().toUpperCase();
}

function escapePs(value) {
  return String(value ?? '').replaceAll("'", "''");
}
