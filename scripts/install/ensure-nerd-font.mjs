/**
 * Best-effort CaskaydiaCove Nerd Font install (user-local).
 * TUI glyphs and Oh My Posh need a Nerd Font; Cascadia Mono is not enough.
 * Never throws — callers treat this as a sidecar.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { downloadToFile } from './download.mjs';
import { findWinget } from './ensure-winget.mjs';
import { hostJoin } from './host-path.mjs';
import { defaultHome } from './platform.mjs';

export const CASKAYDIA_WINGET_ID = 'ryanoasis.CaskaydiaCove';
export const CASKAYDIA_WINGET_SOURCE = 'winget-font';
export const CASKAYDIA_FONT_FACE = 'CaskaydiaCove NF';
export const CASKAYDIA_FONT_ZIP_URL =
  'https://github.com/ryanoasis/nerd-fonts/releases/download/v3.4.0/CascadiaCode.zip';

const FONT_NAMES = [
  'CaskaydiaCoveNerdFont-Regular.ttf',
  'CaskaydiaCoveNF-Regular.ttf',
  'CaskaydiaCoveNerdFontMono-Regular.ttf',
];

export function skipNerdFontRequested(env = process.env, options = {}) {
  if (options.skip === true) return true;
  return env.SUPERLIORA_NO_NERD_FONT === '1';
}

export function userFontsDir(env = process.env, platform = process.platform) {
  const home = env.HOME ?? env.USERPROFILE ?? defaultHome();
  if (platform === 'darwin') return hostJoin(platform, home, 'Library', 'Fonts');
  if (platform === 'linux') return hostJoin(platform, home, '.local', 'share', 'fonts');
  return winJoin(env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'Microsoft', 'Windows', 'Fonts');
}

export function wellKnownNerdFontFiles(env = process.env, platform = process.platform) {
  const home = env.HOME ?? env.USERPROFILE ?? defaultHome();
  const dirs = [];
  if (platform === 'win32') {
    dirs.push('C:\\Windows\\Fonts');
    const localAppData = (env.LOCALAPPDATA ?? '').trim();
    if (localAppData) dirs.push(winJoin(localAppData, 'Microsoft', 'Windows', 'Fonts'));
    if (home) dirs.push(winJoin(home, 'AppData', 'Local', 'Microsoft', 'Windows', 'Fonts'));
  } else if (platform === 'darwin') {
    dirs.push(hostJoin(platform, home, 'Library', 'Fonts'));
    dirs.push('/Library/Fonts');
  } else {
    dirs.push(hostJoin(platform, home, '.local', 'share', 'fonts'));
    dirs.push(hostJoin(platform, home, '.fonts'));
    dirs.push('/usr/local/share/fonts');
    dirs.push('/usr/share/fonts');
  }
  const list = [];
  for (const dir of dirs) {
    for (const name of FONT_NAMES) {
      list.push(hostJoin(platform, dir, name));
    }
  }
  return list;
}

export function findNerdFont(options = {}) {
  const platform = options.platform ?? process.platform;
  if (platform !== 'win32' && platform !== 'darwin' && platform !== 'linux') return null;
  const env = options.env ?? process.env;
  const isFile = options.isFile ?? ((p) => existsSync(p));
  for (const candidate of wellKnownNerdFontFiles(env, platform)) {
    if (isFile(candidate)) {
      return { fontPath: candidate, face: CASKAYDIA_FONT_FACE, alreadyPresent: true };
    }
  }
  return null;
}

/**
 * @returns {Promise<{
 *   skipped?: boolean,
 *   alreadyPresent?: boolean,
 *   installed?: boolean,
 *   ok?: boolean,
 *   face?: string,
 *   fontPath?: string,
 *   via?: string,
 *   message?: string,
 * }>}
 */
