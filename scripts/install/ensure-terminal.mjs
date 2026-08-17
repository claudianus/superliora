/**
 * Best-effort Windows Terminal install + SuperLiora TUI profile.
 * Never throws for missing winget / Store / policy — callers treat this as a sidecar.
 *
 * PC-bang / school images often lack winget, Nerd Fonts, and Windows Terminal.
 * The installer bootstraps those best-effort so the TUI can actually render.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { downloadToFile } from './download.mjs';
import { CASKAYDIA_FONT_FACE, ensureNerdFont, findNerdFont } from './ensure-nerd-font.mjs';
import { findOhMyPosh } from './ensure-oh-my-posh.mjs';
import { ensureShellVibe } from './ensure-shell-vibe.mjs';
import { ensureWinget, findWinget } from './ensure-winget.mjs';
import { defaultHome } from './platform.mjs';

export const SUPERLIORA_WT_PROFILE_NAME = 'SuperLiora';
export const SUPERLIORA_SHELL_PROFILE_NAME = 'SuperLiora Shell';
export const SUPERLIORA_WT_SCHEME_NAME = 'SuperLiora Neon Noir';
export const SUPERLIORA_WT_PROFILE_GUID = '{3f8c1d2a-7b64-5e91-9c04-2a6d8f1e5b70}';
export const SUPERLIORA_SHELL_PROFILE_GUID = '{8e4f2c91-6a0b-5d73-b1e8-4c9a7d2f0e15}';
export const SUPERLIORA_SHELL_COMMANDLINE =
  '%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
export const SUPERLIORA_WT_FONT_FACE = CASKAYDIA_FONT_FACE;
export const SUPERLIORA_WT_FONT_FACE_FALLBACK = 'Cascadia Mono';
export const WT_STOCK_POWERSHELL_GUID = '{61c54bbd-c2c6-5271-96e7-009a87ff44bf}';
export const WT_STOCK_CMD_GUID = '{0caa0dad-35be-5f56-a8ff-afceeeaa6101}';
export const WT_STOCK_PWSH_GUID = '{574e775e-4f2a-5b96-ac1e-a2962a156bcb}';

export const WT_CONSOLE_HOST_GUID = '{B23D10C0-E52E-411E-9D5B-C09FDF709C7D}';
export const WT_DELEGATION_CONSOLE = '{2EACA947-7F5F-4CFA-BA87-8F7FBEEFBE69}';
export const WT_DELEGATION_TERMINAL = '{E12CFF52-A866-4C77-9A90-F570A7AA2C6B}';
export const WT_AUTO_DELEGATION_GUID = '{00000000-0000-0000-0000-000000000000}';

export const WINGET_TERMINAL_ID = 'Microsoft.WindowsTerminal';
export const TERMINAL_RELEASES_LATEST = 'https://github.com/microsoft/terminal/releases/latest';
export const TERMINAL_INSTALL_HINT =
  'Install Windows Terminal from https://aka.ms/terminal then re-run, or pass --no-terminal.';

/** Copied from apps/liora/src/tui/theme/colors.ts `neonNoirColors` — do not import TUI from the installer. */
export const SUPERLIORA_NEON_NOIR_SCHEME = {
  name: SUPERLIORA_WT_SCHEME_NAME,
  background: '#0D1422',
  foreground: '#E6EDF3',
  cursorColor: '#E6EDF3',
  selectionBackground: '#123B5A',
  black: '#060A12',
  red: '#FF5C7A',
  green: '#36D399',
  yellow: '#F5C542',
  blue: '#00D5FF',
  purple: '#A78BFA',
  cyan: '#22D3EE',
  white: '#E6EDF3',
  brightBlack: '#6F7A86',
  brightRed: '#FF91A6',
  brightGreen: '#7AF0B4',
  brightYellow: '#FFE082',
  brightBlue: '#00D5FF',
  brightPurple: '#C4B5FD',
  brightCyan: '#8BE9FD',
  brightWhite: '#FFFFFF',
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

export function windowsTerminalSettingsPath(env = process.env) {
  const localAppData = (env.LOCALAPPDATA ?? '').trim()
    || winJoin(defaultHomeFrom(env), 'AppData', 'Local');
  return winJoin(localAppData, 'Microsoft', 'Windows Terminal', 'settings.json');
}

export function isStockWindowsTerminalDefault(guid) {
  const normalized = normalizeGuid(guid);
  if (!normalized) return true;
  return [
    WT_STOCK_POWERSHELL_GUID,
    WT_STOCK_CMD_GUID,
    WT_STOCK_PWSH_GUID,
  ].some((stock) => normalizeGuid(stock) === normalized);
}

export function resolveCommandLine(binDir, commandName = 'liora', isFile = existsSync) {
  if (!binDir) return undefined;
  const exe = winJoin(binDir, `${commandName}.exe`);
  if (isFile(exe)) return exe;
  const cmd = winJoin(binDir, `${commandName}.cmd`);
  if (isFile(cmd)) return cmd;
  return exe;
}

function renderWtChrome(options = {}) {
  return {
    startingDirectory: '%USERPROFILE%',
    font: {
      face: options.fontFace ?? SUPERLIORA_WT_FONT_FACE,
      size: 13,
      weight: 'normal',
      features: { calt: 1, liga: 1 },
    },
    antialiasingMode: 'grayscale',
    cursorShape: 'bar',
    intenseTextStyle: 'all',
    closeOnExit: 'graceful',
    suppressApplicationTitle: false,
    colorScheme: SUPERLIORA_WT_SCHEME_NAME,
    opacity: 82,
    useAcrylic: true,
    padding: '12,16,12,16',
    scrollbarState: 'hidden',
    bellStyle: 'none',
  };
}

export function renderSuperLioraFragment(options = {}) {
  const commandline = options.commandline
    ?? resolveCommandLine(options.binDir, options.commandName ?? 'liora', options.isFile);
  const chrome = renderWtChrome(options);
  const profile = {
    guid: SUPERLIORA_WT_PROFILE_GUID,
    name: SUPERLIORA_WT_PROFILE_NAME,
    ...chrome,
  };
  if (commandline) profile.commandline = commandline;
  const shell = {
    guid: SUPERLIORA_SHELL_PROFILE_GUID,
    name: SUPERLIORA_SHELL_PROFILE_NAME,
    commandline: SUPERLIORA_SHELL_COMMANDLINE,
    hidden: false,
    ...chrome,
  };
  return {
    profiles: [profile, shell],
    schemes: [SUPERLIORA_NEON_NOIR_SCHEME],
  };
}

export function parseJsonc(text) {
  try {
    return JSON.parse(text);
  } catch {
    const stripped = String(text)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/,\s*([}\]])/g, '$1');
    return JSON.parse(stripped);
  }
}

