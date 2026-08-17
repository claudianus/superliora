/**
 * Best-effort winget bootstrap for PC-bang / Store-less Windows images.
 * Never throws — callers treat this as a sidecar.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { downloadToFile } from './download.mjs';
import { defaultHome } from './platform.mjs';

export const WINGET_RELEASE = 'v1.29.280';
export const WINGET_BUNDLE_URL =
  `https://github.com/microsoft/winget-cli/releases/download/${WINGET_RELEASE}/Microsoft.DesktopAppInstaller_8wekyb3d8bbwe.msixbundle`;
export const WINGET_DEPS_URL =
  `https://github.com/microsoft/winget-cli/releases/download/${WINGET_RELEASE}/DesktopAppInstaller_Dependencies.zip`;
export const VCLIBS_DESKTOP_URL = 'https://aka.ms/Microsoft.VCLibs.x64.14.00.Desktop.appx';

export function skipWingetRequested(env = process.env, options = {}) {
  if (options.skip === true) return true;
  return env.SUPERLIORA_NO_WINGET === '1';
}

export function wellKnownWingetCandidates(env = process.env) {
  const localAppData = (env.LOCALAPPDATA ?? '').trim();
  const home = env.HOME ?? env.USERPROFILE ?? defaultHome();
  const list = [];
  if (localAppData) {
    list.push(winJoin(localAppData, 'Microsoft', 'WindowsApps', 'winget.exe'));
  }
  if (home) {
    list.push(winJoin(home, 'AppData', 'Local', 'Microsoft', 'WindowsApps', 'winget.exe'));
  }
  return list;
}

export function findWinget(options = {}) {
  const platform = options.platform ?? process.platform;
  if (platform !== 'win32') return null;
  const env = options.env ?? process.env;
  const isFile = options.isFile ?? ((p) => existsSync(p));
  const which = options.which ?? defaultWhich;

  const fromPath = which('winget', env) ?? which('winget.exe', env);
  if (fromPath && isFile(fromPath)) {
    return { wingetPath: fromPath, source: 'path', alreadyPresent: true };
  }
  for (const candidate of wellKnownWingetCandidates(env)) {
    if (isFile(candidate)) {
      return { wingetPath: candidate, source: 'well-known', alreadyPresent: true };
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
 *   wingetPath?: string,
 *   source?: string,
 *   message?: string,
 * }>}
 */
export async function ensureWinget(options = {}) {
  const env = options.env ?? process.env;
  if (skipWingetRequested(env, options)) {
    return { skipped: true, ok: true };
  }
  const platform = options.platform ?? process.platform;
  if (platform !== 'win32') {
    return { skipped: true, ok: true };
  }

  const found = findWinget(options);
  if (found) {
    return { skipped: false, alreadyPresent: true, ok: true, ...found };
  }

  try {
    const installed = await bootstrapWinget(options);
    if (!installed.ok) return installed;
    const after = findWinget(options);
    return {
      skipped: false,
      installed: true,
      ok: Boolean(after),
      wingetPath: after?.wingetPath,
      source: after?.source ?? 'bootstrap',
      message: after ? undefined : installed.message,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { skipped: false, installed: false, ok: false, message: detail };
  }
}

async function bootstrapWinget(options = {}) {
  const env = options.env ?? process.env;
  const runtimeDir = options.runtimeDir
    ?? join(env.HOME ?? env.USERPROFILE ?? defaultHome(), '.superliora', 'runtime', 'winget');
  const download = options.downloadToFile ?? downloadToFile;
  const addAppx = options.addAppxPackage ?? defaultAddAppxPackage;
  const expandZip = options.expandZip ?? defaultExpandZip;
  const listAppx = options.listAppxFiles ?? defaultListAppxFiles;

  await mkdir(runtimeDir, { recursive: true });
  const vclibs = join(runtimeDir, 'VCLibs.Desktop.appx');
  const depsZip = join(runtimeDir, 'deps.zip');
  const bundle = join(runtimeDir, 'DesktopAppInstaller.msixbundle');

  await download(VCLIBS_DESKTOP_URL, vclibs);
  addAppx(vclibs);

  await download(WINGET_DEPS_URL, depsZip);
  const depsDir = join(runtimeDir, 'deps');
  expandZip(depsZip, depsDir);
  for (const pkg of listAppx(depsDir)) {
    if (!/[\\/]x64[\\/]/i.test(pkg) && !pkg.toLowerCase().includes('_x64')) continue;
    addAppx(pkg);
  }

  await download(WINGET_BUNDLE_URL, bundle);
  const added = addAppx(bundle);
  if (added.status !== 0) {
    return {
      ok: false,
      installed: false,
      message: added.message ?? 'winget bootstrap failed',
    };
  }
  return { ok: true, installed: true };
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

function defaultAddAppxPackage(appxPath) {
  if (process.platform !== 'win32') return { status: 1, message: 'not windows' };
  const ps = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `Add-AppxPackage -Path '${escapePs(appxPath)}' -ErrorAction Continue`,
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  return {
    status: ps.error ? 1 : (ps.status ?? 1),
    message: ps.stderr || ps.stdout || ps.error?.message,
  };
}

function defaultExpandZip(zipPath, dest) {
  spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `Expand-Archive -Path '${escapePs(zipPath)}' -DestinationPath '${escapePs(dest)}' -Force`,
    ],
    { encoding: 'utf8', windowsHide: true },
  );
}

function defaultListAppxFiles(root) {
  const result = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `Get-ChildItem -LiteralPath '${escapePs(root)}' -Recurse -Include *.appx,*.msix | ForEach-Object { $_.FullName }`,
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  if (result.status !== 0) return [];
  return (result.stdout ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
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