export async function ensureNerdFont(options = {}) {
  const env = options.env ?? process.env;
  if (skipNerdFontRequested(env, options)) {
    return { skipped: true, ok: true };
  }
  const platform = options.platform ?? process.platform;
  if (platform !== 'win32' && platform !== 'darwin' && platform !== 'linux') {
    return { skipped: true, ok: true };
  }

  const found = findNerdFont(options);
  if (found) {
    return { skipped: false, alreadyPresent: true, ok: true, ...found };
  }

  if (options.skipPackages === true) {
    return { skipped: true, ok: true, face: CASKAYDIA_FONT_FACE };
  }

  if (platform === 'win32') {
    const runWinget = options.runWinget ?? defaultRunWingetFont;
    const winget = runWinget();
    if (winget.status === 0) {
      const afterWinget = findNerdFont(options);
      return {
        skipped: false,
        installed: true,
        ok: true,
        via: 'winget-font',
        face: CASKAYDIA_FONT_FACE,
        fontPath: afterWinget?.fontPath,
      };
    }
  }

  try {
    const viaZip = await installNerdFontZip(options);
    const after = findNerdFont(options);
    return {
      skipped: false,
      installed: viaZip.ok === true,
      ok: viaZip.ok === true || Boolean(after),
      via: 'zip',
      face: CASKAYDIA_FONT_FACE,
      fontPath: after?.fontPath,
      message: viaZip.ok ? undefined : viaZip.message,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { skipped: false, installed: false, ok: false, message: detail };
  }
}

async function installNerdFontZip(options = {}) {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const home = env.HOME ?? env.USERPROFILE ?? defaultHome();
  const runtimeDir = options.runtimeDir
    ?? join(home, '.superliora', 'runtime', 'fonts');
  const download = options.downloadToFile ?? downloadToFile;
  const installUserFonts = options.installUserFonts ?? defaultInstallUserFonts;
  await mkdir(runtimeDir, { recursive: true });
  const zip = join(runtimeDir, 'CascadiaCode.zip');
  await download(CASKAYDIA_FONT_ZIP_URL, zip);
  const extractDir = join(runtimeDir, 'CaskaydiaCove');
  const expand = options.expandZip ?? defaultExpandZip;
  await expand(zip, extractDir);
  const fonts = await (options.listFontFiles ?? defaultListFontFiles)(extractDir);
  if (fonts.length === 0) {
    return { ok: false, message: 'Nerd Font zip had no TTF/OTF files' };
  }
  const destDir = options.userFontsDir ?? userFontsDir(env, platform);
  const installed = await installUserFonts({ files: fonts, destDir, platform, env });
  return installed.status === 0
    ? { ok: true }
    : { ok: false, message: installed.message ?? 'user font install failed' };
}

function defaultRunWingetFont() {
  const cmd = findWinget()?.wingetPath ?? 'winget';
  const result = spawnSync(
    cmd,
    [
      'install',
      '-e',
      '--id',
      CASKAYDIA_WINGET_ID,
      '--source',
      CASKAYDIA_WINGET_SOURCE,
      '--accept-package-agreements',
      '--accept-source-agreements',
      '--disable-interactivity',
      '--silent',
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  return {
    status: result.error ? 1 : (result.status ?? 1),
    message: result.stderr || result.stdout || result.error?.message,
  };
}

async function defaultExpandZip(zipPath, dest) {
  await mkdir(dest, { recursive: true });
  if (process.platform === 'win32') {
    spawnSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Expand-Archive -Path '${escapePs(zipPath)}' -DestinationPath '${escapePs(dest)}' -Force`,
      ],
      { encoding: 'utf8', windowsHide: true },
    );
    return;
  }
  spawnSync('tar', ['-xf', zipPath, '-C', dest], {
    encoding: 'utf8',
    windowsHide: true,
  });
}

async function defaultListFontFiles(root) {
  const out = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (/\.(ttf|otf)$/i.test(entry.name)) out.push(full);
    }
  }
  await walk(root);
  return out;
}

async function defaultInstallUserFonts({ files, destDir, platform = process.platform }) {
  if (platform === 'win32') {
    return installUserFontsWin({ files, destDir });
  }
  await mkdir(destDir, { recursive: true });
  for (const src of files) {
    await copyFile(src, join(destDir, basename(src)));
  }
  if (platform === 'linux') {
    spawnSync('fc-cache', ['-f', destDir], { encoding: 'utf8', windowsHide: true });
  }
  return { status: 0 };
}

function installUserFontsWin({ files, destDir }) {
  const list = files.map((file) => `'${escapePs(file)}'`).join(',');
  const script = [
    `$dest = '${escapePs(destDir)}'`,
    'New-Item -ItemType Directory -Force -Path $dest | Out-Null',
    `$reg = 'HKCU:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts'`,
    'New-Item -Path $reg -Force | Out-Null',
    `foreach ($src in @(${list})) {`,
    '  $name = [IO.Path]::GetFileName($src)',
    '  Copy-Item -LiteralPath $src -Destination (Join-Path $dest $name) -Force',
    '  New-ItemProperty -LiteralPath $reg -Name $name -Value (Join-Path $dest $name) -PropertyType String -Force | Out-Null',
    '}',
  ].join('; ');
  const ps = spawnSync('powershell', ['-NoProfile', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
  });
  return {
    status: ps.error ? 1 : (ps.status ?? 1),
    message: ps.stderr || ps.stdout || ps.error?.message,
  };
}

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

function escapePs(value) {
  return String(value ?? '').replaceAll("'", "''");
}