export function mergeWindowsTerminalSettings(current, options = {}) {
  const next = current && typeof current === 'object' ? structuredClone(current) : {};
  const fontFace = options.fontFace ?? SUPERLIORA_WT_FONT_FACE;
  next.profiles = next.profiles && typeof next.profiles === 'object' && !Array.isArray(next.profiles)
    ? next.profiles
    : { defaults: {}, list: Array.isArray(next.profiles) ? next.profiles : [] };
  next.profiles.defaults = next.profiles.defaults && typeof next.profiles.defaults === 'object'
    ? next.profiles.defaults
    : {};
  next.profiles.defaults.font = {
    ...(next.profiles.defaults.font ?? {}),
    face: fontFace,
    size: next.profiles.defaults.font?.size ?? 13,
    features: { calt: 1, liga: 1, ...(next.profiles.defaults.font?.features ?? {}) },
  };
  next.profiles.defaults.colorScheme = SUPERLIORA_WT_SCHEME_NAME;
  next.profiles.defaults.useAcrylic = true;
  next.profiles.defaults.opacity = next.profiles.defaults.opacity ?? 82;
  next.profiles.defaults.padding = next.profiles.defaults.padding ?? '12,16,12,16';
  next.profiles.defaults.antialiasingMode = next.profiles.defaults.antialiasingMode ?? 'grayscale';
  next.profiles.defaults.cursorShape = next.profiles.defaults.cursorShape ?? 'bar';
  next.profiles.defaults.bellStyle = 'none';
  if (isStockWindowsTerminalDefault(next.defaultProfile)) {
    next.defaultProfile = SUPERLIORA_SHELL_PROFILE_GUID;
  }
  const schemes = Array.isArray(next.schemes) ? next.schemes : [];
  const schemeName = SUPERLIORA_NEON_NOIR_SCHEME.name.toLowerCase();
  next.schemes = [
    ...schemes.filter((scheme) => String(scheme?.name ?? '').toLowerCase() !== schemeName),
    SUPERLIORA_NEON_NOIR_SCHEME,
  ];
  const actions = Array.isArray(next.actions) ? next.actions : [];
  const hasQuake = actions.some((action) => {
    const command = action?.command;
    const name = typeof command === 'string' ? command : command?.action;
    return name === 'quakeMode';
  });
  if (!hasQuake) {
    actions.push({ command: { action: 'quakeMode' }, keys: 'win+`' });
  }
  next.actions = actions;
  return next;
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

export function resolveFragmentFontFace(options = {}) {
  if (options.fontFace) return options.fontFace;
  const found = findNerdFont(options);
  return found ? SUPERLIORA_WT_FONT_FACE : SUPERLIORA_WT_FONT_FACE_FALLBACK;
}

/**
 * Env + path probe for TUI / Conductor / `/host-setup`.
 * Does not install anything.
 */
export function probeWindowsTerminalEnv(options = {}) {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  if (platform !== 'win32') {
    return {
      applicable: false,
      platform,
      host: 'other',
      status: 'ok',
      inWindowsTerminal: false,
      hasWt: false,
      hasNerdFont: false,
    };
  }
  const inWindowsTerminal = Boolean((env.WT_SESSION ?? '').trim());
  const found = findWindowsTerminal(options);
  const nerd = findNerdFont(options);
  const omp = findOhMyPosh(options);
  const host = inWindowsTerminal ? 'windowsterminal' : 'conhost';
  const hasWt = Boolean(found);
  const hasNerdFont = Boolean(nerd);
  const hasOhMyPosh = Boolean(omp);
  const status = inWindowsTerminal && hasWt ? 'ok' : 'degraded';
  return {
    applicable: true,
    platform,
    host,
    status,
    inWindowsTerminal,
    hasWt,
    hasNerdFont,
    hasOhMyPosh,
    wtPath: found?.wtPath,
    fontFace: nerd ? SUPERLIORA_WT_FONT_FACE : SUPERLIORA_WT_FONT_FACE_FALLBACK,
  };
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
 *   wingetBootstrapped?: boolean,
 *   nerdFontInstalled?: boolean,
 *   ohMyPoshInstalled?: boolean,
 *   zoxideInstalled?: boolean,
 *   fzfInstalled?: boolean,
 *   profilePatched?: boolean,
 *   settingsMerged?: boolean,
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
  let wingetBootstrapped = false;
  let nerdFontInstalled = false;
  const skipPackages = options.skipPackages === true;

  if (!found && !skipPackages) {
    const bootstrapWinget = options.ensureWinget ?? ensureWinget;
    const winget = await bootstrapWinget(options);
    wingetBootstrapped = winget.installed === true;
    const attempt = await installWindowsTerminal(options);
    installed = attempt.installed === true;
    message = attempt.message;
    if (attempt.ok !== false) {
      found = findWindowsTerminal(options);
    }
  }

  if (!found && skipPackages) {
    let vibe = {};
    if (!options.noShellRc) {
      const bootstrapVibe = options.ensureShellVibe ?? ensureShellVibe;
      try {
        vibe = await bootstrapVibe({ ...options, skipPackages: true });
      } catch {
        vibe = {};
      }
    }
    return {
      skipped: true,
      installed: false,
      ok: true,
      fragmentWritten: false,
      shortcutWritten: false,
      promotedDefault: false,
      wingetBootstrapped,
      nerdFontInstalled,
      ohMyPoshInstalled: vibe.ohMyPoshInstalled === true,
      zoxideInstalled: vibe.zoxideInstalled === true,
      fzfInstalled: vibe.fzfInstalled === true,
      profilePatched: vibe.profilePatched === true,
      message: message ?? TERMINAL_INSTALL_HINT,
    };
  }

  if (!skipPackages) {
    const bootstrapFont = options.ensureNerdFont ?? ensureNerdFont;
    const font = await bootstrapFont(options);
    nerdFontInstalled = font.installed === true;
  }

  let fragmentWritten = false;
  let shortcutWritten = false;
  let promotedDefault = false;
  let settingsMerged = false;
  if (found) {
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
      fontFace: resolveFragmentFontFace(options),
    });
    const fragmentDest = options.fragmentPath ?? fragmentPath(env);
    const writeJson = options.writeFile ?? defaultWriteUtf8;
    await writeJson(fragmentDest, `${JSON.stringify(fragment, null, 2)}\n`);
    fragmentWritten = true;

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
      settingsMerged = await writeMergedTerminalSettings(options, env);
    }
  }

  let vibe = {};
  if (!options.noShellRc) {
    const bootstrapVibe = options.ensureShellVibe ?? ensureShellVibe;
    try {
      vibe = await bootstrapVibe(options);
    } catch (error) {
      vibe = { ok: true, message: error instanceof Error ? error.message : String(error) };
    }
  }

  return {
    skipped: false,
    alreadyPresent: found?.alreadyPresent === true && !installed,
    installed,
    fragmentWritten,
    shortcutWritten,
    promotedDefault,
    settingsMerged,
    wingetBootstrapped,
    nerdFontInstalled,
    ohMyPoshInstalled: vibe.ohMyPoshInstalled === true,
    zoxideInstalled: vibe.zoxideInstalled === true,
    fzfInstalled: vibe.fzfInstalled === true,
    profilePatched: vibe.profilePatched === true,
    wtPath: found?.wtPath,
    source: found?.source,
    ok: Boolean(found),
    message: found ? (vibe.message ?? message) : (message ?? TERMINAL_INSTALL_HINT),
  };
}

async function writeMergedTerminalSettings(options, env) {
  try {
    const dest = options.settingsPath ?? windowsTerminalSettingsPath(env);
    const readText = options.readText ?? defaultReadText;
    const writeJson = options.writeFile ?? defaultWriteUtf8;
    const raw = await readText(dest);
    let current = {};
    if (raw && raw.trim()) {
      try {
        current = parseJsonc(raw);
      } catch {
        return false;
      }
    }
    const next = mergeWindowsTerminalSettings(current, {
      fontFace: resolveFragmentFontFace(options),
    });
    await writeJson(dest, `${JSON.stringify(next, null, 2)}\n`);
    return true;
  } catch {
    return false;
  }
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
  // Fresh winget bootstrap is often missing from PATH in the same process.
  const cmd = findWinget()?.wingetPath ?? 'winget';
  const result = spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true });
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

async function defaultReadText(dest) {
  try {
    return await readFile(dest, 'utf8');
  } catch {
    return '';
  }
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
